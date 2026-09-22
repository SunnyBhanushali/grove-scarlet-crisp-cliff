/**
 * Stamp p0w: People search shows the person collapsed; expand reveals their team.
 */
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const pub = join(root, "public/assets");

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
  for (const dir of [pub, join(root, "recovered-site/assets"), join(root, "dist/client/assets")]) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, rel), text);
    } catch (e) {
      if (String(dir).includes("/dist/")) continue;
      throw e;
    }
  }
}

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0v.js"), join(pub, "login-view-f2j6t0x4-11a3-p0w.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0v.js"), join(pub, "routes-e2g7y5q8-13m-p0w.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0v.js"), join(pub, "index-f4j9a7t3-11v-p0w.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0v.js"), join(pub, "login-ChZ1wVZ-p0w.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0w.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0w.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0w.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0w.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0v.js";`, `from"./index-f4j9a7t3-11v-p0w.js";`, "lv index");
rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0v.js"`, `from"./login-view-f2j6t0x4-11a3-p0w.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0v.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0w.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);

rt = replaceOnce(
  rt,
  `if(!n)return!0;let l=i.roleId?e.roles[i.roleId]?.name:\`\`,d=i.secondaryRoleId?e.roles[i.secondaryRoleId]?.name:\`\`,p=e.functions.find(e=>e.id===i.functionId)?.name,h=e.subFunctions.find(e=>e.id===i.subFunctionId)?.name,g=s?Wi(s.status,e.currentMonth).label:\`\`;return[i.name,i.title,i.email,i.employeeCode,l,d,p,h,g].filter(Boolean).some(e=>String(e).toLowerCase().includes(n))}).slice().sort((e,t)=>O===\`list\`||O===\`summary\`?g===\`az\`?(e.name||\`\`).localeCompare(t.name||\`\`):(t.createdAt||t.id).localeCompare(e.createdAt||e.id):0)}`,
  `return!0});let hits=!n?pool:pool.filter(i=>{let l=i.roleId?e.roles[i.roleId]?.name:\`\`,d=i.secondaryRoleId?e.roles[i.secondaryRoleId]?.name:\`\`,p=e.functions.find(e=>e.id===i.functionId)?.name,h=e.subFunctions.find(e=>e.id===i.subFunctionId)?.name,g=(e.records[e.currentMonth]?.[i.id])?Wi(e.records[e.currentMonth][i.id].status,e.currentMonth).label:\`\`;return[i.name,i.title,i.email,i.employeeCode,l,d,p,h,g].filter(Boolean).some(e=>String(e).toLowerCase().includes(n))});return[pool,hits.slice().sort((e,t)=>O===\`list\`||O===\`summary\`?g===\`az\`?(e.name||\`\`).localeCompare(t.name||\`\`):(t.createdAt||t.id).localeCompare(e.createdAt||e.id):0)]}`,
  "pool+hits memo body",
);

rt = replaceOnce(
  rt,
  `let j=(0,Z.useMemo)(()=>{let n=i.trim().toLowerCase(),sbuWant=null;if(oe.length){sbuWant=new Set(oe);let units=e.businessUnits||[],grew=!0;while(grew){grew=!1;for(let u of units)if(u&&u.parentId&&sbuWant.has(u.parentId)&&!sbuWant.has(u.id)){sbuWant.add(u.id);grew=!0}}}return r.filter(i=>{`,
  `let Y=(0,Z.useMemo)(()=>{let n=i.trim().toLowerCase(),sbuWant=null;if(oe.length){sbuWant=new Set(oe);let units=e.businessUnits||[],grew=!0;while(grew){grew=!1;for(let u of units)if(u&&u.parentId&&sbuWant.has(u.parentId)&&!sbuWant.has(u.id)){sbuWant.add(u.id);grew=!0}}}let pool=r.filter(i=>{`,
  "memo starts with pool",
);

rt = replaceOnce(
  rt,
  `N=(0,Z.useMemo)(()=>j.filter(e=>!e.managerId||!M.has(e.managerId)).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),[j,M]),kfCo=e=>j.filter(t=>t.managerId===e).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),`,
  `pool=Y[0],j=Y[1],N=(0,Z.useMemo)(()=>j.filter(e=>!e.managerId||!M.has(e.managerId)).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),[j,M]),kfCo=e=>pool.filter(t=>t.managerId===e).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),`,
  "destructure pool/j, kids from pool",
);

// M is currently immediately after the useMemo deps. It still uses j — that's hits. Insert pool/j BEFORE M.
// Wait: I put pool=Y[0],j=Y[1] in front of N, but M is before N. Need pool/j before M.

rt = replaceOnce(
  rt,
  `M=(0,Z.useMemo)(()=>new Set(j.map(e=>e.id)),[j]),pool=Y[0],j=Y[1],N=`,
  `pool=Y[0],j=Y[1],M=(0,Z.useMemo)(()=>new Set(j.map(e=>e.id)),[j]),N=`,
  "pool before M",
);

rt = replaceOnce(
  rt,
  `function Pfv({kind:e,people:t,units:n,functions:r,allowActions:i,selectedIds:a,onToggleSelect:o,forceOpen:s}){function c(e,t,n){return t.roots.map(r=>(0,Q.jsx)(Fl,{person:r,allowed:t.ids,allowActions:i,forceOpen:s,selectedIds:a,onToggleSelect:o,kidsFor:t.kids},r.id+e))}`,
  `function Pfv({kind:e,people:t,hits:H,units:n,functions:r,allowActions:i,selectedIds:a,onToggleSelect:o,forceOpen:s}){function c(e,t,n){return(n||t.roots).map(r=>(0,Q.jsx)(Fl,{person:r,allowed:t.ids,allowActions:i,forceOpen:!1,selectedIds:a,onToggleSelect:o,kidsFor:t.kids},r.id+e))}if(H&&H.length&&H.length<t.length){let n=e===\`function\`?__nps(t):__npp(t);return(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,children:[H.length?c(\`:hit\`,n,H):(0,Q.jsx)(\`p\`,{className:\`rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground\`,children:\`No people match.\`})]})}
`,
  "Pfv search hits collapsed",
);

rt = replaceAllCount(rt, `people:j,units:e.businessUnits`, `people:pool,hits:j,units:e.businessUnits`, 2, "Pfv pool+hits");
rt = replaceAllCount(rt, `forceOpen:!!i.trim()`, `forceOpen:!1`, 3, "do not auto-expand search");

rt = replaceOnce(
  rt,
  `getKids=kf||(id=>rr(s.people,id,t)),l=getKids(e.id),[u,d]=(0,Z.useState)(!0),f=r||u`,
  `getKids=kf||(id=>rr(s.people,id,t)),l=getKids(e.id),[u,d]=(0,Z.useState)(!1),f=r||u`,
  "rows start collapsed",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0v.js", "routes-e2g7y5q8-13m-p0w.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0v.js", "login-ChZ1wVZ-p0w.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0v.js"`, `from"./login-view-f2j6t0x4-11a3-p0w.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0v.js"`, `from"./index-f4j9a7t3-11v-p0w.js"`, "login idx");

must(rt.includes("let pool=r.filter"), "pool filter missing");
must(rt.includes("pool=Y[0],j=Y[1]"), "Y destructure missing");
must(rt.includes("kfCo=e=>pool.filter"), "kids from pool");
must(rt.includes("H.length<t.length"), "search hit mode");

writeBoth("login-view-f2j6t0x4-11a3-p0w.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0w.js", rt);
writeBoth("index-f4j9a7t3-11v-p0w.js", idx);
writeBoth("login-ChZ1wVZ-p0w.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0v.js").join("index-f4j9a7t3-11v-p0w.js");
  html = html.split("routes-e2g7y5q8-13m-p0v.js").join("routes-e2g7y5q8-13m-p0w.js");
  html = html.split("apms-sync.js?v=p0v1").join("apms-sync.js?v=p0w1");
  writeFileSync(path, html);
}
for (const f of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
  try { stampHtml(join(root, f)); } catch {}
}
console.log("p0w stamp ok");
