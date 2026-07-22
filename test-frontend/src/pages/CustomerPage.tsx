import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { StatusBadge } from "../components/StatusBadge";
import type { Page, TransactionRecord, TransactionType } from "../types";

interface TransactionForm {
  amount: string;
  transaction_type: TransactionType;
  recipient: string;
  source_device: string;
  city: string;
  country_code: string;
  occurred_at: string;
}

const initialForm: TransactionForm = {
  amount: "250.00",
  transaction_type: "ODEME",
  recipient: "Düzenli fatura",
  source_device: "trusted-mobile",
  city: "İstanbul",
  country_code: "TR",
  occurred_at: new Date().toISOString().slice(0, 16),
};

export function CustomerPage() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);

  const transactions = useQuery({
    queryKey: ["transactions", "mine"],
    queryFn: () => api.request<Page<TransactionRecord>>("/api/v1/transactions?page=0&size=20"),
  });
  const create = useMutation({
    mutationFn: () =>
      api.request<TransactionRecord>("/api/v1/transactions", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...form, amount: form.amount, occurred_at: new Date(form.occurred_at).toISOString() }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });
  const verify = useMutation({
    mutationFn: ({ caseId, response }: { caseId: string; response: "CUSTOMER_CONFIRMED" | "CUSTOMER_DENIED" }) =>
      api.request(`/api/v1/cases/${caseId}/customer-verification`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ response }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });
  const feedback = useMutation({
    mutationFn: ({ caseId, score }: { caseId: string; score: number }) =>
      api.request(`/api/v1/cases/${caseId}/feedback`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ score }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });

  function useRiskPreset() {
    const tonight = new Date();
    tonight.setHours(2, 17, 0, 0);
    setForm({
      amount: "25000.00",
      transaction_type: "TRANSFER",
      recipient: "Yeni yurt dışı alıcı",
      source_device: "new-device-demo",
      city: "Berlin",
      country_code: "DE",
      occurred_at: tonight.toISOString().slice(0, 16),
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Müşteri</p><h1>İşlemlerim</h1></div>
        <button className="button-secondary" onClick={useRiskPreset}>Riskli demo preset'i</button>
      </header>
      <section className="panel">
        <h2>Yeni işlem</h2>
        <form className="form-grid" onSubmit={(event) => submit(event)}>
          <label>Tutar<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
          <label>İşlem tipi<select value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value as TransactionType })}>{["ODEME", "TRANSFER", "FATURA", "CEKIM"].map((type) => <option key={type}>{type}</option>)}</select></label>
          <label>Alıcı<input maxLength={200} value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} required /></label>
          <label>Cihaz<input maxLength={100} value={form.source_device} onChange={(e) => setForm({ ...form, source_device: e.target.value })} required /></label>
          <label>Şehir<input maxLength={100} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required /></label>
          <label>Ülke kodu<input pattern="[A-Z]{2}" maxLength={2} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value.toUpperCase() })} required /></label>
          <label>Zaman<input type="datetime-local" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} required /></label>
          <button className="button-primary" disabled={create.isPending}>{create.isPending ? "Analiz ediliyor…" : "İşlemi oluştur"}</button>
        </form>
        {create.error && <div className="alert alert-error" role="alert">{create.error.message}</div>}
      </section>

      <section className="panel">
        <h2>Geçmiş</h2>
        <AsyncState loading={transactions.isLoading} error={transactions.error} retry={() => void transactions.refetch()} empty={transactions.data?.items.length === 0}>
          <div className="card-grid">
            {transactions.data?.items.map((item) => (
              <article className="transaction-card" key={item.id}>
                <div className="card-heading"><strong>{item.transaction_number}</strong><StatusBadge value={item.risk_level} /></div>
                <div className="amount">{item.amount} {item.currency}</div>
                <p>{item.transaction_type} · {item.city}/{item.country_code}</p>
                <dl>
                  <div><dt>AI skoru</dt><dd>{item.risk_score === null ? "BELİRSİZ" : `${(item.risk_score * 100).toFixed(1)}%`}</dd></div>
                  <div><dt>Tür</dt><dd><StatusBadge value={item.fraud_type} /></dd></div>
                  <div><dt>Karar</dt><dd><StatusBadge value={item.decision} /></dd></div>
                  <div><dt>Vaka</dt><dd><StatusBadge value={item.case_status} /></dd></div>
                </dl>
                {item.prediction_status === "UNAVAILABLE" && <div className="alert alert-warning">AI erişilemedi; işlem güvenli manuel kuyruğa alındı.</div>}
                {item.case_id && item.case_status === "MUSTERI_DOGRULAMA" && (
                  <div className="button-row">
                    <button onClick={() => verify.mutate({ caseId: item.case_id!, response: "CUSTOMER_CONFIRMED" })}>Bu işlemi ben yaptım</button>
                    <button className="button-danger" onClick={() => verify.mutate({ caseId: item.case_id!, response: "CUSTOMER_DENIED" })}>Ben yapmadım</button>
                  </div>
                )}
                {item.case_id && item.case_status === "KAPANDI" && (
                  <div className="rating" aria-label="Süreç puanı">
                    {[1, 2, 3, 4, 5].map((score) => <button key={score} aria-label={`${score} yıldız`} onClick={() => feedback.mutate({ caseId: item.case_id!, score })}>★</button>)}
                  </div>
                )}
              </article>
            ))}
          </div>
        </AsyncState>
      </section>
    </>
  );
}

