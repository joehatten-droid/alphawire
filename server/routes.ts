import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { runPipeline, seedFeedSources } from "./rss-pipeline";
import { fetchQuotes, MAG7_SYMBOLS, AI_UNIVERSE_SYMBOLS } from "./quotes";
import { runAIPipeline, type AIResult } from "./ai-summarizer";

export async function registerRoutes(server: Server, app: Express): Promise<void> {

  // Seed feeds on startup
  await seedFeedSources();

  // Helper: run RSS → AI in one shot
  async function runFullPipeline() {
    const rssResult = await runPipeline();
    let aiResult = { processed: 0, accepted: 0, rejected: 0 };

    if (rssResult.totalNew > 0) {
      console.log(`[Pipeline] Running AI on ${rssResult.totalNew} new articles...`);
      aiResult = await runAIPipeline(
        () => storage.getUnprocessedArticles(rssResult.totalNew + 20),
        async (id: number, result: AIResult) => {
          await storage.applyAIResult(id, result.headline, result.category, result.relevanceScore, result.relevant);
        },
        rssResult.totalNew + 20
      );
    }

    return { ...rssResult, ai: aiResult };
  }

  // --- Articles ---

  app.get("/api/articles", async (req, res) => {
    const { category, status, limit } = req.query;
    const lim = limit ? parseInt(limit as string) : 50;
    const items = category
      ? await storage.getArticlesByCategory(category as string, lim)
      : await storage.getArticles(lim, status as string | undefined);
    res.json(items);
  });

  app.get("/api/articles/grouped", async (_req, res) => {
    const categories = ["funding", "industry", "earnings", "policy", "ma", "market"];
    const grouped: Record<string, any[]> = {};
    for (const cat of categories) {
      grouped[cat] = await storage.getArticlesByCategory(cat, 15);
    }
    res.json(grouped);
  });

  // --- Stats ---

  app.get("/api/stats", async (_req, res) => {
    const sources = await storage.getAllFeedSources();
    const totalArticles = await storage.getArticleCount();
    const recentArticles = await storage.getRecentArticles(24);
    res.json({
      totalFeeds: sources.length,
      enabledFeeds: sources.filter((s) => s.enabled).length,
      totalArticles,
      articlesLast24h: recentArticles.length,
      feeds: sources.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        enabled: s.enabled,
        lastFetchedAt: s.lastFetchedAt ? new Date(s.lastFetchedAt as any).toISOString() : null,
        errorCount: s.errorCount,
      })),
    });
  });

  app.get("/api/feeds", async (_req, res) => {
    res.json(await storage.getAllFeedSources());
  });

  // --- Stock Quotes ---

  app.get("/api/quotes/mag7", async (_req, res) => {
    try { res.json(await fetchQuotes(MAG7_SYMBOLS)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/quotes/ai-universe", async (_req, res) => {
    try { res.json(await fetchQuotes(AI_UNIVERSE_SYMBOLS)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/quotes/all", async (_req, res) => {
    try {
      const [mag7, aiUniverse] = await Promise.all([
        fetchQuotes(MAG7_SYMBOLS),
        fetchQuotes(AI_UNIVERSE_SYMBOLS),
      ]);
      res.json({ mag7, aiUniverse });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- AI Summarization ---

  app.get("/api/ai/stats", async (_req, res) => {
    res.json(await storage.getAIStats());
  });

  app.post("/api/ai/run", async (req, res) => {
    const limit = req.body?.limit ?? 100;
    try {
      const result = await runAIPipeline(
        () => storage.getUnprocessedArticles(limit),
        async (id: number, aiResult: AIResult) => {
          await storage.applyAIResult(id, aiResult.headline, aiResult.category, aiResult.relevanceScore, aiResult.relevant);
        },
        limit
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- Pipeline Control ---

  app.post("/api/pipeline/run", async (_req, res) => {
    try { res.json(await runFullPipeline()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // --- Cron endpoint (for cron-job.org external trigger in production) ---
  // Secured by CRON_SECRET env var — requests must include header: x-cron-secret: <secret>

  app.post("/api/cron/run", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await runFullPipeline();
      console.log(`[Cron] Pipeline complete: ${result.totalNew} new RSS | ${result.ai.accepted} AI accepted`);
      res.json(result);
    } catch (err: any) {
      console.error(`[Cron] Pipeline error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Run pipeline once on startup (non-blocking)
  setTimeout(async () => {
    try {
      const result = await runFullPipeline();
      console.log(`[Startup] RSS: ${result.totalNew} new | AI: ${result.ai.accepted} accepted, ${result.ai.rejected} rejected`);
    } catch (err: any) {
      console.error(`[Startup] Pipeline failed: ${err.message}`);
    }
  }, 3000);
}
