import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import type { TimeseriesPoint } from "@/types";
import { chartColors, tooltipStyle } from "@/lib/chart-theme";

interface Props {
  data: TimeseriesPoint[];
  height?: number;
}

export default function TimeseriesChart({ data, height = 280 }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    time: format(new Date(d.ts), "MMM d HH:mm"),
  }));

  const { palette, grid, tick } = chartColors();
  const c2xx = palette[1];
  const c4xx = palette[2];
  const c5xx = palette[3];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="g2xx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={c2xx} stopOpacity={0.3} />
            <stop offset="95%" stopColor={c2xx} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g4xx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={c4xx} stopOpacity={0.3} />
            <stop offset="95%" stopColor={c4xx} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g5xx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={c5xx} stopOpacity={0.3} />
            <stop offset="95%" stopColor={c5xx} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: tick }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: tick }} tickLine={false} axisLine={false} width={40} />
        <Tooltip contentStyle={tooltipStyle()} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="req_2xx" name="2xx" stroke={c2xx} fill="url(#g2xx)" strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="req_4xx" name="4xx" stroke={c4xx} fill="url(#g4xx)" strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="req_5xx" name="5xx" stroke={c5xx} fill="url(#g5xx)" strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
