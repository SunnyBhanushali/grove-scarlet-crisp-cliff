/**
 * Stamp p0as81 — BATCH-2 (Org / People / Me / Home / Settings, three users).
 *
 * Routes chunk (new name routes-e2g7y5q8-13m-p0as81.js, from p0as80):
 *  1. Live apply hook takes reason "restore": a restore (a `*` in the change
 *     feed, see apms-sync restorePull) wins over whatever the screen holds —
 *     the unsaved edit is dropped and the restored data shown without reload.
 *     Every other apply still refuses while the screen is busy.
 *  2. Settings → Edit access role: Save sent the whole role as it was when the
 *     dialog opened, so a later Save put back what another admin had changed
 *     meanwhile (their note, their grants). Save now sends only what was
 *     changed in the dialog (against the values it opened with, kept once),
 *     with grants / flags rebased per module on the role as it is now.
 *  3. The store subscription that triggers a save did not list `setupDone`
 *     and `companyFactor`: Settings → Setup "Done" was never saved until some
 *     other edit happened.
 *  4. Settings → Backup: the list of server copies re-reads every 3 s while
 *     the screen is open (it was read once on open, so other admins never saw
 *     a new copy without a reload).
 *
 * apms-sync.js and apms-collections.js get ?v=p0as81 (apms-sync.js is edited
 * in recovered-site/assets and copied to public/assets by this script).
 *
 *   node scripts/stamp-p0as81-batch2.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const FROM = "routes-e2g7y5q8-13m-p0as80.js";
const TO = "routes-e2g7y5q8-13m-p0as81.js";
const V = "p0as81";

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function times(src, from, to, n, what) {
  const got = src.split(from).length - 1;
  must(got === n, `${what}: expected ${n} site(s), got ${got}`);
  return src.split(from).join(to);
}

// 1. restore apply
const APPLY_OLD = "apply:(t,reason)=>{if(D.current||f.current||p.current)return!1;";
const APPLY_NEW =
  "apply:(t,reason)=>{if(reason===`restore`){D.current=!1;p.current&&(clearTimeout(p.current),p.current=0);let r=Number(t.notebookUpdatedAt)||0;r&&r<=d.current&&(t.notebookUpdatedAt=d.current+1);w.current=!0;let ok=h(t,`live`);D.current=!1;setTimeout(()=>{w.current=!1},800);return ok!==!1}if(D.current||f.current||p.current)return!1;";

// 2. access role Save: only what changed in the dialog
const ROLE_SAVE_OLD =
  "onClick:()=>{r?n.patchAccessRole(r.id,{name:i.trim(),base:o,note:c,scope:sc,grants:g,flags:fl}):n.addAccessRole(i,o,c,{scope:sc,grants:g,flags:fl}),e()}";
const ROLE_SAVE_NEW =
  "onClick:()=>{if(r){let df=(a,b)=>{let x=null;for(let k of new Set([...Object.keys(a||{}),...Object.keys(b||{})]))JSON.stringify((a||{})[k])!==JSON.stringify((b||{})[k])&&((x=x||{})[k]=(b||{})[k]);return x},cur=tt(K.getState().accessRoles).find(x=>x.id===r.id)||r,cp=n.accessPack({access:cur.base||cur.id,accessRoleId:cur.id}),z0=o0||{},d={};i.trim()!==z0.name&&(d.name=i.trim());o!==z0.base&&(d.base=o);c!==z0.note&&(d.note=c);sc!==z0.scope&&(d.scope=sc);let gd=df(z0.grants,g);gd&&(d.grants={...(cur.grants||cp.grants||{}),...gd});let fd=df(z0.flags,fl);fd&&(d.flags={...(cur.flags||cp.flags||{}),...fd});Object.keys(d).length&&n.patchAccessRole(r.id,d)}else n.addAccessRole(i,o,c,{scope:sc,grants:g,flags:fl});e()}";
// The dialog re-reads the role (r) and its pack (init) from the store on every
// render; what it opened with is kept once, so an untouched field is never
// mistaken for an edit after another admin's change arrives.
const ROLE_STATE_OLD = "[fl,setFl]=(0,Z.useState)(init.flags||{});";
const ROLE_STATE_NEW =
  "[fl,setFl]=(0,Z.useState)(init.flags||{}),[o0]=(0,Z.useState)(()=>r?{name:r.name||``,base:r.base||`manager`,note:r.note||``,scope:r.scope||init.scope||`team`,grants:JSON.parse(JSON.stringify(init.grants||{})),flags:JSON.parse(JSON.stringify(init.flags||{}))}:null);";

// 3. save trigger lists setupDone / companyFactor
const SUB_OLD = "`customReports`,`reportFolders`,`tombstones`])";
const SUB_NEW = "`customReports`,`reportFolders`,`tombstones`,`setupDone`,`companyFactor`])";

// 4. backup list refresh
const BK_OLD = "(0,Z.useEffect)(()=>{d()},[]);async function f(e,t){let n=await fetch(`/api/company-backups`";
const BK_NEW =
  "(0,Z.useEffect)(()=>{d();let q=setInterval(async()=>{try{let e=await fetch(`/api/company-backups`,{credentials:`include`}),t=await e.json();Array.isArray(t.items)&&n(t.items)}catch{}},3e3);return()=>clearInterval(q)},[]);async function f(e,t){let n=await fetch(`/api/company-backups`";

export function stampRoutes(src) {
  let out = times(src, APPLY_OLD, APPLY_NEW, 3, "live apply hook (restore)");
  out = times(out, ROLE_STATE_OLD, ROLE_STATE_NEW, 1, "access role dialog: values at open");
  out = times(out, ROLE_SAVE_OLD, ROLE_SAVE_NEW, 1, "access role Save");
  out = times(out, SUB_OLD, SUB_NEW, 1, "save trigger fields");
  out = times(out, BK_OLD, BK_NEW, 1, "backup list refresh");
  return out;
}

export function stampHtml(html) {
  return html
    .split(FROM).join(TO)
    .replace(/apms-sync\.js\?v=p0as\d+/g, `apms-sync.js?v=${V}`)
    .replace(/apms-collections\.js\?v=p0as\d+/g, `apms-collections.js?v=${V}`)
    .replace(/index-f4j9a7t3-11v-p0ar\.js\?v=p0as\d+/g, `index-f4j9a7t3-11v-p0ar.js?v=${V}`);
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function run() {
  // apms-sync.js is edited in recovered-site; public/ serves the same file.
  const syncSrc = join(root, "recovered-site/assets/apms-sync.js");
  if (existsSync(join(root, "public/assets"))) copyFileSync(syncSrc, join(root, "public/assets/apms-sync.js"));
  for (const dir of ["public/assets", "recovered-site/assets", "dist/client/assets"]) {
    const from = join(root, dir, FROM);
    if (!existsSync(from)) continue;
    writeFileSync(join(root, dir, TO), stampRoutes(readFileSync(from, "utf8")));
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) run();
