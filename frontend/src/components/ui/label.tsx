import { cn } from "@/lib/utils";

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("text-sm font-medium text-foreground leading-none", className)} {...props}>
      {children}
    </label>
  );
}
