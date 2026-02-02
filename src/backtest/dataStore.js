import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = "./data";
const DB_PATH = path.join(DATA_DIR, "backtest.db");

let db = null;

export function getDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  initSchema();
  return db;
}

function initSchema() {
  db.exec(`
    -- Snapshots de mercado (cada tick del loop principal)
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      market_slug TEXT,
      market_end_time TEXT,
      
      -- Precios
      chainlink_price REAL,
      binance_price REAL,
      price_to_beat REAL,
      
      -- Polymarket
      poly_up_price REAL,
      poly_down_price REAL,
      poly_liquidity REAL,
      poly_up_bid_liq REAL,
      poly_up_ask_liq REAL,
      poly_down_bid_liq REAL,
      poly_down_ask_liq REAL,
      
      -- Indicadores
      rsi REAL,
      rsi_slope REAL,
      macd_line REAL,
      macd_signal REAL,
      macd_hist REAL,
      macd_hist_delta REAL,
      vwap REAL,
      vwap_slope REAL,
      vwap_dist REAL,
      heiken_color TEXT,
      heiken_count INTEGER,
      delta_1m REAL,
      delta_3m REAL,
      
      -- Régimen y señales
      regime TEXT,
      time_left_min REAL,
      model_up REAL,
      model_down REAL,
      edge_up REAL,
      edge_down REAL,
      signal TEXT,
      phase TEXT,
      strength TEXT,
      
      -- Índices
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_market_slug ON snapshots(market_slug);
    CREATE INDEX IF NOT EXISTS idx_snapshots_signal ON snapshots(signal);

    -- Resultados de mercados (cuando se resuelven)
    CREATE TABLE IF NOT EXISTS market_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_slug TEXT UNIQUE NOT NULL,
      market_end_time TEXT,
      price_to_beat REAL,
      final_price REAL,
      outcome TEXT,  -- 'UP' o 'DOWN'
      resolved_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_outcomes_slug ON market_outcomes(market_slug);
    CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON market_outcomes(outcome);

    -- Trades simulados (para backtesting)
    CREATE TABLE IF NOT EXISTS simulated_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_slug TEXT NOT NULL,
      entry_timestamp TEXT NOT NULL,
      entry_price REAL NOT NULL,
      side TEXT NOT NULL,  -- 'UP' o 'DOWN'
      size REAL NOT NULL,
      model_prob REAL,
      edge REAL,
      phase TEXT,
      strength TEXT,
      
      -- Resultado (se llena después)
      exit_price REAL,
      outcome TEXT,  -- 'WIN' o 'LOSS'
      pnl REAL,
      pnl_pct REAL,
      resolved_at TEXT,
      
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trades_market ON simulated_trades(market_slug);
    CREATE INDEX IF NOT EXISTS idx_trades_outcome ON simulated_trades(outcome);
  `);
}

// ==================== SNAPSHOTS ====================

export function insertSnapshot(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO snapshots (
      timestamp, market_slug, market_end_time,
      chainlink_price, binance_price, price_to_beat,
      poly_up_price, poly_down_price, poly_liquidity,
      poly_up_bid_liq, poly_up_ask_liq, poly_down_bid_liq, poly_down_ask_liq,
      rsi, rsi_slope, macd_line, macd_signal, macd_hist, macd_hist_delta,
      vwap, vwap_slope, vwap_dist, heiken_color, heiken_count,
      delta_1m, delta_3m,
      regime, time_left_min, model_up, model_down, edge_up, edge_down,
      signal, phase, strength
    ) VALUES (
      @timestamp, @market_slug, @market_end_time,
      @chainlink_price, @binance_price, @price_to_beat,
      @poly_up_price, @poly_down_price, @poly_liquidity,
      @poly_up_bid_liq, @poly_up_ask_liq, @poly_down_bid_liq, @poly_down_ask_liq,
      @rsi, @rsi_slope, @macd_line, @macd_signal, @macd_hist, @macd_hist_delta,
      @vwap, @vwap_slope, @vwap_dist, @heiken_color, @heiken_count,
      @delta_1m, @delta_3m,
      @regime, @time_left_min, @model_up, @model_down, @edge_up, @edge_down,
      @signal, @phase, @strength
    )
  `);

  return stmt.run(data);
}

export function getSnapshotsByMarket(marketSlug) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM snapshots 
    WHERE market_slug = ? 
    ORDER BY timestamp ASC
  `).all(marketSlug);
}

export function getSnapshotsInRange(startTime, endTime) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM snapshots 
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(startTime, endTime);
}

export function getDistinctMarkets() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT market_slug, market_end_time, 
           MIN(timestamp) as first_seen,
           MAX(timestamp) as last_seen,
           COUNT(*) as snapshot_count
    FROM snapshots 
    WHERE market_slug IS NOT NULL
    GROUP BY market_slug
    ORDER BY market_end_time DESC
  `).all();
}

export function getSignalSnapshots(options = {}) {
  const db = getDb();
  const { signal, minEdge, phase, limit } = options;

  let query = `SELECT * FROM snapshots WHERE signal IS NOT NULL AND signal != 'NO_TRADE'`;
  const params = [];

  if (signal) {
    query += ` AND signal = ?`;
    params.push(signal);
  }
  if (minEdge !== undefined) {
    query += ` AND (edge_up >= ? OR edge_down >= ?)`;
    params.push(minEdge, minEdge);
  }
  if (phase) {
    query += ` AND phase = ?`;
    params.push(phase);
  }

  query += ` ORDER BY timestamp DESC`;

  if (limit) {
    query += ` LIMIT ?`;
    params.push(limit);
  }

  return db.prepare(query).all(...params);
}

// ==================== OUTCOMES ====================

export function insertOutcome(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO market_outcomes (
      market_slug, market_end_time, price_to_beat, final_price, outcome
    ) VALUES (
      @market_slug, @market_end_time, @price_to_beat, @final_price, @outcome
    )
  `);
  return stmt.run(data);
}

export function getOutcome(marketSlug) {
  const db = getDb();
  return db.prepare(`SELECT * FROM market_outcomes WHERE market_slug = ?`).get(marketSlug);
}

export function getAllOutcomes() {
  const db = getDb();
  return db.prepare(`SELECT * FROM market_outcomes ORDER BY resolved_at DESC`).all();
}

export function getPendingOutcomes() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT s.market_slug, s.market_end_time, s.price_to_beat
    FROM snapshots s
    LEFT JOIN market_outcomes o ON s.market_slug = o.market_slug
    WHERE o.market_slug IS NULL
      AND s.market_slug IS NOT NULL
      AND s.market_end_time IS NOT NULL
      AND datetime(s.market_end_time) < datetime('now')
    GROUP BY s.market_slug
  `).all();
}

// ==================== SIMULATED TRADES ====================

export function insertSimulatedTrade(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO simulated_trades (
      market_slug, entry_timestamp, entry_price, side, size,
      model_prob, edge, phase, strength
    ) VALUES (
      @market_slug, @entry_timestamp, @entry_price, @side, @size,
      @model_prob, @edge, @phase, @strength
    )
  `);
  return stmt.run(data);
}

export function resolveSimulatedTrade(id, result) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE simulated_trades SET
      exit_price = @exit_price,
      outcome = @outcome,
      pnl = @pnl,
      pnl_pct = @pnl_pct,
      resolved_at = datetime('now')
    WHERE id = @id
  `);
  return stmt.run({ id, ...result });
}

export function getUnresolvedTrades() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM simulated_trades WHERE outcome IS NULL
  `).all();
}

export function getAllTrades(options = {}) {
  const db = getDb();
  const { resolved, limit } = options;

  let query = `SELECT * FROM simulated_trades`;
  const params = [];

  if (resolved === true) {
    query += ` WHERE outcome IS NOT NULL`;
  } else if (resolved === false) {
    query += ` WHERE outcome IS NULL`;
  }

  query += ` ORDER BY entry_timestamp DESC`;

  if (limit) {
    query += ` LIMIT ?`;
    params.push(limit);
  }

  return db.prepare(query).all(...params);
}

export function getTradesByDateRange(startDate, endDate) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM simulated_trades 
    WHERE entry_timestamp >= ? AND entry_timestamp <= ?
      AND outcome IS NOT NULL
    ORDER BY entry_timestamp ASC
  `).all(startDate, endDate);
}

// ==================== STATS ====================

export function getStats() {
  const db = getDb();

  const snapshotCount = db.prepare(`SELECT COUNT(*) as count FROM snapshots`).get().count;
  const marketCount = db.prepare(`SELECT COUNT(DISTINCT market_slug) as count FROM snapshots`).get().count;
  const outcomeCount = db.prepare(`SELECT COUNT(*) as count FROM market_outcomes`).get().count;
  const tradeCount = db.prepare(`SELECT COUNT(*) as count FROM simulated_trades`).get().count;
  const resolvedTradeCount = db.prepare(`SELECT COUNT(*) as count FROM simulated_trades WHERE outcome IS NOT NULL`).get().count;

  const firstSnapshot = db.prepare(`SELECT MIN(timestamp) as ts FROM snapshots`).get().ts;
  const lastSnapshot = db.prepare(`SELECT MAX(timestamp) as ts FROM snapshots`).get().ts;

  return {
    snapshotCount,
    marketCount,
    outcomeCount,
    tradeCount,
    resolvedTradeCount,
    firstSnapshot,
    lastSnapshot
  };
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
