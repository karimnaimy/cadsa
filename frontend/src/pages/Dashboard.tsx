import { useQuery } from "@tanstack/react-query";
import {
  Activity, HardDrive, Clock, AlertTriangle, Shield,
  ArrowUpRight, CheckCircle2, AlertCircle, XCircle,
  TrendingUp, Users, Globe2, ChevronRight,
} from "lucide-react";
import { TrafficCard } from "@/components/charts/TrafficChart";
import { VisitorsCard } from "@/components/charts/VisitorsChart";
import { format } from "date-fns";
import { granularityToFmt } from "@/lib/date-range";
import { analytics, security } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { useFilters } from "@/hooks/useFilters";
import { FilterBar } from "@/components/shared/FilterBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/shared/StatCard";
import { IPBadge } from "@/components/shared/IPBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatBytes, formatNumber, formatDuration } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";


/* ── System Health Banner ────────────────────────────────────────────────────── */

function HealthBanner({ errorRate, totalReqs, securityEvents }: {
  errorRate: number; totalReqs: number; securityEvents: number;
}) {
  const level = errorRate > 0.1 ? "critical" : errorRate > 0.05 ? "degraded" : "healthy";
  const config = {
    healthy:  { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/8 border-emerald-500/20", dot: "bg-emerald-400", label: "All systems operational" },
    degraded: { icon: AlertCircle,  color: "text-amber-400",   bg: "bg-amber-500/8 border-amber-500/20",    dot: "bg-amber-400",   label: "Performance degraded" },
    critical: { icon: XCircle,      color: "text-red-400",     bg: "bg-red-500/8 border-red-500/20",         dot: "bg-red-400",     label: "High error rate detected" },
  }[level];
  if (totalReqs === 0) return null;
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2.5 rounded-xl border text-xs ${config.bg}`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} style={level !== "healthy" ? {} : { animation: "pulse-dot 2s ease-in-out infinite", boxShadow: "0 0 0 3px rgba(16,185,129,0.2)" }} />
        <config.icon className={`w-3.5 h-3.5 flex-shrink-0 ${config.color}`} />
        <span className={`font-semibold ${config.color}`}>{config.label}</span>
        <span className="text-muted-foreground">—</span>
        <span className="text-muted-foreground">Error rate: <span className={`font-semibold ${config.color}`}>{(errorRate * 100).toFixed(2)}%</span></span>
      </div>
      <div className="flex items-center gap-4 text-muted-foreground">
        {securityEvents > 0 && (
          <a href="/security" className="flex items-center gap-1 hover:text-foreground transition-colors">
            <Shield className="w-3 h-3" />
            <span>{securityEvents} security events</span>
            <ChevronRight className="w-3 h-3" />
          </a>
        )}
        <span className="hidden sm:inline">Updated just now</span>
      </div>
    </div>
  );
}

/* ── Status Distribution Bar ─────────────────────────────────────────────────── */

function StatusBar({ r2, r3, r4, r5, total }: { r2: number; r3: number; r4: number; r5: number; total: number }) {
  if (total === 0) return null;
  const pct = (n: number) => Math.max(0.5, (n / total) * 100);
  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
        <span className="font-medium text-foreground">Response Status Distribution</span>
        <span>{total.toLocaleString()} total requests</span>
      </div>
      <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
        <div className="bg-emerald-500 rounded-l-full transition-all" style={{ width: `${pct(r2)}%` }} />
        <div className="bg-indigo-500 transition-all" style={{ width: `${pct(r3)}%` }} />
        <div className="bg-amber-500 transition-all" style={{ width: `${pct(r4)}%` }} />
        <div className="bg-red-500 rounded-r-full transition-all" style={{ width: `${pct(r5)}%` }} />
      </div>
      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-4 mt-3 text-xs">
        {[
          { label: "2xx Success",  n: r2, color: "bg-emerald-500" },
          { label: "3xx Redirect", n: r3, color: "bg-indigo-500" },
          { label: "4xx Client",   n: r4, color: "bg-amber-500" },
          { label: "5xx Server",   n: r5, color: "bg-red-500" },
        ].map(({ label, n, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-sm flex-shrink-0 ${color}`} />
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold text-foreground tabular">{n.toLocaleString()}</span>
            <span className="text-muted-foreground hidden sm:inline">({total > 0 ? ((n / total) * 100).toFixed(1) : "0"}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const { dateMode } = useUIStore();
  const { filters, setFilter } = useFilters();

  // topCountries never filters by country (it IS the country selector)
  const filtersForCountries = { ...filters, country: undefined };

  const { data: overview, isLoading } = useQuery({
    queryKey: ["overview", dateMode, filters],
    queryFn: () => analytics.overview(dateMode, filters),
    refetchInterval: 30_000,
  });

  const { data: tsResp } = useQuery({
    queryKey: ["timeseries-dash", dateMode, filters],
    queryFn: () => analytics.timeseries(dateMode, filters),
    refetchInterval: 60_000,
  });

  const { data: topCountries } = useQuery({
    queryKey: ["top-countries-dash", dateMode, filtersForCountries],
    queryFn: () => analytics.topCountries(dateMode, filtersForCountries),
  });

  const { data: topPaths } = useQuery({
    queryKey: ["top-paths-dash", dateMode, filters],
    queryFn: () => analytics.topPaths(dateMode, filters, 10),
  });

  const { data: topIPs } = useQuery({
    queryKey: ["top-ips-dash", dateMode, filters],
    queryFn: () => analytics.topIPs(dateMode, filters),
  });

  const { data: recentEvents } = useQuery({
    queryKey: ["security-events-dash", dateMode, filters],
    queryFn: () => security.events({ mode: dateMode, filters }),
    refetchInterval: 30_000,
  });

  const totalReqs   = overview?.total_requests ?? 0;
  const errorRate   = overview?.error_rate ?? 0;
  const req2xx      = overview?.req_2xx ?? 0;
  const req3xx      = overview?.req_3xx ?? 0;
  const req4xx      = overview?.req_4xx ?? 0;
  const req5xx      = overview?.req_5xx ?? 0;
  const eventsCount = recentEvents?.total ?? 0;

  const timeFmt  = granularityToFmt(tsResp?.granularity ?? "hour");
  const chartData = (tsResp?.data ?? []).map((d) => ({
    ...d,
    time:   format(new Date(d.ts), timeFmt),
    errors: (d.req_4xx ?? 0) + (d.req_5xx ?? 0),
  }));

  const topPathsMax = topPaths?.[0]?.req_count ?? 1;

  return (
    <div className="p-5 space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Overview</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dateMode.type === "preset" ? dateMode.preset.replace("l", "").toUpperCase() : "Custom day"} window
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar />

      {/* System health banner */}
      {!isLoading && (
        <HealthBanner errorRate={errorRate} totalReqs={totalReqs} securityEvents={eventsCount} />
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard title="Total Requests" value={formatNumber(totalReqs)} icon={Activity} accent="blue" loading={isLoading}
          sub={`${formatNumber(overview?.unique_ips ?? 0)} unique IPs`} />
        <StatCard title="Bandwidth Out" value={formatBytes(overview?.bytes_out ?? 0)} icon={HardDrive} accent="purple" loading={isLoading}
          sub={`In: ${formatBytes(overview?.bytes_in ?? 0)}`} />
        <StatCard title="P50 Latency" value={overview?.p50_ms != null ? formatDuration(overview.p50_ms) : "—"} icon={Clock} accent="cyan" loading={isLoading}
          sub={`P95: ${overview?.p95_ms != null ? formatDuration(overview.p95_ms) : "—"}`} />
        <StatCard title="Error Rate" value={`${(errorRate * 100).toFixed(2)}%`} icon={errorRate > 0.05 ? AlertTriangle : TrendingUp}
          accent={errorRate > 0.1 ? "red" : errorRate > 0.05 ? "amber" : "green"} loading={isLoading}
          sub={`${formatNumber(req4xx + req5xx)} errors total`} />
      </div>

      {/* Status bar */}
      {!isLoading && <StatusBar r2={req2xx} r3={req3xx} r4={req4xx} r5={req5xx} total={totalReqs} />}

      {/* Traffic + Visitors charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrafficCard data={chartData} height={200} className="lg:col-span-2" />
        <VisitorsCard data={chartData} height={160} />
      </div>

      {/* Bottom grid: Countries | Endpoints | IPs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Top countries */}
        <Card className="card-elevated">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-muted-foreground" /> Countries
              </CardTitle>
              <a href="/geo" className="text-xs text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
                View all <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-0.5 pt-0">
            {(topCountries ?? []).slice(0, 8).map((co, i) => {
              const pct  = totalReqs > 0 ? (co.req_count / totalReqs) * 100 : 0;
              const active = filters.country === co.country_code;
              return (
                <div
                  key={co.country_code}
                  className={`flex items-center gap-2.5 py-1.5 rounded-lg px-1 transition-colors group cursor-pointer hover:bg-muted/30 ${active ? "bg-teal-500/8 border border-teal-500/20" : ""}`}
                  onClick={() => setFilter("country", active ? "" : co.country_code)}
                >
                  <span className="text-muted-foreground text-xs tabular w-4 text-center">{i + 1}</span>
                  <CountryFlag code={co.country_code} className="w-5 h-3.5 flex-shrink-0" />
                  <span className="text-xs text-foreground flex-1 truncate">{co.country_name ?? co.country_code}</span>
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${active ? "bg-teal-500/70" : "bg-primary/70"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular w-10 text-right">{formatNumber(co.req_count)}</span>
                </div>
              );
            })}
            {!topCountries?.length && <EmptyState title="No geo data" description="GeoIP not configured" height="h-24" />}
          </CardContent>
        </Card>

        {/* Top endpoints */}
        <Card className="card-elevated">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold">Top Endpoints</CardTitle>
              <a href="/analytics" className="text-xs text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
                Analytics <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-0.5 pt-0">
            {(topPaths ?? []).slice(0, 8).map((p, i) => {
              const pct = topPathsMax > 0 ? (p.req_count / topPathsMax) * 100 : 0;
              return (
                <div key={p.path} className="flex items-center gap-2 py-1.5 hover:bg-muted/30 rounded-lg px-1 transition-colors">
                  <span className="text-muted-foreground text-xs tabular w-4 text-center">{i + 1}</span>
                  <span className="text-xs text-foreground flex-1 truncate font-mono text-[11px]">{p.path}</span>
                  <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                    <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular w-10 text-right">{formatNumber(p.req_count)}</span>
                </div>
              );
            })}
            {!topPaths?.length && <EmptyState title="No endpoint data" height="h-24" />}
          </CardContent>
        </Card>

        {/* Top IPs + Recent events */}
        <div className="space-y-4">
          <Card className="card-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-muted-foreground" /> Top IPs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {(topIPs ?? []).slice(0, 5).map((ip) => (
                <div key={ip.remote_ip} className="flex items-center gap-2 py-1 hover:bg-muted/30 rounded-lg px-1 transition-colors">
                  <CountryFlag code={ip.country_code} className="w-5 h-3.5 flex-shrink-0" />
                  <IPBadge ip={ip.remote_ip} className="flex-1 min-w-0 text-xs" />
                  {ip.threat_score > 40 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded badge-high">{ip.threat_score}</span>
                  )}
                  <span className="text-xs text-muted-foreground tabular">{formatNumber(ip.req_count)}</span>
                </div>
              ))}
              {!topIPs?.length && <EmptyState title="No IP data" height="h-16" />}
            </CardContent>
          </Card>

          {(recentEvents?.data.length ?? 0) > 0 && (
            <Card className="card-elevated" style={{ borderColor: "rgba(239,68,68,0.15)" }}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">Security Events</span>
                  </CardTitle>
                  <a href="/security" className="text-xs text-primary/70 hover:text-primary flex items-center gap-0.5 transition-colors">
                    View all <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {(recentEvents?.data ?? []).slice(0, 4).map((e) => (
                  <div key={e.id} className="flex items-start gap-2 py-1 border-b border-border/30 last:border-0">
                    <div className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${e.severity === "critical" ? "bg-red-500" : e.severity === "high" ? "bg-orange-400" : "bg-amber-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground font-mono truncate">{e.event_type.replace(/_/g, " ")}</p>
                      <p className="text-[10px] text-muted-foreground">{e.remote_ip} · {format(new Date(e.ts), "HH:mm:ss")}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
