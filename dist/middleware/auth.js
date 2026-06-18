"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWalletSignature = verifyWalletSignature;
exports.verifyTOTP = verifyTOTP;
exports.generateTOTPSecret = generateTOTPSecret;
exports.generateJWT = generateJWT;
exports.verifyJWT = verifyJWT;
exports.authMiddleware = authMiddleware;
exports.adminMiddleware = adminMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const ethers_1 = require("ethers");
const speakeasy_1 = __importDefault(require("speakeasy"));
const config_1 = require("../config");
const prisma_1 = require("../lib/prisma");
/**
 * EIP-712 Domain for wallet signature verification.
 */
const EIP712_DOMAIN = {
    name: 'SX Secure Prediction Marketplace',
    version: '1',
    chainId: 1,
};
const EIP712_TYPES = {
    Login: [
        { name: 'wallet', type: 'address' },
        { name: 'nonce', type: 'string' },
        { name: 'timestamp', type: 'uint256' },
    ],
};
/**
 * Verify an EIP-712 signed message and recover the signer address.
 */
function verifyWalletSignature(wallet, nonce, timestamp, signature) {
    try {
        const message = {
            wallet,
            nonce,
            timestamp,
        };
        const recoveredAddress = ethers_1.ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, message, signature);
        return recoveredAddress.toLowerCase() === wallet.toLowerCase();
    }
    catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}
/**
 * Verify a TOTP token using speakeasy.
 */
function verifyTOTP(secret, token) {
    return speakeasy_1.default.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2,
    });
}
/**
 * Generate a TOTP secret for a new user.
 */
function generateTOTPSecret(walletAddress) {
    const totpSecret = speakeasy_1.default.generateSecret({
        name: `SX Secure (${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)})`,
        issuer: 'SX Secure Prediction Marketplace',
        length: 20,
    });
    return {
        secret: totpSecret.base32,
        otpauthUrl: totpSecret.otpauth_url || '',
    };
}
/**
 * Generate a JWT token for authenticated sessions.
 */
function generateJWT(walletAddress, userId) {
    return jsonwebtoken_1.default.sign({
        walletAddress: walletAddress.toLowerCase(),
        userId,
    }, config_1.config.jwt.secret, {
        expiresIn: config_1.config.jwt.expiresIn,
    });
}
/**
 * Verify a JWT token and return the payload.
 */
function verifyJWT(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
        return decoded;
    }
    catch (error) {
        return null;
    }
}
/**
 * Express middleware: authenticate requests via JWT Bearer token.
 */
async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                success: false,
                error: 'Authorization header missing or malformed. Use: Bearer <token>',
            });
            return;
        }
        const token = authHeader.split(' ')[1];
        const payload = verifyJWT(token);
        if (!payload) {
            res.status(401).json({
                success: false,
                error: 'Invalid or expired token',
            });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: payload.walletAddress },
        });
        if (!user) {
            res.status(401).json({
                success: false,
                error: 'User not found',
            });
            return;
        }
        if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
            res.status(403).json({
                success: false,
                error: 'Account is temporarily locked',
                lockedUntil: user.lockedUntil.toISOString(),
            });
            return;
        }
        // Unlock if lock period has expired
        if (user.isLocked && user.lockedUntil && user.lockedUntil <= new Date()) {
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { isLocked: false, lockedUntil: null },
            });
        }
        req.user = {
            id: user.id,
            walletAddress: user.walletAddress,
        };
        next();
    }
    catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication error',
        });
    }
}
/**
 * Express middleware: verify the authenticated user is an admin.
 */
async function adminMiddleware(req, res, next) {
    try {
        if (!req.user) {
            res.status(401).json({
                success: false,
                error: 'Authentication required',
            });
            return;
        }
        const isAdmin = config_1.config.admin.wallets.includes(req.user.walletAddress.toLowerCase());
        if (!isAdmin) {
            res.status(403).json({
                success: false,
                error: 'Admin access required',
            });
            return;
        }
        next();
    }
    catch (error) {
        console.error('Admin middleware error:', error);
        res.status(500).json({
            success: false,
            error: 'Authorization error',
        });
    }
}
//# sourceMappingURL=auth.js.map