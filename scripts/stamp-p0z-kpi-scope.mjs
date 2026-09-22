/**
 * Stamp p0z: Applies as (SBU/Function/named teams) + shared actuals, no stolen revenue.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0y.js"), join(pub, "login-view-f2j6t0x4-11a3-p0z.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0y.js"), join(pub, "routes-e2g7y5q8-13m-p0z.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0y.js"), join(pub, "index-f4j9a7t3-11v-p0z.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0y.js"), join(pub, "login-ChZ1wVZ-p0z.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0z.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0z.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0z.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0z.js"), "utf8");

lv = replaceOnce(lv, `from"./index-f4j9a7t3-11v-p0y.js";`, `from"./index-f4j9a7t3-11v-p0z.js";`, "lv index");
rt = replaceOnce(rt, `from"./login-view-f2j6t0x4-11a3-p0y.js"`, `from"./login-view-f2j6t0x4-11a3-p0z.js"`, "rt lv");
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0y.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0z.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "rt mapDeps",
);
rt = replaceOnce(
  rt,
  `kpiScopeChip as __kchip,`,
  `kpiScopeChip as __kchip,peopleWithTeams as __teams,teamLabel as __tlab,stampSharedAchieved as __shareAch,`,
  "import team helpers",
);

rt = replaceOnce(
  rt,
  `sbus=(st.businessUnits||[]).filter(b=>!b.isGroup),personSbuIds=person?.buIds?.length?person.buIds.filter(Boolean):person?.buId?[person.buId]:[];`,
  `sbus=(st.businessUnits||[]).filter(b=>!b.isGroup),teams=__teams(st.people),fns=st.functions||[],personSbuIds=person?.buIds?.length?person.buIds.filter(Boolean):person?.buId?[person.buId]:[];`,
  "bu teams/fns",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`individual\`?\`secondary\`:\`outline\`,onClick:()=>setSc(\`individual\`),children:\`Self\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`team\`?\`secondary\`:\`outline\`,onClick:()=>setSc(\`team\`),children:\`Team\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`sbu\`?\`secondary\`:\`outline\`,onClick:()=>setSc(\`sbu\`),children:\`Studio\`})]}),(0,Q.jsx)(\`p\`,{className:\`text-[11px] text-muted-foreground\`,children:scope===\`individual\`?\`This person’s own number.\`:scope===\`team\`?\`Team KPI, scored on this person.\`:\`Studio KPI — one studio number, shown on this person.\`})]}),scope===\`team\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Whose team\`,(0,Q.jsx)(\`input\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeLabel,onChange:e=>setScopeLabel(e.target.value),placeholder:\`e.g. Vishal’s team\`})]}):scope===\`sbu\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Studio\`,(0,Q.jsx)(\`select\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeId,onChange:e=>{let id=e.target.value;setScopeId(id),setScopeLabel((sbus.find(b=>b.id===id)||{}).name||\`\`)},children:(sbus.length?sbus:[{id:\`\`,name:\`No studios yet\`}]).map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):null`,
  `(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`individual\`?\`secondary\`:\`outline\`,onClick:()=>{setSc(\`individual\`),setScopeId(\`\`),setScopeLabel(\`\`)},children:\`Self\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`team\`?\`secondary\`:\`outline\`,onClick:()=>{setSc(\`team\`);let p=teams[0];setScopeId(p?.id||\`\`),setScopeLabel(p?__tlab(p):\`\`)},children:\`Team\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`sbu\`?\`secondary\`:\`outline\`,onClick:()=>{setSc(\`sbu\`);let b=sbus[0];setScopeId(b?.id||\`\`),setScopeLabel(b?.name||\`\`)},children:\`SBU\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`function\`?\`secondary\`:\`outline\`,onClick:()=>{setSc(\`function\`);let f=fns[0];setScopeId(f?.id||\`\`),setScopeLabel(f?.name||\`\`)},children:\`Function\`})]}),(0,Q.jsx)(\`p\`,{className:\`mt-1.5 text-[11px] text-muted-foreground\`,children:scope===\`individual\`?\`This person’s own number.\`:scope===\`team\`?\`One number for this team, on every plan.\`:scope===\`function\`?\`One number for this function, on every plan.\`:\`One number for this SBU, on every plan.\`})]}),scope===\`team\`?(0,Q.jsxs)(\`label\`,{className:\`block min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Whose team\`,(0,Q.jsx)(\`select\`,{className:\`mt-1.5 block h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeId,onChange:e=>{let id=e.target.value,p=teams.find(t=>t.id===id);setScopeId(id),setScopeLabel(p?__tlab(p):\`\`)},children:(teams.length?teams:[{id:\`\`,name:\`No teams yet\`}]).map(p=>(0,Q.jsx)(\`option\`,{value:p.id,children:p.id?__tlab(p):p.name},p.id))})]}):scope===\`sbu\`?(0,Q.jsxs)(\`label\`,{className:\`block min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`SBU\`,(0,Q.jsx)(\`select\`,{className:\`mt-1.5 block h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeId,onChange:e=>{let id=e.target.value;setScopeId(id),setScopeLabel((sbus.find(b=>b.id===id)||{}).name||\`\`)},children:(sbus.length?sbus:[{id:\`\`,name:\`No SBUs yet\`}]).map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):scope===\`function\`?(0,Q.jsxs)(\`label\`,{className:\`block min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Function\`,(0,Q.jsx)(\`select\`,{className:\`mt-1.5 block h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeId,onChange:e=>{let id=e.target.value;setScopeId(id),setScopeLabel((fns.find(b=>b.id===id)||{}).name||\`\`)},children:(fns.length?fns:[{id:\`\`,name:\`No functions yet\`}]).map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):null`,
  "bu applies as chips",
);

rt = replaceOnce(
  rt,
  `scope,scopeId:scope===\`sbu\`?scopeId:\`\`,scopeLabel:scope===\`individual\`?\`\`:scopeLabel`,
  `scope,scopeId:scope===\`individual\`?\`\`:scopeId,scopeLabel:scope===\`individual\`?\`\`:scopeLabel`,
  "bu save scopeId",
);

rt = replaceOnce(
  rt,
  `let o=he(e),s=pn(e),c=ze(e),st=K(),sbus=(st.businessUnits||[]).filter(b=>!b.isGroup),`,
  `let o=he(e),s=pn(e),c=ze(e),st=K(),sbus=(st.businessUnits||[]).filter(b=>!b.isGroup),teams=__teams(st.people),fns=st.functions||[],`,
  "Cu teams/fns",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsxs)(\`label\`,{className:\`text-[11px] font-medium text-muted-foreground\`,children:[\`Applies as\`,(0,Q.jsxs)(\`select\`,{className:\`mt-0.5 h-9 rounded-md border border-border bg-card px-2 text-sm\`,disabled:!t.targets,value:e.scope||\`individual\`,onChange:ev=>{let id=ev.target.value;i(k=>{k.scope=id;if(id===\`individual\`){k.scopeId=\`\`;k.scopeLabel=\`\`}else if(id===\`sbu\`){k.scopeId=k.scopeId||sbus[0]&&sbus[0].id||\`\`;k.scopeLabel=(sbus.find(b=>b.id===k.scopeId)||{}).name||k.scopeLabel||\`\`}})},children:[(0,Q.jsx)(\`option\`,{value:\`individual\`,children:\`Self\`}),(0,Q.jsx)(\`option\`,{value:\`team\`,children:\`Team\`}),(0,Q.jsx)(\`option\`,{value:\`sbu\`,children:\`Studio\`})]})]}),t.targets&&e.scope===\`team\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Whose team\`,(0,Q.jsx)(\`input\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeLabel||\`\`,onChange:ev=>i(k=>{k.scopeLabel=ev.target.value}),placeholder:\`e.g. Vishal's team\`})]}):t.targets&&e.scope===\`sbu\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Studio\`,(0,Q.jsx)(\`select\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeId||\`\``,
  `(0,Q.jsxs)(\`label\`,{className:\`block min-w-[11rem] text-[11px] font-medium text-muted-foreground\`,children:[\`Applies as\`,(0,Q.jsxs)(\`select\`,{className:\`mt-1.5 block h-9 w-full min-w-[11rem] rounded-md border border-border bg-card px-2 text-sm\`,disabled:!t.targets,value:e.scope||\`individual\`,onChange:ev=>{let id=ev.target.value;i(k=>{k.scope=id;if(id===\`individual\`){k.scopeId=\`\`;k.scopeLabel=\`\`}else if(id===\`sbu\`){k.scopeId=k.scopeId||sbus[0]&&sbus[0].id||\`\`;k.scopeLabel=(sbus.find(b=>b.id===k.scopeId)||{}).name||k.scopeLabel||\`\`}else if(id===\`team\`){let p=teams.find(t=>t.id===k.scopeId)||teams[0];k.scopeId=p?.id||\`\`;k.scopeLabel=p?__tlab(p):\`\`}else if(id===\`function\`){k.scopeId=k.scopeId||fns[0]&&fns[0].id||\`\`;k.scopeLabel=(fns.find(b=>b.id===k.scopeId)||{}).name||k.scopeLabel||\`\`}})},children:[(0,Q.jsx)(\`option\`,{value:\`individual\`,children:\`Self\`}),(0,Q.jsx)(\`option\`,{value:\`team\`,children:\`Team\`}),(0,Q.jsx)(\`option\`,{value:\`sbu\`,children:\`SBU\`}),(0,Q.jsx)(\`option\`,{value:\`function\`,children:\`Function\`})]})]}),t.targets&&e.scope===\`team\`?(0,Q.jsxs)(\`label\`,{className:\`block min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Whose team\`,(0,Q.jsx)(\`select\`,{className:\`mt-1.5 block h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeId||\`\`,onChange:ev=>{let id=ev.target.value,p=teams.find(t=>t.id===id);i(k=>{k.scopeId=id;k.scopeLabel=p?__tlab(p):\`\`})},children:(teams.length?teams:[{id:\`\`,name:\`No teams yet\`}]).map(p=>(0,Q.jsx)(\`option\`,{value:p.id,children:p.id?__tlab(p):p.name},p.id))})]}):t.targets&&e.scope===\`sbu\`?(0,Q.jsxs)(\`label\`,{className:\`block min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`SBU\`,(0,Q.jsx)(\`select\`,{className:\`mt-1.5 block h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeId||\`\``,
  "Cu applies as select",
);

rt = replaceOnce(
  rt,
  `children:sbus.map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):null]}),(0,Q.jsx)(\`div\`,{className:\`mt-2\`,children:l||e.description?(0,Q.jsxs)(\`label\`,{className:\`block t`,
  `children:sbus.map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):t.targets&&e.scope===\`function\`?(0,Q.jsxs)(\`label\`,{className:\`block min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Function\`,(0,Q.jsx)(\`select\`,{className:\`mt-1.5 block h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeId||\`\`,onChange:ev=>{let id=ev.target.value;i(k=>{k.scopeId=id;k.scopeLabel=(fns.find(b=>b.id===id)||{}).name||\`\`})},children:fns.map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):null]}),(0,Q.jsx)(\`div\`,{className:\`mt-2\`,children:l||e.description?(0,Q.jsxs)(\`label\`,{className:\`block t`,
  "Cu function picker",
);

rt = replaceOnce(
  rt,
  `function gu({empId:e,rec:t,canScore:n,kind:r=\`person\`}){let i=K(e=>e.patchRecord),a=K(e=>e.patchRoleMonth),o=r===\`role\`?a:i,s=di(t),c=[];if(s.forEach((e,t)=>{e.kras.forEach((n,r)=>{n.kpis.forEach((i,a)=>{i.children.length?i.children.forEach((i,o)=>c.push({brand:e.name,kra:n.name,kpi:i,path:[t,r,a,o]})):c.push({brand:e.name,kra:n.name,kpi:i,path:[t,r,a,null]})})})}),!c.length)return null;function l(t,n){let[r,i,a,s]=t;o(e,e=>{let t=e.brands?.length?e.brands:[{id:\`_\`,brandId:\`\`,name:\`All\`,weight:1,kras:e.kras}],o=s==null?t[r].kras[i].kpis[a]:t[r].kras[i].kpis[a].children[s];o.achieved=n,e.brands?.length||(e.brands=t)})}`,
  `function gu({empId:e,rec:t,canScore:n,kind:r=\`person\`,month:month}){let i=K(e=>e.patchRecord),a=K(e=>e.patchRoleMonth),o=r===\`role\`?a:i,s=di(t),c=[];if(s.forEach((e,t)=>{e.kras.forEach((n,r)=>{n.kpis.forEach((i,a)=>{i.children.length?i.children.forEach((i,o)=>c.push({brand:e.name,kra:n.name,kpi:i,path:[t,r,a,o]})):c.push({brand:e.name,kra:n.name,kpi:i,path:[t,r,a,null]})})})}),!c.length)return null;function l(t,n){let[r,i,a,s]=t,row=c.find(k=>k.path[0]===r&&k.path[1]===i&&k.path[2]===a&&k.path[3]===s),kpi=row&&row.kpi;o(e,e=>{let t=e.brands?.length?e.brands:[{id:\`_\`,brandId:\`\`,name:\`All\`,weight:1,kras:e.kras}],o=s==null?t[r].kras[i].kpis[a]:t[r].kras[i].kpis[a].children[s];o.achieved=n,e.brands?.length||(e.brands=t)});if(kpi&&kpi.scope&&kpi.scope!==\`individual\`){let st=K.getState(),m=month||st.currentMonth,bag=((r===\`role\`?st.rewardRoleMonths||st.roleMonths:st.kind===\`rewards\`?st.rewardRecords:st.records)||{})[m]||{};for(let id of Object.keys(bag))id!==e&&o(id,rec=>{__shareAch(rec,kpi,n)})}}`,
  "gu fan-out shared actuals",
);

rt = replaceOnce(
  rt,
  `One number per KPI. Structure stays locked — this is the only scoring surface.`,
  `One number per KPI. SBU / team / function KPIs share one number — edit here, every plan updates.`,
  "gu helper copy",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(\`span\`,{className:\`font-medium\`,children:e.kpi.name}),(0,Q.jsx)(Scp,{kpi:e})`,
  `(0,Q.jsx)(\`span\`,{className:\`font-medium\`,children:e.kpi.name}),(0,Q.jsx)(Scp,{kpi:e.kpi})`,
  "Scp pass kpi",
);

rt = replaceOnce(
  rt,
  `disabled:!n||e.kpi.scope===\`sbu\`&&Lsa(e.kpi)!=null,value:(e.kpi.scope===\`sbu\`&&Lsa(e.kpi)!=null?Lsa(e.kpi):e.kpi.achieved)??\`\`,onChange:t=>l(e.path,t.target.value===\`\`?null:Number(t.target.value)),title:e.kpi.scope===\`sbu\`?\`Studio actual from the target sheet\`:void 0`,
  `disabled:!n,value:e.kpi.achieved??\`\`,onChange:t=>l(e.path,t.target.value===\`\`?null:Number(t.target.value)),title:e.kpi.scope&&e.kpi.scope!==\`individual\`?\`Shared actual — updates every matching plan\`:void 0`,
  "gu achieved input",
);

rt = replaceAllCount(
  rt,
  `(0,Q.jsx)(gu,{empId:_?x:b.id,rec:w,canScore:D.scores,kind:_?\`role\`:\`person\`})`,
  `(0,Q.jsx)(gu,{empId:_?x:b.id,rec:w,canScore:D.scores,kind:_?\`role\`:\`person\`,month:E})`,
  2,
  "gu month prop",
);

rt = replaceOnce(
  rt,
  `t.tone===\`studio\`?\`border-sky-300 bg-sky-50 te`,
  `t.tone===\`function\`?\`border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100\`:t.tone===\`studio\`?\`border-sky-300 bg-sky-50 te`,
  "function chip tone",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0y.js", "routes-e2g7y5q8-13m-p0z.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0y.js", "login-ChZ1wVZ-p0z.js", 2, "index login");
login = replaceOnce(login, `from"./login-view-f2j6t0x4-11a3-p0y.js"`, `from"./login-view-f2j6t0x4-11a3-p0z.js"`, "login lv");
login = replaceOnce(login, `from"./index-f4j9a7t3-11v-p0y.js"`, `from"./index-f4j9a7t3-11v-p0z.js"`, "login idx");

must(rt.includes("children:`SBU`"), "SBU option missing");
must(rt.includes("children:`Function`"), "Function option missing");
must(rt.includes("__shareAch(rec,kpi,n)"), "fan-out missing");
must(rt.includes("Scp,{kpi:e.kpi}"), "Scp kpi fix missing");
must(rt.includes("block min-w-[11rem]"), "applies as spacing missing");

writeBoth("login-view-f2j6t0x4-11a3-p0z.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0z.js", rt);
writeBoth("index-f4j9a7t3-11v-p0z.js", idx);
writeBoth("login-ChZ1wVZ-p0z.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0y.js").join("index-f4j9a7t3-11v-p0z.js");
  html = html.split("routes-e2g7y5q8-13m-p0y.js").join("routes-e2g7y5q8-13m-p0z.js");
  html = html.split("apms-sync.js?v=p0y1").join("apms-sync.js?v=p0z1");
  writeFileSync(path, html);
}
for (const f of ["public/index.html", "public/apms.html", "recovered-site/index.html", "recovered-site/apms.html", "dist/client/index.html", "dist/client/apms.html"]) {
  try { stampHtml(join(root, f)); } catch {}
}
console.log("p0z stamp ok");
