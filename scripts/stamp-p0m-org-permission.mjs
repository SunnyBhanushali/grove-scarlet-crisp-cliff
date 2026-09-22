/**
 * Stamp p0m: clicking a name on Me / KROC must not dump employees
 * onto Org → People. Show a permission message instead.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0l.js"), join(pub, "login-view-f2j6t0x4-11a3-p0m.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0l.js"), join(pub, "routes-e2g7y5q8-13m-p0m.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0l.js"), join(pub, "index-f4j9a7t3-11v-p0m.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0l.js"), join(pub, "login-ChZ1wVZ-p0m.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0m.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0m.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0m.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0m.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0l.js";`,
  `from"./index-f4j9a7t3-11v-p0m.js";`,
  "login-view index import",
);

lv = replaceOnce(
  lv,
  `personStartEdit:!1,cloudResets:[],navHistory:[]`,
  `personStartEdit:!1,accessDenied:null,cloudResets:[],navHistory:[]`,
  "store accessDenied field",
);

lv = replaceOnce(
  lv,
  `openOrgPerson:(t,n)=>e(e=>({...$(e,{selectedPersonId:t,view:\`org-person\`}),personStartEdit:!!n}))`,
  `openOrgPerson:(t,n)=>{let st=t(),who=st.people.find(p=>p.id===st.currentUserId),ok=who&&(canAccess(who,\`org-people\`,\`view\`)||who.access===\`manager\`||who.access===\`function_head\`||G(who));if(!ok){e({accessDenied:\`You don't have permission to open this page.\`});return}e(e=>({...$(e,{selectedPersonId:t,view:\`org-person\`}),personStartEdit:!!n,accessDenied:null}))}`,
  "openOrgPerson permission gate",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0l.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0m.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0l.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0m.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `function jo({children:e}){let[t,n]=(0,Z.useState)(!1),[r,i]=(0,Z.useState)(!1),[viewQ,setViewQ]=(0,Z.useState)(\`\`),a=(0,Z.useRef)(null),o=K(e=>e.currentUserId),`,
  `function jo({children:e}){let[t,n]=(0,Z.useState)(!1),[r,i]=(0,Z.useState)(!1),[viewQ,setViewQ]=(0,Z.useState)(\`\`),a=(0,Z.useRef)(null),denied=K(e=>e.accessDenied),o=K(e=>e.currentUserId),`,
  "jo accessDenied state",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(vo,{children:e})]})]})]})}`,
  `(0,Q.jsx)(vo,{children:e})]})]}),denied?(0,Q.jsxs)(H,{title:\`No access\`,onClose:()=>K.setState({accessDenied:null}),children:[(0,Q.jsx)(\`p\`,{className:\`text-sm text-muted-foreground\`,children:\`You don't have permission to open this page.\`}),(0,Q.jsx)(\`div\`,{className:\`mt-4 flex justify-end\`,children:(0,Q.jsx)(z,{onClick:()=>K.setState({accessDenied:null}),children:\`OK\`})})]}):null]})}`,
  "jo no-access modal",
);

rt = replaceOnce(
  rt,
  `if(r===\`org-person\`&&c&&Hn(p))qe(i,p,{boss:!0,self:!0}).some(e=>e.id===c)||u(\`org-people\`,{replace:!0});else if(r===\`org-person\`&&c){let e=i.find(e=>e.id===c);e&&!qr(p,e,o)&&u(\`org-people\`,{replace:!0})}`,
  `if(p&&(r===\`org-people\`||r===\`org-person\`)&&!K.getState().canAccess(\`org-people\`,\`view\`,p)&&!Hn(p)&&!In(p)){K.setState({accessDenied:\`You don't have permission to open this page.\`}),u(\`me\`,{replace:!0})}else if(r===\`org-person\`&&c&&Hn(p))qe(i,p,{boss:!0,self:!0}).some(e=>e.id===c)||u(\`org-people\`,{replace:!0});else if(r===\`org-person\`&&c){let e=i.find(e=>e.id===c);e&&!qr(p,e,o)&&u(\`org-people\`,{replace:!0})}`,
  "org-person employee bounce + message",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0l.js", "routes-e2g7y5q8-13m-p0m.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0l.js", "login-ChZ1wVZ-p0m.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0l.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0m.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0l.js"`,
  `from"./index-f4j9a7t3-11v-p0m.js"`,
  "login-ChZ index",
);

must(lv.includes("accessDenied:`You don't have permission"), "openOrgPerson deny missing");
must(rt.includes("title:`No access`"), "no-access modal missing");
must(rt.includes("r===`org-people`||r===`org-person`"), "org bounce gate missing");

writeBoth("login-view-f2j6t0x4-11a3-p0m.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0m.js", rt);
writeBoth("index-f4j9a7t3-11v-p0m.js", idx);
writeBoth("login-ChZ1wVZ-p0m.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0l.js").join("index-f4j9a7t3-11v-p0m.js");
  html = html.split("routes-e2g7y5q8-13m-p0l.js").join("routes-e2g7y5q8-13m-p0m.js");
  html = html.split("apms-sync.js?v=p0l1").join("apms-sync.js?v=p0m1");
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

console.log("p0m stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
