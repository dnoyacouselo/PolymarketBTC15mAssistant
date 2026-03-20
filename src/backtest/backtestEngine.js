/**
 * Backtest REAL: descarga datos historicos de Binance y ejecuta
 * la estrategia exacta del bot sobre cada vela de 15 minutos.
 *
 * No necesita datos previos ni npm start - todo se calcula sobre la marcha.
 *
 * Limitacion: no tenemos precios historicos de Polymarket, asi que
 * simulamos el mercado como 50/50 (el edge = modelo - 0.5).
 * Esto testea la capacidad predictiva PURA del modelo tecnico.
 */

import { CONFIG } from "../config.js";
import { computeSessionVwap, computeVwapSeries } from "../indicators/vwap.js";
import { computeRsi, sma, slopeLast, detectRsiDivergence } from "../indicators/rsi.js";
import { computeMacd } from "../indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "../indicators/heikenAshi.js";
import { detectVolumeSpike, computeVolumePressure } from "../indicators/volume.js";
import { detectRegime } from "../engines/regime.js";
import { scoreDirection, binaryOptionPrice, blendProbabilities } from "../engines/probability.js";
import { computeRealizedVolatility } from "../indicators/volatility.js";
import { estimateUncertainty } from "../engines/uncertainty.js";
import { computeEdge, decide } from "../engines/edge.js";
import { sleep } from "../utils.js";

const BINANCE_URL = "https://api.binance.com/api/v3/klines";

// ==================== DATA FETCHING ====================

/**
 * Descarga velas historicas de Binance con paginacion.
 * @param {object} opts
 * @param {number} opts.days - Dias de historia (default 30)
 * @param {string} opts.startDate - Fecha inicio ISO (alternativa a days)
 * @param {string} opts.endDate - Fecha fin ISO (default: ahora)
 * @param {string} opts.interval - Intervalo (default "15m")
 * @returns {Promise<object[]>} Array de candles {openTime, open, high, low, close, volume, closeTime}
 */
async function fetchHistoricalKlines({ days = 30, startDate, endDate, interval = "15m" } = {}) {
  const endMs = endDate ? new Date(endDate).getTime() : Date.now();
  const startMs = startDate
    ? new Date(startDate).getTime()
    : endMs - days * 24 * 60 * 60 * 1000;

  const allCandles = [];
  let currentStart = startMs;

  while (currentStart < endMs) {
    const url = new URL(BINANCE_URL);
    url.searchParams.set("symbol", CONFIG.symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(currentStart));
    url.searchParams.set("endTime", String(endMs));
    url.searchParams.set("limit", "1000");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance error: ${res.status}`);
    const data = await res.json();
    if (!data || data.length === 0) break;

    for (const k of data) {
      allCandles.push({
        openTime: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: Number(k[6])
      });
    }

    // Avanzar al siguiente bloque
    currentStart = allCandles[allCandles.length - 1].closeTime + 1;

    // Rate limit
    await sleep(200);
  }

  return allCandles;
}

// ==================== INDICATOR COMPUTATION ====================

function countVwapCrosses(closes, vwapSeries, lookback) {
  if (closes.length < lookback || vwapSeries.length < lookback) return null;
  let crosses = 0;
  for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] - vwapSeries[i - 1];
    const cur = closes[i] - vwapSeries[i];
    if (prev === 0) continue;
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
  }
  return crosses;
}

/**
 * Computa todos los indicadores para un punto en el tiempo,
 * usando las velas historicas hasta ese momento.
 */
function computeIndicators(candles) {
  const closes = candles.map(c => c.close);

  // VWAP (rolling 96 velas = ~24h de sesion)
  const sessionCandles = candles.slice(-96);
  const vwapNow = computeSessionVwap(sessionCandles);
  const vwapSeries = computeVwapSeries(sessionCandles);
  const vwapSlope = vwapSeries.length >= 5
    ? slopeLast(vwapSeries, 5)
    : null;
  const vwapCrossCount = vwapSeries.length >= 20
    ? countVwapCrosses(
        closes.slice(-vwapSeries.length),
        vwapSeries,
        Math.min(20, vwapSeries.length)
      )
    : null;

  // RSI
  const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
  const rsiMa = sma(
    closes.slice(-30).map((_, i, arr) => computeRsi(closes.slice(0, closes.length - 30 + i + 1), CONFIG.rsiPeriod)).filter(v => v !== null),
    CONFIG.rsiMaPeriod
  );
  // RSI series para divergencia
  const rsiSeries = [];
  for (let j = Math.max(0, closes.length - 30); j <= closes.length; j++) {
    const r = computeRsi(closes.slice(0, j), CONFIG.rsiPeriod);
    if (r !== null) rsiSeries.push(r);
  }
  const rsiSlope = rsiSeries.length >= 5 ? slopeLast(rsiSeries, 5) : null;

  // RSI Divergence
  const divergence = detectRsiDivergence(closes, rsiSeries, 20);

  // MACD
  const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

  // Heiken Ashi
  const haCandles = computeHeikenAshi(candles);
  const consec = countConsecutive(haCandles);

  // Volume indicators
  const volSpike = detectVolumeSpike(candles, 60, 2.0);
  const volPressure = computeVolumePressure(candles, 20);

  // Volume reciente vs media (para regimen)
  const recentVol = candles.length >= 5
    ? candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5
    : null;
  const avgVol = candles.length >= 60
    ? candles.slice(-60).reduce((s, c) => s + c.volume, 0) / 60
    : null;

  // VWAP distance
  const lastClose = closes[closes.length - 1];
  const vwapDist = vwapNow !== null && lastClose !== null && vwapNow !== 0
    ? (lastClose - vwapNow) / vwapNow
    : null;

  // Regime
  const regimeInfo = detectRegime({
    price: lastClose,
    vwap: vwapNow,
    vwapSlope,
    vwapCrossCount,
    volumeRecent: recentVol,
    volumeAvg: avgVol
  });

  // Per-bar realised volatility for binary option pricing
  const sigma = computeRealizedVolatility(closes, 20);

  return {
    closes,
    lastClose,
    vwapNow,
    vwapSlope,
    vwapDist,
    rsiNow,
    rsiSlope,
    divergence,
    macd,
    consec,
    volSpike,
    volPressure,
    regimeInfo,
    sigma
  };
}

// ==================== BACKTEST ENGINE ====================

/**
 * Ejecuta backtest real.
 *
 * @param {object} opts
 * @param {number} opts.days - Dias de historia (default 30)
 * @param {string} opts.startDate - ISO date
 * @param {string} opts.endDate - ISO date
 * @param {number} opts.simulatedTimeLeft - Minutos restantes simulados (default 14 = EARLY)
 * @param {number} opts.lookback - Velas de lookback para indicadores (default 80)
 * @returns {Promise<object>} Resultados del backtest
 */
export async function runRealBacktest({
  days = 30,
  startDate,
  endDate,
  simulatedTimeLeft = 14,
  lookback = 80
} = {}) {
  // 1. Descargar datos historicos
  // Necesitamos lookback extra para los indicadores
  const extraDays = Math.ceil(lookback / 96) + 1;
  const fetchDays = days + extraDays;

  const actualStartDate = startDate
    ? new Date(new Date(startDate).getTime() - extraDays * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  console.log(`Descargando ${fetchDays} dias de velas de Binance...`);
  const allCandles = await fetchHistoricalKlines({
    days: startDate ? undefined : fetchDays,
    startDate: actualStartDate,
    endDate,
    interval: "15m"
  });
  console.log(`  Total velas descargadas: ${allCandles.length}`);

  if (allCandles.length < lookback + 10) {
    throw new Error(`Datos insuficientes: ${allCandles.length} velas (necesito al menos ${lookback + 10})`);
  }

  // Determinar rango de evaluacion (excluir lookback)
  const evalStartMs = startDate
    ? new Date(startDate).getTime()
    : allCandles[0].openTime + lookback * 15 * 60 * 1000;
  const evalStartIdx = allCandles.findIndex(c => c.openTime >= evalStartMs);

  console.log(`  Rango de evaluacion: vela ${evalStartIdx} a ${allCandles.length - 1}`);
  console.log(`  Periodo: ${new Date(allCandles[evalStartIdx].openTime).toISOString()} -> ${new Date(allCandles[allCandles.length - 1].openTime).toISOString()}`);

  // 2. Iterar por cada vela y ejecutar la estrategia
  const trades = [];
  const noTrades = [];
  let totalCandles = 0;

  for (let i = evalStartIdx; i < allCandles.length; i++) {
    totalCandles++;
    const targetCandle = allCandles[i];

    // Indicadores calculados con velas ANTERIORES (sin incluir la que predecimos)
    const historicalCandles = allCandles.slice(Math.max(0, i - lookback), i);
    if (historicalCandles.length < 40) continue; // No suficiente historia

    const indicators = computeIndicators(historicalCandles);

    // Scoring direccional
    const scoring = scoreDirection({
      regime: indicators.regimeInfo.regime,
      price: indicators.lastClose,
      vwap: indicators.vwapNow,
      vwapSlope: indicators.vwapSlope,
      rsi: indicators.rsiNow,
      rsiSlope: indicators.rsiSlope,
      macd: indicators.macd,
      heikenColor: indicators.consec.color,
      heikenCount: indicators.consec.count,
      failedVwapReclaim: false,
      divergence: indicators.divergence,
      volumeSpike: indicators.volSpike,
      volumePressure: indicators.volPressure,
      polymarketBook: { isExtreme: false, contrarianSide: null, confidence: 0 }
    });

    // Binary-option probability from spot vs priceToBeat
    const priceToBeat = historicalCandles[historicalCandles.length - 1].close;
    const spot = targetCandle.open;
    const optionProb = binaryOptionPrice({
      spot,
      priceToBeat,
      sigma: indicators.sigma,
      remainingMinutes: simulatedTimeLeft,
      barMinutes: 15
    });

    // Blend option model with TA scoring (60% option / 40% TA)
    const blended = blendProbabilities(optionProb.probUp, scoring.rawUp, 0.6);

    // Edge simulado (mercado neutral 50/50)
    const edge = computeEdge({
      modelUp: blended.adjustedUp,
      modelDown: blended.adjustedDown,
      marketYes: 0.50,
      marketNo: 0.50
    });

    // Uncertainty estimation
    const scoringInputs = {
      regime: indicators.regimeInfo.regime,
      price: indicators.lastClose,
      vwap: indicators.vwapNow,
      vwapSlope: indicators.vwapSlope,
      rsi: indicators.rsiNow,
      rsiSlope: indicators.rsiSlope,
      macd: indicators.macd,
      heikenColor: indicators.consec.color,
      heikenCount: indicators.consec.count,
      failedVwapReclaim: false,
      divergence: indicators.divergence,
      volumeSpike: indicators.volSpike,
      volumePressure: indicators.volPressure,
      polymarketBook: { isExtreme: false, contrarianSide: null, confidence: 0 }
    };
    const uncertainty = estimateUncertainty(scoringInputs, 20);

    // Decision
    const rec = decide({
      remainingMinutes: simulatedTimeLeft,
      edgeUp: edge.edgeUp,
      edgeDown: edge.edgeDown,
      modelUp: blended.adjustedUp,
      modelDown: blended.adjustedDown,
      regime: indicators.regimeInfo.regime,
      signals: scoring.signals,
      uncertainty
    });

    // Resultado real de la vela
    const actualOutcome = targetCandle.close > targetCandle.open ? "UP" : "DOWN";

    const result = {
      time: new Date(targetCandle.openTime).toISOString(),
      open: targetCandle.open,
      close: targetCandle.close,
      actualOutcome,
      regime: indicators.regimeInfo.regime,
      modelUp: blended.adjustedUp,
      modelDown: blended.adjustedDown,
      optionProbUp: optionProb.probUp,
      sigma: indicators.sigma,
      edgeUp: edge.edgeUp,
      edgeDown: edge.edgeDown,
      action: rec.action,
      side: rec.side,
      phase: rec.phase,
      strength: rec.strength,
      reason: rec.reason,
      agreement: scoring.signals.agreement,
      divergenceSignal: scoring.signals.divergence,
      correct: rec.action === "ENTER" ? rec.side === actualOutcome : null
    };

    if (rec.action === "ENTER") {
      trades.push(result);
    } else {
      noTrades.push(result);
    }
  }

  // 3. Calcular metricas
  const metrics = computeBacktestMetrics(trades, totalCandles);

  return {
    config: { days, startDate, endDate, simulatedTimeLeft, lookback },
    period: {
      start: new Date(allCandles[evalStartIdx].openTime).toISOString(),
      end: new Date(allCandles[allCandles.length - 1].openTime).toISOString(),
      totalCandles
    },
    trades,
    noTrades,
    metrics
  };
}

// ==================== METRICS ====================

function computeBacktestMetrics(trades, totalCandles) {
  if (trades.length === 0) {
    return {
      totalCandles,
      totalTrades: 0,
      tradeRate: 0,
      accuracy: null,
      wins: 0,
      losses: 0
    };
  }

  const wins = trades.filter(t => t.correct === true).length;
  const losses = trades.filter(t => t.correct === false).length;
  const accuracy = wins / trades.length;

  // Por fuerza
  const byStrength = {};
  for (const s of ["STRONG", "GOOD", "OPTIONAL"]) {
    const subset = trades.filter(t => t.strength === s);
    const w = subset.filter(t => t.correct).length;
    byStrength[s] = { total: subset.length, wins: w, accuracy: subset.length > 0 ? w / subset.length : null };
  }

  // Por direccion
  const upTrades = trades.filter(t => t.side === "UP");
  const downTrades = trades.filter(t => t.side === "DOWN");
  const byDirection = {
    UP: { total: upTrades.length, wins: upTrades.filter(t => t.correct).length, accuracy: upTrades.length > 0 ? upTrades.filter(t => t.correct).length / upTrades.length : null },
    DOWN: { total: downTrades.length, wins: downTrades.filter(t => t.correct).length, accuracy: downTrades.length > 0 ? downTrades.filter(t => t.correct).length / downTrades.length : null }
  };

  // Por regimen
  const byRegime = {};
  for (const r of ["TREND_UP", "TREND_DOWN", "RANGE", "CHOP"]) {
    const subset = trades.filter(t => t.regime === r);
    const w = subset.filter(t => t.correct).length;
    byRegime[r] = { total: subset.length, wins: w, accuracy: subset.length > 0 ? w / subset.length : null };
  }

  // Por hora
  const byHour = {};
  for (const t of trades) {
    const h = new Date(t.time).getUTCHours();
    if (!byHour[h]) byHour[h] = { total: 0, wins: 0 };
    byHour[h].total++;
    if (t.correct) byHour[h].wins++;
  }
  for (const h in byHour) {
    byHour[h].accuracy = byHour[h].wins / byHour[h].total;
  }

  // Por dia de semana
  const dayNames = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
  const byDayOfWeek = {};
  for (const t of trades) {
    const d = dayNames[new Date(t.time).getUTCDay()];
    if (!byDayOfWeek[d]) byDayOfWeek[d] = { total: 0, wins: 0 };
    byDayOfWeek[d].total++;
    if (t.correct) byDayOfWeek[d].wins++;
  }
  for (const d in byDayOfWeek) {
    byDayOfWeek[d].accuracy = byDayOfWeek[d].wins / byDayOfWeek[d].total;
  }

  // Rachas
  let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.correct) { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
    else { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
  }

  // Distribucion de regimenes (no-trade incluidos)
  const regimeDist = {};
  // Trades + noTrades serían todos, pero no tenemos noTrades aquí.
  // Solo reportamos sobre los trades activos.

  return {
    totalCandles,
    totalTrades: trades.length,
    tradeRate: (trades.length / totalCandles * 100),
    accuracy,
    wins,
    losses,
    byStrength,
    byDirection,
    byRegime,
    byHour,
    byDayOfWeek,
    maxWinStreak,
    maxLossStreak
  };
}

// ==================== REPORT ====================

export function printBacktestReport(results) {
  const { config, period, trades, metrics } = results;

  console.log("=".repeat(80));
  console.log("BACKTEST REAL - Estrategia sobre datos historicos de Binance");
  console.log("=".repeat(80));

  console.log(`\n[CONFIG]`);
  console.log(`  Periodo: ${period.start.split("T")[0]} -> ${period.end.split("T")[0]}`);
  console.log(`  Velas totales: ${metrics.totalCandles}`);
  console.log(`  Tiempo simulado: ${config.simulatedTimeLeft} min restantes (${config.simulatedTimeLeft > 10 ? "EARLY" : config.simulatedTimeLeft > 5 ? "MID" : "LATE"})`);
  console.log(`  Mercado simulado: 50/50 (sin datos Polymarket)`);

  console.log(`\n[OPERACIONES]`);
  console.log(`  Total trades: ${metrics.totalTrades} de ${metrics.totalCandles} velas (${metrics.tradeRate.toFixed(1)}% operado)`);

  if (metrics.totalTrades === 0) {
    console.log("\n  Sin operaciones generadas. Los filtros son demasiado estrictos");
    console.log("  o los indicadores no generan suficiente conviccion con mercado 50/50.\n");
    return;
  }

  console.log(`  Aciertos: ${metrics.wins} | Fallos: ${metrics.losses}`);
  console.log(`\n>>> PRECISION GLOBAL: ${metrics.wins}/${metrics.totalTrades} = ${(metrics.accuracy * 100).toFixed(2)}% <<<`);

  // Por fuerza
  console.log(`\n[POR FUERZA]`);
  for (const s of ["STRONG", "GOOD", "OPTIONAL"]) {
    const d = metrics.byStrength[s];
    if (d.total > 0) {
      console.log(`  ${s}: ${d.wins}/${d.total} = ${(d.accuracy * 100).toFixed(1)}%`);
    }
  }

  // Por direccion
  console.log(`\n[POR DIRECCION]`);
  for (const dir of ["UP", "DOWN"]) {
    const d = metrics.byDirection[dir];
    if (d.total > 0) {
      console.log(`  ${dir}: ${d.wins}/${d.total} = ${(d.accuracy * 100).toFixed(1)}%`);
    }
  }

  // Por regimen
  console.log(`\n[POR REGIMEN]`);
  for (const r of ["TREND_UP", "TREND_DOWN", "RANGE", "CHOP"]) {
    const d = metrics.byRegime[r];
    if (d && d.total > 0) {
      console.log(`  ${r}: ${d.wins}/${d.total} = ${(d.accuracy * 100).toFixed(1)}%`);
    }
  }

  // Por hora
  console.log(`\n[POR HORA (UTC)]`);
  const hours = Object.keys(metrics.byHour).map(Number).sort((a, b) => a - b);
  for (const h of hours) {
    const d = metrics.byHour[h];
    const bar = "#".repeat(Math.round(d.accuracy * 20));
    console.log(`  ${String(h).padStart(2, "0")}:00 : ${d.wins}/${d.total} (${(d.accuracy * 100).toFixed(1)}%) ${bar}`);
  }

  // Por dia
  console.log(`\n[POR DIA DE SEMANA]`);
  for (const d of ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]) {
    const data = metrics.byDayOfWeek[d];
    if (data && data.total > 0) {
      console.log(`  ${d}: ${data.wins}/${data.total} = ${(data.accuracy * 100).toFixed(1)}%`);
    }
  }

  // Rachas
  console.log(`\n[RACHAS]`);
  console.log(`  Mejor racha ganadora: ${metrics.maxWinStreak}`);
  console.log(`  Peor racha perdedora: ${metrics.maxLossStreak}`);

  // Ultimas 20 operaciones
  console.log(`\n[ULTIMAS 20 OPERACIONES]`);
  console.log(`${"Fecha".padEnd(12)}${"Hora".padEnd(7)}| ${"Voto".padEnd(6)} | ${"Real".padEnd(6)} | ${"Open".padStart(12)} | ${"Close".padStart(12)} | ${"Regimen".padEnd(12)} | OK?`);
  console.log("-".repeat(85));
  const lastTrades = trades.slice(-20);
  for (const t of lastTrades) {
    const dt = new Date(t.time);
    const date = `${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    const time = `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`;
    const icon = t.correct ? "[OK]" : "[X]";
    console.log(`${date.padEnd(12)}${time.padEnd(7)}| ${t.side.padEnd(6)} | ${t.actualOutcome.padEnd(6)} | ${t.open.toFixed(2).padStart(12)} | ${t.close.toFixed(2).padStart(12)} | ${t.regime.padEnd(12)} | ${icon}`);
  }

  // Resumen final
  console.log("\n" + "=".repeat(80));
  if (metrics.accuracy >= 0.60) {
    console.log("[VERDE] SISTEMA RENTABLE (>= 60%)");
  } else if (metrics.accuracy >= 0.55) {
    console.log("[VERDE-AMARILLO] SISTEMA CON EDGE (>= 55%)");
  } else if (metrics.accuracy >= 0.50) {
    console.log("[AMARILLO] SISTEMA MARGINAL (>= 50%)");
  } else {
    console.log("[ROJO] SISTEMA NO RENTABLE (< 50%)");
  }
  console.log("=".repeat(80));
}
