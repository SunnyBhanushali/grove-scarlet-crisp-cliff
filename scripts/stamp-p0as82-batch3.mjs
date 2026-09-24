// @ts-nocheck -- build-time stamp script (string replacements), imported by a unit test
/**
 * Stamp p0as82 — BATCH-3 (security hardening + Targets / Rewards broken links).
 *
 * Routes chunk: new name routes-e2g7y5q8-13m-p0as82.js, built from p0as81.
 * login-view chunk: edited in place (each change applied once), loaded ?v=p0as82.
 * apms-sync.js / apms-collections.js: edited in recovered-site/assets, copied to
 * public/assets, loaded ?v=p0as82.
 *
 * Every change is an exact string replacement asserted to match n times.
 *
 *   node scripts/stamp-p0as82-batch3.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { TARGETS_ROUTES_FIXES, TARGETS_LOGIN_FIXES } from "./stamp-p0as82-targets.mjs";

const root = process.cwd();
const FROM = "routes-e2g7y5q8-13m-p0as81.js";
const TO = "routes-e2g7y5q8-13m-p0as82.js";
const V = "p0as82";
const LOGIN = "login-view-f2j6t0x4-11a3-p0ar.js";

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function times(src, from, to, n, what) {
  const got = src.split(from).length - 1;
  must(got === n, `${what}: expected ${n} site(s), got ${got}`);
  return src.split(from).join(to);
}

// Settings → Assign people: "Locked sign-ins" card (admin). Lists usernames
// locked by the 5-wrong-tries rule (GET /api/login-locks, re-read every 5 s)
// with an Unlock button (POST /api/login-locks {username}). Hidden when none.
const AW_LOCKS =
  "function AwLocks({people:P}){let[L,sL]=(0,Z.useState)([]),[busy,sB]=(0,Z.useState)(``),ld=async()=>{try{let r=await fetch(`/api/login-locks`,{credentials:`include`});if(!r.ok)return;let j=await r.json();Array.isArray(j.locks)&&sL(j.locks)}catch{}};(0,Z.useEffect)(()=>{ld();let q=setInterval(ld,5e3);return()=>clearInterval(q)},[]);if(!L.length)return null;return(0,Q.jsxs)(`div`,{className:`rounded-xl border p-3`,style:{borderColor:`#E25A3C`,background:`#fff4ef`},\"data-apms-locks\":`1`,children:[(0,Q.jsx)(`div`,{className:`text-sm font-medium`,children:`Locked sign-ins`}),(0,Q.jsx)(`p`,{className:`text-xs text-muted-foreground`,children:`Too many wrong passwords. Unlock lets the person try again now.`}),(0,Q.jsx)(`ul`,{className:`mt-2 space-y-2`,children:L.map(e=>{let n=(P||[]).find(p=>String(p.username||``).toLowerCase()===e.username);return(0,Q.jsxs)(`li`,{className:`flex items-center justify-between gap-2 text-sm`,children:[(0,Q.jsx)(`span`,{children:`${n&&n.name?n.name+` · `:``}${e.username} · locked ${e.minutes} min more`}),(0,Q.jsx)(`button`,{type:`button`,className:`rounded-md border border-border bg-card px-2 py-1 text-xs font-medium`,disabled:busy===e.username,onClick:async()=>{sB(e.username);try{await fetch(`/api/login-locks`,{method:`POST`,credentials:`include`,headers:{\"content-type\":`application/json`},body:JSON.stringify({username:e.username})})}catch{}sB(``);ld()},children:`Unlock`})]},e.username)})})]})}";

/** Security / sign-in changes on the routes chunk (BATCH-3 part B). */
export const AUTH_ROUTES_FIXES = [
  {
    what: "Settings → Assign people: define the Locked sign-ins card (AwLocks) at top level",
    old: "}function kc({title:e=`Brands & SBU`",
    new: "}" + AW_LOCKS + "function kc({title:e=`Brands & SBU`",
    n: 1,
  },
  {
    what: "Settings → Assign people: show the Locked sign-ins card above Password reset requests",
    old: "w.length>0&&(0,Q.jsxs)(`div`,{className:`rounded-xl border border-amber-200 bg-amber-50 p-3`,children:[(0,Q.jsx)(`div`,{className:`text-sm font-medium`,children:`Password reset requests`})",
    new: "(0,Q.jsx)(AwLocks,{people:t.people}),w.length>0&&(0,Q.jsxs)(`div`,{className:`rounded-xl border border-amber-200 bg-amber-50 p-3`,children:[(0,Q.jsx)(`div`,{className:`text-sm font-medium`,children:`Password reset requests`})",
    n: 1,
  },
  {
    what:
      "Me → Edit → Save for a non-admin (selfLock) threw `ReferenceError: Cannot access 'e' before initialization`: the self branch read `e.id` while a `let e` declared later in the same handler shadowed the person prop, so an employee's own profile edit was never saved (found by the BATCH-3 employee browser). The person id is now taken once at the top of the form (`__selfPid`).",
    old: "function Ul({person:e,onDone:t}){let n=K(),r=n.people.find(e=>e.id===n.currentUserId),selfLock=n.view===`me`&&!wi(r),",
    new: "function Ul({person:e,onDone:t}){let n=K(),r=n.people.find(e=>e.id===n.currentUserId),__selfPid=e&&e.id,selfLock=n.view===`me`&&!wi(r),",
    n: 1,
  },
  {
    what: "Me → Edit → Save (selfLock): use the id taken at the top of the form",
    old: "if(selfLock){let a=ti(l.firstName,l.lastName,l.name),s=n.updatePerson(e.id,",
    new: "if(selfLock){let a=ti(l.firstName,l.lastName,l.name),s=n.updatePerson(__selfPid,",
    n: 1,
  },
];
/** Security / sign-in changes on the login-view chunk (edited in place). */
export const AUTH_LOGIN_FIXES = [
  {
    what:
      "sign-in: one request per Continue (username, or email when an @ was typed; the server already matches username@aliens.local), so one wrong password counts once against the 5-try lock-out; a lock-out (429) or 'starter password 0000 is off' message from the server is shown as sent instead of 'Wrong username or password.'",
    old:
      "let e=t.includes(`@`)?t.split(`@`)[0]:t,r=await Yi.signIn.username({username:e,password:a},{disableRedirect:!0});if(!r||!r.error){ff(a),window.location.assign(`/`);return}let i=t.includes(`@`)?t.toLowerCase():`${e.toLowerCase()}@aliens.local`,o=await Yi.signIn.email({email:i,password:a},{disableRedirect:!0});if(!o||!o.error){ff(a),window.location.assign(`/`);return}let s=[r.error.message,o.error.message].filter(Boolean).join(` `);",
    new:
      "let e=t.includes(`@`)?t.split(`@`)[0]:t,__say=x=>x&&x.error&&(x.error.status===429||x.error.code===`LOCKED`||x.error.code===`DEFAULT_PIN_OFF`)?x.error.message:``,r=t.includes(`@`)?null:await Yi.signIn.username({username:e,password:a},{disableRedirect:!0});if(r&&!r.error){ff(a),window.location.assign(`/`);return}if(__say(r))throw Error(__say(r));let i=t.includes(`@`)?t.toLowerCase():`${e.toLowerCase()}@aliens.local`,o=t.includes(`@`)?await Yi.signIn.email({email:i,password:a},{disableRedirect:!0}):null;if(o&&!o.error){ff(a),window.location.assign(`/`);return}if(__say(o))throw Error(__say(o));let s=[r&&r.error&&r.error.message,o&&o.error&&o.error.message].filter(Boolean).join(` `);",
    n: 1,
  },
  {
    what:
      "sign-in: after a session was ended elsewhere (password reset by an admin, own password changed in another browser), apms-sync sends the tab here with a reason; say why instead of showing an unexplained sign-in page.",
    old: "function dm({sandbox:e,onForgot:t}){let[r,i]=(0,h.useState)(``),[a,o]=(0,h.useState)(``),[s,c]=(0,h.useState)(null)",
    new: "function dm({sandbox:e,onForgot:t}){let[r,i]=(0,h.useState)(``),[a,o]=(0,h.useState)(``),[s,c]=(0,h.useState)(()=>{try{let v=window.sessionStorage.getItem(`apms-signed-out-reason`);if(v){window.sessionStorage.removeItem(`apms-signed-out-reason`);return`You were signed out because your password was changed or your session was ended. Sign in again.`}}catch{}return null})",
    n: 1,
  },
];

export function stampRoutes(src) {
  let out = times(src, `${LOGIN}?v=p0as81`, `${LOGIN}?v=${V}`, 2, "login-view reference");
  for (const f of [...AUTH_ROUTES_FIXES, ...TARGETS_ROUTES_FIXES]) out = times(out, f.old, f.new, f.n, f.what);
  return out;
}

export function stampLogin(src) {
  let out = src;
  for (const f of [...AUTH_LOGIN_FIXES, ...TARGETS_LOGIN_FIXES]) {
    if (out.split(f.new).length - 1 === f.n) continue;
    out = times(out, f.old, f.new, f.n, f.what);
  }
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
  for (const f of ["apms-sync.js", "apms-collections.js"]) {
    const src = join(root, "recovered-site/assets", f);
    if (existsSync(join(root, "public/assets")) && existsSync(src)) copyFileSync(src, join(root, "public/assets", f));
  }
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
