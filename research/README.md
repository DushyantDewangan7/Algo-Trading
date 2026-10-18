# Strategy research (October 2026)

Backtests of popular crypto strategies, from X/Twitter, GitHub and the quant
literature, on **CoinDCX INR spot** data with **real Indian costs**.

## Run

```bash
node research/data.js --refresh   # download/refresh daily INR candles (cached in research/data/)
node research/run.js              # daily strategy catalogue -> results.md / results.json
node research/robustness.js       # parameter grids, other coins, cost sensitivity
node research/band-grid.js        # SMA ± band neighbourhood check
node research/intraday.js         # GitHub bot strategies on 1h / 15m -> results-intraday.md
node --test tests/research-engine.test.js
```

## Assumptions

- Costs per side: **0.5% fee + 18% GST = 0.59%**, plus 0.2% slippage. **1% TDS** is deducted
  from every sell. That's about **2.6% per round trip**. The live BTC/INR spread was 0.51%
  on 2026-10-18, so 0.2% slippage per side is about half the spread. A 0.5% stress case is
  in `robustness.js`.
- Signals are computed on the daily close and fill at the next day's open. Long-only spot,
  no leverage.
- Data: CoinDCX `I-<COIN>_INR` daily candles from 2020 (used for warm-up) through
  2026-10-17. Broken 2020 prints and absurd wicks are repaired in `data.js`.
- Test windows: full period 2021-01-01→now, an early half 2021–23 and a recent half
  2024→now. A strategy has to work in both halves.

## Findings

| Strategy | CAGR | Max DD | Sharpe | Trades/yr | 2024→now CAGR |
|---|---:|---:|---:|---:|---:|
| **BTC above 100-day SMA, ±1% band** | **43%** | **43%** | **1.22** | 2.4 | 39% |
| BTC above 120-day SMA | 40% | 44% | 1.15 | 3.1 | 32% |
| BTC trend vote (2 of 3) | 35% | 48% | 1.06 | 4.0 | 30% |
| BTC EMA 20/50 cross | 33% | 47% | 0.99 | 2.8 | 26% |
| BTC buy & hold | 24% | 74% | 0.69 | 0 | 31% |
| Coin rotation, top 2, 14d, every 2 weeks | 56–71% | 45–61% | 1.1 | 11–19 | 4–13% |
| Freqtrade BinHV45 / ClucMay / CombinedBinHAndCluc (1h) | — | — | — | 20–160 | **−40% to −99%** (2 yrs) |
| Jesse SimpleBollinger (1h) | — | — | — | 350–530 | **−100%** |
| Connors RSI(2) | −15% | 70% | <0 | 8 | −15% |

1. **Slow trend-following on BTC is the only robust edge after costs.** All 20 cells of the
   SMA 80–150 × band 0–3% grid beat buy & hold on Sharpe, so the result is a plateau, not one
   lucky setting. The rule also improves ETH, BNB and ADA, but **not** XRP, DOGE, LINK, SOL
   or DOT.
2. **The top row is the best of about 50 variants**, so it carries selection bias. Plan on
   roughly 30% CAGR with a 40–50% drawdown, not the headline. Most of the benefit is avoiding
   crashes: 2022 was −16% for the strategy vs −61% for BTC, and 2025 was +18% vs −8%.
3. **The GitHub bots have little or no raw edge**, and their 1–1.25% take-profits are smaller
   than CoinDCX's ~2.6% round-trip cost. Every net "win" is a loss.
4. **Altcoin rotation is fragile.** Its returns come mostly from 2021. The universe is also
   missing coins that blew up (LUNA, FTT), which flatters the results. The earlier repo result
   `backtest-results/comparison-2024.md` used a 0.1% fee, about a quarter of the real cost.
5. **Cost per trade matters more than the signal.** Anything above about 10 round trips a
   year gives up 25%+ a year to fees and TDS.

## Futures and leverage (`futures-run.js`, `futures-robustness.js`)

CoinDCX perpetuals cost **0.059% per side** (taker fee, per the public instrument API), about
a tenth of the spot fee. These backtests use CoinDCX USDT-pair hourly candles (Apr 2021 →
Oct 2026), rolled up to 4h and 1d. Other assumptions:
- Slippage 0.03% per side.
- Funding 0.01% per 8h: longs pay, shorts receive.
- Liquidation checked within each bar using the live margin. All equity is margin.

- **BTC 100-day trend, long/short, 4h candles** was the only strategy that held up:
  - Across 19 one-year windows starting each quarter, 1x had a median return of +29%, a worst
    window of −13%, and no wipe-outs.
  - 2x: median +38%, worst −38%.
  - 3x: median +23%, worst −64%.
  - 5x: 4 of 19 windows were wiped out. 10x: 13 of 19.
- **Fast alt strategies that look great** turn out to be luck from picking the best of 108
  combinations (e.g. DOGE 4h EMA 20/50 long/short at +96%/yr, SOL daily Supertrend at +119%/yr):
  - On holdout coins (XRP, BNB, BTC, ETH) the same rules lose money or get wiped out, even
    at 1x.
  - At 5x and above they get wiped out in most one-year windows.
- **The freqtrade CombinedBinHAndCluc bot loses 8–43%/yr even at futures fees.** It has no edge.
- **Leaving a perp long open** for years at 1x was liquidated on SOL and DOGE by accumulated
  funding plus a crash.

## Inside-CoinDCX price gaps (`arb-check.js`)

The INR and USDT markets for BTC, ETH, SOL, XRP, DOGE and BNB stayed within a median 0.4% of
each other, hourly, Oct 2025 → Oct 2026. The largest gap was 2.8%. Capturing a gap takes
three legs costing about 4.4%, so **no hour in a year was worth taking**.

## CoinDCX futures facts (checked 2026-10-18)

- **No 1% TDS on futures.** CoinDCX TDS FAQ, Q9: "TDS is currently not applicable on Futures
  Trading". TDS still applies to the spot conversions around futures (INR↔crypto,
  crypto↔crypto).
- **INR-margined fee: 0.02% maker / 0.05% taker + 18% GST** = 0.0236% / 0.059%, the same for
  all users.
- **The INR↔USDT rate for INR-margined futures is fixed at ₹102** (last changed 2026-05-26).
- **Margin must be INR or USDT** moved from the spot wallet. Coins can't be used as margin.
- **Funding is charged every 8h.** BTC averaged 0.0109%/8h in 2024, 0.0047% in 2025 and 0.0027%
  in 2026 to date (Binance history; CoinDCX's rate matches Binance's).
- **Maintenance margin is 0.5%** at small sizes, and liquidation takes up to 0.5% of notional
  as a fee.
- **Tax:** CoinDCX treats futures profit as VDA income (30% flat). Whether rupee-settled
  futures count as business income instead is unsettled.

Sensitivity of BTC 4h long/short at 1x (CAGR / max DD, Apr 2021 → Oct 2026):

| Scenario | 1x | 2x |
|---|---|---|
| Base: funding 0.01%/8h | 27% / 48% | 36% / 69% |
| Funding at the 2024–26 average | 27% / 48% | 38% / 68% |
| No funding earned on shorts | 29% / 47% | 40% / 68% |
| High funding (0.03%/8h) | 21% / 51% | 26% / 71% |
| Slippage 0.1% per side | 25% / 49% | 32% / 70% |

## Minimum position sizes (futures instrument API, 2026-10-18, at ₹102/USDT)

| Contract | Min size | ≈ min exposure | Margin needed at 1x / 2x / 5x |
|---|---|---|---|
| BTC | 0.001 BTC | ≈₹8,280 | ₹8,280 / ₹4,140 / ₹1,660 |
| ETH | 24 USDT notional | ≈₹2,450 | ₹2,450 / ₹1,225 / ₹490 |
| DOGE | 6 USDT notional | ≈₹612 | ₹612 / ₹306 / ₹122 |

## Account constraints (checked 2026-10-18, read-only)

- The account holds about **₹99**: DOGE ₹83, USDT ₹12, plus dust.
- CoinDCX's **minimum order is ₹100** on every INR pair, and SHIB also needs at least
  100,000 coins per order. So nothing in the account can currently be sold or traded by
  the bot.
- A single-position BTC strategy needs comfortably more than ₹100, so that a 40% drawdown
  doesn't leave the position too small to exit. **₹500 or more** is a practical floor.
