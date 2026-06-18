import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import speakeasy from 'speakeasy';
import { config } from '../config';
import { prisma } from '../lib/prisma';



export interface AuthRequest extends Request {
  user?: {
    id: string;
    walletAddress: string;
  };
}

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
export function verifyWalletSignature(
  wallet: string,
  nonce: string,
  timestamp: number,
  signature: string
): boolean {
  try {
    const message = {
      wallet,
      nonce,
      timestamp,
    };

    const recoveredAddress = ethers.verifyTypedData(
      EIP712_DOMAIN,
      EIP712_TYPES,
      message,
      signature
    );

    return recoveredAddress.toLowerCase() === wallet.toLowerCase();
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Verify a TOTP token using speakeasy.
 */
export function verifyTOTP(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 4, // Allow ±2 minutes of clock drift
  });
}

/**
 * Generate a TOTP secret for a new user.
 */
export function generateTOTPSecret(walletAddress: string): {
  secret: string;
  otpauthUrl: string;
} {
  const totpSecret = speakeasy.generateSecret({
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
export function generateJWT(walletAddress: string, userId: string): string {
  return jwt.sign(
    {
      walletAddress: walletAddress.toLowerCase(),
      userId,
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
    }
  );
}

/**
 * Verify a JWT token and return the payload.
 */
export function verifyJWT(token: string): { walletAddress: string; userId: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      walletAddress: string;
      userId: string;
    };
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Express middleware: authenticate requests via JWT Bearer token.
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
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

    const user = await prisma.user.findUnique({
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
      await prisma.user.update({
        where: { id: user.id },
        data: { isLocked: false, lockedUntil: null },
      });
    }

    req.user = {
      id: user.id,
      walletAddress: user.walletAddress,
    };

    next();
  } catch (error) {
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
export async function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const isAdmin = config.admin.wallets.includes(req.user.walletAddress.toLowerCase());

    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authorization error',
    });
  }
}
