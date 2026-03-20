import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = "./data";
const DB_PATH = path.join(DATA_DIR, "backtest.db");

let db = null;
let SQL = null;

/**
 * Inicializa sql.js (carga WASM) y abre/crea la base de datos.
 * Debe llamarse una vez antes de usar cualquier otra funcion.
 */
export async function initDb() {
  if (db) return db;

  SQL = await initSqlJs();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode = WAL");
  initSchema();
  return db;
}

/**
 * Devuelve la instancia de DB (debe haberse llamado initDb antes).
 */
export function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

function saveToFile() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function initSchema() {
  db.run(`
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
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_market_slug ON snapshots(market_slug)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_signal ON snapshots(signal)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS market_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_slug TEXT UNIQUE NOT NULL,
      market_end_time TEXT,
      price_to_beat REAL,
      final_price REAL,
      outcome TEXT,
      resolved_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_outcomes_slug ON market_outcomes(market_slug)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON market_outcomes(outcome)`);

  db.run(`
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
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_market ON simulated_trades(market_slug)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_outcome ON simulated_trades(outcome)`);

  saveToFile();
}

// Helper para convertir resultado de sql.js a array de objetos
function rowsToObjects(result) {
  if (!result || result.length === 0) return [];
  const stmt = result[0];
  return stmt.values.map(row => {
    const obj = {};
    stmt.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function queryAll(sql, params = []) {
  try {
    const result = db.exec(sql, params);
    return rowsToObjects(result);
  } catch {
    return [];
  }
}

function queryGet(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveToFile();
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0 };
}

// ==================== SNAPSHOTS ====================

export function insertSnapshot(data) {
  return runSql(`
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
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `, [
    data.timestamp, data.market_slug, data.market_end_time,
    data.chainlink_price, data.binance_price, data.price_to_beat,
    data.poly_up_price, data.poly_down_price, data.poly_liquidity,
    data.poly_up_bid_liq, data.poly_up_ask_liq, data.poly_down_bid_liq, data.poly_down_ask_liq,
    data.rsi, data.rsi_slope, data.macd_line, data.macd_signal, data.macd_hist, data.macd_hist_delta,
    data.vwap, data.vwap_slope, data.vwap_dist, data.heiken_color, data.heiken_count,
    data.delta_1m, data.delta_3m,
    data.regime, data.time_left_min, data.model_up, data.model_down, data.edge_up, data.edge_down,
    data.signal, data.phase, data.strength
  ]);
}

export function getSnapshotsByMarket(marketSlug) {
  return queryAll(`
    SELECT * FROM snapshots 
    WHERE market_slug = ? 
    ORDER BY timestamp ASC
  `, [marketSlug]);
}

export function getSnapshotsInRange(startTime, endTime) {
  return queryAll(`
    SELECT * FROM snapshots 
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `, [startTime, endTime]);
}

export function getDistinctMarkets() {
  return queryAll(`
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

  return queryAll(query, params);
}

// ==================== OUTCOMES ====================

export function insertOutcome(data) {
  return runSql(`
    INSERT OR REPLACE INTO market_outcomes (
      market_slug, market_end_time, price_to_beat, final_price, outcome
    ) VALUES (?, ?, ?, ?, ?)
  `, [data.market_slug, data.market_end_time, data.price_to_beat, data.final_price, data.outcome]);
}

export function getOutcome(marketSlug) {
  return queryGet(`SELECT * FROM market_outcomes WHERE market_slug = ?`, [marketSlug]);
}

export function getAllOutcomes() {
  return queryAll(`SELECT * FROM market_outcomes ORDER BY resolved_at DESC`);
}

export function getPendingOutcomes() {
  return queryAll(`
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
  return runSql(`
    INSERT INTO simulated_trades (
      market_slug, entry_timestamp, entry_price, side, size,
      model_prob, edge, phase, strength
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    data.market_slug, data.entry_timestamp, data.entry_price, data.side, data.size,
    data.model_prob, data.edge, data.phase, data.strength
  ]);
}

export function resolveSimulatedTrade(id, result) {
  runSql(`
    UPDATE simulated_trades SET
      exit_price = ?,
      outcome = ?,
      pnl = ?,
      pnl_pct = ?,
      resolved_at = datetime('now')
    WHERE id = ?
  `, [result.exit_price, result.outcome, result.pnl, result.pnl_pct, id]);
}

export function getUnresolvedTrades() {
  return queryAll(`SELECT * FROM simulated_trades WHERE outcome IS NULL`);
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
  return queryAll(query, params);
}

export function getStats() {
  const snapshotCount = queryGet(`SELECT COUNT(*) as count FROM snapshots`)?.count || 0;
  const marketCount = queryGet(`SELECT COUNT(DISTINCT market_slug) as count FROM snapshots WHERE market_slug IS NOT NULL`)?.count || 0;
  const outcomeCount = queryGet(`SELECT COUNT(*) as count FROM market_outcomes`)?.count || 0;
  const tradeCount = queryGet(`SELECT COUNT(*) as count FROM simulated_trades`)?.count || 0;
  const resolvedTradeCount = queryGet(`SELECT COUNT(*) as count FROM simulated_trades WHERE outcome IS NOT NULL`)?.count || 0;
  const firstSnapshot = queryGet(`SELECT MIN(timestamp) as first_ts FROM snapshots`)?.first_ts || null;
  const lastSnapshot = queryGet(`SELECT MAX(timestamp) as last_ts FROM snapshots`)?.last_ts || null;

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
    saveToFile();
    db.close();
    db = null;
  }
}
