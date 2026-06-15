import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_SERIES = [
  { key: "req_2xx", label: "2xx", color: "#10b981" },
  { key: "req_3xx", label: "3xx", color: "#6366f1" },
  { key: "req_4xx", label: "4xx", color: "#f59e0b" },
  { key: "req_5xx", label: "5xx", color: "#ef4444" },
] as const;

export interface TrafficPoint {
  time: string;
  req_2xx: number;
  req_3xx: number;
  req_4xx: number;
  req_5xx: number;
}

export function TrafficChartLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {STATUS_SERIES.map(({ label, color }) => (
        <div key={label} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function TrafficCard({ data, height = 200, className }: {
  data: TrafficPoint[]; height?: number; className?: string;
}) {
  return (
    <Card className={cn("card-elevated", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Traffic by Status Class</CardTitle>
          <TrafficChartLegend />
        </div>
      </CardHeader>
      <CardContent>
        {data.length > 0
          ? <TrafficChart data={data} height={height} />
          : <EmptyState title="No traffic data" />}
      </CardContent>
    </Card>
  );
}

export function TrafficChart({ data, height = 200 }: { data: TrafficPoint[]; height?: number }) {
  const { grid, tick } = chartColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <defs>
          {STATUS_SERIES.map(({ key, color }) => (
            <linearGradient key={key} id={`tg-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: tick }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: tick }} tickLine={false} axisLine={false} width={34} />
        <Tooltip contentStyle={tooltipStyle()} />
        {STATUS_SERIES.map(({ key, label, color }) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            name={label}
            stroke={color}
            fill={`url(#tg-${key})`}
            strokeWidth={1.5}
            dot={false}
            stackId="s"
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
