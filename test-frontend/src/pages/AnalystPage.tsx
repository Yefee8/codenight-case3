import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { StatusBadge } from "../components/StatusBadge";
import { useSse } from "../hooks/useSse";
import type { FraudType, Page, RiskCase } from "../types";

const FRAUD_TYPES: FraudType[] = ["CALINTI_KART", "HESAP_ELE_GECIRME", "PARA_AKLAMA", "SUPHELI_DAVRANIS", "TEMIZ"];

function remaining(dueAt: string): string {
  const milliseconds = new Date(dueAt).getTime() - Date.now();
  if (milliseconds <= 0) return "SLA AŞILDI";
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${minutes} dk`;
}

export function AnalystPage() {
  const { api, accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<RiskCase | null>(null);
  const [note, setNote] = useState("");
  const [overrideType, setOverrideType] = useState<FraudType>("SUPHELI_DAVRANIS");

  const cases = useQuery({
    queryKey: ["cases", "assigned"],
    queryFn: () => api.request<Page<RiskCase>>("/api/v1/cases?scope=assigned&page=0&size=50&sort=risk,desc&sort=dueAt,asc"),
  });
  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: ["cases"] }), [queryClient]);
  useSse("/api/v1/notifications/stream", accessToken, refresh);

  const action = useMutation({
    mutationFn: ({ caseId, name, version, body = {} }: { caseId: string; name: string; version: number; body?: object }) =>
      api.request<RiskCase>(`/api/v1/cases/${caseId}/actions/${name}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...body, version }),
      }),
    onSuccess: (updated) => { setSelected(updated); refresh(); },
  });
  const override = useMutation({
    mutationFn: ({ caseId, version }: { caseId: string; version: number }) =>
      api.request<RiskCase>(`/api/v1/cases/${caseId}/fraud-type`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ fraud_type: overrideType, reason: "Analist inceleme bulgusu", version }),
      }),
    onSuccess: (updated) => { setSelected(updated); refresh(); },
  });
  const decision = useMutation({
    mutationFn: ({ caseId, version, value }: { caseId: string; version: number; value: "ONAYLANDI" | "BLOKLANDI" }) =>
      api.request<RiskCase>(`/api/v1/cases/${caseId}/decision`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ decision: value, note, version }),
      }),
    onSuccess: () => { setSelected(null); setNote(""); refresh(); },
  });

  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Fraud Analisti</p><h1>Atanan vakalar</h1></div><span className="live-indicator">● Canlı</span></header>
      <div className="split-view">
        <section className="panel case-list" aria-label="Atanan vaka listesi">
          <AsyncState loading={cases.isLoading} error={cases.error} retry={() => void cases.refetch()} empty={cases.data?.items.length === 0}>
            {cases.data?.items.map((riskCase) => (
              <button className={`case-row ${selected?.id === riskCase.id ? "selected" : ""}`} key={riskCase.id} onClick={() => setSelected(riskCase)}>
                <div><strong>{riskCase.transaction.transaction_number}</strong><small>{riskCase.transaction.amount} {riskCase.transaction.currency}</small></div>
                <div><StatusBadge value={riskCase.risk_level} /><span className={remaining(riskCase.due_at) === "SLA AŞILDI" ? "sla-breach" : ""}>{remaining(riskCase.due_at)}</span></div>
              </button>
            ))}
          </AsyncState>
        </section>
        <section className="panel case-detail" aria-live="polite">
          {!selected ? <div className="empty-state">İncelemek için bir vaka seçin.</div> : (
            <>
              <div className="card-heading"><h2>{selected.transaction.transaction_number}</h2><StatusBadge value={selected.status} /></div>
              <div className="score-block"><span>AI risk skoru</span><strong>{selected.raw_ai_score === null ? "BELİRSİZ" : `${(selected.raw_ai_score * 100).toFixed(1)}%`}</strong><small>Efektif: {selected.effective_score === null ? "—" : `${(selected.effective_score * 100).toFixed(1)}%`}</small></div>
              <dl className="detail-list">
                <div><dt>AI türü</dt><dd><StatusBadge value={selected.transaction.fraud_type} /></dd></div>
                <div><dt>Efektif tür</dt><dd><StatusBadge value={selected.fraud_type} /></dd></div>
                <div><dt>Müşteri yanıtı</dt><dd><StatusBadge value={selected.customer_verification} /></dd></div>
                <div><dt>SLA</dt><dd>{remaining(selected.due_at)}</dd></div>
                <div><dt>Alıcı</dt><dd>{selected.transaction.recipient}</dd></div>
                <div><dt>Konum</dt><dd>{selected.transaction.city}/{selected.transaction.country_code}</dd></div>
              </dl>
              {selected.transaction.reason_codes.length > 0 && <ul className="reason-list">{selected.transaction.reason_codes.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
              <div className="button-row">
                {selected.status === "ATANDI" && <button className="button-primary" onClick={() => action.mutate({ caseId: selected.id, name: "start-review", version: selected.version })}>İncelemeyi başlat</button>}
                {selected.status === "INCELENIYOR" && <button onClick={() => action.mutate({ caseId: selected.id, name: "request-customer-verification", version: selected.version })}>Müşteri doğrulaması iste</button>}
              </div>
              {selected.status === "INCELENIYOR" && (
                <>
                  <div className="inline-form"><select value={overrideType} onChange={(e) => setOverrideType(e.target.value as FraudType)}>{FRAUD_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button onClick={() => override.mutate({ caseId: selected.id, version: selected.version })}>Türü güncelle</button></div>
                  <label>Karar notu<textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Özellikle blok kararında bulguyu yazın" /></label>
                  <div className="button-row"><button className="button-primary" disabled={!note.trim()} onClick={() => decision.mutate({ caseId: selected.id, version: selected.version, value: "ONAYLANDI" })}>Onayla</button><button className="button-danger" disabled={!note.trim()} onClick={() => decision.mutate({ caseId: selected.id, version: selected.version, value: "BLOKLANDI" })}>Blokla</button></div>
                </>
              )}
              {(action.error || override.error || decision.error) && <div className="alert alert-error" role="alert">{(action.error ?? override.error ?? decision.error)?.message}</div>}
            </>
          )}
        </section>
      </div>
    </>
  );
}
