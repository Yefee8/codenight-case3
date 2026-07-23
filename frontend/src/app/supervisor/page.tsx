import { SupervisorDashboard } from "@/components/supervisor-dashboard";
import { getAnalystPerformance, getSupervisorMetrics, listCasesFor } from "@/lib/server/fraud-service";
import { requireRole } from "@/lib/server/auth";

export default async function SupervisorPage() {
  const user = await requireRole(["SUPERVISOR", "ADMIN"]);
  const [initialMetrics, initialPerformance, initialCases] = await Promise.all([getSupervisorMetrics(), getAnalystPerformance(), listCasesFor(user)]);
  return <SupervisorDashboard initialMetrics={initialMetrics} initialPerformance={initialPerformance} initialCases={initialCases} canAssign={user.role === "SUPERVISOR"} />;
}
