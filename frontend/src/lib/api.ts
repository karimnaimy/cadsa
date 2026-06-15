/**
 * Typed API client — all fetch calls go through here.
 *
 * Session management rules:
 * - _accessToken lives only in memory (15-min JWT, never persisted).
 * - _refreshToken is persisted in localStorage under "cadsa_refresh".
 * - On startup, initSession() exchanges the stored refresh token for a fresh
 *   access token BEFORE React renders, so no component ever sees a 401 on /me.
 * - Concurrent 401s share one in-flight refresh via _refreshPromise.
 * - If refresh fails mid-session, registerUnauthorizedHandler() callback fires
 *   (registered from main.tsx) to clear state and redirect to /login.
 */
import type {
  AlertHistory,
  AlertRule,
  AuthResponse,
  BandwidthResponse,
  BrowserStat,
  DeviceStat,
  Filters,
  GeoPoint,
  HostPatterns,
  HostSummary,
  IPDetailStats,
  IPProfile,
  IPStatus,
  LiveMetrics,
  LogSourcesResponse,
  LoginResponse,
  OSStat,
  OverviewStats,
  PathByStat,
  PerformanceResponse,
  RequestRow,
  RequestsPage,
  SecurityEventsPage,
  SlowPath,
  StatusCodeStat,
  SystemInfo,
  TimeseriesResponse,
  TopCity,
  TopCountry,
  TopIP,
  TopPath,
  ThreatIP,
  User,
} from "@/types";
import { type DateMode, modeToApiParam } from "@/lib/date-range";

const BASE = "/api/v1";

// ── Token state ───────────────────────────────────────────────────────────────

let _accessToken  = "";
let _refreshToken = localStorage.getItem("cadsa_refresh") ?? "";

// In-flight refresh promise — shared across all concurrent 401 retries so we
// never fire more than one /auth/refresh request at a time.
let _refreshPromise: Promise<boolean> | null = null;

// Registered from main.tsx — called when a refresh fails mid-session so the
// app can clear state and redirect to /login without api.ts knowing about
// React Router or Zustand (avoids circular imports).
let _onUnauthorized: (() => void) | null = null;

export function registerUnauthorizedHandler(cb: () => void): void {
  _onUnauthorized = cb;
}

export function setTokens(access: string, refresh: string): void {
  _accessToken  = access;
  _refreshToken = refresh;
  localStorage.setItem("cadsa_refresh", refresh);
}

export function clearTokens(): void {
  _accessToken  = "";
  _refreshToken = "";
  localStorage.removeItem("cadsa_refresh");
}

export function getAccessToken(): string {
  return _accessToken;
}

// ── Session bootstrap (called from main.tsx before first render) ───────────────

/**
 * Exchange the stored refresh token for a fresh access token.
 * Called once in main.tsx before React renders — this is the only place that
 * "wakes up" a returning user's session without any 401/retry dance.
 *
 * The unauthorized handler is suppressed during bootstrap because failures
 * here simply mean "no session" rather than "session expired mid-use".
 */
export async function initSession(): Promise<boolean> {
  if (!_refreshToken) return false;
  // Suppress the unauthorized redirect during init — a failure here just means
  // there is no valid session; the app renders the login page instead.
  const saved = _onUnauthorized;
  _onUnauthorized = null;
  const ok = await _doRefresh();
  _onUnauthorized = saved;
  return ok;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _doRefresh(): Promise<boolean> {
  if (!_refreshToken) return false;

  // If a refresh is already in flight, wait for it instead of making a second one.
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async (): Promise<boolean> => {
    try {
      const resp = await fetch(BASE + "/auth/refresh", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refresh_token: _refreshToken }),
      });
      if (!resp.ok) {
        clearTokens();
        return false;
      }
      const data = await resp.json();
      _accessToken = data.access_token;
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

async function _fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  let resp = await fetch(BASE + path, { ...options, headers });

  if (resp.status === 401 && _refreshToken) {
    // Access token expired — try to refresh once.
    const refreshed = await _doRefresh();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${_accessToken}`;
      resp = await fetch(BASE + path, { ...options, headers });
    } else {
      // Refresh failed → session is gone. Notify app to clear state + redirect.
      _onUnauthorized?.();
      throw new ApiError(401, "Session expired — please sign in again");
    }
  }

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new ApiError(resp.status, body.detail ?? "Request failed");
  }

  return resp.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (username: string, password: string) =>
    _fetch<LoginResponse>("/auth/login", {
      method: "POST",
      body:   JSON.stringify({ username, password }),
    }),

  login2fa: (partial_token: string, code: string) =>
    _fetch<AuthResponse>("/auth/login/2fa", {
      method: "POST",
      body:   JSON.stringify({ partial_token, code }),
    }),

  loginBackupCode: (partial_token: string, code: string) =>
    _fetch<AuthResponse>("/auth/login/backup-code", {
      method: "POST",
      body:   JSON.stringify({ partial_token, code }),
    }),

  refresh: (refresh_token: string) =>
    _fetch<{ access_token: string; token_type: string }>("/auth/refresh", {
      method: "POST",
      body:   JSON.stringify({ refresh_token }),
    }),

  logout: (refresh_token: string) =>
    _fetch<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      body:   JSON.stringify({ refresh_token }),
    }),

  changePassword: (current_password: string, new_password: string) =>
    _fetch<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body:   JSON.stringify({ current_password, new_password }),
    }),

  setup2fa: () =>
    _fetch<{ secret: string; provisioning_uri: string }>("/auth/2fa/setup"),

  confirm2fa: (code: string) =>
    _fetch<{ ok: boolean; backup_codes: string[] }>("/auth/2fa/confirm", {
      method: "POST",
      body:   JSON.stringify({ code }),
    }),

  me: () => _fetch<User>("/auth/me"),
};

// ── Analytics ────────────────────────────────────────────────────────────────

function buildParams(mode: DateMode, filters?: Filters, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  const [key, val] = modeToApiParam(mode).split("=");
  p.set(key, val);
  if (filters) {
    if (filters.host)         p.set("host",         filters.host);
    if (filters.remote_ip)    p.set("remote_ip",    filters.remote_ip);
    if (filters.method)       p.set("method",       filters.method);
    if (filters.status_class) p.set("status_class", filters.status_class);
    if (filters.path)         p.set("path",         filters.path);
    if (filters.country)      p.set("country_code", filters.country);
  }
  if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v));
  return `?${p}`;
}

export const analytics = {
  overview: (mode: DateMode, filters?: Filters) =>
    _fetch<OverviewStats>(`/analytics/overview${buildParams(mode, filters)}`),

  timeseries: (mode: DateMode, filters?: Filters) =>
    _fetch<TimeseriesResponse>(`/analytics/timeseries${buildParams(mode, filters)}`),

  topPaths: (mode: DateMode, filters?: Filters, limit = 20) =>
    _fetch<TopPath[]>(`/analytics/top-paths${buildParams(mode, filters, { limit: String(limit) })}`),

  topIPs: (mode: DateMode, filters?: Filters) =>
    _fetch<TopIP[]>(`/analytics/top-ips${buildParams(mode, filters)}`),

  topCountries: (mode: DateMode, filters?: Filters) =>
    _fetch<TopCountry[]>(`/analytics/top-countries${buildParams(mode, filters)}`),

  statusCodes: (mode: DateMode, filters?: Filters) =>
    _fetch<StatusCodeStat[]>(`/analytics/status-codes${buildParams(mode, filters)}`),

  performance: (mode: DateMode, filters?: Filters) =>
    _fetch<PerformanceResponse>(`/analytics/performance${buildParams(mode, filters)}`),

  bandwidth: (mode: DateMode, filters?: Filters) =>
    _fetch<BandwidthResponse>(`/analytics/bandwidth${buildParams(mode, filters)}`),

  browsers: (mode: DateMode, filters?: Filters) =>
    _fetch<BrowserStat[]>(`/analytics/browsers${buildParams(mode, filters)}`),

  devices: (mode: DateMode, filters?: Filters) =>
    _fetch<DeviceStat[]>(`/analytics/devices${buildParams(mode, filters)}`),

  referers: (mode: DateMode, filters?: Filters) =>
    _fetch<{ domain: string; req_count: number }[]>(`/analytics/referers${buildParams(mode, filters)}`),

  topCities: (mode: DateMode, filters?: Filters, limit = 30) =>
    _fetch<TopCity[]>(`/analytics/top-cities${buildParams(mode, filters, { limit: String(limit) })}`),

  os: (mode: DateMode, filters?: Filters) =>
    _fetch<OSStat[]>(`/analytics/os${buildParams(mode, filters)}`),

  hosts: (mode: DateMode) =>
    _fetch<HostSummary[]>(`/analytics/hosts${buildParams(mode)}`),

  geo: (mode: DateMode, filters?: Filters) =>
    _fetch<GeoPoint[]>(`/analytics/geo${buildParams(mode, filters)}`),

  requests: (params: {
    mode: DateMode;
    filters?: Filters;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_dir?: string;
  }) => {
    const p = new URLSearchParams();
    const [key, val] = modeToApiParam(params.mode).split("=");
    p.set(key, val);
    const f = params.filters;
    if (f) {
      if (f.host)         p.set("host",         f.host);
      if (f.remote_ip)    p.set("remote_ip",    f.remote_ip);
      if (f.method)       p.set("method",       f.method);
      if (f.status_class) p.set("status_class", f.status_class);
      if (f.path)         p.set("path",         f.path);
      if (f.country)      p.set("country_code", f.country);
    }
    if (params.page)     p.set("page",     String(params.page));
    if (params.limit)    p.set("limit",    String(params.limit));
    if (params.sort_by)  p.set("sort_by",  params.sort_by);
    if (params.sort_dir) p.set("sort_dir", params.sort_dir);
    return _fetch<RequestsPage>(`/analytics/requests?${p}`);
  },

  requestDetail: (id: number) =>
    _fetch<RequestRow>(`/analytics/requests/${id}`),

  ipDetail: (ip: string, mode: DateMode) =>
    _fetch<IPDetailStats>(`/analytics/ip/${ip}${buildParams(mode)}`),

  pathsByStatus: (mode: DateMode, filters?: Filters, limit = 30) =>
    _fetch<PathByStat[]>(`/analytics/paths-by-status${buildParams(mode, filters, { limit: String(limit) })}`),

  hostPatterns: (mode: DateMode, filters?: Filters) =>
    _fetch<HostPatterns>(`/analytics/host-patterns${buildParams(mode, filters)}`),

  slowestPaths: (mode: DateMode, filters?: Filters, limit = 20) =>
    _fetch<SlowPath[]>(`/analytics/slowest-paths${buildParams(mode, filters, { limit: String(limit) })}`),

  distinctCountries: (mode: DateMode, filters?: Filters) =>
    _fetch<{ code: string; name: string }[]>(`/analytics/distinct-countries${buildParams(mode, filters)}`),
};

// ── Security ─────────────────────────────────────────────────────────────────

export const security = {
  events: (params: { mode: DateMode; filters?: Filters; event_type?: string; severity?: string; page?: number }) => {
    const p = new URLSearchParams();
    const [key, val] = modeToApiParam(params.mode).split("=");
    p.set(key, val);
    const f = params.filters;
    if (f) {
      if (f.host)      p.set("host",      f.host);
      if (f.remote_ip) p.set("remote_ip", f.remote_ip);
    }
    if (params.event_type) p.set("event_type", params.event_type);
    if (params.severity)   p.set("severity",   params.severity);
    if (params.page)       p.set("page",       String(params.page));
    return _fetch<SecurityEventsPage>(`/security/events?${p}`);
  },

  topThreats: (mode: DateMode) =>
    _fetch<ThreatIP[]>(`/security/top-threats${buildParams(mode)}`),

  ipProfile: (ip: string, mode: DateMode) =>
    _fetch<IPProfile>(`/security/ip/${ip}${buildParams(mode)}`),

  whitelist: () =>
    _fetch<{ id: number; cidr: string; note: string }[]>("/security/whitelist"),

  addWhitelist: (cidr: string, note: string) =>
    _fetch<{ id: number; cidr: string }>("/security/whitelist", {
      method: "POST",
      body:   JSON.stringify({ cidr, note }),
    }),

  removeWhitelist: (id: number) =>
    _fetch<{ ok: boolean }>(`/security/whitelist/${id}`, { method: "DELETE" }),

  blocklist: () =>
    _fetch<{ id: number; cidr: string; note: string }[]>("/security/blocklist"),

  addBlocklist: (cidr: string, note: string) =>
    _fetch<{ id: number; cidr: string }>("/security/blocklist", {
      method: "POST",
      body:   JSON.stringify({ cidr, note }),
    }),

  removeBlocklist: (id: number) =>
    _fetch<{ ok: boolean }>(`/security/blocklist/${id}`, { method: "DELETE" }),

  ipStatus: (ip: string) =>
    _fetch<IPStatus>(`/security/ip/${encodeURIComponent(ip)}/status`),
};

// ── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = {
  rules: () => _fetch<AlertRule[]>("/alerts/rules"),
  createRule: (data: Omit<AlertRule, "id" | "last_triggered">) =>
    _fetch<AlertRule>("/alerts/rules", { method: "POST", body: JSON.stringify(data) }),
  updateRule: (id: number, data: Partial<AlertRule>) =>
    _fetch<{ ok: boolean }>(`/alerts/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRule: (id: number) =>
    _fetch<{ ok: boolean }>(`/alerts/rules/${id}`, { method: "DELETE" }),
  testRule: (id: number) =>
    _fetch<{ ok: boolean; notifiers_tested: string[] }>(`/alerts/rules/${id}/test`, { method: "POST" }),
  history: (limit = 100, offset = 0) =>
    _fetch<AlertHistory[]>(`/alerts/history?limit=${limit}&offset=${offset}`),
};

// ── Settings ─────────────────────────────────────────────────────────────────

export const settings = {
  get: () =>
    _fetch<{ settings: Record<string, string> }>("/settings/"),
  patch: (data: Record<string, unknown>) =>
    _fetch<{ ok: boolean }>("/settings/", { method: "PATCH", body: JSON.stringify({ data }) }),
  logSources: () =>
    _fetch<LogSourcesResponse>("/settings/log-sources"),
  testLogSource: (path: string) =>
    _fetch<{ ok: boolean; last_lines: string[] }>(
      `/settings/log-sources/${encodeURIComponent(path)}/test`,
      { method: "POST" },
    ),
  updateGeoIP: () =>
    _fetch<{ ok: boolean; size: number }>("/settings/geoip/update", { method: "POST" }),
  testEmail: () =>
    _fetch<{ ok: boolean }>("/settings/email/test", { method: "POST" }),
  testWebhook: () =>
    _fetch<{ ok: boolean }>("/settings/webhook/test", { method: "POST" }),
  system: () =>
    _fetch<SystemInfo>("/settings/system"),
};

// ── Live metrics (polling) ────────────────────────────────────────────────────

export const realtime = {
  live: () => _fetch<LiveMetrics>("/live"),
};
