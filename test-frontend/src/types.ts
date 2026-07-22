export type Role = "CUSTOMER" | "ANALYST" | "SUPERVISOR" | "ADMIN";

export interface ApiErrorPayload {
  code: string;
  message: string;
  field_errors?: Record<string, string[]>;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
  request_id: string;
}

export interface CurrentUser {
  id: string;
  first_name: string;
  last_name: string;
  role: Role;
  specialties: string[];
  regions: string[];
}

export interface AuthResult {
  access_token: string;
  expires_in: number;
  user: CurrentUser;
}

export type TransactionType = "ODEME" | "TRANSFER" | "FATURA" | "CEKIM";
export type FraudType =
  | "CALINTI_KART"
  | "HESAP_ELE_GECIRME"
  | "PARA_AKLAMA"
  | "SUPHELI_DAVRANIS"
  | "TEMIZ"
  | "BELIRSIZ";
export type RiskLevel = "DUSUK" | "ORTA" | "YUKSEK" | "KRITIK" | "BELIRSIZ";
export type CaseStatus =
  | "YENI"
  | "ATANDI"
  | "INCELENIYOR"
  | "MUSTERI_DOGRULAMA"
  | "ONAYLANDI"
  | "BLOKLANDI"
  | "KAPANDI";

export interface TransactionRecord {
  id: string;
  transaction_number: string;
  amount: string;
  currency: string;
  transaction_type: TransactionType;
  recipient: string;
  city: string;
  country_code: string;
  occurred_at: string;
  prediction_status: "AVAILABLE" | "UNAVAILABLE";
  risk_score: number | null;
  risk_level: RiskLevel;
  fraud_type: FraudType;
  decision: "ONAY" | "INCELEME" | "BLOK";
  model_version: string | null;
  reason_codes: string[];
  case_id: string | null;
  case_status: CaseStatus | null;
}

export interface RiskCase {
  id: string;
  transaction: TransactionRecord;
  customer_id: string;
  assigned_analyst_id: string | null;
  status: CaseStatus;
  risk_level: RiskLevel;
  fraud_type: FraudType;
  raw_ai_score: number | null;
  effective_score: number | null;
  hold_status: string | null;
  due_at: string;
  created_at: string;
  version: number;
  customer_verification: "PENDING" | "CUSTOMER_CONFIRMED" | "CUSTOMER_DENIED" | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface OperationsDashboard {
  generated_at: string;
  stale: boolean;
  partial_sources: string[];
  fraud_type_distribution: Array<{ name: string; value: number }>;
  risk_distribution: Array<{ name: string; value: number }>;
  sla_compliance_rate: number;
  active_sla_breaches: number;
  ai_accuracy: number | null;
  false_positive_rate: number | null;
  category_accuracy: Array<{ category: string; accuracy: number; sample_size: number }>;
  analyst_performance: Array<{
    analyst_id: string;
    name: string;
    decision_count: number;
    average_minutes: number;
    accuracy: number | null;
  }>;
  manual_queue: RiskCase[];
}

export interface GameProfile {
  analyst_id: string;
  total_points: number;
  level: "BRONZ" | "GUMUS" | "ALTIN" | "PLATIN";
  solved_cases: number;
  average_feedback: number | null;
  daily_rank: number | null;
  weekly_rank: number | null;
  badges: Array<{ code: string; name: string; earned_at: string }>;
}

export interface LeaderboardEntry {
  rank: number;
  analyst_id: string;
  name: string;
  points: number;
  level: string;
}

