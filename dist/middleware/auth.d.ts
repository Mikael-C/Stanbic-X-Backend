import { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    user?: {
        id: string;
        walletAddress: string;
    };
}
/**
 * Verify an EIP-712 signed message and recover the signer address.
 */
export declare function verifyWalletSignature(wallet: string, nonce: string, timestamp: number, signature: string): boolean;
/**
 * Verify a TOTP token using speakeasy.
 */
export declare function verifyTOTP(secret: string, token: string): boolean;
/**
 * Generate a TOTP secret for a new user.
 */
export declare function generateTOTPSecret(walletAddress: string): {
    secret: string;
    otpauthUrl: string;
};
/**
 * Generate a JWT token for authenticated sessions.
 */
export declare function generateJWT(walletAddress: string, userId: string): string;
/**
 * Verify a JWT token and return the payload.
 */
export declare function verifyJWT(token: string): {
    walletAddress: string;
    userId: string;
} | null;
/**
 * Express middleware: authenticate requests via JWT Bearer token.
 */
export declare function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
/**
 * Express middleware: verify the authenticated user is an admin.
 */
export declare function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map