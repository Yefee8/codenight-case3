"use client";

import { useState } from "react";
import { Activity, Bot, ClockAlert, Gauge, Send } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { RiskBadge } from "@/components/case-badges";
import { Button, Card, CardContent, CardHeader, CardTitle, Select, Skeleton } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAssignCase, useGetAnalystPerformance, useGetCases, useGetSupervisorMetrics } from "@/hooks/use-fraudcell";
import { fraudLabels } from "@/lib/domain-labels";
import { money } from "@/lib/utils";
import type { AnalystPerformance, FraudType, SupervisorMetrics, TransactionCase } from "@/types/domain";

const chartColors = ["#2f7dfa", "#22cddb", "#f97316", "#eab308", "#22c55e"];

/** Hydrates live controls from SSR data, then lets TanStack Query own revalidation. */
export function SupervisorDashboard({ initialMetrics, initialPerformance, initialCases }: { initialMetrics: SupervisorMetrics; initialPerformance: AnalystPerformance[]; initialCases: TransactionCase[] }) {
  const metrics = useGetSupervisorMetrics(initialMetrics);
  const performance = useGetAnalystPerformance(initialPerformance);
  const cases = useGetCases(initialCases);
  const assign = useAssignCase();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const unassigned = cases.data?.filter((item) => item.status === "YENI" && item.assigned_analyst_id === null) ?? [];
  const distribution = Object.entries(metrics.data?.fraud_distribution ?? {}).map(([key, value]) => ({ name: fraudLabels[key as FraudType], value }));

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

  return (
    <>
      <PageHeading eyebrow="Supervisor Control" title="Operasyon sağlığı" description="SLA, model doğruluğu ve ekip kapasitesini tek görünümden izleyin." action={<div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"><Activity size={14} className="text-emerald-500" /> Canlı · 22 Tem 2026</div>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Gauge />} label="SLA uyumu" value={metrics.data ? `%${metrics.data.sla_compliance_rate}` : "—"} trend="+2.4%" />
        <MetricCard icon={<Bot />} label="AI doğruluğu" value={metrics.data ? `%${metrics.data.ai_accuracy_rate}` : "—"} trend="+1.1%" />
        <MetricCard icon={<ClockAlert />} label="Geciken vaka" value={metrics.data?.active_overdue_cases ?? "—"} alert />
        <MetricCard icon={<Activity />} label="Atanmamış vaka" value={unassigned.length} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>Fraud dağılımı</CardTitle><p className="mt-1 text-xs text-muted-foreground">Son 24 saat · yüzde dağılım</p></CardHeader>
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
          <CardHeader><CardTitle>Manuel vaka atama</CardTitle><p className="mt-1 text-xs text-muted-foreground">Belirsiz/atanmamış kuyruk (`YENI`)</p></CardHeader>
          <CardContent className="space-y-3">
            {cases.isLoading ? <Skeleton className="h-48" /> : unassigned.length === 0 ? <p className="rounded-xl bg-muted p-8 text-center text-sm text-muted-foreground">Atama bekleyen vaka yok.</p> : unassigned.map((item) => (
              <div key={item.case_id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_170px_auto] sm:items-center">
                <div className="min-w-0"><div className="mb-1 flex items-center gap-2"><strong className="font-mono text-xs">{item.case_id}</strong><RiskBadge risk={item.risk_level} /></div><p className="truncate text-xs text-muted-foreground">{item.transaction_details.receiver} · {money.format(item.transaction_details.amount)}</p></div>
                <Select aria-label={`${item.case_id} için analist`} value={selections[item.case_id] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [item.case_id]: event.target.value }))}>
                  <option value="">Analist seçin</option>{performance.data?.map(({ analyst }) => <option key={analyst.user_id} value={analyst.user_id}>{analyst.full_name}</option>)}
                </Select>
                <Button size="icon" aria-label="Vakayı ata" loading={assign.isPending && assign.variables?.id === item.case_id} disabled={!selections[item.case_id] || assign.isPending} onClick={() => assignCase(item.case_id)}><Send size={16} /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Analist performansı</CardTitle><p className="mt-1 text-xs text-muted-foreground">Bugünkü canlı operasyon verileri</p></CardHeader>
        <CardContent className="px-0 pb-1">
          {performance.isLoading ? <div className="px-5"><Skeleton className="h-48" /></div> : <Table>
            <TableHeader><TableRow><TableHead>Analist</TableHead><TableHead>Uzmanlık</TableHead><TableHead>Karar</TableHead><TableHead>Ort. süre</TableHead><TableHead>Doğruluk</TableHead></TableRow></TableHeader>
            <TableBody>{performance.data?.map((item) => <TableRow key={item.analyst.user_id}><TableCell><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-brand-soft font-semibold text-brand">{item.analyst.full_name.split(" ").map((part) => part[0]).join("")}</span><strong>{item.analyst.full_name}</strong></div></TableCell><TableCell className="text-xs text-muted-foreground">{item.analyst.specialties?.map((value) => fraudLabels[value]).join(", ")}</TableCell><TableCell>{item.decisions_made}</TableCell><TableCell>{item.average_decision_minutes} dk</TableCell><TableCell><span className="font-semibold text-emerald-600">%{item.accuracy_rate}</span></TableCell></TableRow>)}</TableBody>
          </Table>}
        </CardContent>
      </Card>
    </>
  );
}

function MetricCard({ icon, label, value, trend, alert }: { icon: React.ReactNode; label: string; value: React.ReactNode; trend?: string; alert?: boolean }) {
  return <Card><CardContent className="flex items-center gap-4 py-4"><span className={`grid size-10 place-items-center rounded-xl ${alert ? "bg-red-500/10 text-red-500" : "bg-brand-soft text-brand"}`}>{icon}</span><div><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label} {trend && <span className="ml-1 text-emerald-600">{trend}</span>}</p></div></CardContent></Card>;
}
