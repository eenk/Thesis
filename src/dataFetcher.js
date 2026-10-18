// Data Fetching Module for Twelve Data API with Live & Simulated Fallback Modes

/**
 * Generates realistic 90-day mock stock price data starting 90 trading days ago
 */
function generateMockPriceHistory(ticker, seedBasePrice, seedVol, seedTrend) {
  const data = [];
  const today = new Date();
  let price = seedBasePrice;

  // Generate ~90 trading days
  const tradingDays = [];
  let d = new Date(today);
  d.setDate(d.getDate() - 130);

  while (tradingDays.length < 90) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends
      tradingDays.push(d.toISOString().split('T')[0]);
    }
    d.setDate(d.getDate() + 1);
  }

  // Generate price trajectory with realistic random walk + drift
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let i = 0; i < tradingDays.length; i++) {
    const noise = (pseudoRandom() - 0.48) * seedVol;
    price = price * (1 + seedTrend + noise);
    if (price < 5) price = 5;

    data.push({
      date: tradingDays[i],
      open: parseFloat((price * 0.995).toFixed(2)),
      high: parseFloat((price * 1.01).toFixed(2)),
      low: parseFloat((price * 0.99).toFixed(2)),
      close: parseFloat(price.toFixed(2)),
      volume: Math.floor(1000000 + pseudoRandom() * 5000000)
    });
  }

  return data;
}

export const DEFAULT_COMPANIES = [
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'Energy', listing: 'NYSE' },
  { ticker: 'CVX', name: 'Chevron', sector: 'Energy', listing: 'NYSE' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Health care', listing: 'NYSE' },
  { ticker: 'ABBV', name: 'AbbVie', sector: 'Health care', listing: 'NYSE' },
  { ticker: 'BHP', name: 'BHP Group ADR', sector: 'Mining', listing: 'NYSE' },
  { ticker: 'NEM', name: 'Newmont', sector: 'Mining', listing: 'NYSE' },
  { ticker: 'RTX', name: 'RTX', sector: 'Aerospace and defense', listing: 'NYSE' },
  { ticker: 'LMT', name: 'Lockheed Martin', sector: 'Aerospace and defense', listing: 'NYSE' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Information technology', listing: 'NASDAQ' },
  { ticker: 'ORCL', name: 'Oracle', sector: 'Information technology', listing: 'NYSE' }
];

const DEFAULT_MOCK_PROFILES = {
  // Energy
  XOM: { price: 118.5, vol: 0.016, trend: 0.0006 },
  CVX: { price: 154.2, vol: 0.017, trend: 0.0005 },
  // Health care
  JNJ: { price: 162.0, vol: 0.011, trend: 0.0004 },
  ABBV: { price: 188.4, vol: 0.014, trend: 0.0007 },
  // Mining
  BHP: { price: 58.6, vol: 0.021, trend: 0.0005 },
  NEM: { price: 47.3, vol: 0.025, trend: 0.0008 },
  // Aerospace and defense
  RTX: { price: 124.8, vol: 0.015, trend: 0.0008 },
  LMT: { price: 565.0, vol: 0.013, trend: 0.0007 },
  // Information technology
  MSFT: { price: 442.0, vol: 0.015, trend: 0.0011 },
  ORCL: { price: 176.5, vol: 0.022, trend: 0.0013 },
  // Legacy backups
  AAPL: { price: 225, vol: 0.015, trend: 0.0008 },
  NVDA: { price: 130, vol: 0.032, trend: 0.0018 },
  GOOGL: { price: 178, vol: 0.018, trend: 0.0005 },
  AMZN: { price: 188, vol: 0.021, trend: 0.0009 }
};

/**
 * Generate fallback data for any set of tickers
 */
export function getFallbackStockData(tickers) {
  const result = {};
  tickers.forEach((ticker, idx) => {
    const profile = DEFAULT_MOCK_PROFILES[ticker.toUpperCase()] || {
      price: 100 + (idx + 1) * 35,
      vol: 0.015 + idx * 0.003,
      trend: 0.0006 * (idx % 2 === 0 ? 1 : -0.5)
    };
    result[ticker.toUpperCase()] = generateMockPriceHistory(ticker, profile.price, profile.vol, profile.trend);
  });
  return result;
}

/**
 * Fetch 90-day price history for stock tickers from Twelve Data
 * Falls back gracefully to realistic simulated dataset if API key is empty/invalid or rate limited.
 */
export async function fetchStockData(tickers, apiKey) {
  const cleanTickers = tickers.map(t => t.trim().toUpperCase()).filter(Boolean);
  if (cleanTickers.length < 2) {
    throw new Error('At least 2 valid stock tickers are required.');
  }

  if (!apiKey || apiKey.trim() === '') {
    console.warn('Twelve Data API key omitted. Utilizing Vulcan Quantum Sensor Fallback simulation.');
    return getFallbackStockData(cleanTickers);
  }

  try {
    const symbolsParam = cleanTickers.join(',');
    const url = `https://api.twelvedata.com/time_series?symbol=${symbolsParam}&interval=1day&outputsize=90&apikey=${apiKey.trim()}`;

    const response = await fetch(url);
    const bodyText = await response.text();
    let raw;

    try {
      raw = JSON.parse(bodyText);
    } catch {
      throw new Error('Invalid JSON response from Twelve Data API');
    }

    if (raw.status === 'error') {
      console.warn(`Twelve Data API Error: ${raw.message}. Using simulated fallback.`);
      return getFallbackStockData(cleanTickers);
    }

    const resultMap = {};

    if (cleanTickers.length === 1) {
      const values = raw.values || [];
      if (!values.length) throw new Error(`No price data for ${cleanTickers[0]}`);
      resultMap[cleanTickers[0]] = values.map(b => ({
        date: b.datetime,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume)
      })).sort((a, b) => (a.date < b.date ? -1 : 1));
    } else {
      // Multi-symbol return format
      for (const ticker of cleanTickers) {
        const item = raw[ticker];
        if (item && item.values && item.values.length) {
          resultMap[ticker] = item.values.map(b => ({
            date: b.datetime,
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume)
          })).sort((a, b) => (a.date < b.date ? -1 : 1));
        } else {
          // If individual ticker fails in multi-fetch, substitute fallback
          const fallback = getFallbackStockData([ticker]);
          resultMap[ticker] = fallback[ticker];
        }
      }
    }

    return resultMap;
  } catch (err) {
    console.warn('Network error or API limit reached. Loading fallback simulation dataset.', err);
    return getFallbackStockData(cleanTickers);
  }
}
