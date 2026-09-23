/**
 * Stamp p0as80 — THREE-USERS (feed latency, cache busting).
 *
 * The SPA's live-entity apply (change-feed rows) runs a setState whose store
 * subscription marks the screen dirty until the no-op save 600 ms later
 * finishes. Every feed apply in that window was refused and waited for the
 * next tick, so a burst of commits (a month lock rewrites every target cell)
 * reached idle screens seconds late. The `live` apply already clears D after
 * itself (p0as78); the live-entity apply now does the same and cancels the
 * echo save it scheduled. It only runs on a clean screen
 * (`if(D.current||f.current||p.current)return!1`) and the change is the server's.
 *
 * The live hooks also expose the store's state (`stateRef`), so the sync's
 * read-only screen checks copy the screen state once per change instead of
 * once per feed message.
 *
 * This release also changes apms-sync.js and apms-collections.js: the routes
 * chunk gets a new name and the scripts and index chunk new ?v= so browsers
 * holding p0as78/p0as79 fetch them. Nothing else in the bundle changes.
 *
 *   node scripts/stamp-p0as78-rows-v2.mjs && node scripts/stamp-p0as80-feed.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const FROM = "routes-e2g7y5q8-13m-p0as78.js";
const TO = "routes-e2g7y5q8-13m-p0as80.js";
const V = "p0as80";

const APPLY =
  "K.setState(Object.assign(window.__apmsSync&&window.__apmsSync.pickDataFields?window.__apmsSync.pickDataFields(t):{},{people:t.people,rewardRecords:t.rewardRecords,records:t.records,targetCells:t.targetCells,bookGens:t.bookGens||K.getState().bookGens,notebookUpdatedAt:t.notebookUpdatedAt}))";
const ENTITY_OLD = APPLY + ";return!0}";
// Also cancel the save its setState just scheduled: an echo of the server's
// own rows (the sync would SKIP it), and a pending timer counts as busy too.
const ENTITY_NEW = APPLY + ";D.current=!1;p.current&&(clearTimeout(p.current),p.current=0);return!0}";

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

// The sync's read-only screen checks (view / month / person) cache one copy
// of the screen state per store state; the hooks expose that state object.
const HOOK_OLD = "getSnapshot:()=>K.getState().exportSnapshot(),";
const HOOK_NEW = "getSnapshot:()=>K.getState().exportSnapshot(),stateRef:()=>K.getState(),";

export function stampRoutes(src) {
  const n = src.split(ENTITY_OLD).length - 1;
  must(n === 3, `live-entity apply: expected 3 sites, got ${n}`);
  const h = src.split(HOOK_OLD).length - 1;
  must(h === 4, `live hooks: expected 4 sites, got ${h}`);
  return src.split(ENTITY_OLD).join(ENTITY_NEW).split(HOOK_OLD).join(HOOK_NEW);
}

export function stampHtml(html) {
  return html
    .split(FROM).join(TO)
    .replace(/apms-sync\.js\?v=p0as\d+/g, `apms-sync.js?v=${V}`)
    .replace(/apms-collections\.js\?v=p0as\d+/g, `apms-collections.js?v=${V}`)
    .replace(/index-f4j9a7t3-11v-p0ar\.js\?v=p0as\d+/g, `index-f4j9a7t3-11v-p0ar.js?v=${V}`);
}

function run() {
  for (const dir of ["public/assets", "recovered-site/assets", "dist/client/assets"]) {
    const from = join(root, dir, FROM);
    if (!existsSync(from)) continue;
    writeFileSync(join(root, dir, TO), stampRoutes(readFileSync(from, "utf8")));
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
