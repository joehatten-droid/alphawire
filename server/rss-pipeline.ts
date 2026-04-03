import RSSParser from "rss-parser";
import crypto from "crypto";
import { storage } from "./storage";
import type { InsertArticle, FeedSource } from "@shared/schema";

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    "User-Agent": "TheAlphaWire/1.0 (AI News Aggregator)",
  },
});

// Category keywords for auto-classification
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  funding: [
    "funding", "raises", "raised", "series a", "series b", "series c", "series d", "series e",
    "seed round", "venture", "valuation", "fundrais", "investment round", "backed by",
    "capital", "investor", "ipo", "spac", "unicorn", "$m", "$b", "million round", "billion round",
  ],
  ma: [
    "acqui", "merger", "acquisition", "buyout", "takeover", "deal close",
    "purchase", "bid for", "offer to buy", "combined entity",
  ],
  earnings: [
    "earnings", "revenue", "quarterly", "q1", "q2", "q3", "q4", "profit",
    "financial results", "beat estimates", "missed estimates", "guidance",
    "eps", "capex", "spending", "market cap",
  ],
  policy: [
    "regulation", "congress", "senate", "white house", "executive order",
    "antitrust", "ftc", "sec", "eu", "gdpr", "ai act", "ban", "restrict",
    "pentagon", "defense", "government", "policy", "legislation", "law",
  ],
  industry: [
    "launch", "release", "product", "model", "gpt", "claude", "gemini",
    "open source", "benchmark", "partnership", "deploy", "agent", "robot",
    "chip", "gpu", "data center", "inference", "training",
  ],
  market: [
    "forecast", "outlook", "trend", "report", "analyst", "research",
    "growth", "decline", "market size", "adoption", "survey", "index",
    "prediction", "projection",
  ],
};

function generateFingerprint(title: string): string {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about", "after",
    "before", "between", "under", "and", "but", "or", "nor", "not", "so",
    "yet", "its", "it", "this", "that", "these", "those", "says", "said",
    "new",
  ]);
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const coreWords = normalized.split(" ").filter((w) => !stopWords.has(w) && w.length > 2).sort().join(" ");
  return crypto.createHash("md5").update(coreWords).digest("hex");
}

function classifyArticle(title: string, description: string, feedCategory: string): string {
  const text = `${title} ${description}`.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
  }
  const bestCategory = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (bestCategory[1] === 0) return feedCategory;
  return bestCategory[0];
}

async function processFeed(source: FeedSource): Promise<number> {
  let newArticles = 0;
  try {
    const feed = await parser.parseURL(source.url);
    const now = new Date();

    for (const item of feed.items) {
      if (!item.title || !item.link) continue;

      const existingByLink = await storage.getArticleByLink(item.link);
      if (existingByLink) continue;

      const fingerprint = generateFingerprint(item.title);
      const existingByFp = await storage.getArticleByFingerprint(fingerprint);
      if (existingByFp) continue;

      const description = item.contentSnippet || item.content || "";
      const category = classifyArticle(item.title, description, source.category);

      const article: InsertArticle = {
        feedSourceId: source.id,
        title: item.title.trim(),
        link: item.link,
        description: description.substring(0, 500) || "",
        content: item.content || "",
        pubDate: item.pubDate || item.isoDate || now.toISOString(),
        author: item.creator || item.author || "",
        category,
        fingerprint,
        status: "new",
      };

      try {
        await storage.createArticle(article);
        newArticles++;
      } catch (err: any) {
        if (!err.message?.includes("unique") && !err.message?.includes("UNIQUE")) {
          console.error(`[RSS] Error saving article: ${err.message}`);
        }
      }
    }

    await storage.updateFeedSourceLastFetched(source.id, new Date());
    await storage.resetFeedSourceError(source.id);
  } catch (error: any) {
    console.error(`[RSS] Error fetching ${source.name}: ${error.message}`);
    await storage.incrementFeedSourceError(source.id);
  }

  return newArticles;
}

export async function runPipeline(): Promise<{
  totalNew: number;
  feedResults: { name: string; newArticles: number; error?: string }[];
}> {
  const sources = await storage.getEnabledFeedSources();
  const feedResults: { name: string; newArticles: number; error?: string }[] = [];
  let totalNew = 0;

  console.log(`[RSS] Starting ingestion for ${sources.length} feeds...`);

  const CONCURRENCY = 5;
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (source) => {
        const count = await processFeed(source);
        return { name: source.name, newArticles: count };
      })
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        feedResults.push(result.value);
        totalNew += result.value.newArticles;
      } else {
        feedResults.push({ name: "unknown", newArticles: 0, error: result.reason?.message });
      }
    }
  }

  console.log(`[RSS] Done. ${totalNew} new articles from ${sources.length} feeds.`);
  return { totalNew, feedResults };
}

export async function seedFeedSources() {
  const existingSources = await storage.getAllFeedSources();
  if (existingSources.length > 0) {
    console.log(`[Seed] ${existingSources.length} feed sources already exist.`);
    return;
  }

  const defaultFeeds = [
    { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "funding" },
    { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", category: "industry" },
    { name: "Ars Technica AI", url: "https://arstechnica.com/ai/feed/", category: "industry" },
    { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "industry" },
    { name: "Crunchbase News AI", url: "https://news.crunchbase.com/sections/ai/feed/", category: "funding" },
    { name: "WIRED AI", url: "https://www.wired.com/feed/tag/ai/latest/rss", category: "industry" },
    { name: "Reuters Technology", url: "https://www.reutersagency.com/feed/?best-topics=tech", category: "market" },
    { name: "CNBC Technology", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910", category: "earnings" },
    { name: "OpenAI News", url: "https://openai.com/news/rss.xml", category: "industry" },
    { name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", category: "industry" },
    { name: "Unite.AI", url: "https://www.unite.ai/feed/", category: "industry" },
    { name: "MarkTechPost", url: "https://www.marktechpost.com/feed/", category: "industry" },
    { name: "The Rundown AI", url: "https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml", category: "industry" },
    { name: "a16z Blog", url: "https://a16z.com/feed/", category: "market" },
  ];

  for (const feed of defaultFeeds) {
    try {
      await storage.createFeedSource({ name: feed.name, url: feed.url, category: feed.category, enabled: true });
      console.log(`[Seed] Added: ${feed.name}`);
    } catch (err: any) {
      console.log(`[Seed] Skipped ${feed.name}: ${err.message}`);
    }
  }
  console.log(`[Seed] Done.`);
}
