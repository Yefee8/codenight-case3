import { vi } from "vitest";

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { x: 0, y: 0, width: 800, height: 300, top: 0, right: 800, bottom: 300, left: 0, toJSON: () => ({}) },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this,
    );
  }

  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 300 });

// Role-screen tests validate invalidation behavior separately; transport parsing has a
// dedicated hook test and is not allowed to open an endless stream in jsdom.
vi.mock("../hooks/useSse", () => ({ useSse: vi.fn() }));

