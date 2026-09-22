/**
 * Stamp p0v: People views = List | Company | SBU | Function.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0u.js"), join(pub, "login-view-f2j6t0x4-11a3-p0v.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0u.js"), join(pub, "routes-e2g7y5q8-13m-p0v.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0u.js"), join(pub, "index-f4j9a7t3-11v-p0v.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0u.js"), join(pub, "login-ChZ1wVZ-p0v.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0v.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0v.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0v.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0v.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0u.js";`, `from"./index-f4j9a7t3-11v-p0v.js";`, "lv index");

rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0u.js"`, `from"./login-view-f2j6t0x4-11a3-p0v.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0u.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0v.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);
rt = replaceOnce(
  rt,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,leaderScopeLabel as __scopeLabel,`,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,leaderScopeLabel as __scopeLabel,unitsWithPeople as __uwp,peopleOnSbu as __pos,peopleInFunction as __pif,nestPeopleByPrimary as __npp,nestPeopleInSection as __nps,personSbuIds as __sbuIds,personFunctionIds as __pfids,`,
  "rt tree helpers import",
);

const PFV = `function Pfv({kind:e,people:t,units:n,functions:r,allowActions:i,selectedIds:a,onToggleSelect:o,forceOpen:s}){function c(e,t,n){return t.roots.map(r=>(0,Q.jsx)(Fl,{person:r,allowed:t.ids,allowActions:i,forceOpen:s,selectedIds:a,onToggleSelect:o,kidsFor:t.kids},r.id+e))}if(e===\`sbu\`){let e=__uwp(n,t),r=e.filter(t=>!t.parentId||!e.some(e=>e.id===t.parentId)),l=t.filter(e=>!__sbuIds(e).length);function u(n){let r=__npp(__pos(t,n.id)),s=e.filter(e=>e.parentId===n.id);return(0,Q.jsxs)(\`div\`,{className:\`overflow-hidden rounded-xl border border-border bg-card\`,children:[(0,Q.jsxs)(\`div\`,{className:\`flex items-center justify-between gap-2 border-b border-border px-3 py-2\`,children:[(0,Q.jsx)(\`p\`,{className:\`font-medium leading-tight\`,children:n.name||\`SBU\`}),(0,Q.jsx)(\`p\`,{className:\`text-xs text-muted-foreground\`,children:[r.ids.size,\` \`,r.ids.size===1?\`person\`:\`people\`]})]}),r.roots.length||s.length?(0,Q.jsxs)(\`div\`,{children:[c(\`:\`+n.id,r),s.map(e=>(0,Q.jsx)(\`div\`,{className:\`border-t border-border pl-2 sm:pl-3\`,children:u(e)},e.id))]}):(0,Q.jsx)(\`p\`,{className:\`px-3 py-4 text-sm text-muted-foreground\`,children:\`No people in this studio.\`})]},n.id)}return(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,children:[r.length?r.map(e=>u(e)): (0,Q.jsx)(\`p\`,{className:\`rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground\`,children:\`No people match.\`}),l.length?(0,Q.jsxs)(\`div\`,{className:\`overflow-hidden rounded-xl border border-border bg-card\`,children:[(0,Q.jsx)(\`div\`,{className:\`border-b border-border px-3 py-2 text-sm font-medium\`,children:\`Unassigned\`}),c(\`:none\`,__npp(l))]}):null]})}let l=(r||[]).filter(e=>__pif(t,e.id).length).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),u=t.filter(e=>!__pfids(e).length);return(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,children:[l.length?l.map(n=>{let r=__nps(__pif(t,n.id));return(0,Q.jsxs)(\`div\`,{className:\`overflow-hidden rounded-xl border border-border bg-card\`,children:[(0,Q.jsxs)(\`div\`,{className:\`flex items-center justify-between gap-2 border-b border-border px-3 py-2\`,children:[(0,Q.jsx)(\`p\`,{className:\`font-medium leading-tight\`,children:n.name||\`Function\`}),(0,Q.jsx)(\`p\`,{className:\`text-xs text-muted-foreground\`,children:[r.ids.size,\` \`,r.ids.size===1?\`person\`:\`people\`]})]}),r.roots.length?c(\`:\`+n.id,r):(0,Q.jsx)(\`p\`,{className:\`px-3 py-4 text-sm text-muted-foreground\`,children:\`No people in this function.\`})]},n.id)}):(0,Q.jsx)(\`p\`,{className:\`rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground\`,children:\`No people match.\`}),u.length?(0,Q.jsxs)(\`div\`,{className:\`overflow-hidden rounded-xl border border-border bg-card\`,children:[(0,Q.jsx)(\`div\`,{className:\`border-b border-border px-3 py-2 text-sm font-medium\`,children:\`No function\`}),c(\`:nofn\`,__npp(u))]}):null]})}
function kl(){`;

rt = replaceOnce(rt, `function kl(){`, PFV, "insert Pfv");

rt = replaceOnce(
  rt,
  `[v,y]=(0,Z.useState)(\`nested\`)`,
  `[v,y]=(0,Z.useState)(()=>U(t)?\`company\`:t&&t.access===\`function_head\`?\`function\`:t&&t.access===\`manager\`?\`sbu\`:\`list\`)`,
  "default view by role",
);

rt = replaceOnce(
  rt,
  `O=e.peopleListFilter?\`list\`:v,k=(U(t)||In(t))&&O===\`nested\`,A=U(t)||In(t);`,
  `O=e.peopleListFilter?\`list\`:v,k=U(t)&&O===\`company\`,A=U(t)||In(t);`,
  "drag only on company tree",
);

rt = replaceOnce(
  rt,
  `}).slice().sort((e,t)=>O===\`nested\`?0:g===\`az\`?(e.name||\`\`).localeCompare(t.name||\`\`):(t.createdAt||t.id).localeCompare(e.createdAt||e.id))}`,
  `}).slice().sort((e,t)=>O===\`list\`||O===\`summary\`?g===\`az\`?(e.name||\`\`).localeCompare(t.name||\`\`):(t.createdAt||t.id).localeCompare(e.createdAt||e.id):0)}`,
  "sort only list",
);

rt = replaceOnce(
  rt,
  `mt-2 grid grid-cols-2 gap-2 \${O===\`nested\`?\`md:grid-cols-3 lg:grid-cols-6\`:\`md:grid-cols-6\`}`,
  `mt-2 grid grid-cols-2 gap-2 \${O===\`list\`||O===\`summary\`?\`md:grid-cols-6\`:\`md:grid-cols-3 lg:grid-cols-6\`}`,
  "filter grid",
);

rt = replaceOnce(
  rt,
  `O===\`list\`&&(0,Q.jsxs)(\`select\`,{className:Ol,value:g,onChange:e=>_(e.target.value),children:[(0,Q.jsx)(\`option\`,{value:\`new\`,children:\`Newest first\`}),(0,Q.jsx)(\`option\`,{value:\`az\`,children:\`A–Z\`})]})]}),(0,Q.jsxs)(\`div\`,{className:\`mt-3 flex flex-wrap gap-2\`,children:[!n&&(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`list\`?\`default\`:\`outline\`,onClick:()=>y(\`list\`),children:\`List\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`nested\`||n&&v!==\`summary\`?\`default\`:\`outline\`,onClick:()=>y(\`nested\`),children:\`Nested\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`summary\`?\`default\`:\`outline\`,onClick:()=>y(\`summary\`),children:\`Summary\`}),U(t)&&!w&&(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,className:\`ml-auto\`,onClick:()=>{T(!0),C(new Set)},children:\`Mass update\`})]})]}),O!==\`summary\`&&(0,Q.jsxs)(\`p\`,{className:\`text-xs text-muted-foreground\`,children:[j.length,\` people\`,t&&!U(t)?\` · \${__scopeLabel(t,e.people,e.functions,e.businessUnits)}\`:\`\`,O===\`nested\`&&k?\` · Line = reorder · row = nest\`:\`\`]}),`,
  `O===\`list\`&&(0,Q.jsxs)(\`select\`,{className:Ol,value:g,onChange:e=>_(e.target.value),children:[(0,Q.jsx)(\`option\`,{value:\`new\`,children:\`Newest first\`}),(0,Q.jsx)(\`option\`,{value:\`az\`,children:\`A–Z\`})]})]}),(0,Q.jsxs)(\`div\`,{className:\`mt-3 flex flex-wrap gap-2\`,children:[(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`list\`?\`default\`:\`outline\`,onClick:()=>y(\`list\`),children:\`List\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`company\`?\`default\`:\`outline\`,onClick:()=>y(\`company\`),children:\`Company\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`sbu\`?\`default\`:\`outline\`,onClick:()=>y(\`sbu\`),children:\`SBU\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`function\`?\`default\`:\`outline\`,onClick:()=>y(\`function\`),children:\`Function\`}),n&&(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`summary\`?\`default\`:\`outline\`,onClick:()=>y(\`summary\`),children:\`Summary\`}),U(t)&&!w&&(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,className:\`ml-auto\`,onClick:()=>{T(!0),C(new Set)},children:\`Mass update\`})]})]}),O!==\`summary\`&&(0,Q.jsxs)(\`p\`,{className:\`text-xs text-muted-foreground\`,children:[j.length,\` people\`,O===\`company\`?\` · Primary line\`:O===\`sbu\`?\` · By studio\`:O===\`function\`?\` · By function\`:\`\`,k?\` · Line = reorder · row = nest\`:\`\`]}),`,
  "view buttons",
);

rt = replaceOnce(
  rt,
  `N=(0,Z.useMemo)(()=>gn(e.people,M),[e.people,M]),`,
  `N=(0,Z.useMemo)(()=>j.filter(e=>!e.managerId||!M.has(e.managerId)).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),[j,M]),kfCo=e=>j.filter(t=>t.managerId===e).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),`,
  "company roots",
);

// The nested block is fragile. Replace a smaller unique head and the Fl calls.
must(rt.includes(`O===\`nested\`?(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,"data-drop":\`person:root\``), "nested block missing");

rt = replaceOnce(
  rt,
  `O===\`nested\`?(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,"data-drop":\`person:root\``,
  `O===\`company\`||O===\`nested\`?(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,"data-drop":\`person:root\``,
  "company uses nested slot",
);

// Strip the dual-boss header; always map N roots with kidsFor
{
  const a = rt.indexOf("(()=>{let bosses=");
  must(a >= 0, "bosses IIFE missing");
  const b = rt.indexOf("})()]}):(0,Q.jsx)(`div`,{className:`overflow-hidden rounded-xl border border-border bg-card`,children:(0,Q.jsx)(`div`,{className:`divide-y divide-border`", a);
  must(b > a, "list branch after bosses missing");
  const insert =
    "N.map(e=>(0,Q.jsx)(`div`,{className:`overflow-hidden rounded-xl border border-border bg-card`,children:(0,Q.jsx)(Fl,{person:e,allowed:M,allowActions:A,forceOpen:!!i.trim(),onAddUnder:R(t)?x:void 0,selectedIds:S,onToggleSelect:P?L:void 0,kidsFor:kfCo})},e.id))]}):O===`sbu`?(0,Q.jsx)(Pfv,{kind:`sbu`,people:j,units:e.businessUnits,functions:e.functions,allowActions:A,selectedIds:S,onToggleSelect:P?L:void 0,forceOpen:!!i.trim()}):O===`function`?(0,Q.jsx)(Pfv,{kind:`function`,people:j,units:e.businessUnits,functions:e.functions,allowActions:A,selectedIds:S,onToggleSelect:P?L:void 0,forceOpen:!!i.trim()}):(0,Q.jsx)(`div`,{className:`overflow-hidden rounded-xl border border-border bg-card`,children:(0,Q.jsx)(`div`,{className:`divide-y divide-border`";
  rt = rt.slice(0, a) + insert + rt.slice(b + "})()]}):(0,Q.jsx)(`div`,{className:`overflow-hidden rounded-xl border border-border bg-card`,children:(0,Q.jsx)(`div`,{className:`divide-y divide-border`".length);
}

rt = replaceOnce(
  rt,
  `function Fl({person:e,allowed:t,allowActions:n,forceOpen:r,onAddUnder:i,selectedIds:a,onToggleSelect:o}){let s=K(),c=s.people.find(e=>e.id===s.currentUserId),l=rr(s.people,e.id,t),`,
  `function Fl({person:e,allowed:t,allowActions:n,forceOpen:r,onAddUnder:i,selectedIds:a,onToggleSelect:o,kidsFor:kf}){let s=K(),c=s.people.find(e=>e.id===s.currentUserId),getKids=kf||(id=>rr(s.people,id,t)),l=getKids(e.id),`,
  "Fl kidsFor",
);

rt = replaceOnce(
  rt,
  `(function walk(id){for(let k of rr(s.people,id,t)){if(seen.has(k.id))continue;seen.add(k.id);n++;walk(k.id)}})(e.id);return n})()`,
  `(function walk(id){for(let k of getKids(id)){if(seen.has(k.id))continue;seen.add(k.id);n++;walk(k.id)}})(e.id);return n})()`,
  "Fl team count walk",
);

rt = replaceOnce(
  rt,
  `x=s.functions.find(t=>t.id===e.functionId)?.name,S=Qs()`,
  `x=s.functions.find(t=>t.id===e.functionId)?.name,bu=(s.businessUnits||[]).find(t=>t.id===e.buId)?.name,S=Qs()`,
  "Fl bu",
);

rt = replaceOnce(
  rt,
  `w=[y,b?\`also \${b}\`:\`\`,x,team?\`\${team} \${team===1?\`person\`:\`people\`}\`:\`\`].filter(Boolean).join(\` · \`)||\`No role\``,
  `w=[y,b?\`also \${b}\`:\`\`,x,bu,team?\`\${team} \${team===1?\`person\`:\`people\`}\`:\`\`].filter(Boolean).join(\` · \`)||\`No role\``,
  "Fl subtitle sbu",
);

rt = replaceOnce(
  rt,
  `Fl,{person:k,allowed:t,allowActions:n,forceOpen:r,onAddUnder:i,selectedIds:a,onToggleSelect:o})},\`\${k.id}:\${e.id}\``,
  `Fl,{person:k,allowed:t,allowActions:n,forceOpen:r,onAddUnder:i,selectedIds:a,onToggleSelect:o,kidsFor:kf})},\`\${k.id}:\${e.id}\``,
  "Fl recurse kidsFor",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0u.js", "routes-e2g7y5q8-13m-p0v.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0u.js", "login-ChZ1wVZ-p0v.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0u.js"`, `from"./login-view-f2j6t0x4-11a3-p0v.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0u.js"`, `from"./index-f4j9a7t3-11v-p0v.js"`, "login idx");

must(rt.includes("function Pfv("), "Pfv missing");
must(rt.includes("y(`company`)"), "company button missing");
must(rt.includes("kidsFor:kfCo"), "company kidsFor missing");
must(rt.includes("kind:`sbu`") || rt.includes("kind:\\`sbu\\`") || rt.includes("kind:`sbu`") || rt.includes("kind:`sbu`"), "sbu view");

writeBoth("login-view-f2j6t0x4-11a3-p0v.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0v.js", rt);
writeBoth("index-f4j9a7t3-11v-p0v.js", idx);
writeBoth("login-ChZ1wVZ-p0v.js", login);
writeBoth("apms-org-scope.js", readFileSync(join(pub, "apms-org-scope.js"), "utf8"));

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0u.js").join("index-f4j9a7t3-11v-p0v.js");
  html = html.split("routes-e2g7y5q8-13m-p0u.js").join("routes-e2g7y5q8-13m-p0v.js");
  html = html.split("apms-sync.js?v=p0u1").join("apms-sync.js?v=p0v1");
  writeFileSync(path, html);
}
for (const f of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
  try { stampHtml(join(root, f)); } catch { /* optional */ }
}
console.log("p0v stamp ok");
