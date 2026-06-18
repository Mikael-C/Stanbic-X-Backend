import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
/**
 * Initialize Socket.io server and attach to HTTP server.
 */
export declare function initializeWebSocket(httpServer: HttpServer): SocketIOServer;
/**
 * Get the Socket.io server instance.
 */
export declare function getIO(): SocketIOServer;
/**
 * Broadcast a market update to all subscribers of that market.
 */
export declare function broadcastMarketUpdate(marketId: string, data: {
    marketId: string;
    status?: string;
    yesStakes?: number;
    noStakes?: number;
    yesOdds?: number;
    noOdds?: number;
    winner?: string;
    resolvedAt?: string;
}): void;
/**
 * Broadcast odds change for a market.
 */
export declare function broadcastOddsChange(marketId: string, data: {
    marketId: string;
    yesOdds: number;
    noOdds: number;
    yesStakes: number;
    noStakes: number;
}): void;
/**
 * Broadcast a new stake placed on a market.
 */
export declare function broadcastNewStake(marketId: string, data: {
    marketId: string;
    stakeId: string;
    outcome: string;
    amount: number;
    walletAddress: string;
    newYesStakes: number;
    newNoStakes: number;
    yesOdds: number;
    noOdds: number;
}): void;
/**
 * Broadcast market resolution.
 */
export declare function broadcastMarketResolved(marketId: string, data: {
    marketId: string;
    winner: string;
    resolvedAt: string;
}): void;
/**
 * Broadcast a new listing created.
 */
export declare function broadcastNewListing(data: {
    listingId: string;
    marketId: string;
    stakeId: string;
    price: number;
    seller: string;
}): void;
/**
 * Broadcast a listing purchased.
 */
export declare function broadcastListingPurchased(data: {
    listingId: string;
    marketId: string;
    buyer: string;
    price: number;
}): void;
/**
 * Broadcast a listing cancelled.
 */
export declare function broadcastListingCancelled(data: {
    listingId: string;
    marketId: string;
}): void;
/**
 * Broadcast leaderboard update.
 */
export declare function broadcastLeaderboardUpdate(data: {
    topByAccuracy: any[];
    topByVolume: any[];
}): void;
/**
 * Send a notification to a specific user.
 */
export declare function notifyUser(walletAddress: string, data: {
    type: string;
    title: string;
    message: string;
    data?: any;
}): void;
/**
 * Broadcast a global event (e.g., new market created).
 */
export declare function broadcastGlobalEvent(eventName: string, data: any): void;
/**
 * Get the number of connected clients.
 */
export declare function getConnectedClientsCount(): Promise<number>;
//# sourceMappingURL=websocket.d.ts.map