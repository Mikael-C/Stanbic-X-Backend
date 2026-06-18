"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.httpServer = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const http_1 = require("http");
const config_1 = require("./config");
const websocket_1 = require("./services/websocket");
const indexer_1 = require("./services/indexer");
const rateLimiter_1 = require("./middleware/rateLimiter");
// Route imports
const auth_1 = __importDefault(require("./routes/auth"));
const account_1 = __importDefault(require("./routes/account"));
const markets_1 = __importDefault(require("./routes/markets"));
const listings_1 = __importDefault(require("./routes/listings"));
const leaderboard_1 = __importDefault(require("./routes/leaderboard"));
const events_1 = __importDefault(require("./routes/events"));
const ai_1 = __importDefault(require("./routes/ai"));
const admin_1 = __importDefault(require("./routes/admin"));
/**
 * Initialize Express application.
 */
const app = (0, express_1.default)();
exports.app = app;
const httpServer = (0, http_1.createServer)(app);
exports.httpServer = httpServer;
/**
 * Security middleware.
 */
app.use((0, helmet_1.default)({
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
app.use((0, cors_1.default)({
    origin: config_1.config.cors.origin,
    credentials: config_1.config.cors.credentials,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
/**
 * Body parsing middleware.
 */
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
/**
 * General rate limiting.
 */
app.use(rateLimiter_1.generalRateLimiter);
/**
 * Request logging middleware.
 */
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
});
/**
 * API Routes.
 */
app.use('/api/auth', auth_1.default);
app.use('/api/account', account_1.default);
app.use('/api/balance', account_1.default); // Alias for frontend compatibility
app.use('/api/markets', markets_1.default);
app.use('/api/listings', listings_1.default);
app.use('/api/orderbook', listings_1.default); // Alias for frontend compatibility
app.use('/api/leaderboard', leaderboard_1.default);
app.use('/api/events', events_1.default);
app.use('/api/ai', ai_1.default);
app.use('/api/admin', admin_1.default);
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
app.use((err, req, res, next) => {
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
        ...(config_1.config.nodeEnv === 'development' && { details: err.message }),
    });
});
/**
 * Initialize WebSocket server.
 */
const io = (0, websocket_1.initializeWebSocket)(httpServer);
exports.io = io;
/**
 * Start server and services.
 */
async function startServer() {
    try {
        // Start the indexer service (non-blocking, continues if contracts aren't configured)
        try {
            await (0, indexer_1.startIndexer)();
            console.log('[Server] Event indexer started');
        }
        catch (indexerError) {
            console.warn('[Server] Event indexer failed to start:', indexerError.message);
            console.warn('[Server] The server will continue without the indexer.');
        }
        // Start HTTP server
        httpServer.listen(config_1.config.port, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════════════════╗');
            console.log('║   SX Secure Prediction Marketplace API              ║');
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log(`║   Environment: ${config_1.config.nodeEnv.padEnd(38)}║`);
            console.log(`║   Port:        ${config_1.config.port.toString().padEnd(38)}║`);
            console.log(`║   CORS Origin: ${config_1.config.cors.origin.padEnd(38)}║`);
            console.log('╠══════════════════════════════════════════════════════╣');
            console.log('║   Chains:                                           ║');
            console.log(`║     Hoodi:        ${config_1.config.chains.hoodi.chainId.toString().padEnd(34)}║`);
            console.log(`║     Base Sepolia: ${config_1.config.chains.baseSepolia.chainId.toString().padEnd(34)}║`);
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
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map