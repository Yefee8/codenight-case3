"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { createSseParser, sseEventKey, type SseMessage } from "@/lib/sse";

type StreamMode = "cases" | "game" | "all";
type EventPayload = Record<string, unknown>;

const streams = {
  cases: "/api/v1/notifications/stream",
  game: "/api/v1/game/notifications/stream",
} as const;

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = window.setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function payloadFrom(message: SseMessage): EventPayload {
  try {
    const value: unknown = JSON.parse(message.data);
    return value !== null && typeof value === "object" ? value as EventPayload : {};
  } catch {
    return {};
  }
}

/** Authenticated fetch-stream SSE with resume headers, bounded dedupe and backoff. */
export function useFraudcellEvents(mode: StreamMode) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const controller = new AbortController();
    const lastEventIds = new Map<string, string>();
    const seen = new Set<string>();
    const selected = mode === "all" ? (["cases", "game"] as const) : [mode];

    function handle(stream: "cases" | "game", message: SseMessage) {
      if (!message.id) return;
      const key = sseEventKey(message);
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 500) {
        const oldest = seen.values().next().value;
        if (oldest) seen.delete(oldest);
      }
      lastEventIds.set(stream, message.id);
      const payload = payloadFrom(message);

      if (stream === "cases") {
        void queryClient.invalidateQueries({ queryKey: ["cases"] });
        void queryClient.invalidateQueries({ queryKey: ["operations"] });
        const text = typeof payload.message === "string" ? payload.message : "Vaka güncellendi.";
        toast.info(text, { id: `sse:${key}` });
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["game-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      const badge = typeof payload.badge_name === "string" ? payload.badge_name : null;
      const text = badge
        ? `Yeni rozet: ${badge}`
        : typeof payload.message === "string" ? payload.message : "Puanınız güncellendi.";
      toast.success(text, { id: `sse:${key}` });
    }

    async function connect(stream: "cases" | "game") {
      let retryDelay = 1_000;
      while (!controller.signal.aborted) {
        try {
          const lastEventId = lastEventIds.get(stream);
          const response = await apiFetch(streams[stream], {
            headers: {
              Accept: "text/event-stream",
              ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
            },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.body) {
            throw new ApiClientError(503, "SSE_BODY_MISSING", "Canlı bağlantı kurulamadı.", null);
          }

          retryDelay = 1_000;
          if (stream === "cases") {
            void queryClient.invalidateQueries({ queryKey: ["cases"] });
            void queryClient.invalidateQueries({ queryKey: ["operations"] });
          } else {
            void queryClient.invalidateQueries({ queryKey: ["game-profile"] });
            void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
          }

          const parser = createSseParser((message) => handle(stream, message));
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
          }
          parser.feed(decoder.decode());
          parser.end();
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof ApiClientError && [401, 403, 404, 423].includes(error.status)) {
            toast.error(error.message, { id: `sse:fatal:${stream}` });
            return;
          }
          toast.warning("Canlı bağlantı kesildi; yeniden bağlanılıyor.", { id: `sse:reconnect:${stream}` });
          if (error instanceof ApiClientError && error.retryAfter !== null) {
            retryDelay = Math.max(retryDelay, error.retryAfter * 1_000);
          }
        }
        await abortableDelay(retryDelay, controller.signal);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    }

    for (const stream of selected) void connect(stream);
    return () => controller.abort();
  }, [mode, queryClient]);
}
