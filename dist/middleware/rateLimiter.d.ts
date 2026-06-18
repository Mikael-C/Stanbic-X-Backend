/**
 * General API rate limiter: 100 requests per minute per IP.
 */
export declare const generalRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * AI endpoint rate limiter: 100 requests per minute per IP.
 * Combined with the jailbreak defender's per-user daily tracking (1000/day).
 */
export declare const aiRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * Strict rate limiter for auth endpoints: 10 requests per minute.
 */
export declare const authRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/**
 * Withdrawal rate limiter: 5 requests per minute.
 */
export declare const withdrawalRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
//# sourceMappingURL=rateLimiter.d.ts.map