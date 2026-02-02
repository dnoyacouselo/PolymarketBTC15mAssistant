/**
 * Módulo de backtesting - punto de entrada.
 * 
 * Exporta todas las funcionalidades de backtesting.
 */

export {
  getDb,
  insertSnapshot,
  getSnapshotsByMarket,
  getSnapshotsInRange,
  getDistinctMarkets,
  getSignalSnapshots,
  insertOutcome,
  getOutcome,
  getAllOutcomes,
  getPendingOutcomes,
  insertSimulatedTrade,
  resolveSimulatedTrade,
  getUnresolvedTrades,
  getAllTrades,
  getTradesByDateRange,
  getStats,
  closeDb
} from "./dataStore.js";

export {
  collectSnapshot,
  checkPendingOutcomes,
  startOutcomeChecker,
  stopOutcomeChecker,
  buildCollectorData
} from "./collector.js";

export {
  computeBasicMetrics,
  computeMaxDrawdown,
  computeSharpeRatio,
  computeStreakStats,
  computeMetricsByGroup,
  computeAllMetrics,
  formatMetricsReport
} from "./metrics.js";

export {
  simulateMarket,
  runBacktest,
  persistSimulatedTrades,
  optimizeParameters,
  generateBacktestSummary,
  analyzeByHour,
  analyzeByDayOfWeek
} from "./simulator.js";
