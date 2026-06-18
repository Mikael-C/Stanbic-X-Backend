"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const indexer_1 = require("../services/indexer");
const blockchain_1 = require("../services/blockchain");
const websocket_1 = require("../services/websocket");
const config_1 = require("../config");
const router = (0, express_1.Router)();
/**
 * GET /api/events
 * Query indexed events with optional filters.
 */
router.get('/', async (req, res) => {
    try {
        const { chainId, contractAddress, eventName, fromBlock, toBlock, page = '1', limit = '50', } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
        const skip = (pageNum - 1) * limitNum;
        const where = {};
        if (chainId) {
            where.chainId = parseInt(chainId, 10);
        }
        if (contractAddress && typeof contractAddress === 'string') {
            where.contractAddress = contractAddress.toLowerCase();
        }
        if (eventName && typeof eventName === 'string') {
            where.eventName = eventName;
        }
        if (fromBlock) {
            where.blockNumber = {
                ...(where.blockNumber || {}),
                gte: parseInt(fromBlock, 10),
            };
        }
        if (toBlock) {
            where.blockNumber = {
                ...(where.blockNumber || {}),
                lte: parseInt(toBlock, 10),
            };
        }
        const [events, total] = await Promise.all([
            prisma_1.prisma.event.findMany({
                where,
                orderBy: [
                    { blockNumber: 'desc' },
                    { logIndex: 'asc' },
                ],
                skip,
                take: limitNum,
            }),
            prisma_1.prisma.event.count({ where }),
        ]);
        const formattedEvents = events.map(event => ({
            id: event.id,
            chainId: event.chainId,
            contractAddress: event.contractAddress,
            eventName: event.eventName,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            eventData: event.eventData,
            blockTimestamp: event.blockTimestamp.toISOString(),
            processedAt: event.processedAt.toISOString(),
        }));
        res.status(200).json({
            success: true,
            data: {
                events: formattedEvents,
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
        console.error('Events query error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch events',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/events/:chainId/:transactionHash
 * Get all events from a specific transaction.
 */
router.get('/:chainId/:transactionHash', async (req, res) => {
    try {
        const { chainId, transactionHash } = req.params;
        const events = await prisma_1.prisma.event.findMany({
            where: {
                chainId: parseInt(chainId, 10),
                transactionHash: transactionHash.toLowerCase(),
            },
            orderBy: { logIndex: 'asc' },
        });
        if (events.length === 0) {
            res.status(404).json({
                success: false,
                error: 'No events found for this transaction',
            });
            return;
        }
        const formattedEvents = events.map(event => ({
            id: event.id,
            chainId: event.chainId,
            contractAddress: event.contractAddress,
            eventName: event.eventName,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            eventData: event.eventData,
            blockTimestamp: event.blockTimestamp.toISOString(),
            processedAt: event.processedAt.toISOString(),
        }));
        res.status(200).json({
            success: true,
            data: {
                transactionHash,
                chainId: parseInt(chainId, 10),
                events: formattedEvents,
            },
        });
    }
    catch (error) {
        console.error('Events by tx error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch events',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/stats
 * Get indexer and platform stats.
 */
router.get('/stats', async (req, res) => {
    try {
        const indexerStats = await (0, indexer_1.getIndexerStats)();
        const [totalUsers, totalMarkets, totalStakes, totalListings] = await Promise.all([
            prisma_1.prisma.user.count(),
            prisma_1.prisma.market.count(),
            prisma_1.prisma.stake.count(),
            prisma_1.prisma.listing.count(),
        ]);
        const marketsByStatus = await prisma_1.prisma.market.groupBy({
            by: ['status'],
            _count: { id: true },
        });
        const totalVolumeResult = await prisma_1.prisma.user.aggregate({
            _sum: { totalVolume: true },
        });
        res.status(200).json({
            success: true,
            data: {
                platform: {
                    totalUsers,
                    totalMarkets,
                    totalStakes,
                    totalListings,
                    totalVolume: totalVolumeResult._sum.totalVolume || 0,
                    marketsByStatus: marketsByStatus.reduce((acc, item) => {
                        acc[item.status] = item._count.id;
                        return acc;
                    }, {}),
                },
                indexer: indexerStats,
                timestamp: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stats',
            ...(process.env.NODE_ENV === 'development' && { details: error.message }),
        });
    }
});
/**
 * GET /api/health
 * Health check endpoint.
 */
router.get('/health', async (req, res) => {
    try {
        // Check database connectivity
        let dbHealthy = false;
        try {
            await prisma_1.prisma.$queryRaw `SELECT 1`;
            dbHealthy = true;
        }
        catch (e) {
            dbHealthy = false;
        }
        // Check blockchain providers
        const hoodiHealth = await (0, blockchain_1.checkProviderHealth)(config_1.config.chains.hoodi.chainId);
        const baseSepoliaHealth = await (0, blockchain_1.checkProviderHealth)(config_1.config.chains.baseSepolia.chainId);
        // Get WebSocket status
        const connectedClients = await (0, websocket_1.getConnectedClientsCount)();
        // Get indexer stats
        let indexerStats;
        try {
            indexerStats = await (0, indexer_1.getIndexerStats)();
        }
        catch (e) {
            indexerStats = null;
        }
        const isHealthy = dbHealthy;
        res.status(isHealthy ? 200 : 503).json({
            success: isHealthy,
            data: {
                status: isHealthy ? 'healthy' : 'degraded',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                services: {
                    database: {
                        status: dbHealthy ? 'connected' : 'disconnected',
                    },
                    blockchain: {
                        hoodi: {
                            status: hoodiHealth.healthy ? 'connected' : 'disconnected',
                            blockNumber: hoodiHealth.blockNumber || null,
                            error: hoodiHealth.error || null,
                        },
                        baseSepolia: {
                            status: baseSepoliaHealth.healthy ? 'connected' : 'disconnected',
                            blockNumber: baseSepoliaHealth.blockNumber || null,
                            error: baseSepoliaHealth.error || null,
                        },
                    },
                    websocket: {
                        connectedClients,
                    },
                    indexer: indexerStats,
                },
                environment: config_1.config.nodeEnv,
            },
        });
    }
    catch (error) {
        console.error('Health check error:', error);
        res.status(503).json({
            success: false,
            data: {
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString(),
            },
        });
    }
});
exports.default = router;
//# sourceMappingURL=events.js.map