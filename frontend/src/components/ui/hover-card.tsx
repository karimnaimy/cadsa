import { useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

interface HoverCardProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
}

/**
 * Hover-triggered popover that renders in a portal — never clipped by
 * overflow:hidden containers. Uses Radix Popover.Anchor so the trigger's
 * own click handlers are untouched. Collision detection keeps it on screen
 * regardless of row position.
 */
export function HoverCard({
  trigger,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 8,
  className,
}: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    timer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <span className="inline-flex" onMouseEnter={show} onMouseLeave={hide}>
          {trigger}
        </span>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          avoidCollisions
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={show}
          onMouseLeave={hide}
          className={cn(
            "z-[9999] rounded-xl border border-border bg-popover animate-fade-in",
            className,
          )}
          style={{
            boxShadow:
              "0 4px 6px -1px rgba(0,0,0,.1), 0 20px 48px -4px rgba(0,0,0,.45)",
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
