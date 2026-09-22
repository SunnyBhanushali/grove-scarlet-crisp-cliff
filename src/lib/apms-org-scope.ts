/**
 * People-tree accountability and KPI grain.
 *
 * Accountability is the studios you *run*, not only the studio you sit on.
 * Dual-studio captains (Malad + Bandra) keep both teams. A studio manager
 * above them only sees the spanning captain plus the artists in *their*
 * studio. Dotted reports do not donate a studio upward.
 *
 * Dual-function (Captain → SM + Artist Manager, same studio) is a different
 * rule — both bosses still see the artists. That lives in the rewards note §6.
 */

export type OrgPerson = {
  id: string;
  name?: string;
  access?: string;
  managerId?: string | null;
  buId?: string | null;
  buIds?: string[] | null;
  functionId?: string | null;
  subFunctionId?: string | null;
  status?: string | null;
  dottedLine?: { managerId?: string | null; functionId?: string | null }[] | null;
  functionSeats?: {
    kind?: string;
    functionId?: string | null;
    managerId?: string | null;
  }[] | null;
};

export type KpiLike = {
  name?: string | null;
  achieved?: number | null;
  scope?: string | null;
  scopeId?: string | null;
  scopeLabel?: string | null;
  linkTargetActual?: boolean | null;
};

export type TargetNode = {
  id: string;
  name?: string;
  sbuId?: string | null;
};

export type TargetCell = {
  actual?: number | null;
};

export function personSbuIds(person: OrgPerson | null | undefined): string[] {
  if (!person) return [];
  const ids: string[] = [];
  if (person.buId) ids.push(person.buId);
  if (Array.isArray(person.buIds)) {
    for (const id of person.buIds) if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** A person sits on a studio only via home + extras. Brand is not a studio. */
export function sitsOnSbu(
  person: OrgPerson | null | undefined,
  sbuId: string | null | undefined,
): boolean {
  if (!person || !sbuId) return false;
  return personSbuIds(person).includes(sbuId);
}

export type SbuSeat = {
  buId?: string | null;
  buIds?: string[] | null;
  companyWide?: boolean | null;
};

/**
 * Home studio after the person-editor org picker.
 * Keep the current home if it is still ticked. Do not promote buIds[0]
 * (that dumped new people into Bangalore). A first-and-only pick becomes home.
 */
export function pickerHomeBuId(opts: {
  companyWide?: boolean | null;
  buIds?: string[] | null;
  prevBuId?: string | null;
  primaryId?: string | null;
}): string {
  if (opts.companyWide) return opts.prevBuId || "";
  const ids = (opts.buIds || []).filter(Boolean);
  const primary = opts.primaryId || "";
  if (primary && ids.includes(primary)) return primary;
  const prev = opts.prevBuId || "";
  if (prev && ids.includes(prev)) return prev;
  if (!prev && ids.length === 1) return ids[0];
  return "";
}

/** Remove from an SBU page. Clearing home does not promote another studio. */
export function patchRemovePersonFromSbu(
  person: SbuSeat,
  sbuId: string,
): { buId: string; buIds: string[] } {
  const home = person.buId || "";
  const nextBu = [...new Set([...(person.buIds || []), home].filter(Boolean))].filter(
    (id) => id !== sbuId,
  );
  return { buId: home === sbuId ? "" : home, buIds: nextBu };
}

/** Add from an SBU page. Blank home takes this studio as home. */
export function patchAddPersonToSbu(
  person: SbuSeat,
  sbuId: string,
): { buId: string; buIds: string[] } {
  const home = person.buId || "";
  const buIds = [...new Set([...(person.buIds || []), home, sbuId].filter(Boolean))];
  return { buId: home || sbuId, buIds };
}

export function isDirectBridge(
  person: OrgPerson | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  if (!person || !viewerId) return false;
  if (person.managerId === viewerId) return true;
  if ((person.dottedLine || []).some((d) => d && d.managerId === viewerId)) return true;
  const seats = person.functionSeats || [];
  if (seats.some((s) => s && s.managerId === viewerId)) return true;
  return false;
}

/**
 * Studios this viewer is accountable for:
 *   viewer home + extras
 *   + home studio of each *solid* direct (so an SM with empty home still
 *     inherits the studio her captain sits on)
 * Solid-direct *extras* are NOT donated — that is how Bandra would leak
 * to Sarvajeet through Vishal. Dotted reports donate nothing.
 */
export function accountableSbuSet(
  viewer: OrgPerson,
  people: OrgPerson[],
): Set<string> {
  const set = new Set(personSbuIds(viewer));
  for (const person of people) {
    if (!person || person.id === viewer.id) continue;
    if (person.managerId === viewer.id && person.buId) set.add(person.buId);
  }
  return set;
}

export function filterDescendantIds(
  people: OrgPerson[],
  viewer: OrgPerson,
  descendantIds: Iterable<string>,
): Set<string> {
  const acc = accountableSbuSet(viewer, people);
  const byId = new Map(people.map((p) => [p.id, p]));
  const next = new Set<string>();
  for (const id of descendantIds) {
    const person = byId.get(id);
    if (!person) continue;
    if (isDirectBridge(person, viewer.id)) {
      next.add(id);
      continue;
    }
    const sbus = personSbuIds(person);
    if (sbus.some((s) => acc.has(s))) next.add(id);
  }
  return next;
}

export type OrgUnit = { id: string; parentId?: string | null; name?: string | null };
export type OrgFunction = {
  id: string;
  parentId?: string | null;
  name?: string | null;
  headId?: string | null;
};

export type LeaderScope = {
  sbuIds: Set<string> | null;
  functionIds: Set<string> | null;
};

export function personFunctionIds(person: OrgPerson | null | undefined): string[] {
  if (!person) return [];
  const ids: string[] = [];
  if (person.functionId) ids.push(person.functionId);
  for (const seat of person.functionSeats || []) {
    if (seat?.functionId) ids.push(seat.functionId);
  }
  return [...new Set(ids)];
}

export function expandSbuTree(
  units: OrgUnit[] | null | undefined,
  ids: Iterable<string>,
): Set<string> {
  const set = new Set([...ids].filter(Boolean));
  if (!units?.length) return set;
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (unit?.id && unit.parentId && set.has(unit.parentId) && !set.has(unit.id)) {
        set.add(unit.id);
        grew = true;
      }
    }
  }
  return set;
}

function functionTree(
  functions: OrgFunction[] | null | undefined,
  rootId: string | null | undefined,
): Set<string> {
  const set = new Set<string>();
  if (!rootId) return set;
  set.add(rootId);
  const list = functions || [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of list) {
      if (fn?.id && fn.parentId && set.has(fn.parentId) && !set.has(fn.id)) {
        set.add(fn.id);
        grew = true;
      }
    }
  }
  return set;
}

function intersectScope(
  a: Set<string> | null,
  b: Set<string> | null,
): Set<string> | null {
  if (a == null) return b;
  if (b == null) return a;
  const out = new Set<string>();
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
}

/** Where this leader's People tree is allowed to look. Never inferred from reportees. */
export function leaderScope(
  viewer: OrgPerson | null | undefined,
  people: OrgPerson[] = [],
  functions: OrgFunction[] = [],
  units: OrgUnit[] = [],
): LeaderScope {
  if (!viewer) return { sbuIds: new Set(), functionIds: new Set() };
  if (companyAccess(viewer)) return { sbuIds: null, functionIds: null };

  const fnIds = new Set<string>();
  for (const id of personFunctionIds(viewer)) {
    for (const child of functionTree(functions, id)) fnIds.add(child);
  }
  for (const fn of functions) {
    if (fn.headId === viewer.id) {
      for (const child of functionTree(functions, fn.id)) fnIds.add(child);
    }
  }

  if (viewer.access === "function_head") {
    const seats = personSbuIds(viewer);
    return {
      sbuIds: seats.length ? expandSbuTree(units, seats) : null,
      functionIds: fnIds.size ? fnIds : new Set(),
    };
  }
  if (viewer.access === "manager") {
    return {
      sbuIds: expandSbuTree(units, accountableSbuSet(viewer, people)),
      functionIds: null,
    };
  }
  return {
    sbuIds: expandSbuTree(units, personSbuIds(viewer)),
    functionIds: fnIds.size ? fnIds : null,
  };
}

function reportsEdge(
  person: OrgPerson,
  bossId: string,
): { kind: "solid" | "dotted" | "seat"; functionId: string | null } | null {
  if (person.managerId === bossId) return { kind: "solid", functionId: null };
  const dotted = (person.dottedLine || []).find((d) => d && d.managerId === bossId);
  if (dotted) return { kind: "dotted", functionId: dotted.functionId || null };
  const seat = (person.functionSeats || []).find((s) => s && s.managerId === bossId);
  if (seat) return { kind: "seat", functionId: seat.functionId || null };
  return null;
}

function personMatchesScope(
  person: OrgPerson,
  sbuIds: Set<string> | null,
  functionIds: Set<string> | null,
): boolean {
  if (functionIds) {
    const fns = personFunctionIds(person);
    if (!fns.some((id) => functionIds.has(id))) return false;
  }
  if (sbuIds) {
    const sbus = personSbuIds(person);
    if (sbus.length === 0) return true;
    if (!sbus.some((id) => sbuIds.has(id))) return false;
  }
  return true;
}

/**
 * People this viewer actually leads.
 * Walk solid + dotted. Scope may narrow on an edge. It never picks up a
 * reportee's extra studios or extra functions — except a first-hop
 * bridge (someone who reports to the viewer but sits outside the
 * viewer's function/SBU). Their reporting team comes with them, so
 * expanding Tushar under Allan shows Tushar's people.
 */
export function scopedTeamIds(
  people: OrgPerson[],
  viewer: OrgPerson | null | undefined,
  functions: OrgFunction[] = [],
  units: OrgUnit[] = [],
): Set<string> {
  const ids = new Set<string>();
  if (!viewer) return ids;
  ids.add(viewer.id);
  const root = leaderScope(viewer, people, functions, units);
  const queue: { id: string; sbuIds: Set<string> | null; functionIds: Set<string> | null }[] = [
    { id: viewer.id, sbuIds: root.sbuIds, functionIds: root.functionIds },
  ];
  const visited = new Set<string>([viewer.id]);

  while (queue.length) {
    const node = queue.shift()!;
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

export function scopedTeam(
  people: OrgPerson[],
  viewer: OrgPerson | null | undefined,
  functions: OrgFunction[] = [],
  units: OrgUnit[] = [],
): OrgPerson[] {
  const ids = scopedTeamIds(people, viewer, functions, units);
  return people
    .filter((p) => ids.has(p.id) && (p.status || "active") !== "left")
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function nestPeopleByPrimary(people: OrgPerson[]): {
  roots: OrgPerson[];
  kids: (id: string) => OrgPerson[];
  ids: Set<string>;
} {
  const list = [...people].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const ids = new Set(list.map((p) => p.id));
  const kids = (id: string) => list.filter((p) => p.managerId === id);
  const roots = list.filter((p) => !p.managerId || !ids.has(p.managerId));
  return { roots, kids, ids };
}

export function nestPeopleInSection(people: OrgPerson[]): {
  roots: OrgPerson[];
  kids: (id: string) => OrgPerson[];
  ids: Set<string>;
} {
  const list = [...people].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const ids = new Set(list.map((p) => p.id));
  const kids = (id: string) =>
    list.filter((p) => {
      if (p.managerId === id) return true;
      if (p.managerId && ids.has(p.managerId)) return false;
      return (p.dottedLine || []).some((d) => d && d.managerId === id);
    });
  const roots = list.filter((p) => {
    if (p.managerId && ids.has(p.managerId)) return false;
    return !(p.dottedLine || []).some((d) => d && d.managerId && ids.has(d.managerId));
  });
  return { roots, kids, ids };
}

export function unitsWithPeople(
  units: OrgUnit[] | null | undefined,
  people: OrgPerson[],
): OrgUnit[] {
  const used = new Set<string>();
  for (const person of people) for (const id of personSbuIds(person)) used.add(id);
  const byId = new Map((units || []).map((u) => [u.id, u]));
  const show = new Set(used);
  for (const id of [...used]) {
    let cur = byId.get(id);
    let guard = 0;
    while (cur?.parentId && guard++ < 24) {
      show.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  return (units || [])
    .filter((u) => show.has(u.id))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function peopleOnSbu(people: OrgPerson[], sbuId: string): OrgPerson[] {
  return people.filter((p) => personSbuIds(p).includes(sbuId));
}

export function peopleInFunction(people: OrgPerson[], functionId: string): OrgPerson[] {
  return people.filter((p) => personFunctionIds(p).includes(functionId));
}

export function leaderScopeLabel(
  viewer: OrgPerson | null | undefined,
  people: OrgPerson[] = [],
  functions: OrgFunction[] = [],
  units: OrgUnit[] = [],
): string {
  if (!viewer) return "";
  if (companyAccess(viewer)) return "Whole company";
  const scope = leaderScope(viewer, people, functions, units);
  const fnNames = scope.functionIds
    ? [...scope.functionIds]
        .map((id) => functions.find((f) => f.id === id)?.name)
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const sbuNames = scope.sbuIds
    ? [...scope.sbuIds]
        .filter((id) => {
          const unit = units.find((u) => u.id === id);
          return unit && !unit.parentId;
        })
        .map((id) => units.find((u) => u.id === id)?.name)
        .filter(Boolean)
    : [];
  const leafSbus =
    scope.sbuIds && !sbuNames.length
      ? [...scope.sbuIds]
          .map((id) => units.find((u) => u.id === id)?.name)
          .filter(Boolean)
          .slice(0, 3)
      : sbuNames;
  const fnPart = scope.functionIds == null ? "All functions" : fnNames.join(", ") || "Function";
  const sbuPart =
    scope.sbuIds == null ? "all studios" : leafSbus.join(", ") || "Studios";
  return `${sbuPart} · ${fnPart}`;
}

export function companyAccess(person: OrgPerson | null | undefined): boolean {
  if (!person) return false;
  return (
    person.access === "super_admin" ||
    person.access === "admin" ||
    person.access === "hr"
  );
}

export type NoticeLike = {
  id?: string;
  kind?: string | null;
  month?: string | null;
  planKind?: string | null;
  subjectId?: string | null;
  phase?: string | null;
  status?: string | null;
  title?: string | null;
  body?: string | null;
  toIds?: string[] | null;
  doneIds?: string[] | null;
  createdAt?: string | null;
};

export function noticeGroupKey(n: NoticeLike | null | undefined): string {
  if (!n) return "";
  const to = [...(n.toIds || [])].filter(Boolean).sort().join(",");
  // Lock + login-cycle copies of “plan is ready / month is closed” used to
  // disagree on `phase` (empty vs plan_ready) and stacked as two alerts.
  const phase =
    n.kind === "plan_ready" || n.kind === "month_closed" ? "" : n.phase || "";
  return `${n.kind || ""}|${n.month || ""}|${n.planKind || ""}|${n.subjectId || ""}|${to}|${phase}`;
}

export function isNoticeOpenFor(
  n: NoticeLike | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!n || !userId) return false;
  if (n.status && n.status !== "open") return false;
  if (!(n.toIds || []).includes(userId)) return false;
  if ((n.doneIds || []).includes(userId)) return false;
  return true;
}

export function groupNoticesByKey(
  notices: NoticeLike[] | null | undefined,
): NoticeLike[] {
  const byKey = new Map<string, NoticeLike>();
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
    if (na > pa || (na === pa && String(n.id || "") > String(prev.id || ""))) {
      byKey.set(k, n);
    }
  }
  return [...byKey.values()];
}

export function siblingNoticeIds(
  notices: NoticeLike[] | null | undefined,
  one: NoticeLike | null | undefined,
  userId: string,
): string[] {
  if (!one) return [];
  const k = noticeGroupKey(one);
  return (notices || [])
    .filter((n) => n && n.id && noticeGroupKey(n) === k && isNoticeOpenFor(n, userId))
    .map((n) => n.id as string);
}

export function collapseOpenNotices(
  notices: NoticeLike[] | null | undefined,
  incoming: NoticeLike,
  now = incoming.createdAt || new Date().toISOString(),
): { notices: NoticeLike[]; id: string; added: boolean } {
  const key = noticeGroupKey(incoming);
  const list = [...(notices || [])];
  const openDupes = list.filter((n) => n && n.status === "open" && noticeGroupKey(n) === key);
  if (openDupes.length) {
    const keep = openDupes[0];
    const drop = new Set(openDupes.slice(1).map((n) => n.id));
    const next = list
      .filter((n) => !drop.has(n.id))
      .map((n) =>
        n.id === keep.id
          ? { ...n, ...incoming, id: keep.id, status: "open" as const, createdAt: now }
          : n,
      );
    return { notices: next, id: String(keep.id), added: false };
  }
  const id = incoming.id || `nt-new`;
  return {
    notices: [{ ...incoming, id, status: incoming.status || "open", createdAt: now }, ...list],
    id,
    added: true,
  };
}

export type EmpAlertLike = {
  kind?: string | null;
  month?: string | null;
  phase?: string | null;
  title?: string | null;
  body?: string | null;
};

/** Home also paints Kf “Rewards is ready” rows next to stored notices. */
export function empAlertDuplicatesNotice(
  emp: EmpAlertLike | null | undefined,
  notices: NoticeLike[] | null | undefined,
  userId: string,
): boolean {
  if (!emp || !userId) return false;
  const noticeKind =
    emp.phase === "plan_ready"
      ? "plan_ready"
      : emp.phase === "month_closed"
        ? "month_closed"
        : null;
  if (!noticeKind) return false;
  return (notices || []).some(
    (n) =>
      isNoticeOpenFor(n, userId) &&
      n.kind === noticeKind &&
      (n.month || "") === (emp.month || "") &&
      (n.planKind || "") === (emp.kind || ""),
  );
}

export function empAlertKeyForNotice(
  userId: string,
  n: NoticeLike | null | undefined,
): string | null {
  if (!userId || !n) return null;
  if (n.kind === "plan_ready") {
    return `emp:${userId}:${n.planKind || ""}:${n.month || ""}:plan_ready`;
  }
  if (n.kind === "month_closed") {
    return `emp:${userId}:${n.planKind || ""}:${n.month || ""}:month_closed`;
  }
  return null;
}

export function kpiScopeChip(kpi: KpiLike | null | undefined): {
  label: string;
  title: string;
  tone: "studio" | "team" | "function";
} | null {
  const scope = kpi?.scope;
  if (!scope || scope === "individual") return null;
  const name = String(kpi?.scopeLabel || "").trim();
  if (scope === "sbu") {
    return {
      label: name ? `SBU · ${name}` : "SBU",
      title: "SBU KPI — a label for discussion, scored on this person",
      tone: "studio",
    };
  }
  if (scope === "function") {
    return {
      label: name ? `Function · ${name}` : "Function",
      title: "Function KPI — a label for discussion, scored on this person",
      tone: "function",
    };
  }
  return {
    label: name ? `Team · ${name}` : "Team",
    title: "Team KPI — a label for discussion, scored on this person",
    tone: "team",
  };
}

export function firstNameOf(person: { firstName?: string | null; name?: string | null } | null | undefined): string {
  if (!person) return "";
  const first = String(person.firstName || "").trim();
  if (first) return first;
  return String(person.name || "").trim().split(/\s+/)[0] || "";
}

export function teamLabel(person: { firstName?: string | null; name?: string | null } | null | undefined): string {
  const name = String(person?.name || "").trim();
  if (name) return `${name}'s team`;
  const first = firstNameOf(person);
  return first ? `${first}'s team` : "Team";
}

export function peopleWithTeams(people: OrgPerson[] | null | undefined): OrgPerson[] {
  const bosses = new Set<string>();
  for (const p of people || []) {
    if ((p.status || "active") === "left") continue;
    if (p.managerId) bosses.add(p.managerId);
    for (const d of p.dottedLine || []) if (d?.managerId) bosses.add(d.managerId);
  }
  return (people || [])
    .filter((p) => bosses.has(p.id) && (p.status || "active") !== "left")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function sharedKpiKey(kpi: KpiLike | null | undefined): string | null {
  if (!kpi || !kpi.scope || kpi.scope === "individual") return null;
  return `${kpi.scope}|${kpi.scopeId || ""}|${String(kpi.name || "").trim().toLowerCase()}`;
}

type RecLike = {
  brands?: { kras?: KpiBrandKra[] }[] | null;
  kras?: KpiBrandKra[] | null;
};
type KpiBrandKra = { kpis?: (KpiLike & { children?: KpiLike[] | null })[] | null };

export function stampSharedAchieved(
  rec: RecLike | null | undefined,
  kpi: KpiLike | null | undefined,
  value: number | null,
): number {
  const key = sharedKpiKey(kpi);
  if (!key || !rec) return 0;
  let n = 0;
  const brands = rec.brands?.length ? rec.brands : rec.kras ? [{ kras: rec.kras }] : [];
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

/**
 * Do not steal the SBU revenue cell for score / audit KPIs.
 * Only an explicit linkTargetActual KPI reads the Targets sheet.
 */
export function linkedSbuActual(
  kpi: KpiLike | null | undefined,
  state: {
    currentMonth?: string | null;
    selectedMonth?: string | null;
    selectedTargetMonth?: string | null;
    targetNodes?: Record<string, TargetNode> | TargetNode[] | null;
    targetCells?: Record<string, TargetCell> | null;
  } | null | undefined,
  month?: string | null,
): number | null {
  if (!kpi || kpi.scope !== "sbu" || !kpi.linkTargetActual || !state) return null;
  const sbuId = kpi.scopeId;
  if (!sbuId) return null;
  const nodes = Array.isArray(state.targetNodes)
    ? state.targetNodes
    : Object.values(state.targetNodes || {});
  const node = nodes.find((n) => n && (n.sbuId === sbuId || n.id === sbuId));
  if (!node) return null;
  const months = [
    month,
    state.currentMonth,
    state.selectedMonth,
    state.selectedTargetMonth,
  ].filter((m, i, all): m is string => !!m && all.indexOf(m) === i);
  const cells = state.targetCells || {};
  for (const m of months) {
    const cell = cells[`${node.id}::${m}`];
    if (cell && cell.actual != null && cell.actual !== ("" as unknown)) {
      const n = Number(cell.actual);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export function effectiveAchieved(
  kpi: KpiLike | null | undefined,
  state?: Parameters<typeof linkedSbuActual>[1],
  month?: string | null,
): number | null {
  if (!kpi) return null;
  const linked = linkedSbuActual(kpi, state, month);
  if (linked != null) return linked;
  if (kpi.achieved == null || Number.isNaN(Number(kpi.achieved))) return null;
  return Number(kpi.achieved);
}
