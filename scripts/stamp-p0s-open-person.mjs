/**
 * Stamp p0s: People list Edit actually opens the person.
 *
 * p0m openOrgPerson(t,n) shadowed zustand getState `t` with the person id,
 * so t() threw and the pencil did nothing.
 */
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const pub = join(root, "public/assets");
const rec = join(root, "recovered-site/assets");
const dist = join(root, "dist/client/assets");

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function replaceOnce(src, oldStr, newStr, label) {
  const n = src.split(oldStr).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(oldStr, newStr);
}

function replaceAllCount(src, oldStr, newStr, expected, label) {
  const n = src.split(oldStr).length - 1;
  must(n === expected, `${label}: expected ${expected} matches, got ${n}`);
  return src.split(oldStr).join(newStr);
}

function writeBoth(rel, text) {
  const paths = [join(pub, rel), join(rec, rel), join(dist, rel)];
  for (const p of paths) {
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    } catch (e) {
      if (p.startsWith(join(root, "dist"))) continue;
      throw e;
    }
  }
}

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0r.js"), join(pub, "login-view-f2j6t0x4-11a3-p0s.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0r.js"), join(pub, "routes-e2g7y5q8-13m-p0s.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0r.js"), join(pub, "index-f4j9a7t3-11v-p0s.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0r.js"), join(pub, "login-ChZ1wVZ-p0s.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0s.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0s.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0s.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0s.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0r.js";`,
  `from"./index-f4j9a7t3-11v-p0s.js";`,
  "login-view index import",
);

lv = replaceOnce(
  lv,
  `openOrgPerson:(t,n)=>{let st=t(),who=st.people.find(p=>p.id===st.currentUserId),ok=who&&(canAccess(who,\`org-people\`,\`view\`)||who.access===\`manager\`||who.access===\`function_head\`||G(who));if(!ok){e({accessDenied:\`You don't have permission to open this page.\`});return}e(e=>({...$(e,{selectedPersonId:t,view:\`org-person\`}),personStartEdit:!!n,accessDenied:null}))},`,
  `openOrgPerson:(id,n)=>{let st=t(),who=st.people.find(p=>p.id===st.currentUserId),ok=who&&(canAccess(who,\`org-people\`,\`view\`)||who.access===\`manager\`||who.access===\`function_head\`||G(who));if(!ok){e({accessDenied:\`You don't have permission to open this page.\`});return}e(e=>({...$(e,{selectedPersonId:id,view:\`org-person\`}),personStartEdit:!!n,accessDenied:null}))},`,
  "openOrgPerson uses getState not person id",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0r.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0s.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0r.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0s.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `title:\`Edit\`,onClick:()=>s.openOrgPerson(e.id,!0)`,
  `title:\`Edit\`,onClick:ev=>{ev.stopPropagation(),s.openOrgPerson(e.id,!0)}`,
  "nested edit stopPropagation",
);

rt = replaceOnce(
  rt,
  `variant:\`ghost\`,onClick:()=>i.openOrgPerson(e.id,!0)`,
  `variant:\`ghost\`,onClick:ev=>{ev.stopPropagation(),i.openOrgPerson(e.id,!0)}`,
  "list edit stopPropagation",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0r.js", "routes-e2g7y5q8-13m-p0s.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0r.js", "login-ChZ1wVZ-p0s.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0r.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0s.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0r.js"`,
  `from"./index-f4j9a7t3-11v-p0s.js"`,
  "login-ChZ index",
);

must(lv.includes("openOrgPerson:(id,n)=>{let st=t()"), "openOrgPerson still shadowed");
must(!lv.includes("openOrgPerson:(t,n)=>{let st=t()"), "old openOrgPerson still present");
must(rt.includes("ev.stopPropagation(),s.openOrgPerson(e.id,!0)"), "nested stop missing");
must(rt.includes("ev.stopPropagation(),i.openOrgPerson(e.id,!0)"), "list stop missing");

writeBoth("login-view-f2j6t0x4-11a3-p0s.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0s.js", rt);
writeBoth("index-f4j9a7t3-11v-p0s.js", idx);
writeBoth("login-ChZ1wVZ-p0s.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0r.js").join("index-f4j9a7t3-11v-p0s.js");
  html = html.split("routes-e2g7y5q8-13m-p0r.js").join("routes-e2g7y5q8-13m-p0s.js");
  html = html.split("apms-sync.js?v=p0r1").join("apms-sync.js?v=p0s1");
  writeFileSync(path, html);
}

for (const f of [
  "public/index.html",
  "public/apms.html",
  "recovered-site/index.html",
  "recovered-site/apms.html",
  "dist/client/index.html",
  "dist/client/apms.html",
]) {
  try {
    stampHtml(join(root, f));
  } catch {
    /* dist optional */
  }
}

console.log("p0s stamp ok", { lv: lv.length, rt: rt.length });
