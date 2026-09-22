/**
 * Stamp p0q: People SBU filter applies immediately.
 *
 * 1. Sc picker ran requestAnimationFrame setState every frame while open,
 *    starving the people list (felt like a ~5s wait, or dead until Nest/List).
 * 2. Filtered list useMemo omitted `oe` (selected SBUs).
 * 3. SBU match was exact-id only — picking Mumbai missed people on child studios.
 * 4. Managers/FH were forced into Nested so List did not actually switch.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0p.js"), join(pub, "login-view-f2j6t0x4-11a3-p0q.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0p.js"), join(pub, "routes-e2g7y5q8-13m-p0q.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0p.js"), join(pub, "index-f4j9a7t3-11v-p0q.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0p.js"), join(pub, "login-ChZ1wVZ-p0q.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0q.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0q.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0q.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0q.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0p.js";`,
  `from"./index-f4j9a7t3-11v-p0q.js";`,
  "login-view index import",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0p.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0q.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0p.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0q.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `function place(){if(!s.current)return;let b=s.current.getBoundingClientRect();if(b.bottom<0||b.top>window.innerHeight){f(!1);return}let w=Math.max(b.width,Math.min(720,window.innerWidth-16)),maxH=Math.min(280,window.innerHeight-24),top=b.bottom+4;if(top+160>window.innerHeight)top=Math.max(8,b.top-4-maxH);setPos({top,left:Math.max(8,Math.min(b.left,window.innerWidth-w-8)),width:w,maxHeight:maxH,zIndex:400})}(0,Z.useLayoutEffect)(()=>{if(!d){setPos(null);return}let id=0;function tick(){place();id=requestAnimationFrame(tick)}place();id=requestAnimationFrame(tick);window.addEventListener(\`resize\`,place);return()=>{cancelAnimationFrame(id),window.removeEventListener(\`resize\`,place)}},[d]);`,
  `function place(){if(!s.current)return;let b=s.current.getBoundingClientRect();if(b.bottom<0||b.top>window.innerHeight){f(!1);return}let w=Math.max(b.width,Math.min(720,window.innerWidth-16)),maxH=Math.min(280,window.innerHeight-24),top=b.bottom+4;if(top+160>window.innerHeight)top=Math.max(8,b.top-4-maxH);let left=Math.max(8,Math.min(b.left,window.innerWidth-w-8));setPos(p=>p&&p.top===top&&p.left===left&&p.width===w&&p.maxHeight===maxH?p:{top,left,width:w,maxHeight:maxH,zIndex:400})}(0,Z.useLayoutEffect)(()=>{if(!d){setPos(null);return}place();window.addEventListener(\`resize\`,place);window.addEventListener(\`scroll\`,place,!0);return()=>{window.removeEventListener(\`resize\`,place),window.removeEventListener(\`scroll\`,place,!0)}},[d]);`,
  "picker no rAF loop",
);

rt = replaceOnce(
  rt,
  `O=e.peopleListFilter?\`list\`:v===\`summary\`?\`summary\`:n?\`nested\`:v,`,
  `O=e.peopleListFilter?\`list\`:v,`,
  "list/nested follows the toggle",
);

rt = replaceOnce(
  rt,
  `let j=(0,Z.useMemo)(()=>{let n=i.trim().toLowerCase();return r.filter(i=>{if(o.length&&!o.some(n=>ea(i,n,e.brands,e.businessUnits))||oe.length&&!(oe.includes(i.buId)||(i.buIds||[]).some(n=>oe.includes(n)))||c&&i.functionId!==c||u&&!Xr(i,u))return!1;`,
  `let j=(0,Z.useMemo)(()=>{let n=i.trim().toLowerCase(),sbuWant=null;if(oe.length){sbuWant=new Set(oe);let units=e.businessUnits||[],grew=!0;while(grew){grew=!1;for(let u of units)if(u&&u.parentId&&sbuWant.has(u.parentId)&&!sbuWant.has(u.id)){sbuWant.add(u.id);grew=!0}}}return r.filter(i=>{if(o.length&&!o.some(n=>ea(i,n,e.brands,e.businessUnits))||sbuWant&&![i.buId,...i.buIds||[]].some(id=>id&&sbuWant.has(id))||c&&i.functionId!==c||u&&!Xr(i,u))return!1;`,
  "sbu filter + descendants",
);

rt = replaceOnce(
  rt,
  `},[r,e.roles,e.functions,e.subFunctions,e.records,e.currentMonth,e.peopleListFilter,i,o,c,u,f,m,g,O]),`,
  `},[r,e.roles,e.functions,e.subFunctions,e.records,e.currentMonth,e.peopleListFilter,e.brands,e.businessUnits,i,o,oe,c,u,f,m,g,O,t&&t.id]),`,
  "useMemo deps include SBU",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0p.js", "routes-e2g7y5q8-13m-p0q.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0p.js", "login-ChZ1wVZ-p0q.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0p.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0q.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0p.js"`,
  `from"./index-f4j9a7t3-11v-p0q.js"`,
  "login-ChZ index",
);

must(!rt.includes("requestAnimationFrame(tick)"), "rAF loop still present");
must(rt.includes("sbuWant"), "sbuWant missing");
must(rt.includes(",oe,c,u,f,m,g,O,"), "oe dep missing");
must(rt.includes("O=e.peopleListFilter?`list`:v,"), "O toggle missing");

writeBoth("login-view-f2j6t0x4-11a3-p0q.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0q.js", rt);
writeBoth("index-f4j9a7t3-11v-p0q.js", idx);
writeBoth("login-ChZ1wVZ-p0q.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0p.js").join("index-f4j9a7t3-11v-p0q.js");
  html = html.split("routes-e2g7y5q8-13m-p0p.js").join("routes-e2g7y5q8-13m-p0q.js");
  html = html.split("apms-sync.js?v=p0p1").join("apms-sync.js?v=p0q1");
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

console.log("p0q stamp ok", { lv: lv.length, rt: rt.length });
