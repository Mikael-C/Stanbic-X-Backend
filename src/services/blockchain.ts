import { ethers } from 'ethers';
import { config, getChainConfig, ChainConfig } from '../config';

/**
 * Provider cache to avoid creating multiple instances.
 */
const providerCache: Map<number, ethers.JsonRpcProvider> = new Map();

/**
 * Get or create a JSON-RPC provider for a given chain.
 */
export function getProvider(chainId: number): ethers.JsonRpcProvider {
  const cached = providerCache.get(chainId);
  if (cached) return cached;

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl, {
    chainId: chainConfig.chainId,
    name: chainConfig.name,
  });

  providerCache.set(chainId, provider);
  return provider;
}

/**
 * Get the Hoodi testnet provider.
 */
export function getHoodiProvider(): ethers.JsonRpcProvider {
  return getProvider(config.chains.hoodi.chainId);
}

/**
 * Get the Base Sepolia provider.
 */
export function getBaseSepoliaProvider(): ethers.JsonRpcProvider {
  return getProvider(config.chains.baseSepolia.chainId);
}

/**
 * Create a contract instance for the Prediction Market contract.
 */
export function getPredictionMarketContract(
  chainId: number,
  signerOrProvider?: ethers.Signer | ethers.Provider
): ethers.Contract {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const provider = signerOrProvider || getProvider(chainId);
  return new ethers.Contract(
    chainConfig.predictionMarketContract,
    config.contracts.predictionMarketABI,
    provider
  );
}

/**
 * Create a contract instance for the Vault contract.
 */
export function getVaultContract(
  chainId: number,
  signerOrProvider?: ethers.Signer | ethers.Provider
): ethers.Contract {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const provider = signerOrProvider || getProvider(chainId);
  return new ethers.Contract(
    chainConfig.vaultContract,
    config.contracts.vaultABI,
    provider
  );
}

/**
 * Create a contract instance for the Stablecoin (ERC-20) contract.
 */
export function getStablecoinContract(
  chainId: number,
  signerOrProvider?: ethers.Signer | ethers.Provider
): ethers.Contract {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const provider = signerOrProvider || getProvider(chainId);
  return new ethers.Contract(
    chainConfig.stablecoinContract,
    config.contracts.stablecoinABI,
    provider
  );
}

/**
 * Get the current block number for a chain.
 */
export async function getCurrentBlockNumber(chainId: number): Promise<number> {
  const provider = getProvider(chainId);
  return await provider.getBlockNumber();
}

/**
 * Get the block timestamp for a given block number.
 */
export async function getBlockTimestamp(chainId: number, blockNumber: number): Promise<Date> {
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
export async function isTransactionSuccessful(
  chainId: number,
  txHash: string
): Promise<boolean> {
  const provider = getProvider(chainId);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return false;
  return receipt.status === 1;
}

/**
 * Get logs for a contract within a block range.
 */
export async function getContractLogs(
  chainId: number,
  contractAddress: string,
  fromBlock: number,
  toBlock: number,
  topics?: string[]
): Promise<ethers.Log[]> {
  const provider = getProvider(chainId);
  const filter: ethers.Filter = {
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
export function parseEventLogs(
  abi: string[],
  logs: ethers.Log[]
): Array<{ name: string; args: Record<string, any>; log: ethers.Log }> {
  const iface = new ethers.Interface(abi);
  const parsed: Array<{ name: string; args: Record<string, any>; log: ethers.Log }> = [];

  for (const log of logs) {
    try {
      const parsedLog = iface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });

      if (parsedLog) {
        const args: Record<string, any> = {};
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
    } catch (e) {
      // Skip logs that don't match the ABI
    }
  }

  return parsed;
}

/**
 * Wait for a transaction to be confirmed.
 */
export async function waitForTransaction(
  chainId: number,
  txHash: string,
  confirmations: number = 1
): Promise<ethers.TransactionReceipt | null> {
  const provider = getProvider(chainId);
  return await provider.waitForTransaction(txHash, confirmations);
}

/**
 * Check if a provider is healthy by fetching the latest block.
 */
export async function checkProviderHealth(chainId: number): Promise<{
  healthy: boolean;
  blockNumber?: number;
  error?: string;
}> {
  try {
    const provider = getProvider(chainId);
    const blockNumber = await provider.getBlockNumber();
    return { healthy: true, blockNumber };
  } catch (error: any) {
    return { healthy: false, error: error.message };
  }
}
