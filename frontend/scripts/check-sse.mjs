import assert from "node:assert/strict";
import { createSseParser, sseEventKey } from "../src/lib/sse.ts";

const messages = [];
const parser = createSseParser((message) => messages.push(message));

parser.feed("\uFEFF: connected\r\nid: event-1\r");
parser.feed("\nevent: badge.earned\r\ndata: first line\r\n");
parser.feed("data: second line\r\n\r\nevent: points.changed\ndata: {}\n\n");
parser.end();

assert.deepEqual(messages, [
  { id: "event-1", event: "badge.earned", data: "first line\nsecond line" },
  { id: "event-1", event: "points.changed", data: "{}" },
]);

const seen = new Set(messages.map(sseEventKey));
assert.equal(seen.has("badge.earned:event-1"), true);
assert.equal(seen.has("points.changed:event-1"), true);
assert.equal(new Set([...seen, sseEventKey(messages[0])]).size, 2);

console.log("SSE parser and eventType:id dedupe key checks passed.");
