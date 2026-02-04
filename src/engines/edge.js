import { clamp } from "../utils.js";

export function computeEdge({ modelUp, modelDown, marketYes, marketNo }) {
  if (marketYes === null || marketNo === null) {
    return { marketUp: null, marketDown: null, edgeUp: null, edgeDown: null };
  }

  const sum = marketYes + marketNo;
  const marketUp = sum > 0 ? marketYes / sum : null;
  const marketDown = sum > 0 ? marketNo / sum : null;

  const edgeUp = marketUp === null ? null : modelUp - marketUp;
  const edgeDown = marketDown === null ? null : modelDown - marketDown;

  return {
    marketUp: marketUp === null ? null : clamp(marketUp, 0, 1),
    marketDown: marketDown === null ? null : clamp(marketDown, 0, 1),
    edgeUp,
    edgeDown
  };
}

export function decide({ remainingMinutes, edgeUp, edgeDown, modelUp = null, modelDown = null, regime = null }) {
  const phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";

  // Umbrales ajustados basados en backtesting de 45+ horas
  // GOOD tuvo 62.5% precision, STRONG solo 36.7%
  const threshold = phase === "EARLY" ? 0.08 : phase === "MID" ? 0.12 : 0.2;

  // Probabilidad minima mas estricta
  const minProb = phase === "EARLY" ? 0.60 : phase === "MID" ? 0.65 : 0.70;

  if (edgeUp === null || edgeDown === null) {
    return { action: "NO_TRADE", side: null, phase, reason: "missing_market_data" };
  }

  const bestSide = edgeUp > edgeDown ? "UP" : "DOWN";
  const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
  const bestModel = bestSide === "UP" ? modelUp : modelDown;

  // FILTRO CRITICO: Votos UP en TREND_UP tuvieron solo 35% precision
  // Requerir edge mucho mayor para esta combinacion
  if (bestSide === "UP" && regime === "TREND_UP") {
    const upInTrendThreshold = 0.25; // Mucho mas estricto
    if (bestEdge < upInTrendThreshold) {
      return { action: "NO_TRADE", side: null, phase, reason: "up_in_trend_up_filtered" };
    }
  }

  if (bestEdge < threshold) {
    return { action: "NO_TRADE", side: null, phase, reason: `edge_below_${threshold}` };
  }

  if (bestModel !== null && bestModel < minProb) {
    return { action: "NO_TRADE", side: null, phase, reason: `prob_below_${minProb}` };
  }

  // STRONG ahora requiere edge >= 0.30 Y probabilidad >= 0.75
  // Esto evita los falsos positivos que tenian 36.7% precision
  const isStrong = bestEdge >= 0.30 && bestModel !== null && bestModel >= 0.75;
  const isGood = bestEdge >= 0.12;
  
  const strength = isStrong ? "STRONG" : isGood ? "GOOD" : "OPTIONAL";
  return { action: "ENTER", side: bestSide, phase, strength, edge: bestEdge };
}
