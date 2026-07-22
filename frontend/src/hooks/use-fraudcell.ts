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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success || payload.data === null) {
    throw new Error(payload.error?.message ?? "İstek tamamlanamadı");
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
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useAssignCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AssignmentRequest & { id: string }) => request<TransactionCase>(`/api/v1/cases/${id}/assignment`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cases"] }),
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cases"] }),
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
