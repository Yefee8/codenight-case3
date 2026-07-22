export interface SseMessage {
  id: string;
  event: string;
  data: string;
}

export function sseEventKey(message: Pick<SseMessage, "id" | "event">) {
  return `${message.event}:${message.id}`;
}

/** Incremental SSE parser: handles split chunks, CRLF and multiline data. */
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = "";
  let data: string[] = [];
  let event = "message";
  let lastEventId = "";
  let firstLine = true;

  function dispatch() {
    if (data.length) onMessage({ id: lastEventId, event, data: data.join("\n") });
    data = [];
    event = "message";
  }

  function line(value: string) {
    if (firstLine) {
      value = value.replace(/^\uFEFF/, "");
      firstLine = false;
    }
    if (!value) return dispatch();
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    const raw = colon < 0 ? "" : value.slice(colon + 1);
    const fieldValue = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "data") data.push(fieldValue);
    else if (field === "event") event = fieldValue || "message";
    else if (field === "id" && !fieldValue.includes("\0")) lastEventId = fieldValue;
  }

  function feed(chunk: string) {
    buffer += chunk;
    let start = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      if (character === "\r" && index === buffer.length - 1) break;
      line(buffer.slice(start, index));
      if (character === "\r" && buffer[index + 1] === "\n") index += 1;
      start = index + 1;
    }
    buffer = buffer.slice(start);
  }

  function end() {
    if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
    if (buffer) line(buffer);
    buffer = "";
    dispatch();
  }

  return { feed, end };
}
