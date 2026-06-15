import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore, type ThemeMode } from "@/stores/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { mode: ThemeMode; icon: React.ElementType; label: string }[] = [
  { mode: "system", icon: Monitor, label: "System" },
  { mode: "light",  icon: Sun,     label: "Light"  },
  { mode: "dark",   icon: Moon,    label: "Dark"   },
];

export function ThemeSwitcher({ className }: { className?: string }) {
  const { mode, setMode } = useThemeStore();

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md bg-muted p-0.5",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      {OPTIONS.map(({ mode: m, icon: Icon, label }) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          title={label}
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded transition-colors",
            mode === m
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}
