import { createHash } from "node:crypto";

export const BOOK_IDS = ["org", "plans", "months", "targets"] as const;
export type BookId = (typeof BOOK_IDS)[number];

export type Snapshot = Record<string, unknown>;

const ROLE_KROC_FIELDS = ["kras", "ags", "competencies"] as const;

const BOOK_FIELDS: Record<BookId, readonly string[]> = {
  org: [
    "companies",
    "brands",
    "businessUnits",
    "sbuMembers",
    "functions",
    "subFunctions",
    "people",
    "roles",
    "accessRoles",
    "customReports",
    "reportFolders",
    "notices",
    "appRequests",
    "dismissedAlertIds",
    "setupDone",
    "companyFactor",
    "pendingRoleDeletes",
    "roleCases",
    "months",
    "seedGeneration",
    "notebookId",
    "notebookSource",
    "notebookUpdatedAt",
    "trash",
    "tombstones",
    "bookGens",
    "logins",
  ],
  plans: [
    "valuesCatalog",
    "kpiMaster",
    "apmsPlans",
    "awardInstances",
    "awardBandShares",
    "awardMeasures",
    "gateUnits",
    "roleKrocs",
  ],
  months: [
    "apmsMonths",
    "records",
    "roleMonths",
    "rewardRecords",
    "rewardRoleMonths",
    "agsMonths",
    "agsReviews",
    "periodReviews",
    "gateMonths",
  ],
  targets: [
    "sbuTargets",
    "targetHistory",
    "targetNodes",
    "targetMembers",
    "targetCells",
    "targetMonthStatus",
    "targetRootOrder",
  ],
};

const FIELD_TO_BOOK = new Map<string, BookId>();
for (const id of BOOK_IDS) {
  for (const field of BOOK_FIELDS[id]) FIELD_TO_BOOK.set(field, id);
}

const SESSION_KEYS = new Set([
  "currentUserId",
  "currentMonth",
  "view",
  "kind",
  "selectedPersonId",
  "selectedMonth",
  "selectedRoleId",
  "selectedTargetMonth",
  "selectedApmsId",
  "selectedAwardId",
  "selectedFunctionId",
  "selectedSbuId",
  "selectedBrandId",
  "selectedAgsId",
  "selectedPeriodId",
  "selectedRoleCaseId",
  "navHistory",
  "orgFilterBrandId",
  "impersonatorId",
  "notebookBaseAt",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (v !== undefined) out[key] = sortValue(v);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function bookHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function peelRoleKrocs(roles: unknown): {
  roles: Record<string, unknown>;
  roleKrocs: Record<string, unknown>;
} {
  const next: Record<string, unknown> = {};
  const krocs: Record<string, unknown> = {};
  if (!isPlainObject(roles)) return { roles: next, roleKrocs: krocs };
  for (const [id, raw] of Object.entries(roles)) {
    if (!isPlainObject(raw)) {
      next[id] = raw;
      continue;
    }
    const role: Record<string, unknown> = { ...raw };
    const kroc: Record<string, unknown> = {};
    for (const field of ROLE_KROC_FIELDS) {
      if (field in role) {
        kroc[field] = role[field];
        delete role[field];
      }
    }
    next[id] = role;
    if (Object.keys(kroc).length) krocs[id] = kroc;
  }
  return { roles: next, roleKrocs: krocs };
}

function applyRoleKrocs(roles: unknown, roleKrocs: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainObject(roles) ? { ...roles } : {};
  if (!isPlainObject(roleKrocs)) return next;
  for (const [id, kroc] of Object.entries(roleKrocs)) {
    const role = isPlainObject(next[id]) ? { ...(next[id] as Record<string, unknown>) } : { id };
    next[id] = { ...role, ...(isPlainObject(kroc) ? kroc : {}) };
  }
  return next;
}

export function splitSnapshot(snapshot: Snapshot): Record<BookId, Snapshot> {
  const books: Record<BookId, Snapshot> = {
    org: {},
    plans: {},
    months: {},
    targets: {},
  };
  for (const [key, value] of Object.entries(snapshot)) {
    if (SESSION_KEYS.has(key)) continue;
    const book = FIELD_TO_BOOK.get(key) ?? "org";
    books[book][key] = value;
  }
  const peeled = peelRoleKrocs(books.org.roles);
  books.org.roles = peeled.roles;
  const existing = isPlainObject(books.plans.roleKrocs) ? books.plans.roleKrocs : {};
  books.plans.roleKrocs = { ...peeled.roleKrocs, ...existing };
  return books;
}

export function assembleSnapshot(books: Partial<Record<BookId, Snapshot | null>>): Snapshot {
  const snap: Snapshot = {};
  for (const id of BOOK_IDS) {
    const book = books[id];
    if (!isPlainObject(book)) continue;
    Object.assign(snap, book);
  }
  snap.roles = applyRoleKrocs(snap.roles, snap.roleKrocs);
  delete snap.roleKrocs;
  snap.bookGens = normalizeBookGens(snap);
  return snap;
}

export function peopleCount(snapshot: Snapshot | null | undefined): number {
  const people = snapshot?.people;
  return Array.isArray(people) ? people.length : 0;
}

/** True when incoming looks like an old preview/seed replica, not a real org shrink. */
export function wouldShrinkLive(
  incoming: Snapshot,
  stored: Snapshot | null | undefined,
): boolean {
  const live = peopleCount(stored);
  if (live < 10) return false;
  return peopleCount(incoming) < Math.max(10, Math.floor(live * 0.7));
}

const ID_ARRAY_KEYS = new Set([
  "people",
  "companies",
  "brands",
  "businessUnits",
  "functions",
  "subFunctions",
  "notices",
  "appRequests",
  "customReports",
  "reportFolders",
  "trash",
  "pendingRoleDeletes",
  "roleCases",
  "awardInstances",
  "awardMeasures",
  "kpiMaster",
  "valuesCatalog",
  "agsReviews",
  "targetHistory",
]);

const PAIR_ARRAY_KEYS: Record<string, readonly [string, string]> = {
  sbuMembers: ["groupId", "memberId"],
};

const UNION_STRING_KEYS = new Set(["dismissedAlertIds", "months"]);

const MAP_KEYS = new Set([
  "roles",
  "accessRoles",
  "logins",
  "records",
  "rewardRecords",
  "apmsMonths",
  "roleMonths",
  "rewardRoleMonths",
  "agsMonths",
  "gateMonths",
  "targetNodes",
  "targetCells",
  "targetMembers",
  "apmsPlans",
  "gateUnits",
  "awardBandShares",
  "sbuTargets",
  "targetMonthStatus",
  "targetRootOrder",
  "periodReviews",
]);

const META_KEYS = new Set(["notebookBaseAt", "currentUserId", "impersonatorId"]);

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return stableStringify(a) === stableStringify(b);
}

function stamp(row: unknown): number {
  if (!isPlainObject(row)) return 0;
  const n = Number(row.updatedAt);
  return Number.isFinite(n) ? n : 0;
}

function isEmptyVal(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function looksLikeObjectArray(...vals: unknown[]): boolean {
  if (vals.some((v) => isPlainObject(v) && Object.keys(v).length > 0)) return false;
  const arrays = vals.filter(Array.isArray) as unknown[][];
  if (!arrays.length) return false;
  return arrays.every(
    (a) => a.length === 0 || a.every((x) => x == null || isPlainObject(x)),
  );
}

function rowKey(row: Record<string, unknown>): string {
  const id = String(row.id || "");
  if (id) return `id:${id}`;
  const planId = String(row.planId || "");
  const month = String(row.month || "");
  if (planId && month) return `plan:${planId}\0${month}`;
  const groupId = String(row.groupId ?? "");
  const memberId = String(row.memberId ?? "");
  if (groupId || memberId) return `mem:${month}\0${groupId}\0${memberId}`;
  return `row:${stableStringify(row)}`;
}

function indexByRowKey(rows: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const arr = Array.isArray(rows) ? rows : [];
  for (const row of arr) {
    if (!isPlainObject(row)) continue;
    map.set(rowKey(row), row);
  }
  return map;
}

function indexByPair(
  rows: unknown,
  a: string,
  b: string,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const key = `${row[a] ?? ""}\0${row[b] ?? ""}`;
    if (key === "\0") continue;
    map.set(key, row);
  }
  return map;
}

function asMap(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

type MergeOpts = { honorIncomingDeletes?: boolean; incomingNewer?: boolean; haveBase?: boolean };

function pickConflict(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  opts: MergeOpts = {},
): Record<string, unknown> {
  const ts = stamp(stored);
  const ti = stamp(incoming);
  if (ti && ts && ti !== ts) {
    return ti > ts ? { ...stored, ...incoming } : { ...incoming, ...stored };
  }
  if (opts.incomingNewer) return { ...stored, ...incoming };
  if (ti && !ts) return { ...stored, ...incoming };
  if (ts && !ti) return { ...incoming, ...stored };
  return { ...incoming, ...stored };
}

function mergeObject(
  base: unknown,
  stored: unknown,
  incoming: unknown,
  opts: MergeOpts = {},
): Record<string, unknown> {
  const b = isPlainObject(base) ? base : {};
  const s = isPlainObject(stored) ? stored : {};
  const i = isPlainObject(incoming) ? incoming : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(s), ...Object.keys(i)]);
  const out: Record<string, unknown> = { ...s };
  for (const key of keys) {
    const bv = b[key];
    const sv = s[key];
    const iv = i[key];
    if (eq(sv, iv)) out[key] = sv;
    else if (eq(iv, bv)) out[key] = sv;
    else if (eq(sv, bv)) out[key] = iv;
    else if (isPlainObject(sv) || isPlainObject(iv) || isPlainObject(bv)) {
      out[key] = mergeObject(bv, sv, iv, opts);
    } else {
      out[key] = pickConflict(s, i, opts)[key] ?? (opts.incomingNewer ? iv : sv);
    }
  }
  const latest = Math.max(stamp(s), stamp(i));
  if (latest) out.updatedAt = latest;
  return out;
}

function mergeKeyedRows(
  b: Map<string, Record<string, unknown>>,
  s: Map<string, Record<string, unknown>>,
  i: Map<string, Record<string, unknown>>,
  opts: MergeOpts = {},
): unknown[] {
  const ids = new Set([...b.keys(), ...s.keys(), ...i.keys()]);
  const out: unknown[] = [];
  const haveBase = !!opts.haveBase;
  const incomingNewer = !!opts.incomingNewer;
  const honor = !!opts.honorIncomingDeletes;
  for (const id of ids) {
    const br = b.get(id);
    const sr = s.get(id);
    const ir = i.get(id);
    if (!sr && ir) {
      if (br && eq(br, ir)) continue;
      if (!haveBase && !incomingNewer) continue;
      out.push(ir);
      continue;
    }
    if (sr && !ir) {
      if (br && eq(br, sr)) continue;
      if (haveBase && !br) {
        out.push(sr);
        continue;
      }
      if (honor && incomingNewer) continue;
      out.push(sr);
      continue;
    }
    if (sr && ir) out.push(mergeObject(br, sr, ir, opts));
  }
  return out;
}

function mergeObjectArray(
  base: unknown,
  stored: unknown,
  incoming: unknown,
  opts: MergeOpts = {},
): unknown[] {
  return mergeKeyedRows(indexByRowKey(base), indexByRowKey(stored), indexByRowKey(incoming), opts);
}

function mergePairArray(
  base: unknown,
  stored: unknown,
  incoming: unknown,
  a: string,
  b: string,
  opts: MergeOpts = {},
): unknown[] {
  return mergeKeyedRows(
    indexByPair(base, a, b),
    indexByPair(stored, a, b),
    indexByPair(incoming, a, b),
    opts,
  );
}

function mergeStringList(base: unknown, stored: unknown, incoming: unknown, opts: MergeOpts = {}): unknown {
  const as = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const bset = new Set(as(base));
  const s = new Set(as(stored));
  const i = new Set(as(incoming));
  if (!opts.haveBase && opts.incomingNewer) return [...i];
  if (!opts.haveBase && !opts.incomingNewer) return [...s];
  const out = new Set(s);
  for (const x of i) if (!bset.has(x)) out.add(x);
  for (const x of bset) if (s.has(x) && !i.has(x)) out.delete(x);
  return [...out];
}

function mergeMap(
  base: unknown,
  stored: unknown,
  incoming: unknown,
  opts: MergeOpts = {},
): Record<string, unknown> {
  const b = asMap(base);
  const s = asMap(stored);
  const i = asMap(incoming);
  const keys = new Set([...Object.keys(b), ...Object.keys(s), ...Object.keys(i)]);
  const out: Record<string, unknown> = {};
  const haveBase = !!opts.haveBase;
  const incomingNewer = !!opts.incomingNewer;
  const honor = !!opts.honorIncomingDeletes;
  for (const key of keys) {
    const bv = b[key];
    const sv = s[key];
    const iv = i[key];
    if (sv === undefined && iv !== undefined) {
      if (bv !== undefined && eq(iv, bv)) continue;
      if (!haveBase && !incomingNewer) continue;
      out[key] = iv;
      continue;
    }
    if (sv !== undefined && iv === undefined) {
      if (haveBase && bv !== undefined && eq(bv, sv)) continue;
      if (haveBase && bv === undefined) {
        out[key] = sv;
        continue;
      }
      if ((honor && incomingNewer) || (!haveBase && incomingNewer)) continue;
      out[key] = sv;
      continue;
    }
    if (isPlainObject(sv) || isPlainObject(iv) || isPlainObject(bv)) {
      out[key] = mergeMap(bv, sv, iv, opts);
    } else if (eq(sv, iv)) out[key] = sv;
    else if (eq(iv, bv)) out[key] = sv;
    else if (eq(sv, bv)) out[key] = iv;
    else out[key] = incomingNewer ? iv : sv;
  }
  return out;
}

function mergeLeaf(base: unknown, stored: unknown, incoming: unknown, opts: MergeOpts = {}): unknown {
  if (eq(stored, incoming)) return stored;
  if (eq(incoming, base)) return stored;
  if (eq(stored, base)) return incoming;
  if (isPlainObject(stored) || isPlainObject(incoming) || isPlainObject(base)) {
    return mergeMap(base, stored, incoming, opts);
  }
  return opts.incomingNewer ? (incoming ?? stored) : (stored ?? incoming);
}

type Tombstones = Record<string, Record<string, number>>;

const TOMBSTONE_SKIP = new Set(["roles", "logins", "tombstones", "bookGens", "currentUserId", "notebookUpdatedAt", "notebookBaseAt", "notebookId", "notebookSource", "seedGeneration", "setupDone", "companyFactor", "currentMonth", "view", "kind"]);

function asTombstones(value: unknown): Tombstones {
  if (!isPlainObject(value)) return {};
  const out: Tombstones = {};
  for (const [field, keys] of Object.entries(value)) {
    if (!isPlainObject(keys)) continue;
    out[field] = {};
    for (const [k, ts] of Object.entries(keys)) {
      const n = Number(ts) || 0;
      if (n) out[field][k] = n;
    }
  }
  return out;
}

function unionTombstones(a: Tombstones, b: Tombstones): Tombstones {
  const out: Tombstones = {};
  for (const src of [a, b]) {
    for (const [field, keys] of Object.entries(src)) {
      out[field] = out[field] || {};
      for (const [k, ts] of Object.entries(keys)) {
        out[field][k] = Math.max(out[field][k] || 0, ts);
      }
    }
  }
  return out;
}

function collectionKeys(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    const keys = new Set<string>();
    for (const row of value) {
      if (typeof row === "string") keys.add(row);
      else if (isPlainObject(row)) keys.add(rowKey(row));
    }
    return keys;
  }
  if (isPlainObject(value)) return new Set(Object.keys(value));
  return new Set();
}

function markGone(tombs: Tombstones, field: string, key: string, at: number) {
  if (!at || !key) return;
  tombs[field] = tombs[field] || {};
  tombs[field][key] = Math.max(tombs[field][key] || 0, at);
}

function markMissingInField(tombs: Tombstones, field: string, from: unknown, incoming: unknown, at: number) {
  const had = collectionKeys(from);
  const has = collectionKeys(incoming);
  for (const k of had) if (!has.has(k)) markGone(tombs, field, k, at);
  if (isPlainObject(from) && isPlainObject(incoming)) {
    for (const k of Object.keys(incoming)) {
      const sv = from[k];
      const iv = incoming[k];
      if (isPlainObject(sv) && isPlainObject(iv)) {
        markMissingNested(tombs, `${field}/${k}`, sv, iv, at);
      }
    }
  }
}

function markMissingNested(tombs: Tombstones, field: string, from: Record<string, unknown>, incoming: Record<string, unknown>, at: number) {
  for (const k of Object.keys(from)) if (!(k in incoming)) markGone(tombs, field, k, at);
}

function collectTombstones(
  stored: Snapshot,
  incoming: Snapshot,
  base: Snapshot | null,
  incomingAt: number,
  incomingNewer: boolean,
  skipFields: Set<string> = new Set(),
): Tombstones {
  const tombs = unionTombstones(asTombstones(stored.tombstones), asTombstones(incoming.tombstones));
  if (!incomingNewer || !incomingAt) return tombs;
  const fromSnap = base || stored;
  const fields = new Set([...Object.keys(fromSnap), ...Object.keys(incoming), ...Object.keys(stored)]);
  for (const field of fields) {
    if (skipFields.has(field)) continue;
    if (TOMBSTONE_SKIP.has(field) || META_KEYS.has(field) || SESSION_KEYS.has(field)) continue;
    markMissingInField(tombs, field, fromSnap[field], incoming[field], incomingAt);
  }
  return tombs;
}

function stampOf(value: unknown): number {
  return stamp(value);
}

function shouldKeepAgainstTombstone(value: unknown, tombAt: number, incomingBaseAt: number): boolean {
  if (!tombAt) return true;
  if (stampOf(value) > tombAt) return true;
  if (incomingBaseAt > tombAt) return true;
  return false;
}

function stripMapField(value: unknown, field: string, tombs: Tombstones, incomingBaseAt: number): unknown {
  if (!isPlainObject(value)) return value;
  const t = tombs[field] || {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const tombAt = t[k] || 0;
    if (tombAt && !shouldKeepAgainstTombstone(v, tombAt, incomingBaseAt)) continue;
    out[k] = isPlainObject(v) ? stripMapField(v, `${field}/${k}`, tombs, incomingBaseAt) : v;
  }
  return out;
}

function stripArrayField(value: unknown, field: string, tombs: Tombstones, incomingBaseAt: number): unknown {
  if (!Array.isArray(value)) return value;
  const t = tombs[field] || {};
  if (!Object.keys(t).length && field !== "months") return value;
  return value.filter((row) => {
    if (typeof row === "string") return shouldKeepAgainstTombstone({ updatedAt: 0 }, t[row] || 0, incomingBaseAt);
    if (!isPlainObject(row)) return true;
    const tombAt = t[rowKey(row)] || t[String(row.id || "")] || 0;
    return shouldKeepAgainstTombstone(row, tombAt, incomingBaseAt);
  });
}

function applyTombstones(out: Snapshot, _incoming: Snapshot, tombs: Tombstones, incomingBaseAt: number, skipFields: Set<string> = new Set()) {
  for (const field of Object.keys(out)) {
    if (skipFields.has(field)) continue;
    if (TOMBSTONE_SKIP.has(field) || META_KEYS.has(field) || SESSION_KEYS.has(field)) continue;
    const v = out[field];
    if (Array.isArray(v)) out[field] = stripArrayField(v, field, tombs, incomingBaseAt);
    else if (isPlainObject(v)) out[field] = stripMapField(v, field, tombs, incomingBaseAt);
  }
}

const BOOK_EQ_SKIP = new Set([
  "notebookUpdatedAt",
  "notebookSource",
  "notebookId",
  "notebookBaseAt",
  "tombstones",
  "bookGens",
]);

export function bookPayload(snapshot: Snapshot, id: BookId): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of BOOK_FIELDS[id]) {
    if (BOOK_EQ_SKIP.has(field) || SESSION_KEYS.has(field)) continue;
    if (snapshot[field] !== undefined) out[field] = snapshot[field];
  }
  return out;
}

/**
 * 3-way merge so two sessions editing different people / roles keep both edits.
 * `base` is the snapshot the incoming client last loaded. Without it, people
 * still union (never drop a stored person) and per-row `updatedAt` breaks ties.
 *
 * Deletes are recorded as tombstones so a later stale save cannot resurrect
 * months, targets, trash, or maps the client already removed.
 */
export function mergeConcurrentSnapshots(
  stored: Snapshot,
  incoming: Snapshot,
  base?: Snapshot | null,
): Snapshot {
  const haveBase = !!(base && typeof base === "object" && Object.keys(base).length);
  const b: Snapshot = haveBase ? (base as Snapshot) : {};
  const storedAt = Number(stored.notebookUpdatedAt) || 0;
  const incomingAt = Number(incoming.notebookUpdatedAt) || 0;
  const incomingBaseAt = Number(incoming.notebookBaseAt) || 0;
  const loadedBehind = incomingBaseAt > 0 && storedAt > 0 && incomingBaseAt < storedAt;
  const incomingNewer = incomingAt >= storedAt && !loadedBehind;
  const keys = new Set([
    ...Object.keys(stored),
    ...Object.keys(incoming),
    ...Object.keys(b),
  ]);
  const out: Snapshot = { ...stored };
  const locked = new Set<string>();
  if (haveBase) {
    for (const id of BOOK_IDS) {
      const bb = bookPayload(b, id);
      const sb = bookPayload(stored, id);
      const ib = bookPayload(incoming, id);
      if (eq(ib, sb)) continue;
      if (eq(ib, bb)) {
        for (const field of BOOK_FIELDS[id]) {
          if (BOOK_EQ_SKIP.has(field) || SESSION_KEYS.has(field)) continue;
          out[field] = stored[field];
          locked.add(field);
        }
        continue;
      }
      if (eq(sb, bb)) {
        for (const field of BOOK_FIELDS[id]) {
          if (BOOK_EQ_SKIP.has(field) || SESSION_KEYS.has(field)) continue;
          const iv = incoming[field];
          const sv = stored[field];
          out[field] = isEmptyVal(iv) && isEmptyVal(sv) && sv !== undefined ? sv : iv;
          locked.add(field);
        }
      }
    }
  }
  const KEEP_WITHOUT_BASE = new Set(["people", "roles", "logins"]);
  for (const key of keys) {
    if (META_KEYS.has(key) || SESSION_KEYS.has(key) || key === "tombstones" || locked.has(key)) continue;
    const bv = b[key];
    const sv = stored[key];
    const iv = incoming[key];
    const honorIncomingDeletes = KEEP_WITHOUT_BASE.has(key) ? haveBase : haveBase || incomingNewer;
    const opts = { honorIncomingDeletes, incomingNewer, haveBase };
    if (isEmptyVal(sv) && isEmptyVal(iv)) {
      out[key] = sv !== undefined && sv !== null ? sv : iv;
      continue;
    }
    if (UNION_STRING_KEYS.has(key)) {
      out[key] = mergeStringList(bv, sv, iv, opts);
      continue;
    }
    if (ID_ARRAY_KEYS.has(key) || looksLikeObjectArray(bv, sv, iv)) {
      out[key] = mergeObjectArray(bv, sv, iv, KEEP_WITHOUT_BASE.has(key) ? { ...opts, honorIncomingDeletes: haveBase } : opts);
      continue;
    }
    const pair = PAIR_ARRAY_KEYS[key];
    if (pair) {
      out[key] = mergePairArray(bv, sv, iv, pair[0], pair[1], opts);
      continue;
    }
    if (MAP_KEYS.has(key) || isPlainObject(sv) || isPlainObject(iv)) {
      out[key] = mergeMap(bv, sv, iv, opts);
      continue;
    }
    out[key] = mergeLeaf(bv, sv, iv, opts);
  }
  const tombs = collectTombstones(stored, incoming, haveBase ? b : null, incomingAt, incomingNewer, locked);
  out.tombstones = tombs;
  applyTombstones(out, incoming, tombs, incomingBaseAt, locked);
  out.notebookUpdatedAt = Math.max(storedAt, incomingAt);
  if (!out.notebookUpdatedAt) out.notebookUpdatedAt = Date.now();
  delete out.notebookBaseAt;
  return out;
}

export type BookGens = Record<BookId, number>;

export function normalizeBookGens(snapshot: Snapshot | null | undefined): BookGens {
  const raw = snapshot && isPlainObject(snapshot.bookGens) ? snapshot.bookGens : {};
  const out = {} as BookGens;
  for (const id of BOOK_IDS) {
    const n = Number((raw as Record<string, unknown>)[id]) || 0;
    out[id] = n > 0 ? n : snapshot && !isEmptyVal(bookPayload(snapshot, id)) ? 1 : 0;
  }
  return out;
}

function hasBookGens(snapshot: Snapshot): boolean {
  return isPlainObject(snapshot.bookGens) && BOOK_IDS.some((id) => Number((snapshot.bookGens as Record<string, unknown>)[id]) > 0);
}

function unionNewPeople(stored: unknown, incoming: unknown): unknown[] {
  const s = Array.isArray(stored) ? stored : [];
  const i = Array.isArray(incoming) ? incoming : [];
  const ids = new Set(
    s.map((row) => (isPlainObject(row) ? String(row.id || "") : "")).filter(Boolean),
  );
  const extra = i.filter((row) => {
    if (!isPlainObject(row)) return false;
    const id = String(row.id || "");
    return id && !ids.has(id);
  });
  return extra.length ? [...s, ...extra] : s;
}

function stampOfRow(row: unknown): number {
  if (!isPlainObject(row)) return 0;
  const n = Number(row.updatedAt);
  return Number.isFinite(n) ? n : 0;
}

/** Keep stored people the incoming book omitted; newer updatedAt wins on overlap. */
export function mergeKeepPeople(stored: unknown, incoming: unknown): unknown[] {
  const s = Array.isArray(stored) ? stored : [];
  const i = Array.isArray(incoming) ? incoming : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of s) {
    if (!isPlainObject(row) || !row.id) continue;
    byId.set(String(row.id), row);
  }
  for (const row of i) {
    if (!isPlainObject(row) || !row.id) continue;
    const id = String(row.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, row);
      continue;
    }
    byId.set(id, stampOfRow(row) >= stampOfRow(prev) ? { ...prev, ...row } : { ...row, ...prev });
  }
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const row of i) {
    if (!isPlainObject(row) || !row.id) continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id));
  }
  for (const row of s) {
    if (!isPlainObject(row) || !row.id) continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** Month → personId → record. Union omitted months/people; never drop a live row the incoming book did not mention. */
export function mergeKeepMonthMaps(stored: unknown, incoming: unknown): unknown {
  if (!isPlainObject(incoming)) return stored ?? incoming;
  if (!isPlainObject(stored)) return incoming;
  const out: Record<string, unknown> = { ...stored };
  for (const [month, iVal] of Object.entries(incoming)) {
    const sVal = stored[month];
    if (isPlainObject(iVal) && isPlainObject(sVal)) {
      const monthOut: Record<string, unknown> = { ...sVal };
      for (const [pid, rec] of Object.entries(iVal)) {
        const prev = sVal[pid];
        if (isPlainObject(rec) && isPlainObject(prev)) {
          monthOut[pid] =
            stampOfRow(rec) >= stampOfRow(prev) ? { ...prev, ...rec } : { ...rec, ...prev };
        } else {
          monthOut[pid] = rec;
        }
      }
      out[month] = monthOut;
    } else {
      out[month] = iVal;
    }
  }
  return out;
}

const MONTH_RECORD_FIELDS = new Set([
  "records",
  "rewardRecords",
  "roleMonths",
  "rewardRoleMonths",
  "apmsMonths",
  "agsMonths",
  "agsReviews",
  "periodReviews",
  "gateMonths",
]);

function writeBookFields(
  out: Snapshot,
  stored: Snapshot,
  payload: Snapshot,
  id: BookId,
  tombs: Tombstones,
  at: number,
) {
  for (const field of BOOK_FIELDS[id]) {
    if (BOOK_EQ_SKIP.has(field) || SESSION_KEYS.has(field)) continue;
    if (!(field in payload)) continue;
    if (field === "people") out.people = mergeKeepPeople(stored.people, payload.people);
    else if (MONTH_RECORD_FIELDS.has(field)) {
      out[field] = mergeKeepMonthMaps(stored[field], payload[field]);
      if (isPlainObject(stored[field]) && isPlainObject(payload[field])) {
        for (const month of Object.keys(stored[field] as Record<string, unknown>)) {
          if (!(month in (payload[field] as Record<string, unknown>))) {
            markGone(tombs, field, month, at);
          }
        }
      }
    } else out[field] = payload[field];
  }
  for (const field of BOOK_FIELDS[id]) {
    if (BOOK_EQ_SKIP.has(field) || SESSION_KEYS.has(field) || TOMBSTONE_SKIP.has(field)) continue;
    if (MONTH_RECORD_FIELDS.has(field) || field === "people") continue;
    markMissingInField(tombs, field, stored[field], payload[field], at);
  }
}

/**
 * Save contract: each book is independently versioned.
 *
 * Fresh book (client gen === server gen): incoming payload replaces that book.
 * Stale book (client gen behind): server book is kept. Stale deletes and
 * overwrites cannot land. New people ids from a stale org save are unioned.
 *
 * This is the guarantee that deleted months, trash, and target cells cannot
 * come back from an older tab, and that an unrelated org save cannot roll
 * rewards/targets back in time.
 */
export function commitBooks(stored: Snapshot, incoming: Snapshot): Snapshot {
  const sGens = normalizeBookGens(stored);
  const iGens = normalizeBookGens(incoming);
  const incomingKnowsGens = hasBookGens(incoming);
  const storedAt = Number(stored.notebookUpdatedAt) || 0;
  const incomingAt = Number(incoming.notebookUpdatedAt) || 0;
  const incomingBaseAt = Number(incoming.notebookBaseAt) || 0;
  const loadedBehind = incomingBaseAt > 0 && storedAt > 0 && incomingBaseAt < storedAt;
  const tombs = unionTombstones(asTombstones(stored.tombstones), asTombstones(incoming.tombstones));
  const out: Snapshot = { ...stored };
  const nextGens: BookGens = { ...sGens };
  const incomingNewerFallback = incomingAt >= storedAt && !loadedBehind;

  for (const id of BOOK_IDS) {
    const sPay = bookPayload(stored, id);
    const iPay = bookPayload(incoming, id);
    if (eq(sPay, iPay)) {
      nextGens[id] = Math.max(sGens[id], iGens[id]);
      continue;
    }
    const fresh = incomingKnowsGens
      ? Number(iGens[id]) === Number(sGens[id])
      : incomingNewerFallback;
    if (!fresh) {
      if (id === "org") out.people = unionNewPeople(stored.people, incoming.people);
      continue;
    }
    writeBookFields(out, stored, incoming, id, tombs, incomingAt || Date.now());
    nextGens[id] = Math.max(sGens[id], iGens[id]) + 1;
  }

  out.bookGens = nextGens;
  out.tombstones = tombs;
  applyTombstones(out, incoming, tombs, incomingBaseAt);
  out.notebookUpdatedAt = Math.max(storedAt, incomingAt) || Date.now();
  delete out.notebookBaseAt;
  for (const key of SESSION_KEYS) delete out[key];
  return out;
}

export type BookPatchResult = {
  snapshot: Snapshot;
  applied: BookId[];
  conflict: BookId[];
  skipped: BookId[];
};

/**
 * Google Docs-style per-document write.
 * Matching baseGen merges that book (people and month records union by id;
 * incoming wins on newer updatedAt). Stale baseGen is a conflict. Unmentioned
 * books stay. Nested reward/APMS person rows are never tombstoned just because
 * another tab omitted them.
 */
export function applyBookPatches(
  stored: Snapshot,
  incomingBooks: Partial<Record<BookId, Snapshot>>,
  baseGens: Partial<Record<BookId, number>> = {},
  extraTombs?: unknown,
): BookPatchResult {
  const sGens = normalizeBookGens(stored);
  const out: Snapshot = { ...stored };
  const nextGens: BookGens = { ...sGens };
  const applied: BookId[] = [];
  const conflict: BookId[] = [];
  const skipped: BookId[] = [];
  const tombs = unionTombstones(asTombstones(stored.tombstones), asTombstones(extraTombs));
  const at = Date.now();

  for (const id of BOOK_IDS) {
    const payload = incomingBooks[id];
    if (!payload || typeof payload !== "object") {
      skipped.push(id);
      continue;
    }
    const base = Number(baseGens[id]);
    const server = Number(sGens[id] || 0);
    if (!Number.isFinite(base) || base !== server) {
      conflict.push(id);
      continue;
    }
    writeBookFields(out, stored, payload, id, tombs, at);
    nextGens[id] = server + 1;
    applied.push(id);
  }

  out.bookGens = nextGens;
  out.tombstones = tombs;
  applyTombstones(out, stored, tombs, at);
  out.notebookUpdatedAt = Math.max(Number(stored.notebookUpdatedAt) || 0, at);
  delete out.notebookBaseAt;
  for (const key of SESSION_KEYS) delete out[key];
  return { snapshot: out, applied, conflict, skipped };
}

/** PERF (p0aw5): every applied book (and the tombstones) comes out exactly as stored. */
export function bookPatchIsNoop(stored: Snapshot, merged: Snapshot, applied: readonly BookId[]): boolean {
  if (!applied.length) return false;
  if (stableStringify(stored.tombstones ?? null) !== stableStringify(merged.tombstones ?? null)) return false;
  for (const id of applied) {
    if (stableStringify(bookPayload(stored, id)) !== stableStringify(bookPayload(merged, id))) return false;
  }
  return true;
}
