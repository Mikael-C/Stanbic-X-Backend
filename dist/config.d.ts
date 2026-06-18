export declare const config: {
    port: number;
    nodeEnv: string;
    databaseUrl: string;
    jwt: {
        secret: string;
        expiresIn: string;
    };
    admin: {
        wallets: string[];
    };
    cors: {
        origin: string;
        credentials: boolean;
    };
    chains: {
        localhost: {
            chainId: number;
            name: string;
            rpcUrl: string;
            predictionMarketContract: string;
            vaultContract: string;
            stablecoinContract: string;
            blockExplorer: string;
            startBlock: number;
        };
        hoodi: {
            chainId: number;
            name: string;
            rpcUrl: string;
            predictionMarketContract: string;
            vaultContract: string;
            stablecoinContract: string;
            blockExplorer: string;
            startBlock: number;
        };
        baseSepolia: {
            chainId: number;
            name: string;
            rpcUrl: string;
            predictionMarketContract: string;
            vaultContract: string;
            stablecoinContract: string;
            blockExplorer: string;
            startBlock: number;
        };
    };
    contracts: {
        predictionMarketABI: string[];
        vaultABI: string[];
        stablecoinABI: string[];
    };
    fees: {
        withdrawalFeePercent: number;
        platformFeePercent: number;
    };
    rateLimit: {
        general: {
            windowMs: number;
            max: number;
        };
        ai: {
            windowMs: number;
            max: number;
            dailyMax: number;
        };
    };
    indexer: {
        pollingIntervalMs: number;
        batchSize: number;
        confirmations: number;
    };
    ai: {
        endpoint: string;
        apiKey: string;
        model: string;
        maxTokens: number;
        systemPrompt: string;
    };
};
export type ChainConfig = typeof config.chains.hoodi;
export declare function getChainConfig(chainId: number): ChainConfig | null;
export declare function getAllChainConfigs(): ChainConfig[];
//# sourceMappingURL=config.d.ts.map