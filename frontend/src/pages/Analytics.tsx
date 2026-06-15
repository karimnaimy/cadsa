import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import { TrafficCard } from "@/components/charts/TrafficChart";
import { VisitorsCard } from "@/components/charts/VisitorsChart";
import { format } from "date-fns";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { analytics } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { useFilters } from "@/hooks/useFilters";
import { FilterBar } from "@/components/shared/FilterBar";
import { granularityToFmt } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart } from "@/components/charts/DonutChart";
import { EmptyState } from "@/components/shared/EmptyState";
import { IPBadge } from "@/components/shared/IPBadge";
import { formatBytes, formatNumber, formatDuration } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";

type SortDir = "asc" | "desc";

function SortBtn({ field, current, dir, onClick }: { field: string; current: string; dir: SortDir; onClick: () => void }) {
  const active = current === field;
  return (
    <button onClick={onClick} className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors">
      {active
        ? (dir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)
        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

export default function Analytics() {
  const { dateMode } = useUIStore();
  const { filters, setFilter } = useFilters();

  const [pathSort, setPathSort] = useState<{ field: string; dir: SortDir }>({ field: "req_count", dir: "desc" });
  const [ipSort,   setIpSort]   = useState<{ field: string; dir: SortDir }>({ field: "req_count", dir: "desc" });

  // topCountries never filters by country — it IS the country selector
  const filtersNoCountry = { ...filters, country: undefined };

  const { data: tsResp }       = useQuery({ queryKey: ["ts-an", dateMode, filters],          queryFn: () => analytics.timeseries(dateMode, filters) });
  const { data: perfResp }     = useQuery({ queryKey: ["perf-an", dateMode, filters],         queryFn: () => analytics.performance(dateMode, filters) });
  const { data: bwResp }       = useQuery({ queryKey: ["bw-an", dateMode, filters],           queryFn: () => analytics.bandwidth(dateMode, filters) });
  const { data: topPaths }     = useQuery({ queryKey: ["paths-an", dateMode, filters],        queryFn: () => analytics.topPaths(dateMode, filters, 20) });
  const { data: topIPs }       = useQuery({ queryKey: ["ips-an", dateMode, filters],          queryFn: () => analytics.topIPs(dateMode, filters) });
  const { data: browsers }     = useQuery({ queryKey: ["br-an", dateMode, filters],           queryFn: () => analytics.browsers(dateMode, filters) });
  const { data: devices }      = useQuery({ queryKey: ["dev-an", dateMode, filters],          queryFn: () => analytics.devices(dateMode, filters) });
  const { data: statusCodes }  = useQuery({ queryKey: ["sc-an", dateMode, filters],           queryFn: () => analytics.statusCodes(dateMode, filters) });
  const { data: topCountries } = useQuery({ queryKey: ["co-an", dateMode, filtersNoCountry], queryFn: () => analytics.topCountries(dateMode, filtersNoCountry) });

  const { palette, grid, tick } = chartColors();
  const granHint = tsResp?.granularity ?? perfResp?.granularity ?? "hour";
  const fmt = (ts: string) => format(new Date(ts), granularityToFmt(granHint));

  const sortedPaths = [...(topPaths ?? [])].sort((a, b) => {
    const av = (a as unknown as Record<string, number>)[pathSort.field] ?? 0;
    const bv = (b as unknown as Record<string, number>)[pathSort.field] ?? 0;
    return pathSort.dir === "desc" ? bv - av : av - bv;
  });

  const sortedIPs = [...(topIPs ?? [])].sort((a, b) => {
    const av = (a as unknown as Record<string, number>)[ipSort.field] ?? 0;
    const bv = (b as unknown as Record<string, number>)[ipSort.field] ?? 0;
    return ipSort.dir === "desc" ? bv - av : av - bv;
  });

  const sortPath = (field: string) => setPathSort((s) => ({ field, dir: s.field === field && s.dir === "desc" ? "asc" : "desc" }));
  const sortIP   = (field: string) => setIpSort((s) => ({ field, dir: s.field === field && s.dir === "desc" ? "asc" : "desc" }));

  const maxPaths = sortedPaths[0]?.req_count ?? 1;
  const maxIP    = sortedIPs[0]?.req_count ?? 1;

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Analytics</h1>
        <span className="text-xs text-muted-foreground">
          Granularity: <span className="text-foreground font-medium">{granHint}</span>
        </span>
      </div>

      <FilterBar />

      {/* Traffic + Visitors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrafficCard
          data={(tsResp?.data ?? []).map((d) => ({ ...d, time: fmt(d.ts) }))}
          height={200}
          className="lg:col-span-2"
        />
        <VisitorsCard
          data={(tsResp?.data ?? []).map((d) => ({ time: fmt(d.ts), unique_ips: d.unique_ips }))}
          height={160}
        />
      </div>

      {/* Bandwidth + Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="card-elevated">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Bandwidth</CardTitle></CardHeader>
          <CardContent>
            {(bwResp?.data?.length ?? 0) > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={bwResp!.data.map((b) => ({ ...b, time: fmt(b.ts) }))} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => formatBytes(v)} />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [formatBytes(v)]} />
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="bytes_out" name="Out" fill={palette[0]} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="bytes_in"  name="In"  fill={palette[1]} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No bandwidth data" height="h-36" />}
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Response Time Percentiles</CardTitle></CardHeader>
          <CardContent>
            {(perfResp?.data?.length ?? 0) > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={perfResp!.data.map((d) => ({ ...d, time: fmt(d.ts) }))} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={40} unit="ms" />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [`${v}ms`]} />
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="p50" name="P50" stroke={palette[1]} strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="p95" name="P95" stroke={palette[2]} strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="p99" name="P99" stroke={palette[3]} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No performance data" height="h-36" />}
          </CardContent>
        </Card>
      </div>

      {/* Donuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="card-elevated">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Browsers</CardTitle></CardHeader>
          <CardContent>
            {(browsers?.length ?? 0) > 0
              ? <DonutChart data={browsers!.slice(0, 6).map((b) => ({ name: b.browser ?? "Unknown", value: b.req_count }))} height={200} />
              : <EmptyState title="No data" height="h-36" />}
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Device Types</CardTitle></CardHeader>
          <CardContent>
            {(devices?.length ?? 0) > 0
              ? <DonutChart data={devices!.map((d) => ({ name: d.device ?? "unknown", value: d.req_count }))} height={200} />
              : <EmptyState title="No data" height="h-36" />}
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Status Codes</CardTitle></CardHeader>
          <CardContent>
            {(statusCodes?.length ?? 0) > 0
              ? <DonutChart data={statusCodes!.slice(0, 8).map((s) => ({ name: String(s.status), value: s.req_count }))} height={200} />
              : <EmptyState title="No data" height="h-36" />}
          </CardContent>
        </Card>
      </div>

      {/* Top countries — clicking sets the country filter */}
      {(topCountries?.length ?? 0) > 0 && (
        <Card className="card-elevated">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Traffic by Country</CardTitle>
              <p className="text-[10px] text-muted-foreground">Click a bar to filter</p>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={topCountries!.slice(0, 12).map((c) => ({
                  name: c.country_name ?? c.country_code,
                  code: c.country_code,
                  requests: c.req_count,
                  errors: Math.round(c.error_rate * c.req_count),
                }))}
                layout="vertical"
                margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
                onClick={(data) => {
                  const code = data?.activePayload?.[0]?.payload?.code as string | undefined;
                  if (code) setFilter("country", filters.country === code ? "" : code);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumber(v)} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: tick }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [formatNumber(v)]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="requests" name="Requests" fill={palette[0]} radius={[0, 3, 3, 0]}>
                  {topCountries!.slice(0, 12).map((co, i) => (
                    <Cell
                      key={i}
                      fill={filters.country === co.country_code ? "#8b5cf6" : palette[i % palette.length]}
                      opacity={filters.country && filters.country !== co.country_code ? 0.4 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Top paths */}
      <Card className="card-elevated overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top Endpoints</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Path</th>
                  {[
                    { label: "Requests",     field: "req_count" },
                    { label: "Avg Duration", field: "avg_ms" },
                    { label: "Bandwidth",    field: "bytes_out" },
                  ].map(({ label, field }) => (
                    <th key={field} className="text-left px-4 py-2.5 text-muted-foreground font-medium whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        {label}
                        <SortBtn field={field} current={pathSort.field} dir={pathSort.dir} onClick={() => sortPath(field)} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPaths.map((p) => (
                  <tr key={p.path} className="border-b border-border/40 hover:bg-accent/20">
                    <td className="px-4 py-2 font-mono text-foreground max-w-sm">
                      <span className="block truncate">{p.path}</span>
                      <div className="mt-1 h-0.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/50 rounded-full" style={{ width: `${(p.req_count / maxPaths) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-foreground tabular">{formatNumber(p.req_count)}</td>
                    <td className="px-4 py-2 text-muted-foreground tabular">{formatDuration(p.avg_ms)}</td>
                    <td className="px-4 py-2 text-muted-foreground tabular">{formatBytes(p.bytes_out)}</td>
                  </tr>
                ))}
                {!sortedPaths.length && <tr><td colSpan={4}><EmptyState title="No endpoint data" height="h-24" /></td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top IPs */}
      <Card className="card-elevated overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top IP Addresses</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">IP Address</th>
                  {[
                    { label: "Requests", field: "req_count" },
                    { label: "Error %",  field: "error_rate" },
                    { label: "Threat",   field: "threat_score" },
                    { label: "Last seen",field: "last_seen" },
                  ].map(({ label, field }) => (
                    <th key={field} className="text-left px-4 py-2.5 text-muted-foreground font-medium whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        {label}
                        <SortBtn field={field} current={ipSort.field} dir={ipSort.dir} onClick={() => sortIP(field)} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedIPs.map((ip) => (
                  <tr key={ip.remote_ip} className="border-b border-border/40 hover:bg-accent/20">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <CountryFlag code={ip.country_code} className="w-5 h-3.5 flex-shrink-0" />
                        <IPBadge ip={ip.remote_ip} />
                      </div>
                      <div className="mt-1 h-0.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/50 rounded-full" style={{ width: `${(ip.req_count / maxIP) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2 tabular text-foreground">{formatNumber(ip.req_count)}</td>
                    <td className="px-4 py-2 tabular text-muted-foreground">{(ip.error_rate * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 tabular">
                      <span className={ip.threat_score > 70 ? "text-red-500 font-semibold" : ip.threat_score > 40 ? "text-amber-500" : "text-green-500"}>
                        {ip.threat_score}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular text-muted-foreground">
                      {ip.last_seen ? format(new Date(ip.last_seen), "MMM d HH:mm") : "—"}
                    </td>
                  </tr>
                ))}
                {!sortedIPs.length && <tr><td colSpan={5}><EmptyState title="No IP data" height="h-24" /></td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
