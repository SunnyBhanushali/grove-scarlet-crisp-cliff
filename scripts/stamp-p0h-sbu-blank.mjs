/**
 * Stamp p0h: people sit on an SBU only via explicit home+extras.
 * Create stays blank. Remove from an SBU does not dump into Bangalore.
 * Copies live p0g SPA files and patches the real constructors.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0g.js"), join(pub, "login-view-f2j6t0x4-11a3-p0h.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0g.js"), join(pub, "routes-e2g7y5q8-13m-p0h.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0g.js"), join(pub, "index-f4j9a7t3-11v-p0h.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0g.js"), join(pub, "login-ChZ1wVZ-p0h.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0h.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0h.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0h.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0h.js"), "utf8");

lv = replaceAllCount(lv, "index-f4j9a7t3-11v-p0g.js", "index-f4j9a7t3-11v-p0h.js", 1, "lv index import");
lv = replaceOnce(
  lv,
  `import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa}from"./apms-org-scope.js";`,
  `import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa,personSbuIds as __sbuIds}from"./apms-org-scope.js";`,
  "lv sbu helper import",
);
lv = replaceOnce(
  lv,
  `function ft(e,t,n){if(e.buIds?.length)return e.buIds;if(e.brandIds?.length){let n=new Set(e.brandIds);let ofBrand=t.filter(u=>n.has(u.brandId));let tops=ofBrand.filter(u=>u.isGroup||ofBrand.some(c=>c.parentId===u.id));return (tops.length?tops:[]).map(u=>u.id)}return e.buId?[e.buId]:[]}`,
  `function ft(e,t,n){return __sbuIds(e)}`,
  "ft explicit sbu only",
);
lv = replaceOnce(
  lv,
  `brandId:n.brandId||\`\`,buId:n.buId||\`\`,companyId:n.companyId||f.companyId||\`\``,
  `brandId:n.brandId||\`\`,buId:n.buId||\`\`,buIds:Array.isArray(n.buIds)?n.buIds.filter(Boolean):[],companyId:n.companyId||f.companyId||\`\``,
  "addPerson buIds blank",
);

rt = replaceAllCount(rt, "login-view-f2j6t0x4-11a3-p0g.js", "login-view-f2j6t0x4-11a3-p0h.js", 2, "routes login-view");
rt = replaceOnce(
  rt,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip}from"./apms-org-scope.js";`,
  `import{linkedSbuActual as __lsa,kpiScopeChip as __kchip,pickerHomeBuId as __homeBu,patchRemovePersonFromSbu as __dropSbu}from"./apms-org-scope.js";`,
  "routes sbu helpers",
);
rt = replaceOnce(
  rt,
  `title:S&&r.roles[S]?.name||\`\`,companyId:\`\`,brandId:\`\`,buId:\`\`,roleId:S||null`,
  `title:S&&r.roles[S]?.name||\`\`,companyId:\`\`,brandId:\`\`,buId:\`\`,buIds:[],roleId:S||null`,
  "Gs create blank sbu",
);
rt = replaceOnce(
  rt,
  `brandIds:t.brandIds,buIds:t.buIds,brandId:t.companyWide?l.brandId:t.brandIds[0]||\`\`,buId:t.companyWide?l.buId:t.buIds[0]||\`\``,
  `brandIds:t.brandIds,buIds:t.buIds,brandId:t.companyWide?l.brandId:t.brandIds[0]||\`\`,buId:__homeBu({companyWide:t.companyWide,buIds:t.buIds,prevBuId:l.buId})`,
  "editor picker home",
);
rt = replaceOnce(
  rt,
  `brandId:l.companyWide?l.brandId:l.brandIds?.[0]||l.brandId||\`\`,buId:l.companyWide?l.buId:l.buIds?.[0]||l.buId||\`\``,
  `brandId:l.companyWide?l.brandId:l.brandIds?.[0]||l.brandId||\`\`,buId:__homeBu({companyWide:l.companyWide,buIds:l.buIds,prevBuId:l.buId})`,
  "editor save home",
);
rt = replaceAllCount(
  rt,
  `nextBu=[...new Set([...(p.buIds||[]),p.buId].filter(Boolean))].filter(id=>id!==t.id),patch={buId:p.buId===t.id?(nextBu[0]||\`\`):p.buId||\`\`,buIds:nextBu}`,
  `drop=__dropSbu(p,t.id),patch={buId:drop.buId,buIds:drop.buIds}`,
  2,
  "sbu page remove no promote",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0g.js", "routes-e2g7y5q8-13m-p0h.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0g.js", "login-ChZ1wVZ-p0h.js", 2, "index login");

login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0g.js"`, `from"./login-view-f2j6t0x4-11a3-p0h.js"`, "login-ChZ lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0g.js"`, `from"./index-f4j9a7t3-11v-p0h.js"`, "login-ChZ idx");

writeBoth("login-view-f2j6t0x4-11a3-p0h.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0h.js", rt);
writeBoth("index-f4j9a7t3-11v-p0h.js", idx);
writeBoth("login-ChZ1wVZ-p0h.js", login);
writeBoth("apms-org-scope.js", readFileSync(join(pub, "apms-org-scope.js"), "utf8"));

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0g.js").join("index-f4j9a7t3-11v-p0h.js");
  html = html.split("routes-e2g7y5q8-13m-p0g.js").join("routes-e2g7y5q8-13m-p0h.js");
  html = html.split("apms-sync.js?v=p0g1").join("apms-sync.js?v=p0h1");
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

console.log("p0h stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
