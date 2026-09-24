#!/usr/bin/env node
/**
 * Markdown tables for REPORT-BATCH-2.md from the runners' JSON reports.
 *   node scripts/e2e/report-batch2-tables.mjs <batch2.json> [batch1.json] [security.json]
 */
import { readFileSync } from "node:fs";

const [b2, b1, sec] = process.argv.slice(2).map((f) => (f ? JSON.parse(readFileSync(f, "utf8")) : null));
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const secs = (r) => {
  const d = (r.checks?.[3]?.detail || "").match(/(\d+(?:\.\d+)?) s/g);
  return d ? [...new Set(d)].slice(0, 3).join(" / ") : "";
};
function checksTable(results) {
  const out = ["| Module | Screen | 1 | 2 | 3 | 4 | 5 | 6 | C saw it after |", "|---|---|---|---|---|---|---|---|---|"];
  for (const r of results) {
    const c = [1, 2, 3, 4, 5, 6].map((n) => r.checks?.[n]?.status || "—");
    const stop = r.checks?.[0] ? ` **stopped:** ${esc(r.checks[0].detail)}` : "";
    out.push(`| ${esc(r.module)} | ${esc(r.id)}${stop} | ${c.join(" | ")} | ${secs(r)} |`);
  }
  return out.join("\n");
}
function extras(results) {
  const out = [];
  for (const r of results) {
    for (const [k, v] of Object.entries(r.checks || {})) {
      if (/^\d$/.test(k)) continue;
      out.push(`| ${esc(r.id)} | ${esc(k)} | ${v.status} | ${esc(v.detail).slice(0, 300)} |`);
    }
  }
  return out.length ? ["| Screen | Special check | Result | Detail |", "|---|---|---|---|", ...out].join("\n") : "";
}
function naList(results) {
  const out = [];
  for (const r of results) for (const [k, v] of Object.entries(r.checks || {})) if (v.status === "n/a") out.push(`- **${r.id}, check ${k}** — ${esc(v.detail)}`);
  return out.join("\n");
}
function fails(results) {
  const out = [];
  for (const r of results) for (const [k, v] of Object.entries(r.checks || {})) if (v.status === "fail") out.push(`- **${r.id}, check ${k}** — ${esc(v.detail)}`);
  return out.join("\n") || "None.";
}
if (b2) {
  console.log("## SCREENS\n");
  console.log("| Module | Screen / dialog / button | What it saves | Scenario | Reached |\n|---|---|---|---|---|");
  for (const s of b2.screens) console.log(`| ${esc(s.module)} | ${esc(s.screen)} | ${esc(s.saves)} | ${esc(s.scenario || "")} | ${s.reached ? "yes" : `**not reached** — ${esc(s.why)}`} |`);
  console.log("\n## BATCH-2 CHECKS\n\n" + checksTable(b2.results));
  console.log("\n## SPECIAL\n\n" + extras(b2.results));
  console.log("\n## N/A\n\n" + naList(b2.results));
  console.log("\n## FAILS\n\n" + fails(b2.results));
}
if (b1) console.log("\n## BATCH-1\n\n" + checksTable(b1.results) + "\n\nFAILS:\n" + fails(b1.results));
if (sec) {
  console.log("\n## SECURITY\n\n| Group | Check | Result | Detail |\n|---|---|---|---|");
  for (const r of sec.results) console.log(`| ${r.group} | ${esc(r.name)} | ${r.ok ? "pass" : "**fail**"} | ${esc(r.detail).slice(0, 160)} |`);
}
