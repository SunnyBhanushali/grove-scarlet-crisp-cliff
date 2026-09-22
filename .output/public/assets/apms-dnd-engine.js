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
  if (!prev) return null;
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
  if (!prev) return null;
  const prefix = active.key.slice(0, active.key.length - active.id.length);
  if (target.depth === prev.depth + 1) return { overKey: prefix + prev.id, mode: "inside" };
  if (next && target.depth <= next.depth) return { overKey: prefix + next.id, mode: "before" };
  return { overKey: prefix + prev.id, mode: "after" };
}
