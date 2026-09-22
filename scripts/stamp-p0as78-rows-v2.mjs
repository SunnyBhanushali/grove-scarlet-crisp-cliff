/**
 * Stamp p0as78 — ROWS-V2.
 * The SPA's live-entity `apply` only wrote the four hot collections into the
 * store. Every collection is a row now, so the same apply must also take the
 * generic fields (roles, plans, notices, targets graph, …) that
 * apms-sync.js merged. Nothing else in the bundle changes.
 *
 *   node scripts/stamp-p0as78-rows-v2.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.cwd();
const FROM = "routes-e2g7y5q8-13m-p0as72.js";
const TO = "routes-e2g7y5q8-13m-p0as78.js";
const OLD =
  "K.setState({people:t.people,rewardRecords:t.rewardRecords,records:t.records,targetCells:t.targetCells,bookGens:t.bookGens||K.getState().bookGens,notebookUpdatedAt:t.notebookUpdatedAt})";
const NEW =
  "K.setState(Object.assign(window.__apmsSync&&window.__apmsSync.pickDataFields?window.__apmsSync.pickDataFields(t):{},{people:t.people,rewardRecords:t.rewardRecords,records:t.records,targetCells:t.targetCells,bookGens:t.bookGens||K.getState().bookGens,notebookUpdatedAt:t.notebookUpdatedAt}))";

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function stampRoutes(src) {
  const n = src.split(OLD).length - 1;
  must(n === 3, `live-entity apply: expected 3 sites, got ${n}`);
  return src.split(OLD).join(NEW);
}

export function stampHtml(html) {
  return html
    .split(FROM).join(TO)
    .replace(/apms-sync\.js\?v=p0as7\d/g, "apms-sync.js?v=p0as78")
    .replace(/index-f4j9a7t3-11v-p0ar\.js\?v=p0as7\d/g, "index-f4j9a7t3-11v-p0ar.js?v=p0as78");
}

function run() {
  for (const dir of ["public/assets", "recovered-site/assets", "dist/client/assets"]) {
    const from = join(root, dir, FROM);
    if (!existsSync(from)) continue;
    const out = stampRoutes(readFileSync(from, "utf8"));
    mkdirSync(dirname(join(root, dir, TO)), { recursive: true });
    writeFileSync(join(root, dir, TO), out);
    // index-*.js preloads the routes chunk by name
    for (const f of readdirSafe(join(root, dir))) {
      if (!/^index-.*\.js$/.test(f)) continue;
      const p = join(root, dir, f);
      const s = readFileSync(p, "utf8");
      if (s.includes(FROM)) writeFileSync(p, s.split(FROM).join(TO));
    }
  }
  for (const rel of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    writeFileSync(p, stampHtml(readFileSync(p, "utf8")));
  }
  console.log("stamped", TO);
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) run();
