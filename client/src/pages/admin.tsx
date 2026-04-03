import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface FeedInfo {
  id: number;
  name: string;
  category: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  errorCount: number;
}

interface Stats {
  totalFeeds: number;
  enabledFeeds: number;
  totalArticles: number;
  articlesLast24h: number;
  feeds: FeedInfo[];
}

interface AIStats {
  total: number;
  processed: number;
  accepted: number;
  rejected: number;
}

interface PipelineResult {
  totalNew: number;
  feedResults: { name: string; newArticles: number; error?: string }[];
  ai?: { processed: number; accepted: number; rejected: number };
}

export default function AdminPage() {
  const { toast } = useToast();

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/stats"],
    queryFn: () => apiRequest("GET", "/api/stats").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: aiStats, refetch: refetchAIStats } = useQuery<AIStats>({
    queryKey: ["/api/ai/stats"],
    queryFn: () => apiRequest("GET", "/api/ai/stats").then((r) => r.json()),
    refetchInterval: 15000,
  });

  const runPipeline = useMutation<PipelineResult>({
    mutationFn: () =>
      apiRequest("POST", "/api/pipeline/run").then((r) => r.json()),
    onSuccess: (data) => {
      const aiMsg = data.ai
        ? ` | AI: ${data.ai.accepted} accepted, ${data.ai.rejected} rejected`
        : "";
      toast({
        title: "Pipeline Complete",
        description: `${data.totalNew} new articles${aiMsg}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/grouped"] });
    },
    onError: (err: any) => {
      toast({ title: "Pipeline Error", description: err.message, variant: "destructive" });
    },
  });

  const runAI = useMutation<{ processed: number; accepted: number; rejected: number }>({
    mutationFn: () =>
      apiRequest("POST", "/api/ai/run", { limit: 200 }).then((r) => r.json()),
    onSuccess: (data) => {
      toast({
        title: "AI Processing Complete",
        description: `${data.accepted} accepted, ${data.rejected} rejected out of ${data.processed} articles`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles/grouped"] });
    },
    onError: (err: any) => {
      toast({ title: "AI Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "24px 20px",
        fontFamily: "'Courier New', monospace",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: "bold" }} data-testid="admin-title">
            Pipeline Admin
          </h1>
          <a href="#/" style={{ color: "#003366", fontSize: 13 }}>
            &larr; Back to site
          </a>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            onClick={() => runAI.mutate()}
            disabled={runAI.isPending}
            data-testid="button-run-ai"
            variant="outline"
            style={{ fontFamily: "'Courier New', monospace" }}
          >
            {runAI.isPending ? "Processing..." : "Run AI Now"}
          </Button>
          <Button
            onClick={() => runPipeline.mutate()}
            disabled={runPipeline.isPending}
            data-testid="button-run-pipeline"
            style={{ fontFamily: "'Courier New', monospace" }}
          >
            {runPipeline.isPending ? "Running..." : "Run Full Pipeline"}
          </Button>
        </div>
      </div>

      {isLoading && <p>Loading stats...</p>}

      {stats && (
        <>
          {/* RSS Stats Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
            <StatCard label="Total Feeds" value={stats.totalFeeds} data-testid="stat-total-feeds" />
            <StatCard label="Enabled" value={stats.enabledFeeds} data-testid="stat-enabled-feeds" />
            <StatCard label="Total Articles" value={stats.totalArticles} data-testid="stat-total-articles" />
            <StatCard label="Last 24h" value={stats.articlesLast24h} data-testid="stat-24h" />
          </div>

          {/* AI Stats Cards */}
          {aiStats && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 11, fontWeight: "bold", color: "#888", letterSpacing: 1, marginBottom: 8 }}>
                AI LAYER
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                <StatCard label="Total Ingested" value={aiStats.total} />
                <StatCard label="AI Processed" value={aiStats.processed} accent="#003366" />
                <StatCard label="Accepted" value={aiStats.accepted} accent="#006400" />
                <StatCard label="Rejected" value={aiStats.rejected} accent="#b00000" />
              </div>
              {aiStats.total > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
                  {Math.round((aiStats.processed / aiStats.total) * 100)}% processed &nbsp;·&nbsp;
                  {aiStats.processed > 0 ? Math.round((aiStats.accepted / aiStats.processed) * 100) : 0}% acceptance rate
                </div>
              )}
            </div>
          )}

          {/* Pipeline Results */}
          {runPipeline.data && (
            <div style={{ marginBottom: 24, padding: 16, border: "1px solid #ccc", background: "#f9f9f9" }}>
              <h3 style={{ fontWeight: "bold", marginBottom: 8 }}>Last Run Results</h3>
              <p>New articles: {runPipeline.data.totalNew}</p>
              {runPipeline.data.ai && (
                <p style={{ marginTop: 4, color: "#003366" }}>
                  AI: {runPipeline.data.ai.accepted} accepted &nbsp;·&nbsp; {runPipeline.data.ai.rejected} rejected
                </p>
              )}
              <div style={{ marginTop: 8 }}>
                {runPipeline.data.feedResults.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
                    {r.error ? (
                      <span style={{ color: "#b00" }}>✗ {r.name}: {r.error}</span>
                    ) : (
                      <span style={{ color: r.newArticles > 0 ? "#060" : "#666" }}>
                        ✓ {r.name}: {r.newArticles} new
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feed Sources Table */}
          <h2 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 12 }}>Feed Sources</h2>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #000", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Category</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Last Fetched</th>
                <th style={{ padding: "6px 8px" }}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {stats.feeds.map((feed) => (
                <tr key={feed.id} style={{ borderBottom: "1px solid #ddd" }} data-testid={`row-feed-${feed.id}`}>
                  <td style={{ padding: "6px 8px" }}>{feed.name}</td>
                  <td style={{ padding: "6px 8px" }}>{feed.category}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ color: feed.enabled ? "#060" : "#b00" }}>
                      {feed.enabled ? "ON" : "OFF"}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {feed.lastFetchedAt
                      ? new Date(feed.lastFetchedAt).toLocaleString()
                      : "Never"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ color: feed.errorCount > 0 ? "#b00" : "#666" }}>
                      {feed.errorCount}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  ...props
}: {
  label: string;
  value: number;
  accent?: string;
  [key: string]: any;
}) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        padding: "16px",
        textAlign: "center",
      }}
      {...props}
    >
      <div style={{ fontSize: 28, fontWeight: "bold", color: accent ?? "inherit" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{label}</div>
    </div>
  );
}
