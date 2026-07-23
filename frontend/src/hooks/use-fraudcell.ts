"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnalystPerformance,
  ApiResponse,
  AssignmentRequest,
  DecisionRequest,
  GamificationProfile,
  LeaderboardEntry,
  LoginRequest,
  LoginResult,
  SupervisorMetrics,
  TransactionCase,
  TransactionSimulationRequest,
  TransactionSimulationResult,
} from "@/types/domain";

let refreshPromise: Promise<boolean> | null = null;

function refreshSession() {
  refreshPromise ??= fetch("/api/v1/auth/refresh", { method: "POST" })
    .then((response) => response.ok)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const options = {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  };
  let response = await fetch(url, options);
  if (response.status === 401 && !url.startsWith("/api/v1/auth/") && await refreshSession()) {
    response = await fetch(url, options);
  }
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === null) {
    throw new Error(payload.error ?? "İstek tamamlanamadı");
  }
  return payload.data;
}

export function useGetCases(initialData?: TransactionCase[]) {
  return useQuery({ queryKey: ["cases"], queryFn: () => request<TransactionCase[]>("/api/v1/cases"), initialData, staleTime: 30_000 });
}

export function useGetCase(id: string | null, initialData?: TransactionCase) {
  return useQuery({ queryKey: ["cases", id], queryFn: () => request<TransactionCase>(`/api/v1/cases/${id}`), enabled: Boolean(id), initialData, staleTime: 30_000 });
}

export function useApproveTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DecisionRequest & { id: string }) => request<TransactionCase>(`/api/v1/cases/${id}/decision`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["cases", data.case_id], data);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cases"] }),
        queryClient.invalidateQueries({ queryKey: ["game-profile"] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
        queryClient.invalidateQueries({ queryKey: ["supervisor-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["analyst-performance"] }),
      ]);
      // ponytail: one delayed refresh covers RabbitMQ eventual consistency; replace with SSE only if needed.
      setTimeout(() => void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["game-profile"] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      ]), 1_000);
    },
  });
}

export function useStartReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<TransactionCase>(`/api/v1/cases/${id}/actions/start-review`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(["cases", data.case_id], data);
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useAssignCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AssignmentRequest & { id: string }) => request<TransactionCase>(`/api/v1/cases/${id}/assignment`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["cases", data.case_id], data);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cases"] }),
        queryClient.invalidateQueries({ queryKey: ["supervisor-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["analyst-performance"] }),
      ]);
    },
  });
}

export function useGetGameProfile(userId: string, initialData?: GamificationProfile) {
  return useQuery({ queryKey: ["game-profile", userId], queryFn: () => request<GamificationProfile>(`/api/v1/game/profile/${userId}`), initialData, staleTime: 300_000 });
}

export function useGetSupervisorMetrics(initialData?: SupervisorMetrics) {
  return useQuery({ queryKey: ["supervisor-metrics"], queryFn: () => request<SupervisorMetrics>("/api/v1/metrics/supervisor"), initialData, staleTime: 60_000 });
}

export function useGetAnalystPerformance(initialData?: AnalystPerformance[]) {
  return useQuery({ queryKey: ["analyst-performance"], queryFn: () => request<AnalystPerformance[]>("/api/v1/analysts/performance"), initialData, staleTime: 60_000 });
}

export function useGetLeaderboard(initialData?: LeaderboardEntry[]) {
  return useQuery({ queryKey: ["leaderboard"], queryFn: () => request<LeaderboardEntry[]>("/api/v1/game/leaderboard"), initialData, staleTime: 60_000 });
}

export function useSimulateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionSimulationRequest) => request<TransactionSimulationResult>("/api/v1/transactions/simulate", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cases"] }),
      queryClient.invalidateQueries({ queryKey: ["supervisor-metrics"] }),
    ]),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => request<LoginResult>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.clear(),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<{ logged_out: boolean }>("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => queryClient.clear(),
  });
}
