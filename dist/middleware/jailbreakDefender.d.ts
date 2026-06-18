import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
/**
 * Check if the input contains a jailbreak pattern.
 * @returns The name of the detected pattern, or null if clean.
 */
export declare function checkJailbreak(input: string): string | null;
/**
 * Rate limit check for a given user ID.
 * Enforces per-minute and per-day limits.
 * @returns Object with allowed status and remaining counts.
 */
export declare function rateLimitCheck(userId: string, countRequest?: boolean): {
    allowed: boolean;
    reason?: string;
    minuteRemaining: number;
    dailyRemaining: number;
};
/**
 * Lockout check: if a user has 5+ jailbreak attempts in the last 10 minutes,
 * they are locked out for 30 minutes.
 * @returns Object with locked status and optional unlock time.
 */
export declare function lockoutCheck(userId: string): {
    locked: boolean;
    unlockAt?: Date;
    attemptsInWindow: number;
};
/**
 * Get a list of all currently locked users from the in-memory map.
 */
export declare function getLockedUsersData(): Array<{
    userId: string;
    lockoutStart: number;
}>;
/**
 * Manually unlock a user (reset their lockout status).
 */
export declare function unlockUserById(userId: string): boolean;
/**
 * Express middleware: combines jailbreak detection, rate limiting, and lockout checks.
 * Logs all jailbreak attempts to the database.
 */
export declare function jailbreakMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=jailbreakDefender.d.ts.map