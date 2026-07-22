"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiClientError, apiRequest, setAuthResult } from "@/lib/api-client";
import type {
  AssignmentRequest,
  AuthResult,
  CustomerVerificationRequest,
  DecisionRequest,
  FeedbackRequest,
  GameLeaderboardEntry,
  GameLevel,
  GameProfileView,
  GamificationProfile,
  LeaderboardEntry,
  LoginCredentials,
  LoginResult,
  OperationsDashboard,
  PageView,
  RiskCaseView,
  TransactionCase,
  TransactionSimulationRequest,
  TransactionSimulationResult,
  TransactionView,
} from "@/types/domain";

const retryTransient = (failures: number, error: Error) =>
  failures < 1 && (!(error instanceof ApiClientError) || error.status === 0 || error.status >= 500);

const levelNames: Record<GameLevel, GamificationProfile["level"]> = {
  BRONZ: "Bronz",
  GUMUS: "Gümüş",
  ALTIN: "Altın",
  PLATIN: "Platin",
};

export function toTransactionCase(value: RiskCaseView): TransactionCase {
  return {
    id: value.id,
    case_id: value.id,
    version: value.version,
    prediction_status: value.transaction.prediction_status,
    transaction_details: {
      transaction_number: value.transaction.transaction_number,
      amount: Number(value.transaction.amount),
      currency: value.transaction.currency,
      type: value.transaction.transaction_type,
      receiver: value.transaction.recipient,
      device: value.transaction.source_device,
      location: `${value.transaction.city}, ${value.transaction.country_code}`,
      timestamp: value.transaction.occurred_at,
    },
    ai_analysis: {
      risk_score: value.effective_score ?? value.raw_ai_score,
      fraud_type: value.fraud_type,
      recommended_decision: value.transaction.decision,
    },
    status: value.status,
    risk_level: value.risk_level,
    assigned_analyst_id: value.assigned_analyst_id,
    sla_deadline: value.due_at,
  };
}

function toProfile(value: GameProfileView): GamificationProfile {
  return {
    total_points: value.total_points,
    level: levelNames[value.level],
    badges: value.badges.filter((badge) => badge.earned).map((badge) => badge.name),
    daily_rank: value.daily_rank,
  };
}

function toLeaderboardEntry(value: GameLeaderboardEntry): LeaderboardEntry {
  return {
    rank: value.rank,
    analyst: { user_id: value.analyst_id, full_name: value.name, role: "ANALYST" },
    profile: {
      total_points: value.points,
      level: levelNames[value.level],
      badges: [],
      daily_rank: value.rank,
    },
  };
}

export function useApiErrorToast(error: Error | null, fallback: string) {
  useEffect(() => {
    if (!error) return;
    const requestId = error instanceof ApiClientError ? error.requestId : null;
    toast.error(error.message || fallback, {
      id: `api:${requestId ?? `${fallback}:${error.message}`}`,
      description: requestId ? `İstek: ${requestId}` : undefined,
    });
  }, [error, fallback]);
}

export function useGetCases() {
  return useQuery({
    queryKey: ["cases"],
    queryFn: async () => (await apiRequest<PageView<RiskCaseView>>("/api/v1/cases?page=0&size=50")).items.map(toTransactionCase),
    staleTime: 30_000,
    retry: retryTransient,
  });
}

export function useGetCase(id: string | null) {
  return useQuery({
    queryKey: ["cases", id],
    queryFn: async () => toTransactionCase(await apiRequest<RiskCaseView>(`/api/v1/cases/${id}`)),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: retryTransient,
  });
}

export function useApproveTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, ...body }: DecisionRequest & { id: string; status: TransactionCase["status"] }) => {
      let version = body.version;
      if (status === "ATANDI") {
        const reviewing = await apiRequest<RiskCaseView>(`/api/v1/cases/${id}/actions/start-review`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ version }),
        });
        version = reviewing.version;
      }
      return toTransactionCase(await apiRequest<RiskCaseView>(`/api/v1/cases/${id}/decision`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...body, version }),
      }));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["cases", data.case_id], data);
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useAssignCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AssignmentRequest & { id: string }) =>
      apiRequest<RiskCaseView>(`/api/v1/cases/${id}/assignments`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["operations"] }),
  });
}

export function useGetGameProfile() {
  return useQuery({
    queryKey: ["game-profile", "me"],
    queryFn: async () => toProfile(await apiRequest<GameProfileView>("/api/v1/game/profile/me")),
    staleTime: 300_000,
    retry: retryTransient,
  });
}

export function useGetOperationsDashboard() {
  return useQuery({
    queryKey: ["operations"],
    queryFn: () => apiRequest<OperationsDashboard>("/api/v1/dashboard/operations"),
    staleTime: 30_000,
    retry: retryTransient,
  });
}

export function useGetLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard", "daily"],
    queryFn: async () => (await apiRequest<GameLeaderboardEntry[]>("/api/v1/game/leaderboard?period=daily")).map(toLeaderboardEntry),
    staleTime: 60_000,
    retry: retryTransient,
  });
}

function transactionLocation(location: string) {
  // ponytail: the preserved UI has one "City, CC" field; split it only when the form gains address fields.
  const parts = location.split(",").map((item) => item.trim()).filter(Boolean);
  const candidate = parts.at(-1)?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(candidate)
    ? { city: parts.slice(0, -1).join(", "), country_code: candidate }
    : { city: location.trim(), country_code: "TR" };
}

export function useSimulateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (form: TransactionSimulationRequest): Promise<TransactionSimulationResult> => {
      const location = transactionLocation(form.location);
      const transaction = await apiRequest<TransactionView>("/api/v1/transactions", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          amount: form.amount,
          transaction_type: form.type,
          recipient: form.receiver,
          source_device: form.device,
          ...location,
          occurred_at: new Date().toISOString(),
        }),
      });
      if (!transaction.case_id) {
        throw new ApiClientError(502, "CASE_NOT_CREATED", "İşlem oluşturuldu ancak vaka bilgisi alınamadı.", null);
      }
      const riskCase = toTransactionCase(await apiRequest<RiskCaseView>(`/api/v1/cases/${transaction.case_id}`));
      return { case: riskCase, requires_verification: riskCase.status === "MUSTERI_DOGRULAMA" };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
      void queryClient.invalidateQueries({ queryKey: ["operations"] });
    },
  });
}

export function useVerifyCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: CustomerVerificationRequest & { id: string }) =>
      toTransactionCase(await apiRequest<RiskCaseView>(`/api/v1/cases/${id}/customer-verification`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      })),
    onSuccess: (data) => {
      queryClient.setQueryData(["cases", data.case_id], data);
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: ({ id, ...body }: FeedbackRequest & { id: string }) =>
      apiRequest<RiskCaseView>(`/api/v1/cases/${id}/feedback`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      }),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginCredentials) => apiRequest<LoginResult>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
      auth: false,
    }),
    onSuccess: (result) => {
      setAuthResult(result);
      queryClient.clear();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ logged_out: boolean }>("/api/v1/auth/logout", { method: "POST", auth: false }),
    retry: (failures, error) => failures < 1 && error instanceof ApiClientError && error.status === 0,
    onSettled: () => {
      setAuthResult(null);
      queryClient.clear();
    },
  });
}

export async function restoreAuth(): Promise<AuthResult> {
  const result = await apiRequest<AuthResult>("/api/v1/auth/refresh", { method: "POST", auth: false });
  setAuthResult(result);
  return result;
}
