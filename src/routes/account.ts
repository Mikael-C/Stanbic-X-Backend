import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import {
  AuthRequest,
  authMiddleware,
  verifyWalletSignature,
  verifyTOTP,
  generateTOTPSecret,
  generateJWT,
} from '../middleware/auth';
import { authRateLimiter, withdrawalRateLimiter } from '../middleware/rateLimiter';
import { calculateWithdrawalFee, formatPayoutForResponse } from '../utils/fees';

const router = Router();

function validateAmount(amount: unknown): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount > 1_000_000) return null;
  return Math.round(amount * 100) / 100;
}


// Simple in-memory ledger for demo purposes
const mockLedger: Record<string, {
  uncommittedBalance: number;
  transactions: any[];
  demoSubAccounts: any[];
}> = {};

const initLedger = (userId: string) => {
  if (!mockLedger[userId]) {
    mockLedger[userId] = {
      uncommittedBalance: 4050.0,
      transactions: [
        { id: '1', type: 'deposit', amount: 5000, timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), status: 'completed', txHash: '0xabc...123' },
        { id: '2', type: 'yield', amount: 42.5, timestamp: new Date(Date.now() - 3 * 86400000).toISOString(), status: 'completed' },
        { id: '3', type: 'stake', amount: 250, timestamp: new Date(Date.now() - 4 * 86400000).toISOString(), status: 'completed' },
        { id: '4', type: 'payout', amount: 487.5, timestamp: new Date(Date.now() - 5 * 86400000).toISOString(), status: 'completed' },
        { id: '5', type: 'withdraw', amount: 1000, timestamp: new Date(Date.now() - 7 * 86400000).toISOString(), status: 'completed', txHash: '0xdef...456' },
      ],
      demoSubAccounts: [
        {
          subAccountId: 'CSA-DEMO1',
          principal: 5000,
          yieldAccrued: 187.5,
          status: 'active',
          createdAt: new Date('2025-01-15T10:00:00Z'),
          maturityDate: new Date('2025-07-15T10:00:00Z'),
        },
        {
          subAccountId: 'CSA-DEMO2',
          principal: 3400,
          yieldAccrued: 154.68,
          status: 'active',
          createdAt: new Date('2025-02-20T10:00:00Z'),
          maturityDate: new Date('2025-08-20T10:00:00Z'),
        }
      ]
    };
  }
  return mockLedger[userId];
};

/**
 * POST /api/account/register
 * Register a new wallet and set up TOTP.
 */
router.post('/register', authRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { walletAddress, signature, nonce, timestamp } = req.body;

    if (!walletAddress || !signature || !nonce || !timestamp) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, signature, nonce, timestamp',
      });
      return;
    }

    // Verify signature
    const isValid = verifyWalletSignature(walletAddress, nonce, timestamp, signature);
    if (!isValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid wallet signature',
      });
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (existingUser) {
      // Return existing user with a new JWT
      const token = generateJWT(existingUser.walletAddress, existingUser.id);
      res.status(200).json({
        success: true,
        message: 'User already registered',
        token,
        user: {
          id: existingUser.id,
          walletAddress: existingUser.walletAddress,
          sxId: existingUser.sxId,
          totpEnabled: !!existingUser.totpSecret,
        },
      });
      return;
    }

    // Generate TOTP secret
    const totp = generateTOTPSecret(walletAddress);
    const sxId = `SX-${uuidv4().split('-')[0].toUpperCase()}`;

    // Create user
    const user = await prisma.user.create({
      data: {
        walletAddress: walletAddress.toLowerCase(),
        sxId,
        totpSecret: totp.secret,
      },
    });

    // Generate QR code
    const qrCodeDataUrl = await QRCode.toDataURL(totp.otpauthUrl);

    // Generate JWT
    const token = generateJWT(user.walletAddress, user.id);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please set up your authenticator app.',
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        sxId: user.sxId,
      },
      totp: {
        qrCode: qrCodeDataUrl,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * POST /api/account/verify-totp
 * Verify TOTP token for login.
 */
router.post('/verify-totp', authRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { walletAddress, signature, nonce, timestamp, totpToken } = req.body;

    if (!walletAddress || !signature || !nonce || !timestamp || !totpToken) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, signature, nonce, timestamp, totpToken',
      });
      return;
    }

    // Verify wallet signature
    const isValidSig = verifyWalletSignature(walletAddress, nonce, timestamp, signature);
    if (!isValidSig) {
      res.status(401).json({
        success: false,
        error: 'Invalid wallet signature',
      });
      return;
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found. Please register first.',
      });
      return;
    }

    if (!user.totpSecret) {
      res.status(400).json({
        success: false,
        error: 'TOTP not configured for this account',
      });
      return;
    }

    // Check lockout
    if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(403).json({
        success: false,
        error: 'Account is temporarily locked',
        lockedUntil: user.lockedUntil.toISOString(),
      });
      return;
    }

    // Verify TOTP
    const isValidTotp = verifyTOTP(user.totpSecret, totpToken);
    if (!isValidTotp) {
      res.status(401).json({
        success: false,
        error: 'Invalid TOTP token',
      });
      return;
    }

    // Generate JWT
    const token = generateJWT(user.walletAddress, user.id);

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        sxId: user.sxId,
      },
    });
  } catch (error: any) {
    console.error('TOTP verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * GET /api/account/balance or /api/balance/
 * Returns unified balance, committed balances, uncommitted balance, and accrued yield.
 */
const getBalanceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const ledger = initLedger(userId);

    // Get all committed sub-accounts
    const dbCommittedAccounts = await prisma.committedSubAccount.findMany({
      where: { userId },
      orderBy: { creationTimestamp: 'desc' },
    });

    const dbCommittedBalances = dbCommittedAccounts.map(acc => ({
      subAccountId: acc.subAccountId,
      principal: acc.principal,
      yieldAccrued: acc.yieldAccrued,
      maturityDate: acc.maturityDate.toISOString(),
      status: acc.status,
      createdAt: acc.creationTimestamp.toISOString(),
    }));

    const committedBalances = [
      ...ledger.demoSubAccounts.map(a => ({
        subAccountId: a.subAccountId,
        principal: a.principal,
        yieldAccrued: a.yieldAccrued,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        maturityDate: a.maturityDate.toISOString(),
      })),
      ...dbCommittedBalances
    ];

    // Calculate totals
    const totalCommitted = committedBalances.reduce((sum, acc) => sum + acc.principal, 0);
    const totalYieldAccrued = committedBalances.reduce((sum, acc) => sum + acc.yieldAccrued, 0);

    // Get user record for total volume
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    const unifiedBalance = totalCommitted + totalYieldAccrued + ledger.uncommittedBalance;
    const uncommittedBalance = ledger.uncommittedBalance;

    res.status(200).json({
      success: true,
      data: {
        unifiedBalance: formatPayoutForResponse(unifiedBalance),
        committedBalances,
        uncommittedBalance: formatPayoutForResponse(uncommittedBalance),
        accruedYield: formatPayoutForResponse(totalYieldAccrued),
        totalVolume: user?.totalVolume || 0,
        rewardsEarned: user?.rewardsEarned || 0,
      },
    });
  } catch (error: any) {
    console.error('Balance fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch balance',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

router.get('/', authMiddleware, getBalanceHandler);
router.get('/balance', authMiddleware, getBalanceHandler);

/**
 * POST /api/account/deposit
 * Deposit funds with optional committed percentage.
 */
router.post('/deposit', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { amount, stablecoin, committedPercentage } = req.body;

    const validAmount = validateAmount(amount);
    if (!validAmount) {
      res.status(400).json({ success: false, error: 'Invalid amount: must be a positive finite number under 1,000,000' });
      return;
    }

    if (!stablecoin) {
      res.status(400).json({
        success: false,
        error: 'Stablecoin type is required',
      });
      return;
    }

    const commitPct = Math.min(Math.max(committedPercentage || 0, 0), 100);
    const committedAmount = (amount * commitPct) / 100;
    let subAccountId: string | null = null;

    // Create committed sub-account if applicable
    if (committedAmount > 0) {
      subAccountId = `CSA-${uuidv4().split('-')[0].toUpperCase()}`;
      const maturityDate = new Date();
      maturityDate.setDate(maturityDate.getDate() + 90); // 90-day maturity

      await prisma.committedSubAccount.create({
        data: {
          userId,
          subAccountId,
          principal: committedAmount,
          maturityDate,
          status: 'active',
        },
      });
    }

    // Generate a mock transaction hash (in production, this comes from the blockchain)
    const transactionHash = `0x${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 32)}`;

    // Update user's total volume
    await prisma.user.update({
      where: { id: userId },
      data: {
        totalVolume: { increment: amount },
      },
    });

    const ledger = initLedger(userId);
    ledger.uncommittedBalance += (amount - committedAmount);
    ledger.transactions.unshift({
      id: uuidv4(),
      type: 'deposit',
      amount: amount,
      timestamp: new Date().toISOString(),
      status: 'completed',
      txHash: transactionHash
    });

    res.status(200).json({
      success: true,
      data: {
        newBalance: amount,
        committedAmount: committedAmount,
        uncommittedAmount: amount - committedAmount,
        subAccountId,
        transactionHash,
      },
    });
  } catch (error: any) {
    console.error('Deposit error:', error);
    res.status(500).json({
      success: false,
      error: 'Deposit failed',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * POST /api/account/withdraw
 * Withdraw funds from committed or uncommitted balance.
 * 6% withdrawal fee is baked into the net amount.
 */
router.post('/withdraw', authMiddleware, withdrawalRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { amount, source } = req.body;

    const validAmount = validateAmount(amount);
    if (!validAmount) {
      res.status(400).json({ success: false, error: 'Invalid amount: must be a positive finite number under 1,000,000' });
      return;
    }

    if (!source || !['committed', 'uncommitted'].includes(source)) {
      res.status(400).json({
        success: false,
        error: 'Source must be "committed" or "uncommitted"',
      });
      return;
    }

    // Calculate fee (baked in — never exposed separately)
    const feeResult = calculateWithdrawalFee(amount);

    // Generate a mock transaction hash
    const transactionHash = `0x${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 32)}`;

    const ledger = initLedger(userId);
    if (source === 'uncommitted') {
      if (ledger.uncommittedBalance < amount) {
        res.status(400).json({
          success: false,
          error: 'Insufficient balance',
        });
        return;
      }
      ledger.uncommittedBalance -= amount;
    }
    ledger.transactions.unshift({
      id: uuidv4(),
      type: 'withdraw',
      amount: amount,
      timestamp: new Date().toISOString(),
      status: 'completed',
      txHash: transactionHash
    });

    res.status(200).json({
      success: true,
      data: {
        amountWithdrawn: amount,
        netReceived: formatPayoutForResponse(feeResult.net),
        source,
        transactionHash,
      },
    });
  } catch (error: any) {
    console.error('Withdrawal error:', error);
    res.status(500).json({
      success: false,
      error: 'Withdrawal failed',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

/**
 * GET /api/account/transactions
 * Returns user transaction history.
 */
router.get('/transactions', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const ledger = initLedger(userId);
    const stakes = await prisma.stake.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    const dbTransactions = stakes.map(s => ({
      id: s.id,
      type: 'stake',
      amount: s.amount,
      timestamp: s.createdAt.toISOString(),
      status: 'completed',
      txHash: s.stakeIdOnchain
    }));

    // Merge ledger transactions and DB stakes, sort by timestamp
    const allTransactions = [...ledger.transactions, ...dbTransactions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    res.status(200).json({
      success: true,
      data: allTransactions
    });
  } catch (error: any) {
    console.error('Transactions fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transactions',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
});

export default router;
