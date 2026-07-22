import { AnalystDashboard } from "@/components/analyst-dashboard";
import { requireRole } from "@/lib/server/auth";

export default async function AnalystPage() {
  const user = await requireRole(["ANALYST"]);
  return <AnalystDashboard userId={user.user_id} />;
}
