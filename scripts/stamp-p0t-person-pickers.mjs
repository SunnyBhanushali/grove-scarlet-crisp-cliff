/**
 * Stamp p0t: person-editor pickers.
 * - Brand / SBU / Function / Reports to: multi-select + Primary
 * - Drop separate Also serves
 * - Same dropdown chrome; click field again or outside to close
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0s.js"), join(pub, "login-view-f2j6t0x4-11a3-p0t.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0s.js"), join(pub, "routes-e2g7y5q8-13m-p0t.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0s.js"), join(pub, "index-f4j9a7t3-11v-p0t.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0s.js"), join(pub, "login-ChZ1wVZ-p0t.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0t.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0t.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0t.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0t.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0s.js";`, `from"./index-f4j9a7t3-11v-p0t.js";`, "lv index");
rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0s.js"`, `from"./login-view-f2j6t0x4-11a3-p0t.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0s.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0t.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(\`input\`,{className:\`\${W} h-9 pl-8\`,placeholder:r,autoComplete:\`off\`,value:d?i:n,onFocus:()=>{f(!0),a(\`\`)}`,
  `(0,Q.jsx)(\`input\`,{className:\`\${W} h-9 pl-8\`,placeholder:r,autoComplete:\`off\`,value:d?i:n,onMouseDown:e=>{if(d){e.preventDefault(),f(!1),e.currentTarget.blur()}},onFocus:()=>{d||(f(!0),a(\`\`))}`,
  "sc toggle field",
);

rt = replaceOnce(
  rt,
  `{ref:s,className:t?\`block text-xs font-medium text-muted-foreground\`:\`block\``,
  `{ref:s,className:(t?\`block text-xs font-medium text-muted-foreground\`:\`block\`)+(d?\` relative z-[401]\`:\`\`)`,
  "sc trigger above backdrop",
);

rt = replaceOnce(
  rt,
  `d&&pos?Ys.createPortal((0,Q.jsx)(\`div\`,{ref:panel,"data-apms-picker":e,className:\`fixed max-h-96 overflow-auto rounded-md border border-border bg-card p-2 shadow-lg\`,onMouseDown:e=>e.stopPropagation(),onPointerDown:e=>e.stopPropagation(),style:{position:\`fixed\`,top:pos.top,left:pos.left,width:pos.width,maxHeight:pos.maxHeight,zIndex:pos.zIndex},children:o}),document.body):null`,
  `d&&pos?Ys.createPortal((0,Q.jsxs)(Q.Fragment,{children:[(0,Q.jsx)(\`div\`,{className:\`fixed inset-0 z-[399]\`,"data-apms-picker-backdrop":e,onPointerDown:()=>f(!1)}),(0,Q.jsx)(\`div\`,{ref:panel,"data-apms-picker":e,className:\`fixed max-h-96 overflow-auto rounded-md border border-border bg-card p-2 shadow-lg\`,onMouseDown:e=>e.stopPropagation(),onPointerDown:e=>e.stopPropagation(),style:{position:\`fixed\`,top:pos.top,left:pos.left,width:pos.width,maxHeight:pos.maxHeight,zIndex:pos.zIndex},children:o})]}),document.body):null`,
  "sc backdrop close",
);

rt = replaceOnce(
  rt,
  `function McList({id:e,title:t,items:n,value:r,onChange:i,placeholder:a,mode:o=\`none\`,allLabel:s,kind:v=\`brand\`})`,
  `function McList({id:e,title:t,items:n,value:r,onChange:i,placeholder:a,mode:o=\`none\`,allLabel:s,kind:v=\`brand\`,primaryId:priId,onPrimary:setPriId})`,
  "mclist primary args",
);

rt = replaceOnce(
  rt,
  `let selected=(!q&&f.length)?(0,Q.jsxs)(\`div\`,{className:\`mb-1 border-b border-border pb-1\`,children:[(0,Q.jsx)(\`div\`,{className:\`px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground\`,children:\`Selected\`}),f.map(id=>{let item=pool.find(e=>e.id===id);return item?(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`flex min-h-8 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-foreground/5\`,onClick:()=>toggle([id],!0),children:[(0,Q.jsx)(wc,{on:!0,some:!1}),(0,Q.jsx)(\`span\`,{className:\`truncate font-medium\`,children:item.name})]},id):null})]}):null`,
  `let selected=(!q&&f.length)?(0,Q.jsxs)(\`div\`,{className:\`mb-1 border-b border-border pb-1\`,children:[(0,Q.jsx)(\`div\`,{className:\`px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground\`,children:\`Selected\`}),f.map(id=>{let item=pool.find(e=>e.id===id);if(!item)return null;let isPri=!!setPriId&&f.length>1&&(priId||f[0])===id;return(0,Q.jsxs)(\`div\`,{className:\`flex min-h-8 w-full items-center gap-1 rounded-md px-1 text-sm\`,children:[(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-foreground/5\`,onClick:()=>toggle([id],!0),children:[(0,Q.jsx)(wc,{on:!0,some:!1}),(0,Q.jsx)(\`span\`,{className:\`truncate font-medium\`,children:item.name})]}),setPriId&&f.length>1?(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide \${isPri?\`bg-primary/15 text-primary\`:\`text-muted-foreground hover:bg-foreground/5\`}\`,onClick:ev=>{ev.stopPropagation(),setPriId(id)},children:isPri?\`Primary\`:\`Make primary\`}):null]},id)})]}):null`,
  "mclist selected primary",
);

rt = replaceOnce(
  rt,
  `function f(n,s){if(l&&s.some(e=>!l.has(e))){o(k);return}o(\`\`);let i=n[0]?u.find(e=>e.id===n[0]):null,a=s[0]?d.find(e=>e.id===s[0]):null,c=i?.companyId||(a?u.find(e=>e.id===a.brandId)?.companyId:\`\`)||e.companyId||\`\`;t({companyId:c,companyWide:!1,brandIds:n,buIds:s})}return(0,Q.jsxs)(\`div\`,{className:\`grid gap-3 sm:grid-cols-2\`,children:[(0,Q.jsx)(B,{label:\`Brand\`,children:(0,Q.jsx)(McList,{id:\`seat-brands\`,kind:\`brand\`,items:u,value:e.brandIds||[],onChange:n=>f(n,e.buIds||[]),placeholder:\`Search brands…\`,mode:\`none\`})}),(0,Q.jsx)(B,{label:\`SBU\`,children:(0,Q.jsx)(McList,{id:\`seat-sbus\`,kind:\`sbu\`,items:d,value:e.buIds||[],onChange:n=>f(e.brandIds||[],n),placeholder:\`Search SBUs…\`,mode:\`none\`})})`,
  `function f(n,s,priBrand,priBu){if(l&&s.some(e=>!l.has(e))){o(k);return}o(\`\`);let i=(priBrand&&n.includes(priBrand)?priBrand:n[0])?u.find(e=>e.id===(priBrand&&n.includes(priBrand)?priBrand:n[0])):null,a=(priBu&&s.includes(priBu)?priBu:s[0])?d.find(e=>e.id===(priBu&&s.includes(priBu)?priBu:s[0])):null,c=i?.companyId||(a?u.find(e=>e.id===a.brandId)?.companyId:\`\`)||e.companyId||\`\`,brandId=priBrand&&n.includes(priBrand)?priBrand:n.length===1?n[0]:n.includes(e.brandId)?e.brandId:n[0]||\`\`,buId=__homeBu({companyWide:!1,buIds:s,prevBuId:e.buId,primaryId:priBu});t({companyId:c,companyWide:!1,brandIds:n,buIds:s,brandId,buId})}return(0,Q.jsxs)(\`div\`,{className:\`grid gap-3 sm:grid-cols-2\`,children:[(0,Q.jsx)(B,{label:\`Brand\`,children:(0,Q.jsx)(McList,{id:\`seat-brands\`,kind:\`brand\`,items:u,value:e.brandIds||[],primaryId:e.brandId||\`\`,onPrimary:id=>f(e.brandIds||[],e.buIds||[],id,e.buId),onChange:n=>f(n,e.buIds||[],e.brandId,e.buId),placeholder:\`Search brands…\`,mode:\`none\`})}),(0,Q.jsx)(B,{label:\`SBU\`,children:(0,Q.jsx)(McList,{id:\`seat-sbus\`,kind:\`sbu\`,items:d,value:e.buIds||[],primaryId:e.buId||\`\`,onPrimary:id=>f(e.brandIds||[],e.buIds||[],e.brandId,id),onChange:n=>f(e.brandIds||[],n,e.brandId,e.buId),placeholder:\`Search SBUs…\`,mode:\`none\`})})`,
  "ic brand/sbu primary",
);

rt = replaceOnce(
  rt,
  `function Lc({title:e=\`Function\`,value:t,onChange:n,allowed:r,excludeKeys:i,emptyLabel:a}){let o=K();return(0,Q.jsx)(Nc,{title:e,functions:o.functions,subFunctions:o.subFunctions,allowed:r,value:t,onChange:n,excludeKeys:i,emptyLabel:a})}`,
  `function Lc({title:e=\`Function\`,value:t,onChange:n,allowed:r,excludeKeys:i,emptyLabel:a,ids:ids,onChangeIds:onIds,primaryId:priId,onPrimary:setPriId}){let o=K();return(0,Q.jsx)(Nc,{title:e,functions:o.functions,subFunctions:o.subFunctions,allowed:r,value:t,onChange:n,ids:ids,onChangeIds:onIds,primaryId:priId,onPrimary:setPriId,excludeKeys:i,emptyLabel:a})}`,
  "lc pass primary/ids",
);

rt = replaceOnce(
  rt,
  `function Nc({title:e=\`Function\`,functions:t,subFunctions:n,allowed:r,value:i=\`\`,onChange:a,ids:o,onChangeIds:s,excludeKeys:c,placeholder:l=\`Search functions…\`,emptyLabel:u=\`No function\`})`,
  `function Nc({title:e=\`Function\`,functions:t,subFunctions:n,allowed:r,value:i=\`\`,onChange:a,ids:o,onChangeIds:s,excludeKeys:c,placeholder:l=\`Search functions…\`,emptyLabel:u=\`No function\`,primaryId:priId,onPrimary:setPriId})`,
  "nc primary args",
);

rt = replaceOnce(
  rt,
  `(y?b:i?[i]:[]).filter(key=>ni(key).functionId).map(key=>{let parsed=ni(key),fn=t.find(e=>e.id===parsed.functionId),sf=parsed.subFunctionId?n.find(e=>e.id===parsed.subFunctionId):null,name=sf?\`\${fn?.name||\`\`} › \${sf.name}\`:fn?.name||key;return(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`flex min-h-8 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-foreground/5\`,onClick:()=>C({key,functionId:parsed.functionId,subFunctionId:parsed.subFunctionId,name,children:[]}),children:[(0,Q.jsx)(wc,{on:!0,some:!1}),(0,Q.jsx)(\`span\`,{className:\`truncate font-medium\`,children:name})]},key)})`,
  `(y?b:i?[i]:[]).filter(key=>ni(key).functionId).map(key=>{let parsed=ni(key),fn=t.find(e=>e.id===parsed.functionId),sf=parsed.subFunctionId?n.find(e=>e.id===parsed.subFunctionId):null,name=sf?\`\${fn?.name||\`\`} › \${sf.name}\`:fn?.name||key,fid=parsed.functionId,isPri=!!setPriId&&(y?b:i?[i]:[]).length>1&&(priId||fid)===fid;return(0,Q.jsxs)(\`div\`,{className:\`flex min-h-8 w-full items-center gap-1 rounded-md px-1 text-sm\`,children:[(0,Q.jsxs)(\`button\`,{type:\`button\`,className:\`flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-foreground/5\`,onClick:()=>C({key,functionId:parsed.functionId,subFunctionId:parsed.subFunctionId,name,children:[]}),children:[(0,Q.jsx)(wc,{on:!0,some:!1}),(0,Q.jsx)(\`span\`,{className:\`truncate font-medium\`,children:name})]}),setPriId&&(y?b.length:1)>1?(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide \${isPri?\`bg-primary/15 text-primary\`:\`text-muted-foreground hover:bg-foreground/5\`}\`,onClick:ev=>{ev.stopPropagation(),setPriId(fid)},children:isPri?\`Primary\`:\`Make primary\`}):null]},key)})`,
  "nc selected primary",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(Ic,{peopleScope:!0,value:{companyId:l.companyId||\`\`,companyWide:!!l.companyWide,brandIds:l.brandIds||[],buIds:l.buIds||[]},onChange:t=>{let r={companyId:t.companyId,companyWide:t.companyWide,brandIds:t.brandIds,buIds:t.buIds,brandId:t.companyWide?l.brandId:t.brandIds[0]||\`\`,buId:__homeBu({companyWide:t.companyWide,buIds:t.buIds,prevBuId:l.buId})};u(e=>({...e,...r})),n.updatePerson(e.id,r)}})`,
  `(0,Q.jsx)(Ic,{peopleScope:!0,value:{companyId:l.companyId||\`\`,companyWide:!!l.companyWide,brandIds:[...new Set([l.brandId,...l.brandIds||[]].filter(Boolean))],buIds:[...new Set([l.buId,...l.buIds||[]].filter(Boolean))],brandId:l.brandId||\`\`,buId:l.buId||\`\`},onChange:t=>{let r={companyId:t.companyId,companyWide:t.companyWide,brandIds:t.brandIds,buIds:t.buIds,brandId:t.brandId||(t.brandIds||[])[0]||\`\`,buId:t.buId||__homeBu({companyWide:t.companyWide,buIds:t.buIds,prevBuId:l.buId,primaryId:t.buId})};u(e=>({...e,...r})),n.updatePerson(e.id,r)}})`,
  "person ic value primary",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(Lc,{title:\`Function\`,allowed:ra(r,n.functions),value:l.functionId?mi(l.functionId,l.subFunctionId):\`\`,onChange:t=>{let r=ni(t),i=(l.functionSeats||[]).filter(e=>e.kind===\`additional\`&&e.functionId&&e.functionId!==r.functionId),a=r.functionId?[{functionId:r.functionId,subFunctionId:r.subFunctionId,managerId:l.managerId||null,kind:\`home\`}]:[],o=Li([...a,...i]);u(e=>({...e,...o})),n.updatePerson(e.id,{functionId:o.functionId,subFunctionId:o.subFunctionId,functionSeats:o.functionSeats})},emptyLabel:\`No function\`})`,
  `(0,Q.jsx)(Lc,{title:\`Function\`,allowed:ra(r,n.functions),ids:[...new Set([l.functionId,...(l.functionSeats||[]).map(s=>s.functionId)].filter(Boolean))],primaryId:l.functionId||\`\`,onPrimary:id=>{let ids=[...new Set([l.functionId,...(l.functionSeats||[]).map(s=>s.functionId),id].filter(Boolean))],cur=Mr(l),home={functionId:id,subFunctionId:(cur.find(s=>s.functionId===id)||{}).subFunctionId||null,managerId:id===l.functionId?l.managerId||null:(cur.find(s=>s.functionId===id)||{}).managerId||null,kind:\`home\`},add=ids.filter(x=>x!==id).map(x=>{let ex=cur.find(s=>s.functionId===x);return{functionId:x,subFunctionId:ex?.subFunctionId||null,managerId:ex?.managerId||null,kind:\`additional\`}}),o=Li([home,...add]);u(e=>({...e,...o})),n.updatePerson(e.id,{functionId:o.functionId,subFunctionId:o.subFunctionId,functionSeats:o.functionSeats})},onChangeIds:ids=>{let pri=ids.includes(l.functionId)?l.functionId:ids[0]||\`\`,cur=Mr(l),home=pri?{functionId:pri,subFunctionId:(cur.find(s=>s.functionId===pri)||{}).subFunctionId||(pri===l.functionId?l.subFunctionId:null),managerId:pri===l.functionId?l.managerId||null:(cur.find(s=>s.functionId===pri)||{}).managerId||null,kind:\`home\`}:null,add=ids.filter(id=>id!==pri).map(id=>{let ex=cur.find(s=>s.functionId===id);return{functionId:id,subFunctionId:ex?.subFunctionId||null,managerId:ex?.managerId||null,kind:\`additional\`}}),o=Li([...home?[home]:[],...add]);u(e=>({...e,...o})),n.updatePerson(e.id,{functionId:o.functionId,subFunctionId:o.subFunctionId,functionSeats:o.functionSeats})},emptyLabel:\`No function\`})`,
  "function multi primary",
);

rt = replaceOnce(
  rt,
  `i&&(0,Q.jsxs)(\`div\`,{className:\`sm:col-span-2 rounded-lg border border-border p-3\`,children:[(0,Q.jsx)(\`div\`,{className:\`text-xs font-medium text-muted-foreground\`,children:\`Also serves\`}),(0,Q.jsx)(\`p\`,{className:\`mt-1 text-[11px] text-muted-foreground\`,children:\`Other functions this person works — e.g. Cluster Manager in Operations who also serves Revenue. Each function head then sees them.\`}),(0,Q.jsx)(ql,{personId:e.id,homeFunctionId:l.functionId,seats:Mr(l),onChange:e=>u(t=>({...t,...Li(e)}))})]}),`,
  ``,
  "remove also serves",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0s.js", "routes-e2g7y5q8-13m-p0t.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0s.js", "login-ChZ1wVZ-p0t.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0s.js"`, `from"./login-view-f2j6t0x4-11a3-p0t.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0s.js"`, `from"./index-f4j9a7t3-11v-p0t.js"`, "login idx");

must(rt.includes("data-apms-picker-backdrop"), "backdrop missing");
must(rt.includes("onMouseDown:e=>{if(d){e.preventDefault()"), "toggle missing");
must(!rt.includes("children:`Also serves`"), "also serves still present");
must(rt.includes("onPrimary:id=>f(e.brandIds"), "brand primary missing");
must(rt.includes("onChangeIds:ids=>{let pri="), "function ids missing");
must(rt.includes("Make primary"), "make primary missing");

writeBoth("login-view-f2j6t0x4-11a3-p0t.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0t.js", rt);
writeBoth("index-f4j9a7t3-11v-p0t.js", idx);
writeBoth("login-ChZ1wVZ-p0t.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0s.js").join("index-f4j9a7t3-11v-p0t.js");
  html = html.split("routes-e2g7y5q8-13m-p0s.js").join("routes-e2g7y5q8-13m-p0t.js");
  html = html.split("apms-sync.js?v=p0s1").join("apms-sync.js?v=p0t1");
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

console.log("p0t stamp ok", { lv: lv.length, rt: rt.length });
