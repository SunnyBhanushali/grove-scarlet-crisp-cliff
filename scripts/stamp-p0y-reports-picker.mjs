/**
 * Stamp p0y: Reports-to picker keeps scroll, ticks Avnish (and anyone) without jumping.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0x.js"), join(pub, "login-view-f2j6t0x4-11a3-p0y.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0x.js"), join(pub, "routes-e2g7y5q8-13m-p0y.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0x.js"), join(pub, "index-f4j9a7t3-11v-p0y.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0x.js"), join(pub, "login-ChZ1wVZ-p0y.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0y.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0y.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0y.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0y.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0x.js";`, `from"./index-f4j9a7t3-11v-p0y.js";`, "lv index");
rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0x.js"`, `from"./login-view-f2j6t0x4-11a3-p0y.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0x.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0y.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);

rt = replaceOnce(
  rt,
  `function Sc({id:e,title:t,summary:n,placeholder:r,query:i,onQuery:a,children:o,inline:il}){let s=(0,Z.useRef)(null),panel=(0,Z.useRef)(null),c=(0,Z.useContext)(yc),[l,u]=(0,Z.useState)(!1),[pos,setPos]=(0,Z.useState)(null),d=c?c.open===e:l;`,
  `function Sc({id:e,title:t,summary:n,placeholder:r,query:i,onQuery:a,children:o,inline:il}){let s=(0,Z.useRef)(null),panel=(0,Z.useRef)(null),scroller=(0,Z.useRef)(null),keep=(0,Z.useRef)(0),c=(0,Z.useContext)(yc),[l,u]=(0,Z.useState)(!1),[pos,setPos]=(0,Z.useState)(null),d=c?c.open===e:l;(0,Z.useLayoutEffect)(()=>{if(scroller.current)scroller.current.scrollTop=keep.current},[o,il]);`,
  "Sc keep scroll",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(\`div\`,{"data-apms-picker":e,className:\`mt-2 max-h-72 overflow-auto rounded-md border border-border bg-card p-2\`,children:o})`,
  `(0,Q.jsx)(\`div\`,{ref:scroller,"data-apms-picker":e,onScroll:e=>{keep.current=e.currentTarget.scrollTop},className:\`mt-2 max-h-[min(32rem,70vh)] overflow-auto rounded-md border border-border bg-card p-2\`,children:o})`,
  "Sc inline scroller",
);

rt = replaceOnce(
  rt,
  `(0,Z.useEffect)(()=>{let e=h?g:r?[r]:[];if(!e.length)return;let t=new Map(v.map(e=>[e.id,e])),n=[];for(let r of e){let e=t.get(r),i=new Set;for(;e?.managerId&&!i.has(e.id);)i.add(e.id),n.push(e.managerId),e=t.get(e.managerId)}n.length&&Ec(n,p)},[C,v]);`,
  `(0,Z.useEffect)(()=>{if(il)return;let e=h?g:r?[r]:[];if(!e.length)return;let t=new Map(v.map(e=>[e.id,e])),n=[];for(let r of e){let e=t.get(r),i=new Set;for(;e?.managerId&&!i.has(e.id);)i.add(e.id),n.push(e.managerId),e=t.get(e.managerId)}n.length&&Ec(n,p)},[C,v,il]);`,
  "no auto-expand when inline",
);

rt = replaceOnce(
  rt,
  `function w(e){return m?!0:f[e]??!0}`,
  `function w(e){return m?!0:f[e]??!1}`,
  "picker rows start collapsed",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-foreground/5 \`,onClick:()=>{T(e.id),t.length&&Ec([e.id],p)},children:[h?(0,Q.jsx)(wc,{on:a}):(0,Q.jsx)(Tc,{on:a})`,
  `(0,Q.jsxs)(\`div\`,{role:\`button\`,tabIndex:0,className:\`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-foreground/5\`,onPointerDown:ev=>{ev.preventDefault(),T(e.id)},onKeyDown:ev=>{if(ev.key===\`Enter\`||ev.key===\` \`){ev.preventDefault(),T(e.id)}},children:[h?(0,Q.jsx)(wc,{on:a}):(0,Q.jsx)(Tc,{on:a})`,
  "tick on pointerdown, no nested button",
);

rt = replaceOnce(
  rt,
  `!m&&(h?g.length:r)?(0,Q.jsxs)(\`div\`,{className:\`mb-1 border-b border-border pb-1\`,children:[(0,Q.jsx)(\`div\`,{className:\`px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground\`,children:\`Selected\`})`,
  `!m&&(h?g.length:r)?(0,Q.jsxs)(\`div\`,{className:\`sticky top-0 z-10 mb-1 border-b border-border bg-card pb-1\`,children:[(0,Q.jsx)(\`div\`,{className:\`px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground\`,children:\`Selected\`})`,
  "sticky selected",
);

rt = replaceOnce(
  rt,
  `onChangeMany:ids=>{let cur=s.people.filter(t=>t.managerId===e.id).map(t=>t.id),next=ids||[];for(let id of next)cur.includes(id)||id===e.id||s.nestPerson(id,e.id);for(let id of cur)next.includes(id)||s.nestPerson(id,null)}`,
  `onChangeMany:ids=>{let cur=s.people.filter(t=>t.managerId===e.id).map(t=>t.id),next=ids||[],err=\`\`;for(let id of next)if(!cur.includes(id)&&id!==e.id){let res=s.nestPerson(id,e.id);if(res&&res.ok===!1)err=res.reason||\`Could not add.\`}for(let id of cur)if(!next.includes(id)){let res=s.nestPerson(id,null);if(res&&res.ok===!1)err=res.reason||\`Could not remove.\`}_(err)}`,
  "surface nest errors",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0x.js", "routes-e2g7y5q8-13m-p0y.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0x.js", "login-ChZ1wVZ-p0y.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0x.js"`, `from"./login-view-f2j6t0x4-11a3-p0y.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0x.js"`, `from"./index-f4j9a7t3-11v-p0y.js"`, "login idx");

must(rt.includes("keep.current=e.currentTarget.scrollTop"), "scroll keep missing");
must(rt.includes("onPointerDown:ev=>{ev.preventDefault(),T(e.id)}"), "pointerdown missing");
must(rt.includes("if(il)return;let e=h?g"), "inline skip expand missing");

writeBoth("login-view-f2j6t0x4-11a3-p0y.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0y.js", rt);
writeBoth("index-f4j9a7t3-11v-p0y.js", idx);
writeBoth("login-ChZ1wVZ-p0y.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0x.js").join("index-f4j9a7t3-11v-p0y.js");
  html = html.split("routes-e2g7y5q8-13m-p0x.js").join("routes-e2g7y5q8-13m-p0y.js");
  html = html.split("apms-sync.js?v=p0x1").join("apms-sync.js?v=p0y1");
  writeFileSync(path, html);
}
for (const f of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
  try { stampHtml(join(root, f)); } catch {}
}
console.log("p0y stamp ok");
