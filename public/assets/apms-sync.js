/**
 * Aliens APMS per-book sync (Google Docs / Zoho grade).
 * PATCH only dirty books with baseGen. 409 rebases that book. Live pulls
 * only clean books whose generation moved. UI nav never rides the wire.
 * Stamp: p0as83 — PERF: no hint GET for rows the pushed feed carries; feed pages pushed on the live stream are applied like a poll (poll only on a gap); feed poll only when tick/SSE `seq` is past the cursor; one real tick per 5 s (30 s hidden) shared by the SPA and sync timers; list screens re-read every 20 s with If-None-Match (304). p0as79 — HOT-FEED people/month/reward/cells on /api/changes; id-list removals stick. p0as78 ROWS-V2 every collection is a row; per-row 409 → 3-way field merge; change feed /api/changes. p0as77 MOD-APMS fetch-on-access month-records. p0as76 ARMY-2. p0as75 ARMY. p0as74 MOD-ORG. p0as73 APMS. p0as72 routes. p0as69 G9. p0as60.
 */
(function (global) {
  "use strict";

  var BOOK_IDS = ["org", "plans", "months", "targets"];
  var LIVE_ENTITY_CAP = 20;
  var BOOK_FIELDS = {
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
      // Row-owned (award-prizes rows, settings/rewardYearSeed) and on the wire:
      // without them here the baseline never held them, so every save
      // re-proposed all prizes and the seed as new rows (409 probes).
      "awardPrizeCatalog",
      "rewardYearSeed",
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
  var SESSION_KEYS = [
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
  ];
  var SESSION_SET = {};
  SESSION_KEYS.forEach(function (k) {
    SESSION_SET[k] = 1;
  });
  var STRING_LIST = { dismissedAlertIds: 1, months: 1 };
  var SKIP_EQ = { notebookUpdatedAt: 1, notebookSource: 1, notebookId: 1, notebookBaseAt: 1, tombstones: 1, bookGens: 1 };
  var ROLE_KROC = ["kras", "ags", "competencies"];
  var SAVE_FN = "/_serverFn/b4b4aa7e0ac816b4d5b83f44cd4fa14cbee181632dfc30d951bda1da6d06ecdb";

  var lastHashes = emptyBooks("");
  var replayFeedOnHooks = false;
  var lastGens = emptyBooks(0);
  var lastRemoteAt = 0;
  var lastPulledAt = 0;
  var lastWireAt = 0;
  var lastTickHadGens = false;
  var everLoaded = false;
  var lastRowConflicts = [];
  var dismissedConflicts = {};
  var lastAcked = emptyBooks(null);
  var pendingEntities = [];
  var seenEntityKeys = {};
  var remoteGens = emptyBooks(0);
  var rawFetch = null;
  var installed = false;
  var lastSaveMeta = null;
  var lastPullMeta = null;
  var saveQueues = emptyBooks(Promise.resolve());

  // ROWS-V2 — generic row sync for every collection described in apms-collections.js.
  var C = global.__apmsCollections || null;
  var liveSeq = 0;
  var lastChangesAt = 0;
  var announcedSeq = 0;
  var pollIssuedSeq = 0;
  var PUSH_WAIT_MS = 1500;
  var changesInFlight = null;
  var lastMergeTrace = [];

  function fieldBook(field) {
    for (var i = 0; i < BOOK_IDS.length; i++) {
      if (BOOK_FIELDS[BOOK_IDS[i]].indexOf(field) >= 0) return BOOK_IDS[i];
    }
    return null;
  }

  function rowsById(spec, value) {
    var map = {};
    if (!C) return map;
    C.toRows(spec, value).forEach(function (row) {
      map[row.id] = row;
    });
    return map;
  }

  function isObjArrayWithIds(v) {
    if (!Array.isArray(v) || !v.length) return false;
    for (var i = 0; i < v.length; i++) {
      if (!isPlainObject(v[i]) || v[i].id === undefined || v[i].id === null) return false;
    }
    return true;
  }
  function idArrayOrEmpty(v) {
    return Array.isArray(v) && (v.length === 0 || isObjArrayWithIds(v));
  }
  function mergeableIdArrays(mine, theirs) {
    return idArrayOrEmpty(mine) && idArrayOrEmpty(theirs) && (isObjArrayWithIds(mine) || isObjArrayWithIds(theirs));
  }

  /**
   * Three-way merge of one row: base = what this client last had acked,
   * mine = the local edit, theirs = the server's current row.
   *   - a field only I changed keeps my value
   *   - a field only they changed takes their value
   *   - a field we both changed: recurse into objects and id-arrays; on a
   *     primitive clash the local edit wins (latest writer of that cell), and
   *     the clash is recorded so the UI can show it if it wants to.
   * Never drops a field the other side added. Google-Sheets semantics.
   */
  function merge3(base, mine, theirs, trace, path) {
    trace = trace || [];
    path = path || "";
    if (eq(mine, theirs)) return mine;
    if (eq(mine, base)) return theirs;
    if (eq(theirs, base)) return mine;
    if (isPlainObject(mine) && isPlainObject(theirs)) {
      var b = isPlainObject(base) ? base : {};
      var out = {};
      var keys = {};
      Object.keys(mine).forEach(function (k) { keys[k] = 1; });
      Object.keys(theirs).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var inMine = Object.prototype.hasOwnProperty.call(mine, k);
        var inTheirs = Object.prototype.hasOwnProperty.call(theirs, k);
        var inBase = Object.prototype.hasOwnProperty.call(b, k);
        if (inMine && inTheirs) {
          out[k] = merge3(b[k], mine[k], theirs[k], trace, path ? path + "." + k : k);
        } else if (inMine && !inTheirs) {
          // they removed it, or I added it
          if (inBase && eq(mine[k], b[k])) return; // they deleted, I did not touch → gone
          out[k] = mine[k];
        } else if (!inMine && inTheirs) {
          if (inBase && eq(theirs[k], b[k])) return; // I deleted, they did not touch → gone
          out[k] = theirs[k];
        }
      });
      return out;
    }
    if (mergeableIdArrays(mine, theirs)) {
      var bm = {};
      (Array.isArray(base) ? base : []).forEach(function (r) { if (isPlainObject(r) && r.id != null) bm[String(r.id)] = r; });
      var mm = {};
      mine.forEach(function (r) { mm[String(r.id)] = r; });
      var tm = {};
      theirs.forEach(function (r) { tm[String(r.id)] = r; });
      var order = [];
      var seen = {};
      mine.concat(theirs).forEach(function (r) {
        var id = String(r.id);
        if (seen[id]) return;
        seen[id] = 1;
        order.push(id);
      });
      var list = [];
      order.forEach(function (id) {
        var inM = Object.prototype.hasOwnProperty.call(mm, id);
        var inT = Object.prototype.hasOwnProperty.call(tm, id);
        var inB = Object.prototype.hasOwnProperty.call(bm, id);
        if (inM && inT) list.push(merge3(bm[id], mm[id], tm[id], trace, path + "[" + id + "]"));
        else if (inM && !inT) {
          // They removed an item this side had (an EO moved to trash, a KPI
          // deleted): the removal stands, even if this side edited it from a
          // stale screen. Only an item this side added is kept.
          if (inB) {
            if (!eq(mm[id], bm[id])) trace.push({ path: path + "[" + id + "]", removedBy: "theirs" });
            return;
          }
          list.push(mm[id]);
        } else if (!inM && inT) {
          // Same the other way: this side removed it.
          if (inB) {
            if (!eq(tm[id], bm[id])) trace.push({ path: path + "[" + id + "]", removedBy: "mine" });
            return;
          }
          list.push(tm[id]);
        }
      });
      return list;
    }
    if (isPrimitiveList(mine) && isPrimitiveList(theirs)) {
      // Lists of ids (target root order, members, setupDone, …): a removal by
      // either side sticks, an addition by either side is kept, my order wins.
      var baseList = isPrimitiveList(base) ? base : [];
      var inBaseP = {};
      baseList.forEach(function (x) { inBaseP[pk(x)] = 1; });
      var inMineP = {};
      mine.forEach(function (x) { inMineP[pk(x)] = 1; });
      var inTheirsP = {};
      theirs.forEach(function (x) { inTheirsP[pk(x)] = 1; });
      var outP = [];
      var seenP = {};
      mine.concat(theirs).forEach(function (x) {
        var k = pk(x);
        if (seenP[k]) return;
        seenP[k] = 1;
        var removedByMe = inBaseP[k] && !inMineP[k];
        var removedByThem = inBaseP[k] && !inTheirsP[k];
        if (removedByMe || removedByThem) return;
        outP.push(x);
      });
      return outP;
    }
    trace.push({ path: path, mine: mine, theirs: theirs });
    return mine;
  }

  function isPrimitiveList(v) {
    if (!Array.isArray(v)) return false;
    for (var i = 0; i < v.length; i++) {
      var t = typeof v[i];
      if (t !== "string" && t !== "number") return false;
    }
    return true;
  }
  function pk(x) {
    return typeof x + ":" + String(x);
  }

  /**
   * The acked baseline of one generic field, in row shape. `roles` rows carry
   * kras / ags / competencies, but the book split (noteLoaded) keeps those in
   * plans.roleKrocs — fold them back so an untouched role is not a diff. The
   * role's own fields win (after a save lastAcked.org.roles is already whole).
   */
  function ackedFieldValue(spec) {
    var acked = lastAcked[spec.book] || {};
    var value = acked[spec.field];
    if (spec.field !== "roles" || !isPlainObject(value)) return value;
    var krocs = lastAcked.plans && lastAcked.plans.roleKrocs;
    if (!isPlainObject(krocs)) return value;
    var out = {};
    Object.keys(value).forEach(function (id) {
      var role = value[id];
      out[id] = isPlainObject(role) && isPlainObject(krocs[id]) ? Object.assign({}, krocs[id], role) : role;
    });
    return out;
  }

  /**
   * Ordered lists (a target group's members): the order is the array order on
   * screen, which rows do not carry. Keep each row's `pos`; when the order of a
   * group's members changed against the baseline, number that group 0..n-1 so
   * the reorder is saved (and reaches other users) like any field.
   */
  function withPositions(spec, list, acked) {
    if (!Array.isArray(list)) return list;
    var groupKey = function (x) { return isPlainObject(x) ? String(x.groupId) + "\u0001" + String(x.month) : ""; };
    var prevPos = {};
    var prevSeq = {};
    (Array.isArray(acked) ? C.sortByPos(acked) : []).forEach(function (x, i) {
      var k = C.rowKey(spec, x, i);
      if (isPlainObject(x) && typeof x.pos === "number") prevPos[k] = x.pos;
      var g = groupKey(x);
      (prevSeq[g] = prevSeq[g] || []).push(k);
    });
    var nextSeq = {};
    list.forEach(function (x, i) {
      var g = groupKey(x);
      (nextSeq[g] = nextSeq[g] || []).push(C.rowKey(spec, x, i));
    });
    var moved = {};
    Object.keys(nextSeq).forEach(function (g) {
      var had = prevSeq[g] || [];
      var common = nextSeq[g].filter(function (k) { return had.indexOf(k) >= 0; });
      var was = had.filter(function (k) { return common.indexOf(k) >= 0; });
      if (common.join("\u0002") !== was.join("\u0002")) moved[g] = 1;
    });
    var counters = {};
    return list.map(function (x, i) {
      if (!isPlainObject(x)) return x;
      var g = groupKey(x);
      var k = C.rowKey(spec, x, i);
      if (moved[g]) {
        var n = counters[g] || 0;
        counters[g] = n + 1;
        return x.pos === n ? x : Object.assign({}, x, { pos: n });
      }
      if (typeof x.pos !== "number" && typeof prevPos[k] === "number") return Object.assign({}, x, { pos: prevPos[k] });
      return x;
    });
  }

  /**
   * Rows a screen makes up by itself that carry nothing yet, so opening a
   * page or signing in never writes.
   *
   * "Add review" (My APMS) puts an empty, not-yet-opened review into the
   * store just to show the page. It carries nothing a missing review does not
   * ("idle" = no review), so it is not written: opening a page never writes.
   * "Open review" (status leaves idle) or any typed note makes it a real row.
   */
  // Month reminders (plan due / late / close) that every signed-in screen
  // derives from the data on its own (ensureCycleNotices). Saving each one a
  // screen derived was a write on every sign-in; they are saved once someone
  // acts on one (done, dismissed: any other field or status).
  var AUTO_NOTICE = { plan_due: 1, plan_late: 1, month_close_due: 1 };
  var AUTO_NOTICE_KEYS = { id: 1, kind: 1, title: 1, body: 1, fromId: 1, toIds: 1, month: 1, planKind: 1, phase: 1, subjectId: 1, status: 1, createdAt: 1, scope: 1 };
  function isPlaceholderRow(spec, payload) {
    if (!spec || !isPlainObject(payload)) return false;
    if (spec.kind === "notices") {
      if (!AUTO_NOTICE[payload.kind] || (payload.status && payload.status !== "open")) return false;
      return Object.keys(payload).every(function (k) { return AUTO_NOTICE_KEYS[k] === 1; });
    }
    if (spec.kind !== "period-reviews") return false;
    if (payload.status && payload.status !== "idle") return false;
    if (payload.selfNote || payload.managerNote) return false;
    if (isPlainObject(payload.ags) && Object.keys(payload.ags).length) return false;
    return true;
  }

  /**
   * Passwords this client saved that the server accepted but never echoes back
   * (NO-SECRETS-WIRE strips `password` from every read). Without this the
   * saved row looks edited forever (local has the password, the acked copy
   * from the server has none) and every later save re-sends this screen's copy
   * of the whole row — over other users' newer fields.
   */
  var sentSecrets = {};
  function sansSentSecret(revKey, next, prev) {
    if (!isPlainObject(next) || !next.password || (isPlainObject(prev) && prev.password)) return next;
    if (sentSecrets[revKey] !== next.password) return next;
    var out = Object.assign({}, next);
    delete out.password;
    return out;
  }

  function genericOpsFor(spec, snap, ops) {
    // A field the UI snapshot does not carry (e.g. roleKrocs, a book-storage
    // split) is "not held here", never "every row deleted".
    if (snap[spec.field] === undefined) return;
    var prev = rowsById(spec, ackedFieldValue(spec));
    var nextValue = spec.ordered ? withPositions(spec, snap[spec.field], ackedFieldValue(spec)) : snap[spec.field];
    var next = rowsById(spec, nextValue);
    Object.keys(next).forEach(function (id) {
      if (prev[id] && eq(sansSentSecret("e:" + spec.kind + ":" + id, next[id].payload, prev[id].payload), prev[id].payload)) return;
      var row = next[id];
      if (!prev[id] && isPlaceholderRow(spec, row.payload)) return;
      ops.push({
        kind: "e:" + spec.kind,
        spec: spec,
        field: spec.field,
        rowId: row.id,
        k1: row.k1,
        k2: row.k2,
        url: C.rowPath(row),
        payload: sansSentSecret("e:" + spec.kind + ":" + row.id, row.payload, prev[id] && prev[id].payload),
        deleted: false,
        revKey: "e:" + spec.kind + ":" + row.id,
      });
    });
    Object.keys(prev).forEach(function (id) {
      if (next[id]) return;
      var row = prev[id];
      ops.push({
        kind: "e:" + spec.kind,
        spec: spec,
        field: spec.field,
        rowId: row.id,
        k1: row.k1,
        k2: row.k2,
        url: C.rowPath(row),
        payload: row.payload,
        deleted: true,
        revKey: "e:" + spec.kind + ":" + row.id,
      });
    });
  }

  function genericRowFromOp(op, payload) {
    return { kind: op.spec.kind, id: op.rowId, k1: op.k1, k2: op.k2, payload: payload };
  }

  /**
   * Apply one generic row into a snapshot. With alsoAck the same row is queued
   * to be folded into lastAcked — committed only once the UI actually took the
   * new snapshot (commitPendingAcks), so a blocked apply never leaves the
   * baseline ahead of the screen (which would make the next save resend the
   * stale local value over the other user's change).
   */
  var pendingAcks = [];
  /**
   * Acks are scoped to the flow that built the snapshot they belong to.
   * pullLive merges rows between awaits while pollChanges / hint GETs apply
   * their own snapshots; one shared queue let one flow commit the other's
   * acks — the baseline then held a row the screen never took, and the next
   * save sent the screen's old value as an edit (a silent revert).
   */
  var ackSink = null;
  function pushAck(fn) {
    (ackSink || pendingAcks).push(fn);
  }
  function withAcks(list, fn) {
    var prev = ackSink;
    ackSink = list;
    try {
      return fn();
    } finally {
      ackSink = prev;
    }
  }
  function runAcks(list) {
    (list || []).forEach(function (fn) { fn(); });
    return (list || []).length;
  }
  /**
   * Generic rows this client has ever held (loaded, pulled or acked). A save
   * that finds the row tombstoned is a stale edit when the id is known here —
   * the delete stands; only a never-seen id is a genuine create.
   */
  var knownRowKeys = {};
  /**
   * Rows another user deleted (learned from the feed or a 409). A later save
   * that re-adds one (not in the baseline) comes from stale screen state — an
   * SPA list rebuilt from memory — so it is not sent: the delete stands.
   */
  var remoteDeletedKeys = {};
  /**
   * Rows this client puts back from Trash in the current save (explicit user
   * action). Only set after the trash row itself was deleted on the server by
   * this save; such a row may re-create its tombstone (baseRev = tombstone rev).
   */
  var trashRestoreKeys = {};
  function trashRestoredKeys(trashOp, ops) {
    var item = ackedSlice(trashOp) || trashOp.payload || {};
    var snap = isPlainObject(item.snapshot) ? item.snapshot : null;
    if (!snap) return [];
    var keys = [];
    ops.forEach(function (op) {
      if (op.deleted) return;
      // BATCH-2: a person put back from Trash (hot people row) counts too.
      if (op.kind === "people") {
        if (Array.isArray(snap.people) && snap.people.some(function (x) { return isPlainObject(x) && String(x.id) === String(op.personId); })) keys.push(op.revKey);
        return;
      }
      if (!op.spec || op.spec.kind === "trash" || snap[op.spec.field] === undefined) return;
      if (rowsById(op.spec, snap[op.spec.field])[op.rowId]) keys.push(op.revKey);
    });
    return keys;
  }
  function rememberRows(snapshot) {
    if (!C || !isPlainObject(snapshot)) return;
    C.SPECS.forEach(function (spec) {
      if (snapshot[spec.field] === undefined) return;
      Object.keys(rowsById(spec, snapshot[spec.field])).forEach(function (id) {
        knownRowKeys["e:" + spec.kind + ":" + id] = 1;
      });
    });
  }
  function applyGenericRow(snap, spec, row, deleted, alsoAck) {
    var out = Object.assign({}, snap);
    var value = C.applyRow(spec, out[spec.field], row, deleted);
    if (value === undefined) delete out[spec.field];
    else out[spec.field] = value;
    if (alsoAck) {
      pushAck(function () {
        knownRowKeys["e:" + spec.kind + ":" + row.id] = 1;
        var book = spec.book;
        lastAcked[book] = lastAcked[book] || {};
        var av = C.applyRow(spec, lastAcked[book][spec.field], row, deleted);
        if (av === undefined) delete lastAcked[book][spec.field];
        else lastAcked[book][spec.field] = av;
        lastHashes[book] = stableStringify(bookPayload(lastAcked[book], book));
      });
    }
    return out;
  }
  function commitPendingAcks() {
    var list = pendingAcks;
    pendingAcks = [];
    list.forEach(function (fn) { fn(); });
    return list.length;
  }
  function discardPendingAcks() {
    var n = pendingAcks.length;
    pendingAcks = [];
    return n;
  }

  function emptyBooks(fill) {
    return { org: fill, plans: fill, months: fill, targets: fill };
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function listify(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      return Object.keys(v)
        .map(function (k) {
          return v[k];
        })
        .filter(function (x) {
          return x != null;
        });
    }
    return [];
  }

  function normalizeKra(k) {
    if (!isPlainObject(k)) return k;
    var o = Object.assign({}, k);
    o.kpis = listify(o.kpis).map(function (kpi) {
      if (!isPlainObject(kpi)) return kpi;
      var p = Object.assign({}, kpi);
      if ("children" in p) p.children = listify(p.children);
      return p;
    });
    return o;
  }

  function normalizePlanRec(rec) {
    if (!isPlainObject(rec)) return rec;
    var out = Object.assign({}, rec);
    if ("rewardFlags" in out) out.rewardFlags = listify(out.rewardFlags);
    if ("kras" in out) out.kras = listify(out.kras).map(normalizeKra);
    if ("ags" in out) out.ags = listify(out.ags);
    if ("competencies" in out) out.competencies = listify(out.competencies);
    if ("brands" in out) {
      out.brands = listify(out.brands).map(function (b) {
        if (!isPlainObject(b)) return b;
        var bb = Object.assign({}, b);
        if ("kras" in bb) bb.kras = listify(bb.kras).map(normalizeKra);
        return bb;
      });
    }
    return out;
  }

  function sortValue(value) {
    if (Array.isArray(value)) return value.map(sortValue);
    if (!isPlainObject(value)) return value;
    var out = {};
    Object.keys(value)
      .sort()
      .forEach(function (key) {
        if (value[key] !== undefined) out[key] = sortValue(value[key]);
      });
    return out;
  }

  function stableStringify(value) {
    return JSON.stringify(sortValue(value));
  }

  function eq(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    return stableStringify(a) === stableStringify(b);
  }

  function stamp(row) {
    if (!isPlainObject(row)) return 0;
    var n = Number(row.updatedAt);
    return Number.isFinite(n) ? n : 0;
  }

  function rowKey(row) {
    if (!isPlainObject(row)) return "row:" + stableStringify(row);
    var id = String(row.id || "");
    if (id) return "id:" + id;
    var planId = String(row.planId || "");
    var month = String(row.month || "");
    if (planId && month) return "plan:" + planId + "\0" + month;
    var groupId = String(row.groupId ?? "");
    var memberId = String(row.memberId ?? "");
    if (groupId || memberId) return "mem:" + month + "\0" + groupId + "\0" + memberId;
    return "row:" + stableStringify(row);
  }

  function peelRoleKrocs(roles) {
    var next = {};
    var krocs = {};
    if (!isPlainObject(roles)) return { roles: next, roleKrocs: krocs };
    Object.keys(roles).forEach(function (id) {
      var raw = roles[id];
      if (!isPlainObject(raw)) {
        next[id] = raw;
        return;
      }
      var role = Object.assign({}, raw);
      var kroc = {};
      ROLE_KROC.forEach(function (field) {
        if (field in role) {
          kroc[field] = role[field];
          delete role[field];
        }
      });
      next[id] = role;
      if (Object.keys(kroc).length) krocs[id] = kroc;
    });
    return { roles: next, roleKrocs: krocs };
  }

  function applyRoleKrocs(roles, roleKrocs) {
    var next = isPlainObject(roles) ? Object.assign({}, roles) : {};
    if (!isPlainObject(roleKrocs)) return next;
    Object.keys(roleKrocs).forEach(function (id) {
      var kroc = roleKrocs[id];
      var role = isPlainObject(next[id]) ? Object.assign({}, next[id]) : { id: id };
      next[id] = Object.assign({}, role, isPlainObject(kroc) ? kroc : {});
    });
    return next;
  }

  function stripUi(snapshot) {
    if (!isPlainObject(snapshot)) return {};
    var out = Object.assign({}, snapshot);
    SESSION_KEYS.forEach(function (key) {
      delete out[key];
    });
    return out;
  }

  function splitSnapshot(snapshot) {
    var books = { org: {}, plans: {}, months: {}, targets: {} };
    var fieldToBook = {};
    BOOK_IDS.forEach(function (id) {
      BOOK_FIELDS[id].forEach(function (field) {
        fieldToBook[field] = id;
      });
    });
    if (!isPlainObject(snapshot)) return books;
    Object.keys(snapshot).forEach(function (key) {
      if (SESSION_SET[key]) return;
      var book = fieldToBook[key] || "org";
      books[book][key] = snapshot[key];
    });
    var peeled = peelRoleKrocs(books.org.roles);
    books.org.roles = peeled.roles;
    var existing = isPlainObject(books.plans.roleKrocs) ? books.plans.roleKrocs : {};
    books.plans.roleKrocs = Object.assign({}, peeled.roleKrocs, existing);
    return books;
  }

  function bookPayload(snapshot, id) {
    var out = {};
    if (!isPlainObject(snapshot)) return out;
    BOOK_FIELDS[id].forEach(function (field) {
      if (SKIP_EQ[field] || SESSION_SET[field]) return;
      if (snapshot[field] !== undefined) out[field] = snapshot[field];
    });
    return out;
  }

  function hashBook(snapshot, id) {
    return stableStringify(bookPayload(snapshot, id));
  }

  function normalizeGens(snapshot) {
    var raw = snapshot && isPlainObject(snapshot.bookGens) ? snapshot.bookGens : {};
    var out = emptyBooks(0);
    BOOK_IDS.forEach(function (id) {
      var n = Number(raw[id]) || 0;
      out[id] = n > 0 ? n : 0;
    });
    return out;
  }

  function dirtyBooks(snapshot) {
    var books = splitSnapshot(snapshot);
    var dirty = [];
    BOOK_IDS.forEach(function (id) {
      var hash = stableStringify(bookPayload(books[id], id));
      if (hash !== lastHashes[id]) dirty.push(id);
    });
    return dirty;
  }

  /**
   * Books that still need a book PATCH after the row saves ran. Row-owned
   * fields (hot tables + ROWS-V2 collections) are saved row by row and the
   * book PATCH cannot write them; a difference left there (e.g. a record's
   * updatedAt stamp the row diff deliberately ignores) must not send the
   * whole book.
   */
  function dirtyBookFields(snapshot) {
    var books = splitSnapshot(snapshot);
    var dirty = [];
    BOOK_IDS.forEach(function (id) {
      var hash = stableStringify(withoutRowOwned(id, bookPayload(books[id], id)));
      if (hash !== stableStringify(withoutRowOwned(id, lastAcked[id]))) dirty.push(id);
    });
    return dirty;
  }

  function withoutRowOwned(book, payload) {
    if (!isPlainObject(payload)) return payload;
    var out = Object.assign({}, payload);
    (HOT_BY_BOOK[book] || []).forEach(function (field) { delete out[field]; });
    if (C) C.SPECS.forEach(function (spec) { if (spec.book === book) delete out[spec.field]; });
    return out;
  }

  function noteLoaded(snapshot) {
    if (!isPlainObject(snapshot)) return;
    everLoaded = true;
    var books = splitSnapshot(snapshot);
    var gens = normalizeGens(snapshot);
    BOOK_IDS.forEach(function (id) {
      lastAcked[id] = bookPayload(books[id], id);
      lastHashes[id] = stableStringify(lastAcked[id]);
      lastGens[id] = gens[id];
      remoteGens[id] = Math.max(Number(remoteGens[id]) || 0, gens[id]);
    });
    rememberRows(snapshot);
    var at = Number(snapshot.notebookUpdatedAt) || 0;
    if (at > lastWireAt) lastWireAt = at;
    // The loaded snapshot already holds every change up to `at`: an idle tick
    // at the same `at` must not poll the change feed.
    if (at > lastChangesAt) lastChangesAt = at;
    lastScreenKey = "";
    lastPeopleFetchAt = 0;
    lastRewardsFetchAt = 0;
    lastApmsMonthFetchAt = 0;
    lastApmsPersonFetchAt = 0;
    lastApmsPersonKey = "";
    var wireSeq = Number(snapshot.feedSeq);
    if (C && Number.isFinite(wireSeq) && wireSeq >= 0 && snapshot.feedSeq !== null && snapshot.feedSeq !== undefined) {
      // The wire may be a stale-while-revalidate copy: replay the change feed
      // from the position it was built at, not from the head, so a commit the
      // wire has not caught up with (a delete, a lock) still reaches the screen.
      liveSeq = wireSeq;
      replayFeedOnHooks = true;
      if (liveHooks) {
        replayFeedOnHooks = false;
        try {
          pollChanges();
        } catch (err) {}
      }
    } else if (C && typeof document !== "undefined") {
      try {
        fetchLiveHead();
      } catch (err) {}
    }
    try {
      maybeScreenRead();
    } catch (err) {}
  }

  function noteRemote(tick) {
    if (!tick || typeof tick !== "object") return;
    var at = Number(tick.at) || Number(tick.notebookUpdatedAt) || 0;
    if (at > lastRemoteAt) lastRemoteAt = at;
    if (Array.isArray(tick.entities)) {
      tick.entities.forEach(function (hint) {
        queueEntityHint(hint);
      });
    }
    var gens = tick.bookGens;
    if (!isPlainObject(gens)) {
      lastTickHadGens = false;
      return;
    }
    lastTickHadGens = true;
    BOOK_IDS.forEach(function (id) {
      var n = Number(gens[id]) || 0;
      if (n > (Number(remoteGens[id]) || 0)) remoteGens[id] = n;
    });
  }

  var liveHooks = null;
  var livePullTimer = null;

  var LOAD_FN = "/_serverFn/5c5cc138c933bc09d2cf232e1c81b3bbc654ed1bc6c042fa94c1b527783e7bf5";

  function requestPath(input) {
    try {
      var href = typeof input === "string" ? input : (input && input.url) || "";
      if (!href) return "";
      if (href.charAt(0) === "/") {
        var q = href.indexOf("?");
        return q < 0 ? href : href.slice(0, q);
      }
      return new URL(href, "http://local.invalid").pathname;
    } catch (err) {
      return "";
    }
  }

  function isCompanyFileGet(path) {
    return path === "/api/company" || path.indexOf(LOAD_FN) === 0;
  }

  /**
   * Read-only look at the screen for view / month / person / record checks.
   * `exportSnapshot` copies the whole company, and a burst of feed ticks used
   * to take several per tick (seconds of frozen screen on a lock). One copy
   * serves every read-only caller in the same task; never mutate it.
   */
  var peekCache = null;
  var peekState = null;
  function peekSnapshot() {
    if (!liveHooks || typeof liveHooks.getSnapshot !== "function") return null;
    // p0as80 hooks expose the store's state object: the copy stays valid
    // until the state changes (across feed messages, not just one task).
    var ref = null;
    try {
      ref = typeof liveHooks.stateRef === "function" ? liveHooks.stateRef() : null;
    } catch (err) {
      ref = null;
    }
    if (ref && peekState && peekState.ref === ref) return peekState.snap;
    if (!ref && peekCache && peekCache.hooks === liveHooks) return peekCache.snap;
    var snap = liveHooks.getSnapshot();
    if (ref) {
      peekState = { ref: ref, snap: snap };
    } else {
      peekCache = { hooks: liveHooks, snap: snap };
      Promise.resolve().then(function () {
        peekCache = null;
      });
    }
    return snap;
  }

  function uiView() {
    try {
      var nav = global.__apmsNavUi && typeof global.__apmsNavUi.loadSession === "function" ? global.__apmsNavUi.loadSession() : null;
      if (nav && nav.view) return String(nav.view);
    } catch (err) {}
    if (liveHooks && typeof liveHooks.getSnapshot === "function") {
      var snap = peekSnapshot();
      if (snap && snap.view) return String(snap.view);
    }
    return "";
  }

  function uiMonth() {
    try {
      var nav = global.__apmsNavUi && typeof global.__apmsNavUi.loadSession === "function" ? global.__apmsNavUi.loadSession() : null;
      if (nav && (nav.currentMonth || nav.selectedMonth)) return String(nav.currentMonth || nav.selectedMonth);
    } catch (err) {}
    if (liveHooks && typeof liveHooks.getSnapshot === "function") {
      var snap = peekSnapshot();
      if (snap) return String(snap.currentMonth || snap.selectedMonth || "");
    }
    return "";
  }

  function uiPerson() {
    try {
      var nav = global.__apmsNavUi && typeof global.__apmsNavUi.loadSession === "function" ? global.__apmsNavUi.loadSession() : null;
      if (nav && nav.selectedPersonId) return String(nav.selectedPersonId);
    } catch (err) {}
    return apmsPersonId(peekSnapshot());
  }

  function isApmsView(view) {
    var v = String(view || "");
    return (
      v === "apms" ||
      v === "apms-person" ||
      v === "apms-me" ||
      v === "apms-plan" ||
      v === "person-month" ||
      v === "scorecard" ||
      v === "scorecard-role" ||
      v === "execution" ||
      v === "kroc" ||
      v === "values" ||
      v === "apms-values" ||
      v === "apms-execution" ||
      v === "apms-kroc" ||
      v === "apms-scorecard"
    );
  }

  function apmsViewOpen() {
    return isApmsView(uiView());
  }

  function apmsPersonId(snap) {
    if (!snap || typeof snap !== "object") return "";
    return String(snap.selectedPersonId || snap.selectedApmsId || "");
  }

  function isOrgView(view) {
    var v = String(view || "");
    return (
      v === "org" ||
      v === "org-overview" ||
      v === "org-chart" ||
      v === "org-builder" ||
      v === "org-units" ||
      v === "org-brands" ||
      v === "org-brand" ||
      v === "org-sbus" ||
      v === "org-sbu" ||
      v === "org-cluster" ||
      v === "org-functions" ||
      v === "org-function" ||
      v === "org-roles" ||
      v === "org-role" ||
      v === "org-people" ||
      v === "org-person" ||
      v === "people" ||
      v === "role-edit" ||
      v === "role-view" ||
      v === "settings-trash" ||
      v === "trash"
    );
  }

  function orgViewOpen() {
    return isOrgView(uiView());
  }

  function orgKindForView(view) {
    var v = String(view || "");
    if (v === "org-chart") return "chart";
    if (v === "org-builder") return "builder";
    if (v === "org-units") return "companies";
    if (v === "org-brands" || v === "org-brand") return "brands";
    if (v === "org-sbus" || v === "org-sbu") return "sbus";
    if (v === "org-cluster") return "cluster";
    if (v === "org-functions" || v === "org-function") return "functions";
    if (v === "org-roles" || v === "org-role" || v === "role-edit" || v === "role-view") return "roles";
    if (v === "org" || v === "org-overview") return "overview";
    if (v === "settings-trash" || v === "trash") return "trash";
    return "";
  }

  var lastScreenKey = "";
  var screenReadTimer = null;
  var lastPeopleFetchAt = 0;
  var lastRewardsFetchAt = 0;
  var lastApmsMonthFetchAt = 0;
  var lastApmsPersonFetchAt = 0;
  var lastApmsPersonKey = "";
  var liveWatchStarted = false;
  var liveTickTimer = null;
  var liveSource = null;
  var LIVE_FALLBACK_MS = 5000;

  function orgSelectedId(snap, kind) {
    if (!snap) return "";
    if (kind === "brands") return String(snap.selectedBrandId || "");
    if (kind === "sbus") return String(snap.selectedSbuId || "");
    if (kind === "functions") return String(snap.selectedFunctionId || "");
    if (kind === "roles") return String(snap.selectedRoleId || "");
    if (kind === "companies") return String(snap.selectedCompanyId || "");
    return "";
  }

  function maybeScreenRead() {
    try {
      flagStaleReadd();
    } catch (err) {}
    try {
      clearGhosts();
    } catch (err) {
      if (typeof console !== "undefined" && console.warn) console.warn("[apms-sync] clearGhosts", err);
    }
    // The screen state is copied only when a branch below needs it: this runs
    // on every feed message.
    var snapMemo;
    var snap = null;
    function S() {
      if (snapMemo === undefined) snapMemo = peekSnapshot();
      return snapMemo;
    }
    var view = uiView();
    if (!view && S() && S().view) view = String(S().view);
    var needMP = view === "rewards" || view === "apms" || view === "org-person" || isApmsView(view);
    var needQ = view === "org-people" || view === "people";
    var month = needMP ? uiMonth() || (S() ? String(S().currentMonth || S().selectedMonth || "") : "") : "";
    var person = needMP ? uiPerson() || apmsPersonId(S()) : "";
    var orgKind = orgKindForView(view);
    var orgId = orgKind ? orgSelectedId(S(), orgKind) : "";
    if (needQ) snap = S();
    if (!orgId) {
      try {
        var nav = global.__apmsNavUi && global.__apmsNavUi.loadSession ? global.__apmsNavUi.loadSession() : null;
        if (nav) orgId = orgSelectedId(nav, orgKind);
      } catch (err) {}
    }
    if (view === "org-people" || view === "people") {
      if (!everLoaded) return;
      var q = snap && snap.peopleQuery != null ? String(snap.peopleQuery) : snap && snap.q != null ? String(snap.q) : "";
      var pkey = "people\0" + view + "\0" + q;
      var nowP = Date.now();
      if (pkey === lastScreenKey && nowP - lastPeopleFetchAt < SCREEN_REREAD_MS) return;
      lastScreenKey = pkey;
      lastPeopleFetchAt = nowP;
      openPeopleScreen({ limit: 80, q: q }).catch(function () {});
      return;
    }
    if (view === "rewards") {
      if (!everLoaded || !month) return;
      var rkey = "rewards\0" + month;
      var nowR = Date.now();
      if (rkey === lastScreenKey && nowR - lastRewardsFetchAt < SCREEN_REREAD_MS) return;
      lastScreenKey = rkey;
      lastRewardsFetchAt = nowR;
      openRewardsMonth(month, { limit: 80 }).catch(function () {});
      return;
    }
    if (view === "apms") {
      if (!everLoaded || !month) return;
      var getterApms = rawFetch || (typeof fetch === "function" ? fetch : null);
      if (!getterApms) return;
      var akey = "apms-month\0" + month;
      var nowA = Date.now();
      if (!(akey === lastScreenKey && nowA - lastApmsMonthFetchAt < SCREEN_REREAD_MS)) {
        lastScreenKey = akey;
        lastApmsMonthFetchAt = nowA;
        openApmsMonth(month, { limit: 80 }).catch(function () {});
      }
      if (person) fetchApmsPersonRow(month, person);
      return;
    }
    if (isApmsView(view) && month && person) {
      if (!everLoaded) return;
      fetchApmsPersonRow(month, person);
      return;
    }
    var key = view + "\0" + month + "\0" + person + "\0" + orgKind + "\0" + orgId;
    if (key === lastScreenKey) return;
    lastScreenKey = key;
    if (view === "org-person") {
      if (person) openOrgPerson(person).catch(function () {});
      return;
    }
    if (view === "settings-trash" || view === "trash") {
      openOrgTrash().catch(function () {});
      return;
    }
    if (orgKind) {
      openOrgSlice(orgKind).catch(function () {});
      if (orgId) openOrgNode(orgKind, orgId).catch(function () {});
    }
  }

  function fetchApmsPersonRow(month, person) {
    var pid = String(person || "");
    var m = String(month || "");
    if (!m || !pid) return;
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter) return;
    var pkey = "apms-person\0" + m + "\0" + pid;
    var nowP = Date.now();
    if (pkey === lastApmsPersonKey && nowP - lastApmsPersonFetchAt < SCREEN_REREAD_MS) return;
    lastApmsPersonKey = pkey;
    lastApmsPersonFetchAt = nowP;
    openApmsPerson(m, pid).catch(function () {});
  }

  function startScreenReadWatch() {
    if (screenReadTimer) return;
    screenReadTimer = setInterval(function () {
      try {
        maybeScreenRead();
      } catch (err) {}
    }, 400);
    if (screenReadTimer && typeof screenReadTimer.unref === "function") screenReadTimer.unref();
  }

  function setLiveHooks(hooks) {
    liveHooks = hooks && typeof hooks === "object" ? hooks : null;
    if (liveHooks && liveSource) {
      // The SPA's stream is up: drop the fallback one.
      try {
        liveSource.close();
      } catch (err) {}
      liveSource = null;
    }
    startScreenReadWatch();
    startLiveWatch();
    if (liveHooks && replayFeedOnHooks) {
      replayFeedOnHooks = false;
      try {
        pollChanges();
      } catch (err) {}
    }
    if (liveHooks && (pendingEntities.length > 0 || lastRemoteAt > lastPulledAt)) {
      scheduleLivePull();
    }
    // The SPA re-installs its hooks on every feed message; the screen read
    // takes one (shared) snapshot copy, see peekSnapshot.
    try {
      maybeScreenRead();
    } catch (err) {}
  }

  function scheduleLivePull() {
    if (!liveHooks || typeof liveHooks.getSnapshot !== "function") return;
    if (livePullTimer) return;
    livePullTimer = setTimeout(function () {
      livePullTimer = null;
      var hooks = liveHooks;
      if (!hooks || typeof hooks.getSnapshot !== "function") return;
      pullLive({
        isBlocked: hooks.isBlocked,
        getSnapshot: hooks.getSnapshot,
        apply: hooks.apply,
        remember: hooks.remember,
        skip: false,
      }).catch(function () {});
    }, 0);
  }

  var lastTickHadEntities = false;
  var lastLiveTrace = { tick: null, urls: [] };
  var fetchingHints = {};

  function fetchHintNow(hint) {
    if (!hint || !hint.type || !hint.id) return;
    var t = normEntityType(hint.type);
    if (t === "month-records" && !apmsViewOpen()) return;
    if (String(t).indexOf("org-") === 0 && !orgViewOpen()) return;
    var url = entityUrl(hint);
    if (!url) return;
    var key = entityHintKey(hint);
    if (!key || fetchingHints[key] || seenEntityKeys[key]) return;
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter) return;
    fetchingHints[key] = 1;
    getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" })
      .then(function (res) {
        if (!res || !res.ok) {
          delete fetchingHints[key];
          return null;
        }
        return res.json().then(function (body) {
          seenEntityKeys[key] = 1;
          delete fetchingHints[key];
          var hooks = liveHooks;
          var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
          if (local && body && body.ok !== false) {
            var hintAcks = [];
            var next = withAcks(hintAcks, function () { return mergeEntityPayload(local, hint, body, {}); });
            var took = false;
            if (hooks && typeof hooks.apply === "function") took = hooks.apply(next, "live-entity") !== false;
            if (took) runAcks(hintAcks);
            else {
              // UI not ready or refused: keep the hint queued so pullLive applies it later.
              delete seenEntityKeys[key];
              queueEntityHint(hint);
            }
            lastPulledAt = Math.max(lastPulledAt, Number(hint.at) || lastRemoteAt || Date.now());
          } else if (!local) {
            // via=init: hooks not installed yet. Queue for the first pullLive.
            delete seenEntityKeys[key];
            queueEntityHint(hint);
          }
          return body;
        });
      })
      .catch(function () {
        delete fetchingHints[key];
      });
  }

  /**
   * PERF (p0as83): the live stream pushes every change; the tick is the
   * fallback (and how an idle tab notices its session ended). The SPA's own
   * 2.5 s tick and this one used to send two requests every 2.5 s per tab.
   * Now one real tick per TICK_VISIBLE_MS while the tab is visible and per
   * TICK_HIDDEN_MS while hidden; a tick asked for inside that window gets the
   * last answer again (nothing moved, nothing to do).
   */
  var TICK_VISIBLE_MS = 5000;
  var TICK_HIDDEN_MS = 30000;
  var lastRealTickAt = 0;
  var lastTickBody = null;
  function tickWindow() {
    try {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return TICK_HIDDEN_MS;
    } catch (err) {}
    return TICK_VISIBLE_MS;
  }
  function tickDue() {
    return Date.now() - lastRealTickAt >= tickWindow() - 50;
  }
  function rememberTick(body) {
    try {
      if (body && typeof body === "object" && body.at != null) lastTickBody = JSON.stringify(body);
    } catch (err) {}
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    // Back to a visible tab: catch up at once.
    document.addEventListener("visibilitychange", function () {
      try {
        if (document.visibilityState === "visible") lastRealTickAt = 0;
      } catch (err) {}
    });
  }

  function startLiveWatch() {
    if (typeof document === "undefined") return;
    if (liveWatchStarted) return;
    liveWatchStarted = true;
    // The SPA keeps its own /api/company-live stream and hands every message
    // to handleLiveEvent (it installs the live hooks as it does). A second
    // stream here handled each tick twice and held one of the browser's six
    // HTTP/1.1 connections per tab, so saves queued behind it. Open ours only
    // when the SPA's has delivered nothing after a few seconds.
    if (typeof EventSource === "function") {
      var fallback = setTimeout(function () {
        if (liveHooks || liveSource) return;
        try {
          liveSource = new EventSource("/api/company-live", { withCredentials: true });
          liveSource.onmessage = function (ev) {
            try {
              var data = JSON.parse(ev.data);
              handleLiveEvent(data);
            } catch (err) {}
          };
        } catch (err) {}
      }, LIVE_FALLBACK_MS);
      if (fallback && typeof fallback.unref === "function") fallback.unref();
    }
    if (liveTickTimer) return;
    liveTickTimer = setInterval(function () {
      var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
      if (!getter) return;
      if (!tickDue()) return;
      lastRealTickAt = Date.now();
      getter("/api/company-tick?since=" + (lastPulledAt || lastWireAt || 0), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      })
        .then(function (res) {
          if (!res || !res.ok) return null;
          return res.json();
        })
        .then(function (tick) {
          if (tick) {
            rememberTick(tick);
            handleLiveEvent(tick);
          }
        })
        .catch(function () {});
    }, 2500);
    if (liveTickTimer && typeof liveTickTimer.unref === "function") liveTickTimer.unref();
  }

  /** Cursor for the change feed: taken at hydrate so only later commits are replayed. */
  function fetchLiveHead() {
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter || !C) return Promise.resolve(liveSeq);
    return getter("/api/changes?head=1", { method: "GET", credentials: "include", cache: "no-store" })
      .then(function (res) { return res && res.ok ? res.json() : null; })
      .then(function (body) {
        if (body && Number.isFinite(Number(body.seq))) liveSeq = Math.max(liveSeq, Number(body.seq));
        return liveSeq;
      })
      .catch(function () { return liveSeq; });
  }

  /**
   * ROWS-V2 follower: after any live tick that moved, pull every generic row
   * committed after our cursor, with payloads, in one request, and overlay
   * them. Idle ticks cost nothing. A `*` change (restore) forces a full pull.
   */
  // A tick that arrives while a poll is in flight must not be lost: that poll's
  // request may predate the commit the tick announces. Poll once more after it.
  var pollAgain = false;
  var pollRefused = false;
  var feedLog = [];
  function pollChanges() {
    if (changesInFlight) pollAgain = true;
    if (!C || changesInFlight) return changesInFlight || Promise.resolve(null);
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter) return Promise.resolve(null);
    var since = liveSeq;
    pollIssuedSeq = announcedSeq;
    pollAgain = false;
    pollRefused = false;
    changesInFlight = getter("/api/changes?since=" + since + "&payload=1&limit=500", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    })
      .then(function (res) { return res && res.ok ? res.json() : null; })
      .then(function (body) {
        changesInFlight = null;
        feedLog.push({ at: Date.now(), since: since, n: body && Array.isArray(body.changes) ? body.changes.length : -1, seq: body && body.seq });
        if (feedLog.length > 40) feedLog.shift();
        if (!body || !Array.isArray(body.changes)) {
          // The poll failed (network / 5xx): the tick that asked for it is not
          // consumed, so the next tick polls again from the same cursor.
          lastChangesAt = 0;
          return null;
        }
        var more = applyFeedBody(body, since);
        if (more === "more") return pollChanges();
        return body;
      })
      .catch(function () {
        changesInFlight = null;
        lastChangesAt = 0;
        return null;
      })
      .then(function (body) {
        // Refused applies rewind the cursor and wait for the next tick instead.
        if (pollAgain && !pollRefused) {
          pollAgain = false;
          setTimeout(function () {
            try {
              pollChanges();
            } catch (err) {}
          }, 0);
        }
        return body;
      });
    return changesInFlight;
  }

  /**
   * Apply one page of the change feed (a poll answer, or a page the server
   * pushed down the live stream — p0as83) that starts at cursor `since`.
   * Returns "more" when the page was full (the caller reads the next one).
   */
  function applyFeedBody(body, since) {
    {
        var hooks = liveHooks;
        var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
        if (body.changes.length && !local) {
          // Nothing on screen to apply them to yet: keep the cursor, replay later.
          replayFeedOnHooks = true;
          return body;
        }
        if (Number.isFinite(Number(body.seq))) liveSeq = Math.max(liveSeq, Number(body.seq));
        if (!body.changes.length) return body;
        var resync = false;
        var next = local;
        var feedAcks = [];
        body.changes.forEach(function (ch) {
          if (!ch || !ch.kind) return;
          if (ch.kind === "*") { resync = true; entityFieldsFromNextPull = true; return; }
          if (!next) return;
          if (HOT_FEED[ch.kind]) {
            next = withAcks(feedAcks, function () { return mergeHotRow(next, ch.kind, ch); });
            return;
          }
          next = withAcks(feedAcks, function () { return mergeGenericRow(next, ch.kind, ch); });
        });
        if (resync) {
          // BATCH-2: a restore replaced the company. Pull every book and let
          // it win over whatever this screen holds (unsaved edits included).
          restorePull();
          return body;
        }
        var applied = false;
        // BATCH-2: a sibling reorder (sortKey) from the feed moves the row on screen too.
        if (next && next !== local && C && typeof C.orderSiblings === "function") next = C.orderSiblings(next);
        if (next && next !== local && hooks && typeof hooks.apply === "function") {
          try {
            applied = hooks.apply(Object.assign({}, next, { bookGens: Object.assign({}, lastGens, remoteGens) }), "live-entity") !== false;
          } catch (err) {
            applied = false;
          }
        } else if (next === local) {
          applied = true;
        }
        if (applied) runAcks(feedAcks);
        else {
          // UI refused (unsaved edits in flight). Rewind the cursor: replay on the next tick
          // (even if that tick's `at` has not moved again).
          pollRefused = true;
          if (feedLog.length) feedLog[feedLog.length - 1].refused = true;
          liveSeq = since;
          lastChangesAt = 0;
          return body;
        }
        if (body.changes.length >= 500) return "more";
        return body;
    }
  }

  /**
   * p0as83: a feed page pushed on the live stream (`push`, `since`, `seq`,
   * `changes`). Applied like a poll answer when it starts at or before our
   * cursor (rows we already have are skipped); a page that starts past our
   * cursor means we missed one: poll instead.
   */
  var pushWaitTimer = null;
  var lastPushAt = 0;
  var PUSH_LIVE_MS = 60000;
  function feedPushLive() {
    return !!C && lastPushAt > 0 && Date.now() - lastPushAt < PUSH_LIVE_MS;
  }
  function feedCarries(hint) {
    var t = normEntityType(hint.type);
    return !!HOT_FEED[t] || String(t).indexOf("e:") === 0;
  }
  function applyPushedFeed(tick) {
    lastPushAt = Date.now();
    var from = Number(tick.since);
    var to = Number(tick.seq) || 0;
    if (!C || !Number.isFinite(from) || !(to > liveSeq)) return true;
    if (changesInFlight) return false;
    if (from > liveSeq) return false;
    var rows = tick.changes.filter(function (ch) {
      return ch && (Number(ch.seq) || 0) > liveSeq;
    });
    var cursor = liveSeq;
    feedLog.push({ at: Date.now(), since: cursor, n: rows.length, seq: to, pushed: true });
    if (feedLog.length > 40) feedLog.shift();
    var r = applyFeedBody({ ok: true, since: cursor, seq: to, changes: rows }, cursor);
    if (r === "more") pollChanges();
    return true;
  }

  /**
   * BATCH-2 (restore wins): after a `*` in the change feed, pull all books and
   * apply them as the new baseline with reason "restore" — the SPA applies it
   * even while a field is being edited, and the edit is dropped. Row caches
   * learned before the restore (revs, remote deletes) are reset so a restored
   * row is neither refused as a stale re-add nor sent back as an old value.
   */
  var restoreInFlight = null;
  var restoreLog = [];
  function restorePull(attempt) {
    if (restoreInFlight) return restoreInFlight;
    attempt = attempt || 0;
    restoreInFlight = (async function () {
      var hooks = liveHooks;
      if (!hooks || typeof hooks.getSnapshot !== "function" || typeof hooks.apply !== "function") {
        entityFieldsFromNextPull = true;
        scheduleLivePull();
        return false;
      }
      var pulled = await pullBooks(BOOK_IDS.slice());
      if (!pulled || !pulled.books) throw new Error("restore pull failed");
      var local = hooks.getSnapshot();
      if (!isPlainObject(local)) return false;
      var merged = Object.assign({}, local);
      BOOK_IDS.forEach(function (id) {
        var book = pulled.books[id];
        if (!isPlainObject(book)) return;
        BOOK_FIELDS[id].forEach(function (field) {
          if (field in book) merged[field] = book[field];
        });
      });
      if (pulled.bookGens) merged.bookGens = Object.assign({}, pulled.bookGens);
      if (C && typeof C.orderSiblings === "function") merged = C.orderSiblings(merged);
      merged.notebookUpdatedAt = Math.max(Number(pulled.notebookUpdatedAt) || 0, Number(local.notebookUpdatedAt) || 0, Date.now());
      var ok = false;
      try {
        ok = hooks.apply(merged, "restore") !== false;
      } catch (err) {
        ok = false;
      }
      restoreLog.push({ at: Date.now(), ok: ok, attempt: attempt });
      if (restoreLog.length > 10) restoreLog.shift();
      if (!ok) throw new Error("restore apply refused");
      var after = hooks.getSnapshot() || merged;
      discardPendingAcks();
      entityRevs = {};
      remoteDeletedKeys = {};
      knownRowKeys = {};
      lastRowConflicts = [];
      entityFieldsFromNextPull = false;
      var books = splitSnapshot(after);
      var gens = normalizeGens(after);
      BOOK_IDS.forEach(function (id) {
        lastAcked[id] = bookPayload(books[id], id);
        lastHashes[id] = stableStringify(lastAcked[id]);
        lastGens[id] = gens[id];
        remoteGens[id] = gens[id];
      });
      rememberRows(after);
      lastPulledAt = Math.max(lastPulledAt, lastRemoteAt, Number(pulled.notebookUpdatedAt) || 0);
      return true;
    })()
      .catch(function () {
        // Pull failed or the screen refused: try again shortly (bounded).
        if (attempt < 20) {
          setTimeout(function () {
            restorePull(attempt + 1);
          }, 500);
        }
        return false;
      })
      .then(function (ok) {
        restoreInFlight = null;
        return ok;
      });
    return restoreInFlight;
  }

  function handleLiveEvent(tick) {
    if (!tick || typeof tick !== "object") return { queued: 0, shouldPull: false, at: 0 };
    var at = Number(tick.at || tick.notebookUpdatedAt) || 0;
    // PERF (p0as83): the server says how far the change feed is (`seq`). One
    // save moved `at` up to three times (commit, LISTEN, book mirror) and each
    // move polled the feed; poll only when the feed has something past our
    // cursor (and past what an in-flight poll was already sent for).
    var tseq = Number(tick.seq) || 0;
    if (tseq > announcedSeq) announcedSeq = tseq;
    var needPoll = !!(C && at > lastChangesAt);
    if (C && tick.push && Array.isArray(tick.changes)) {
      // The rows themselves came down the live stream.
      if (applyPushedFeed(tick)) needPoll = false;
      else needPoll = true;
    } else if (needPoll && tick.push && tseq > liveSeq) {
      // This stream pushes the rows right behind its tick: wait for them;
      // poll only if they have not arrived in PUSH_WAIT_MS.
      needPoll = false;
      if (!pushWaitTimer) {
        pushWaitTimer = setTimeout(function () {
          pushWaitTimer = null;
          if (announcedSeq > liveSeq) pollChanges();
        }, PUSH_WAIT_MS);
      }
    }
    if (needPoll && tseq && tseq <= liveSeq) needPoll = false;
    if (needPoll && tseq && changesInFlight && tseq <= pollIssuedSeq) needPoll = false;
    feedLog.push({ at: Date.now(), tick: at, seq: tseq, poll: needPoll });
    if (feedLog.length > 40) feedLog.shift();
    if (C && at > lastChangesAt) lastChangesAt = at;
    if (needPoll) pollChanges();
    var ents = Array.isArray(tick.entities) ? tick.entities : [];
    var urls = [];
    var fresh = [];
    // PERF-TAB: never more than LIVE_ENTITY_CAP row GETs per tick (newest last).
    var window = ents.length > LIVE_ENTITY_CAP ? ents.slice(-LIVE_ENTITY_CAP) : ents;
    for (var ei = 0; ei < window.length; ei++) {
      var h = window[ei];
      var url = entityUrl(h);
      urls.push({ hint: h, url: url });
      if (!h || !h.type || !h.id) continue;
      // p0as83: while the live stream pushes the change feed, the row a hint
      // names arrives in the feed itself (HOT-FEED rows and every generic row);
      // a GET per hint per tab was one more request per save per open tab.
      if (feedPushLive() && feedCarries(h)) {
        seenEntityKeys[entityHintKey(h)] = 1;
        continue;
      }
      // Do NOT drop hat <= lastPulledAt. Live via=init: wrapFetch handleLiveEvent
      // ran before routes setLiveHooks, so scheduleLivePull no-op'd and entityGets=0.
      // GET the row now even without liveHooks.
      fetchHintNow(h);
      fresh.push(h);
    }
    lastLiveTrace = {
      tick: { at: at, bookGens: tick.bookGens || null, entities: ents },
      urls: urls,
    };
    if (fresh.length) lastTickHadEntities = true;
    noteRemote({ at: at, bookGens: tick.bookGens, entities: fresh });
    var should = pendingEntities.length > 0 || fresh.length > 0;
    if (should) scheduleLivePull();
    return { queued: pendingEntities.length, shouldPull: !!should, at: at };
  }

  function normEntityType(type) {
    var t = String(type || "");
    if (t === "reward_records" || t === "reward-records") return "reward-records";
    if (t === "month_records" || t === "month-records") return "month-records";
    if (t === "target_cells" || t === "target-cells") return "target-cells";
    if (t === "people") return "people";
    return t.replace(/_/g, "-");
  }

  function entityHintKey(hint) {
    if (!hint) return "";
    return normEntityType(hint.type) + "\0" + String(hint.id || "") + "\0" + String(hint.period || "");
  }

  function queueEntityHint(hint) {
    if (!hint || !hint.type || !hint.id) return;
    var row = {
      type: normEntityType(hint.type),
      id: String(hint.id),
      period: hint.period ? String(hint.period) : "",
    };
    if (!row.type || !row.id) return;
    if (row.type === "month-records" && !apmsViewOpen()) return;
    if (String(row.type).indexOf("org-") === 0 && !orgViewOpen()) return;
    var key = entityHintKey(row);
    if (seenEntityKeys[key] || fetchingHints[key]) return;
    for (var i = 0; i < pendingEntities.length; i++) {
      if (entityHintKey(pendingEntities[i]) === key) return;
    }
    if (pendingEntities.length >= LIVE_ENTITY_CAP) return;
    pendingEntities.push(row);
  }

  function entityUrl(hint) {
    if (!hint || !hint.type || !hint.id) return "";
    var t = normEntityType(hint.type);
    if (t === "people") return "/api/people/" + encodeURIComponent(hint.id);
    if (t === "target-cells") return "/api/target-cells/" + encodeURIComponent(hint.id);
    if (t === "reward-records" && hint.period) {
      return "/api/reward-records/" + encodeURIComponent(hint.period) + "/" + encodeURIComponent(hint.id);
    }
    if (t === "month-records" && hint.period) {
      return "/api/month-records/" + encodeURIComponent(hint.period) + "/" + encodeURIComponent(hint.id);
    }
    if (t.indexOf("org-") === 0) {
      return "/api/org/" + encodeURIComponent(t.slice(4)) + "/" + encodeURIComponent(hint.id);
    }
    if (t.indexOf("e:") === 0) {
      var p = "/api/e/" + encodeURIComponent(t.slice(2)) + "/" + encodeURIComponent(hint.id);
      if (hint.period) p += "/" + encodeURIComponent(hint.period);
      return p;
    }
    return "";
  }

  function genericSpecForHint(kind, id) {
    if (!C) return null;
    if (kind === "settings") return C.settingsSpec(id);
    return C.specForKind(kind);
  }

  /**
   * Overlay one server row (from a hint GET or the change feed) into the local
   * snapshot. A row this client has edited but not yet saved is three-way
   * merged and left dirty; everything else is applied and acked outright.
   */
  function mergeGenericRow(local, kind, body) {
    var spec = genericSpecForHint(kind, body.k1 || body.id);
    if (!spec) return local;
    var k1 = body.k1 != null ? String(body.k1) : String(body.id);
    var k2 = body.k2 != null ? String(body.k2) : null;
    var id = spec.shape === "map2" ? k1 + C.SEP + (k2 || "") : k1;
    var row = { kind: spec.kind, id: id, k1: k1, k2: k2, payload: isPlainObject(body.payload) ? body.payload : {} };
    var revKey = "e:" + spec.kind + ":" + id;
    // The row's rev is learned together with its payload: only once the UI
    // took the snapshot (commitPendingAcks). Learning it early, while the apply
    // is refused (save in flight), let the next save go out at the new rev with
    // the old payload — a silent overwrite instead of a 409 merge.
    if (Number.isFinite(Number(body.rev))) {
      var learnedRev = Number(body.rev);
      pushAck(function () {
        entityRevs[revKey] = learnedRev;
      });
    }
    var deleted = !!body.deleted;
    if (deleted) remoteDeletedKeys[revKey] = 1;
    else delete remoteDeletedKeys[revKey];
    var ackedRow = rowsById(spec, ackedFieldValue(spec))[id];
    var localRow = rowsById(spec, local[spec.field])[id];
    // A placeholder this screen never saved (see isPlaceholderRow) is not an edit.
    if (localRow && !ackedRow && isPlaceholderRow(spec, localRow.payload)) localRow = undefined;
    var localDirty = !eq(localRow ? localRow.payload : undefined, ackedRow ? ackedRow.payload : undefined);
    if (!localDirty || deleted) {
      return applyGenericRow(local, spec, row, deleted, true);
    }
    // Keep my unsaved edit on top of their change; ack theirs as the new base.
    var merged = merge3(ackedRow ? ackedRow.payload : undefined, localRow.payload, row.payload, []);
    applyGenericRow({}, spec, row, false, true); // queues the ack of THEIR row
    return applyGenericRow(local, spec, { kind: row.kind, id: id, k1: k1, k2: k2, payload: merged }, false, false);
  }

  var HOT_FEED = { "people": "people", "month-records": "month_records", "reward-records": "reward_records", "target-cells": "target_cells" };

  /** Local + acked copies of one hot-table row, in the shape the SPA store keeps. */
  function hotRowPair(kind, k1, k2, local) {
    if (kind === "people") {
      var lp = peopleById(local.people)[k1];
      var ap = peopleById((lastAcked.org && lastAcked.org.people) || [])[k1];
      return { local: lp, acked: ap };
    }
    if (kind === "target-cells") {
      var lc = isPlainObject(local.targetCells) ? local.targetCells[k1] : undefined;
      var ac = lastAcked.targets && isPlainObject(lastAcked.targets.targetCells) ? lastAcked.targets.targetCells[k1] : undefined;
      return { local: lc, acked: ac };
    }
    var field = kind === "month-records" ? "records" : "rewardRecords";
    var lt = isPlainObject(local[field]) && isPlainObject(local[field][k2]) ? local[field][k2][k1] : undefined;
    var at = lastAcked.months && isPlainObject(lastAcked.months[field]) && isPlainObject(lastAcked.months[field][k2]) ? lastAcked.months[field][k2][k1] : undefined;
    return { local: lt, acked: at };
  }

  /** Fold one server row into the acked baseline (queued until the UI takes the snapshot). */
  function ackHotRow(kind, k1, k2, payload, deleted) {
    pushAck(function () {
      if (kind === "people") {
        lastAcked.org = lastAcked.org || {};
        var rows = Array.isArray(lastAcked.org.people) ? lastAcked.org.people.slice() : [];
        var idx = -1;
        for (var i = 0; i < rows.length; i++) if (rows[i] && String(rows[i].id) === k1) { idx = i; break; }
        if (deleted) { if (idx >= 0) rows.splice(idx, 1); }
        else if (idx >= 0) rows[idx] = payload;
        else rows.push(payload);
        lastAcked.org.people = rows;
        lastHashes.org = stableStringify(bookPayload(lastAcked.org, "org"));
        return;
      }
      if (kind === "target-cells") {
        lastAcked.targets = lastAcked.targets || {};
        var cells = Object.assign({}, isPlainObject(lastAcked.targets.targetCells) ? lastAcked.targets.targetCells : {});
        if (deleted) delete cells[k1];
        else cells[k1] = payload;
        lastAcked.targets.targetCells = cells;
        lastHashes.targets = stableStringify(bookPayload(lastAcked.targets, "targets"));
        return;
      }
      var field = kind === "month-records" ? "records" : "rewardRecords";
      lastAcked.months = lastAcked.months || {};
      var tree = Object.assign({}, isPlainObject(lastAcked.months[field]) ? lastAcked.months[field] : {});
      var month = Object.assign({}, isPlainObject(tree[k2]) ? tree[k2] : {});
      var before = month[k1];
      if (isPlainObject(before) && !deleted && !eq(before, payload)) {
        supersededRows[entityRevKey(kind === "month-records" ? "month_records" : "reward_records", k2, k1)] = before;
      }
      if (deleted) delete month[k1];
      else month[k1] = payload;
      tree[k2] = month;
      lastAcked.months[field] = tree;
      lastHashes.months = stableStringify(bookPayload(lastAcked.months, "months"));
    });
  }

  /**
   * ROWS-V2: a hot-table change (people / month-records / reward-records /
   * target-cells) arriving on the change feed. Same rules as mergeGenericRow:
   * clean row → take theirs and ack it; dirty row → 3-way merge, keep dirty;
   * deleted → gone. The rev is learned only when the UI takes the snapshot.
   */
  // A month / reward record's `updatedAt` is a stamp the SPA refreshes when it
  // re-derives a record (e.g. opening an open APMS plan). On its own it is not
  // an edit: comparing it made every viewer PATCH the record just by opening it.
  function recordContent(r) {
    if (!isPlainObject(r) || !("updatedAt" in r)) return r;
    var c = Object.assign({}, r);
    delete c.updatedAt;
    return c;
  }

  function personContent(p) {
    if (!isPlainObject(p)) return p;
    var c = {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (k === "rev" || v === "" || v === null || v === undefined) return;
      if (Array.isArray(v) && v.length === 0) return;
      c[k] = v;
    });
    return c;
  }

  function mergeHotRow(local, kind, ch) {
    var table = HOT_FEED[kind];
    if (!table) return local;
    var k1 = ch.k1 != null ? String(ch.k1) : String(ch.id || "");
    var k2 = ch.k2 != null ? String(ch.k2) : null;
    if (!k1) return local;
    if ((kind === "month-records" || kind === "reward-records") && !k2) return local;
    var payload = isPlainObject(ch.payload) ? ch.payload : {};
    var deleted = !!ch.deleted;
    var revKey = kind === "people" || kind === "target-cells" ? entityRevKey(table, k1) : entityRevKey(table, k2, k1);
    if (Number.isFinite(Number(ch.rev))) {
      var learnedRev = Number(ch.rev);
      pushAck(function () { entityRevs[revKey] = learnedRev; });
    }
    if (deleted) remoteDeletedKeys[revKey] = 1;
    else {
      delete remoteDeletedKeys[revKey];
      delete staleReadds[revKey];
    }
    var hint = { type: kind, id: k1, period: k2 || undefined };
    var pair = hotRowPair(kind, k1, k2, local);
    var localDirty = kind === "people" ? !eq(personContent(pair.local), personContent(pair.acked)) : kind === "target-cells" ? !eq(pair.local, pair.acked) : !eq(recordContent(pair.local), recordContent(pair.acked));
    // Baseline in exactly the shape the screen holds (the store normalises
    // plan records, stamps cell ids, …) so an untouched row never looks dirty.
    var theirs = deleted ? undefined : hotRowPair(kind, k1, k2, placeEntityPayload({}, hint, { ok: true, payload: payload, deleted: false }, {})).local;
    // BATCH-2: a server row at a newer rev is authoritative. Placing it with
    // the `updatedAt` rule of mergeKeepPeopleClient let an older local copy win
    // whenever the row's updatedAt came from the client that clicked first but
    // committed last (A's access-role change never reached B's / C's screens).
    if (deleted || !localDirty) {
      ackHotRow(kind, k1, k2, theirs, deleted);
      return placeEntityPayload(local, hint, { ok: true, payload: payload, deleted: deleted }, {}, true);
    }
    var merged = merge3(pair.acked, pair.local, theirs, []);
    ackHotRow(kind, k1, k2, theirs, false);
    return placeEntityPayload(local, hint, { ok: true, payload: merged, deleted: false }, {}, true);
  }

  /**
   * A server row (screen read, hint GET, pull) onto the screen. Hot-table rows
   * go through mergeHotRow so the baseline and rev follow what the screen
   * took; before, screen reads only placed rows, so the next save probed every
   * row of the month (a 409 per record on merely opening APMS / Rewards).
   * A dirty same person+month slice keeps the local draft (contract lock).
   */
  function mergeEntityPayload(local, hint, body, slices) {
    var ht = normEntityType(hint.type);
    if (HOT_FEED[ht] && body && (isPlainObject(body.payload) || body.deleted)) {
      var hk1 = String(hint.id || body.personId || body.id || "");
      var hk2 = ht === "people" || ht === "target-cells" ? null : String(hint.period || body.period || "");
      if (hk2 !== null && slices && slices.months) {
        var hfield = ht === "reward-records" ? "rewardRecords" : "records";
        if (slices.months[sliceKey(hfield, hk2, hk1)]) return placeEntityPayload(local, hint, body, slices);
      }
      return mergeHotRow(local, ht, { k1: hk1, k2: hk2, payload: body.payload, rev: body.rev, deleted: !!body.deleted });
    }
    return placeEntityPayload(local, hint, body, slices);
  }

  function placeEntityPayload(local, hint, body, slices, authoritative) {
    var out = Object.assign({}, local);
    var payload = isPlainObject(body && body.payload) ? body.payload : {};
    var t = normEntityType(hint.type);
    if (t.indexOf("e:") === 0) {
      return mergeGenericRow(out, t.slice(2), Object.assign({ k1: hint.id, k2: hint.period || null }, body || {}));
    }
    if (t === "people") {
      if (body && body.deleted) {
        out.people = (Array.isArray(out.people) ? out.people : []).filter(function (row) {
          return !row || String(row.id) !== hint.id;
        });
      } else {
        var row = Object.assign({}, payload, { id: hint.id });
        out.people = authoritative ? replacePersonRow(out.people, row) : mergeKeepPeopleClient(out.people, [row]);
      }
      return out;
    }
    if (t === "reward-records" || t === "month-records") {
      var field = t === "reward-records" ? "rewardRecords" : "records";
      var period = hint.period || body.period || "";
      var pid = hint.id || body.personId || "";
      if (!period || !pid) return out;
      var dkey = sliceKey(field, period, pid);
      if (slices && slices.months && slices.months[dkey]) {
        var dismissKey = period + "\0" + pid;
        // A delete is not a conflict to resolve: it stands, and the draft is
        // dropped when it is saved. No "changed in another session" banner.
        if (!dismissedConflicts[dismissKey] && !(body && body.deleted)) {
          lastRowConflicts = lastRowConflicts.concat([{ field: field, period: period, personId: pid }]);
        }
        return out;
      }
      var tree = {};
      tree[period] = {};
      if (body && body.deleted) {
        /* missing key is not a delete of other people; drop this one slice */
        var next = Object.assign({}, mergeKeepMonthMapsClient(out[field], {}));
        if (isPlainObject(next[period])) {
          // Copy the month map: it is shared with the screen's own state (and
          // possibly the baseline); deleting in place changed them unseen.
          next[period] = Object.assign({}, next[period]);
          delete next[period][pid];
        }
        out[field] = next;
        return out;
      }
      tree[period][pid] = normalizePlanRec(payload);
      out[field] = mergeKeepMonthMapsClient(out[field], tree);
      return out;
    }
    if (t === "target-cells") {
      var cells = Object.assign({}, isPlainObject(out.targetCells) ? out.targetCells : {});
      if (body && body.deleted) delete cells[hint.id];
      else cells[hint.id] = Object.assign({}, payload, { id: hint.id });
      out.targetCells = cells;
    }
    return out;
  }

  async function pullPendingEntities(local, slices, getNow) {
    if (!pendingEntities.length) return { local: local, fetched: [], types: {}, acks: [] };
    var batch = pendingEntities.slice(0, LIVE_ENTITY_CAP);
    pendingEntities = pendingEntities.slice(LIVE_ENTITY_CAP);
    var fetched = [];
    var types = {};
    var out = local;
    var pullAcks = [];
    var bodies = [];
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    for (var i = 0; i < batch.length; i++) {
      var hint = batch[i];
      if (normEntityType(hint.type) === "month-records" && !apmsViewOpen()) continue;
      var url = entityUrl(hint);
      if (!url || !getter) {
        pendingEntities.push(hint);
        continue;
      }
      try {
        var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
        if (!res || !res.ok) {
          pendingEntities.push(hint);
          continue;
        }
        var body = await res.json().catch(function () {
          return null;
        });
        if (!body || body.ok === false) {
          pendingEntities.push(hint);
          continue;
        }
        seenEntityKeys[entityHintKey(hint)] = 1;
        fetched.push(hint);
        types[hint.type] = 1;
        bodies.push({ hint: hint, body: body });
      } catch (err) {
        pendingEntities.push(hint);
      }
    }
    // Merge onto the screen as it is now, not as it was before the GETs: the
    // change feed may have applied other rows meanwhile (another user's new
    // target), and a result built on the older snapshot took them off the
    // screen while the baseline kept them, so the next save deleted them.
    if (bodies.length && typeof getNow === "function") {
      var now = getNow();
      if (isPlainObject(now)) {
        out = now;
        slices = dirtySlices(now);
      }
    }
    bodies.forEach(function (fb) {
      var before = out;
      out = withAcks(pullAcks, function () { return mergeEntityPayload(before, fb.hint, fb.body, slices); });
    });
    return { local: out, fetched: fetched, types: types, acks: pullAcks };
  }

  function noteAck(ack, sentIds) {
    if (!ack) return;
    var gens = isPlainObject(ack.bookGens) ? ack.bookGens : {};
    (sentIds || ack.applied || []).forEach(function (id) {
      if (Number.isFinite(Number(gens[id]))) lastGens[id] = Number(gens[id]);
    });
    BOOK_IDS.forEach(function (id) {
      if (Number.isFinite(Number(gens[id])) && (sentIds || []).indexOf(id) >= 0) {
        lastGens[id] = Number(gens[id]);
      }
    });
  }

  /**
   * `into` with every row-owned field of `book` taken from `from` (absent stays
   * absent): the four hot collections, and with ROWS-V2 every generic field.
   */
  var HOT_BY_BOOK = { org: ["people"], months: ["records", "rewardRecords"], targets: ["targetCells"], plans: [] };
  function keepRowOwned(book, into, from) {
    if (!isPlainObject(into)) return into;
    var out = Object.assign({}, into);
    var src = isPlainObject(from) ? from : {};
    var fields = (HOT_BY_BOOK[book] || []).slice();
    if (C) C.SPECS.forEach(function (spec) { if (spec.book === book) fields.push(spec.field); });
    fields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(src, field)) out[field] = src[field];
      else delete out[field];
    });
    return out;
  }

  function markAckedFromSnap(snapshot, ids) {
    rememberRows(snapshot);
    var books = splitSnapshot(snapshot);
    (ids || BOOK_IDS).forEach(function (id) {
      lastAcked[id] = bookPayload(books[id], id);
      lastHashes[id] = stableStringify(lastAcked[id]);
    });
    var gens = normalizeGens(snapshot);
    (ids || BOOK_IDS).forEach(function (id) {
      if (gens[id]) lastGens[id] = gens[id];
    });
  }

  function buildPatch(snapshot, ids) {
    var books = splitSnapshot(snapshot);
    var gens = Object.assign({}, lastGens, normalizeGens(snapshot));
    var body = { books: {}, baseGens: {} };
    ids.forEach(function (id) {
      body.books[id] = bookPayload(books[id], id);
      body.baseGens[id] = Number(gens[id]) || 0;
    });
    if (snapshot.tombstones) body.tombstones = snapshot.tombstones;
    body.clientOpId = "op-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    return body;
  }

  function indexRows(rows) {
    var map = {};
    if (!Array.isArray(rows)) return map;
    rows.forEach(function (row) {
      if (typeof row === "string") {
        map["str:" + row] = row;
        return;
      }
      if (!isPlainObject(row)) return;
      map[rowKey(row)] = row;
    });
    return map;
  }

  function mergeArrays(base, server, local) {
    var bMap = indexRows(base);
    var sMap = indexRows(server);
    var lMap = indexRows(local);
    var keys = {};
    Object.keys(bMap).forEach(function (k) {
      keys[k] = 1;
    });
    Object.keys(sMap).forEach(function (k) {
      keys[k] = 1;
    });
    Object.keys(lMap).forEach(function (k) {
      keys[k] = 1;
    });
    var out = [];
    Object.keys(keys).forEach(function (k) {
      var b = bMap[k];
      var s = sMap[k];
      var l = lMap[k];
      if (l != null && s != null) {
        if (eq(l, s)) out.push(s);
        else if (b != null && eq(l, b)) out.push(s);
        else if (b != null && eq(s, b)) out.push(l);
        else if (isPlainObject(l) || isPlainObject(s)) {
          out.push(stamp(l) >= stamp(s) ? Object.assign({}, s, l) : Object.assign({}, l, s));
        } else out.push(l);
      } else if (l != null && s == null) {
        if (b != null && eq(l, b)) return;
        out.push(l);
      } else if (l == null && s != null) {
        // Keep server-only rows. A live pull that updated lastAcked without
        // applying to the store used to look like a local delete and dropped
        // newly added people (Priya vanishing for ~15s).
        out.push(s);
      }
    });
    return out;
  }

  function mergeMaps(base, server, local) {
    var b = isPlainObject(base) ? base : {};
    var s = isPlainObject(server) ? server : {};
    var l = isPlainObject(local) ? local : {};
    var keys = {};
    Object.keys(b).concat(Object.keys(s), Object.keys(l)).forEach(function (k) {
      keys[k] = 1;
    });
    var out = {};
    Object.keys(keys).forEach(function (k) {
      var bv = b[k];
      var sv = s[k];
      var lv = l[k];
      if (lv !== undefined && sv !== undefined) {
        if (eq(lv, sv)) out[k] = sv;
        else if (eq(lv, bv)) out[k] = sv;
        else if (eq(sv, bv)) out[k] = lv;
        else if (isPlainObject(lv) && isPlainObject(sv) && (lv.status || sv.status || lv.kpis || sv.kpis)) {
          out[k] = stamp(lv) >= stamp(sv) ? lv : sv;
        } else if (isPlainObject(lv) || isPlainObject(sv) || isPlainObject(bv)) out[k] = mergeMaps(bv, sv, lv);
        else if (Array.isArray(lv) || Array.isArray(sv)) out[k] = mergeArrays(bv, sv, lv);
        else out[k] = stamp(lv) >= stamp(sv) ? lv : sv;
      } else if (lv !== undefined && sv === undefined) {
        if (bv !== undefined && eq(lv, bv)) return;
        out[k] = lv;
      } else if (lv === undefined && sv !== undefined) {
        out[k] = sv;
      }
    });
    return out;
  }

  function mergeStringList(base, server, local) {
    function as(v) {
      return Array.isArray(v) ? v.map(String) : [];
    }
    var bset = {};
    as(base).forEach(function (x) {
      bset[x] = 1;
    });
    var out = {};
    as(server).forEach(function (x) {
      out[x] = 1;
    });
    as(local).forEach(function (x) {
      if (!bset[x]) out[x] = 1;
    });
    as(base).forEach(function (x) {
      if (out[x] && as(local).indexOf(x) < 0) delete out[x];
    });
    return Object.keys(out);
  }

  function overlappingPersonMonths(base, local, server) {
    var hits = [];
    ["rewardRecords", "records"].forEach(function (field) {
      var b = isPlainObject(base && base[field]) ? base[field] : {};
      var l = isPlainObject(local && local[field]) ? local[field] : {};
      var sv = isPlainObject(server && server[field]) ? server[field] : {};
      Object.keys(l).concat(Object.keys(sv)).forEach(function (month) {
        var lm = isPlainObject(l[month]) ? l[month] : {};
        var sm = isPlainObject(sv[month]) ? sv[month] : {};
        var bm = isPlainObject(b[month]) ? b[month] : {};
        Object.keys(lm).concat(Object.keys(sm)).forEach(function (pid) {
          if (lm[pid] === undefined || sm[pid] === undefined) return;
          if (eq(lm[pid], sm[pid])) return;
          if (eq(lm[pid], bm[pid])) return;
          if (eq(sm[pid], bm[pid])) return;
          if (hits.some(function (h) { return h.month === month && h.personId === pid; })) return;
          hits.push({ month: month, personId: pid, field: field });
        });
      });
    });
    return hits;
  }

  /** The server's row replaces the screen's (fields the wire never carries, e.g. password, are kept). */
  function replacePersonRow(stored, row) {
    var list = Array.isArray(stored) ? stored.slice() : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(row.id)) {
        var keep = {};
        ["password", "passwordHash"].forEach(function (f) {
          if (list[i][f] !== undefined && row[f] === undefined) keep[f] = list[i][f];
        });
        list[i] = Object.assign({}, row, keep);
        return list;
      }
    }
    list.push(row);
    return list;
  }

  function mergeKeepPeopleClient(stored, incoming) {
    var sRows = Array.isArray(stored) ? stored : [];
    var iRows = Array.isArray(incoming) ? incoming : [];
    if (iRows.length === 1 && iRows[0] && iRows[0].id) {
      var oneId = String(iRows[0].id);
      var idx = -1;
      for (var pi = 0; pi < sRows.length; pi++) {
        if (sRows[pi] && String(sRows[pi].id) === oneId) {
          idx = pi;
          break;
        }
      }
      if (idx >= 0) {
        var prevOne = sRows[idx];
        var nextOne =
          stamp(iRows[0]) >= stamp(prevOne)
            ? Object.assign({}, prevOne, iRows[0])
            : Object.assign({}, iRows[0], prevOne);
        var copy = sRows.slice();
        copy[idx] = nextOne;
        return copy;
      }
    }
    var byId = {};
    sRows.forEach(function (row) {
      if (isPlainObject(row) && row.id) byId[String(row.id)] = row;
    });
    iRows.forEach(function (row) {
      if (!isPlainObject(row) || !row.id) return;
      var id = String(row.id);
      var prev = byId[id];
      byId[id] = prev ? (stamp(row) >= stamp(prev) ? Object.assign({}, prev, row) : Object.assign({}, row, prev)) : row;
    });
    var seen = {};
    var out = [];
    iRows.concat(sRows).forEach(function (row) {
      if (!isPlainObject(row) || !row.id) return;
      var id = String(row.id);
      if (seen[id]) return;
      seen[id] = 1;
      out.push(byId[id]);
    });
    return out;
  }

  function stampPeopleTombs(snapshot) {
    var acked = lastAcked.org && lastAcked.org.people;
    var now = snapshot.people;
    if (!Array.isArray(acked) || !Array.isArray(now)) return snapshot;
    var have = {};
    now.forEach(function (p) {
      if (p && p.id) have[String(p.id)] = 1;
    });
    var tombs = isPlainObject(snapshot.tombstones) ? snapshot.tombstones : {};
    tombs.people = isPlainObject(tombs.people) ? tombs.people : {};
    var at = Date.now();
    acked.forEach(function (p) {
      if (p && p.id && !have[String(p.id)]) tombs.people[String(p.id)] = at;
    });
    snapshot.tombstones = tombs;
    return snapshot;
  }

  function rebaseBook(id, localBook, serverBook) {
    var base = lastAcked[id] || {};
    var local = isPlainObject(localBook) ? localBook : {};
    var server = isPlainObject(serverBook) ? serverBook : {};
    var out = {};
    BOOK_FIELDS[id].forEach(function (field) {
      if (SKIP_EQ[field] || SESSION_SET[field]) return;
      var b = base[field];
      var s = server[field];
      var l = local[field];
      if (l === undefined && s === undefined) return;
      if (eq(l, s)) out[field] = s;
      else if (eq(l, b)) out[field] = s;
      else if (eq(s, b)) out[field] = l;
      else if (STRING_LIST[field]) out[field] = mergeStringList(b, s, l);
      else if (Array.isArray(l) || Array.isArray(s) || Array.isArray(b)) out[field] = mergeArrays(b, s, l);
      else if (isPlainObject(l) || isPlainObject(s) || isPlainObject(b)) out[field] = mergeMaps(b, s, l);
      else out[field] = l !== undefined ? l : s;
    });
    return out;
  }

  function mergeKeepMonthMapsClient(stored, incoming) {
    var out = Object.assign({}, isPlainObject(stored) ? stored : {});
    if (!isPlainObject(incoming)) return out;
    Object.keys(incoming).forEach(function (month) {
      var im = incoming[month];
      if (!isPlainObject(im)) {
        out[month] = im;
        return;
      }
      var sm = Object.assign({}, isPlainObject(out[month]) ? out[month] : {});
      Object.keys(im).forEach(function (pid) {
        sm[pid] = im[pid];
      });
      out[month] = sm;
    });
    return out;
  }

  function sliceKey(field, period, pid) {
    return field + "\0" + period + "\0" + pid;
  }

  function dirtySlices(snap) {
    var people = {};
    var months = {};
    if (!isPlainObject(snap)) return { people: people, months: months };
    var prevP = peopleById((lastAcked.org && lastAcked.org.people) || []);
    var nextP = peopleById(snap.people);
    Object.keys(nextP).forEach(function (id) {
      if (!eq(nextP[id], prevP[id])) people[id] = 1;
    });
    ["records", "rewardRecords"].forEach(function (field) {
      var prev = (lastAcked.months && lastAcked.months[field]) || {};
      walkPersonPeriod(snap[field], function (period, pid, rec) {
        var before = isPlainObject(prev[period]) ? prev[period][pid] : undefined;
        if (!eq(rec, before)) months[sliceKey(field, period, pid)] = 1;
      });
    });
    return { people: people, months: months };
  }

  function restoreLocalPeople(outRows, localRows, dirtyIds) {
    if (!dirtyIds || !Object.keys(dirtyIds).length) return outRows;
    var localMap = peopleById(localRows);
    var outMap = peopleById(outRows);
    Object.keys(dirtyIds).forEach(function (id) {
      if (localMap[id]) outMap[id] = localMap[id];
    });
    var seen = {};
    var out = [];
    (Array.isArray(outRows) ? outRows : []).concat(Array.isArray(localRows) ? localRows : []).forEach(function (row) {
      if (!isPlainObject(row) || !row.id) return;
      var id = String(row.id);
      if (seen[id]) return;
      seen[id] = 1;
      out.push(outMap[id] || row);
    });
    return out;
  }

  function restoreLocalMonths(outTree, localTree, field, dirty) {
    if (!dirty || !Object.keys(dirty).length) return outTree;
    var out = mergeKeepMonthMapsClient(outTree, {});
    Object.keys(dirty).forEach(function (key) {
      var parts = key.split("\0");
      if (parts[0] !== field) return;
      var period = parts[1];
      var pid = parts[2];
      var localRec = isPlainObject(localTree) && isPlainObject(localTree[period]) ? localTree[period][pid] : undefined;
      if (localRec === undefined) return;
      if (!isPlainObject(out[period])) out[period] = {};
      out[period][pid] = localRec;
    });
    return out;
  }

  function collectRowConflicts(local, books, slices) {
    var hits = [];
    if (!books || !slices) return hits;
    var months = books.months || {};
    ["records", "rewardRecords"].forEach(function (field) {
      walkPersonPeriod(months[field], function (period, pid, rec) {
        var key = sliceKey(field, period, pid);
        if (!slices.months[key]) return;
        var localRec =
          isPlainObject(local[field]) && isPlainObject(local[field][period]) ? local[field][period][pid] : undefined;
        if (eq(localRec, rec)) return;
        var dismissKey = period + "\0" + pid;
        if (dismissedConflicts[dismissKey]) return;
        hits.push({ field: field, period: period, personId: pid });
      });
    });
    return hits;
  }

  /**
   * ROWS-V2: generic fields are row-owned and reach followers through the
   * change feed. A book pull is served from the stale-while-revalidate wire,
   * so right after a row commit it can still carry the old row — applying it
   * put the old value back on screen and the next save sent it as an edit.
   * Book pulls keep the local value of every row-owned field, except the one
   * full pull after a `*` (restore) in the feed.
   */
  var entityFieldsFromNextPull = false;
  function applyPulledBooks(local, books, skip) {
    var out = Object.assign({}, local);
    var keepRows = !!C && !entityFieldsFromNextPull;
    var skipSet = skip || {};
    var slices = dirtySlices(local);
    BOOK_IDS.forEach(function (id) {
      if (skipSet[id] && id === "plans") return;
      var book = books && books[id];
      if (!isPlainObject(book)) return;
      BOOK_FIELDS[id].forEach(function (field) {
        if (!(field in book)) return;
        if (keepRows && C.specForField(field)) return;
        if (field === "people") {
          out.people = restoreLocalPeople(
            mergeKeepPeopleClient(out.people, book.people),
            local.people,
            slices.people,
          );
        } else if (field === "records" || field === "rewardRecords") {
          out[field] = restoreLocalMonths(
            mergeKeepMonthMapsClient(out[field], book[field]),
            local[field],
            field,
            slices.months,
          );
        } else if (skipSet[id] && id === "plans") return;
        else out[field] = book[field];
      });
    });
    if (out.roleKrocs) {
      out.roles = applyRoleKrocs(out.roles, out.roleKrocs);
      delete out.roleKrocs;
    }
    SESSION_KEYS.forEach(function (key) {
      if (key in local) out[key] = local[key];
      else delete out[key];
    });
    return out;
  }

  function extractSnapshot(input) {
    var value = input;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (e) {
        return null;
      }
    }
    if (!isPlainObject(value)) return null;
    if (isPlainObject(value.data)) return extractSnapshot(value.data);
    if (typeof value.json === "string") {
      try {
        return extractSnapshot(JSON.parse(value.json));
      } catch (e) {
        return null;
      }
    }
    if (typeof value.snapshotJson === "string") {
      try {
        return extractSnapshot(JSON.parse(value.snapshotJson));
      } catch (e) {
        return null;
      }
    }
    if (Array.isArray(value.people) && isPlainObject(value.roles)) return value;
    return null;
  }

  function enqueueSave(id, fn) {
    var run = (saveQueues[id] || Promise.resolve()).then(fn, fn);
    saveQueues[id] = run.then(
      function () {},
      function () {},
    );
    return run;
  }

  function doFetch() {
    var fn = rawFetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (!fn) throw new Error("fetch is not available");
    return fn.apply(null, arguments);
  }

  async function patchOnce(body) {
    var res = await doFetch("/api/company", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var json = await res.json().catch(function () {
      return null;
    });
    return { status: res.status, json: json };
  }

  async function saveOneBook(snapshot, id) {
    var current = snapshot;
    var attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      var body = buildPatch(current, [id]);
      var bytes = JSON.stringify(body).length;
      var result;
      try {
        result = await patchOnce(body);
      } catch (err) {
        lastSaveMeta = { via: "PATCH-FAIL", bytes: bytes, books: [id], at: Date.now(), error: "network" };
        return {
          ok: false,
          error: "patch-failed",
          applied: [],
          conflict: [id],
          skipped: [],
          bookGens: Object.assign({}, lastGens),
          notebookUpdatedAt: Number(current.notebookUpdatedAt) || Date.now(),
        };
      }
      if (!result.json && (result.status === 404 || result.status === 405 || result.status === 410 || result.status === 0)) {
        lastSaveMeta = { via: "PATCH-FAIL", bytes: bytes, books: [id], at: Date.now(), error: result.status };
        return {
          ok: false,
          error: "patch-failed",
          applied: [],
          conflict: [id],
          skipped: [],
          bookGens: Object.assign({}, lastGens),
          notebookUpdatedAt: Number(current.notebookUpdatedAt) || Date.now(),
        };
      }
      var ack = result.json || {};
      if (result.status === 200 && ack.ok) {
        if (ack.bookGens) {
          BOOK_IDS.forEach(function (bid) {
            var n = Number(ack.bookGens[bid]);
            if (Number.isFinite(n)) lastGens[bid] = n;
          });
        }
        markAckedFromSnap(current, ack.applied && ack.applied.length ? ack.applied : [id]);
        lastSaveMeta = { via: "PATCH", bytes: bytes, books: [id], at: Date.now(), applied: ack.applied || [id] };
        ack.notebookUpdatedAt = Number(ack.notebookUpdatedAt) || Date.now();
        return ack;
      }
      if (result.status === 409 && ack && Array.isArray(ack.conflict) && ack.conflict.length) {
        if (ack.bookGens) {
          BOOK_IDS.forEach(function (bid) {
            var n = Number(ack.bookGens[bid]);
            if (Number.isFinite(n)) lastGens[bid] = n;
          });
        }
        if (ack.applied && ack.applied.length) markAckedFromSnap(current, ack.applied);
        var split = splitSnapshot(current);
        var personHits = [];
        ack.conflict.forEach(function (cid) {
          var serverBook = (ack.books && ack.books[cid]) || {};
          if (cid === "months") {
            personHits = personHits.concat(overlappingPersonMonths(lastAcked[cid], split[cid], serverBook));
          }
          // Row-owned fields are not the book's to settle (book PATCH ignores
          // them; rows + the change feed own them). Taking the server book's
          // copy into the baseline or the rebased local book made a value the
          // screen never took look like a local edit to revert.
          var localBook = split[cid];
          var prevAck = lastAcked[cid] || {};
          split[cid] = keepRowOwned(cid, rebaseBook(cid, localBook, serverBook), localBook);
          lastAcked[cid] = keepRowOwned(cid, bookPayload(serverBook, cid), prevAck);
          lastHashes[cid] = stableStringify(lastAcked[cid]);
        });
        if (personHits.length) {
          current = Object.assign({}, current);
          BOOK_IDS.forEach(function (bid) {
            Object.assign(current, split[bid]);
          });
          current.bookGens = Object.assign({}, lastGens, ack.bookGens || {});
          continue;
        }
        current = Object.assign({}, current);
        BOOK_IDS.forEach(function (bid) {
          Object.assign(current, split[bid]);
        });
        current.bookGens = Object.assign({}, lastGens, ack.bookGens || {});
        continue;
      }
      lastSaveMeta = { via: "PATCH-FAIL", bytes: bytes, books: [id], at: Date.now(), error: result.status };
      return {
        ok: false,
        error: "patch-failed",
        applied: [],
        conflict: [id],
        skipped: [],
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(current.notebookUpdatedAt) || Date.now(),
      };
    }
    lastSaveMeta = { via: "PATCH-FAIL", bytes: 0, books: [id], at: Date.now(), error: "exhausted" };
    return {
      ok: false,
      error: "patch-failed",
      applied: [],
      conflict: [id],
      skipped: [],
      bookGens: Object.assign({}, lastGens),
      notebookUpdatedAt: Number(current.notebookUpdatedAt) || Date.now(),
    };
  }

  function entityRevKey(kind, a, b) {
    if (kind === "people" || kind === "target_cells") return kind + ":" + a;
    return kind + ":" + a + ":" + b;
  }

  var entityRevs = {};

  function nextOpId() {
    return "ent-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function peopleById(rows) {
    var map = {};
    if (!Array.isArray(rows)) return map;
    rows.forEach(function (row) {
      if (isPlainObject(row) && row.id) map[String(row.id)] = row;
    });
    return map;
  }

  function walkPersonPeriod(map, visit) {
    if (!isPlainObject(map)) return;
    Object.keys(map).forEach(function (period) {
      var inner = map[period];
      if (!isPlainObject(inner)) return;
      Object.keys(inner).forEach(function (pid) {
        visit(period, pid, inner[pid]);
      });
    });
  }

  function collectEntityOps(snap) {
    var ops = [];
    var ackedOrg = lastAcked.org || {};
    var prevPeople = peopleById(ackedOrg.people);
    var nextPeople = peopleById(snap.people);
    // Compare people by content. `rev` is server metadata the people list /
    // row GETs put on each person, and the SPA's hydrate fills empty defaults
    // ([] lists, password ""): neither is an edit. Without this every load or
    // live apply re-saved all people (180 PATCHes holding the save — and the
    // live view — for many seconds). Clearing a field that had a value still
    // differs from the baseline, so real edits are unaffected.
    Object.keys(nextPeople).forEach(function (id) {
      if (!eq(personContent(sansSentSecret(entityRevKey("people", id), nextPeople[id], prevPeople[id])), personContent(prevPeople[id]))) {
        ops.push({
          kind: "people",
          url: "/api/people/" + encodeURIComponent(id),
          // BATCH-3: a password this browser already saved (and the server
          // accepted) is not sent again with a later edit of another field:
          // the server stores a hash and would take the re-sent temporary
          // password as a new one (resetting the person and ending their
          // sessions after they had set their own).
          payload: sansSentSecret(entityRevKey("people", id), nextPeople[id], prevPeople[id]),
          deleted: false,
          revKey: entityRevKey("people", id),
          personId: id,
        });
      }
    });
    Object.keys(prevPeople).forEach(function (id) {
      if (!nextPeople[id]) {
        ops.push({
          kind: "people",
          url: "/api/people/" + encodeURIComponent(id),
          payload: prevPeople[id],
          deleted: true,
          revKey: entityRevKey("people", id),
          personId: id,
        });
      }
    });
    function diffPeriod(field, table, path) {
      var prev = (lastAcked.months && lastAcked.months[field]) || {};
      var next = snap[field];
      var seen = {};
      walkPersonPeriod(next, function (period, pid, rec) {
        seen[period + "\0" + pid] = 1;
        var before = isPlainObject(prev[period]) ? prev[period][pid] : undefined;
        if (eq(recordContent(rec), recordContent(before))) return;
        ops.push({
          kind: table,
          url: path + encodeURIComponent(period) + "/" + encodeURIComponent(pid),
          payload: isPlainObject(rec) ? rec : { value: rec },
          deleted: false,
          revKey: entityRevKey(table, period, pid),
          personId: pid,
          period: period,
        });
      });
      walkPersonPeriod(prev, function (period, pid, rec) {
        if (seen[period + "\0" + pid]) return;
        ops.push({
          kind: table,
          url: path + encodeURIComponent(period) + "/" + encodeURIComponent(pid),
          payload: isPlainObject(rec) ? rec : { value: rec },
          deleted: true,
          revKey: entityRevKey(table, period, pid),
          personId: pid,
          period: period,
        });
      });
    }
    diffPeriod("records", "month_records", "/api/month-records/");
    diffPeriod("rewardRecords", "reward_records", "/api/reward-records/");
    var prevCells = (lastAcked.targets && lastAcked.targets.targetCells) || {};
    var nextCells = isPlainObject(snap.targetCells) ? snap.targetCells : {};
    Object.keys(nextCells).forEach(function (id) {
      if (eq(nextCells[id], prevCells[id])) return;
      ops.push({
        kind: "target_cells",
        url: "/api/target-cells/" + encodeURIComponent(id),
        payload: isPlainObject(nextCells[id]) ? nextCells[id] : { value: nextCells[id] },
        deleted: false,
        revKey: entityRevKey("target_cells", id),
      });
    });
    Object.keys(isPlainObject(prevCells) ? prevCells : {}).forEach(function (id) {
      if (id in nextCells) return;
      ops.push({
        kind: "target_cells",
        url: "/api/target-cells/" + encodeURIComponent(id),
        payload: isPlainObject(prevCells[id]) ? prevCells[id] : {},
        deleted: true,
        revKey: entityRevKey("target_cells", id),
      });
    });
    if (C) {
      // ROWS-V2: every remaining collection is a per-row PATCH with its own rev.
      C.SPECS.forEach(function (spec) {
        genericOpsFor(spec, snap, ops);
      });
    }
    return ops;
  }

  function ackedSlice(op) {
    if (op.spec) {
      var prevRows = rowsById(op.spec, ackedFieldValue(op.spec));
      return prevRows[op.rowId] ? prevRows[op.rowId].payload : undefined;
    }
    if (op.kind === "people") {
      var rows = (lastAcked.org && lastAcked.org.people) || [];
      var found = null;
      rows.forEach(function (row) {
        if (row && String(row.id) === String(op.personId)) found = row;
      });
      return found;
    }
    if (op.kind === "month_records" || op.kind === "reward_records") {
      var field = op.kind === "month_records" ? "records" : "rewardRecords";
      var tree = (lastAcked.months && lastAcked.months[field]) || {};
      return isPlainObject(tree[op.period]) ? tree[op.period][op.personId] : undefined;
    }
    var id = op.revKey.slice("target_cells:".length);
    var cells = (lastAcked.targets && lastAcked.targets.targetCells) || {};
    return cells[id];
  }

  async function patchEntityOnce(op, baseRev) {
    var body = {
      payload: op.payload || {},
      baseRev: baseRev,
      clientOpId: op.clientOpId || nextOpId(),
    };
    if (op.deleted) body.deleted = true;
    op.clientOpId = body.clientOpId;
    var res = await doFetch(op.url, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var json = await res.json().catch(function () {
      return null;
    });
    return { status: res.status, json: json };
  }

  /**
   * Which screen the person is on, and how they got there. The SPA creates a
   * plan record just by opening a person-month page that has none ("Add APMS
   * → Create plan" relies on it), so a record that comes back is a deliberate
   * create only when the person navigated to that page and the record did not
   * exist when they arrived. A page restored on load, or one that held the
   * record when they arrived (someone else deleted it meanwhile), is a stale
   * screen rebuilding a blank record.
   */
  var screenEntry = { key: "", at: 0, fromLoad: true, hadRecord: false };
  var screenEntries = [];
  function recordScreenKey(kind, pid, month) {
    return "scorecard|" + kind + "|" + pid + "|" + month;
  }
  function noteScreenEntry() {
    var nav = null;
    try {
      nav = global.__apmsNavUi && typeof global.__apmsNavUi.loadSession === "function" ? global.__apmsNavUi.loadSession() : null;
    } catch (err) {}
    var view = uiView();
    var kind = nav && nav.kind ? String(nav.kind) : "apms";
    // The person-month page is "scorecard" (APMS) or "rewards-scorecard".
    if (view === "rewards-scorecard") {
      view = "scorecard";
      kind = "rewards";
    }
    // Person and month only matter on a person-month page (reading them may
    // copy the whole screen state).
    var pid = view === "scorecard" ? uiPerson() : "";
    var month = view === "scorecard" ? uiMonth() : "";
    var key = view === "scorecard" ? recordScreenKey(kind, pid, month) : view;
    if (key === screenEntry.key) return screenEntry;
    var had = false;
    if (view === "scorecard") {
      var tree = (lastAcked.months && lastAcked.months[kind === "rewards" ? "rewardRecords" : "records"]) || {};
      had = isPlainObject(tree[month]) && tree[month][pid] !== undefined;
    }
    screenEntry = { key: key, at: Date.now(), fromLoad: screenEntry.key === "", hadRecord: had, view: view, kind: kind, pid: pid, month: month };
    if (view === "scorecard" && !screenEntry.fromLoad && !had && typeof staleReadds === "object") {
      // Navigated here and there is no plan yet: whatever appears now is a create.
      delete staleReadds[entityRevKey(kind === "rewards" ? "reward_records" : "month_records", month, pid)];
    }
    screenEntries.push(screenEntry);
    if (screenEntries.length > 20) screenEntries.shift();
    return screenEntry;
  }

  /**
   * Flag a blank record the SPA rebuilt on a stale page the moment it shows up
   * (it may only be saved after the person has moved on to another screen).
   */
  var staleReadds = {};
  function flagStaleReadd() {
    var entry = noteScreenEntry();
    if (entry.view !== "scorecard" || !(entry.fromLoad || entry.hadRecord)) return;
    var snap = peekSnapshot();
    if (!snap) return;
    var field = entry.kind === "rewards" ? "rewardRecords" : "records";
    var tree = (lastAcked.months && lastAcked.months[field]) || {};
    var local = isPlainObject(snap[field]) && isPlainObject(snap[field][entry.month]) ? snap[field][entry.month][entry.pid] : undefined;
    var acked = isPlainObject(tree[entry.month]) ? tree[entry.month][entry.pid] : undefined;
    if (local === undefined || acked !== undefined) return;
    var revKey = entityRevKey(entry.kind === "rewards" ? "reward_records" : "month_records", entry.month, entry.pid);
    if (remoteDeletedKeys[revKey] || entry.fromLoad) staleReadds[revKey] = 1;
  }

  /**
   * Deleted records a stale page rebuilt locally and that were not sent. If
   * the UI refused the corrected snapshot at save time, the blank record would
   * stay on this person's screen (and in their month list); once they are off
   * that record's page it is taken off their screen.
   */
  var ghostRecords = {};
  function noteGhost(op) {
    if (op.kind !== "month_records" && op.kind !== "reward_records") return;
    ghostRecords[op.revKey] = { field: op.kind === "reward_records" ? "rewardRecords" : "records", kind: op.kind === "reward_records" ? "rewards" : "apms", month: String(op.period), pid: String(op.personId) };
  }
  /** Put the server's version back on screen after a dropped stale write-back. */
  function restoreWritebacks() {
    var keys = Object.keys(restoreRows);
    if (!keys.length || !liveHooks || typeof liveHooks.getSnapshot !== "function" || typeof liveHooks.apply !== "function") return;
    if (typeof liveHooks.isBlocked === "function" && liveHooks.isBlocked()) return;
    var snap = liveHooks.getSnapshot();
    if (!snap) return;
    var next = snap;
    keys.forEach(function (revKey) {
      var r = restoreRows[revKey];
      var tree = (lastAcked.months && lastAcked.months[r.field]) || {};
      var acked = isPlainObject(tree[r.month]) ? tree[r.month][r.pid] : undefined;
      var here = isPlainObject(next[r.field]) && isPlainObject(next[r.field][r.month]) ? next[r.field][r.month][r.pid] : undefined;
      if (acked === undefined || eq(recordContent(here), recordContent(acked))) return;
      var month = Object.assign({}, next[r.field][r.month]);
      month[r.pid] = acked;
      var field = Object.assign({}, next[r.field]);
      field[r.month] = month;
      next = Object.assign({}, next);
      next[r.field] = field;
    });
    if (next !== snap) {
      var took = false;
      try {
        took = liveHooks.apply(Object.assign({}, next, { bookGens: Object.assign({}, lastGens) }), "live-entity") !== false;
      } catch (err) {
        took = false;
      }
      if (!took) return;
    }
    restoreRows = {};
  }

  function clearGhosts() {
    restoreWritebacks();
    var keys = Object.keys(ghostRecords);
    if (!keys.length || !liveHooks || typeof liveHooks.getSnapshot !== "function" || typeof liveHooks.apply !== "function") return;
    if (typeof liveHooks.isBlocked === "function" && liveHooks.isBlocked()) return;
    var snap = liveHooks.getSnapshot();
    if (!snap) return;
    var next = snap;
    var cleared = [];
    keys.forEach(function (revKey) {
      var g = ghostRecords[revKey];
      if (screenEntry.key === recordScreenKey(g.kind, g.pid, g.month)) return;
      var tree = (lastAcked.months && lastAcked.months[g.field]) || {};
      if (!remoteDeletedKeys[revKey] || (isPlainObject(tree[g.month]) && tree[g.month][g.pid] !== undefined)) {
        cleared.push(revKey);
        return;
      }
      var here = isPlainObject(next[g.field]) && isPlainObject(next[g.field][g.month]) ? next[g.field][g.month][g.pid] : undefined;
      if (here === undefined) {
        cleared.push(revKey);
        return;
      }
      var month = Object.assign({}, next[g.field][g.month]);
      delete month[g.pid];
      var field = Object.assign({}, next[g.field]);
      field[g.month] = month;
      next = Object.assign({}, next);
      next[g.field] = field;
      cleared.push(revKey);
    });
    if (next !== snap) {
      var took = false;
      try {
        took = liveHooks.apply(Object.assign({}, next, { bookGens: Object.assign({}, lastGens) }), "live-entity") !== false;
      } catch (err) {
        took = false;
      }
      if (!took) return;
    }
    cleared.forEach(function (k) {
      delete ghostRecords[k];
    });
  }

  /** A month / reward record another user deleted, re-added by a stale page. */
  function staleHotReadd(op) {
    if (op.kind !== "month_records" && op.kind !== "reward_records") return false;
    if (staleReadds[op.revKey]) return true;
    var entry = noteScreenEntry();
    if (entry.key !== recordScreenKey(op.kind === "reward_records" ? "rewards" : "apms", String(op.personId), String(op.period))) return false;
    return entry.fromLoad || entry.hadRecord;
  }

  /**
   * The version of a month / reward record this client held just before the
   * latest server version replaced it. The SPA sometimes writes a whole record
   * back from an older copy it kept (an open plan page did this right after
   * another user's lock arrived): that save is the superseded version exactly,
   * down to its updatedAt stamp, which a real edit always refreshes. Sending it
   * would silently undo the other user's change, so it is not sent and the
   * screen goes back to the server's version.
   */
  var supersededRows = {};
  var restoreRows = {};
  function staleWriteback(op) {
    if (op.deleted || (op.kind !== "month_records" && op.kind !== "reward_records")) return false;
    var sup = supersededRows[op.revKey];
    if (!isPlainObject(sup) || sup.updatedAt === undefined || !isPlainObject(op.payload)) return false;
    if (op.payload.updatedAt !== sup.updatedAt) return false;
    return eq(op.payload, sup);
  }

  async function saveOneEntity(op, snap) {
    if (staleWriteback(op)) {
      var current = ackedSlice(op);
      restoreRows[op.revKey] = { field: op.kind === "reward_records" ? "rewardRecords" : "records", month: String(op.period), pid: String(op.personId) };
      lastMergeTrace.push({ revKey: op.revKey, kind: "stale-writeback-dropped" });
      return { ok: true, json: { ok: true, payload: current, deleted: current === undefined }, op: op, adopted: true, deleted: current === undefined, restore: true };
    }
    if (!op.deleted && remoteDeletedKeys[op.revKey] && ackedSlice(op) === undefined && (op.spec || staleHotReadd(op))) {
      // Re-adding a row someone else deleted: stale screen state, not a create.
      noteGhost(op);
      lastMergeTrace.push({ revKey: op.revKey, kind: "stale-readd-dropped" });
      return { ok: true, json: { ok: true, deleted: true, payload: op.payload }, op: op, adopted: true, deleted: true };
    }
    var known = Object.prototype.hasOwnProperty.call(entityRevs, op.revKey);
    var baseRev = known ? Number(entityRevs[op.revKey]) || 0 : 0;
    var attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      var result;
      try {
        result = await patchEntityOnce(op, baseRev);
      } catch (err) {
        return { ok: false, error: "patch-failed", op: op };
      }
      if (result.status === 200 && result.json && result.json.ok) {
        entityRevs[op.revKey] = Number(result.json.rev) || baseRev;
        if (!op.deleted && isPlainObject(op.payload) && op.payload.password && !(isPlainObject(result.json.payload) && result.json.payload.password)) {
          sentSecrets[op.revKey] = op.payload.password;
        }
        if (result.json.bookGens) noteAck({ bookGens: result.json.bookGens }, BOOK_IDS);
        if (result.json.deleted === true && !op.deleted) {
          // The server stored my create as a tombstone (a duplicate auto
          // notice another user's screen already raised): drop it here too.
          remoteDeletedKeys[op.revKey] = 1;
          return { ok: true, json: result.json, op: op, adopted: true, deleted: true };
        }
        return { ok: true, json: result.json, op: op };
      }
      if (result.status === 409 && result.json) {
        var serverRev = Number(result.json.rev);
        var serverPayload = result.json.payload;
        var serverDeleted = !!result.json.deleted;
        var base = ackedSlice(op);
        if (!Number.isFinite(serverRev)) {
          return { ok: false, error: "patch-failed", op: op, status: 409 };
        }
        entityRevs[op.revKey] = serverRev;
        known = true;
        if (serverRev === baseRev && attempts > 1) {
          // Same rev twice: nothing we send is accepted. Take theirs.
          return { ok: true, json: result.json, op: op, adopted: true, deleted: serverDeleted };
        }
        baseRev = serverRev;
        if (serverDeleted && !op.deleted) {
          if (trashRestoreKeys[op.revKey]) {
            // Restored from Trash: re-create on top of the tombstone (baseRev = its rev).
            delete trashRestoreKeys[op.revKey];
            lastMergeTrace.push({ revKey: op.revKey, kind: "trash-restore-recreate" });
            continue;
          }
          if (base === undefined && !knownRowKeys[op.revKey] && !staleHotReadd(op)) {
            // I never had this row: it is a genuine create that collided with
            // an old tombstone id. Re-create it on top of the tombstone.
            continue;
          }
          // They deleted the row while I edited it. The delete stands; my
          // edit is dropped rather than resurrecting the row.
          remoteDeletedKeys[op.revKey] = 1;
          noteGhost(op);
          lastMergeTrace.push({ revKey: op.revKey, kind: "deleted-by-other" });
          return { ok: true, json: result.json, op: op, adopted: true, deleted: true };
        }
        if (serverDeleted && op.deleted) {
          // Already gone. Nothing to do.
          return { ok: true, json: result.json, op: op, adopted: true, deleted: true };
        }
        if (op.deleted) {
          // I deleted; they changed it meanwhile. The explicit delete stands.
          continue;
        }
        if (eq(serverPayload, op.payload)) {
          // The server already holds exactly my row: adopt its rev, no write.
          return { ok: true, json: result.json, op: op, adopted: true, deleted: false };
        }
        if (eq(serverPayload, base)) {
          // Nobody else touched it; I just did not know the rev. Resend as-is.
          continue;
        }
        var trace = [];
        var merged = merge3(base, op.payload, serverPayload, trace);
        lastMergeTrace.push({ revKey: op.revKey, kind: "merged", clashes: trace });
        if (eq(merged, serverPayload)) {
          // The server already holds exactly the merged row: nothing to write.
          return { ok: true, json: result.json, op: op, adopted: true, deleted: false };
        }
        op.payload = merged;
        op.merged = true;
        continue;
      }
      return { ok: false, error: "patch-failed", op: op, status: result && result.status };
    }
    return { ok: true, json: { ok: true, rev: baseRev }, op: op };
  }

  function ackMassRow(op, payload) {
    if (op.kind !== "reward_records" && op.kind !== "month_records") return;
    lastAcked.months = lastAcked.months || {};
    var field = op.kind === "reward_records" ? "rewardRecords" : "records";
    var tree = Object.assign({}, lastAcked.months[field] || {});
    var month = Object.assign({}, tree[op.period] || {});
    month[op.personId] = payload;
    tree[op.period] = month;
    lastAcked.months[field] = tree;
    if (lastHashes.months) {
      lastHashes.months = stableStringify(bookPayload(lastAcked.months, "months"));
    }
  }

  /** One PATCH per row. 409 is not retried (would overwrite). GET rev only when unknown. */
  async function massPatch(ops) {
    if (!ops || !ops.length) {
      return { updated: 0, stale: 0, failed: 0, staleIds: [], results: [], message: "0 updated, 0 stale (409), 0 failed." };
    }
    var results = await Promise.all(
      ops.map(async function (op) {
        var baseRev;
        if (Number.isFinite(Number(op.baseRev))) baseRev = Number(op.baseRev);
        else if (Object.prototype.hasOwnProperty.call(entityRevs, op.revKey)) baseRev = Number(entityRevs[op.revKey]) || 0;
        else {
          try {
            var g = await doFetch(op.url, { credentials: "include" });
            var gj = await g.json().catch(function () {
              return null;
            });
            baseRev = gj && Number.isFinite(Number(gj.rev)) ? Number(gj.rev) : 0;
            entityRevs[op.revKey] = baseRev;
          } catch (err) {
            baseRev = 0;
          }
        }
        var result;
        try {
          result = await patchEntityOnce(op, baseRev);
        } catch (err) {
          return { status: 0, json: null, personId: op.personId, period: op.period, failed: true };
        }
        if (result.status === 200 && result.json && result.json.ok) {
          entityRevs[op.revKey] = Number(result.json.rev) || baseRev;
          ackMassRow(op, result.json.payload);
        }
        return { status: result.status, json: result.json, personId: op.personId, period: op.period };
      }),
    );
    var updated = 0;
    var stale = 0;
    var failed = 0;
    var staleIds = [];
    results.forEach(function (r) {
      if (r.status === 200) updated += 1;
      else if (r.status === 409) {
        stale += 1;
        staleIds.push(r.personId);
      } else failed += 1;
    });
    var message = updated + " updated, " + stale + " stale (409), " + failed + " failed.";
    lastSaveMeta = { via: "MASS", bytes: 0, books: [], at: Date.now(), message: message };
    return { updated: updated, stale: stale, failed: failed, staleIds: staleIds, results: results, message: message };
  }

  function markEntityFieldsAcked(snap, ops) {
    var touchOrg = false;
    var touchMonths = false;
    var touchTargets = false;
    ops.forEach(function (op) {
      if (op.kind === "people") touchOrg = true;
      if (String(op.kind).indexOf("org-") === 0) touchOrg = true;
      if (op.kind === "month_records" || op.kind === "reward_records") touchMonths = true;
      if (op.kind === "target_cells") touchTargets = true;
    });
    if (touchOrg) {
      lastAcked.org = lastAcked.org || {};
      lastAcked.org.people = snap.people;
      lastAcked.org.trash = snap.trash;
      lastAcked.org.tombstones = snap.tombstones;
      lastAcked.org.companies = snap.companies;
      lastAcked.org.brands = snap.brands;
      lastAcked.org.businessUnits = snap.businessUnits;
      lastAcked.org.functions = snap.functions;
      lastAcked.org.subFunctions = snap.subFunctions;
      lastAcked.org.roles = snap.roles;
      lastAcked.org.sbuMembers = snap.sbuMembers;
      lastHashes.org = stableStringify(bookPayload(lastAcked.org, "org"));
    }
    if (touchMonths) {
      lastAcked.months = lastAcked.months || {};
      lastAcked.months.records = snap.records;
      lastAcked.months.rewardRecords = snap.rewardRecords;
      lastHashes.months = stableStringify(bookPayload(lastAcked.months, "months"));
    }
    if (touchTargets) {
      lastAcked.targets = lastAcked.targets || {};
      lastAcked.targets.targetCells = snap.targetCells;
      lastHashes.targets = stableStringify(bookPayload(lastAcked.targets, "targets"));
    }
    // ROWS-V2: generic fields are acked per field so a clean save leaves no dirty book behind.
    var touchedBooks = {};
    ops.forEach(function (op) {
      if (!op.spec) return;
      var book = op.spec.book;
      lastAcked[book] = lastAcked[book] || {};
      if (snap[op.field] === undefined) delete lastAcked[book][op.field];
      else lastAcked[book][op.field] = snap[op.field];
      touchedBooks[book] = 1;
    });
    Object.keys(touchedBooks).forEach(function (book) {
      lastHashes[book] = stableStringify(bookPayload(lastAcked[book], book));
    });
  }

  /**
   * Fold server-side outcomes (merged rows, adopted deletes, server versions)
   * back into the snapshot so the UI and the acked baseline both reflect what
   * the server actually holds. Returns the corrected snapshot.
   */
  function foldEntityResults(snap, results) {
    var out = snap;
    var changed = false;
    results.forEach(function (r) {
      if (!r || !r.ok || !r.op) return;
      var op = r.op;
      var json = r.json || {};
      if (op.spec) {
        var serverRow = genericRowFromOp(op, isPlainObject(json.payload) ? json.payload : op.payload);
        var deleted = r.deleted === true || (r.adopted && json.deleted === true) || (!r.adopted && op.deleted);
        if (r.adopted || r.merged || op.merged) {
          out = applyGenericRow(out, op.spec, serverRow, !!deleted, false);
          changed = true;
        }
        return;
      }
      if (!(r.adopted || op.merged)) return;
      var hint = { type: op.kind, id: op.personId || op.rowId || (op.revKey || "").split(":").pop(), period: op.period };
      if (op.kind === "target_cells") hint.id = op.revKey.slice("target_cells:".length);
      out = placeEntityPayload(out, hint, { ok: true, payload: json.payload || op.payload, deleted: !!(r.deleted || json.deleted) }, {});
      changed = true;
    });
    return changed ? out : snap;
  }

  async function saveEntities(snap) {
    var ops = collectEntityOps(snap);
    if (!ops.length) return { ok: true, applied: [], ops: [], snapshot: snap };
    // Trash → Restore: the trash row's delete goes first. Only when this save
    // really removed it from the server (not a stale screen whose item someone
    // already restored or deleted forever) may its rows re-create their tombstones.
    var trashOps = ops.filter(function (op) { return op.kind === "e:trash" && op.deleted && trashRestoredKeys(op, ops).length; });
    var trashResults = [];
    var staleDropped = [];
    trashRestoreKeys = {};
    if (trashOps.length) {
      trashResults = await Promise.all(trashOps.map(function (op) { return saveOneEntity(op, snap); }));
      var staleRestore = {};
      trashResults.forEach(function (r) {
        if (!r || !r.op) return;
        if (!r.ok || r.adopted) {
          // Someone else already restored it or deleted it forever: this
          // screen's restore is stale — its rows are not re-created.
          if (r.ok) trashRestoredKeys(r.op, ops).forEach(function (k) { staleRestore[k] = 1; });
          return;
        }
        trashRestoredKeys(r.op, ops).forEach(function (k) {
          trashRestoreKeys[k] = 1;
          delete remoteDeletedKeys[k];
        });
      });
      ops = ops.filter(function (op) { return trashOps.indexOf(op) < 0; });
      if (Object.keys(staleRestore).length) {
        ops = ops.filter(function (op) {
          if (op.deleted || !staleRestore[op.revKey]) return true;
          remoteDeletedKeys[op.revKey] = 1;
          staleDropped.push(op);
          trashResults.push({ ok: true, json: { ok: true, deleted: true, payload: op.payload }, op: op, adopted: true, deleted: true });
          lastMergeTrace.push({ revKey: op.revKey, kind: "stale-trash-restore-dropped" });
          return false;
        });
      }
    }
    // A target month's order row goes first. If another user deleted that
    // month (this screen still had it), whatever this save adds to it (new
    // cells, memberships, targets) is stale: dropped, so the month stays gone.
    var orderOps = ops.filter(function (op) { return op.kind === "e:target-root-order"; });
    var orderResults = [];
    var deadMonths = {};
    if (orderOps.length && ops.length > orderOps.length) {
      orderResults = await Promise.all(orderOps.map(function (op) { return saveOneEntity(op, snap); }));
      orderResults.forEach(function (r) {
        if (r && r.ok && r.adopted && r.deleted && r.op && !r.op.deleted) deadMonths[String(r.op.rowId)] = 1;
      });
      ops = ops.filter(function (op) { return op.kind !== "e:target-root-order"; });
    }
    var dropped = [];
    if (Object.keys(deadMonths).length) {
      var droppedNodes = {};
      ops = ops.filter(function (op) {
        if (op.deleted) return true;
        var month = null;
        var node = null;
        if (op.kind === "target_cells") {
          var cid = op.revKey.slice("target_cells:".length);
          month = cid.split("::")[1];
          node = cid.split("::")[0];
        } else if (op.kind === "e:target-members" || op.kind === "e:target-month-status") {
          month = op.kind === "e:target-members" ? String((op.payload || {}).month || "") : String(op.rowId);
        }
        if (month && deadMonths[month] && ackedSlice(op) === undefined) {
          if (node) droppedNodes[node] = 1;
          dropped.push({ ok: true, json: { ok: true, deleted: true, payload: op.payload }, op: op, adopted: true, deleted: true });
          return false;
        }
        return true;
      });
      ops = ops.filter(function (op) {
        if (op.kind === "e:target-nodes" && !op.deleted && droppedNodes[String(op.rowId)] && ackedSlice(op) === undefined) {
          dropped.push({ ok: true, json: { ok: true, deleted: true, payload: op.payload }, op: op, adopted: true, deleted: true });
          return false;
        }
        return true;
      });
      lastMergeTrace.push({ kind: "stale-month-content-dropped", months: Object.keys(deadMonths), ops: dropped.length });
    }
    // Target cells next: a re-added target re-creates its cell before its
    // group membership, which the server refuses while the cell is deleted.
    var cellOps = ops.filter(function (op) { return op.kind === "target_cells"; });
    var otherOps = ops.filter(function (op) { return op.kind !== "target_cells"; });
    var cellResults = cellOps.length && otherOps.some(function (op) { return op.kind === "e:target-members"; })
      ? await Promise.all(cellOps.map(function (op) { return saveOneEntity(op, snap); }))
      : null;
    var restResults = await Promise.all((cellResults ? otherOps : ops).map(function (op) { return saveOneEntity(op, snap); }));
    var results = orderResults.concat(dropped, cellResults ? cellResults.concat(restResults) : restResults);
    ops = orderOps.length && orderResults.length ? orderOps.concat(dropped.map(function (r) { return r.op; }), cellResults ? cellOps.concat(otherOps) : ops) : (cellResults ? cellOps.concat(otherOps) : ops);
    if (trashOps.length) {
      results = trashResults.concat(results);
      ops = trashOps.concat(staleDropped, ops);
      trashRestoreKeys = {};
    }
    var conflict = results.find(function (r) { return r && r.error === "person-month-conflict"; });
    if (conflict) {
      return {
        ok: false,
        conflict: true,
        error: "person-month-conflict",
        personMonths: conflict.personMonths || [],
        applied: [],
        skipped: [],
        books: {},
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(snap.notebookUpdatedAt) || Date.now(),
      };
    }
    var failed = results.find(function (r) { return r && !r.ok; });
    if (failed) {
      // Rows that did commit are acked so they are not re-sent; the failed op
      // stays dirty and is retried on the next save.
      var okOps = results.filter(function (r) { return r && r.ok && r.op; }).map(function (r) { return r.op; });
      if (okOps.length) markEntityFieldsAcked(foldEntityResults(snap, results), okOps);
      return {
        ok: false,
        error: "patch-failed",
        applied: [],
        conflict: [],
        skipped: [],
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(snap.notebookUpdatedAt) || Date.now(),
      };
    }
    var corrected = foldEntityResults(snap, results);
    // Without UI hooks the caller takes `snapshot: corrected` from the result.
    var took = corrected === snap || !liveHooks || typeof liveHooks.apply !== "function";
    if (!took) {
      // The screen gets the server's outcomes on top of what it shows now
      // (rows the feed applied during this save stay); the baseline below is
      // still acked from what was sent.
      var uiNow = typeof liveHooks.getSnapshot === "function" ? liveHooks.getSnapshot() : null;
      var uiCorrected = isPlainObject(uiNow) ? foldEntityResults(stripUi(uiNow), results) : corrected;
      try {
        took = liveHooks.apply(Object.assign({}, uiCorrected, { bookGens: Object.assign({}, lastGens) }), "live-entity") !== false;
      } catch (err) {
        took = false;
      }
    }
    if (took) {
      markEntityFieldsAcked(corrected, ops);
    } else {
      // The UI refused the merged rows (it is still busy with this save). Keep
      // the baseline on what the UI shows and forget the merged rows' new rev:
      // the next save then 409-merges against the server instead of sending
      // the UI's pre-merge copy at the current rev (a silent revert of the
      // other user's fields). The change feed brings the merged row to the UI.
      // A record the server holds as deleted never enters the baseline, even
      // if the screen still shows it (a blank plan a stale page rebuilt).
      var ackSnap = snap;
      results.forEach(function (r) {
        if (!r || !r.ok || !r.op || !r.adopted || !(r.deleted || r.restore)) return;
        if (r.op.kind !== "month_records" && r.op.kind !== "reward_records") return;
        var keep = r.restore ? ackedSlice(r.op) : undefined;
        ackSnap = placeEntityPayload(ackSnap, { type: r.op.kind, id: r.op.personId, period: r.op.period }, keep === undefined ? { ok: true, deleted: true } : { ok: true, payload: keep, deleted: false }, {});
      });
      markEntityFieldsAcked(ackSnap, ops);
      results.forEach(function (r) {
        if (r && r.ok && r.op && (r.adopted || r.op.merged)) delete entityRevs[r.op.revKey];
      });
    }
    lastSaveMeta = {
      via: "ENTITY",
      bytes: 0,
      books: ops.map(function (op) { return op.kind; }),
      at: Date.now(),
      applied: ops.map(function (op) { return op.url; }),
      merged: results.filter(function (r) { return r && (r.adopted || (r.op && r.op.merged)); }).length,
    };
    return { ok: true, applied: ops.map(function (op) { return op.url; }), ops: ops, snapshot: took ? corrected : snap };
  }

  async function save(snapshot) {
    var snap = stripUi(snapshot);
    if (!Array.isArray(snap.people) || !isPlainObject(snap.roles)) {
      return { ok: false, error: "invalid snapshot", applied: [], conflict: [], skipped: BOOK_IDS.slice(), bookGens: lastGens, notebookUpdatedAt: 0 };
    }
    var dirty = dirtyBooks(snap);
    if (!dirty.length) {
      lastSaveMeta = { via: "SKIP", bytes: 0, books: [], at: Date.now() };
      return {
        ok: true,
        applied: [],
        conflict: [],
        skipped: BOOK_IDS.slice(),
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(snap.notebookUpdatedAt) || Date.now(),
      };
    }
    if (!everLoaded) {
      noteLoaded(snap);
      lastSaveMeta = { via: "SKIP", bytes: 0, books: [], at: Date.now() };
      return {
        ok: true,
        applied: [],
        conflict: [],
        skipped: BOOK_IDS.slice(),
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(snap.notebookUpdatedAt) || Date.now(),
      };
    }
    if (dirty.indexOf("org") >= 0) snap = stampPeopleTombs(snap);
    var entityAck = await saveEntities(snap);
    if (entityAck && entityAck.error === "person-month-conflict") {
      lastSaveMeta = { via: "ENTITY", bytes: 0, books: dirty.slice(), at: Date.now() };
      return {
        ok: true,
        applied: [],
        conflict: [],
        skipped: BOOK_IDS.slice(),
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(snap.notebookUpdatedAt) || Date.now(),
        banner: false,
      };
    }
    if (entityAck && entityAck.error === "patch-failed") {
      lastSaveMeta = { via: "PATCH-FAIL", bytes: 0, books: dirty.slice(), at: Date.now(), error: "patch-failed" };
      return entityAck;
    }
    if (entityAck && entityAck.snapshot) snap = entityAck.snapshot;
    dirty = C ? dirtyBookFields(snap) : dirtyBooks(snap);
    if (!dirty.length) {
      lastSaveMeta = {
        via: entityAck && entityAck.ops && entityAck.ops.length ? "ENTITY" : "SKIP",
        bytes: 0,
        books: entityAck && entityAck.applied ? entityAck.applied : [],
        at: Date.now(),
        applied: entityAck && entityAck.applied ? entityAck.applied : [],
        merged: lastSaveMeta && lastSaveMeta.via === "ENTITY" ? lastSaveMeta.merged || 0 : 0,
      };
      return {
        ok: true,
        applied: entityAck && entityAck.applied ? entityAck.applied : [],
        conflict: [],
        skipped: BOOK_IDS.slice(),
        bookGens: Object.assign({}, lastGens),
        notebookUpdatedAt: Number(snap.notebookUpdatedAt) || Date.now(),
      };
    }
    var results = await Promise.all(
      dirty.map(function (id) {
        return enqueueSave(id, function () {
          return saveOneBook(snap, id);
        });
      }),
    );
    var applied = [];
    var conflict = [];
    var skipped = [];
    var bookGens = Object.assign({}, lastGens);
    var notebookUpdatedAt = Number(snap.notebookUpdatedAt) || Date.now();
    var personConflict = null;
    var failed = null;
    results.forEach(function (ack) {
      if (!ack) return;
      if (Array.isArray(ack.applied)) applied = applied.concat(ack.applied);
      if (Array.isArray(ack.conflict) && ack.error !== "person-month-conflict") conflict = conflict.concat(ack.conflict);
      if (Array.isArray(ack.skipped)) skipped = skipped.concat(ack.skipped);
      if (ack.bookGens) Object.assign(bookGens, ack.bookGens);
      if (Number(ack.notebookUpdatedAt)) notebookUpdatedAt = Number(ack.notebookUpdatedAt);
      if (ack.error === "person-month-conflict" && !personConflict) personConflict = ack;
      if (ack.error === "patch-failed" && !failed) failed = ack;
    });
    if (personConflict) {
      lastSaveMeta = { via: "PATCH", bytes: 0, books: dirty.slice(), at: Date.now(), applied: applied };
      return {
        ok: true,
        applied: applied,
        conflict: [],
        skipped: skipped,
        bookGens: bookGens,
        notebookUpdatedAt: notebookUpdatedAt,
        banner: false,
      };
    }
    if (failed) {
      lastSaveMeta = { via: "PATCH-FAIL", bytes: 0, books: dirty.slice(), at: Date.now(), error: failed.error };
      return failed;
    }
    lastSaveMeta = { via: "PATCH", bytes: 0, books: dirty.slice(), at: Date.now(), applied: applied };
    return {
      ok: conflict.length === 0,
      applied: applied,
      conflict: conflict,
      skipped: skipped,
      bookGens: bookGens,
      notebookUpdatedAt: notebookUpdatedAt,
    };
  }

  /**
   * Screen reads: apply server rows through the merge rules, in their own ack
   * scope; the baseline and revs move only if the UI took the snapshot.
   */
  function applyServerRows(build) {
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (!local) return false;
    var acks = [];
    var next = withAcks(acks, function () { return build(local); });
    var took = true;
    if (next !== local && hooks && typeof hooks.apply === "function") {
      try {
        took = hooks.apply(next, "live-entity") !== false;
      } catch (err) {
        took = false;
      }
    }
    if (took) runAcks(acks);
    return took;
  }

  /**
   * PERF (p0as83): an open list screen re-reads its rows every SCREEN_REREAD_MS
   * (was 2 s); the change feed already brings every row change within a
   * second. The re-read sends the ETag it last got: an unchanged list is a 304
   * with no body (`!res.ok` → nothing applied). An ETag is used for at most
   * ETAG_MAX_MS, then one plain read (a screen that refused an apply gets the
   * rows again).
   */
  var SCREEN_REREAD_MS = 20000;
  var ETAG_MAX_MS = 60000;
  var screenEtags = {};
  function screenGet(getter, url) {
    var init = { method: "GET", credentials: "same-origin", cache: "no-store" };
    var hit = screenEtags[url];
    if (hit && Date.now() - hit.at < ETAG_MAX_MS) init.headers = { "If-None-Match": hit.etag };
    return getter(url, init).then(function (res) {
      try {
        var etag = res && res.ok && res.headers && res.headers.get ? res.headers.get("etag") : null;
        if (etag) screenEtags[url] = { etag: etag, at: hit && hit.etag === etag ? hit.at : Date.now() };
        else if (res && res.status !== 304) delete screenEtags[url];
      } catch (err) {}
      return res;
    });
  }

  async function openPeopleScreen(opts) {
    opts = opts || {};
    var limit = Number(opts.limit) || 80;
    var q = opts.q != null ? String(opts.q) : "";
    var sbu = opts.sbu != null ? String(opts.sbu) : "";
    var url = "/api/people?limit=" + encodeURIComponent(String(limit));
    if (q) url += "&q=" + encodeURIComponent(q);
    if (sbu) url += "&sbu=" + encodeURIComponent(sbu);
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter) return { people: [], url: url };
    var res = await screenGet(getter, url);
    if (!res || !res.ok) return { people: [], url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var people = body && Array.isArray(body.people) ? body.people : [];
    if (people.length) {
      applyServerRows(function (local) {
        var acc = local;
        people.forEach(function (p) {
          if (!p || p.id == null) return;
          acc = mergeEntityPayload(acc, { type: "people", id: String(p.id) }, { ok: true, payload: p, rev: p.rev }, {});
        });
        return acc;
      });
    }
    if (typeof opts.apply === "function") opts.apply(people, body);
    return { people: people, url: url, total: body && body.total };
  }

  async function openRewardsMonth(period, opts) {
    opts = opts || {};
    var month = String(period || "");
    var limit = Number(opts.limit) || 80;
    var url = "/api/reward-records/" + encodeURIComponent(month) + "?limit=" + encodeURIComponent(String(limit));
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter || !month) return { records: [], url: url };
    var res = await screenGet(getter, url);
    if (!res || !res.ok) return { records: [], url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var records = body && Array.isArray(body.records) ? body.records : [];
    if (records.length) {
      applyServerRows(function (local) {
        var acc = local;
        records.forEach(function (rec) {
          if (!rec || !rec.personId) return;
          acc = mergeEntityPayload(acc, { type: "reward-records", id: String(rec.personId), period: month }, { ok: true, payload: rec.payload || rec, rev: rec.rev, deleted: !!rec.deleted }, {});
        });
        return acc;
      });
    }
    if (typeof opts.apply === "function") opts.apply(records, body);
    return { records: records, url: url, total: body && body.total, period: month };
  }

  async function openApmsMonth(period, opts) {
    opts = opts || {};
    var month = String(period || "");
    var limit = Number(opts.limit) || 80;
    var url = "/api/month-records/" + encodeURIComponent(month) + "?limit=" + encodeURIComponent(String(limit));
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter || !month) return { records: [], url: url };
    var res = await screenGet(getter, url);
    if (!res || !res.ok) return { records: [], url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var records = body && Array.isArray(body.records) ? body.records : [];
    if (records.length) {
      applyServerRows(function (local) {
        var acc = local;
        records.forEach(function (rec) {
          if (!rec || !rec.personId) return;
          acc = mergeEntityPayload(acc, { type: "month-records", id: String(rec.personId), period: month }, { ok: true, payload: rec.payload || rec, rev: rec.rev, deleted: !!rec.deleted }, {});
        });
        return acc;
      });
    }
    if (typeof opts.apply === "function") opts.apply(records, body);
    return { records: records, url: url, total: body && body.total, period: month };
  }

  async function openApmsPerson(period, personId, opts) {
    opts = opts || {};
    var month = String(period || "");
    var pid = String(personId || "");
    var url = "/api/month-records/" + encodeURIComponent(month) + "/" + encodeURIComponent(pid);
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter || !month || !pid) return { payload: null, url: url };
    var res = await screenGet(getter, url);
    if (!res || !res.ok) return { payload: null, url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var payload = body && body.payload ? body.payload : body;
    if (payload) {
      applyServerRows(function (local) {
        return mergeEntityPayload(local, { type: "month-records", id: pid, period: month }, body && body.payload ? body : { payload: payload }, {});
      });
    }
    if (typeof opts.apply === "function") opts.apply(payload, body);
    return { payload: payload, url: url, rev: body && body.rev };
  }

  /**
   * Org slice (rows are served from the entity table): merge row by row so the
   * baseline follows what the screen took — whole-field replacement left every
   * row unacked, so the next save probed the whole catalog.
   */
  function applyOrgFields(local, body) {
    var next = Object.assign({}, local);
    ["companies", "brands", "businessUnits", "functions", "subFunctions", "roles", "sbuMembers", "trash"].forEach(function (field) {
      if (!body || body[field] === undefined) return;
      var spec = C ? C.specForField(field) : null;
      if (!spec) {
        next[field] = body[field];
        return;
      }
      C.toRows(spec, body[field], []).forEach(function (row) {
        next = mergeGenericRow(next, spec.kind, { k1: row.k1, k2: row.k2, payload: row.payload, deleted: false });
      });
    });
    if (body && Array.isArray(body.people)) {
      body.people.forEach(function (p) {
        if (!p || p.id == null) return;
        next = mergeEntityPayload(next, { type: "people", id: String(p.id) }, { ok: true, payload: p, rev: p.rev }, {});
      });
    }
    return next;
  }

  async function openOrgSlice(kind, opts) {
    opts = opts || {};
    var k = String(kind || "overview");
    var url = "/api/org?kind=" + encodeURIComponent(k);
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter) return { url: url };
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { url: url, status: res && res.status };
    var body = await res.json().catch(function () { return null; });
    if (body) applyServerRows(function (local) { return applyOrgFields(local, body); });
    return { url: url, body: body };
  }

  async function openOrgNode(kind, id, opts) {
    opts = opts || {};
    var k = String(kind || "");
    var nid = String(id || "");
    var url = "/api/org/" + encodeURIComponent(k) + "/" + encodeURIComponent(nid);
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter || !k || !nid) return { url: url };
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { url: url, status: res && res.status };
    var body = await res.json().catch(function () { return null; });
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && body && body.payload) {
      var field = body.field || "";
      var next = Object.assign({}, local);
      if (field === "roles" && isPlainObject(local.roles)) {
        next.roles = Object.assign({}, local.roles);
        next.roles[nid] = body.payload;
      } else if (field) {
        var list = Array.isArray(local[field]) ? local[field].slice() : [];
        var found = false;
        for (var i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id) === nid) {
            list[i] = body.payload;
            found = true;
          }
        }
        if (!found) list.push(body.payload);
        next[field] = list;
      }
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
    }
    return { url: url, payload: body && body.payload, rev: body && body.rev };
  }

  async function openOrgPerson(personId, opts) {
    opts = opts || {};
    var pid = String(personId || "");
    var url = "/api/people/" + encodeURIComponent(pid);
    var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
    if (!getter || !pid) return { url: url };
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { url: url, status: res && res.status };
    var body = await res.json().catch(function () { return null; });
    var payload = body && body.payload ? body.payload : body;
    if (payload) {
      applyServerRows(function (local) {
        return mergeEntityPayload(local, { type: "people", id: pid }, body && body.payload ? body : { payload: payload }, {});
      });
    }
    return { url: url, payload: payload, rev: body && body.rev };
  }

  async function openOrgTrash(opts) {
    return openOrgSlice("trash", opts);
  }

  async function pullBooks(ids) {
    if (!ids || !ids.length) return null;
    var res = await doFetch("/api/company?books=" + ids.join(","), { credentials: "include" });
    if (!res.ok) return null;
    var body = await res.json().catch(function () {
      return null;
    });
    if (!body || !body.books) return null;
    lastPullMeta = { books: ids.slice(), at: Date.now(), bytes: JSON.stringify(body.books).length };
    if (body.bookGens) noteRemote({ bookGens: body.bookGens });
    return body;
  }

  async function pullLive(opts) {
    opts = opts || {};
    function blocked() {
      if (opts.skip) return true;
      var flag = opts.isBlocked;
      if (typeof flag === "function") return !!flag();
      return !!flag;
    }
    function remember() {
      if (typeof opts.remember === "function" && opts.remoteAt) opts.remember(opts.remoteAt);
    }
    if (blocked()) {
      remember();
      return { pulled: [], skipped: BOOK_IDS.slice(), blocked: true };
    }
    var local = typeof opts.getSnapshot === "function" ? opts.getSnapshot() : null;
    if (!isPlainObject(local)) return { pulled: [] };
    // Hashing every book is the costliest step of a live tick; it only
    // decides whether a changed non-row book (plans, settings…) may be pulled.
    var dirty = null;
    var dirtySet = null;
    var firstLocal = local;
    function isDirty(id) {
      if (!dirtySet) {
        dirty = dirtyBooks(firstLocal);
        dirtySet = {};
        dirty.forEach(function (d) {
          dirtySet[d] = 1;
        });
      }
      return !!dirtySet[id];
    }
    var slices = dirtySlices(local);
    if (opts.entities && Array.isArray(opts.entities)) {
      opts.entities.forEach(function (hint) {
        queueEntityHint(hint);
      });
    }
    var entityPull = await pullPendingEntities(local, slices, opts.getSnapshot);
    var entityFetched = entityPull.fetched || [];
    if (entityFetched.length) {
      local = entityPull.local;
      local.notebookUpdatedAt = Math.max(
        Number(local.notebookUpdatedAt) || 0,
        lastRemoteAt,
        Date.now(),
      );
      var tookEntities = true;
      if (typeof opts.apply === "function") tookEntities = opts.apply(local, "live-entity") !== false;
      if (tookEntities) runAcks(entityPull.acks);
      if (entityPull.types.people) lastGens.org = Math.max(Number(lastGens.org) || 0, Number(remoteGens.org) || 0);
      if (entityPull.types["reward-records"] || entityPull.types["month-records"] || entityPull.types.reward_records || entityPull.types.month_records) {
        lastGens.months = Math.max(Number(lastGens.months) || 0, Number(remoteGens.months) || 0);
      }
      if (entityPull.types["target-cells"] || entityPull.types.target_cells) {
        lastGens.targets = Math.max(Number(lastGens.targets) || 0, Number(remoteGens.targets) || 0);
      }
      lastPulledAt = Math.max(lastPulledAt, lastRemoteAt);
    }
    var skipCompanyFile = entityFetched.length > 0 || pendingEntities.length > 0 || lastTickHadEntities;
    lastTickHadEntities = false;
    // Home idle must not pull the company file. Empty view is NOT home
    // (unit tests and first-paint pullLive still hydrate clean books).
    if (uiView() === "home") skipCompanyFile = true;
    var localGens = Object.assign({}, lastGens, normalizeGens(local));
    var toPull = [];
    BOOK_IDS.forEach(function (id) {
      var remote = Number(remoteGens[id]) || 0;
      var mine = Number(localGens[id]) || 0;
      if (remote > mine) {
        if (id === "org" && (entityPull.types.people || skipCompanyFile)) return;
        if (id === "months" && (entityPull.types["reward-records"] || entityPull.types["month-records"] || entityPull.types.reward_records || entityPull.types.month_records || skipCompanyFile)) return;
        if (id === "targets" && (entityPull.types["target-cells"] || entityPull.types.target_cells || skipCompanyFile)) return;
        if (id === "org" || id === "months" || id === "targets" || !isDirty(id)) toPull.push(id);
      }
    });
    if (!toPull.length && lastRemoteAt > lastPulledAt && !lastTickHadGens && !entityFetched.length && !skipCompanyFile) {
      ["org", "months", "targets"].forEach(function (id) {
        if (toPull.indexOf(id) < 0) toPull.push(id);
      });
    }
    if (!toPull.length) {
      lastPulledAt = Math.max(lastPulledAt, lastRemoteAt);
      remember();
      return {
        pulled: [],
        entities: entityFetched,
        dirty: dirty || [],
        blocked: blocked(),
        rowConflicts: lastRowConflicts.slice(),
        banner: false,
        merged: entityFetched.length ? local : undefined,
      };
    }
    var pulled = await pullBooks(toPull);
    if (!pulled) return { pulled: [], error: "pull-failed", banner: false, rowConflicts: [] };
    if (blocked()) {
      remember();
      return { pulled: [], dirty: dirty || [], blocked: true, deferred: toPull, banner: false, rowConflicts: [] };
    }
    local = typeof opts.getSnapshot === "function" ? opts.getSnapshot() : local;
    dirty = dirtyBooks(local);
    dirtySet = {};
    dirty.forEach(function (id) {
      dirtySet[id] = 1;
    });
    var slices = dirtySlices(local);
    var merged = applyPulledBooks(local, pulled.books, dirtySet);
    if (C && typeof C.orderSiblings === "function") merged = C.orderSiblings(merged);
    var hits = collectRowConflicts(local, pulled.books, slices);
    lastRowConflicts = hits;
    if (pulled.bookGens) merged.bookGens = Object.assign({}, localGens, pulled.bookGens);
    if (pulled.notebookUpdatedAt) merged.notebookUpdatedAt = pulled.notebookUpdatedAt;
    var applied = true;
    if (typeof opts.apply === "function") {
      applied = opts.apply(merged, "live") !== false;
    }
    if (applied) {
      entityFieldsFromNextPull = false;
      var after = typeof opts.getSnapshot === "function" ? opts.getSnapshot() : merged;
      var afterBooks = splitSnapshot(after);
      toPull.forEach(function (id) {
        if (dirtySet[id] && id === "plans") return;
        if (dirtySet[id] && (id === "org" || id === "months" || id === "targets")) {
          if (pulled.bookGens && Number.isFinite(Number(pulled.bookGens[id]))) lastGens[id] = Number(pulled.bookGens[id]);
          return;
        }
        lastAcked[id] = bookPayload(afterBooks[id], id);
        lastHashes[id] = stableStringify(lastAcked[id]);
        if (pulled.bookGens && Number.isFinite(Number(pulled.bookGens[id]))) lastGens[id] = Number(pulled.bookGens[id]);
      });
      lastPulledAt = Math.max(lastPulledAt, lastRemoteAt, Number(pulled.notebookUpdatedAt) || 0);
    }
    return { pulled: toPull, dirty: dirty, merged: merged, rowConflicts: hits, banner: false };
  }

  function pathOf(input) {
    try {
      var href = typeof input === "string" ? input : input && input.url ? String(input.url) : "";
      return new URL(href, "http://apms.local").pathname;
    } catch (e) {
      return "";
    }
  }

  function isCompanyPost(path) {
    if (path === "/api/company") return true;
    if (path.indexOf(SAVE_FN) === 0) return true;
    return false;
  }

  function isRestorePost(parsed) {
    if (!isPlainObject(parsed)) return false;
    var inner = isPlainObject(parsed.data) ? parsed.data : parsed;
    return inner.restore === true || inner.allowEmpty === true || inner.adminRestore === true;
  }

  function wrapFetch(original) {
    return async function wrapped(input, init) {
      var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      var path = pathOf(input);
      if (method === "POST" && isCompanyPost(path)) {
        try {
          var rawBody = init && init.body;
          var parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
          if (isRestorePost(parsed)) {
            return original.apply(null, arguments);
          }
          var snap = extractSnapshot(parsed);
          if (snap && Array.isArray(snap.people)) {
            var ack = await save(snap);
            return new Response(JSON.stringify(ack), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }
        } catch (err) {
          /* refuse the full POST */
        }
        return new Response(
          JSON.stringify({
            ok: false,
            error: "gone",
            message: "Full snapshot POST is disabled. Use PATCH /api/company with baseGens.",
          }),
          { status: 410, headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
      var result;
      if (method === "GET" && path === "/api/company-tick") {
        if (lastTickBody && !tickDue()) {
          return new Response(lastTickBody, {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8", "x-apms-tick": "cached" },
          });
        }
        lastRealTickAt = Date.now();
      }
      if (method === "GET" && isCompanyFileGet(path)) {
        var href = typeof input === "string" ? input : (input && input.url) || "";
        if (String(href).indexOf("books=") < 0 && everLoaded) {
          return new Response(
            JSON.stringify({
              unchanged: true,
              snapshotJson: null,
              notebookUpdatedAt: lastWireAt,
              bookGens: lastGens,
              entities: [],
              personId: null,
              resets: [],
              bootstrap: false,
              forbidden: false,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
                etag: '"apms-' + lastWireAt + '"',
              },
            },
          );
        }
        if (String(href).indexOf("books=") < 0 && !everLoaded && typeof input === "string" && /[?&]at=/.test(input)) {
          // BATCH-3: no baseline yet (page load): ask for the whole file. An
          // "unchanged" answer (the SPA's cached copy looked current) left the
          // sync without a baseline, and the first save then took the screen —
          // with the edit just made (a new hire) — as already saved: the edit
          // was never sent. The full answer goes through noteLoaded below.
          input = input.replace(/([?&])at=[^&]*&?/, "$1").replace(/[?&]$/, "");
        }
        if (String(href).indexOf("books=") < 0 && lastWireAt) {
          init = Object.assign({}, init || {});
          var hdrs = Object.assign({}, init.headers || {});
          if (!hdrs["If-None-Match"] && !hdrs["if-none-match"]) {
            hdrs["If-None-Match"] = '"apms-' + lastWireAt + '"';
          }
          init.headers = hdrs;
        }
        result = await original.call(null, input, init);
      } else {
        result = await original.apply(null, arguments);
      }
      try {
        if (method === "GET" && isCompanyFileGet(path) && result && result.ok) {
          var url = typeof input === "string" ? input : (input && input.url) || "";
          if (String(url).indexOf("books=") < 0) {
            var clone = result.clone();
            var body = await clone.json();
            if (body && body.unchanged) {
              if (body.bookGens || body.entities) {
                noteRemote({
                  bookGens: body.bookGens,
                  at: body.notebookUpdatedAt,
                  entities: body.entities,
                });
              }
              if (Array.isArray(body.entities) && body.entities.length) handleLiveEvent(body);
              var uAt = Number(body.notebookUpdatedAt) || 0;
              if (uAt > lastWireAt) lastWireAt = uAt;
            } else {
              if (body && body.bookGens) noteRemote({ bookGens: body.bookGens });
              var loaded = null;
              if (body && body.snapshotJson) {
                try {
                  loaded =
                    typeof body.snapshotJson === "string" ? JSON.parse(body.snapshotJson) : body.snapshotJson;
                } catch (e2) {}
              } else if (body && Array.isArray(body.people)) {
                loaded = body;
              }
              if (loaded && loaded.bookGens) noteRemote({ bookGens: loaded.bookGens });
              if (loaded && loaded.snapshotJson) delete loaded.snapshotJson;
              if (body && body.snapshotJson) body.snapshotJson = null;
              if (loaded && Number(loaded.notebookUpdatedAt) > lastWireAt) {
                lastWireAt = Number(loaded.notebookUpdatedAt);
              }
              if (body && Number(body.notebookUpdatedAt) > lastWireAt) {
                lastWireAt = Number(body.notebookUpdatedAt);
              }
              if (loaded && !everLoaded) noteLoaded(loaded);
            }
          }
        }
        if (method === "GET" && path === "/api/company-tick" && result && result.ok) {
          var tick = await result.clone().json();
          rememberTick(tick);
          handleLiveEvent(tick);
        }
      } catch (err) {
        /* ignore hydrate-note failures */
      }
      return result;
    };
  }

  /**
   * BATCH-3: session ended elsewhere (admin password reset, own password
   * change in another browser, admin unlock/revoke). The next app API call
   * answers 401; confirm with get-session and, if this browser is signed out,
   * leave the app for the sign-in page (within seconds, not "keep working").
   */
  var sessionEnded = false;
  var sessionCheck = null;
  function isAppApiPath(path) {
    return /^\/(api|_serverFn)\//.test(String(path || "")) && !/^\/api\/(auth|password-reset)(\/|\?|$)/.test(String(path || ""));
  }
  function checkSessionEnded(original) {
    if (sessionEnded || sessionCheck || !everLoaded) return;
    sessionCheck = (async function () {
      try {
        var headers = {};
        try {
          var bearer = global.sessionStorage && global.sessionStorage.getItem("grok-auth.bearer-token");
          if (bearer) headers.Authorization = "Bearer " + bearer;
        } catch (e0) {}
        var r = await original("/api/auth/get-session", { credentials: "include", headers: headers });
        var j = r && r.ok ? await r.json().catch(function () { return null; }) : null;
        if (j && j.session) return;
        sessionEnded = true;
        try {
          global.sessionStorage.removeItem("grok-auth.bearer-token");
          global.sessionStorage.setItem("apms-signed-out-reason", "session-ended");
        } catch (e1) {}
        try {
          await original("/api/auth/sign-out", { method: "POST", credentials: "include" });
        } catch (e2) {}
        if (global.location && typeof global.location.assign === "function") global.location.assign("/");
      } catch (err) {
        /* network: try again on the next 401 */
      } finally {
        sessionCheck = null;
      }
    })();
  }
  function watchAuth(original) {
    return async function watched(input) {
      var res = await original.apply(null, arguments);
      try {
        if (res && res.status === 401 && isAppApiPath(pathOf(input))) checkSessionEnded(original);
      } catch (err) {}
      return res;
    };
  }

  function install(fetchImpl) {
    var original0 = fetchImpl || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (!original0) return api;
    var original = watchAuth(original0);
    rawFetch = original;
    if (typeof global.fetch === "function") {
      global.fetch = wrapFetch(original);
      installed = true;
    }
    return api;
  }

  function resetForTests() {
    knownRowKeys = {};
    remoteDeletedKeys = {};
    screenEntry = { key: "", at: 0, fromLoad: true, hadRecord: false };
    screenEntries = [];
    staleReadds = {};
    ghostRecords = {};
    supersededRows = {};
    restoreRows = {};
    replayFeedOnHooks = false;
    entityFieldsFromNextPull = false;
    liveSeq = 0;
    lastChangesAt = 0;
    announcedSeq = 0;
    pollIssuedSeq = 0;
    lastPushAt = 0;
    lastRealTickAt = 0;
    lastTickBody = null;
    screenEtags = {};
    if (pushWaitTimer) {
      clearTimeout(pushWaitTimer);
      pushWaitTimer = null;
    }
    changesInFlight = null;
    lastMergeTrace = [];
    pendingAcks = [];
    C = global.__apmsCollections || null;
    lastHashes = emptyBooks("");
    lastGens = emptyBooks(0);
    lastAcked = emptyBooks(null);
    remoteGens = emptyBooks(0);
    lastRemoteAt = 0;
    lastPulledAt = 0;
    lastSaveMeta = null;
    lastPullMeta = null;
    saveQueues = emptyBooks(Promise.resolve());
    entityRevs = {};
    everLoaded = false;
    lastRowConflicts = [];
    dismissedConflicts = {};
    lastWireAt = 0;
    lastTickHadGens = false;
    lastRemoteAt = 0;
    lastPulledAt = 0;
    pendingEntities = [];
    seenEntityKeys = {};
    lastTickHadEntities = false;
    lastLiveTrace = { tick: null, urls: [] };
    lastScreenKey = "";
    lastPeopleFetchAt = 0;
    lastRewardsFetchAt = 0;
    lastApmsMonthFetchAt = 0;
    lastApmsPersonFetchAt = 0;
    lastApmsPersonKey = "";
    fetchingHints = {};
    peekCache = null;
    peekState = null;
    liveWatchStarted = false;
    if (screenReadTimer) {
      clearInterval(screenReadTimer);
      screenReadTimer = null;
    }
    if (liveTickTimer) {
      clearInterval(liveTickTimer);
      liveTickTimer = null;
    }
    if (liveSource) {
      try {
        liveSource.close();
      } catch (err) {}
      liveSource = null;
    }
    liveHooks = null;
    if (livePullTimer) {
      clearTimeout(livePullTimer);
      livePullTimer = null;
    }
  }

  /** Data fields the UI store should take from a live/merged snapshot (ROWS-V2 stamp uses this). */
  function pickDataFields(snap) {
    var out = {};
    if (!C || !isPlainObject(snap)) return out;
    C.FIELDS.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(snap, field)) out[field] = snap[field];
    });
    return out;
  }

  var api = {
    pickDataFields: pickDataFields,
    merge3: merge3,
    collectEntityOps: collectEntityOps,
    mergeGenericRow: mergeGenericRow,
    mergeHotRow: mergeHotRow,
    /** Read-only diagnostics: what the next save would send for the screen as it is now. */
    /** Read-only diagnostics: is the UI refusing live applies right now (SPA dirty/saving)? */
    /** Read-only diagnostics: the last change-feed polls (time, cursor, rows, refused). */
    feedLog: function () {
      return feedLog.slice();
    },
    liveBlocked: function () {
      try {
        return liveHooks && typeof liveHooks.isBlocked === "function" ? !!liveHooks.isBlocked() : null;
      } catch (err) {
        return null;
      }
    },
    /** Read-only diagnostics: the screens this page went through (stale re-add rule). */
    screenEntries: function () {
      return screenEntries.slice();
    },
    pendingOps: function () {
      var local = liveHooks && typeof liveHooks.getSnapshot === "function" ? liveHooks.getSnapshot() : null;
      if (!local) return null;
      return collectEntityOps(stripUi(local)).map(function (op) {
        return { url: op.url, deleted: !!op.deleted, payload: op.payload, acked: ackedSlice(op) };
      });
    },
    pollChanges: pollChanges,
    restorePull: restorePull,
    restoreLog: function () {
      return restoreLog.slice();
    },
    commitPendingAcks: commitPendingAcks,
    liveSeq: function () { return liveSeq; },
    setLiveSeq: function (n) { liveSeq = Number(n) || 0; lastChangesAt = 0; },
    entityRevs: function () { return entityRevs; },
    mergeTrace: function () { return lastMergeTrace.slice(); },
    lastAckedBooks: function () { return lastAcked; },
    BOOK_IDS: BOOK_IDS,
    LIVE_ENTITY_CAP: LIVE_ENTITY_CAP,
    BOOK_FIELDS: BOOK_FIELDS,
    splitSnapshot: splitSnapshot,
    bookPayload: bookPayload,
    hashBook: hashBook,
    dirtyBooks: dirtyBooks,
    buildPatch: buildPatch,
    rebaseBook: rebaseBook,
    overlappingPersonMonths: overlappingPersonMonths,
    mergeKeepPeopleClient: mergeKeepPeopleClient,
    mergeEntityPayload: mergeEntityPayload,
    collectEntityOps: collectEntityOps,
    applyPulledBooks: applyPulledBooks,
    extractSnapshot: extractSnapshot,
    noteLoaded: noteLoaded,
    noteRemote: noteRemote,
    handleLiveEvent: handleLiveEvent,
    entityUrl: entityUrl,
    lastLiveTrace: function () {
      return lastLiveTrace;
    },
    openPeopleScreen: openPeopleScreen,
    openRewardsMonth: openRewardsMonth,
    openApmsMonth: openApmsMonth,
    openApmsPerson: openApmsPerson,
    isApmsView: isApmsView,
    isOrgView: isOrgView,
    openOrgSlice: openOrgSlice,
    openOrgNode: openOrgNode,
    openOrgPerson: openOrgPerson,
    openOrgTrash: openOrgTrash,
    maybeScreenRead: maybeScreenRead,
    startLiveWatch: startLiveWatch,
    uiView: uiView,
    setLiveHooks: setLiveHooks,
    save: save,
    massPatch: massPatch,
    pullLive: pullLive,
    pullBooks: pullBooks,
    install: install,
    resetForTests: resetForTests,
    lastSave: function () {
      return lastSaveMeta;
    },
    lastPull: function () {
      return lastPullMeta;
    },
    gens: function () {
      return { local: Object.assign({}, lastGens), remote: Object.assign({}, remoteGens) };
    },
    rowConflicts: function () {
      return lastRowConflicts.slice();
    },
    dismissRowConflict: function (period, personId) {
      if (period && personId) dismissedConflicts[period + "\0" + personId] = 1;
      lastRowConflicts = lastRowConflicts.filter(function (hit) {
        return !(hit.period === period && hit.personId === personId);
      });
    },
    showGlobalConflictBar: function () {
      return false;
    },
  };

  global.__apmsSync = api;
  if (typeof document !== "undefined" && typeof global.fetch === "function") {
    install(global.fetch.bind(global));
    startScreenReadWatch();
    startLiveWatch();
  }
})(typeof window !== "undefined" ? window : globalThis);
