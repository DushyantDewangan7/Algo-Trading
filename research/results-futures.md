# Futures backtests — CoinDCX perpetuals (USDT pairs), Apr 2021 → Oct 2026

Costs: taker fee 0.059% per side (incl. GST), slippage 0.03% per side, funding 0.01% per 8h (longs pay, shorts receive), TDS 0% on exits. Signals on bar close, fills next open, liquidation checked intrabar.

Buy & hold 1x: BTC CAGR -4.3% / DD 86.2% / Sharpe 0.30 · ETH CAGR -14.3% / DD 97.8% / Sharpe 0.57 · SOL CAGR -100.0% / DD 100.0% / Sharpe 0.11 · DOGE CAGR -100.0% / DD 100.0% / Sharpe 0.38

## All strategies at 1x leverage (sorted by Sharpe)

| Candles | Coin | Strategy | CAGR % | Max DD % | Sharpe | Trades/yr | Win % | 2021–23 CAGR | 2024→ CAGR |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1d | SOL | Supertrend(10,3) long/short | 118.7 | 64.0 | 1.30 | 7.4 | 51 | 417.6 | -6.3 |
| 4h | SOL | EMA20/50 long-only | 80.5 | 66.5 | 1.20 | 20.0 | 32 | 197.6 | 10.3 |
| 4h | DOGE | EMA20/50 long/short | 96.3 | 69.7 | 1.18 | 39.3 | 32 | 84.7 | 108.5 |
| 4h | SOL | EMA20/50 long/short | 91.1 | 69.8 | 1.17 | 39.8 | 33 | 225.7 | 13.1 |
| 1d | DOGE | Donchian 20/10 long/short | 88.8 | 62.5 | 1.09 | 13.3 | 49 | 110.2 | 62.8 |
| 1h | SOL | EMA20/50 long-only | 65.6 | 69.5 | 1.05 | 78.2 | 31 | 169.0 | 2.7 |
| 4h | DOGE | Donchian 20/10 long/short | 75.1 | 83.7 | 1.03 | 89.0 | 36 | 43.7 | 112.6 |
| 4h | SOL | Donchian 55/20 long/short | 53.3 | 70.4 | 0.93 | 39.4 | 40 | 177.1 | -14.3 |
| 1h | SOL | EMA20/50 long/short | 51.5 | 79.8 | 0.91 | 156.2 | 32 | 144.6 | -5.5 |
| 4h | DOGE | EMA20/50 long-only | 54.1 | 80.9 | 0.89 | 19.6 | 25 | 61.1 | 47.4 |
| 4h | DOGE | Donchian 55/20 long/short | 49.7 | 90.1 | 0.87 | 37.3 | 39 | 36.5 | 63.8 |
| 1d | SOL | Donchian 20/10 long/short | 40.9 | 73.0 | 0.82 | 15.7 | 44 | 128.2 | -8.7 |
| 4h | DOGE | Supertrend(10,3) long/short | 26.2 | 90.5 | 0.79 | 42.5 | 41 | -14.7 | 85.0 |
| 1d | SOL | Donchian 55/20 long/short | 37.2 | 73.0 | 0.79 | 6.8 | 42 | 150.3 | -16.0 |
| 1d | DOGE | EMA20/50 long/short | 39.0 | 86.8 | 0.79 | 5.9 | 39 | 27.4 | 51.4 |
| 1d | DOGE | Supertrend(10,3) long/short | 37.2 | 75.4 | 0.78 | 8.1 | 42 | 68.8 | 11.9 |
| 1d | SOL | EMA20/50 long-only | 34.7 | 79.1 | 0.77 | 3.6 | 25 | 106.6 | -11.7 |
| 1h | DOGE | EMA20/50 long/short | 33.5 | 88.2 | 0.75 | 171.5 | 29 | 40.5 | 26.9 |
| 4h | BTC | SMA600 ±1% long/short | 26.5 | 48.2 | 0.74 | 10.4 | 28 | 30.5 | 22.5 |
| 1h | SOL | RSI(2) mean reversion long-only | 16.4 | 54.4 | 0.73 | 180.6 | 62 | 54.1 | -11.8 |
| 4h | SOL | Bollinger(20,2) dip-buy in uptrend | 17.5 | 34.9 | 0.71 | 14.2 | 67 | 47.5 | -6.1 |
| 1h | BTC | SMA2400 ±1% long/short | 23.9 | 50.7 | 0.70 | 13.0 | 24 | 32.0 | 16.1 |
| 1h | DOGE | EMA20/50 long-only | 33.4 | 79.0 | 0.68 | 85.7 | 25 | 51.3 | 17.8 |
| 1d | DOGE | Donchian 55/20 long/short | 24.7 | 91.8 | 0.67 | 6.5 | 36 | 0.0 | 55.0 |
| 1d | BTC | SMA100 ±1% long/short | 22.0 | 43.6 | 0.66 | 7.2 | 30 | 14.9 | 29.2 |
| 1d | DOGE | EMA20/50 long-only | 24.4 | 87.2 | 0.65 | 3.1 | 29 | 26.1 | 22.8 |
| 4h | DOGE | RSI(2) mean reversion long-only | 18.1 | 48.6 | 0.63 | 36.9 | 62 | 29.2 | 8.1 |
| 4h | SOL | Supertrend(10,3) long/short | 14.3 | 81.5 | 0.62 | 49.2 | 38 | 78.0 | -26.2 |
| 1h | SOL | Bollinger(20,2) dip-buy in uptrend | 13.5 | 36.2 | 0.58 | 60.7 | 67 | 29.0 | 0.1 |
| 1d | ETH | EMA20/50 long/short | 17.8 | 65.4 | 0.58 | 6.5 | 44 | 6.7 | 29.5 |
| 4h | BTC | SMA600 ±1% long-only | 14.8 | 38.5 | 0.56 | 5.2 | 24 | 8.4 | 21.2 |
| 1d | SOL | EMA20/50 long/short | 9.9 | 86.2 | 0.56 | 7.2 | 28 | 70.9 | -29.0 |
| 1h | DOGE | Donchian 55/20 long/short | 12.6 | 92.3 | 0.55 | 155.8 | 33 | -3.0 | 29.9 |
| 1h | SOL | SMA2400 ±1% long-only | 15.2 | 79.8 | 0.54 | 16.9 | 11 | 66.9 | -20.1 |
| 1d | BTC | Bollinger(20,2) dip-buy in uptrend | 8.1 | 23.5 | 0.54 | 3.1 | 71 | 9.0 | 7.1 |
| 1h | BTC | SMA2400 ±1% long-only | 13.6 | 37.8 | 0.53 | 6.5 | 19 | 9.2 | 17.9 |
| 4h | SOL | Donchian 20/10 long/short | 9.8 | 77.7 | 0.52 | 92.6 | 38 | 75.8 | -30.6 |
| 1d | ETH | Donchian 55/20 long/short | 14.0 | 66.4 | 0.52 | 6.5 | 50 | 4.3 | 20.5 |
| 1d | BTC | SMA100 ±1% long-only | 12.5 | 43.9 | 0.50 | 3.6 | 30 | 2.3 | 23.2 |
| 1d | BTC | RSI(2) mean reversion long-only | 6.4 | 23.7 | 0.48 | 8.1 | 67 | 6.0 | 6.8 |
| 4h | SOL | SMA600 ±1% long-only | 8.9 | 83.9 | 0.46 | 12.4 | 13 | 37.7 | -13.6 |
| 1h | DOGE | SMA2400 ±1% long-only | 4.7 | 95.6 | 0.46 | 12.8 | 13 | -14.1 | 27.3 |
| 1d | ETH | EMA20/50 long-only | 10.4 | 66.2 | 0.45 | 3.2 | 39 | 6.5 | 14.1 |
| 1d | ETH | Supertrend(10,3) long/short | 7.1 | 78.3 | 0.44 | 8.5 | 47 | 27.4 | -9.7 |
| 1d | ETH | Bollinger(20,2) dip-buy in uptrend | 7.1 | 37.6 | 0.41 | 2.9 | 75 | 11.8 | 2.6 |
| 4h | DOGE | SMA600 ±1% long-only | -0.3 | 95.7 | 0.41 | 9.7 | 15 | -13.8 | 15.1 |
| 4h | ETH | Donchian 55/20 long/short | 8.3 | 61.8 | 0.41 | 39.8 | 38 | -5.0 | 23.1 |
| 1h | DOGE | SMA2400 ±1% long/short | -5.5 | 98.7 | 0.40 | 25.4 | 15 | -40.2 | 48.5 |
| 1d | DOGE | SMA100 ±1% long-only | -2.0 | 95.6 | 0.40 | 5.8 | 19 | -12.3 | 9.3 |
| 1h | DOGE | Donchian 20/10 long/short | -3.5 | 96.9 | 0.37 | 380.0 | 33 | -11.8 | 5.2 |
| 1d | SOL | SMA100 ±1% long-only | 1.1 | 85.9 | 0.35 | 7.7 | 14 | 24.4 | -17.7 |
| 4h | BTC | Supertrend(10,3) long/short | 4.0 | 61.5 | 0.33 | 50.6 | 38 | 14.5 | -5.4 |
| 1d | BTC | EMA20/50 long/short | 4.1 | 60.2 | 0.33 | 6.1 | 38 | 4.9 | 3.2 |
| 4h | DOGE | SMA600 ±1% long/short | -16.6 | 99.0 | 0.31 | 19.3 | 18 | -44.4 | 24.4 |
| 1d | ETH | SMA100 ±1% long/short | -1.0 | 86.2 | 0.31 | 10.4 | 24 | -24.8 | 29.6 |
| 1h | SOL | SMA2400 ±1% long/short | -7.0 | 93.5 | 0.31 | 33.9 | 12 | 47.7 | -41.1 |
| 1d | ETH | SMA100 ±1% long-only | 1.9 | 74.1 | 0.30 | 5.2 | 21 | -11.2 | 16.4 |
| 1h | DOGE | Bollinger(20,2) dip-buy in uptrend | 4.4 | 45.2 | 0.29 | 50.8 | 59 | 21.3 | -9.9 |
| 4h | BTC | Donchian 55/20 long/short | 3.7 | 53.7 | 0.29 | 38.7 | 37 | -5.8 | 15.2 |
| 1d | BTC | EMA20/50 long-only | 3.9 | 53.1 | 0.29 | 3.1 | 29 | -1.7 | 9.4 |
| 4h | ETH | SMA600 ±1% long/short | -3.2 | 84.4 | 0.26 | 16.9 | 16 | -21.9 | 19.2 |
| 4h | BTC | EMA20/50 long-only | 2.9 | 59.8 | 0.26 | 20.4 | 26 | -9.3 | 16.5 |
| 4h | ETH | SMA600 ±1% long-only | -0.5 | 73.4 | 0.25 | 8.5 | 13 | -10.6 | 10.3 |
| 4h | BTC | EMA20/50 long/short | -0.3 | 64.2 | 0.25 | 40.5 | 30 | -11.2 | 11.6 |
| 1d | ETH | RSI(2) mean reversion long-only | 2.6 | 23.7 | 0.23 | 7.0 | 59 | 3.3 | 1.9 |
| 4h | SOL | SMA600 ±1% long/short | -13.8 | 90.5 | 0.22 | 24.9 | 14 | 8.0 | -31.0 |
| 4h | ETH | EMA20/50 long-only | -0.9 | 66.2 | 0.21 | 21.3 | 26 | -1.0 | -0.9 |
| 1d | ETH | Donchian 20/10 long/short | -6.3 | 77.4 | 0.20 | 15.9 | 35 | -4.1 | -6.2 |
| 1d | BTC | Donchian 55/20 long/short | -0.1 | 56.0 | 0.20 | 7.7 | 42 | 2.1 | -2.2 |
| 1d | SOL | Bollinger(20,2) dip-buy in uptrend | 1.6 | 55.6 | 0.20 | 2.3 | 46 | -5.6 | 9.1 |
| 4h | ETH | Supertrend(10,3) long/short | -9.4 | 68.7 | 0.19 | 52.4 | 34 | -21.4 | 4.2 |
| 1h | ETH | SMA2400 ±1% long-only | -3.7 | 75.7 | 0.19 | 11.0 | 11 | -13.7 | 7.1 |
| 1d | BTC | Donchian 20/10 long/short | -1.8 | 54.0 | 0.19 | 16.4 | 31 | -9.0 | 5.8 |
| 1h | DOGE | RSI(2) mean reversion long-only | 1.3 | 46.5 | 0.18 | 158.0 | 59 | 23.7 | -16.7 |
| 1d | DOGE | SMA100 ±1% long/short | -35.3 | 99.7 | 0.17 | 11.3 | 24 | -64.0 | 15.5 |
| 1h | DOGE | Supertrend(10,3) long/short | -35.3 | 99.8 | 0.16 | 191.3 | 32 | -71.4 | 44.1 |
| 1h | ETH | SMA2400 ±1% long/short | -9.6 | 89.0 | 0.15 | 22.0 | 13 | -27.2 | 11.7 |
| 1d | BTC | Supertrend(10,3) long/short | -4.4 | 72.4 | 0.15 | 9.0 | 32 | 19.1 | -23.0 |
| 1d | SOL | RSI(2) mean reversion long-only | 0.1 | 28.2 | 0.13 | 7.4 | 56 | 0.3 | -0.2 |
| 1h | ETH | EMA20/50 long-only | -5.3 | 69.1 | 0.13 | 84.1 | 27 | 8.9 | -17.5 |
| 4h | DOGE | Bollinger(20,2) dip-buy in uptrend | -2.6 | 54.8 | 0.13 | 11.9 | 61 | -0.3 | -4.9 |
| 4h | ETH | EMA20/50 long/short | -12.9 | 78.2 | 0.12 | 42.3 | 30 | -16.3 | -9.5 |
| 1h | SOL | Donchian 55/20 long/short | -18.5 | 82.7 | 0.10 | 162.1 | 36 | 6.6 | -36.6 |
| 4h | ETH | Bollinger(20,2) dip-buy in uptrend | -2.7 | 49.9 | 0.05 | 14.9 | 72 | -5.1 | -0.3 |
| 1d | SOL | SMA100 ±1% long/short | -27.1 | 90.4 | 0.02 | 15.5 | 15 | -16.6 | -36.2 |
| 4h | SOL | RSI(2) mean reversion long-only | -3.2 | 48.8 | 0.00 | 44.5 | 61 | 5.0 | -10.7 |
| 4h | BTC | Bollinger(20,2) dip-buy in uptrend | -2.5 | 37.3 | -0.05 | 16.8 | 67 | -1.6 | -3.3 |
| 4h | ETH | Donchian 20/10 long/short | -19.2 | 88.2 | -0.07 | 98.3 | 31 | -30.3 | -6.6 |
| 1h | ETH | EMA20/50 long/short | -24.1 | 90.2 | -0.07 | 168.0 | 26 | -7.6 | -37.6 |
| 4h | BTC | Donchian 20/10 long/short | -13.8 | 79.6 | -0.09 | 96.2 | 34 | -27.7 | 2.4 |
| 1h | ETH | Donchian 55/20 long/short | -19.3 | 86.4 | -0.10 | 162.5 | 34 | -15.2 | -23.0 |
| 1h | ETH | Supertrend(10,3) long/short | -26.5 | 93.3 | -0.11 | 200.5 | 35 | -3.3 | -43.9 |
| 1d | DOGE | RSI(2) mean reversion long-only | -7.2 | 49.9 | -0.13 | 5.6 | 55 | -8.7 | -5.7 |
| 1h | BTC | EMA20/50 long-only | -11.3 | 66.4 | -0.14 | 82.7 | 25 | -18.6 | -3.6 |
| 4h | BTC | CombinedBinHAndCluc (freqtrade) | -7.8 | 51.6 | -0.21 | 31.9 | 60 | -14.2 | -1.1 |
| 1h | SOL | Supertrend(10,3) long/short | -55.2 | 99.1 | -0.28 | 201.9 | 36 | -45.0 | -63.3 |
| 1h | BTC | EMA20/50 long/short | -27.8 | 89.8 | -0.36 | 165.3 | 26 | -30.6 | -24.9 |
| 1h | ETH | Donchian 20/10 long/short | -35.7 | 96.0 | -0.40 | 394.1 | 32 | -41.8 | -29.3 |
| 1h | SOL | Donchian 20/10 long/short | -50.5 | 98.5 | -0.41 | 389.7 | 35 | -42.9 | -56.7 |
| 4h | ETH | RSI(2) mean reversion long-only | -12.2 | 59.7 | -0.42 | 47.4 | 65 | -8.4 | -15.8 |
| 1d | DOGE | Bollinger(20,2) dip-buy in uptrend | -14.0 | 63.5 | -0.43 | 1.4 | 38 | -7.3 | -20.0 |
| 1h | BTC | Bollinger(20,2) dip-buy in uptrend | -7.6 | 43.5 | -0.44 | 64.7 | 62 | -7.3 | -7.9 |
| 1h | ETH | Bollinger(20,2) dip-buy in uptrend | -11.1 | 56.5 | -0.45 | 66.8 | 65 | -9.0 | -13.2 |
| 1h | BTC | CombinedBinHAndCluc (freqtrade) | -15.8 | 69.1 | -0.68 | 40.9 | 56 | -27.1 | -3.0 |
| 1h | BTC | Supertrend(10,3) long/short | -41.2 | 95.8 | -0.72 | 199.0 | 33 | -41.7 | -40.7 |
| 1h | DOGE | CombinedBinHAndCluc (freqtrade) | -29.6 | 90.5 | -0.75 | 91.1 | 54 | -30.3 | -28.9 |
| 4h | ETH | CombinedBinHAndCluc (freqtrade) | -24.8 | 83.3 | -0.75 | 45.7 | 52 | -18.5 | -30.5 |
| 1h | BTC | Donchian 55/20 long/short | -36.0 | 93.6 | -0.81 | 168.6 | 32 | -46.6 | -23.5 |
| 4h | BTC | RSI(2) mean reversion long-only | -14.7 | 60.2 | -0.86 | 46.3 | 60 | -20.2 | -9.0 |
| 4h | DOGE | CombinedBinHAndCluc (freqtrade) | -32.0 | 88.2 | -0.88 | 52.8 | 48 | -35.6 | -28.3 |
| 1h | SOL | CombinedBinHAndCluc (freqtrade) | -36.9 | 95.4 | -0.88 | 104.6 | 54 | -40.7 | -33.3 |
| 1h | ETH | CombinedBinHAndCluc (freqtrade) | -29.7 | 88.6 | -1.10 | 66.8 | 53 | -36.4 | -22.4 |
| 4h | SOL | CombinedBinHAndCluc (freqtrade) | -42.6 | 96.4 | -1.24 | 56.6 | 46 | -56.3 | -24.8 |
| 1h | BTC | Donchian 20/10 long/short | -56.4 | 99.1 | -1.47 | 404.5 | 29 | -60.5 | -52.0 |
| 1h | ETH | RSI(2) mean reversion long-only | -28.6 | 86.1 | -1.74 | 181.0 | 56 | -29.6 | -27.6 |
| 1h | BTC | RSI(2) mean reversion long-only | -25.6 | 81.5 | -2.08 | 182.4 | 52 | -25.0 | -26.2 |

## Leverage ladder for the robust ones (CAGR % / max DD % / liquidated?)

| Candles | Coin | Strategy | 1x | 2x | 3x | 5x | 10x |
|---|---|---|---|---|---|---|---|
| 4h | SOL | EMA20/50 long-only | 80 / 66 | 89 / 90 | 💀 wiped 2021-05-19 | 💀 wiped 2021-05-19 | 💀 wiped 2021-05-12 |
| 4h | DOGE | EMA20/50 long/short | 96 / 70 | 77 / 94 | -1 / 100 | 💀 wiped 2021-04-01 | 💀 wiped 2021-04-01 |
| 4h | SOL | EMA20/50 long/short | 91 / 70 | 71 / 94 | 💀 wiped 2021-05-19 | 💀 wiped 2021-04-18 | 💀 wiped 2021-04-18 |
| 1d | DOGE | Donchian 20/10 long/short | 89 / 63 | 115 / 77 | 81 / 92 | 💀 wiped 2021-05-24 | 💀 wiped 2021-04-07 |
| 1h | SOL | EMA20/50 long-only | 66 / 70 | 70 / 92 | 💀 wiped 2021-05-19 | 💀 wiped 2021-05-19 | 💀 wiped 2021-05-13 |
| 4h | DOGE | Donchian 20/10 long/short | 75 / 84 | 14 / 100 | 💀 wiped 2021-05-13 | 💀 wiped 2021-05-09 | 💀 wiped 2021-04-01 |
| 4h | DOGE | EMA20/50 long-only | 54 / 81 | 31 / 96 | -17 / 100 | 💀 wiped 2021-06-07 | 💀 wiped 2021-04-01 |
| 4h | DOGE | Donchian 55/20 long/short | 50 / 90 | 6 / 100 | 💀 wiped 2021-05-13 | 💀 wiped 2021-05-13 | 💀 wiped 2021-04-01 |
