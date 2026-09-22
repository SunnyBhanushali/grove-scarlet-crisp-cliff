/** Pointer-slot math for People / functions / SBU / targets / roles trees. */
export const DND_INDENT = 28;
export const DND_THRESHOLD = 4;
export const DND_DROP_MS = 260;

export function projectSlot(rows, rects, a, pageY, dx, indent, minFloor) {
  indent = indent == null ? 28 : indent;
  minFloor = minFloor == null ? 1 : minFloor;
  const n = rows.length;
  if (!n || a < 0 || a >= n || !rects[a]) return null;
  let over = -1;
  for (let i = 0; i < n; i++) {
    if (pageY >= rects[i].top && pageY < rects[i].bottom) {
      over = i;
      break;
    }
  }
  if (over === -1) over = pageY < rects[0].top ? 0 : n - 1;
  const others = rows.filter((_, i) => i !== a);
  if (!others.length) return null;
  const t = Math.max(minFloor, Math.min(over, others.length));
  const prev = others[t - 1];
  const next = others[t];
  if (!prev) {
    if (!next) return null;
    return { t, depth: next.depth, parentId: null };
  }
  const maxDepth = prev.depth + 1;
  const minDepth = next ? Math.max(minFloor, next.depth) : minFloor;
  const wanted = rows[a].depth + Math.round(dx / indent);
  const depth = Math.max(minDepth, Math.min(maxDepth, wanted));
  let parentId = null;
  for (let i = t - 1; i >= 0; i--) {
    if (others[i].depth === depth - 1) {
      parentId = others[i].id;
      break;
    }
  }
  return { t, depth, parentId };
}

export function shiftsFor(a, t, n, h) {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === a) {
      out[i] = (t - a) * h;
      continue;
    }
    const p = i < a ? i : i - 1;
    const q = p < t ? p : p + 1;
    out[i] = (q - i) * h;
  }
  return out;
}

export function slotToDrop(rows, a, target) {
  const active = rows[a];
  if (!active || !target) return null;
  const others = rows.filter((_, i) => i !== a);
  const prev = others[target.t - 1];
  const next = others[target.t];
  if (!prev) {
    if (next) return { overKey: next.key, mode: "before" };
    return null;
  }
  if (target.depth === prev.depth + 1) return { overKey: prev.key, mode: "inside" };
  if (next && target.depth <= next.depth) return { overKey: next.key, mode: "before" };
  return { overKey: prev.key, mode: "after" };
}

export function applyPlanDrop(kras, activeId, overKey, mode) {
  const overId = String(overKey || "").split(":").slice(1).join(":");
  if (!activeId || !overId || overId === activeId || overId === "root" || overId === "__head") return kras;
  const next = kras.map((k) => Object.assign({}, k, { kpis: (k.kpis || []).slice() }));
  function find(list, id) {
    for (let ki = 0; ki < list.length; ki++) {
      if (list[ki].id === id) return { kind: "kra", ki };
      const pi = (list[ki].kpis || []).findIndex((p) => p.id === id);
      if (pi >= 0) return { kind: "kpi", ki, pi };
    }
    return null;
  }
  const src = find(next, activeId);
  const dst = find(next, overId);
  if (!src || !dst) return kras;
  if (src.kind === "kra") {
    const item = next[src.ki];
    const rest = next.filter((_, i) => i !== src.ki);
    const dstKraId = next[dst.ki].id;
    const di = rest.findIndex((k) => k.id === dstKraId);
    if (di < 0) return kras;
    rest.splice(mode === "before" ? di : di + 1, 0, item);
    return rest;
  }
  const kpi = next[src.ki].kpis[src.pi];
  next[src.ki].kpis.splice(src.pi, 1);
  const dst2 = find(next, overId);
  if (!dst2) return kras;
  if (dst2.kind === "kra") {
    const list = next[dst2.ki].kpis;
    if (mode === "after") list.push(kpi);
    else list.unshift(kpi);
    return next;
  }
  const list = next[dst2.ki].kpis;
  let at = dst2.pi;
  if (mode === "after" || mode === "inside") at = dst2.pi + 1;
  list.splice(at, 0, kpi);
  return next;
}
