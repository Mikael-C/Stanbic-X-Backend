import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { getIndexerStats } from '../services/indexer';
import { checkProviderHealth } from '../services/blockchain';
import { getConnectedClientsCount } from '../services/websocket';
import { config } from '../config';

const router = Router();


/**
 * GET /api/events
 * Query indexed events with optional filters.
 */
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      chainId,
      contractAddress,
      eventName,
      fromBlock,
      toBlock,
      page = '1',
      limit = '50',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (chainId) {
      where.chainId = parseInt(chainId as string, 10);
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
        gte: parseInt(fromBlock as string, 10),
      };
    }
    if (toBlock) {
      where.blockNumber = {
        ...(where.blockNumber || {}),
        lte: parseInt(toBlock as string, 10),
      };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: [
          { blockNumber: 'desc' },
          { logIndex: 'asc' },
        ],
        skip,
        take: limitNum,
      }),
      prisma.event.count({ where }),
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
  } catch (error: any) {
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
router.get('/:chainId/:transactionHash', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { chainId, transactionHash } = req.params;

    const events = await prisma.event.findMany({
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
  } catch (error: any) {
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
router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const indexerStats = await getIndexerStats();

    const [totalUsers, totalMarkets, totalStakes, totalListings] = await Promise.all([
      prisma.user.count(),
      prisma.market.count(),
      prisma.stake.count(),
      prisma.listing.count(),
    ]);

    const marketsByStatus = await prisma.market.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const totalVolumeResult = await prisma.user.aggregate({
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
          }, {} as Record<string, number>),
        },
        indexer: indexerStats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
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
router.get('/health', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Check database connectivity
    let dbHealthy = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbHealthy = true;
    } catch (e) {
      dbHealthy = false;
    }

    // Check blockchain providers
    const hoodiHealth = await checkProviderHealth(config.chains.hoodi.chainId);
    const baseSepoliaHealth = await checkProviderHealth(config.chains.baseSepolia.chainId);

    // Get WebSocket status
    const connectedClients = await getConnectedClientsCount();

    // Get indexer stats
    let indexerStats;
    try {
      indexerStats = await getIndexerStats();
    } catch (e) {
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
        environment: config.nodeEnv,
      },
    });
  } catch (error: any) {
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

export default router;
