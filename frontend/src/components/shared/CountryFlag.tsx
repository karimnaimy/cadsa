import * as Flags from "country-flag-icons/react/3x2";
import { cn } from "@/lib/utils";

interface Props {
  code?: string | null;
  className?: string;
}

export function CountryFlag({ code, className }: Props) {
  if (!code || code.length !== 2) return null;
  const Cmp = (Flags as Record<string, React.ComponentType<{ className?: string; title?: string }>>)[
    code.toUpperCase()
  ];
  if (!Cmp) return <span className={cn("text-[10px] font-mono text-muted-foreground", className)}>{code}</span>;
  return <Cmp className={cn("inline-block rounded-[1px]", className)} title={code} />;
}
