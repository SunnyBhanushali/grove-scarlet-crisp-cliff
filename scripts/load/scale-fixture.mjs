#!/usr/bin/env node
/**
 * PERF: production-sized fixture from the seed (src/lib/company-seed.json).
 * Live (p0as81 measurements): 180 people, company wire ≈ 5.8 MB, backup ≈ 14 MB.
 * The seed has the same 180 people but few month / reward records; this clones
 * existing records onto more people × months (ids rewritten) until the
 * collections reach live's volume. Output: a snapshot JSON the load DB boots from.
 *   node scripts/load/scale-fixture.mjs [out.json] [--records=N] [--rewards=N]
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || "/tmp/apms-load-fixture.json";
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
};
const TARGET_RECORDS = arg("records", 240); // month_records rows (~12 KB each)
const TARGET_REWARDS = arg("rewards", 180); // reward_records rows
const TARGET_CELLS = arg("cells", 420);
const TARGET_HISTORY = arg("history", 900);
const TARGET_NOTICES = arg("notices", 450);

const seed = JSON.parse(readFileSync(new URL("../../src/lib/company-seed.json", import.meta.url), "utf8"));
const people = (seed.people || []).filter((p) => p && p.id && p.status !== "left");
const periods = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

function fillPeriodTree(tree, want) {
  const templates = [];
  for (const month of Object.values(tree || {})) for (const rec of Object.values(month || {})) templates.push(rec);
  if (!templates.length) return tree;
  let count = templates.length;
  let i = 0;
  for (const period of periods) {
    tree[period] = tree[period] || {};
    for (const person of people) {
      if (count >= want) return tree;
      if (tree[period][person.id]) continue;
      const tpl = templates[i++ % templates.length];
      const copy = JSON.parse(JSON.stringify(tpl));
      copy.personId = person.id;
      if ("period" in copy) copy.period = period;
      if ("month" in copy) copy.month = period;
      if ("id" in copy) copy.id = `${person.id}::${period}`;
      delete copy.rev;
      tree[period][person.id] = copy;
      count++;
    }
  }
  return tree;
}

seed.records = fillPeriodTree(seed.records, TARGET_RECORDS);
seed.rewardRecords = fillPeriodTree(seed.rewardRecords, TARGET_REWARDS);

// Target cells: the same nodes in more months.
const cells = seed.targetCells || {};
const cellTpl = Object.values(cells);
const nodeIds = Object.keys(seed.targetNodes || {});
const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", ...periods, "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];
let n = Object.keys(cells).length;
outer: for (const month of months) {
  for (const nodeId of nodeIds) {
    if (n >= TARGET_CELLS) break outer;
    const key = `${nodeId}::${month}`;
    if (cells[key]) continue;
    const copy = JSON.parse(JSON.stringify(cellTpl[n % cellTpl.length]));
    copy.nodeId = nodeId;
    copy.month = month;
    cells[key] = copy;
    n++;
  }
}
seed.targetCells = cells;

function growArray(list, want, mut) {
  const base = Array.isArray(list) ? list : [];
  if (!base.length) return base;
  const outList = base.slice();
  for (let i = 0; outList.length < want; i++) outList.push(mut(JSON.parse(JSON.stringify(base[i % base.length])), i));
  return outList;
}
seed.targetHistory = growArray(seed.targetHistory, TARGET_HISTORY, (row, i) => ({ ...row, id: `th-load-${i}` }));
seed.notices = growArray(seed.notices, TARGET_NOTICES, (row, i) => ({ ...row, id: `nt-load-${i}` }));

const json = JSON.stringify(seed);
writeFileSync(out, json);
const size = (v) => (JSON.stringify(v || null).length / 1e6).toFixed(2) + " MB";
console.log(
  JSON.stringify({
    out,
    bytes: json.length,
    people: seed.people.length,
    records: Object.values(seed.records).reduce((a, m) => a + Object.keys(m).length, 0),
    rewardRecords: Object.values(seed.rewardRecords).reduce((a, m) => a + Object.keys(m).length, 0),
    targetCells: Object.keys(seed.targetCells).length,
    targetHistory: seed.targetHistory.length,
    notices: seed.notices.length,
    sizes: { records: size(seed.records), rewardRecords: size(seed.rewardRecords), people: size(seed.people) },
  }),
);
