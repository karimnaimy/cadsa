import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Shield, ShieldAlert, ShieldCheck, X, ChevronLeft, ChevronRight, AlertTriangle,
  Trash2, Plus, CheckCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { security } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { FilterBar } from "@/components/shared/FilterBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IPBadge } from "@/components/shared/IPBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/Skeleton";

import { CountryFlag } from "@/components/shared/CountryFlag";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import { useFilters } from "@/hooks/useFilters";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;
const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-500 bg-red-500/10 border-red-500/20",
  high:     "text-orange-500 bg-orange-500/10 border-orange-500/20",
  medium:   "text-amber-500 bg-amber-500/10 border-amber-500/20",
  low:      "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
  info:     "text-blue-500 bg-blue-500/10 border-blue-500/20",
};

export default function Security() {
  const { dateMode } = useUIStore();
  const { filters } = useFilters();

  const [page, setPage]                   = useState(1);
  const [filterSeverity, setFilterSeverity] = useState("");

  const { data: events, isLoading } = useQuery({
    queryKey: ["security-events", page, filterSeverity, dateMode, filters],
    queryFn: () => security.events({ mode: dateMode, filters, page, severity: filterSeverity || undefined }),
    refetchInterval: 30_000,
  });

  const { data: threats } = useQuery({
    queryKey: ["top-threats", dateMode],
    queryFn: () => security.topThreats(dateMode),
    refetchInterval: 60_000,
  });

  const totalPages = Math.ceil((events?.total ?? 0) / 50);

  const severityCounts = SEVERITY_ORDER.reduce((acc, s) => {
    acc[s] = (events?.data ?? []).filter((e) => e.severity === s).length;
    return acc;
  }, {} as Record<string, number>);

  const eventTypeFreq = Object.entries(
    (events?.data ?? []).reduce((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([type, count]) => ({ type: type.replace(/_/g, " "), count }));

  const { palette, grid, tick } = chartColors();
  const totalEvents    = events?.total ?? 0;
  const criticalCount  = (events?.data ?? []).filter((e) => e.severity === "critical" || e.severity === "high").length;

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">Security</h1>
        <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full
          ${criticalCount > 0 ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"}`}>
          {criticalCount > 0
            ? <><AlertTriangle className="w-3 h-3" /> {criticalCount} critical/high</>
            : <><ShieldCheck className="w-3 h-3" /> All clear</>}
        </div>
      </div>

      <FilterBar />

      {/* Severity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {SEVERITY_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setFilterSeverity(filterSeverity === s ? "" : s)}
            className={`rounded-lg p-3 text-center border transition-all card-elevated
              ${filterSeverity === s ? "ring-2 ring-primary" : ""}
              ${SEVERITY_COLORS[s]}`}
          >
            <p className="text-2xl font-bold tabular">{severityCounts[s] ?? 0}</p>
            <p className="text-xs font-medium mt-0.5 capitalize">{s}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top threat IPs */}
        <Card className="card-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
              Top Threat IPs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {(threats ?? []).slice(0, 10).map((t) => (
              <div
                key={t.remote_ip}
                className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-accent/30 transition-colors"
              >
                <CountryFlag code={t.country_code} className="w-5 h-3.5 flex-shrink-0" />
                <IPBadge ip={t.remote_ip} className="flex-1 min-w-0" />
                <div className="w-14 h-1 bg-muted rounded-full overflow-hidden ml-auto">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: `${Math.min(t.max_score, 100)}%` }} />
                </div>
                <span className={`tabular flex-shrink-0 font-semibold ${t.max_score > 70 ? "text-red-500" : t.max_score > 40 ? "text-amber-500" : "text-green-500"}`}>
                  {t.max_score}
                </span>
                <span className="text-muted-foreground flex-shrink-0 tabular">{t.event_count}ev</span>
              </div>
            ))}
            {!threats?.length && <EmptyState icon={ShieldCheck} title="No threats detected" height="h-24" />}
          </CardContent>
        </Card>

        {/* Event type frequency */}
        <Card className="card-elevated lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Event Type Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {eventTypeFreq.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={eventTypeFreq} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="type" width={150} tick={{ fontSize: 10, fill: tick }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle()} />
                  <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]}>
                    {eventTypeFreq.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={Shield} title="No events in range" height="h-40" />}
          </CardContent>
        </Card>
      </div>

      {/* Events log */}
      <Card className="card-elevated overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Security Events</CardTitle>
            <div className="flex items-center gap-2">
              {filterSeverity && (
                <button onClick={() => setFilterSeverity("")}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                  <X className="w-3 h-3" /> Clear filter
                </button>
              )}
              <span className="text-xs text-muted-foreground tabular">{totalEvents.toLocaleString()} events</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs data-table">
              <thead>
                <tr className="border-b border-border">
                  {["Time", "Severity", "Event Type", "IP", "Host", "Details"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-muted-foreground font-medium bg-card">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6}><TableSkeleton rows={8} cols={6} /></td></tr>}
                {!isLoading && (events?.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-border/40 hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono tabular">
                      {format(new Date(e.ts), "MMM d HH:mm:ss")}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium capitalize ${SEVERITY_COLORS[e.severity] ?? ""}`}>
                        {e.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">
                      {e.event_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2">
                      {e.remote_ip && <IPBadge ip={e.remote_ip} />}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{e.host ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-48 truncate">
                      {e.uri && <span className="font-mono">{e.uri}</span>}
                    </td>
                  </tr>
                ))}
                {!isLoading && !events?.data.length && (
                  <tr><td colSpan={6}>
                    <EmptyState icon={ShieldCheck} title="No events found"
                      description={filterSeverity ? `No ${filterSeverity} events` : "No security events in this range"}
                      height="h-32" />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <span className="text-xs text-muted-foreground tabular">Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <button className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <WhitelistCard />
    </div>
  );
}

function WhitelistCard() {
  const qc = useQueryClient();
  const cidrRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [addError, setAddError] = useState("");
  const [addOk, setAddOk] = useState(false);

  const { data: list, isLoading } = useQuery({
    queryKey: ["whitelist"],
    queryFn: () => security.whitelist(),
  });

  const remove = useMutation({
    mutationFn: (id: number) => security.removeWhitelist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whitelist"] }),
  });

  const add = useMutation({
    mutationFn: ({ cidr, note }: { cidr: string; note: string }) =>
      security.addWhitelist(cidr, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whitelist"] });
      if (cidrRef.current) cidrRef.current.value = "";
      if (noteRef.current) noteRef.current.value = "";
      setAddError("");
      setAddOk(true);
      setTimeout(() => setAddOk(false), 2000);
    },
    onError: (e: Error) => setAddError(e.message),
  });

  function handleAdd() {
    const cidr = cidrRef.current?.value.trim() ?? "";
    if (!cidr) { setAddError("CIDR is required"); return; }
    setAddError("");
    add.mutate({ cidr, note: noteRef.current?.value.trim() ?? "" });
  }

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-primary" />
          IP Whitelist
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-8 rounded" />)}
          </div>
        )}
        {!isLoading && list && list.length > 0 && (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">CIDR / IP</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Note</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/40 last:border-0 hover:bg-accent/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-foreground">{entry.cidr}</td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.note || "—"}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => remove.mutate(entry.id)}
                        disabled={remove.isPending}
                        className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && list?.length === 0 && (
          <EmptyState icon={Shield} title="No whitelist entries" description="Whitelisted IPs bypass security alerts." height="h-20" />
        )}

        <div className="flex flex-col sm:flex-row items-start gap-2 pt-2 border-t border-border">
          <div className="flex flex-col gap-1 flex-1 min-w-0 w-full sm:w-auto">
            <input
              ref={cidrRef}
              type="text"
              placeholder="IP or CIDR  (e.g. 203.0.113.5 or 10.0.0.0/8)"
              className="text-xs bg-background border border-border rounded-md px-2.5 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full font-mono"
            />
            {addError && <p className="text-[11px] text-red-500">{addError}</p>}
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <input
              ref={noteRef}
              type="text"
              placeholder="Note (optional)"
              className="text-xs bg-background border border-border rounded-md px-2.5 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary flex-1 sm:w-48"
            />
            <button
              onClick={handleAdd}
              disabled={add.isPending}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {addOk
                ? <><CheckCircle className="w-3.5 h-3.5" /> Added</>
                : <><Plus className="w-3.5 h-3.5" /> Add</>}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
