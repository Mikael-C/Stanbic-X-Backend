/**
 * Odds calculation utilities for prediction markets.
 */
/**
 * Calculate odds multipliers based on current stake pools.
 * Odds represent the multiplier a staker would receive if their outcome wins.
 *
 * @param yesStakes - Total amount staked on "Yes"
 * @param noStakes - Total amount staked on "No"
 * @returns Object with yesOdds and noOdds multipliers
 */
export declare function calculateOdds(yesStakes: number, noStakes: number): {
    yesOdds: number;
    noOdds: number;
    yesImpliedProbability: number;
    noImpliedProbability: number;
};
/**
 * Calculate potential payout for a given stake.
 * Takes into account the current pool sizes and a 1% platform fee baked in.
 *
 * @param stakeAmount - Amount being staked
 * @param outcome - "Yes" or "No"
 * @param yesStakes - Current total yes stakes (before this stake)
 * @param noStakes - Current total no stakes (before this stake)
 * @returns Potential payout (net of platform fee)
 */
export declare function calculatePotentialPayout(stakeAmount: number, outcome: string, yesStakes: number, noStakes: number): {
    potentialPayout: number;
    odds: number;
};
/**
 * Calculate the claimable payout for a resolved market.
 *
 * @param userStake - Amount user staked on winning outcome
 * @param winningPool - Total staked on winning outcome
 * @param totalPot - Total staked on all outcomes
 * @returns Net payout after 1% fee
 */
export declare function calculateClaimablePayout(userStake: number, winningPool: number, totalPot: number): number;
/**
 * Get a human-readable odds format.
 */
export declare function formatOdds(odds: number): string;
//# sourceMappingURL=odds.d.ts.map