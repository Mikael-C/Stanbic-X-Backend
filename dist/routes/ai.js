"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const jailbreakDefender_1 = require("../middleware/jailbreakDefender");
const rateLimiter_1 = require("../middleware/rateLimiter");
const config_1 = require("../config");
const router = (0, express_1.Router)();
/**
 * POST /api/ai/chat
 * AI chat endpoint with jailbreak protection.
 */
router.post('/chat', auth_1.authMiddleware, rateLimiter_1.aiRateLimiter, jailbreakDefender_1.jailbreakMiddleware, async (req, res) => {
    try {
        const { message, conversationId } = req.body;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            res.status(400).json({
                success: false,
                error: 'Message is required and must be a non-empty string',
            });
            return;
        }
        if (message.length > 4000) {
            res.status(400).json({
                success: false,
                error: 'Message exceeds maximum length of 4000 characters',
            });
            return;
        }
        // If AI endpoint is configured, forward to it
        if (config_1.config.ai.endpoint && config_1.config.ai.apiKey) {
            try {
                const response = await fetch(config_1.config.ai.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config_1.config.ai.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: config_1.config.ai.model,
                        messages: [
                            { role: 'system', content: config_1.config.ai.systemPrompt },
                            { role: 'user', content: message },
                        ],
                        max_tokens: config_1.config.ai.maxTokens,
                        temperature: 0.7,
                    }),
                });
                const aiResult = await response.json();
                if (aiResult.choices && aiResult.choices.length > 0) {
                    res.status(200).json({
                        success: true,
                        data: {
                            response: aiResult.choices[0].message.content,
                            conversationId: conversationId || null,
                            model: config_1.config.ai.model,
                            usage: aiResult.usage || null,
                        },
                    });
                    return;
                }
            }
            catch (aiError) {
                console.error('AI API error:', aiError.message);
                // Fall through to default response
            }
        }
        // Default response when AI endpoint is not configured or fails
        const defaultResponses = {
            odds: 'Odds in prediction markets represent the implied probability of an outcome. For example, odds of 2.0 mean a 50% implied probability. The lower the odds, the more likely the outcome is considered to be.',
            stake: 'To place a stake, select a market, choose Yes or No, and enter your amount. A 1% platform fee is applied. Your potential payout depends on the current odds at the time of staking.',
            payout: 'Payouts are calculated based on your share of the winning pool. When a market resolves, winners can claim their proportional share of the total pot.',
            market: 'Prediction markets allow you to stake on the outcomes of future events. Markets have a question, end time, and two outcomes (Yes/No). Markets are resolved by admins after the event concludes.',
            listing: 'You can sell your staked positions on the marketplace. Create a listing with your desired price. Other users can purchase your position, transferring ownership of the stake.',
            leaderboard: 'The leaderboard ranks users by prediction accuracy and trading volume. Top performers may receive rewards from the platform reward pool.',
            default: 'I\'m the SX Secure Prediction Marketplace assistant. I can help you understand prediction markets, odds, staking, payouts, listings, and leaderboard rankings. What would you like to know?',
        };
        const lowerMessage = message.toLowerCase();
        let responseText = defaultResponses.default;
        for (const [keyword, response] of Object.entries(defaultResponses)) {
            if (keyword !== 'default' && lowerMessage.includes(keyword)) {
                responseText = response;
                break;
            }
        }
        res.status(200).json({
            success: true,
            data: {
                response: responseText,
                conversationId: conversationId || null,
                model: 'sx-secure-local',
                usage: null,
            },
        });
    }
    catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({
            success: false,
            error: 'AI chat service error',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/ai/logs
 * Admin-only: view jailbreak attempt logs.
 */
router.get('/logs', auth_1.authMiddleware, auth_1.adminMiddleware, async (req, res) => {
    try {
        const { page = '1', limit = '50', walletAddress } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (walletAddress && typeof walletAddress === 'string') {
            where.walletAddress = walletAddress.toLowerCase();
        }
        const [logs, total] = await Promise.all([
            prisma_1.prisma.jailbreakAttempt.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip,
                take: limitNum,
            }),
            prisma_1.prisma.jailbreakAttempt.count({ where }),
        ]);
        const formattedLogs = logs.map(log => ({
            id: log.id,
            userId: log.userId,
            walletAddress: log.walletAddress,
            promptSanitized: log.promptSanitized,
            detectedPattern: log.detectedPattern,
            actionTaken: log.actionTaken,
            timestamp: log.timestamp.toISOString(),
        }));
        res.status(200).json({
            success: true,
            data: {
                logs: formattedLogs,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            },
        });
    }
    catch (error) {
        console.error('AI logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch AI logs',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/ai/status
 * Get AI rate limit status for the authenticated user.
 */
router.get('/status', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const rateStatus = (0, jailbreakDefender_1.rateLimitCheck)(userId, false);
        const lockStatus = (0, jailbreakDefender_1.lockoutCheck)(userId);
        // Get user's jailbreak attempt count
        const attemptCount = await prisma_1.prisma.jailbreakAttempt.count({
            where: { userId },
        });
        const recentAttempts = await prisma_1.prisma.jailbreakAttempt.count({
            where: {
                userId,
                timestamp: {
                    gte: new Date(Date.now() - 10 * 60 * 1000), // Last 10 minutes
                },
            },
        });
        res.status(200).json({
            success: true,
            data: {
                rateLimit: {
                    minuteRemaining: rateStatus.minuteRemaining,
                    dailyRemaining: rateStatus.dailyRemaining,
                },
                lockout: {
                    isLocked: lockStatus.locked,
                    unlockAt: lockStatus.unlockAt?.toISOString() || null,
                    attemptsInWindow: lockStatus.attemptsInWindow,
                },
                jailbreakAttempts: {
                    total: attemptCount,
                    recentInWindow: recentAttempts,
                },
            },
        });
    }
    catch (error) {
        console.error('AI status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch AI status',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
exports.default = router;
//# sourceMappingURL=ai.js.map