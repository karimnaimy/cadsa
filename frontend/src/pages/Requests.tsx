import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Download,
  Search, Clock, Globe2, Monitor, PanelRight, Filter,
} from "lucide-react";
import { format } from "date-fns";
import { analytics } from "@/lib/api";
import type { RequestRow } from "@/types";
import { Button } from "@/components/ui/button";
import { StatusBadge, MethodBadge } from "@/components/shared/StatusBadge";
import { IPBadge } from "@/components/shared/IPBadge";
import { HostLink } from "@/components/shared/HostLink";
import { TableSkeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { Drawer } from "@/components/shared/Drawer";
import { FilterBar } from "@/components/shared/FilterBar";
import { formatBytes, formatDuration, cn } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { useUIStore } from "@/stores/ui";
import { useFilters } from "@/hooks/useFilters";

const PAGE_SIZE = 100;

/* ── Request detail (inside Drawer) ─────────────────────────────────────────── */

function RequestDetail({ row }: { row: RequestRow }) {
  const sections: [string, Record<string, string | number | boolean | undefined>][] = [
    ["Request", {
      Timestamp: format(new Date(row.ts), "yyyy-MM-dd HH:mm:ss.SSS"),
      Host:      row.host,
      Method:    row.method ?? "—",
      URI:       row.uri ?? "—",
      Protocol:  row.http_proto ?? "—",
      Status:    row.status ?? "—",
    }],
    ["Performance", {
      Duration:        row.duration_ms != null ? formatDuration(row.duration_ms) : "—",
      "Response size": row.response_bytes ? formatBytes(row.response_bytes) : "—",
      "Request size":  row.request_bytes  ? formatBytes(row.request_bytes)  : "—",
    }],
    ["Client", {
      "IP Address": row.remote_ip,
      Country:      row.country_name ?? row.country_code ?? "—",
      City:         row.city ?? "—",
      Browser:      row.ua_browser ?? "—",
      OS:           row.ua_os ?? "—",
      Device:       row.ua_device ?? "—",
      Bot:          row.is_bot ? "Yes" : "No",
    }],
    ["Security", {
      "Threat score": row.threat_score,
      "TLS version":  row.tls_version ?? "—",
      Cipher:         row.tls_cipher ?? "—",
      Referer:        row.referer ?? "—",
    }],
  ];

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        {row.status && <StatusBadge status={row.status} large />}
        {row.duration_ms != null && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span className="tabular font-semibold text-foreground">{formatDuration(row.duration_ms)}</span>
          </div>
        )}
        {row.country_code && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CountryFlag code={row.country_code} className="w-5 h-3.5" />
            <span>{row.country_name ?? row.country_code}</span>
          </div>
        )}
      </div>

      {sections.map(([title, fields]) => (
        <div key={title}>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{title}</p>
          <div className="space-y-1.5 bg-muted/30 rounded-xl p-3">
            {Object.entries(fields).map(([k, v]) => (
              <div key={k} className="flex gap-3 text-xs">
                <span className="text-muted-foreground min-w-[7.5rem] flex-shrink-0">{k}</span>
                <span className="text-foreground break-all font-mono text-[11px]">{String(v ?? "—")}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">User-Agent</p>
        <p className="text-[11px] font-mono bg-muted/30 px-3 py-2.5 rounded-xl break-all text-muted-foreground leading-relaxed">
          {row.user_agent ?? "—"}
        </p>
      </div>

      {row.threat_score > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Threat Score</p>
            <span className={cn("text-xs font-bold tabular",
              row.threat_score > 70 ? "text-red-400" : row.threat_score > 40 ? "text-amber-400" : "text-emerald-400",
            )}>{row.threat_score}/100</span>
          </div>
          <div className="progress-track">
            <div
              className={cn("progress-fill", row.threat_score > 70 ? "bg-red-500" : row.threat_score > 40 ? "bg-amber-500" : "bg-emerald-500")}
              style={{ width: `${row.threat_score}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────────── */

export default function Requests() {
  const { dateMode } = useUIStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedRow, setSelectedRow] = useState<RequestRow | null>(null);

  const { filters, setFilter } = useFilters();

  const page = useMemo(() => {
    const raw = parseInt(searchParams.get("page") ?? "1", 10);
    return isNaN(raw) || raw < 1 ? 1 : raw;
  }, [searchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ["requests", page, filters, dateMode],
    queryFn: () => analytics.requests({ mode: dateMode, filters, page, limit: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p === 1) next.delete("page");
      else next.set("page", String(p));
      return next;
    }, { replace: true });
  }

  const visiblePages = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, page - 2);
    const end   = Math.min(totalPages, page + 2);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);

  return (
    <div className="p-5 flex flex-col gap-4 h-full" style={{ height: "calc(100vh - 48px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Request Log</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data?.total?.toLocaleString() ?? "—"} requests in window
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex-shrink-0 flex items-center gap-3">
        <FilterBar />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Search className="w-3 h-3" />
          <span className="tabular">{data?.total?.toLocaleString() ?? "—"} results</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 rounded-xl border border-border overflow-hidden bg-card card-elevated flex flex-col">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[860px] text-xs data-table">
              <thead>
                <tr>
                  <th className="w-9 px-2 py-3" />
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider whitespace-nowrap w-32">
                    <Clock className="w-3 h-3 inline mr-1" />Time
                  </th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">Host</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">IP</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">Method</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">Path</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">Status</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">Duration</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">Size</th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">
                    <Globe2 className="w-3 h-3 inline mr-1" />Geo
                  </th>
                  <th className="text-left px-3 py-3 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">
                    <Monitor className="w-3 h-3 inline mr-1" />Client
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={11}><TableSkeleton rows={15} cols={11} /></td></tr>
                )}
                {!isLoading && data?.data.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-border/30 transition-all hover:bg-muted/20",
                      selectedRow?.id === r.id && "bg-primary/5 border-primary/20",
                    )}
                  >
                    <td className="px-2 py-2 w-9">
                      <button
                        onClick={() => setSelectedRow(r.id === selectedRow?.id ? null : r)}
                        title="View request details"
                        className={cn(
                          "w-6 h-6 flex items-center justify-center rounded transition-colors",
                          selectedRow?.id === r.id
                            ? "text-primary bg-primary/15"
                            : "text-muted-foreground/40 hover:text-primary hover:bg-primary/10",
                        )}
                      >
                        <PanelRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[11px] tabular">
                      {format(new Date(r.ts), "MMM d HH:mm:ss")}
                    </td>
                    <td className="px-3 py-2 max-w-40">
                      <div className="flex items-center gap-1 group/hcell">
                        <HostLink host={r.host} className="text-[11px] truncate min-w-0" />
                        <button
                          onClick={(e) => { e.stopPropagation(); setFilter("host", r.host); }}
                          className="opacity-0 group-hover/hcell:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
                          title={`Filter by host: ${r.host}`}
                        >
                          <Filter className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 group/ipcell">
                        <IPBadge ip={r.remote_ip} />
                        <button
                          onClick={(e) => { e.stopPropagation(); setFilter("remote_ip", r.remote_ip); }}
                          className="opacity-0 group-hover/ipcell:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
                          title={`Filter by IP: ${r.remote_ip}`}
                        >
                          <Filter className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {r.method && <MethodBadge method={r.method} />}
                    </td>
                    <td className="px-3 py-2 max-w-64">
                      <div className="flex items-center gap-1 group/pathcell">
                        <span className="font-mono text-[11px] text-foreground truncate min-w-0">{r.path}</span>
                        {r.path && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setFilter("path", r.path!); }}
                            className="opacity-0 group-hover/pathcell:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-primary hover:bg-primary/10"
                            title={`Filter by path: ${r.path}`}
                          >
                            <Filter className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {r.status && <StatusBadge status={r.status} />}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular text-[11px]">
                      {r.duration_ms != null ? (
                        <span className={cn(r.duration_ms > 1000 ? "text-amber-400 font-semibold" : "")}>
                          {formatDuration(r.duration_ms)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular text-[11px]">
                      {r.response_bytes ? formatBytes(r.response_bytes) : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap text-[11px]">
                      <div className="flex items-center gap-1 group/geocell">
                        <CountryFlag code={r.country_code} className="w-4 h-2.5" />
                        <span>{r.country_code ?? "—"}</span>
                        {r.country_code && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setFilter("country", r.country_code!); }}
                            className="opacity-0 group-hover/geocell:opacity-100 transition-opacity flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-teal-400 hover:bg-teal-500/10"
                            title={`Filter by country: ${r.country_code}`}
                          >
                            <Filter className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-24 text-[11px]">
                      {r.ua_browser ?? "—"}
                    </td>
                  </tr>
                ))}
                {!isLoading && !data?.data.length && (
                  <tr>
                    <td colSpan={11}>
                      <EmptyState
                        icon={Search}
                        title="No requests found"
                        description="Try removing filters or expanding the time range"
                        height="h-40"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border flex-shrink-0 bg-card/80">
            <span className="text-xs text-muted-foreground tabular">
              {data?.total ? (
                <>Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, data.total).toLocaleString()} of {data.total.toLocaleString()}</>
              ) : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => goToPage(1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              {visiblePages.map((p) => (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={cn(
                    "text-xs h-7 w-7 rounded-lg transition-colors font-medium",
                    page === p
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {p}
                </button>
              ))}
              {totalPages > page + 2 && <span className="text-xs text-muted-foreground px-1">…</span>}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => goToPage(totalPages)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Drawer
        open={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        title="Request Detail"
        subtitle={selectedRow ? `${selectedRow.method ?? ""} ${selectedRow.path ?? selectedRow.uri ?? ""}`.trim() : undefined}
        width="w-[32rem]"
      >
        {selectedRow && <RequestDetail row={selectedRow} />}
      </Drawer>
    </div>
  );
}
