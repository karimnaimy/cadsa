import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App";
import { applyTheme } from "@/stores/theme";
import { auth, initSession, clearTokens, registerUnauthorizedHandler } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

// Apply saved theme before first paint to avoid flash
const stored = (() => {
  try {
    const raw = localStorage.getItem("cadsa-theme");
    return raw ? (JSON.parse(raw)?.state?.mode ?? "system") : "system";
  } catch {
    return "system";
  }
})();
applyTheme(stored);

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const raw = localStorage.getItem("cadsa-theme");
  const mode = raw ? (JSON.parse(raw)?.state?.mode ?? "system") : "system";
  if (mode === "system") applyTheme("system");
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// When a mid-session API call returns 401 and refresh fails, wipe all session
// state and hard-redirect to /login. api.ts calls this via the registered
// callback so it doesn't need to import Zustand or React Router.
registerUnauthorizedHandler(() => {
  clearTokens();
  localStorage.removeItem("cadsa-auth");
  useAuthStore.setState({ user: null, accessToken: "", refreshToken: "" });
  window.location.replace("/login");
});

async function bootstrap() {
  const ok = await initSession();
  if (ok) {
    try {
      const user = await auth.me();
      useAuthStore.setState({ user });
    } catch {
      // Access token was valid but /me failed — treat as no session.
      clearTokens();
      localStorage.removeItem("cadsa-auth");
      useAuthStore.setState({ user: null, accessToken: "", refreshToken: "" });
    }
  } else {
    // No stored refresh token, or it's expired — start clean.
    clearTokens();
    useAuthStore.setState({ user: null, accessToken: "", refreshToken: "" });
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

bootstrap();
