import type {
  AnalystPerformance,
  CaseStatus,
  FraudType,
  GamificationProfile,
  LeaderboardEntry,
  RiskLevel,
  SupervisorMetrics,
  TransactionCase,
  TransactionType,
  User,
} from "@/types/domain";

type CaseSeed = Omit<TransactionCase, "case_id" | "risk_level" | "sla_deadline">;
type RawCaseSeed = [number, TransactionType, string, string, string, string, number, FraudType, "ONAY" | "INCELEME" | "BLOK", CaseStatus, string | null];

const seeds: CaseSeed[] = ([
  [24500, "TRANSFER", "Nova Bilişim A.Ş.", "iPhone 14 Pro · iOS 17", "İzmir, TR", "2026-07-22T09:42:00+03:00", .96, "HESAP_ELE_GECIRME", "BLOK", "YENI", null],
  [3890, "ODEME", "Marmara Elektronik", "Galaxy S24 · Android 15", "İstanbul, TR", "2026-07-22T09:35:00+03:00", .73, "CALINTI_KART", "INCELEME", "ATANDI", "usr_analyst_1"],
  [85000, "TRANSFER", "Kuzey Dış Ticaret", "Chrome · Windows 11", "Bakü, AZ", "2026-07-22T09:21:00+03:00", .93, "PARA_AKLAMA", "BLOK", "INCELENIYOR", "usr_analyst_1"],
  [649, "FATURA", "Turkcell Fatura", "iPhone 13 · iOS 18", "Ankara, TR", "2026-07-22T09:10:00+03:00", .08, "TEMIZ", "ONAY", "ONAYLANDI", "usr_analyst_2"],
  [12400, "CEKIM", "ATM TR-8821", "Kart · Temassız", "Antalya, TR", "2026-07-22T08:56:00+03:00", .87, "SUPHELI_DAVRANIS", "INCELEME", "MUSTERI_DOGRULAMA", "usr_analyst_3"],
  [7200, "ODEME", "Anadolu Kuyumculuk", "Pixel 9 · Android 16", "Bursa, TR", "2026-07-22T08:44:00+03:00", .68, "CALINTI_KART", "INCELEME", "ATANDI", "usr_analyst_2"],
  [149900, "TRANSFER", "Atlas Danışmanlık Ltd.", "Safari · macOS 16", "Lefkoşa, CY", "2026-07-22T08:28:00+03:00", .98, "PARA_AKLAMA", "BLOK", "YENI", null],
  [189, "ODEME", "Getir", "iPhone 15 · iOS 18", "İstanbul, TR", "2026-07-22T08:04:00+03:00", .12, "TEMIZ", "ONAY", "KAPANDI", "usr_analyst_4"],
  [47750, "TRANSFER", "Ege Yapı Market", "Firefox · Ubuntu", "Manisa, TR", "2026-07-22T07:49:00+03:00", .82, "HESAP_ELE_GECIRME", "BLOK", "BLOKLANDI", "usr_analyst_1"],
  [2350, "CEKIM", "ATM TR-1907", "Kart · Çipli", "Adana, TR", "2026-07-22T07:32:00+03:00", .44, "SUPHELI_DAVRANIS", "INCELEME", "YENI", null],
  [995, "FATURA", "Enerjisa", "Galaxy A55 · Android 14", "Eskişehir, TR", "2026-07-22T07:18:00+03:00", .18, "TEMIZ", "ONAY", "ONAYLANDI", "usr_analyst_3"],
  [32000, "ODEME", "Global Travel BV", "Chrome · Android 15", "Amsterdam, NL", "2026-07-22T06:55:00+03:00", .91, "CALINTI_KART", "BLOK", "INCELENIYOR", "usr_analyst_4"],
] satisfies RawCaseSeed[]).map(([amount, type, receiver, device, location, timestamp, risk_score, fraud_type, recommended_decision, status, assigned_analyst_id]) => ({
  transaction_details: { amount, currency: "TRY", type, receiver, device, location, timestamp },
  ai_analysis: { risk_score, fraud_type, recommended_decision },
  status,
  assigned_analyst_id,
}));

export function riskLevel(score: number): RiskLevel {
  if (score > .9) return "KRITIK";
  if (score >= .75) return "YUKSEK";
  if (score >= .4) return "ORTA";
  return "DUSUK";
}

function slaDeadline(timestamp: string, score: number) {
  const minutes = score > .9 ? 15 : score >= .75 ? 30 : score >= .4 ? 120 : 1440;
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString();
}

export const mockCases: TransactionCase[] = seeds.map((seed, index) => ({
  ...seed,
  case_id: `TRX-2026-${String(index + 123).padStart(6, "0")}`,
  risk_level: riskLevel(seed.ai_analysis.risk_score),
  sla_deadline: slaDeadline(seed.transaction_details.timestamp, seed.ai_analysis.risk_score),
}));

export const analysts: User[] = [
  { user_id: "usr_analyst_1", full_name: "Selin Kaya", role: "ANALYST", gsm: "+90 532 111 20 26", specialties: ["HESAP_ELE_GECIRME", "PARA_AKLAMA"] },
  { user_id: "usr_analyst_2", full_name: "Mert Demir", role: "ANALYST", gsm: "+90 532 222 20 26", specialties: ["CALINTI_KART"] },
  { user_id: "usr_analyst_3", full_name: "Ece Yıldız", role: "ANALYST", gsm: "+90 532 333 20 26", specialties: ["SUPHELI_DAVRANIS"] },
  { user_id: "usr_analyst_4", full_name: "Can Arslan", role: "ANALYST", gsm: "+90 532 444 20 26", specialties: ["CALINTI_KART", "HESAP_ELE_GECIRME"] },
];

export const analystPerformance: AnalystPerformance[] = analysts.map((analyst, index) => ({
  analyst,
  decisions_made: [48, 43, 39, 35][index],
  average_decision_minutes: [8.4, 10.1, 11.8, 9.7][index],
  accuracy_rate: [96.8, 94.2, 91.7, 93.6][index],
}));

const points = [4850, 4320, 3975, 3640, 3210, 2950, 2700, 2480, 2210, 1980];
const names = ["Selin Kaya", "Mert Demir", "Ece Yıldız", "Can Arslan", "Duru Koç", "Arda Şen", "Naz Aksoy", "Bora Aydın", "İpek Kurt", "Emir Çelik"];
export const leaderboard: LeaderboardEntry[] = names.map((full_name, index) => ({
  rank: index + 1,
  analyst: analysts[index] ?? { user_id: `usr_analyst_${index + 1}`, full_name, role: "ANALYST", gsm: `+90 532 555 ${20 + index} 26` },
  profile: {
    total_points: points[index],
    level: points[index] >= 4500 ? "Platin" : points[index] >= 3200 ? "Altın" : points[index] >= 2300 ? "Gümüş" : "Bronz",
    badges: index < 2 ? ["İlk Yakalama", "Keskin Göz"] : index < 6 ? ["Hız Ustası"] : ["Takım Oyuncusu"],
    daily_rank: index + 1,
  },
}));

export const supervisorMetrics: SupervisorMetrics = {
  sla_compliance_rate: 94.5,
  ai_accuracy_rate: 88.2,
  active_overdue_cases: 3,
  fraud_distribution: {
    CALINTI_KART: 34,
    HESAP_ELE_GECIRME: 26,
    PARA_AKLAMA: 14,
    SUPHELI_DAVRANIS: 18,
    TEMIZ: 8,
  },
};

export const analystProfile: GamificationProfile = leaderboard[0].profile;

// ponytail: in-memory state is for the mock BFF; replace this module when persistence is required.
if (mockCases.some((item) => item.ai_analysis.risk_score > .9 && (item.risk_level !== "KRITIK" || new Date(item.sla_deadline).getTime() - new Date(item.transaction_details.timestamp).getTime() !== 900_000))) {
  throw new Error("Critical risk/SLA mock contract is invalid");
}
