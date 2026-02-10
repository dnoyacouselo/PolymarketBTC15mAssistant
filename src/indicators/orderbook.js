/**
 * Analisis de order book de Polymarket como indicador contrarian.
 *
 * Idea: cuando el mercado de Polymarket esta MUY sesgado en una direccion
 * (p.ej. 85% UP), el valor real puede estar en la direccion contraria.
 * Los mercados de prediccion tienden a sobre-reaccionar.
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
