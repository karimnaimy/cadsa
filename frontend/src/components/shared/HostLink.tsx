import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Props {
  host: string;
  className?: string;
}

export function HostLink({ host, className }: Props) {
  return (
    <Link
      to={`/hosts/${encodeURIComponent(host)}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "font-mono text-primary hover:text-primary/80 hover:underline underline-offset-2 decoration-primary/40 transition-colors truncate",
        className,
      )}
    >
      {host}
    </Link>
  );
}
