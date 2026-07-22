import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/server/auth";

/** Isolates request-time cookie access so the page shell can stream independently. */
export async function AppHeader() {
  return <AppShell user={await getSession()} />;
}

export function AppHeaderSkeleton() {
  return <div className="h-[65px] border-b border-border bg-surface" aria-label="Üst menü yükleniyor" />;
}
