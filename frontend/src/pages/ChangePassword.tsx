import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff, Check, X } from "lucide-react";
import { auth } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    current_password: z.string().min(1, "Required"),
    new_password: z
      .string()
      .min(12, "At least 12 characters")
      .regex(/[A-Z]/, "Must contain an uppercase letter")
      .regex(/[0-9]/, "Must contain a digit"),
    confirm: z.string(),
  })
  .refine((d) => d.new_password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type Form = z.infer<typeof schema>;

interface Req { label: string; met: boolean }

function PasswordRequirements({ password }: { password: string }) {
  const reqs: Req[] = [
    { label: "At least 12 characters", met: password.length >= 12 },
    { label: "One uppercase letter",   met: /[A-Z]/.test(password) },
    { label: "One digit",              met: /[0-9]/.test(password) },
  ];

  if (!password) return null;

  return (
    <ul className="mt-2 space-y-1">
      {reqs.map((r) => (
        <li key={r.label} className={cn("flex items-center gap-1.5 text-xs", r.met ? "text-emerald-400" : "text-muted-foreground")}>
          {r.met
            ? <Check className="w-3 h-3 flex-shrink-0" />
            : <X className="w-3 h-3 flex-shrink-0" />}
          {r.label}
        </li>
      ))}
    </ul>
  );
}

function PasswordField({
  id, label, placeholder, registration, error, autoComplete,
}: {
  id: string;
  label: string;
  placeholder?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registration: any;
  error?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          {...(registration as object)}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function ChangePassword() {
  const navigate  = useNavigate();
  const { loadUser } = useAuthStore();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  const newPassword = watch("new_password") ?? "";

  const onSubmit = async (data: Form) => {
    setServerError("");
    try {
      await auth.changePassword(data.current_password, data.new_password);
      await loadUser();
      // Navigate based on current user state after reload
      const user = useAuthStore.getState().user;
      if (!user?.totp_confirmed) navigate("/setup-2fa");
      else                        navigate("/");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to change password");
    }
  };

  return (
    <AuthShell>
      <div className="p-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground">Change password</h2>
          <p className="text-sm text-muted-foreground mt-1">
            You must set a new password before continuing.
          </p>
        </div>

        {serverError && (
          <div className="mb-4 flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            <span className="mt-0.5 flex-shrink-0">⚠</span>
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <PasswordField
            id="current_password"
            label="Current password"
            placeholder="••••••••••••"
            autoComplete="current-password"
            registration={register("current_password")}
            error={errors.current_password?.message}
          />

          <div>
            <PasswordField
              id="new_password"
              label="New password"
              placeholder="••••••••••••"
              autoComplete="new-password"
              registration={register("new_password")}
              error={errors.new_password?.message}
            />
            <PasswordRequirements password={newPassword} />
          </div>

          <PasswordField
            id="confirm"
            label="Confirm new password"
            placeholder="••••••••••••"
            autoComplete="new-password"
            registration={register("confirm")}
            error={errors.confirm?.message}
          />

          <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
            {isSubmitting
              ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              : "Change password"}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
