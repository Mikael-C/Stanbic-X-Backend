/**
 * Fee calculation utilities.
 * All fees are BAKED INTO prices/payouts — never returned as separate line items.
 */
/**
 * Calculate withdrawal fee (6% fee baked in).
 * User requests to withdraw `amount` — they receive net after fee deduction.
 */
export declare function calculateWithdrawalFee(amount: number): {
    gross: number;
    fee: number;
    net: number;
};
/**
 * Calculate Platform Transaction Fee (PTF) — 1% fee baked in.
 * Applied to staking amounts and listing purchases.
 */
export declare function calculatePTF(amount: number): {
    gross: number;
    fee: number;
    net: number;
};
/**
 * Calculate payout with 1% platform fee baked in.
 * Used when a market resolves and winning stakes are paid out.
 *
 * @param userStake - The amount the user staked on the winning outcome
 * @param winningPool - Total staked on the winning outcome
 * @param totalPot - Total staked across all outcomes (yes + no)
 * @returns net payout after 1% fee deduction
 */
export declare function calculatePayoutWithFee(userStake: number, winningPool: number, totalPot: number): {
    grossPayout: number;
    fee: number;
    netPayout: number;
};
/**
 * Calculate current odds based on staked amounts.
 */
export declare function calculateOdds(yesStakes: number, noStakes: number): {
    yesOdds: number;
    noOdds: number;
};
/**
 * Formats a payout amount for API response — fee is baked in, never shown separately.
 * Only the net amount is returned to the caller.
 */
export declare function formatPayoutForResponse(netAmount: number): number;
//# sourceMappingURL=fees.d.ts.map