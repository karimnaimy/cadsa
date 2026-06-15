import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Globe, Activity, TrendingUp } from "lucide-react";
import { security } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { HoverCard } from "@/components/ui/hover-card";

interface Props {
  ip: string;
  className?: string;
}

function ThreatBar({ score }: { score: number }) {
  const color =
    score > 70 ? "bg-red-500" : score > 40 ? "bg-amber-500" : "bg-emerald-500";
  const label =
    score > 70 ? "High" : score > 40 ? "Medium" : "Low";
  const textColor =
    score > 70 ? "text-red-400" : score > 40 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
          Threat Score
        </span>
        <span className={cn("text-[10px] font-bold tabular", textColor)}>
          {label} · {score}
        </span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function IPCardContent({ ip }: { ip: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ip-mini", ip],
    queryFn: () => security.ipProfile(ip, { type: "preset", preset: "l24h" }),
    staleTime: 60_000,
  });

  return (
    <div className="w-60 p-3.5 space-y-3 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono font-semibold text-foreground tracking-tight">
          {ip}
        </span>
        {data?.country_code && (
          <CountryFlag code={data.country_code} className="w-6 h-4 flex-shrink-0" />
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          <div className="skeleton h-3 w-4/5 rounded" />
          <div className="skeleton h-3 w-3/5 rounded" />
          <div className="skeleton h-3 w-full rounded" />
        </div>
      )}

      {data && (
        <>
          {/* Location / Org */}
          {(data.country_name || data.org) && (
            <div className="space-y-1">
              {data.country_name && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Globe className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">
                    {data.country_name}
                    {data.city ? `, ${data.city}` : ""}
                  </span>
                </div>
              )}
              {data.org && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{data.org}</span>
                  {data.asn && (
                    <span className="ml-auto flex-shrink-0 text-[10px] bg-muted px-1 rounded font-mono">
                      AS{data.asn}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
            <div className="bg-muted/40 rounded-lg px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                Requests
              </p>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-2.5 h-2.5 text-primary" />
                <p className="font-semibold text-foreground tabular">
                  {formatNumber(data.req_count)}
                </p>
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                Error Rate
              </p>
              <p
                className={cn(
                  "font-semibold tabular",
                  data.error_rate > 0.1 ? "text-red-400" : "text-emerald-400",
                )}
              >
                {(data.error_rate * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Threat bar */}
          <div className="pt-1 border-t border-border">
            <ThreatBar score={data.max_threat} />
          </div>
        </>
      )}
    </div>
  );
}

export function IPBadge({ ip, className }: Props) {
  return (
    <HoverCard
      trigger={
        <Link
          to={`/ip/${ip}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "font-mono text-xs px-1.5 py-0.5 rounded border transition-colors",
            "bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 hover:border-primary/40",
            className,
          )}
        >
          {ip}
        </Link>
      }
    >
      <IPCardContent ip={ip} />
    </HoverCard>
  );
}
