#!/usr/bin/env node

/**
 * CLI para backtest y análisis de datos.
 * 
 * Uso:
 *   node src/backtest/cli.js stats           # Ver estadísticas de datos recolectados
 *   node src/backtest/cli.js markets         # Listar mercados con datos
 *   node src/backtest/cli.js backtest        # Ejecutar backtest con config por defecto
 *   node src/backtest/cli.js optimize        # Optimizar parámetros
 *   node src/backtest/cli.js export          # Exportar datos a CSV
 */

import {
  getStats,
  getDistinctMarkets,
  getAllOutcomes,
  getSnapshotsByMarket,
  getAllTrades,
  closeDb
} from "./dataStore.js";
import {
  runBacktest,
  optimizeParameters,
  generateBacktestSummary,
  analyzeByHour,
  analyzeByDayOfWeek
} from "./simulator.js";
import { formatMetricsReport } from "./metrics.js";
import fs from "node:fs";
import path from "node:path";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m"
};

function printHeader(text) {
  console.log(`\n${ANSI.bold}${ANSI.cyan}${text}${ANSI.reset}\n`);
}

function printSubHeader(text) {
  console.log(`${ANSI.yellow}${text}${ANSI.reset}`);
}

function printSuccess(text) {
  console.log(`${ANSI.green}✓ ${text}${ANSI.reset}`);
}

function printError(text) {
  console.log(`${ANSI.red}✗ ${text}${ANSI.reset}`);
}

function printTable(headers, rows) {
  const colWidths = headers.map((h, i) => {
    const maxData = Math.max(...rows.map(r => String(r[i] ?? "").length));
    return Math.max(h.length, maxData);
  });

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ");
  const separator = colWidths.map(w => "-".repeat(w)).join("-+-");

  console.log(headerLine);
  console.log(separator);
  for (const row of rows) {
    const line = row.map((cell, i) => String(cell ?? "-").padEnd(colWidths[i])).join(" | ");
    console.log(line);
  }
}

// ==================== COMMANDS ====================

function cmdStats() {
  printHeader("📊 ESTADÍSTICAS DE DATOS");

  try {
    const stats = getStats();

    console.log(`Snapshots recolectados:    ${stats.snapshotCount.toLocaleString()}`);
    console.log(`Mercados únicos:           ${stats.marketCount}`);
    console.log(`Outcomes registrados:      ${stats.outcomeCount}`);
    console.log(`Trades simulados:          ${stats.tradeCount}`);
    console.log(`  - Resueltos:             ${stats.resolvedTradeCount}`);
    console.log();
    console.log(`Primer snapshot:           ${stats.firstSnapshot ?? "-"}`);
    console.log(`Último snapshot:           ${stats.lastSnapshot ?? "-"}`);

    if (stats.snapshotCount === 0) {
      console.log();
      printError("No hay datos. Ejecuta el asistente principal para recolectar datos.");
      console.log(`${ANSI.dim}  npm start${ANSI.reset}`);
    }
  } catch (err) {
    printError(`Error: ${err.message}`);
  }
}

function cmdMarkets() {
  printHeader("📋 MERCADOS CON DATOS");

  try {
    const markets = getDistinctMarkets();
    const outcomes = getAllOutcomes();
    const outcomeMap = new Map(outcomes.map(o => [o.market_slug, o]));

    if (markets.length === 0) {
      printError("No hay mercados con datos.");
      return;
    }

    const rows = markets.map(m => {
      const outcome = outcomeMap.get(m.market_slug);
      const outcomeStr = outcome?.outcome ?? "PENDING";
      const outcomeColor = outcome?.outcome === "UP" 
        ? ANSI.green 
        : outcome?.outcome === "DOWN" 
          ? ANSI.red 
          : ANSI.dim;

      return [
        m.market_slug?.slice(0, 40) ?? "-",
        m.snapshot_count,
        m.first_seen?.split("T")[0] ?? "-",
        `${outcomeColor}${outcomeStr}${ANSI.reset}`
      ];
    });

    printTable(["Market Slug", "Snapshots", "Date", "Outcome"], rows);
    console.log();
    console.log(`Total: ${markets.length} mercados`);
  } catch (err) {
    printError(`Error: ${err.message}`);
  }
}

async function cmdBacktest(args) {
  printHeader("🔬 BACKTEST");

  try {
    // Parsear argumentos opcionales
    const config = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.replace("--", "");
      const value = args[i + 1];
      if (key && value) {
        if (key === "minEdge" || key === "minModelProb" || key === "minTimeLeft" || key === "maxTimeLeft") {
          config[key] = parseFloat(value);
        } else if (key === "positionSize") {
          config[key] = parseFloat(value);
        } else if (key === "phases") {
          config.allowedPhases = value.split(",");
        } else if (key === "strengths") {
          config.allowedStrengths = value.split(",");
        }
      }
    }

    console.log("Ejecutando backtest...");
    if (Object.keys(config).length > 0) {
      console.log("Configuración personalizada:", config);
    }
    console.log();

    const results = await runBacktest(config);

    if (results.allTrades.length === 0) {
      printError("No se generaron trades. Verifica que tienes datos y outcomes.");
      console.log(`${ANSI.dim}  - Mercados con datos: ${results.markets.length}${ANSI.reset}`);
      return;
    }

    // Mostrar reporte
    console.log(formatMetricsReport(results.summary));

    // Análisis adicional
    printSubHeader("\n📅 Rendimiento por día de la semana:");
    const byDay = analyzeByDayOfWeek(results.allTrades);
    const dayRows = Object.entries(byDay)
      .filter(([_, d]) => d.trades > 0)
      .map(([day, d]) => [
        day,
        d.trades,
        d.winRate !== null ? `${(d.winRate * 100).toFixed(1)}%` : "-",
        `$${d.pnl.toFixed(2)}`
      ]);
    if (dayRows.length > 0) {
      printTable(["Day", "Trades", "Win Rate", "P&L"], dayRows);
    }

    printSubHeader("\n⏰ Rendimiento por hora (UTC):");
    const byHour = analyzeByHour(results.allTrades);
    const hourRows = Object.entries(byHour)
      .filter(([_, h]) => h.trades > 0)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([hour, h]) => [
        `${hour.padStart(2, "0")}:00`,
        h.trades,
        h.winRate !== null ? `${(h.winRate * 100).toFixed(1)}%` : "-",
        `$${h.pnl.toFixed(2)}`
      ]);
    if (hourRows.length > 0) {
      printTable(["Hour", "Trades", "Win Rate", "P&L"], hourRows);
    }

    // Resumen
    const summary = generateBacktestSummary(results);
    console.log();
    printSuccess(`Backtest completado: ${summary.trades.total} trades, Win Rate: ${summary.trades.winRate}, P&L: ${summary.pnl.total}`);

  } catch (err) {
    printError(`Error: ${err.message}`);
    console.error(err);
  }
}

function cmdOptimize() {
  printHeader("🎯 OPTIMIZACIÓN DE PARÁMETROS");

  try {
    console.log("Ejecutando optimización (esto puede tardar)...\n");

    const optimization = optimizeParameters();

    console.log(`Total combinaciones probadas: ${optimization.totalCombinations}\n`);

    printSubHeader("Top 5 por P&L Total:");
    const pnlRows = optimization.bestByPnl.slice(0, 5).map((r, i) => [
      i + 1,
      r.trades,
      r.winRate !== null ? `${(r.winRate * 100).toFixed(1)}%` : "-",
      `$${r.totalPnl?.toFixed(2) ?? "-"}`,
      `Edge>=${r.config.minEdge}`,
      `Prob>=${r.config.minModelProb}`,
      `Time:${r.config.minTimeLeft}-${r.config.maxTimeLeft}m`
    ]);
    if (pnlRows.length > 0) {
      printTable(["#", "Trades", "Win%", "P&L", "MinEdge", "MinProb", "Time"], pnlRows);
    }

    console.log();
    printSubHeader("Top 5 por Sharpe Ratio:");
    const sharpeRows = optimization.bestBySharpe.slice(0, 5).map((r, i) => [
      i + 1,
      r.trades,
      r.winRate !== null ? `${(r.winRate * 100).toFixed(1)}%` : "-",
      r.sharpe?.toFixed(2) ?? "-",
      `Edge>=${r.config.minEdge}`,
      `Prob>=${r.config.minModelProb}`,
      r.config.allowedPhases.join(",")
    ]);
    if (sharpeRows.length > 0) {
      printTable(["#", "Trades", "Win%", "Sharpe", "MinEdge", "MinProb", "Phases"], sharpeRows);
    }

    console.log();
    printSubHeader("Top 5 por Win Rate (min 10 trades):");
    const wrRows = optimization.bestByWinRate.slice(0, 5).map((r, i) => [
      i + 1,
      r.trades,
      r.winRate !== null ? `${(r.winRate * 100).toFixed(1)}%` : "-",
      `$${r.totalPnl?.toFixed(2) ?? "-"}`,
      `Edge>=${r.config.minEdge}`,
      r.config.allowedStrengths.join(",")
    ]);
    if (wrRows.length > 0) {
      printTable(["#", "Trades", "Win%", "P&L", "MinEdge", "Strengths"], wrRows);
    }

    // Exportar resultados completos
    const exportPath = "./data/optimization_results.json";
    fs.mkdirSync("./data", { recursive: true });
    fs.writeFileSync(exportPath, JSON.stringify(optimization, null, 2));
    console.log();
    printSuccess(`Resultados completos exportados a: ${exportPath}`);

  } catch (err) {
    printError(`Error: ${err.message}`);
    console.error(err);
  }
}

function cmdExport() {
  printHeader("📤 EXPORTAR DATOS");

  try {
    const exportDir = "./data/exports";
    fs.mkdirSync(exportDir, { recursive: true });

    // Exportar mercados
    const markets = getDistinctMarkets();
    const marketsPath = path.join(exportDir, "markets.csv");
    const marketsHeader = "market_slug,snapshot_count,first_seen,last_seen\n";
    const marketsData = markets.map(m => 
      `"${m.market_slug}",${m.snapshot_count},"${m.first_seen}","${m.last_seen}"`
    ).join("\n");
    fs.writeFileSync(marketsPath, marketsHeader + marketsData);
    printSuccess(`Mercados exportados: ${marketsPath}`);

    // Exportar outcomes
    const outcomes = getAllOutcomes();
    const outcomesPath = path.join(exportDir, "outcomes.csv");
    const outcomesHeader = "market_slug,market_end_time,price_to_beat,final_price,outcome,resolved_at\n";
    const outcomesData = outcomes.map(o => 
      `"${o.market_slug}","${o.market_end_time}",${o.price_to_beat},${o.final_price},"${o.outcome}","${o.resolved_at}"`
    ).join("\n");
    fs.writeFileSync(outcomesPath, outcomesHeader + outcomesData);
    printSuccess(`Outcomes exportados: ${outcomesPath}`);

    // Exportar trades
    const trades = getAllTrades({ resolved: true });
    const tradesPath = path.join(exportDir, "trades.csv");
    const tradesHeader = "id,market_slug,entry_timestamp,side,entry_price,size,model_prob,edge,phase,strength,outcome,pnl,pnl_pct\n";
    const tradesData = trades.map(t => 
      `${t.id},"${t.market_slug}","${t.entry_timestamp}","${t.side}",${t.entry_price},${t.size},${t.model_prob},${t.edge},"${t.phase}","${t.strength ?? ""}","${t.outcome}",${t.pnl},${t.pnl_pct}`
    ).join("\n");
    fs.writeFileSync(tradesPath, tradesHeader + tradesData);
    printSuccess(`Trades exportados: ${tradesPath}`);

    // Exportar snapshots de un mercado específico (último)
    if (markets.length > 0) {
      const latestMarket = markets[0];
      const snapshots = getSnapshotsByMarket(latestMarket.market_slug);
      const snapshotsPath = path.join(exportDir, `snapshots_${latestMarket.market_slug.slice(0, 30)}.csv`);
      
      if (snapshots.length > 0) {
        const snapshotKeys = Object.keys(snapshots[0]);
        const snapshotsHeader = snapshotKeys.join(",") + "\n";
        const snapshotsData = snapshots.map(s => 
          snapshotKeys.map(k => {
            const v = s[k];
            if (v === null || v === undefined) return "";
            if (typeof v === "string") return `"${v}"`;
            return v;
          }).join(",")
        ).join("\n");
        fs.writeFileSync(snapshotsPath, snapshotsHeader + snapshotsData);
        printSuccess(`Snapshots del último mercado: ${snapshotsPath}`);
      }
    }

    console.log();
    console.log(`Archivos exportados en: ${exportDir}`);

  } catch (err) {
    printError(`Error: ${err.message}`);
    console.error(err);
  }
}

function cmdHelp() {
  console.log(`
${ANSI.bold}Polymarket BTC 15m Backtest CLI${ANSI.reset}

${ANSI.cyan}Uso:${ANSI.reset}
  node src/backtest/cli.js <comando> [opciones]

${ANSI.cyan}Comandos:${ANSI.reset}
  stats           Ver estadísticas de datos recolectados
  markets         Listar mercados con datos
  backtest        Ejecutar backtest con configuración por defecto
  optimize        Optimizar parámetros (prueba múltiples combinaciones)
  export          Exportar datos a CSV
  help            Mostrar esta ayuda

${ANSI.cyan}Opciones de backtest:${ANSI.reset}
  --minEdge <n>       Edge mínimo para entrar (default: 0.05)
  --minModelProb <n>  Probabilidad mínima del modelo (default: 0.55)
  --minTimeLeft <n>   Minutos mínimos restantes (default: 2)
  --maxTimeLeft <n>   Minutos máximos restantes (default: 14)
  --positionSize <n>  Tamaño de posición en $ (default: 10)
  --phases <list>     Fases permitidas (EARLY,MID,LATE)
  --strengths <list>  Strengths permitidos (STRONG,GOOD,OPTIONAL)

${ANSI.cyan}Ejemplos:${ANSI.reset}
  node src/backtest/cli.js backtest
  node src/backtest/cli.js backtest --minEdge 0.1 --phases MID,LATE
  node src/backtest/cli.js optimize
`);
}

// ==================== MAIN ====================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase() ?? "help";
  const cmdArgs = args.slice(1);

  try {
    switch (command) {
      case "stats":
        cmdStats();
        break;
      case "markets":
        cmdMarkets();
        break;
      case "backtest":
      case "bt":
        await cmdBacktest(cmdArgs);
        break;
      case "optimize":
      case "opt":
        cmdOptimize();
        break;
      case "export":
        cmdExport();
        break;
      case "help":
      case "-h":
      case "--help":
      default:
        cmdHelp();
        break;
    }
  } finally {
    closeDb();
  }
}

main();
