"use client";

import { useState } from "react";
import { Activity, Bot, ClockAlert, Gauge, Send } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { RiskBadge } from "@/components/case-badges";
import { Button, Card, CardContent, CardHeader, CardTitle, Select, Skeleton } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toTransactionCase, useApiErrorToast, useAssignCase, useGetOperationsDashboard } from "@/hooks/use-fraudcell";
import { useFraudcellEvents } from "@/hooks/use-fraudcell-events";
import { fraudLabels } from "@/lib/domain-labels";
import { dateTime, money } from "@/lib/utils";
import type { FraudType } from "@/types/domain";

const chartColors = ["#2f7dfa", "#22cddb", "#f97316", "#eab308", "#22c55e"];

/** Loads live operational data while preserving role-aware mutation controls. */
export function SupervisorDashboard({ canAssign = true }: { canAssign?: boolean } = {}) {
  const dashboard = useGetOperationsDashboard();
  const assign = useAssignCase();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const unassigned = dashboard.data?.manual_queue.map(toTransactionCase) ?? [];
  const distribution = dashboard.data?.fraud_type_distribution.map((item) => ({ name: fraudLabels[item.name as FraudType] ?? item.name, value: item.value })) ?? [];
  const performance = dashboard.data?.analyst_performance ?? [];
  useFraudcellEvents("cases");
  useApiErrorToast(dashboard.error, "Operasyon verileri yüklenemedi");

  async function assignCase(id: string) {
    if (!canAssign) return;
    const analyst_id = selections[id];
    const item = unassigned.find((candidate) => candidate.case_id === id);
    if (!analyst_id || item?.version === undefined) return;
    try {
      await assign.mutateAsync({ id, analyst_id, version: item.version, reason: "Supervisor manuel ataması", override_capacity: false });
      toast.success("Vaka analiste atandı");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Atama tamamlanamadı");
    }
  }

  return (
    <>
      <PageHeading eyebrow="Supervisor Control" title="Operasyon sağlığı" description="SLA, model doğruluğu ve ekip kapasitesini tek görünümden izleyin." action={<div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"><Activity size={14} className="text-emerald-500" /> Canlı{dashboard.data ? ` · ${dateTime.format(new Date(dashboard.data.generated_at))}` : ""}</div>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Gauge />} label="SLA uyumu" value={dashboard.data ? `%${dashboard.data.sla_compliance_rate}` : "—"} />
        <MetricCard icon={<Bot />} label="AI doğruluğu" value={dashboard.data?.ai_accuracy === null || !dashboard.data ? "—" : `%${dashboard.data.ai_accuracy}`} />
        <MetricCard icon={<ClockAlert />} label="Geciken vaka" value={dashboard.data?.active_sla_breaches ?? "—"} alert />
        <MetricCard icon={<Activity />} label="Atanmamış vaka" value={unassigned.length} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>Fraud dağılımı</CardTitle><p className="mt-1 text-xs text-muted-foreground">Son 24 saat · yüzde dağılım</p></CardHeader>
          <CardContent>
            {dashboard.isLoading ? <Skeleton className="h-64" /> : <div className="grid items-center sm:grid-cols-[1fr_180px] lg:grid-cols-1 xl:grid-cols-[1fr_180px]">
              <div className="h-64" aria-label="Dolandırıcılık türleri pasta grafiği">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={distribution} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={3}>{distribution.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, background: "var(--surface)", borderColor: "var(--border)" }} /></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">{distribution.map((item, index) => <div key={item.name} className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><i className="size-2 rounded-full" style={{ background: chartColors[index % chartColors.length] }} />{item.name}</span><strong>%{item.value}</strong></div>)}</div>
            </div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Manuel vaka atama</CardTitle><p className="mt-1 text-xs text-muted-foreground">Belirsiz/atanmamış kuyruk (YENİ)</p></CardHeader>
          <CardContent className="space-y-3">
            {dashboard.isLoading ? <Skeleton className="h-48" /> : unassigned.length === 0 ? <p className="rounded-xl bg-muted p-8 text-center text-sm text-muted-foreground">Atama bekleyen vaka yok.</p> : unassigned.map((item) => (
              <div key={item.case_id} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_170px_auto] sm:items-center">
                <div className="min-w-0"><div className="mb-1 flex items-center gap-2"><strong className="font-mono text-xs">{item.transaction_details.transaction_number ?? item.case_id}</strong><RiskBadge risk={item.risk_level} /></div><p className="truncate text-xs text-muted-foreground">{item.transaction_details.receiver} · {money.format(item.transaction_details.amount)}</p></div>
                <Select aria-label={`${item.case_id} için analist`} disabled={!canAssign} value={selections[item.case_id] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [item.case_id]: event.target.value }))}>
                  <option value="">Analist seçin</option>{performance.map((analyst) => <option key={analyst.analyst_id} value={analyst.analyst_id}>{analyst.name}</option>)}
                </Select>
                <Button size="icon" aria-label="Vakayı ata" loading={assign.isPending && assign.variables?.id === item.case_id} disabled={!canAssign || !selections[item.case_id] || assign.isPending} onClick={() => assignCase(item.case_id)}><Send size={16} /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Analist performansı</CardTitle><p className="mt-1 text-xs text-muted-foreground">Bugünkü canlı operasyon verileri</p></CardHeader>
        <CardContent className="px-0 pb-1">
          {dashboard.isLoading ? <div className="px-5"><Skeleton className="h-48" /></div> : <Table>
            <TableHeader><TableRow><TableHead>Analist</TableHead><TableHead>Uzmanlık</TableHead><TableHead>Karar</TableHead><TableHead>Ort. süre</TableHead><TableHead>Doğruluk</TableHead></TableRow></TableHeader>
            <TableBody>{performance.map((item) => <TableRow key={item.analyst_id}><TableCell><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-brand-soft font-semibold text-brand">{item.name.split(" ").map((part) => part[0]).join("")}</span><strong>{item.name}</strong></div></TableCell><TableCell className="text-xs text-muted-foreground">—</TableCell><TableCell>{item.decision_count}</TableCell><TableCell>{item.average_minutes} dk</TableCell><TableCell><span className="font-semibold text-emerald-600">{item.accuracy === null ? "—" : `%${item.accuracy}`}</span></TableCell></TableRow>)}</TableBody>
          </Table>}
        </CardContent>
      </Card>
    </>
  );
}

function MetricCard({ icon, label, value, trend, alert }: { icon: React.ReactNode; label: string; value: React.ReactNode; trend?: string; alert?: boolean }) {
  return <Card><CardContent className="flex items-center gap-4 py-4"><span className={`grid size-10 place-items-center rounded-xl ${alert ? "bg-red-500/10 text-red-500" : "bg-brand-soft text-brand"}`}>{icon}</span><div><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label} {trend && <span className="ml-1 text-emerald-600">{trend}</span>}</p></div></CardContent></Card>;
}
