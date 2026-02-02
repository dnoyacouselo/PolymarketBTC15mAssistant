/**
 * Módulo de métricas para evaluar rendimiento de estrategias.
 */

/**
 * Calcula métricas básicas de rendimiento.
 */
export function computeBasicMetrics(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      avgWin: null,
      avgLoss: null,
      profitFactor: null,
      totalPnl: 0,
      avgPnl: null,
      expectancy: null
    };
  }

  const resolved = trades.filter(t => t.pnl !== null && t.pnl !== undefined);
  if (resolved.length === 0) {
    return {
      totalTrades: trades.length,
      resolvedTrades: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      avgWin: null,
      avgLoss: null,
      profitFactor: null,
      totalPnl: 0,
      avgPnl: null,
      expectancy: null
    };
  }

  const wins = resolved.filter(t => t.pnl > 0);
  const losses = resolved.filter(t => t.pnl < 0);
  const breakeven = resolved.filter(t => t.pnl === 0);

  const totalWinPnl = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLossPnl = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0);
  const totalPnl = resolved.reduce((sum, t) => sum + t.pnl, 0);

  const winRate = resolved.length > 0 ? wins.length / resolved.length : null;
  const avgWin = wins.length > 0 ? totalWinPnl / wins.length : null;
  const avgLoss = losses.length > 0 ? totalLossPnl / losses.length : null;
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : (totalWinPnl > 0 ? Infinity : null);
  const avgPnl = resolved.length > 0 ? totalPnl / resolved.length : null;

  // Expectancy = (Win% × Avg Win) - (Loss% × Avg Loss)
  const expectancy = winRate !== null && avgWin !== null && avgLoss !== null
    ? (winRate * avgWin) - ((1 - winRate) * avgLoss)
    : null;

  return {
    totalTrades: trades.length,
    resolvedTrades: resolved.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnl,
    avgPnl,
    expectancy
  };
}

/**
 * Calcula el drawdown máximo.
 */
export function computeMaxDrawdown(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPct: 0, drawdownTrades: 0 };
  }

  const resolved = trades.filter(t => t.pnl !== null && t.pnl !== undefined);
  if (resolved.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPct: 0, drawdownTrades: 0 };
  }

  let peak = 0;
  let cumPnl = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let currentDrawdownStart = 0;
  let maxDrawdownTrades = 0;

  for (let i = 0; i < resolved.length; i++) {
    cumPnl += resolved[i].pnl;
    
    if (cumPnl > peak) {
      peak = cumPnl;
      currentDrawdownStart = i;
    }
    
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownTrades = i - currentDrawdownStart;
      maxDrawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    }
  }

  return { maxDrawdown, maxDrawdownPct, drawdownTrades: maxDrawdownTrades };
}

/**
 * Calcula el Sharpe Ratio (simplificado, asumiendo risk-free = 0).
 */
export function computeSharpeRatio(trades, periodsPerYear = 365 * 24 * 4) {
  // periodsPerYear: asumiendo trades cada 15 min, 4 por hora, 24h, 365 días
  if (!Array.isArray(trades) || trades.length < 2) {
    return null;
  }

  const resolved = trades.filter(t => t.pnl !== null && t.pnl !== undefined);
  if (resolved.length < 2) return null;

  const returns = resolved.map(t => t.pnl_pct ?? (t.pnl / (t.size || 1)));
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return avgReturn > 0 ? Infinity : (avgReturn < 0 ? -Infinity : 0);
  
  // Anualizar
  const annualizedReturn = avgReturn * periodsPerYear;
  const annualizedStdDev = stdDev * Math.sqrt(periodsPerYear);
  
  return annualizedReturn / annualizedStdDev;
}

/**
 * Calcula estadísticas de rachas (streaks).
 */
export function computeStreakStats(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return { 
      maxWinStreak: 0, 
      maxLossStreak: 0, 
      currentStreak: { type: null, count: 0 },
      avgWinStreak: null,
      avgLossStreak: null
    };
  }

  const resolved = trades.filter(t => t.outcome !== null && t.outcome !== undefined);
  if (resolved.length === 0) {
    return { 
      maxWinStreak: 0, 
      maxLossStreak: 0, 
      currentStreak: { type: null, count: 0 },
      avgWinStreak: null,
      avgLossStreak: null
    };
  }

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentType = null;
  let currentCount = 0;
  
  const winStreaks = [];
  const lossStreaks = [];

  for (const trade of resolved) {
    const isWin = trade.outcome === "WIN" || trade.pnl > 0;
    const type = isWin ? "WIN" : "LOSS";

    if (type === currentType) {
      currentCount++;
    } else {
      // Guardar racha anterior
      if (currentType === "WIN" && currentCount > 0) {
        winStreaks.push(currentCount);
        maxWinStreak = Math.max(maxWinStreak, currentCount);
      } else if (currentType === "LOSS" && currentCount > 0) {
        lossStreaks.push(currentCount);
        maxLossStreak = Math.max(maxLossStreak, currentCount);
      }
      
      currentType = type;
      currentCount = 1;
    }
  }

  // Última racha
  if (currentType === "WIN" && currentCount > 0) {
    winStreaks.push(currentCount);
    maxWinStreak = Math.max(maxWinStreak, currentCount);
  } else if (currentType === "LOSS" && currentCount > 0) {
    lossStreaks.push(currentCount);
    maxLossStreak = Math.max(maxLossStreak, currentCount);
  }

  const avgWinStreak = winStreaks.length > 0 
    ? winStreaks.reduce((a, b) => a + b, 0) / winStreaks.length 
    : null;
  const avgLossStreak = lossStreaks.length > 0 
    ? lossStreaks.reduce((a, b) => a + b, 0) / lossStreaks.length 
    : null;

  return {
    maxWinStreak,
    maxLossStreak,
    currentStreak: { type: currentType, count: currentCount },
    avgWinStreak,
    avgLossStreak
  };
}

/**
 * Agrupa métricas por diferentes dimensiones.
 */
export function computeMetricsByGroup(trades, groupByField) {
  if (!Array.isArray(trades) || trades.length === 0) return {};

  const groups = {};
  
  for (const trade of trades) {
    const key = trade[groupByField] ?? "UNKNOWN";
    if (!groups[key]) groups[key] = [];
    groups[key].push(trade);
  }

  const result = {};
  for (const [key, groupTrades] of Object.entries(groups)) {
    result[key] = {
      ...computeBasicMetrics(groupTrades),
      ...computeMaxDrawdown(groupTrades)
    };
  }

  return result;
}

/**
 * Calcula todas las métricas de forma comprehensiva.
 */
export function computeAllMetrics(trades) {
  const basic = computeBasicMetrics(trades);
  const drawdown = computeMaxDrawdown(trades);
  const sharpe = computeSharpeRatio(trades);
  const streaks = computeStreakStats(trades);
  const byPhase = computeMetricsByGroup(trades, "phase");
  const bySide = computeMetricsByGroup(trades, "side");
  const byStrength = computeMetricsByGroup(trades, "strength");

  return {
    summary: {
      ...basic,
      ...drawdown,
      sharpeRatio: sharpe,
      ...streaks
    },
    byPhase,
    bySide,
    byStrength
  };
}

/**
 * Formatea métricas para mostrar en consola.
 */
export function formatMetricsReport(metrics) {
  const s = metrics.summary;
  
  const lines = [
    "═══════════════════════════════════════════════════════════",
    "                    BACKTEST REPORT                        ",
    "═══════════════════════════════════════════════════════════",
    "",
    `Total Trades:       ${s.totalTrades}`,
    `Resolved Trades:    ${s.resolvedTrades}`,
    `Wins:               ${s.wins} (${s.winRate !== null ? (s.winRate * 100).toFixed(1) : "-"}%)`,
    `Losses:             ${s.losses}`,
    "",
    "───────────────────────────────────────────────────────────",
    "                    P&L METRICS                            ",
    "───────────────────────────────────────────────────────────",
    "",
    `Total P&L:          $${s.totalPnl?.toFixed(2) ?? "-"}`,
    `Avg P&L per Trade:  $${s.avgPnl?.toFixed(2) ?? "-"}`,
    `Avg Win:            $${s.avgWin?.toFixed(2) ?? "-"}`,
    `Avg Loss:           $${s.avgLoss?.toFixed(2) ?? "-"}`,
    `Profit Factor:      ${s.profitFactor !== null ? (s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)) : "-"}`,
    `Expectancy:         $${s.expectancy?.toFixed(2) ?? "-"} per trade`,
    "",
    "───────────────────────────────────────────────────────────",
    "                    RISK METRICS                           ",
    "───────────────────────────────────────────────────────────",
    "",
    `Max Drawdown:       $${s.maxDrawdown?.toFixed(2) ?? "-"} (${s.maxDrawdownPct?.toFixed(1) ?? "-"}%)`,
    `Sharpe Ratio:       ${s.sharpeRatio?.toFixed(2) ?? "-"}`,
    `Max Win Streak:     ${s.maxWinStreak}`,
    `Max Loss Streak:    ${s.maxLossStreak}`,
    "",
  ];

  // Métricas por fase
  if (Object.keys(metrics.byPhase).length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("                    BY PHASE                               ");
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("");
    for (const [phase, m] of Object.entries(metrics.byPhase)) {
      const wr = m.winRate !== null ? (m.winRate * 100).toFixed(1) : "-";
      lines.push(`  ${phase.padEnd(8)} | Trades: ${String(m.resolvedTrades).padStart(4)} | Win Rate: ${wr.padStart(5)}% | P&L: $${m.totalPnl?.toFixed(2) ?? "-"}`);
    }
    lines.push("");
  }

  // Métricas por lado
  if (Object.keys(metrics.bySide).length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("                    BY SIDE                                ");
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("");
    for (const [side, m] of Object.entries(metrics.bySide)) {
      const wr = m.winRate !== null ? (m.winRate * 100).toFixed(1) : "-";
      lines.push(`  ${side.padEnd(8)} | Trades: ${String(m.resolvedTrades).padStart(4)} | Win Rate: ${wr.padStart(5)}% | P&L: $${m.totalPnl?.toFixed(2) ?? "-"}`);
    }
    lines.push("");
  }

  // Métricas por strength
  if (Object.keys(metrics.byStrength).length > 0) {
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("                    BY STRENGTH                            ");
    lines.push("───────────────────────────────────────────────────────────");
    lines.push("");
    for (const [strength, m] of Object.entries(metrics.byStrength)) {
      const wr = m.winRate !== null ? (m.winRate * 100).toFixed(1) : "-";
      lines.push(`  ${(strength || "N/A").padEnd(8)} | Trades: ${String(m.resolvedTrades).padStart(4)} | Win Rate: ${wr.padStart(5)}% | P&L: $${m.totalPnl?.toFixed(2) ?? "-"}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}
