/**
 * Start the indexer service for all configured chains.
 */
export declare function startIndexer(): Promise<void>;
/**
 * Stop the indexer for a specific chain.
 */
export declare function stopIndexer(chainId: number): void;
/**
 * Get indexer stats for health checks and monitoring.
 */
export declare function getIndexerStats(): Promise<{
    chains: Array<{
        chainId: number;
        name: string;
        isRunning: boolean;
        lastIndexedBlock: number;
        currentBlock: number;
        blocksBehind: number;
        lastSyncTime: string;
        isReorging: boolean;
        lastError: string | null;
        lastErrorTime: string | null;
        blocksProcessed: number;
        eventsProcessed: number;
    }>;
    totalEventsStored: number;
}>;
//# sourceMappingURL=indexer.d.ts.map