"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";

/** Owns one QueryClient for the browser lifetime and one global feedback surface. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <LiveGameEvents />
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

function LiveGameEvents() {
  const pathname = usePathname();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!["/analyst", "/supervisor", "/leaderboard"].some((path) => pathname.startsWith(path))) return;
    const source = new EventSource("/api/v1/game/notifications/stream");
    let first = true;
    source.addEventListener("points.changed", () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["game-profile"] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      ]);
      if (first) {
        first = false;
      } else {
        toast.success("Puanlar güncellendi");
      }
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, [pathname, queryClient]);

  return null;
}
