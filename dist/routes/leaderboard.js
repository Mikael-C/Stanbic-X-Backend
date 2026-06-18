"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const fees_1 = require("../utils/fees");
const websocket_1 = require("../services/websocket");
const router = (0, express_1.Router)();
/**
 * GET /api/leaderboard
 * Get top 10 users by accuracy or volume.
 */
router.get('/', async (req, res) => {
    try {
        const { type = 'accuracy' } = req.query;
        if (!['accuracy', 'volume'].includes(type)) {
            res.status(400).json({
                success: false,
                error: 'Type must be "accuracy" or "volume"',
            });
            return;
        }
        // Get users with prediction stats
        const users = await prisma_1.prisma.user.findMany({
            where: {
                totalPredictions: { gt: 0 },
            },
            select: {
                id: true,
                walletAddress: true,
                sxId: true,
                totalPredictions: true,
                correctPredictions: true,
                totalVolume: true,
                rewardsEarned: true,
            },
        });
        let leaderboard;
        if (type === 'accuracy') {
            leaderboard = users
                .map(user => ({
                walletAddress: user.walletAddress,
                sxId: user.sxId,
                accuracy: user.totalPredictions > 0
                    ? Math.round((user.correctPredictions / user.totalPredictions) * 10000) / 100
                    : 0,
                totalPredictions: user.totalPredictions,
                correctPredictions: user.correctPredictions,
                totalVolume: user.totalVolume,
                rewardsEarned: user.rewardsEarned,
            }))
                .sort((a, b) => b.accuracy - a.accuracy || b.totalPredictions - a.totalPredictions)
                .slice(0, 10)
                .map((entry, index) => ({
                rank: index + 1,
                ...entry,
            }));
        }
        else {
            leaderboard = users
                .map(user => ({
                walletAddress: user.walletAddress,
                sxId: user.sxId,
                accuracy: user.totalPredictions > 0
                    ? Math.round((user.correctPredictions / user.totalPredictions) * 10000) / 100
                    : 0,
                totalPredictions: user.totalPredictions,
                correctPredictions: user.correctPredictions,
                totalVolume: user.totalVolume,
                rewardsEarned: user.rewardsEarned,
            }))
                .sort((a, b) => b.totalVolume - a.totalVolume)
                .slice(0, 10)
                .map((entry, index) => ({
                rank: index + 1,
                ...entry,
            }));
        }
        res.status(200).json({
            success: true,
            data: {
                type,
                leaderboard,
                updatedAt: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch leaderboard',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/leaderboard/user/:wallet
 * Get a specific user's rank and stats.
 */
router.get('/user/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        const user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: wallet.toLowerCase() },
            select: {
                id: true,
                walletAddress: true,
                sxId: true,
                totalPredictions: true,
                correctPredictions: true,
                totalVolume: true,
                rewardsEarned: true,
            },
        });
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found',
            });
            return;
        }
        const accuracy = user.totalPredictions > 0
            ? Math.round((user.correctPredictions / user.totalPredictions) * 10000) / 100
            : 0;
        // Calculate accuracy rank
        const usersWithBetterAccuracy = await prisma_1.prisma.user.findMany({
            where: {
                totalPredictions: { gt: 0 },
            },
            select: {
                id: true,
                totalPredictions: true,
                correctPredictions: true,
            },
        });
        const accuracyRank = usersWithBetterAccuracy
            .map(u => ({
            id: u.id,
            accuracy: u.totalPredictions > 0
                ? (u.correctPredictions / u.totalPredictions) * 100
                : 0,
        }))
            .sort((a, b) => b.accuracy - a.accuracy)
            .findIndex(u => u.id === user.id) + 1;
        // Calculate volume rank
        const usersWithBetterVolume = await prisma_1.prisma.user.count({
            where: {
                totalVolume: { gt: user.totalVolume },
            },
        });
        const volumeRank = usersWithBetterVolume + 1;
        // Get latest snapshot if available
        const latestSnapshot = await prisma_1.prisma.leaderboardSnapshot.findFirst({
            where: { userId: user.id },
            orderBy: { snapshotDate: 'desc' },
        });
        res.status(200).json({
            success: true,
            data: {
                walletAddress: user.walletAddress,
                sxId: user.sxId,
                accuracy,
                totalPredictions: user.totalPredictions,
                correctPredictions: user.correctPredictions,
                totalVolume: user.totalVolume,
                rewardsEarned: user.rewardsEarned,
                rankByAccuracy: accuracyRank || null,
                rankByVolume: volumeRank,
                lastSnapshot: latestSnapshot ? {
                    accuracy: latestSnapshot.accuracy,
                    volume: latestSnapshot.volume,
                    rankByAccuracy: latestSnapshot.rankByAccuracy,
                    rankByVolume: latestSnapshot.rankByVolume,
                    snapshotDate: latestSnapshot.snapshotDate.toISOString(),
                } : null,
            },
        });
    }
    catch (error) {
        console.error('User rank error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user rank',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/reward-pool
 * Get the current reward pool balance.
 */
router.get('/reward-pool', async (req, res) => {
    try {
        // Aggregate total rewards earned (distributed)
        const totalDistributed = await prisma_1.prisma.user.aggregate({
            _sum: {
                rewardsEarned: true,
            },
        });
        // Aggregate total platform fees collected (approximation from volume)
        const totalVolume = await prisma_1.prisma.user.aggregate({
            _sum: {
                totalVolume: true,
            },
        });
        const platformFeesCollected = (totalVolume._sum.totalVolume || 0) * 0.01;
        const distributed = totalDistributed._sum.rewardsEarned || 0;
        const poolBalance = platformFeesCollected - distributed;
        res.status(200).json({
            success: true,
            data: {
                poolBalance: (0, fees_1.formatPayoutForResponse)(Math.max(0, poolBalance)),
                totalDistributed: (0, fees_1.formatPayoutForResponse)(distributed),
                platformFeesCollected: (0, fees_1.formatPayoutForResponse)(platformFeesCollected),
                updatedAt: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Reward pool error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch reward pool',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * POST /api/rewards/claim
 * Claim accumulated rewards.
 */
router.post('/rewards/claim', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found',
            });
            return;
        }
        if (user.rewardsEarned <= 0) {
            res.status(400).json({
                success: false,
                error: 'No rewards available to claim',
            });
            return;
        }
        const claimableAmount = user.rewardsEarned;
        // Reset rewards (in production, this would trigger a blockchain transaction)
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                rewardsEarned: 0,
            },
        });
        // Create a leaderboard snapshot
        const allUsers = await prisma_1.prisma.user.findMany({
            where: { totalPredictions: { gt: 0 } },
            select: { id: true, totalPredictions: true, correctPredictions: true, totalVolume: true },
        });
        const sortedByAccuracy = [...allUsers]
            .map(u => ({
            ...u,
            accuracy: u.totalPredictions > 0 ? (u.correctPredictions / u.totalPredictions) * 100 : 0,
        }))
            .sort((a, b) => b.accuracy - a.accuracy);
        const sortedByVolume = [...allUsers].sort((a, b) => b.totalVolume - a.totalVolume);
        const accuracyRank = sortedByAccuracy.findIndex(u => u.id === userId) + 1;
        const volumeRank = sortedByVolume.findIndex(u => u.id === userId) + 1;
        await prisma_1.prisma.leaderboardSnapshot.create({
            data: {
                userId,
                walletAddress: user.walletAddress,
                accuracy: user.totalPredictions > 0
                    ? (user.correctPredictions / user.totalPredictions) * 100
                    : 0,
                volume: user.totalVolume,
                rankByAccuracy: accuracyRank || null,
                rankByVolume: volumeRank || null,
                rewardsEarned: claimableAmount,
            },
        });
        const transactionHash = `0x${Buffer.from(Date.now().toString()).toString('hex').padEnd(64, '0')}`;
        // Notify user
        (0, websocket_1.notifyUser)(user.walletAddress, {
            type: 'rewards_claimed',
            title: 'Rewards Claimed',
            message: `You claimed ${(0, fees_1.formatPayoutForResponse)(claimableAmount)} in rewards`,
            data: { amount: claimableAmount },
        });
        res.status(200).json({
            success: true,
            data: {
                amountClaimed: (0, fees_1.formatPayoutForResponse)(claimableAmount),
                transactionHash,
                newRewardsBalance: 0,
            },
        });
    }
    catch (error) {
        console.error('Claim rewards error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to claim rewards',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * Route aliases for frontend compatibility.
 * Frontend uses /rewards for pool and /claim for claiming.
 */
router.get('/rewards', async (req, res) => {
    // Delegate to /reward-pool
    req.url = '/reward-pool';
    router.handle(req, res, () => { });
});
router.post('/claim', auth_1.authMiddleware, async (req, res) => {
    // Delegate to /rewards/claim
    req.url = '/rewards/claim';
    router.handle(req, res, () => { });
});
exports.default = router;
//# sourceMappingURL=leaderboard.js.map