import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { server } from "./test/server";
import type { AuthResult, CurrentUser, OperationsDashboard, RiskCase, Role, TransactionRecord } from "./types";

const BASE = "http://localhost:8080";

function auth(role: Role): AuthResult {
  const user: CurrentUser = { id: `${role.toLowerCase()}-1`, first_name: "Demo", last_name: role, role, specialties: ["CALINTI_KART"], regions: ["Marmara"] };
  return { access_token: `${role}-token`, expires_in: 900, user };
}

const transaction: TransactionRecord = {
  id: "tx-1", transaction_number: "TRX-2026-00000001", amount: "25000.00", currency: "TRY", transaction_type: "TRANSFER", recipient: "Yeni alıcı", city: "Berlin", country_code: "DE", occurred_at: "2026-07-22T02:00:00Z", prediction_status: "AVAILABLE", risk_score: 0.95, risk_level: "KRITIK", fraud_type: "CALINTI_KART", decision: "BLOK", model_version: "risk-2026.1", reason_codes: ["FOREIGN_LOCATION", "NEW_DEVICE"], case_id: "case-1", case_status: "ATANDI",
};
const riskCase: RiskCase = {
  id: "case-1", transaction, customer_id: "customer-1", assigned_analyst_id: "analyst-1", status: "ATANDI", risk_level: "KRITIK", fraud_type: "CALINTI_KART", raw_ai_score: 0.95, effective_score: 0.95, hold_status: "TEMPORARY_BLOCKED", due_at: "2099-07-22T10:00:00Z", created_at: "2026-07-22T09:00:00Z", version: 1, customer_verification: null,
};

function commonHandlers(role: Role) {
  server.use(
    http.post(`${BASE}/api/v1/auth/staff/login`, () => HttpResponse.json({ success: true, data: auth(role), error: null, request_id: crypto.randomUUID() })),
    http.post(`${BASE}/api/v1/auth/customers/login`, () => HttpResponse.json({ success: true, data: auth("CUSTOMER"), error: null, request_id: crypto.randomUUID() })),
    http.get(`${BASE}/api/v1/notifications/stream`, () => new HttpResponse("", { headers: { "Content-Type": "text/event-stream" } })),
    http.get(`${BASE}/api/v1/game/notifications/stream`, () => new HttpResponse("", { headers: { "Content-Type": "text/event-stream" } })),
  );
}

async function login(role: Role) {
  commonHandlers(role);
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);
  if (role === "CUSTOMER") {
    await user.type(screen.getByLabelText("OTP"), "1234");
  } else {
    await user.click(screen.getByRole("tab", { name: "Personel" }));
    await user.type(screen.getByLabelText("E-posta"), `${role.toLowerCase()}@example.com`);
    await user.type(screen.getByLabelText("Şifre"), "Secret!1");
  }
  await user.click(screen.getByRole("button", { name: "Giriş yap" }));
  return user;
}

describe("dört rolün temel UI akışları", () => {
  it("customer risk preset'i kullanır ve idempotent transaction oluşturur", async () => {
    let receivedKey = "";
    let receivedBody: Record<string, unknown> = {};
    server.use(
      http.get(`${BASE}/api/v1/transactions`, () => HttpResponse.json({ success: true, data: { items: [transaction], page: 0, size: 20, total: 1 }, error: null, request_id: crypto.randomUUID() })),
      http.post(`${BASE}/api/v1/transactions`, async ({ request }) => {
        receivedKey = request.headers.get("Idempotency-Key") ?? "";
        receivedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: transaction, error: null, request_id: crypto.randomUUID() }, { status: 201 });
      }),
    );
    const user = await login("CUSTOMER");
    expect(await screen.findByRole("heading", { name: "İşlemlerim" })).toBeInTheDocument();
    expect(await screen.findByText("TRX-2026-00000001")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Riskli demo preset'i" }));
    expect(screen.getByLabelText("Ülke kodu")).toHaveValue("DE");
    await user.click(screen.getByRole("button", { name: "İşlemi oluştur" }));

    await screen.findByText("TRX-2026-00000001");
    expect(receivedKey.length).toBeGreaterThan(10);
    expect(receivedBody).toMatchObject({ amount: "25000.00", country_code: "DE", transaction_type: "TRANSFER" });
  });

  it("analyst case detayını açar ve incelemeyi başlatır", async () => {
    server.use(
      http.get(`${BASE}/api/v1/cases`, () => HttpResponse.json({ success: true, data: { items: [riskCase], page: 0, size: 50, total: 1 }, error: null, request_id: crypto.randomUUID() })),
      http.post(`${BASE}/api/v1/cases/case-1/actions/start-review`, async ({ request }) => {
        expect(await request.json()).toMatchObject({ version: 1 });
        return HttpResponse.json({ success: true, data: { ...riskCase, status: "INCELENIYOR", version: 2 }, error: null, request_id: crypto.randomUUID() });
      }),
    );
    const user = await login("ANALYST");
    expect(await screen.findByRole("heading", { name: "Atanan vakalar" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /TRX-2026-00000001/ }));
    expect(screen.getByText("95.0%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "İncelemeyi başlat" }));
    expect(await screen.findByText("INCELENIYOR")).toBeInTheDocument();
  });

  it("supervisor zorunlu dashboard metrikleri ve manuel kuyruğu görür", async () => {
    const dashboard: OperationsDashboard = {
      generated_at: "2026-07-22T10:00:00Z", stale: false, partial_sources: [], fraud_type_distribution: [{ name: "CALINTI_KART", value: 4 }], risk_distribution: [{ name: "KRITIK", value: 2 }], sla_compliance_rate: 92.5, active_sla_breaches: 1, ai_accuracy: 88.2, false_positive_rate: 3.1, category_accuracy: [{ category: "CALINTI_KART", accuracy: 90, sample_size: 40 }], analyst_performance: [{ analyst_id: "analyst-1", name: "Ada Analyst", decision_count: 12, average_minutes: 8.5, accuracy: 91 }], manual_queue: [{ ...riskCase, assigned_analyst_id: null, status: "YENI" }],
    };
    server.use(http.get(`${BASE}/api/v1/dashboard/operations`, () => HttpResponse.json({ success: true, data: dashboard, error: null, request_id: crypto.randomUUID() })));
    await login("SUPERVISOR");
    expect(await screen.findByRole("heading", { name: "Operasyon merkezi" })).toBeInTheDocument();
    expect(await screen.findByText("92.5%")).toBeInTheDocument();
    expect(screen.getByText("Kategori bazlı AI doğruluğu")).toBeInTheDocument();
    expect(screen.getByText("Ada Analyst")).toBeInTheDocument();
    expect(screen.getByLabelText("TRX-2026-00000001 analist UUID")).toBeInTheDocument();
  });

  it("admin personel ve audit sekmelerini görüntüler", async () => {
    server.use(
      http.get(`${BASE}/api/v1/staff`, () => HttpResponse.json({ success: true, data: { items: [{ id: "a1", first_name: "Ada", last_name: "Analyst", email: "ada@example.com", role: "ANALYST", status: "ACTIVE", title: "Fraud Analisti", specialties: ["CALINTI_KART"], regions: ["Marmara"] }], page: 0, size: 50, total: 1 }, error: null, request_id: crypto.randomUUID() })),
      http.get(`${BASE}/api/v1/admin/audit-logs`, () => HttpResponse.json({ success: true, data: { items: [{ id: "log1", actor_id: "admin-1", action: "STAFF_CREATED", result: "SUCCESS", resource_type: "USER", resource_id: "a1", ip_address_masked: "127.0.*.*", occurred_at: "2026-07-22T10:00:00Z" }], page: 0, size: 50, total: 1 }, error: null, request_id: crypto.randomUUID() })),
    );
    const user = await login("ADMIN");
    expect(await screen.findByRole("heading", { name: "Kimlik ve denetim" })).toBeInTheDocument();
    expect(await screen.findByText("Ada Analyst")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Audit log" }));
    expect(await screen.findByText("STAFF_CREATED")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("127.0.*.*")).toBeInTheDocument();
  });
});

