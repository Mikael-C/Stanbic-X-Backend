"use strict";
/**
 * Odds calculation utilities for prediction markets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateOdds = calculateOdds;
exports.calculatePotentialPayout = calculatePotentialPayout;
exports.calculateClaimablePayout = calculateClaimablePayout;
exports.formatOdds = formatOdds;
/**
 * Calculate odds multipliers based on current stake pools.
 * Odds represent the multiplier a staker would receive if their outcome wins.
 *
 * @param yesStakes - Total amount staked on "Yes"
 * @param noStakes - Total amount staked on "No"
 * @returns Object with yesOdds and noOdds multipliers
 */
function calculateOdds(yesStakes, noStakes) {
    const total = yesStakes + noStakes;
    if (total === 0) {
        return {
            yesOdds: 2.0,
            noOdds: 2.0,
            yesImpliedProbability: 0.5,
            noImpliedProbability: 0.5,
        };
    }
    if (yesStakes === 0) {
        return {
            yesOdds: 100.0,
            noOdds: 1.01,
            yesImpliedProbability: 0.01,
            noImpliedProbability: 0.99,
        };
    }
    if (noStakes === 0) {
        return {
            yesOdds: 1.01,
            noOdds: 100.0,
            yesImpliedProbability: 0.99,
            noImpliedProbability: 0.01,
        };
    }
    const yesOdds = total / yesStakes;
    const noOdds = total / noStakes;
    const yesImpliedProbability = yesStakes / total;
    const noImpliedProbability = noStakes / total;
    return {
        yesOdds: Math.round(yesOdds * 100) / 100,
        noOdds: Math.round(noOdds * 100) / 100,
        yesImpliedProbability: Math.round(yesImpliedProbability * 10000) / 10000,
        noImpliedProbability: Math.round(noImpliedProbability * 10000) / 10000,
    };
}
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
function calculatePotentialPayout(stakeAmount, outcome, yesStakes, noStakes) {
    const PLATFORM_FEE_RATE = 0.01;
    let newYesStakes = yesStakes;
    let newNoStakes = noStakes;
    if (outcome === 'Yes') {
        newYesStakes += stakeAmount;
    }
    else {
        newNoStakes += stakeAmount;
    }
    const totalPot = newYesStakes + newNoStakes;
    const winningPool = outcome === 'Yes' ? newYesStakes : newNoStakes;
    if (winningPool === 0) {
        return { potentialPayout: 0, odds: 0 };
    }
    const shareOfPool = stakeAmount / winningPool;
    const grossPayout = shareOfPool * totalPot;
    const netPayout = grossPayout * (1 - PLATFORM_FEE_RATE);
    const odds = totalPot / winningPool;
    return {
        potentialPayout: Math.round(netPayout * 100) / 100,
        odds: Math.round(odds * 100) / 100,
    };
}
/**
 * Calculate the claimable payout for a resolved market.
 *
 * @param userStake - Amount user staked on winning outcome
 * @param winningPool - Total staked on winning outcome
 * @param totalPot - Total staked on all outcomes
 * @returns Net payout after 1% fee
 */
function calculateClaimablePayout(userStake, winningPool, totalPot) {
    if (winningPool === 0)
        return 0;
    const PLATFORM_FEE_RATE = 0.01;
    const share = userStake / winningPool;
    const gross = share * totalPot;
    const net = gross * (1 - PLATFORM_FEE_RATE);
    return Math.round(net * 100) / 100;
}
/**
 * Get a human-readable odds format.
 */
function formatOdds(odds) {
    if (odds >= 100)
        return '99:1';
    if (odds <= 1.01)
        return '1:99';
    const against = Math.round((odds - 1) * 100) / 100;
    return `1:${against}`;
}
//# sourceMappingURL=odds.js.map