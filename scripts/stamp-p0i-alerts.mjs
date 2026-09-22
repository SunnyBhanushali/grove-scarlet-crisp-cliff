/**
 * Stamp p0i: home alerts — no Open/Done tabs, both buttons dismiss,
 * lock/unlock copies of the same notice collapse to one.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0h.js"), join(pub, "login-view-f2j6t0x4-11a3-p0i.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0h.js"), join(pub, "routes-e2g7y5q8-13m-p0i.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0h.js"), join(pub, "index-f4j9a7t3-11v-p0i.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0h.js"), join(pub, "login-ChZ1wVZ-p0i.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0i.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0i.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0i.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0i.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0h.js";import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa,personSbuIds as __sbuIds}from"./apms-org-scope.js";`,
  `from"./index-f4j9a7t3-11v-p0i.js";import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa,personSbuIds as __sbuIds,collapseOpenNotices as __collapse}from"./apms-org-scope.js";`,
  "login-view imports",
);

lv = replaceOnce(
  lv,
  `function qf(e){return\`\${e.kind}|\${e.month||\`\`}|\${e.planKind||\`\`}|\${e.subjectId||\`\`}|\${[...e.toIds].sort().join(\`,\`)}|\${e.phase||\`\`}\`}`,
  `function qf(e){return\`\${e.kind}|\${e.month||\`\`}|\${e.planKind||\`\`}|\${e.subjectId||\`\`}|\${[...e.toIds||[]].sort().join(\`,\`)}|\${e.phase||\`\`}\`}`,
  "qf null-safe toIds",
);

lv = replaceOnce(
  lv,
  `addNotice:t=>{let n=\`nt-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,6)}\`,r={...t,id:n,status:t.status||\`open\`,createdAt:new Date().toISOString()};return e(e=>({notices:[r,...e.notices||[]]})),n}`,
  `addNotice:n=>{let payload={...n,toIds:n.toIds||[],status:n.status||\`open\`,id:n.id||\`nt-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,6)}\`};let out=__collapse(t().notices||[],payload);return e(s=>({notices:out.notices})),out.id}`,
  "addNotice collapse",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0h.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0i.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0h.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0i.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);
rt = replaceOnce(
  rt,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,patchRemovePersonFromSbu as __dropSbu}from"./apms-org-scope.js";`,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,patchRemovePersonFromSbu as __dropSbu,groupNoticesByKey as __groupN,siblingNoticeIds as __sibN}from"./apms-org-scope.js";`,
  "routes helper import",
);

rt = replaceOnce(
  rt,
  `function iu({userId:e,personId:t}){let n=K(),r=n.people.find(t=>t.id===e),[a,o]=(0,Z.useState)(\`open\`);if(!r)return null;let i=Qe(n,r),allN=(n.notices||[]).filter(x=>x.toIds.includes(e)),openN=allN.filter(x=>x.status===\`open\`&&!(x.doneIds||[]).includes(e)),doneN=allN.filter(x=>x.status===\`done\`||(x.doneIds||[]).includes(e)),emp=E(n,r),c=n.dismissedAlertIds||[],empOpen=emp.filter(x=>!c.includes(\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`)),empDone=emp.filter(x=>c.includes(\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`));`,
  `function iu({userId:e,personId:t}){let n=K(),r=n.people.find(t=>t.id===e);if(!r)return null;let i=Qe(n,r),allN=(n.notices||[]).filter(x=>x.toIds.includes(e)),openN=__groupN(allN.filter(x=>x.status===\`open\`&&!(x.doneIds||[]).includes(e))),emp=E(n,r),c=n.dismissedAlertIds||[],empOpen=emp.filter(x=>!c.includes(\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`));`,
  "iu setup",
);

rt = replaceOnce(
  rt,
  `function rowN(x){return{k:\`n:\${x.id}\`,label:x.title,body:x.body,n:null,go:()=>goN(x),done:()=>n.markNotice(x.id,\`done\`)}}function rowE(x){let k=\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`;return{k,label:x.title,body:x.body,n:null,go:()=>goEmp(x),done:()=>n.dismissAlert(k)}}`,
  `function doneN(x){for(let id of __sibN(n.notices,x,e))n.markNotice(id,\`done\`)}function rowN(x){return{k:\`n:\${x.id}\`,label:x.title,body:x.body,n:null,go:()=>{goN(x),doneN(x)},done:()=>doneN(x)}}function rowE(x){let k=\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`;return{k,label:x.title,body:x.body,n:null,go:()=>{goEmp(x),n.dismissAlert(k)},done:()=>n.dismissAlert(k)}}`,
  "iu row dismiss",
);

rt = replaceOnce(
  rt,
  `ops=ops.filter(e=>e.n>0).map(e=>{let k=\`ops:\${e.label}\`;return{k,label:e.label,body:null,n:e.n,go:e.go,done:()=>n.dismissAlert(k)}})`,
  `ops=ops.filter(e=>e.n>0).map(e=>{let k=\`ops:\${e.label}\`;return{k,label:e.label,body:null,n:e.n,go:()=>{e.go(),n.dismissAlert(k)},done:()=>n.dismissAlert(k)}})`,
  "iu ops dismiss on open",
);

rt = replaceOnce(
  rt,
  `let l=[...openN.map(rowN),...empOpen.map(rowE),...ops.filter(e=>!c.includes(e.k))],u=[...doneN.map(rowN),...empDone.map(rowE),...ops.filter(e=>c.includes(e.k))],d=a===\`open\`?l:u;return(0,Q.jsxs)(\`div\`,{className:q(\`grid gap-4\`,l.length||u.length?\`lg:grid-cols-2\`:\`\`),children:[(l.length||u.length)&&(0,Q.jsxs)(\`section\`,{className:\`rounded-xl border border-border bg-card p-5\`,"data-alerts":\`home\`,children:[(0,Q.jsxs)(\`div\`,{className:\`flex flex-wrap items-center justify-between gap-3\`,children:[(0,Q.jsx)(\`h2\`,{className:\`font-display text-lg\`,children:\`Alerts\`}),(0,Q.jsx)(\`div\`,{className:\`flex rounded-lg bg-muted p-0.5\`,children:[\`open\`,\`done\`].map(e=>(0,Q.jsxs)(\`button\`,{type:\`button\`,onClick:()=>o(e),className:q(\`rounded-md px-3 py-1.5 text-xs font-medium\`,a===e?\`bg-card text-foreground shadow-sm\`:\`text-muted-foreground hover:text-foreground\`),children:[e===\`open\`?\`Open\`:\`Done\`,(0,Q.jsx)(\`span\`,{className:\`ml-1 tabular-nums text-[10px] text-muted-foreground\`,children:e===\`open\`?l.length:u.length})]},e))})]}),d.length?(0,Q.jsx)(\`ul\`,{className:\`mt-3 divide-y divide-border\`,children:d.map(e=>(0,Q.jsxs)(\`li\`,{className:\`flex items-center justify-between gap-2 py-2.5\`,children:[(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`min-w-0 flex-1 text-left hover:opacity-90\`,onClick:e.go,children:[(0,Q.jsx)(\`span\`,{className:\`text-sm font-medium\`,children:e.label}),e.body?(0,Q.jsx)(\`span\`,{className:\`mt-0.5 block text-xs text-muted-foreground\`,children:e.body}):(0,Q.jsx)(\`span\`,{className:\`ml-2 font-display text-xl tabular-nums text-red-700 dark:text-red-300\`,children:e.n})]}),(0,Q.jsxs)(\`div\`,{className:\`flex shrink-0 gap-1\`,children:[(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:e.go,children:\`Open\`}),a===\`open\`?(0,Q.jsx)(z,{size:\`sm\`,variant:\`ghost\`,onClick:e.done,children:\`Done\`}):null]})]},e.k))}):(0,Q.jsx)(\`p\`,{className:\`mt-3 text-sm text-muted-foreground\`,children:a===\`open\`?\`Nothing open.\`:\`Nothing marked done.\`})]})`,
  `let l=[...openN.map(rowN),...empOpen.map(rowE),...ops.filter(e=>!c.includes(e.k))];return(0,Q.jsxs)(\`div\`,{className:\`grid gap-4 lg:grid-cols-2\`,children:[(0,Q.jsxs)(\`section\`,{className:\`rounded-xl border border-border bg-card p-5\`,"data-alerts":\`home\`,children:[(0,Q.jsx)(\`h2\`,{className:\`font-display text-lg\`,children:\`Alerts\`}),l.length?(0,Q.jsx)(\`ul\`,{className:\`mt-3 divide-y divide-border\`,children:l.map(e=>(0,Q.jsxs)(\`li\`,{className:\`flex items-center justify-between gap-2 py-2.5\`,children:[(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`min-w-0 flex-1 text-left hover:opacity-90\`,onClick:e.go,children:[(0,Q.jsx)(\`span\`,{className:\`text-sm font-medium\`,children:e.label}),e.body?(0,Q.jsx)(\`span\`,{className:\`mt-0.5 block text-xs text-muted-foreground\`,children:e.body}):(0,Q.jsx)(\`span\`,{className:\`ml-2 font-display text-xl tabular-nums text-red-700 dark:text-red-300\`,children:e.n})]}),(0,Q.jsxs)(\`div\`,{className:\`flex shrink-0 gap-1\`,children:[(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:e.go,children:\`Open\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:\`ghost\`,onClick:e.done,children:\`Done\`})]})]},e.k))}):(0,Q.jsx)(\`p\`,{className:\`mt-3 text-sm text-muted-foreground\`,children:\`No alerts.\`})]})`,
  "iu list UI",
);

rt = replaceOnce(
  rt,
  `function au({userId:e}){let t=K(),n=t.people.find(t=>t.id===e),[r,i]=(0,Z.useState)(\`open\`);if(!n)return null;let a=(t.notices||[]).filter(t=>t.toIds.includes(e)&&t.kind!==\`plan_due\`&&t.kind!==\`plan_late\`&&t.kind!==\`month_close_due\`),o=a.filter(n=>n.status===\`open\`&&!(n.doneIds||[]).includes(e)),s=a.filter(n=>n.status===\`done\`||(n.doneIds||[]).includes(e)),c=E(t,n),l=t.dismissedAlertIds||[],u=c.filter(t=>!l.includes(\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`)),d=c.filter(t=>l.includes(\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`)),f=r===\`open\`?[...o.map(e=>({k:\`n:\${e.id}\`,kind:\`notice\`,row:e})),...u.map(t=>({k:\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`,kind:\`emp\`,row:t}))]:[...s.map(e=>({k:\`n:\${e.id}\`,kind:\`notice\`,row:e})),...d.map(t=>({k:\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`,kind:\`emp\`,row:t}))];`,
  `function au({userId:e}){let t=K(),n=t.people.find(t=>t.id===e);if(!n)return null;let a=__groupN((t.notices||[]).filter(t=>t.toIds.includes(e)&&t.kind!==\`plan_due\`&&t.kind!==\`plan_late\`&&t.kind!==\`month_close_due\`&&t.status===\`open\`&&!(t.doneIds||[]).includes(e))),c=E(t,n),l=t.dismissedAlertIds||[],u=c.filter(t=>!l.includes(\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`)),f=[...a.map(e=>({k:\`n:\${e.id}\`,kind:\`notice\`,row:e})),...u.map(t=>({k:\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`,kind:\`emp\`,row:t}))];`,
  "au setup",
);

rt = replaceOnce(
  rt,
  `function m(n){n.kind===\`notice\`?t.markNotice(n.row.id,\`done\`):t.dismissAlert(n.k)}`,
  `function m(n){n.kind===\`notice\`?__sibN(t.notices,n.row,e).forEach(id=>t.markNotice(id,\`done\`)):t.dismissAlert(n.k)}function openA(n){p(n),m(n)}`,
  "au dismiss group",
);

rt = replaceOnce(
  rt,
  `return(0,Q.jsxs)(\`section\`,{className:\`rounded-xl border border-border bg-card p-4 sm:p-5\`,"data-alerts":\`home\`,children:[(0,Q.jsxs)(\`div\`,{className:\`flex flex-wrap items-center justify-between gap-3\`,children:[(0,Q.jsx)(\`h2\`,{className:\`font-display text-lg\`,children:\`Alerts\`}),(0,Q.jsx)(\`div\`,{className:\`flex rounded-lg bg-muted p-0.5\`,children:[\`open\`,\`done\`].map(e=>(0,Q.jsxs)(\`button\`,{type:\`button\`,onClick:()=>i(e),className:q(\`rounded-md px-3 py-1.5 text-xs font-medium\`,r===e?\`bg-card text-foreground shadow-sm\`:\`text-muted-foreground hover:text-foreground\`),children:[e===\`open\`?\`Open\`:\`Done\`,(0,Q.jsx)(\`span\`,{className:\`ml-1 tabular-nums text-[10px] text-muted-foreground\`,children:e===\`open\`?o.length+u.length:s.length+d.length})]},e))})]}),f.length?(0,Q.jsx)(\`ul\`,{className:\`mt-3 divide-y divide-border\`,children:f.map(e=>{let n=e.row;return(0,Q.jsxs)(\`li\`,{className:\`flex items-center justify-between gap-2 py-2.5\`,children:[(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`min-w-0 flex-1 text-left\`,onClick:()=>p(e),children:[(0,Q.jsx)(\`div\`,{className:\`truncate text-sm font-medium\`,children:n.title}),(0,Q.jsx)(\`div\`,{className:\`truncate text-xs text-muted-foreground\`,children:n.body})]}),(0,Q.jsxs)(\`div\`,{className:\`flex shrink-0 gap-1\`,children:[(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:()=>p(e),children:\`Open\`}),r===\`open\`?(0,Q.jsx)(z,{size:\`sm\`,variant:\`ghost\`,onClick:()=>m(e),children:\`Done\`}):null]})]},e.k)})}):(0,Q.jsx)(\`p\`,{className:\`mt-3 text-sm text-muted-foreground\`,children:r===\`open\`?\`Nothing open.\`:\`Nothing marked done.\`})]})}function ou()`,
  `return(0,Q.jsxs)(\`section\`,{className:\`rounded-xl border border-border bg-card p-4 sm:p-5\`,"data-alerts":\`home\`,children:[(0,Q.jsx)(\`h2\`,{className:\`font-display text-lg\`,children:\`Alerts\`}),f.length?(0,Q.jsx)(\`ul\`,{className:\`mt-3 divide-y divide-border\`,children:f.map(e=>{let n=e.row;return(0,Q.jsxs)(\`li\`,{className:\`flex items-center justify-between gap-2 py-2.5\`,children:[(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`min-w-0 flex-1 text-left\`,onClick:()=>openA(e),children:[(0,Q.jsx)(\`div\`,{className:\`truncate text-sm font-medium\`,children:n.title}),(0,Q.jsx)(\`div\`,{className:\`truncate text-xs text-muted-foreground\`,children:n.body})]}),(0,Q.jsxs)(\`div\`,{className:\`flex shrink-0 gap-1\`,children:[(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:()=>openA(e),children:\`Open\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:\`ghost\`,onClick:()=>m(e),children:\`Done\`})]})]},e.k)})}):(0,Q.jsx)(\`p\`,{className:\`mt-3 text-sm text-muted-foreground\`,children:\`No alerts.\`})]})}function ou()`,
  "au list UI",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0h.js", "routes-e2g7y5q8-13m-p0i.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0h.js", "login-ChZ1wVZ-p0i.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0h.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0i.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0h.js"`,
  `from"./index-f4j9a7t3-11v-p0i.js"`,
  "login-ChZ index",
);

writeBoth("login-view-f2j6t0x4-11a3-p0i.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0i.js", rt);
writeBoth("index-f4j9a7t3-11v-p0i.js", idx);
writeBoth("login-ChZ1wVZ-p0i.js", login);
writeBoth("apms-org-scope.js", readFileSync(join(pub, "apms-org-scope.js"), "utf8"));

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0h.js").join("index-f4j9a7t3-11v-p0i.js");
  html = html.split("routes-e2g7y5q8-13m-p0h.js").join("routes-e2g7y5q8-13m-p0i.js");
  html = html.split("apms-sync.js?v=p0h1").join("apms-sync.js?v=p0i1");
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

console.log("p0i stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
