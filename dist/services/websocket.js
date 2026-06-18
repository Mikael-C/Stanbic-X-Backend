"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeWebSocket = initializeWebSocket;
exports.getIO = getIO;
exports.broadcastMarketUpdate = broadcastMarketUpdate;
exports.broadcastOddsChange = broadcastOddsChange;
exports.broadcastNewStake = broadcastNewStake;
exports.broadcastMarketResolved = broadcastMarketResolved;
exports.broadcastNewListing = broadcastNewListing;
exports.broadcastListingPurchased = broadcastListingPurchased;
exports.broadcastListingCancelled = broadcastListingCancelled;
exports.broadcastLeaderboardUpdate = broadcastLeaderboardUpdate;
exports.notifyUser = notifyUser;
exports.broadcastGlobalEvent = broadcastGlobalEvent;
exports.getConnectedClientsCount = getConnectedClientsCount;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
let io = null;
/**
 * Initialize Socket.io server and attach to HTTP server.
 */
function initializeWebSocket(httpServer) {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: config_1.config.cors.origin,
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket', 'polling'],
        pingInterval: 25000,
        pingTimeout: 60000,
    });
    io.on('connection', (socket) => {
        // Authenticate via JWT
        const token = socket.handshake.auth?.token;
        if (!token) {
            socket.disconnect(true);
            return;
        }
        try {
            const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
            socket.data.wallet = payload.walletAddress;
        }
        catch {
            socket.disconnect(true);
            return;
        }
        console.log(`[WebSocket] Client connected: ${socket.id}`);
        // Join a market-specific room
        socket.on('subscribe:market', (marketId) => {
            socket.join(`market:${marketId}`);
            console.log(`[WebSocket] ${socket.id} subscribed to market:${marketId}`);
        });
        // Leave a market room
        socket.on('unsubscribe:market', (marketId) => {
            socket.leave(`market:${marketId}`);
            console.log(`[WebSocket] ${socket.id} unsubscribed from market:${marketId}`);
        });
        // Join leaderboard room
        socket.on('subscribe:leaderboard', () => {
            socket.join('leaderboard');
            console.log(`[WebSocket] ${socket.id} subscribed to leaderboard`);
        });
        // Join user-specific room for personal notifications — only if wallet matches
        socket.on('subscribe:user', (walletAddress) => {
            if (walletAddress.toLowerCase() !== socket.data.wallet?.toLowerCase()) {
                return;
            }
            socket.join(`user:${walletAddress.toLowerCase()}`);
            console.log(`[WebSocket] ${socket.id} subscribed to user:${walletAddress}`);
        });
        socket.on('disconnect', (reason) => {
            console.log(`[WebSocket] Client disconnected: ${socket.id} (${reason})`);
        });
        socket.on('error', (error) => {
            console.error(`[WebSocket] Error for ${socket.id}:`, error);
        });
    });
    console.log('[WebSocket] Socket.io server initialized');
    return io;
}
/**
 * Get the Socket.io server instance.
 */
function getIO() {
    if (!io) {
        throw new Error('Socket.io server not initialized. Call initializeWebSocket first.');
    }
    return io;
}
/**
 * Broadcast a market update to all subscribers of that market.
 */
function broadcastMarketUpdate(marketId, data) {
    if (!io)
        return;
    io.to(`market:${marketId}`).emit('market:updated', data);
}
/**
 * Broadcast odds change for a market.
 */
function broadcastOddsChange(marketId, data) {
    if (!io)
        return;
    io.to(`market:${marketId}`).emit('market:odds', data);
}
/**
 * Broadcast a new stake placed on a market.
 */
function broadcastNewStake(marketId, data) {
    if (!io)
        return;
    io.to(`market:${marketId}`).emit('market:newStake', data);
}
/**
 * Broadcast market resolution.
 */
function broadcastMarketResolved(marketId, data) {
    if (!io)
        return;
    io.to(`market:${marketId}`).emit('market:resolved', data);
}
/**
 * Broadcast a new listing created.
 */
function broadcastNewListing(data) {
    if (!io)
        return;
    io.to(`market:${data.marketId}`).emit('listing:created', data);
}
/**
 * Broadcast a listing purchased.
 */
function broadcastListingPurchased(data) {
    if (!io)
        return;
    io.to(`market:${data.marketId}`).emit('listing:purchased', data);
}
/**
 * Broadcast a listing cancelled.
 */
function broadcastListingCancelled(data) {
    if (!io)
        return;
    io.to(`market:${data.marketId}`).emit('listing:cancelled', data);
}
/**
 * Broadcast leaderboard update.
 */
function broadcastLeaderboardUpdate(data) {
    if (!io)
        return;
    io.to('leaderboard').emit('leaderboard:updated', data);
}
/**
 * Send a notification to a specific user.
 */
function notifyUser(walletAddress, data) {
    if (!io)
        return;
    io.to(`user:${walletAddress.toLowerCase()}`).emit('notification', data);
}
/**
 * Broadcast a global event (e.g., new market created).
 */
function broadcastGlobalEvent(eventName, data) {
    if (!io)
        return;
    io.emit(eventName, data);
}
/**
 * Get the number of connected clients.
 */
async function getConnectedClientsCount() {
    if (!io)
        return 0;
    const sockets = await io.fetchSockets();
    return sockets.length;
}
//# sourceMappingURL=websocket.js.map