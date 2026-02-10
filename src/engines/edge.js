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

/**
 * Logica de decision mejorada.
 *
 * Cambios clave respecto al original:
 *   1. Requiere un minimo de senales en acuerdo (agreement) para operar
 *   2. Umbrales adaptativos por regimen (no solo por fase temporal)
 *   3. Divergencias pueden anular la decision cuando contradicen
 *   4. En CHOP: ultra-conservador, casi nunca operar
 *   5. STRONG solo cuando TODO alinea
 *
 * @param {object} params
 * @param {number} params.remainingMinutes
 * @param {number|null} params.edgeUp
 * @param {number|null} params.edgeDown
 * @param {number|null} params.modelUp
 * @param {number|null} params.modelDown
 * @param {string|null} params.regime
 * @param {object} params.signals - del scoreDirection { agreement, divergence, ... }
 * @returns {{ action: string, side: string|null, phase: string, strength: string, reason: string, edge: number }}
 */
export function decide({
  remainingMinutes,
  edgeUp,
  edgeDown,
  modelUp = null,
  modelDown = null,
  regime = null,
  signals = {}
}) {
  const phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";
  const agreement = signals.agreement ?? 0;
  const divergence = signals.divergence ?? "NONE";

  // --- Umbrales por regimen + fase ---
  // En CHOP: muy dificil que entre
  // En RANGE: permite mas operaciones porque las divergencias funcionan
  // En TREND: estandar
  const thresholds = {
    TREND_UP:   { EARLY: 0.08, MID: 0.12, LATE: 0.20 },
    TREND_DOWN: { EARLY: 0.08, MID: 0.12, LATE: 0.20 },
    RANGE:      { EARLY: 0.10, MID: 0.14, LATE: 0.22 },
    CHOP:       { EARLY: 0.18, MID: 0.22, LATE: 0.30 }
  };

  const minProbs = {
    TREND_UP:   { EARLY: 0.58, MID: 0.62, LATE: 0.68 },
    TREND_DOWN: { EARLY: 0.58, MID: 0.62, LATE: 0.68 },
    RANGE:      { EARLY: 0.55, MID: 0.58, LATE: 0.65 },
    CHOP:       { EARLY: 0.65, MID: 0.70, LATE: 0.75 }
  };

  const regimeKey = regime && thresholds[regime] ? regime : "RANGE";
  const threshold = thresholds[regimeKey][phase];
  const minProb = minProbs[regimeKey][phase];

  // --- Filtros basicos ---
  if (edgeUp === null || edgeDown === null) {
    return { action: "NO_TRADE", side: null, phase, reason: "missing_market_data" };
  }

  const bestSide = edgeUp > edgeDown ? "UP" : "DOWN";
  const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
  const bestModel = bestSide === "UP" ? modelUp : modelDown;

  // --- FILTRO 1: Minimo de senales en acuerdo ---
  // En TREND necesitamos al menos 2 indicadores de acuerdo
  // En RANGE/CHOP al menos 3 (mas exigente porque hay mas ruido)
  const minAgreement = (regimeKey === "RANGE" || regimeKey === "CHOP") ? 3 : 2;
  if (agreement < minAgreement) {
    return { action: "NO_TRADE", side: null, phase, reason: `low_agreement_${agreement}_need_${minAgreement}` };
  }

  // --- FILTRO 2: Divergencias como veto ---
  // Si hay divergencia CONTRARIA a nuestra senal, NO operar
  // (las divergencias son indicadores leading y merecen respeto)
  if (bestSide === "UP" && divergence === "BEARISH") {
    return { action: "NO_TRADE", side: null, phase, reason: "bearish_divergence_vetoes_up" };
  }
  if (bestSide === "DOWN" && divergence === "BULLISH") {
    return { action: "NO_TRADE", side: null, phase, reason: "bullish_divergence_vetoes_down" };
  }

  // --- FILTRO 3: Edge minimo ---
  if (bestEdge < threshold) {
    return { action: "NO_TRADE", side: null, phase, reason: `edge_${bestEdge.toFixed(3)}_below_${threshold}` };
  }

  // --- FILTRO 4: Probabilidad minima ---
  if (bestModel !== null && bestModel < minProb) {
    return { action: "NO_TRADE", side: null, phase, reason: `prob_${bestModel.toFixed(3)}_below_${minProb}` };
  }

  // --- FILTRO 5: En CHOP, casi nunca operar ---
  if (regimeKey === "CHOP" && phase !== "LATE") {
    // En CHOP solo operar LATE con edge muy alto
    return { action: "NO_TRADE", side: null, phase, reason: "chop_regime_not_late" };
  }

  // --- FILTRO 6: Senal contraria al regimen necesita mas evidencia ---
  // Ej: comprar UP en TREND_DOWN necesita divergencia bullish O acuerdo >= 4
  if (bestSide === "UP" && regimeKey === "TREND_DOWN") {
    const hasBullishDivergence = divergence === "BULLISH";
    if (!hasBullishDivergence && agreement < 4) {
      return { action: "NO_TRADE", side: null, phase, reason: "up_against_trend_down_weak" };
    }
  }
  if (bestSide === "DOWN" && regimeKey === "TREND_UP") {
    const hasBearishDivergence = divergence === "BEARISH";
    if (!hasBearishDivergence && agreement < 4) {
      return { action: "NO_TRADE", side: null, phase, reason: "down_against_trend_up_weak" };
    }
  }

  // --- Clasificacion de fuerza ---
  // STRONG: edge alto + probabilidad alta + muchas senales de acuerdo + con la tendencia
  const withTrend = (bestSide === "UP" && regimeKey === "TREND_UP") ||
                    (bestSide === "DOWN" && regimeKey === "TREND_DOWN");
  const hasDivergenceSupport = (bestSide === "UP" && divergence === "BULLISH") ||
                               (bestSide === "DOWN" && divergence === "BEARISH");

  const isStrong = bestEdge >= 0.25 &&
                   bestModel !== null && bestModel >= 0.70 &&
                   agreement >= 3 &&
                   (withTrend || hasDivergenceSupport);

  const isGood = bestEdge >= 0.12 && agreement >= 2;

  const strength = isStrong ? "STRONG" : isGood ? "GOOD" : "OPTIONAL";

  return { action: "ENTER", side: bestSide, phase, strength, edge: bestEdge, reason: "signal_confirmed" };
}
