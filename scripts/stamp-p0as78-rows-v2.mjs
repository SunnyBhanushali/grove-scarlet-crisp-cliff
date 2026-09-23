/**
 * Stamp p0as78 — ROWS-V2.
 * The SPA's live-entity `apply` only wrote the four hot collections into the
 * store. Every collection is a row now, so the same apply must also take the
 * generic fields (roles, plans, notices, targets graph, …) that
 * apms-sync.js merged.
 *
 * The `live` (book pull) apply marks its own setState as local work: the store
 * subscription sets the dirty flag D while `w` (applying) suppresses the save
 * that would clear it, so D stayed true until the user's next edit — and every
 * later live-entity apply was refused (`if(D.current||…)return!1`). The apply
 * only runs on a clean screen, so D is cleared right after it.
 *
 * The same `w` window also swallowed real edits: a change made within 800 ms
 * of a book-pull apply set D but scheduled no save, so the edit sat unsaved
 * (and the screen stayed blocked) until the next edit. The save is scheduled
 * regardless now — an echo of an applied snapshot diffs to nothing (SKIP).
 * Nothing else in the bundle changes.
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

const LIVE_OLD = "w.current=!0;let ok=h(t,`live`);setTimeout(()=>{w.current=!1},800);return ok";
const LIVE_NEW = "w.current=!0;let ok=h(t,`live`);D.current=!1;setTimeout(()=>{w.current=!1},800);return ok";
const DIRTY_OLD = "function _(){D.current=!0;l.current&&!w.current&&(";
const DIRTY_NEW = "function _(){D.current=!0;l.current&&(";
const FOCUS_OLD = "(w.current=!0,h(t,`live`),setTimeout(()=>{w.current=!1},800))";
const FOCUS_NEW = "(w.current=!0,h(t,`live`),D.current=!1,setTimeout(()=>{w.current=!1},800))";

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function stampRoutes(src) {
  const n = src.split(OLD).length - 1;
  must(n === 3, `live-entity apply: expected 3 sites, got ${n}`);
  const live = src.split(LIVE_OLD).length - 1;
  must(live === 3, `live apply: expected 3 sites, got ${live}`);
  const focus = src.split(FOCUS_OLD).length - 1;
  must(focus === 1, `focus apply: expected 1 site, got ${focus}`);
  const dirty = src.split(DIRTY_OLD).length - 1;
  must(dirty === 1, `dirty scheduler: expected 1 site, got ${dirty}`);
  return src.split(OLD).join(NEW).split(LIVE_OLD).join(LIVE_NEW).split(FOCUS_OLD).join(FOCUS_NEW).split(DIRTY_OLD).join(DIRTY_NEW);
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
