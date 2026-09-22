/**
 * Stamp p0r: SBU picker always shows Select/Deselect all on top;
 * filtered People nested view no longer injects managers (Avnish).
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0q.js"), join(pub, "login-view-f2j6t0x4-11a3-p0r.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0q.js"), join(pub, "routes-e2g7y5q8-13m-p0r.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0q.js"), join(pub, "index-f4j9a7t3-11v-p0r.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0q.js"), join(pub, "login-ChZ1wVZ-p0r.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0r.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0r.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0r.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0r.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0q.js";`,
  `from"./index-f4j9a7t3-11v-p0r.js";`,
  "login-view index import",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0q.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0r.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0q.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0r.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `body=(0,Q.jsxs)(\`div\`,{className:\`space-y-0.5\`,children:[selected,(0,Q.jsxs)(\`div\`,{className:\`mb-1 flex justify-end gap-2\`,children:[(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`text-[11px] text-primary hover:underline\`,onClick:()=>i(v===\`sbu\`?shownUnits.map(e=>e.id):shownBrands.map(e=>e.id)),children:\`Select all\`}),(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`text-[11px] text-primary hover:underline\`,onClick:()=>i([]),children:o===\`all\`?\`All\`:\`Clear\`})]}),`,
  `body=(0,Q.jsxs)(\`div\`,{className:\`space-y-0.5\`,children:[(0,Q.jsxs)(\`div\`,{className:\`picker-actions\`,children:[(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`text-[11px] text-primary hover:underline\`,onClick:()=>i(v===\`sbu\`?shownUnits.map(e=>e.id):shownBrands.map(e=>e.id)),children:\`Select all\`}),(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`text-[11px] text-primary hover:underline\`,onClick:()=>i([]),children:\`Deselect all\`})]}),selected,`,
  "picker actions always on top",
);

rt = replaceOnce(
  rt,
  `M=(0,Z.useMemo)(()=>{let t=new Set(j.map(e=>e.id));if(!n)for(let n of j){let r=n.managerId?e.people.find(e=>e.id===n.managerId):void 0,i=new Set;for(;r&&!i.has(r.id);)i.add(r.id),t.add(r.id),r=r.managerId?e.people.find(e=>e.id===r.managerId):void 0}return t},[j,e.people,n]),`,
  `M=(0,Z.useMemo)(()=>new Set(j.map(e=>e.id)),[j]),`,
  "no ancestor padding on filter",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0q.js", "routes-e2g7y5q8-13m-p0r.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0q.js", "login-ChZ1wVZ-p0r.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0q.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0r.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0q.js"`,
  `from"./index-f4j9a7t3-11v-p0r.js"`,
  "login-ChZ index",
);

must(rt.includes("picker-actions"), "picker-actions missing");
must(rt.includes("Deselect all"), "Deselect all missing");
must(!rt.includes("if(!n)for(let n of j)"), "ancestor walk still present");
must(rt.includes("M=(0,Z.useMemo)(()=>new Set(j.map(e=>e.id)),[j])"), "M memo missing");

writeBoth("login-view-f2j6t0x4-11a3-p0r.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0r.js", rt);
writeBoth("index-f4j9a7t3-11v-p0r.js", idx);
writeBoth("login-ChZ1wVZ-p0r.js", login);

const cssExtra = `
/* Picker: Select all / Deselect all stay pinned while the list scrolls. */
.picker-actions {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.2rem 0.25rem 0.4rem;
  margin: -0.25rem -0.25rem 0.35rem;
  background: var(--card, #1a1612);
  border-bottom: 1px solid var(--border, rgba(255,255,255,.1));
}
`;

for (const p of [
  join(root, "public/assets/form-controls.css"),
  join(root, "recovered-site/assets/form-controls.css"),
  join(root, "dist/client/assets/form-controls.css"),
]) {
  try {
    let css = readFileSync(p, "utf8");
    if (!css.includes(".picker-actions")) css += cssExtra;
    writeFileSync(p, css);
  } catch {
    /* dist optional */
  }
}

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0q.js").join("index-f4j9a7t3-11v-p0r.js");
  html = html.split("routes-e2g7y5q8-13m-p0q.js").join("routes-e2g7y5q8-13m-p0r.js");
  html = html.split("apms-sync.js?v=p0q1").join("apms-sync.js?v=p0r1");
  html = html.split("form-controls.css?v=p0p1").join("form-controls.css?v=p0r1");
  html = html.split("form-controls.css?v=p0q1").join("form-controls.css?v=p0r1");
  html = html.split('href="/assets/form-controls.css"').join('href="/assets/form-controls.css?v=p0r1"');
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

console.log("p0r stamp ok", { lv: lv.length, rt: rt.length });
