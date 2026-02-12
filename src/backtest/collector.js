import { insertSnapshot, insertOutcome, getPendingOutcomes, getOutcome } from "./dataStore.js";

/**
 * Recolector de datos para backtesting.
 * Se integra con el loop principal para guardar cada snapshot.
 */

let lastCollectedSlug = null;
let outcomeCheckInterval = null;

/**
 * Recolecta un snapshot del estado actual del mercado y señales.
 * Llamar esto en cada iteración del loop principal.
 */
export async function collectSnapshot(data) {
  const {
    // Mercado
    market,
    poly,
    
    // Precios
    chainlinkPrice,
    binancePrice,
    priceToBeat,
    
    // Indicadores
    rsi,
    rsiSlope,
    macd,
    vwap,
    vwapSlope,
    vwapDist,
    heikenColor,
    heikenCount,
    delta1m,
    delta3m,
    
    // Régimen y señales
    regime,
    timeLeftMin,
    modelUp,
    modelDown,
    edgeUp,
    edgeDown,
    signal,
    phase,
    strength
  } = data;

  const marketSlug = market?.slug ?? null;
  const marketEndTime = market?.endDate ?? null;

  // Extraer datos del orderbook
  const upBookSummary = poly?.orderbook?.up ?? {};
  const downBookSummary = poly?.orderbook?.down ?? {};

  const snapshot = {
    timestamp: new Date().toISOString(),
    market_slug: marketSlug,
    market_end_time: marketEndTime,
    
    chainlink_price: chainlinkPrice ?? null,
    binance_price: binancePrice ?? null,
    price_to_beat: priceToBeat ?? null,
    
    poly_up_price: poly?.prices?.up ?? null,
    poly_down_price: poly?.prices?.down ?? null,
    poly_liquidity: market?.liquidityNum ?? market?.liquidity ?? null,
    poly_up_bid_liq: upBookSummary.bidLiquidity ?? null,
    poly_up_ask_liq: upBookSummary.askLiquidity ?? null,
    poly_down_bid_liq: downBookSummary.bidLiquidity ?? null,
    poly_down_ask_liq: downBookSummary.askLiquidity ?? null,
    
    rsi: rsi ?? null,
    rsi_slope: rsiSlope ?? null,
    macd_line: macd?.macd ?? null,
    macd_signal: macd?.signal ?? null,
    macd_hist: macd?.hist ?? null,
    macd_hist_delta: macd?.histDelta ?? null,
    vwap: vwap ?? null,
    vwap_slope: vwapSlope ?? null,
    vwap_dist: vwapDist ?? null,
    heiken_color: heikenColor ?? null,
    heiken_count: heikenCount ?? null,
    delta_1m: delta1m ?? null,
    delta_3m: delta3m ?? null,
    
    regime: regime ?? null,
    time_left_min: timeLeftMin ?? null,
    model_up: modelUp ?? null,
    model_down: modelDown ?? null,
    edge_up: edgeUp ?? null,
    edge_down: edgeDown ?? null,
    signal: signal ?? null,
    phase: phase ?? null,
    strength: strength ?? null
  };

  try {
    await insertSnapshot(snapshot);
    
    // Detectar cambio de mercado para resolver outcomes pendientes
    if (marketSlug && marketSlug !== lastCollectedSlug) {
      lastCollectedSlug = marketSlug;
      // Chequear outcomes pendientes cuando cambia el mercado
      // No awaiting here to avoid blocking main loop too much if DB is slow?
      // Actually await is fine as sqlite3 in WAL mode is fast.
      checkPendingOutcomes(chainlinkPrice).catch(e => console.error(e));
    }
  } catch (err) {
    if (process.env.DEBUG_COLLECTOR) {
      console.error("[Collector] Error inserting snapshot:", err.message);
    }
  }

  return snapshot;
}

/**
 * Revisa mercados que ya terminaron y registra su outcome.
 */
export async function checkPendingOutcomes(currentChainlinkPrice) {
  if (currentChainlinkPrice === null || currentChainlinkPrice === undefined) return;

  try {
    const pending = await getPendingOutcomes();
    
    for (const market of pending) {
      const { market_slug, market_end_time, price_to_beat } = market;
      
      if (!price_to_beat) continue;
      
      // Verificar que el mercado ya terminó (con margen de 1 minuto)
      const endTime = new Date(market_end_time).getTime();
      const now = Date.now();
      if (now < endTime + 60_000) continue;
      
      // Determinar outcome basado en precio final vs price to beat
      // NOTA: Idealmente deberíamos obtener el precio exacto al momento de cierre
      // Por ahora usamos el precio actual como aproximación si no tenemos mejor dato
      const outcome = currentChainlinkPrice > price_to_beat ? "UP" : "DOWN";
      
      await insertOutcome({
        market_slug,
        market_end_time,
        price_to_beat,
        final_price: currentChainlinkPrice,
        outcome
      });
      
      if (process.env.DEBUG_COLLECTOR) {
        console.log(`[Collector] Resolved ${market_slug}: ${outcome} (${currentChainlinkPrice} vs ${price_to_beat})`);
      }
    }
  } catch (err) {
    if (process.env.DEBUG_COLLECTOR) {
      console.error("[Collector] Error checking pending outcomes:", err.message);
    }
  }
}

/**
 * Inicia un intervalo para revisar outcomes pendientes periódicamente.
 */
export function startOutcomeChecker(getChainlinkPriceFn, intervalMs = 60_000) {
  if (outcomeCheckInterval) {
    clearInterval(outcomeCheckInterval);
  }
  
  outcomeCheckInterval = setInterval(() => {
    const price = getChainlinkPriceFn();
    if (price !== null) {
      checkPendingOutcomes(price).catch(err => {
          if (process.env.DEBUG_COLLECTOR) console.error(err);
      });
    }
  }, intervalMs);
  
  return outcomeCheckInterval;
}

export function stopOutcomeChecker() {
  if (outcomeCheckInterval) {
    clearInterval(outcomeCheckInterval);
    outcomeCheckInterval = null;
  }
}

/**
 * Construye los datos para el collector desde las variables del loop principal.
 * Helper para facilitar la integración.
 */
export function buildCollectorData({
  poly,
  chainlinkPrice,
  binancePrice,
  priceToBeat,
  rsiNow,
  rsiSlope,
  macd,
  vwapNow,
  vwapSlope,
  vwapDist,
  consec,
  delta1m,
  delta3m,
  regimeInfo,
  timeAware,
  edge,
  rec,
  timeLeftMin
}) {
  const market = poly?.ok ? poly.market : null;
  const signal = rec?.action === "ENTER" 
    ? (rec.side === "UP" ? "BUY_UP" : "BUY_DOWN") 
    : "NO_TRADE";

  return {
    market,
    poly: poly?.ok ? poly : null,
    chainlinkPrice,
    binancePrice,
    priceToBeat,
    rsi: rsiNow,
    rsiSlope,
    macd,
    vwap: vwapNow,
    vwapSlope,
    vwapDist,
    heikenColor: consec?.color ?? null,
    heikenCount: consec?.count ?? null,
    delta1m,
    delta3m,
    regime: regimeInfo?.regime ?? null,
    timeLeftMin,
    modelUp: timeAware?.adjustedUp ?? null,
    modelDown: timeAware?.adjustedDown ?? null,
    edgeUp: edge?.edgeUp ?? null,
    edgeDown: edge?.edgeDown ?? null,
    signal,
    phase: rec?.phase ?? null,
    strength: rec?.strength ?? null
  };
}
