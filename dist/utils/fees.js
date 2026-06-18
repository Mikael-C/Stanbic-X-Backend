"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateWithdrawalFee = calculateWithdrawalFee;
exports.calculatePTF = calculatePTF;
exports.calculatePayoutWithFee = calculatePayoutWithFee;
exports.calculateOdds = calculateOdds;
exports.formatPayoutForResponse = formatPayoutForResponse;
const config_1 = require("../config");
/**
 * Fee calculation utilities.
 * All fees are BAKED INTO prices/payouts — never returned as separate line items.
 */
/**
 * Calculate withdrawal fee (6% fee baked in).
 * User requests to withdraw `amount` — they receive net after fee deduction.
 */
function calculateWithdrawalFee(amount) {
    const feeRate = config_1.config.fees.withdrawalFeePercent / 100;
    const fee = amount * feeRate;
    const net = amount - fee;
    return { gross: amount, fee, net };
}
/**
 * Calculate Platform Transaction Fee (PTF) — 1% fee baked in.
 * Applied to staking amounts and listing purchases.
 */
function calculatePTF(amount) {
    const feeRate = config_1.config.fees.platformFeePercent / 100;
    const fee = amount * feeRate;
    const net = amount - fee;
    return { gross: amount, fee, net };
}
/**
 * Calculate payout with 1% platform fee baked in.
 * Used when a market resolves and winning stakes are paid out.
 *
 * @param userStake - The amount the user staked on the winning outcome
 * @param winningPool - Total staked on the winning outcome
 * @param totalPot - Total staked across all outcomes (yes + no)
 * @returns net payout after 1% fee deduction
 */
function calculatePayoutWithFee(userStake, winningPool, totalPot) {
    if (winningPool === 0) {
        return { grossPayout: 0, fee: 0, netPayout: 0 };
    }
    const shareOfPool = userStake / winningPool;
    const grossPayout = shareOfPool * totalPot;
    const feeRate = config_1.config.fees.platformFeePercent / 100;
    const fee = grossPayout * feeRate;
    const netPayout = grossPayout - fee;
    return { grossPayout, fee, netPayout };
}
/**
 * Calculate current odds based on staked amounts.
 */
function calculateOdds(yesStakes, noStakes) {
    const total = yesStakes + noStakes;
    if (total === 0) {
        return { yesOdds: 2.0, noOdds: 2.0 };
    }
    if (yesStakes === 0) {
        return { yesOdds: total / 0.01, noOdds: 1.0 };
    }
    if (noStakes === 0) {
        return { yesOdds: 1.0, noOdds: total / 0.01 };
    }
    const yesOdds = total / yesStakes;
    const noOdds = total / noStakes;
    return {
        yesOdds: Math.round(yesOdds * 100) / 100,
        noOdds: Math.round(noOdds * 100) / 100,
    };
}
/**
 * Formats a payout amount for API response — fee is baked in, never shown separately.
 * Only the net amount is returned to the caller.
 */
function formatPayoutForResponse(netAmount) {
    return Math.round(netAmount * 100) / 100;
}
//# sourceMappingURL=fees.js.map