import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { StatusBadge } from "../components/StatusBadge";
import type { OperationsDashboard } from "../types";

const COLORS = ["#2563eb", "#7c3aed", "#ea580c", "#dc2626", "#059669"];

export function SupervisorPage() {
  const { api, user } = useAuth();
  const queryClient = useQueryClient();
  const [analystByCase, setAnalystByCase] = useState<Record<string, string>>({});
  const dashboard = useQuery({
    queryKey: ["dashboard", "operations"],
    queryFn: () => api.request<OperationsDashboard>("/api/v1/dashboard/operations"),
    refetchInterval: 30_000,
  });
  const assign = useMutation({
    mutationFn: ({ caseId, analystId, version }: { caseId: string; analystId: string; version: number }) =>
      api.request(`/api/v1/cases/${caseId}/assignments`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ analyst_id: analystId, version, reason: "Süpervizör manuel kuyruk ataması", override_capacity: true }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Süpervizör</p><h1>Operasyon merkezi</h1></div>
        {dashboard.data && <span className={dashboard.data.stale ? "stale-indicator" : "fresh-indicator"}>{dashboard.data.stale ? "Gecikmeli veri" : "Güncel"} · {new Date(dashboard.data.generated_at).toLocaleTimeString("tr-TR")}</span>}
      </header>
      <AsyncState loading={dashboard.isLoading} error={dashboard.error} retry={() => void dashboard.refetch()}>
        {dashboard.data && (
          <>
            {dashboard.data.partial_sources.length > 0 && <div className="alert alert-warning">Kısmi veri: {dashboard.data.partial_sources.join(", ")}</div>}
            <section className="metric-grid">
              <article className="metric"><span>SLA uyumu</span><strong>{dashboard.data.sla_compliance_rate.toFixed(1)}%</strong></article>
              <article className="metric danger"><span>Aktif SLA aşımı</span><strong>{dashboard.data.active_sla_breaches}</strong></article>
              <article className="metric"><span>AI doğruluğu</span><strong>{dashboard.data.ai_accuracy === null ? "N/A" : `${dashboard.data.ai_accuracy.toFixed(1)}%`}</strong></article>
              <article className="metric"><span>Yanlış pozitif</span><strong>{dashboard.data.false_positive_rate === null ? "N/A" : `${dashboard.data.false_positive_rate.toFixed(1)}%`}</strong></article>
            </section>
            <section className="chart-grid">
              <article className="panel"><h2>Dolandırıcılık türleri</h2><div className="chart"><ResponsiveContainer><PieChart><Pie data={dashboard.data.fraud_type_distribution} dataKey="value" nameKey="name" outerRadius={95} label>{dashboard.data.fraud_type_distribution.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div></article>
              <article className="panel"><h2>Risk dağılımı</h2><div className="chart"><ResponsiveContainer><BarChart data={dashboard.data.risk_distribution}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="value" fill="#2563eb" /></BarChart></ResponsiveContainer></div></article>
            </section>
            <section className="panel"><h2>Kategori bazlı AI doğruluğu</h2><div className="table-wrap"><table><thead><tr><th>Kategori</th><th>Doğruluk</th><th>Örnek</th></tr></thead><tbody>{dashboard.data.category_accuracy.map((row) => <tr key={row.category}><td><StatusBadge value={row.category} /></td><td>{row.accuracy.toFixed(1)}%</td><td>{row.sample_size}</td></tr>)}</tbody></table></div></section>
            <section className="panel"><h2>Analist performansı</h2><div className="table-wrap"><table><thead><tr><th>Analist</th><th>Karar</th><th>Ort. süre</th><th>Doğruluk</th></tr></thead><tbody>{dashboard.data.analyst_performance.map((row) => <tr key={row.analyst_id}><td>{row.name}</td><td>{row.decision_count}</td><td>{row.average_minutes.toFixed(1)} dk</td><td>{row.accuracy === null ? "N/A" : `${row.accuracy.toFixed(1)}%`}</td></tr>)}</tbody></table></div></section>
            <section className="panel"><h2>Manuel inceleme kuyruğu</h2><AsyncState loading={false} error={null} empty={dashboard.data.manual_queue.length === 0} emptyMessage="Manuel kuyruk boş."><div className="queue-list">{dashboard.data.manual_queue.map((item) => <article key={item.id} className="queue-row"><div><strong>{item.transaction.transaction_number}</strong><StatusBadge value={item.risk_level} /><small>{item.transaction.amount} {item.transaction.currency} · {item.transaction.city}</small></div>{user?.role === "SUPERVISOR" && <div className="inline-form"><input aria-label={`${item.transaction.transaction_number} analist UUID`} placeholder="Analist UUID" value={analystByCase[item.id] ?? ""} onChange={(event) => setAnalystByCase({ ...analystByCase, [item.id]: event.target.value })} /><button disabled={!analystByCase[item.id] || assign.isPending} onClick={() => assign.mutate({ caseId: item.id, analystId: analystByCase[item.id]!, version: item.version })}>Ata</button></div>}</article>)}</div></AsyncState>{assign.error && <div className="alert alert-error">{assign.error.message}</div>}</section>
          </>
        )}
      </AsyncState>
    </>
  );
}
