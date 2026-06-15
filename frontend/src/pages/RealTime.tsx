import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Pause, Play, Activity, AlertCircle, Clock,
  Globe, Users, HardDrive, Zap,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { wsClient } from "@/lib/websocket";
import type { RequestRow, LiveMetrics, WSMessage, Filters } from "@/types";
import { FilterBar } from "@/components/shared/FilterBar";

import { formatBytes, formatDuration, formatNumber, cn } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import { useFilters } from "@/hooks/useFilters";

const MAX_CHART_POINTS = 90;
const MAX_ROWS = 500;
const LOCAL_WINDOW_MS = 30_000;

interface ChartPoint {
  time:       string;
  rps_2xx:    number;
  rps_4xx:    number;
  rps_5xx:    number;
  rps:        number;
  p50:        number;
  err_pct:    number;
  unique_ips: number;
}

interface LocalEvent {
  t:       number;
  sc:      string;
  d:       number | null;
  bo:      number;
  bi:      number;
  ip:      string;
  host:    string;
  method:  string;
  path:    string;
  country: string;
}

/* ── Compute live metrics from filtered local event buffer ─────────────────── */

function computeLocalMetrics(events: LocalEvent[], filters: Filters): LiveMetrics | null {
  const now = Date.now();
  const cutoff = now - LOCAL_WINDOW_MS;
  while (events.length > 0 && events[0].t < cutoff) events.shift();

  // Apply non-host filters client-side (host already filtered by WS server)
  const matched = events.filter((e) => {
    if (filters.remote_ip    && e.ip      !== filters.remote_ip)    return false;
    if (filters.method       && e.method  !== filters.method)       return false;
    if (filters.status_class && e.sc      !== filters.status_class) return false;
    if (filters.path         && !e.path.includes(filters.path))     return false;
    if (filters.country      && e.country !== filters.country)      return false;
    return true;
  });

  const n = matched.length;
  if (n === 0) return null;

  const elapsed = n >= 2
    ? Math.max((matched[matched.length - 1].t - matched[0].t) / 1000, 0.5)
    : LOCAL_WINDOW_MS / 1000;

  const c2 = matched.filter((e) => e.sc === "2xx").length;
  const c3 = matched.filter((e) => e.sc === "3xx").length;
  const c4 = matched.filter((e) => e.sc === "4xx").length;
  const c5 = matched.filter((e) => e.sc === "5xx").length;
  const durs = matched.map((e) => e.d).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const p50 = durs.length > 0 ? durs[Math.floor(durs.length / 2)] : 0;

  return {
    req_count:  n,
    rps:        parseFloat((n / elapsed).toFixed(2)),
    rps_2xx:    parseFloat((c2 / elapsed).toFixed(2)),
    rps_3xx:    parseFloat((c3 / elapsed).toFixed(2)),
    rps_4xx:    parseFloat((c4 / elapsed).toFixed(2)),
    rps_5xx:    parseFloat((c5 / elapsed).toFixed(2)),
    error_rate: parseFloat(((c4 + c5) / Math.max(n, 1)).toFixed(4)),
    unique_ips: new Set(matched.map((e) => e.ip)).size,
    p50_ms:     p50,
    bytes_out:  matched.reduce((s, e) => s + e.bo, 0),
    bytes_in:   matched.reduce((s, e) => s + e.bi, 0),
    req_2xx: c2, req_3xx: c3, req_4xx: c4, req_5xx: c5,
  };
}

function rowMatchesFilters(r: RequestRow, filters: Filters): boolean {
  if (filters.host         && r.host         !== filters.host)         return false;
  if (filters.remote_ip    && r.remote_ip    !== filters.remote_ip)    return false;
  if (filters.method       && r.method       !== filters.method)       return false;
  if (filters.status_class && r.status_class !== filters.status_class) return false;
  if (filters.path         && !r.path?.includes(filters.path))         return false;
  if (filters.country      && r.country_code !== filters.country)      return false;
  return true;
}

/* ── Connection status indicator ─────────────────────────────────────────────── */

function ConnStatus({ connected }: { connected: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border",
      connected
        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
        : "bg-muted border-border text-muted-foreground",
    )}>
      <span
        className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", connected ? "bg-emerald-400" : "bg-muted-foreground")}
        style={connected ? { animation: "pulse-dot 2s ease-in-out infinite", boxShadow: "0 0 0 3px rgba(52,211,153,0.2)" } : {}}
      />
      {connected ? "Live" : "Disconnected"}
    </div>
  );
}

/* ── Metric tile ─────────────────────────────────────────────────────────────── */

function MetricTile({
  label, value, sub, icon: Icon, accent = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent?: "default" | "green" | "red" | "amber" | "blue" | "purple";
}) {
  const styles: Record<string, { icon: string; glow: string; bg: string }> = {
    default: { icon: "text-muted-foreground", glow: "",                                        bg: "bg-muted/30" },
    green:   { icon: "text-emerald-400",      glow: "shadow-[0_0_12px_rgba(52,211,153,0.2)]", bg: "bg-emerald-500/10" },
    red:     { icon: "text-red-400",          glow: "shadow-[0_0_12px_rgba(239,68,68,0.2)]",  bg: "bg-red-500/10" },
    amber:   { icon: "text-amber-400",        glow: "shadow-[0_0_12px_rgba(251,191,36,0.2)]", bg: "bg-amber-500/10" },
    blue:    { icon: "text-indigo-400",       glow: "shadow-[0_0_12px_rgba(99,102,241,0.2)]", bg: "bg-indigo-500/10" },
    purple:  { icon: "text-purple-400",       glow: "shadow-[0_0_12px_rgba(168,85,247,0.2)]", bg: "bg-purple-500/10" },
  };
  const s = styles[accent];

  return (
    <div className={cn("relative bg-card border border-border rounded-xl p-4 flex flex-col gap-2 card-elevated overflow-hidden", s.glow)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", s.bg)}>
          <Icon className={cn("w-3.5 h-3.5", s.icon)} />
        </div>
      </div>
      <p className="text-3xl font-bold tabular leading-none tracking-tight text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground leading-none">{sub}</p>}
    </div>
  );
}

/* ── Live breakdown panels ───────────────────────────────────────────────────── */

function CountryFeed({ rows }: { rows: RequestRow[] }) {
  const counts = useMemo(() => {
    const map: Record<string, { code: string; name?: string; count: number }> = {};
    for (const r of rows) {
      if (!r.country_code) continue;
      if (!map[r.country_code]) map[r.country_code] = { code: r.country_code, name: r.country_name, count: 0 };
      map[r.country_code].count++;
    }
    return Object.values(map).sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code));
  }, [rows]);

  const max = Math.max(...counts.map((c) => c.count), 1);

  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active Countries</p>
      {counts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Waiting for traffic…</p>
      ) : (
        <div className="space-y-2">
          {counts.map((c) => (
            <div key={c.code} className="flex items-center gap-2">
              <CountryFlag code={c.code} className="w-5 h-3.5 flex-shrink-0" />
              <span className="text-xs text-foreground flex-1 truncate">{c.name ?? c.code}</span>
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${(c.count / max) * 100}%` }} />
              </div>
              <span className="text-xs text-muted-foreground tabular w-8 text-right">{c.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HostFeed({ rows }: { rows: RequestRow[] }) {
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.host] = (map[r.host] ?? 0) + 1;
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const max = Math.max(...counts.map(([, c]) => c), 1);

  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active Hosts</p>
      {counts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Waiting for traffic…</p>
      ) : (
        <div className="space-y-2">
          {counts.map(([host, count]) => (
            <div key={host} className="flex items-center gap-2">
              <Link
                to={`/hosts/${encodeURIComponent(host)}`}
                className="font-mono flex-1 min-w-0 truncate text-[11px] text-foreground hover:text-primary transition-colors"
                title={host}
              >
                {host}
              </Link>
              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                <div className="h-full bg-cyan-500/70 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <span className="text-xs text-muted-foreground tabular w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IPFeed({ rows }: { rows: RequestRow[] }) {
  const counts = useMemo(() => {
    const map: Record<string, { count: number; threat: number; country?: string }> = {};
    for (const r of rows) {
      if (!map[r.remote_ip]) map[r.remote_ip] = { count: 0, threat: r.threat_score ?? 0, country: r.country_code };
      map[r.remote_ip].count++;
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 10);
  }, [rows]);

  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active IPs</p>
      {counts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Waiting for traffic…</p>
      ) : (
        <div className="space-y-1.5">
          {counts.map(([ip, { count, threat, country }]) => (
            <div key={ip} className="flex items-center gap-2 text-xs">
              <CountryFlag code={country} className="w-5 h-3.5 flex-shrink-0" />
              <Link
                to={`/ip/${encodeURIComponent(ip)}`}
                className="font-mono flex-1 min-w-0 truncate text-[11px] text-foreground hover:text-primary transition-colors"
                title={ip}
              >
                {ip}
              </Link>
              {threat > 40 && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0",
                  threat > 70 ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400",
                )}>{threat}</span>
              )}
              <span className="text-muted-foreground tabular w-8 text-right flex-shrink-0">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────────── */

export default function RealTime() {
  const { filters, activeCount } = useFilters();

  const [rows, setRows]           = useState<RequestRow[]>([]);
  const [metrics, setMetrics]     = useState<LiveMetrics | null>(null);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused]       = useState(false);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);

  const pausedRef   = useRef(false);
  const filtersRef  = useRef<Filters>(filters);
  const localEventsRef = useRef<LocalEvent[]>([]);
  const localTickRef   = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // WebSocket lifecycle
  useEffect(() => {
    wsClient.connect();

    const offMsg = wsClient.onMessage((msg: WSMessage) => {
      if (msg.type === "new_request" && !pausedRef.current) {
        const r = msg.data;
        setRows((prev) => [r, ...prev].slice(0, MAX_ROWS));
        localEventsRef.current.push({
          t:       Date.now(),
          sc:      r.status_class ?? "",
          d:       r.duration_ms ?? null,
          bo:      r.response_bytes ?? 0,
          bi:      r.request_bytes ?? 0,
          ip:      r.remote_ip ?? "",
          host:    r.host ?? "",
          method:  r.method ?? "",
          path:    r.path ?? "",
          country: r.country_code ?? "",
        });
      } else if (msg.type === "metrics_update") {
        // Only use server metrics when no filters active — server metrics are all-host/unfiltered
        if (!Object.values(filtersRef.current).some(Boolean) && !pausedRef.current) {
          const d = msg.data;
          setMetrics(d);
          setChartData((prev) => [
            ...prev,
            {
              time:       format(new Date(), "HH:mm:ss"),
              rps_2xx:    d.rps_2xx,
              rps_4xx:    d.rps_4xx,
              rps_5xx:    d.rps_5xx,
              rps:        d.rps,
              p50:        d.p50_ms,
              err_pct:    parseFloat((d.error_rate * 100).toFixed(2)),
              unique_ips: d.unique_ips,
            },
          ].slice(-MAX_CHART_POINTS));
        }
      } else if (msg.type === "replay") {
        const f = filtersRef.current;
        const data = f ? msg.data.filter((r: RequestRow) => rowMatchesFilters(r, f)) : msg.data;
        setRows([...data].reverse().slice(0, MAX_ROWS));
      }
    });

    const offStatus = wsClient.onStatus(setConnected);
    return () => { offMsg(); offStatus(); wsClient.disconnect(); };
  }, []);

  // When filters change: update WS host filter, clear stale data, manage local tick
  useEffect(() => {
    wsClient.send({ type: "filter", host: filters.host ?? undefined });

    setRows([]);
    setChartData([]);
    setMetrics(null);
    localEventsRef.current = [];
    clearInterval(localTickRef.current);

    const anyFilter = Object.values(filters).some(Boolean);
    if (anyFilter) {
      localTickRef.current = setInterval(() => {
        if (pausedRef.current) return;
        const m = computeLocalMetrics(localEventsRef.current, filtersRef.current);
        if (!m) return;
        setMetrics(m);
        setChartData((prev) => [
          ...prev,
          {
            time:       format(new Date(), "HH:mm:ss"),
            rps_2xx:    m.rps_2xx,
            rps_4xx:    m.rps_4xx,
            rps_5xx:    m.rps_5xx,
            rps:        m.rps,
            p50:        m.p50_ms,
            err_pct:    parseFloat((m.error_rate * 100).toFixed(2)),
            unique_ips: m.unique_ips,
          },
        ].slice(-MAX_CHART_POINTS));
      }, 1000);
    }

    return () => clearInterval(localTickRef.current);
  }, [filters]);

  const { grid, tick } = chartColors();

  const filteredRows = useMemo(
    () => rows.filter((r) => rowMatchesFilters(r, filters)),
    [rows, filters],
  );

  const uniqueIPs       = useMemo(() => new Set(filteredRows.map((r) => r.remote_ip)).size,                    [filteredRows]);
  const uniqueCountries = useMemo(() => new Set(filteredRows.map((r) => r.country_code).filter(Boolean)).size, [filteredRows]);
  const activeHosts     = useMemo(() => new Set(filteredRows.map((r) => r.host)).size,                         [filteredRows]);
  const errorRateAccent = (metrics?.error_rate ?? 0) > 0.1 ? "red" : (metrics?.error_rate ?? 0) > 0.05 ? "amber" : "green";

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground tracking-tight">Real-Time Monitor</h1>
          <ConnStatus connected={connected} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded-lg border text-xs font-medium transition-all",
              paused
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {paused ? <><Play className="w-3.5 h-3.5" />Resume</> : <><Pause className="w-3.5 h-3.5" />Pause</>}
          </button>
        </div>
      </div>

      {/* Filters */}
      <FilterBar />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricTile label="Req / sec"    value={metrics ? metrics.rps.toFixed(1) : "—"}
          sub="Current rate" icon={Zap} accent="blue" />
        <MetricTile label="Error rate"   value={metrics ? `${(metrics.error_rate * 100).toFixed(1)}%` : "—"}
          sub={metrics ? `${metrics.req_4xx + metrics.req_5xx} errors` : undefined} icon={AlertCircle} accent={errorRateAccent} />
        <MetricTile label="P50 latency"  value={metrics ? formatDuration(metrics.p50_ms) : "—"}
          sub="Median response" icon={Clock} />
        <MetricTile label="Unique IPs"   value={metrics ? formatNumber(metrics.unique_ips) : String(uniqueIPs || "—")}
          sub={`${uniqueCountries} countr${uniqueCountries === 1 ? "y" : "ies"}`} icon={Users} accent="green" />
        <MetricTile label="Active hosts" value={String(activeHosts || "—")}
          sub={activeCount > 0 ? "filtered view" : "In live window"} icon={Globe} accent="purple" />
        <MetricTile label="Bandwidth"    value={metrics ? formatBytes(metrics.bytes_out) : "—"}
          sub={metrics ? `In: ${formatBytes(metrics.bytes_in)}` : undefined} icon={HardDrive} />
      </div>

      {/* Chart 1: Request rate */}
      <div className="bg-card border border-border rounded-xl card-elevated overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-semibold text-foreground">Request Rate</span>
            <span className="text-xs text-muted-foreground">
              req/s · 90-second window{filters.host ? ` · ${filters.host}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" /><span>2xx</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-amber-400/80" /><span>4xx</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-red-500/80" /><span>5xx</span></div>
          </div>
        </div>
        <div className="px-2 pt-2 pb-4">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} stackOffset="none">
              <defs>
                <linearGradient id="g2xx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#10b981" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="g4xx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.7} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.15} />
                </linearGradient>
                <linearGradient id="g5xx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: tick }} tickLine={false} axisLine={false} interval={14} />
              <YAxis
                tick={{ fontSize: 10, fill: tick }}
                tickLine={false}
                axisLine={false}
                width={38}
                tickFormatter={(v: number) => v.toFixed(v < 10 ? 1 : 0)}
                domain={[0, "auto"]}
                allowDataOverflow={false}
              />
              <Tooltip
                contentStyle={tooltipStyle()}
                formatter={(v: number, name: string) => [`${v.toFixed(2)} req/s`, name]}
                labelFormatter={(l) => `Time: ${l}`}
              />
              <Area type="monotone" dataKey="rps_2xx" name="2xx/s" stackId="1" stroke="#10b981" fill="url(#g2xx)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="rps_4xx" name="4xx/s" stackId="1" stroke="#f59e0b" fill="url(#g4xx)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="rps_5xx" name="5xx/s" stackId="1" stroke="#ef4444" fill="url(#g5xx)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts 2 + 3 + 4 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl card-elevated overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-foreground">Error Rate</span>
            <span className="text-xs text-muted-foreground">% · auto-scale</span>
          </div>
          <div className="px-2 pt-2 pb-4">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="gerr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} interval={14} />
                <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={36} unit="%" domain={[0, "auto"]} allowDataOverflow={false} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [`${v.toFixed(2)}%`, "Error rate"]} />
                <Area type="monotone" dataKey="err_pct" name="Error %" stroke="#ef4444" fill="url(#gerr)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl card-elevated overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-foreground">P50 Latency</span>
            <span className="text-xs text-muted-foreground">ms · auto-scale</span>
          </div>
          <div className="px-2 pt-2 pb-4">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="glat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} interval={14} />
                <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={42} unit="ms" domain={[0, "auto"]} allowDataOverflow={false} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [`${v} ms`, "P50"]} />
                <Area type="monotone" dataKey="p50" name="P50" stroke="#f59e0b" fill="url(#glat)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl card-elevated overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
            <Users className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-foreground">Unique Visitors</span>
            <span className="text-xs text-muted-foreground">rolling window</span>
          </div>
          <div className="px-2 pt-2 pb-4">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="gvis" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} interval={14} />
                <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={32} allowDecimals={false} domain={[0, "auto"]} allowDataOverflow={false} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [`${v}`, "Unique IPs"]} />
                <Area type="monotone" dataKey="unique_ips" name="Unique IPs" stroke="#8b5cf6" fill="url(#gvis)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Live breakdown panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CountryFeed rows={filteredRows} />
        <HostFeed    rows={filteredRows} />
        <IPFeed      rows={filteredRows} />
      </div>
    </div>
  );
}
