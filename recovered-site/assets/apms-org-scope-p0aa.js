/** People-tree accountability + KPI grain. Loaded by the live SPA. */
export function personSbuIds(p) {
  if (!p) return [];
  const ids = [];
  if (p.buId) ids.push(p.buId);
  if (Array.isArray(p.buIds)) for (const id of p.buIds) if (id) ids.push(id);
  return [...new Set(ids)];
}

export function sitsOnSbu(p, sbuId) {
  if (!p || !sbuId) return false;
  return personSbuIds(p).includes(sbuId);
}

export function pickerHomeBuId(opts) {
  if (!opts) return "";
  if (opts.companyWide) return opts.prevBuId || "";
  const ids = (opts.buIds || []).filter(Boolean);
  const primary = opts.primaryId || "";
  if (primary && ids.includes(primary)) return primary;
  const prev = opts.prevBuId || "";
  if (prev && ids.includes(prev)) return prev;
  if (!prev && ids.length === 1) return ids[0];
  return "";
}

export function patchRemovePersonFromSbu(person, sbuId) {
  const home = (person && person.buId) || "";
  const nextBu = [...new Set([...((person && person.buIds) || []), home].filter(Boolean))].filter(
    (id) => id !== sbuId,
  );
  return { buId: home === sbuId ? "" : home, buIds: nextBu };
}

export function patchAddPersonToSbu(person, sbuId) {
  const home = (person && person.buId) || "";
  const buIds = [...new Set([...((person && person.buIds) || []), home, sbuId].filter(Boolean))];
  return { buId: home || sbuId, buIds };
}

export function isDirectBridge(person, viewerId) {
  if (!person || !viewerId) return false;
  if (person.managerId === viewerId) return true;
  if ((person.dottedLine || []).some((d) => d && d.managerId === viewerId)) return true;
  if ((person.functionSeats || []).some((s) => s && s.managerId === viewerId)) return true;
  return false;
}

export function accountableSbuSet(viewer, people) {
  const set = new Set(personSbuIds(viewer));
  for (const person of people || []) {
    if (!person || person.id === viewer.id) continue;
    if (person.managerId === viewer.id && person.buId) set.add(person.buId);
  }
  return set;
}

export function filterDescendantIds(people, viewer, descendantIds) {
  const acc = accountableSbuSet(viewer, people);
  const byId = new Map((people || []).map((p) => [p.id, p]));
  const next = new Set();
  for (const id of descendantIds) {
    const person = byId.get(id);
    if (!person) continue;
    if (isDirectBridge(person, viewer.id)) {
      next.add(id);
      continue;
    }
    if (personSbuIds(person).some((s) => acc.has(s))) next.add(id);
  }
  return next;
}

export function personFunctionIds(person) {
  if (!person) return [];
  const ids = [];
  if (person.functionId) ids.push(person.functionId);
  for (const seat of person.functionSeats || []) if (seat && seat.functionId) ids.push(seat.functionId);
  return [...new Set(ids)];
}

export function expandSbuTree(units, ids) {
  const set = new Set([...(ids || [])].filter(Boolean));
  if (!units || !units.length) return set;
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (unit && unit.id && unit.parentId && set.has(unit.parentId) && !set.has(unit.id)) {
        set.add(unit.id);
        grew = true;
      }
    }
  }
  return set;
}

function functionTree(functions, rootId) {
  const set = new Set();
  if (!rootId) return set;
  set.add(rootId);
  const list = functions || [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of list) {
      if (fn && fn.id && fn.parentId && set.has(fn.parentId) && !set.has(fn.id)) {
        set.add(fn.id);
        grew = true;
      }
    }
  }
  return set;
}

function intersectScope(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  const out = new Set();
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
}

function isCompanyAccess(person) {
  return !!person && (person.access === "super_admin" || person.access === "admin" || person.access === "hr");
}

export function leaderScope(viewer, people, functions, units) {
  people = people || [];
  functions = functions || [];
  units = units || [];
  if (!viewer) return { sbuIds: new Set(), functionIds: new Set() };
  if (isCompanyAccess(viewer)) return { sbuIds: null, functionIds: null };
  const fnIds = new Set();
  for (const id of personFunctionIds(viewer)) {
    for (const child of functionTree(functions, id)) fnIds.add(child);
  }
  for (const fn of functions) {
    if (fn.headId === viewer.id) for (const child of functionTree(functions, fn.id)) fnIds.add(child);
  }
  if (viewer.access === "function_head") {
    const seats = personSbuIds(viewer);
    return { sbuIds: seats.length ? expandSbuTree(units, seats) : null, functionIds: fnIds.size ? fnIds : new Set() };
  }
  if (viewer.access === "manager") {
    return { sbuIds: expandSbuTree(units, accountableSbuSet(viewer, people)), functionIds: null };
  }
  return {
    sbuIds: expandSbuTree(units, personSbuIds(viewer)),
    functionIds: fnIds.size ? fnIds : null,
  };
}

function reportsEdge(person, bossId) {
  if (person.managerId === bossId) return { kind: "solid", functionId: null };
  const dotted = (person.dottedLine || []).find((d) => d && d.managerId === bossId);
  if (dotted) return { kind: "dotted", functionId: dotted.functionId || null };
  const seat = (person.functionSeats || []).find((s) => s && s.managerId === bossId);
  if (seat) return { kind: "seat", functionId: seat.functionId || null };
  return null;
}

function personMatchesScope(person, sbuIds, functionIds) {
  if (functionIds) {
    const fns = personFunctionIds(person);
    if (!fns.some((id) => functionIds.has(id))) return false;
  }
  if (sbuIds) {
    const sbus = personSbuIds(person);
    if (!sbus.length) return true;
    if (!sbus.some((id) => sbuIds.has(id))) return false;
  }
  return true;
}

export function scopedTeamIds(people, viewer, functions, units) {
  const ids = new Set();
  if (!viewer) return ids;
  people = people || [];
  functions = functions || [];
  units = units || [];
  ids.add(viewer.id);
  const root = leaderScope(viewer, people, functions, units);
  const queue = [{ id: viewer.id, sbuIds: root.sbuIds, functionIds: root.functionIds }];
  const visited = new Set([viewer.id]);
  while (queue.length) {
    const node = queue.shift();
    const firstHop = node.id === viewer.id;
    for (const person of people) {
      if (!person || visited.has(person.id) || person.id === node.id) continue;
      if ((person.status || "active") === "left") continue;
      const edge = reportsEdge(person, node.id);
      if (!edge) continue;
      let fn = node.functionIds;
      if (edge.functionId) fn = intersectScope(fn, new Set([edge.functionId]));
      const matches = personMatchesScope(person, node.sbuIds, fn);
      if (!matches && !firstHop) continue;
      visited.add(person.id);
      ids.add(person.id);
      const openBridge = firstHop && !matches;
      queue.push({
        id: person.id,
        sbuIds: openBridge ? null : node.sbuIds,
        functionIds: openBridge ? null : fn,
      });
    }
  }
  return ids;
}

export function scopedTeam(people, viewer, functions, units) {
  const ids = scopedTeamIds(people, viewer, functions, units);
  return (people || [])
    .filter((p) => ids.has(p.id) && (p.status || "active") !== "left")
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function nestPeopleByPrimary(people) {
  const list = [...(people || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const ids = new Set(list.map((p) => p.id));
  return {
    ids,
    kids: (id) => list.filter((p) => p.managerId === id),
    roots: list.filter((p) => !p.managerId || !ids.has(p.managerId)),
  };
}

export function nestPeopleInSection(people) {
  const list = [...(people || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const ids = new Set(list.map((p) => p.id));
  return {
    ids,
    kids: (id) =>
      list.filter((p) => {
        if (p.managerId === id) return true;
        if (p.managerId && ids.has(p.managerId)) return false;
        return (p.dottedLine || []).some((d) => d && d.managerId === id);
      }),
    roots: list.filter((p) => {
      if (p.managerId && ids.has(p.managerId)) return false;
      return !(p.dottedLine || []).some((d) => d && d.managerId && ids.has(d.managerId));
    }),
  };
}

export function unitsWithPeople(units, people) {
  const used = new Set();
  for (const person of people || []) for (const id of personSbuIds(person)) used.add(id);
  const byId = new Map((units || []).map((u) => [u.id, u]));
  const show = new Set(used);
  for (const id of [...used]) {
    let cur = byId.get(id);
    let guard = 0;
    while (cur && cur.parentId && guard++ < 24) {
      show.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  return (units || [])
    .filter((u) => show.has(u.id))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function peopleOnSbu(people, sbuId) {
  return (people || []).filter((p) => personSbuIds(p).includes(sbuId));
}

export function peopleInFunction(people, functionId) {
  return (people || []).filter((p) => personFunctionIds(p).includes(functionId));
}

export function leaderScopeLabel(viewer, people, functions, units) {
  if (!viewer) return "";
  if (isCompanyAccess(viewer)) return "Whole company";
  people = people || [];
  functions = functions || [];
  units = units || [];
  const scope = leaderScope(viewer, people, functions, units);
  const fnNames = scope.functionIds
    ? [...scope.functionIds].map((id) => (functions.find((f) => f.id === id) || {}).name).filter(Boolean).slice(0, 3)
    : [];
  let sbuNames = [];
  if (scope.sbuIds) {
    sbuNames = [...scope.sbuIds]
      .map((id) => units.find((u) => u.id === id))
      .filter((u) => u && !u.parentId)
      .map((u) => u.name)
      .filter(Boolean);
    if (!sbuNames.length) {
      sbuNames = [...scope.sbuIds]
        .map((id) => (units.find((u) => u.id === id) || {}).name)
        .filter(Boolean)
        .slice(0, 3);
    }
  }
  const fnPart = scope.functionIds == null ? "All functions" : fnNames.join(", ") || "Function";
  const sbuPart = scope.sbuIds == null ? "all studios" : sbuNames.join(", ") || "Studios";
  return `${sbuPart} · ${fnPart}`;
}

export function noticeGroupKey(n) {
  if (!n) return "";
  const to = [...(n.toIds || [])].filter(Boolean).sort().join(",");
  const phase = n.kind === "plan_ready" || n.kind === "month_closed" ? "" : n.phase || "";
  return `${n.kind || ""}|${n.month || ""}|${n.planKind || ""}|${n.subjectId || ""}|${to}|${phase}`;
}

export function isNoticeOpenFor(n, userId) {
  if (!n || !userId) return false;
  if (n.status && n.status !== "open") return false;
  if (!(n.toIds || []).includes(userId)) return false;
  if ((n.doneIds || []).includes(userId)) return false;
  return true;
}

export function groupNoticesByKey(notices) {
  const byKey = new Map();
  for (const n of notices || []) {
    if (!n) continue;
    const k = noticeGroupKey(n);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, n);
      continue;
    }
    const na = String(n.createdAt || "");
    const pa = String(prev.createdAt || "");
    if (na > pa || (na === pa && String(n.id || "") > String(prev.id || ""))) byKey.set(k, n);
  }
  return [...byKey.values()];
}

export function siblingNoticeIds(notices, one, userId) {
  if (!one) return [];
  const k = noticeGroupKey(one);
  return (notices || [])
    .filter((n) => n && n.id && noticeGroupKey(n) === k && isNoticeOpenFor(n, userId))
    .map((n) => n.id);
}

export function collapseOpenNotices(notices, incoming, now) {
  const key = noticeGroupKey(incoming);
  const list = [...(notices || [])];
  const stamp = now || incoming.createdAt || new Date().toISOString();
  const openDupes = list.filter((n) => n && n.status === "open" && noticeGroupKey(n) === key);
  if (openDupes.length) {
    const keep = openDupes[0];
    const drop = new Set(openDupes.slice(1).map((n) => n.id));
    const next = list
      .filter((n) => !drop.has(n.id))
      .map((n) =>
        n.id === keep.id ? { ...n, ...incoming, id: keep.id, status: "open", createdAt: stamp } : n,
      );
    return { notices: next, id: keep.id, added: false };
  }
  const id = incoming.id || "nt-new";
  return {
    notices: [{ ...incoming, id, status: incoming.status || "open", createdAt: stamp }, ...list],
    id,
    added: true,
  };
}

export function empAlertDuplicatesNotice(emp, notices, userId) {
  if (!emp || !userId) return false;
  const noticeKind =
    emp.phase === "plan_ready" ? "plan_ready" : emp.phase === "month_closed" ? "month_closed" : null;
  if (!noticeKind) return false;
  return (notices || []).some(
    (n) =>
      isNoticeOpenFor(n, userId) &&
      n.kind === noticeKind &&
      (n.month || "") === (emp.month || "") &&
      (n.planKind || "") === (emp.kind || ""),
  );
}

export function empAlertKeyForNotice(userId, n) {
  if (!userId || !n) return null;
  if (n.kind === "plan_ready") return `emp:${userId}:${n.planKind || ""}:${n.month || ""}:plan_ready`;
  if (n.kind === "month_closed") return `emp:${userId}:${n.planKind || ""}:${n.month || ""}:month_closed`;
  return null;
}

export function kpiScopeChip(kpi) {
  const scope = kpi && kpi.scope;
  if (!scope || scope === "individual") return null;
  const name = String((kpi && kpi.scopeLabel) || "").trim();
  if (scope === "sbu") {
    return {
      label: name ? "SBU · " + name : "SBU",
      title: "SBU KPI — a label for discussion, scored on this person",
      tone: "studio",
    };
  }
  if (scope === "function") {
    return {
      label: name ? "Function · " + name : "Function",
      title: "Function KPI — a label for discussion, scored on this person",
      tone: "function",
    };
  }
  return {
    label: name ? "Team · " + name : "Team",
    title: "Team KPI — a label for discussion, scored on this person",
    tone: "team",
  };
}

export function firstNameOf(person) {
  if (!person) return "";
  const first = String(person.firstName || "").trim();
  if (first) return first;
  return String(person.name || "").trim().split(/\s+/)[0] || "";
}

export function teamLabel(person) {
  const first = firstNameOf(person);
  return first ? first + "'s team" : "Team";
}

export function peopleWithTeams(people) {
  const bosses = new Set();
  for (const p of people || []) {
    if ((p.status || "active") === "left") continue;
    if (p.managerId) bosses.add(p.managerId);
    for (const d of p.dottedLine || []) if (d && d.managerId) bosses.add(d.managerId);
  }
  return (people || [])
    .filter((p) => bosses.has(p.id) && (p.status || "active") !== "left")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function sharedKpiKey(kpi) {
  if (!kpi || !kpi.scope || kpi.scope === "individual") return null;
  return `${kpi.scope}|${kpi.scopeId || ""}|${String(kpi.name || "").trim().toLowerCase()}`;
}

export function stampSharedAchieved(rec, kpi, value) {
  const key = sharedKpiKey(kpi);
  if (!key || !rec) return 0;
  let n = 0;
  const brands = rec.brands && rec.brands.length ? rec.brands : rec.kras ? [{ kras: rec.kras }] : [];
  for (const b of brands) {
    for (const kra of b.kras || []) {
      for (const k of kra.kpis || []) {
        for (const x of [k, ...(k.children || [])]) {
          if (sharedKpiKey(x) === key) {
            x.achieved = value;
            n += 1;
          }
        }
      }
    }
  }
  return n;
}

export function linkedSbuActual(kpi, state, month) {
  if (!kpi || kpi.scope !== "sbu" || !kpi.linkTargetActual || !state) return null;
  const sbuId = kpi.scopeId;
  if (!sbuId) return null;
  const nodes = Array.isArray(state.targetNodes)
    ? state.targetNodes
    : Object.values(state.targetNodes || {});
  const node = nodes.find((n) => n && (n.sbuId === sbuId || n.id === sbuId));
  if (!node) return null;
  const months = [month, state.currentMonth, state.selectedMonth, state.selectedTargetMonth].filter(
    (m, i, all) => m && all.indexOf(m) === i,
  );
  const cells = state.targetCells || {};
  for (const m of months) {
    const cell = cells[`${node.id}::${m}`];
    if (cell && cell.actual != null && cell.actual !== "") {
      const n = Number(cell.actual);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export function effectiveAchieved(kpi, state, month) {
  if (!kpi) return null;
  const linked = linkedSbuActual(kpi, state, month);
  if (linked != null) return linked;
  if (kpi.achieved == null || Number.isNaN(Number(kpi.achieved))) return null;
  return Number(kpi.achieved);
}
