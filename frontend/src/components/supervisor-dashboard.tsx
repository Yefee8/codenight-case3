"use client";

import { useState } from "react";
import { Activity, Bot, ClockAlert, Gauge, Save, Send } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { RiskBadge, StatusBadge } from "@/components/case-badges";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, Skeleton } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAssignCase, useGetAnalystPerformance, useGetCases, useGetSupervisorMetrics, useOverrideRiskLevel } from "@/hooks/use-fraudcell";
import { fraudLabels } from "@/lib/domain-labels";
import { money } from "@/lib/utils";
import type { AnalystPerformance, FraudType, RiskLevel, SupervisorMetrics, TransactionCase } from "@/types/domain";

const chartColors = ["#2f7dfa", "#22cddb", "#f97316", "#eab308", "#22c55e", "#94a3b8"];
const riskLevels: RiskLevel[] = ["DUSUK", "ORTA", "YUKSEK", "KRITIK"];

/** Hydrates live controls from SSR data, then lets TanStack Query own revalidation. */
export function SupervisorDashboard({ initialMetrics, initialPerformance, initialCases, canAssign }: { initialMetrics: SupervisorMetrics; initialPerformance: AnalystPerformance[]; initialCases: TransactionCase[]; canAssign: boolean }) {
  const metrics = useGetSupervisorMetrics(initialMetrics);
  const performance = useGetAnalystPerformance(initialPerformance);
  const cases = useGetCases(initialCases);
  const assign = useAssignCase();
  const overrideRisk = useOverrideRiskLevel();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [riskSelections, setRiskSelections] = useState<Record<string, RiskLevel>>({});
  const [riskReasons, setRiskReasons] = useState<Record<string, string>>({});
  const unassigned = cases.data?.filter((item) => item.status === "YENI" && item.assigned_analyst_id === null) ?? [];
  const hasCases = Boolean(cases.data?.length);
  const distribution = Object.entries(metrics.data?.fraud_distribution ?? {}).map(([key, value]) => ({ name: fraudLabels[key as FraudType | "BELIRSIZ"], value }));

  async function assignCase(id: string) {
    const analyst_id = selections[id];
    if (!analyst_id) return;
    try {
      await assign.mutateAsync({ id, analyst_id });
      toast.success("Vaka analiste atandı");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Atama tamamlanamadı");
    }
  }

  async function saveRisk(id: string) {
    const risk_level = riskSelections[id];
    const reason = riskReasons[id]?.trim();
    if (!risk_level || !reason) return;
    try {
      await overrideRisk.mutateAsync({ id, risk_level, reason });
      toast.success("Risk seviyesi güncellendi");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Risk güncellenemedi");
    }
  }

  return (
    <>
      <PageHeading eyebrow="Supervisor Control" title="Operasyon sağlığı" description="SLA, AI erişilebilirliği ve ekip kapasitesini tek görünümden izleyin." action={<div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"><Activity size={14} className="text-emerald-500" /> Canlı</div>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Gauge />} label="SLA uyumu" value={metrics.data && hasCases ? `%${metrics.data.sla_compliance_rate}` : "—"} />
        <MetricCard icon={<Bot />} label="AI kullanılabilirliği" value={metrics.data && hasCases ? `%${metrics.data.ai_accuracy_rate}` : "—"} />
        <MetricCard icon={<ClockAlert />} label="Geciken vaka" value={metrics.data?.active_overdue_cases ?? "—"} alert />
        <MetricCard icon={<Activity />} label="Atanmamış vaka" value={unassigned.length} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>Fraud dağılımı</CardTitle><p className="mt-1 text-xs text-muted-foreground">Kayıtlı vakaların yüzde dağılımı</p></CardHeader>
          <CardContent>
            {metrics.isLoading ? <Skeleton className="h-64" /> : <div className="grid items-center sm:grid-cols-[1fr_180px] lg:grid-cols-1 xl:grid-cols-[1fr_180px]">
              <div className="h-64" aria-label="Dolandırıcılık türleri pasta grafiği">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={distribution} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={3}>{distribution.map((item, index) => <Cell key={item.name} fill={chartColors[index]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, background: "var(--surface)", borderColor: "var(--border)" }} /></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">{distribution.map((item, index) => <div key={item.name} className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><i className="size-2 rounded-full" style={{ background: chartColors[index] }} />{item.name}</span><strong>%{item.value}</strong></div>)}</div>
            </div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{canAssign ? "Manuel vaka atama" : "Tüm vakalar · salt okunur"}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{canAssign ? "Belirsiz/atanmamış kuyruk (`YENI`)" : "Admin kayıt görünümü"}</p></CardHeader>
          <CardContent className="space-y-3">
            {!canAssign ? cases.isLoading ? <Skeleton className="h-48" /> : cases.data?.length ? cases.data.map((item) => <div key={item.case_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="min-w-0"><strong className="font-mono text-xs">{item.case_id}</strong><p className="truncate text-xs text-muted-foreground">{item.transaction_details.receiver} · {money.format(item.transaction_details.amount)}</p></div><div className="flex gap-2"><RiskBadge risk={item.risk_level} /><StatusBadge status={item.status} /></div></div>) : <p className="rounded-xl bg-muted p-8 text-center text-sm text-muted-foreground">Kayıtlı vaka yok.</p> : cases.isLoading ? <Skeleton className="h-48" /> : unassigned.length === 0 ? <p className="rounded-xl bg-muted p-8 text-center text-sm text-muted-foreground">Atama bekleyen vaka yok.</p> : unassigned.map((item) => (
              <div key={item.case_id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_170px_auto] sm:items-center">
                <div className="min-w-0"><div className="mb-1 flex items-center gap-2"><strong className="font-mono text-xs">{item.case_id}</strong><RiskBadge risk={item.risk_level} /></div><p className="truncate text-xs text-muted-foreground">{item.transaction_details.receiver} · {money.format(item.transaction_details.amount)}</p></div>
                <Select aria-label={`${item.case_id} için analist`} value={selections[item.case_id] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [item.case_id]: event.target.value }))}>
                  <option value="">Analist seçin</option>{performance.data?.map(({ analyst }) => <option key={analyst.user_id} value={analyst.user_id}>{analyst.full_name}</option>)}
                </Select>
                <Button size="icon" aria-label="Vakayı ata" loading={assign.isPending && assign.variables?.id === item.case_id} disabled={!selections[item.case_id] || assign.isPending} onClick={() => assignCase(item.case_id)}><Send size={16} /></Button>
              </div>
            ))}
            {canAssign && cases.data?.length ? <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">AI risk düzeltme</p>
              <div className="space-y-2">{cases.data.map((item) => (
                <div key={`risk-${item.case_id}`} className="grid gap-2 rounded-xl bg-muted p-3 lg:grid-cols-[1fr_120px_1fr_auto] lg:items-center">
                  <div className="min-w-0"><strong className="font-mono text-xs">{item.case_id}</strong><p className="truncate text-xs text-muted-foreground">Mevcut risk: {item.risk_level}{item.risk_override ? ` · ${item.risk_override.reason}` : ""}</p></div>
                  <Select aria-label={`${item.case_id} risk seviyesi`} value={riskSelections[item.case_id] ?? item.risk_level} onChange={(event) => setRiskSelections((current) => ({ ...current, [item.case_id]: event.target.value as RiskLevel }))}>{riskLevels.map((risk) => <option key={risk} value={risk}>{risk}</option>)}</Select>
                  <Input placeholder="Gerekçe" value={riskReasons[item.case_id] ?? ""} onChange={(event) => setRiskReasons((current) => ({ ...current, [item.case_id]: event.target.value }))} />
                  <Button size="icon" variant="outline" aria-label="Riski kaydet" loading={overrideRisk.isPending && overrideRisk.variables?.id === item.case_id} disabled={!riskReasons[item.case_id]?.trim()} onClick={() => saveRisk(item.case_id)}><Save size={15} /></Button>
                </div>
              ))}</div>
            </div> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Analist performansı</CardTitle><p className="mt-1 text-xs text-muted-foreground">Karar süresi ve SLA verileri</p></CardHeader>
        <CardContent className="px-0 pb-1">
          {performance.isLoading ? <div className="px-5"><Skeleton className="h-48" /></div> : <Table>
            <TableHeader><TableRow><TableHead>Analist</TableHead><TableHead>İncelediği türler</TableHead><TableHead>Karar</TableHead><TableHead>Ort. süre</TableHead><TableHead>SLA içinde</TableHead></TableRow></TableHeader>
            <TableBody>{performance.data?.map((item) => <TableRow key={item.analyst.user_id}><TableCell><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-brand-soft font-semibold text-brand">{item.analyst.full_name.split(" ").map((part) => part[0]).join("")}</span><strong>{item.analyst.full_name}</strong></div></TableCell><TableCell className="text-xs text-muted-foreground">{item.analyst.specialties?.length ? item.analyst.specialties.map((value) => fraudLabels[value]).join(", ") : "—"}</TableCell><TableCell>{item.decisions_made}</TableCell><TableCell>{item.decisions_made ? `${item.average_decision_minutes} dk` : "—"}</TableCell><TableCell><span className="font-semibold text-emerald-600">{item.decisions_made ? `%${item.accuracy_rate}` : "—"}</span></TableCell></TableRow>)}</TableBody>
          </Table>}
        </CardContent>
      </Card>
    </>
  );
}

function MetricCard({ icon, label, value, alert }: { icon: React.ReactNode; label: string; value: React.ReactNode; alert?: boolean }) {
  return <Card><CardContent className="flex items-center gap-4 py-4"><span className={`grid size-10 place-items-center rounded-xl ${alert ? "bg-red-500/10 text-red-500" : "bg-brand-soft text-brand"}`}>{icon}</span><div><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}
