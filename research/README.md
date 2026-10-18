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

## Account constraints (checked 2026-10-18, read-only)

- The account holds about **₹99**: DOGE ₹83, USDT ₹12, plus dust.
- CoinDCX's **minimum order is ₹100** on every INR pair, and SHIB also needs at least
  100,000 coins per order. So nothing in the account can currently be sold or traded by
  the bot.
- A single-position BTC strategy needs comfortably more than ₹100, so that a 40% drawdown
  doesn't leave the position too small to exit. **₹500 or more** is a practical floor.
