import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./AuthContext";
import type { Role } from "../types";

export function RoleGuard({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

