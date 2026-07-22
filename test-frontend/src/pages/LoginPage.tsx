import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../types";

const HOME: Record<Role, string> = {
  CUSTOMER: "/customer",
  ANALYST: "/analyst",
  SUPERVISOR: "/supervisor",
  ADMIN: "/admin",
};

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"customer" | "staff">("customer");
  const [gsm, setGsm] = useState("+905551111111");
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (auth.user) return <Navigate to={HOME[auth.user.role]} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "customer") await auth.loginCustomer(gsm, otp);
      else await auth.loginStaff(email, password);
      const user = auth.user;
      navigate(user ? HOME[user.role] : "/", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Giriş tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand brand-login"><span className="brand-mark">FC</span>FraudCell</div>
        <h1 id="login-title">Güvenli işlem merkezi</h1>
        <p>Rolünüze uygun güvenli giriş yöntemini kullanın.</p>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "customer"} onClick={() => setMode("customer")}>Müşteri</button>
          <button role="tab" aria-selected={mode === "staff"} onClick={() => setMode("staff")}>Personel</button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          {mode === "customer" ? (
            <>
              <label>GSM<input value={gsm} onChange={(event) => setGsm(event.target.value)} autoComplete="tel" required /></label>
              <label>OTP<input value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required /></label>
            </>
          ) : (
            <>
              <label>E-posta<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
              <label>Şifre<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            </>
          )}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button className="button-primary" disabled={busy}>{busy ? "Kontrol ediliyor…" : "Giriş yap"}</button>
        </form>
        <small>Token tarayıcı kalıcı depolamasına yazılmaz.</small>
      </section>
    </main>
  );
}

