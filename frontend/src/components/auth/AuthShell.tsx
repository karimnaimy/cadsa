/**
 * Shared wrapper for all authentication pages.
 * Provides the full-screen background, centred card, and consistent logo/branding.
 */
import { cn } from "@/lib/utils";

interface AuthShellProps {
  children: React.ReactNode;
  /** Card width class — defaults to max-w-sm (384 px) */
  maxWidth?: string;
}

export function AuthShell({ children, maxWidth = "max-w-sm" }: AuthShellProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className={cn("w-full", maxWidth)}>
        {/* Branding */}
        <div className="flex flex-col items-center mb-8 select-none">
          <img
            src="/logo.webp"
            alt="CADSA"
            className="h-12 w-auto mb-3"
            draggable={false}
          />
          <p className="text-xs text-muted-foreground tracking-widest uppercase mt-1">
            Caddy Server Analytics
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-xl shadow-black/20">
          {children}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/50 mt-6 tracking-wide">
          CADSA · secure admin interface
        </p>
      </div>
    </div>
  );
}
