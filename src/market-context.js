const BITGET_TICKER_URL = "https://api.bitget.com/api/v2/spot/market/tickers";
const DEFAULT_TIMEOUT_MS = 5000;

export async function getBitgetSpotContext(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    return {
      marketContext: {},
      warning: "Bitget ticker skipped because no valid trading pair was provided."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${BITGET_TICKER_URL}?symbol=${encodeURIComponent(normalizedSymbol)}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    const payload = await response.json();
    const ticker = payload?.data?.[0];

    if (!response.ok || payload?.code !== "00000" || !ticker) {
      return {
        marketContext: { bitgetContextStatus: "unavailable" },
        warning: `Bitget ticker unavailable for ${normalizedSymbol}.`
      };
    }

    const bid = toNumber(ticker.bidPr);
    const ask = toNumber(ticker.askPr);
    const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null;

    return {
      marketContext: {
        bitgetContextStatus: "live",
        bitgetSymbol: ticker.symbol ?? normalizedSymbol,
        bitgetTickerTime: formatTickerTime(ticker.ts),
        lastPrice: toNumber(ticker.lastPr),
        priceChange24hPct: toNumber(ticker.change24h) * 100,
        quoteVolume24hUsd: toNumber(ticker.usdtVolume ?? ticker.quoteVolume),
        bidPrice: bid,
        askPrice: ask,
        spreadBps: mid ? ((ask - bid) / mid) * 10000 : null
      },
      warning: null
    };
  } catch (error) {
    return {
      marketContext: { bitgetContextStatus: "unavailable" },
      warning: `Bitget ticker request failed: ${error.message}.`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSymbol(symbol) {
  const normalized = String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5,24}$/.test(normalized) ? normalized : "";
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTickerTime(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
