/**
 * Polymarket order book analysis:
 *  1. Contrarian indicator (existing)
 *  2. VPIN — Volume-synchronized Probability of Informed Trading
 *
 * VPIN measures the imbalance between buy-initiated and sell-initiated
 * volume.  High VPIN (> 0.7) signals toxic flow — informed traders are
 * active and it is dangerous to take the other side.
 */

/**
 * Analiza el sesgo del order book de Polymarket.
 *
 * @param {object} params
 * @param {number|null} params.marketUp - precio de UP en Polymarket (0-1)
 * @param {number|null} params.marketDown - precio de DOWN en Polymarket (0-1)
 * @param {object|null} params.upBook - resumen del order book UP { bestBid, bestAsk, spread, bidLiquidity, askLiquidity }
 * @param {object|null} params.downBook - resumen del order book DOWN
 * @returns {{
 *   skew: number,           // -1 (muy bearish) a +1 (muy bullish)
 *   isExtreme: boolean,     // si el sesgo es extremo (>0.75 o <-0.75)
 *   contrarianSide: string|null,  // "UP" o "DOWN" - la direccion contrarian
 *   liquidityImbalance: number,   // diferencia de liquidez relativa
 *   confidence: number      // 0-1, cuanto confiar en la senal
 * }}
 */
export function analyzePolymarketBook({ marketUp, marketDown, upBook, downBook }) {
  const result = {
    skew: 0,
    isExtreme: false,
    contrarianSide: null,
    liquidityImbalance: 0,
    confidence: 0
  };

  if (marketUp === null || marketDown === null) return result;

  const sum = marketUp + marketDown;
  if (sum <= 0) return result;

  // Normalizar a probabilidades
  const pUp = marketUp / sum;
  const pDown = marketDown / sum;

  // Skew: positivo = mercado apuesta UP, negativo = apuesta DOWN
  result.skew = pUp - pDown;

  // Extremo: cuando el mercado da > 80% a un lado
  result.isExtreme = pUp > 0.80 || pDown > 0.80;

  // La senal contrarian: si el mercado esta demasiado en un lado, apostar al otro
  if (pUp > 0.80) {
    result.contrarianSide = "DOWN";
    result.confidence = (pUp - 0.80) * 5; // 0 a 1 entre 80% y 100%
  } else if (pDown > 0.80) {
    result.contrarianSide = "UP";
    result.confidence = (pDown - 0.80) * 5;
  }

  // Analisis de liquidez si hay datos del order book
  if (upBook && downBook) {
    const upLiq = (upBook.bidLiquidity ?? 0) + (upBook.askLiquidity ?? 0);
    const downLiq = (downBook.bidLiquidity ?? 0) + (downBook.askLiquidity ?? 0);
    const totalLiq = upLiq + downLiq;

    if (totalLiq > 0) {
      // Imbalance: positivo = mas liquidez en UP, negativo = mas en DOWN
      result.liquidityImbalance = (upLiq - downLiq) / totalLiq;
    }
  }

  return result;
}

// ==================== VPIN ====================

const vpinBuffer = [];
const VPIN_WINDOW = 300; // snapshots (~5 min at 1 snapshot/sec)

/**
 * Feed a new orderbook snapshot into the rolling VPIN buffer.
 *
 * "Buy volume" is approximated as increase in bid-side liquidity on UP
 * (or ask-side on DOWN) between consecutive snapshots.
 * "Sell volume" is the opposite direction.
 *
 * @param {{ bidLiquidity: number|null, askLiquidity: number|null }} upBook
 * @param {{ bidLiquidity: number|null, askLiquidity: number|null }} downBook
 */
export function updateVpinBuffer(upBook, downBook) {
  const ts = Date.now();
  const upBid = upBook?.bidLiquidity ?? 0;
  const upAsk = upBook?.askLiquidity ?? 0;
  const downBid = downBook?.bidLiquidity ?? 0;
  const downAsk = downBook?.askLiquidity ?? 0;

  vpinBuffer.push({ ts, upBid, upAsk, downBid, downAsk });

  while (vpinBuffer.length > VPIN_WINDOW) {
    vpinBuffer.shift();
  }
}

/**
 * Compute VPIN from the rolling buffer of orderbook snapshots.
 *
 * Buy-initiated volume ≈ increase in UP bid liquidity + increase in DOWN ask liquidity
 * Sell-initiated volume ≈ increase in UP ask liquidity + increase in DOWN bid liquidity
 *
 * VPIN = |V_buy - V_sell| / (V_buy + V_sell)
 *
 * @returns {number|null} VPIN in [0, 1], or null if not enough data
 */
export function computeVPIN() {
  if (vpinBuffer.length < 10) return null;

  let buyVol = 0;
  let sellVol = 0;

  for (let i = 1; i < vpinBuffer.length; i++) {
    const prev = vpinBuffer[i - 1];
    const cur = vpinBuffer[i];

    const dUpBid = cur.upBid - prev.upBid;
    const dUpAsk = cur.upAsk - prev.upAsk;
    const dDownBid = cur.downBid - prev.downBid;
    const dDownAsk = cur.downAsk - prev.downAsk;

    buyVol += Math.max(0, dUpBid) + Math.max(0, dDownAsk);
    sellVol += Math.max(0, dUpAsk) + Math.max(0, dDownBid);
  }

  const total = buyVol + sellVol;
  if (total <= 0) return null;

  return Math.abs(buyVol - sellVol) / total;
}

/**
 * Reset VPIN buffer (useful for tests).
 */
export function resetVpinBuffer() {
  vpinBuffer.length = 0;
}
