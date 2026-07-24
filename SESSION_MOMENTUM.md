# Session Momentum

This dashboard is plain Node.js, CSS, and browser JavaScript. It provides paper
trading, walk-forward backtests, and a gated CoinDCX Futures live mode.

## Run

```bash
npm install
copy .env.example .env
npm test
npm start
```

Open `http://localhost:4000`. Paper trading and backtests have no warning or
confirmation. The paper toggle starts a 60-minute session; renew preserves
positions/stops, and end closes all paper positions immediately.

## Strategy defaults

- Qualified CoinDCX INR top gainers: at least ₹10 lakh trailing 24-hour volume,
  ranked by gain, maximum 15 symbols.
- Up to `MAX_POSITIONS=2`, with cash divided across remaining slots.
- `TRAIL_PCT=6` ratcheting stop and no take-profit.
- CoinGecko non-stable top-ten market-cap list refreshes every six hours, with
  disk cache and fallback. Big coins have no 24-hour max hold; other coins do.
- Paper leverage is 5x. Live leverage defaults to 3x and is capped at 5x.
- Fees, sell-side TDS, bounded slippage, cooldown, leveraged P&L, and simulated
  liquidation share the same strategy/leverage modules.

## Backtests

Select **Session Momentum** in the backtest modal, or consume the live SSE log
while running both presets against a running server:

```bash
npm run backtest:session:presets
```

The presets are YTD 2026 @ 1h and Last 7 days @ 15m. Each includes a same-window,
unleveraged BTC buy-and-hold comparison.

## Live gate and order safety

Live mode remains disabled unless `.env` contains `LIVE_TRADING_ENABLED=true`
and valid `COINDCX_API_KEY` / `COINDCX_SECRET` values. The browser requires, in
order: real-money warning, authenticated balance review, optional conversion
plan approval, exact case-sensitive `LIVE`, and final server checks. Conversion
approval is read-only; spot conversion sells are deferred until the final gate.

Current reference: <https://docs.coindcx.com/#futures-end-points>

Leveraged entries use:

`POST https://api.coindcx.com/exchange/v1/derivatives/futures/orders/create`

The requested leverage is set immediately before an entry with:

`POST https://api.coindcx.com/exchange/v1/derivatives/futures/positions/update_leverage`

INR funding uses:

`POST https://api.coindcx.com/exchange/v1/derivatives/futures/wallets/transfer`

Verification on 2026-07-17: the public BTC/INR Futures instrument request
returned HTTP 200 with `B-BTC_USDT` active, and a deliberately unauthenticated,
zero-quantity request to the exact create URL returned HTTP 401 `Invalid
credentials`. That verifies the production handler without risking an order;
no authenticated create request was sent.

The red **STOP LIVE + CLOSE ALL** button has no confirmation. It fences an
in-flight scan, cancels open Futures orders, exits all INR Futures positions,
and performs a second flat-verification sweep. A crash marker causes startup to
close/verify a previous live session before a new one can begin.

Full redacted request/response audit records are written to ignored
`live-trading.log`. Log failures are non-fatal so they cannot block an exit.
