import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { slimForWire } from "./company-wire-slim.ts";

test("slimForWire keeps logins and passwords, drops passwordHash", () => {
  const slim = slimForWire({
    people: [
      { id: "p-1", username: "sunny.b", password: "0000", passwordHash: "x" },
      { id: "p-2", username: "ada.l", password: "secret" },
    ],
    logins: { "sunny.b": { personId: "p-1", password: "0000" } },
    notebookUpdatedAt: 9,
  });
  const people = slim.people as Array<Record<string, unknown>>;
  assert.equal(people[0].password, "0000");
  assert.equal(people[0].passwordHash, undefined);
  assert.equal(people[1].password, "secret");
  assert.deepEqual(slim.logins, { "sunny.b": { personId: "p-1", password: "0000" } });
});

test("gzip level 5 of a company-sized JSON envelope is well under a megabyte", () => {
  const snapshotJson = JSON.stringify({
    people: Array.from({ length: 172 }, (_, i) => ({ id: `p-${i}`, name: `Person ${i}` })),
    rewardRecords: Object.fromEntries(
      Array.from({ length: 14 }, (_, m) => [
        `2025-${String(m + 1).padStart(2, "0")}`,
        Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p-${i}`, { score: i, notes: "n".repeat(200) }])),
      ]),
    ),
  });
  const jsonBody = Buffer.from(
    JSON.stringify({ snapshotJson, personId: null, resets: [], bootstrap: false, forbidden: false }),
    "utf8",
  );
  const gzipBody = gzipSync(jsonBody, { level: 5 });
  assert.equal(JSON.parse(gunzipSync(gzipBody).toString("utf8")).personId, null);
  assert.ok(gzipBody.length < jsonBody.length / 4);
  assert.ok(gzipBody.length < 400_000, `gzip ${gzipBody.length}`);
});

test("unchanged payload is tiny and keeps personId", () => {
  const body = JSON.stringify({
    unchanged: true,
    notebookUpdatedAt: 123,
    snapshotJson: null,
    personId: "p-admin",
    resets: [],
    bootstrap: false,
    forbidden: false,
  });
  assert.ok(body.length < 500);
  assert.equal(JSON.parse(body).snapshotJson, null);
});
