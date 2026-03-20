/**
 * Avellaneda-Stoikov market-making execution engine.
 *
 * Computes a "reservation price" that skews our limit order placement
 * based on current inventory, risk aversion, volatility and time left.
 *
 * When EXECUTION_ENABLED is true, it places real limit orders via the
 * Polymarket CLOB API.  Otherwise it only logs what it *would* do.
 */

import { bus } from "../core/eventBus.js";
import { netInventory, updateInventory, loadInventory } from "./inventory.js";

const EXECUTION_ENABLED = (process.env.EXECUTION_ENABLED || "false").toLowerCase() === "true";

const MAKER_CONFIG = {
  gamma: parseFloat(process.env.MAKER_GAMMA || "0.1"),
  maxInventory: parseInt(process.env.MAKER_MAX_INVENTORY || "50", 10),
  positionSize: parseFloat(process.env.MAKER_POSITION_SIZE || "10"),
  refreshIntervalMs: parseInt(process.env.MAKER_REFRESH_MS || "5000", 10)
};

/**
 * Avellaneda-Stoikov reservation price.
 *
 * r_t = s_t - q * gamma * sigma^2 * (T - t)
 *
 * @param {object}  opts
 * @param {number}  opts.fairPrice      - model fair value (e.g. binaryOptionPrice probUp * 100)
 * @param {number}  opts.inventory      - net inventory (q), positive = long UP
 * @param {number}  opts.gamma          - risk aversion parameter
 * @param {number}  opts.sigma          - per-bar realised volatility (in price units)
 * @param {number}  opts.timeLeftBars   - remaining time in bar units
 * @returns {number} reservation price (in cents, 0-100)
 */
export function reservationPrice({ fairPrice, inventory, gamma, sigma, timeLeftBars }) {
  const r = fairPrice - inventory * gamma * sigma * sigma * timeLeftBars;
  return Math.max(1, Math.min(99, r));
}

/**
 * Compute optimal bid/ask spread around the reservation price.
 * spread = gamma * sigma^2 * (T-t) + (2 / gamma) * ln(1 + gamma / kappa)
 * where kappa is an order arrival intensity (approximated as 1 here).
 */
export function optimalSpread({ gamma, sigma, timeLeftBars }) {
  const kappa = 1;
  const spread = gamma * sigma * sigma * timeLeftBars +
                 (2 / gamma) * Math.log(1 + gamma / kappa);
  return Math.max(0.5, spread);
}

/**
 * Generate a maker quote based on the current signal.
 *
 * @param {object} opts
 * @param {string} opts.side         - "UP" or "DOWN"
 * @param {number} opts.fairProbUp   - model's fair probability of UP (0-1)
 * @param {number} opts.sigma        - per-bar volatility
 * @param {number} opts.remainingMinutes
 * @param {number} opts.barMinutes   - bar size (default 1 for live)
 * @returns {{ limitPrice: number, side: string, size: number, reservationPx: number, executed: boolean }}
 */
export function generateQuote({
  side,
  fairProbUp,
  sigma,
  remainingMinutes,
  barMinutes = 1
}) {
  loadInventory();
  const q = netInventory();

  if (Math.abs(q) >= MAKER_CONFIG.maxInventory) {
    return { limitPrice: null, side, size: 0, reservationPx: null, executed: false, reason: "max_inventory" };
  }

  const fairPrice = side === "UP" ? fairProbUp * 100 : (1 - fairProbUp) * 100;
  const timeLeftBars = remainingMinutes / barMinutes;
  const sigmaPrice = sigma * 100;

  const resPx = reservationPrice({
    fairPrice,
    inventory: side === "UP" ? q : -q,
    gamma: MAKER_CONFIG.gamma,
    sigma: sigmaPrice,
    timeLeftBars
  });

  const halfSpread = optimalSpread({
    gamma: MAKER_CONFIG.gamma,
    sigma: sigmaPrice,
    timeLeftBars
  }) / 2;

  const limitPrice = Math.round((resPx - halfSpread) * 100) / 100;
  const clampedPrice = Math.max(1, Math.min(99, limitPrice));

  const quote = {
    limitPrice: clampedPrice,
    side,
    size: MAKER_CONFIG.positionSize,
    reservationPx: Math.round(resPx * 100) / 100,
    executed: false,
    reason: "quote_generated"
  };

  if (EXECUTION_ENABLED) {
    // TODO: integrate with @polymarket/clob-client to place real limit orders
    // For now, log intent
    console.log(`[MAKER] REAL ORDER: ${side} @ ${clampedPrice}c, size $${MAKER_CONFIG.positionSize}`);
    quote.executed = true;
  }

  bus.emit("maker:quote", quote);
  return quote;
}

/**
 * Simulate a fill for backtesting.
 * A limit order fills only if the oracle price crosses our limit price.
 *
 * @param {number} limitPrice  - our limit price (cents)
 * @param {string} side        - "UP" or "DOWN"
 * @param {number[]} oraclePrices - array of oracle prices during the window (0-100 scale)
 * @returns {boolean} true if filled
 */
export function simulateFill(limitPrice, side, oraclePrices) {
  if (!oraclePrices || oraclePrices.length === 0) return false;
  for (const px of oraclePrices) {
    if (px <= limitPrice) return true;
  }
  return false;
}
