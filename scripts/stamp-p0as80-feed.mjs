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
 * Target value inputs commit on blur only what was typed since focus, and
 * the Target tab's rename starts from the current name (both wrote a stale
 * copy over another user's change).
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

// Target values (actual, M1–M5): the input copies the value when it gets
// focus and, on blur, wrote that copy back whenever it differed from the
// store. Tab moves focus into the next value, so a change another user made
// there meanwhile was written back over on the next click elsewhere — an
// edit nobody typed. On blur it now commits only if the text changed since
// focus.
const VALUE_STATE_OLD = "let[F,setF]=(0,Z.useState)(!1);";
const VALUE_STATE_NEW = "let[F,setF]=(0,Z.useState)(!1);let F0=(0,Z.useRef)(null);";
const VALUE_FOCUS_OLD =
  "onFocus:t=>{setF(!0),a(ld(e,r));try{t.target.select()}catch{}},onBlur:()=>{setF(!1);let t=G(i);a(ld(t,r)),t!==e&&n(t)}";
const VALUE_FOCUS_NEW =
  "onFocus:t=>{setF(!0),a(ld(e,r)),F0.current=ld(e,r);try{t.target.select()}catch{}},onBlur:()=>{setF(!1);let t=G(i);a(ld(t,r)),t!==e&&i!==F0.current&&n(t)}";
// Target / Group tab rename: the draft name was taken when the row first
// rendered; opening Edit after someone else renamed it and leaving wrote the
// old name back. It now starts from the current name.
// …and while it has focus but nothing was typed, it follows the store.
const VALUE_SYNC_OLD = "return(0,Z.useEffect)(()=>{F||a(ld(e,r))},[e,r,F])";
const VALUE_SYNC_NEW = "return(0,Z.useEffect)(()=>{if(F&&i!==F0.current)return;let v=ld(e,r);a(v),F&&(F0.current=v)},[e,r,F])";
const RENAME_OLD = "title:`Edit`,onClick:()=>r(!0),children:(0,Q.jsx)(Ha,{className:`size-3.5`})";
const RENAME_NEW = "title:`Edit`,onClick:()=>{a(e.name),r(!0)},children:(0,Q.jsx)(Ha,{className:`size-3.5`})";

function once(src, from, to, what) {
  const n = src.split(from).length - 1;
  must(n === 1, `${what}: expected 1 site, got ${n}`);
  return src.split(from).join(to);
}

export function stampRoutes(src) {
  const n = src.split(ENTITY_OLD).length - 1;
  must(n === 3, `live-entity apply: expected 3 sites, got ${n}`);
  const h = src.split(HOOK_OLD).length - 1;
  must(h === 4, `live hooks: expected 4 sites, got ${h}`);
  let out = src.split(ENTITY_OLD).join(ENTITY_NEW).split(HOOK_OLD).join(HOOK_NEW);
  out = once(out, VALUE_STATE_OLD, VALUE_STATE_NEW, "target value state");
  out = once(out, VALUE_FOCUS_OLD, VALUE_FOCUS_NEW, "target value focus/blur");
  out = once(out, VALUE_SYNC_OLD, VALUE_SYNC_NEW, "target value follows the store while untouched");
  out = once(out, RENAME_OLD, RENAME_NEW, "target tab rename");
  return out;
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
