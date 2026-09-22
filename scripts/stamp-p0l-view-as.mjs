/**
 * Stamp p0l: View as people list scrolls (and can be filtered).
 *
 * The picker had no max-height / overflow, so ~190 people ran off the
 * viewport with no way to reach names below the fold.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0k.js"), join(pub, "login-view-f2j6t0x4-11a3-p0l.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0k.js"), join(pub, "routes-e2g7y5q8-13m-p0l.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0k.js"), join(pub, "index-f4j9a7t3-11v-p0l.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0k.js"), join(pub, "login-ChZ1wVZ-p0l.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0l.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0l.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0l.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0l.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0k.js";`,
  `from"./index-f4j9a7t3-11v-p0l.js";`,
  "login-view index import",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0k.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0l.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0k.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0l.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `function jo({children:e}){let[t,n]=(0,Z.useState)(!1),[r,i]=(0,Z.useState)(!1),`,
  `function jo({children:e}){let[t,n]=(0,Z.useState)(!1),[r,i]=(0,Z.useState)(!1),[viewQ,setViewQ]=(0,Z.useState)(\`\`),`,
  "view-as search state",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:()=>i(e=>!e),children:\`View as\`}),r&&(0,Q.jsx)(\`div\`,{className:\`absolute right-0 z-50 mt-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg\`,children:s.slice().sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)).map(e=>(0,Q.jsxs)(\`button\`,{type:\`button\`,className:q(\`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted\`,e.id===m?.id&&\`bg-muted\`),onClick:()=>{f(e.id),i(!1)},children:[(0,Q.jsx)(\`span\`,{children:e.name}),(0,Q.jsx)(\`span\`,{className:\`text-[11px] text-muted-foreground\`,children:At[e.access]})]},e.id))})`,
  `(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:()=>{i(e=>!e),setViewQ(\`\`)},children:\`View as\`}),r&&(0,Q.jsxs)(\`div\`,{className:\`absolute right-0 z-50 mt-1 flex max-h-[min(36rem,calc(100dvh-4.75rem))] w-72 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg\`,children:[(0,Q.jsx)(\`div\`,{className:\`shrink-0 border-b border-border p-1\`,children:(0,Q.jsx)(\`input\`,{type:\`search\`,value:viewQ,placeholder:\`Find a person\`,autoFocus:!0,"aria-label":\`Find a person\`,className:\`w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none\`,onChange:e=>setViewQ(e.target.value)})}),(0,Q.jsx)(\`div\`,{className:\`min-h-0 flex-1 overflow-y-auto overscroll-contain p-1\`,children:s.slice().sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`)).filter(e=>{let q=(viewQ||\`\`).trim().toLowerCase();return!q||String(e.name||\`\`).toLowerCase().includes(q)||String(At[e.access]||\`\`).toLowerCase().includes(q)}).map(e=>(0,Q.jsxs)(\`button\`,{type:\`button\`,className:q(\`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted\`,e.id===m?.id&&\`bg-muted\`),onClick:()=>{f(e.id),i(!1),setViewQ(\`\`)},children:[(0,Q.jsx)(\`span\`,{children:e.name}),(0,Q.jsx)(\`span\`,{className:\`text-[11px] text-muted-foreground\`,children:At[e.access]})]},e.id))})]})`,
  "view-as scroll + find",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0k.js", "routes-e2g7y5q8-13m-p0l.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0k.js", "login-ChZ1wVZ-p0l.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0k.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0l.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0k.js"`,
  `from"./index-f4j9a7t3-11v-p0l.js"`,
  "login-ChZ index",
);

must(rt.includes("overflow-y-auto overscroll-contain"), "view-as overflow missing");
must(rt.includes("Find a person"), "view-as find field missing");
must(rt.includes("[viewQ,setViewQ]"), "view-as search state missing");
must(!rt.includes("mt-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg"), "old view-as menu still present");

writeBoth("login-view-f2j6t0x4-11a3-p0l.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0l.js", rt);
writeBoth("index-f4j9a7t3-11v-p0l.js", idx);
writeBoth("login-ChZ1wVZ-p0l.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0k.js").join("index-f4j9a7t3-11v-p0l.js");
  html = html.split("routes-e2g7y5q8-13m-p0k.js").join("routes-e2g7y5q8-13m-p0l.js");
  html = html.split("apms-sync.js?v=p0k1").join("apms-sync.js?v=p0l1");
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

console.log("p0l stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
