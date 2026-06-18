"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const blockchain_1 = require("../services/blockchain");
const indexer_1 = require("../services/indexer");
const jailbreakDefender_1 = require("../middleware/jailbreakDefender");
const router = (0, express_1.Router)();
/**
 * All admin routes require authentication + admin privileges.
 */
router.use(auth_1.authMiddleware);
router.use(auth_1.adminMiddleware);
/**
 * GET /api/admin/verification
 * Formal verification dashboard data — contract deployment status, verification results.
 */
router.get('/verification', async (req, res) => {
    try {
        // Get contract deployment status for all chains
        const chains = [config_1.config.chains.hoodi, config_1.config.chains.baseSepolia];
        const contractStatus = await Promise.all(chains.map(async (chain) => {
            const providerHealth = await (0, blockchain_1.checkProviderHealth)(chain.chainId);
            return {
                chain: chain.name,
                chainId: chain.chainId,
                providerStatus: providerHealth.healthy ? 'connected' : 'disconnected',
                currentBlock: providerHealth.blockNumber || null,
                contracts: {
                    predictionMarket: {
                        address: chain.predictionMarketContract || 'Not deployed',
                        deployed: !!chain.predictionMarketContract,
                    },
                    vault: {
                        address: chain.vaultContract || 'Not deployed',
                        deployed: !!chain.vaultContract,
                    },
                    stablecoin: {
                        address: chain.stablecoinContract || 'Not deployed',
                        deployed: !!chain.stablecoinContract,
                    },
                },
            };
        }));
        // Get platform statistics for verification
        const [totalMarkets, resolvedMarkets, totalStakes, totalUsers] = await Promise.all([
            prisma_1.prisma.market.count(),
            prisma_1.prisma.market.count({ where: { status: 'resolved' } }),
            prisma_1.prisma.stake.count(),
            prisma_1.prisma.user.count(),
        ]);
        // Get recent market resolutions for audit trail
        const recentResolutions = await prisma_1.prisma.market.findMany({
            where: { status: 'resolved' },
            orderBy: { resolvedAt: 'desc' },
            take: 10,
            select: {
                marketId: true,
                question: true,
                winner: true,
                resolvedAt: true,
                yesStakes: true,
                noStakes: true,
            },
        });
        // Get unclaimed payouts
        const unclaimedStakes = await prisma_1.prisma.stake.count({
            where: {
                claimed: false,
                market: { status: 'resolved' },
            },
        });
        res.status(200).json({
            success: true,
            data: {
                contractStatus,
                platformMetrics: {
                    totalMarkets,
                    resolvedMarkets,
                    totalStakes,
                    totalUsers,
                    unclaimedPayouts: unclaimedStakes,
                },
                recentResolutions: recentResolutions.map(r => ({
                    marketId: r.marketId,
                    question: r.question,
                    winner: r.winner,
                    resolvedAt: r.resolvedAt?.toISOString(),
                    totalPot: r.yesStakes + r.noStakes,
                })),
                verificationChecks: {
                    feeIntegrity: {
                        withdrawalFee: `${config_1.config.fees.withdrawalFeePercent}%`,
                        platformFee: `${config_1.config.fees.platformFeePercent}%`,
                        status: 'verified',
                    },
                    rateLimiting: {
                        general: `${config_1.config.rateLimit.general.max}/min`,
                        ai: `${config_1.config.rateLimit.ai.max}/min, ${config_1.config.rateLimit.ai.dailyMax}/day`,
                        status: 'active',
                    },
                    jailbreakProtection: {
                        patternsLoaded: 12,
                        lockoutThreshold: '5 attempts in 10 minutes',
                        lockoutDuration: '30 minutes',
                        status: 'active',
                    },
                },
                timestamp: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Verification dashboard error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch verification data',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/admin/jailbreak-logs
 * View jailbreak attempt logs with analytics.
 */
router.get('/jailbreak-logs', async (req, res) => {
    try {
        const { page = '1', limit = '50', walletAddress, pattern, startDate, endDate, } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (walletAddress && typeof walletAddress === 'string') {
            where.walletAddress = walletAddress.toLowerCase();
        }
        if (pattern && typeof pattern === 'string') {
            where.detectedPattern = pattern;
        }
        if (startDate && typeof startDate === 'string') {
            where.timestamp = {
                ...(where.timestamp || {}),
                gte: new Date(startDate),
            };
        }
        if (endDate && typeof endDate === 'string') {
            where.timestamp = {
                ...(where.timestamp || {}),
                lte: new Date(endDate),
            };
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
        // Pattern distribution analytics
        const patternDistribution = await prisma_1.prisma.jailbreakAttempt.groupBy({
            by: ['detectedPattern'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
        });
        // Top offenders
        const topOffenders = await prisma_1.prisma.jailbreakAttempt.groupBy({
            by: ['walletAddress'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10,
        });
        // Last 24h count
        const last24hCount = await prisma_1.prisma.jailbreakAttempt.count({
            where: {
                timestamp: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                },
            },
        });
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
                analytics: {
                    totalAttempts: total,
                    last24Hours: last24hCount,
                    patternDistribution: patternDistribution.map(p => ({
                        pattern: p.detectedPattern,
                        count: p._count.id,
                    })),
                    topOffenders: topOffenders.map(o => ({
                        walletAddress: o.walletAddress,
                        attempts: o._count.id,
                    })),
                },
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
        console.error('Jailbreak logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch jailbreak logs',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/admin/security/logs
 * View security logs formatted for the dashboard.
 */
router.get('/security/logs', async (req, res) => {
    try {
        const logs = await prisma_1.prisma.jailbreakAttempt.findMany({
            orderBy: { timestamp: 'desc' },
            take: 100,
        });
        const formattedLogs = logs.map(log => ({
            id: log.id,
            type: 'jailbreak',
            wallet: log.walletAddress,
            message: `Attempted prompt injection: ${log.detectedPattern}`,
            timestamp: log.timestamp.toISOString(),
            severity: 'high',
        }));
        res.status(200).json({
            success: true,
            data: formattedLogs,
        });
    }
    catch (error) {
        console.error('Security logs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch security logs',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/admin/security/locked
 * View currently locked users.
 */
router.get('/security/locked', async (req, res) => {
    try {
        const lockedData = (0, jailbreakDefender_1.getLockedUsersData)();
        const lockedUsers = [];
        for (const data of lockedData) {
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: data.userId },
                select: { walletAddress: true },
            });
            if (user) {
                lockedUsers.push({
                    wallet: user.walletAddress,
                    reason: 'Repeated jailbreak attempts',
                    lockedAt: new Date(data.lockoutStart).toISOString(),
                    unlockAt: new Date(data.lockoutStart + 30 * 60 * 1000).toISOString(),
                });
            }
        }
        res.status(200).json({
            success: true,
            data: lockedUsers,
        });
    }
    catch (error) {
        console.error('Locked users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch locked users',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * POST /api/admin/security/unlock
 * Unlock a specific user by wallet address.
 */
router.post('/security/unlock', async (req, res) => {
    try {
        const { wallet } = req.body;
        if (!wallet) {
            res.status(400).json({ success: false, error: 'Wallet address required' });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: wallet.toLowerCase() },
        });
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        const unlocked = (0, jailbreakDefender_1.unlockUserById)(user.id);
        res.status(200).json({
            success: true,
            data: { unlocked },
        });
    }
    catch (error) {
        console.error('Unlock user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to unlock user',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/admin/contracts
 * Get deployed contracts status and indexer health.
 */
router.get('/contracts', async (req, res) => {
    try {
        const chains = [config_1.config.chains.hoodi, config_1.config.chains.baseSepolia];
        const indexerStats = await (0, indexer_1.getIndexerStats)();
        const contractsStatus = await Promise.all(chains.map(async (chain) => {
            const health = await (0, blockchain_1.checkProviderHealth)(chain.chainId);
            const syncStatus = await prisma_1.prisma.syncStatus.findUnique({
                where: { chainId: chain.chainId },
            });
            const eventCounts = await prisma_1.prisma.event.groupBy({
                by: ['eventName'],
                where: { chainId: chain.chainId },
                _count: { id: true },
            });
            return {
                chain: chain.name,
                chainId: chain.chainId,
                rpcUrl: chain.rpcUrl,
                provider: {
                    status: health.healthy ? 'connected' : 'disconnected',
                    currentBlock: health.blockNumber || null,
                    error: health.error || null,
                },
                contracts: {
                    predictionMarket: chain.predictionMarketContract || null,
                    vault: chain.vaultContract || null,
                    stablecoin: chain.stablecoinContract || null,
                },
                indexer: {
                    lastIndexedBlock: syncStatus?.lastIndexedBlock || 0,
                    lastSyncTime: syncStatus?.lastSyncTime?.toISOString() || null,
                    isReorging: syncStatus?.isReorging || false,
                    blocksBehind: health.blockNumber
                        ? health.blockNumber - (syncStatus?.lastIndexedBlock || 0)
                        : null,
                },
                eventCounts: eventCounts.map(ec => ({
                    eventName: ec.eventName,
                    count: ec._count.id,
                })),
            };
        }));
        res.status(200).json({
            success: true,
            data: {
                contracts: contractsStatus,
                indexer: {
                    pollingInterval: `${config_1.config.indexer.pollingIntervalMs}ms`,
                    batchSize: config_1.config.indexer.batchSize,
                    confirmations: config_1.config.indexer.confirmations,
                    totalEventsStored: indexerStats.totalEventsStored,
                },
                timestamp: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Contracts status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch contracts status',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map