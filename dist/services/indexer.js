"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startIndexer = startIndexer;
exports.stopIndexer = stopIndexer;
exports.getIndexerStats = getIndexerStats;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../config");
const blockchain_1 = require("./blockchain");
const websocket_1 = require("./websocket");
const indexerStates = new Map();
/**
 * Initialize sync status for a chain in the database.
 */
async function initSyncStatus(chainConfig) {
    const existing = await prisma_1.prisma.syncStatus.findUnique({
        where: { chainId: chainConfig.chainId },
    });
    if (!existing) {
        await prisma_1.prisma.syncStatus.create({
            data: {
                chainId: chainConfig.chainId,
                lastIndexedBlock: chainConfig.startBlock,
                lastSyncTime: new Date(),
                isReorging: false,
            },
        });
    }
}
/**
 * Get the last indexed block for a chain.
 */
async function getLastIndexedBlock(chainId) {
    const status = await prisma_1.prisma.syncStatus.findUnique({
        where: { chainId },
    });
    return status?.lastIndexedBlock || 0;
}
/**
 * Update the last indexed block for a chain.
 */
async function updateLastIndexedBlock(chainId, blockNumber) {
    await prisma_1.prisma.syncStatus.update({
        where: { chainId },
        data: {
            lastIndexedBlock: blockNumber,
            lastSyncTime: new Date(),
        },
    });
}
/**
 * Detect chain reorgs by checking if the parent hash of the current block
 * matches what we expect.
 */
async function detectReorg(chainId, currentBlock) {
    try {
        const provider = (0, blockchain_1.getProvider)(chainId);
        const block = await provider.getBlock(currentBlock);
        if (!block)
            return false;
        // Check if we have events at this block that have a different hash
        const existingEvents = await prisma_1.prisma.event.findFirst({
            where: {
                chainId,
                blockNumber: currentBlock,
            },
        });
        if (existingEvents) {
            // We already indexed this block — possible reorg
            console.warn(`[Indexer] Possible reorg detected at block ${currentBlock} on chain ${chainId}`);
            return true;
        }
        return false;
    }
    catch (error) {
        console.error(`[Indexer] Reorg detection error on chain ${chainId}:`, error);
        return false;
    }
}
/**
 * Handle a reorg by rolling back events from the affected blocks.
 */
async function handleReorg(chainId, fromBlock) {
    console.warn(`[Indexer] Handling reorg on chain ${chainId} from block ${fromBlock}`);
    await prisma_1.prisma.syncStatus.update({
        where: { chainId },
        data: { isReorging: true },
    });
    // Delete events from the reorged blocks
    await prisma_1.prisma.event.deleteMany({
        where: {
            chainId,
            blockNumber: { gte: fromBlock },
        },
    });
    // Reset the last indexed block
    await prisma_1.prisma.syncStatus.update({
        where: { chainId },
        data: {
            lastIndexedBlock: fromBlock - 1,
            isReorging: false,
        },
    });
    console.log(`[Indexer] Reorg handled. Reset to block ${fromBlock - 1} on chain ${chainId}`);
}
/**
 * Process a batch of event logs for a chain.
 */
async function processEvents(chainId, chainConfig, fromBlock, toBlock) {
    let totalEventsProcessed = 0;
    // Process Prediction Market contract events
    if (chainConfig.predictionMarketContract) {
        try {
            const logs = await (0, blockchain_1.getContractLogs)(chainId, chainConfig.predictionMarketContract, fromBlock, toBlock);
            const parsed = (0, blockchain_1.parseEventLogs)(config_1.config.contracts.predictionMarketABI, logs);
            for (const event of parsed) {
                const blockTimestamp = await (0, blockchain_1.getBlockTimestamp)(chainId, event.log.blockNumber);
                await prisma_1.prisma.event.create({
                    data: {
                        chainId,
                        contractAddress: chainConfig.predictionMarketContract,
                        eventName: event.name,
                        blockNumber: event.log.blockNumber,
                        transactionHash: event.log.transactionHash,
                        logIndex: event.log.index,
                        eventData: event.args,
                        blockTimestamp,
                    },
                });
                // Process specific events for state updates
                await processMarketEvent(event.name, event.args, chainConfig);
                totalEventsProcessed++;
            }
        }
        catch (error) {
            console.error(`[Indexer] Error processing prediction market events on chain ${chainId}:`, error);
        }
    }
    // Process Vault contract events
    if (chainConfig.vaultContract) {
        try {
            const logs = await (0, blockchain_1.getContractLogs)(chainId, chainConfig.vaultContract, fromBlock, toBlock);
            const parsed = (0, blockchain_1.parseEventLogs)(config_1.config.contracts.vaultABI, logs);
            for (const event of parsed) {
                const blockTimestamp = await (0, blockchain_1.getBlockTimestamp)(chainId, event.log.blockNumber);
                await prisma_1.prisma.event.create({
                    data: {
                        chainId,
                        contractAddress: chainConfig.vaultContract,
                        eventName: event.name,
                        blockNumber: event.log.blockNumber,
                        transactionHash: event.log.transactionHash,
                        logIndex: event.log.index,
                        eventData: event.args,
                        blockTimestamp,
                    },
                });
                totalEventsProcessed++;
            }
        }
        catch (error) {
            console.error(`[Indexer] Error processing vault events on chain ${chainId}:`, error);
        }
    }
    return totalEventsProcessed;
}
/**
 * Process a specific market event and update database state.
 */
async function processMarketEvent(eventName, args, chainConfig) {
    try {
        switch (eventName) {
            case 'MarketCreated': {
                const existingMarket = await prisma_1.prisma.market.findUnique({
                    where: { marketId: args.marketId },
                });
                if (!existingMarket) {
                    await prisma_1.prisma.market.create({
                        data: {
                            marketId: args.marketId,
                            contractAddress: chainConfig.predictionMarketContract,
                            creator: args.creator,
                            question: args.question,
                            endTime: new Date(parseInt(args.endTime) * 1000),
                            status: 'open',
                        },
                    });
                }
                break;
            }
            case 'StakePlaced': {
                const market = await prisma_1.prisma.market.findUnique({
                    where: { marketId: args.marketId },
                });
                if (market) {
                    const outcome = args.outcome === '0' || args.outcome === 0 ? 'Yes' : 'No';
                    const amount = parseFloat(args.amount) / 1e18;
                    // Update market stakes
                    const updateData = outcome === 'Yes'
                        ? { yesStakes: market.yesStakes + amount }
                        : { noStakes: market.noStakes + amount };
                    await prisma_1.prisma.market.update({
                        where: { id: market.id },
                        data: updateData,
                    });
                    // Broadcast odds change
                    const updatedMarket = await prisma_1.prisma.market.findUnique({
                        where: { id: market.id },
                    });
                    if (updatedMarket) {
                        const total = updatedMarket.yesStakes + updatedMarket.noStakes;
                        const yesOdds = updatedMarket.yesStakes > 0 ? total / updatedMarket.yesStakes : 100;
                        const noOdds = updatedMarket.noStakes > 0 ? total / updatedMarket.noStakes : 100;
                        (0, websocket_1.broadcastOddsChange)(market.marketId, {
                            marketId: market.marketId,
                            yesOdds: Math.round(yesOdds * 100) / 100,
                            noOdds: Math.round(noOdds * 100) / 100,
                            yesStakes: updatedMarket.yesStakes,
                            noStakes: updatedMarket.noStakes,
                        });
                    }
                }
                break;
            }
            case 'MarketResolved': {
                const market = await prisma_1.prisma.market.findUnique({
                    where: { marketId: args.marketId },
                });
                if (market) {
                    const winner = args.winner === '0' || args.winner === 0 ? 'Yes' : 'No';
                    await prisma_1.prisma.market.update({
                        where: { id: market.id },
                        data: {
                            status: 'resolved',
                            winner,
                            resolvedAt: new Date(),
                        },
                    });
                    (0, websocket_1.broadcastMarketResolved)(market.marketId, {
                        marketId: market.marketId,
                        winner,
                        resolvedAt: new Date().toISOString(),
                    });
                }
                break;
            }
            case 'PayoutClaimed': {
                // Mark stakes as claimed for this user/market
                const market = await prisma_1.prisma.market.findUnique({
                    where: { marketId: args.marketId },
                });
                if (market) {
                    const user = await prisma_1.prisma.user.findUnique({
                        where: { walletAddress: args.claimer.toLowerCase() },
                    });
                    if (user) {
                        await prisma_1.prisma.stake.updateMany({
                            where: {
                                userId: user.id,
                                marketId: market.id,
                                claimed: false,
                            },
                            data: {
                                claimed: true,
                                claimedAt: new Date(),
                            },
                        });
                    }
                }
                break;
            }
        }
    }
    catch (error) {
        console.error(`[Indexer] Error processing ${eventName} event:`, error);
    }
}
/**
 * Run the indexer loop for a single chain.
 */
async function indexChain(chainConfig) {
    const chainId = chainConfig.chainId;
    const state = indexerStates.get(chainId);
    try {
        const lastIndexed = await getLastIndexedBlock(chainId);
        const currentBlock = await (0, blockchain_1.getCurrentBlockNumber)(chainId);
        const safeBlock = currentBlock - config_1.config.indexer.confirmations;
        if (lastIndexed >= safeBlock) {
            return; // Already up to date
        }
        const fromBlock = lastIndexed + 1;
        const toBlock = Math.min(fromBlock + config_1.config.indexer.batchSize - 1, safeBlock);
        // Check for reorgs
        if (await detectReorg(chainId, fromBlock)) {
            await handleReorg(chainId, fromBlock);
            return; // Will retry on next iteration
        }
        const eventsProcessed = await processEvents(chainId, chainConfig, fromBlock, toBlock);
        await updateLastIndexedBlock(chainId, toBlock);
        state.blocksProcessed += (toBlock - fromBlock + 1);
        state.eventsProcessed += eventsProcessed;
        state.lastError = null;
        state.lastErrorTime = null;
        if (eventsProcessed > 0) {
            console.log(`[Indexer] Chain ${chainId}: Processed blocks ${fromBlock}-${toBlock}, ${eventsProcessed} events`);
        }
    }
    catch (error) {
        state.lastError = error.message;
        state.lastErrorTime = new Date();
        console.error(`[Indexer] Error indexing chain ${chainId}:`, error.message);
    }
}
/**
 * Start the indexer service for all configured chains.
 */
async function startIndexer() {
    const chains = (0, config_1.getAllChainConfigs)();
    for (const chainConfig of chains) {
        // Skip chains without contracts configured
        if (!chainConfig.predictionMarketContract && !chainConfig.vaultContract) {
            console.log(`[Indexer] Skipping chain ${chainConfig.chainId} (${chainConfig.name}): no contracts configured`);
            continue;
        }
        await initSyncStatus(chainConfig);
        indexerStates.set(chainConfig.chainId, {
            chainId: chainConfig.chainId,
            isRunning: true,
            lastError: null,
            lastErrorTime: null,
            blocksProcessed: 0,
            eventsProcessed: 0,
        });
        console.log(`[Indexer] Started indexer for ${chainConfig.name} (chain ${chainConfig.chainId})`);
    }
    // Start polling loop
    const poll = async () => {
        for (const chainConfig of chains) {
            const state = indexerStates.get(chainConfig.chainId);
            if (state?.isRunning) {
                await indexChain(chainConfig);
            }
        }
    };
    setInterval(poll, config_1.config.indexer.pollingIntervalMs);
    // Run immediately once
    await poll();
}
/**
 * Stop the indexer for a specific chain.
 */
function stopIndexer(chainId) {
    const state = indexerStates.get(chainId);
    if (state) {
        state.isRunning = false;
        console.log(`[Indexer] Stopped indexer for chain ${chainId}`);
    }
}
/**
 * Get indexer stats for health checks and monitoring.
 */
async function getIndexerStats() {
    const chains = (0, config_1.getAllChainConfigs)();
    const chainStats = [];
    for (const chainConfig of chains) {
        const state = indexerStates.get(chainConfig.chainId);
        const syncStatus = await prisma_1.prisma.syncStatus.findUnique({
            where: { chainId: chainConfig.chainId },
        });
        let currentBlock = 0;
        try {
            currentBlock = await (0, blockchain_1.getCurrentBlockNumber)(chainConfig.chainId);
        }
        catch (e) {
            // Provider might be down
        }
        chainStats.push({
            chainId: chainConfig.chainId,
            name: chainConfig.name,
            isRunning: state?.isRunning || false,
            lastIndexedBlock: syncStatus?.lastIndexedBlock || 0,
            currentBlock,
            blocksBehind: currentBlock - (syncStatus?.lastIndexedBlock || 0),
            lastSyncTime: syncStatus?.lastSyncTime?.toISOString() || 'never',
            isReorging: syncStatus?.isReorging || false,
            lastError: state?.lastError || null,
            lastErrorTime: state?.lastErrorTime?.toISOString() || null,
            blocksProcessed: state?.blocksProcessed || 0,
            eventsProcessed: state?.eventsProcessed || 0,
        });
    }
    const totalEventsStored = await prisma_1.prisma.event.count();
    return {
        chains: chainStats,
        totalEventsStored,
    };
}
//# sourceMappingURL=indexer.js.map