import { analystPerformance, analystProfile, leaderboard, mockCases, supervisorMetrics } from "@/lib/mock-data";
import type { RiskLevel, SessionUser } from "@/types/domain";

const priority: Record<RiskLevel, number> = { KRITIK: 0, YUKSEK: 1, ORTA: 2, DUSUK: 3 };

/** Shared by Server Components and BFF routes so SSR never calls its own HTTP endpoint. */
export async function listCasesFor(user: SessionUser) {
  const visible = user.role === "ANALYST" ? mockCases.filter((item) => item.assigned_analyst_id === user.user_id) : mockCases;
  return [...visible].sort((a, b) => priority[a.risk_level] - priority[b.risk_level]);
}

export async function findCaseFor(id: string, user: SessionUser) {
  return (await listCasesFor(user)).find((item) => item.case_id === id) ?? null;
}

export async function getGameProfile() {
  return analystProfile;
}

export async function getSupervisorMetrics() {
  return supervisorMetrics;
}

export async function getAnalystPerformance() {
  return analystPerformance;
}

export async function getLeaderboard() {
  return leaderboard;
}
