import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function statusColor(status: number): string {
  if (status < 300) return "text-green-400";
  if (status < 400) return "text-blue-400";
  if (status < 500) return "text-yellow-400";
  return "text-red-400";
}

export function statusBg(status: number): string {
  if (status < 300) return "bg-green-400/10 text-green-400";
  if (status < 400) return "bg-blue-400/10 text-blue-400";
  if (status < 500) return "bg-yellow-400/10 text-yellow-400";
  return "bg-red-400/10 text-red-400";
}

export function severityColor(severity: string): string {
  const map: Record<string, string> = {
    info: "text-blue-400",
    low: "text-green-400",
    medium: "text-yellow-400",
    high: "text-orange-400",
    critical: "text-red-400",
  };
  return map[severity] ?? "text-gray-400";
}

export function severityBg(severity: string): string {
  const map: Record<string, string> = {
    info: "bg-blue-400/10 text-blue-400",
    low: "bg-green-400/10 text-green-400",
    medium: "bg-yellow-400/10 text-yellow-400",
    high: "bg-orange-400/10 text-orange-400",
    critical: "bg-red-400/10 text-red-400",
  };
  return map[severity] ?? "bg-gray-400/10 text-gray-400";
}


export function defaultDateRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to };
}
