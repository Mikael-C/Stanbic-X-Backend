import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config';

let io: SocketIOServer | null = null;

/**
 * Initialize Socket.io server and attach to HTTP server.
 */
export function initializeWebSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.cors.origin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  io.on('connection', (socket: Socket) => {
    // Authenticate via JWT
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const payload = jwt.verify(token, config.jwt.secret) as { walletAddress: string; userId: string };
      socket.data.wallet = payload.walletAddress;
    } catch {
      socket.disconnect(true);
      return;
    }

    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Join a market-specific room
    socket.on('subscribe:market', (marketId: string) => {
      socket.join(`market:${marketId}`);
      console.log(`[WebSocket] ${socket.id} subscribed to market:${marketId}`);
    });

    // Leave a market room
    socket.on('unsubscribe:market', (marketId: string) => {
      socket.leave(`market:${marketId}`);
      console.log(`[WebSocket] ${socket.id} unsubscribed from market:${marketId}`);
    });

    // Join leaderboard room
    socket.on('subscribe:leaderboard', () => {
      socket.join('leaderboard');
      console.log(`[WebSocket] ${socket.id} subscribed to leaderboard`);
    });

    // Join user-specific room for personal notifications — only if wallet matches
    socket.on('subscribe:user', (walletAddress: string) => {
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
export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.io server not initialized. Call initializeWebSocket first.');
  }
  return io;
}

/**
 * Broadcast a market update to all subscribers of that market.
 */
export function broadcastMarketUpdate(marketId: string, data: {
  marketId: string;
  status?: string;
  yesStakes?: number;
  noStakes?: number;
  yesOdds?: number;
  noOdds?: number;
  winner?: string;
  resolvedAt?: string;
}): void {
  if (!io) return;
  io.to(`market:${marketId}`).emit('market:updated', data);
}

/**
 * Broadcast odds change for a market.
 */
export function broadcastOddsChange(marketId: string, data: {
  marketId: string;
  yesOdds: number;
  noOdds: number;
  yesStakes: number;
  noStakes: number;
}): void {
  if (!io) return;
  io.to(`market:${marketId}`).emit('market:odds', data);
}

/**
 * Broadcast a new stake placed on a market.
 */
export function broadcastNewStake(marketId: string, data: {
  marketId: string;
  stakeId: string;
  outcome: string;
  amount: number;
  walletAddress: string;
  newYesStakes: number;
  newNoStakes: number;
  yesOdds: number;
  noOdds: number;
}): void {
  if (!io) return;
  io.to(`market:${marketId}`).emit('market:newStake', data);
}

/**
 * Broadcast market resolution.
 */
export function broadcastMarketResolved(marketId: string, data: {
  marketId: string;
  winner: string;
  resolvedAt: string;
}): void {
  if (!io) return;
  io.to(`market:${marketId}`).emit('market:resolved', data);
}

/**
 * Broadcast a new listing created.
 */
export function broadcastNewListing(data: {
  listingId: string;
  marketId: string;
  stakeId: string;
  price: number;
  seller: string;
}): void {
  if (!io) return;
  io.to(`market:${data.marketId}`).emit('listing:created', data);
}

/**
 * Broadcast a listing purchased.
 */
export function broadcastListingPurchased(data: {
  listingId: string;
  marketId: string;
  buyer: string;
  price: number;
}): void {
  if (!io) return;
  io.to(`market:${data.marketId}`).emit('listing:purchased', data);
}

/**
 * Broadcast a listing cancelled.
 */
export function broadcastListingCancelled(data: {
  listingId: string;
  marketId: string;
}): void {
  if (!io) return;
  io.to(`market:${data.marketId}`).emit('listing:cancelled', data);
}

/**
 * Broadcast leaderboard update.
 */
export function broadcastLeaderboardUpdate(data: {
  topByAccuracy: any[];
  topByVolume: any[];
}): void {
  if (!io) return;
  io.to('leaderboard').emit('leaderboard:updated', data);
}

/**
 * Send a notification to a specific user.
 */
export function notifyUser(walletAddress: string, data: {
  type: string;
  title: string;
  message: string;
  data?: any;
}): void {
  if (!io) return;
  io.to(`user:${walletAddress.toLowerCase()}`).emit('notification', data);
}

/**
 * Broadcast a global event (e.g., new market created).
 */
export function broadcastGlobalEvent(eventName: string, data: any): void {
  if (!io) return;
  io.emit(eventName, data);
}

/**
 * Get the number of connected clients.
 */
export async function getConnectedClientsCount(): Promise<number> {
  if (!io) return 0;
  const sockets = await io.fetchSockets();
  return sockets.length;
}
