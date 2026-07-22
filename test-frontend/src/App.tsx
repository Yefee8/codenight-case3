import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RoleGuard } from "./auth/RoleGuard";
import { AppLayout } from "./layout/AppLayout";
import { AdminPage } from "./pages/AdminPage";
import { AnalystPage } from "./pages/AnalystPage";
import { CustomerPage } from "./pages/CustomerPage";
import { GamePage } from "./pages/GamePage";
import { LoginPage } from "./pages/LoginPage";
import { ForbiddenPage, NotFoundPage } from "./pages/SimplePages";
import { SupervisorPage } from "./pages/SupervisorPage";
import type { Role } from "./types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

const HOME: Record<Role, string> = {
  CUSTOMER: "/customer",
  ANALYST: "/analyst",
  SUPERVISOR: "/supervisor",
  ADMIN: "/admin",
};

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? HOME[user.role] : "/login"} replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<HomeRedirect />} />
            <Route element={<RoleGuard roles={["CUSTOMER"]} />}><Route path="customer" element={<CustomerPage />} /></Route>
            <Route element={<RoleGuard roles={["ANALYST"]} />}><Route path="analyst" element={<AnalystPage />} /></Route>
            <Route element={<RoleGuard roles={["SUPERVISOR", "ADMIN"]} />}><Route path="supervisor" element={<SupervisorPage />} /></Route>
            <Route element={<RoleGuard roles={["ADMIN"]} />}><Route path="admin" element={<AdminPage />} /></Route>
            <Route element={<RoleGuard roles={["ANALYST", "SUPERVISOR"]} />}><Route path="game" element={<GamePage />} /></Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  );
}

