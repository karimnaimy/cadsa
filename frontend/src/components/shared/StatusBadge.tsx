import { cn } from "@/lib/utils";

interface StatusProps {
  status: number;
  className?: string;
  large?: boolean;
}

function statusStyle(s: number) {
  if (s < 300) return "bg-emerald-500/12 text-emerald-400 border-emerald-500/25";
  if (s < 400) return "bg-indigo-500/12 text-indigo-400 border-indigo-500/25";
  if (s < 500) return "bg-amber-500/12 text-amber-400 border-amber-500/25";
  return "bg-red-500/12 text-red-400 border-red-500/25";
}

export function StatusBadge({ status, className, large }: StatusProps) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-md font-bold border tabular tracking-wide",
      large ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]",
      statusStyle(status),
      className,
    )}>
      {status}
    </span>
  );
}

const METHOD_STYLES: Record<string, string> = {
  GET:     "bg-indigo-500/12 text-indigo-400 border-indigo-500/25",
  POST:    "bg-emerald-500/12 text-emerald-400 border-emerald-500/25",
  PUT:     "bg-amber-500/12 text-amber-400 border-amber-500/25",
  PATCH:   "bg-purple-500/12 text-purple-400 border-purple-500/25",
  DELETE:  "bg-red-500/12 text-red-400 border-red-500/25",
  HEAD:    "bg-slate-500/12 text-slate-400 border-slate-500/25",
  OPTIONS: "bg-slate-500/12 text-slate-400 border-slate-500/25",
};

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold border tracking-wide",
      METHOD_STYLES[method] ?? "bg-slate-500/12 text-slate-400 border-slate-500/25",
      className,
    )}>
      {method}
    </span>
  );
}
