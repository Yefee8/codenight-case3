export type Role = "CUSTOMER" | "ANALYST" | "SUPERVISOR" | "ADMIN";
export type FraudType =
  | "CALINTI_KART"
  | "HESAP_ELE_GECIRME"
  | "PARA_AKLAMA"
  | "SUPHELI_DAVRANIS"
  | "TEMIZ";
export type RiskLevel = "DUSUK" | "ORTA" | "YUKSEK" | "KRITIK";
export type CaseStatus =
  | "YENI"
  | "ATANDI"
  | "INCELENIYOR"
  | "MUSTERI_DOGRULAMA"
  | "ONAYLANDI"
  | "BLOKLANDI"
  | "KAPANDI";
export type TransactionType = "ODEME" | "TRANSFER" | "FATURA" | "CEKIM";
export type AnalystDecision = "ONAYLANDI" | "BLOKLANDI";

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: number; message: string } | null;
}

export interface User {
  user_id: string;
  full_name: string;
  role: Role;
  gsm: string;
  specialties?: FraudType[];
}

export type SessionUser = Pick<User, "user_id" | "full_name" | "role">;

export interface LoginRequest {
  gsm: string;
  otp: string;
}

export interface LoginResult {
  user: SessionUser;
  redirect_to: string;
}

export interface TransactionCase {
  case_id: string;
  transaction_details: {
    amount: number;
    currency: string;
    type: TransactionType;
    receiver: string;
    device: string;
    location: string;
    timestamp: string;
  };
  ai_analysis: {
    risk_score: number;
    fraud_type: FraudType;
    recommended_decision: "ONAY" | "INCELEME" | "BLOK";
  };
  status: CaseStatus;
  risk_level: RiskLevel;
  assigned_analyst_id: string | null;
  sla_deadline: string;
}

export interface GamificationProfile {
  total_points: number;
  level: "Bronz" | "Gümüş" | "Altın" | "Platin";
  badges: string[];
  daily_rank: number;
}

export interface SupervisorMetrics {
  sla_compliance_rate: number;
  ai_accuracy_rate: number;
  active_overdue_cases: number;
  fraud_distribution: Record<FraudType, number>;
}

export interface DecisionRequest {
  decision: AnalystDecision;
  note: string;
}

export interface AssignmentRequest {
  analyst_id: string;
}

export interface AnalystPerformance {
  analyst: User;
  decisions_made: number;
  average_decision_minutes: number;
  accuracy_rate: number;
}

export interface LeaderboardEntry {
  rank: number;
  analyst: User;
  profile: GamificationProfile;
}

export interface TransactionSimulationRequest {
  amount: number;
  type: TransactionType;
  receiver: string;
  device: string;
  location: string;
}

export interface TransactionSimulationResult {
  case: TransactionCase;
  requires_verification: boolean;
}
