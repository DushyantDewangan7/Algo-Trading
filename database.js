const path = require("node:path");
const Database = require("better-sqlite3");

const databasePath = path.join(__dirname, "trading.db");
const db = new Database(databasePath);

// WAL keeps writes durable while allowing the dashboard to read at the same time.
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS candles (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (symbol, interval, timestamp)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS signals (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('BUY', 'HOLD', 'SELL')),
    price REAL,
    reason TEXT NOT NULL,
    rsi REAL,
    adx REAL,
    ema20 REAL,
    ema50 REAL,
    ema200 REAL,
    atr REAL,
    roc REAL,
    PRIMARY KEY (symbol, interval, timestamp)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS paper_trades (
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity REAL NOT NULL,
    entry_price REAL,
    exit_price REAL,
    entry_time INTEGER,
    exit_time INTEGER,
    pnl REAL,
    fees REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS backtests (
    strategy_name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    from_date INTEGER NOT NULL,
    to_date INTEGER NOT NULL,
    net_return REAL,
    gross_return REAL,
    sharpe REAL,
    max_drawdown REAL,
    win_rate REAL,
    total_trades INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const upsertCandleStatement = db.prepare(`
  INSERT INTO candles (symbol, interval, timestamp, open, high, low, close, volume)
  VALUES (@symbol, @interval, @timestamp, @open, @high, @low, @close, @volume)
  ON CONFLICT (symbol, interval, timestamp) DO UPDATE SET
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume
`);

const selectCandlesStatement = db.prepare(`
  SELECT timestamp AS time, open, high, low, close, volume
  FROM candles
  WHERE symbol = @symbol
    AND interval = @interval
    AND timestamp BETWEEN @from AND @to
  ORDER BY timestamp ASC
`);

const selectRecentCandlesStatement = db.prepare(`
  SELECT time, open, high, low, close, volume
  FROM (
    SELECT timestamp AS time, open, high, low, close, volume
    FROM candles
    WHERE symbol = @symbol
      AND interval = @interval
      AND timestamp BETWEEN @from AND @to
    ORDER BY timestamp DESC
    LIMIT @limit
  )
  ORDER BY time ASC
`);

const upsertSignalStatement = db.prepare(`
  INSERT INTO signals (
    symbol, interval, timestamp, action, price, reason,
    rsi, adx, ema20, ema50, ema200, atr, roc
  ) VALUES (
    @symbol, @interval, @timestamp, @action, @price, @reason,
    @rsi, @adx, @ema20, @ema50, @ema200, @atr, @roc
  )
  ON CONFLICT (symbol, interval, timestamp) DO UPDATE SET
    action = excluded.action,
    price = excluded.price,
    reason = excluded.reason,
    rsi = excluded.rsi,
    adx = excluded.adx,
    ema20 = excluded.ema20,
    ema50 = excluded.ema50,
    ema200 = excluded.ema200,
    atr = excluded.atr,
    roc = excluded.roc
`);

const insertTradeStatement = db.prepare(`
  INSERT INTO paper_trades (
    symbol, side, quantity, entry_price, exit_price,
    entry_time, exit_time, pnl, fees
  ) VALUES (
    @symbol, @side, @quantity, @entry_price, @exit_price,
    @entry_time, @exit_time, @pnl, @fees
  )
`);

const insertBacktestStatement = db.prepare(`
  INSERT INTO backtests (
    strategy_name, symbol, interval, from_date, to_date,
    net_return, gross_return, sharpe, max_drawdown,
    win_rate, total_trades, created_at
  ) VALUES (
    @strategy_name, @symbol, @interval, @from_date, @to_date,
    @net_return, @gross_return, @sharpe, @max_drawdown,
    @win_rate, @total_trades, @created_at
  )
`);

const insertCandlesTransaction = db.transaction((rows) => {
  for (const row of rows) upsertCandleStatement.run(row);
  return rows.length;
});

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function saveCandles(symbol, interval, candles) {
  if (!symbol || !interval || !Array.isArray(candles) || candles.length === 0) return 0;

  const rows = candles.map((candle) => ({
    symbol,
    interval,
    timestamp: Number(candle.timestamp ?? candle.time),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume) || 0,
  }));

  return insertCandlesTransaction(rows);
}

function getCandles(symbol, interval, { from = 0, to = Number.MAX_SAFE_INTEGER, limit } = {}) {
  const params = { symbol, interval, from: Number(from), to: Number(to) };
  if (Number.isInteger(limit) && limit > 0) {
    return selectRecentCandlesStatement.all({ ...params, limit });
  }
  return selectCandlesStatement.all(params);
}

function saveSignal(signal) {
  const action = signal.action === "BUY" ? "BUY" : signal.action === "HOLD" ? "HOLD" : "SELL";
  return upsertSignalStatement.run({
    symbol: signal.symbol,
    interval: signal.interval,
    timestamp: Number(signal.timestamp),
    action,
    price: finiteOrNull(signal.price),
    reason: String(signal.reason || ""),
    rsi: finiteOrNull(signal.rsi),
    adx: finiteOrNull(signal.adx),
    ema20: finiteOrNull(signal.ema20),
    ema50: finiteOrNull(signal.ema50),
    ema200: finiteOrNull(signal.ema200),
    atr: finiteOrNull(signal.atr),
    roc: finiteOrNull(signal.roc),
  });
}

function saveTrade(trade) {
  const side = String(trade.side || "").toUpperCase();
  return insertTradeStatement.run({
    symbol: trade.symbol,
    side,
    quantity: Number(trade.quantity),
    entry_price: finiteOrNull(trade.entry_price),
    exit_price: finiteOrNull(trade.exit_price),
    entry_time: finiteOrNull(trade.entry_time),
    exit_time: finiteOrNull(trade.exit_time),
    pnl: finiteOrNull(trade.pnl),
    fees: finiteOrNull(trade.fees) ?? 0,
  });
}

function saveBacktest(backtest) {
  return insertBacktestStatement.run({
    strategy_name: backtest.strategy_name,
    symbol: backtest.symbol,
    interval: backtest.interval,
    from_date: Number(backtest.from_date),
    to_date: Number(backtest.to_date),
    net_return: finiteOrNull(backtest.net_return),
    gross_return: finiteOrNull(backtest.gross_return),
    sharpe: finiteOrNull(backtest.sharpe),
    max_drawdown: finiteOrNull(backtest.max_drawdown),
    win_rate: finiteOrNull(backtest.win_rate),
    total_trades: Number(backtest.total_trades) || 0,
    created_at: Number(backtest.created_at) || Date.now(),
  });
}

module.exports = {
  databasePath,
  saveCandles,
  getCandles,
  saveSignal,
  saveTrade,
  saveBacktest,
};
