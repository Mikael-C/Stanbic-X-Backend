import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { config } from './config';
import { initializeWebSocket } from './services/websocket';
import { startIndexer } from './services/indexer';
import { generalRateLimiter } from './middleware/rateLimiter';

// Route imports
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import marketsRoutes from './routes/markets';
import listingsRoutes from './routes/listings';
import leaderboardRoutes from './routes/leaderboard';
import eventsRoutes from './routes/events';
import aiRoutes from './routes/ai';
import adminRoutes from './routes/admin';

/**
 * Initialize Express application.
 */
const app = express();
const httpServer = createServer(app);

/**
 * Security middleware.
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

/**
 * Body parsing middleware.
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * General rate limiting.
 */
app.use(generalRateLimiter);

/**
 * Request logging middleware.
 */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

/**
 * API Routes.
 */
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/balance', accountRoutes);      // Alias for frontend compatibility
app.use('/api/markets', marketsRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/orderbook', listingsRoutes);   // Alias for frontend compatibility
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);

/**
 * Root endpoint.
 */
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SX Secure Prediction Marketplace API',
    version: '1.0.0',
    endpoints: {
      account: '/api/account',
      markets: '/api/markets',
      listings: '/api/listings',
      leaderboard: '/api/leaderboard',
      events: '/api/events',
      ai: '/api/ai',
      admin: '/api/admin',
      health: '/api/events/health',
      stats: '/api/events/stats',
    },
  });
});

/**
 * 404 handler.
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
  });
});

/**
 * Global error handler.
 */
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err.stack);

  // Handle specific error types
  if (err.name === 'SyntaxError' && 'body' in err) {
    res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
    });
    return;
  }

  if (err.name === 'UnauthorizedError') {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    ...(config.nodeEnv === 'development' && { details: err.message }),
  });
});

/**
 * Initialize WebSocket server.
 */
const io = initializeWebSocket(httpServer);

/**
 * Start server and services.
 */
async function startServer(): Promise<void> {
  try {
    // Start the indexer service (non-blocking, continues if contracts aren't configured)
    try {
      await startIndexer();
      console.log('[Server] Event indexer started');
    } catch (indexerError: any) {
      console.warn('[Server] Event indexer failed to start:', indexerError.message);
      console.warn('[Server] The server will continue without the indexer.');
    }

    // Start HTTP server
    httpServer.listen(config.port, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════╗');
      console.log('║   SX Secure Prediction Marketplace API              ║');
      console.log('╠══════════════════════════════════════════════════════╣');
      console.log(`║   Environment: ${config.nodeEnv.padEnd(38)}║`);
      console.log(`║   Port:        ${config.port.toString().padEnd(38)}║`);
      console.log(`║   CORS Origin: ${(config.cors.origin as string).padEnd(38)}║`);
      console.log('╠══════════════════════════════════════════════════════╣');
      console.log('║   Chains:                                           ║');
      console.log(`║     Hoodi:        ${config.chains.hoodi.chainId.toString().padEnd(34)}║`);
      console.log(`║     Base Sepolia: ${config.chains.baseSepolia.chainId.toString().padEnd(34)}║`);
      console.log('╠══════════════════════════════════════════════════════╣');
      console.log('║   Endpoints:                                        ║');
      console.log('║     GET  /api/account/balance                       ║');
      console.log('║     POST /api/account/register                      ║');
      console.log('║     POST /api/account/deposit                       ║');
      console.log('║     POST /api/account/withdraw                      ║');
      console.log('║     GET  /api/markets                               ║');
      console.log('║     POST /api/markets/:id/stake                     ║');
      console.log('║     GET  /api/listings                              ║');
      console.log('║     GET  /api/leaderboard                           ║');
      console.log('║     POST /api/ai/chat                               ║');
      console.log('║     GET  /api/events/health                         ║');
      console.log('╚══════════════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[Server] SIGTERM received. Shutting down...');
  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer();

export { app, httpServer, io };
