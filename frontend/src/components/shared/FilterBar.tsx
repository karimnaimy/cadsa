import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, X, Search, ChevronDown, Check } from "lucide-react";
import { analytics } from "@/lib/api";
import { useUIStore } from "@/stores/ui";
import { useFilters } from "@/hooks/useFilters";
import { CountryFlag } from "@/components/shared/CountryFlag";
import { Drawer } from "@/components/shared/Drawer";
import { cn } from "@/lib/utils";
import type { Filters, FilterKey } from "@/types";

/* ── Constants ───────────────────────────────────────────────────────────── */

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"] as const;

const STATUS_OPTIONS = [
  { value: "2xx", label: "2xx Success",     color: "emerald" },
  { value: "3xx", label: "3xx Redirect",    color: "indigo"  },
  { value: "4xx", label: "4xx Client Err",  color: "amber"   },
  { value: "5xx", label: "5xx Server Err",  color: "red"     },
] as const;

const STATUS_STYLES: Record<string, { active: string; inactive: string }> = {
  emerald: { active: "bg-emerald-500/20 border-emerald-500/50 text-emerald-300", inactive: "border-border text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-400" },
  indigo:  { active: "bg-indigo-500/20 border-indigo-500/50 text-indigo-300",   inactive: "border-border text-muted-foreground hover:border-indigo-500/30 hover:text-indigo-400"  },
  amber:   { active: "bg-amber-500/20 border-amber-500/50 text-amber-300",      inactive: "border-border text-muted-foreground hover:border-amber-500/30 hover:text-amber-400"   },
  red:     { active: "bg-red-500/20 border-red-500/50 text-red-300",            inactive: "border-border text-muted-foreground hover:border-red-500/30 hover:text-red-400"       },
};

const METHOD_STYLES: Record<string, string> = {
  GET:    "hover:bg-sky-500/15 hover:text-sky-300 hover:border-sky-500/40",
  POST:   "hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/40",
  PUT:    "hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/40",
  DELETE: "hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/40",
  PATCH:  "hover:bg-orange-500/15 hover:text-orange-300 hover:border-orange-500/40",
  HEAD:   "hover:bg-purple-500/15 hover:text-purple-300 hover:border-purple-500/40",
};

const METHOD_ACTIVE: Record<string, string> = {
  GET:    "bg-sky-500/20 border-sky-500/50 text-sky-300",
  POST:   "bg-emerald-500/20 border-emerald-500/50 text-emerald-300",
  PUT:    "bg-amber-500/20 border-amber-500/50 text-amber-300",
  DELETE: "bg-red-500/20 border-red-500/50 text-red-300",
  PATCH:  "bg-orange-500/20 border-orange-500/50 text-orange-300",
  HEAD:   "bg-purple-500/20 border-purple-500/50 text-purple-300",
};

const CHIP_STYLES: Record<FilterKey, string> = {
  host:         "bg-indigo-500/12 border-indigo-500/25 text-indigo-300",
  remote_ip:    "bg-cyan-500/12 border-cyan-500/25 text-cyan-300",
  method:       "bg-purple-500/12 border-purple-500/25 text-purple-300",
  status_class: "bg-amber-500/12 border-amber-500/25 text-amber-300",
  path:         "bg-emerald-500/12 border-emerald-500/25 text-emerald-300",
  country:      "bg-teal-500/12 border-teal-500/25 text-teal-300",
};

const FILTER_LABELS: Record<FilterKey, string> = {
  host: "Host", remote_ip: "IP", method: "Method",
  status_class: "Status", path: "Path", country: "Country",
};

/* ── Searchable Combobox ─────────────────────────────────────────────────── */

function Combobox({
  options,
  value,
  onChange,
  placeholder,
  loading,
  renderOption,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  loading?: boolean;
  renderOption?: (opt: { value: string; label: string }) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()) || o.value.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 text-xs bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin">
        {value && (
          <button
            onClick={() => onChange("")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear selection
          </button>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">No results</div>
        ) : (
          filtered.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onChange(selected ? "" : opt.value)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors",
                  selected
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "text-foreground hover:bg-muted/60 border border-transparent",
                )}
              >
                {renderOption ? renderOption(opt) : <span className="flex-1 text-left truncate">{opt.label}</span>}
                {selected && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Section wrapper ─────────────────────────────────────────────────────── */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{label}</p>
      {children}
    </div>
  );
}

/* ── FilterBar ───────────────────────────────────────────────────────────── */

export function FilterBar() {
  const { filters, activeCount, removeFilter, clearFilters, applyAllFilters } = useFilters();
  const { dateMode } = useUIStore();
  const [open, setOpen] = useState(false);

  // Draft state — what's staged inside the Drawer before "Apply"
  const [draft, setDraft] = useState<Filters>({});

  // Sync draft from URL when drawer opens
  useEffect(() => {
    if (open) setDraft({ ...filters });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch options for the dropdowns
  const { data: hosts, isLoading: hostsLoading } = useQuery({
    queryKey: ["filter-hosts", dateMode],
    queryFn: () => analytics.hosts(dateMode),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const { data: countries, isLoading: countriesLoading } = useQuery({
    queryKey: ["filter-countries", dateMode],
    queryFn: () => analytics.distinctCountries(dateMode),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const hostOptions = useMemo(
    () => (hosts ?? []).map((h) => ({ value: h.host, label: h.host })),
    [hosts],
  );

  const countryOptions = useMemo(
    () => (countries ?? []).map((c) => ({ value: c.code, label: c.name })),
    [countries],
  );

  function applyFilters() {
    applyAllFilters(draft);
    setOpen(false);
  }

  function resetDraft() {
    setDraft({});
  }

  function handleApply() {
    applyFilters();
  }

  function handleReset() {
    resetDraft();
    clearFilters();
    setOpen(false);
  }

  const draftCount = Object.values(draft).filter(Boolean).length;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "relative flex items-center gap-2 px-3 h-8 rounded-lg border text-xs font-medium transition-all",
          activeCount > 0
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/30",
        )}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        Filters
        {activeCount > 0 && (
          <span className="ml-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {activeCount}
          </span>
        )}
        <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
      </button>

      {/* Active filter chips */}
      {(Object.entries(filters) as [FilterKey, string | undefined][]).map(([key, value]) => {
        if (!value) return null;
        return (
          <span
            key={key}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs",
              CHIP_STYLES[key],
            )}
          >
            <span className="opacity-60 text-[10px] uppercase font-bold">{FILTER_LABELS[key]}</span>
            {key === "country" && <CountryFlag code={value} className="w-4 h-2.5 rounded-[1px]" />}
            <span className="font-mono">{value}</span>
            <button
              onClick={() => removeFilter(key)}
              className="ml-0.5 hover:opacity-70 transition-opacity"
              aria-label={`Remove ${FILTER_LABELS[key]} filter`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}

      {activeCount > 1 && (
        <button
          onClick={clearFilters}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 h-8 border border-transparent hover:border-border rounded-lg"
        >
          Clear all
        </button>
      )}

      {/* Drawer */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        subtitle={draftCount > 0 ? `${draftCount} filter${draftCount > 1 ? "s" : ""} staged` : "Refine data across all charts"}
        width="w-[380px]"
      >
        <div className="flex flex-col h-full">
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

            {/* ── Host ── */}
            <Section label="Host">
              <Combobox
                options={hostOptions}
                value={draft.host ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, host: v || undefined }))}
                placeholder="Search hosts…"
                loading={hostsLoading}
              />
            </Section>

            <div className="h-px bg-border/60" />

            {/* ── Country ── */}
            <Section label="Country">
              <Combobox
                options={countryOptions}
                value={draft.country ?? ""}
                onChange={(v) => setDraft((d) => ({ ...d, country: v || undefined }))}
                placeholder="Search countries…"
                loading={countriesLoading}
                renderOption={(opt) => (
                  <>
                    <CountryFlag code={opt.value} className="w-5 h-3.5 rounded-[1px] flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{opt.label}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">{opt.value}</span>
                  </>
                )}
              />
            </Section>

            <div className="h-px bg-border/60" />

            {/* ── Status ── */}
            <Section label="Status Class">
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((s) => {
                  const active = draft.status_class === s.value;
                  const style = STATUS_STYLES[s.color];
                  return (
                    <button
                      key={s.value}
                      onClick={() => setDraft((d) => ({ ...d, status_class: active ? undefined : s.value }))}
                      className={cn(
                        "flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs font-medium transition-all",
                        active ? style.active : style.inactive,
                      )}
                    >
                      <span>{s.label}</span>
                      {active && <Check className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            </Section>

            <div className="h-px bg-border/60" />

            {/* ── Method ── */}
            <Section label="HTTP Method">
              <div className="flex flex-wrap gap-2">
                {METHODS.map((m) => {
                  const active = draft.method === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setDraft((d) => ({ ...d, method: active ? undefined : m }))}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all",
                        active
                          ? METHOD_ACTIVE[m]
                          : cn("border-border text-muted-foreground", METHOD_STYLES[m]),
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </Section>

            <div className="h-px bg-border/60" />

            {/* ── IP ── */}
            <Section label="IP Address">
              <input
                value={draft.remote_ip ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, remote_ip: e.target.value.slice(0, 45) || undefined }))}
                placeholder="e.g. 1.2.3.4 or 10.0.0.0/8"
                className="w-full px-3 py-2.5 text-xs bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
            </Section>

            <div className="h-px bg-border/60" />

            {/* ── Path ── */}
            <Section label="Path">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={draft.path ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value.slice(0, 2048) || undefined }))}
                  placeholder="e.g. /api/users (partial match)"
                  className="w-full pl-9 pr-3 py-2.5 text-xs bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                />
              </div>
            </Section>
          </div>

          {/* ── Footer ── */}
          <div className="flex-shrink-0 px-5 py-4 border-t border-border bg-card/50 flex items-center gap-3">
            <button
              onClick={handleReset}
              className="flex-1 h-9 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
            >
              Reset all
            </button>
            <button
              onClick={handleApply}
              className="flex-2 px-6 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Apply filters
              {draftCount > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-white/20 text-[10px]">{draftCount}</span>
              )}
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
