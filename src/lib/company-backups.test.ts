import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_RETENTION_DAYS,
  backupKindLabel,
  hourlyBackupLabel,
  inHourlyBackupWindow,
  istDay,
  istHour,
  istHourKey,
  wrapBackupDownload,
} from "./company-backups-meta.ts";

test("retention is a month", () => {
  assert.equal(BACKUP_RETENTION_DAYS, 30);
});

test("kind labels are the ones shown in Settings", () => {
  assert.equal(backupKindLabel("hourly"), "Hourly");
  assert.equal(backupKindLabel("daily"), "Daily");
  assert.equal(backupKindLabel("manual"), "Saved");
  assert.equal(backupKindLabel("undo"), "Before restore");
});

test("istDay is YYYY-MM-DD in India time", () => {
  const day = istDay(new Date("2026-09-10T18:40:00.000Z"));
  assert.equal(day, "2026-09-11");
  const prev = istDay(new Date("2026-09-10T18:20:00.000Z"));
  assert.equal(prev, "2026-09-10");
});

test("hourly window is 9am through 3am India time", () => {
  // 09:00 IST
  assert.equal(istHour(new Date("2026-09-15T03:30:00.000Z")), 9);
  assert.equal(inHourlyBackupWindow(new Date("2026-09-15T03:30:00.000Z")), true);
  // 15:00 IST
  assert.equal(inHourlyBackupWindow(new Date("2026-09-15T09:30:00.000Z")), true);
  // 03:00 IST
  assert.equal(istHour(new Date("2026-09-14T21:30:00.000Z")), 3);
  assert.equal(inHourlyBackupWindow(new Date("2026-09-14T21:30:00.000Z")), true);
  // 03:59 IST
  assert.equal(inHourlyBackupWindow(new Date("2026-09-14T22:29:00.000Z")), true);
  // 04:00 IST — quiet hours
  assert.equal(istHour(new Date("2026-09-14T22:30:00.000Z")), 4);
  assert.equal(inHourlyBackupWindow(new Date("2026-09-14T22:30:00.000Z")), false);
  // 08:00 IST
  assert.equal(inHourlyBackupWindow(new Date("2026-09-15T02:30:00.000Z")), false);
});

test("hour key is one slot per IST hour", () => {
  assert.equal(istHourKey(new Date("2026-09-15T03:30:00.000Z")), "2026-09-15-09");
  assert.equal(istHourKey(new Date("2026-09-15T03:59:00.000Z")), "2026-09-15-09");
  assert.equal(istHourKey(new Date("2026-09-14T21:30:00.000Z")), "2026-09-15-03");
});

test("hourly label names the India clock time", () => {
  const label = hourlyBackupLabel(new Date("2026-09-15T03:30:00.000Z"));
  assert.match(label, /^Hourly · /);
  assert.match(label, /9/i);
});

test("download wrap keeps restore-compatible state", () => {
  const state = { people: [{ id: "p-1" }], roles: { ceo: { id: "ceo" } } };
  const wrapped = wrapBackupDownload(state, {
    id: "bk-1",
    kind: "hourly",
    createdAt: "2026-09-11T03:30:00.000Z",
    expiresAt: "2026-10-11T03:30:00.000Z",
    createdBy: "hourly",
    label: "Hourly · 11 Sep, 9:00 am",
    peopleCount: 1,
    bytes: 12,
    restoredAt: null,
    restoredBy: "",
    restoreOf: "",
  });
  assert.equal(wrapped.format, "aliens-apms-backup");
  assert.equal(wrapped.state, state);
  assert.equal(wrapped.vault.id, "bk-1");
  assert.equal(wrapped.vault.kind, "hourly");
});
