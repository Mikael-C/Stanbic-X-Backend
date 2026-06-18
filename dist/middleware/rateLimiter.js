"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withdrawalRateLimiter = exports.authRateLimiter = exports.aiRateLimiter = exports.generalRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("../config");
/**
 * General API rate limiter: 100 requests per minute per IP.
 */
exports.generalRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.general.windowMs,
    max: config_1.config.rateLimit.general.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(config_1.config.rateLimit.general.windowMs / 1000),
    },
    keyGenerator: (req) => {
        // Use wallet address if authenticated, otherwise IP
        return req.user?.walletAddress || req.ip || 'unknown';
    },
});
/**
 * AI endpoint rate limiter: 100 requests per minute per IP.
 * Combined with the jailbreak defender's per-user daily tracking (1000/day).
 */
exports.aiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.ai.windowMs,
    max: config_1.config.rateLimit.ai.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'AI rate limit exceeded. Please wait before sending more messages.',
        retryAfter: Math.ceil(config_1.config.rateLimit.ai.windowMs / 1000),
    },
    keyGenerator: (req) => {
        return req.user?.walletAddress || req.ip || 'unknown';
    },
});
/**
 * Strict rate limiter for auth endpoints: 10 requests per minute.
 */
exports.authRateLimiter = (0, express_rate_limit_1.default)({
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
exports.withdrawalRateLimiter = (0, express_rate_limit_1.default)({
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
        return req.user?.walletAddress || req.ip || 'unknown';
    },
});
//# sourceMappingURL=rateLimiter.js.map