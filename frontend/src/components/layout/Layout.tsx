import { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  LayoutDashboard, Activity, List, BarChart2, Shield,
  Globe2, Map, Bell, Settings, LogOut, Search,
  ChevronRight, Cpu, ChevronDown, User, KeyRound,
  CalendarDays, X, Menu,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useAuthStore } from "@/stores/auth";
import { useUIStore, selectActivePreset, selectCustomDate } from "@/stores/ui";
import {
  PRESET_LIST, PRESET_LABELS, formatDayLabel,
  type DatePreset,
} from "@/lib/date-range";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";

/* ── Navigation groups ──────────────────────────────────────────────────────── */

const NAV_GROUPS = [
  {
    label: "Monitor",
    items: [
      { to: "/",          icon: LayoutDashboard, label: "Dashboard",   end: true,  shortcut: "G D" },
      { to: "/realtime",  icon: Activity,        label: "Real-Time",              shortcut: "G R" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { to: "/requests",  icon: List,            label: "Requests",               shortcut: "G Q" },
      { to: "/analytics", icon: BarChart2,       label: "Analytics",              shortcut: "G A" },
      { to: "/hosts",     icon: Globe2,          label: "Hosts",                  shortcut: "G H" },
      { to: "/geo",       icon: Map,             label: "Geographic",             shortcut: "G E" },
    ],
  },
  {
    label: "Security",
    items: [
      { to: "/security",  icon: Shield,          label: "Security",               shortcut: "G S" },
      { to: "/alerts",    icon: Bell,            label: "Alerts",                 shortcut: "G L" },
    ],
  },
  {
    label: "Config",
    items: [
      { to: "/settings",  icon: Settings,        label: "Settings",               shortcut: "G ," },
    ],
  },
];

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

/* Bottom nav — 4 primary pages + "More" opens the full nav sheet */
const BOTTOM_NAV = [
  { to: "/",          icon: LayoutDashboard, label: "Overview", end: true  },
  { to: "/realtime",  icon: Activity,        label: "Live"               },
  { to: "/requests",  icon: List,            label: "Requests"           },
  { to: "/security",  icon: Shield,          label: "Security"           },
];

/* ── Date range selector ─────────────────────────────────────────────────────── */

function DateRangeSelector() {
  const { setDatePreset, setCustomDate } = useUIStore();
  const activePreset  = useUIStore(selectActivePreset);
  const customDate    = useUIStore(selectCustomDate);
  const [calOpen, setCalOpen] = useState(false);

  function handlePreset(preset: DatePreset) {
    setCalOpen(false);
    setDatePreset(preset);
  }

  function handleCustomDay(date: Date) {
    setCustomDate(date);
    setCalOpen(false);
  }

  return (
    <div className="flex items-center gap-0.5">
      {/* Preset buttons */}
      <div className="flex items-center bg-muted/60 rounded-lg p-0.5 gap-0.5 border border-border">
        {PRESET_LIST.map((preset) => (
          <button
            key={preset}
            onClick={() => handlePreset(preset)}
            className={cn(
              "px-2.5 h-6 rounded-md text-xs font-medium transition-all",
              activePreset === preset
                ? "bg-card text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </div>

      {/* Custom date picker */}
      <Popover.Root open={calOpen} onOpenChange={setCalOpen}>
        <Popover.Trigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs font-medium transition-all ml-1",
              customDate
                ? "bg-primary/10 border-primary/40 text-primary"
                : calOpen
                ? "bg-muted border-border text-foreground"
                : "bg-muted/60 border-border text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <CalendarDays className="w-3 h-3 flex-shrink-0" />
            {customDate ? formatDayLabel(customDate) : "Date"}
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            avoidCollisions
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="z-[9999] rounded-xl border border-border bg-popover animate-fade-in"
            style={{ boxShadow: "0 4px 6px -1px rgba(0,0,0,.1), 0 20px 48px -4px rgba(0,0,0,.4)" }}
          >
            <DatePicker value={customDate} onChange={handleCustomDay} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Clear custom date */}
      {customDate && (
        <button
          onClick={() => handlePreset("l1h")}
          title="Back to preset"
          className="ml-0.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/* ── Command Palette ─────────────────────────────────────────────────────────── */

interface CmdItem {
  id: string;
  label: string;
  sub?: string;
  icon: React.ElementType;
  action: () => void;
  shortcut?: string;
  group: string;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: CmdItem[] = [
    ...ALL_NAV.map((n) => ({
      id: `nav-${n.to}`,
      label: n.label,
      sub: "Navigate",
      icon: n.icon,
      action: () => { navigate(n.to); onClose(); },
      shortcut: n.shortcut,
      group: "Pages",
    })),
  ];

  const filtered = query
    ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()) || i.sub?.toLowerCase().includes(query.toLowerCase()))
    : items;

  const groups = filtered.reduce<Record<string, CmdItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") { filtered[selected]?.action(); }
  }, [open, filtered, selected, onClose]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!open) return null;

  let globalIdx = 0;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search pages, hosts, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cmd-key text-xs">ESC</kbd>
        </div>
        <div className="cmd-results">
          {Object.entries(groups).map(([group, groupItems]) => (
            <div key={group}>
              <p className="cmd-section-label">{group}</p>
              {groupItems.map((item) => {
                const idx = globalIdx++;
                const isSelected = selected === idx;
                return (
                  <div
                    key={item.id}
                    className={cn("cmd-item", isSelected && "selected")}
                    onClick={item.action}
                    onMouseEnter={() => setSelected(idx)}
                  >
                    <div className="cmd-item-icon">
                      <item.icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-none">{item.label}</p>
                      {item.sub && <p className="text-xs text-muted-foreground mt-0.5">{item.sub}</p>}
                    </div>
                    {item.shortcut && (
                      <div className="cmd-shortcut">
                        {item.shortcut.split(" ").map((k) => <kbd key={k} className="cmd-key">{k}</kbd>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-10">No results for "{query}"</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── User Menu ───────────────────────────────────────────────────────────────── */

function UserMenu() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2 h-7 rounded-lg hover:bg-muted/60 transition-colors"
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)" }}
        >
          {user?.username?.[0]?.toUpperCase() ?? "A"}
        </div>
        <span className="text-xs font-medium text-foreground hidden sm:block">{user?.username ?? "admin"}</span>
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform hidden sm:block", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-48 bg-popover border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-slide-up"
          style={{ boxShadow: "0 16px 40px rgba(0,0,0,0.4)" }}>
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold text-foreground">{user?.username ?? "admin"}</p>
            <p className="text-[10px] text-muted-foreground">Administrator</p>
          </div>
          <div className="p-1">
            <button
              onClick={() => { setOpen(false); navigate("/settings"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              Profile &amp; Settings
            </button>
            <button
              onClick={() => { setOpen(false); navigate("/change-password"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Change Password
            </button>
            <div className="h-px bg-border mx-1 my-1" />
            <button
              onClick={async () => { setOpen(false); await logout(); navigate("/login"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/8 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── TopBar ──────────────────────────────────────────────────────────────────── */

const HIDE_DATE_PICKER_PATHS = new Set(["/realtime"]);

function TopBar({ onCmdOpen, onMenuOpen }: { onCmdOpen: () => void; onMenuOpen: () => void }) {
  const location = useLocation();
  const pageName = ALL_NAV.find((n) => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))?.label ?? "";
  const showDatePicker = !HIDE_DATE_PICKER_PATHS.has(location.pathname);

  return (
    <div className="flex-shrink-0 bg-card/80 backdrop-blur-md border-b border-border sticky top-0 z-20">
      {/* Main row */}
      <div className="flex items-center gap-2 md:gap-3 px-4 h-12">
        {/* Mobile: hamburger */}
        <button
          onClick={onMenuOpen}
          aria-label="Open navigation"
          className="md:hidden flex items-center justify-center w-9 h-9 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile: page title */}
        <span className="md:hidden text-sm font-semibold text-foreground truncate">
          {pageName || "CADSA"}
        </span>

        {/* Desktop: breadcrumb */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
          <Cpu className="w-3 h-3" />
          <span>CADSA</span>
          {pageName && <><ChevronRight className="w-3 h-3" /><span className="text-foreground font-medium">{pageName}</span></>}
        </div>

        {/* Desktop: date picker inline */}
        {showDatePicker && (
          <div className="hidden md:flex">
            <DateRangeSelector />
          </div>
        )}

        <div className="flex-1" />

        {/* Desktop: search */}
        <button
          onClick={onCmdOpen}
          className="hidden md:flex items-center gap-2 px-3 h-7 rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
        >
          <Search className="w-3 h-3" />
          <span>Search...</span>
          <div className="flex gap-0.5 ml-1">
            <kbd className="cmd-key">⌘</kbd>
            <kbd className="cmd-key">K</kbd>
          </div>
        </button>

        <ThemeSwitcher />
        <UserMenu />
      </div>

      {/* Mobile: date picker row — horizontal scroll, no visible bar */}
      {showDatePicker && (
        <div className="md:hidden overflow-x-auto scrollbar-none px-4 pb-2.5">
          <div className="min-w-max">
            <DateRangeSelector />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Desktop Sidebar ─────────────────────────────────────────────────────────── */

function Sidebar() {
  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border flex-shrink-0">
        <img src="/logo.webp" alt="CADSA" className="h-7 w-auto flex-shrink-0" draggable={false} />
        <div className="flex flex-col">
          <span className="font-bold text-sm tracking-tight gradient-text">CADSA</span>
          <span className="text-[9px] text-muted-foreground -mt-0.5 leading-none">Server Analytics</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_GROUPS.map(({ label, items }) => (
          <div key={label}>
            <p className="sidebar-section">{label}</p>
            {items.map(({ to, icon: Icon, label: itemLabel, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "nav-item flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-sm mb-0.5",
                    isActive ? "nav-item-active" : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-primary" : "")} />
                    <span>{itemLabel}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Live indicator */}
      <div className="border-t border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="status-dot live" />
          <span className="text-xs text-muted-foreground">Monitoring live</span>
        </div>
      </div>
    </aside>
  );
}

/* ── Mobile Nav Sheet (slide from left) ──────────────────────────────────────── */

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative flex flex-col h-full bg-card border-r border-border shadow-2xl animate-slide-left"
        style={{ width: "min(18rem, calc(100vw - 56px))", boxShadow: "8px 0 40px rgba(0,0,0,0.4)" }}
      >
        {/* Logo + close */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <img src="/logo.webp" alt="CADSA" className="h-7 w-auto flex-shrink-0" draggable={false} />
            <div>
              <span className="font-bold text-sm gradient-text">CADSA</span>
              <p className="text-[9px] text-muted-foreground leading-none mt-0.5">Server Analytics</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_GROUPS.map(({ label, items }) => (
            <div key={label}>
              <p className="sidebar-section">{label}</p>
              {items.map(({ to, icon: Icon, label: itemLabel, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      "nav-item flex items-center gap-2.5 mx-2 px-3 py-3 rounded-lg text-sm mb-0.5",
                      isActive ? "nav-item-active" : "text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-primary" : "")} />
                      <span>{itemLabel}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User + live indicator */}
        <div
          className="border-t border-border px-4 py-4 flex-shrink-0 space-y-3"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-1.5">
            <span className="status-dot live" />
            <span className="text-xs text-muted-foreground">Monitoring live</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)" }}
              >
                {user?.username?.[0]?.toUpperCase() ?? "A"}
              </div>
              <span className="text-xs font-medium text-foreground">{user?.username ?? "admin"}</span>
            </div>
            <button
              onClick={async () => { onClose(); await logout(); navigate("/login"); }}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/8 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Mobile Bottom Nav ───────────────────────────────────────────────────────── */

function MobileBottomNav({ onMoreOpen }: { onMoreOpen: () => void }) {
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-card/95 backdrop-blur-md border-t border-border flex items-stretch"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {BOTTOM_NAV.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 px-1 min-h-[56px]"
        >
          {({ isActive }) => (
            <>
              <Icon className={cn(
                "w-5 h-5 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )} />
              <span className={cn(
                "text-[10px] font-medium leading-none transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}

      {/* More — opens full nav sheet */}
      <button
        onClick={onMoreOpen}
        className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 px-1 min-h-[56px] text-muted-foreground"
      >
        <Menu className="w-5 h-5" />
        <span className="text-[10px] font-medium leading-none">More</span>
      </button>
    </nav>
  );
}

/* ── Root Layout ─────────────────────────────────────────────────────────────── */

export default function Layout() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="flex h-dvh bg-background overflow-hidden">
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          onCmdOpen={() => setCmdOpen(true)}
          onMenuOpen={() => setMobileNavOpen(true)}
        />
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Bottom padding on mobile to clear the fixed tab bar */}
          <div className="pb-16 md:pb-0">
            <Outlet />
          </div>
        </div>
      </main>

      <MobileBottomNav onMoreOpen={() => setMobileNavOpen(true)} />
    </div>
  );
}
