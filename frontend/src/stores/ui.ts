import { create } from "zustand";
import type { Granularity } from "@/types";
import { type DatePreset, type DateMode } from "@/lib/date-range";

export type { DatePreset, DateMode };

interface UIState {
  granularity: Granularity;
  dateMode:    DateMode;

  setGranularity: (g: Granularity) => void;
  setDatePreset:  (preset: DatePreset) => void;
  setCustomDate:  (date: Date) => void;
}

const DEFAULT_PRESET: DatePreset = "l1h";

export const useUIStore = create<UIState>((set) => ({
  granularity: "hour",
  dateMode:    { type: "preset", preset: DEFAULT_PRESET },

  setGranularity:  (granularity) => set({ granularity }),
  setDatePreset:   (preset) => set({ dateMode: { type: "preset", preset } }),
  setCustomDate:   (date)   => set({ dateMode: { type: "custom", date } }),
}));

// ── Convenience selectors ──────────────────────────────────────────────────

export const selectIsCustomDate = (s: UIState) => s.dateMode.type === "custom";

export const selectActivePreset = (s: UIState): DatePreset | null =>
  s.dateMode.type === "preset" ? s.dateMode.preset : null;

export const selectCustomDate = (s: UIState): Date | null =>
  s.dateMode.type === "custom" ? s.dateMode.date : null;

export const selectDateLabel = (s: UIState): string => {
  if (s.dateMode.type === "preset") return s.dateMode.preset.replace("l", "");
  const d = s.dateMode.date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
