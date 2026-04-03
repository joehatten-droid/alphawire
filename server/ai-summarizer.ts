import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "gpt-4.1-mini";

// Categories the site supports
const VALID_CATEGORIES = [
  "funding",   // VC rounds, valuations, IPOs
  "industry",  // product launches, model releases, company moves
  "earnings",  // revenue, financials, market cap, analyst calls
  "policy",    // regulation, legislation, government, legal
  "ma",        // mergers, acquisitions, partnerships
  "market",    // forecasts, trends, research, macro
] as const;

export type ArticleCategory = (typeof VALID_CATEGORIES)[number];

export interface AIResult {
  relevant: boolean;           // true = keep, false = discard
  headline: string;            // rewritten investor-focused headline
  category: ArticleCategory;   // best-fit category
  relevanceScore: number;      // 0-100: how useful for an AI investor
}

const SYSTEM_PROMPT = `You are the editorial AI for The Alpha Wire, a news aggregator for investors tracking the AI industry — including AI companies, chips, data centers, energy infrastructure, and enterprise software.

Your job is to evaluate each article and return a JSON object with these fields:

{
  "relevant": boolean,
  "headline": string,
  "category": "funding" | "industry" | "earnings" | "policy" | "ma" | "market",
  "relevanceScore": number (0-100)
}

## Relevance Rules
Mark "relevant": false for:
- Consumer gadget reviews or deals (laptops, phones, tablets, TVs, accessories)
- Gaming hardware or software
- Lifestyle, entertainment, travel, food
- Sports, celebrity, or social media drama
- Articles with no meaningful connection to AI, semiconductors, data infrastructure, or enterprise tech

Mark "relevant": true for:
- AI company funding rounds, valuations, IPOs, or secondary sales
- AI model releases, benchmarks, research breakthroughs
- Semiconductor earnings, capacity, or supply chain news
- Data center builds, power infrastructure for AI workloads
- Enterprise software adopting AI (CRM, ERP, finance, healthcare)
- AI regulation, government policy, antitrust, export controls
- M&A activity in AI, cloud, chips, or adjacent sectors
- Macro analyst forecasts or market research about AI spending

## Headline Rewriting Rules
If relevant, rewrite the headline to be:
- Direct, factual, and investor-focused (think Bloomberg terminal, not TechCrunch clickbait)
- Front-load the most important financial or strategic fact
- Include dollar amounts, percentages, or company names when present
- 10 words max — punchy, no filler
- No quotes around the headline
- No trailing punctuation

Examples of good rewrites:
  Original: "OpenAI is reportedly in talks to raise another massive funding round"
  Rewritten: "OpenAI Nears $10B Raise at $300B Valuation"

  Original: "Nvidia's data center revenue hits new record as AI demand surges"
  Rewritten: "Nvidia Data Center Revenue Hits $22.6B, Up 93% YoY"

  Original: "Anthropic releases Claude 4 with major reasoning improvements"
  Rewritten: "Anthropic Launches Claude 4 With Extended Reasoning Mode"

## Category Definitions
- funding: VC rounds, valuations, IPOs, SPACs, secondary sales
- industry: product launches, model releases, research, company strategy
- earnings: revenue reports, guidance, analyst upgrades/downgrades, capex
- policy: regulation, legislation, lawsuits, export controls, government contracts
- ma: acquisitions, mergers, strategic partnerships, joint ventures
- market: macro forecasts, research reports, adoption trends, spending surveys

Return only valid JSON. No markdown, no explanation.`;

/**
 * Process a batch of articles through GPT-4.1 mini.
 * Returns results in the same order as inputs.
 * Handles failures gracefully per article.
 */
export async function processArticleBatch(
  articles: Array<{ id: number; title: string; description: string; category: string }>
): Promise<Map<number, AIResult>> {
  const results = new Map<number, AIResult>();

  // Process concurrently in groups of 5 to balance speed vs rate limits
  const CONCURRENCY = 5;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);

    const settled = await Promise.allSettled(
      batch.map(async (article) => {
        const result = await processArticle(article);
        return { id: article.id, result };
      })
    );

    for (const item of settled) {
      if (item.status === "fulfilled") {
        results.set(item.value.id, item.value.result);
      }
    }

    // Small delay between batches to respect rate limits
    if (i + CONCURRENCY < articles.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

/**
 * Process a single article through GPT-4.1 mini.
 */
export async function processArticle(article: {
  title: string;
  description: string;
  category: string;
}): Promise<AIResult> {
  const userContent = `Title: ${article.title}
Description: ${article.description?.substring(0, 400) || "(none)"}
Current category: ${article.category}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2, // low temp for consistent, factual output
      max_tokens: 150,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    // Validate and normalize the response
    const relevant = Boolean(parsed.relevant);
    const headline = typeof parsed.headline === "string" && parsed.headline.trim()
      ? parsed.headline.trim()
      : article.title;
    const category = VALID_CATEGORIES.includes(parsed.category)
      ? (parsed.category as ArticleCategory)
      : (article.category as ArticleCategory) ?? "industry";
    const relevanceScore = typeof parsed.relevanceScore === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.relevanceScore)))
      : relevant ? 50 : 5;

    return { relevant, headline, category, relevanceScore };
  } catch (err: any) {
    // On any error, fall back to keeping the original (don't lose articles)
    console.error(`[AI] Failed to process article: ${err.message}`);
    return {
      relevant: true,
      headline: article.title,
      category: (VALID_CATEGORIES.includes(article.category as ArticleCategory)
        ? article.category
        : "industry") as ArticleCategory,
      relevanceScore: 50,
    };
  }
}

/**
 * Run AI processing on all unprocessed articles in the DB.
 * Called after each RSS pipeline run.
 */
export async function runAIPipeline(
  getUnprocessed: () => Promise<Array<{ id: number; title: string; description: string | null; category: string }>> | Array<{ id: number; title: string; description: string | null; category: string }>,
  applyResult: (id: number, result: AIResult) => Promise<void> | void,
  limit = 100
): Promise<{ processed: number; accepted: number; rejected: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[AI] No OPENAI_API_KEY set — skipping AI processing");
    return { processed: 0, accepted: 0, rejected: 0 };
  }

  const unprocessed = (await getUnprocessed()).slice(0, limit);
  if (unprocessed.length === 0) {
    console.log("[AI] No unprocessed articles.");
    return { processed: 0, accepted: 0, rejected: 0 };
  }

  console.log(`[AI] Processing ${unprocessed.length} articles with GPT-4.1-mini...`);

  const normalized = unprocessed.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description ?? "",
    category: a.category,
  }));

  const results = await processArticleBatch(normalized);

  let accepted = 0;
  let rejected = 0;

  for (const [id, result] of results) {
    await applyResult(id, result);
    result.relevant ? accepted++ : rejected++;
  }

  console.log(
    `[AI] Done — ${accepted} accepted, ${rejected} rejected out of ${results.size} processed`
  );

  return { processed: results.size, accepted, rejected };
}
