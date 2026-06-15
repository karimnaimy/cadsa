import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";
import { auth, clearTokens, setTokens } from "@/lib/api";

interface AuthState {
  user: User | null;
  accessToken: string;
  refreshToken: string;
  isLoading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<LoginStep>;
  complete2fa: (partial_token: string, code: string) => Promise<{ must_change_password: boolean }>;
  loginWithBackupCode: (partial_token: string, code: string) => Promise<{ must_change_password: boolean }>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

export type LoginStep =
  | { step: "2fa"; partial_token: string; requires_password_change: boolean }
  | { step: "done"; must_setup_2fa: boolean; must_change_password: boolean };

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: "",
      refreshToken: "",
      isLoading: false,
      error: null,

      login: async (username, password): Promise<LoginStep> => {
        set({ isLoading: true, error: null });
        try {
          const resp = await auth.login(username, password);
          // No 2FA configured — backend issued full tokens directly
          if (resp.access_token) {
            const at = resp.access_token;
            const rt = resp.refresh_token ?? "";
            setTokens(at, rt);
            set({ accessToken: at, refreshToken: rt });
            await get().loadUser();
            set({ isLoading: false });
            return {
              step: "done",
              must_setup_2fa: resp.must_setup_2fa ?? false,
              must_change_password: resp.must_change_password ?? false,
            };
          }
          set({ isLoading: false });
          return {
            step: "2fa",
            partial_token: resp.partial_token ?? "",
            requires_password_change: resp.requires_password_change ?? false,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Login failed";
          set({ isLoading: false, error: msg });
          throw err;
        }
      },

      complete2fa: async (partial_token, code) => {
        set({ isLoading: true, error: null });
        try {
          const resp = await auth.login2fa(partial_token, code);
          setTokens(resp.access_token, resp.refresh_token);
          set({ accessToken: resp.access_token, refreshToken: resp.refresh_token });
          await get().loadUser();
          set({ isLoading: false });
          return { must_change_password: resp.must_change_password ?? false };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "2FA failed";
          set({ isLoading: false, error: msg });
          throw err;
        }
      },

      loginWithBackupCode: async (partial_token, code) => {
        set({ isLoading: true, error: null });
        try {
          const resp = await auth.loginBackupCode(partial_token, code);
          setTokens(resp.access_token, resp.refresh_token ?? "");
          set({ accessToken: resp.access_token, refreshToken: resp.refresh_token ?? "" });
          await get().loadUser();
          set({ isLoading: false });
          return { must_change_password: resp.must_change_password ?? false };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Invalid backup code";
          set({ isLoading: false, error: msg });
          throw err;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          if (refreshToken) await auth.logout(refreshToken);
        } catch {
          // best-effort
        }
        clearTokens();
        set({ user: null, accessToken: "", refreshToken: "" });
      },

      setUser: (user) => set({ user }),

      loadUser: async () => {
        try {
          const user = await auth.me();
          set({ user });
        } catch {
          set({ user: null });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: "cadsa-auth",
      partialize: (s) => ({ refreshToken: s.refreshToken }),
    },
  ),
);
