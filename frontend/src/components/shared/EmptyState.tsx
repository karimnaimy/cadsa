import { cn } from "@/lib/utils";

interface Props {
  icon?: React.ElementType;
  title?: string;
  description?: string;
  height?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, title = "No data", description, height = "h-48", className }: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2", height, className)}>
      {Icon && <Icon className="w-8 h-8 text-muted-foreground/40" />}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70">{description}</p>}
    </div>
  );
}
