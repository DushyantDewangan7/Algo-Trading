# Strategy backtests — CoinDCX INR daily, 2021-01-01 → 2026-10-17

Costs per side: fee 0.5% + 18% GST on fee, slippage 0.2%; TDS 1% of every sell. Signals on daily close, fills at next open. Long-only spot, no leverage.

BTC buy & hold: CAGR 24.2%, max drawdown 73.6%, Sharpe 0.69.

| Strategy | CAGR % | Max DD % | Sharpe | Trades/yr | Win % | In market % | 2021–23 CAGR | 2024–now CAGR | 2024–now DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTC SMA100 ±1% band | 43.2 | 42.9 | 1.22 | 2.4 | 43 | 54 | 45.8 | 38.6 | 20.7 |
| BTC above 120d SMA | 39.9 | 43.9 | 1.15 | 3.1 | 33 | 54 | 46.4 | 31.6 | 28.2 |
| Rotation (19 coins) top2 14d BTC>100SMA buf2 every 2w | 71.0 | 61.0 | 1.11 | 19.2 | 37 | 50 | 181.5 | 4.4 | 61.0 |
| Rotation (5 coins) top2 14d BTC>100SMA buf2 every 2w | 55.9 | 44.5 | 1.09 | 11.0 | 41 | 45 | 113.1 | 12.8 | 44.5 |
| BTC trend vote (2 of 3: EMA20/50, SMA100, Donchian55/20) | 35.4 | 47.6 | 1.06 | 4.0 | 30 | 52 | 38.7 | 30.3 | 32.7 |
| BTC SMA120 ±1% band | 33.5 | 41.0 | 1.01 | 2.6 | 40 | 54 | 39.9 | 25.4 | 29.9 |
| BTC EMA 20/50 cross | 33.3 | 47.0 | 0.99 | 2.8 | 44 | 54 | 39.2 | 25.7 | 38.7 |
| BTC above 100d SMA | 32.7 | 51.5 | 0.99 | 5.0 | 24 | 54 | 37.5 | 26.2 | 36.6 |
| ETH trend vote (2 of 3: EMA20/50, SMA100, Donchian55/20) | 39.7 | 61.2 | 0.93 | 4.0 | 30 | 53 | 50.0 | 28.6 | 45.7 |
| BTC SMA100 + vol-target 50% | 27.1 | 52.9 | 0.91 | 10.2 | 24 | 54 | 26.4 | 26.2 | 36.6 |
| BTC+ETH each above 100d SMA | 31.4 | 59.9 | 0.90 | 11.4 | 20 | 61 | 33.8 | 27.4 | 37.8 |
| BTC Donchian 55/20 breakout | 24.1 | 33.2 | 0.90 | 3.6 | 62 | 39 | 26.4 | 18.9 | 30.1 |
| BTC trend vote (3 of 3: EMA20/50, SMA100, Donchian55/20) | 22.5 | 28.9 | 0.87 | 3.8 | 59 | 37 | 26.3 | 16.0 | 27.7 |
| ETH Bollinger(20,2) breakout + Ichimoku (Jesse) | 27.2 | 28.6 | 0.85 | 4.5 | 58 | 27 | 36.8 | 15.9 | 28.6 |
| ETH SMA100 ±1% band | 33.4 | 72.6 | 0.83 | 3.8 | 27 | 56 | 32.4 | 33.7 | 38.5 |
| BTC Bollinger(20,2) breakout + Ichimoku (Jesse) | 19.2 | 35.6 | 0.82 | 4.8 | 46 | 31 | 18.8 | 19.6 | 29.0 |
| Rotation (19 coins) top2 56d BTC>200SMA | 37.0 | 74.6 | 0.78 | 17.9 | 33 | 56 | 89.5 | -0.8 | 67.7 |
| BTC EMA 10/30 cross | 22.9 | 54.3 | 0.78 | 4.7 | 37 | 54 | 16.1 | 28.9 | 34.1 |
| BTC Donchian ensemble (Zarattini 2025, vol-target 50%) | 18.8 | 44.8 | 0.77 | 3.5 | 45 | 63 | 17.3 | 17.4 | 23.3 |
| Rotation (5 coins) top1 56d BTC>200SMA | 36.7 | 87.3 | 0.77 | 8.8 | 37 | 56 | 51.5 | 26.1 | 64.2 |
| BTC Donchian 150/50 breakout | 19.9 | 32.8 | 0.76 | 1.6 | 56 | 36 | 29.0 | 8.4 | 30.0 |
| BTC above 50d SMA | 22.1 | 59.0 | 0.75 | 8.8 | 24 | 54 | 26.7 | 15.7 | 47.9 |
| ETH Donchian 20/10 breakout | 23.1 | 52.8 | 0.70 | 7.2 | 50 | 37 | 52.6 | -3.6 | 52.8 |
| Buy & hold ETH | 27.9 | 78.2 | 0.70 | 0.0 | 0 | 100 | 52.4 | 5.3 | 63.0 |
| BTC 30d time-series momentum (weekly) | 19.8 | 37.0 | 0.70 | 4.5 | 42 | 57 | 30.3 | 6.7 | 34.7 |
| Buy & hold BTC | 24.2 | 73.6 | 0.69 | 0.0 | 0 | 100 | 17.1 | 30.5 | 47.3 |
| BTC Donchian 20/10 breakout | 17.5 | 49.7 | 0.69 | 7.9 | 41 | 41 | 19.8 | 15.1 | 36.8 |
| Rotation (19 coins) top2 28d BTC>200SMA | 26.9 | 78.6 | 0.68 | 24.5 | 37 | 54 | 106.2 | -21.7 | 78.6 |
| Rotation (5 coins) top2 28d BTC>200SMA | 26.3 | 79.6 | 0.67 | 18.1 | 36 | 50 | 66.1 | -2.7 | 52.3 |
| BTC Supertrend(7,3) | 18.4 | 54.8 | 0.67 | 3.5 | 45 | 53 | 22.0 | 13.2 | 41.5 |
| ETH Donchian ensemble (Zarattini 2025, vol-target 50%) | 16.8 | 48.1 | 0.65 | 2.4 | 57 | 48 | 27.1 | 4.9 | 32.8 |
| Rotation (19 coins) top2 28d BTC>200SMA vol-adj | 23.2 | 64.8 | 0.63 | 26.6 | 36 | 54 | 89.8 | -20.2 | 64.8 |
| Dual momentum BTC/ETH 30d | 20.5 | 49.1 | 0.63 | 9.7 | 45 | 63 | 39.5 | 5.2 | 39.9 |
| Rotation (19 coins) top2 28d BTC>200SMA buf2 | 22.0 | 76.4 | 0.62 | 18.5 | 31 | 54 | 86.9 | -18.5 | 76.4 |
| BTC Supertrend(10,3) | 15.5 | 56.0 | 0.61 | 3.5 | 45 | 49 | 14.9 | 14.7 | 40.7 |
| BTC above 200d SMA | 16.5 | 54.2 | 0.61 | 4.5 | 19 | 57 | 26.7 | 5.1 | 53.7 |
| BTC Donchian 200/50 breakout | 14.2 | 46.6 | 0.60 | 1.6 | 56 | 34 | 19.5 | 6.4 | 33.7 |
| BTC 90d time-series momentum (weekly) | 15.7 | 51.6 | 0.59 | 2.1 | 50 | 54 | 14.1 | 14.5 | 39.6 |
| Rotation (19 coins) top1 28d BTC>200SMA | 10.8 | 89.9 | 0.56 | 13.6 | 37 | 54 | 96.4 | -37.3 | 89.9 |
| Rotation (19 coins) top2 14d BTC>200SMA | 14.8 | 73.6 | 0.54 | 31.1 | 38 | 53 | 54.0 | -14.0 | 73.6 |
| Rotation (5 coins) top1 28d BTC>200SMA | 12.4 | 90.5 | 0.50 | 12.4 | 36 | 50 | 37.9 | -6.3 | 62.1 |
| BTC 90d time-series momentum | 9.6 | 61.4 | 0.44 | 7.1 | 17 | 54 | 6.8 | 11.2 | 36.6 |
| Rotation (19 coins) top2 28d | -0.3 | 92.8 | 0.42 | 40.2 | 37 | 90 | 86.4 | -47.0 | 92.5 |
| BTC SMA 50/200 cross | 8.1 | 60.7 | 0.39 | 1.2 | 57 | 55 | 8.2 | 6.5 | 49.2 |
| Rotation (19 coins) top2 28d coin>50SMA | -1.7 | 93.9 | 0.39 | 38.1 | 38 | 86 | 73.7 | -44.6 | 91.6 |
| Dual momentum BTC/ETH 90d | 2.0 | 79.8 | 0.29 | 4.8 | 39 | 61 | 6.1 | -4.5 | 49.8 |
| ETH RSI(2) pullback <10 | -14.6 | 67.9 | -0.47 | 8.1 | 34 | 9 | -14.9 | -14.2 | 37.0 |
| BTC RSI(2) pullback <10 | -16.3 | 74.3 | -0.91 | 8.1 | 19 | 10 | -17.1 | -15.7 | 38.3 |

## Calendar-year returns (%)

| Strategy | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---:|---:|---:|---:|---:|---:|
| BTC SMA100 ±1% band | 79.8 | -16.4 | 106.2 | 105.9 | 17.6 | 6.7 |
| BTC above 120d SMA | 94.0 | -24.2 | 113.2 | 105.1 | 7.6 | 1.2 |
| Rotation (19 coins) top2 14d BTC>100SMA buf2 every 2w | 1350.6 | -24.5 | 103.2 | 82.8 | -33.2 | -17.7 |
| Rotation (5 coins) top2 14d BTC>100SMA buf2 every 2w | 473.0 | -20.8 | 112.6 | 21.1 | 35.7 | -17.2 |
| BTC trend vote (2 of 3: EMA20/50, SMA100, Donchian55/20) | 74.5 | -27.4 | 110.2 | 80.6 | 9.0 | 10.5 |
| BTC SMA120 ±1% band | 80.9 | -20.3 | 89.7 | 94.4 | 5.1 | -4.4 |
| BTC EMA 20/50 cross | 94.6 | -30.4 | 98.9 | 67.2 | 17.0 | 0.6 |
| BTC above 100d SMA | 82.8 | -26.0 | 91.8 | 70.2 | 6.2 | 10.0 |
| ETH trend vote (2 of 3: EMA20/50, SMA100, Donchian55/20) | 278.1 | -41.0 | 51.0 | 47.3 | 50.4 | -6.9 |
| BTC SMA100 + vol-target 50% | 46.6 | -28.2 | 91.8 | 70.2 | 6.2 | 10.0 |
| BTC+ETH each above 100d SMA | 147.2 | -38.0 | 56.0 | 63.9 | 21.3 | 2.1 |
| BTC Donchian 55/20 breakout | 47.9 | -23.0 | 77.2 | 76.5 | -9.8 | 8.7 |
| BTC trend vote (3 of 3: EMA20/50, SMA100, Donchian55/20) | 46.4 | -17.9 | 67.6 | 76.5 | -16.1 | 9.0 |
| ETH Bollinger(20,2) breakout + Ichimoku (Jesse) | 106.8 | -9.1 | 36.1 | 43.1 | 13.9 | -3.4 |
| ETH SMA100 ±1% band | 196.6 | -47.4 | 48.6 | 39.3 | 47.0 | 12.0 |
| BTC Bollinger(20,2) breakout + Ichimoku (Jesse) | -0.8 | -1.9 | 72.2 | 59.8 | -7.8 | 11.9 |
| Rotation (19 coins) top2 56d BTC>200SMA | 281.3 | -6.8 | 91.0 | 45.1 | -40.8 | 6.4 |
| BTC EMA 10/30 cross | 46.0 | -45.8 | 97.6 | 95.3 | 20.4 | -10.2 |
| BTC Donchian ensemble (Zarattini 2025, vol-target 50%) | -5.7 | -6.9 | 84.0 | 71.3 | -10.1 | 9.2 |
| Rotation (5 coins) top1 56d BTC>200SMA | 124.1 | 1.0 | 53.5 | 78.1 | 29.2 | -23.5 |
| BTC Donchian 150/50 breakout | 56.1 | 0.0 | 37.4 | 52.3 | -13.4 | 1.4 |
| BTC above 50d SMA | 93.9 | -50.8 | 113.5 | 71.8 | 1.2 | -10.3 |
| ETH Donchian 20/10 breakout | 220.9 | 3.2 | 7.1 | 24.8 | -7.1 | -18.9 |
| Buy & hold ETH | 405.0 | -64.6 | 97.9 | 50.8 | -12.9 | -10.4 |
| BTC 30d time-series momentum (weekly) | 0.3 | -17.5 | 167.2 | 60.3 | -11.3 | -9.5 |
| Buy & hold BTC | 58.3 | -61.0 | 159.6 | 132.1 | -8.2 | 2.5 |
| BTC Donchian 20/10 breakout | 49.6 | -38.2 | 85.9 | 67.3 | -5.3 | -6.4 |
| Rotation (19 coins) top2 28d BTC>200SMA | 549.5 | -5.0 | 42.0 | 46.1 | -50.5 | -37.2 |
| Rotation (5 coins) top2 28d BTC>200SMA | 148.7 | -4.3 | 92.4 | 10.1 | -2.9 | -21.0 |
| BTC Supertrend(7,3) | 107.0 | -48.0 | 68.5 | 27.1 | 10.2 | 4.8 |
| ETH Donchian ensemble (Zarattini 2025, vol-target 50%) | 86.8 | -6.9 | 18.1 | 27.3 | -4.1 | -2.1 |
| Rotation (19 coins) top2 28d BTC>200SMA vol-adj | 359.5 | -5.0 | 56.5 | -7.6 | -31.5 | -22.5 |
| Dual momentum BTC/ETH 30d | 114.8 | -16.8 | 51.8 | -23.4 | 29.1 | 9.6 |
| Rotation (19 coins) top2 28d BTC>200SMA buf2 | 424.9 | -5.0 | 30.8 | 48.2 | -48.9 | -35.9 |
| BTC Supertrend(10,3) | 77.6 | -49.3 | 68.5 | 34.2 | 11.4 | 1.7 |
| BTC above 200d SMA | 5.4 | -6.8 | 106.9 | 87.4 | -35.6 | -1.2 |
| BTC Donchian 200/50 breakout | 31.5 | 0.0 | 29.7 | 52.3 | -17.9 | 1.4 |
| BTC 90d time-series momentum (weekly) | 10.9 | -16.4 | 60.3 | 106.6 | -7.1 | -18.4 |
| Rotation (19 coins) top1 28d BTC>200SMA | 372.0 | 9.3 | 46.6 | 16.6 | -73.7 | -22.0 |
| Rotation (19 coins) top2 14d BTC>200SMA | 177.7 | -3.1 | 35.5 | 59.1 | -54.5 | -15.8 |
| Rotation (5 coins) top1 28d BTC>200SMA | 36.8 | -11.9 | 117.6 | 41.4 | -28.6 | -25.7 |
| BTC 90d time-series momentum | 48.6 | -38.4 | 33.0 | 75.3 | -6.1 | -15.2 |
| Rotation (19 coins) top2 28d | 682.8 | -68.3 | 160.2 | 37.8 | -56.3 | -74.8 |
| BTC SMA 50/200 cross | 3.4 | -10.1 | 36.4 | 94.1 | -27.5 | -12.1 |
| Rotation (19 coins) top2 28d coin>50SMA | 750.0 | -72.4 | 123.3 | 41.0 | -50.3 | -75.3 |
| Dual momentum BTC/ETH 90d | 94.6 | -58.7 | 48.5 | 8.2 | 12.1 | -22.3 |
| ETH RSI(2) pullback <10 | -18.7 | -11.2 | -14.5 | -24.3 | -10.5 | -4.0 |
| BTC RSI(2) pullback <10 | -27.2 | 0.6 | -22.2 | -23.0 | -15.7 | -3.3 |
