import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Globe2, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { analytics } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatBytes, formatNumber, formatDuration } from "@/lib/utils";
import type { HostSummary } from "@/types";

function HostCard({ host, onClick }: { host: HostSummary; onClick: () => void }) {
  const errorHigh = host.error_rate > 0.05;
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-lg p-4 card-elevated hover:border-primary/30 hover:bg-accent/20 transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Globe2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="font-mono text-sm font-medium text-primary truncate">{host.host}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Last seen {host.last_seen ? format(new Date(host.last_seen), "MMM d HH:mm") : "—"}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Requests</p>
          <p className="text-base font-semibold tabular text-foreground">{formatNumber(host.req_count)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Unique IPs</p>
          <p className="text-base font-semibold tabular text-foreground">{formatNumber(host.unique_ips)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">P50</p>
          <p className="text-base font-semibold tabular text-foreground">{formatDuration(host.p50_ms)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${errorHigh ? "bg-red-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.min((1 - host.error_rate) * 100, 100)}%` }}
          />
        </div>
        <span className={`text-xs font-medium tabular ${errorHigh ? "text-red-400" : "text-emerald-400"}`}>
          {(host.error_rate * 100).toFixed(1)}% errors
        </span>
        <span className="text-xs text-muted-foreground tabular">{formatBytes(host.bytes_out)}</span>
      </div>
    </button>
  );
}

export default function Hosts() {
  const { dateMode } = useUIStore();
  const navigate = useNavigate();

  const { data: hosts, isLoading } = useQuery({
    queryKey: ["hosts-page", dateMode],
    queryFn: () => analytics.hosts(dateMode),
    refetchInterval: 60_000,
  });

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Virtual Hosts</h1>
        {hosts && (
          <span className="text-xs text-muted-foreground">
            {hosts.length} host{hosts.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="skeleton h-4 w-40" />
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, j) => <div key={j} className="skeleton h-8" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(hosts ?? []).map((h) => (
            <HostCard
              key={h.host}
              host={h}
              onClick={() => navigate(`/hosts/${encodeURIComponent(h.host)}`)}
            />
          ))}
          {!hosts?.length && (
            <div className="col-span-3">
              <EmptyState
                icon={Globe2}
                title="No hosts found"
                description="No traffic in the selected time range"
                height="h-48"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
