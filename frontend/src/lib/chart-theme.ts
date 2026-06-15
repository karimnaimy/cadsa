/**
 * Read chart-related CSS variables from the document root at call time,
 * so charts always respect the active light/dark theme.
 */
export function chartColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    grid:    v("--chart-grid")   || "#1a2035",
    tick:    v("--chart-tick")   || "#4a5568",
    bg:      v("--chart-bg")     || "#0c1019",
    border:  v("--chart-border") || "#1a2035",
    palette: [
      "#6366f1", // indigo
      "#06b6d4", // cyan
      "#10b981", // emerald
      "#f59e0b", // amber
      "#ef4444", // rose
      "#a855f7", // purple
    ],
  };
}

/** Tooltip contentStyle for Recharts — always theme-aware. */
export function tooltipStyle(): React.CSSProperties {
  const s = getComputedStyle(document.documentElement);
  return {
    background: s.getPropertyValue("--chart-bg").trim() || "#0c1019",
    border: `1px solid ${s.getPropertyValue("--chart-border").trim() || "#1a2035"}`,
    borderRadius: "8px",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    padding: "8px 12px",
  };
}
