import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";
import { cn, formatNumber } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface VisitorsPoint {
  time: string;
  unique_ips: number;
}

export function VisitorsCard({ data, height = 160, className }: {
  data: VisitorsPoint[]; height?: number; className?: string;
}) {
  const peak = data.length > 0 ? Math.max(...data.map((d) => d.unique_ips)) : 0;
  return (
    <Card className={cn("card-elevated", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Unique Visitors</CardTitle>
          {peak > 0 && (
            <p className="text-2xl font-bold tabular tracking-tight text-foreground">
              {formatNumber(peak)}
              <span className="text-xs font-normal text-muted-foreground ml-2">peak</span>
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data.length > 0
          ? <VisitorsChart data={data} height={height} />
          : <EmptyState title="No visitor data" />}
      </CardContent>
    </Card>
  );
}

export function VisitorsChart({ data, height = 160 }: { data: VisitorsPoint[]; height?: number }) {
  const { grid, tick } = chartColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id="vc-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 9, fill: tick }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [formatNumber(v), "Unique IPs"]} />
        <Area type="monotone" dataKey="unique_ips" name="Visitors" stroke="#8b5cf6" fill="url(#vc-grad)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
