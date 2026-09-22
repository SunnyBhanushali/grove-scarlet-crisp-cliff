/**
 * Stamp p0u: People tree walks reporting with a leader scope that never widens.
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
  for (const p of [join(pub, rel), join(rec, rel), join(dist, rel)]) {
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    } catch (e) {
      if (String(p).includes("/dist/")) continue;
      throw e;
    }
  }
}

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0t.js"), join(pub, "login-view-f2j6t0x4-11a3-p0u.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0t.js"), join(pub, "routes-e2g7y5q8-13m-p0u.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0t.js"), join(pub, "index-f4j9a7t3-11v-p0u.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0t.js"), join(pub, "login-ChZ1wVZ-p0u.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0u.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0u.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0u.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0u.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0t.js";`, `from"./index-f4j9a7t3-11v-p0u.js";`, "lv index");
lv = replaceOnce(
  lv,
  `import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa,personSbuIds as __sbuIds,collapseOpenNotices as __collapse}from"./apms-org-scope.js";`,
  `import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa,personSbuIds as __sbuIds,collapseOpenNotices as __collapse,scopedTeamIds as __scopedTeam}from"./apms-org-scope.js";`,
  "lv scoped import",
);

lv = replaceOnce(
  lv,
  `function Df(e,t,n=[]){let r=Ef(e,t.id);if(t&&!G(t))r=__accFilter(e,t,r);if(t.access===\`function_head\`&&t.functionId){let i=n.length?ze(n,t.functionId):new Set([t.functionId]);for(let n of e)n.id!==t.id&&(n.functionId===t.functionId||He(n,i))&&r.add(n.id)}return e.filter(e=>r.has(e.id)&&(e.status||\`active\`)!==\`left\`).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`))}`,
  `function Df(e,t,n=[],u=[]){if(!t)return[];if(G(t))return e.filter(e=>(e.status||\`active\`)!==\`left\`);let r=__scopedTeam(e,t,n,u);return e.filter(e=>r.has(e.id)&&(e.status||\`active\`)!==\`left\`).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`))}`,
  "Df scoped team",
);

lv = replaceOnce(
  lv,
  `function Mf(e,t,n){let r=Ef(e,t.id);if(t&&!G(t))r=__accFilter(e,t,r);return n.self!==!1&&r.add(t.id),n.boss&&(t.managerId&&r.add(t.managerId),(t.dottedLine||[]).forEach(d=>d.managerId&&!d.functionId&&r.add(d.managerId))),e.filter(e=>r.has(e.id)&&(n.includeLeft||(e.status||\`active\`)!==\`left\`))}`,
  `function Mf(e,t,n,fns,units){if(!t)return[];let r=__scopedTeam(e,t,fns||[],units||[]);return n.self!==!1&&r.add(t.id),n.boss&&(t.managerId&&r.add(t.managerId),(t.dottedLine||[]).forEach(d=>d.managerId&&!d.functionId&&r.add(d.managerId))),e.filter(e=>r.has(e.id)&&(n.includeLeft||(e.status||\`active\`)!==\`left\`))}`,
  "Mf scoped team",
);

rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0t.js"`, `from"./login-view-f2j6t0x4-11a3-p0u.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0t.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0u.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);
rt = replaceOnce(
  rt,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,`,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,leaderScopeLabel as __scopeLabel,`,
  "rt scope label import",
);

rt = replaceOnce(
  rt,
  `qe(e.people,t,{boss:!0,self:!0,includeLeft:e.peopleListFilter===\`left_ytd\`})`,
  `qe(e.people,t,{boss:!0,self:!0,includeLeft:e.peopleListFilter===\`left_ytd\`},e.functions,e.businessUnits)`,
  "kl qe pass units",
);

rt = replaceOnce(
  rt,
  `=\`summary\`&&(0,Q.jsxs)(\`p\`,{className:\`text-xs text-muted-foreground\`,children:[j.length,\` people\`,O===\`nested\`&&k?\` · Line = reorder · row = nest\`:\`\`]}),`,
  `=\`summary\`&&(0,Q.jsxs)(\`p\`,{className:\`text-xs text-muted-foreground\`,children:[j.length,\` people\`,t&&!U(t)?\` · \${__scopeLabel(t,e.people,e.functions,e.businessUnits)}\`:\`\`,O===\`nested\`&&k?\` · Line = reorder · row = nest\`:\`\`]}),`,
  "people scope hint",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0t.js", "routes-e2g7y5q8-13m-p0u.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0t.js", "login-ChZ1wVZ-p0u.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0t.js"`, `from"./login-view-f2j6t0x4-11a3-p0u.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0t.js"`, `from"./index-f4j9a7t3-11v-p0u.js"`, "login idx");

must(lv.includes("__scopedTeam(e,t,n,u)"), "Df not wired");
must(lv.includes("__scopedTeam(e,t,fns||[]"), "Mf not wired");
must(rt.includes("__scopeLabel"), "label missing");

writeBoth("login-view-f2j6t0x4-11a3-p0u.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0u.js", rt);
writeBoth("index-f4j9a7t3-11v-p0u.js", idx);
writeBoth("login-ChZ1wVZ-p0u.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0t.js").join("index-f4j9a7t3-11v-p0u.js");
  html = html.split("routes-e2g7y5q8-13m-p0t.js").join("routes-e2g7y5q8-13m-p0u.js");
  html = html.split("apms-sync.js?v=p0t1").join("apms-sync.js?v=p0u1");
  writeFileSync(path, html);
}
for (const f of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
  try { stampHtml(join(root, f)); } catch { /* optional */ }
}
console.log("p0u stamp ok");
