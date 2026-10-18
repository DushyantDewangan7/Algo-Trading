# GitHub bot strategies on CoinDCX INR intraday candles

Costs: 0.59% fee per side (0.5% + GST), 0.2% slippage per side, 1% TDS on sells ≈ 2.6% per round trip.

| Strategy | Candles | Coin | Trades | Win % (net) | Avg gross/trade % | Avg net/trade % | Total, no costs % | Total, with costs % | Max DD (with costs) % |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| BinHV45 (freqtrade) | 1h (2024-10-18→) | BTC | 19 | 0 | -0.07 | -2.63 | -1.9 | -40.1 | 40.5 |
| ClucMay72018 (freqtrade) | 1h (2024-10-18→) | BTC | 24 | 0 | 0.50 | -2.07 | 12.3 | -39.7 | 39.7 |
| CombinedBinHAndCluc (freqtrade) | 1h (2024-10-18→) | BTC | 46 | 22 | 1.00 | -1.58 | 55.7 | -52.8 | 53.5 |
| SimpleBollinger (Jesse) | 1h (2024-10-18→) | BTC | 528 | 5 | -0.06 | -2.62 | -32.7 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 1h (2024-10-18→) | ETH | 30 | 0 | -0.00 | -2.56 | -1.0 | -54.5 | 54.8 |
| ClucMay72018 (freqtrade) | 1h (2024-10-18→) | ETH | 59 | 0 | -0.28 | -2.83 | -16.5 | -81.9 | 81.9 |
| CombinedBinHAndCluc (freqtrade) | 1h (2024-10-18→) | ETH | 97 | 23 | -0.17 | -2.73 | -20.1 | -93.5 | 93.6 |
| SimpleBollinger (Jesse) | 1h (2024-10-18→) | ETH | 407 | 9 | 0.14 | -2.42 | 50.4 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 1h (2024-10-18→) | SOL | 42 | 0 | -0.68 | -3.23 | -26.4 | -75.2 | 75.9 |
| ClucMay72018 (freqtrade) | 1h (2024-10-18→) | SOL | 81 | 0 | 0.24 | -2.32 | 20.1 | -85.3 | 85.3 |
| CombinedBinHAndCluc (freqtrade) | 1h (2024-10-18→) | SOL | 129 | 27 | 0.08 | -2.48 | 2.2 | -96.4 | 96.7 |
| SimpleBollinger (Jesse) | 1h (2024-10-18→) | SOL | 360 | 11 | 0.01 | -2.55 | -9.7 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 1h (2024-10-18→) | XRP | 43 | 0 | 0.38 | -2.19 | 16.4 | -61.9 | 62.0 |
| ClucMay72018 (freqtrade) | 1h (2024-10-18→) | XRP | 75 | 0 | -0.06 | -2.61 | -5.9 | -86.6 | 86.6 |
| CombinedBinHAndCluc (freqtrade) | 1h (2024-10-18→) | XRP | 119 | 29 | 0.33 | -2.24 | 36.0 | -93.8 | 94.0 |
| SimpleBollinger (Jesse) | 1h (2024-10-18→) | XRP | 348 | 11 | 0.45 | -2.12 | 217.3 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 1h (2024-10-18→) | DOGE | 79 | 0 | -0.02 | -2.58 | -3.7 | -87.6 | 87.7 |
| ClucMay72018 (freqtrade) | 1h (2024-10-18→) | DOGE | 112 | 0 | 0.25 | -2.32 | 28.9 | -92.9 | 93.0 |
| CombinedBinHAndCluc (freqtrade) | 1h (2024-10-18→) | DOGE | 163 | 25 | -0.16 | -2.72 | -31.0 | -99.0 | 99.0 |
| SimpleBollinger (Jesse) | 1h (2024-10-18→) | DOGE | 359 | 11 | 0.15 | -2.41 | 23.8 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 15m (2026-04-21→) | BTC | 1 | 0 | 1.25 | -1.34 | 1.2 | -1.3 | 2.2 |
| ClucMay72018 (freqtrade) | 15m (2026-04-21→) | BTC | 0 | 0 | 0.00 | 0.00 | 0.0 | 0.0 | 0.0 |
| CombinedBinHAndCluc (freqtrade) | 15m (2026-04-21→) | BTC | 1 | 0 | 0.61 | -1.96 | 0.6 | -2.0 | 2.6 |
| SimpleBollinger (Jesse) | 15m (2026-04-21→) | BTC | 781 | 1 | -0.03 | -2.59 | -22.9 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 15m (2026-04-21→) | ETH | 6 | 0 | 0.21 | -2.36 | 1.1 | -13.5 | 14.3 |
| ClucMay72018 (freqtrade) | 15m (2026-04-21→) | ETH | 4 | 0 | 0.70 | -1.88 | 2.8 | -7.3 | 7.3 |
| CombinedBinHAndCluc (freqtrade) | 15m (2026-04-21→) | ETH | 11 | 0 | 0.28 | -2.29 | 2.9 | -22.7 | 22.9 |
| SimpleBollinger (Jesse) | 15m (2026-04-21→) | ETH | 641 | 2 | -0.02 | -2.58 | -13.9 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 15m (2026-04-21→) | SOL | 7 | 0 | 0.36 | -2.21 | 2.4 | -14.6 | 15.7 |
| ClucMay72018 (freqtrade) | 15m (2026-04-21→) | SOL | 5 | 0 | 0.89 | -1.69 | 4.5 | -8.2 | 8.2 |
| CombinedBinHAndCluc (freqtrade) | 15m (2026-04-21→) | SOL | 11 | 18 | 1.34 | -1.26 | 15.6 | -13.1 | 14.1 |
| SimpleBollinger (Jesse) | 15m (2026-04-21→) | SOL | 651 | 2 | -0.06 | -2.62 | -34.3 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 15m (2026-04-21→) | XRP | 3 | 0 | -0.83 | -3.37 | -2.6 | -9.9 | 9.9 |
| ClucMay72018 (freqtrade) | 15m (2026-04-21→) | XRP | 6 | 0 | 0.81 | -1.77 | 5.0 | -10.2 | 10.2 |
| CombinedBinHAndCluc (freqtrade) | 15m (2026-04-21→) | XRP | 9 | 11 | 0.49 | -2.09 | 4.2 | -17.5 | 19.3 |
| SimpleBollinger (Jesse) | 15m (2026-04-21→) | XRP | 509 | 3 | -0.01 | -2.57 | -7.9 | -100.0 | 100.0 |
| BinHV45 (freqtrade) | 15m (2026-04-21→) | DOGE | 11 | 0 | 0.21 | -2.36 | 2.0 | -23.3 | 23.3 |
| ClucMay72018 (freqtrade) | 15m (2026-04-21→) | DOGE | 7 | 0 | -0.27 | -2.83 | -2.0 | -18.3 | 18.9 |
| CombinedBinHAndCluc (freqtrade) | 15m (2026-04-21→) | DOGE | 21 | 10 | 0.11 | -2.45 | 1.8 | -41.0 | 42.2 |
| SimpleBollinger (Jesse) | 15m (2026-04-21→) | DOGE | 650 | 2 | -0.05 | -2.61 | -29.1 | -100.0 | 100.0 |
