import { useEffect, useRef } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

interface SseMessage<T> {
  id: string;
  event: string;
  data: T;
}

export function useSse<T>(
  path: string,
  accessToken: string | null,
  onMessage: (message: SseMessage<T>) => void,
) {
  const callbackRef = useRef(onMessage);
  const lastEventId = useRef("");
  const seen = useRef(new Set<string>());

  useEffect(() => {
    callbackRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    let retryDelay = 1_000;

    async function connect() {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${accessToken}`,
              ...(lastEventId.current ? { "Last-Event-ID": lastEventId.current } : {}),
            },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
          retryDelay = 1_000;
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const fields = Object.fromEntries(
                frame
                  .split("\n")
                  .filter((line) => !line.startsWith(":"))
                  .map((line) => {
                    const split = line.indexOf(":");
                    return [line.slice(0, split), line.slice(split + 1).trimStart()];
                  }),
              );
              if (!fields.id || !fields.data || seen.current.has(fields.id)) continue;
              seen.current.add(fields.id);
              if (seen.current.size > 500) seen.current.clear();
              lastEventId.current = fields.id;
              callbackRef.current({
                id: fields.id,
                event: fields.event ?? "message",
                data: JSON.parse(fields.data) as T,
              });
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn("SSE bağlantısı yeniden kurulacak", error);
        }
        await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    }

    void connect();
    return () => controller.abort();
  }, [accessToken, path]);
}

