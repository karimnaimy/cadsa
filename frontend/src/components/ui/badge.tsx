import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const VARIANTS: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground",
  success: "bg-green-400/10 text-green-400",
  warning: "bg-yellow-400/10 text-yellow-400",
  danger: "bg-red-400/10 text-red-400",
  info: "bg-blue-400/10 text-blue-400",
};

export function Badge({ className, variant = "default", children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
