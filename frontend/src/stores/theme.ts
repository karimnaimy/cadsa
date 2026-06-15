import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedTheme: () => "light" | "dark";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      mode: "system",

      setMode: (mode) => {
        set({ mode });
        applyTheme(mode);
      },

      resolvedTheme: () => {
        const { mode } = get();
        if (mode === "system") return systemPrefersDark() ? "dark" : "light";
        return mode;
      },
    }),
    {
      name: "cadsa-theme",
      // Only persist if the user has explicitly chosen — if they haven't touched it,
      // clear the key so we always re-read the system preference on next load.
      partialize: (state) =>
        state.mode === "system" ? {} : { mode: state.mode },
    },
  ),
);
