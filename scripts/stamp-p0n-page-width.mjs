/**
 * Stamp p0n: one content width across the app.
 *
 * Employee Home was max-w-lg (phone column) while Me / APMS / Rewards
 * fill the shell, and FH/admin Home used max-w-4xl. Shell also split
 * max-w-5xl vs max-w-7xl by page. Unify to max-w-7xl; drop inner caps.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0m.js"), join(pub, "login-view-f2j6t0x4-11a3-p0n.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0m.js"), join(pub, "routes-e2g7y5q8-13m-p0n.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0m.js"), join(pub, "index-f4j9a7t3-11v-p0n.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0m.js"), join(pub, "login-ChZ1wVZ-p0n.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0n.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0n.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0n.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0n.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0m.js";`,
  `from"./index-f4j9a7t3-11v-p0n.js";`,
  "login-view index import",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0m.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0n.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0m.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0n.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `c===\`mis\`||c===\`mis-apms\`||c===\`mis-custom\`||c===\`mis-reports\`?\`max-w-none px-3 py-3\`:c===\`execution\`||c===\`role-edit\`||c===\`role-view\`||c===\`org-roles\`||c===\`roles\`||c===\`kpis\`||c===\`kpi-scores\`?\`max-w-7xl px-4 py-6\`:\`max-w-5xl px-4 py-6\``,
  `c===\`mis\`||c===\`mis-apms\`||c===\`mis-custom\`||c===\`mis-reports\`?\`max-w-none px-3 py-3\`:\`max-w-7xl px-4 py-6\``,
  "shell one width",
);

rt = replaceOnce(
  rt,
  `className:r?\`mx-auto max-w-4xl space-y-5\`:\`mx-auto max-w-lg space-y-5\``,
  `className:\`space-y-5\``,
  "home fills shell",
);

rt = replaceOnce(
  rt,
  `className:see?\`mx-auto max-w-2xl space-y-5\`:\`mx-auto max-w-lg space-y-5\``,
  `className:\`space-y-5\``,
  "award page fills shell",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0m.js", "routes-e2g7y5q8-13m-p0n.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0m.js", "login-ChZ1wVZ-p0n.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0m.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0n.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0m.js"`,
  `from"./index-f4j9a7t3-11v-p0n.js"`,
  "login-ChZ index",
);

must(!rt.includes("max-w-5xl"), "old 5xl shell still present");
must(!rt.includes("max-w-4xl"), "old home 4xl still present");
must(!rt.includes("mx-auto max-w-lg space-y-5"), "old home lg still present");
must(rt.includes("`max-w-7xl px-4 py-6`"), "7xl shell missing");
must(rt.includes("function Jl()") && rt.includes('className:`space-y-5`'), "home space-y-5 missing");

writeBoth("login-view-f2j6t0x4-11a3-p0n.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0n.js", rt);
writeBoth("index-f4j9a7t3-11v-p0n.js", idx);
writeBoth("login-ChZ1wVZ-p0n.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0m.js").join("index-f4j9a7t3-11v-p0n.js");
  html = html.split("routes-e2g7y5q8-13m-p0m.js").join("routes-e2g7y5q8-13m-p0n.js");
  html = html.split("apms-sync.js?v=p0m1").join("apms-sync.js?v=p0n1");
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

console.log("p0n stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
