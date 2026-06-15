import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings as SettingsIcon, RefreshCw, CheckCircle, XCircle, Loader2,
  AlertTriangle, Save, Eye, EyeOff, Terminal, ChevronDown, ChevronUp,
} from "lucide-react";
import { settings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function Input({
  value, onChange, type = "text", placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full h-8 px-2.5 text-xs bg-muted/40 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
        className,
      )}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span className={cn(
        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0",
      )} />
    </button>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder} className="pr-8" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

type SaveStatus = "idle" | "saving" | "ok" | "error";

function SaveButton({ status, onClick }: { status: SaveStatus; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={status === "saving"}
      className={status === "ok" ? "border-green-500/40 text-green-400" : status === "error" ? "border-red-500/40 text-red-400" : ""}>
      {status === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {status === "ok"     && <CheckCircle className="w-3.5 h-3.5" />}
      {status === "error"  && <XCircle className="w-3.5 h-3.5" />}
      {status === "idle"   && <><Save className="w-3.5 h-3.5" /> Save</>}
    </Button>
  );
}

function TestButton({ label, fn }: { label: string; fn: () => Promise<unknown> }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const run = async () => {
    setStatus("loading");
    try { await fn(); setStatus("ok"); }
    catch { setStatus("error"); }
    setTimeout(() => setStatus("idle"), 3000);
  };
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={status === "loading"}>
      {status === "loading" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {status === "ok"      && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
      {status === "error"   && <XCircle className="w-3.5 h-3.5 text-red-400" />}
      {status === "idle" && label}
    </Button>
  );
}

// ── Log source test row ────────────────────────────────────────────────────────

function LogSourceRow({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function test() {
    setStatus("loading");
    try {
      const r = await settings.testLogSource(path);
      setLines(r.last_lines);
      setStatus("ok");
      setOpen(true);
    } catch {
      setStatus("error");
      setLines([]);
    }
    setTimeout(() => setStatus((s) => s === "error" ? "idle" : s), 3000);
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
        <code className="text-xs font-mono text-foreground flex-1 truncate">{path}</code>
        <Button variant="outline" size="sm" onClick={test} disabled={status === "loading"} className="flex-shrink-0">
          {status === "loading" && <Loader2 className="w-3 h-3 animate-spin" />}
          {status === "ok"      && <><Terminal className="w-3 h-3 text-green-400" /> Tail</>}
          {status === "error"   && <><XCircle className="w-3 h-3 text-red-400" /> Failed</>}
          {status === "idle"    && <><Terminal className="w-3 h-3" /> Test</>}
        </Button>
        {lines.length > 0 && (
          <button onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {open && lines.length > 0 && (
        <div className="border-t border-border bg-muted/20 px-3 py-2 space-y-1">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">Last 5 lines</p>
          {lines.map((l, i) => (
            <p key={i} className="text-[10px] font-mono text-foreground/80 truncate">{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const qc = useQueryClient();

  const { data: sysInfo }    = useQuery({ queryKey: ["system-info"],  queryFn: settings.system,     refetchInterval: 30_000 });
  const { data: logSources } = useQuery({ queryKey: ["log-sources"],  queryFn: settings.logSources, staleTime: 60_000 });
  const { data: stored }     = useQuery({ queryKey: ["app-settings"], queryFn: settings.get });

  const patch = useMutation({
    mutationFn: settings.patch,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });

  const updateGeoIP = useMutation({ mutationFn: settings.updateGeoIP });

  // ── Retention state ──
  const [ret, setRet] = useState<{ retention_days: string; agg_days: string } | null>(null);
  const [retStatus, setRetStatus] = useState<SaveStatus>("idle");

  const retVals = ret ?? {
    retention_days: stored?.settings.retention_days ?? "90",
    agg_days:       stored?.settings.aggregation_retention_days ?? "365",
  };

  async function saveRetention() {
    setRetStatus("saving");
    try {
      await patch.mutateAsync({ retention_days: retVals.retention_days, aggregation_retention_days: retVals.agg_days });
      setRetStatus("ok");
    } catch { setRetStatus("error"); }
    setTimeout(() => setRetStatus("idle"), 2500);
  }

  // ── Security thresholds state ──
  const [sec, setSec] = useState<{ rate: string; err: string; slow: string } | null>(null);
  const [secStatus, setSecStatus] = useState<SaveStatus>("idle");

  const secVals = sec ?? {
    rate: stored?.settings.rate_limit_threshold ?? "300",
    err:  stored?.settings.error_rate_threshold ?? "0.20",
    slow: stored?.settings.slow_request_threshold_ms ?? "2000",
  };

  async function saveThresholds() {
    setSecStatus("saving");
    try {
      await patch.mutateAsync({
        rate_limit_threshold:      secVals.rate,
        error_rate_threshold:      secVals.err,
        slow_request_threshold_ms: secVals.slow,
      });
      setSecStatus("ok");
    } catch { setSecStatus("error"); }
    setTimeout(() => setSecStatus("idle"), 2500);
  }

  // ── Email state ──
  const [email, setEmail] = useState<{
    enabled: boolean; host: string; port: string; user: string;
    password: string; from: string; to: string;
  } | null>(null);
  const [emailStatus, setEmailStatus] = useState<SaveStatus>("idle");

  const s = stored?.settings ?? {};
  const emailVals = email ?? {
    enabled:  s.email_enabled === "true",
    host:     s.smtp_host ?? "",
    port:     s.smtp_port ?? "587",
    user:     s.smtp_user ?? "",
    password: s.smtp_password ?? "",
    from:     s.email_from ?? "",
    to:       s.email_to ?? "",
  };

  async function saveEmail() {
    setEmailStatus("saving");
    try {
      await patch.mutateAsync({
        email_enabled:  String(emailVals.enabled),
        smtp_host:      emailVals.host,
        smtp_port:      emailVals.port,
        smtp_user:      emailVals.user,
        smtp_password:  emailVals.password,
        email_from:     emailVals.from,
        email_to:       emailVals.to,
      });
      setEmailStatus("ok");
    } catch { setEmailStatus("error"); }
    setTimeout(() => setEmailStatus("idle"), 2500);
  }

  // ── Webhook state ──
  const [wh, setWh] = useState<{ enabled: boolean; url: string; secret: string } | null>(null);
  const [whStatus, setWhStatus] = useState<SaveStatus>("idle");

  const whVals = wh ?? {
    enabled: s.webhook_enabled === "true",
    url:     s.webhook_url ?? "",
    secret:  s.webhook_secret ?? "",
  };

  async function saveWebhook() {
    setWhStatus("saving");
    try {
      await patch.mutateAsync({
        webhook_enabled: String(whVals.enabled),
        webhook_url:     whVals.url,
        webhook_secret:  whVals.secret,
      });
      setWhStatus("ok");
    } catch { setWhStatus("error"); }
    setTimeout(() => setWhStatus("idle"), 2500);
  }

  // ── Threat intel state ──
  const [ti, setTi] = useState<{ enabled: boolean; apiKey: string; cacheHours: string } | null>(null);
  const [tiStatus, setTiStatus] = useState<SaveStatus>("idle");

  const tiVals = ti ?? {
    enabled:    s.abuseipdb_enabled === "true",
    apiKey:     s.abuseipdb_api_key ?? "",
    cacheHours: s.abuseipdb_cache_hours ?? "24",
  };

  async function saveThreatIntel() {
    setTiStatus("saving");
    try {
      await patch.mutateAsync({
        abuseipdb_enabled:    String(tiVals.enabled),
        abuseipdb_api_key:    tiVals.apiKey,
        abuseipdb_cache_hours: tiVals.cacheHours,
      });
      setTiStatus("ok");
    } catch { setTiStatus("error"); }
    setTimeout(() => setTiStatus("idle"), 2500);
  }

  // ── Helper to update partial state ──
  function upd<T>(setter: React.Dispatch<React.SetStateAction<T | null>>, vals: T, patch_: Partial<T>) {
    setter({ ...vals, ...patch_ });
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2">
        <SettingsIcon className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        {/* Left column: System → Log Sources → GeoIP → Email */}
        <div className="space-y-5">

          {/* System Info */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">System</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Version",      value: sysInfo?.version ?? "—" },
                  { label: "Uptime",       value: sysInfo ? `${Math.floor(sysInfo.uptime_seconds / 3600)}h ${Math.floor((sysInfo.uptime_seconds % 3600) / 60)}m` : "—" },
                  { label: "Analytics DB", value: sysInfo ? formatBytes(sysInfo.db_sizes.analytics) : "—" },
                  { label: "App DB",       value: sysInfo ? formatBytes(sysInfo.db_sizes.app) : "—" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Log Sources */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Log Sources</CardTitle>
                {logSources?.success
                  ? <Badge variant="success" className="text-[10px]">{logSources.source}</Badge>
                  : <Badge variant="danger" className="text-[10px]">Discovery failed</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {logSources?.success ? (
                <>
                  <div className="space-y-2">
                    {logSources.log_files.map((f) => <LogSourceRow key={f} path={f} />)}
                  </div>

                  {logSources.skip_hosts.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5 font-medium">Hosts skipped (no Caddy logging configured):</p>
                      {logSources.skip_hosts.map((h) => (
                        <div key={h} className="flex items-center gap-2 py-0.5 text-xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                          <span className="text-muted-foreground font-mono">{h}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {Object.keys(logSources.logger_to_hosts).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5 font-medium">Logger → Host mapping:</p>
                      <div className="space-y-0.5 text-xs">
                        {Object.entries(logSources.logger_to_hosts).map(([logger, hosts]) => (
                          <div key={logger} className="flex gap-2">
                            <code className="text-primary w-16 shrink-0">{logger}</code>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-foreground">{(hosts as string[]).join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-red-400">No Caddy log files could be found automatically.</p>
                  <div className="space-y-1">
                    {logSources?.tried?.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{t}</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <p className="text-xs font-medium text-foreground mb-2">To fix this, choose one option:</p>
                    <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                      <li>Enable Caddy Admin API: add <code className="bg-muted px-1 rounded">{"{ admin localhost:2019 }"}</code> to your Caddyfile</li>
                      <li>Add manual log source in <code className="bg-muted px-1 rounded">/etc/cadsa/cadsa.yaml</code> under <code className="bg-muted px-1 rounded">logs.sources</code></li>
                      <li>Add <code className="bg-muted px-1 rounded">log {"{ output file /var/log/caddy/access.log }"}</code> to your site blocks</li>
                    </ol>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* GeoIP — bottom of left column */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">GeoIP Database</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <div>
                {sysInfo?.geoip?.modified && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: <span className="text-foreground">{new Date(sysInfo.geoip.modified).toLocaleDateString()}</span>
                    {sysInfo.geoip.size && <span className="ml-1">({formatBytes(sysInfo.geoip.size)})</span>}
                  </p>
                )}
                {sysInfo?.geoip?.available === false && (
                  <p className="text-xs text-yellow-400">GeoIP not found — download to enable geo analytics</p>
                )}
                {updateGeoIP.isSuccess && <p className="text-xs text-green-400 mt-1">Updated successfully.</p>}
                {updateGeoIP.isError && (
                  <p className="text-xs text-red-400 mt-1">Update failed: {(updateGeoIP.error as Error)?.message}</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => updateGeoIP.mutate()} disabled={updateGeoIP.isPending} className="flex-shrink-0">
                {updateGeoIP.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Updating...</>
                  : <><RefreshCw className="w-3.5 h-3.5" /> Update GeoIP</>}
              </Button>
            </CardContent>
          </Card>

          {/* Email — bottom of left column */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm">Email Notifications</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Toggle checked={emailVals.enabled} onChange={(v) => upd(setEmail, emailVals, { enabled: v })} />
                    <span>{emailVals.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TestButton label="Send Test" fn={settings.testEmail} />
                  <SaveButton status={emailStatus} onClick={saveEmail} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="SMTP Host">
                <Input value={emailVals.host} onChange={(v) => upd(setEmail, emailVals, { host: v })} placeholder="smtp.example.com" />
              </Field>
              <Field label="SMTP Port">
                <Input type="number" value={emailVals.port} onChange={(v) => upd(setEmail, emailVals, { port: v })} placeholder="587" />
              </Field>
              <Field label="SMTP Username">
                <Input value={emailVals.user} onChange={(v) => upd(setEmail, emailVals, { user: v })} placeholder="alerts@example.com" />
              </Field>
              <Field label="SMTP Password">
                <PasswordInput value={emailVals.password} onChange={(v) => upd(setEmail, emailVals, { password: v })} placeholder="••••••••" />
              </Field>
              <Field label="From Address">
                <Input value={emailVals.from} onChange={(v) => upd(setEmail, emailVals, { from: v })} placeholder="cadsa@example.com" />
              </Field>
              <Field label="To Address(es)" hint="Comma-separated for multiple recipients.">
                <Input value={emailVals.to} onChange={(v) => upd(setEmail, emailVals, { to: v })} placeholder="admin@example.com" />
              </Field>
            </CardContent>
          </Card>

        </div>{/* /left column */}

        {/* Right column: Retention → Thresholds → Webhook → Threat Intel */}
        <div className="space-y-5">

          {/* Data Retention */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Data Retention</CardTitle>
                <SaveButton status={retStatus} onClick={saveRetention} />
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Raw Requests (days)" hint="Individual request rows. Older rows are deleted.">
                <Input
                  type="number"
                  value={retVals.retention_days}
                  onChange={(v) => upd(setRet, retVals, { retention_days: v })}
                  placeholder="90"
                />
              </Field>
              <Field label="Aggregated Stats (days)" hint="Hourly/daily summaries. Can be kept much longer.">
                <Input
                  type="number"
                  value={retVals.agg_days}
                  onChange={(v) => upd(setRet, retVals, { agg_days: v })}
                  placeholder="365"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Security Thresholds */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Security Thresholds</CardTitle>
                <SaveButton status={secStatus} onClick={saveThresholds} />
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Rate Limit" hint="Req/min per IP.">
                <Input
                  type="number"
                  value={secVals.rate}
                  onChange={(v) => upd(setSec, secVals, { rate: v })}
                  placeholder="300"
                />
              </Field>
              <Field label="Error Rate" hint="Fraction 0.0–1.0.">
                <Input
                  type="number"
                  value={secVals.err}
                  onChange={(v) => upd(setSec, secVals, { err: v })}
                  placeholder="0.20"
                />
              </Field>
              <Field label="Slow Request (ms)" hint="P95 threshold.">
                <Input
                  type="number"
                  value={secVals.slow}
                  onChange={(v) => upd(setSec, secVals, { slow: v })}
                  placeholder="2000"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Webhook */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm">Webhook</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Toggle checked={whVals.enabled} onChange={(v) => upd(setWh, whVals, { enabled: v })} />
                    <span>{whVals.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TestButton label="Send Test" fn={settings.testWebhook} />
                  <SaveButton status={whStatus} onClick={saveWebhook} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Webhook URL" hint="POST request with JSON payload on every alert.">
                <Input value={whVals.url} onChange={(v) => upd(setWh, whVals, { url: v })} placeholder="https://hooks.example.com/..." />
              </Field>
              <Field label="HMAC Secret" hint="Optional. Signs requests with X-Cadsa-Signature header.">
                <PasswordInput value={whVals.secret} onChange={(v) => upd(setWh, whVals, { secret: v })} placeholder="leave blank to disable signing" />
              </Field>
            </CardContent>
          </Card>

          {/* Threat Intel */}
          <Card className="card-elevated">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm">Threat Intel (AbuseIPDB)</CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Toggle checked={tiVals.enabled} onChange={(v) => upd(setTi, tiVals, { enabled: v })} />
                    <span>{tiVals.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
                <SaveButton status={tiStatus} onClick={saveThreatIntel} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="AbuseIPDB API Key" hint="Free tier at abuseipdb.com. Enriches IP threat scores.">
                <PasswordInput value={tiVals.apiKey} onChange={(v) => upd(setTi, tiVals, { apiKey: v })} placeholder="Your API key" />
              </Field>
              <Field label="Cache Duration (hours)" hint="How long to cache results before re-checking.">
                <Input type="number" value={tiVals.cacheHours} onChange={(v) => upd(setTi, tiVals, { cacheHours: v })} placeholder="24" />
              </Field>
            </CardContent>
          </Card>

        </div>{/* /right column */}

      </div>
    </div>
  );
}
