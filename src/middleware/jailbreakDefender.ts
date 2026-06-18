import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from './auth';



/**
 * Known jailbreak patterns — regex patterns that detect prompt injection,
 * role hijacking, system prompt extraction, and other adversarial inputs.
 */
const JAILBREAK_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'system_prompt_extraction',
    pattern: /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules|guidelines)/i,
  },
  {
    name: 'role_hijacking',
    pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you(?:'re|\s+are))|roleplay\s+as|simulate\s+being|behave\s+as(?:\s+if)?)/i,
  },
  {
    name: 'prompt_leak',
    pattern: /(?:show|reveal|display|print|output|repeat|echo)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules|guidelines|configuration)/i,
  },
  {
    name: 'encoding_bypass',
    pattern: /(?:base64|hex|rot13|binary|morse|ascii)\s*(?:encode|decode|translate|convert)/i,
  },
  {
    name: 'dan_jailbreak',
    pattern: /\b(?:DAN|do\s+anything\s+now|jailbreak(?:ed)?|unfiltered|uncensored)\b/i,
  },
  {
    name: 'code_execution',
    pattern: /(?:execute|run|eval|exec)\s+(?:this\s+)?(?:code|script|command|shell|bash|python|javascript)/i,
  },
  {
    name: 'developer_mode',
    pattern: /(?:developer|debug|maintenance|god|admin|root)\s+mode/i,
  },
  {
    name: 'hypothetical_bypass',
    pattern: /(?:hypothetically|theoretically|in\s+a\s+fictional|imagine\s+(?:you|a)\s+(?:could|were|are))\s+(?:.*?)(?:bypass|ignore|break|hack)/i,
  },
  {
    name: 'instruction_override',
    pattern: /(?:new\s+instructions?|override\s+(?:your|the)\s+(?:rules|instructions|guidelines)|from\s+now\s+on\s+you\s+(?:will|must|should))/i,
  },
  {
    name: 'token_smuggling',
    pattern: /(?:\[SYSTEM\]|\[INST\]|\[\/INST\]|<<SYS>>|<\|im_start\|>|<\|system\|>)/i,
  },
  {
    name: 'persona_manipulation',
    pattern: /(?:forget\s+(?:that\s+)?you(?:'re|\s+are)\s+an?\s+AI|you\s+(?:don't|do\s+not)\s+have\s+(?:any\s+)?(?:rules|restrictions|limitations|guidelines))/i,
  },
  {
    name: 'sql_injection_attempt',
    pattern: /(?:DROP\s+TABLE|SELECT\s+\*\s+FROM|INSERT\s+INTO|DELETE\s+FROM|UNION\s+SELECT|OR\s+1\s*=\s*1)/i,
  },
];

/**
 * In-memory rate tracking for AI requests per user.
 */
const userRequestMap: Map<string, { timestamps: number[]; lockoutCount: number; lockoutStart: number | null }> = new Map();

/**
 * Check if the input contains a jailbreak pattern.
 * @returns The name of the detected pattern, or null if clean.
 */
export function checkJailbreak(input: string): string | null {
  for (const { name, pattern } of JAILBREAK_PATTERNS) {
    if (pattern.test(input)) {
      return name;
    }
  }
  return null;
}

/**
 * Sanitize input for safe logging (remove potentially harmful content).
 */
function sanitizeForLogging(input: string): string {
  return input
    .replace(/[<>]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .substring(0, 500);
}

/**
 * Rate limit check for a given user ID.
 * Enforces per-minute and per-day limits.
 * @returns Object with allowed status and remaining counts.
 */
export function rateLimitCheck(userId: string, countRequest = true): {
  allowed: boolean;
  reason?: string;
  minuteRemaining: number;
  dailyRemaining: number;
} {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const PER_MINUTE_LIMIT = 100;
  const PER_DAY_LIMIT = 1000;

  let userData = userRequestMap.get(userId);
  if (!userData) {
    userData = { timestamps: [], lockoutCount: 0, lockoutStart: null };
    userRequestMap.set(userId, userData);
  }

  // Clean old timestamps
  userData.timestamps = userData.timestamps.filter(t => t > oneDayAgo);

  const minuteRequests = userData.timestamps.filter(t => t > oneMinuteAgo).length;
  const dailyRequests = userData.timestamps.length;

  if (minuteRequests >= PER_MINUTE_LIMIT) {
    return {
      allowed: false,
      reason: 'Rate limit exceeded: too many requests per minute',
      minuteRemaining: 0,
      dailyRemaining: PER_DAY_LIMIT - dailyRequests,
    };
  }

  if (dailyRequests >= PER_DAY_LIMIT) {
    return {
      allowed: false,
      reason: 'Rate limit exceeded: daily limit reached',
      minuteRemaining: PER_MINUTE_LIMIT - minuteRequests,
      dailyRemaining: 0,
    };
  }

  // Record this request
  if (countRequest) {
    userData.timestamps.push(now);
  }

  return {
    allowed: true,
    minuteRemaining: PER_MINUTE_LIMIT - minuteRequests - 1,
    dailyRemaining: PER_DAY_LIMIT - dailyRequests - 1,
  };
}

/**
 * Lockout check: if a user has 5+ jailbreak attempts in the last 10 minutes,
 * they are locked out for 30 minutes.
 * @returns Object with locked status and optional unlock time.
 */
export function lockoutCheck(userId: string): {
  locked: boolean;
  unlockAt?: Date;
  attemptsInWindow: number;
} {
  const LOCKOUT_THRESHOLD = 5;
  const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

  const now = Date.now();
  let userData = userRequestMap.get(userId);

  if (!userData) {
    return { locked: false, attemptsInWindow: 0 };
  }

  // Check if currently locked out
  if (userData.lockoutStart) {
    const lockoutEnd = userData.lockoutStart + LOCKOUT_DURATION_MS;
    if (now < lockoutEnd) {
      return {
        locked: true,
        unlockAt: new Date(lockoutEnd),
        attemptsInWindow: userData.lockoutCount,
      };
    } else {
      // Lockout expired, reset
      userData.lockoutStart = null;
      userData.lockoutCount = 0;
    }
  }

  return {
    locked: false,
    attemptsInWindow: userData.lockoutCount,
  };
}

/**
 * Increment the jailbreak attempt counter for lockout tracking.
 */
function incrementLockoutCounter(userId: string): void {
  const LOCKOUT_THRESHOLD = 5;
  const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

  let userData = userRequestMap.get(userId);
  if (!userData) {
    userData = { timestamps: [], lockoutCount: 0, lockoutStart: null };
    userRequestMap.set(userId, userData);
  }

  userData.lockoutCount += 1;

  if (userData.lockoutCount >= LOCKOUT_THRESHOLD) {
    userData.lockoutStart = Date.now();
  }
}

/**
 * Get a list of all currently locked users from the in-memory map.
 */
export function getLockedUsersData(): Array<{ userId: string; lockoutStart: number }> {
  const lockedUsers: Array<{ userId: string; lockoutStart: number }> = [];
  for (const [userId, data] of userRequestMap.entries()) {
    if (data.lockoutStart) {
      lockedUsers.push({ userId, lockoutStart: data.lockoutStart });
    }
  }
  return lockedUsers;
}

/**
 * Manually unlock a user (reset their lockout status).
 */
export function unlockUserById(userId: string): boolean {
  const userData = userRequestMap.get(userId);
  if (userData) {
    userData.lockoutStart = null;
    userData.lockoutCount = 0;
    return true;
  }
  return false;
}

/**
 * Express middleware: combines jailbreak detection, rate limiting, and lockout checks.
 * Logs all jailbreak attempts to the database.
 */
export async function jailbreakMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id || 'anonymous';
    const walletAddress = req.user?.walletAddress || 'unknown';

    // Step 1: Check lockout
    const lockout = lockoutCheck(userId);
    if (lockout.locked) {
      res.status(429).json({
        success: false,
        error: 'Account temporarily locked due to repeated policy violations',
        unlockAt: lockout.unlockAt?.toISOString(),
      });
      return;
    }

    // Step 2: Check rate limits
    const rateLimit = rateLimitCheck(userId);
    if (!rateLimit.allowed) {
      res.status(429).json({
        success: false,
        error: rateLimit.reason,
        minuteRemaining: rateLimit.minuteRemaining,
        dailyRemaining: rateLimit.dailyRemaining,
      });
      return;
    }

    // Step 3: Check for jailbreak patterns in the message body
    const message = req.body?.message || req.body?.prompt || '';
    if (typeof message === 'string' && message.length > 0) {
      const detectedPattern = checkJailbreak(message);

      if (detectedPattern) {
        // Increment lockout counter
        incrementLockoutCounter(userId);

        // Log to database
        try {
          await prisma.jailbreakAttempt.create({
            data: {
              userId: req.user?.id || null,
              walletAddress,
              promptSanitized: sanitizeForLogging(message),
              detectedPattern,
              actionTaken: 'blocked',
            },
          });
        } catch (dbError) {
          console.error('Failed to log jailbreak attempt:', dbError);
        }

        res.status(403).json({
          success: false,
          error: 'Your message was flagged by our security system. Please rephrase your question about prediction markets.',
          code: 'JAILBREAK_DETECTED',
        });
        return;
      }
    }

    next();
  } catch (error) {
    console.error('Jailbreak middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Security check failed',
    });
  }
}
