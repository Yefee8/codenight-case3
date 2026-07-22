export type Role = "CUSTOMER" | "ANALYST" | "SUPERVISOR" | "ADMIN";
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
export type AnalystDecision = "ONAYLANDI" | "BLOKLANDI";
export type PredictionStatus = "PENDING" | "AVAILABLE" | "UNAVAILABLE";
export type RecommendedDecision = "ONAY" | "INCELEME" | "BLOK";
export type GameLevel = "BRONZ" | "GUMUS" | "ALTIN" | "PLATIN";

export interface ApiErrorPayload {
  code: string;
  message: string;
  field_errors?: Record<string, string[]>;
}

/** Exact JSON envelope emitted by the gateway and every service. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorPayload | null;
  request_id: string;
}

export type ApiResponse<T> = ApiEnvelope<T>;

export interface CurrentUser {
  id: string;
  first_name: string;
  last_name: string;
  role: Role;
  specialties: FraudType[];
  regions: string[];
}

export interface AuthResult {
  access_token: string;
  expires_in: number;
  user: CurrentUser;
}

export interface OtpChallengeRequest { gsm: string }
export interface OtpChallengeResult { challenge_id: string; expires_at: string }
export interface CustomerLoginRequest { challenge_id: string | null; gsm: string; otp_code: string }
export interface StaffLoginRequest { email: string; password: string }
/** Same two-field login card; the BFF selects customer or staff auth from the identifier. */
export interface LoginCredentials { identifier: string; secret: string }
export interface LoginResult extends AuthResult { redirect_to: string }

export interface TransactionView {
  id: string;
  transaction_number: string;
  amount: string;
  currency: string;
  transaction_type: TransactionType;
  recipient: string;
  source_device: string;
  city: string;
  country_code: string;
  occurred_at: string;
  prediction_status: PredictionStatus;
  risk_score: number | null;
  risk_level: RiskLevel;
  fraud_type: FraudType;
  decision: RecommendedDecision;
  model_version: string | null;
  reason_codes: string[];
  case_id: string | null;
  case_status: CaseStatus | null;
}

export interface RiskCaseView {
  id: string;
  transaction: TransactionView;
  customer_id: string;
  assigned_analyst_id: string | null;
  status: CaseStatus;
  risk_level: RiskLevel;
  fraud_type: FraudType;
  raw_ai_score: number | null;
  effective_score: number | null;
  hold_status: string | null;
  queue_reason: string | null;
  due_at: string;
  created_at: string;
  version: number;
  customer_verification: "PENDING" | "CUSTOMER_CONFIRMED" | "CUSTOMER_DENIED" | null;
}

export interface PageView<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface CreateTransactionRequest {
  amount: number;
  transaction_type: TransactionType;
  recipient: string;
  source_device: string;
  city: string;
  country_code: string;
  occurred_at: string;
}

export interface DecisionRequest {
  decision: AnalystDecision;
  note: string;
  version: number;
}

export interface AssignmentRequest {
  analyst_id: string;
  version: number;
  reason: string;
  override_capacity: boolean;
}

export interface CustomerVerificationRequest {
  response: "CUSTOMER_CONFIRMED" | "CUSTOMER_DENIED";
}

export interface FeedbackRequest { score: number }
export interface NamedCount { name: string; value: number }
export interface RiskTrend { bucket: string; risk_level: RiskLevel; value: number }
export interface CategoryAccuracy { category: FraudType; accuracy: number; sample_size: number }
export interface OperationsAnalystPerformance {
  analyst_id: string;
  name: string;
  decision_count: number;
  average_minutes: number;
  accuracy: number | null;
}

export interface OperationsDashboard {
  generated_at: string;
  stale: boolean;
  partial_sources: string[];
  fraud_type_distribution: NamedCount[];
  risk_distribution: NamedCount[];
  risk_trend: RiskTrend[];
  sla_compliance_rate: number;
  active_sla_breaches: number;
  ai_accuracy: number | null;
  false_positive_rate: number | null;
  category_accuracy: CategoryAccuracy[];
  analyst_performance: OperationsAnalystPerformance[];
  manual_queue: RiskCaseView[];
}

export interface BadgeView {
  code: string;
  name: string;
  description: string;
  earned: boolean;
  earned_at: string | null;
}

export interface GameProfileView {
  analyst_id: string;
  name: string;
  total_points: number;
  level: GameLevel;
  solved_cases: number;
  average_feedback: number | null;
  daily_rank: number | null;
  weekly_rank: number | null;
  badges: BadgeView[];
}

export interface GameLeaderboardEntry {
  rank: number;
  analyst_id: string;
  name: string;
  points: number;
  level: GameLevel;
}

/** Signed UI-session shape; it contains identity metadata, never an access token. */
export interface User {
  user_id: string;
  full_name: string;
  role: Role;
  gsm?: string;
  specialties?: FraudType[];
}
export type SessionUser = Pick<User, "user_id" | "full_name" | "role">;

/** Existing component view models; wire data is converted at the query boundary. */
export interface TransactionCase {
  id?: string;
  case_id: string;
  version?: number;
  prediction_status?: PredictionStatus;
  transaction_details: {
    transaction_number?: string;
    amount: number;
    currency: string;
    type: TransactionType;
    receiver: string;
    device: string;
    location: string;
    timestamp: string;
  };
  ai_analysis: {
    risk_score: number | null;
    fraud_type: FraudType;
    recommended_decision: RecommendedDecision;
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
  daily_rank: number | null;
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
