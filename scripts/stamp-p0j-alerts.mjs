/**
 * Stamp p0j: Sameer's three "plan locked / ready" rows become one Home alert.
 * (lock notice + login-cycle notice + Kf ready row)
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0i.js"), join(pub, "login-view-f2j6t0x4-11a3-p0j.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0i.js"), join(pub, "routes-e2g7y5q8-13m-p0j.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0i.js"), join(pub, "index-f4j9a7t3-11v-p0j.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0i.js"), join(pub, "login-ChZ1wVZ-p0j.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0j.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0j.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0j.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0j.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0i.js";`,
  `from"./index-f4j9a7t3-11v-p0j.js";`,
  "login-view index import",
);

lv = replaceOnce(
  lv,
  `function qf(e){return\`\${e.kind}|\${e.month||\`\`}|\${e.planKind||\`\`}|\${e.subjectId||\`\`}|\${[...e.toIds||[]].sort().join(\`,\`)}|\${e.phase||\`\`}\`}`,
  `function qf(e){let phase=e.kind===\`plan_ready\`||e.kind===\`month_closed\`?\`\`:e.phase||\`\`;return\`\${e.kind}|\${e.month||\`\`}|\${e.planKind||\`\`}|\${e.subjectId||\`\`}|\${[...e.toIds||[]].sort().join(\`,\`)}|\${phase}\`}`,
  "qf ignore phase on plan_ready",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0i.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0j.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0i.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0j.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);
rt = replaceOnce(
  rt,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,patchRemovePersonFromSbu as __dropSbu,groupNoticesByKey as __groupN,siblingNoticeIds as __sibN}from"./apms-org-scope.js";`,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,patchRemovePersonFromSbu as __dropSbu,groupNoticesByKey as __groupN,siblingNoticeIds as __sibN,empAlertDuplicatesNotice as __empDup,empAlertKeyForNotice as __empKey}from"./apms-org-scope.js";`,
  "routes helper import",
);

rt = replaceOnce(
  rt,
  `empOpen=emp.filter(x=>!c.includes(\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`));`,
  `empOpen=emp.filter(x=>!c.includes(\`emp:\${e}:\${x.kind}:\${x.month}:\${x.phase}\`)&&!__empDup(x,openN,e));`,
  "iu hide emp covered by notice",
);

rt = replaceOnce(
  rt,
  `function doneN(x){for(let id of __sibN(n.notices,x,e))n.markNotice(id,\`done\`)}`,
  `function doneN(x){for(let id of __sibN(n.notices,x,e))n.markNotice(id,\`done\`);let ek=__empKey(e,x);ek&&n.dismissAlert(ek)}`,
  "iu done also dismisses emp twin",
);

rt = replaceOnce(
  rt,
  `u=c.filter(t=>!l.includes(\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`)),f=[...a.map(e=>({k:\`n:\${e.id}\`,kind:\`notice\`,row:e})),...u.map(t=>({k:\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`,kind:\`emp\`,row:t}))];`,
  `u=c.filter(t=>!l.includes(\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`)&&!__empDup(t,a,e)),f=[...a.map(e=>({k:\`n:\${e.id}\`,kind:\`notice\`,row:e})),...u.map(t=>({k:\`emp:\${e}:\${t.kind}:\${t.month}:\${t.phase}\`,kind:\`emp\`,row:t}))];`,
  "au hide emp covered by notice",
);

rt = replaceOnce(
  rt,
  `function m(n){n.kind===\`notice\`?__sibN(t.notices,n.row,e).forEach(id=>t.markNotice(id,\`done\`)):t.dismissAlert(n.k)}function openA(n){p(n),m(n)}`,
  `function m(n){if(n.kind===\`notice\`){__sibN(t.notices,n.row,e).forEach(id=>t.markNotice(id,\`done\`));let ek=__empKey(e,n.row);ek&&t.dismissAlert(ek)}else t.dismissAlert(n.k)}function openA(n){p(n),m(n)}`,
  "au done also dismisses emp twin",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0i.js", "routes-e2g7y5q8-13m-p0j.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0i.js", "login-ChZ1wVZ-p0j.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0i.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0j.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0i.js"`,
  `from"./index-f4j9a7t3-11v-p0j.js"`,
  "login-ChZ index",
);

writeBoth("login-view-f2j6t0x4-11a3-p0j.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0j.js", rt);
writeBoth("index-f4j9a7t3-11v-p0j.js", idx);
writeBoth("login-ChZ1wVZ-p0j.js", login);
writeBoth("apms-org-scope.js", readFileSync(join(pub, "apms-org-scope.js"), "utf8"));

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0i.js").join("index-f4j9a7t3-11v-p0j.js");
  html = html.split("routes-e2g7y5q8-13m-p0i.js").join("routes-e2g7y5q8-13m-p0j.js");
  html = html.split("apms-sync.js?v=p0i1").join("apms-sync.js?v=p0j1");
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

console.log("p0j stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
