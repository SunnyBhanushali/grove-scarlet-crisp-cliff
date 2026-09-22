/** Spreadsheet → Rewards plans. One row = one KPI in one person-month. */

import { parseMonth, parseMoney, xlsxSheets } from "./targets-import.ts";

export type RewardImportRow = {
  row: number;
  month: string;
  email: string;
  name: string;
  status: string;
  unlock_against: string;
  kra: string;
  kra_weight: number | null;
  kpi: string;
  parent_kpi: string;
  kpi_weight: number | null;
  unit: string;
  target: number | null;
  floor: number | null;
  achieved: number | null;
  lower_is_better: boolean;
  notes: string;
};

export type RewardImportError = { row: number; message: string };

export type RewardImportReport = {
  ok: boolean;
  created: number;
  updated: number;
  kpis: number;
  skipped: number;
  months: string[];
  people: number;
  errors: RewardImportError[];
};

type Person = {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  roleId?: string | null;
  gateUnitId?: string | null;
};

type KpiNode = {
  id: string;
  name: string;
  weight: number;
  unit: string;
  target: number;
  floor: number;
  ranges: {
    high: { min: number; max: number };
    mid: { min: number; max: number };
    low: { min: number; max: number };
  };
  achieved: number | null;
  lowerIsBetter: boolean;
  children: KpiNode[];
  scope?: "individual" | "team" | "sbu";
  scopeId?: string;
  scopeLabel?: string;
};

type Kra = {
  id: string;
  name: string;
  weight: number;
  responsibilities: unknown[];
  performanceOutcomes: unknown[];
  executionOutcomes: unknown[];
  kpis: KpiNode[];
};

type MonthRecord = {
  status: string;
  kras: Kra[];
  brands: { id: string; brandId: string; name: string; weight: number; kras: Kra[] }[];
  priorities: unknown[];
  values: unknown[];
  notes: string;
  selfNotes: string;
  dq: unknown;
  authors: unknown[];
  scoring: { phase: string };
  heldRoleId?: string | null;
  heldRoleName?: string;
  gateUnitId?: string | null;
  targetNodeId?: string | null;
  rewardFlags?: unknown[];
};

export type RewardImportState = {
  people?: Person[];
  roles?: Record<string, { id?: string; name?: string }>;
  months?: string[];
  rewardRecords?: Record<string, Record<string, MonthRecord>>;
  targetNodes?: Record<string, { id: string; name: string }>;
  valuesCatalog?: unknown[];
};

const COLS = [
  "month",
  "email",
  "name",
  "status",
  "unlock_against",
  "kra",
  "kra_weight",
  "kpi",
  "parent_kpi",
  "kpi_weight",
  "unit",
  "target",
  "floor",
  "achieved",
  "lower_is_better",
  "notes",
] as const;

function norm(s: string) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
    email: get("email", "username", "login"),
    name: get("name", "person", "employee"),
    status: get("status"),
    unlock_against: get("unlock_against", "unlock", "target", "unlock_target"),
    kra: get("kra", "kra_name"),
    kra_weight: get("kra_weight", "kra_wt"),
    kpi: get("kpi", "kpi_name"),
    parent_kpi: get("parent_kpi", "kpi_parent"),
    kpi_weight: get("kpi_weight", "kpi_wt"),
    unit: get("unit", "metric"),
    target: get("target"),
    floor: get("floor"),
    achieved: get("achieved", "actual"),
    lower_is_better: get("lower_is_better", "lower"),
    notes: get("notes", "note"),
  };
}

export function parseStatus(raw: unknown): string {
  const n = norm(String(raw || ""));
  if (!n || n === "open" || n === "plan_open" || n === "draft") return "plan_open";
  if (n === "locked" || n === "plan_locked" || n === "lock") return "plan_locked";
  if (n === "closed" || n === "close") return "closed";
  return "plan_open";
}

export function parseWeight(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const t = String(raw).replace(/%/g, "").trim();
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > 1.5) return n / 100;
  return n;
}

function parseBool(raw: unknown): boolean {
  const n = norm(String(raw || ""));
  return n === "1" || n === "yes" || n === "true" || n === "y";
}

export function normalizeKpiUnit(raw: string) {
  const t = String(raw || "").trim();
  const n = t.toLowerCase();
  if (!t || t === "%" || n === "pct" || n === "percentage") return "%";
  if (n === "rupees" || n === "inr" || n === "rs" || t === "₹" || n === "revenue") return "rupees";
  if (n === "count" || n === "score" || n === "index" || n === "days" || n === "percent") return n === "percent" ? "%" : n;
  return t;
}

export function rowsFromTable(table: string[][]): { rows: RewardImportRow[]; errors: RewardImportError[] } {
  const errors: RewardImportError[] = [];
  if (!table.length) return { rows: [], errors: [{ row: 1, message: "Empty sheet." }] };
  const idx = headerIndex(table[0]);
  if (idx.month < 0 || (idx.email < 0 && idx.name < 0)) {
    return { rows: [], errors: [{ row: 1, message: "Need columns month and email (or name)." }] };
  }
  const rows: RewardImportRow[] = [];
  table.slice(1).forEach((line, i) => {
    const row = i + 2;
    const cell = (c: number) => (c < 0 ? "" : line[c] ?? "");
    if (line.every((v) => String(v || "").trim() === "")) return;
    const month = parseMonth(cell(idx.month));
    const email = String(cell(idx.email) || "").trim();
    const name = String(cell(idx.name) || "").trim();
    const kra = String(cell(idx.kra) || "").trim();
    const kpi = String(cell(idx.kpi) || "").trim();
    if (!month && !email && !name && !kra && !kpi) return;
    if (!month) {
      errors.push({ row, message: "Month must be YYYY-MM." });
      return;
    }
    if (!email && !name) {
      errors.push({ row, message: "Need an email or a name." });
      return;
    }
    rows.push({
      row,
      month,
      email,
      name,
      status: parseStatus(cell(idx.status)),
      unlock_against: String(cell(idx.unlock_against) || "").trim(),
      kra,
      kra_weight: parseWeight(cell(idx.kra_weight)),
      kpi,
      parent_kpi: String(cell(idx.parent_kpi) || "").trim(),
      kpi_weight: parseWeight(cell(idx.kpi_weight)),
      unit: normalizeKpiUnit(cell(idx.unit)),
      target: parseMoney(cell(idx.target)),
      floor: parseMoney(cell(idx.floor)),
      achieved: parseMoney(cell(idx.achieved)),
      lower_is_better: parseBool(cell(idx.lower_is_better)),
      notes: String(cell(idx.notes) || "").trim(),
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

export async function parseXlsx(
  buffer: ArrayBuffer | Uint8Array,
  inflate: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>,
) {
  const sheets = await xlsxSheets(buffer, inflate);
  const wanted =
    sheets.find((s) => ["kpis", "plans", "rewards"].includes(norm(s.name))) ||
    sheets.find((s) => {
      const idx = headerIndex(s.rows[0] || []);
      return idx.month >= 0 && (idx.email >= 0 || idx.name >= 0);
    });
  if (!wanted) return { rows: [], errors: [{ row: 1, message: "No Plans/KPIs sheet (need columns month, email)." }] };
  return rowsFromTable(wanted.rows);
}

function findPerson(people: Person[], email: string, name: string): Person | null {
  const em = norm(email);
  if (em) {
    const hit = people.find((p) => norm(p.email || "") === em || norm(p.username || "") === em);
    if (hit) return hit;
  }
  const nm = norm(name);
  if (!nm) return null;
  const hits = people.filter((p) => norm(p.name || "") === nm);
  return hits.length === 1 ? hits[0] : null;
}

function findTarget(nodes: Record<string, { id: string; name: string }> | undefined, name: string) {
  const n = norm(name);
  if (!n || !nodes) return null;
  return Object.values(nodes).find((t) => norm(t.name) === n) || null;
}

function isOpen(status: string | undefined) {
  const s = String(status || "plan_open").toLowerCase();
  return s === "plan_open" || s === "open" || s === "draft" || !status;
}

function emptyRecord(person: Person, roleName?: string): MonthRecord {
  return {
    status: "plan_open",
    kras: [],
    brands: [],
    priorities: [],
    values: [],
    notes: "",
    selfNotes: "",
    dq: null,
    authors: [],
    scoring: { phase: "idle" },
    heldRoleId: person.roleId || null,
    heldRoleName: roleName,
    gateUnitId: person.gateUnitId || "",
    targetNodeId: null,
    rewardFlags: [],
  };
}

function makeKpi(id: string, r: RewardImportRow): KpiNode {
  const target = r.target ?? 0;
  const floor = r.floor != null ? r.floor : r.unit === "%" ? Math.round(target * 0.6 * 100) / 100 : 0;
  return {
    id,
    name: r.kpi,
    weight: r.kpi_weight ?? 0,
    unit: r.unit || "%",
    target,
    floor,
    ranges: {
      high: { min: floor, max: target },
      mid: { min: floor, max: floor },
      low: { min: 0, max: floor },
    },
    achieved: r.achieved,
    lowerIsBetter: r.lower_is_better,
    children: [],
  };
}

function normalizeGroupWeights<T extends { weight: number }>(items: T[]) {
  const sum = items.reduce((a, b) => a + (b.weight || 0), 0);
  if (sum > 1.5) items.forEach((i) => (i.weight = i.weight / 100));
  const next = items.reduce((a, b) => a + (b.weight || 0), 0);
  if (next < 0.005 && items.length) items.forEach((i) => (i.weight = 1 / items.length));
}

export function applyRewardImport(
  state: RewardImportState,
  rows: RewardImportRow[],
  opts: { allowClosed?: boolean } = {},
): { state: RewardImportState; report: RewardImportReport } {
  const allowClosed = opts.allowClosed !== false;
  const people = state.people || [];
  const roles = state.roles || {};
  const records: Record<string, Record<string, MonthRecord>> = {};
  for (const [month, map] of Object.entries(state.rewardRecords || {})) {
    records[month] = { ...map };
  }
  const months = new Set(state.months || []);
  const errors: RewardImportError[] = [];
  let created = 0;
  let updated = 0;
  let kpis = 0;
  let skipped = 0;
  let seq = 0;
  const seenPeople = new Set<string>();
  const groups = new Map<string, RewardImportRow[]>();

  for (const r of rows) {
    const person = findPerson(people, r.email, r.name);
    if (!person) {
      errors.push({ row: r.row, message: `No person for ${r.email || r.name}.` });
      skipped++;
      continue;
    }
    const rec = records[r.month]?.[person.id];
    if (!allowClosed && rec && !isOpen(rec.status)) {
      errors.push({ row: r.row, message: `${r.name || r.email} ${r.month} is locked or closed.` });
      skipped++;
      continue;
    }
    if (r.unlock_against) {
      const node = findTarget(state.targetNodes, r.unlock_against);
      if (!node) {
        errors.push({ row: r.row, message: `No target named “${r.unlock_against}”.` });
        skipped++;
        continue;
      }
    }
    const key = `${r.month}|${person.id}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  for (const [key, list] of groups) {
    const [month, personId] = key.split("|");
    const person = people.find((p) => p.id === personId)!;
    months.add(month);
    seenPeople.add(personId);
    if (!records[month]) records[month] = {};
    const had = !!records[month][personId];
    const rec = had ? { ...records[month][personId] } : emptyRecord(person, person.roleId ? roles[person.roleId]?.name : undefined);
    rec.heldRoleId = person.roleId || rec.heldRoleId;
    rec.heldRoleName = person.roleId ? roles[person.roleId]?.name : rec.heldRoleName;
    rec.gateUnitId = person.gateUnitId || rec.gateUnitId;
    const head = list[0];
    rec.status = head.status || rec.status || "plan_open";
    rec.notes = list.find((r) => r.notes)?.notes || rec.notes || "";
    const unlock = list.find((r) => r.unlock_against)?.unlock_against;
    if (unlock) {
      const node = findTarget(state.targetNodes, unlock);
      if (node) rec.targetNodeId = node.id;
    }
    const kraRows = list.filter((r) => r.kra);
    if (kraRows.length) {
      const kraOrder: string[] = [];
      const kraMap = new Map<string, { name: string; weight: number | null; kpis: RewardImportRow[] }>();
      for (const r of kraRows) {
        const k = norm(r.kra);
        if (!kraMap.has(k)) {
          kraMap.set(k, { name: r.kra, weight: r.kra_weight, kpis: [] });
          kraOrder.push(k);
        } else if (r.kra_weight != null && kraMap.get(k)!.weight == null) {
          kraMap.get(k)!.weight = r.kra_weight;
        }
        if (r.kpi) kraMap.get(k)!.kpis.push(r);
      }
      const kras: Kra[] = [];
      for (const k of kraOrder) {
        const g = kraMap.get(k)!;
        seq += 1;
        const kra: Kra = {
          id: `kra-imp-${seq}`,
          name: g.name,
          weight: g.weight ?? 0,
          responsibilities: [],
          performanceOutcomes: [],
          executionOutcomes: [],
          kpis: [],
        };
        const byName = new Map<string, KpiNode>();
        const pending: { row: RewardImportRow; node: KpiNode }[] = [];
        for (const r of g.kpis) {
          seq += 1;
          const node = makeKpi(`kpi-imp-${seq}`, r);
          pending.push({ row: r, node });
          if (!r.parent_kpi) byName.set(norm(r.kpi), node);
        }
        for (const { row, node } of pending) {
          if (!row.parent_kpi) {
            kra.kpis.push(node);
            continue;
          }
          const parent = byName.get(norm(row.parent_kpi));
          if (!parent) {
            errors.push({ row: row.row, message: `No parent KPI “${row.parent_kpi}” under ${g.name}.` });
            skipped++;
            continue;
          }
          parent.children.push(node);
          kpis++;
        }
        kpis += kra.kpis.length;
        normalizeGroupWeights(kra.kpis);
        for (const kpi of kra.kpis) if (kpi.children.length) normalizeGroupWeights(kpi.children);
        kras.push(kra);
      }
      normalizeGroupWeights(kras);
      rec.kras = kras;
      rec.brands = [
        {
          id: `bb-all-imp-${month}-${personId}`,
          brandId: "all",
          name: "All brands",
          weight: 1,
          kras,
        },
      ];
    }
    records[month][personId] = rec;
    if (had) updated++;
    else created++;
  }

  return {
    state: {
      ...state,
      months: [...months].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort(),
      rewardRecords: records,
    },
    report: {
      ok: errors.length === 0,
      created,
      updated,
      kpis,
      skipped,
      months: [...new Set(rows.map((r) => r.month))].sort(),
      people: seenPeople.size,
      errors,
    },
  };
}

export { COLS };
