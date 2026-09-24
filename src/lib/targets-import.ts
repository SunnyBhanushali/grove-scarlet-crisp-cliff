/** Spreadsheet → Targets. One row = one node in one month. Groups only from kind=group. */

export type TargetKind = "target" | "group";
export type TargetMode = "set" | "roll";

export type TargetImportRow = {
  row: number;
  month: string;
  kind: TargetKind;
  name: string;
  unit: string;
  parent_group: string;
  brand_or_sbu: string;
  mode: TargetMode;
  M1: number | null;
  M2: number | null;
  M3: number | null;
  M4: number | null;
  M5: number | null;
  actual: number | null;
};

export type TargetImportError = { row: number; message: string };

export type TargetImportReport = {
  ok: boolean;
  created: number;
  updated: number;
  nested: number;
  skipped: number;
  months: string[];
  replaced: string[];
  remapped?: number;
  unmapped?: number;
  unmappedRows?: UnmappedReward[];
  aborted?: boolean;
  needsConfirm?: boolean;
  /** Value cells (M1–M5, actual) in the file that change a stored value. */
  changed?: number;
  /** Value cells equal to what is stored (or blank where nothing is stored). */
  unchanged?: number;
  /** Blank value cells where the stored value is kept. */
  blankKept?: number;
  /** Targets on a replaced month that are not in the file (they leave that month). */
  removed?: number;
  errors: TargetImportError[];
};

type Node = {
  id: string;
  name: string;
  kind: "leaf" | "group";
  metric: string;
  sbuId: string | null;
  brandId: string;
  companyId?: string | null;
  createdAt: string;
};

type Cell = {
  nodeId: string;
  month: string;
  ladder: { M1: number; M2: number; M3: number; M4: number; M5: number };
  actual: number | null;
  mode: TargetMode;
  status: string;
};

type Member = { groupId: string; memberId: string; month: string };

type RewardMonthRec = {
  targetNodeId?: string | null;
  targetSbuId?: string | null;
  targetMetric?: string;
  [k: string]: unknown;
};

export type TargetImportState = {
  companies?: { id: string; name: string }[];
  brands?: { id: string; name: string; companyId?: string }[];
  businessUnits?: { id: string; name: string; brandId?: string }[];
  targetNodes?: Record<string, Node>;
  targetCells?: Record<string, Cell>;
  targetMembers?: Member[];
  targetRootOrder?: Record<string, string[]>;
  targetMonthStatus?: Record<string, string>;
  rewardRecords?: Record<string, Record<string, RewardMonthRec>>;
  rewardRoleMonths?: Record<string, Record<string, RewardMonthRec>>;
};

const COLS = [
  "month",
  "kind",
  "name",
  "unit",
  "parent_group",
  "brand_or_sbu",
  "mode",
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "actual",
] as const;

function norm(s: string) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function cellKey(id: string, month: string) {
  return `${id}::${month}`;
}

export function normalizeUnit(raw: string) {
  const t = String(raw || "").trim();
  const n = t.toLowerCase();
  if (!t || n === "revenue" || n === "inr" || n === "rs" || t === "₹" || n === "lakhs" || n === "crores") return "rupees";
  if (t === "%" || n === "pct" || n === "percentage") return "percent";
  if (n === "rupees" || n === "percent" || n === "count" || n === "score" || n === "index" || n === "days") return n;
  return t || "rupees";
}

export function parseMoney(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const t = String(raw).replace(/[₹\s,]/g, "").trim();
  if (!t) return null;
  const m = /^(-?[\d.]+)\s*(cr|l|k)?$/i.exec(t);
  if (!m) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || "").toLowerCase();
  if (u === "cr") return n * 1e7;
  if (u === "l") return n * 1e5;
  if (u === "k") return n * 1e3;
  return n;
}

export function parseMonth(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(Date.UTC(1899, 11, 30 + Math.round(raw)));
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const t = String(raw).trim();
  const iso = /^(\d{4})[-/](\d{1,2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  const alt = /^(\d{1,2})[-/](\d{4})$/.exec(t);
  if (alt) return `${alt[2]}-${alt[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}$/.test(t) ? t : null;
}

function parseKind(raw: unknown): TargetKind | null {
  const n = norm(String(raw || ""));
  if (n === "target" || n === "leaf" || n === "studio") return "target";
  if (n === "group" || n === "cluster") return "group";
  return null;
}

function parseMode(raw: unknown, kind: TargetKind): TargetMode {
  const n = norm(String(raw || ""));
  if (n === "roll" || n === "rollup") return "roll";
  if (n === "set") return "set";
  return kind === "group" ? "roll" : "set";
}

function headerIndex(header: string[]) {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const n = norm(h).replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
    map[n] = i;
  });
  const get = (...aliases: string[]) => {
    for (const a of aliases) if (a in map) return map[a];
    return -1;
  };
  return {
    month: get("month"),
    kind: get("kind"),
    name: get("name"),
    unit: get("unit", "metric"),
    parent_group: get("parent_group", "parent", "group"),
    brand_or_sbu: get("brand_or_sbu", "brand", "sbu", "org"),
    mode: get("mode"),
    M1: get("m1"),
    M2: get("m2"),
    M3: get("m3"),
    M4: get("m4"),
    M5: get("m5"),
    actual: get("actual"),
  };
}

export function rowsFromTable(table: string[][]): { rows: TargetImportRow[]; errors: TargetImportError[] } {
  const errors: TargetImportError[] = [];
  if (!table.length) return { rows: [], errors: [{ row: 1, message: "Empty sheet." }] };
  const idx = headerIndex(table[0]);
  if (idx.month < 0 || idx.kind < 0 || idx.name < 0) {
    return { rows: [], errors: [{ row: 1, message: "Need columns month, kind, name." }] };
  }
  const rows: TargetImportRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((line, i) => {
    const row = i + 2;
    const cell = (c: number) => (c < 0 ? "" : line[c] ?? "");
    if (line.every((v) => String(v || "").trim() === "")) return;
    const month = parseMonth(cell(idx.month));
    const kind = parseKind(cell(idx.kind));
    const name = String(cell(idx.name) || "").trim();
    if (!month && !kind && !name) return;
    if (!month) {
      errors.push({ row, message: "Month must be YYYY-MM." });
      return;
    }
    if (!kind) {
      errors.push({ row, message: "Kind must be target or group." });
      return;
    }
    if (!name) {
      errors.push({ row, message: "Name is required." });
      return;
    }
    const key = `${month}|${kind}|${norm(name)}`;
    if (seen.has(key)) {
      errors.push({ row, message: `Duplicate ${kind} “${name}” in ${month}.` });
      return;
    }
    seen.add(key);
    const unit = normalizeUnit(cell(idx.unit));
    const mode = parseMode(cell(idx.mode), kind);
    const money = (c: number) => parseMoney(cell(c));
    const M1 = money(idx.M1);
    const M2 = money(idx.M2);
    const M3 = money(idx.M3);
    const M4 = money(idx.M4);
    const M5 = money(idx.M5);
    if (mode === "set") {
      // A blank floor keeps the stored value (checked against it on apply);
      // the floors given must still go up.
      const ladder = [M1, M2, M3, M4, M5].filter((n) => n != null) as number[];
      for (let i = 1; i < ladder.length; i++) {
        if (ladder[i] <= ladder[i - 1]) {
          errors.push({ row, message: "M1–M5 must each be higher than the one before." });
          return;
        }
      }
    }
    rows.push({
      row,
      month,
      kind,
      name,
      unit,
      parent_group: String(cell(idx.parent_group) || "").trim(),
      brand_or_sbu: String(cell(idx.brand_or_sbu) || "").trim(),
      mode,
      M1,
      M2,
      M3,
      M4,
      M5,
      actual: money(idx.actual),
    });
  });
  return { rows, errors };
}

export function parseCsv(text: string) {
  const lines: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let q = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      cur.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cur.push(cell);
      cell = "";
      lines.push(cur);
      cur = [];
    } else cell += ch;
  }
  if (cell || cur.length) {
    cur.push(cell);
    lines.push(cur);
  }
  return rowsFromTable(lines);
}

function u8(buf: ArrayBuffer | Uint8Array) {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

function readStr(bytes: Uint8Array, start: number, n: number) {
  return new TextDecoder("utf-8").decode(bytes.subarray(start, start + n));
}

function inflateRaw(bytes: Uint8Array, inflate: (d: Uint8Array) => Uint8Array) {
  return inflate(bytes);
}

/** Minimal ZIP reader. `inflate` must be raw DEFLATE. */
export async function unzip(buffer: ArrayBuffer | Uint8Array, inflate: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>) {
  const bytes = u8(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip/xlsx file.");
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const files: Record<string, Uint8Array> = {};
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) throw new Error("Bad zip directory.");
    const method = view.getUint16(off + 10, true);
    const comp = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commLen = view.getUint16(off + 32, true);
    const local = view.getUint32(off + 42, true);
    const name = readStr(bytes, off + 46, nameLen);
    const dataOff = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const packed = bytes.subarray(dataOff, dataOff + comp);
    files[name] = method === 0 ? packed : await Promise.resolve(inflate(packed));
    off += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

function xmlText(xml: string, tag: string) {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function decodeXml(s: string) {
  const amp = "&" + "amp;";
  const lt = "&" + "lt;";
  const gt = "&" + "gt;";
  const quot = "&" + "quot;";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll(amp, "&")
    .replaceAll(lt, "<")
    .replaceAll(gt, ">")
    .replaceAll(quot, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function sharedStrings(xml: string) {
  const items: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const ts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1]));
    items.push(ts.join(""));
  }
  return items;
}

function colRow(ref: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { c: 0, r: 0 };
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { c: c - 1, r: Number(m[2]) };
}

function sheetTable(xml: string, sst: string[]) {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const line: string[] = [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[2] || "";
      const body = cm[3] || "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] || "";
      const t = /t="([^"]+)"/.exec(attrs)?.[1] || "";
      const { c, r } = colRow(ref);
      while (rows.length < r) rows.push([]);
      const row = rows[r - 1];
      while (row.length <= c) row.push("");
      let val = "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const is = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1];
      if (t === "s" && v != null) val = sst[Number(v)] ?? "";
      else if (is) val = [...is.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("");
      else if (v != null) val = v;
      row[c] = decodeXml(val);
    }
  }
  return rows.filter((r) => r.some((c) => String(c || "").trim() !== ""));
}

export async function xlsxSheets(
  buffer: ArrayBuffer | Uint8Array,
  inflate: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<{ name: string; rows: string[][] }[]> {
  const files = await unzip(buffer, inflate);
  const dec = new TextDecoder("utf-8");
  const wb = dec.decode(files["xl/workbook.xml"] || new Uint8Array());
  const rels = dec.decode(files["xl/_rels/workbook.xml.rels"] || new Uint8Array());
  const sst = files["xl/sharedStrings.xml"] ? sharedStrings(dec.decode(files["xl/sharedStrings.xml"])) : [];
  const ridToPath: Record<string, string> = {};
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="([^"]+)"/g)) {
    const id = m[1] || m[4];
    const target = m[2] || m[3];
    ridToPath[id] = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/>|<sheet\b([^>]*)>/g)) {
    const attrs = m[1] || m[2] || "";
    const name = /name="([^"]+)"/.exec(attrs)?.[1] || "";
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1] || "";
    const path = ridToPath[rid];
    if (name && path && files[path]) sheets.push({ name, path });
  }
  return sheets.map((s) => ({ name: s.name, rows: sheetTable(dec.decode(files[s.path]), sst) }));
}


export async function parseXlsx(buffer: ArrayBuffer | Uint8Array, inflate: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>) {
  const sheets = await xlsxSheets(buffer, inflate);
  const wanted =
    sheets.find((s) => norm(s.name) === "targets") ||
    sheets.find((s) => {
      const idx = headerIndex(s.rows[0] || []);
      return idx.month >= 0 && idx.kind >= 0 && idx.name >= 0;
    });
  if (!wanted) return { rows: [], errors: [{ row: 1, message: "No Targets sheet (need columns month, kind, name)." }] };
  return rowsFromTable(wanted.rows);
}

function findOrg(name: string, state: TargetImportState) {
  const n = norm(name).replace(/\.+$/, "");
  if (!n) return null;
  const unit = (state.businessUnits || []).find((u) => norm(u.name).replace(/\.+$/, "") === n);
  if (unit) {
    const brand = (state.brands || []).find((b) => b.id === unit.brandId);
    return { sbuId: unit.id, brandId: unit.brandId || "", companyId: brand?.companyId || null };
  }
  const brand = (state.brands || []).find((b) => norm(b.name).replace(/\.+$/, "") === n);
  if (brand) return { sbuId: null, brandId: brand.id, companyId: brand.companyId || null };
  const co = (state.companies || []).find((c) => norm(c.name).replace(/\.+$/, "") === n);
  if (co) return { sbuId: null, brandId: "", companyId: co.id };
  return "missing" as const;
}

function findNode(nodes: Record<string, Node>, kind: TargetKind, name: string) {
  return findReusableNode(nodes, kind, name, null, "");
}

export function nodeIdentityKey(name: string, sbuId: string | null | undefined, metric: string, kind?: string) {
  return `${kind === "group" ? "group" : "leaf"}|${norm(name)}|${sbuId || ""}|${norm(metric || "")}`;
}

/** Upsert key: name + sbuId + metric (+ kind). Unique name+kind is the fallback so old sheets still reuse ids. */
export function findReusableNode(
  nodes: Record<string, Node>,
  kind: TargetKind,
  name: string,
  sbuId: string | null | undefined,
  metric: string,
) {
  const want = kind === "group" ? "group" : "leaf";
  const all = Object.values(nodes).filter((n) => n.kind === want && norm(n.name) === norm(name));
  const exact = all.find(
    (n) => (n.sbuId || "") === (sbuId || "") && norm(n.metric || "") === norm(metric || ""),
  );
  if (exact) return exact;
  const sbuHit = sbuId ? all.filter((n) => (n.sbuId || "") === sbuId) : [];
  if (sbuHit.length === 1) return sbuHit[0];
  if (all.length === 1) return all[0];
  return undefined;
}

type RewardPointer = {
  kind: "record" | "roleMonth";
  period: string;
  personId?: string;
  roleId?: string;
  nodeId: string;
};

export type UnmappedReward = RewardPointer & { nodeName: string };

export function describeUnmapped(
  rows: UnmappedReward[],
  people?: { id: string; name?: string }[],
  roles?: Record<string, { name?: string }>,
): string[] {
  return (rows || []).map((r) => {
    const who =
      r.kind === "roleMonth"
        ? roles?.[r.roleId || ""]?.name || r.roleId || "Role"
        : people?.find((p) => p.id === r.personId)?.name || r.personId || "Person";
    return `${who} · ${r.period} · ${r.nodeName || r.nodeId}`;
  });
}

export function collectRewardPointers(
  state: Pick<TargetImportState, "rewardRecords" | "rewardRoleMonths">,
  months?: Set<string>,
): RewardPointer[] {
  const out: RewardPointer[] = [];
  for (const [period, people] of Object.entries(state.rewardRecords || {})) {
    if (months && !months.has(period)) continue;
    for (const [personId, rec] of Object.entries(people || {})) {
      const id = rec && rec.targetNodeId;
      if (id) out.push({ kind: "record", period, personId, nodeId: String(id) });
    }
  }
  for (const [roleId, byMonth] of Object.entries(state.rewardRoleMonths || {})) {
    if (!byMonth || typeof byMonth !== "object") continue;
    for (const [period, rec] of Object.entries(byMonth)) {
      if (months && !months.has(period)) continue;
      const id = rec && rec.targetNodeId;
      if (id) out.push({ kind: "roleMonth", period, roleId, nodeId: String(id) });
    }
  }
  return out;
}

function remapTargetId(
  oldId: string,
  orig: Record<string, Node>,
  nodes: Record<string, Node>,
  usedIds: Set<string>,
): string | null {
  if (usedIds.has(oldId)) return oldId;
  const old = orig[oldId] || nodes[oldId];
  if (!old) return null;
  const key = nodeIdentityKey(old.name, old.sbuId, old.metric || "", old.kind);
  for (const id of usedIds) {
    const n = nodes[id];
    if (!n) continue;
    if (nodeIdentityKey(n.name, n.sbuId, n.metric || "", n.kind) === key) return id;
  }
  return null;
}

function usedNodeIdsForMonths(
  cells: Record<string, Cell>,
  members: Member[],
  root: Record<string, string[]>,
  months: string[],
) {
  const used = new Set<string>();
  const want = new Set(months);
  for (const c of Object.values(cells)) {
    if (want.has(c.month)) used.add(c.nodeId);
  }
  for (const m of members) {
    if (!want.has(m.month)) continue;
    used.add(m.groupId);
    used.add(m.memberId);
  }
  for (const month of months) {
    for (const id of root[month] || []) used.add(id);
  }
  return used;
}

function clonePersonMonthMap(
  tree: Record<string, Record<string, RewardMonthRec>> | undefined,
): Record<string, Record<string, RewardMonthRec>> {
  const out: Record<string, Record<string, RewardMonthRec>> = {};
  for (const [a, inner] of Object.entries(tree || {})) {
    out[a] = {};
    for (const [b, rec] of Object.entries(inner || {})) {
      out[a][b] = { ...rec };
    }
  }
  return out;
}

function applyPointerRemap(
  state: TargetImportState,
  plan: { ptr: RewardPointer; next: string }[],
  nodes: Record<string, Node>,
): Pick<TargetImportState, "rewardRecords" | "rewardRoleMonths"> {
  const rewardRecords = clonePersonMonthMap(state.rewardRecords);
  const rewardRoleMonths = clonePersonMonthMap(state.rewardRoleMonths);
  for (const { ptr, next } of plan) {
    const node = nodes[next];
    if (ptr.kind === "record" && ptr.personId && rewardRecords[ptr.period]?.[ptr.personId]) {
      const rec = rewardRecords[ptr.period][ptr.personId];
      rec.targetNodeId = next;
      if (node) {
        rec.targetSbuId = node.sbuId;
        rec.targetMetric = node.metric;
      }
    }
    if (ptr.kind === "roleMonth" && ptr.roleId && rewardRoleMonths[ptr.roleId]?.[ptr.period]) {
      const rec = rewardRoleMonths[ptr.roleId][ptr.period];
      rec.targetNodeId = next;
      if (node) {
        rec.targetSbuId = node.sbuId;
        rec.targetMetric = node.metric;
      }
    }
  }
  return { rewardRecords, rewardRoleMonths };
}


function emptyLadder() {
  return { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0 };
}

const RUNGS = ["M1", "M2", "M3", "M4", "M5"] as const;

/**
 * A blank value cell in the file keeps the stored value; only an explicit
 * value (0 included) changes it. `prev` is the stored cell of the same
 * target in the same month (undefined for a new target / month).
 */
export function mergeImportRow(
  r: Pick<TargetImportRow, "mode" | "M1" | "M2" | "M3" | "M4" | "M5" | "actual">,
  prev: Pick<Cell, "ladder" | "actual"> | undefined,
): { ladder: Cell["ladder"]; actual: number | null; error?: string; counts: { changed: number; unchanged: number; blankKept: number } } {
  const counts = { changed: 0, unchanged: 0, blankKept: 0 };
  const count = (v: number | null, old: number | null | undefined) => {
    if (v == null) {
      if (prev && old != null) counts.blankKept++;
      else counts.unchanged++;
    } else if (prev && old === v) counts.unchanged++;
    else counts.changed++;
  };
  const prevLadder = (prev && prev.ladder) || null;
  let ladder: Cell["ladder"];
  let error: string | undefined;
  if (r.mode === "set") {
    const out = emptyLadder();
    let missing = false;
    for (const k of RUNGS) {
      const v = r[k];
      const old = prevLadder ? prevLadder[k] : undefined;
      count(v, old);
      if (v != null) out[k] = v;
      else if (old != null) out[k] = old;
      else missing = true;
    }
    ladder = out;
    if (missing) error = "mode=set needs M1–M5 (a blank keeps the current value; this target has none).";
    else {
      for (let i = 1; i < RUNGS.length; i++) {
        if (out[RUNGS[i]] <= out[RUNGS[i - 1]]) {
          error = "M1–M5 must each be higher than the one before (blank cells keep the current value).";
          break;
        }
      }
    }
  } else {
    // roll: floors come from the members; a group with no members keeps its floors.
    ladder = prevLadder ? { ...emptyLadder(), ...prevLadder } : emptyLadder();
  }
  const oldActual = prev ? prev.actual : undefined;
  count(r.actual, oldActual);
  const actual = r.actual != null ? r.actual : oldActual != null ? oldActual : null;
  return { ladder, actual, error, counts };
}

function rollFillMonth(
  nodes: Record<string, Node>,
  members: Member[],
  cells: Record<string, Cell>,
  month: string,
) {
  const seen = new Set<string>();
  function walk(id: string): Cell | undefined {
    const key = cellKey(id, month);
    const cell = cells[key];
    if (!cell) return;
    if (seen.has(id)) return cell;
    seen.add(id);
    const kids = members.filter((m) => m.groupId === id && m.month === month).map((m) => m.memberId);
    if (cell.mode !== "roll" || !kids.length) return cell;
    const L = emptyLadder();
    let actual: number | null = null;
    let anyA = false;
    for (const kid of kids) {
      const kc = walk(kid);
      if (!kc) continue;
      L.M1 += kc.ladder?.M1 || 0;
      L.M2 += kc.ladder?.M2 || 0;
      L.M3 += kc.ladder?.M3 || 0;
      L.M4 += kc.ladder?.M4 || 0;
      L.M5 += kc.ladder?.M5 || 0;
      if (kc.actual != null) {
        anyA = true;
        actual = (actual || 0) + kc.actual;
      }
    }
    cells[key] = { ...cell, ladder: L, actual: anyA ? actual : cell.actual };
    return cells[key];
  }
  for (const n of Object.values(nodes)) walk(n.id);
}

function isOpen(status: string | undefined) {
  const s = String(status || "plan_open").toLowerCase();
  return s === "plan_open" || s === "open" || s === "draft" || !status;
}

export function monthHasLayout(state: TargetImportState, month: string) {
  if ((state.targetMonthStatus || {})[month]) return true;
  if ((state.targetRootOrder || {})[month]?.length) return true;
  if ((state.targetMembers || []).some((m) => m.month === month)) return true;
  return Object.values(state.targetCells || {}).some((c) => c.month === month);
}

export function monthsAlreadyLaid(state: TargetImportState, months: string[]) {
  return months.filter((m) => monthHasLayout(state, m));
}

function wipeMonth(
  month: string,
  cells: Record<string, Cell>,
  members: Member[],
  root: Record<string, string[]>,
) {
  for (const key of Object.keys(cells)) {
    if (cells[key].month === month || key.endsWith(`::${month}`)) delete cells[key];
  }
  for (let i = members.length - 1; i >= 0; i--) {
    if (members[i].month === month) members.splice(i, 1);
  }
  root[month] = [];
}

export function applyTargetImport(
  state: TargetImportState,
  rows: TargetImportRow[],
  opts: { allowClosed?: boolean } = {},
): { state: TargetImportState; report: TargetImportReport } {
  const allowClosed = opts.allowClosed !== false;
  const nodes: Record<string, Node> = { ...(state.targetNodes || {}) };
  const cells: Record<string, Cell> = { ...(state.targetCells || {}) };
  const members: Member[] = [...(state.targetMembers || [])];
  const root: Record<string, string[]> = { ...(state.targetRootOrder || {}) };
  const status: Record<string, string> = { ...(state.targetMonthStatus || {}) };
  const errors: TargetImportError[] = [];
  const prevCells: Record<string, Cell> = state.targetCells || {};
  const merged = new Map<number, ReturnType<typeof mergeImportRow>>();
  let changed = 0;
  let unchanged = 0;
  let blankKept = 0;
  let created = 0;
  let updated = 0;
  let nested = 0;
  let skipped = 0;
  const months = [...new Set(rows.map((r) => r.month))].sort();
  let seq = 0;
  const idOf: Record<string, string> = {};

  for (const month of months) {
    if (!status[month]) status[month] = "plan_open";
  }

  for (const r of rows) {
    const st = status[r.month];
    if (!allowClosed && !isOpen(st)) {
      errors.push({ row: r.row, message: `${r.month} is locked or closed.` });
      skipped++;
      continue;
    }
    if (r.brand_or_sbu) {
      const org = findOrg(r.brand_or_sbu, state);
      if (org === "missing") {
        errors.push({ row: r.row, message: `No org named “${r.brand_or_sbu}”.` });
        skipped++;
        continue;
      }
    }
    // Blank cells keep the stored value of the same target in the same month.
    const org = r.brand_or_sbu ? findOrg(r.brand_or_sbu, state) : null;
    const scope = org && org !== "missing" ? org : { sbuId: null as string | null };
    const hit = findReusableNode(nodes, r.kind, r.name, scope.sbuId, r.unit);
    const m = mergeImportRow(r, hit ? prevCells[cellKey(hit.id, r.month)] : undefined);
    if (m.error) {
      errors.push({ row: r.row, message: m.error });
      skipped++;
      continue;
    }
    merged.set(r.row, m);
  }

  const usable = rows.filter((r) => !errors.some((e) => e.row === r.row));
  const wipeMonths = [...new Set(usable.map((r) => r.month))];
  const replaced = monthsAlreadyLaid({ targetCells: cells, targetMembers: members, targetRootOrder: root, targetMonthStatus: status }, wipeMonths);
  for (const month of wipeMonths) wipeMonth(month, cells, members, root);

  for (const r of usable) {
    const kind = r.kind === "group" ? "group" : "leaf";
    const org = r.brand_or_sbu ? findOrg(r.brand_or_sbu, state) : null;
    const scope = org && org !== "missing" ? org : { sbuId: null as string | null, brandId: "", companyId: null as string | null };
    let node = findReusableNode(nodes, r.kind, r.name, scope.sbuId, r.unit);
    if (!node) {
      seq += 1;
      const id = `tn-imp-${seq}-${Math.random().toString(36).slice(2, 8)}`;
      node = {
        id,
        name: r.name,
        kind,
        metric: r.unit,
        sbuId: scope.sbuId,
        brandId: scope.brandId,
        companyId: scope.companyId,
        createdAt: new Date().toISOString(),
      };
      nodes[id] = node;
      created++;
    } else {
      if (org && org !== "missing") {
        node = { ...node, name: r.name, metric: r.unit, sbuId: org.sbuId, brandId: org.brandId, companyId: org.companyId };
        nodes[node.id] = node;
      } else {
        node = { ...node, name: r.name, metric: r.unit };
        nodes[node.id] = node;
      }
    }
    idOf[`${r.month}|${r.kind}|${norm(r.name)}`] = node.id;
    const key = cellKey(node.id, r.month);
    const had = !!prevCells[key];
    // Merged against the stored cell before the month was cleared (blank = keep).
    const m = merged.get(r.row) || mergeImportRow(r, prevCells[key]);
    changed += m.counts.changed;
    unchanged += m.counts.unchanged;
    blankKept += m.counts.blankKept;
    cells[key] = {
      nodeId: node.id,
      month: r.month,
      ladder: m.ladder,
      actual: m.actual,
      mode: r.mode,
      status: "open",
    };
    if (had) updated++;
    const order = root[r.month] || [];
    if (!order.includes(node.id)) root[r.month] = [...order, node.id];
  }

  // Detach then nest from the sheet only — never from org parents.
  for (const r of usable) {
    const id = idOf[`${r.month}|${r.kind}|${norm(r.name)}`];
    if (!id) continue;
    for (let i = members.length - 1; i >= 0; i--) {
      if (members[i].month === r.month && members[i].memberId === id) members.splice(i, 1);
    }
  }
  for (const r of usable) {
    const id = idOf[`${r.month}|${r.kind}|${norm(r.name)}`];
    if (!id) continue;
    const parentName = r.parent_group;
    if (!parentName) {
      const order = (root[r.month] || []).filter((x) => x !== id);
      root[r.month] = [...order, id];
      continue;
    }
    const parent = findNode(nodes, "group", parentName);
    if (!parent) {
      errors.push({ row: r.row, message: `No group named “${parentName}” in this file.` });
      skipped++;
      continue;
    }
    if (parent.id === id) {
      errors.push({ row: r.row, message: "A group cannot sit under itself." });
      skipped++;
      continue;
    }
    members.push({ groupId: parent.id, memberId: id, month: r.month });
    root[r.month] = (root[r.month] || []).filter((x) => x !== id);
    if (!(root[r.month] || []).includes(parent.id) && !members.some((m) => m.month === r.month && m.memberId === parent.id)) {
      root[r.month] = [...(root[r.month] || []).filter((x) => x !== parent.id), parent.id];
    }
    nested++;
  }

  for (const month of wipeMonths) rollFillMonth(nodes, members, cells, month);

  const usedIds = usedNodeIdsForMonths(cells, members, root, wipeMonths);
  let removed = 0;
  for (const [key, c] of Object.entries(prevCells)) {
    const month = c && (c.month || key.slice(key.lastIndexOf("::") + 2));
    if (c && wipeMonths.includes(month) && !usedIds.has(c.nodeId)) removed++;
  }
  const origNodes = state.targetNodes || {};
  const ptrs = collectRewardPointers(state, new Set(wipeMonths));
  const remapPlan: { ptr: RewardPointer; next: string }[] = [];
  const unmapped: RewardPointer[] = [];
  for (const ptr of ptrs) {
    const next = remapTargetId(ptr.nodeId, origNodes, nodes, usedIds);
    if (!next) unmapped.push(ptr);
    else if (next !== ptr.nodeId) remapPlan.push({ ptr, next });
  }

  const remappedMaps = remapPlan.length ? applyPointerRemap(state, remapPlan, nodes) : null;
  const unmappedRows: UnmappedReward[] = unmapped.map((ptr) => ({
    ...ptr,
    nodeName: (origNodes[ptr.nodeId] || nodes[ptr.nodeId])?.name || ptr.nodeId,
  }));

  return {
    state: {
      ...state,
      targetNodes: nodes,
      targetCells: cells,
      targetMembers: members,
      targetRootOrder: root,
      targetMonthStatus: status,
      ...(remappedMaps || {}),
    },
    report: {
      ok: errors.length === 0,
      created,
      updated,
      nested,
      skipped,
      months,
      replaced,
      remapped: remapPlan.length,
      unmapped: unmapped.length,
      unmappedRows,
      aborted: false,
      needsConfirm: unmapped.length > 0,
      changed,
      unchanged,
      blankKept,
      removed,
      errors,
    },
  };
}

export { COLS };
