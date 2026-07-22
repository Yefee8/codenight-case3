import type { ApiResponse } from "@/types/domain";

export function apiSuccess<T>(data: T, status = 200) {
  const body: ApiResponse<T> = { success: true, data, error: null };
  return Response.json(body, { status });
}

export function apiError(code: number, message: string) {
  const body: ApiResponse<never> = { success: false, data: null, error: { code, message } };
  return Response.json(body, { status: code });
}
