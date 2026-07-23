"use client";

import { useState } from "react";
import { LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { RiskBadge, StatusBadge } from "@/components/case-badges";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import { useSimulateTransaction } from "@/hooks/use-fraudcell";
import { money } from "@/lib/utils";
import type { TransactionSimulationRequest, TransactionSimulationResult, TransactionType } from "@/types/domain";

const initialForm: TransactionSimulationRequest = { amount: 0, type: "TRANSFER", receiver: "", device: "iPhone 15 Pro · iOS 18", location: "İstanbul, TR" };

export function CustomerPortal() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState<TransactionSimulationResult | null>(null);
  const simulate = useSimulateTransaction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      setResult(await simulate.mutateAsync(form));
      toast.success("İşlem ve risk vakası kaydedildi");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "İşlem simüle edilemedi");
    }
  }

  const score = result?.case.ai_analysis.risk_score;
  const aiUnavailable = result?.case.ai_analysis.prediction_status === "UNAVAILABLE";

  return (
    <>
      <PageHeading eyebrow="FraudCell Müşteri" title="Güvenli işlem simülatörü" description="İşlemi kaydedin ve gerçek zamanlı risk değerlendirmesini görün." action={<div className="flex items-center gap-2 text-xs text-emerald-600"><LockKeyhole size={14} /> Güvenli oturum</div>} />
      <div className="mx-auto grid max-w-5xl items-start gap-5 lg:grid-cols-[1fr_.8fr]">
        <Card>
          <CardHeader><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><WalletCards /></span><div><CardTitle>Yeni işlem</CardTitle><p className="mt-1 text-xs text-muted-foreground">Risk analizi için işlem detaylarını girin</p></div></div></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <Field label="Tutar (TRY)" htmlFor="amount"><Input id="amount" type="number" min="1" step="0.01" required value={form.amount || ""} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} placeholder="25.000" /></Field>
              <Field label="İşlem tipi" htmlFor="type"><Select id="type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as TransactionType })}><option value="TRANSFER">Transfer</option><option value="ODEME">Ödeme</option><option value="FATURA">Fatura</option><option value="CEKIM">Nakit çekim</option></Select></Field>
              <Field label="Alıcı / iş yeri" htmlFor="receiver" className="sm:col-span-2"><Input id="receiver" required value={form.receiver} onChange={(event) => setForm({ ...form, receiver: event.target.value })} placeholder="Örn. Atlas Danışmanlık Ltd." /></Field>
              <Field label="Cihaz" htmlFor="device"><Select id="device" value={form.device} onChange={(event) => setForm({ ...form, device: event.target.value })}><option>iPhone 15 Pro · iOS 18</option><option>Galaxy S24 · Android 15</option><option>Chrome · Windows 11</option><option>Safari · macOS 16</option></Select></Field>
              <Field label="Konum" htmlFor="location"><Input id="location" required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field>
              <Button className="mt-2 sm:col-span-2" loading={simulate.isPending}>{simulate.isPending ? "AI analiz ediyor…" : "İşlemi simüle et"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="h-1 bg-brand-gradient" />
          <CardContent className="py-6">
            {result ? <>
              <div className="mb-5 flex items-start justify-between"><div><p className="text-xs text-muted-foreground">Son analiz</p><strong className="font-mono text-sm">{result.case.case_id}</strong></div><div className="flex gap-2"><RiskBadge risk={result.case.risk_level} /><StatusBadge status={result.case.status} /></div></div>
              <div className="mb-5 grid grid-cols-2 gap-3"><Result label="Risk skoru" value={score === null || score === undefined ? "—" : `%${Math.round(score * 100)}`} /><Result label="AI önerisi" value={result.case.ai_analysis.recommended_decision} /><Result label="Tutar" value={money.format(result.case.transaction_details.amount)} /><Result label="İnceleme" value={result.requires_verification ? "Gerekli" : "Düşük risk"} /></div>
              <div className={`rounded-xl p-3 text-sm ${aiUnavailable ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-brand-soft text-brand"}`}>
                {aiUnavailable ? "AI servisine ulaşılamadı; vaka güvenli şekilde manuel inceleme kuyruğuna alındı." : result.requires_verification ? "Vaka analist incelemesi için oluşturuldu." : "Risk değerlendirmesi tamamlandı ve vaka kaydedildi."}
              </div>
            </> : <div className="py-10 text-center"><ShieldCheck className="mx-auto mb-3 text-brand" size={40} /><p className="font-medium">AI risk motoru hazır</p><p className="mt-1 text-xs text-muted-foreground">İşlem sonucu burada görünecek.</p></div>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) { return <div className={className}><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }
function Result({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
