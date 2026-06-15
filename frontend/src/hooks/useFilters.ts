import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Filters, FilterKey } from "@/types";

const VALID_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
const VALID_STATUS  = new Set(["2xx", "3xx", "4xx", "5xx"]);

export function useFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: Filters = useMemo(() => ({
    host:         searchParams.get("host")?.slice(0, 253) || undefined,
    remote_ip:    searchParams.get("remote_ip")?.slice(0, 45) || undefined,
    method:       VALID_METHODS.has(searchParams.get("method") ?? "") ? searchParams.get("method")! : undefined,
    status_class: VALID_STATUS.has(searchParams.get("status_class") ?? "") ? searchParams.get("status_class")! : undefined,
    path:         searchParams.get("path")?.slice(0, 2048) || undefined,
    country:      searchParams.get("country")?.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2) || undefined,
  }), [searchParams]);

  const activeCount = Object.values(filters).filter(Boolean).length;

  function setFilter(key: FilterKey, value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(key, value);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  function removeFilter(key: FilterKey) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }

  function clearFilters() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        (["host", "remote_ip", "method", "status_class", "path", "country", "page"] as const).forEach(
          (k) => next.delete(k),
        );
        return next;
      },
      { replace: true },
    );
  }

  function applyAllFilters(draft: Filters) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("page");
        const keys = ["host", "remote_ip", "method", "status_class", "path", "country"] as const;
        keys.forEach((k) => {
          const v = draft[k];
          if (v) next.set(k, v);
          else next.delete(k);
        });
        return next;
      },
      { replace: true },
    );
  }

  return { filters, activeCount, setFilter, removeFilter, clearFilters, applyAllFilters };
}
