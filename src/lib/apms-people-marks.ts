/** People-list marks. Client-only display. */

export type PersonLite = {
  id: string;
  managerId?: string | null;
  dottedLine?: Array<{ managerId?: string | null; functionId?: string | null; personId?: string | null } | string | null> | null;
  status?: string | null;
  name?: string;
};

export function isLeft(p: PersonLite): boolean {
  return (p.status || "active") === "left";
}

/** Unique people who report to `id` (solid or dotted). */
export function reporteeIds(people: PersonLite[], id: string): string[] {
  const out: string[] = [];
  for (const p of people) {
    if (!p || p.id === id || isLeft(p)) continue;
    const solid = p.managerId === id;
    const dotted = (p.dottedLine || []).some((d) => {
      if (!d) return false;
      if (typeof d === "string") return d === id;
      return d.managerId === id || d.personId === id;
    });
    if (solid || dotted) out.push(p.id);
  }
  return out;
}

export function hasMultipleReportees(people: PersonLite[], id: string): boolean {
  return reporteeIds(people, id).length > 1;
}

export function extraManagerIds(person: PersonLite): string[] {
  const primary = person.managerId || "";
  const ids: string[] = [];
  for (const d of person.dottedLine || []) {
    if (!d) continue;
    const id = typeof d === "string" ? d : d.managerId || (d as { personId?: string }).personId;
    if (id && id !== primary) ids.push(id);
  }
  return [...new Set(ids)];
}

export function dottedManagerIds(person: PersonLite): string[] {
  return extraManagerIds(person);
}

/** Primary + at least one other manager. Manager chips only show for these people. */
export function isMultiReporting(person: PersonLite | null | undefined): boolean {
  if (!person) return false;
  const ids = new Set(
    [person.managerId, ...extraManagerIds(person)].filter(Boolean) as string[],
  );
  return ids.size > 1;
}

export function viewerBosses(
  people: PersonLite[],
  viewer: PersonLite | null | undefined,
): { primary: PersonLite | null; dotted: PersonLite[] } {
  if (!viewer) return { primary: null, dotted: [] };
  const byId = (id: string) => people.find((p) => p.id === id) || null;
  const primary = viewer.managerId ? byId(viewer.managerId) : null;
  const dotted = dottedManagerIds(viewer)
    .map((id) => byId(id))
    .filter((p): p is PersonLite => !!p);
  return { primary, dotted };
}

/** People on this team (except the viewer) who have at least one reportee in the team. */
export function managersOnTeam(pool: PersonLite[], viewerId: string): PersonLite[] {
  return pool.filter((p) => p.id !== viewerId && reporteeIds(pool, p.id).length > 0);
}
