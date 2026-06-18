import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * General API rate limiter: 100 requests per minute per IP.
 */
export const generalRateLimiter = rateLimit({
  windowMs: config.rateLimit.general.windowMs,
  max: config.rateLimit.general.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
    retryAfter: Math.ceil(config.rateLimit.general.windowMs / 1000),
  },
  keyGenerator: (req) => {
    // Use wallet address if authenticated, otherwise IP
    return (req as any).user?.walletAddress || req.ip || 'unknown';
  },
});

/**
 * AI endpoint rate limiter: 100 requests per minute per IP.
 * Combined with the jailbreak defender's per-user daily tracking (1000/day).
 */
export const aiRateLimiter = rateLimit({
  windowMs: config.rateLimit.ai.windowMs,
  max: config.rateLimit.ai.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AI rate limit exceeded. Please wait before sending more messages.',
    retryAfter: Math.ceil(config.rateLimit.ai.windowMs / 1000),
  },
  keyGenerator: (req) => {
    return (req as any).user?.walletAddress || req.ip || 'unknown';
  },
});

/**
 * Strict rate limiter for auth endpoints: 10 requests per minute.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
    retryAfter: 60,
  },
});

/**
 * Withdrawal rate limiter: 5 requests per minute.
 */
export const withdrawalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many withdrawal attempts. Please try again later.',
    retryAfter: 60,
  },
  keyGenerator: (req) => {
    return (req as any).user?.walletAddress || req.ip || 'unknown';
  },
});
