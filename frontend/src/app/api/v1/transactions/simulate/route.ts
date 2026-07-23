import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { simulateTransaction } from "@/lib/server/fraud-service";
import { stripScriptTags } from "@/lib/server/sanitize";
import type { TransactionSimulationRequest, TransactionType } from "@/types/domain";

const transactionTypes: TransactionType[] = ["ODEME", "TRANSFER", "FATURA", "CEKIM"];

function isSimulation(value: unknown): value is TransactionSimulationRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<TransactionSimulationRequest>;
  return typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0 && transactionTypes.includes(body.type as TransactionType) &&
    [body.receiver, body.device, body.location].every((item) => typeof item === "string" && item.trim().length > 1);
}

export async function POST(request: Request) {
  const user = await authorizeApi(["CUSTOMER"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!isSimulation(body)) return apiError(422, "İşlem bilgileri eksik veya geçersiz");
  try {
    const input = body as TransactionSimulationRequest;
    return apiSuccess(await simulateTransaction({
      ...input,
      receiver: stripScriptTags(input.receiver),
      device: stripScriptTags(input.device),
      location: stripScriptTags(input.location),
    }, user), 201);
  } catch (error) {
    return backendApiError(error);
  }
}
