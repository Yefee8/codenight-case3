import { apiError, apiSuccess } from "@/lib/api-response";
import { mockCases, riskLevel } from "@/lib/mock-data";
import { authorizeApi } from "@/lib/server/api-auth";
import type { TransactionCase, TransactionSimulationRequest, TransactionSimulationResult, TransactionType } from "@/types/domain";

const transactionTypes: TransactionType[] = ["ODEME", "TRANSFER", "FATURA", "CEKIM"];

function isSimulation(value: unknown): value is TransactionSimulationRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<TransactionSimulationRequest>;
  return typeof body.amount === "number" && body.amount > 0 && transactionTypes.includes(body.type as TransactionType) &&
    [body.receiver, body.device, body.location].every((item) => typeof item === "string" && item.trim().length > 1);
}

export async function POST(request: Request) {
  const user = await authorizeApi(["CUSTOMER", "ADMIN"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!isSimulation(body)) return apiError(422, "İşlem bilgileri eksik veya geçersiz");

  const score = body.amount >= 10_000 ? .94 : body.amount >= 3_000 ? .76 : .18;
  const timestamp = new Date().toISOString();
  const transactionCase: TransactionCase = {
    case_id: `TRX-2026-${String(mockCases.length + 123).padStart(6, "0")}`,
    transaction_details: { ...body, currency: "TRY", timestamp },
    ai_analysis: {
      risk_score: score,
      fraud_type: score > .9 ? "HESAP_ELE_GECIRME" : score > .7 ? "SUPHELI_DAVRANIS" : "TEMIZ",
      recommended_decision: score > .9 ? "BLOK" : score > .7 ? "INCELEME" : "ONAY",
    },
    status: score > .7 ? "MUSTERI_DOGRULAMA" : "ONAYLANDI",
    risk_level: riskLevel(score),
    assigned_analyst_id: null,
    sla_deadline: new Date(new Date(timestamp).getTime() + (score > .9 ? 15 : score > .7 ? 30 : 1440) * 60_000).toISOString(),
  };
  mockCases.push(transactionCase);

  const result: TransactionSimulationResult = { case: transactionCase, requires_verification: score > .7 };
  return apiSuccess(result, 201);
}
