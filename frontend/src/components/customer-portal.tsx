"use client";

import { useState } from "react";
import { CheckCircle2, LockKeyhole, ShieldCheck, Star, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { RiskBadge } from "@/components/case-badges";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApiErrorToast, useGetCase, useSimulateTransaction, useSubmitFeedback, useVerifyCustomer } from "@/hooks/use-fraudcell";
import { useFraudcellEvents } from "@/hooks/use-fraudcell-events";
import { money } from "@/lib/utils";
import type { TransactionSimulationRequest, TransactionSimulationResult, TransactionType } from "@/types/domain";

const initialForm: TransactionSimulationRequest = { amount: 0, type: "TRANSFER", receiver: "", device: "iPhone 15 Pro · iOS 18", location: "İstanbul, TR" };

/** Runs transaction simulation only after the server page has authorized a customer session. */
export function CustomerPortal() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState<TransactionSimulationResult | null>(null);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const simulate = useSimulateTransaction();
  const verifyCustomer = useVerifyCustomer();
  const feedback = useSubmitFeedback();
  const liveCase = useGetCase(result?.case.case_id ?? null);
  const currentCase = liveCase.data ?? result?.case;
  useFraudcellEvents("cases");
  useApiErrorToast(liveCase.error, "Vaka durumu yüklenemedi");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setRating(0);
    try {
      const data = await simulate.mutateAsync(form);
      setResult(data);
      if (data.requires_verification) setVerificationOpen(true);
      else if (data.case.prediction_status === "UNAVAILABLE") toast.warning("AI erişilemedi; vaka manuel kuyruğa alındı.");
      else if (data.case.status === "ONAYLANDI") toast.success("İşlem güvenle onaylandı");
      else toast.info("İşlem manuel inceleme kuyruğuna alındı");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "İşlem simüle edilemedi");
    }
  }

  async function verify(madeByCustomer: boolean) {
    if (!currentCase) return;
    try {
      const updated = await verifyCustomer.mutateAsync({
        id: currentCase.case_id,
        response: madeByCustomer ? "CUSTOMER_CONFIRMED" : "CUSTOMER_DENIED",
      });
      setResult({ case: updated, requires_verification: false });
      setVerificationOpen(false);
      toast[madeByCustomer ? "success" : "warning"](madeByCustomer ? "Yanıtınız doğrulandı" : "Yanıtınız güvenlik ekibine iletildi");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Doğrulama yanıtı gönderilemedi");
    }
  }

  async function submitRating(value: number) {
    if (!currentCase || feedback.isPending || rating > 0) return;
    try {
      await feedback.mutateAsync({ id: currentCase.case_id, score: value });
      setRating(value);
      toast.success("Geri bildiriminiz alındı");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Geri bildirim gönderilemedi");
    }
  }

  const awaitingVerification = currentCase?.status === "MUSTERI_DOGRULAMA";
  const manualReview = currentCase && ["YENI", "ATANDI", "INCELENIYOR"].includes(currentCase.status);
  const aiUnavailable = currentCase?.prediction_status === "UNAVAILABLE";

  return (
    <>
      <PageHeading eyebrow="FraudCell Müşteri" title="Güvenli işlem simülatörü" description="İşlem davranışını gerçek zamanlı AI risk motoruyla test edin." action={<div className="flex items-center gap-2 text-xs text-emerald-600"><LockKeyhole size={14} /> Güvenli oturum</div>} />
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

        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="h-1 bg-brand-gradient" />
            <CardContent className="py-6">
              {currentCase ? <>
                <div className="mb-5 flex items-start justify-between"><div><p className="text-xs text-muted-foreground">Son analiz</p><strong className="font-mono text-sm">{currentCase.transaction_details.transaction_number ?? currentCase.case_id}</strong></div><RiskBadge risk={currentCase.risk_level} /></div>
                <div className="mb-5 grid grid-cols-2 gap-3"><Result label="Risk skoru" value={currentCase.ai_analysis.risk_score === null ? "BELİRSİZ" : `%${Math.round(currentCase.ai_analysis.risk_score * 100)}`} /><Result label="AI önerisi" value={currentCase.ai_analysis.recommended_decision} /><Result label="Tutar" value={money.format(currentCase.transaction_details.amount)} /><Result label="Doğrulama" value={awaitingVerification ? "Gerekli" : "Gerekli değil"} /></div>
                <div className={`rounded-xl p-3 text-sm ${manualReview || awaitingVerification ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>{aiUnavailable ? "AI erişilemedi; vaka manuel atama kuyruğuna alındı." : awaitingVerification ? "Müşteri doğrulaması bekleniyor" : manualReview ? "Vaka güvenlik ekibinin manuel incelemesine alındı." : <span className="flex items-center gap-2"><CheckCircle2 size={17} /> İşlem akışı tamamlandı</span>}</div>
              </> : <div className="py-10 text-center"><ShieldCheck className="mx-auto mb-3 text-brand" size={40} /><p className="font-medium">AI risk motoru hazır</p><p className="mt-1 text-xs text-muted-foreground">İşlem sonucu burada görünecek.</p></div>}
            </CardContent>
          </Card>
          {currentCase?.status === "KAPANDI" && <Rating rating={rating} pending={feedback.isPending} submit={submitRating} />}
        </div>
      </div>

      <Dialog open={verificationOpen} onOpenChange={setVerificationOpen}>
        <DialogContent>
          <DialogHeader><div className="mb-3 grid size-12 place-items-center rounded-full bg-red-500/10 text-red-500"><ShieldCheck /></div><DialogTitle>Bu işlemi siz mi yaptınız?</DialogTitle><DialogDescription>Did you make this transaction? {currentCase && `${currentCase.transaction_details.receiver} için ${money.format(currentCase.transaction_details.amount)} tutarında işlem algılandı.`}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3"><Button variant="outline" loading={verifyCustomer.isPending && verifyCustomer.variables?.response === "CUSTOMER_CONFIRMED"} disabled={verifyCustomer.isPending} onClick={() => verify(true)}>Evet, benim</Button><Button variant="danger" loading={verifyCustomer.isPending && verifyCustomer.variables?.response === "CUSTOMER_DENIED"} disabled={verifyCustomer.isPending} onClick={() => verify(false)}>Hayır, blokla</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) { return <div className={className}><Label htmlFor={htmlFor}>{label}</Label>{children}</div>; }
function Result({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
function Rating({ rating, pending, submit }: { rating: number; pending: boolean; submit: (value: number) => void }) { return <Card><CardContent className="py-5 text-center"><p className="text-sm font-medium">Deneyiminizi puanlayın</p><p className="mb-3 text-xs text-muted-foreground">Geri bildiriminiz güvenlik akışını iyileştirir.</p><div className="flex justify-center gap-1">{[1, 2, 3, 4, 5].map((value) => <button key={value} aria-label={`${value} yıldız`} disabled={pending || rating > 0} onClick={() => submit(value)} className="rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"><Star size={25} className={value <= rating ? "fill-amber-400 text-amber-400" : "text-subtle"} /></button>)}</div></CardContent></Card>; }
