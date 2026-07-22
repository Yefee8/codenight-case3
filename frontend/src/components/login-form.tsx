"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, Input, Label } from "@/components/ui/primitives";
import { useLogin } from "@/hooks/use-fraudcell";

const demos = [
  ["Müşteri", "0532 000 00 01", "1234"],
  ["Analist", "0532 111 20 26", "2468"],
  ["Supervisor", "0532 000 00 03", "8642"],
];

/** Sends credentials to the BFF; the component never stores or invents authentication state. */
export function LoginForm() {
  const [gsm, setGsm] = useState("");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const login = useLogin();
  const router = useRouter();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await login.mutateAsync({ gsm, otp });
      router.replace(result.redirect_to);
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      toast.error(error instanceof Error ? error.message : "Giriş yapılamadı");
    }
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-10rem)] max-w-5xl place-items-center">
      <Card className="grid w-full overflow-hidden border-0 shadow-[0_30px_80px_-45px_rgba(3,78,162,.7)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="relative hidden min-h-[580px] overflow-hidden bg-brand-gradient p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 size-72 rounded-full border-[50px] border-white/10" /><div className="absolute -bottom-28 -left-20 size-80 rounded-full bg-accent/15 blur-2xl" />
          <span className="relative grid size-12 place-items-center rounded-2xl bg-white/15 backdrop-blur"><ShieldCheck size={27} /></span>
          <div className="relative"><p className="mb-4 text-xs font-bold uppercase tracking-[.25em] text-blue-50">FraudCell Secure Access</p><h1 className="font-display text-4xl font-semibold leading-tight">Riskin önünde,<br />işlemin yanında.</h1><p className="mt-5 max-w-sm text-sm leading-6 text-blue-50/80">Rol tabanlı güvenli erişim ile doğru ekip, yalnızca yetkili olduğu operasyon alanını görür.</p></div>
        </div>
        <CardContent className="p-7 sm:p-12">
          <div className="mb-8"><span className="mb-5 grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Smartphone /></span><h1 className="font-display text-3xl font-semibold">Hesabınıza giriş yapın</h1><p className="mt-2 text-sm text-muted-foreground">GSM numaranız ve tek kullanımlık şifrenizle devam edin.</p></div>
          <form onSubmit={submit} className="space-y-4">
            <div><Label htmlFor="login-gsm">GSM numarası</Label><Input id="login-gsm" autoComplete="tel" inputMode="tel" required value={gsm} onChange={(event) => setGsm(event.target.value)} placeholder="05xx xxx xx xx" /></div>
            <div><Label htmlFor="login-otp">Tek kullanımlık şifre</Label><div className="relative"><KeyRound className="absolute left-3 top-3 text-subtle" size={16} /><Input id="login-otp" className="pl-10 tracking-[.35em]" autoComplete="one-time-code" inputMode="numeric" maxLength={4} required value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="••••" /></div></div>
            <Button className="w-full" loading={submitting}>{submitting ? "Doğrulanıyor…" : "Güvenli giriş"}</Button>
          </form>
          <div className="mt-8 border-t border-border pt-5"><p className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-muted-foreground">Demo hesaplar</p><div className="space-y-2">{demos.map(([role, phone, code]) => <div key={role} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-muted px-3 py-2 text-xs"><span><strong className="mr-2 text-brand">{role}</strong>{phone}</span><code className="font-semibold">{code}</code></div>)}</div></div>
        </CardContent>
      </Card>
    </div>
  );
}
