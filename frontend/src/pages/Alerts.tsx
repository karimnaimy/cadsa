import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, FlaskConical, Loader2 } from "lucide-react";
import { alerts as alertsApi } from "@/lib/api";
import type { AlertRule } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Alerts() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", rule_type: "threshold", metric: "error_rate", threshold: "0.2", cooldown_minutes: 30, notifiers: [] as string[] });

  const { data: rules } = useQuery({ queryKey: ["alert-rules"], queryFn: alertsApi.rules });
  const { data: history } = useQuery({ queryKey: ["alert-history"], queryFn: () => alertsApi.history() });

  const createRule = useMutation({
    mutationFn: () =>
      alertsApi.createRule({
        name: form.name,
        rule_type: form.rule_type as AlertRule["rule_type"],
        enabled: true,
        conditions: { metric: form.metric, threshold: Number(form.threshold) },
        cooldown_minutes: form.cooldown_minutes,
        notifiers: form.notifiers,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alert-rules"] }); setCreating(false); },
  });

  const deleteRule = useMutation({
    mutationFn: (id: number) => alertsApi.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      alertsApi.updateRule(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  const testRule = useMutation({
    mutationFn: (id: number) => alertsApi.testRule(id),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Alerts</h1>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" /> New Rule
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <Card>
          <CardHeader><CardTitle>New Alert Rule</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Name</label>
                <input
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Alert name..."
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Metric</label>
                <select
                  className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground"
                  value={form.metric}
                  onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
                >
                  {["error_rate", "request_rate", "latency_p95", "bandwidth"].map((m) => (
                    <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Threshold</label>
                <input
                  type="number"
                  step="0.01"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.threshold}
                  onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Cooldown (min)</label>
                <input
                  type="number"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.cooldown_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, cooldown_minutes: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createRule.mutate()} disabled={createRule.isPending || !form.name}>
                {createRule.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules list */}
      <Card>
        <CardHeader><CardTitle>Alert Rules</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Name", "Type", "Conditions", "Cooldown", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rules ?? []).map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-accent/20">
                  <td className="px-4 py-2.5 text-foreground font-medium">{r.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.rule_type}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">
                    {typeof r.conditions === "object"
                      ? Object.entries(r.conditions).map(([k, v]) => `${k}: ${v}`).join(", ")
                      : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.cooldown_minutes}m</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleRule.mutate({ id: r.id, enabled: !r.enabled })}
                      className="text-xs"
                    >
                      <Badge variant={r.enabled ? "success" : "default"}>
                        {r.enabled ? "active" : "disabled"}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm"
                        onClick={() => testRule.mutate(r.id)}
                        title="Test"
                        disabled={testRule.isPending}
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm"
                        onClick={() => deleteRule.mutate(r.id)}
                        className="hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rules?.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No alert rules configured</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader><CardTitle>Alert History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Time", "Rule", "Details"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id} className="border-b border-border/50 hover:bg-accent/20">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs">
                    {new Date(h.triggered_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-foreground">{h.rule_name ?? `Rule #${h.rule_id}`}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs font-mono">
                    {typeof h.details === "object"
                      ? Object.entries(h.details).map(([k, v]) => `${k}: ${v}`).join(", ")
                      : "-"}
                  </td>
                </tr>
              ))}
              {!history?.length && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No alerts triggered yet</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
