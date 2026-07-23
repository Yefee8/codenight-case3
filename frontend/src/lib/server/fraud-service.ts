import { backendRequest } from "@/lib/server/backend";
import { getAccessToken } from "@/lib/server/auth";
import type {
  AnalystPerformance,
  DecisionRequest,
  FeedbackRequest,
  FraudType,
  GamificationProfile,
  LeaderboardEntry,
  RiskOverrideRequest,
  RiskLevel,
  SessionUser,
  SupervisorMetrics,
  TransactionCase,
  TransactionSimulationRequest,
  TransactionSimulationResult,
  User,
} from "@/types/domain";

const priority: Record<RiskLevel, number> = { KRITIK: 0, YUKSEK: 1, ORTA: 2, DUSUK: 3 };
const terminalStatuses = new Set(["ONAYLANDI", "BLOKLANDI", "KAPANDI"]);
const fraudTypes = new Set<FraudType>(["CALINTI_KART", "HESAP_ELE_GECIRME", "PARA_AKLAMA", "SUPHELI_DAVRANIS", "TEMIZ"]);

async function gateway<T>(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return backendRequest<T>(path, { ...init, headers });
}

async function allCases() {
  return gateway<TransactionCase[]>("/api/v1/cases");
}

export async function listCasesFor(user: SessionUser) {
  const cases = await allCases();
  const visible = user.role === "ANALYST" ? cases.filter((item) => item.assigned_analyst_id === user.user_id) : cases;
  return visible.sort((a, b) => priority[a.risk_level] - priority[b.risk_level] || Date.parse(a.sla_deadline) - Date.parse(b.sla_deadline));
}

export async function findCaseFor(id: string, user: SessionUser) {
  const item = await gateway<TransactionCase>(`/api/v1/cases/${encodeURIComponent(id)}`);
  return user.role === "ANALYST" && item.assigned_analyst_id !== user.user_id ? null : item;
}

export function getGameProfile(userId: string) {
  return gateway<GamificationProfile>(`/api/v1/game/profile/${encodeURIComponent(userId)}`);
}

export function getLeaderboard() {
  return gateway<LeaderboardEntry[]>("/api/v1/game/leaderboard");
}

export function getStaff() {
  return gateway<User[]>("/api/v1/staff");
}

function percentage(part: number, total: number) {
  return total ? Math.round(part * 1_000 / total) / 10 : 0;
}

export async function getSupervisorMetrics(): Promise<SupervisorMetrics> {
  const cases = await allCases();
  const now = Date.now();
  const decided = cases.filter((item) => item.decided_at);
  const compliant = decided.filter((item) => Date.parse(item.decided_at as string) <= Date.parse(item.sla_deadline)).length;
  const available = cases.filter((item) => item.ai_analysis.prediction_status === "AVAILABLE").length;
  const distribution = { CALINTI_KART: 0, HESAP_ELE_GECIRME: 0, PARA_AKLAMA: 0, SUPHELI_DAVRANIS: 0, TEMIZ: 0, BELIRSIZ: 0 };
  for (const item of cases) distribution[item.ai_analysis.fraud_type] += 1;
  for (const key of Object.keys(distribution) as (keyof typeof distribution)[]) distribution[key] = percentage(distribution[key], cases.length);

  return {
    sla_compliance_rate: percentage(compliant, decided.length),
    ai_accuracy_rate: percentage(available, cases.length),
    active_overdue_cases: cases.filter((item) => !terminalStatuses.has(item.status) && Date.parse(item.sla_deadline) < now).length,
    fraud_distribution: distribution,
  };
}

export async function getAnalystPerformance(): Promise<AnalystPerformance[]> {
  const [staff, cases] = await Promise.all([getStaff(), allCases()]);
  return staff.map((analyst) => {
    const assigned = cases.filter((item) => item.assigned_analyst_id === analyst.user_id);
    const decided = assigned.filter((item) => item.decided_at);
    const durations = decided.map((item) => (Date.parse(item.decided_at as string) - Date.parse(item.created_at)) / 60_000);
    const specialties = [...new Set(assigned.map((item) => item.ai_analysis.fraud_type).filter((value): value is FraudType => fraudTypes.has(value as FraudType)))];
    return {
      analyst: { ...analyst, specialties },
      decisions_made: decided.length,
      average_decision_minutes: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) * 10 / durations.length) / 10 : 0,
      accuracy_rate: percentage(decided.filter((item) => Date.parse(item.decided_at as string) <= Date.parse(item.sla_deadline)).length, decided.length),
    };
  });
}

export function assignCase(id: string, analystId: string) {
  return gateway<TransactionCase>(`/api/v1/cases/${encodeURIComponent(id)}/assignment`, {
    method: "PATCH",
    body: JSON.stringify({ analyst_id: analystId }),
  });
}

export function overrideRiskLevel(id: string, body: RiskOverrideRequest) {
  return gateway<TransactionCase>(`/api/v1/cases/${encodeURIComponent(id)}/risk-level`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function submitCaseFeedback(id: string, body: FeedbackRequest) {
  return gateway<TransactionCase>(`/api/v1/cases/${encodeURIComponent(id)}/feedback`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startCaseReview(id: string) {
  return gateway<TransactionCase>(`/api/v1/cases/${encodeURIComponent(id)}/actions/start-review`, { method: "POST" });
}

export function decideCase(id: string, body: DecisionRequest, user: SessionUser) {
  return gateway<TransactionCase>(`/api/v1/cases/${encodeURIComponent(id)}/decision`, {
    method: "PATCH",
    body: JSON.stringify({ ...body, analyst_id: user.user_id, analyst_name: user.full_name }),
  });
}

export function simulateTransaction(body: TransactionSimulationRequest, user: SessionUser) {
  return gateway<TransactionSimulationResult>("/api/v1/transactions/simulate", {
    method: "POST",
    body: JSON.stringify({ ...body, currency: "TRY", customer_id: user.user_id }),
  });
}
