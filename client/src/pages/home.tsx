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

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null): string {
  if (n == null) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function QuoteChip({ q, compact = false, dark = false }: { q: Quote; compact?: boolean; dark?: boolean }) {
  const up = q.changePercent !== null && q.changePercent >= 0;
  const color = q.changePercent === null
    ? (dark ? "#888" : "#666")
    : up ? "#00aa00" : "#cc0000";
  const priceColor = dark ? "#cccccc" : "#111111";
  const symbolColor = dark ? "#ffffff" : "#000000";

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "baseline",
      marginRight: compact ? 14 : 18,
      gap: 3,
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: compact ? 11 : 12,
      whiteSpace: "nowrap",
    }}>
      <span style={{ fontWeight: "bold", color: symbolColor }}>{q.symbol}</span>
      {q.price !== null && (
        <>
          <span style={{ color: priceColor }}>{fmt(q.price)}</span>
          <span style={{ color, fontWeight: "bold" }}>{fmtPct(q.changePercent)}</span>
        </>
      )}
      {q.price === null && <span style={{ color: dark ? "#555" : "#aaa" }}>—</span>}
    </span>
  );
}

function ScrollingTicker({ quotes }: { quotes: Quote[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const animRef = useRef<number | null>(null);
  const speed = 0.6;

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
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [quotes.length]);

  if (quotes.length === 0) return null;
  const doubled = [...quotes, ...quotes];

  return (
    <div style={{
      background: "#0a0a14",
      borderBottom: "1px solid #333",
      padding: "4px 0",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
    }}>
      <span style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 10,
        fontWeight: "bold",
        color: "#666",
        letterSpacing: 1,
        whiteSpace: "nowrap",
        paddingLeft: 8,
        paddingRight: 10,
        borderRight: "1px solid #333",
        marginRight: 8,
        flexShrink: 0,
      }}>AI</span>
      <div style={{ overflow: "hidden", flex: 1 }}>
        <div ref={trackRef} style={{ display: "inline-flex", transform: `translateX(-${offset}px)`, willChange: "transform" }}>
          {doubled.map((q, i) => <QuoteChip key={`${q.symbol}-${i}`} q={q} compact dark />)}
        </div>
      </div>
    </div>
  );
}

function Mag7Bar({ quotes }: { quotes: Quote[] }) {
  return (
    <div style={{
      background: "#111111",
      borderTop: "1px solid #000",
      borderBottom: "1px solid #000",
      padding: "4px 10px",
      overflowX: "auto",
      whiteSpace: "nowrap",
    }}>
      <span style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 10,
        fontWeight: "bold",
        color: "#888",
        marginRight: 12,
        letterSpacing: 2,
      }}>MAG 7</span>
      {quotes.length === 0
        ? ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"].map((s) => (
            <span key={s} style={{ fontFamily: "Arial, sans-serif", fontSize: 12, color: "#666", marginRight: 18 }}>
              <strong style={{ color: "#fff" }}>{s}</strong> —
            </span>
          ))
        : quotes.map((q) => <QuoteChip key={q.symbol} q={q} dark />)}
    </div>
  );
}

function TopStory({ articles }: { articles: GroupedArticles }) {
  const allArticles = Object.values(articles).flat();
  if (allArticles.length === 0) return null;

  allArticles.sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime());

  const topCandidates = allArticles.filter(
    (a) => a.category === "funding" || a.category === "ma" || a.category === "policy"
  );
  const top = topCandidates[0] || allArticles[0];
  const sub = allArticles.filter((a) => a.id !== top.id).slice(0, 2);

  return (
    <div style={{ textAlign: "center", padding: "20px 20px 14px", borderBottom: "2px solid #000" }}>
      <a
        href={top.link}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#cc0000",
          fontSize: "28px",
          fontWeight: "bold",
          textDecoration: "none",
          lineHeight: 1.2,
          display: "block",
          fontFamily: "Georgia, 'Times New Roman', serif",
          textTransform: "uppercase",
        }}
        data-testid="top-story-link"
      >
        {top.aiHeadline || top.title}
      </a>
      {sub.map((article) => (
        <div key={article.id} style={{ marginTop: 8 }}>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#222",
              fontSize: "16px",
              textDecoration: "none",
              fontFamily: "Georgia, serif",
            }}
          >
            {article.aiHeadline || article.title}...
          </a>
        </div>
      ))}
    </div>
  );
}

function ArticleColumn({ category, articles }: { category: string; articles: Article[] }) {
  if (articles.length === 0) return null;

  return (
    <div style={{ flex: 1, minWidth: 280, padding: "12px 16px", borderRight: "1px solid #ccc" }}>
      <h2 style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: "12px",
        fontWeight: "bold",
        letterSpacing: "2px",
        marginBottom: 10,
        paddingBottom: 5,
        borderBottom: "2px solid #000",
        color: "#000",
      }} data-testid={`section-${category}`}>
        {CATEGORY_LABELS[category] || category.toUpperCase()}
      </h2>
      {articles.map((article, i) => {
        const displayTitle = article.aiHeadline || article.title;
        return (
          <div key={article.id} style={{ marginBottom: 9 }}>
            <span style={{ color: "#999", marginRight: 3 }}>&raquo;</span>
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: i === 0 ? "#003366" : "#003366",
                fontSize: i === 0 ? "15px" : "13.5px",
                fontWeight: i === 0 ? "bold" : "normal",
                textDecoration: "none",
                lineHeight: 1.4,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
              data-testid={`article-link-${article.id}`}
            >
              {displayTitle}
            </a>
            {article.aiHeadline && (
              <span title="AI-rewritten headline" style={{ marginLeft: 4, fontSize: 9, color: "#aaa", fontFamily: "monospace", verticalAlign: "middle" }}>✦</span>
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
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });

  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", background: "#fff" }}>
      {/* Header */}
      <div style={{ textAlign: "center", padding: "16px 0 6px", borderBottom: "2px solid #000" }}>
        <h1 style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: "52px",
          fontWeight: "bold",
          letterSpacing: "3px",
          marginBottom: 4,
          color: "#000",
        }} data-testid="site-title">
          the Alpha wire
        </h1>
        <div style={{ fontFamily: "Georgia, serif", fontSize: "16px", fontStyle: "italic", color: "#555" }}>
          AI News for Investors
        </div>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: "11px", color: "#999", marginTop: 4 }}>
          Last updated: {timeStr}
        </div>
      </div>

      {/* MAG 7 ticker */}
      <Mag7Bar quotes={quotes?.mag7 ?? []} />

      {/* AI Universe scrolling belt */}
      <ScrollingTicker quotes={quotes?.aiUniverse ?? []} />

      {/* Top Story */}
      {grouped && <TopStory articles={grouped} />}

      {/* Loading State */}
      {articlesLoading && (
        <div style={{ textAlign: "center", padding: 40, color: "#888", fontFamily: "Georgia, serif", fontSize: 15 }}>
          Loading pipeline data...
        </div>
      )}

      {/* Empty State */}
      {grouped && Object.values(grouped).every((arr) => arr.length === 0) && (
        <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
          <p style={{ fontFamily: "Georgia, serif", fontSize: 15 }}>No articles yet. The pipeline is running — articles will appear shortly.</p>
          <p style={{ fontFamily: "Arial, sans-serif", fontSize: 12, marginTop: 8 }}>
            Visit <a href="#/admin" style={{ color: "#003366" }}>#/admin</a> to check pipeline status.
          </p>
        </div>
      )}

      {/* Three-Column Layout */}
      {grouped && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {CATEGORY_ORDER.slice(0, 3).map((cat) => (
              <ArticleColumn key={cat} category={cat} articles={grouped[cat] || []} />
            ))}
          </div>
          <div style={{ borderTop: "2px solid #000", margin: "6px 0" }} />
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {CATEGORY_ORDER.slice(3).map((cat) => (
              <ArticleColumn key={cat} category={cat} articles={grouped[cat] || []} />
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{
        textAlign: "center", padding: "16px 0", borderTop: "2px solid #000", marginTop: 16,
        fontFamily: "Arial, Helvetica, sans-serif", fontSize: "11px", color: "#999",
      }}>
        &copy; {now.getFullYear()} The Alpha Wire &mdash; AI News for Investors
      </div>
    </div>
  );
}
