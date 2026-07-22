import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("./useSse");

import { useSse } from "./useSse";

describe("useSse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Bearer kimliğiyle bağlanır, SSE çerçevesini ayrıştırır ve aynı id'yi tek kez işler", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            ':keep-alive\nid: score-42\nevent: score.updated\ndata: {"points":15}\n\n' +
              'id: score-42\nevent: score.updated\ndata: {"points":15}\n\n',
          ),
        );
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
    vi.stubGlobal("fetch", fetchMock);
    const onMessage = vi.fn();

    const { unmount } = renderHook(() => useSse("/api/v1/game/stream", "memory-token", onMessage));

    await waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    expect(onMessage).toHaveBeenCalledWith({
      id: "score-42",
      event: "score.updated",
      data: { points: 15 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/game/stream",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          Authorization: "Bearer memory-token",
        }),
      }),
    );

    unmount();
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("token yokken bağlantı açmaz", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useSse("/api/v1/game/stream", null, vi.fn()));

    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });
});
