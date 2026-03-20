/**
 * Uncertainty estimation via indicator bootstrap.
 *
 * Instead of Monte Carlo Dropout on an LSTM (Phase 5 future),
 * we perturb the TA indicator inputs with gaussian noise and
 * re-run scoreDirection() multiple times.  If the resulting
 * rawUp distribution has high standard deviation, the signal
 * is "confused" and we should not trade.
 *
 * When a real ML model is ready, replace estimateUncertainty()
 * with the model's own { mean, std } output from MC Dropout.
 */

import { scoreDirection } from "./probability.js";

/**
 * Add gaussian noise proportional to the value's magnitude.
 * @param {number|null} value
 * @param {number} noiseFraction - e.g. 0.05 = 5% noise
 * @returns {number|null}
 */
function perturb(value, noiseFraction = 0.05) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  const noise = (Math.random() * 2 - 1) * Math.abs(value) * noiseFraction;
  return value + noise;
}

function perturbInputs(inputs) {
  return {
    ...inputs,
    price: perturb(inputs.price, 0.001),
    vwap: perturb(inputs.vwap, 0.001),
    vwapSlope: perturb(inputs.vwapSlope, 0.10),
    rsi: perturb(inputs.rsi, 0.05),
    rsiSlope: perturb(inputs.rsiSlope, 0.15),
    macd: inputs.macd ? {
      ...inputs.macd,
      hist: perturb(inputs.macd.hist, 0.10),
      histDelta: perturb(inputs.macd.histDelta, 0.15),
      macd: perturb(inputs.macd.macd, 0.10)
    } : null,
    heikenCount: Math.max(0, (inputs.heikenCount ?? 0) + (Math.random() > 0.8 ? (Math.random() > 0.5 ? 1 : -1) : 0)),
    volumeSpike: inputs.volumeSpike ? {
      ...inputs.volumeSpike,
      ratio: perturb(inputs.volumeSpike.ratio, 0.10)
    } : inputs.volumeSpike,
    volumePressure: inputs.volumePressure ? {
      ...inputs.volumePressure,
      ratio: perturb(inputs.volumePressure.ratio, 0.10)
    } : inputs.volumePressure
  };
}

/**
 * Estimate model uncertainty by running scoreDirection with
 * perturbed inputs multiple times.
 *
 * @param {object} inputs - same shape as scoreDirection inputs
 * @param {number} iterations - number of bootstrap runs (default 20)
 * @returns {{ mean: number, std: number, confident: boolean }}
 */
export function estimateUncertainty(inputs, iterations = 20) {
  const results = [];

  for (let i = 0; i < iterations; i++) {
    const perturbed = perturbInputs(inputs);
    const { rawUp } = scoreDirection(perturbed);
    results.push(rawUp);
  }

  const mean = results.reduce((a, b) => a + b, 0) / results.length;
  const std = Math.sqrt(
    results.reduce((s, v) => s + (v - mean) ** 2, 0) / results.length
  );

  // Threshold: if std > 0.12, the signal is too noisy to trust.
  // Conservative default — tighten after validating on live data.
  return { mean, std, confident: std < 0.12 };
}
