/**
 * Indicadores de volumen: spikes, ratio y presion compradora/vendedora.
 */

/**
 * Detecta si hay un spike de volumen anormal.
 * Un spike suele preceder un movimiento fuerte.
 *
 * @param {object[]} candles - velas con .volume, .close, .open
 * @param {number} lookback - ventana para la media (default 60)
 * @param {number} threshold - multiplicador sobre la media para considerar spike (default 2.0)
 * @returns {{ isSpike: boolean, ratio: number, direction: string }}
 */
export function detectVolumeSpike(candles, lookback = 60, threshold = 2.0) {
  const result = { isSpike: false, ratio: 0, direction: "NEUTRAL" };

  if (!Array.isArray(candles) || candles.length < lookback + 1) return result;

  // Volumen medio de las ultimas `lookback` velas (excluyendo la actual)
  const past = candles.slice(-lookback - 1, -1);
  const avgVolume = past.reduce((s, c) => s + c.volume, 0) / past.length;

  if (avgVolume <= 0) return result;

  const current = candles[candles.length - 1];
  const ratio = current.volume / avgVolume;

  result.ratio = ratio;
  result.isSpike = ratio >= threshold;

  // La direccion del spike la determina la vela actual
  if (current.close > current.open) {
    result.direction = "UP";
  } else if (current.close < current.open) {
    result.direction = "DOWN";
  }

  return result;
}

/**
 * Calcula la presion compradora vs vendedora usando volumen y precio.
 * Basado en la idea de que:
 *   - Velas verdes con volumen alto = presion compradora
 *   - Velas rojas con volumen alto = presion vendedora
 *
 * @param {object[]} candles - velas con .open, .close, .volume
 * @param {number} lookback - cuantas velas mirar (default 20)
 * @returns {{ buyPressure: number, sellPressure: number, ratio: number, bias: string }}
 *   ratio > 1 = compradores dominan, ratio < 1 = vendedores dominan
 */
export function computeVolumePressure(candles, lookback = 20) {
  const result = { buyPressure: 0, sellPressure: 0, ratio: 1, bias: "NEUTRAL" };

  if (!Array.isArray(candles) || candles.length < lookback) return result;

  const slice = candles.slice(-lookback);

  let buyVol = 0;
  let sellVol = 0;

  for (const c of slice) {
    if (c.close > c.open) {
      buyVol += c.volume;
    } else if (c.close < c.open) {
      sellVol += c.volume;
    } else {
      // Doji: repartir
      buyVol += c.volume * 0.5;
      sellVol += c.volume * 0.5;
    }
  }

  result.buyPressure = buyVol;
  result.sellPressure = sellVol;

  if (sellVol > 0) {
    result.ratio = buyVol / sellVol;
  }

  // Solo marcar sesgo si hay una diferencia significativa (>40% de ventaja)
  if (result.ratio > 1.4) {
    result.bias = "BUY";
  } else if (result.ratio < 0.7) {
    result.bias = "SELL";
  }

  return result;
}
