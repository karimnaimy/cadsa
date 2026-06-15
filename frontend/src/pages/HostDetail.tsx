import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, Globe2, Globe, ExternalLink, FileSearch,
  TrendingUp, Users, Activity, Zap, Monitor, Smartphone, Bot,
  MapPin,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { analytics } from "@/lib/api";
import { TrafficCard } from "@/components/charts/TrafficChart";
import { VisitorsCard } from "@/components/charts/VisitorsChart";
import { useUIStore } from "@/stores/ui";
import { IPBadge } from "@/components/shared/IPBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeleton";
import { formatNumber, formatBytes, formatDuration, cn } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import { granularityToFmt } from "@/lib/date-range";
import type { PathByStat, SlowPath, HostHourStat, TopCity, OSStat } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = "patterns" | "paths" | "audience" | "clients";
type PathFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";

const TABS: { id: Tab; label: string }[] = [
  { id: "patterns", label: "Patterns" },
  { id: "paths",    label: "Paths" },
  { id: "audience", label: "Audience" },
  { id: "clients",  label: "Clients" },
];

const PATH_FILTERS: { id: PathFilter; label: string; color: string }[] = [
  { id: "all", label: "All",  color: "" },
  { id: "2xx", label: "2xx", color: "text-emerald-400" },
  { id: "3xx", label: "3xx", color: "text-indigo-400" },
  { id: "4xx", label: "4xx", color: "text-amber-400" },
  { id: "5xx", label: "5xx", color: "text-red-400" },
];

// ── Hour×Day heatmap ─────────────────────────────────────────────────────────

const ISO_DOW    = [1, 2, 3, 4, 5, 6, 0];
const ISO_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function heatCell(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return "bg-muted/20";
  const r = count / maxCount;
  if (r < 0.12) return "bg-primary/12";
  if (r < 0.25) return "bg-primary/25";
  if (r < 0.45) return "bg-primary/45";
  if (r < 0.65) return "bg-primary/65";
  if (r < 0.82) return "bg-primary/82";
  return "bg-primary";
}

function HourHeatmap({ data }: { data: HostHourStat[] }) {
  const lookup = new Map(data.map((d) => [`${d.dow}-${d.hour}`, d.req_count]));
  const maxCount = Math.max(...data.map((d) => d.req_count), 1);

  return (
    <div className="select-none">
      <div className="flex ml-9 mb-1">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground">
            {h % 6 === 0 ? `${h}h` : ""}
          </div>
        ))}
      </div>
      {ISO_DOW.map((dow, i) => (
        <div key={dow} className="flex items-center gap-1 mb-0.5">
          <div className="w-8 text-[9px] text-muted-foreground text-right pr-1 flex-shrink-0">
            {ISO_LABELS[i]}
          </div>
          <div className="flex flex-1 gap-0.5">
            {Array.from({ length: 24 }, (_, h) => {
              const count = lookup.get(`${dow}-${h}`) ?? 0;
              return (
                <div
                  key={h}
                  title={`${ISO_LABELS[i]} ${h}:00 UTC — ${formatNumber(count)} requests`}
                  className={cn("flex-1 h-5 rounded-sm transition-colors cursor-default", heatCell(count, maxCount))}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between mt-2 px-9">
        <span className="text-[9px] text-muted-foreground">All times UTC</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground">Low</span>
          {[0.12, 0.30, 0.55, 0.75, 1].map((r, i) => (
            <div key={i} className={cn("w-3 h-3 rounded-sm", heatCell(Math.ceil(r * maxCount), maxCount))} />
          ))}
          <span className="text-[9px] text-muted-foreground">High</span>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-border rounded-xl card-elevated", className)}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-5 pt-5 pb-3 border-b border-border">
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
    <div className="flex items-center border-b border-border overflow-x-auto">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "px-5 py-3 text-sm font-medium transition-colors relative whitespace-nowrap",
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

// Horizontal bar with label + count + %
function BarRow({ label, count, total, color, prefix }: {
  label: string; count: number; total: number; color: string; prefix?: React.ReactNode;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-foreground font-medium truncate max-w-[60%]" title={label}>
          {prefix}
          {label}
        </span>
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

// ── Paths tab ─────────────────────────────────────────────────────────────────

function PathsTab({ host, mode }: { host: string; mode: import("@/lib/date-range").DateMode }) {
  const [filter, setFilter] = useState<PathFilter>("all");

  const { data: paths, isLoading } = useQuery({
    queryKey: ["host-paths", host, mode],
    queryFn: () => analytics.pathsByStatus(mode, { host }, 100),
    staleTime: 30_000,
  });

  const { data: slowPaths, isLoading: slowLoading } = useQuery({
    queryKey: ["host-slowest", host, mode],
    queryFn: () => analytics.slowestPaths(mode, { host }),
    staleTime: 30_000,
  });

  const countKey: Record<PathFilter, keyof PathByStat | "total"> = {
    all: "total", "2xx": "req_2xx", "3xx": "req_3xx", "4xx": "req_4xx", "5xx": "req_5xx",
  };

  const filtered = (paths ?? [])
    .filter((p) => filter === "all" || (p[countKey[filter] as keyof PathByStat] as number) > 0)
    .sort((a, b) => (b[countKey[filter] as keyof PathByStat] as number) - (a[countKey[filter] as keyof PathByStat] as number));

  const maxSlowP95 = Math.max(...(slowPaths ?? []).map((p) => p.p95_ms), 1);

  return (
    <div className="divide-y divide-border">
      {/* Paths by status — tabular with filter sub-tabs */}
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
          <div className="p-4"><TableSkeleton rows={12} cols={7} /></div>
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

      {/* Slowest paths */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionLabel>Slowest Paths — P95 Latency</SectionLabel>
          <span className="text-[10px] text-muted-foreground">Min 3 requests · sorted by P95</span>
        </div>
        {slowLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : !slowPaths?.length ? (
          <EmptyState icon={Zap} title="Not enough data for latency ranking" height="h-20" />
        ) : (
          <table className="w-full text-xs data-table">
            <thead>
              <tr>
                <th className="text-left pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Path</th>
                <th className="text-right pb-2 text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider w-24">P95</th>
                <th className="text-right pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-20">P50</th>
                <th className="text-right pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-20">Avg</th>
                <th className="text-right pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-16">Reqs</th>
              </tr>
            </thead>
            <tbody>
              {(slowPaths as SlowPath[]).map((p) => (
                <tr key={p.path} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 font-mono text-[11px] text-foreground truncate max-w-sm pr-4">{p.path}</td>
                  <td className="py-2.5 text-right tabular">
                    <span className={cn("font-semibold",
                      p.p95_ms > 2000 ? "text-red-400" : p.p95_ms > 500 ? "text-amber-400" : "text-foreground",
                    )}>
                      {formatDuration(p.p95_ms)}
                    </span>
                    <div className="h-0.5 bg-muted rounded-full overflow-hidden mt-1">
                      <div
                        className={cn("h-full rounded-full", p.p95_ms > 2000 ? "bg-red-400" : p.p95_ms > 500 ? "bg-amber-400" : "bg-primary/60")}
                        style={{ width: `${(p.p95_ms / maxSlowP95) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular text-muted-foreground">{formatDuration(p.p50_ms)}</td>
                  <td className="py-2.5 text-right tabular text-muted-foreground">{formatDuration(p.avg_ms)}</td>
                  <td className="py-2.5 text-right tabular text-muted-foreground">{formatNumber(p.req_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Audience tab ───────────────────────────────────────────────────────────────

function AudienceTab({ host, mode }: { host: string; mode: import("@/lib/date-range").DateMode }) {
  const { data: topIPs } = useQuery({
    queryKey: ["host-top-ips", host, mode],
    queryFn: () => analytics.topIPs(mode, { host }),
    staleTime: 30_000,
  });

  const { data: topCountries } = useQuery({
    queryKey: ["host-top-countries", host, mode],
    queryFn: () => analytics.topCountries(mode, { host }),
    staleTime: 60_000,
  });

  const { data: topCities } = useQuery({
    queryKey: ["host-top-cities", host, mode],
    queryFn: () => analytics.topCities(mode, { host }, 30),
    staleTime: 60_000,
  });

  const { palette } = chartColors();
  const totalIPs = (topIPs ?? []).reduce((s, t) => s + t.req_count, 0) || 1;
  const maxCountryReqs = (topCountries ?? [])[0]?.req_count || 1;
  const maxCityReqs = (topCities ?? [])[0]?.req_count || 1;

  return (
    <div className="p-5 space-y-5">
      {/* Top IPs + Top Countries — 2 column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Visitors (IPs) */}
        <Card>
          <CardHeader title="Top Visitors" sub="IPs by request count" />
          <div className="p-5">
            {!topIPs ? (
              <TableSkeleton rows={8} cols={4} />
            ) : !topIPs.length ? (
              <EmptyState icon={Users} title="No visitor data" height="h-24" />
            ) : (
              <div className="space-y-0 -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">IP</th>
                      <th className="text-left pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Country</th>
                      <th className="text-right pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Reqs</th>
                      <th className="text-right pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1 w-12">Err%</th>
                      <th className="text-right pb-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1 w-12">Threat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topIPs.map((t) => (
                      <tr key={t.remote_ip} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-1"><IPBadge ip={t.remote_ip} /></td>
                        <td className="py-2 px-1">
                          <span className="flex items-center gap-1 text-muted-foreground text-[10px]">
                            <CountryFlag code={t.country_code} className="w-5 h-3.5 flex-shrink-0" />
                            <span className="truncate max-w-[80px]">{t.country_name ?? t.country_code ?? "—"}</span>
                          </span>
                        </td>
                        <td className="py-2 px-1 text-right">
                          <span className="tabular text-foreground font-medium">{formatNumber(t.req_count)}</span>
                          <div className="h-0.5 bg-muted rounded-full overflow-hidden mt-0.5">
                            <div className="h-full rounded-full bg-primary/50" style={{ width: `${(t.req_count / totalIPs) * 100}%` }} />
                          </div>
                        </td>
                        <td className={cn("py-2 px-1 text-right tabular text-[11px]",
                          t.error_rate > 0.1 ? "text-red-400" : t.error_rate > 0.05 ? "text-amber-400" : "text-muted-foreground",
                        )}>
                          {(t.error_rate * 100).toFixed(1)}%
                        </td>
                        <td className="py-2 px-1 text-right">
                          {t.threat_score > 0 ? (
                            <span className={cn("text-[10px] font-semibold tabular",
                              t.threat_score > 70 ? "text-red-400" : t.threat_score > 40 ? "text-amber-400" : "text-muted-foreground",
                            )}>
                              {t.threat_score}
                            </span>
                          ) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Top Countries */}
        <Card>
          <CardHeader title="Top Countries" sub="Requests by country of origin" />
          <div className="p-5">
            {!topCountries ? (
              <TableSkeleton rows={8} cols={4} />
            ) : !topCountries.length ? (
              <EmptyState icon={Globe} title="No geographic data" height="h-24" />
            ) : (
              <div className="space-y-3">
                {topCountries.slice(0, 15).map((c) => (
                  <div key={c.country_code} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-foreground font-medium">
                        <CountryFlag code={c.country_code} className="w-6 h-4 flex-shrink-0" />
                        {c.country_name ?? c.country_code}
                        <span className="text-[9px] text-muted-foreground font-mono">{c.country_code}</span>
                      </span>
                      <span className="tabular text-muted-foreground flex-shrink-0 ml-2">
                        {formatNumber(c.req_count)}
                        <span className="ml-2 text-[10px] text-emerald-400/70">{c.unique_ips} IPs</span>
                        {c.error_rate > 0.05 && (
                          <span className={cn("ml-2 text-[10px]", c.error_rate > 0.15 ? "text-red-400" : "text-amber-400")}>
                            {(c.error_rate * 100).toFixed(0)}% err
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(c.req_count / maxCountryReqs) * 100}%`, background: palette[0] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Top Cities — full width */}
      <Card>
        <CardHeader title="Top Cities" sub="All cities by request volume" />
        <div className="p-5">
          {!topCities ? (
            <TableSkeleton rows={10} cols={5} />
          ) : !topCities.length ? (
            <EmptyState icon={MapPin} title="No city-level data available" height="h-24" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2.5">
              {(topCities as TopCity[]).map((c) => (
                <div key={`${c.city}-${c.country_code}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-foreground font-medium truncate max-w-[60%]">
                      <CountryFlag code={c.country_code} className="w-5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{c.city}</span>
                      <span className="text-[9px] text-muted-foreground font-mono flex-shrink-0">{c.country_code}</span>
                    </span>
                    <span className="tabular text-muted-foreground flex-shrink-0 ml-1">
                      {formatNumber(c.req_count)}
                      <span className="ml-1 text-[10px]">{c.unique_ips} IP{c.unique_ips !== 1 ? "s" : ""}</span>
                    </span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/50"
                      style={{ width: `${(c.req_count / maxCityReqs) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Clients tab ────────────────────────────────────────────────────────────────

function ClientsTab({ host, mode }: { host: string; mode: import("@/lib/date-range").DateMode }) {
  const { data: browsers } = useQuery({
    queryKey: ["host-browsers", host, mode],
    queryFn: () => analytics.browsers(mode, { host }),
    staleTime: 60_000,
  });

  const { data: devices } = useQuery({
    queryKey: ["host-devices", host, mode],
    queryFn: () => analytics.devices(mode, { host }),
    staleTime: 60_000,
  });

  const { data: osData } = useQuery({
    queryKey: ["host-os", host, mode],
    queryFn: () => analytics.os(mode, { host }),
    staleTime: 60_000,
  });

  const { palette } = chartColors();
  const totalBrowsers = (browsers ?? []).reduce((s, b) => s + b.req_count, 0) || 1;
  const totalDevices  = (devices  ?? []).reduce((s, d) => s + d.req_count, 0) || 1;
  const totalOS       = (osData   ?? []).reduce((s, o) => s + o.req_count, 0) || 1;

  function deviceIcon(name: string) {
    const n = name.toLowerCase();
    if (n === "mobile" || n === "tablet") return <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />;
    if (n === "bot") return <Bot className="w-3.5 h-3.5 text-orange-400" />;
    return <Monitor className="w-3.5 h-3.5 text-muted-foreground" />;
  }

  return (
    <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Browsers */}
      <Card>
        <CardHeader title="Browsers" sub={`${formatNumber(totalBrowsers)} total requests`} />
        <div className="p-5 space-y-3">
          {!browsers ? (
            <TableSkeleton rows={6} cols={2} />
          ) : !browsers.length ? (
            <EmptyState title="No browser data" height="h-20" />
          ) : (
            browsers.slice(0, 15).map((b, i) => (
              <BarRow
                key={b.browser}
                label={b.browser || "Unknown"}
                count={b.req_count}
                total={totalBrowsers}
                color={palette[i % palette.length]}
              />
            ))
          )}
        </div>
      </Card>

      {/* Operating Systems */}
      <Card>
        <CardHeader title="Operating Systems" sub={`${formatNumber(totalOS)} total requests`} />
        <div className="p-5 space-y-3">
          {!osData ? (
            <TableSkeleton rows={6} cols={2} />
          ) : !osData.length ? (
            <EmptyState title="No OS data" height="h-20" />
          ) : (
            (osData as OSStat[]).slice(0, 15).map((o, i) => (
              <BarRow
                key={o.os}
                label={o.os || "Unknown"}
                count={o.req_count}
                total={totalOS}
                color={palette[(i + 2) % palette.length]}
              />
            ))
          )}
        </div>
      </Card>

      {/* Device Types */}
      <Card>
        <CardHeader title="Device Types" sub={`${formatNumber(totalDevices)} total requests`} />
        <div className="p-5 space-y-3">
          {!devices ? (
            <TableSkeleton rows={4} cols={2} />
          ) : !devices.length ? (
            <EmptyState title="No device data" height="h-20" />
          ) : (
            devices.map((d, i) => (
              <BarRow
                key={d.device}
                label={d.device || "Unknown"}
                count={d.req_count}
                total={totalDevices}
                color={palette[(i + 4) % palette.length]}
                prefix={deviceIcon(d.device)}
              />
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HostDetail() {
  const { host: encodedHost = "" } = useParams<{ host: string }>();
  const host = decodeURIComponent(encodedHost);
  const navigate = useNavigate();
  const { dateMode } = useUIStore();

  const [tab, setTab] = useState<Tab>("patterns");

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["host-overview", host, dateMode],
    queryFn: () => analytics.overview(dateMode, { host }),
    enabled: !!host,
    refetchInterval: 60_000,
  });

  const { data: tsResp } = useQuery({
    queryKey: ["host-timeseries", host, dateMode],
    queryFn: () => analytics.timeseries(dateMode, { host }),
    enabled: !!host,
    staleTime: 30_000,
  });

  const { data: perfResp } = useQuery({
    queryKey: ["host-performance", host, dateMode],
    queryFn: () => analytics.performance(dateMode, { host }),
    enabled: !!host,
    staleTime: 30_000,
  });

  const { data: patterns, isLoading: patternsLoading } = useQuery({
    queryKey: ["host-patterns", host, dateMode],
    queryFn: () => analytics.hostPatterns(dateMode, { host }),
    enabled: !!host && tab === "patterns",
    staleTime: 60_000,
  });

  const { palette, grid, tick } = chartColors();

  const totalStatus = overview
    ? ((overview.req_2xx ?? 0) + (overview.req_3xx ?? 0) + (overview.req_4xx ?? 0) + (overview.req_5xx ?? 0)) || 1
    : 1;

  const timeFmt     = granularityToFmt(tsResp?.granularity ?? "hour");
  const timelineData = (tsResp?.data ?? []).map((d) => ({
    ...d,
    time: format(new Date(d.ts), timeFmt),
  }));

  const perfData = (perfResp?.data ?? []).map((d) => ({
    ...d,
    time: format(new Date(d.ts), timeFmt),
  }));

  const protoTotal = (patterns?.protocol_breakdown ?? []).reduce((s, p) => s + p.req_count, 0) || 1;
  const maxRefReqs = (patterns?.top_referers?.[0]?.req_count) ?? 1;

  return (
    <div className="p-5 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <span>/</span>
        <Globe2 className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground font-mono font-semibold">{host}</span>
      </div>

      {/* Hero */}
      <div className="bg-card border border-border rounded-xl p-5 card-elevated">
        {overviewLoading ? (
          <div className="space-y-3">
            <div className="skeleton h-8 w-64" />
            <div className="skeleton h-4 w-48" />
            <div className="skeleton h-2 w-full max-w-md mt-2" />
          </div>
        ) : (
          <div className="flex flex-col md:flex-row md:items-start gap-5">
            <div className="space-y-3 flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <Globe2 className="w-5 h-5 text-primary flex-shrink-0" />
                <h1 className="text-2xl font-bold font-mono tracking-tight break-all">{host}</h1>
                <a
                  href={`https://${host}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {formatNumber(overview?.total_requests ?? 0)} requests
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {formatNumber(overview?.unique_ips ?? 0)} unique IPs
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  {formatBytes(overview?.bytes_out ?? 0)} sent
                </span>
              </div>
              {overview && (
                <div className="space-y-1.5">
                  <div className="flex h-2 w-full max-w-lg rounded-full overflow-hidden gap-px">
                    {(overview.req_2xx ?? 0) > 0 && <div className="bg-emerald-500" style={{ width: `${((overview.req_2xx ?? 0) / totalStatus) * 100}%` }} />}
                    {(overview.req_3xx ?? 0) > 0 && <div className="bg-indigo-400" style={{ width: `${((overview.req_3xx ?? 0) / totalStatus) * 100}%` }} />}
                    {(overview.req_4xx ?? 0) > 0 && <div className="bg-amber-400" style={{ width: `${((overview.req_4xx ?? 0) / totalStatus) * 100}%` }} />}
                    {(overview.req_5xx ?? 0) > 0 && <div className="bg-red-500"   style={{ width: `${((overview.req_5xx ?? 0) / totalStatus) * 100}%` }} />}
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    {[
                      { key: "req_2xx" as const, label: "2xx", cls: "bg-emerald-500" },
                      { key: "req_3xx" as const, label: "3xx", cls: "bg-indigo-400" },
                      { key: "req_4xx" as const, label: "4xx", cls: "bg-amber-400" },
                      { key: "req_5xx" as const, label: "5xx", cls: "bg-red-500" },
                    ]
                      .filter((s) => (overview[s.key] ?? 0) > 0)
                      .map((s) => (
                        <span key={s.key} className="flex items-center gap-1">
                          <span className={cn("w-2 h-2 rounded-full inline-block", s.cls)} />
                          {(((overview[s.key] ?? 0) / totalStatus) * 100).toFixed(1)}% {s.label}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <Link
              to={`/requests?host=${encodeURIComponent(host)}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/20 transition-colors whitespace-nowrap flex-shrink-0"
            >
              <FileSearch className="w-4 h-4" />
              All requests
            </Link>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Total Requests" value={overview ? formatNumber(overview.total_requests) : "—"} />
        <Tile label="Unique IPs"     value={overview ? formatNumber(overview.unique_ips) : "—"} />
        <Tile
          label="Error Rate"
          value={overview ? `${(overview.error_rate * 100).toFixed(1)}%` : "—"}
          accent={overview && overview.error_rate > 0.1 ? "text-red-400" : overview && overview.error_rate > 0.05 ? "text-amber-400" : undefined}
        />
        <Tile
          label="P50 Latency"
          value={overview ? formatDuration(overview.p50_ms) : "—"}
          sub={overview?.p95_ms ? `P95: ${formatDuration(overview.p95_ms)}` : undefined}
        />
        <Tile
          label="Bandwidth Out"
          value={overview ? formatBytes(overview.bytes_out) : "—"}
          sub={overview ? `In: ${formatBytes(overview.bytes_in ?? 0)}` : undefined}
        />
      </div>

      {/* Traffic + Visitors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrafficCard data={timelineData} height={190} className="lg:col-span-2" />
        <VisitorsCard
          data={timelineData.map((d) => ({ time: d.time, unique_ips: d.unique_ips }))}
          height={160}
        />
      </div>

      {/* Performance */}
      {perfData.length > 0 && (
        <Card>
          <CardHeader title="Response Latency Percentiles" />
          <div className="p-5">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={perfData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="hst-gp50" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={palette[1]} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={palette[1]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}ms`} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [`${v}ms`, ""]} />
                <Area type="monotone" dataKey="p50" name="P50" stroke={palette[1]} fill="url(#hst-gp50)" strokeWidth={2}   dot={false} />
                <Area type="monotone" dataKey="p95" name="P95" stroke={palette[3]} fill="none"            strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Area type="monotone" dataKey="p99" name="P99" stroke={palette[4]} fill="none"            strokeWidth={1}   dot={false} strokeDasharray="2 2" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-5 mt-2 text-[10px] text-muted-foreground">
              {[{ label: "P50", color: palette[1] }, { label: "P95", color: palette[3] }, { label: "P99", color: palette[4] }].map((l) => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className="w-5 h-0.5 rounded inline-block" style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Tab panel */}
      <div className="bg-card border border-border rounded-xl card-elevated overflow-hidden">
        <TabBar active={tab} onChange={setTab} />

        {/* ── Patterns ── */}
        {tab === "patterns" && (
          <div className="p-5 space-y-8">
            {patternsLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-40 w-full" />
              </div>
            ) : !patterns?.busy_hours?.length ? (
              <EmptyState title="No pattern data in this range" height="h-32" />
            ) : (
              <>
                <div>
                  <SectionLabel>Busy Hours — Requests by Day & Hour (UTC)</SectionLabel>
                  <HourHeatmap data={patterns.busy_hours} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-6 border-t border-border">
                  {/* Protocol breakdown */}
                  <Card className="p-5">
                    <p className="text-sm font-semibold text-foreground mb-4">HTTP Protocol</p>
                    {patterns.protocol_breakdown.length > 0 ? (
                      <div className="space-y-3">
                        {patterns.protocol_breakdown.map((p, i) => (
                          <BarRow
                            key={p.protocol}
                            label={p.protocol}
                            count={p.req_count}
                            total={protoTotal}
                            color={palette[i % palette.length]}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No protocol data" height="h-16" />
                    )}
                  </Card>

                  {/* Bot ratio */}
                  <Card className="p-5">
                    <p className="text-sm font-semibold text-foreground mb-4">Bot Traffic</p>
                    <div className="flex items-center gap-4">
                      <div className="relative w-20 h-20 flex-shrink-0">
                        <div
                          className="w-full h-full rounded-full"
                          style={{
                            background: `conic-gradient(#f87171 0% ${patterns.bot_pct}%, hsl(var(--muted)) ${patterns.bot_pct}% 100%)`,
                          }}
                        />
                        <div className="absolute inset-2.5 bg-card rounded-full flex items-center justify-center">
                          <span className="text-[13px] font-bold tabular">{patterns.bot_pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1.5">
                        <p>
                          <span className="text-red-400 font-semibold">{patterns.bot_pct.toFixed(1)}%</span>
                          {" "}flagged as bot
                        </p>
                        <p className="tabular">{formatNumber(patterns.bot_count)} bot requests</p>
                        {patterns.bot_pct > 30 && (
                          <p className="text-amber-400 text-[10px]">High bot ratio — review UA patterns</p>
                        )}
                      </div>
                    </div>
                  </Card>

                  {/* Top referrers */}
                  <Card className="p-5">
                    <p className="text-sm font-semibold text-foreground mb-4">Top Referrers</p>
                    {patterns.top_referers?.length > 0 ? (
                      <div className="space-y-3">
                        {patterns.top_referers.slice(0, 8).map((r) => (
                          <BarRow
                            key={r.domain}
                            label={r.domain}
                            count={r.req_count}
                            total={maxRefReqs}
                            color={palette[1]}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No referrer data" height="h-16" />
                    )}
                  </Card>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Paths ── */}
        {tab === "paths" && <PathsTab host={host} mode={dateMode} />}

        {/* ── Audience ── */}
        {tab === "audience" && <AudienceTab host={host} mode={dateMode} />}

        {/* ── Clients ── */}
        {tab === "clients" && <ClientsTab host={host} mode={dateMode} />}
      </div>
    </div>
  );
}
