import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Map, ChevronDown, ChevronUp } from "lucide-react";
import { analytics } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { FilterBar } from "@/components/shared/FilterBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatNumber, formatBytes } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import { useFilters } from "@/hooks/useFilters";


type SortField = "req_count" | "unique_ips" | "error_rate" | "bytes_out";
type SortDir   = "asc" | "desc";

function pct(v: number, total: number) {
  if (!total) return 0;
  return (v / total) * 100;
}

function ThreatLevel({ rate }: { rate: number }) {
  const label = rate > 0.2 ? "High" : rate > 0.1 ? "Medium" : rate > 0.05 ? "Low" : "OK";
  const color  = rate > 0.2 ? "text-red-500 bg-red-500/10" : rate > 0.1 ? "text-amber-500 bg-amber-500/10" :
                 rate > 0.05 ? "text-yellow-500 bg-yellow-500/10" : "text-green-500 bg-green-500/10";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{label}</span>
  );
}

export default function Geo() {
  const { dateMode } = useUIStore();
  const { filters } = useFilters();
  const [sortField, setSortField] = useState<SortField>("req_count");
  const [sortDir,   setSortDir]   = useState<SortDir>("desc");
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Strip country from filters — this page IS the country selector
  const filtersNoCountry = { ...filters, country: undefined };

  const { data: countries, isLoading } = useQuery({
    queryKey: ["countries-geo", dateMode, filtersNoCountry],
    queryFn: () => analytics.topCountries(dateMode, filtersNoCountry),
  });

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  }

  const sorted = [...(countries ?? [])].sort((a, b) => {
    const av = a[sortField] as number;
    const bv = b[sortField] as number;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const total = (countries ?? []).reduce((s, c) => s + c.req_count, 0);
  const { palette, grid, tick } = chartColors();

  const chartData = (countries ?? []).slice(0, 12).map((c) => ({
    name: `${c.country_name ?? c.country_code}`,
    requests: c.req_count,
    errors: Math.round(c.error_rate * c.req_count),
    code: c.country_code,
  }));

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    return (
      <button onClick={() => toggleSort(field)}
        className={`flex items-center gap-0.5 text-xs font-medium whitespace-nowrap transition-colors
          ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
        {label}
        {active
          ? (sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)
          : <ChevronDown className="w-3 h-3 opacity-30" />}
      </button>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Geographic Analytics</h1>
        {countries && (
          <span className="text-xs text-muted-foreground">{countries.length} countries</span>
        )}
      </div>

      <FilterBar />

      {/* Summary row */}
      {(countries?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Countries",    value: formatNumber(countries?.length ?? 0), color: "text-foreground" },
            { label: "Total Requests",value: formatNumber(total),                  color: "text-foreground" },
            { label: "Top Country",  value: `${countries?.[0]?.country_name ?? "—"}`, color: "text-primary" },
            { label: "Top Error Rate",
              value: (() => {
                const worst = [...(countries ?? [])].sort((a, b) => b.error_rate - a.error_rate)[0];
                return worst ? `${worst.country_code} ${(worst.error_rate * 100).toFixed(1)}%` : "—";
              })(),
              color: "text-red-500",
            },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-lg p-3 card-elevated">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-base font-semibold tabular mt-0.5 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Horizontal bar chart */}
      <Card className="card-elevated">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Requests by Country (Top 12)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="h-64 flex items-center justify-center"><div className="skeleton w-full h-48" /></div>}
          {!isLoading && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 32)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 60, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => formatNumber(v)} />
                <YAxis type="category" dataKey="name" width={165} tick={{ fontSize: 12, fill: tick }}
                  tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle()}
                  formatter={(v: number, name: string) => [formatNumber(v), name]} />
                <Bar dataKey="requests" name="Requests" radius={[0, 4, 4, 0]}
                  onMouseEnter={(d) => setHighlighted(d.code)}
                  onMouseLeave={() => setHighlighted(null)}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={palette[i % palette.length]}
                      opacity={highlighted && highlighted !== d.code ? 0.4 : 1} />
                  ))}
                </Bar>
                <Bar dataKey="errors" name="Errors" fill={palette[3]} radius={[0, 4, 4, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          ) : !isLoading ? (
            <EmptyState icon={Map} title="No geographic data" description="GeoIP may not be configured" height="h-48" />
          ) : null}
        </CardContent>
      </Card>

      {/* Country table */}
      <Card className="card-elevated overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All Countries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Country</th>
                  <th className="text-left px-4 py-2.5"><SortHeader field="req_count" label="Requests" /></th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Share</th>
                  <th className="text-left px-4 py-2.5"><SortHeader field="unique_ips" label="Unique IPs" /></th>
                  <th className="text-left px-4 py-2.5"><SortHeader field="error_rate" label="Error Rate" /></th>
                  <th className="text-left px-4 py-2.5"><SortHeader field="bytes_out" label="Bandwidth" /></th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const share = pct(c.req_count, total);
                  return (
                    <tr key={c.country_code}
                      className={`border-b border-border/40 hover:bg-accent/20 transition-colors
                        ${highlighted === c.country_code ? "bg-primary/5" : ""}`}
                      onMouseEnter={() => setHighlighted(c.country_code)}
                      onMouseLeave={() => setHighlighted(null)}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <CountryFlag code={c.country_code} className="w-6 h-4 flex-shrink-0" />
                          <div>
                            <p className="text-foreground font-medium">{c.country_name ?? c.country_code}</p>
                            <p className="text-muted-foreground text-xs">{c.country_code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular text-foreground font-semibold">{formatNumber(c.req_count)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-muted-foreground tabular">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular text-muted-foreground">{formatNumber(c.unique_ips)}</td>
                      <td className="px-4 py-2.5 tabular">
                        <span className={c.error_rate > 0.1 ? "text-red-500 font-semibold" : c.error_rate > 0.05 ? "text-amber-500" : "text-green-500"}>
                          {(c.error_rate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular text-muted-foreground">{formatBytes(c.bytes_out)}</td>
                      <td className="px-4 py-2.5"><ThreatLevel rate={c.error_rate} /></td>
                    </tr>
                  );
                })}
                {!sorted.length && !isLoading && (
                  <tr><td colSpan={7}>
                    <EmptyState icon={Map} title="No geographic data" description="GeoIP may not be configured" height="h-32" />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
