import { ethers } from 'ethers';
/**
 * Get or create a JSON-RPC provider for a given chain.
 */
export declare function getProvider(chainId: number): ethers.JsonRpcProvider;
/**
 * Get the Hoodi testnet provider.
 */
export declare function getHoodiProvider(): ethers.JsonRpcProvider;
/**
 * Get the Base Sepolia provider.
 */
export declare function getBaseSepoliaProvider(): ethers.JsonRpcProvider;
/**
 * Create a contract instance for the Prediction Market contract.
 */
export declare function getPredictionMarketContract(chainId: number, signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract;
/**
 * Create a contract instance for the Vault contract.
 */
export declare function getVaultContract(chainId: number, signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract;
/**
 * Create a contract instance for the Stablecoin (ERC-20) contract.
 */
export declare function getStablecoinContract(chainId: number, signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract;
/**
 * Get the current block number for a chain.
 */
export declare function getCurrentBlockNumber(chainId: number): Promise<number>;
/**
 * Get the block timestamp for a given block number.
 */
export declare function getBlockTimestamp(chainId: number, blockNumber: number): Promise<Date>;
/**
 * Check if a transaction was successful.
 */
export declare function isTransactionSuccessful(chainId: number, txHash: string): Promise<boolean>;
/**
 * Get logs for a contract within a block range.
 */
export declare function getContractLogs(chainId: number, contractAddress: string, fromBlock: number, toBlock: number, topics?: string[]): Promise<ethers.Log[]>;
/**
 * Parse event logs using contract ABI.
 */
export declare function parseEventLogs(abi: string[], logs: ethers.Log[]): Array<{
    name: string;
    args: Record<string, any>;
    log: ethers.Log;
}>;
/**
 * Wait for a transaction to be confirmed.
 */
export declare function waitForTransaction(chainId: number, txHash: string, confirmations?: number): Promise<ethers.TransactionReceipt | null>;
/**
 * Check if a provider is healthy by fetching the latest block.
 */
export declare function checkProviderHealth(chainId: number): Promise<{
    healthy: boolean;
    blockNumber?: number;
    error?: string;
}>;
//# sourceMappingURL=blockchain.d.ts.map