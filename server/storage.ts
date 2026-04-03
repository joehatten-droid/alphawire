import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleSQLite } from "drizzle-orm/better-sqlite3";
import BetterSQLite from "better-sqlite3";
import { eq, desc, and, sql } from "drizzle-orm";
import path from "path";
import {
  feedSources,
  articles,
  type FeedSource,
  type InsertFeedSource,
  type Article,
  type InsertArticle,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// DB setup: Neon in production, SQLite locally
// ---------------------------------------------------------------------------

let db: ReturnType<typeof drizzleNeon> | ReturnType<typeof drizzleSQLite>;
let sqliteDb: InstanceType<typeof BetterSQLite> | null = null;
let isPostgres = false;

if (process.env.DATABASE_URL) {
  const neonSql = neon(process.env.DATABASE_URL);
  db = drizzleNeon(neonSql) as any;
  isPostgres = true;
  console.log("[DB] Using Neon Postgres");
} else {
  const dbPath = path.resolve(process.cwd(), "data.db");
  sqliteDb = new BetterSQLite(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  db = drizzleSQLite(sqliteDb) as any;
  console.log("[DB] Using local SQLite");
}

export { db };

// ---------------------------------------------------------------------------
// Raw SQL helper for stats queries (works across both drivers)
// ---------------------------------------------------------------------------

async function queryOne(query: string): Promise<number> {
  if (isPostgres) {
    const rows = await (db as ReturnType<typeof drizzleNeon>).execute(sql.raw(query));
    return Number((rows as any)[0]?.count ?? 0);
  } else {
    const result = sqliteDb!.prepare(query.replace(/count\(\*\)/gi, "COUNT(*)")).get() as any;
    return Number(result?.count ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------

export interface IStorage {
  getAllFeedSources(): Promise<FeedSource[]>;
  getEnabledFeedSources(): Promise<FeedSource[]>;
  createFeedSource(source: InsertFeedSource): Promise<FeedSource>;
  updateFeedSourceLastFetched(id: number, timestamp: Date): Promise<void>;
  incrementFeedSourceError(id: number): Promise<void>;
  resetFeedSourceError(id: number): Promise<void>;

  getArticles(limit?: number, status?: string): Promise<Article[]>;
  getArticlesByCategory(category: string, limit?: number): Promise<Article[]>;
  getArticleByLink(link: string): Promise<Article | undefined>;
  getArticleByFingerprint(fingerprint: string): Promise<Article | undefined>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticleStatus(id: number, status: string): Promise<void>;
  getArticleCount(): Promise<number>;
  getRecentArticles(hours: number): Promise<Article[]>;

  getUnprocessedArticles(limit?: number): Promise<Article[]>;
  applyAIResult(id: number, aiHeadline: string, aiCategory: string, aiRelevanceScore: number, relevant: boolean): Promise<void>;
  getAIStats(): Promise<{ total: number; processed: number; accepted: number; rejected: number }>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DatabaseStorage implements IStorage {
  private get d() { return db as any; }

  async getAllFeedSources(): Promise<FeedSource[]> {
    if (!isPostgres) {
      const rows = sqliteDb!.prepare("SELECT * FROM feed_sources ORDER BY id").all() as any[];
      return rows.map(this._normalizeFeed);
    }
    return this.d.select().from(feedSources).orderBy(feedSources.id);
  }

  async getEnabledFeedSources(): Promise<FeedSource[]> {
    if (!isPostgres) {
      const rows = sqliteDb!.prepare("SELECT * FROM feed_sources WHERE enabled = 1").all() as any[];
      return rows.map(this._normalizeFeed);
    }
    return this.d.select().from(feedSources).where(eq(feedSources.enabled, true));
  }

  private _normalizeFeed(s: any): FeedSource {
    return {
      ...s,
      id: Number(s.id),
      enabled: Boolean(s.enabled),
      errorCount: Number(s.error_count ?? s.errorCount ?? 0),
      lastFetchedAt: s.last_fetched_at ? new Date(s.last_fetched_at) : (s.lastFetchedAt ? new Date(s.lastFetchedAt) : null),
      feedSourceId: s.feed_source_id ?? s.feedSourceId,
    } as FeedSource;
  }

  async createFeedSource(source: InsertFeedSource): Promise<FeedSource> {
    const rows = await this.d.insert(feedSources).values(source).returning();
    return rows[0];
  }

  async updateFeedSourceLastFetched(id: number, timestamp: Date): Promise<void> {
    // SQLite needs a string; Postgres accepts Date objects
    const val = isPostgres ? timestamp : (timestamp.toISOString() as any);
    await this.d.update(feedSources).set({ lastFetchedAt: val }).where(eq(feedSources.id, id));
  }

  async incrementFeedSourceError(id: number): Promise<void> {
    await this.d.execute(
      sql`UPDATE feed_sources SET error_count = error_count + 1 WHERE id = ${id}`
    );
  }

  async resetFeedSourceError(id: number): Promise<void> {
    await this.d.update(feedSources).set({ errorCount: 0 }).where(eq(feedSources.id, id));
  }

  async getArticles(limit = 50, status?: string): Promise<Article[]> {
    const q = this.d.select().from(articles);
    if (status) {
      return q.where(eq(articles.status, status)).orderBy(desc(articles.pubDate)).limit(limit);
    }
    return q.orderBy(desc(articles.pubDate)).limit(limit);
  }

  async getArticlesByCategory(category: string, limit = 20): Promise<Article[]> {
    const published = await this.d
      .select()
      .from(articles)
      .where(and(eq(articles.category, category), eq(articles.status, "published")))
      .orderBy(desc(articles.pubDate))
      .limit(limit);

    if (published.length > 0) return published;

    return this.d
      .select()
      .from(articles)
      .where(and(eq(articles.category, category), eq(articles.status, "new")))
      .orderBy(desc(articles.pubDate))
      .limit(limit);
  }

  async getArticleByLink(link: string): Promise<Article | undefined> {
    const rows = await this.d.select().from(articles).where(eq(articles.link, link)).limit(1);
    return rows[0];
  }

  async getArticleByFingerprint(fingerprint: string): Promise<Article | undefined> {
    const rows = await this.d.select().from(articles).where(eq(articles.fingerprint, fingerprint)).limit(1);
    return rows[0];
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const rows = await this.d.insert(articles).values(article).returning();
    return rows[0];
  }

  async updateArticleStatus(id: number, status: string): Promise<void> {
    await this.d.update(articles).set({ status }).where(eq(articles.id, id));
  }

  async getArticleCount(): Promise<number> {
    if (!isPostgres) {
      const row = sqliteDb!.prepare("SELECT COUNT(*) as c FROM articles").get() as any;
      return Number(row?.c ?? 0);
    }
    const rows = await this.d.select({ count: sql<number>`count(*)` }).from(articles);
    return Number((rows[0] as any)?.count ?? 0);
  }

  async getRecentArticles(hours: number): Promise<Article[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    if (!isPostgres) {
      return sqliteDb!.prepare(
        "SELECT * FROM articles WHERE status = 'published' AND created_at >= ? ORDER BY pub_date DESC"
      ).all(since) as any[];
    }
    return this.d
      .select()
      .from(articles)
      .where(and(eq(articles.status, "published"), sql`${articles.createdAt} >= ${since}`))
      .orderBy(desc(articles.pubDate));
  }

  async getUnprocessedArticles(limit = 100): Promise<Article[]> {
    return this.d
      .select()
      .from(articles)
      .where(eq(articles.status, "new"))
      .orderBy(desc(articles.createdAt))
      .limit(limit);
  }

  async applyAIResult(
    id: number,
    aiHeadline: string,
    aiCategory: string,
    aiRelevanceScore: number,
    relevant: boolean
  ): Promise<void> {
    const now = isPostgres ? new Date() : (new Date().toISOString() as any);
    await this.d.update(articles)
      .set({
        aiHeadline,
        aiCategory,
        aiRelevanceScore,
        aiProcessedAt: now,
        status: relevant ? "published" : "rejected",
        category: relevant ? aiCategory : undefined,
      })
      .where(eq(articles.id, id));
  }

  async getAIStats(): Promise<{ total: number; processed: number; accepted: number; rejected: number }> {
    if (isPostgres) {
      // Postgres supports FILTER (WHERE ...)
      const rows = await this.d.select({
        total: sql<number>`count(*)`,
        processed: sql<number>`count(${articles.aiProcessedAt})`,
        accepted: sql<number>`count(*) filter (where ${articles.status} = 'published')`,
        rejected: sql<number>`count(*) filter (where ${articles.status} = 'rejected')`,
      }).from(articles);
      const r = rows[0];
      return {
        total: Number(r?.total ?? 0),
        processed: Number(r?.processed ?? 0),
        accepted: Number(r?.accepted ?? 0),
        rejected: Number(r?.rejected ?? 0),
      };
    } else {
      // SQLite: four separate count queries
      const [total, processed, accepted, rejected] = await Promise.all([
        this.d.select({ c: sql<number>`count(*)` }).from(articles).then((r: any) => Number(r[0]?.c ?? 0)),
        this.d.select({ c: sql<number>`count(*)` }).from(articles).where(sql`${articles.aiProcessedAt} is not null`).then((r: any) => Number(r[0]?.c ?? 0)),
        this.d.select({ c: sql<number>`count(*)` }).from(articles).where(eq(articles.status, "published")).then((r: any) => Number(r[0]?.c ?? 0)),
        this.d.select({ c: sql<number>`count(*)` }).from(articles).where(eq(articles.status, "rejected")).then((r: any) => Number(r[0]?.c ?? 0)),
      ]);
      return { total, processed, accepted, rejected };
    }
  }
}

export const storage = new DatabaseStorage();
