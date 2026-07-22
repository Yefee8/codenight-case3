import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";

import { ApiClient } from "../api/client";
import type { AuthResult, CurrentUser } from "../types";

interface AuthContextValue {
  accessToken: string | null;
  user: CurrentUser | null;
  api: ApiClient;
  loginStaff(email: string, password: string): Promise<void>;
  loginCustomer(gsm: string, otpCode: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const authRef = useRef<AuthResult | null>(null);

  const writeAuth = useCallback((next: AuthResult | null) => {
    authRef.current = next;
    setAuth(next);
  }, []);

  const api = useMemo(
    () => new ApiClient(() => authRef.current?.access_token ?? null, writeAuth),
    [writeAuth],
  );

  const loginStaff = useCallback(
    async (email: string, password: string) => {
      const result = await api.request<AuthResult>(
        "/api/v1/auth/staff/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
        false,
      );
      writeAuth(result);
    },
    [api, writeAuth],
  );

  const loginCustomer = useCallback(
    async (gsm: string, otpCode: string) => {
      const result = await api.request<AuthResult>(
        "/api/v1/auth/customers/login",
        { method: "POST", body: JSON.stringify({ gsm, otp_code: otpCode }) },
        false,
      );
      writeAuth(result);
    },
    [api, writeAuth],
  );

  const logout = useCallback(async () => {
    try {
      await api.request<unknown>("/api/v1/auth/logout", { method: "POST" }, false);
    } finally {
      writeAuth(null);
    }
  }, [api, writeAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: auth?.access_token ?? null,
      user: auth?.user ?? null,
      api,
      loginStaff,
      loginCustomer,
      logout,
    }),
    [api, auth, loginCustomer, loginStaff, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

