import { pgTable, text, integer, boolean, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// RSS feed sources
export const feedSources = pgTable("feed_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  category: text("category").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at"),
  errorCount: integer("error_count").notNull().default(0),
});

// Ingested articles
export const articles = pgTable("articles", {
  id: serial("id").primaryKey(),
  feedSourceId: integer("feed_source_id").references(() => feedSources.id),
  title: text("title").notNull(),
  link: text("link").notNull().unique(),
  description: text("description"),
  content: text("content"),
  pubDate: text("pub_date"),
  author: text("author"),
  category: text("category").notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at").notNull().defaultNow(),

  // AI-processed fields
  aiHeadline: text("ai_headline"),
  aiCategory: text("ai_category"),
  aiRelevanceScore: integer("ai_relevance_score"),
  aiProcessedAt: timestamp("ai_processed_at"),
});

// Insert schemas
export const insertFeedSourceSchema = createInsertSchema(feedSources).omit({
  id: true,
  lastFetchedAt: true,
  errorCount: true,
});

export const insertArticleSchema = createInsertSchema(articles).omit({
  id: true,
  createdAt: true,
  aiHeadline: true,
  aiCategory: true,
  aiRelevanceScore: true,
  aiProcessedAt: true,
});

// Types
export type FeedSource = typeof feedSources.$inferSelect;
export type InsertFeedSource = z.infer<typeof insertFeedSourceSchema>;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
