/**
 * Date range helpers — single source of truth for all time-range logic.
 *
 * The backend is responsible for all time-range computation. The frontend only
 * sends `period=l1h` (for relative presets) or `date=2024-01-13T00:00:00+02:00`
 * (for a specific calendar day with the client's UTC offset). Never compute
 * from/to Date objects here for API calls.
 */

export type DatePreset = "l15m" | "l1h" | "l6h" | "l24h" | "l7d" | "l30d";

export type DateMode =
  | { type: "preset"; preset: DatePreset }
  | { type: "custom"; date: Date };

// ── Labels ──────────────────────────────────────────────────────────────────

export const PRESET_LABELS: Record<DatePreset, string> = {
  "l15m": "15m",
  "l1h":  "1h",
  "l6h":  "6h",
  "l24h": "24h",
  "l7d":  "7d",
  "l30d": "30d",
};

export const PRESET_LIST: DatePreset[] = ["l15m", "l1h", "l6h", "l24h", "l7d", "l30d"];

// ── API param builder ────────────────────────────────────────────────────────

/**
 * Converts a DateMode to the API query string fragment the backend expects.
 * For presets: "period=l1h"
 * For a specific day: "date=2024-01-13T00:00:00+02:00" (local midnight with TZ offset)
 */
export function modeToApiParam(mode: DateMode): string {
  if (mode.type === "preset") return `period=${mode.preset}`;

  const d = mode.date;
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const offsetMin = -midnight.getTimezoneOffset(); // negative of getTimezoneOffset
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs  = Math.abs(offsetMin);
  const hh   = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm   = String(abs % 60).padStart(2, "0");
  const y    = midnight.getFullYear();
  const mo   = String(midnight.getMonth() + 1).padStart(2, "0");
  const da   = String(midnight.getDate()).padStart(2, "0");
  return `date=${y}-${mo}-${da}T00:00:00${sign}${hh}:${mm}`;
}

// ── Calendar picker constraint ────────────────────────────────────────────────

export const MAX_RETENTION_DAYS = 30;

/** The earliest selectable date in the date picker (start of day, MAX_RETENTION_DAYS ago). */
export function earliestAllowedDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() - MAX_RETENTION_DAYS);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

/** "Jun 13" — used to label a selected custom date in the TopBar. */
export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "2026-06-13" — native date input value format. */
export function toInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a "yyyy-MM-dd" string from a date input into a local Date. */
export function fromInputValue(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Chart time-label formatter ───────────────────────────────────────────────

/**
 * Returns a date-fns format string appropriate for the granularity hint
 * returned by the backend in timeseries responses.
 */
export function granularityToFmt(granularity: string): string {
  switch (granularity) {
    case "minute": return "HH:mm";
    case "15min":  return "HH:mm";
    case "hour":   return "HH:mm";
    case "8hour":  return "MMM d HH:mm";
    case "day":    return "MMM d";
    default:       return "HH:mm";
  }
}
