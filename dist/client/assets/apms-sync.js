/**
 * Aliens APMS per-book sync (Google Docs / Zoho grade).
 * PATCH only dirty books with baseGen. 409 rebases that book. Live pulls
 * only clean books whose generation moved. UI nav never rides the wire.
 * Stamp: p0as77 — MOD-APMS fetch-on-access month-records. p0as76 ARMY-2. p0as75 ARMY. p0as74 MOD-ORG. p0as73 APMS. p0as72 routes. p0as69 G9. p0as60.
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
    var at = Number(snapshot.notebookUpdatedAt) || 0;
    if (at > lastWireAt) lastWireAt = at;
    lastScreenKey = "";
    lastPeopleFetchAt = 0;
    lastRewardsFetchAt = 0;
    lastApmsMonthFetchAt = 0;
    lastApmsPersonFetchAt = 0;
    lastApmsPersonKey = "";
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

  function uiView() {
    try {
      var nav = global.__apmsNavUi && typeof global.__apmsNavUi.loadSession === "function" ? global.__apmsNavUi.loadSession() : null;
      if (nav && nav.view) return String(nav.view);
    } catch (err) {}
    if (liveHooks && typeof liveHooks.getSnapshot === "function") {
      var snap = liveHooks.getSnapshot();
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
      var snap = liveHooks.getSnapshot();
      if (snap) return String(snap.currentMonth || snap.selectedMonth || "");
    }
    return "";
  }

  function uiPerson() {
    try {
      var nav = global.__apmsNavUi && typeof global.__apmsNavUi.loadSession === "function" ? global.__apmsNavUi.loadSession() : null;
      if (nav && nav.selectedPersonId) return String(nav.selectedPersonId);
    } catch (err) {}
    return apmsPersonId(liveHooks && liveHooks.getSnapshot ? liveHooks.getSnapshot() : null);
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
    var snap = liveHooks && typeof liveHooks.getSnapshot === "function" ? liveHooks.getSnapshot() : null;
    var view = uiView();
    if (!view && snap && snap.view) view = String(snap.view);
    var month = uiMonth() || (snap ? String(snap.currentMonth || snap.selectedMonth || "") : "");
    var person = uiPerson() || apmsPersonId(snap);
    var orgKind = orgKindForView(view);
    var orgId = orgSelectedId(snap, orgKind);
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
      if (pkey === lastScreenKey && nowP - lastPeopleFetchAt < 2000) return;
      lastScreenKey = pkey;
      lastPeopleFetchAt = nowP;
      openPeopleScreen({ limit: 80, q: q }).catch(function () {});
      return;
    }
    if (view === "rewards") {
      if (!everLoaded || !month) return;
      var rkey = "rewards\0" + month;
      var nowR = Date.now();
      if (rkey === lastScreenKey && nowR - lastRewardsFetchAt < 2000) return;
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
      if (!(akey === lastScreenKey && nowA - lastApmsMonthFetchAt < 2000)) {
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
    if (pkey === lastApmsPersonKey && nowP - lastApmsPersonFetchAt < 2000) return;
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
    startScreenReadWatch();
    startLiveWatch();
    if (liveHooks && (pendingEntities.length > 0 || lastRemoteAt > lastPulledAt)) {
      scheduleLivePull();
    }
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
            var next = mergeEntityPayload(local, hint, body, {});
            if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
            lastPulledAt = Math.max(lastPulledAt, Number(hint.at) || lastRemoteAt || Date.now());
          }
          return body;
        });
      })
      .catch(function () {
        delete fetchingHints[key];
      });
  }

  function startLiveWatch() {
    if (typeof document === "undefined") return;
    if (liveWatchStarted) return;
    liveWatchStarted = true;
    try {
      if (typeof EventSource === "function") {
        liveSource = new EventSource("/api/company-live", { withCredentials: true });
        liveSource.onmessage = function (ev) {
          try {
            var data = JSON.parse(ev.data);
            handleLiveEvent(data);
          } catch (err) {}
        };
      }
    } catch (err) {}
    if (liveTickTimer) return;
    liveTickTimer = setInterval(function () {
      var getter = rawFetch || (typeof fetch === "function" ? fetch : null);
      if (!getter) return;
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
          if (tick) handleLiveEvent(tick);
        })
        .catch(function () {});
    }, 2500);
    if (liveTickTimer && typeof liveTickTimer.unref === "function") liveTickTimer.unref();
  }

  function handleLiveEvent(tick) {
    if (!tick || typeof tick !== "object") return { queued: 0, shouldPull: false, at: 0 };
    var at = Number(tick.at || tick.notebookUpdatedAt) || 0;
    var ents = Array.isArray(tick.entities) ? tick.entities : [];
    var urls = [];
    var fresh = [];
    for (var ei = 0; ei < ents.length; ei++) {
      var h = ents[ei];
      var url = entityUrl(h);
      urls.push({ hint: h, url: url });
      if (!h || !h.type || !h.id) continue;
      // Do NOT drop hat <= lastPulledAt. Live via=init: wrapFetch handleLiveEvent
      // ran before routes setLiveHooks, so scheduleLivePull no-op'd and entityGets=0.
      // GET the row now even without liveHooks.
      fetchHintNow(h);
      fresh.push(h);
    }
    if (fresh.length > LIVE_ENTITY_CAP) fresh = fresh.slice(-LIVE_ENTITY_CAP);
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
    if (seenEntityKeys[key]) return;
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
    return "";
  }

  function mergeEntityPayload(local, hint, body, slices) {
    var out = Object.assign({}, local);
    var payload = isPlainObject(body && body.payload) ? body.payload : {};
    var t = normEntityType(hint.type);
    if (t === "people") {
      if (body && body.deleted) {
        out.people = (Array.isArray(out.people) ? out.people : []).filter(function (row) {
          return !row || String(row.id) !== hint.id;
        });
      } else {
        var row = Object.assign({}, payload, { id: hint.id });
        out.people = mergeKeepPeopleClient(out.people, [row]);
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
        if (!dismissedConflicts[dismissKey]) {
          lastRowConflicts = lastRowConflicts.concat([{ field: field, period: period, personId: pid }]);
        }
        return out;
      }
      var tree = {};
      tree[period] = {};
      if (body && body.deleted) {
        /* missing key is not a delete of other people; drop this one slice */
        var next = mergeKeepMonthMapsClient(out[field], {});
        if (isPlainObject(next[period])) {
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

  async function pullPendingEntities(local, slices) {
    if (!pendingEntities.length) return { local: local, fetched: [], types: {} };
    var batch = pendingEntities.slice(0, LIVE_ENTITY_CAP);
    pendingEntities = pendingEntities.slice(LIVE_ENTITY_CAP);
    var fetched = [];
    var types = {};
    var out = local;
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
        out = mergeEntityPayload(out, hint, body, slices);
      } catch (err) {
        pendingEntities.push(hint);
      }
    }
    return { local: out, fetched: fetched, types: types };
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

  function markAckedFromSnap(snapshot, ids) {
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

  function applyPulledBooks(local, books, skip) {
    var out = Object.assign({}, local);
    var skipSet = skip || {};
    var slices = dirtySlices(local);
    BOOK_IDS.forEach(function (id) {
      if (skipSet[id] && id === "plans") return;
      var book = books && books[id];
      if (!isPlainObject(book)) return;
      BOOK_FIELDS[id].forEach(function (field) {
        if (!(field in book)) return;
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
          split[cid] = rebaseBook(cid, split[cid], serverBook);
          lastAcked[cid] = bookPayload(serverBook, cid);
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
    Object.keys(nextPeople).forEach(function (id) {
      if (!eq(nextPeople[id], prevPeople[id])) {
        ops.push({
          kind: "people",
          url: "/api/people/" + encodeURIComponent(id),
          payload: nextPeople[id],
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
        if (eq(rec, before)) return;
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
    function diffOrgList(field, kind, path) {
      var prev = rowsById((lastAcked.org && lastAcked.org[field]) || []);
      var next = rowsById(snap[field]);
      Object.keys(next).forEach(function (id) {
        if (eq(next[id], prev[id])) return;
        ops.push({
          kind: "org-" + kind,
          url: path + encodeURIComponent(id),
          payload: next[id],
          deleted: false,
          revKey: entityRevKey("org-" + kind, id),
          orgField: field,
        });
      });
      Object.keys(prev).forEach(function (id) {
        if (next[id]) return;
        ops.push({
          kind: "org-" + kind,
          url: path + encodeURIComponent(id),
          payload: prev[id],
          deleted: true,
          revKey: entityRevKey("org-" + kind, id),
          orgField: field,
        });
      });
    }
    function rowsById(value) {
      var map = {};
      if (Array.isArray(value)) {
        value.forEach(function (row) {
          if (isPlainObject(row) && row.id) map[String(row.id)] = row;
        });
      } else if (isPlainObject(value)) {
        Object.keys(value).forEach(function (id) {
          var row = value[id];
          if (isPlainObject(row)) map[String(row.id || id)] = row;
        });
      }
      return map;
    }
    diffOrgList("companies", "companies", "/api/org/companies/");
    diffOrgList("brands", "brands", "/api/org/brands/");
    diffOrgList("businessUnits", "sbus", "/api/org/sbus/");
    diffOrgList("functions", "functions", "/api/org/functions/");
    diffOrgList("subFunctions", "subFunctions", "/api/org/subFunctions/");
    diffOrgList("roles", "roles", "/api/org/roles/");
    return ops;
  }

  function ackedSlice(op) {
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

  async function saveOneEntity(op, snap) {
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
        if (result.json.bookGens) noteAck({ bookGens: result.json.bookGens }, BOOK_IDS);
        return { ok: true, json: result.json, op: op };
      }
      if (result.status === 409 && result.json) {
        var serverRev = Number(result.json.rev);
        var serverPayload = result.json.payload;
        if (!known && Number.isFinite(serverRev) && eq(serverPayload, ackedSlice(op))) {
          entityRevs[op.revKey] = serverRev;
          known = true;
          baseRev = serverRev;
          continue;
        }
        if (Number.isFinite(serverRev) && serverRev !== baseRev) {
          entityRevs[op.revKey] = serverRev;
          known = true;
          baseRev = serverRev;
          continue;
        }
        entityRevs[op.revKey] = Number.isFinite(serverRev) ? serverRev : baseRev;
        return { ok: true, json: result.json || { ok: true, rev: baseRev }, op: op, adopted: true };
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
  }

  async function saveEntities(snap) {
    var ops = collectEntityOps(snap);
    if (!ops.length) return { ok: true, applied: [], ops: [] };
    var results = await Promise.all(ops.map(function (op) { return saveOneEntity(op, snap); }));
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
    markEntityFieldsAcked(snap, ops);
    lastSaveMeta = {
      via: "ENTITY",
      bytes: 0,
      books: ops.map(function (op) { return op.kind; }),
      at: Date.now(),
      applied: ops.map(function (op) { return op.url; }),
    };
    return { ok: true, applied: ops.map(function (op) { return op.url; }), ops: ops };
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
    dirty = dirtyBooks(snap);
    if (!dirty.length) {
      lastSaveMeta = {
        via: entityAck && entityAck.ops && entityAck.ops.length ? "ENTITY" : "SKIP",
        bytes: 0,
        books: entityAck && entityAck.applied ? entityAck.applied : [],
        at: Date.now(),
        applied: entityAck && entityAck.applied ? entityAck.applied : [],
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
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { people: [], url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var people = body && Array.isArray(body.people) ? body.people : [];
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && people.length) {
      var next = Object.assign({}, local);
      next.people = mergeKeepPeopleClient(local.people, people);
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
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
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { records: [], url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var records = body && Array.isArray(body.records) ? body.records : [];
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && records.length) {
      var tree = {};
      tree[month] = {};
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!rec || !rec.personId) continue;
        tree[month][rec.personId] = rec.payload || rec;
      }
      var next = Object.assign({}, local);
      next.rewardRecords = mergeKeepMonthMapsClient(local.rewardRecords, tree);
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
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
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { records: [], url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var records = body && Array.isArray(body.records) ? body.records : [];
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && records.length) {
      var tree = {};
      tree[month] = {};
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!rec || !rec.personId) continue;
        tree[month][rec.personId] = rec.payload || rec;
      }
      var next = Object.assign({}, local);
      next.records = mergeKeepMonthMapsClient(local.records, tree);
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
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
    var res = await getter(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
    if (!res || !res.ok) return { payload: null, url: url, status: res && res.status };
    var body = await res.json().catch(function () {
      return null;
    });
    var payload = body && body.payload ? body.payload : body;
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && payload) {
      var next = mergeEntityPayload(local, { type: "month-records", id: pid, period: month }, body || { payload: payload }, {});
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
    }
    if (typeof opts.apply === "function") opts.apply(payload, body);
    return { payload: payload, url: url, rev: body && body.rev };
  }

  function applyOrgFields(local, body) {
    var next = Object.assign({}, local);
    ["companies", "brands", "businessUnits", "functions", "subFunctions", "roles", "sbuMembers", "trash"].forEach(function (field) {
      if (body && body[field] !== undefined) next[field] = body[field];
    });
    if (body && Array.isArray(body.people)) next.people = mergeKeepPeopleClient(local.people, body.people);
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
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && body) {
      var next = applyOrgFields(local, body);
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
    }
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
    var hooks = liveHooks;
    var local = hooks && typeof hooks.getSnapshot === "function" ? hooks.getSnapshot() : null;
    if (local && payload) {
      var next = mergeEntityPayload(local, { type: "people", id: pid }, body || { payload: payload }, {});
      if (hooks && typeof hooks.apply === "function") hooks.apply(next, "live-entity");
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
    var dirty = dirtyBooks(local);
    var dirtySet = {};
    dirty.forEach(function (id) {
      dirtySet[id] = 1;
    });
    var slices = dirtySlices(local);
    if (opts.entities && Array.isArray(opts.entities)) {
      opts.entities.forEach(function (hint) {
        queueEntityHint(hint);
      });
    }
    var entityPull = await pullPendingEntities(local, slices);
    var entityFetched = entityPull.fetched || [];
    if (entityFetched.length) {
      local = entityPull.local;
      local.notebookUpdatedAt = Math.max(
        Number(local.notebookUpdatedAt) || 0,
        lastRemoteAt,
        Date.now(),
      );
      if (typeof opts.apply === "function") opts.apply(local, "live-entity");
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
        if (!dirtySet[id] || id === "org" || id === "months" || id === "targets") toPull.push(id);
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
        dirty: dirty,
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
      return { pulled: [], dirty: dirty, blocked: true, deferred: toPull, banner: false, rowConflicts: [] };
    }
    local = typeof opts.getSnapshot === "function" ? opts.getSnapshot() : local;
    dirty = dirtyBooks(local);
    dirtySet = {};
    dirty.forEach(function (id) {
      dirtySet[id] = 1;
    });
    var slices = dirtySlices(local);
    var merged = applyPulledBooks(local, pulled.books, dirtySet);
    var hits = collectRowConflicts(local, pulled.books, slices);
    lastRowConflicts = hits;
    if (pulled.bookGens) merged.bookGens = Object.assign({}, localGens, pulled.bookGens);
    if (pulled.notebookUpdatedAt) merged.notebookUpdatedAt = pulled.notebookUpdatedAt;
    var applied = true;
    if (typeof opts.apply === "function") {
      applied = opts.apply(merged, "live") !== false;
    }
    if (applied) {
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
          handleLiveEvent(tick);
        }
      } catch (err) {
        /* ignore hydrate-note failures */
      }
      return result;
    };
  }

  function install(fetchImpl) {
    var original = fetchImpl || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (!original) return api;
    rawFetch = original;
    if (typeof global.fetch === "function") {
      global.fetch = wrapFetch(original);
      installed = true;
    }
    return api;
  }

  function resetForTests() {
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

  var api = {
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
