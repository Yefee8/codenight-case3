import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "../auth/AuthContext";
import { server } from "../test/server";
import { LoginPage } from "./LoginPage";
import type { AuthResult } from "../types";

const BASE = "http://localhost:8080";

function Home() {
  const { user } = useAuth();
  return <div>Hoş geldin {user?.first_name} · {user?.role}</div>;
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Home />} />
          <Route path="/analyst" element={<Home />} />
          <Route path="/customer" element={<Home />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function result(role: "ANALYST" | "CUSTOMER"): AuthResult {
  return {
    access_token: "access",
    expires_in: 900,
    user: { id: "u1", first_name: "Mert", last_name: "Test", role, specialties: [], regions: [] },
  };
}

describe("LoginPage", () => {
  it("personel girişini yapar ve tokenı context memory'ye koyar", async () => {
    server.use(http.post(`${BASE}/api/v1/auth/staff/login`, async ({ request }) => {
      const body = await request.json() as Record<string, string>;
      expect(body).toEqual({ email: "analyst@example.com", password: "Secret!1" });
      return HttpResponse.json({ success: true, data: result("ANALYST"), error: null, request_id: crypto.randomUUID() });
    }));
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("tab", { name: "Personel" }));
    await user.type(screen.getByLabelText("E-posta"), "analyst@example.com");
    await user.type(screen.getByLabelText("Şifre"), "Secret!1");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));

    expect(await screen.findByText(/Hoş geldin Mert · ANALYST/)).toBeInTheDocument();
  });

  it("müşteri hatasını güvenli mesajla gösterir", async () => {
    server.use(http.post(`${BASE}/api/v1/auth/customers/login`, () => HttpResponse.json(
      { success: false, data: null, error: { code: "OTP_INVALID", message: "Kod geçersiz veya süresi dolmuş." }, request_id: crypto.randomUUID() },
      { status: 401 },
    )));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("OTP"), "0000");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Kod geçersiz veya süresi dolmuş.");
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });
});

