/**
 * Minimal calendar date-picker.
 * Renders a month grid constrained to the last MAX_RETENTION_DAYS days.
 * Calls onChange only when the user clicks a valid day — no intermediate state.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  earliestAllowedDate,
  formatDayLabel,
  toInputValue,
} from "@/lib/date-range";

interface DatePickerProps {
  /** Currently selected date (if any) */
  value?: Date | null;
  /** Called only when the user clicks a valid day */
  onChange: (date: Date) => void;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** 0 = Mon … 6 = Sun (ISO week order) */
function isoDow(d: Date) {
  return (d.getDay() + 6) % 7;
}

const DOW_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function DatePicker({ value, onChange }: DatePickerProps) {
  const today    = new Date();
  const earliest = earliestAllowedDate();

  const [view, setView] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const monthStart  = startOfMonth(view);
  const monthEnd    = endOfMonth(view);
  const leadPad     = isoDow(monthStart);  // empty cells before the 1st

  // Collect all days in the month
  const days: Date[] = [];
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  const prevMonthStart = new Date(view.getFullYear(), view.getMonth() - 1, 1);
  const nextMonthStart = new Date(view.getFullYear(), view.getMonth() + 1, 1);

  // Can go back only if the previous month contains days ≥ earliest
  const canPrev = endOfMonth(prevMonthStart) >= earliest;
  // Can go forward only if next month starts ≤ today
  const canNext = nextMonthStart <= today;

  function isDisabled(day: Date) {
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const e = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return s < e || s > t;
  }

  return (
    <div className="p-3 select-none w-64">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => canPrev && setView(prevMonthStart)}
          disabled={!canPrev}
          className="p-1 rounded-md hover:bg-muted transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <span className="text-sm font-semibold text-foreground">
          {view.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <button
          onClick={() => canNext && setView(nextMonthStart)}
          disabled={!canNext}
          className="p-1 rounded-md hover:bg-muted transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DOW_LABELS.map((label) => (
          <div key={label} className="text-center text-[10px] text-muted-foreground font-semibold py-1 uppercase tracking-wide">
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px">
        {/* Leading empty cells */}
        {Array.from({ length: leadPad }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}

        {days.map((day) => {
          const disabled  = isDisabled(day);
          const isToday   = isSameDay(day, today);
          const selected  = value && isSameDay(day, value);

          return (
            <button
              key={toInputValue(day)}
              onClick={() => !disabled && onChange(day)}
              disabled={disabled}
              className={cn(
                "h-8 w-full rounded-md text-xs font-medium transition-colors",
                selected
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isToday
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : disabled
                  ? "text-muted-foreground/25 cursor-not-allowed"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <p className="text-[10px] text-muted-foreground text-center mt-3 border-t border-border pt-2">
        Data available from {formatDayLabel(earliest)}
      </p>
    </div>
  );
}
