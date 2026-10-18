# Futures robustness

## 12-month windows started every quarter (19 windows, 2021-04 → 2025-10)

Cells: windows wiped out by liquidation / median 12-month return % / worst 12-month return %

| Candles | Coin | Strategy | 1x | 2x | 3x | 5x | 10x |
|---|---|---|---|---|---|---|---|
| 4h | DOGE | EMA20/50 long/short | 0/19 wiped · med 47% · worst -56% | 0/19 wiped · med 33% · worst -87% | 0/19 wiped · med -14% · worst -97% | 6/19 wiped · med -95% · worst -100% | 19/19 wiped · med -100% · worst -100% |
| 1d | SOL | Supertrend(10,3) long/short | 0/19 wiped · med 41% · worst -29% | 0/19 wiped · med 60% · worst -75% | 6/19 wiped · med -71% · worst -100% | 18/19 wiped · med -100% · worst -100% | 19/19 wiped · med -100% · worst -100% |
| 1d | DOGE | Donchian 20/10 long/short | 0/19 wiped · med 36% · worst -25% | 0/19 wiped · med 57% · worst -56% | 0/19 wiped · med 38% · worst -82% | 10/19 wiped · med -100% · worst -100% | 19/19 wiped · med -100% · worst -100% |
| 4h | SOL | EMA20/50 long/short | 0/19 wiped · med 23% · worst -58% | 0/19 wiped · med -10% · worst -91% | 1/19 wiped · med -61% · worst -100% | 8/19 wiped · med -99% · worst -100% | 19/19 wiped · med -100% · worst -100% |
| 1d | BTC | SMA100 ±1% long-only | 0/19 wiped · med 5% · worst -28% | 0/19 wiped · med 7% · worst -51% | 0/19 wiped · med 3% · worst -68% | 2/19 wiped · med -17% · worst -100% | 15/19 wiped · med -100% · worst -100% |
| 1d | ETH | SMA100 ±1% long-only | 0/19 wiped · med -1% · worst -43% | 0/19 wiped · med -11% · worst -70% | 0/19 wiped · med -25% · worst -86% | 6/19 wiped · med -56% · worst -100% | 15/19 wiped · med -100% · worst -100% |
| 1d | BTC | SMA100 ±1% long/short | 0/19 wiped · med 33% · worst -28% | 0/19 wiped · med 42% · worst -55% | 0/19 wiped · med 35% · worst -77% | 4/19 wiped · med -27% · worst -100% | 16/19 wiped · med -100% · worst -100% |
| 4h | BTC | SMA100 ±1% long/short | 0/19 wiped · med 29% · worst -13% | 0/19 wiped · med 38% · worst -38% | 0/19 wiped · med 23% · worst -64% | 4/19 wiped · med -12% · worst -100% | 13/19 wiped · med -100% · worst -100% |

## Holdout coins (not used to pick the strategies), Apr 2021 → now, 1x

| Candles | Strategy | XRP CAGR / DD | BNB CAGR / DD | BTC CAGR / DD | ETH CAGR / DD |
|---|---|---|---|---|---|
| 4h | EMA20/50 long/short | -3% / 88% | -7% / 75% | -0% / 64% | -13% / 78% |
| 1d | Supertrend(10,3) long/short | 💀 wiped | 6% / 85% | -4% / 72% | 7% / 78% |
| 1d | Donchian 20/10 long/short | 💀 wiped | 12% / 74% | -2% / 54% | -6% / 77% |
| 4h | EMA20/50 long/short | -3% / 88% | -7% / 75% | -0% / 64% | -13% / 78% |
