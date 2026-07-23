import { AnalystDashboard } from "@/components/analyst-dashboard";
import { getGameProfile, listCasesFor } from "@/lib/server/fraud-service";
import { requireRole } from "@/lib/server/auth";

export default async function AnalystPage() {
  const user = await requireRole(["ANALYST"]);
  const [initialCases, initialProfile] = await Promise.all([listCasesFor(user), getGameProfile(user.user_id)]);
  return <AnalystDashboard initialCases={initialCases} initialProfile={initialProfile} userId={user.user_id} />;
}
