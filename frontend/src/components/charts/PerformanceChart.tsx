import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import type { PerformancePoint } from "@/types";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";

interface Props {
  data: PerformancePoint[];
  height?: number;
}

export default function PerformanceChart({ data, height = 260 }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    time: format(new Date(d.ts), "MMM d HH:mm"),
  }));

  const { palette, grid, tick } = chartColors();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: tick }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: tick }} tickLine={false} axisLine={false} width={45} unit="ms" />
        <Tooltip contentStyle={tooltipStyle()} formatter={(v: number) => [`${v}ms`]} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="p50" name="P50" stroke={palette[1]} strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="p95" name="P95" stroke={palette[2]} strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="p99" name="P99" stroke={palette[3]} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
