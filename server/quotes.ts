// Dynamic import to handle ESM/CJS bundling for yahoo-finance2
let yahooFinance: any;
async function getYahooFinance() {
  if (!yahooFinance) {
    const mod = await import("yahoo-finance2");
    const YF = (mod.default as any)?.default ?? mod.default;
    yahooFinance = typeof YF === "function" ? new YF({ suppressNotices: ["yahooSurvey"] }) : YF;
  }
  return yahooFinance;
}

// Mag 7
export const MAG7_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];

// AI-adjacent universe: data centers, semis, energy, AI-enabled software
export const AI_UNIVERSE_SYMBOLS = [
  // Semiconductors / AI chips
  "AMD", "INTC", "QCOM", "AVGO", "MU", "TSM", "ARM", "MRVL", "SMCI",
  // AI Software / cloud
  "CRM", "ORCL", "PLTR", "SNOW", "AI", "PATH", "SOUN", "BBAI",
  // Data centers / infrastructure
  "DLR", "EQIX", "VRT", "DELL", "HPE", "NET", "CFLT",
  // Energy / power for AI
  "VST", "CEG", "NRG", "ETN", "PWR",
  // Robotics / autonomous
  "ISRG", "ABB", "HON",
];

interface QuoteResult {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
}

// In-memory cache: { symbol -> { data, fetchedAt } }
const cache = new Map<string, { data: QuoteResult; fetchedAt: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute

async function fetchQuote(symbol: string): Promise<QuoteResult> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  try {
    const yf = await getYahooFinance();
    const q = await yf.quote(symbol, {}, { validateResult: false });
    const result: QuoteResult = {
      symbol,
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      name: q.shortName ?? q.longName ?? symbol,
    };
    cache.set(symbol, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (err: any) {
    // Return a minimal fallback if this symbol errors
    const fallback: QuoteResult = {
      symbol,
      price: null,
      change: null,
      changePercent: null,
      name: symbol,
    };
    cache.set(symbol, { data: fallback, fetchedAt: Date.now() });
    return fallback;
  }
}

export async function fetchQuotes(symbols: string[]): Promise<QuoteResult[]> {
  // Batch by 10 with small delays to avoid rate limiting
  const results: QuoteResult[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((s) => fetchQuote(s))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
    if (i + BATCH_SIZE < symbols.length) {
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  return results;
}
