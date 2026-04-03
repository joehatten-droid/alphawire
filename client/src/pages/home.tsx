import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useEffect, useRef, useState } from "react";

interface Article {
  id: number;
  title: string;
  aiHeadline: string | null;
  link: string;
  description: string | null;
  pubDate: string | null;
  category: string;
  author: string | null;
  aiRelevanceScore: number | null;
  status: string;
}

type GroupedArticles = Record<string, Article[]>;

interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  name: string | null;
}

interface AllQuotes {
  mag7: Quote[];
  aiUniverse: Quote[];
}

const CATEGORY_LABELS: Record<string, string> = {
  funding: "FUNDING & DEALS",
  industry: "AI INDUSTRY",
  earnings: "EARNINGS & FINANCIALS",
  policy: "REGULATION & POLICY",
  ma: "M&A & PARTNERSHIPS",
  market: "MARKET & TRENDS",
};

const CATEGORY_ORDER = ["funding", "industry", "earnings", "policy", "ma", "market"];

// Format price with 2 decimal places
function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format percent
function fmtPct(n: number | null): string {
  if (n == null) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function QuoteChip({
  q,
  compact = false,
  dark = false,
}: {
  q: Quote;
  compact?: boolean;
  dark?: boolean;
}) {
  const up = q.changePercent !== null && q.changePercent >= 0;
  const color = q.changePercent === null
    ? (dark ? "#888" : "#666")
    : up
    ? (dark ? "#4ade80" : "#006400")
    : (dark ? "#f87171" : "#b00000");
  const priceColor = dark ? "#d1d5db" : "#333";
  const symbolColor = dark ? "#ffffff" : "#000000";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        marginRight: compact ? 20 : 20,
        gap: 4,
        fontFamily: "'Courier New', monospace",
        fontSize: compact ? 12 : 13,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontWeight: "bold", color: symbolColor }}>{q.symbol}</span>
      {q.price !== null && (
        <>
          <span style={{ color: priceColor }}>{fmt(q.price)}</span>
          <span style={{ color, fontWeight: "bold" }}>{fmtPct(q.changePercent)}</span>
        </>
      )}
      {q.price === null && (
        <span style={{ color: dark ? "#555" : "#aaa" }}>—</span>
      )}
    </span>
  );
}

// Scrolling ticker belt for AI universe
function ScrollingTicker({ quotes }: { quotes: Quote[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const animRef = useRef<number | null>(null);
  const speed = 0.6; // px per frame

  useEffect(() => {
    if (!trackRef.current || quotes.length === 0) return;

    let pos = 0;
    const track = trackRef.current;

    function step() {
      if (!track) return;
      const halfWidth = track.scrollWidth / 2;
      pos += speed;
      if (pos >= halfWidth) pos -= halfWidth;
      setOffset(pos);
      animRef.current = requestAnimationFrame(step);
    }

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [quotes.length]);

  if (quotes.length === 0) return null;

  // Duplicate for seamless loop
  const doubled = [...quotes, ...quotes];

  return (
    <div
      style={{
        background: "#0a0a14",
        borderBottom: "1px solid #333",
        padding: "5px 0",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          fontWeight: "bold",
          color: "#666",
          letterSpacing: 1,
          whiteSpace: "nowrap",
          paddingLeft: 10,
          paddingRight: 12,
          borderRight: "1px solid #333",
          marginRight: 10,
          flexShrink: 0,
        }}
      >
        AI
      </span>
      <div
        style={{ overflow: "hidden", flex: 1 }}
      >
      <div
        ref={trackRef}
        style={{
          display: "inline-flex",
          transform: `translateX(-${offset}px)`,
          willChange: "transform",
        }}
      >
        {doubled.map((q, i) => (
          <QuoteChip
            key={`${q.symbol}-${i}`}
            q={q}
            compact
            dark
          />
        ))}
      </div>
      </div>
    </div>
  );
}

// Static Mag 7 bar (no scroll — fits on one line)
function Mag7Bar({ quotes }: { quotes: Quote[] }) {
  return (
    <div
      style={{
        background: "#f0f0f0",
        borderTop: "1px solid #bbb",
        borderBottom: "1px solid #bbb",
        padding: "6px 12px",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 12,
          fontWeight: "bold",
          color: "#555",
          marginRight: 14,
          letterSpacing: 1,
        }}
      >
        MAG 7
      </span>
      {quotes.length === 0
        ? ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"].map((s) => (
            <span
              key={s}
              style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 13,
                color: "#aaa",
                marginRight: 20,
              }}
            >
              <strong>{s}</strong> —
            </span>
          ))
        : quotes.map((q) => <QuoteChip key={q.symbol} q={q} />)}
    </div>
  );
}

function TopStory({ articles }: { articles: GroupedArticles }) {
  const allArticles = Object.values(articles).flat();
  if (allArticles.length === 0) return null;

  allArticles.sort(
    (a, b) =>
      new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime()
  );

  const topCandidates = allArticles.filter(
    (a) =>
      a.category === "funding" || a.category === "ma" || a.category === "policy"
  );
  const top = topCandidates[0] || allArticles[0];
  const sub = allArticles.filter((a) => a.id !== top.id).slice(0, 2);

  return (
    <div
      style={{
        textAlign: "center",
        padding: "24px 20px 16px",
        borderBottom: "2px solid #000",
      }}
    >
      <a
        href={top.link}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#b00",
          fontSize: "28px",
          fontWeight: "bold",
          textDecoration: "none",
          lineHeight: 1.25,
          display: "block",
          fontFamily: "Georgia, 'Times New Roman', serif",
          textTransform: "uppercase",
        }}
        data-testid="top-story-link"
      >
        {top.title}
      </a>
      {sub.map((article) => (
        <div key={article.id} style={{ marginTop: 8 }}>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#333",
              fontSize: "16px",
              textDecoration: "none",
              fontFamily: "Georgia, serif",
            }}
          >
            {article.title}...
          </a>
        </div>
      ))}
    </div>
  );
}

function ArticleColumn({
  category,
  articles,
}: {
  category: string;
  articles: Article[];
}) {
  if (articles.length === 0) return null;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 280,
        padding: "12px 16px",
        borderRight: "1px solid #ccc",
      }}
    >
      <h2
        style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: "15px",
          fontWeight: "bold",
          letterSpacing: "1px",
          marginBottom: 12,
          paddingBottom: 6,
          borderBottom: "1px solid #999",
        }}
        data-testid={`section-${category}`}
      >
        {CATEGORY_LABELS[category] || category.toUpperCase()}
      </h2>
      {articles.map((article, i) => {
        // Prefer AI headline; strip trailing ellipsis from raw titles if needed
        const displayTitle = article.aiHeadline || article.title;
        return (
          <div key={article.id} style={{ marginBottom: 10 }}>
            <span style={{ color: "#999", marginRight: 4 }}>&raquo;</span>
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: i === 0 ? "#b00" : "#003366",
                fontSize: i === 0 ? "16px" : "14.5px",
                fontWeight: i === 0 ? "bold" : "normal",
                textDecoration: "none",
                lineHeight: 1.4,
                fontFamily: "Georgia, serif",
              }}
              data-testid={`article-link-${article.id}`}
            >
              {displayTitle}
            </a>
            {article.aiHeadline && (
              <span
                title="AI-rewritten headline"
                style={{
                  marginLeft: 5,
                  fontSize: 9,
                  color: "#aaa",
                  fontFamily: "monospace",
                  verticalAlign: "middle",
                }}
              >
                ✦
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const { data: grouped, isLoading: articlesLoading } = useQuery<GroupedArticles>({
    queryKey: ["/api/articles/grouped"],
    queryFn: () => apiRequest("GET", "/api/articles/grouped").then((r) => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: quotes } = useQuery<AllQuotes>({
    queryKey: ["/api/quotes/all"],
    queryFn: () => apiRequest("GET", "/api/quotes/all").then((r) => r.json()),
    refetchInterval: 60 * 1000, // refresh every 60s
    staleTime: 30 * 1000,
  });

  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", background: "#fff" }}>
      {/* Header */}
      <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
        <h1
          style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "48px",
            fontWeight: "normal",
            letterSpacing: "2px",
            marginBottom: 4,
          }}
          data-testid="site-title"
        >
          the Alpha wire
        </h1>
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "16px",
            fontStyle: "italic",
            color: "#003366",
          }}
        >
          AI News for Investors
        </div>
        <div
          style={{
            fontFamily: "'Courier New', monospace",
            fontSize: "12px",
            color: "#888",
            marginTop: 4,
          }}
        >
          Last updated: {timeStr}
        </div>
      </div>

      {/* MAG 7 ticker — static bar */}
      <Mag7Bar quotes={quotes?.mag7 ?? []} />

      {/* AI Universe — scrolling belt */}
      <ScrollingTicker quotes={quotes?.aiUniverse ?? []} />

      {/* Top Story */}
      {grouped && <TopStory articles={grouped} />}

      {/* Loading State */}
      {articlesLoading && (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "#888",
            fontFamily: "'Courier New', monospace",
          }}
        >
          Loading pipeline data...
        </div>
      )}

      {/* Empty State */}
      {grouped &&
        Object.values(grouped).every((arr) => arr.length === 0) && (
          <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
            <p
              style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 14,
              }}
            >
              No articles yet. The pipeline is running — articles will appear
              shortly.
            </p>
            <p
              style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 12,
                marginTop: 8,
              }}
            >
              Visit{" "}
              <a href="#/admin" style={{ color: "#003366" }}>
                #/admin
              </a>{" "}
              to check pipeline status.
            </p>
          </div>
        )}

      {/* Three-Column Layout */}
      {grouped && (
        <>
          {/* Row 1 */}
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {CATEGORY_ORDER.slice(0, 3).map((cat) => (
              <ArticleColumn
                key={cat}
                category={cat}
                articles={grouped[cat] || []}
              />
            ))}
          </div>

          {/* Divider */}
          <div style={{ borderTop: "2px solid #000", margin: "8px 0" }} />

          {/* Row 2 */}
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {CATEGORY_ORDER.slice(3).map((cat) => (
              <ArticleColumn
                key={cat}
                category={cat}
                articles={grouped[cat] || []}
              />
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          padding: "20px 0",
          borderTop: "2px solid #000",
          marginTop: 16,
          fontFamily: "'Courier New', monospace",
          fontSize: "12px",
          color: "#888",
        }}
      >
        &copy; {now.getFullYear()} The Alpha Wire &mdash; AI News for Investors
      </div>
    </div>
  );
}
