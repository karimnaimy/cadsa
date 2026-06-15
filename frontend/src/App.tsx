import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import Layout from "@/components/layout/Layout";
import Login from "@/pages/Login";
import Setup2FA from "@/pages/Setup2FA";
import ChangePassword from "@/pages/ChangePassword";
import Dashboard from "@/pages/Dashboard";
import RealTime from "@/pages/RealTime";
import Requests from "@/pages/Requests";
import Analytics from "@/pages/Analytics";
import Security from "@/pages/Security";
import Hosts from "@/pages/Hosts";
import HostDetail from "@/pages/HostDetail";
import IPDetail from "@/pages/IPDetail";
import Geo from "@/pages/Geo";
import Alerts from "@/pages/Alerts";
import Settings from "@/pages/Settings";

// Redirects fully-authenticated users away from the login page.
function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user?.totp_confirmed && !user?.must_change_password) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// Guards /setup-2fa: requires a session; bounces away if 2FA is already done.
function Setup2FAGate({ children }: { children: React.ReactNode }) {
  const { user, refreshToken } = useAuthStore();
  if (!refreshToken) return <Navigate to="/login" replace />;
  if (user?.totp_confirmed && !user?.must_change_password) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// Guards /change-password: requires a session but no other restrictions.
function ChangePasswordGate({ children }: { children: React.ReactNode }) {
  const { refreshToken } = useAuthStore();
  if (!refreshToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Guards all app routes: requires a session and a completed onboarding flow.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, refreshToken } = useAuthStore();
  if (!refreshToken) return <Navigate to="/login" replace />;
  if (user?.must_change_password) return <Navigate to="/change-password" replace />;
  if (user && !user.totp_confirmed) return <Navigate to="/setup-2fa" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/change-password" element={<ChangePasswordGate><ChangePassword /></ChangePasswordGate>} />
        <Route path="/setup-2fa" element={<Setup2FAGate><Setup2FA /></Setup2FAGate>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="realtime" element={<RealTime />} />
          <Route path="requests" element={<Requests />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="security" element={<Security />} />
          <Route path="hosts" element={<Hosts />} />
          <Route path="hosts/:host" element={<HostDetail />} />
          <Route path="ip/:ip" element={<IPDetail />} />
          <Route path="geo" element={<Geo />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
