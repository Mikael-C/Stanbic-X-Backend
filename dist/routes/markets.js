"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const uuid_1 = require("uuid");
const auth_1 = require("../middleware/auth");
const odds_1 = require("../utils/odds");
const fees_1 = require("../utils/fees");
const websocket_1 = require("../services/websocket");
const router = (0, express_1.Router)();
function validateAmount(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)
        return null;
    if (amount > 1_000_000)
        return null;
    return Math.round(amount * 100) / 100;
}
/**
 * POST /api/markets
 * Create a new prediction market.
 */
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { question, endTime, minStake } = req.body;
        if (!question || typeof question !== 'string' || question.trim().length === 0 || question.length > 500) {
            res.status(400).json({
                success: false,
                error: 'Question is required and must be under 500 characters',
            });
            return;
        }
        if (!endTime) {
            res.status(400).json({
                success: false,
                error: 'Missing required field: endTime',
            });
            return;
        }
        const endTimeDate = new Date(endTime);
        if (endTimeDate <= new Date()) {
            res.status(400).json({
                success: false,
                error: 'End time must be in the future',
            });
            return;
        }
        const marketId = `MKT-${(0, uuid_1.v4)().split('-')[0].toUpperCase()}`;
        const market = await prisma_1.prisma.market.create({
            data: {
                marketId,
                creator: req.user.walletAddress,
                question,
                endTime: endTimeDate,
                status: 'open',
                yesStakes: 0,
                noStakes: 0,
            },
        });
        // Broadcast new market
        (0, websocket_1.broadcastGlobalEvent)('market:created', {
            marketId: market.marketId,
            question: market.question,
            endTime: market.endTime.toISOString(),
            creator: market.creator,
        });
        res.status(201).json({
            success: true,
            data: {
                id: market.id,
                marketId: market.marketId,
                question: market.question,
                endTime: market.endTime.toISOString(),
                status: market.status,
                creator: market.creator,
                createdAt: market.createdAt.toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Create market error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create market',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/markets
 * List all markets with optional status filter.
 */
router.get('/', async (req, res) => {
    try {
        const { status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (status && typeof status === 'string') {
            where.status = status;
        }
        const [markets, total] = await Promise.all([
            prisma_1.prisma.market.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            prisma_1.prisma.market.count({ where }),
        ]);
        const marketsWithOdds = markets.map(market => {
            const odds = (0, odds_1.calculateOdds)(market.yesStakes, market.noStakes);
            return {
                id: market.id,
                marketId: market.marketId,
                question: market.question,
                endTime: market.endTime.toISOString(),
                status: market.status,
                yesStakes: market.yesStakes,
                noStakes: market.noStakes,
                totalVolume: market.yesStakes + market.noStakes,
                yesOdds: odds.yesOdds,
                noOdds: odds.noOdds,
                yesImpliedProbability: odds.yesImpliedProbability,
                noImpliedProbability: odds.noImpliedProbability,
                winner: market.winner,
                resolvedAt: market.resolvedAt?.toISOString() || null,
                creator: market.creator,
                createdAt: market.createdAt.toISOString(),
            };
        });
        res.status(200).json({
            success: true,
            data: {
                markets: marketsWithOdds,
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
        console.error('List markets error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch markets',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/markets/:id
 * Get a single market by ID or marketId.
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
            include: {
                stakes: {
                    select: {
                        id: true,
                        outcome: true,
                        amount: true,
                        oddsAtStake: true,
                        potentialPayout: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
                _count: {
                    select: { stakes: true, listings: true },
                },
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        const odds = (0, odds_1.calculateOdds)(market.yesStakes, market.noStakes);
        res.status(200).json({
            success: true,
            data: {
                id: market.id,
                marketId: market.marketId,
                contractAddress: market.contractAddress,
                question: market.question,
                endTime: market.endTime.toISOString(),
                status: market.status,
                yesStakes: market.yesStakes,
                noStakes: market.noStakes,
                totalVolume: market.yesStakes + market.noStakes,
                yesOdds: odds.yesOdds,
                noOdds: odds.noOdds,
                yesImpliedProbability: odds.yesImpliedProbability,
                noImpliedProbability: odds.noImpliedProbability,
                winner: market.winner,
                resolvedAt: market.resolvedAt?.toISOString() || null,
                creator: market.creator,
                createdAt: market.createdAt.toISOString(),
                recentStakes: market.stakes,
                totalStakes: market._count?.stakes || 0,
                totalListings: market._count?.listings || 0,
            },
        });
    }
    catch (error) {
        console.error('Get market error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch market',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/markets/:id/odds
 * Get current odds for a market.
 */
router.get('/:id/odds', async (req, res) => {
    try {
        const { id } = req.params;
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        const odds = (0, odds_1.calculateOdds)(market.yesStakes, market.noStakes);
        res.status(200).json({
            success: true,
            data: {
                marketId: market.marketId,
                yesOdds: odds.yesOdds,
                noOdds: odds.noOdds,
                yesImpliedProbability: odds.yesImpliedProbability,
                noImpliedProbability: odds.noImpliedProbability,
                yesStakes: market.yesStakes,
                noStakes: market.noStakes,
                totalVolume: market.yesStakes + market.noStakes,
            },
        });
    }
    catch (error) {
        console.error('Get odds error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch odds',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * POST /api/markets/:id/stake
 * Place a stake on a market outcome.
 */
router.post('/:id/stake', auth_1.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { outcome: rawOutcome, amount } = req.body;
        const outcome = rawOutcome ? rawOutcome.charAt(0).toUpperCase() + rawOutcome.slice(1).toLowerCase() : '';
        if (!outcome || !['Yes', 'No'].includes(outcome)) {
            res.status(400).json({
                success: false,
                error: 'Outcome must be "Yes" or "No"',
            });
            return;
        }
        const validAmount = validateAmount(amount);
        if (!validAmount) {
            res.status(400).json({
                success: false,
                error: 'Invalid amount: must be a positive finite number under 1,000,000',
            });
            return;
        }
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        if (market.status !== 'open') {
            res.status(400).json({
                success: false,
                error: 'Market is not open for staking',
            });
            return;
        }
        if (market.endTime <= new Date()) {
            res.status(400).json({
                success: false,
                error: 'Market has ended',
            });
            return;
        }
        // Apply 1% platform fee (baked in)
        const ptf = (0, fees_1.calculatePTF)(amount);
        const netStakeAmount = ptf.net;
        // Calculate potential payout with current odds
        const payout = (0, odds_1.calculatePotentialPayout)(netStakeAmount, outcome, market.yesStakes, market.noStakes);
        // Calculate odds at time of stake
        const currentOdds = (0, odds_1.calculateOdds)(market.yesStakes, market.noStakes);
        const oddsAtStake = outcome === 'Yes' ? currentOdds.yesOdds : currentOdds.noOdds;
        const stakeIdOnchain = `STK-${(0, uuid_1.v4)().split('-')[0].toUpperCase()}`;
        // Create stake
        const stake = await prisma_1.prisma.stake.create({
            data: {
                userId: req.user.id,
                marketId: market.id,
                stakeIdOnchain,
                outcome,
                amount: netStakeAmount,
                oddsAtStake,
                potentialPayout: payout.potentialPayout,
            },
        });
        // Update market stakes
        const updateData = outcome === 'Yes'
            ? { yesStakes: market.yesStakes + netStakeAmount }
            : { noStakes: market.noStakes + netStakeAmount };
        const updatedMarket = await prisma_1.prisma.market.update({
            where: { id: market.id },
            data: updateData,
        });
        // Update user stats
        await prisma_1.prisma.user.update({
            where: { id: req.user.id },
            data: {
                totalPredictions: { increment: 1 },
                totalVolume: { increment: amount },
            },
        });
        // Calculate new odds after stake
        const newOdds = (0, odds_1.calculateOdds)(updatedMarket.yesStakes, updatedMarket.noStakes);
        // Generate mock transaction hash
        const transactionHash = `0x${(0, uuid_1.v4)().replace(/-/g, '')}${(0, uuid_1.v4)().replace(/-/g, '').slice(0, 32)}`;
        // Broadcast updates
        (0, websocket_1.broadcastNewStake)(market.marketId, {
            marketId: market.marketId,
            stakeId: stake.id,
            outcome,
            amount: netStakeAmount,
            walletAddress: req.user.walletAddress,
            newYesStakes: updatedMarket.yesStakes,
            newNoStakes: updatedMarket.noStakes,
            yesOdds: newOdds.yesOdds,
            noOdds: newOdds.noOdds,
        });
        res.status(201).json({
            success: true,
            data: {
                positionId: stake.id,
                stakeIdOnchain,
                outcome,
                amount: netStakeAmount,
                oddsAtStake,
                potentialPayout: payout.potentialPayout,
                transactionHash,
                market: {
                    marketId: market.marketId,
                    yesStakes: updatedMarket.yesStakes,
                    noStakes: updatedMarket.noStakes,
                    yesOdds: newOdds.yesOdds,
                    noOdds: newOdds.noOdds,
                },
            },
        });
    }
    catch (error) {
        console.error('Place stake error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to place stake',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/markets/:id/positions/:user
 * Get a user's positions in a specific market.
 */
router.get('/:id/positions/:user', auth_1.authMiddleware, async (req, res) => {
    try {
        const { id, user: walletAddress } = req.params;
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: walletAddress.toLowerCase() },
        });
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found',
            });
            return;
        }
        const stakes = await prisma_1.prisma.stake.findMany({
            where: {
                userId: user.id,
                marketId: market.id,
            },
            orderBy: { createdAt: 'desc' },
        });
        const positions = stakes.map(stake => ({
            id: stake.id,
            stakeIdOnchain: stake.stakeIdOnchain,
            outcome: stake.outcome,
            amount: stake.amount,
            oddsAtStake: stake.oddsAtStake,
            potentialPayout: stake.potentialPayout,
            claimed: stake.claimed,
            claimedAt: stake.claimedAt?.toISOString() || null,
            createdAt: stake.createdAt.toISOString(),
        }));
        const totalYesStaked = stakes.filter(s => s.outcome === 'Yes').reduce((sum, s) => sum + s.amount, 0);
        const totalNoStaked = stakes.filter(s => s.outcome === 'No').reduce((sum, s) => sum + s.amount, 0);
        res.status(200).json({
            success: true,
            data: {
                marketId: market.marketId,
                walletAddress,
                positions,
                summary: {
                    totalPositions: positions.length,
                    totalYesStaked,
                    totalNoStaked,
                    totalStaked: totalYesStaked + totalNoStaked,
                },
            },
        });
    }
    catch (error) {
        console.error('Get positions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch positions',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * POST /api/markets/:id/resolve
 * Admin-only: resolve a market with a winner.
 */
router.post('/:id/resolve', auth_1.authMiddleware, auth_1.adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { winner } = req.body;
        if (!winner || !['Yes', 'No'].includes(winner)) {
            res.status(400).json({
                success: false,
                error: 'Winner must be "Yes" or "No"',
            });
            return;
        }
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        if (market.status === 'resolved') {
            res.status(400).json({
                success: false,
                error: 'Market is already resolved',
            });
            return;
        }
        const resolvedAt = new Date();
        const updatedMarket = await prisma_1.prisma.market.update({
            where: { id: market.id },
            data: {
                status: 'resolved',
                winner,
                resolvedAt,
            },
        });
        // Update correct predictions for winning stakers
        const winningStakes = await prisma_1.prisma.stake.findMany({
            where: {
                marketId: market.id,
                outcome: winner,
            },
            select: { userId: true },
        });
        const uniqueWinnerUserIds = [...new Set(winningStakes.map(s => s.userId))];
        for (const userId of uniqueWinnerUserIds) {
            await prisma_1.prisma.user.update({
                where: { id: userId },
                data: {
                    correctPredictions: { increment: 1 },
                },
            });
        }
        // Broadcast resolution
        (0, websocket_1.broadcastMarketResolved)(market.marketId, {
            marketId: market.marketId,
            winner,
            resolvedAt: resolvedAt.toISOString(),
        });
        res.status(200).json({
            success: true,
            data: {
                marketId: updatedMarket.marketId,
                winner,
                resolvedAt: resolvedAt.toISOString(),
                status: 'resolved',
            },
        });
    }
    catch (error) {
        console.error('Resolve market error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve market',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/markets/:id/payout/:user
 * Get the claimable payout amount for a user in a resolved market.
 */
router.get('/:id/payout/:user', auth_1.authMiddleware, async (req, res) => {
    try {
        const { id, user: walletAddress } = req.params;
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        if (market.status !== 'resolved' || !market.winner) {
            res.status(400).json({
                success: false,
                error: 'Market is not yet resolved',
            });
            return;
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { walletAddress: walletAddress.toLowerCase() },
        });
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found',
            });
            return;
        }
        // Get user's winning stakes
        const winningStakes = await prisma_1.prisma.stake.findMany({
            where: {
                userId: user.id,
                marketId: market.id,
                outcome: market.winner,
                claimed: false,
            },
        });
        if (winningStakes.length === 0) {
            res.status(200).json({
                success: true,
                data: {
                    marketId: market.marketId,
                    walletAddress,
                    claimableAmount: 0,
                    message: 'No claimable payout. Either no winning stakes or already claimed.',
                },
            });
            return;
        }
        const totalUserStake = winningStakes.reduce((sum, s) => sum + s.amount, 0);
        const winningPool = market.winner === 'Yes' ? market.yesStakes : market.noStakes;
        const totalPot = market.yesStakes + market.noStakes;
        const claimable = (0, odds_1.calculateClaimablePayout)(totalUserStake, winningPool, totalPot);
        res.status(200).json({
            success: true,
            data: {
                marketId: market.marketId,
                walletAddress,
                winner: market.winner,
                userStake: totalUserStake,
                claimableAmount: (0, fees_1.formatPayoutForResponse)(claimable),
                stakesCount: winningStakes.length,
            },
        });
    }
    catch (error) {
        console.error('Get payout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch payout',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * POST /api/markets/:id/payout/claim
 * Claim payout for a resolved market.
 */
router.post('/:id/payout/claim', auth_1.authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const market = await prisma_1.prisma.market.findFirst({
            where: {
                OR: [{ id }, { marketId: id }],
            },
        });
        if (!market) {
            res.status(404).json({
                success: false,
                error: 'Market not found',
            });
            return;
        }
        if (market.status !== 'resolved' || !market.winner) {
            res.status(400).json({
                success: false,
                error: 'Market is not yet resolved',
            });
            return;
        }
        // Get unclaimed winning stakes
        const winningStakes = await prisma_1.prisma.stake.findMany({
            where: {
                userId,
                marketId: market.id,
                outcome: market.winner,
                claimed: false,
            },
        });
        if (winningStakes.length === 0) {
            res.status(400).json({
                success: false,
                error: 'No unclaimed winning stakes found',
            });
            return;
        }
        const totalUserStake = winningStakes.reduce((sum, s) => sum + s.amount, 0);
        const winningPool = market.winner === 'Yes' ? market.yesStakes : market.noStakes;
        const totalPot = market.yesStakes + market.noStakes;
        const claimable = (0, odds_1.calculateClaimablePayout)(totalUserStake, winningPool, totalPot);
        // Mark stakes as claimed
        await prisma_1.prisma.stake.updateMany({
            where: {
                id: { in: winningStakes.map(s => s.id) },
            },
            data: {
                claimed: true,
                claimedAt: new Date(),
            },
        });
        // Update user rewards
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                rewardsEarned: { increment: claimable },
            },
        });
        const transactionHash = `0x${(0, uuid_1.v4)().replace(/-/g, '')}${(0, uuid_1.v4)().replace(/-/g, '').slice(0, 32)}`;
        // Notify user
        (0, websocket_1.notifyUser)(req.user.walletAddress, {
            type: 'payout_claimed',
            title: 'Payout Claimed',
            message: `You claimed ${(0, fees_1.formatPayoutForResponse)(claimable)} from market "${market.question}"`,
            data: { marketId: market.marketId, amount: claimable },
        });
        res.status(200).json({
            success: true,
            data: {
                marketId: market.marketId,
                amountClaimed: (0, fees_1.formatPayoutForResponse)(claimable),
                stakesClaimed: winningStakes.length,
                transactionHash,
            },
        });
    }
    catch (error) {
        console.error('Claim payout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to claim payout',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
exports.default = router;
//# sourceMappingURL=markets.js.map