// All TypeScript types for cadsa — mirroring the Python Pydantic models

export interface User {
  id: number;
  username: string;
  email?: string;
  must_change_password: boolean;
  totp_confirmed: boolean;
  last_login?: string;
}

export interface LoginResponse {
  requires_2fa?: boolean;
  requires_password_change?: boolean;
  partial_token?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  must_setup_2fa?: boolean;
  must_change_password?: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  must_change_password?: boolean;
  must_setup_2fa?: boolean;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface OverviewStats {
  total_requests: number;
  unique_ips: number;
  bytes_out: number;
  bytes_in: number;
  error_rate: number;
  p50_ms: number;
  p95_ms?: number;
  req_2xx: number;
  req_3xx: number;
  req_4xx: number;
  req_5xx: number;
}

export interface TimeseriesPoint {
  ts: string;
  req_count: number;
  req_2xx: number;
  req_3xx: number;
  req_4xx: number;
  req_5xx: number;
  bytes_out: number;
  bytes_in: number;
  p50_ms: number;
  unique_ips: number;
}

export interface TimeseriesResponse {
  granularity: string;
  data: TimeseriesPoint[];
}

export interface PerformanceResponse {
  granularity: string;
  data: PerformancePoint[];
}

export interface BandwidthPoint {
  ts: string;
  bytes_out: number;
  bytes_in: number;
}

export interface BandwidthResponse {
  granularity: string;
  data: BandwidthPoint[];
}

export interface TopPath {
  path: string;
  req_count: number;
  avg_ms: number;
  bytes_out: number;
}

export interface TopIP {
  remote_ip: string;
  req_count: number;
  error_rate: number;
  threat_score: number;
  country_code?: string;
  country_name?: string;
  last_seen?: string;
}

export interface TopCountry {
  country_code: string;
  country_name?: string;
  req_count: number;
  unique_ips: number;
  error_rate: number;
  bytes_out: number;
}

export interface PerformancePoint {
  ts: string;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface RequestRow {
  id: number;
  ts: string;
  host: string;
  remote_ip: string;
  method?: string;
  uri?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  response_bytes?: number;
  request_bytes?: number;
  user_agent?: string;
  ua_browser?: string;
  ua_os?: string;
  ua_device?: string;
  country_code?: string;
  country_name?: string;
  city?: string;
  referer?: string;
  tls_version?: string;
  tls_cipher?: string;
  http_proto?: string;
  is_bot: boolean;
  threat_score: number;
  status_class?: string;
}

export interface RequestsPage {
  total: number;
  page: number;
  limit: number;
  data: RequestRow[];
}

export interface HostSummary {
  host: string;
  req_count: number;
  unique_ips: number;
  error_rate: number;
  p50_ms: number;
  bytes_out: number;
  last_seen?: string;
}

export interface GeoPoint {
  country_code: string;
  country_name?: string;
  lat: number;
  lon: number;
  req_count: number;
  unique_ips: number;
}

export interface BrowserStat {
  browser: string;
  req_count: number;
}

export interface DeviceStat {
  device: string;
  req_count: number;
}

export interface OSStat {
  os: string;
  req_count: number;
}

export interface TopCity {
  city: string;
  country_name: string;
  country_code: string;
  req_count: number;
  unique_ips: number;
}

export interface StatusCodeStat {
  status: number;
  req_count: number;
}

// ── Security ─────────────────────────────────────────────────────────────────

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface SecurityEvent {
  id: number;
  ts: string;
  event_type: string;
  severity: Severity;
  remote_ip?: string;
  host?: string;
  uri?: string;
  details: Record<string, unknown>;
  alert_sent: boolean;
}

export interface SecurityEventsPage {
  total: number;
  page: number;
  limit: number;
  data: SecurityEvent[];
}

export interface ThreatIP {
  remote_ip: string;
  event_count: number;
  max_score: number;
  country_code?: string;
  first_seen?: string;
  last_seen?: string;
}

export interface IPProfile {
  remote_ip: string;
  req_count: number;
  hosts_count: number;
  error_rate: number;
  max_threat: number;
  country_code?: string;
  country_name?: string;
  city?: string;
  org?: string;
  asn?: number;
  first_seen?: string;
  last_seen?: string;
  browser?: string;
  os?: string;
  top_paths: { path: string; count: number }[];
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export type RuleType = "threshold" | "anomaly" | "pattern";

export interface AlertRule {
  id: number;
  name: string;
  enabled: boolean;
  rule_type: RuleType;
  conditions: Record<string, unknown>;
  cooldown_minutes: number;
  last_triggered?: string;
  notifiers: string[];
}

export interface AlertHistory {
  id: number;
  rule_id: number;
  rule_name?: string;
  triggered_at: string;
  resolved_at?: string;
  details: Record<string, unknown>;
}

// ── Real-time WebSocket ───────────────────────────────────────────────────────

export interface LiveMetrics {
  req_count:  number;
  rps:        number;   // total req/s in rolling window
  rps_2xx:    number;   // 2xx/s
  rps_3xx:    number;
  rps_4xx:    number;
  rps_5xx:    number;
  error_rate: number;   // 0–1 fraction
  unique_ips: number;
  p50_ms:     number;
  bytes_out:  number;
  bytes_in:   number;
  // Absolute counts in window (for KPI tiles)
  req_2xx:    number;
  req_3xx:    number;
  req_4xx:    number;
  req_5xx:    number;
}

export type WSMessage =
  | { type: "new_request"; data: RequestRow }
  | { type: "metrics_update"; data: LiveMetrics }
  | { type: "security_event"; data: SecurityEvent }
  | { type: "replay"; data: RequestRow[] }
  | { type: "ping" };

export type WSClientMessage =
  | { type: "pong" }
  | { type: "filter"; host?: string; status_class?: string }
  | { type: "subscribe"; topics: ("requests" | "metrics" | "security")[] };

// ── Settings / discovery ──────────────────────────────────────────────────────

export interface LogSourcesResponse {
  success: boolean;
  log_files: string[];
  logger_to_hosts: Record<string, string[]>;
  skip_hosts: string[];
  source: string;
  tried: string[];
}

export interface SystemInfo {
  version: string;
  uptime_seconds: number;
  db_sizes: { analytics: number; app: number };
  geoip: { size?: number; modified?: string; available?: boolean };
  log_files: string[];
}

// ── Per-path status breakdown ─────────────────────────────────────────────────

export interface PathByStat {
  path: string;
  total: number;
  req_2xx: number;
  req_3xx: number;
  req_4xx: number;
  req_5xx: number;
  avg_ms: number;
  bytes_out: number;
}

export interface IPHourStat {
  hour: number;
  req_count: number;
  err_count: number;
}

export interface IPUASummary {
  browser: string | null;
  os: string | null;
  tls_version: string | null;
  http_proto: string | null;
  is_bot_pct: number;
  tls_resumed_pct: number | null;
  sample_ua: string | null;
}

export interface IPResponseSummary {
  avg_ms: number;
  p95_ms: number;
  total_bytes_in: number;
  total_bytes_out: number;
}

// Extended IP analytics (new backend endpoint /analytics/ip/:ip)
export interface IPDetailStats {
  hosts_accessed: { host: string; req_count: number; error_rate: number }[];
  timeline: TimeseriesPoint[];
  methods: { method: string; count: number }[];
  status_codes: StatusCodeStat[];
  busy_hours: IPHourStat[];
  ua_summary: IPUASummary;
  response_summary: IPResponseSummary;
}

export interface HostHourStat {
  hour: number;
  dow: number;  // 0=Sunday … 6=Saturday
  req_count: number;
}

export interface HostPatterns {
  busy_hours: HostHourStat[];
  protocol_breakdown: { protocol: string; req_count: number }[];
  bot_pct: number;
  bot_count: number;
  top_referers: { domain: string; req_count: number }[];
}

export interface SlowPath {
  path: string;
  req_count: number;
  p50_ms: number;
  p95_ms: number;
  avg_ms: number;
}

// ── IP Status ─────────────────────────────────────────────────────────────────

export interface IPStatusEntry {
  id: number;
  cidr: string;
  note: string;
  is_individual: boolean;
}

export interface IPStatus {
  ip: string;
  whitelisted: boolean;
  whitelist_entry: IPStatusEntry | null;
  blocked: boolean;
  block_entry: IPStatusEntry | null;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type FilterKey = "host" | "remote_ip" | "method" | "status_class" | "path" | "country";

export interface Filters {
  host?: string;
  remote_ip?: string;
  method?: string;
  status_class?: string;
  path?: string;
  /** ISO 3166-1 alpha-2 country code — mapped to country_code on the API */
  country?: string;
}

// ── Common ────────────────────────────────────────────────────────────────────

export type Granularity = "minute" | "hour" | "day";

export interface DateRange {
  from: Date;
  to: Date;
}
