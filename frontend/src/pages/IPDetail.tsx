import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, Globe, Clock, FileSearch,
  ChevronLeft, ChevronRight, Server, Shield, Globe2, Database,
  Ban, ShieldCheck, ShieldOff,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { TrafficCard } from "@/components/charts/TrafficChart";
import { security, analytics } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { HostLink } from "@/components/shared/HostLink";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeleton";
import { formatNumber, formatBytes, formatDuration, cn } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import type { PathByStat, IPDetailStats, SecurityEvent } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "activity" | "paths" | "requests" | "security";
type PathFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";
type ReqFilter  = "all" | "2xx" | "3xx" | "4xx" | "5xx";

const TABS: { id: Tab; label: string }[] = [
  { id: "activity",  label: "Activity" },
  { id: "paths",     label: "Paths" },
  { id: "requests",  label: "Requests" },
  { id: "security",  label: "Security" },
];

const PATH_FILTERS: { id: PathFilter; label: string; color: string }[] = [
  { id: "all", label: "All",  color: "" },
  { id: "2xx", label: "2xx", color: "text-emerald-400" },
  { id: "3xx", label: "3xx", color: "text-indigo-400" },
  { id: "4xx", label: "4xx", color: "text-amber-400" },
  { id: "5xx", label: "5xx", color: "text-red-400" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: number): string {
  return s >= 500 ? "text-red-400"
    : s >= 400 ? "text-amber-400"
    : s >= 300 ? "text-indigo-400"
    : "text-emerald-400";
}

// ── Shared sub-components ────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-border rounded-xl card-elevated", className)}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-5 pt-4 pb-3 border-b border-border">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Tile({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 card-elevated">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">{label}</p>
      <p className={cn("text-2xl font-bold tabular text-foreground", accent)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {children}
    </p>
  );
}

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex items-center border-b border-border">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "px-5 py-3 text-sm font-medium transition-colors relative",
            "hover:text-foreground",
            active === t.id
              ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-t"
              : "text-muted-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function BarRow({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground font-medium truncate max-w-[60%]" title={label}>{label}</span>
        <span className="tabular text-muted-foreground flex-shrink-0 ml-2">
          {formatNumber(count)}
          <span className="ml-2 text-[10px]">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// Busy-hours bar chart
function BusyHoursChart({ detail }: { detail: IPDetailStats }) {
  const { palette, tick } = chartColors();
  const hourMap = new Map(detail.busy_hours.map((d) => [d.hour, d]));
  const data = Array.from({ length: 24 }, (_, h) => {
    const found = hourMap.get(h);
    const req = found?.req_count ?? 0;
    const err = found?.err_count ?? 0;
    return { hour: `${h}`, ok: req - err, err };
  });
  const allHoursActive = data.every((d) => d.ok + d.err > 0);
  return (
    <div>
      {allHoursActive && (
        <p className="text-[10px] text-orange-400 mb-2">
          Active every hour of the day — likely automated / bot traffic
        </p>
      )}
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 2, right: 5, bottom: 0, left: 0 }} barGap={0}>
          <XAxis dataKey="hour" tick={{ fontSize: 8, fill: tick }} tickLine={false} axisLine={false} interval={5} />
          <YAxis hide />
          <Tooltip
            contentStyle={tooltipStyle()}
            formatter={(v: number, name: string) => [formatNumber(v), name === "ok" ? "Success" : "Errors"]}
            labelFormatter={(l) => `${l}:00 UTC`}
          />
          <Bar dataKey="ok"  stackId="a" fill={palette[1]} maxBarSize={20} />
          <Bar dataKey="err" stackId="a" fill="#f87171"    maxBarSize={20} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Paths tab ─────────────────────────────────────────────────────────────────

function PathsTab({ ip, mode }: { ip: string; mode: import("@/lib/date-range").DateMode }) {
  const [filter, setFilter] = useState<PathFilter>("all");

  const { data: paths, isLoading } = useQuery({
    queryKey: ["ip-paths", ip, mode],
    queryFn: () => analytics.pathsByStatus(mode, { remote_ip: ip }, 100),
    staleTime: 30_000,
  });

  const countKey: Record<PathFilter, keyof PathByStat | "total"> = {
    all: "total", "2xx": "req_2xx", "3xx": "req_3xx", "4xx": "req_4xx", "5xx": "req_5xx",
  };

  const filtered = (paths ?? [])
    .filter((p) => filter === "all" || (p[countKey[filter] as keyof PathByStat] as number) > 0)
    .sort((a, b) => (b[countKey[filter] as keyof PathByStat] as number) - (a[countKey[filter] as keyof PathByStat] as number));

  return (
    <div>
      {/* Sub-tab filter bar */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-border bg-muted/20">
        {PATH_FILTERS.map((f) => {
          const key = countKey[f.id] as keyof PathByStat;
          const total = (paths ?? []).reduce((s, p) => s + ((p[key] as number) ?? 0), 0);
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              <span className={filter === f.id ? "" : f.color}>{f.label}</span>
              {total > 0 && (
                <span className={cn("text-[10px] tabular px-1 rounded font-semibold",
                  filter === f.id ? "bg-white/20" : "bg-background/50",
                )}>
                  {formatNumber(total)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="p-4"><TableSkeleton rows={10} cols={7} /></div>
      ) : !filtered.length ? (
        <EmptyState title="No paths match this filter" height="h-28" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs data-table">
            <thead>
              <tr>
                <th className="text-left px-4 py-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Path</th>
                <th className="text-right px-3 py-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-16">Total</th>
                <th className="text-right px-3 py-3 text-[10px] text-emerald-500/70 font-semibold uppercase tracking-wider w-14">2xx</th>
                <th className="text-right px-3 py-3 text-[10px] text-indigo-400/70 font-semibold uppercase tracking-wider w-14">3xx</th>
                <th className="text-right px-3 py-3 text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider w-14">4xx</th>
                <th className="text-right px-3 py-3 text-[10px] text-red-400/70 font-semibold uppercase tracking-wider w-14">5xx</th>
                <th className="text-right px-3 py-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-20">Avg</th>
                <th className="text-right px-3 py-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-20">Bytes Out</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const total = p.total || 1;
                return (
                  <tr key={p.path} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-foreground truncate max-w-sm">{p.path}</span>
                        <div className="flex h-1 w-20 rounded-full overflow-hidden flex-shrink-0 gap-px">
                          {p.req_2xx > 0 && <div className="bg-emerald-500" style={{ width: `${(p.req_2xx / total) * 100}%` }} />}
                          {p.req_3xx > 0 && <div className="bg-indigo-400" style={{ width: `${(p.req_3xx / total) * 100}%` }} />}
                          {p.req_4xx > 0 && <div className="bg-amber-400" style={{ width: `${(p.req_4xx / total) * 100}%` }} />}
                          {p.req_5xx > 0 && <div className="bg-red-500"   style={{ width: `${(p.req_5xx / total) * 100}%` }} />}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-foreground font-medium">{formatNumber(p.total)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-emerald-400">{p.req_2xx || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular text-indigo-400">{p.req_3xx || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular text-amber-400">{p.req_4xx || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular text-red-400">{p.req_5xx || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{formatDuration(p.avg_ms)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{formatBytes(p.bytes_out)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── IP status + actions panel ─────────────────────────────────────────────────

function IPActions({ ip }: { ip: string }) {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ["ip-status", ip],
    queryFn: () => security.ipStatus(ip),
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ip-status", ip] });
    qc.invalidateQueries({ queryKey: ["whitelist"] });
    qc.invalidateQueries({ queryKey: ["blocklist"] });
  };

  const block = useMutation({
    mutationFn: () => security.addBlocklist(ip, ""),
    onSuccess: invalidate,
  });
  const unblock = useMutation({
    mutationFn: (id: number) => security.removeBlocklist(id),
    onSuccess: invalidate,
  });
  const whitelist = useMutation({
    mutationFn: () => security.addWhitelist(ip, ""),
    onSuccess: invalidate,
  });
  const removeWhitelist = useMutation({
    mutationFn: (id: number) => security.removeWhitelist(id),
    onSuccess: invalidate,
  });

  if (isLoading || !status) return null;

  return (
    <div className="flex flex-col gap-2 min-w-[160px]">
      {/* Status badges */}
      {status.blocked && (
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium",
          "bg-red-500/10 border-red-500/20 text-red-400",
        )}>
          <Ban className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            {status.block_entry?.is_individual
              ? "Blocked"
              : `Blocked via ${status.block_entry?.cidr}`}
          </span>
        </div>
      )}
      {status.whitelisted && (
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium",
          "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
        )}>
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            {status.whitelist_entry?.is_individual
              ? "Whitelisted"
              : `Whitelisted via ${status.whitelist_entry?.cidr}`}
          </span>
        </div>
      )}

      {/* Block / Unblock */}
      {!status.blocked && (
        <button
          onClick={() => block.mutate()}
          disabled={block.isPending}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
        >
          <Ban className="w-3.5 h-3.5" />
          Block IP
        </button>
      )}
      {status.blocked && status.block_entry?.is_individual && (
        <button
          onClick={() => unblock.mutate(status.block_entry!.id)}
          disabled={unblock.isPending}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ShieldOff className="w-3.5 h-3.5" />
          Remove Block
        </button>
      )}

      {/* Whitelist / Remove whitelist */}
      {!status.whitelisted && (
        <button
          onClick={() => whitelist.mutate()}
          disabled={whitelist.isPending}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Whitelist IP
        </button>
      )}
      {status.whitelisted && status.whitelist_entry?.is_individual && (
        <button
          onClick={() => removeWhitelist.mutate(status.whitelist_entry!.id)}
          disabled={removeWhitelist.isPending}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ShieldOff className="w-3.5 h-3.5" />
          Remove Whitelist
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IPDetail() {
  const { ip = "" } = useParams<{ ip: string }>();
  const navigate = useNavigate();
  const { dateMode } = useUIStore();

  const [tab, setTab] = useState<Tab>("activity");
  const [reqFilter, setReqFilter] = useState<ReqFilter>("all");
  const [reqPage, setReqPage] = useState(1);
  const LIMIT = 50;

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["ip-profile", ip, dateMode],
    queryFn: () => security.ipProfile(ip, dateMode),
    enabled: !!ip,
  });

  const { data: detail } = useQuery({
    queryKey: ["ip-detail", ip, dateMode],
    queryFn: () => analytics.ipDetail(ip, dateMode),
    enabled: !!ip,
    staleTime: 30_000,
  });

  const { data: requests, isLoading: reqLoading } = useQuery({
    queryKey: ["ip-requests", ip, reqFilter, reqPage, dateMode],
    queryFn: () => analytics.requests({
      mode: dateMode,
      filters: { remote_ip: ip, status_class: reqFilter === "all" ? undefined : reqFilter },
      page: reqPage, limit: LIMIT,
    }),
    enabled: !!ip && tab === "requests",
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: secEvents, isLoading: secLoading } = useQuery({
    queryKey: ["ip-sec-events", ip, dateMode],
    queryFn: () => security.events({ mode: dateMode, page: 1 }),
    enabled: !!ip && tab === "security",
    staleTime: 60_000,
  });

  const { palette } = chartColors();
  const totalPages = Math.ceil((requests?.total ?? 0) / LIMIT);

  const threatLevel = !profile ? null
    : profile.max_threat > 70 ? { label: "HIGH",   cls: "text-red-400 bg-red-500/10 border-red-500/20" }
    : profile.max_threat > 40 ? { label: "MEDIUM", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" }
    : { label: "LOW",    cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };

  const timelineData = (detail?.timeline ?? []).map((d) => ({
    ...d,
    time: format(new Date(d.ts), "MMM d HH:mm"),
  }));

  const sc = detail?.status_codes ?? [];
  const count2xx = sc.filter((s) => s.status >= 200 && s.status < 300).reduce((a, s) => a + s.req_count, 0);
  const count3xx = sc.filter((s) => s.status >= 300 && s.status < 400).reduce((a, s) => a + s.req_count, 0);
  const count4xx = sc.filter((s) => s.status >= 400 && s.status < 500).reduce((a, s) => a + s.req_count, 0);
  const count5xx = sc.filter((s) => s.status >= 500).reduce((a, s) => a + s.req_count, 0);

  const filterCounts: Record<ReqFilter, number> = {
    all: profile?.req_count ?? 0,
    "2xx": count2xx, "3xx": count3xx, "4xx": count4xx, "5xx": count5xx,
  };

  const maxStatusCount = Math.max(...sc.map((s) => s.req_count), 1);
  const maxMethodCount = Math.max(...(detail?.methods ?? []).map((m) => m.count), 1);
  const ipEvents = (secEvents?.data ?? []).filter((e: SecurityEvent) => e.remote_ip === ip);

  const ua = detail?.ua_summary;
  const resp = detail?.response_summary;

  return (
    <div className="p-5 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <span>/</span>
        <span className="text-foreground font-mono font-semibold">{ip}</span>
      </div>

      {/* Hero */}
      <div className="bg-card border border-border rounded-xl p-5 card-elevated">
        {profileLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-8 w-48" />
            <div className="skeleton h-4 w-72" />
            <div className="skeleton h-4 w-64" />
          </div>
        ) : (
          <div className="flex flex-col md:flex-row md:items-start gap-5">
            <div className="space-y-2 flex-1 min-w-0">
              {/* IP + badges */}
              <div className="flex items-center gap-3 flex-wrap">
                {profile?.country_code && (
                  <CountryFlag code={profile.country_code} className="w-10 h-7 flex-shrink-0" />
                )}
                <h1 className="text-2xl font-bold font-mono tracking-tight">{ip}</h1>
                {threatLevel && (
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-widest", threatLevel.cls)}>
                    {threatLevel.label} THREAT
                  </span>
                )}
                {(ua?.is_bot_pct ?? 0) > 50 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 uppercase tracking-widest">
                    BOT
                  </span>
                )}
              </div>

              {/* Location + Org */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {(profile?.country_name || profile?.country_code) && (
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    {[profile.country_name, profile.country_code].filter(Boolean).join(" · ")}
                  </span>
                )}
                {profile?.org && (
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3 h-3 flex-shrink-0" />
                    {profile.org}
                    {profile.asn && (
                      <span className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px] ml-1">AS{profile.asn}</span>
                    )}
                  </span>
                )}
              </div>

              {/* Client fingerprint badges */}
              <div className="flex flex-wrap gap-2">
                {ua?.browser && (
                  <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full text-foreground">{ua.browser}</span>
                )}
                {ua?.os && (
                  <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full text-foreground">{ua.os}</span>
                )}
                {ua?.tls_version && (
                  <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full font-mono text-foreground">{ua.tls_version}</span>
                )}
                {ua?.http_proto && (
                  <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full font-mono text-foreground">{ua.http_proto}</span>
                )}
                {ua?.tls_resumed_pct != null && (
                  <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                    {ua.tls_resumed_pct.toFixed(0)}% TLS resumed
                  </span>
                )}
                {(ua?.is_bot_pct ?? 0) > 0 && (
                  <span className={cn("text-[11px] px-2 py-0.5 rounded-full",
                    ua!.is_bot_pct > 50 ? "bg-orange-500/10 text-orange-400" : "bg-muted text-muted-foreground",
                  )}>
                    {ua!.is_bot_pct.toFixed(1)}% bot-flagged
                  </span>
                )}
              </div>

              {/* First / last seen */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {profile?.first_seen && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    First {format(new Date(profile.first_seen), "MMM d yyyy HH:mm")} UTC
                  </span>
                )}
                {profile?.last_seen && (
                  <span>Last {format(new Date(profile.last_seen), "MMM d yyyy HH:mm")} UTC</span>
                )}
              </div>

              {/* Sample UA */}
              {ua?.sample_ua && (
                <p className="text-[10px] text-muted-foreground/50 font-mono truncate mt-1 max-w-xl" title={ua.sample_ua}>
                  {ua.sample_ua}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 flex-shrink-0">
              <Link
                to={`/requests?remote_ip=${ip}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/20 transition-colors whitespace-nowrap"
              >
                <FileSearch className="w-4 h-4" />
                All requests
              </Link>
              <IPActions ip={ip} />
            </div>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Total Requests" value={profile ? formatNumber(profile.req_count) : "—"} />
        <Tile label="Hosts Accessed" value={profile?.hosts_count ?? "—"} />
        <Tile
          label="Error Rate"
          value={profile ? `${(profile.error_rate * 100).toFixed(1)}%` : "—"}
          accent={profile && profile.error_rate > 0.1 ? "text-red-400" : profile && profile.error_rate > 0.05 ? "text-amber-400" : undefined}
        />
        <Tile
          label="Avg Response"
          value={resp ? formatDuration(resp.avg_ms) : "—"}
          sub={resp?.p95_ms ? `P95: ${formatDuration(resp.p95_ms)}` : undefined}
        />
        <Tile
          label="Bandwidth"
          value={resp ? formatBytes(resp.total_bytes_out) : "—"}
          sub={resp ? `In: ${formatBytes(resp.total_bytes_in)}` : undefined}
        />
      </div>

      {/* Traffic timeline */}
      <TrafficCard data={timelineData} height={180} />

      {/* Tab panel */}
      <div className="bg-card border border-border rounded-xl card-elevated overflow-hidden">
        <TabBar active={tab} onChange={(t) => { setTab(t); }} />

        {/* ── Activity tab ── */}
        {tab === "activity" && (
          <div className="p-5 space-y-5">
            {/* Busy hours */}
            {(detail?.busy_hours?.length ?? 0) > 0 && (
              <div className="pt-4 border-t border-border">
                <SectionLabel>Activity by Hour of Day (UTC)</SectionLabel>
                <BusyHoursChart detail={detail!} />
              </div>
            )}

            {/* Cards grid: Hosts | Methods | Status | Client info */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 pt-4 border-t border-border">

              {/* Hosts Accessed */}
              <Card>
                <CardHeader title="Hosts Accessed" sub={`${detail?.hosts_accessed?.length ?? 0} distinct hosts`} />
                <div className="p-4">
                  {!detail?.hosts_accessed?.length ? (
                    <EmptyState icon={Globe2} title="No host data" height="h-16" />
                  ) : (
                    <div className="space-y-0">
                      {detail.hosts_accessed.map((h) => (
                        <div key={h.host} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                          <HostLink host={h.host} className="text-xs truncate max-w-[55%]" />
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="tabular text-xs text-foreground font-medium">{formatNumber(h.req_count)}</span>
                            <span className={cn("text-[10px] tabular",
                              h.error_rate > 0.1 ? "text-red-400" : h.error_rate > 0.05 ? "text-amber-400" : "text-muted-foreground",
                            )}>
                              {(h.error_rate * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* HTTP Methods */}
              <Card>
                <CardHeader title="HTTP Methods" />
                <div className="p-4 space-y-2.5">
                  {!detail?.methods?.length ? (
                    <EmptyState title="No data" height="h-16" />
                  ) : (
                    detail.methods.map((m, i) => (
                      <BarRow
                        key={m.method}
                        label={m.method}
                        count={m.count}
                        total={maxMethodCount}
                        color={palette[i % palette.length]}
                      />
                    ))
                  )}
                </div>
              </Card>

              {/* Status Codes */}
              <Card>
                <CardHeader title="Status Codes" />
                <div className="p-4">
                  {!sc.length ? (
                    <EmptyState title="No data" height="h-16" />
                  ) : (
                    <div className="space-y-2">
                      {sc.map((s) => (
                        <div key={s.status} className="flex items-center gap-2.5 text-xs">
                          <span className={cn("font-mono font-bold tabular w-10 flex-shrink-0 text-sm", statusColor(s.status))}>
                            {s.status}
                          </span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(s.req_count / maxStatusCount) * 100}%`,
                                background:
                                  s.status >= 500 ? "#f87171"
                                  : s.status >= 400 ? "#fbbf24"
                                  : s.status >= 300 ? "#818cf8"
                                  : "#34d399",
                              }}
                            />
                          </div>
                          <span className="tabular text-muted-foreground w-14 text-right flex-shrink-0">
                            {formatNumber(s.req_count)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* Client Fingerprint */}
              <Card>
                <CardHeader title="Client Info" />
                <div className="p-4 space-y-2">
                  {[
                    { label: "Browser",  value: ua?.browser },
                    { label: "OS",       value: ua?.os },
                    { label: "TLS",      value: ua?.tls_version },
                    { label: "Protocol", value: ua?.http_proto },
                    { label: "Bot %",    value: ua?.is_bot_pct != null ? `${ua.is_bot_pct.toFixed(1)}%` : null },
                    { label: "TLS resumed", value: ua?.tls_resumed_pct != null ? `${ua.tls_resumed_pct.toFixed(1)}%` : null },
                  ].filter((row) => row.value).map((row) => (
                    <div key={row.label} className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
                      <span className="text-[11px] text-muted-foreground">{row.label}</span>
                      <span className="text-[11px] text-foreground font-medium font-mono">{row.value}</span>
                    </div>
                  ))}
                  {!ua?.browser && !ua?.os && !ua?.tls_version && (
                    <EmptyState icon={Database} title="No client data" height="h-16" />
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── Paths tab ── */}
        {tab === "paths" && <PathsTab ip={ip} mode={dateMode} />}

        {/* ── Requests tab ── */}
        {tab === "requests" && (
          <div>
            {/* Filter pills */}
            <div className="flex items-center gap-1.5 flex-wrap px-4 py-3 border-b border-border bg-muted/20">
              {(["all", "2xx", "3xx", "4xx", "5xx"] as ReqFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => { setReqFilter(f); setReqPage(1); }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    reqFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80",
                  )}
                >
                  {f === "all" ? "All" : f}
                  {filterCounts[f] > 0 && (
                    <span className={cn("text-[10px] tabular px-1 rounded font-semibold",
                      reqFilter === f ? "bg-white/20" : "bg-background/50",
                    )}>
                      {formatNumber(filterCounts[f])}
                    </span>
                  )}
                </button>
              ))}
              <Link
                to={`/requests?remote_ip=${ip}${reqFilter !== "all" ? `&status_class=${reqFilter}` : ""}`}
                className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open in explorer
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs data-table">
                <thead>
                  <tr className="border-b border-border">
                    {["Time", "Host", "Method", "Path", "Status", "Duration", "Size"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider bg-card">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reqLoading && (
                    <tr><td colSpan={7}><div className="p-4"><TableSkeleton rows={10} cols={7} /></div></td></tr>
                  )}
                  {!reqLoading && (requests?.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground font-mono whitespace-nowrap">
                        {format(new Date(r.ts), "MMM d HH:mm:ss")}
                      </td>
                      <td className="px-3 py-2 max-w-[140px] truncate">
                        {r.host ? <HostLink host={r.host} className="text-xs" /> : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-foreground">{r.method ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-foreground max-w-[260px] truncate">
                        {r.path ?? r.uri ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.status != null
                          ? <span className={cn("font-mono font-bold tabular text-xs", statusColor(r.status))}>{r.status}</span>
                          : "—"}
                      </td>
                      <td className="px-3 py-2 tabular text-muted-foreground">
                        {r.duration_ms != null ? formatDuration(r.duration_ms) : "—"}
                      </td>
                      <td className="px-3 py-2 tabular text-muted-foreground">
                        {r.response_bytes != null ? formatBytes(r.response_bytes) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!reqLoading && !requests?.data?.length && (
                    <tr><td colSpan={7}>
                      <EmptyState title={`No ${reqFilter === "all" ? "" : reqFilter + " "}requests from this IP`} height="h-24" />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
                <span className="text-xs text-muted-foreground tabular">
                  {formatNumber(requests?.total ?? 0)} total · page {reqPage} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                    disabled={reqPage <= 1}
                    onClick={() => setReqPage((p) => p - 1)}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                    disabled={reqPage >= totalPages}
                    onClick={() => setReqPage((p) => p + 1)}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Security tab ── */}
        {tab === "security" && (
          <div>
            {secLoading ? (
              <div className="p-4"><TableSkeleton rows={6} cols={5} /></div>
            ) : !ipEvents.length ? (
              <div className="p-8">
                <EmptyState icon={Shield} title="No security events for this IP in the selected range" height="h-32" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs data-table">
                  <thead>
                    <tr>
                      {["Time", "Event Type", "Severity", "Host", "URI"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ipEvents.map((e) => (
                      <tr key={e.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-muted-foreground font-mono whitespace-nowrap">
                          {format(new Date(e.ts), "MMM d HH:mm:ss")}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-foreground">{e.event_type.replace(/_/g, " ")}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
                            e.severity === "critical" ? "bg-red-500/15 text-red-400"
                            : e.severity === "high"   ? "bg-orange-500/15 text-orange-400"
                            : e.severity === "medium" ? "bg-amber-500/15 text-amber-400"
                            : "bg-blue-500/15 text-blue-400",
                          )}>
                            {e.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {e.host ? <HostLink host={e.host} className="text-xs" /> : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground truncate max-w-64">{e.uri ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
