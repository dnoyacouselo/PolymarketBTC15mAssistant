import sqlite3 from "sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = "./data";
const DB_PATH = path.join(DATA_DIR, "backtest.db");

let db = null;

function runAsync(sql, params) {
  const d = getDb();
  return new Promise((resolve, reject) => {
    let adaptedParams = params;
    if (params && !Array.isArray(params)) {
      adaptedParams = {};
      for (const [k, v] of Object.entries(params)) {
        const newKey = k.startsWith('@') || k.startsWith('$') || k.startsWith(':') ? k : '@' + k;
        adaptedParams[newKey] = v;
      }
    }

    d.run(sql, adaptedParams, function(err) {
      if (err) return reject(err);
      resolve({ lastInsertRowid: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params) {
  const d = getDb();
  return new Promise((resolve, reject) => {
    let adaptedParams = params;
    if (params && !Array.isArray(params)) {
      adaptedParams = {};
      for (const [k, v] of Object.entries(params)) {
         const newKey = k.startsWith('@') || k.startsWith('$') || k.startsWith(':') ? k : '@' + k;
         adaptedParams[newKey] = v;
      }
    }
    d.get(sql, adaptedParams, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allAsync(sql, params) {
  const d = getDb();
  return new Promise((resolve, reject) => {
    let adaptedParams = params;
    if (params && !Array.isArray(params)) {
      adaptedParams = {};
      for (const [k, v] of Object.entries(params)) {
         const newKey = k.startsWith('@') || k.startsWith('$') || k.startsWith(':') ? k : '@' + k;
         adaptedParams[newKey] = v;
      }
    }
    d.all(sql, adaptedParams, (err, rows) => {
       if (err) return reject(err);
       resolve(rows);
    });
  });
}

export function getDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new sqlite3.Database(DB_PATH);
  
  db.run("PRAGMA journal_mode = WAL");

  initSchema();
  return db;
}

function initSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      market_slug TEXT,
      market_end_time TEXT,
      chainlink_price REAL,
      binance_price REAL,
      price_to_beat REAL,
      poly_up_price REAL,
      poly_down_price REAL,
      poly_liquidity REAL,
      poly_up_bid_liq REAL,
      poly_up_ask_liq REAL,
      poly_down_bid_liq REAL,
      poly_down_ask_liq REAL,
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
      regime TEXT,
      time_left_min REAL,
      model_up REAL,
      model_down REAL,
      edge_up REAL,
      edge_down REAL,
      signal TEXT,
      phase TEXT,
      strength TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_market_slug ON snapshots(market_slug);
    CREATE INDEX IF NOT EXISTS idx_snapshots_signal ON snapshots(signal);

    CREATE TABLE IF NOT EXISTS market_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_slug TEXT UNIQUE NOT NULL,
      market_end_time TEXT,
      price_to_beat REAL,
      final_price REAL,
      outcome TEXT,
      resolved_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outcomes_slug ON market_outcomes(market_slug);
    CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON market_outcomes(outcome);

    CREATE TABLE IF NOT EXISTS simulated_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_slug TEXT NOT NULL,
      entry_timestamp TEXT NOT NULL,
      entry_price REAL NOT NULL,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      model_prob REAL,
      edge REAL,
      phase TEXT,
      strength TEXT,
      exit_price REAL,
      outcome TEXT,
      pnl REAL,
      pnl_pct REAL,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_market ON simulated_trades(market_slug);
    CREATE INDEX IF NOT EXISTS idx_trades_outcome ON simulated_trades(outcome);
  `;
  
  db.exec(schema, (err) => {
      if (err) console.error("Schema init error:", err);
  });
}

// ==================== SNAPSHOTS ====================

export function insertSnapshot(data) {
  return runAsync(`
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
  `, data);
}

export function getSnapshotsByMarket(marketSlug) {
  return allAsync(`
    SELECT * FROM snapshots 
    WHERE market_slug = ? 
    ORDER BY timestamp ASC
  `, [marketSlug]);
}

export function getSnapshotsInRange(startTime, endTime) {
  return allAsync(`
    SELECT * FROM snapshots 
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `, [startTime, endTime]);
}

export function getDistinctMarkets() {
  return allAsync(`
    SELECT DISTINCT market_slug, market_end_time, 
           MIN(timestamp) as first_seen,
           MAX(timestamp) as last_seen,
           COUNT(*) as snapshot_count
    FROM snapshots 
    WHERE market_slug IS NOT NULL
    GROUP BY market_slug
    ORDER BY market_end_time DESC
  `); 
}

export function getSignalSnapshots(options = {}) {
  const { signal, minEdge, phase, limit } = options;

  let query = `SELECT * FROM snapshots WHERE signal IS NOT NULL AND signal != 'NO_TRADE'`;
  const params = [];

  if (signal) {
    query += ` AND signal = ?`;
    params.push(processParam(signal));
  }
  if (minEdge !== undefined) {
    query += ` AND (edge_up >= ? OR edge_down >= ?)`;
    params.push(processParam(minEdge), processParam(minEdge));
  }
  if (phase) {
    query += ` AND phase = ?`;
    params.push(processParam(phase));
  }

  query += ` ORDER BY timestamp DESC`;

  if (limit) {
    query += ` LIMIT ?`;
    params.push(processParam(limit));
  }

  return allAsync(query, params);
}

function processParam(p) {
    return p;
}

// ==================== OUTCOMES ====================

export function insertOutcome(data) {
  return runAsync(`
    INSERT OR REPLACE INTO market_outcomes (
      market_slug, market_end_time, price_to_beat, final_price, outcome
    ) VALUES (
      @market_slug, @market_end_time, @price_to_beat, @final_price, @outcome
    )
  `, data);
}

export function getOutcome(marketSlug) {
  return getAsync(`SELECT * FROM market_outcomes WHERE market_slug = ?`, [marketSlug]);
}

export function getAllOutcomes() {
  return allAsync(`SELECT * FROM market_outcomes ORDER BY resolved_at DESC`);
}

export function getPendingOutcomes() {
  return allAsync(`
    SELECT DISTINCT s.market_slug, s.market_end_time, s.price_to_beat
    FROM snapshots s
    LEFT JOIN market_outcomes o ON s.market_slug = o.market_slug
    WHERE o.market_slug IS NULL
      AND s.market_slug IS NOT NULL
      AND s.market_end_time IS NOT NULL
      AND datetime(s.market_end_time) < datetime('now')
    GROUP BY s.market_slug
  `);
}

// ==================== SIMULATED TRADES ====================

export function insertSimulatedTrade(data) {
  return runAsync(`
    INSERT INTO simulated_trades (
      market_slug, entry_timestamp, entry_price, side, size,
      model_prob, edge, phase, strength
    ) VALUES (
      @market_slug, @entry_timestamp, @entry_price, @side, @size,
      @model_prob, @edge, @phase, @strength
    )
  `, data);
}

export function resolveSimulatedTrade(id, result) {
  return runAsync(`
    UPDATE simulated_trades SET
      exit_price = @exit_price,
      outcome = @outcome,
      pnl = @pnl,
      pnl_pct = @pnl_pct,
      resolved_at = datetime('now')
    WHERE id = @id
  `, { id, ...result });
}

export function getUnresolvedTrades() {
  return allAsync(`
    SELECT * FROM simulated_trades WHERE outcome IS NULL
  `);
}

export function getAllTrades(options = {}) {
  const { resolved, limit } = options;

  let query = `SELECT * FROM simulated_trades`;
  const params = [];

  if (resolved === true) {
    query += ` WHERE outcome IS NOT NULL`;
  } else if (resolved === false) {
    query += ` WHERE outcome IS NULL`;
  }
  
  if (limit) {
      query += ` LIMIT ?`;
      params.push(limit);
  }
  return allAsync(query, params);
}

export async function getStats() {
  try {
    const snapshotResult = await getAsync(`SELECT COUNT(*) as count FROM snapshots`);
    const snapshotCount = snapshotResult?.count || 0;

    const marketResult = await getAsync(`SELECT COUNT(DISTINCT market_slug) as count FROM snapshots WHERE market_slug IS NOT NULL`);
    const marketCount = marketResult?.count || 0;

    const outcomeResult = await getAsync(`SELECT COUNT(*) as count FROM market_outcomes`);
    const outcomeCount = outcomeResult?.count || 0;

    const tradeResult = await getAsync(`SELECT COUNT(*) as count FROM simulated_trades`);
    const tradeCount = tradeResult?.count || 0;

    const resolvedResult = await getAsync(`SELECT COUNT(*) as count FROM simulated_trades WHERE outcome IS NOT NULL`);
    const resolvedTradeCount = resolvedResult?.count || 0;

    const firstResult = await getAsync(`SELECT MIN(timestamp) as first_ts FROM snapshots`);
    const firstSnapshot = firstResult?.first_ts || null;

    const lastResult = await getAsync(`SELECT MAX(timestamp) as last_ts FROM snapshots`);
    const lastSnapshot = lastResult?.last_ts || null;

    return {
      snapshotCount,
      marketCount,
      outcomeCount,
      tradeCount,
      resolvedTradeCount,
      firstSnapshot,
      lastSnapshot
    };
  } catch (err) {
    console.error("Error getting stats:", err);
    return {
      snapshotCount: 0,
      marketCount: 0,
      outcomeCount: 0,
      tradeCount: 0,
      resolvedTradeCount: 0,
      firstSnapshot: null,
      lastSnapshot: null
    };
  }
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
