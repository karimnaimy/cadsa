import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Loader2, Copy, Check, ShieldCheck, AlertCircle, Download,
} from "lucide-react";
import { auth } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

/* ── Step indicator ─────────────────────────────────────────────────────────── */

const STEPS = ["Scan QR code", "Verify", "Save backup codes"] as const;
type StepId = "scan" | "verify" | "backup";
const STEP_ORDER: StepId[] = ["scan", "verify", "backup"];

function StepIndicator({ current }: { current: StepId }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((label, i) => {
        const done    = i < idx;
        const active  = i === idx;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-colors",
              done   ? "bg-emerald-500 text-white"  :
              active ? "bg-primary text-primary-foreground" :
                       "bg-muted text-muted-foreground",
            )}>
              {done ? <Check className="w-3 h-3" /> : i + 1}
            </div>
            <span className={cn(
              "text-xs hidden sm:block",
              active ? "text-foreground font-medium" : "text-muted-foreground",
            )}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn(
                "w-6 h-px mx-1 flex-shrink-0",
                done ? "bg-emerald-500/60" : "bg-border",
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Copy button ─────────────────────────────────────────────────────────────── */

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all",
        copied
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/40",
      )}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

/* ── OTP input ───────────────────────────────────────────────────────────────── */

function OtpInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      disabled={disabled}
      value={value}
      maxLength={6}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className={cn(
        "w-full h-14 text-center text-2xl font-mono tracking-[0.5em] font-bold",
        "bg-muted/50 border border-border rounded-xl outline-none",
        "focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
        "placeholder:text-muted-foreground/30 transition-all",
        "disabled:opacity-50",
      )}
      placeholder="──────"
    />
  );
}

/* ── Page ────────────────────────────────────────────────────────────────────── */

export default function Setup2FA() {
  const navigate      = useNavigate();
  const { loadUser }  = useAuthStore();
  const [step, setStep]           = useState<StepId>("scan");
  const [code, setCode]           = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const { data: setupData, isLoading: setupLoading, error: setupError } = useQuery({
    queryKey: ["2fa-setup"],
    queryFn:  () => auth.setup2fa(),
    staleTime: Infinity,  // don't refetch — regenerating invalidates the QR code
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: (c: string) => auth.confirm2fa(c),
    onSuccess: (data) => {
      setBackupCodes(data.backup_codes);
      setVerifyError("");
      setStep("backup");
    },
    onError: (err) => {
      setVerifyError(err instanceof Error ? err.message : "Invalid code — try again");
      setCode("");
    },
  });

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6 || confirm.isPending) return;
    setVerifyError("");
    confirm.mutate(code);
  };

  const handleDone = async () => {
    await loadUser();
    navigate("/");
  };

  const backupText = backupCodes.join("\n");

  const downloadBackup = () => {
    const blob = new Blob([backupText], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "cadsa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (setupLoading) {
    return (
      <AuthShell maxWidth="max-w-md">
        <div className="p-12 flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }

  if (setupError) {
    return (
      <AuthShell maxWidth="max-w-md">
        <div className="p-8 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            Failed to load 2FA setup. Please refresh the page.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidth="max-w-md">
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Set up two-factor authentication</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6 ml-11">
          2FA is required to access CADSA.
        </p>

        <StepIndicator current={step} />

        {/* ── Step 1: Scan ── */}
        {step === "scan" && setupData && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Scan the QR code below with <span className="text-foreground font-medium">Google Authenticator</span>,{" "}
              <span className="text-foreground font-medium">Authy</span>, or any TOTP app.
            </p>

            {/* QR code */}
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-xl shadow-sm">
                <QRCodeSVG
                  value={setupData.provisioning_uri}
                  size={176}
                  level="M"
                />
              </div>
            </div>

            {/* Manual key */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Can't scan? Enter this key manually:
              </p>
              <div className="flex items-center gap-2 p-3 bg-muted/50 border border-border rounded-xl">
                <code className="flex-1 text-xs font-mono text-foreground break-all leading-relaxed">
                  {setupData.secret.match(/.{1,4}/g)?.join(" ")}
                </code>
                <CopyButton text={setupData.secret} />
              </div>
            </div>

            <Button onClick={() => setStep("verify")} className="w-full">
              I've added the account — Next
            </Button>
          </div>
        )}

        {/* ── Step 2: Verify ── */}
        {step === "verify" && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code your app is showing right now to confirm the setup worked.
            </p>

            {verifyError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {verifyError}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <OtpInput value={code} onChange={setCode} disabled={confirm.isPending} />

              <Button
                type="submit"
                className="w-full"
                disabled={confirm.isPending || code.length < 6}
              >
                {confirm.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying…</>
                  : "Verify & enable 2FA"}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => setStep("scan")}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              ← Back to QR code
            </button>
          </div>
        )}

        {/* ── Step 3: Backup codes ── */}
        {step === "backup" && (
          <div className="space-y-5">
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="text-sm text-emerald-400 font-medium">2FA enabled successfully!</span>
            </div>

            <p className="text-sm text-muted-foreground">
              Save these backup codes somewhere safe — each can be used once if you lose access to your authenticator app.
            </p>

            {/* Backup codes grid */}
            <div className="bg-muted/50 border border-border rounded-xl p-4">
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground/50 tabular w-3 flex-shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <code className="text-sm font-mono text-foreground tracking-widest">{c}</code>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <CopyButton text={backupText} label="Copy all" />
              <button
                type="button"
                onClick={downloadBackup}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/40 transition-all"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
            </div>

            <Button onClick={handleDone} className="w-full">
              I've saved my backup codes — Continue
            </Button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
