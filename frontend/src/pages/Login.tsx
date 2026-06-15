import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* ── Schemas ────────────────────────────────────────────────────────────────── */

const loginSchema = z.object({
  username: z.string().min(1, "Username required"),
  password: z.string().min(1, "Password required"),
});

const backupSchema = z.object({
  code: z.string().min(8, "Backup codes are 8 characters"),
});

type LoginForm  = z.infer<typeof loginSchema>;
type BackupForm = z.infer<typeof backupSchema>;

/* ── Error banner ────────────────────────────────────────────────────────────── */

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
      <span className="mt-0.5 flex-shrink-0">⚠</span>
      <span>{message}</span>
    </div>
  );
}

/* ── TOTP digit boxes ────────────────────────────────────────────────────────── */

interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(raw);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.form?.requestSubmit();
  };

  return (
    <div className="flex justify-center">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        disabled={disabled}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={6}
        className={cn(
          "w-48 h-14 text-center text-2xl font-mono tracking-[0.5em] font-bold",
          "bg-muted/50 border border-border rounded-xl outline-none",
          "focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
          "transition-all placeholder:text-muted-foreground/30",
          "disabled:opacity-50",
        )}
        placeholder="──────"
      />
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────────── */

type Step = "credentials" | "totp" | "backup";

export default function Login() {
  const navigate = useNavigate();
  const { login, complete2fa, loginWithBackupCode, isLoading, error, clearError } = useAuthStore();

  const [step, setStep]               = useState<Step>("credentials");
  const [partialToken, setPartialToken] = useState("");
  const [showPw, setShowPw]           = useState(false);
  const [totpCode, setTotpCode]       = useState("");

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const backupForm = useForm<BackupForm>({ resolver: zodResolver(backupSchema) });

  const goBack = () => {
    clearError();
    setTotpCode("");
    setStep("credentials");
  };

  /* ── Handlers ── */

  const handleLogin = async (data: LoginForm) => {
    clearError();
    try {
      const result = await login(data.username, data.password);
      if (result.step === "2fa") {
        setPartialToken(result.partial_token);
        setStep("totp");
      } else {
        if (result.must_change_password) navigate("/change-password");
        else if (result.must_setup_2fa)  navigate("/setup-2fa");
        else                              navigate("/");
      }
    } catch { /* error in store */ }
  };

  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length < 6) return;
    clearError();
    try {
      const result = await complete2fa(partialToken, totpCode);
      if (result.must_change_password) navigate("/change-password");
      else                              navigate("/");
    } catch { /* error in store */ }
  };

  const handleBackup = async (data: BackupForm) => {
    clearError();
    try {
      const result = await loginWithBackupCode(partialToken, data.code);
      if (result.must_change_password) navigate("/change-password");
      else                              navigate("/");
    } catch { /* error in store */ }
  };

  /* ── Render ── */

  return (
    <AuthShell>
      {step === "credentials" && (
        <div className="p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-1">Enter your credentials to continue</p>
          </div>

          {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

          <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoFocus
                autoComplete="username"
                placeholder="admin"
                {...loginForm.register("username")}
              />
              {loginForm.formState.errors.username && (
                <p className="text-xs text-destructive">{loginForm.formState.errors.username.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  {...loginForm.register("password")}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPw((p) => !p)}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {loginForm.formState.errors.password && (
                <p className="text-xs text-destructive">{loginForm.formState.errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Signing in…</>
                : "Continue"}
            </Button>
          </form>
        </div>
      )}

      {step === "totp" && (
        <div className="p-8">
          <div className="flex items-start gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Two-step verification</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Open your authenticator app and enter the 6-digit code.
              </p>
            </div>
          </div>

          {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

          <form onSubmit={handleTotp} className="space-y-5">
            <OtpInput value={totpCode} onChange={setTotpCode} disabled={isLoading} />

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || totpCode.length < 6}
            >
              {isLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying…</>
                : "Verify"}
            </Button>
          </form>

          <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Back
            </button>
            <button
              type="button"
              onClick={() => { clearError(); setStep("backup"); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Use a backup code
            </button>
          </div>
        </div>
      )}

      {step === "backup" && (
        <div className="p-8">
          <div className="flex items-start gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <KeyRound className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Backup code</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Enter one of your saved backup codes. It will be consumed.
              </p>
            </div>
          </div>

          {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

          <form onSubmit={backupForm.handleSubmit(handleBackup)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Backup code</Label>
              <Input
                autoFocus
                className="font-mono tracking-widest text-center"
                placeholder="xxxxxxxx"
                {...backupForm.register("code")}
              />
              {backupForm.formState.errors.code && (
                <p className="text-xs text-destructive">{backupForm.formState.errors.code.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying…</>
                : "Sign in with backup code"}
            </Button>
          </form>

          <div className="mt-5 pt-4 border-t border-border">
            <button
              type="button"
              onClick={() => { clearError(); setStep("totp"); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Use authenticator app instead
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
