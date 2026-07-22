"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Download, LogIn, LogOut, ShieldCheck, SunMoon, Trophy, UserRound, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, buttonStyles } from "@/components/ui/primitives";
import { useLogout } from "@/hooks/use-fraudcell";
import { cn } from "@/lib/utils";
import type { Role, SessionUser } from "@/types/domain";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __fraudcellInstallPrompt?: InstallPrompt;
  }
}

const allNavigation: { href: string; label: string; icon: typeof UserRound; roles: Role[] }[] = [
  { href: "/analyst", label: "Vaka Merkezi", icon: UserRound, roles: ["ANALYST"] },
  { href: "/supervisor", label: "Operasyon", icon: BarChart3, roles: ["SUPERVISOR", "ADMIN"] },
  { href: "/customer", label: "İşlemler", icon: UsersRound, roles: ["CUSTOMER"] },
  { href: "/leaderboard", label: "Liderlik", icon: Trophy, roles: ["ANALYST", "SUPERVISOR", "ADMIN"] },
];

const roleLabels: Record<Role, string> = { CUSTOMER: "Müşteri", ANALYST: "Fraud Analisti", SUPERVISOR: "Supervisor", ADMIN: "Yönetici" };

/** Client-only header handles active navigation, theme and logout; identity arrives securely from SSR. */
export function AppShell({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(() => typeof window === "undefined" ? null : window.__fraudcellInstallPrompt ?? null);
  const [isInstalled, setIsInstalled] = useState(false);
  const navigation = user ? allNavigation.filter((item) => item.roles.includes(user.role)) : [];

  useEffect(() => {
    const preferred = localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", preferred);

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      window.__fraudcellInstallPrompt = event as InstallPrompt;
      setInstallPrompt(window.__fraudcellInstallPrompt);
    };
    const handleInstalled = () => {
      delete window.__fraudcellInstallPrompt;
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  async function signOut() {
    try {
      await logout.mutateAsync();
    } catch {
      toast.warning("Oturum bu cihazda kapatıldı; sunucu oturumu doğrulanamadı.");
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  async function installApp() {
    if (!installPrompt) {
      toast.info("Tarayıcı menüsünden ‘Ana Ekrana Ekle’ veya ‘Uygulamayı Yükle’ seçeneğini kullanın.");
      return;
    }

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      delete window.__fraudcellInstallPrompt;
      setIsInstalled(outcome === "accepted");
      setInstallPrompt(null);
    } catch {
      toast.error("Yükleme istemi açılamadı. Tarayıcı menüsündeki yükleme seçeneğini kullanın.");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 shadow-[0_8px_30px_-24px_rgba(3,78,162,.5)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 lg:px-8">
        <Link href="/" className="mr-auto flex items-center gap-2.5" aria-label="FraudCell ana sayfa">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-gradient text-white shadow-lg shadow-blue-500/20"><ShieldCheck size={21} /></span>
          <span><strong className="font-display block text-lg leading-none text-brand">FraudCell</strong><small className="text-[9px] font-bold uppercase tracking-[.23em] text-muted-foreground">Risk Command</small></span>
        </Link>
        {user && <nav className="hidden items-center gap-1 md:flex" aria-label="Ana navigasyon">
          {navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={cn("flex items-center gap-2 rounded-full px-3.5 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-brand", pathname === href && "bg-brand-soft font-semibold text-brand")}><Icon size={16} />{label}</Link>)}
        </nav>}
        {!isInstalled && <Button variant="ghost" size="icon" onClick={installApp} aria-label="FraudCell uygulamasını yükle" title="Uygulamayı yükle" className="pwa-install-button"><Download size={18} /></Button>}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Renk temasını değiştir"><SunMoon size={18} /></Button>
        {user ? <div className="hidden items-center gap-3 border-l border-border pl-3 sm:flex"><div className="text-right"><strong className="block text-xs">{user.full_name}</strong><span className="text-[10px] text-muted-foreground">{roleLabels[user.role]}</span></div><Button variant="ghost" size="icon" onClick={signOut} loading={logout.isPending} aria-label="Oturumu kapat"><LogOut size={17} /></Button></div> : <Link href="/login" className={buttonStyles({ size: "sm" })}><LogIn size={15} /> Giriş yap</Link>}
      </div>
      {user && <nav className="flex overflow-x-auto border-t border-border px-2 py-1 md:hidden" aria-label="Mobil navigasyon">
        {navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={cn("flex min-w-max flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-muted-foreground", pathname === href && "bg-brand-soft font-medium text-brand")}><Icon size={14} />{label}</Link>)}
        <Button variant="ghost" onClick={signOut} loading={logout.isPending} aria-label="Oturumu kapat" className="h-auto rounded-lg px-3 py-2 text-muted-foreground"><LogOut size={15} /></Button>
      </nav>}
    </header>
  );
}
