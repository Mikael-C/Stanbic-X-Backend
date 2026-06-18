import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { calculatePTF, formatPayoutForResponse } from '../utils/fees';
import {
  broadcastNewListing,
  broadcastListingPurchased,
  broadcastListingCancelled,
  notifyUser,
} from '../services/websocket';

const router = Router();

function validateAmount(amount: unknown): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount > 1_000_000) return null;
  return Math.round(amount * 100) / 100;
}


/**
 * POST /api/listings
 * Create a new listing to sell a staked position.
 */
router.post('/', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { marketId, stakeId, price } = req.body;

    if (!marketId || !stakeId || !price) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: marketId, stakeId, price',
      });
      return;
    }

    const validPrice = validateAmount(price);
    if (!validPrice) {
      res.status(400).json({
        success: false,
        error: 'Invalid price: must be a positive finite number under 1,000,000',
      });
      return;
    }

    // Verify the market exists
    const market = await prisma.market.findFirst({
      where: {
        OR: [{ id: marketId }, { marketId }],
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
        error: 'Market is not open. Cannot list positions.',
      });
      return;
    }

    // Verify the stake exists and belongs to the seller
    const stake = await prisma.stake.findFirst({
      where: {
        OR: [{ id: stakeId }, { stakeIdOnchain: stakeId }],
        userId: req.user!.id,
      },
    });

    if (!stake) {
      res.status(404).json({
        success: false,
        error: 'Stake not found or does not belong to you',
      });
      return;
    }

    // Check if already listed
    const existingListing = await prisma.listing.findFirst({
      where: {
        stakeId: stake.id,
        status: 'active',
      },
    });

    if (existingListing) {
      res.status(400).json({
        success: false,
        error: 'This stake is already listed for sale',
      });
      return;
    }

    const listingIdOnchain = `LST-${uuidv4().split('-')[0].toUpperCase()}`;

    const listing = await prisma.listing.create({
      data: {
        listingIdOnchain,
        sellerId: req.user!.id,
        marketId: market.id,
        stakeId: stake.id,
        price,
        status: 'active',
      },
    });

    // Broadcast new listing
    broadcastNewListing({
      listingId: listing.id,
      marketId: market.marketId,
      stakeId: stake.id,
      price,
      seller: req.user!.walletAddress,
    });

    res.status(201).json({
      success: true,
      data: {
        id: listing.id,
        listingIdOnchain,
        marketId: market.marketId,
        stakeId: stake.id,
        price,
        outcome: stake.outcome,
        stakeAmount: stake.amount,
        potentialPayout: stake.potentialPayout,
        status: 'active',
        createdAt: listing.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Create listing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create listing',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * GET /api/listings
 * Get all active listings, optionally filtered by market.
 */
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { marketId, status = 'active', page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (status && typeof status === 'string') {
      where.status = status;
    }

    if (marketId && typeof marketId === 'string') {
      const market = await prisma.market.findFirst({
        where: {
          OR: [{ id: marketId }, { marketId }],
        },
      });
      if (market) {
        where.marketId = market.id;
      }
    }

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: {
          stake: {
            select: {
              outcome: true,
              amount: true,
              oddsAtStake: true,
              potentialPayout: true,
            },
          },
          market: {
            select: {
              marketId: true,
              question: true,
              endTime: true,
              status: true,
              yesStakes: true,
              noStakes: true,
            },
          },
          seller: {
            select: {
              walletAddress: true,
              sxId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.listing.count({ where }),
    ]);

    const formattedListings = listings.map(listing => ({
      id: listing.id,
      listingIdOnchain: listing.listingIdOnchain,
      price: listing.price,
      status: listing.status,
      stake: {
        outcome: listing.stake.outcome,
        amount: listing.stake.amount,
        oddsAtStake: listing.stake.oddsAtStake,
        potentialPayout: listing.stake.potentialPayout,
      },
      market: {
        marketId: listing.marketId,
        question: listing.market.question,
        endTime: listing.market.endTime.toISOString(),
        status: listing.market.status,
      },
      seller: {
        walletAddress: listing.seller.walletAddress,
        sxId: listing.seller.sxId,
      },
      createdAt: listing.createdAt.toISOString(),
    }));

    res.status(200).json({
      success: true,
      data: {
        listings: formattedListings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error: any) {
    console.error('List listings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch listings',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * POST /api/listings/:id/buy
 * Purchase a listed position.
 */
router.post('/:id/buy', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const listing = await prisma.listing.findFirst({
      where: {
        OR: [{ id }, { listingIdOnchain: id }],
        status: 'active',
      },
      include: {
        stake: true,
        market: true,
        seller: true,
      },
    });

    if (!listing) {
      res.status(404).json({
        success: false,
        error: 'Listing not found or no longer active',
      });
      return;
    }

    // Cannot buy your own listing
    if (listing.sellerId === req.user!.id) {
      res.status(400).json({
        success: false,
        error: 'Cannot buy your own listing',
      });
      return;
    }

    // Apply 1% platform fee (baked in)
    const ptf = calculatePTF(listing.price);

    // Update listing to sold
    const updatedListing = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: 'sold',
        buyerId: req.user!.id,
        purchasedAt: new Date(),
      },
    });

    // Transfer the stake ownership to the buyer
    await prisma.stake.update({
      where: { id: listing.stakeId },
      data: {
        userId: req.user!.id,
      },
    });

    // Update buyer stats
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        totalVolume: { increment: listing.price },
        totalPredictions: { increment: 1 },
      },
    });

    const transactionHash = `0x${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 32)}`;

    // Broadcast listing purchased
    broadcastListingPurchased({
      listingId: listing.id,
      marketId: listing.marketId,
      buyer: req.user!.walletAddress,
      price: listing.price,
    });

    // Notify seller
    const seller = await prisma.user.findUnique({ where: { id: listing.sellerId } });
    if (seller) {
      notifyUser(seller.walletAddress, {
        type: 'listing_sold',
        title: 'Position Sold',
        message: `Your listed position was purchased for ${listing.price}`,
        data: {
          listingId: listing.id,
          marketId: listing.marketId,
          price: listing.price,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        listingId: listing.id,
        marketId: listing.marketId,
        pricePaid: listing.price,
        position: {
          outcome: listing.stake?.outcome || 'Unknown',
          amount: listing.stake?.amount || 0,
          potentialPayout: listing.stake?.potentialPayout || 0,
        },
        transactionHash,
      },
    });
  } catch (error: any) {
    console.error('Buy listing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to purchase listing',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * DELETE /api/listings/:id
 * Cancel an active listing (seller only).
 */
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const listing = await prisma.listing.findFirst({
      where: {
        OR: [{ id }, { listingIdOnchain: id }],
        status: 'active',
      },
      include: {
        market: true,
      },
    });

    if (!listing) {
      res.status(404).json({
        success: false,
        error: 'Listing not found or no longer active',
      });
      return;
    }

    // Only the seller can cancel
    if (listing.sellerId !== req.user!.id) {
      res.status(403).json({
        success: false,
        error: 'Only the seller can cancel this listing',
      });
      return;
    }

    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    });

    // Broadcast listing cancelled
    broadcastListingCancelled({
      listingId: listing.id,
      marketId: listing.market.marketId,
    });

    res.status(200).json({
      success: true,
      data: {
        listingId: listing.id,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Cancel listing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel listing',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * Route aliases for frontend compatibility.
 * The frontend orderBookApi uses /list, /buy/:id, /cancel/:id.
 */
router.post('/list', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  // Delegate to the main POST / handler by re-routing
  req.url = '/';
  router.handle(req, res, () => {});
});

router.post('/buy/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  // Delegate to POST /:id/buy
  req.url = `/${req.params.id}/buy`;
  router.handle(req, res, () => {});
});

router.post('/cancel/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  // Simulate DELETE /:id using POST
  req.method = 'DELETE';
  req.url = `/${req.params.id}`;
  router.handle(req, res, () => {});
});

export default router;
