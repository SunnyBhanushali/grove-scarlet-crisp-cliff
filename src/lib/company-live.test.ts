import assert from "node:assert/strict";
import test from "node:test";
import {
  currentLiveAt,
  emitCompanyLive,
  encodeSse,
  liveSseHeaders,
  subscribeCompanyLive,
} from "./company-live.ts";

test("encodeSse is a JSON data frame", () => {
  assert.equal(encodeSse(123), `data: {"at":123,"entities":[]}\n\n`);
});

test("encodeSse includes entities when provided", () => {
  const frame = encodeSse(9, { org: 1, plans: 1, months: 1, targets: 1 }, [
    { type: "people", id: "p-new" },
  ]);
  const body = JSON.parse(frame.slice(6).trim()) as {
    entities: Array<{ type: string; id: string }>;
  };
  assert.equal(body.entities[0].id, "p-new");
});

test("live SSE headers disable buffering", () => {
  const headers = liveSseHeaders();
  assert.equal(headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(headers["x-accel-buffering"], "no");
});

test("in-process subscribers see the latest tick", () => {
  const seen: number[] = [];
  const stop = subscribeCompanyLive((at) => seen.push(at));
  const first = emitCompanyLive(Date.now());
  const second = emitCompanyLive(first + 50);
  stop();
  emitCompanyLive(second + 50);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], first);
  assert.equal(seen[1], second);
  assert.equal(currentLiveAt(), second + 50);
});
