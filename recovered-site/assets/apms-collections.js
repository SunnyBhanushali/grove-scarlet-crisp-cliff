/**
 * Aliens APMS — collection spec shared by server and client sync.
 *
 * Every snapshot field that is not already a hot table (people / records /
 * rewardRecords / targetCells) is described here so it can live as rows in the
 * generic `entities` table with per-row `rev` (compare-and-set OCC).
 *
 * Plain script on purpose: the server imports it as a module (allowJs), the
 * browser loads it as a classic <script> and reads `globalThis.__apmsCollections`.
 *
 * shape:
 *   list    — array of objects; row id = key(row) (default row.id)
 *   map     — object keyed by id; row payload = value (non-object values wrap as {value})
 *   map2    — object keyed by outer id, then inner id; row = (k1=outer, k2=inner)
 *   scalar  — the whole field is one row (id = field name, payload = {value})
 */
(function (g) {
  "use strict";

  function pick(field, kind, shape, book, extra) {
    var spec = { field: field, kind: kind, shape: shape, book: book };
    if (extra) for (var k in extra) spec[k] = extra[k];
    return spec;
  }

  var SPECS = [
    // ---- org book -----------------------------------------------------------
    pick("companies", "companies", "list", "org"),
    pick("brands", "brands", "list", "org"),
    pick("businessUnits", "sbus", "list", "org"),
    pick("sbuMembers", "sbu-members", "list", "org", { keyFields: ["groupId", "memberId"] }),
    pick("functions", "functions", "list", "org"),
    pick("subFunctions", "sub-functions", "list", "org"),
    pick("roles", "roles", "map", "org"),
    pick("accessRoles", "access-roles", "list", "org"),
    pick("customReports", "custom-reports", "list", "org"),
    pick("reportFolders", "report-folders", "list", "org"),
    pick("notices", "notices", "list", "org"),
    pick("appRequests", "app-requests", "list", "org"),
    pick("roleCases", "role-cases", "list", "org"),
    pick("trash", "trash", "list", "org"),
    pick("logins", "logins", "map", "org"),
    pick("dismissedAlertIds", "settings", "scalar", "org"),
    pick("setupDone", "settings", "scalar", "org"),
    pick("companyFactor", "settings", "scalar", "org"),
    pick("pendingRoleDeletes", "settings", "scalar", "org"),
    pick("months", "settings", "scalar", "org"),
    pick("seedGeneration", "settings", "scalar", "org"),
    // ---- plans book ---------------------------------------------------------
    pick("valuesCatalog", "values-catalog", "list", "plans"),
    pick("kpiMaster", "kpi-master", "list", "plans"),
    pick("apmsPlans", "apms-plans", "map", "plans"),
    pick("awardInstances", "award-instances", "list", "plans"),
    pick("awardMeasures", "award-measures", "list", "plans"),
    pick("awardPrizeCatalog", "award-prizes", "list", "plans"),
    pick("gateUnits", "gate-units", "map", "plans"),
    pick("roleKrocs", "role-krocs", "map", "plans"),
    pick("awardBandShares", "settings", "scalar", "plans"),
    pick("rewardYearSeed", "settings", "scalar", "plans"),
    // ---- months book --------------------------------------------------------
    pick("apmsMonths", "apms-months", "list", "months", { keyFields: ["planId", "month"] }),
    pick("roleMonths", "role-months", "map2", "months"),
    pick("rewardRoleMonths", "reward-role-months", "map2", "months"),
    pick("agsMonths", "ags-months", "map2", "months"),
    pick("agsReviews", "ags-reviews", "list", "months"),
    pick("periodReviews", "period-reviews", "map", "months"),
    pick("gateMonths", "gate-months", "map2", "months"),
    // ---- targets book -------------------------------------------------------
    pick("sbuTargets", "sbu-targets", "map", "targets"),
    pick("targetHistory", "target-history", "list", "targets"),
    pick("targetNodes", "target-nodes", "map", "targets"),
    pick("targetMembers", "target-members", "list", "targets", { keyFields: ["groupId", "memberId", "month"] }),
    pick("targetMonthStatus", "target-month-status", "map", "targets"),
    pick("targetRootOrder", "target-root-order", "map", "targets"),
  ];

  var BY_FIELD = {};
  var BY_KIND = {};
  SPECS.forEach(function (s) {
    BY_FIELD[s.field] = s;
    if (s.kind !== "settings") BY_KIND[s.kind] = s;
  });

  var SEP = "\u001f";

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function rowKey(spec, row, fallbackIndex) {
    if (!isPlainObject(row)) return null;
    if (spec.keyFields) {
      var parts = [];
      for (var i = 0; i < spec.keyFields.length; i++) {
        var v = row[spec.keyFields[i]];
        if (v === undefined || v === null || v === "") return null;
        parts.push(String(v));
      }
      return parts.join(SEP);
    }
    if (row.id !== undefined && row.id !== null && row.id !== "") return String(row.id);
    return fallbackIndex !== undefined ? "i" + fallbackIndex : null;
  }

  function wrap(value) {
    return isPlainObject(value) ? value : { value: value };
  }

  function unwrap(payload) {
    if (isPlainObject(payload) && Object.keys(payload).length === 1 && "value" in payload) return payload.value;
    return payload;
  }

  /**
   * Flatten one snapshot field into rows: [{ kind, id, k1, k2, payload }].
   * Rows that cannot be keyed are skipped (and reported via `skipped`).
   */
  function toRows(spec, value, skipped) {
    var rows = [];
    if (spec.shape === "scalar") {
      if (value === undefined) return rows;
      rows.push({ kind: spec.kind, id: spec.field, k1: spec.field, k2: null, payload: { value: value } });
      return rows;
    }
    if (spec.shape === "list") {
      if (!Array.isArray(value)) return rows;
      value.forEach(function (row, i) {
        var id = rowKey(spec, row, i);
        if (!id) {
          if (skipped) skipped.push({ field: spec.field, index: i });
          return;
        }
        rows.push({ kind: spec.kind, id: id, k1: id, k2: null, payload: row });
      });
      return rows;
    }
    if (spec.shape === "map") {
      if (!isPlainObject(value)) return rows;
      Object.keys(value).forEach(function (id) {
        rows.push({ kind: spec.kind, id: id, k1: id, k2: null, payload: wrap(value[id]) });
      });
      return rows;
    }
    if (spec.shape === "map2") {
      if (!isPlainObject(value)) return rows;
      Object.keys(value).forEach(function (outer) {
        var inner = value[outer];
        if (!isPlainObject(inner)) return;
        Object.keys(inner).forEach(function (innerId) {
          rows.push({
            kind: spec.kind,
            id: outer + SEP + innerId,
            k1: outer,
            k2: innerId,
            payload: wrap(inner[innerId]),
          });
        });
      });
      return rows;
    }
    return rows;
  }

  /** Rebuild the snapshot field from rows (live rows only). */
  function fromRows(spec, rows) {
    if (spec.shape === "scalar") {
      var found = null;
      rows.forEach(function (r) {
        if (r.id === spec.field) found = r;
      });
      return found ? found.payload.value : undefined;
    }
    if (spec.shape === "list") {
      var list = [];
      rows.forEach(function (r) {
        list.push(r.payload);
      });
      // Keep a stable order: by explicit `order`/`sort` if present, else by insertion
      return list;
    }
    if (spec.shape === "map") {
      var map = {};
      rows.forEach(function (r) {
        map[r.id] = unwrap(r.payload);
      });
      return map;
    }
    if (spec.shape === "map2") {
      var tree = {};
      rows.forEach(function (r) {
        var outer = r.k1 !== undefined && r.k1 !== null ? r.k1 : String(r.id).split(SEP)[0];
        var innerId = r.k2 !== undefined && r.k2 !== null ? r.k2 : String(r.id).split(SEP)[1];
        if (!tree[outer]) tree[outer] = {};
        tree[outer][innerId] = unwrap(r.payload);
      });
      return tree;
    }
    return undefined;
  }

  /** Apply one row change to a snapshot field in place (returns new field value). */
  function applyRow(spec, current, row, deleted) {
    if (spec.shape === "scalar") {
      return deleted ? undefined : row.payload.value;
    }
    if (spec.shape === "list") {
      var list = Array.isArray(current) ? current.slice() : [];
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (rowKey(spec, list[i], i) === row.id) {
          idx = i;
          break;
        }
      }
      if (deleted) {
        if (idx >= 0) list.splice(idx, 1);
      } else if (idx >= 0) list[idx] = row.payload;
      else list.push(row.payload);
      return list;
    }
    if (spec.shape === "map") {
      var map = isPlainObject(current) ? Object.assign({}, current) : {};
      if (deleted) delete map[row.id];
      else map[row.id] = unwrap(row.payload);
      return map;
    }
    if (spec.shape === "map2") {
      var tree = isPlainObject(current) ? Object.assign({}, current) : {};
      var outer = row.k1 !== undefined && row.k1 !== null ? row.k1 : String(row.id).split(SEP)[0];
      var innerId = row.k2 !== undefined && row.k2 !== null ? row.k2 : String(row.id).split(SEP)[1];
      var inner = isPlainObject(tree[outer]) ? Object.assign({}, tree[outer]) : {};
      if (deleted) {
        delete inner[innerId];
        if (Object.keys(inner).length) tree[outer] = inner;
        else delete tree[outer];
      } else {
        inner[innerId] = unwrap(row.payload);
        tree[outer] = inner;
      }
      return tree;
    }
    return current;
  }

  /** URL id for a row: k1 and optional k2, each URI-encoded, joined by "/". */
  function rowPath(row) {
    var p = "/api/e/" + encodeURIComponent(row.kind) + "/" + encodeURIComponent(row.k1 !== undefined && row.k1 !== null ? row.k1 : row.id);
    if (row.k2 !== undefined && row.k2 !== null) p += "/" + encodeURIComponent(row.k2);
    return p;
  }

  function specForField(field) {
    return BY_FIELD[field] || null;
  }

  function specForKind(kind) {
    return BY_KIND[kind] || null;
  }

  function settingsSpec(field) {
    var s = BY_FIELD[field];
    return s && s.kind === "settings" ? s : null;
  }

  var api = {
    SPECS: SPECS,
    SEP: SEP,
    FIELDS: SPECS.map(function (s) {
      return s.field;
    }),
    KINDS: Object.keys(BY_KIND),
    specForField: specForField,
    specForKind: specForKind,
    settingsSpec: settingsSpec,
    rowKey: rowKey,
    toRows: toRows,
    fromRows: fromRows,
    applyRow: applyRow,
    rowPath: rowPath,
    wrap: wrap,
    unwrap: unwrap,
  };

  g.__apmsCollections = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
