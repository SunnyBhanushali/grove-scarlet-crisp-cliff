// @ts-nocheck -- build-time stamp script (string replacements), imported by a unit test
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
 *  8. Autosave: a change made while the previous save was in flight (e.g. a
 *     person's Core role picked right after Save) waited for the next edit;
 *     the save now runs once more when the in-flight one ends.
 *
 *  5. Routes load the login-view chunk as ?v=p0as81 (see below).
 *
 * login-view chunk (edited in place, like every earlier change to it):
 *  6. Drag-reorder among siblings (People tree, Brands & SBUs, Functions,
 *     Roles) only re-ordered the local array: nothing was saved, other users
 *     never saw it and a reload put the old order back. The moved row's
 *     siblings (same manager / parent / brand / company) now get `sortKey`
 *     0..n-1 in their new order, which is saved as row data; the server and
 *     the sync keep those lists sorted by it (apms-collections siblingOrder).
 *  7. Derived reminders (plan due / late / month close) had a random id per
 *     page load, so the bell counted them unseen again after every reload.
 *     They now get a stable id from their dedupe key (qf).
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

// 8. autosave: a change made while the previous save was in flight was only
//    sent on the next store change (the timer found a save running and gave
//    up; the save's end then cleared the dirty flag). It now runs once more.
const SAVE_BUSY_OLD = "async function g(){if(f.current)return;p.current=0;";
const SAVE_BUSY_NEW = "async function g(){if(f.current){f.again=!0;return}f.again=!1;p.current=0;";
const SAVE_END_OLD = "}catch{}finally{f.current=!1}}}function _(){D.current=!0;";
const SAVE_END_NEW = "}catch{}finally{f.current=!1;if(f.again){f.again=!1;setTimeout(()=>{g().catch(()=>void 0)},0)}}}}function _(){D.current=!0;";

// 3. save trigger lists setupDone / companyFactor
const SUB_OLD = "`customReports`,`reportFolders`,`tombstones`])";
const SUB_NEW = "`customReports`,`reportFolders`,`tombstones`,`setupDone`,`companyFactor`])";

// 4. backup list refresh
const BK_OLD = "(0,Z.useEffect)(()=>{d()},[]);async function f(e,t){let n=await fetch(`/api/company-backups`";
const BK_NEW =
  "(0,Z.useEffect)(()=>{d();let q=setInterval(async()=>{try{let e=await fetch(`/api/company-backups`,{credentials:`include`}),t=await e.json();Array.isArray(t.items)&&n(t.items)}catch{}},3e3);return()=>clearInterval(q)},[]);async function f(e,t){let n=await fetch(`/api/company-backups`";

// 5. routes load the fixed login-view chunk
const LOGIN = "login-view-f2j6t0x4-11a3-p0ar.js";
const LOGIN_REF_OLD = `${LOGIN}?v=p0as80`;
const LOGIN_REF_NEW = `${LOGIN}?v=${V}`;

// 6. sibling order (login-view)
const SK_FN = "function _sk(a,t,k){let m=a.find(x=>x&&x.id===t);if(!m)return a;let g=k(m),i=0;return a.map(x=>{if(!x||k(x)!==g)return x;let s=i++;return x.sortKey===s?x:{...x,sortKey:s}})}";
const NT_HASH = "function __ntk(s){let h=5381;for(let i=0;i<s.length;i++)h=(Math.imul(h,33)^s.charCodeAt(i))>>>0;return h.toString(36)}";
const LOGIN_PAIRS = [
  ["function nestAtTop(e,t,n,r){", SK_FN + NT_HASH + "function nestAtTop(e,t,n,r){", 1, "sibling sortKey helper + notice key hash"],
  // 7. derived reminders (plan due / late / close) get a stable id from their
  //    dedupe key, so the bell's "seen" list still matches them after a reload.
  [
    "id:n.id||`nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`}",
    "id:n.id||(/^(plan_due|plan_late|month_close_due)$/.test(n.kind||``)?`nt-a-${__ntk(qf(n))}`:`nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`)}",
    1,
    "stable id for derived reminders",
  ],
  ["people:_e(e.people,n,r,i)", "people:_sk(_e(e.people,n,r,i),n,x=>x.managerId||``)", 2, "people reorder / nudge"],
  ["people:nestAtTop(e.people,n,r,`managerId`)", "people:_sk(nestAtTop(e.people,n,r,`managerId`),n,x=>x.managerId||``)", 1, "people nest"],
  ["businessUnits:_e(e.businessUnits,n,r,i)", "businessUnits:_sk(_e(e.businessUnits,n,r,i),n,x=>(x.parentId||``)+`|`+(x.brandId||``))", 1, "SBU reorder"],
  ["brands:_e(e.brands,n,r,i)", "brands:_sk(_e(e.brands,n,r,i),n,x=>x.companyId||``)", 1, "brand reorder"],
  ["functions:_e(e.functions,n,r,i)", "functions:_sk(_e(e.functions,n,r,i),n,x=>x.parentId||``)", 1, "function reorder"],
  ["functions:nestAtTop(e.functions,n,r,`parentId`)", "functions:_sk(nestAtTop(e.functions,n,r,`parentId`),n,x=>x.parentId||``)", 1, "function nest"],
  [
    "return s<0?{}:(o.splice(i===`after`?s+1:s,0,a),{roles:Object.fromEntries(o)})",
    "if(s<0)return{};o.splice(i===`after`?s+1:s,0,a);let q=_sk(o.map(([k,v])=>({...v,id:v&&v.id||k})),n,x=>x.reportsToRoleId||``);return{roles:Object.fromEntries(o.map(([k,v],j)=>[k,q[j].sortKey===(v&&v.sortKey)?v:{...v,sortKey:q[j].sortKey}]))}",
    1,
    "role reorder",
  ],
];

/** Edited in place: each change is applied once (skipped when already there). */
export function stampLogin(src) {
  let out = src;
  for (const [from, to, n, what] of LOGIN_PAIRS) {
    if (out.split(to).length - 1 === n) continue;
    out = times(out, from, to, n, what);
  }
  return out;
}

// Org batch-2 fixes: KROC editor autosave (fix 1), Brands & SBUs drag depth +
// top-of-brand reorder (fix 2), brand/SBU double-click rename (fix 5).
const ORG_FIXES = [
 {
  "what": "org fix 1: Role KROC editor (Pf): track the KRAs the draft was seeded from; an idle editor takes other users' KRA changes and the 8 s autosave only fires for a real local edit (it used to re-save the stale draft over them).",
  "old": "(0,Z.useEffect)(()=>{o((i.kras||[]).map(ci))},[e]);let d=JSON.stringify(a)!==JSON.stringify((i.kras||[]).map(ci)),f=zt(a);",
  "new": "let sd=(0,Z.useRef)(null),sk=JSON.stringify((i.kras||[]).map(ci));sd.current===null&&(sd.current=JSON.stringify(a));(0,Z.useEffect)(()=>{let v=(i.kras||[]).map(ci);sd.current=JSON.stringify(v);o(v)},[e]);(0,Z.useEffect)(()=>{JSON.stringify(a)===sd.current&&sk!==sd.current&&(sd.current=sk,o(JSON.parse(sk)))},[sk]);let d=JSON.stringify(a)!==sd.current,f=zt(a);",
  "n": 1
 },
 {
  "what": "org fix 1: Role KROC editor (Pf): after Save draft / Publish the saved KRAs become the new seed.",
  "old": "r(e,e=>{e.kras=a,e.krocStatus=t,e.krocSavedAt=new Date().toISOString()}),c(t===",
  "new": "r(e,e=>{e.kras=a,e.krocStatus=t,e.krocSavedAt=new Date().toISOString()}),sd.current=JSON.stringify(a),c(t===",
  "n": 1
 },
 {
  "what": "org fix 2: Brands & SBUs drag: root drop wrapper so brands sit at depth 1 (like person:root / fn:root); without it every row was depth 0 and drag-left / reorder could only nest.",
  "old": "children:e})}function zd(){",
  "new": "children:(0,Q.jsx)(`div`,{\"data-drop\":`sbu:root`,children:e})})}function zd(){",
  "n": 1
 },
 {
  "what": "org fix 2: Brand row: the data-drop element now wraps the brand row AND its SBU list (children were a sibling container, so the drag engine saw no nesting).",
  "old": "return(0,Q.jsxs)(`div`,{children:[(0,Q.jsx)(Ud,{open:s,hasKids:m.length>0||g,",
  "new": "return(0,Q.jsxs)(`div`,{\"data-drop\":`brand:${e.id}`,className:ec(Qs(),`brand:${e.id}`,e.id),children:[(0,Q.jsx)(Ud,{outer:!0,open:s,hasKids:m.length>0||g,",
  "n": 1
 },
 {
  "what": "org fix 2: SBU row: the data-drop element wraps the SBU row AND its nested SBUs.",
  "old": "return(0,Q.jsxs)(`div`,{children:[(0,Q.jsx)(Ud,{open:s,hasKids:m.length>0||y,",
  "new": "return(0,Q.jsxs)(`div`,{\"data-drop\":`sbu:${e.id}`,className:ec(Qs(),`sbu:${e.id}`,e.id),children:[(0,Q.jsx)(Ud,{outer:!0,open:s,hasKids:m.length>0||y,",
  "n": 1
 },
 {
  "what": "org fix 2: Ud row chrome: when the caller owns the data-drop wrapper (outer), the row itself is not a second drop target.",
  "old": "onDelete:p,onGroup:m,dropKey:h,dragId:g}){let _=Qs();return(0,Q.jsxs)(`div`,{\"data-drop\":h,className:ec(_,h||``,g||``),children:[",
  "new": "onDelete:p,onGroup:m,dropKey:h,dragId:g,outer:ox}){let _=Qs();return(0,Q.jsxs)(`div`,{\"data-drop\":ox?void 0:h,className:ox?`relative`:ec(_,h||``,g||``),children:[",
  "n": 1
 },
 {
  "what": "org fix 5: Brand/SBU/company row: single click opens the page after 300 ms unless a double-click follows (double-click = inline rename), and the row button ignores clicks while its rename input is open (Space typed in the input activated the button and opened the page / toggled the company). Before, the first click of a double-click opened the page so rename was unreachable.",
  "old": "onClick:a||n,onDoubleClick:e=>{e.preventDefault(),e.stopPropagation(),c()},children:(0,Q.jsx)(`span`,{className:`min-w-0 flex-1`,children:r?(0,Q.jsx)(Gd,{value:i,onSave:o,onCancel:s}):(0,Q.jsxs)(`span`,{className:`block text-left`,onDoubleClick:e=>{e.preventDefault(),e.stopPropagation(),c()},",
  "new": "onClick:e=>{if(r)return;if(!a)return n(e);clearTimeout(window.__apmsUdOpen);if(e.detail>1)return;window.__apmsUdOpen=setTimeout(()=>a(),300)},onDoubleClick:e=>{e.preventDefault(),e.stopPropagation(),clearTimeout(window.__apmsUdOpen),c()},children:(0,Q.jsx)(`span`,{className:`min-w-0 flex-1`,children:r?(0,Q.jsx)(Gd,{value:i,onSave:o,onCancel:s}):(0,Q.jsxs)(`span`,{className:`block text-left`,onDoubleClick:e=>{e.preventDefault(),e.stopPropagation(),clearTimeout(window.__apmsUdOpen),c()},",
  "n": 1
 },
 {
  "what": "org fix 2: Brands & SBUs drop handler (Ld): a drop in the first slot under a brand arrives as 'inside brand'; treat it as 'before the brand's first SBU' so a same-depth reorder to the top of a brand calls reorderSbu (it only called nestSbu(e,null), a no-op, so nothing was written).",
  "old": "n===`before`&&t[0]&&r.reorderSbu(e,t[0].id,`before`)",
  "new": "(n===`before`||n===`inside`)&&t[0]&&r.reorderSbu(e,t[0].id,`before`)",
  "n": 1
 }
];

export function stampRoutes(src) {
  let out = times(src, APPLY_OLD, APPLY_NEW, 3, "live apply hook (restore)");
  out = times(out, ROLE_STATE_OLD, ROLE_STATE_NEW, 1, "access role dialog: values at open");
  out = times(out, ROLE_SAVE_OLD, ROLE_SAVE_NEW, 1, "access role Save");
  out = times(out, SUB_OLD, SUB_NEW, 1, "save trigger fields");
  out = times(out, BK_OLD, BK_NEW, 1, "backup list refresh");
  out = times(out, LOGIN_REF_OLD, LOGIN_REF_NEW, 2, "login-view reference");
  // apms-dnd-engine.js changed (drag-left at the end of a subtree): new ?v=.
  out = times(out, "apms-dnd-engine.js?v=p0as52", `apms-dnd-engine.js?v=${V}`, 1, "dnd engine reference");
  out = times(out, SAVE_BUSY_OLD, SAVE_BUSY_NEW, 1, "autosave while a save is in flight");
  out = times(out, SAVE_END_OLD, SAVE_END_NEW, 1, "autosave reruns after the in-flight save");
  for (const f of ORG_FIXES) out = times(out, f.old, f.new, f.n, f.what);
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
    const login = join(root, dir, LOGIN);
    if (existsSync(login)) writeFileSync(login, stampLogin(readFileSync(login, "utf8")));
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
