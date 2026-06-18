import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import {
  AuthRequest,
  authMiddleware,
  verifyWalletSignature,
  verifyTOTP,
  generateTOTPSecret,
  generateJWT,
} from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { randomBytes } from 'crypto';

const router = Router();


// In-memory nonce store (use Redis in production)
const nonceStore = new Map<string, { nonce: string; timestamp: number }>();

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
router.post('/nonce', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { wallet } = req.body;

    if (!wallet) {
      res.status(400).json({
        success: false,
        error: 'Wallet address is required',
      });
      return;
    }

    const nonce = randomBytes(32).toString('hex');
    nonceStore.set(wallet.toLowerCase(), { nonce, timestamp: Date.now() });

    res.status(200).json({
      success: true,
      nonce,
    });
  } catch (error: any) {
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
router.post('/login', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
    const { verifyMessage } = await import('ethers');
    const expectedMessage = `Sign this message to authenticate with SX Secure.\n\nNonce: ${nonceData.nonce}`;

    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(expectedMessage, signature);
    } catch {
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
    let user = await prisma.user.findUnique({
      where: { walletAddress: walletLower },
    });

    if (!user) {
      // New user — create account and set up TOTP
      const totp = generateTOTPSecret(walletLower);
      const sxId = `SX-${uuidv4().split('-')[0].toUpperCase()}`;
      const qrCode = await QRCode.toDataURL(totp.otpauthUrl);

      user = await prisma.user.create({
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
    } else {
      // User exists but has no TOTP secret (e.g. created by indexer or reset)
      // Generate new TOTP secret
      const totp = generateTOTPSecret(walletLower);
      const qrCode = await QRCode.toDataURL(totp.otpauthUrl);

      await prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: totp.secret },
      });

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
    }
  } catch (error: any) {
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
router.post('/totp/verify', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token: totpToken, walletAddress } = req.body;

    if (!totpToken || !walletAddress) {
      res.status(400).json({
        success: false,
        error: 'TOTP token and walletAddress are required',
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!user || !user.totpSecret) {
      res.status(400).json({
        success: false,
        error: 'TOTP not configured',
      });
      return;
    }

    const isValid = verifyTOTP(user.totpSecret, totpToken);
    if (!isValid) {
      res.status(401).json({
        success: false,
        verified: false,
        error: 'Invalid TOTP code',
      });
      return;
    }

    // TOTP verified — now generate and return the JWT
    const jwtToken = generateJWT(user.walletAddress, user.id);

    res.status(200).json({
      success: true,
      verified: true,
      jwt: jwtToken,
    });
  } catch (error: any) {
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
router.post('/totp/setup', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

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
      const isValid = verifyTOTP(user.totpSecret, currentToken);
      if (!isValid) {
        res.status(401).json({ success: false, error: 'Invalid current TOTP token' });
        return;
      }
    }

    const totp = generateTOTPSecret(user.walletAddress);
    const qrCode = await QRCode.toDataURL(totp.otpauthUrl);

    // Update the TOTP secret
    await prisma.user.update({
      where: { id: userId },
      data: { totpSecret: totp.secret },
    });

    res.status(200).json({
      success: true,
      qrCode,
    });
  } catch (error: any) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ success: false, error: 'TOTP setup failed' });
  }
});

/**
 * GET /api/auth/profile
 * Get the authenticated user's profile.
 */
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

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
  } catch (error: any) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

export default router;
