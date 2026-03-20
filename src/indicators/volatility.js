/**
 * Realized volatility from log-returns of closing prices.
 * Used by the binary option pricing model to scale the
 * distance between spot and strike.
 *
 * @param {number[]} closes - array of closing prices
 * @param {number}   period - number of recent bars to use (default 20)
 * @returns {number|null} annualised volatility (per-bar sigma * sqrt(barsPerYear))
 *   Returns the RAW per-bar sigma (not annualised) so the caller
 *   can multiply by sqrt(T) expressed in the same bar units.
 */
export function computeRealizedVolatility(closes, period = 20) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  const slice = closes.slice(-(period + 1));
  const logReturns = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] <= 0 || slice[i] <= 0) continue;
    logReturns.push(Math.log(slice[i] / slice[i - 1]));
  }

  if (logReturns.length < 2) return null;

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);

  return Math.sqrt(variance);
}
