import { Leaderboard } from "@/components/leaderboard";
import { requireRole } from "@/lib/server/auth";

export default async function LeaderboardPage() {
  await requireRole(["ANALYST", "SUPERVISOR", "ADMIN"]);
  return <Leaderboard />;
}
