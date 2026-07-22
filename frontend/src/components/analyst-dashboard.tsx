"use client";

import { useState } from "react";
import { Award, Clock3, MapPin, ShieldAlert, Sparkles, Target, Trophy } from "lucide-react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { RiskBadge, StatusBadge } from "@/components/case-badges";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, Textarea } from "@/components/ui/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApproveTransaction, useGetCase, useGetCases, useGetGameProfile } from "@/hooks/use-fraudcell";
import { dateTime, money } from "@/lib/utils";
import { fraudLabels } from "@/lib/domain-labels";
import type { AnalystDecision, GamificationProfile, TransactionCase } from "@/types/domain";

/** Interactive analyst controls hydrate server-rendered cases without a blank client fetch. */
export function AnalystDashboard({ initialCases, initialProfile, userId }: { initialCases: TransactionCase[]; initialProfile: GamificationProfile; userId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const cases = useGetCases(initialCases);
  const profile = useGetGameProfile(userId, initialProfile);
  const assigned = cases.data?.filter((item) => item.assigned_analyst_id === userId) ?? [];
  const activeId = selectedId ?? assigned[0]?.case_id ?? null;
  const detail = useGetCase(activeId, assigned.find((item) => item.case_id === activeId));
  const decision = useApproveTransaction();

  async function decide(value: AnalystDecision) {
    if (!activeId || !note.trim()) return;
    try {
      await decision.mutateAsync({ id: activeId, decision: value, note });
      setNote("");
      toast.success(value === "BLOKLANDI" ? "Vaka başarıyla bloklandı" : "İşlem onaylandı");
      if (value === "BLOKLANDI") toast("Rozet Kazanıldı: İlk Yakalama", { icon: "🏅" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Karar kaydedilemedi");
    }
  }

  return (
    <>
      <PageHeading eyebrow="Analist Operasyon Merkezi" title="Vaka komuta ekranı" description="En kritik sinyalleri önce inceleyin, AI önerisini doğrulayın ve SLA içinde karar verin." action={<Badge className="w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-600">● Sistemler aktif</Badge>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Summary icon={<ShieldAlert />} label="Aktif vakalar" value={assigned.filter((item) => !["ONAYLANDI", "BLOKLANDI", "KAPANDI"].includes(item.status)).length} />
        <Summary icon={<Clock3 />} label="Kritik SLA" value={assigned.filter((item) => item.risk_level === "KRITIK").length} accent="red" />
        <Summary icon={<Target />} label="Bugünkü doğruluk" value="96.8%" />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)_280px]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>Atanmış vaka kuyruğu</CardTitle><p className="mt-1 text-xs text-muted-foreground">Risk önceliğine göre sıralı</p></CardHeader>
          <CardContent className="px-0 pb-1">
            {cases.isLoading ? <div className="space-y-2 px-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : (
              <Table>
                <TableHeader><TableRow><TableHead>Vaka</TableHead><TableHead>Risk</TableHead><TableHead>Tutar</TableHead><TableHead>SLA</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader>
                <TableBody>{assigned.map((item) => (
                  <TableRow key={item.case_id} onClick={() => setSelectedId(item.case_id)} className={activeId === item.case_id ? "bg-brand-soft" : "cursor-pointer"}>
                    <TableCell><span className="flex items-center gap-2 font-mono text-xs"><i className={`size-1.5 rounded-full ${item.risk_level === "KRITIK" ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-accent"}`} />{item.case_id}</span></TableCell>
                    <TableCell><RiskBadge risk={item.risk_level} /></TableCell>
                    <TableCell className="font-medium">{money.format(item.transaction_details.amount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{dateTime.format(new Date(item.sla_deadline))}</TableCell>
                    <TableCell><StatusBadge status={item.status} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <CaseDetail item={detail.data} loading={detail.isLoading} note={note} setNote={setNote} pending={decision.isPending} decide={decide} />

        <Card className="xl:sticky xl:top-24">
          <CardHeader className="bg-gradient-to-br from-blue-500/15 to-accent/10"><div className="flex items-center gap-2 text-brand"><Trophy size={18} /><CardTitle>Analist profili</CardTitle></div></CardHeader>
          <CardContent>
            {profile.isLoading ? <Skeleton className="h-36" /> : profile.data && <>
              <div className="mb-4 flex items-end justify-between"><div><p className="text-3xl font-semibold">{profile.data.total_points.toLocaleString("tr-TR")}</p><p className="text-xs text-muted-foreground">toplam puan</p></div><Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600">{profile.data.level}</Badge></div>
              <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-[78%] bg-brand-gradient" /></div>
              <div className="mb-5 flex items-center justify-between rounded-xl bg-muted p-3"><span className="text-xs text-muted-foreground">Günlük sıra</span><strong className="text-xl">#{profile.data.daily_rank}</strong></div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Son rozetler</p>
              <div className="flex flex-wrap gap-2">{profile.data.badges.map((badge) => <Badge key={badge}><Award size={12} className="mr-1 text-amber-500" />{badge}</Badge>)}</div>
            </>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Summary({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent?: "red" }) {
  return <Card><CardContent className="flex items-center gap-3 py-4"><span className={`grid size-9 place-items-center rounded-lg ${accent === "red" ? "bg-red-500/10 text-red-500" : "bg-brand-soft text-brand"}`}>{icon}</span><div><p className="text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}

function CaseDetail({ item, loading, note, setNote, pending, decide }: { item?: ReturnType<typeof useGetCase>["data"]; loading: boolean; note: string; setNote: (value: string) => void; pending: boolean; decide: (value: AnalystDecision) => void }) {
  if (loading || !item) return <Card><CardContent><Skeleton className="h-[460px]" /></CardContent></Card>;
  return <Card>
    <CardHeader><div className="flex items-center justify-between"><CardTitle>Vaka detayı</CardTitle><RiskBadge risk={item.risk_level} /></div><p className="font-mono text-xs text-muted-foreground">{item.case_id}</p></CardHeader>
    <CardContent className="space-y-5">
      <div className="flex items-center justify-between rounded-xl bg-muted p-4"><div><p className="text-xs text-muted-foreground">AI risk skoru</p><p className="text-3xl font-semibold">%{Math.round(item.ai_analysis.risk_score * 100)}</p></div><Sparkles className="text-accent" /><div className="text-right"><p className="text-xs text-muted-foreground">Öneri</p><strong>{item.ai_analysis.recommended_decision}</strong></div></div>
      <dl className="grid grid-cols-2 gap-3 text-sm"><Info label="Tutar" value={money.format(item.transaction_details.amount)} /><Info label="İşlem" value={item.transaction_details.type} /><Info label="Alıcı" value={item.transaction_details.receiver} /><Info label="Fraud tipi" value={fraudLabels[item.ai_analysis.fraud_type]} /><Info label="Cihaz" value={item.transaction_details.device} /><Info label="Konum" value={item.transaction_details.location} icon={<MapPin size={12} />} /></dl>
      <div><label htmlFor="analyst-note" className="mb-1.5 block text-xs font-medium">Analist notu <span className="text-red-500">*</span></label><Textarea id="analyst-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Karar gerekçenizi yazın…" /></div>
      <div className="grid grid-cols-2 gap-3"><Button variant="outline" disabled={!note.trim() || pending} onClick={() => decide("ONAYLANDI")}>Onayla</Button><Button variant="danger" disabled={!note.trim() || pending} onClick={() => decide("BLOKLANDI")}>Blokla</Button></div>
    </CardContent>
  </Card>;
}

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div className="min-w-0"><dt className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</dt><dd className="truncate font-medium" title={value}>{value}</dd></div>;
}
