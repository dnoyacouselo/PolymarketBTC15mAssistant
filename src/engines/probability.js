import { clamp } from "../utils.js";

/**
 * Scoring adaptativo por regimen de mercado.
 *
 * Filosofia:
 *   TREND_UP/DOWN -> seguir la tendencia, pero penalizar senales a contracorriente
 *   RANGE         -> mean reversion: RSI extremo y divergencias valen mas
 *   CHOP          -> ser ultra-conservador, casi no operar
 *
 * Cada indicador aporta puntos ponderados segun el regimen.
 */

// Pesos por regimen: cuanto vale cada indicador en cada contexto
// Valores mas altos = mas importancia
const WEIGHTS = {
  TREND_UP: {
    vwapPosition:   2.0,   // precio vs VWAP
    vwapSlope:      2.5,   // pendiente del VWAP (importante en tendencia)
    rsiMomentum:    1.5,   // RSI + pendiente
    macdMomentum:   2.0,   // MACD histograma
    heikenAshi:     1.0,   // velas Heiken Ashi
    divergence:     3.0,   // divergencias RSI - MUY importante para detectar giros
    volumeSpike:    2.0,   // spikes de volumen
    volumePressure: 1.5,   // presion compradora/vendedora
    contrarian:     1.5,   // senal contrarian de Polymarket
  },
  TREND_DOWN: {
    vwapPosition:   2.0,
    vwapSlope:      2.5,
    rsiMomentum:    1.5,
    macdMomentum:   2.0,
    heikenAshi:     1.0,
    divergence:     3.0,
    volumeSpike:    2.0,
    volumePressure: 1.5,
    contrarian:     1.5,
  },
  RANGE: {
    vwapPosition:   1.0,   // menos importante en rango
    vwapSlope:      0.5,   // casi irrelevante
    rsiMomentum:    3.0,   // MUY importante: mean reversion
    macdMomentum:   1.0,
    heikenAshi:     1.5,
    divergence:     3.5,   // maximo peso: divergencias predicen giros
    volumeSpike:    2.5,   // spikes pueden romper el rango
    volumePressure: 2.0,
    contrarian:     2.5,   // mercado Polymarket sobrereacciona en rangos
  },
  CHOP: {
    vwapPosition:   0.5,
    vwapSlope:      0.5,
    rsiMomentum:    1.0,
    macdMomentum:   0.5,
    heikenAshi:     0.5,
    divergence:     2.0,
    volumeSpike:    1.5,
    volumePressure: 1.0,
    contrarian:     1.0,
  }
};

/**
 * Calcula una puntuacion direccional ponderada por regimen.
 *
 * @param {object} inputs
 * @param {string} inputs.regime - "TREND_UP", "TREND_DOWN", "RANGE", "CHOP"
 * @param {number|null} inputs.price
 * @param {number|null} inputs.vwap
 * @param {number|null} inputs.vwapSlope
 * @param {number|null} inputs.rsi
 * @param {number|null} inputs.rsiSlope
 * @param {object|null} inputs.macd - { hist, histDelta, macd }
 * @param {string|null} inputs.heikenColor - "green" | "red"
 * @param {number} inputs.heikenCount
 * @param {boolean} inputs.failedVwapReclaim
 * @param {{ bullish: boolean, bearish: boolean, strength: number }} inputs.divergence
 * @param {{ isSpike: boolean, ratio: number, direction: string }} inputs.volumeSpike
 * @param {{ bias: string, ratio: number }} inputs.volumePressure
 * @param {{ isExtreme: boolean, contrarianSide: string|null, confidence: number }} inputs.polymarketBook
 * @returns {{ upScore: number, downScore: number, rawUp: number, signals: object }}
 */
export function scoreDirection(inputs) {
  const {
    regime = "RANGE",
    price,
    vwap,
    vwapSlope,
    rsi,
    rsiSlope,
    macd,
    heikenColor,
    heikenCount,
    failedVwapReclaim,
    divergence = { bullish: false, bearish: false, strength: 0 },
    volumeSpike = { isSpike: false, ratio: 0, direction: "NEUTRAL" },
    volumePressure = { bias: "NEUTRAL", ratio: 1 },
    polymarketBook = { isExtreme: false, contrarianSide: null, confidence: 0 }
  } = inputs;

  const w = WEIGHTS[regime] ?? WEIGHTS.RANGE;

  let up = 0;
  let down = 0;

  // Para tracking de cuales senales contribuyen
  const signals = {
    vwap: "NEUTRAL",
    rsi: "NEUTRAL",
    macd: "NEUTRAL",
    heiken: "NEUTRAL",
    divergence: "NONE",
    volume: "NEUTRAL",
    contrarian: "NONE",
    agreement: 0
  };

  // --- 1. VWAP Position ---
  if (price !== null && vwap !== null) {
    if (price > vwap) {
      up += w.vwapPosition;
      signals.vwap = "LONG";
    }
    if (price < vwap) {
      down += w.vwapPosition;
      signals.vwap = "SHORT";
    }
  }

  // --- 2. VWAP Slope ---
  if (vwapSlope !== null) {
    if (vwapSlope > 0) up += w.vwapSlope;
    if (vwapSlope < 0) down += w.vwapSlope;
  }

  // --- 3. RSI Momentum ---
  // En RANGE/CHOP: logica de MEAN REVERSION (RSI extremo -> apostar al giro)
  // En TREND: logica de MOMENTUM (RSI con la tendencia)
  if (rsi !== null) {
    if (regime === "RANGE" || regime === "CHOP") {
      // Mean reversion: RSI sobrecomprado -> DOWN, sobrevendido -> UP
      if (rsi > 70) {
        down += w.rsiMomentum * 1.5;
        signals.rsi = "SHORT";
      } else if (rsi < 30) {
        up += w.rsiMomentum * 1.5;
        signals.rsi = "LONG";
      } else if (rsi > 60 && rsiSlope !== null && rsiSlope < 0) {
        down += w.rsiMomentum * 0.5;
        signals.rsi = "SHORT";
      } else if (rsi < 40 && rsiSlope !== null && rsiSlope > 0) {
        up += w.rsiMomentum * 0.5;
        signals.rsi = "LONG";
      }
    } else {
      // Momentum: ir con la tendencia del RSI
      if (rsi > 55 && rsiSlope !== null && rsiSlope > 0) {
        up += w.rsiMomentum;
        signals.rsi = "LONG";
      }
      if (rsi < 45 && rsiSlope !== null && rsiSlope < 0) {
        down += w.rsiMomentum;
        signals.rsi = "SHORT";
      }
    }
  }

  // --- 4. MACD Momentum ---
  if (macd?.hist !== null && macd?.histDelta !== null) {
    const expandingGreen = macd.hist > 0 && macd.histDelta > 0;
    const expandingRed = macd.hist < 0 && macd.histDelta < 0;
    const contractingGreen = macd.hist > 0 && macd.histDelta < 0;
    const contractingRed = macd.hist < 0 && macd.histDelta > 0;

    if (expandingGreen) {
      up += w.macdMomentum;
      signals.macd = "LONG";
    }
    if (expandingRed) {
      down += w.macdMomentum;
      signals.macd = "SHORT";
    }

    // MACD contrayendo = posible cambio de tendencia (leading)
    if (regime === "RANGE" || regime === "CHOP") {
      if (contractingRed) {
        up += w.macdMomentum * 0.5; // senal debil de giro
      }
      if (contractingGreen) {
        down += w.macdMomentum * 0.5;
      }
    }
  }

  // --- 5. Heiken Ashi ---
  if (heikenColor) {
    const minCount = regime === "RANGE" ? 3 : 2;
    if (heikenColor === "green" && heikenCount >= minCount) {
      up += w.heikenAshi;
      signals.heiken = "LONG";
    }
    if (heikenColor === "red" && heikenCount >= minCount) {
      down += w.heikenAshi;
      signals.heiken = "SHORT";
    }
  }

  // --- 6. DIVERGENCIAS RSI (indicador leading - el mas importante) ---
  if (divergence.bullish) {
    up += w.divergence * (1 + divergence.strength);
    signals.divergence = "BULLISH";

    // En tendencia bajista, una divergencia bullish es mas significativa
    if (regime === "TREND_DOWN") {
      up += w.divergence * 0.5;
    }
  }
  if (divergence.bearish) {
    down += w.divergence * (1 + divergence.strength);
    signals.divergence = signals.divergence === "BULLISH" ? "MIXED" : "BEARISH";

    // En tendencia alcista, una divergencia bearish es mas significativa
    if (regime === "TREND_UP") {
      down += w.divergence * 0.5;
    }
  }

  // --- 7. Volume Spike ---
  if (volumeSpike.isSpike) {
    if (volumeSpike.direction === "UP") {
      up += w.volumeSpike;
    } else if (volumeSpike.direction === "DOWN") {
      down += w.volumeSpike;
    }
    signals.volume = volumeSpike.direction;
  }

  // --- 8. Volume Pressure ---
  if (volumePressure.bias === "BUY") {
    up += w.volumePressure;
    if (signals.volume === "NEUTRAL") signals.volume = "BUY_PRESSURE";
  } else if (volumePressure.bias === "SELL") {
    down += w.volumePressure;
    if (signals.volume === "NEUTRAL") signals.volume = "SELL_PRESSURE";
  }

  // --- 9. Polymarket Contrarian ---
  if (polymarketBook.isExtreme && polymarketBook.contrarianSide) {
    const contrarianWeight = w.contrarian * polymarketBook.confidence;
    if (polymarketBook.contrarianSide === "UP") {
      up += contrarianWeight;
      signals.contrarian = "BUY";
    } else if (polymarketBook.contrarianSide === "DOWN") {
      down += contrarianWeight;
      signals.contrarian = "SELL";
    }
  }

  // --- 10. Failed VWAP Reclaim (senal bajista fuerte) ---
  if (failedVwapReclaim === true) {
    down += 2.0;
  }

  // --- Calculo final ---
  // Base minima para evitar division por 0
  up = Math.max(up, 0.1);
  down = Math.max(down, 0.1);

  const rawUp = up / (up + down);

  // Contar cuantas senales estan de acuerdo
  const longSignals = [signals.vwap, signals.rsi, signals.macd, signals.heiken, signals.volume]
    .filter(s => s === "LONG" || s === "BUY_PRESSURE").length;
  const shortSignals = [signals.vwap, signals.rsi, signals.macd, signals.heiken, signals.volume]
    .filter(s => s === "SHORT" || s === "SELL_PRESSURE").length;
  signals.agreement = Math.max(longSignals, shortSignals);

  return { upScore: up, downScore: down, rawUp, signals };
}

/**
 * Ajuste temporal: a medida que queda menos tiempo, la probabilidad
 * converge hacia 50% (menos certeza).
 */
export function applyTimeAwareness(rawUp, remainingMinutes, windowMinutes) {
  const timeDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
  const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
  return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}
