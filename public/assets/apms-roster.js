/**
 * Aliens APMS Roster R1. HR/admin month assignments.
 * People identity stays on /api/people. Overlay cache: window.__apmsRoster.
 */
(function (global) {
  "use strict";
  if (global.__apmsRosterUi) return;

  var STYLE_ID = "apms-roster-css";
  var BANNER_ID = "apms-roster-missing";
  var HOST_ID = "apms-roster-root";
  var cache = { period: "", byPerson: {}, loaded: false, setCount: 0, status: "", rev: 0, kind: "", subject: "", rosterId: "" };
  var state = {
    period: "",
    data: null,
    drafts: {},
    saving: false,
    msg: "",
    err: "",
    q: "",
  };

  function ym(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function shift(period, delta) {
    var p = String(period || "").split("-").map(Number);
    if (!p[0] || !p[1]) return period;
    var d = new Date(p[0], p[1] - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function labelMonth(period) {
    var p = String(period || "").split("-").map(Number);
    if (!p[0] || !p[1]) return period;
    return new Date(p[0], p[1] - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
  }
  function session() {
    try {
      return JSON.parse(sessionStorage.getItem("apms-ui-session-v1") || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function sessionMonth() {
    var s = session();
    return s.currentMonth || s.selectedMonth || ym();
  }
  function sessionView() {
    return String(session().view || "");
  }
  function cred() {
    return { credentials: "include", headers: { accept: "application/json" } };
  }
  function byId(list, id) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function nameOf(list, id) {
    var row = byId(list, id);
    return row ? row.name || id : id || "—";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;");
  }

  function setCache(period, body) {
    var byPerson = {};
    var rows = (body && body.assignments) || [];
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      if (!a || !a.personId) continue;
      if (a.line && a.line !== "solid") continue;
      if (!byPerson[a.personId]) byPerson[a.personId] = a;
    }
    cache = {
      period: period,
      byPerson: byPerson,
      loaded: true,
      setCount: Object.keys(byPerson).length,
      status: (body && body.status) || "",
      rev: (body && body.rev) || 0,
      kind: (body && body.kind) || cache.kind || "",
      subject: (body && body.subjectId) || cache.subject || period,
      rosterId: (body && body.rosterId) || period,
    };
    global.__apmsRoster = cache;
    paintBanner();
  }

  function paintBanner() {
    var view = sessionView();
    var orgLike = view === "org" || view.indexOf("org-") === 0 || view === "rewards" || view.indexOf("rewards") === 0 || view === "apms" || view.indexOf("apms") === 0 || view.indexOf("award") === 0;
    var el = document.getElementById(BANNER_ID);
    var msg = "";
    if (orgLike && cache.loaded && cache.setCount < 1) msg = "Roster not set for this month.";
    else if (orgLike && cache.loaded && cache.rosterId && cache.subject && cache.rosterId !== cache.subject && (view.indexOf("rewards") === 0 || view.indexOf("apms") === 0 || view.indexOf("award") === 0)) {
      msg = "Using roster " + cache.rosterId + ".";
    }
    var show = !!msg;
    if (!show) {
      if (el) el.hidden = true;
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = BANNER_ID;
      el.className = "apms-roster-banner";
      var main = document.querySelector("main") || document.getElementById("apms-root") || document.body;
      main.insertBefore(el, main.firstChild);
    }
    el.textContent = msg;
    el.hidden = false;
  }

  function bindKind() {
    var v = sessionView();
    if (v === "rewards" || v.indexOf("rewards") === 0) return "rewards";
    if (v === "apms" || v.indexOf("apms") === 0) return "apms";
    if (v.indexOf("award") === 0) return "award";
    return "";
  }
  function overlaySubject(kind) {
    if (kind === "award") return session().selectedAwardId || "";
    return sessionMonth();
  }

  var inflight = null;
  function load(period, force) {
    period = period || sessionMonth();
    if (!/^\d{4}-\d{2}$/.test(period)) period = ym();
    if (!force && inflight && cache.period === period && cache.loaded && !cache.kind) return inflight;
    inflight = fetch("/api/roster/" + period, cred())
      .then(function (r) {
        if (r.status === 401) return null;
        return r.json();
      })
      .then(function (body) {
        if (!body || !body.ok) return body;
        cache.kind = "";
        cache.subject = period;
        setCache(period, body);
        state.period = period;
        state.data = body;
        state.drafts = {};
        render();
        return body;
      })
      .catch(function () {
        return null;
      });
    return inflight;
  }

  function loadBind(kind, subject, force) {
    if (!kind || !subject) return load(sessionMonth(), force);
    if (!force && inflight && cache.kind === kind && cache.subject === subject && cache.loaded) return inflight;
    inflight = fetch("/api/roster-bind/" + encodeURIComponent(kind) + "/" + encodeURIComponent(subject), cred())
      .then(function (r) {
        if (r.status === 401) return null;
        return r.json();
      })
      .then(function (body) {
        if (!body || !body.ok) return body;
        var rosterId = body.rosterId || body.period || subject;
        cache.kind = kind;
        cache.subject = subject;
        setCache(rosterId, body);
        return body;
      })
      .catch(function () {
        return null;
      });
    return inflight;
  }

  function loadOverlay(force) {
    var kind = bindKind();
    var subject = overlaySubject(kind);
    if (kind && subject) return loadBind(kind, subject, force);
    return load(sessionMonth(), force);
  }

  function mergedRow(a) {
    var d = state.drafts[a.personId] || {};
    return {
      id: a.id,
      personId: a.personId,
      sbuId: d.sbuId != null ? d.sbuId : a.sbuId,
      brandId: d.brandId != null ? d.brandId : a.brandId,
      managerId: d.managerId != null ? d.managerId : a.managerId,
      functionId: d.functionId != null ? d.functionId : a.functionId,
      status: d.status != null ? d.status : a.status,
      line: d.line != null ? d.line : a.line,
      reason: d.reason != null ? d.reason : a.reason,
      startDate: a.startDate,
      endDate: a.endDate,
      allocationPct: a.allocationPct,
    };
  }

  function selectHtml(name, value, options, personId) {
    var html = '<select data-field="' + name + '" data-person="' + esc(personId) + '"' + (locked() ? " disabled" : "") + ">";
    html += '<option value="">—</option>';
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      var sel = String(o.id) === String(value) ? " selected" : "";
      html += '<option value="' + esc(o.id) + '"' + sel + ">" + esc(o.name || o.id) + "</option>";
    }
    html += "</select>";
    return html;
  }

  function locked() {
    return state.data && state.data.status === "locked";
  }

  function catalogs() {
    return (state.data && state.data.catalogs) || { people: [], sbus: [], brands: [], functions: [] };
  }

  function render() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (!state.data) {
      host.innerHTML = '<div class="apms-roster"><p class="muted">Opening roster…</p></div>';
      return;
    }
    var cat = catalogs();
    var peopleById = {};
    (cat.people || []).forEach(function (p) {
      peopleById[p.id] = p;
    });
    var rows = (state.data.assignments || []).slice().sort(function (a, b) {
      var na = (peopleById[a.personId] && peopleById[a.personId].name) || a.personId;
      var nb = (peopleById[b.personId] && peopleById[b.personId].name) || b.personId;
      return String(na).localeCompare(String(nb));
    });
    var q = state.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (a) {
        var p = peopleById[a.personId] || {};
        var m = mergedRow(a);
        return [p.name, a.personId, nameOf(cat.sbus, m.sbuId), nameOf(cat.people, m.managerId), m.status]
          .join(" ")
          .toLowerCase()
          .indexOf(q) >= 0;
      });
    }
    var assigned = {};
    rows.forEach(function (a) {
      assigned[a.personId] = true;
    });
    var missing = (cat.people || []).filter(function (p) {
      return (p.status || "active") !== "left" && !assigned[p.id];
    });

    var lockBanner = locked()
      ? '<div class="apms-roster-lock">Locked. Past APMS and Rewards for this month use this roster.</div>'
      : "";
    var nextPeriod = shift(state.period, 1);
    var html = "";
    html += '<div class="apms-roster">';
    html += '<header class="apms-roster-head">';
    html += "<div><h1>Roster</h1><p class=\"muted\">Month assignments. People stay identity — APMS and Rewards keep the month they were written.</p></div>";
    html += '<div class="apms-roster-month">';
    html += '<button type="button" data-act="prev" aria-label="Previous month">‹</button>';
    html += "<strong>" + esc(labelMonth(state.period)) + "</strong>";
    html += '<button type="button" data-act="next" aria-label="Next month">›</button>';
    html += '<span class="pill ' + (locked() ? "locked" : "draft") + '">' + esc(state.data.status || "draft") + "</span>";
    html += "</div></header>";
    html += lockBanner;
    html += '<div class="apms-roster-actions">';
    html += '<input type="search" placeholder="Search people" value="' + esc(state.q) + '" data-act="q"/>';
    if (!locked()) {
      html += '<button type="button" class="primary" data-act="save">Save</button>';
      html += '<button type="button" data-act="lock">Lock roster</button>';
      html += '<button type="button" data-act="copy">Copy to ' + esc(labelMonth(nextPeriod)) + "</button>";
    } else {
      html += '<button type="button" data-act="unlock">Unlock</button>';
    }
    if (state.msg) html += '<span class="ok">' + esc(state.msg) + "</span>";
    if (state.err) html += '<span class="err">' + esc(state.err) + "</span>";
    html += "</div>";
    html += '<div class="apms-roster-table-wrap"><table class="apms-roster-table"><thead><tr>';
    html += "<th>Person</th><th>SBU</th><th>Manager</th><th>Function</th><th>Brand</th><th>Status</th><th>Line</th><th>Start</th><th>End</th><th>%</th><th>Reason</th>";
    html += "</tr></thead><tbody>";
    if (!rows.length) {
      html += '<tr><td colspan="11" class="muted">No assignments for this month.</td></tr>';
    }
    rows.forEach(function (a) {
      var m = mergedRow(a);
      var p = peopleById[a.personId] || { id: a.personId, name: a.personId };
      html += "<tr>";
      html += "<td><div class=\"name\">" + esc(p.name || a.personId) + '</div><div class="muted">' + esc(a.personId) + "</div></td>";
      html += "<td>" + selectHtml("sbuId", m.sbuId, cat.sbus || [], a.personId) + "</td>";
      html += "<td>" + selectHtml("managerId", m.managerId, cat.people || [], a.personId) + "</td>";
      html += "<td>" + selectHtml("functionId", m.functionId, cat.functions || [], a.personId) + "</td>";
      html += "<td>" + selectHtml("brandId", m.brandId, cat.brands || [], a.personId) + "</td>";
      html += "<td>" + selectHtml("status", m.status, [
        { id: "active", name: "active" },
        { id: "joining", name: "joining" },
        { id: "paused", name: "paused" },
        { id: "left", name: "left" },
      ], a.personId) + "</td>";
      html += "<td>" + esc(m.line || "solid") + "</td>";
      html += "<td class=\"muted\">" + esc(m.startDate || "") + "</td>";
      html += "<td class=\"muted\">" + esc(m.endDate || "") + "</td>";
      html += "<td class=\"muted\">" + esc(m.allocationPct == null ? 100 : m.allocationPct) + "</td>";
      html += '<td><input data-field="reason" data-person="' + esc(a.personId) + '" value="' + esc(m.reason || "") + '"' + (locked() ? " disabled" : "") + "/></td>";
      html += "</tr>";
    });
    missing.forEach(function (p) {
      html += '<tr class="missing"><td><div class="name">' + esc(p.name || p.id) + '</div><div class="muted">Roster not set</div></td>';
      html += '<td colspan="10" class="muted">Falls back to the person file until you save a row for this month.</td></tr>';
    });
    html += "</tbody></table></div></div>";
    host.innerHTML = html;
    bind(host);
  }

  function bind(host) {
    host.querySelector('[data-act="prev"]') &&
      host.querySelector('[data-act="prev"]').addEventListener("click", function () {
        load(shift(state.period, -1), true);
      });
    host.querySelector('[data-act="next"]') &&
      host.querySelector('[data-act="next"]').addEventListener("click", function () {
        load(shift(state.period, 1), true);
      });
    host.querySelector('[data-act="q"]') &&
      host.querySelector('[data-act="q"]').addEventListener("input", function (ev) {
        state.q = ev.target.value;
        render();
        var inp = host.querySelector('[data-act="q"]');
        if (inp) {
          inp.focus();
          try {
            inp.setSelectionRange(inp.value.length, inp.value.length);
          } catch (e) {}
        }
      });
    host.querySelector('[data-act="save"]') &&
      host.querySelector('[data-act="save"]').addEventListener("click", save);
    host.querySelector('[data-act="lock"]') &&
      host.querySelector('[data-act="lock"]').addEventListener("click", function () {
        post("/api/roster/" + state.period + "/lock");
      });
    host.querySelector('[data-act="unlock"]') &&
      host.querySelector('[data-act="unlock"]').addEventListener("click", function () {
        post("/api/roster/" + state.period + "/unlock");
      });
    host.querySelector('[data-act="copy"]') &&
      host.querySelector('[data-act="copy"]').addEventListener("click", function () {
        post("/api/roster/" + shift(state.period, 1) + "/copy-from/" + state.period);
      });
    host.querySelectorAll("select[data-field], input[data-field]").forEach(function (el) {
      el.addEventListener("change", onDraft);
      el.addEventListener("input", onDraft);
    });
  }

  function onDraft(ev) {
    var el = ev.target;
    var personId = el.getAttribute("data-person");
    var field = el.getAttribute("data-field");
    if (!personId || !field) return;
    state.drafts[personId] = state.drafts[personId] || {};
    state.drafts[personId][field] = el.value;
  }

  function opId() {
    return "roster-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function save() {
    if (!state.data || locked() || state.saving) return;
    var assignments = [];
    (state.data.assignments || []).forEach(function (a) {
      var d = state.drafts[a.personId];
      if (!d) return;
      assignments.push({
        id: a.id,
        personId: a.personId,
        sbuId: d.sbuId != null ? d.sbuId : a.sbuId,
        brandId: d.brandId != null ? d.brandId : a.brandId,
        managerId: d.managerId != null ? d.managerId : a.managerId,
        functionId: d.functionId != null ? d.functionId : a.functionId,
        status: d.status != null ? d.status : a.status,
        reason: d.reason != null ? d.reason : a.reason,
      });
    });
    state.saving = true;
    state.err = "";
    state.msg = "Saving…";
    render();
    fetch("/api/roster/" + state.period, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        baseRev: state.data.rev,
        clientOpId: opId(),
        assignments: assignments,
      }),
    })
      .then(function (r) {
        return r.json().then(function (b) {
          return { status: r.status, body: b };
        });
      })
      .then(function (res) {
        state.saving = false;
        if (res.status === 409) {
          state.err = res.body && res.body.error === "roster-locked" ? "Locked — cannot edit." : "Someone else saved. Reloaded.";
          if (res.body && res.body.ok !== false && res.body.assignments) {
            setCache(state.period, res.body);
            state.data = res.body;
            state.drafts = {};
          } else {
            return load(state.period, true);
          }
        } else if (!res.body || !res.body.ok) {
          state.err = (res.body && res.body.error) || "Save failed.";
        } else {
          state.msg = "Saved.";
          state.err = "";
          state.drafts = {};
          setCache(state.period, res.body);
          state.data = res.body;
        }
        render();
      })
      .catch(function () {
        state.saving = false;
        state.err = "Save failed.";
        render();
      });
  }

  function post(url) {
    state.err = "";
    state.msg = "Working…";
    render();
    fetch(url, { method: "POST", credentials: "include", headers: { accept: "application/json" } })
      .then(function (r) {
        return r.json().then(function (b) {
          return { status: r.status, body: b };
        });
      })
      .then(function (res) {
        if (res.status === 403) {
          state.err =
            res.body && res.body.error === "rewards-locked"
              ? "Rewards is locked for this month. Only admin can unlock."
              : "Not allowed.";
        } else if (!res.body || (res.body.ok === false && res.status >= 400)) {
          state.err = (res.body && res.body.error) || "Failed.";
        } else {
          state.msg = "Done.";
          if (res.body.period) {
            setCache(res.body.period, res.body);
            state.period = res.body.period;
            state.data = res.body;
            state.drafts = {};
          } else {
            return load(state.period, true);
          }
        }
        render();
      })
      .catch(function () {
        state.err = "Failed.";
        render();
      });
  }

  function tick() {
    var host = document.getElementById(HOST_ID);
    var view = sessionView();
    var month = sessionMonth();
    var kind = bindKind();
    var subject = overlaySubject(kind);
    if (host) {
      if (state.period !== month || !state.data) load(month, state.period !== month);
      else if (!host.querySelector(".apms-roster")) render();
    }
    if (kind && subject) {
      if (cache.kind !== kind || cache.subject !== subject || !cache.loaded) loadOverlay(false);
    } else if (cache.period !== month || cache.kind || !cache.loaded) {
      loadOverlay(false);
    }
    paintBanner();
  }

  function boot() {
    if (!document.getElementById(STYLE_ID)) {
      var link = document.createElement("link");
      link.id = STYLE_ID;
      link.rel = "stylesheet";
      link.href = "/assets/apms-roster.css?v=p0as45";
      document.head.appendChild(link);
    }
    setInterval(tick, 700);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick);
    else tick();
  }

  global.__apmsRoster = cache;
  global.__apmsRosterUi = { load: load, loadBind: loadBind, loadOverlay: loadOverlay, cache: function () { return cache; }, overlayBanner: paintBanner };
  boot();
})(typeof window !== "undefined" ? window : globalThis);
