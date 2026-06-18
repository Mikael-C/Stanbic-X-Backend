"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const uuid_1 = require("uuid");
const qrcode_1 = __importDefault(require("qrcode"));
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const crypto_1 = require("crypto");
const router = (0, express_1.Router)();
// In-memory nonce store (use Redis in production)
const nonceStore = new Map();
// Clean expired nonces every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of nonceStore.entries()) {
        if (now - value.timestamp > 5 * 60 * 1000) {
            nonceStore.delete(key);
        }
    }
}, 5 * 60 * 1000);
/**
 * POST /api/auth/nonce
 * Generate a nonce for wallet signature authentication.
 */
router.post('/nonce', rateLimiter_1.authRateLimiter, async (req, res) => {
    try {
        const { wallet } = req.body;
        if (!wallet) {
            res.status(400).json({
                success: false,
                error: 'Wallet address is required',
            });
            return;
        }
        const nonce = (0, crypto_1.randomBytes)(32).toString('hex');
        nonceStore.set(wallet.toLowerCase(), { nonce, timestamp: Date.now() });
        res.status(200).json({
            success: true,
            nonce,
        });
    }
    catch (error) {
        console.error('Nonce generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate nonce',
        });
    }
});
/**
 * POST /api/auth/login
 * Authenticate with wallet signature. Creates user if not exists.
 */
router.post('/login', rateLimiter_1.authRateLimiter, async (req, res) => {
    try {
        const { wallet, signature } = req.body;
        if (!wallet || !signature) {
            res.status(400).json({
                success: false,
                error: 'Wallet and signature are required',
            });
            return;
        }
        const walletLower = wallet.toLowerCase();
        // Verify the nonce exists
        const nonceData = nonceStore.get(walletLower);
        if (!nonceData) {
            res.status(401).json({
                success: false,
                error: 'No nonce found. Please request a new nonce first.',
            });
            return;
        }
        // Check nonce isn't expired (5 min)
        if (Date.now() - nonceData.timestamp > 5 * 60 * 1000) {
            nonceStore.delete(walletLower);
            res.status(401).json({
                success: false,
                error: 'Nonce expired. Please request a new nonce.',
            });
            return;
        }
        // Verify signature against the message the frontend signed
        const { verifyMessage } = await Promise.resolve().then(() => __importStar(require('ethers')));
        const expectedMessage = `Sign this message to authenticate with SX Secure.\n\nNonce: ${nonceData.nonce}`;
        let recoveredAddress;
        try {
            recoveredAddress = verifyMessage(expectedMessage, signature);
        }
        catch {
            res.status(401).json({
                success: false,
                error: 'Invalid signature',
            });
            return;
        }
        if (recoveredAddress.toLowerCase() !== walletLower) {
            res.status(401).json({
                success: false,
                error: 'Signature does not match wallet address',
            });
            return;
        }
        // Clear the nonce (one-time use)
        nonceStore.delete(walletLower);
        // Find or create user
        let user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: walletLower },
        });
        if (!user) {
            // New user — create account and set up TOTP
            const totp = (0, auth_1.generateTOTPSecret)(walletLower);
            const sxId = `SX-${(0, uuid_1.v4)().split('-')[0].toUpperCase()}`;
            const qrCode = await qrcode_1.default.toDataURL(totp.otpauthUrl);
            user = await prisma_1.prisma.user.create({
                data: {
                    walletAddress: walletLower,
                    sxId,
                    totpSecret: totp.secret,
                },
            });
            // Return with TOTP setup required — no JWT until TOTP is verified
            res.status(200).json({
                success: true,
                data: {
                    token: null,
                    totpRequired: true,
                    walletAddress: user.walletAddress,
                    totpSetup: {
                        qrCode,
                    },
                },
            });
            return;
        }
        // Existing user
        // Check lockout
        if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
            res.status(403).json({
                success: false,
                error: 'Account is temporarily locked',
                lockedUntil: user.lockedUntil.toISOString(),
            });
            return;
        }
        if (user.totpSecret) {
            // TOTP is set up — require verification, no JWT until TOTP verified
            res.status(200).json({
                success: true,
                data: {
                    token: null,
                    totpRequired: true,
                    walletAddress: user.walletAddress,
                },
            });
        }
        else {
            // No TOTP — direct login (shouldn't happen normally)
            const token = (0, auth_1.generateJWT)(user.walletAddress, user.id);
            res.status(200).json({
                success: true,
                data: {
                    token,
                    totpRequired: false,
                },
            });
        }
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * POST /api/auth/totp/verify
 * Verify a TOTP code for completing authentication.
 */
router.post('/totp/verify', async (req, res) => {
    try {
        const { token: totpToken, walletAddress } = req.body;
        if (!totpToken || !walletAddress) {
            res.status(400).json({
                success: false,
                error: 'TOTP token and walletAddress are required',
            });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: walletAddress.toLowerCase() },
        });
        if (!user || !user.totpSecret) {
            res.status(400).json({
                success: false,
                error: 'TOTP not configured',
            });
            return;
        }
        const isValid = (0, auth_1.verifyTOTP)(user.totpSecret, totpToken);
        if (!isValid) {
            res.status(401).json({
                success: false,
                verified: false,
                error: 'Invalid TOTP code',
            });
            return;
        }
        // TOTP verified — now generate and return the JWT
        const jwt = (0, auth_1.generateJWT)(user.walletAddress, user.id);
        res.status(200).json({
            success: true,
            verified: true,
            token: jwt,
        });
    }
    catch (error) {
        console.error('TOTP verify error:', error);
        res.status(500).json({
            success: false,
            error: 'TOTP verification failed',
        });
    }
});
/**
 * POST /api/auth/totp/setup
 * Generate a new TOTP secret and QR code (if not already set up).
 */
router.post('/totp/setup', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        // If TOTP is already configured, require current token for re-setup
        if (user.totpSecret) {
            const { currentToken } = req.body;
            if (!currentToken) {
                res.status(400).json({ success: false, error: 'Current TOTP token is required to re-setup 2FA' });
                return;
            }
            const isValid = (0, auth_1.verifyTOTP)(user.totpSecret, currentToken);
            if (!isValid) {
                res.status(401).json({ success: false, error: 'Invalid current TOTP token' });
                return;
            }
        }
        const totp = (0, auth_1.generateTOTPSecret)(user.walletAddress);
        const qrCode = await qrcode_1.default.toDataURL(totp.otpauthUrl);
        // Update the TOTP secret
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { totpSecret: totp.secret },
        });
        res.status(200).json({
            success: true,
            qrCode,
        });
    }
    catch (error) {
        console.error('TOTP setup error:', error);
        res.status(500).json({ success: false, error: 'TOTP setup failed' });
    }
});
/**
 * GET /api/auth/profile
 * Get the authenticated user's profile.
 */
router.get('/profile', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        // Admin wallets (configurable via env)
        const adminWallets = (process.env.ADMIN_WALLETS || '').toLowerCase().split(',').filter(Boolean);
        const isAdmin = adminWallets.includes(user.walletAddress.toLowerCase());
        res.status(200).json({
            success: true,
            wallet: user.walletAddress,
            role: isAdmin ? 'admin' : 'user',
            totpEnabled: !!user.totpSecret,
            sxId: user.sxId,
            totalPredictions: user.totalPredictions,
            correctPredictions: user.correctPredictions,
            totalVolume: user.totalVolume,
            rewardsEarned: user.rewardsEarned,
            createdAt: user.createdAt.toISOString(),
        });
    }
    catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch profile' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map