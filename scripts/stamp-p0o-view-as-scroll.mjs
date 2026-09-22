/**
 * Stamp p0o: View as list actually scrolls.
 *
 * p0l used Tailwind arbitrary max-h-[min(36rem,...)], which is not in
 * the built CSS, so the menu grew to 190 rows, got clipped, and never
 * scrolled. Put a real max-height on .view-as-menu in form-controls.css.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0n.js"), join(pub, "login-view-f2j6t0x4-11a3-p0o.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0n.js"), join(pub, "routes-e2g7y5q8-13m-p0o.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0n.js"), join(pub, "index-f4j9a7t3-11v-p0o.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0n.js"), join(pub, "login-ChZ1wVZ-p0o.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0o.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0o.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0o.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0o.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0n.js";`,
  `from"./index-f4j9a7t3-11v-p0o.js";`,
  "login-view index import",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0n.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0o.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0n.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0o.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `className:\`absolute right-0 z-50 mt-1 flex max-h-[min(36rem,calc(100dvh-4.75rem))] w-72 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg\``,
  `className:\`view-as-menu absolute right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg\``,
  "view-as menu class",
);

rt = replaceOnce(
  rt,
  `className:\`shrink-0 border-b border-border p-1\``,
  `className:\`view-as-search border-b border-border p-1\``,
  "view-as search class",
);

rt = replaceOnce(
  rt,
  `className:\`min-h-0 flex-1 overflow-y-auto overscroll-contain p-1\``,
  `className:\`view-as-list p-1\``,
  "view-as list class",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0n.js", "routes-e2g7y5q8-13m-p0o.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0n.js", "login-ChZ1wVZ-p0o.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0n.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0o.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0n.js"`,
  `from"./index-f4j9a7t3-11v-p0o.js"`,
  "login-ChZ index",
);

must(rt.includes("view-as-menu"), "view-as-menu class missing");
must(rt.includes("view-as-list"), "view-as-list class missing");
must(!rt.includes("max-h-[min(36rem"), "old arbitrary max-h still present");

writeBoth("login-view-f2j6t0x4-11a3-p0o.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0o.js", rt);
writeBoth("index-f4j9a7t3-11v-p0o.js", idx);
writeBoth("login-ChZ1wVZ-p0o.js", login);

const cssExtra = `
/* View as: real max-height so the 190-person list scrolls. */
.view-as-menu {
  display: flex;
  flex-direction: column;
  max-height: min(36rem, calc(100dvh - 7rem));
  overflow: hidden;
}
.view-as-search {
  flex: none;
  background: var(--card, inherit);
}
.view-as-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
`;

for (const p of [
  join(root, "public/assets/form-controls.css"),
  join(root, "recovered-site/assets/form-controls.css"),
  join(root, "dist/client/assets/form-controls.css"),
]) {
  try {
    let css = readFileSync(p, "utf8");
    if (!css.includes(".view-as-menu")) css += cssExtra;
    writeFileSync(p, css);
  } catch {
    /* dist optional */
  }
}

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0n.js").join("index-f4j9a7t3-11v-p0o.js");
  html = html.split("routes-e2g7y5q8-13m-p0n.js").join("routes-e2g7y5q8-13m-p0o.js");
  html = html.split("apms-sync.js?v=p0n1").join("apms-sync.js?v=p0o1");
  html = html.split('href="/assets/form-controls.css"').join('href="/assets/form-controls.css?v=p0o1"');
  html = html.split('href="/assets/form-controls.css?v=p0o1?v=p0o1"').join('href="/assets/form-controls.css?v=p0o1"');
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

console.log("p0o stamp ok", { lv: lv.length, rt: rt.length });
