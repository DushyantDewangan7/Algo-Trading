const REFRESH_INTERVAL_MS = 1_000;
const ACCOUNT_REFRESH_INTERVAL_MS = 15_000;
const POPULAR_ASSETS = [
  "BTC", "ETH", "USDT", "BNB", "SOL", "XRP", "DOGE", "ADA",
  "SHIB", "SUI", "TRX", "AVAX", "LINK", "DOT", "LTC",
];

const elements = {
  clock: document.querySelector("#clock"),
  liveState: document.querySelector("#liveState"),
  liveText: document.querySelector("#liveText"),
  marketCount: document.querySelector("#marketCount"),
  gainersCount: document.querySelector("#gainersCount"),
  gainersPercent: document.querySelector("#gainersPercent"),
  losersCount: document.querySelector("#losersCount"),
  losersPercent: document.querySelector("#losersPercent"),
  topMover: document.querySelector("#topMover"),
  topMoverChange: document.querySelector("#topMoverChange"),
  accountContent: document.querySelector("#accountContent"),
  accountError: document.querySelector("#accountError"),
  accountErrorMessage: document.querySelector("#accountErrorMessage"),
  accountRetryButton: document.querySelector("#accountRetryButton"),
  tradePlanStatus: document.querySelector("#tradePlanStatus"),
  tradeSellTarget: document.querySelector("#tradeSellTarget"),
  tradeBuyAsset: document.querySelector("#tradeBuyAsset"),
  tradeBuyMarket: document.querySelector("#tradeBuyMarket"),
  tradeLeverage: document.querySelector("#tradeLeverage"),
  tradeRiskRule: document.querySelector("#tradeRiskRule"),
  tradeRefreshButton: document.querySelector("#tradeRefreshButton"),
  tradeExecuteButton: document.querySelector("#tradeExecuteButton"),
  tradePlanUpdated: document.querySelector("#tradePlanUpdated"),
  tradeSellSummary: document.querySelector("#tradeSellSummary"),
  tradeSellRows: document.querySelector("#tradeSellRows"),
  tradeBuySpotQty: document.querySelector("#tradeBuySpotQty"),
  tradeBuyLeverageNotional: document.querySelector("#tradeBuyLeverageNotional"),
  tradeBuyLeverageQty: document.querySelector("#tradeBuyLeverageQty"),
  tradeExecutionMode: document.querySelector("#tradeExecutionMode"),
  tradeWarnings: document.querySelector("#tradeWarnings"),
  tradeSignalRows: document.querySelector("#tradeSignalRows"),
  portfolioValue: document.querySelector("#portfolioValue"),
  portfolioUpdated: document.querySelector("#portfolioUpdated"),
  assetCount: document.querySelector("#assetCount"),
  tradeCount: document.querySelector("#tradeCount"),
  totalPnl: document.querySelector("#totalPnl"),
  totalPnlPercent: document.querySelector("#totalPnlPercent"),
  cryptoCurrentValue: document.querySelector("#cryptoCurrentValue"),
  realizedPnl: document.querySelector("#realizedPnl"),
  investedValue: document.querySelector("#investedValue"),
  pnlCoverage: document.querySelector("#pnlCoverage"),
  pnlDisclaimer: document.querySelector("#pnlDisclaimer"),
  unpricedNotice: document.querySelector("#unpricedNotice"),
  holdingSearchInput: document.querySelector("#holdingSearchInput"),
  holdingSort: document.querySelector("#holdingSort"),
  profitHoldingRows: document.querySelector("#profitHoldingRows"),
  lossHoldingRows: document.querySelector("#lossHoldingRows"),
  profitCoinCount: document.querySelector("#profitCoinCount"),
  lossCoinCount: document.querySelector("#lossCoinCount"),
  holdingRows: document.querySelector("#holdingRows"),
  tradeRows: document.querySelector("#tradeRows"),
  popularSearchInput: document.querySelector("#popularSearchInput"),
  popularQuoteFilters: document.querySelector("#popularQuoteFilters"),
  popularSort: document.querySelector("#popularSort"),
  popularRows: document.querySelector("#popularRows"),
  popularEmptyState: document.querySelector("#popularEmptyState"),
  popularResultsCount: document.querySelector("#popularResultsCount"),
  moverSearchInput: document.querySelector("#moverSearchInput"),
  moverQuoteFilters: document.querySelector("#moverQuoteFilters"),
  moverLimit: document.querySelector("#moverLimit"),
  marketGainerRows: document.querySelector("#marketGainerRows"),
  marketLoserRows: document.querySelector("#marketLoserRows"),
  marketGainerCount: document.querySelector("#marketGainerCount"),
  marketLoserCount: document.querySelector("#marketLoserCount"),
  updatedText: document.querySelector("#updatedText"),
  searchInput: document.querySelector("#searchInput"),
  quoteFilters: document.querySelector("#quoteFilters"),
  marketSort: document.querySelector("#marketSort"),
  sortDirection: document.querySelector("#sortDirection"),
  pageSize: document.querySelector("#pageSize"),
  marketRows: document.querySelector("#marketRows"),
  loadingState: document.querySelector("#loadingState"),
  errorState: document.querySelector("#errorState"),
  errorMessage: document.querySelector("#errorMessage"),
  retryButton: document.querySelector("#retryButton"),
  tableWrapper: document.querySelector("#tableWrapper"),
  emptyState: document.querySelector("#emptyState"),
  resultsCount: document.querySelector("#resultsCount"),
  previousPage: document.querySelector("#previousPage"),
  nextPage: document.querySelector("#nextPage"),
  pageLabel: document.querySelector("#pageLabel"),
  paperToggle: document.querySelector("#paperToggle"),
  signalsRegimeBadge: document.querySelector("#signalsRegimeBadge"),
  regimeBadge: document.querySelector("#regimeBadge"),
  crossSectionalLookback: document.querySelector("#crossSectionalLookback"),
  crossSectionalTopN: document.querySelector("#crossSectionalTopN"),
  rankingUpdated: document.querySelector("#rankingUpdated"),
  rankingRows: document.querySelector("#rankingRows"),
  signalsRefreshButton: document.querySelector("#signalsRefreshButton"),
  signalsUpdated: document.querySelector("#signalsUpdated"),
  signalRows: document.querySelector("#signalRows"),
  paperEquity: document.querySelector("#paperEquity"),
  paperEquityReturn: document.querySelector("#paperEquityReturn"),
  paperCash: document.querySelector("#paperCash"),
  paperOpenCount: document.querySelector("#paperOpenCount"),
  paperCapNote: document.querySelector("#paperCapNote"),
  paperPnl: document.querySelector("#paperPnl"),
  paperPnlToday: document.querySelector("#paperPnlToday"),
  paperPositionRows: document.querySelector("#paperPositionRows"),
  paperPositionsNote: document.querySelector("#paperPositionsNote"),
  backtestOpenButton: document.querySelector("#backtestOpenButton"),
  backtestCloseButton: document.querySelector("#backtestCloseButton"),
  backtestModal: document.querySelector("#backtestModal"),
  backtestForm: document.querySelector("#backtestForm"),
  backtestStrategy: document.querySelector("#backtestStrategy"),
  backtestDynamicFields: document.querySelector("#backtestDynamicFields"),
  backtestSymbol: document.querySelector("#backtestSymbol"),
  backtestInterval: document.querySelector("#backtestInterval"),
  backtestFrom: document.querySelector("#backtestFrom"),
  backtestTo: document.querySelector("#backtestTo"),
  backtestEquity: document.querySelector("#backtestEquity"),
  backtestRisk: document.querySelector("#backtestRisk"),
  backtestRunButton: document.querySelector("#backtestRunButton"),
  backtestStatus: document.querySelector("#backtestStatus"),
  backtestResults: document.querySelector("#backtestResults"),
  backtestStats: document.querySelector("#backtestStats"),
  backtestChart: document.querySelector("#backtestChart"),
  backtestLog: document.querySelector("#backtestLog"),
  backtestLogPanel: document.querySelector("#backtestLogPanel"),
  backtestSpinner: document.querySelector("#backtestSpinner"),
  sessionPaperToggle: document.querySelector("#sessionPaperToggle"),
  sessionModeBadge: document.querySelector("#sessionModeBadge"),
  sessionGoLiveButton: document.querySelector("#sessionGoLiveButton"),
  sessionLiveStopButton: document.querySelector("#sessionLiveStopButton"),
  sessionRenewButton: document.querySelector("#sessionRenewButton"),
  sessionEndButton: document.querySelector("#sessionEndButton"),
  sessionRemaining: document.querySelector("#sessionRemaining"),
  sessionActionStatus: document.querySelector("#sessionActionStatus"),
  sessionConfigSummary: document.querySelector("#sessionConfigSummary"),
  sessionEquity: document.querySelector("#sessionEquity"),
  sessionEquityNote: document.querySelector("#sessionEquityNote"),
  sessionCash: document.querySelector("#sessionCash"),
  sessionMarginUsed: document.querySelector("#sessionMarginUsed"),
  sessionLeverageNote: document.querySelector("#sessionLeverageNote"),
  sessionExposure: document.querySelector("#sessionExposure"),
  sessionPositionCount: document.querySelector("#sessionPositionCount"),
  sessionPositionNote: document.querySelector("#sessionPositionNote"),
  sessionPositionRows: document.querySelector("#sessionPositionRows"),
  sessionLog: document.querySelector("#sessionLog"),
  sessionLogCount: document.querySelector("#sessionLogCount"),
  sessionRenewToast: document.querySelector("#sessionRenewToast"),
  sessionToastRenewButton: document.querySelector("#sessionToastRenewButton"),
  sessionToastDismissButton: document.querySelector("#sessionToastDismissButton"),
  liveGateModal: document.querySelector("#liveGateModal"),
  liveGateStep: document.querySelector("#liveGateStep"),
  liveGateTitle: document.querySelector("#liveGateTitle"),
  liveGateCloseButton: document.querySelector("#liveGateCloseButton"),
  liveGateBody: document.querySelector("#liveGateBody"),
  liveGateError: document.querySelector("#liveGateError"),
  liveGateActions: document.querySelector("#liveGateActions"),
  topGainersToggle: document.querySelector("#topGainersToggle"),
  topGainersEquity: document.querySelector("#topGainersEquity"),
  topGainersCash: document.querySelector("#topGainersCash"),
  topGainersUnrealized: document.querySelector("#topGainersUnrealized"),
  topGainersRealized: document.querySelector("#topGainersRealized"),
  topGainersEnabledText: document.querySelector("#topGainersEnabledText"),
  topGainersPositionCount: document.querySelector("#topGainersPositionCount"),
  topGainersNextRescan: document.querySelector("#topGainersNextRescan"),
  topGainersUniverseStats: document.querySelector("#topGainersUniverseStats"),
  topGainersUniverseRows: document.querySelector("#topGainersUniverseRows"),
  topGainersPositionRows: document.querySelector("#topGainersPositionRows"),
  topGainersLog: document.querySelector("#topGainersLog"),
  topGainersLogCount: document.querySelector("#topGainersLogCount"),
};

const state = {
  markets: [],
  priceHistory: new Map(),
  account: null,
  tradePlan: null,
  selectedQuote: "ALL",
  search: "",
  marketSort: "volume",
  sortDirection: "desc",
  pageSize: 12,
  holdingSearch: "",
  holdingSort: "return",
  popularSearch: "",
  popularQuote: "INR",
  popularSort: "rank",
  moverSearch: "",
  moverQuote: "INR",
  moverLimit: Infinity,
  page: 1,
  isLoading: false,
  isAccountLoading: false,
  isTradePlanLoading: false,
  updatedAt: null,
  signals: null,
  ranking: null,
  paper: null,
  paperEnabled: localStorage.getItem("paperTradingEnabled") === "true",
  isSignalsLoading: false,
  isBacktestRunning: false,
  backtestChart: null,
  backtestStream: null,
  backtestValues: {},
  backtestStrategy: null,
  topGainers: null,
  sessionMomentum: null,
  sessionLoading: false,
  sessionActionPending: false,
  sessionEndAt: null,
  sessionActiveMode: null,
  sessionKey: null,
  sessionRenewToastFor: null,
  sessionRenewToastDismissedFor: null,
  liveGate: {
    step: 1,
    gateId: null,
    account: null,
    config: null,
    conversionPlan: null,
  },
};

// These controls belonged to the old momentum-only modal. The strategy field
// renderer below replaces them with the exact fields declared per strategy.
for (const legacy of [
  elements.backtestSymbol,
  elements.backtestInterval,
  elements.backtestFrom,
  elements.backtestTo,
  elements.backtestRisk,
]) {
  legacy?.closest("label")?.remove();
}

function formatClock() {
  elements.clock.textContent = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date());
}

function formatPrice(value, quote, precision = 8) {
  if (!Number.isFinite(value)) return "—";

  const currencySymbols = { INR: "₹", USD: "$", USDT: "$" };
  const symbol = currencySymbols[quote] || "";
  let maximumFractionDigits = Math.min(Math.max(precision, 2), 8);

  if (value >= 1_000) maximumFractionDigits = 2;
  else if (value >= 1) maximumFractionDigits = Math.min(maximumFractionDigits, 4);

  return `${symbol}${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits,
    minimumFractionDigits: value >= 1 ? 2 : 0,
  }).format(value)}`;
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAmount(value, maximumFractionDigits = 8) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits,
  }).format(value);
}

function formatInr(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value >= 100 ? 2 : 4,
  }).format(value);
}

function formatSignedInr(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatInr(value)}`;
}

function formatSignedPrice(value, quote, precision) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${formatPrice(Math.abs(value), quote, precision)}`;
}

function formatPercent(value, signed = false) {
  if (!Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function setPnlValue(element, value) {
  element.textContent = formatSignedInr(value);
  element.classList.remove("positive", "negative");
  if (value > 0) element.classList.add("positive");
  if (value < 0) element.classList.add("negative");
}

function updatePriceHistory(markets) {
  for (const market of markets) {
    const history = state.priceHistory.get(market.market) || [];
    history.push(market.price);
    state.priceHistory.set(market.market, history.slice(-24));
  }
}

function getSparklinePoints(market) {
  const history = state.priceHistory.get(market.market) || [];
  let values = history;

  if (values.length < 3) {
    const movement = market.change / 100;
    const base = market.price / (1 + movement || 1);
    values = [base, (base + market.price) / 2, market.price];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = values.length === 1 ? 36 : (index / (values.length - 1)) * 70 + 1;
      const y = 25 - ((value - min) / range) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function filteredMarkets() {
  const query = state.search.trim().toUpperCase();
  const direction = state.sortDirection === "asc" ? 1 : -1;

  return state.markets
    .filter((market) => {
      const quoteMatches = state.selectedQuote === "ALL" || market.quote === state.selectedQuote;
      const queryMatches =
        !query ||
        market.market.includes(query) ||
        market.asset.includes(query) ||
        market.name.toUpperCase().includes(query);
      return quoteMatches && queryMatches;
    })
    .sort((a, b) => {
      if (state.marketSort === "name") {
        return a.name.localeCompare(b.name) * direction;
      }
      const sortValues = {
        volume: [a.volume, b.volume],
        change: [a.change, b.change],
        price: [a.price, b.price],
      };
      const [aValue, bValue] = sortValues[state.marketSort] || sortValues.volume;
      return (aValue - bValue) * direction;
    });
}

function renderSummary() {
  const gainers = state.markets.filter((market) => market.change > 0);
  const losers = state.markets.filter((market) => market.change < 0);
  const count = state.markets.length || 1;
  const topMover = [...state.markets].sort((a, b) => b.change - a.change)[0];

  elements.marketCount.textContent = state.markets.length.toLocaleString("en-IN");
  elements.gainersCount.textContent = gainers.length.toLocaleString("en-IN");
  elements.losersCount.textContent = losers.length.toLocaleString("en-IN");
  elements.gainersPercent.textContent = `${((gainers.length / count) * 100).toFixed(1)}% of markets`;
  elements.losersPercent.textContent = `${((losers.length / count) * 100).toFixed(1)}% of markets`;

  if (topMover) {
    elements.topMover.textContent = topMover.market;
    elements.topMoverChange.textContent = `+${topMover.change.toFixed(2)}% in 24 hours`;
  }
}

function createMarketRow(market) {
  const row = document.createElement("tr");
  const isPositive = market.change >= 0;
  const directionClass = isPositive ? "positive" : "negative";
  const directionSymbol = isPositive ? "+" : "";
  const iconText = (market.asset || market.market).slice(0, 3);

  row.innerHTML = `
    <td>
      <div class="asset-cell">
        <span class="asset-icon">${escapeHtml(iconText)}</span>
        <span>
          <span class="asset-name">${escapeHtml(market.name)}</span>
          <span class="asset-market">${escapeHtml(market.market)}</span>
        </span>
      </div>
    </td>
    <td class="align-right">${formatPrice(market.price, market.quote, market.precision)}</td>
    <td class="align-right">
      <span class="change-pill ${directionClass}">${directionSymbol}${market.change.toFixed(2)}%</span>
    </td>
    <td class="align-right hide-mobile">${formatPrice(market.high, market.quote, market.precision)}</td>
    <td class="align-right hide-tablet">${formatPrice(market.low, market.quote, market.precision)}</td>
    <td class="align-right hide-tablet">${formatCompact(market.volume)} ${escapeHtml(market.asset)}</td>
    <td class="align-right">
      <svg class="sparkline" viewBox="0 0 72 28" role="img" aria-label="${isPositive ? "Up" : "Down"} trend">
        <polyline points="${getSparklinePoints(market)}" stroke="${isPositive ? "#b7ff39" : "#ff5c66"}"></polyline>
      </svg>
    </td>
  `;

  return row;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createMoverRows(markets, emptyMessage) {
  if (markets.length === 0) {
    return `<tr><td class="account-placeholder" colspan="5">${escapeHtml(emptyMessage)}</td></tr>`;
  }

  return markets
    .map((market) => {
      const isPositive = market.change >= 0;
      const directionClass = isPositive ? "positive" : "negative";
      return `
        <tr>
          <td>
            <div class="asset-cell">
              <span class="asset-icon">${escapeHtml((market.asset || market.market).slice(0, 3))}</span>
              <span>
                <span class="asset-name">${escapeHtml(market.asset || market.name)}</span>
                <span class="asset-market">${escapeHtml(market.market)}</span>
              </span>
            </div>
          </td>
          <td class="align-right">${formatPrice(market.price, market.quote, market.precision)}</td>
          <td class="align-right"><span class="change-pill ${directionClass}">${formatPercent(market.change, true)}</span></td>
          <td class="align-right">${formatCompact(market.volume)}</td>
          <td class="align-right">
            <svg class="sparkline" viewBox="0 0 72 28" role="img" aria-label="${isPositive ? "Up" : "Down"} trend">
              <polyline points="${getSparklinePoints(market)}" stroke="${isPositive ? "#b7ff39" : "#ff5c66"}"></polyline>
            </svg>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderMarketMovers() {
  const query = state.moverSearch.trim().toUpperCase();
  const matching = state.markets.filter(
    (market) =>
      market.price > 0 &&
      Number.isFinite(market.change) &&
      (state.moverQuote === "ALL" || market.quote === state.moverQuote) &&
      (!query ||
        market.asset.includes(query) ||
        market.market.includes(query) ||
        market.name.toUpperCase().includes(query)),
  );
  const gainers = matching
    .filter((market) => market.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, state.moverLimit);
  const losers = matching
    .filter((market) => market.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, state.moverLimit);

  elements.marketGainerRows.innerHTML = createMoverRows(
    gainers,
    query ? "No gainers match this search." : "No gaining markets found.",
  );
  elements.marketLoserRows.innerHTML = createMoverRows(
    losers,
    query ? "No losers match this search." : "No losing markets found.",
  );
  elements.marketGainerCount.textContent = `${gainers.length} ${gainers.length === 1 ? "market" : "markets"}`;
  elements.marketLoserCount.textContent = `${losers.length} ${losers.length === 1 ? "market" : "markets"}`;
}

function renderPopularMarkets() {
  const query = state.popularSearch.trim().toUpperCase();
  let markets = state.markets.filter(
    (market) =>
      market.quote === state.popularQuote &&
      POPULAR_ASSETS.includes(market.asset) &&
      (!query ||
        market.asset.includes(query) ||
        market.market.includes(query) ||
        market.name.toUpperCase().includes(query)),
  );

  markets = [...markets].sort((a, b) => {
    if (state.popularSort === "rank") {
      return POPULAR_ASSETS.indexOf(a.asset) - POPULAR_ASSETS.indexOf(b.asset);
    }
    if (state.popularSort === "change-desc") return b.change - a.change;
    if (state.popularSort === "change-asc") return a.change - b.change;
    if (state.popularSort === "volume") return b.volume - a.volume;
    if (state.popularSort === "price") return b.price - a.price;
    return a.name.localeCompare(b.name);
  });

  elements.popularRows.innerHTML = markets
    .map((market, index) => {
      const isPositive = market.change >= 0;
      const directionClass = isPositive ? "positive" : "negative";
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="asset-cell">
              <span class="asset-icon">${escapeHtml(market.asset.slice(0, 3))}</span>
              <span>
                <span class="asset-name">${escapeHtml(market.name)}</span>
                <span class="asset-market">${escapeHtml(market.market)}</span>
              </span>
            </div>
          </td>
          <td class="align-right">${formatPrice(market.price, market.quote, market.precision)}</td>
          <td class="align-right"><span class="change-pill ${directionClass}">${formatPercent(market.change, true)}</span></td>
          <td class="align-right hide-mobile">${formatPrice(market.high, market.quote, market.precision)}</td>
          <td class="align-right hide-tablet">${formatCompact(market.volume)} ${escapeHtml(market.asset)}</td>
          <td class="align-right">
            <svg class="sparkline" viewBox="0 0 72 28" role="img" aria-label="${isPositive ? "Up" : "Down"} trend">
              <polyline points="${getSparklinePoints(market)}" stroke="${isPositive ? "#b7ff39" : "#ff5c66"}"></polyline>
            </svg>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.popularEmptyState.classList.toggle("hidden", markets.length !== 0);
  elements.popularResultsCount.textContent =
    `${markets.length.toLocaleString("en-IN")} popular coins`;
}

function renderMarkets() {
  const markets = filteredMarkets();
  const totalPages = Math.max(1, Math.ceil(markets.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const visibleMarkets = markets.slice(start, start + state.pageSize);

  elements.marketRows.replaceChildren(...visibleMarkets.map(createMarketRow));
  elements.emptyState.classList.toggle("hidden", markets.length !== 0);
  elements.resultsCount.textContent = `${markets.length.toLocaleString("en-IN")} markets`;
  elements.pageLabel.textContent = `${state.page} / ${totalPages}`;
  elements.previousPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= totalPages;
}

function renderUpdatedTime(stale = false) {
  if (!state.updatedAt) return;
  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(state.updatedAt);
  elements.updatedText.textContent = `${stale ? "Cached data" : "Updated"} at ${time}`;
}

function sortPortfolioHoldings(holdings) {
  return [...holdings].sort((a, b) => {
    if (state.holdingSort === "name") return a.name.localeCompare(b.name);
    const sortValues = {
      return: [a.pnlPercent ?? -Infinity, b.pnlPercent ?? -Infinity],
      pnl: [a.unrealizedPnlInr ?? -Infinity, b.unrealizedPnlInr ?? -Infinity],
      value: [a.valueInr ?? -Infinity, b.valueInr ?? -Infinity],
      invested: [a.costBasisInr ?? -Infinity, b.costBasisInr ?? -Infinity],
    };
    const [aValue, bValue] = sortValues[state.holdingSort] || sortValues.return;
    return bValue - aValue;
  });
}

function createPerformanceRows(holdings, emptyMessage) {
  if (holdings.length === 0) {
    return `<tr><td class="account-placeholder" colspan="4">${escapeHtml(emptyMessage)}</td></tr>`;
  }

  return holdings
    .map((holding) => {
      const isProfit = holding.unrealizedPnlInr > 0;
      const directionClass = isProfit ? "positive" : "negative";
      return `
        <tr>
          <td class="holding-asset">
            <span>${escapeHtml(holding.currency)}</span>
            <span>${escapeHtml(holding.name)}</span>
          </td>
          <td class="align-right">${formatInr(holding.costBasisInr)}</td>
          <td class="align-right">${formatInr(holding.valueInr)}</td>
          <td class="align-right">
            <span class="performance-return ${directionClass}">
              ${formatSignedInr(holding.unrealizedPnlInr)}
              <span>${formatPercent(holding.pnlPercent, true)}</span>
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderPerformanceTables(holdings) {
  const query = state.holdingSearch.trim().toUpperCase();
  const matching = sortPortfolioHoldings(
    holdings.filter(
      (holding) =>
        holding.currency !== "INR" &&
        holding.unrealizedPnlInr !== null &&
        (!query ||
          holding.currency.includes(query) ||
          holding.name.toUpperCase().includes(query)),
    ),
  );
  const profitHoldings = matching.filter((holding) => holding.unrealizedPnlInr > 0);
  const lossHoldings = matching.filter((holding) => holding.unrealizedPnlInr < 0);

  elements.profitHoldingRows.innerHTML = createPerformanceRows(
    profitHoldings,
    query ? "No profitable coins match your search." : "No coins are currently in profit.",
  );
  elements.lossHoldingRows.innerHTML = createPerformanceRows(
    lossHoldings,
    query ? "No losing coins match your search." : "No coins are currently in loss.",
  );
  elements.profitCoinCount.textContent = `${profitHoldings.length} ${profitHoldings.length === 1 ? "coin" : "coins"}`;
  elements.lossCoinCount.textContent = `${lossHoldings.length} ${lossHoldings.length === 1 ? "coin" : "coins"}`;
}

function renderHoldings(holdings) {
  if (holdings.length === 0) {
    elements.holdingRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="7">No non-zero balances found.</td></tr>';
    return;
  }

  elements.holdingRows.innerHTML = holdings
    .map((holding) => {
      const pnlClass =
        holding.unrealizedPnlInr > 0
          ? "positive"
          : holding.unrealizedPnlInr < 0
            ? "negative"
            : "";
      const allocation = holding.allocationPercent ?? 0;
      const balanceDetail = holding.locked > 0
        ? `${formatAmount(holding.available)} available · ${formatAmount(holding.locked)} locked`
        : `${formatAmount(holding.available)} available`;

      return `
        <tr>
          <td class="holding-asset">
            <span>${escapeHtml(holding.currency)}</span>
            <span>${escapeHtml(holding.name)}</span>
          </td>
          <td class="align-right">
            ${formatAmount(holding.total)}
            <span class="holding-detail">${escapeHtml(balanceDetail)}</span>
          </td>
          <td class="align-right">${holding.averageBuyPriceInr === null ? "—" : formatInr(holding.averageBuyPriceInr)}</td>
          <td class="align-right">${holding.priceInr === null ? "Unpriced" : formatInr(holding.priceInr)}</td>
          <td class="align-right">${holding.valueInr === null ? "Unpriced" : formatInr(holding.valueInr)}</td>
          <td class="align-right">
            <span class="pnl-value ${pnlClass}">${holding.unrealizedPnlInr === null ? "—" : formatSignedInr(holding.unrealizedPnlInr)}</span>
            <span class="pnl-value-sub ${pnlClass}">${holding.pnlPercent === null ? "No cost basis" : formatPercent(holding.pnlPercent, true)}</span>
          </td>
          <td class="align-right">
            <span class="allocation">
              <span class="allocation-track"><span class="allocation-fill" style="width:${Math.min(100, Math.max(0, allocation))}%"></span></span>
              ${formatPercent(allocation)}
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderTrades(trades) {
  if (trades.length === 0) {
    elements.tradeRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="7">No account trades found.</td></tr>';
    return;
  }

  elements.tradeRows.innerHTML = trades
    .map((trade) => {
      const tradeTime = new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(trade.timestamp));
      const side = String(trade.side || "").toLowerCase();
      const movementClass =
        trade.priceChangePercent > 0
          ? "positive"
          : trade.priceChangePercent < 0
            ? "negative"
            : "";

      return `
        <tr>
          <td class="holding-asset">${escapeHtml(trade.symbol)}</td>
          <td><span class="trade-side ${side === "buy" ? "buy" : "sell"}">${escapeHtml(side)}</span></td>
          <td class="align-right">${formatAmount(trade.quantity)}</td>
          <td class="align-right">${formatPrice(trade.price, trade.quote, trade.precision)}</td>
          <td class="align-right">
            ${trade.currentPrice === null ? escapeHtml(trade.comparisonUnavailableReason || "Unavailable") : formatPrice(trade.currentPrice, trade.currentPriceQuote, trade.precision)}
            ${trade.isConvertedComparison ? '<span class="holding-detail">Converted to INR</span>' : ""}
          </td>
          <td class="align-right">
            <span class="pnl-value ${movementClass}">${trade.priceChangePercent === null ? "—" : formatPercent(trade.priceChangePercent, true)}</span>
            <span class="pnl-value-sub ${movementClass}">${trade.valueDifference === null ? "" : formatSignedPrice(trade.valueDifference, trade.currentPriceQuote, trade.precision)}</span>
          </td>
          <td class="align-right">${escapeHtml(tradeTime)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderTradeSellRows(legs) {
  if (!legs?.length) {
    elements.tradeSellRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="6">No sell assets configured.</td></tr>';
    return;
  }

  elements.tradeSellRows.innerHTML = legs
    .map((leg) => {
      const statusClass = leg.ready ? "positive" : "negative";
      const statusText = leg.ready ? "Ready" : leg.warning || "Not ready";
      return `
        <tr>
          <td class="holding-asset">
            <span>${escapeHtml(leg.asset)}</span>
            <span>${escapeHtml(leg.market || "No market")}</span>
          </td>
          <td class="align-right">${escapeHtml(leg.market || "Unavailable")}</td>
          <td class="align-right">${formatInr(leg.availableValueInr)}</td>
          <td class="align-right">${formatInr(leg.estimatedSellValueInr)}</td>
          <td class="align-right">${formatAmount(leg.estimatedQuantity)}</td>
          <td class="align-right"><span class="pnl-value ${statusClass}">${escapeHtml(statusText)}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderTradeSignals(signals) {
  if (!signals?.length) {
    elements.tradeSignalRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="5">No automation signals configured.</td></tr>';
    return;
  }

  elements.tradeSignalRows.innerHTML = signals
    .map((signal) => {
      const movementClass =
        signal.changeFromBuyPercent > 0
          ? "positive"
          : signal.changeFromBuyPercent < 0
            ? "negative"
            : "";
      const signalLabel = String(signal.trigger || "waiting").replaceAll("-", " ");
      return `
        <tr>
          <td class="holding-asset">
            <span>${escapeHtml(signal.asset)}</span>
            <span>${formatInr(signal.currentValueInr)} held</span>
          </td>
          <td class="align-right">${formatInr(signal.averageBuyPriceInr)}</td>
          <td class="align-right">${formatInr(signal.livePriceInr)}</td>
          <td class="align-right"><span class="pnl-value ${movementClass}">${formatPercent(signal.changeFromBuyPercent, true)}</span></td>
          <td class="align-right"><span class="signal-pill ${escapeHtml(signal.trigger)}">${escapeHtml(signalLabel)}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderTradePlan(plan) {
  state.tradePlan = plan;
  const config = plan.config || {};
  const sell = plan.sell || {};
  const buy = plan.buy || {};
  const automation = plan.automation || {};
  const execution = plan.execution || {};

  elements.tradePlanStatus.textContent = execution.liveOrdersEnabled
    ? "Live orders enabled"
    : "Dry run only";
  elements.tradePlanStatus.classList.toggle("warning-badge", !execution.liveOrdersEnabled);
  elements.tradeSellTarget.textContent = formatInr(sell.targetSellInr);
  elements.tradeBuyAsset.textContent = buy.asset || config.targetAsset || "MORPHO";
  elements.tradeBuyMarket.textContent = buy.market
    ? `${buy.market} market`
    : "No active MORPHO market found";
  elements.tradeLeverage.textContent = `${buy.requestedLeverage || config.preferredLeverage || 10}x`;
  elements.tradeRiskRule.textContent =
    `${automation.stopLossPercent ?? config.stopLossPercent}% / +${automation.takeProfitPercent ?? config.takeProfitPercent}%`;
  elements.tradeExecutionMode.textContent = execution.mode || "dry-run";
  elements.tradeExecuteButton.disabled = !execution.liveOrdersEnabled;
  elements.tradeExecuteButton.textContent = execution.liveOrdersEnabled
    ? "Place real orders"
    : "Place real orders locked";

  elements.tradeSellSummary.textContent =
    sell.shortfallInr > 0
      ? `${formatInr(sell.estimatedSellValueInr)} planned, ${formatInr(sell.shortfallInr)} short`
      : `${formatInr(sell.estimatedSellValueInr)} planned`;
  elements.tradeBuySpotQty.textContent =
    buy.spotQuantityEstimate === null
      ? "Unavailable"
      : `${formatAmount(buy.spotQuantityEstimate)} ${escapeHtml(buy.asset || "MORPHO")}`;
  elements.tradeBuyLeverageNotional.textContent = formatInr(buy.leveragedNotionalInr);
  elements.tradeBuyLeverageQty.textContent =
    buy.leveragedQuantityEstimate === null
      ? "Unavailable"
      : `${formatAmount(buy.leveragedQuantityEstimate)} ${escapeHtml(buy.asset || "MORPHO")}`;
  elements.tradeWarnings.innerHTML = (plan.warnings || [])
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
  elements.tradePlanUpdated.textContent = `Dry run updated ${new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(plan.updatedAt))}`;

  renderTradeSellRows(sell.legs);
  renderTradeSignals(automation.signals);
}

function renderAccount(account) {
  state.account = account;
  const performance = account.performance;
  elements.portfolioValue.textContent = formatInr(account.totalValueInr);
  elements.assetCount.textContent = account.coinCount.toLocaleString("en-IN");
  elements.tradeCount.textContent = account.totalTradeCount.toLocaleString("en-IN");
  setPnlValue(elements.totalPnl, performance.portfolioReturnsInr);
  setPnlValue(elements.realizedPnl, performance.realizedPnlInr);
  elements.cryptoCurrentValue.textContent = formatInr(performance.portfolioCurrentValueInr);
  elements.investedValue.textContent =
    performance.coveragePercent > 0 ? formatInr(performance.investedInr) : "Unavailable";
  elements.totalPnlPercent.textContent =
    performance.portfolioReturnsPercent === null
      ? "No cost basis available"
      : `${formatPercent(performance.portfolioReturnsPercent, true)} total returns`;
  elements.pnlCoverage.textContent =
    performance.costBasisSource === "manual"
      ? "Manual invested value"
      : `${performance.coveragePercent.toFixed(1)}% of portfolio has cost basis`;
  elements.pnlDisclaimer.textContent =
    performance.costBasisSource === "manual"
      ? `Using your manual invested value of ${formatInr(performance.investedInr)} with live CoinDCX holdings. ${performance.unassignedInvestedInr !== 0 ? `${formatInr(Math.abs(performance.unassignedInvestedInr))} is unassigned to a specific coin because the per-coin amounts do not equal the overall total.` : "All invested value is assigned to coins."}`
      : performance.coveragePercent === 0
      ? "Overall returns are unavailable: CoinDCX API returned no purchase cost history for the coins currently held. The CoinDCX app's internal invested value is not exposed through its public API."
      : performance.isEstimated
        ? "Estimated using FIFO cost from available spot trades. Fees, deposits, rewards, transfers, non-INR conversion and missing fills can affect accuracy."
        : "Calculated using FIFO cost from available spot trades. Trading fees are not included.";
  elements.unpricedNotice.textContent = account.unpricedAssets
    ? `${account.unpricedAssets} unpriced`
    : "Live INR value";
  elements.portfolioUpdated.textContent = `Updated ${new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(account.updatedAt))}`;
  renderPerformanceTables(account.holdings);
  renderHoldings(account.holdings);
  renderTrades(account.trades);
}

async function loadAccount() {
  if (state.isAccountLoading) return;
  state.isAccountLoading = true;

  try {
    const response = await fetch("/api/account", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }

    renderAccount(payload);
    elements.accountContent.classList.remove("hidden");
    elements.accountError.classList.add("hidden");
  } catch (error) {
    elements.accountContent.classList.add("hidden");
    elements.accountErrorMessage.textContent = error.message;
    elements.accountError.classList.remove("hidden");
  } finally {
    state.isAccountLoading = false;
  }
}

async function loadTradePlan() {
  if (state.isTradePlanLoading) return;
  state.isTradePlanLoading = true;
  elements.tradePlanUpdated.textContent = "Refreshing dry run...";

  try {
    const response = await fetch("/api/trade-plan", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }

    renderTradePlan(payload);
  } catch (error) {
    elements.tradePlanStatus.textContent = "Dry run unavailable";
    elements.tradePlanStatus.classList.add("warning-badge");
    elements.tradePlanUpdated.textContent = error.message;
    elements.tradeSellRows.innerHTML =
      `<tr><td class="account-placeholder" colspan="6">${escapeHtml(error.message)}</td></tr>`;
    elements.tradeSignalRows.innerHTML =
      `<tr><td class="account-placeholder" colspan="5">${escapeHtml(error.message)}</td></tr>`;
    elements.tradeWarnings.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
  } finally {
    state.isTradePlanLoading = false;
  }
}

function setConnectionState(connected, stale = false) {
  elements.liveState.classList.toggle("offline", !connected);
  elements.liveText.textContent = connected ? (stale ? "Data delayed" : "Live") : "Offline";
}

async function loadMarkets({ initial = false } = {}) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (initial) {
    elements.loadingState.classList.remove("hidden");
    elements.errorState.classList.add("hidden");
  }

  try {
    const response = await fetch("/api/markets", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }

    state.markets = payload.markets.sort((a, b) => {
      const quotePriority = { INR: 0, USDT: 1, BTC: 2 };
      const aPriority = quotePriority[a.quote] ?? 3;
      const bPriority = quotePriority[b.quote] ?? 3;
      return aPriority - bPriority || b.volume - a.volume;
    });
    state.updatedAt = new Date(payload.updatedAt);
    updatePriceHistory(state.markets);
    renderSummary();
    renderMarketMovers();
    renderPopularMarkets();
    renderMarkets();
    renderUpdatedTime(payload.stale);
    setConnectionState(true, payload.stale);
    elements.loadingState.classList.add("hidden");
    elements.errorState.classList.add("hidden");
  } catch (error) {
    setConnectionState(false);
    if (state.markets.length === 0) {
      elements.loadingState.classList.add("hidden");
      elements.errorMessage.textContent = error.message;
      elements.errorState.classList.remove("hidden");
    } else {
      elements.updatedText.textContent = "Update failed — retrying automatically";
    }
  } finally {
    state.isLoading = false;
  }
}

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  state.page = 1;
  renderMarkets();
});

elements.holdingSearchInput.addEventListener("input", (event) => {
  state.holdingSearch = event.target.value;
  if (state.account) renderPerformanceTables(state.account.holdings);
});

elements.holdingSort.addEventListener("change", (event) => {
  state.holdingSort = event.target.value;
  if (state.account) renderPerformanceTables(state.account.holdings);
});

elements.popularSearchInput.addEventListener("input", (event) => {
  state.popularSearch = event.target.value;
  renderPopularMarkets();
});

elements.moverSearchInput.addEventListener("input", (event) => {
  state.moverSearch = event.target.value;
  renderMarketMovers();
});

elements.moverQuoteFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-quote]");
  if (!button) return;

  state.moverQuote = button.dataset.quote;
  elements.moverQuoteFilters.querySelectorAll("button").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderMarketMovers();
});

elements.moverLimit.addEventListener("change", (event) => {
  state.moverLimit =
    event.target.value === "all" ? Infinity : Number(event.target.value) || Infinity;
  renderMarketMovers();
});

elements.popularQuoteFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-quote]");
  if (!button) return;

  state.popularQuote = button.dataset.quote;
  elements.popularQuoteFilters.querySelectorAll("button").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderPopularMarkets();
});

elements.popularSort.addEventListener("change", (event) => {
  state.popularSort = event.target.value;
  renderPopularMarkets();
});

elements.quoteFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-quote]");
  if (!button) return;

  state.selectedQuote = button.dataset.quote;
  state.page = 1;
  elements.quoteFilters.querySelectorAll("button").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderMarkets();
});

elements.marketSort.addEventListener("change", (event) => {
  state.marketSort = event.target.value;
  state.page = 1;
  renderMarkets();
});

elements.sortDirection.addEventListener("click", () => {
  state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
  elements.sortDirection.textContent = state.sortDirection === "desc" ? "↓" : "↑";
  elements.sortDirection.title =
    state.sortDirection === "desc" ? "Sorted descending" : "Sorted ascending";
  state.page = 1;
  renderMarkets();
});

elements.pageSize.addEventListener("change", (event) => {
  state.pageSize = Number(event.target.value) || 12;
  state.page = 1;
  renderMarkets();
});

elements.previousPage.addEventListener("click", () => {
  state.page -= 1;
  renderMarkets();
});

elements.nextPage.addEventListener("click", () => {
  state.page += 1;
  renderMarkets();
});

elements.retryButton.addEventListener("click", () => loadMarkets({ initial: true }));
elements.accountRetryButton.addEventListener("click", loadAccount);
elements.tradeRefreshButton.addEventListener("click", loadTradePlan);

// ---------------------------------------------------------------------------
// Momentum signals + paper trading + backtest modal
// ---------------------------------------------------------------------------

const SIGNALS_REFRESH_INTERVAL_MS = 60_000;

function formatIndicator(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function signalPillClass(action) {
  if (action === "BUY") return "signal-buy";
  if (action === "SELL") return "signal-sell";
  if (action === "REDUCE_50") return "signal-reduce";
  return "signal-hold";
}

function regimeBadgeClass(regime) {
  if (regime === "TREND_UP") return "trend-up";
  if (regime === "TREND_DOWN") return "trend-down";
  if (regime === "RANGE") return "range";
  return "";
}

function renderRegimeBadge(el, regime, known) {
  if (!el) return;
  el.className = `regime-badge ${regimeBadgeClass(regime)}`;
  el.textContent = known && regime ? `Regime: ${regime.replace("_", " ")}` : "Regime: unknown";
}

function renderSignals(payload) {
  state.signals = payload;
  renderRegimeBadge(elements.signalsRegimeBadge, payload.regime?.regime, payload.regime?.known);
  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(payload.updatedAt));
  elements.signalsUpdated.textContent = `${payload.interval} candles · updated ${time}`;

  if (!payload.signals?.length) {
    elements.signalRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="8">Watchlist is empty. Set WATCHLIST in .env.</td></tr>';
    return;
  }

  elements.signalRows.innerHTML = payload.signals
    .map((row) => {
      const indicators = row.indicators || {};
      const action = row.signal?.action || "HOLD";
      const label = action === "REDUCE_50" ? "REDUCE 50%" : action;
      const emaAligned = indicators.emaAligned === true;
      const volumeRatio = indicators.volumeRatio;
      const positionNote = row.position
        ? `In paper position · stop ${formatInr(row.position.stopLoss)}`
        : row.market || "";

      return `
        <tr>
          <td class="holding-asset">
            <span>${escapeHtml(row.symbol)}</span>
            <span>${escapeHtml(positionNote)}</span>
          </td>
          <td class="align-right">${formatInr(row.price)}</td>
          <td class="align-right">${formatIndicator(indicators.rsi)}</td>
          <td class="align-right">${formatIndicator(indicators.adx)}</td>
          <td class="align-right">
            <span class="ema-state ${emaAligned ? "positive" : ""}">${emaAligned ? "20&gt;50&gt;200 ✓" : "Not aligned"}</span>
          </td>
          <td class="align-right">${Number.isFinite(volumeRatio) ? `${volumeRatio.toFixed(2)}×` : "—"}</td>
          <td class="align-right">
            <span class="signal-pill ${signalPillClass(action)}">${escapeHtml(label)}</span>
            ${row.stale ? '<span class="stale-badge">STALE</span>' : ""}
          </td>
          <td class="signal-reason">${escapeHtml(row.signal?.reason || row.error || "")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPaper(view) {
  if (!view) return;
  state.paper = view;

  elements.paperEquity.textContent = formatInr(view.equityInr);
  elements.paperEquityReturn.textContent =
    view.totalReturnPct === null
      ? "Simulated portfolio value"
      : `${formatPercent(view.totalReturnPct, true)} since start (₹${Math.round(view.startingEquityInr).toLocaleString("en-IN")})`;
  elements.paperCash.textContent = formatInr(view.cashInr);
  elements.paperOpenCount.textContent = `${view.openPositionCount} / ${view.maxPositions}`;
  elements.paperCapNote.textContent = view.dailyLossCapped
    ? "Daily loss cap hit — entries blocked"
    : `Max ${view.maxPositions} concurrent`;
  setPnlValue(elements.paperPnl, view.totalRealizedPnlInr + view.unrealizedPnlInr);
  elements.paperPnlToday.textContent =
    `${formatSignedInr(view.realizedTodayInr)} realized today · ${formatSignedInr(view.unrealizedPnlInr)} open`;

  if (!view.positions?.length) {
    elements.paperPositionRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="8">No open paper positions.</td></tr>';
    return;
  }

  elements.paperPositionRows.innerHTML = view.positions
    .map((position) => {
      const pnlClass =
        position.unrealizedPnlInr > 0 ? "positive" : position.unrealizedPnlInr < 0 ? "negative" : "";
      return `
        <tr>
          <td class="holding-asset">
            <span>${escapeHtml(position.symbol)}</span>
            <span>${position.tookPartial ? "Runner (50% taken at +2R)" : "Full position"}</span>
          </td>
          <td class="align-right">${formatAmount(position.qty, 6)}</td>
          <td class="align-right">${formatInr(position.entryPrice)}</td>
          <td class="align-right">${formatInr(position.markPrice)}</td>
          <td class="align-right">${formatInr(position.stopLoss)}</td>
          <td class="align-right">
            <span class="pnl-value ${pnlClass}">${formatSignedInr(position.unrealizedPnlInr)}</span>
          </td>
          <td class="align-right">${Number.isFinite(position.unrealizedR) ? `${position.unrealizedR >= 0 ? "+" : ""}${position.unrealizedR.toFixed(2)}R` : "—"}</td>
          <td class="align-right">
            <button class="paper-close-button" data-symbol="${escapeHtml(position.symbol)}">Close</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadSignals() {
  if (state.isSignalsLoading) return;
  state.isSignalsLoading = true;

  try {
    const response = await fetch("/api/signals", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    renderSignals(payload);

    if (state.paperEnabled) {
      const executeResponse = await fetch("/api/paper/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: true }),
      });
      const executePayload = await executeResponse.json();
      if (!executeResponse.ok) {
        throw new Error(executePayload.detail || executePayload.error || `HTTP ${executeResponse.status}`);
      }
      renderPaper(executePayload.portfolio);
      elements.paperPositionsNote.textContent = executePayload.executed.length
        ? `${executePayload.executed.length} auto fill${executePayload.executed.length === 1 ? "" : "s"} this refresh`
        : "Auto-trading signals — paper fills at live ticker price";
    } else {
      const paperResponse = await fetch("/api/positions/paper", { cache: "no-store" });
      const paperPayload = await paperResponse.json();
      if (paperResponse.ok) renderPaper(paperPayload);
      elements.paperPositionsNote.textContent = "Paper trading is OFF — signals are informational";
    }
  } catch (error) {
    elements.signalsUpdated.textContent = `Signals unavailable: ${error.message}`;
  } finally {
    state.isSignalsLoading = false;
  }
}

function renderRanking(payload) {
  state.ranking = payload;
  elements.crossSectionalLookback.textContent = payload.lookbackDays;
  elements.crossSectionalTopN.textContent = payload.topN;
  renderRegimeBadge(elements.regimeBadge, payload.regime, payload.regimeKnown);
  if (elements.regimeBadge) {
    elements.regimeBadge.title = payload.rebalanceAt
      ? `Last rebalance regime: ${payload.regimeAtRebalance || "unknown"}`
      : "";
  }

  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(payload.updatedAt));
  elements.rankingUpdated.textContent = `updated ${time}`;

  if (!payload.ranking?.length) {
    elements.rankingRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="5">No ranking data available.</td></tr>';
    return;
  }

  elements.rankingRows.innerHTML = payload.ranking
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td class="holding-asset"><span>${escapeHtml(row.symbol)}</span></td>
          <td class="align-right">${formatIndicator(row.score, 3)}</td>
          <td class="align-right">${row.weight > 0 ? formatPercent(row.weight * 100) : "—"}</td>
          <td class="align-right"><span class="rank-status ${row.held ? "held" : "cash"}">${row.held ? "HELD" : "CASH"}</span></td>
        </tr>
      `,
    )
    .join("");
}

async function loadRanking() {
  try {
    const response = await fetch("/api/ranking", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    renderRanking(payload);
  } catch (error) {
    elements.rankingUpdated.textContent = `Ranking unavailable: ${error.message}`;
  }
}

async function closePaperPosition(symbol) {
  try {
    const response = await fetch("/api/paper/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, action: "SELL" }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    renderPaper(payload.portfolio);
  } catch (error) {
    elements.paperPositionsNote.textContent = `Close failed: ${error.message}`;
  }
}

// --- Backtest modal ---

const BACKTEST_FIELD_CONFIG = {
  momentum4h: ["symbol", "interval", "from", "to"],
  csPrevious: ["watchlist", "rebalanceFreq", "from", "to"],
  cs30ema: ["watchlist", "from", "to"],
  cs60ema: ["watchlist", "from", "to"],
  topGainers: ["minVolumeINR", "maxPositions", "trailPct", "tpPct", "from", "to"],
  sessionMomentum: [
    "sessionUniverse",
    "sessionPresets",
    "sessionMinutes",
    "trailPct",
    "leverage",
    "maxPositions",
    "smallCoinMaxHoldHours",
    "interval",
    "from",
    "to",
  ],
  btcHold: ["from", "to"],
};

const BACKTEST_ENDPOINTS = {
  momentum4h: "/api/backtest",
  csPrevious: "/api/backtest/cross-sectional",
  cs30ema: "/api/backtest/cross-sectional",
  cs60ema: "/api/backtest/cross-sectional",
  topGainers: "/api/top-gainers/backtest",
  sessionMomentum: "/api/session-momentum/backtest",
  btcHold: "/api/backtest/btc-hold",
};

const BACKTEST_DEFAULTS = {
  momentum4h: { interval: "4h" },
  csPrevious: { rebalanceFreq: "1" },
  topGainers: { minVolumeINR: "1000000", maxPositions: "15", trailPct: "2", tpPct: "50" },
  sessionMomentum: {
    sessionMinutes: "60",
    trailPct: "6",
    leverage: "5",
    maxPositions: "2",
    smallCoinMaxHoldHours: "24",
    interval: "1h",
  },
};

function defaultBacktestDates() {
  const now = new Date();
  return {
    to: now.toISOString().slice(0, 10),
    from: new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10),
  };
}

function backtestValuesFor(strategy) {
  if (!state.backtestValues[strategy]) state.backtestValues[strategy] = {};
  return state.backtestValues[strategy];
}

function rememberBacktestFields(strategy = state.backtestStrategy || elements.backtestStrategy.value) {
  if (!strategy) return;
  const values = backtestValuesFor(strategy);
  elements.backtestDynamicFields.querySelectorAll("[data-backtest-field]").forEach((input) => {
    values[input.dataset.backtestField] = input.value;
  });
}

function backtestFieldMarkup(field) {
  const strategy = state.backtestStrategy || elements.backtestStrategy.value;
  const watchlist = state.signals?.watchlist || ["I-BTC_INR", "I-ETH_INR", "I-SOL_INR", "I-BNB_INR", "I-XRP_INR"];
  const dates = defaultBacktestDates();
  const defaults = {
    symbol: watchlist[0],
    watchlist: watchlist.join(","),
    rebalanceFreq: "1",
    minVolumeINR: "1000000",
    maxPositions: "15",
    trailPct: "2",
    tpPct: "50",
    from: dates.from,
    to: dates.to,
    ...(BACKTEST_DEFAULTS[strategy] || {}),
  };
  const value = backtestValuesFor(strategy)[field] ?? defaults[field];
  const escaped = escapeHtml(String(value ?? ""));
  const intervals = strategy === "sessionMomentum" ? ["15m", "1h"] : ["1h", "2h", "4h", "6h", "1d"];
  const definitions = {
    symbol: `<label><span>Symbol</span><select data-backtest-field="symbol">${watchlist.map((symbol) => `<option value="${escapeHtml(symbol)}" ${symbol === value ? "selected" : ""}>${escapeHtml(symbol)}</option>`).join("")}</select></label>`,
    interval: `<label><span>${strategy === "sessionMomentum" ? "Interval" : "Timeframe"}</span><select data-backtest-field="interval">${intervals.map((interval) => `<option value="${interval}" ${interval === value ? "selected" : ""}>${interval}</option>`).join("")}</select></label>`,
    watchlist: `<label><span>Watchlist</span><input data-backtest-field="watchlist" value="${escaped}" placeholder="I-BTC_INR,I-ETH_INR" /></label>`,
    rebalanceFreq: `<label><span>Rebalance (weeks)</span><select data-backtest-field="rebalanceFreq"><option value="1" ${value === "1" ? "selected" : ""}>Weekly</option><option value="2" ${value === "2" ? "selected" : ""}>Every 2 weeks</option></select></label>`,
    minVolumeINR: `<label><span>Min volume (INR)</span><input type="number" min="0" step="100000" data-backtest-field="minVolumeINR" value="${escaped}" /></label>`,
    maxPositions: `<label><span>Max positions</span><input type="number" min="1" max="${strategy === "sessionMomentum" ? "15" : "50"}" data-backtest-field="maxPositions" value="${escaped}" /></label>`,
    trailPct: `<label><span>Trail %</span><input type="number" min="0.1" step="0.1" data-backtest-field="trailPct" value="${escaped}" /></label>`,
    tpPct: `<label><span>Take profit %</span><input type="number" min="0.1" step="0.1" data-backtest-field="tpPct" value="${escaped}" /></label>`,
    sessionMinutes: `<label><span>Session length (minutes)</span><input type="number" min="1" step="1" data-backtest-field="sessionMinutes" value="${escaped}" /></label>`,
    leverage: `<label><span>Leverage</span><input type="number" min="1" max="5" step="1" data-backtest-field="leverage" value="${escaped}" /></label>`,
    smallCoinMaxHoldHours: `<label><span>Small-coin max hold (hours)</span><input type="number" min="1" step="1" data-backtest-field="smallCoinMaxHoldHours" value="${escaped}" /></label>`,
    sessionUniverse: '<div class="backtest-readonly-info"><span>Universe</span><strong>Qualified CoinDCX INR top gainers</strong><small>Minimum 24h volume &#8377;10 lakh, ranked by 24h gain, maximum 15 coins.</small></div>',
    sessionPresets: '<div class="backtest-preset-row"><span>Presets</span><button type="button" data-session-preset="ytd-1h">YTD 2026 @ 1h</button><button type="button" data-session-preset="last-7d-15m">Last 7 days @ 15m</button></div>',
    from: `<label><span>From</span><input type="date" required data-backtest-field="from" value="${escaped}" /></label>`,
    to: `<label><span>To</span><input type="date" required data-backtest-field="to" value="${escaped}" /></label>`,
  };
  return definitions[field];
}

function renderBacktestFields() {
  rememberBacktestFields(state.backtestStrategy);
  const strategy = elements.backtestStrategy.value;
  state.backtestStrategy = strategy;
  const fields = BACKTEST_FIELD_CONFIG[strategy] || [];
  console.log(`Strategy=${strategy}, showing fields=[${fields.join(",")}]`);
  elements.backtestDynamicFields.innerHTML = fields.map(backtestFieldMarkup).join("");
}

function applySessionBacktestPreset(preset) {
  if (elements.backtestStrategy.value !== "sessionMomentum") return;
  rememberBacktestFields("sessionMomentum");
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const values = backtestValuesFor("sessionMomentum");
  if (preset === "ytd-1h") {
    Object.assign(values, { from: "2026-01-01", to, interval: "1h" });
  } else if (preset === "last-7d-15m") {
    const from = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    Object.assign(values, { from, to, interval: "15m" });
  }
  for (const field of ["from", "to", "interval"]) {
    const input = elements.backtestDynamicFields.querySelector(`[data-backtest-field="${field}"]`);
    if (input && values[field] !== undefined) input.value = values[field];
  }
}

function openBacktestModal() {
  renderBacktestFields();
  elements.backtestModal.classList.remove("hidden");
}

function closeBacktestModal() {
  elements.backtestModal.classList.add("hidden");
}

function renderSingleBacktestStats(result) {
  elements.backtestStats.classList.remove("comparison-mode");
  const summary = result.summary;
  const stat = (label, value, cssClass = "") =>
    `<div class="backtest-stat"><span>${label}</span><strong class="${cssClass}">${value}</strong></div>`;
  const pnlClass = (value) => (value > 0 ? "positive" : value < 0 ? "negative" : "");

  elements.backtestStats.innerHTML = [
    stat("Net return (after fees + TDS)", formatPercent(summary.netReturnPct, true), pnlClass(summary.netReturnPct)),
    stat("Gross return", formatPercent(summary.grossReturnPct, true), pnlClass(summary.grossReturnPct)),
    stat("CAGR", formatPercent(summary.cagrPct, true), pnlClass(summary.cagrPct)),
    stat("Sharpe", formatIndicator(summary.sharpe, 2)),
    stat("Max drawdown", formatPercent(summary.maxDrawdownPct)),
    stat("Trades", String(summary.tradeCount)),
    stat("Win rate", formatPercent(summary.winRatePct)),
    stat("Avg R multiple", formatIndicator(summary.avgRMultiple, 2)),
    stat("Turnover", Number.isFinite(summary.turnover) ? `${summary.turnover.toFixed(1)}×` : "—"),
    stat("Fees paid", formatInr(summary.totalFeesInr), "negative"),
    stat("TDS withheld", formatInr(summary.totalTdsInr), "negative"),
    Number.isFinite(summary.totalSlippageCostInr)
      ? stat("Slippage cost", formatInr(summary.totalSlippageCostInr), "negative")
      : "",
    Number.isFinite(summary.captureRatio)
      ? stat("BTC capture ratio", `${summary.captureRatio.toFixed(2)}x`)
      : "",
    stat("Final equity", formatInr(summary.finalEquityInr)),
    stat("Candles", String(result.candleCount)),
  ].join("");
}

function backtestSummary(entry) {
  return entry?.summary || entry?.metrics || entry?.result?.summary || entry?.result?.metrics || entry || {};
}

function comparisonLabel(key, entry, index) {
  if (entry?.label || entry?.title || entry?.name) return String(entry.label || entry.title || entry.name);
  const normalized = String(key || "").toLowerCase();
  if (normalized.includes("btc") || normalized.includes("benchmark")) return "BTC Buy & Hold";
  if (normalized.includes("session") || normalized.includes("strategy")) return "Session Momentum";
  return `Result ${index + 1}`;
}

function comparisonEntries(result) {
  const comparison = result?.comparison;
  if (!comparison) return [];
  const source = Array.isArray(comparison)
    ? comparison.map((entry, index) => [String(index), entry])
    : Array.isArray(comparison.results)
      ? comparison.results.map((entry, index) => [String(index), entry])
      : Object.entries(comparison);

  return source
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([key, entry], index) => ({
      key,
      label: comparisonLabel(key, entry, index),
      entry: entry.result && typeof entry.result === "object" ? entry.result : entry,
    }))
    .filter(({ entry }) => {
      const summary = backtestSummary(entry);
      return ["netReturnPct", "netPct", "grossReturnPct", "tradeCount", "positionsOpened", "finalEquityInr"]
        .some((field) => summary[field] !== undefined);
    });
}

function getPrimaryBacktestResult(result) {
  if (result?.strategyResult && typeof result.strategyResult === "object") return result.strategyResult;
  if (result?.result && typeof result.result === "object" && (result.result.summary || result.result.equityCurve)) {
    return result.result;
  }
  if (result?.summary || Array.isArray(result?.equityCurve)) return result;
  const entries = comparisonEntries(result);
  const strategy = entries.find(({ key, label }) =>
    /session|strategy/i.test(`${key} ${label}`) && !/btc|benchmark/i.test(`${key} ${label}`),
  );
  return strategy?.entry || result;
}

function renderBacktestComparison(entries) {
  const rows = [
    ["Net %", (summary) => formatPercent(firstFinite(summary.netReturnPct, summary.netPct), true)],
    ["Gross %", (summary) => formatPercent(firstFinite(summary.grossReturnPct, summary.grossPct), true)],
    ["Max DD", (summary) => formatPercent(firstFinite(summary.maxDrawdownPct, summary.maxDdPct))],
    ["Sessions run", (summary) => formatAmount(firstFinite(summary.sessionsRun, summary.sessionCount), 0)],
    ["Positions opened", (summary) => formatAmount(firstFinite(summary.positionsOpened, summary.tradeCount), 0)],
    ["Win rate", (summary) => formatPercent(firstFinite(summary.winRatePct, summary.winPct))],
    ["Avg R", (summary) => formatIndicator(firstFinite(summary.avgRMultiple, summary.avgR), 2)],
    ["Liquidations", (summary) => formatAmount(firstFinite(summary.liquidations, summary.liquidationCount), 0)],
    ["Total fees", (summary) => formatInr(firstFinite(summary.totalFeesInr, summary.feesInr))],
    ["Total TDS", (summary) => formatInr(firstFinite(summary.totalTdsInr, summary.tdsInr))],
    ["Capture ratio", (summary) => {
      const value = firstFinite(summary.captureRatio);
      return Number.isFinite(value) ? `${value.toFixed(2)}x` : "\u2014";
    }],
  ];
  const columns = entries.map(({ label, entry }) => ({ label, summary: backtestSummary(entry) }));
  elements.backtestStats.classList.add("comparison-mode");
  elements.backtestStats.innerHTML = `
    <div class="backtest-comparison-table" style="--comparison-columns:${columns.length}">
      <div class="backtest-comparison-cell comparison-corner">Metric</div>
      ${columns.map(({ label }) => `<div class="backtest-comparison-cell comparison-heading">${escapeHtml(label)}</div>`).join("")}
      ${rows.map(([label, formatter]) => `
        <div class="backtest-comparison-cell comparison-metric">${escapeHtml(label)}</div>
        ${columns.map(({ summary }) => `<div class="backtest-comparison-cell comparison-value">${formatter(summary)}</div>`).join("")}
      `).join("")}
    </div>
  `;
}

function renderBacktestStats(result) {
  const entries = comparisonEntries(result);
  if (entries.length >= 2) renderBacktestComparison(entries);
  else renderSingleBacktestStats(getPrimaryBacktestResult(result));
}

function renderBacktestChart(result) {
  const wrap = elements.backtestChart.parentElement;
  if (typeof Chart === "undefined") {
    wrap.innerHTML =
      '<p class="backtest-chart-fallback">Equity curve chart unavailable: Chart.js could not be loaded from the CDN.</p>';
    return;
  }

  if (state.backtestChart) {
    state.backtestChart.destroy();
    state.backtestChart = null;
  }

  const points = Array.isArray(result?.equityCurve) ? result.equityCurve : [];
  state.backtestChart = new Chart(elements.backtestChart, {
    type: "line",
    data: {
      labels: points.map((point) =>
        new Date(point.time).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
      ),
      datasets: [
        {
          label: `Equity (INR) — ${result.symbol || result.strategy || "portfolio"} ${result.interval || ""}`,
          data: points.map((point) => point.equity),
          borderColor: "#b7ff39",
          backgroundColor: "rgba(183, 255, 57, 0.08)",
          fill: true,
          pointRadius: 0,
          borderWidth: 1.6,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#899397", boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label: (context) => ` ₹${Number(context.parsed.y).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#899397", maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          ticks: {
            color: "#899397",
            callback: (value) => `₹${Number(value).toLocaleString("en-IN", { notation: "compact" })}`,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}

async function runBacktestFromForm(event) {
  event.preventDefault();
  if (state.isBacktestRunning) return;
  state.isBacktestRunning = true;
  elements.backtestRunButton.disabled = true;
  elements.backtestStatus.textContent = "Fetching candles and simulating… this can take a few seconds.";

  try {
    const response = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: elements.backtestSymbol.value,
        interval: elements.backtestInterval.value,
        from: elements.backtestFrom.value,
        to: elements.backtestTo.value,
        equity: Number(elements.backtestEquity.value) || 100000,
        riskPerTradePct: Number(elements.backtestRisk.value) || 0.5,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);

    renderBacktestStats(payload);
    elements.backtestResults.classList.remove("hidden");
    renderBacktestChart(payload);
    elements.backtestStatus.textContent =
      `Done: ${payload.summary.tradeCount} trades over ${Math.round(payload.summary.durationDays)} days.`;
  } catch (error) {
    elements.backtestStatus.textContent = `Backtest failed: ${error.message}`;
  } finally {
    state.isBacktestRunning = false;
    elements.backtestRunButton.disabled = false;
  }
}

function appendBacktestLog(line) {
  const emptyMessage = "Choose a strategy and run a backtest.";
  const lines = elements.backtestLog.textContent === emptyMessage
    ? []
    : elements.backtestLog.textContent.split("\n").filter(Boolean);
  lines.push(line);
  elements.backtestLog.textContent = lines.slice(-500).join("\n");
  elements.backtestLog.scrollTop = elements.backtestLog.scrollHeight;
}

function openBacktestStream() {
  state.backtestStream?.close();
  elements.backtestLog.textContent = "";
  const stream = new EventSource("/api/backtest/stream?tail=0");
  state.backtestStream = stream;
  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.line) appendBacktestLog(payload.line);
    } catch {
      appendBacktestLog(event.data);
    }
  };
  stream.addEventListener("done", () => {
    stream.close();
    if (state.backtestStream === stream) state.backtestStream = null;
  });
  stream.onerror = () => {
    if (!state.isBacktestRunning) stream.close();
  };
  return new Promise((resolve) => {
    let settled = false;
    const ready = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.onopen = ready;
    setTimeout(ready, 1_500);
  });
}

async function runSelectedBacktestFromForm(event) {
  event.preventDefault();
  if (state.isBacktestRunning) return;
  state.isBacktestRunning = true;
  elements.backtestRunButton.disabled = true;
  elements.backtestSpinner.classList.remove("hidden");
  elements.backtestLogPanel.open = true;
  elements.backtestStatus.textContent = "Fetching candles and simulating; this can take a while.";

  try {
    const strategy = elements.backtestStrategy.value;
    rememberBacktestFields(strategy);
    const values = { ...backtestValuesFor(strategy) };
    if (!values.from || !values.to) throw new Error("Choose both From and To dates");
    const payload = {
      strategy,
      equity: Number(elements.backtestEquity.value) || 100000,
      ...values,
      from: `${values.from}T00:00:00Z`,
      to: `${values.to}T23:59:59Z`,
    };
    for (const field of [
      "minVolumeINR",
      "maxPositions",
      "trailPct",
      "tpPct",
      "rebalanceFreq",
      "sessionMinutes",
      "leverage",
      "smallCoinMaxHoldHours",
    ]) {
      if (payload[field] !== undefined) payload[field] = Number(payload[field]);
    }
    await openBacktestStream();
    const response = await fetch(BACKTEST_ENDPOINTS[strategy], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || `HTTP ${response.status}`);
    renderBacktestStats(result);
    elements.backtestResults.classList.remove("hidden");
    const primaryResult = getPrimaryBacktestResult(result);
    renderBacktestChart(primaryResult);
    const summary = backtestSummary(primaryResult);
    const trades = firstFinite(summary.positionsOpened, summary.tradeCount);
    const sessions = firstFinite(summary.sessionsRun, summary.sessionCount);
    elements.backtestStatus.textContent =
      strategy === "sessionMomentum"
        ? `Done: ${Number.isFinite(sessions) ? sessions : 0} sessions, ${Number.isFinite(trades) ? trades : 0} positions opened.`
        : `Done: ${Number.isFinite(trades) ? trades : 0} trades${Number.isFinite(summary.durationDays) ? ` over ${Math.round(summary.durationDays)} days` : ""}.`;
  } catch (error) {
    elements.backtestStatus.textContent = `Backtest failed: ${error.message}`;
  } finally {
    state.isBacktestRunning = false;
    elements.backtestRunButton.disabled = false;
    elements.backtestSpinner.classList.add("hidden");
  }
}

// --- Session Momentum: paper session, live status and five-step gate ---

const SESSION_STATUS_REFRESH_INTERVAL_MS = 5_000;
const SESSION_ROUTES = {
  status: "/api/session-momentum/status",
  paperStart: "/api/session-momentum/paper/start",
  paperRenew: "/api/session-momentum/paper/renew",
  paperEnd: "/api/session-momentum/paper/end",
  livePreflight: "/api/session-momentum/live/preflight",
  livePrepare: "/api/session-momentum/live/prepare",
  liveApproveConversion: "/api/session-momentum/live/approve-conversion",
  liveStart: "/api/session-momentum/live/start",
  liveRenew: "/api/session-momentum/live/renew",
  liveStop: "/api/session-momentum/live/stop",
};

function sessionConfig(source = state.sessionMomentum?.config || {}) {
  return {
    sessionMinutes: firstFinite(source.sessionMinutes, source.SESSION_MINUTES, 60),
    trailPct: firstFinite(source.trailPct, source.TRAIL_PCT, 6),
    maxPositions: firstFinite(source.maxPositions, source.MAX_POSITIONS, 2),
    paperLeverage: firstFinite(source.paperLeverage, source.PAPER_LEVERAGE, source.leverage, 5),
    liveLeverage: firstFinite(source.liveLeverage, source.LIVE_LEVERAGE, source.leverage, 3),
    smallCoinMaxHoldHours: firstFinite(source.smallCoinMaxHoldHours, source.maxHoldHours, 24),
  };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSessionPayload(payload) {
  const envelope = objectValue(payload);
  const nested = objectValue(envelope.sessionMomentum);
  const status = objectValue(envelope.status);
  const root = Object.keys(nested).length ? nested : Object.keys(status).length ? status : envelope;
  return {
    ...root,
    paper: objectValue(root.paper || envelope.paper),
    live: objectValue(root.live || envelope.live),
    config: objectValue(root.config || envelope.config),
    updatedAt: root.updatedAt || envelope.updatedAt || Date.now(),
  };
}

function sessionStateName(session) {
  const value = session?.state ?? session?.status ?? session?.sessionState;
  if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
  return session?.running === true || session?.active === true ? "RUNNING" : "IDLE";
}

function sessionIsRunning(session) {
  return session?.running === true || session?.active === true || sessionStateName(session) === "RUNNING";
}

function timestampMs(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
      const number = Number(value);
      if (Number.isFinite(number)) return number < 10_000_000_000 ? number * 1_000 : number;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sessionEndTimestamp(session, config) {
  const direct = timestampMs(
    session?.expiresAt,
    session?.sessionExpiresAt,
    session?.endsAt,
    session?.endAt,
    session?.expiry,
  );
  if (Number.isFinite(direct)) return direct;
  const remaining = firstFinite(session?.remainingMs, session?.timeRemainingMs);
  if (Number.isFinite(remaining)) return Date.now() + Math.max(0, remaining);
  const startedAt = timestampMs(session?.startedAt, session?.sessionStartedAt, session?.startTime);
  return Number.isFinite(startedAt) ? startedAt + config.sessionMinutes * 60_000 : null;
}

function formatSessionDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "Not running";
  if (milliseconds <= 0) return "Expired";
  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatPositionHeld(position) {
  const suppliedHours = firstFinite(position.timeHeldHours, position.heldHours);
  if (Number.isFinite(suppliedHours)) return `${suppliedHours.toFixed(1)}h`;
  const openedAt = timestampMs(position.entryTime, position.enteredAt, position.openedAt, position.createdAt);
  if (!Number.isFinite(openedAt)) return "\u2014";
  const heldMs = Math.max(0, Date.now() - openedAt);
  if (heldMs < 3_600_000) return `${Math.floor(heldMs / 60_000)}m`;
  return `${(heldMs / 3_600_000).toFixed(1)}h`;
}

function activeSessionView(view = state.sessionMomentum) {
  if (!view) return { mode: null, session: {}, running: false };
  if (sessionIsRunning(view.live)) return { mode: "live", session: view.live, running: true };
  if (sessionIsRunning(view.paper)) return { mode: "paper", session: view.paper, running: true };
  const liveState = sessionStateName(view.live);
  const paperState = sessionStateName(view.paper);
  if (liveState === "EXPIRED") return { mode: "live", session: view.live, running: false };
  if (paperState === "EXPIRED") return { mode: "paper", session: view.paper, running: false };
  return { mode: null, session: view.paper || {}, running: false };
}

function renderSessionPositions(positions, config, mode) {
  elements.sessionPositionCount.textContent = `${positions.length} open position${positions.length === 1 ? "" : "s"}`;
  elements.sessionPositionNote.textContent = `${config.trailPct}% trail · no take-profit`;
  if (!positions.length) {
    elements.sessionPositionRows.innerHTML =
      '<tr><td class="account-placeholder" colspan="10">No open Session Momentum positions.</td></tr>';
    return;
  }

  elements.sessionPositionRows.innerHTML = positions.map((position) => {
    const symbol = position.symbol || position.market || position.pair || "Unknown";
    const entry = firstFinite(position.entryPrice, position.entry);
    const current = firstFinite(position.markPrice, position.currentPrice, position.current, position.price);
    const highest = firstFinite(position.highestPrice, position.highest, entry);
    const stop = firstFinite(position.trailingStop, position.stopPrice, position.stop);
    const leverage = firstFinite(position.leverage, mode === "live" ? config.liveLeverage : config.paperLeverage);
    const margin = firstFinite(position.marginUsedINR, position.marginINR, position.marginUsedInr, position.marginInr, position.marginUsed, position.margin);
    const pnl = firstFinite(position.unrealizedPnlINR, position.unrealizedPnlInr, position.unrealizedPnl, position.pnlINR, position.pnlInr, position.pnl);
    const pnlClass = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
    const bigCoin = position.isBigCoin === true || /^(BIG|BIG_COIN)$/i.test(position.coinClass || position.classification || "");
    return `<tr>
      <td>${escapeHtml(symbol)}</td>
      <td><span class="status-badge ${bigCoin ? "held" : ""}">${bigCoin ? "BIG COIN" : "SMALL COIN"}</span></td>
      <td class="align-right">${formatInr(entry)}</td>
      <td class="align-right">${formatInr(current)}</td>
      <td class="align-right">${formatInr(highest)}</td>
      <td class="align-right">${formatInr(stop)}</td>
      <td class="align-right">${Number.isFinite(leverage) ? `${leverage}x` : "\u2014"}</td>
      <td class="align-right">${formatInr(margin)}</td>
      <td class="align-right ${pnlClass}">${formatSignedInr(pnl)}</td>
      <td class="align-right">${formatPositionHeld(position)}</td>
    </tr>`;
  }).join("");
}

function renderSessionLog(entries) {
  const log = (Array.isArray(entries) ? entries : []).slice(-30);
  elements.sessionLogCount.textContent = `${log.length} event${log.length === 1 ? "" : "s"}`;
  elements.sessionLog.innerHTML = log.length
    ? log.map((entry) => {
        const item = typeof entry === "string" ? { message: entry } : objectValue(entry);
        const when = timestampMs(item.timestamp, item.time, item.createdAt);
        const type = item.type || item.event || item.reason || "EVENT";
        const message = item.message || item.detail || item.text || "";
        return `<div class="runner-log-line"><time>${Number.isFinite(when) ? new Date(when).toLocaleString("en-IN") : "\u2014"}</time><strong>${escapeHtml(type)}</strong><span>${escapeHtml(message)}</span></div>`;
      }).join("")
    : '<p class="account-placeholder">No session events yet.</p>';
  elements.sessionLog.scrollTop = elements.sessionLog.scrollHeight;
}

function renderSessionMomentum(payload) {
  const view = normalizeSessionPayload(payload);
  state.sessionMomentum = view;
  const config = sessionConfig(view.config);
  const active = activeSessionView(view);
  const liveRunning = sessionIsRunning(view.live);
  const paperRunning = sessionIsRunning(view.paper);
  const stateName = active.mode ? sessionStateName(active.session) : "IDLE";
  const leverage = active.mode === "live" ? config.liveLeverage : config.paperLeverage;
  const positions = Array.isArray(active.session.positions)
    ? active.session.positions
    : Array.isArray(view.positions) ? view.positions : [];

  elements.sessionModeBadge.className = `session-mode-badge ${liveRunning ? "live" : paperRunning ? "paper" : "idle"}`;
  elements.sessionModeBadge.textContent = liveRunning
    ? `LIVE · ${stateName}`
    : paperRunning ? `PAPER · ${stateName}` : stateName;
  elements.sessionPaperToggle.checked = paperRunning;
  elements.sessionPaperToggle.disabled = liveRunning || state.sessionActionPending;
  elements.sessionGoLiveButton.disabled = liveRunning || state.sessionActionPending;
  elements.sessionGoLiveButton.textContent = liveRunning ? "Live session running" : "Go Live";
  elements.sessionLiveStopButton.classList.toggle("hidden", !liveRunning);
  elements.sessionLiveStopButton.disabled = state.sessionActionPending;
  elements.sessionRenewButton.disabled = !active.running || state.sessionActionPending;
  elements.sessionRenewButton.textContent = active.mode === "live" ? "Renew live session" : "Renew session";
  elements.sessionEndButton.classList.toggle("hidden", liveRunning);
  elements.sessionEndButton.disabled = !paperRunning || state.sessionActionPending;

  elements.sessionConfigSummary.textContent =
    `Qualified top-gainers universe · ${config.trailPct}% trailing stop · ${config.sessionMinutes}-minute session · up to ${config.maxPositions} positions`;
  const equity = firstFinite(active.session.equityInr, active.session.equity, view.equityInr, view.equity);
  const cash = firstFinite(active.session.cashInr, active.session.cash, active.session.availableCashInr, view.cashInr, view.cash);
  const margin = firstFinite(active.session.marginUsedINR, active.session.marginUsedInr, active.session.marginUsed, view.marginUsedINR, view.marginUsedInr, view.marginUsed, 0);
  const exposure = firstFinite(active.session.exposureINR, active.session.exposureInr, active.session.exposure, active.session.notionalINR, active.session.notionalInr, view.exposureINR, view.exposureInr, view.exposure, Number.isFinite(margin) ? margin * leverage : null);
  elements.sessionEquity.textContent = formatInr(equity);
  elements.sessionEquityNote.textContent = active.mode === "live" ? "Real CoinDCX portfolio equity" : "Paper portfolio value";
  elements.sessionCash.textContent = formatInr(cash);
  elements.sessionMarginUsed.textContent = formatInr(margin);
  elements.sessionLeverageNote.textContent = `${active.mode === "live" ? "Live" : "Paper"} leverage ${leverage}x`;
  elements.sessionExposure.textContent = formatInr(exposure);
  renderSessionPositions(positions, config, active.mode || "paper");
  renderSessionLog(active.session.log || active.session.events || view.log || view.events || []);

  state.sessionActiveMode = active.running ? active.mode : null;
  state.sessionEndAt = active.running ? sessionEndTimestamp(active.session, config) : null;
  state.sessionKey = active.running
    ? String(active.session.sessionId || active.session.id || timestampMs(active.session.startedAt, active.session.sessionStartedAt) || active.mode)
    : null;
  if (!state.sessionActionPending) {
    elements.sessionActionStatus.textContent = liveRunning
      ? "LIVE trading active. The kill switch closes every live position immediately."
      : paperRunning ? "Paper session active. No real orders are placed." : "Paper mode ready.";
  }
  updateSessionCountdown();
}

function updateSessionCountdown() {
  if (!state.sessionActiveMode || !Number.isFinite(state.sessionEndAt)) {
    elements.sessionRemaining.textContent = state.sessionActiveMode ? "Timer unavailable" : "Not running";
    elements.sessionRemaining.classList.remove("urgent");
    elements.sessionRenewToast.classList.add("hidden");
    return;
  }
  const remaining = state.sessionEndAt - Date.now();
  elements.sessionRemaining.textContent = formatSessionDuration(remaining);
  elements.sessionRemaining.classList.toggle("urgent", remaining > 0 && remaining <= 10 * 60_000);
  const shouldToast = state.sessionActiveMode === "live" && remaining > 0 && remaining <= 10 * 60_000;
  const dismissed = state.sessionRenewToastDismissedFor === state.sessionKey;
  elements.sessionRenewToast.classList.toggle("hidden", !shouldToast || dismissed);
  if (shouldToast && !dismissed) state.sessionRenewToastFor = state.sessionKey;
}

async function sessionPost(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  return payload;
}

async function loadSessionMomentum() {
  if (state.sessionLoading) return;
  state.sessionLoading = true;
  try {
    const response = await fetch(SESSION_ROUTES.status, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    renderSessionMomentum(payload);
  } catch (error) {
    if (!state.sessionMomentum) {
      elements.sessionActionStatus.textContent = `Session Momentum unavailable: ${error.message}`;
    }
  } finally {
    state.sessionLoading = false;
  }
}

async function runSessionAction(url, pendingText, successText) {
  if (state.sessionActionPending) return null;
  state.sessionActionPending = true;
  elements.sessionActionStatus.textContent = pendingText;
  try {
    const payload = await sessionPost(url);
    if (payload && typeof payload === "object") renderSessionMomentum(payload);
    elements.sessionActionStatus.textContent = successText;
    return payload;
  } catch (error) {
    elements.sessionActionStatus.textContent = `Action failed: ${error.message}`;
    throw error;
  } finally {
    state.sessionActionPending = false;
    const actionMessage = elements.sessionActionStatus.textContent;
    if (state.sessionMomentum) renderSessionMomentum(state.sessionMomentum);
    await loadSessionMomentum();
    elements.sessionActionStatus.textContent = actionMessage;
  }
}

async function toggleSessionPaper(event) {
  const enabled = event.target.checked;
  event.target.disabled = true;
  try {
    await runSessionAction(
      enabled ? SESSION_ROUTES.paperStart : SESSION_ROUTES.paperEnd,
      enabled ? "Starting paper session..." : "Ending paper session and closing positions...",
      enabled ? "Paper session started." : "Paper session ended; all paper positions closed.",
    );
  } catch {
    event.target.checked = !enabled;
  } finally {
    event.target.disabled = sessionIsRunning(state.sessionMomentum?.live);
  }
}

async function renewSessionMomentum() {
  const active = activeSessionView();
  if (!active.running) return;
  state.sessionRenewToastDismissedFor = null;
  state.sessionRenewToastFor = null;
  elements.sessionRenewToast.classList.add("hidden");
  try {
    await runSessionAction(
      active.mode === "live" ? SESSION_ROUTES.liveRenew : SESSION_ROUTES.paperRenew,
      "Renewing session timer...",
      "Session renewed; positions continue with the same stops.",
    );
  } catch {
    // Inline action status already contains the error.
  }
}

async function endPaperSessionMomentum() {
  try {
    await runSessionAction(
      SESSION_ROUTES.paperEnd,
      "Ending paper session and closing positions...",
      "Paper session ended; all paper positions closed.",
    );
  } catch {
    // Inline action status already contains the error.
  }
}

async function stopLiveSessionMomentum() {
  try {
    await runSessionAction(
      SESSION_ROUTES.liveStop,
      "STOPPING LIVE: closing every position at market...",
      "Live session stopped; close-all request completed.",
    );
  } catch {
    // Keep the red kill switch visible after a failed close attempt.
  }
}

function resetLiveGateState(config = state.sessionMomentum?.config || {}) {
  state.liveGate = {
    step: 1,
    gateId: null,
    account: null,
    config: objectValue(config),
    conversionPlan: null,
    preflight: null,
    pending: false,
  };
}

function renderLiveGateShell(step, title, body, actions, errorMessage = "") {
  state.liveGate.step = step;
  elements.liveGateCloseButton.disabled = Boolean(state.liveGate.pending);
  elements.liveGateStep.textContent = `LIVE TRADING GATE · STEP ${step} OF 5`;
  elements.liveGateTitle.textContent = title;
  elements.liveGateBody.innerHTML = body;
  elements.liveGateActions.innerHTML = actions;
  elements.liveGateError.textContent = errorMessage;
  elements.liveGateError.classList.toggle("hidden", !errorMessage);
}

function liveGateButtons(buttons) {
  return buttons.map((button) =>
    `<button type="button" class="${escapeHtml(button.className || "")}" data-live-action="${escapeHtml(button.action)}" ${button.disabled ? "disabled" : ""}>${escapeHtml(button.label)}</button>`,
  ).join("");
}

function renderLiveGateStep1(errorMessage = "") {
  const config = sessionConfig(state.liveGate.config || state.sessionMomentum?.config);
  renderLiveGateShell(
    1,
    "Switch to LIVE trading?",
    `<div class="live-gate-copy">
      <p>You are about to trade with <strong>REAL money</strong> on CoinDCX.<br />This is NOT paper trading. Losses will be real.</p>
      <dl class="live-gate-summary">
        <div><dt>Current strategy:</dt><dd>Session Momentum</dd></div>
        <div><dt>Leverage:</dt><dd>${config.liveLeverage}x</dd></div>
        <div><dt>Trailing stop:</dt><dd>${config.trailPct}%</dd></div>
        <div><dt>Session length:</dt><dd>${config.sessionMinutes} minutes</dd></div>
        <div><dt>Max positions:</dt><dd>${config.maxPositions}</dd></div>
      </dl>
    </div>`,
    liveGateButtons([
      { action: "cancel", label: "Cancel", className: "ghost-button" },
      { action: "continue", label: "Continue", className: "live-continue-button" },
    ]),
    errorMessage,
  );
}

function accountHoldings(account) {
  const spotHoldings = Array.isArray(account?.holdings)
    ? account.holdings
    : Array.isArray(account?.nonInrHoldings) ? account.nonInrHoldings : [];
  const futuresHoldings = Array.isArray(account?.futuresWallets)
    ? account.futuresWallets.map((holding) => ({ ...holding, wallet: "Futures" }))
    : [];
  const holdings = [...spotHoldings, ...futuresHoldings];
  return holdings.map((holding) => {
    const item = objectValue(holding);
    const currency = String(item.currency || item.asset || item.symbol || item.coin || "").toUpperCase();
    const available = firstFinite(item.available, item.balance, item.quantity, item.total, 0);
    const total = firstFinite(item.total, item.quantity, item.balance, item.available, 0);
    const priceInr = firstFinite(item.priceInr, item.currentPriceInr, item.price);
    const valueInr = firstFinite(
      item.valueInr,
      item.currentValueInr,
      item.estimatedValueInr,
      Number.isFinite(total) && Number.isFinite(priceInr) ? total * priceInr : null,
    );
    return {
      ...item,
      currency,
      wallet: item.wallet || "Spot",
      available,
      total,
      priceInr,
      valueInr,
    };
  });
}

function accountInrAvailable(account) {
  const inr = accountHoldings(account).find((holding) => holding.currency === "INR");
  return firstFinite(
    account?.inrAvailable,
    account?.availableInr,
    account?.inrBalance,
    account?.cashAvailableInr,
    inr?.available,
    account?.cashBalanceInr,
    inr?.total,
    0,
  );
}

function nonInrHoldings(account) {
  return accountHoldings(account).filter((holding) => holding.currency && holding.currency !== "INR" && holding.total > 0);
}

function estimatedConversionInr(account, context = {}) {
  const estimated = firstFinite(
    context.estimatedInr,
    context.estimatedConversionInr,
    context.estimatedNetInr,
    context.totalEstimatedInr,
    account?.estimatedConversionInr,
  );
  if (Number.isFinite(estimated)) return estimated;
  const convertible = Array.isArray(account?.nonInrHoldings)
    ? account.nonInrHoldings
    : nonInrHoldings(account).filter((holding) => holding.wallet !== "Futures");
  return convertible.reduce((sum, holding) =>
    sum + (Number.isFinite(Number(holding.valueInr)) ? Number(holding.valueInr) : 0), 0);
}

function accountTotalInr(account) {
  const total = firstFinite(account?.totalPortfolioValueInr, account?.totalValueInr, account?.portfolioValueInr);
  if (Number.isFinite(total)) return total;
  const holdings = accountHoldings(account);
  const holdingsTotal = holdings.reduce((sum, holding) => sum + (Number.isFinite(holding.valueInr) ? holding.valueInr : 0), 0);
  return holdings.some((holding) => holding.currency === "INR") ? holdingsTotal : holdingsTotal + accountInrAvailable(account);
}

function renderLiveGateStep2() {
  const account = objectValue(state.liveGate.account);
  const holdings = nonInrHoldings(account);
  const convertibleHoldings = Array.isArray(account.nonInrHoldings)
    ? account.nonInrHoldings.filter((holding) => firstFinite(holding.available, holding.total, 0) > 0)
    : holdings.filter((holding) => holding.wallet !== "Futures");
  const inrAvailable = accountInrAvailable(account);
  const estimated = estimatedConversionInr(account, state.liveGate.preflight || {});
  const holdingRows = holdings.length
    ? holdings.map((holding) => `<tr><td>${escapeHtml(holding.currency)}${holding.wallet === "Futures" ? " <small>(Futures)</small>" : ""}</td><td class="align-right">${formatAmount(holding.total, 8)}</td><td class="align-right">${formatInr(holding.valueInr)}</td></tr>`).join("")
    : '<tr><td class="account-placeholder" colspan="3">No non-INR holdings.</td></tr>';
  renderLiveGateShell(
    2,
    "Balance check",
    `<div class="live-balance-summary">
      <div><span>INR available</span><strong>${formatInr(inrAvailable)}</strong><small>Spot ${formatInr(firstFinite(account.spotInrAvailable, inrAvailable))} · Futures ${formatInr(firstFinite(account.futuresInrAvailable, 0))}</small></div>
      <div><span>Total portfolio value</span><strong>${formatInr(accountTotalInr(account))}</strong></div>
    </div>
    <div class="live-holdings-table"><h4>Non-INR holdings</h4><div class="account-table-scroll"><table class="account-table"><thead><tr><th>Coin</th><th class="align-right">Balance</th><th class="align-right">Current INR value</th></tr></thead><tbody>${holdingRows}</tbody></table></div></div>
    <div class="live-gate-question">
      <strong>Convert existing crypto holdings to INR before trading?</strong>
      <p>If YES: we will place market SELL orders for ALL non-INR balances to raise ${formatInr(estimated)} INR for the strategy.</p>
      <p>If NO: we will only use your existing INR balance ${formatInr(inrAvailable)}. If INR balance is below &#8377;100, we cannot start.</p>
    </div>`,
    liveGateButtons([
      { action: "cancel", label: "Cancel", className: "ghost-button" },
      { action: "prepare-convert", label: "Convert to INR", className: "conversion-button", disabled: convertibleHoldings.length === 0 },
      { action: "prepare-existing", label: "Use existing INR only", className: "live-continue-button", disabled: inrAvailable < 100 },
    ]),
  );
}

function conversionPlanRows(plan) {
  const root = objectValue(plan);
  const rows = Array.isArray(plan)
    ? plan
    : Array.isArray(root.sells) ? root.sells
      : Array.isArray(root.holdings) ? root.holdings
        : Array.isArray(root.orders) ? root.orders : [];
  return rows.map((row) => {
    const item = objectValue(row);
    return {
      currency: String(item.currency || item.asset || item.symbol || item.coin || "Unknown").toUpperCase(),
      priceInr: firstFinite(item.priceInr, item.currentPriceInr, item.currentPrice, item.price),
      valueInr: firstFinite(item.estimatedSellValueInr, item.estimatedValueInr, item.valueInr, item.grossInr),
      feeInr: firstFinite(item.feeInr, item.estimatedFeeInr, item.fee, 0),
      tdsInr: firstFinite(item.tdsInr, item.estimatedTdsInr, item.tds, 0),
    };
  });
}

function conversionPlanTotal(plan, rows) {
  const root = objectValue(plan);
  return firstFinite(
    root.totalValueInr,
    root.totalEstimatedInr,
    root.estimatedSellValueInr,
    root.estimatedNetInr,
    root.totalInr,
    rows.reduce((sum, row) => sum + (Number.isFinite(row.valueInr) ? row.valueInr : 0), 0),
  );
}

function conversionPlanCapitalAfter(plan, rows) {
  const root = objectValue(plan);
  return firstFinite(
    root.estimatedInrAfterConversion,
    root.availableCapitalInr,
    root.projectedCapitalInr,
    root.estimatedConversionNetInr,
    conversionPlanTotal(plan, rows),
  );
}

function renderLiveGateStep3() {
  const rows = conversionPlanRows(state.liveGate.conversionPlan);
  const total = conversionPlanTotal(state.liveGate.conversionPlan, rows);
  const capitalAfter = conversionPlanCapitalAfter(state.liveGate.conversionPlan, rows);
  const bodyRows = rows.length
    ? rows.map((row) => `<tr><td>${escapeHtml(row.currency)}</td><td class="align-right">${formatInr(row.priceInr)}</td><td class="align-right">${formatInr(row.valueInr)}</td><td class="align-right negative">${formatInr(row.feeInr)}</td><td class="align-right negative">${formatInr(row.tdsInr)}</td></tr>`).join("")
    : '<tr><td class="account-placeholder" colspan="5">No eligible sell orders were returned.</td></tr>';
  renderLiveGateShell(
    3,
    "Planned sells",
    `<p class="live-gate-lead">Review every market sell before converting the account to INR.</p>
    <div class="account-table-scroll live-conversion-table"><table class="account-table"><thead><tr><th>Holding</th><th class="align-right">Current price</th><th class="align-right">Estimated sell value</th><th class="align-right">Fee</th><th class="align-right">TDS</th></tr></thead><tbody>${bodyRows}</tbody></table></div>
    <div class="live-conversion-total"><span>Total estimated INR after conversion</span><strong>${formatInr(capitalAfter)}</strong></div>`,
    liveGateButtons([
      { action: "cancel", label: "Cancel", className: "ghost-button" },
      { action: "approve-conversion", label: `Sell ${formatInr(total)} of crypto to INR`, className: "live-danger-approval", disabled: rows.length === 0 || total <= 0 },
    ]),
  );
}

function renderLiveGateStep4() {
  const config = sessionConfig(state.liveGate.config || state.sessionMomentum?.config);
  const capital = firstFinite(
    state.liveGate.conversionPlan?.estimatedInrAfterConversion,
    state.liveGate.preflight?.availableCapitalInr,
    accountInrAvailable(state.liveGate.account),
  );
  const exposure = firstFinite(state.liveGate.preflight?.exposureInr, capital * config.liveLeverage);
  const maxLoss = firstFinite(
    state.liveGate.preflight?.estimatedMaxLossPerStop,
    state.liveGate.preflight?.maxLossPerStop,
    (capital / Math.max(1, config.maxPositions)) * config.liveLeverage * (config.trailPct / 100),
  );
  renderLiveGateShell(
    4,
    "Final confirmation",
    `<div class="live-final-copy">
      <p>Type <strong>LIVE</strong> below to start real-money trading.</p>
      <dl class="live-gate-summary">
        <div><dt>Available capital:</dt><dd>${formatInr(capital)}</dd></div>
        <div><dt>Leverage:</dt><dd>${config.liveLeverage}x <span>(${formatInr(exposure)} exposure)</span></dd></div>
        <div><dt>Estimated max loss per stop-out:</dt><dd>${formatInr(maxLoss)}</dd></div>
      </dl>
      <p>This action places real orders. There is no undo.</p>
      <label class="live-confirmation-label"><span>Type LIVE exactly (case-sensitive)</span><input id="liveConfirmationInput" autocomplete="off" spellcheck="false" /></label>
    </div>`,
    liveGateButtons([
      { action: "cancel", label: "Cancel", className: "ghost-button" },
      { action: "start-live", label: "Start Live Session", className: "live-danger-approval", disabled: true },
    ]).replace('data-live-action="start-live"', 'id="liveStartButton" data-live-action="start-live"'),
  );
  elements.liveGateBody.querySelector("#liveConfirmationInput")?.focus();
}

function renderLiveGateStep5() {
  state.liveGate.pending = true;
  elements.liveGateCloseButton.disabled = true;
  renderLiveGateShell(
    5,
    "Server-side final gate",
    '<div class="live-gate-loading"><span class="backtest-spinner" aria-hidden="true"></span><strong>Verifying environment flag, API credentials, balance and active-session state...</strong><p>No real order can fire until every server check passes.</p></div>',
    "",
  );
}

function closeLiveGate(force = false) {
  if (state.liveGate.pending && !force) return;
  elements.liveGateModal.classList.add("hidden");
  resetLiveGateState();
}

function openLiveGate() {
  resetLiveGateState(state.sessionMomentum?.config);
  elements.liveGateModal.classList.remove("hidden");
  renderLiveGateStep1();
}

function resetLiveGateWithError(error) {
  const config = state.liveGate.config || state.sessionMomentum?.config;
  resetLiveGateState(config);
  renderLiveGateStep1(error instanceof Error ? error.message : String(error));
}

function setLiveGatePending(pending) {
  state.liveGate.pending = pending;
  elements.liveGateCloseButton.disabled = pending;
  elements.liveGateActions.querySelectorAll("button").forEach((button) => {
    button.disabled = pending || button.disabled;
  });
}

async function liveGatePreflight() {
  setLiveGatePending(true);
  renderLiveGateShell(
    2,
    "Balance check",
    '<div class="live-gate-loading"><span class="backtest-spinner" aria-hidden="true"></span><strong>Querying your authenticated CoinDCX balance...</strong></div>',
    "",
  );
  try {
    const payload = await sessionPost(SESSION_ROUTES.livePreflight);
    state.liveGate.preflight = payload;
    state.liveGate.gateId = payload.gateId || payload.gate?.id || null;
    state.liveGate.account = objectValue(payload.account || payload.balance || payload.portfolio || payload);
    state.liveGate.config = objectValue(payload.config || state.liveGate.config);
    state.liveGate.pending = false;
    renderLiveGateStep2();
  } catch (error) {
    resetLiveGateWithError(error);
  }
}

async function liveGatePrepare(convertToInr) {
  setLiveGatePending(true);
  try {
    const payload = await sessionPost(SESSION_ROUTES.livePrepare, {
      gateId: state.liveGate.gateId,
      convertToInr,
    });
    state.liveGate.gateId = payload.gateId || state.liveGate.gateId;
    state.liveGate.account = objectValue(payload.account || state.liveGate.account);
    state.liveGate.config = objectValue(payload.config || state.liveGate.config);
    state.liveGate.conversionPlan = payload.conversionPlan || payload.plan || null;
    state.liveGate.pending = false;
    if (convertToInr) renderLiveGateStep3();
    else renderLiveGateStep4();
  } catch (error) {
    resetLiveGateWithError(error);
  }
}

async function liveGateApproveConversion() {
  setLiveGatePending(true);
  elements.liveGateError.textContent =
    "Conversion approved. No order is sent until the final LIVE confirmation and server gate pass.";
  elements.liveGateError.classList.remove("hidden");
  try {
    const payload = await sessionPost(SESSION_ROUTES.liveApproveConversion, { gateId: state.liveGate.gateId });
    state.liveGate.gateId = payload.gateId || state.liveGate.gateId;
    state.liveGate.account = objectValue(payload.account || payload.balance || state.liveGate.account);
    state.liveGate.config = objectValue(payload.config || state.liveGate.config);
    state.liveGate.pending = false;
    renderLiveGateStep4();
  } catch (error) {
    resetLiveGateWithError(error);
  }
}

async function liveGateStart() {
  const input = elements.liveGateBody.querySelector("#liveConfirmationInput");
  if (input?.value !== "LIVE") return;
  renderLiveGateStep5();
  try {
    const payload = await sessionPost(SESSION_ROUTES.liveStart, {
      gateId: state.liveGate.gateId,
      confirmation: "LIVE",
    });
    closeLiveGate(true);
    renderSessionMomentum(payload);
    elements.sessionActionStatus.textContent = "LIVE session started. Real orders are enabled for Session Momentum.";
    await loadSessionMomentum();
  } catch (error) {
    resetLiveGateWithError(error);
  }
}

async function handleLiveGateAction(event) {
  const button = event.target.closest("button[data-live-action]");
  if (!button || state.liveGate.pending) return;
  const action = button.dataset.liveAction;
  if (action === "cancel") closeLiveGate();
  else if (action === "continue") await liveGatePreflight();
  else if (action === "prepare-convert") await liveGatePrepare(true);
  else if (action === "prepare-existing") await liveGatePrepare(false);
  else if (action === "approve-conversion") await liveGateApproveConversion();
  else if (action === "start-live") await liveGateStart();
}

function renderTopGainersPanel(status, universe, positionsPayload, logPayload) {
  const positions = positionsPayload.positions || [];
  state.topGainers = { status, universe, positions, log: logPayload.log || [] };
  const unrealized = positions.reduce((sum, position) => sum + (position.current - position.entry) * position.qty, 0);
  elements.topGainersToggle.checked = Boolean(status.enabled);
  elements.topGainersEquity.textContent = formatInr(status.equity);
  elements.topGainersCash.textContent = formatInr(status.cash);
  elements.topGainersUnrealized.textContent = formatInr(unrealized);
  elements.topGainersUnrealized.className = unrealized > 0 ? "positive" : unrealized < 0 ? "negative" : "";
  elements.topGainersRealized.textContent = formatInr(status.realizedPnlToday);
  elements.topGainersRealized.className = status.realizedPnlToday > 0 ? "positive" : status.realizedPnlToday < 0 ? "negative" : "";
  elements.topGainersEnabledText.textContent = status.enabled ? "Runner enabled" : "Runner disabled";
  elements.topGainersPositionCount.textContent = `${positions.length} open position${positions.length === 1 ? "" : "s"}`;
  elements.topGainersUniverseStats.textContent = `${universe.metadata.aboveVolumeFloor} of ${universe.metadata.totalINRPairs} INR pairs above ${formatInr(universe.metadata.minVolumeINR)} floor`;

  const slotSize = status.equity * (1 - status.config.cashReservePct / 100) / status.config.maxPositions;
  elements.topGainersUniverseRows.innerHTML = universe.rows.length
    ? universe.rows.map((row) => {
        const highRisk = slotSize > row.volumeINR * 0.01;
        const cooldown = row.cooldownUntil > Date.now();
        const badge = row.held
          ? '<span class="status-badge held">HELD</span>'
          : cooldown
            ? '<span class="status-badge cooldown">COOLDOWN</span>'
            : '<span class="status-badge">WATCH</span>';
        return `<tr class="${highRisk ? "slippage-risk" : ""}"><td>${row.rank}</td><td>${escapeHtml(row.market)}</td><td class="align-right positive">${formatPercent(row.change24h, true)}</td><td class="align-right">${formatInr(row.volumeINR)}</td><td class="align-right">${badge}</td></tr>`;
      }).join("")
    : '<tr><td class="account-placeholder" colspan="5">No INR pair currently clears the volume floor.</td></tr>';

  elements.topGainersPositionRows.innerHTML = positions.length
    ? positions.map((position) => {
        const pnlClass = position.unrealizedPct > 0 ? "positive" : position.unrealizedPct < 0 ? "negative" : "";
        return `<tr><td>${escapeHtml(position.symbol)}</td><td class="align-right">${formatPrice(position.entry, "INR")}</td><td class="align-right">${formatPrice(position.current, "INR")}</td><td class="align-right">${formatPrice(position.highest, "INR")}</td><td class="align-right">${formatPrice(position.stop, "INR")}</td><td class="align-right">${formatPrice(position.tp, "INR")}</td><td class="align-right ${pnlClass}">${formatPercent(position.unrealizedPct, true)}</td><td class="align-right">${formatPercent(position.distanceToStopPct)}</td><td class="align-right">${formatPercent(position.distanceToTpPct)}</td><td class="align-right">${position.timeHeldHours.toFixed(1)}h</td></tr>`;
      }).join("")
    : '<tr><td class="account-placeholder" colspan="10">No open paper positions.</td></tr>';

  const events = (logPayload.log || []).slice(-20);
  elements.topGainersLogCount.textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
  elements.topGainersLog.innerHTML = events.length
    ? events.map((entry) => `<div class="runner-log-line"><time>${new Date(entry.timestamp).toLocaleString("en-IN")}</time><strong>${escapeHtml(entry.type)}</strong><span>${escapeHtml(entry.message)}</span></div>`).join("")
    : '<p class="account-placeholder">No runner events yet.</p>';
  elements.topGainersLog.scrollTop = elements.topGainersLog.scrollHeight;
  updateTopGainersCountdown();
}

function updateTopGainersCountdown() {
  const next = state.topGainers?.status?.nextRescan;
  if (!next) {
    elements.topGainersNextRescan.textContent = "Next rescan —";
    return;
  }
  const seconds = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  elements.topGainersNextRescan.textContent = `Next rescan ${hours}h ${minutes}m ${remainder}s`;
}

async function loadTopGainers() {
  try {
    const responses = await Promise.all([
      fetch("/api/top-gainers/status"),
      fetch("/api/top-gainers/universe"),
      fetch("/api/top-gainers/positions"),
      fetch("/api/top-gainers/log?n=20"),
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    const failedIndex = responses.findIndex((response) => !response.ok);
    if (failedIndex >= 0) throw new Error(payloads[failedIndex].detail || payloads[failedIndex].error);
    renderTopGainersPanel(...payloads);
  } catch (error) {
    elements.topGainersUniverseStats.textContent = `Top-gainers unavailable: ${error.message}`;
  }
}

async function toggleTopGainers(event) {
  const enabled = event.target.checked;
  event.target.disabled = true;
  try {
    const response = await fetch("/api/top-gainers/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error);
    await loadTopGainers();
  } catch (error) {
    event.target.checked = !enabled;
    elements.topGainersEnabledText.textContent = `Toggle failed: ${error.message}`;
  } finally {
    event.target.disabled = false;
  }
}

elements.paperToggle.addEventListener("change", (event) => {
  state.paperEnabled = event.target.checked;
  localStorage.setItem("paperTradingEnabled", String(state.paperEnabled));
  loadSignals();
});

elements.signalsRefreshButton.addEventListener("click", loadSignals);
elements.backtestOpenButton.addEventListener("click", openBacktestModal);
elements.backtestCloseButton.addEventListener("click", closeBacktestModal);
elements.backtestModal.addEventListener("click", (event) => {
  if (event.target === elements.backtestModal) closeBacktestModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.backtestModal.classList.contains("hidden")) {
    closeBacktestModal();
  }
  if (event.key === "Escape" && !elements.liveGateModal.classList.contains("hidden") && !state.liveGate.pending) {
    closeLiveGate();
  }
});
elements.backtestStrategy.addEventListener("change", renderBacktestFields);
elements.backtestDynamicFields.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-session-preset]");
  if (button) applySessionBacktestPreset(button.dataset.sessionPreset);
});
elements.backtestForm.addEventListener("submit", runSelectedBacktestFromForm);
elements.topGainersToggle.addEventListener("change", toggleTopGainers);
elements.paperPositionRows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-symbol]");
  if (button) closePaperPosition(button.dataset.symbol);
});
elements.sessionPaperToggle.addEventListener("change", toggleSessionPaper);
elements.sessionRenewButton.addEventListener("click", renewSessionMomentum);
elements.sessionEndButton.addEventListener("click", endPaperSessionMomentum);
elements.sessionGoLiveButton.addEventListener("click", openLiveGate);
elements.sessionLiveStopButton.addEventListener("click", stopLiveSessionMomentum);
elements.sessionToastRenewButton.addEventListener("click", renewSessionMomentum);
elements.sessionToastDismissButton.addEventListener("click", () => {
  state.sessionRenewToastDismissedFor = state.sessionKey;
  elements.sessionRenewToast.classList.add("hidden");
});
elements.liveGateCloseButton.addEventListener("click", () => {
  if (!state.liveGate.pending) closeLiveGate();
});
elements.liveGateModal.addEventListener("click", (event) => {
  if (event.target === elements.liveGateModal && !state.liveGate.pending) closeLiveGate();
});
elements.liveGateActions.addEventListener("click", handleLiveGateAction);
elements.liveGateBody.addEventListener("input", (event) => {
  if (event.target.id !== "liveConfirmationInput") return;
  const startButton = elements.liveGateActions.querySelector("#liveStartButton");
  if (startButton) startButton.disabled = event.target.value !== "LIVE";
});

elements.paperToggle.checked = state.paperEnabled;

formatClock();
setInterval(formatClock, 1_000);
loadMarkets({ initial: true });
loadAccount();
loadTradePlan();
loadSignals();
loadRanking();
loadTopGainers();
loadSessionMomentum();
setInterval(loadMarkets, REFRESH_INTERVAL_MS);
setInterval(loadAccount, ACCOUNT_REFRESH_INTERVAL_MS);
setInterval(loadTradePlan, ACCOUNT_REFRESH_INTERVAL_MS);
setInterval(loadSignals, SIGNALS_REFRESH_INTERVAL_MS);
setInterval(loadRanking, SIGNALS_REFRESH_INTERVAL_MS);
setInterval(loadTopGainers, 30_000);
setInterval(updateTopGainersCountdown, 1_000);
setInterval(loadSessionMomentum, SESSION_STATUS_REFRESH_INTERVAL_MS);
setInterval(updateSessionCountdown, 1_000);
