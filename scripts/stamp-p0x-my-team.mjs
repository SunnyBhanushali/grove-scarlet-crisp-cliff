/**
 * Stamp p0x: My team tab after List (personal line vs whole company).
 */
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0w.js"), join(pub, "login-view-f2j6t0x4-11a3-p0x.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0w.js"), join(pub, "routes-e2g7y5q8-13m-p0x.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0w.js"), join(pub, "index-f4j9a7t3-11v-p0x.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0w.js"), join(pub, "login-ChZ1wVZ-p0x.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0x.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0x.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0x.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0x.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0w.js";`, `from"./index-f4j9a7t3-11v-p0x.js";`, "lv index");
rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0w.js"`, `from"./login-view-f2j6t0x4-11a3-p0x.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0w.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0x.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);
rt = replaceOnce(
  rt,
  `leaderScopeLabel as __scopeLabel,`,
  `leaderScopeLabel as __scopeLabel,scopedTeam as __myTeam,`,
  "import scopedTeam",
);

rt = replaceOnce(
  rt,
  `function kl(){let e=K(),t=e.people.find(t=>t.id===e.currentUserId),n=Hn(t)||In(t),r=(function(){`,
  `function kl(){let e=K(),t=e.people.find(t=>t.id===e.currentUserId),n=Hn(t)||In(t),rAll=(function(){`,
  "rename r to rAll",
);

rt = replaceOnce(
  rt,
  `[v,y]=(0,Z.useState)(()=>U(t)?\`company\`:t&&t.access===\`function_head\`?\`function\`:t&&t.access===\`manager\`?\`sbu\`:\`list\`)`,
  `[v,y]=(0,Z.useState)(()=>t?\`my\`:\`list\`)`,
  "default My team",
);

rt = replaceOnce(
  rt,
  `O=e.peopleListFilter?\`list\`:v,k=U(t)&&O===\`company\`,A=U(t)||In(t);`,
  `O=e.peopleListFilter?\`list\`:v,k=U(t)&&O===\`company\`,A=U(t)||In(t),rMine=t?__myTeam(e.people,t,e.functions,e.businessUnits):[],r=O===\`my\`?rMine:rAll;`,
  "pick my team vs company pool",
);

rt = replaceOnce(
  rt,
  `kfCo=e=>pool.filter(t=>t.managerId===e).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),`,
  `kfCo=e=>pool.filter(t=>t.managerId===e).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),kfMy=__nps(pool).kids,`,
  "my-team kids include dotted",
);

{
  const oldN = `N=(0,Z.useMemo)(()=>j.filter(e=>!e.managerId||!M.has(e.managerId)).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),[j,M])`;
  const newN = `N=(0,Z.useMemo)(()=>O===\`my\`&&t&&!i.trim()&&j.some(e=>e.id===t.id)?[j.find(e=>e.id===t.id)]:j.filter(e=>!e.managerId||!M.has(e.managerId)).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)),[j,M,O,t,i])`;
  rt = replaceOnce(rt, oldN, newN, "my team roots at self");
}

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`list\`?\`default\`:\`outline\`,onClick:()=>y(\`list\`),children:\`List\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`company\`?\`default\`:\`outline\`,onClick:()=>y(\`company\`),children:\`Company\`})`,
  `(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`list\`?\`default\`:\`outline\`,onClick:()=>y(\`list\`),children:\`List\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`my\`?\`default\`:\`outline\`,onClick:()=>y(\`my\`),children:\`My team\`}),(0,Q.jsx)(z,{size:\`sm\`,variant:v===\`company\`?\`default\`:\`outline\`,onClick:()=>y(\`company\`),children:\`Company\`})`,
  "My team button",
);

rt = replaceOnce(
  rt,
  `O===\`company\`?\` · Primary line\`:O===\`sbu\`?\` · By studio\`:O===\`function\`?\` · By function\`:\`\``,
  `O===\`my\`?\` · My team\`:O===\`company\`?\` · Primary line\`:O===\`sbu\`?\` · By studio\`:O===\`function\`?\` · By function\`:\`\``,
  "hint",
);

rt = replaceOnce(
  rt,
  `O===\`company\`||O===\`nested\`?(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,"data-drop":\`person:root\``,
  `O===\`company\`||O===\`nested\`||O===\`my\`?(0,Q.jsxs)(\`div\`,{className:\`space-y-2\`,"data-drop":\`person:root\``,
  "my uses tree slot",
);

rt = replaceAllCount(
  rt,
  `kidsFor:kfCo`,
  `kidsFor:O===\`my\`?kfMy:kfCo`,
  2,
  "kidsFor my vs company",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0w.js", "routes-e2g7y5q8-13m-p0x.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0w.js", "login-ChZ1wVZ-p0x.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0w.js"`, `from"./login-view-f2j6t0x4-11a3-p0x.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0w.js"`, `from"./index-f4j9a7t3-11v-p0x.js"`, "login idx");

must(rt.includes("children:`My team`"), "button missing");
must(rt.includes("r=O===`my`?rMine:rAll"), "pool switch missing");
must(rt.includes("kfMy=__nps(pool).kids"), "kfMy missing");

writeBoth("login-view-f2j6t0x4-11a3-p0x.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0x.js", rt);
writeBoth("index-f4j9a7t3-11v-p0x.js", idx);
writeBoth("login-ChZ1wVZ-p0x.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0w.js").join("index-f4j9a7t3-11v-p0x.js");
  html = html.split("routes-e2g7y5q8-13m-p0w.js").join("routes-e2g7y5q8-13m-p0x.js");
  html = html.split("apms-sync.js?v=p0w1").join("apms-sync.js?v=p0x1");
  writeFileSync(path, html);
}
for (const f of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
  try { stampHtml(join(root, f)); } catch {}
}
console.log("p0x stamp ok");
