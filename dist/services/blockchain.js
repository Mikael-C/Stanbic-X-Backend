"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProvider = getProvider;
exports.getHoodiProvider = getHoodiProvider;
exports.getBaseSepoliaProvider = getBaseSepoliaProvider;
exports.getPredictionMarketContract = getPredictionMarketContract;
exports.getVaultContract = getVaultContract;
exports.getStablecoinContract = getStablecoinContract;
exports.getCurrentBlockNumber = getCurrentBlockNumber;
exports.getBlockTimestamp = getBlockTimestamp;
exports.isTransactionSuccessful = isTransactionSuccessful;
exports.getContractLogs = getContractLogs;
exports.parseEventLogs = parseEventLogs;
exports.waitForTransaction = waitForTransaction;
exports.checkProviderHealth = checkProviderHealth;
const ethers_1 = require("ethers");
const config_1 = require("../config");
/**
 * Provider cache to avoid creating multiple instances.
 */
const providerCache = new Map();
/**
 * Get or create a JSON-RPC provider for a given chain.
 */
function getProvider(chainId) {
    const cached = providerCache.get(chainId);
    if (cached)
        return cached;
    const chainConfig = (0, config_1.getChainConfig)(chainId);
    if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    const provider = new ethers_1.ethers.JsonRpcProvider(chainConfig.rpcUrl, {
        chainId: chainConfig.chainId,
        name: chainConfig.name,
    });
    providerCache.set(chainId, provider);
    return provider;
}
/**
 * Get the Hoodi testnet provider.
 */
function getHoodiProvider() {
    return getProvider(config_1.config.chains.hoodi.chainId);
}
/**
 * Get the Base Sepolia provider.
 */
function getBaseSepoliaProvider() {
    return getProvider(config_1.config.chains.baseSepolia.chainId);
}
/**
 * Create a contract instance for the Prediction Market contract.
 */
function getPredictionMarketContract(chainId, signerOrProvider) {
    const chainConfig = (0, config_1.getChainConfig)(chainId);
    if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    const provider = signerOrProvider || getProvider(chainId);
    return new ethers_1.ethers.Contract(chainConfig.predictionMarketContract, config_1.config.contracts.predictionMarketABI, provider);
}
/**
 * Create a contract instance for the Vault contract.
 */
function getVaultContract(chainId, signerOrProvider) {
    const chainConfig = (0, config_1.getChainConfig)(chainId);
    if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    const provider = signerOrProvider || getProvider(chainId);
    return new ethers_1.ethers.Contract(chainConfig.vaultContract, config_1.config.contracts.vaultABI, provider);
}
/**
 * Create a contract instance for the Stablecoin (ERC-20) contract.
 */
function getStablecoinContract(chainId, signerOrProvider) {
    const chainConfig = (0, config_1.getChainConfig)(chainId);
    if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    const provider = signerOrProvider || getProvider(chainId);
    return new ethers_1.ethers.Contract(chainConfig.stablecoinContract, config_1.config.contracts.stablecoinABI, provider);
}
/**
 * Get the current block number for a chain.
 */
async function getCurrentBlockNumber(chainId) {
    const provider = getProvider(chainId);
    return await provider.getBlockNumber();
}
/**
 * Get the block timestamp for a given block number.
 */
async function getBlockTimestamp(chainId, blockNumber) {
    const provider = getProvider(chainId);
    const block = await provider.getBlock(blockNumber);
    if (!block) {
        throw new Error(`Block ${blockNumber} not found on chain ${chainId}`);
    }
    return new Date(block.timestamp * 1000);
}
/**
 * Check if a transaction was successful.
 */
async function isTransactionSuccessful(chainId, txHash) {
    const provider = getProvider(chainId);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt)
        return false;
    return receipt.status === 1;
}
/**
 * Get logs for a contract within a block range.
 */
async function getContractLogs(chainId, contractAddress, fromBlock, toBlock, topics) {
    const provider = getProvider(chainId);
    const filter = {
        address: contractAddress,
        fromBlock,
        toBlock,
        topics,
    };
    return await provider.getLogs(filter);
}
/**
 * Parse event logs using contract ABI.
 */
function parseEventLogs(abi, logs) {
    const iface = new ethers_1.ethers.Interface(abi);
    const parsed = [];
    for (const log of logs) {
        try {
            const parsedLog = iface.parseLog({
                topics: log.topics,
                data: log.data,
            });
            if (parsedLog) {
                const args = {};
                parsedLog.fragment.inputs.forEach((input, i) => {
                    const value = parsedLog.args[i];
                    args[input.name] = typeof value === 'bigint' ? value.toString() : value;
                });
                parsed.push({
                    name: parsedLog.name,
                    args,
                    log,
                });
            }
        }
        catch (e) {
            // Skip logs that don't match the ABI
        }
    }
    return parsed;
}
/**
 * Wait for a transaction to be confirmed.
 */
async function waitForTransaction(chainId, txHash, confirmations = 1) {
    const provider = getProvider(chainId);
    return await provider.waitForTransaction(txHash, confirmations);
}
/**
 * Check if a provider is healthy by fetching the latest block.
 */
async function checkProviderHealth(chainId) {
    try {
        const provider = getProvider(chainId);
        const blockNumber = await provider.getBlockNumber();
        return { healthy: true, blockNumber };
    }
    catch (error) {
        return { healthy: false, error: error.message };
    }
}
//# sourceMappingURL=blockchain.js.map