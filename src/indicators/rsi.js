import { clamp } from "../utils.js";

export function computeRsi(closes, period) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    const diff = cur - prev;
    if (diff > 0) gains += diff;
    else losses += -diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return clamp(rsi, 0, 100);
}

export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function slopeLast(values, points) {
  if (!Array.isArray(values) || values.length < points) return null;
  const slice = values.slice(values.length - points);
  const first = slice[0];
  const last = slice[slice.length - 1];
  return (last - first) / (points - 1);
}

/**
 * Detecta divergencias entre precio y RSI (indicador leading).
 * Divergencia bullish: precio hace nuevo minimo pero RSI no -> probable giro UP.
 * Divergencia bearish: precio hace nuevo maximo pero RSI no -> probable giro DOWN.
 *
 * @param {number[]} closes  - serie de precios de cierre
 * @param {number[]} rsiSeries - serie de valores RSI ya calculados
 * @param {number} lookback - cuantas barras mirar hacia atras (default 20)
 * @returns {{ bullish: boolean, bearish: boolean, strength: number }}
 *   strength 0-1 indica cuanta divergencia hay (0 = nada, 1 = fuerte)
 */
export function detectRsiDivergence(closes, rsiSeries, lookback = 20) {
  const result = { bullish: false, bearish: false, strength: 0 };

  if (
    !Array.isArray(closes) || !Array.isArray(rsiSeries) ||
    closes.length < lookback || rsiSeries.length < lookback
  ) {
    return result;
  }

  const priceSlice = closes.slice(-lookback);
  // Alinear rsiSeries al final para que coincida con priceSlice
  const rsiSlice = rsiSeries.slice(-lookback);

  // Encontrar los dos minimos y maximos locales mas recientes del precio
  const priceLows = [];
  const priceHighs = [];

  for (let i = 1; i < priceSlice.length - 1; i += 1) {
    if (priceSlice[i] <= priceSlice[i - 1] && priceSlice[i] <= priceSlice[i + 1]) {
      priceLows.push(i);
    }
    if (priceSlice[i] >= priceSlice[i - 1] && priceSlice[i] >= priceSlice[i + 1]) {
      priceHighs.push(i);
    }
  }

  // Divergencia bullish: precio hace lower low, RSI hace higher low
  if (priceLows.length >= 2) {
    const prev = priceLows[priceLows.length - 2];
    const curr = priceLows[priceLows.length - 1];

    if (priceSlice[curr] < priceSlice[prev] && rsiSlice[curr] > rsiSlice[prev]) {
      const priceDrop = (priceSlice[prev] - priceSlice[curr]) / priceSlice[prev];
      const rsiRise = (rsiSlice[curr] - rsiSlice[prev]) / 100;
      result.bullish = true;
      result.strength = clamp(priceDrop + rsiRise, 0, 1);
    }
  }

  // Divergencia bearish: precio hace higher high, RSI hace lower high
  if (priceHighs.length >= 2) {
    const prev = priceHighs[priceHighs.length - 2];
    const curr = priceHighs[priceHighs.length - 1];

    if (priceSlice[curr] > priceSlice[prev] && rsiSlice[curr] < rsiSlice[prev]) {
      const priceRise = (priceSlice[curr] - priceSlice[prev]) / priceSlice[prev];
      const rsiDrop = (rsiSlice[prev] - rsiSlice[curr]) / 100;
      result.bearish = true;
      // Si ya hay bullish, tomar la mas fuerte
      result.strength = Math.max(result.strength, clamp(priceRise + rsiDrop, 0, 1));
    }
  }

  return result;
}
