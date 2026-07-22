import { Leaderboard } from "@/components/leaderboard";
import { requireRole } from "@/lib/server/auth";
import { getLeaderboard } from "@/lib/server/fraud-service";

export default async function LeaderboardPage() {
  await requireRole(["ANALYST", "SUPERVISOR", "ADMIN"]);
  return <Leaderboard initialEntries={await getLeaderboard()} />;
}
