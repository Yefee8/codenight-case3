import { SupervisorDashboard } from "@/components/supervisor-dashboard";
import { requireRole } from "@/lib/server/auth";

export default async function SupervisorPage() {
  const user = await requireRole(["SUPERVISOR", "ADMIN"]);
  return <SupervisorDashboard canAssign={user.role === "SUPERVISOR"} />;
}
