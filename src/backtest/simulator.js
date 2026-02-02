import {
  getSnapshotsByMarket,
  getDistinctMarkets,
  getOutcome,
  insertSimulatedTrade,
  resolveSimulatedTrade,
  getAllTrades,
  getUnresolvedTrades
} from "./dataStore.js";
import { computeAllMetrics } from "./metrics.js";

/**
 * Simulador de backtesting.
 * Permite probar estrategias con datos históricos.
 */

/**
 * Configuración por defecto para el simulador.
 */
const DEFAULT_CONFIG = {
  // Tamaño de posición
  positionSize: 10,  // $10 por trade
  
  // Filtros de entrada
  minEdge: 0.05,           // Edge mínimo para entrar
  minModelProb: 0.55,      // Probabilidad mínima del modelo
  
  // Filtros por fase
  allowedPhases: ["EARLY", "MID", "LATE"],
  
  // Filtros por strength
  allowedStrengths: ["STRONG", "GOOD", "OPTIONAL"],
  
  // Solo una entrada por mercado
  oneEntryPerMarket: true,
  
  // Preferir señales más fuertes
  preferStrongerSignals: true,
  
  // Tiempo mínimo restante para entrar (minutos)
  minTimeLeft: 2,
  
  // Tiempo máximo restante para entrar (evitar entrar muy temprano)
  maxTimeLeft: 14,
  
  // Slippage simulado (en centavos, afecta al precio de entrada)
  slippage: 0.5,  // 0.5 centavos
  
  // Comisión (porcentaje del tamaño)
  commissionPct: 0.001  // 0.1%
};

/**
 * Simula trades para un mercado específico.
 */
export function simulateMarket(marketSlug, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const snapshots = getSnapshotsByMarket(marketSlug);
  const outcome = getOutcome(marketSlug);

  if (!snapshots || snapshots.length === 0) {
    return { marketSlug, trades: [], error: "no_snapshots" };
  }

  if (!outcome) {
    return { marketSlug, trades: [], error: "no_outcome" };
  }

  const trades = [];
  let hasEntered = false;

  // Ordenar por timestamp
  const sorted = [...snapshots].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const snap of sorted) {
    // Si ya entramos y solo permitimos una entrada por mercado, saltar
    if (cfg.oneEntryPerMarket && hasEntered) continue;

    // Verificar si hay señal de entrada
    if (!snap.signal || snap.signal === "NO_TRADE") continue;

    // Filtrar por fase
    if (!cfg.allowedPhases.includes(snap.phase)) continue;

    // Filtrar por strength
    if (snap.strength && !cfg.allowedStrengths.includes(snap.strength)) continue;

    // Filtrar por tiempo restante
    if (snap.time_left_min < cfg.minTimeLeft || snap.time_left_min > cfg.maxTimeLeft) continue;

    // Determinar lado
    const side = snap.signal === "BUY_UP" ? "UP" : "DOWN";
    const entryPrice = side === "UP" ? snap.poly_up_price : snap.poly_down_price;
    const modelProb = side === "UP" ? snap.model_up : snap.model_down;
    const edge = side === "UP" ? snap.edge_up : snap.edge_down;

    // Validar datos
    if (entryPrice === null || entryPrice === undefined) continue;
    if (modelProb === null || modelProb < cfg.minModelProb) continue;
    if (edge === null || edge < cfg.minEdge) continue;

    // Aplicar slippage al precio de entrada
    const adjustedEntryPrice = entryPrice + cfg.slippage;

    // Calcular resultado
    const won = outcome.outcome === side;
    const exitPrice = won ? 100 : 0;  // Polymarket paga 100 si ganas, 0 si pierdes
    
    // PnL = (exit - entry) * contracts - comisión
    // contracts = positionSize / entryPrice
    const contracts = cfg.positionSize / adjustedEntryPrice;
    const grossPnl = (exitPrice - adjustedEntryPrice) * contracts / 100;  // Dividir por 100 porque precios son en centavos
    const commission = cfg.positionSize * cfg.commissionPct;
    const netPnl = grossPnl - commission;
    const pnlPct = netPnl / cfg.positionSize;

    const trade = {
      market_slug: marketSlug,
      entry_timestamp: snap.timestamp,
      entry_price: adjustedEntryPrice,
      side,
      size: cfg.positionSize,
      model_prob: modelProb,
      edge,
      phase: snap.phase,
      strength: snap.strength,
      exit_price: exitPrice,
      outcome: won ? "WIN" : "LOSS",
      pnl: netPnl,
      pnl_pct: pnlPct,
      market_outcome: outcome.outcome,
      time_left_at_entry: snap.time_left_min,
      regime: snap.regime
    };

    trades.push(trade);
    hasEntered = true;

    // Si preferimos señales más fuertes, seguimos buscando por si hay mejor
    if (!cfg.preferStrongerSignals) break;
  }

  // Si preferimos señales más fuertes, quedarnos con la de mayor edge
  if (cfg.preferStrongerSignals && trades.length > 1) {
    trades.sort((a, b) => b.edge - a.edge);
    return { marketSlug, trades: [trades[0]], outcome };
  }

  return { marketSlug, trades, outcome };
}

/**
 * Ejecuta backtest completo sobre todos los mercados con outcome conocido.
 */
export function runBacktest(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const markets = getDistinctMarkets();
  
  const results = {
    config: cfg,
    markets: [],
    allTrades: [],
    summary: null,
    startTime: new Date().toISOString(),
    endTime: null
  };

  for (const market of markets) {
    const outcome = getOutcome(market.market_slug);
    if (!outcome) continue;  // Saltar mercados sin outcome

    const marketResult = simulateMarket(market.market_slug, cfg);
    
    results.markets.push({
      slug: market.market_slug,
      snapshotCount: market.snapshot_count,
      outcome: outcome.outcome,
      trades: marketResult.trades
    });

    results.allTrades.push(...marketResult.trades);
  }

  // Ordenar trades por timestamp
  results.allTrades.sort((a, b) => 
    new Date(a.entry_timestamp).getTime() - new Date(b.entry_timestamp).getTime()
  );

  // Calcular métricas
  results.summary = computeAllMetrics(results.allTrades);
  results.endTime = new Date().toISOString();

  return results;
}

/**
 * Guarda los trades simulados en la base de datos.
 */
export function persistSimulatedTrades(trades) {
  const results = [];
  
  for (const trade of trades) {
    const insertResult = insertSimulatedTrade({
      market_slug: trade.market_slug,
      entry_timestamp: trade.entry_timestamp,
      entry_price: trade.entry_price,
      side: trade.side,
      size: trade.size,
      model_prob: trade.model_prob,
      edge: trade.edge,
      phase: trade.phase,
      strength: trade.strength
    });

    // Si ya tenemos el outcome, resolver inmediatamente
    if (trade.outcome) {
      resolveSimulatedTrade(insertResult.lastInsertRowid, {
        exit_price: trade.exit_price,
        outcome: trade.outcome,
        pnl: trade.pnl,
        pnl_pct: trade.pnl_pct
      });
    }

    results.push({ id: insertResult.lastInsertRowid, ...trade });
  }

  return results;
}

/**
 * Optimiza parámetros probando múltiples configuraciones.
 */
export function optimizeParameters(paramRanges = {}) {
  const defaults = {
    minEdge: [0.03, 0.05, 0.07, 0.10, 0.15],
    minModelProb: [0.50, 0.52, 0.55, 0.58, 0.60],
    minTimeLeft: [1, 2, 3, 5],
    maxTimeLeft: [10, 12, 14, 15],
    allowedPhases: [
      ["EARLY", "MID", "LATE"],
      ["EARLY", "MID"],
      ["MID", "LATE"],
      ["MID"]
    ],
    allowedStrengths: [
      ["STRONG", "GOOD", "OPTIONAL"],
      ["STRONG", "GOOD"],
      ["STRONG"]
    ]
  };

  const ranges = { ...defaults, ...paramRanges };
  const results = [];

  // Generar todas las combinaciones
  for (const minEdge of ranges.minEdge) {
    for (const minModelProb of ranges.minModelProb) {
      for (const minTimeLeft of ranges.minTimeLeft) {
        for (const maxTimeLeft of ranges.maxTimeLeft) {
          if (minTimeLeft >= maxTimeLeft) continue;
          
          for (const allowedPhases of ranges.allowedPhases) {
            for (const allowedStrengths of ranges.allowedStrengths) {
              const config = {
                minEdge,
                minModelProb,
                minTimeLeft,
                maxTimeLeft,
                allowedPhases,
                allowedStrengths
              };

              const backtest = runBacktest(config);
              const s = backtest.summary.summary;

              results.push({
                config,
                trades: s.resolvedTrades,
                winRate: s.winRate,
                totalPnl: s.totalPnl,
                profitFactor: s.profitFactor,
                maxDrawdown: s.maxDrawdown,
                sharpe: s.sharpeRatio,
                expectancy: s.expectancy
              });
            }
          }
        }
      }
    }
  }

  // Ordenar por diferentes criterios
  const byPnl = [...results].sort((a, b) => (b.totalPnl ?? 0) - (a.totalPnl ?? 0));
  const bySharpe = [...results].sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity));
  const byWinRate = [...results].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
  const byExpectancy = [...results].sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));

  return {
    totalCombinations: results.length,
    bestByPnl: byPnl.slice(0, 10),
    bestBySharpe: bySharpe.slice(0, 10),
    bestByWinRate: byWinRate.filter(r => r.trades >= 10).slice(0, 10),
    bestByExpectancy: byExpectancy.filter(r => r.trades >= 10).slice(0, 10),
    allResults: results
  };
}

/**
 * Genera un resumen rápido del backtest.
 */
export function generateBacktestSummary(results) {
  const s = results.summary.summary;
  
  return {
    period: {
      start: results.allTrades[0]?.entry_timestamp ?? null,
      end: results.allTrades[results.allTrades.length - 1]?.entry_timestamp ?? null
    },
    markets: {
      total: results.markets.length,
      withTrades: results.markets.filter(m => m.trades.length > 0).length
    },
    trades: {
      total: s.resolvedTrades,
      wins: s.wins,
      losses: s.losses,
      winRate: s.winRate !== null ? `${(s.winRate * 100).toFixed(1)}%` : "-"
    },
    pnl: {
      total: s.totalPnl !== null ? `$${s.totalPnl.toFixed(2)}` : "-",
      average: s.avgPnl !== null ? `$${s.avgPnl.toFixed(2)}` : "-",
      expectancy: s.expectancy !== null ? `$${s.expectancy.toFixed(2)}` : "-"
    },
    risk: {
      profitFactor: s.profitFactor !== null 
        ? (s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)) 
        : "-",
      maxDrawdown: s.maxDrawdown !== null ? `$${s.maxDrawdown.toFixed(2)}` : "-",
      sharpeRatio: s.sharpeRatio !== null ? s.sharpeRatio.toFixed(2) : "-"
    },
    config: results.config
  };
}

/**
 * Analiza rendimiento por hora del día (UTC).
 */
export function analyzeByHour(trades) {
  const byHour = {};
  
  for (let h = 0; h < 24; h++) {
    byHour[h] = [];
  }

  for (const trade of trades) {
    if (!trade.entry_timestamp) continue;
    const hour = new Date(trade.entry_timestamp).getUTCHours();
    byHour[hour].push(trade);
  }

  const results = {};
  for (const [hour, hourTrades] of Object.entries(byHour)) {
    if (hourTrades.length === 0) {
      results[hour] = { trades: 0, winRate: null, pnl: 0 };
      continue;
    }

    const wins = hourTrades.filter(t => t.outcome === "WIN").length;
    const pnl = hourTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    
    results[hour] = {
      trades: hourTrades.length,
      winRate: wins / hourTrades.length,
      pnl
    };
  }

  return results;
}

/**
 * Analiza rendimiento por día de la semana.
 */
export function analyzeByDayOfWeek(trades) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byDay = {};
  
  for (const day of days) {
    byDay[day] = [];
  }

  for (const trade of trades) {
    if (!trade.entry_timestamp) continue;
    const dayName = days[new Date(trade.entry_timestamp).getUTCDay()];
    byDay[dayName].push(trade);
  }

  const results = {};
  for (const [day, dayTrades] of Object.entries(byDay)) {
    if (dayTrades.length === 0) {
      results[day] = { trades: 0, winRate: null, pnl: 0 };
      continue;
    }

    const wins = dayTrades.filter(t => t.outcome === "WIN").length;
    const pnl = dayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    
    results[day] = {
      trades: dayTrades.length,
      winRate: wins / dayTrades.length,
      pnl
    };
  }

  return results;
}
