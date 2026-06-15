import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "blue" | "green" | "red" | "amber" | "purple" | "cyan";

interface Props {
  title: string;
  value: string | number;
  sub?: string;
  icon?: React.ElementType;
  trend?: number;
  accent?: Accent;
  loading?: boolean;
  className?: string;
}

const ACCENT: Record<Accent, {
  iconBg: string;
  iconColor: string;
  gradientFrom: string;
  valueCls: string;
}> = {
  blue:   { iconBg: "rgba(99,102,241,0.15)",  iconColor: "#818cf8", gradientFrom: "rgba(99,102,241,0.06)",  valueCls: "" },
  cyan:   { iconBg: "rgba(6,182,212,0.15)",   iconColor: "#22d3ee", gradientFrom: "rgba(6,182,212,0.06)",   valueCls: "" },
  green:  { iconBg: "rgba(16,185,129,0.15)",  iconColor: "#34d399", gradientFrom: "rgba(16,185,129,0.06)",  valueCls: "" },
  red:    { iconBg: "rgba(239,68,68,0.15)",   iconColor: "#f87171", gradientFrom: "rgba(239,68,68,0.06)",   valueCls: "text-red-400" },
  amber:  { iconBg: "rgba(245,158,11,0.15)",  iconColor: "#fbbf24", gradientFrom: "rgba(245,158,11,0.06)",  valueCls: "text-amber-400" },
  purple: { iconBg: "rgba(168,85,247,0.15)",  iconColor: "#c084fc", gradientFrom: "rgba(168,85,247,0.06)",  valueCls: "" },
};

export function StatCard({ title, value, sub, icon: Icon, trend, accent = "blue", loading, className }: Props) {
  const a = ACCENT[accent];

  if (loading) {
    return (
      <div className={cn("bg-card border border-border rounded-xl p-5 card-elevated overflow-hidden", className)}>
        <div className="skeleton h-3 w-24 mb-4" />
        <div className="skeleton h-8 w-20 mb-2" />
        <div className="skeleton h-3 w-28" />
      </div>
    );
  }

  return (
    <div
      className={cn("relative bg-card border border-border rounded-xl p-5 card-elevated overflow-hidden", className)}
      style={{ background: `linear-gradient(135deg, ${a.gradientFrom} 0%, transparent 60%), var(--card)` }}
    >
      {/* Accent orb background */}
      <div
        className="absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl pointer-events-none"
        style={{ background: a.iconBg, opacity: 0.6 }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 leading-none">
            {title}
          </p>
          <p className={cn("text-3xl font-bold tabular leading-none tracking-tight", a.valueCls || "text-foreground")}>
            {value}
          </p>
          {sub && (
            <p className="text-xs text-muted-foreground mt-2 leading-none">{sub}</p>
          )}
          {trend !== undefined && (
            <div className={cn(
              "mt-3 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
              trend > 0
                ? "text-emerald-400 bg-emerald-400/10"
                : trend < 0
                ? "text-red-400 bg-red-400/10"
                : "text-muted-foreground bg-muted"
            )}>
              {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{trend > 0 ? "+" : ""}{trend.toFixed(1)}%</span>
            </div>
          )}
        </div>
        {Icon && (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 relative"
            style={{ background: a.iconBg }}
          >
            <Icon style={{ color: a.iconColor }} size={18} />
          </div>
        )}
      </div>
    </div>
  );
}
