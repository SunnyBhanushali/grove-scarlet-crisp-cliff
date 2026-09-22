/**
 * Stamp p0g: people-tree accountability + KPI scope chip / linked studio actual.
 * Copies live p0f SPA files and patches the real constructors.
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
      if (p.startsWith(dist) && e && e.code === "ENOENT") continue;
      if (p.startsWith(join(root, "dist"))) continue;
      throw e;
    }
  }
}

function copyStamp(from, to) {
  for (const dir of [pub, rec, dist]) {
    try {
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(dir === dist && !from.startsWith("/") ? pub : dir, from), join(dir, to));
    } catch {
      if (dir === dist) {
        try {
          copyFileSync(join(pub, from), join(dir, to));
        } catch {
          /* dist optional */
        }
      } else {
        copyFileSync(join(pub, from), join(dir, to));
      }
    }
  }
}

// Start from p0f
copyFileSync(
  join(pub, "login-view-f2j6t0x4-11a3-p0f.js"),
  join(pub, "login-view-f2j6t0x4-11a3-p0g.js"),
);
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0f.js"), join(pub, "routes-e2g7y5q8-13m-p0g.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0f.js"), join(pub, "index-f4j9a7t3-11v-p0g.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0f.js"), join(pub, "login-ChZ1wVZ-p0g.js"));
copyFileSync(join(pub, "apms-org-scope.js"), join(pub, "apms-org-scope.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0g.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0g.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0g.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0g.js"), "utf8");

// --- login-view import ---
lv = replaceOnce(
  lv,
  `import{i as e,r as t,t as n}from"./react-SIfiwpqq.js";import{c as r,d as i,f as a,l as o,m as s,p as c,s as l,t as u,u as d}from"./index-f4j9a7t3-11v-p0f.js";`,
  `import{i as e,r as t,t as n}from"./react-SIfiwpqq.js";import{c as r,d as i,f as a,l as o,m as s,p as c,s as l,t as u,u as d}from"./index-f4j9a7t3-11v-p0g.js";import{filterDescendantIds as __accFilter,effectiveAchieved as __effAch,linkedSbuActual as __lsa}from"./apms-org-scope.js";`,
  "login-view imports",
);

function storeState() {
  return `(typeof Hp<\`u\`&&Hp&&Hp.getState?Hp.getState():null)`;
}

// Df: filter reporting descendants, then overlay FH unfiltered
lv = replaceOnce(
  lv,
  `function Df(e,t,n=[]){let r=Ef(e,t.id);if(t.access===\`function_head\`&&t.functionId){let i=n.length?ze(n,t.functionId):new Set([t.functionId]);for(let n of e)n.id!==t.id&&(n.functionId===t.functionId||He(n,i))&&r.add(n.id)}return e.filter(e=>r.has(e.id)&&(e.status||\`active\`)!==\`left\`).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`))}`,
  `function Df(e,t,n=[]){let r=Ef(e,t.id);if(t&&!G(t))r=__accFilter(e,t,r);if(t.access===\`function_head\`&&t.functionId){let i=n.length?ze(n,t.functionId):new Set([t.functionId]);for(let n of e)n.id!==t.id&&(n.functionId===t.functionId||He(n,i))&&r.add(n.id)}return e.filter(e=>r.has(e.id)&&(e.status||\`active\`)!==\`left\`).sort((e,t)=>(e.name||\`\`).localeCompare(t.name||\`\`))}`,
  "Df",
);

lv = replaceOnce(
  lv,
  `function Mf(e,t,n){let r=Ef(e,t.id);return n.self!==!1&&r.add(t.id),n.boss&&(t.managerId&&r.add(t.managerId),(t.dottedLine||[]).forEach(d=>d.managerId&&!d.functionId&&r.add(d.managerId))),e.filter(e=>r.has(e.id)&&(n.includeLeft||(e.status||\`active\`)!==\`left\`))}`,
  `function Mf(e,t,n){let r=Ef(e,t.id);if(t&&!G(t))r=__accFilter(e,t,r);return n.self!==!1&&r.add(t.id),n.boss&&(t.managerId&&r.add(t.managerId),(t.dottedLine||[]).forEach(d=>d.managerId&&!d.functionId&&r.add(d.managerId))),e.filter(e=>r.has(e.id)&&(n.includeLeft||(e.status||\`active\`)!==\`left\`))}`,
  "Mf",
);

lv = replaceOnce(
  lv,
  `function fl(e,t,n=[]){return e?e.id===t.id||dl(e,t,n):!1}`,
  `function fl(e,t,n=[]){if(!e||!t)return!1;if(e.id===t.id||G(e)||dl(e,t,n))return!0;try{let r=${storeState()},i=r&&r.people||[];return Df(i,e,n.length?n:r&&r.functions||[]).some(n=>n.id===t.id)}catch{return!1}}`,
  "fl",
);

lv = replaceOnce(
  lv,
  `function pl(e,t,n=[]){return t?G(t)?e:e.filter(e=>fl(t,e,n)):[]}`,
  `function pl(e,t,n=[]){if(!t)return[];if(G(t))return e;let r=new Set(Df(e,t,n).map(e=>e.id));return r.add(t.id),e.filter(e=>r.has(e.id))}`,
  "pl",
);

lv = replaceOnce(
  lv,
  `function $p(e,t){return!!e&&!!t&&e.id!==t.id&&!!(G(e)||ul(e,t)||e.access===\`function_head\`&&(t.functionId===e.functionId||Ve(t).some(t=>t.functionId===e.functionId)))}`,
  `function $p(e,t){return!!e&&!!t&&e.id!==t.id&&!!(G(e)||ul(e,t)||e.access===\`function_head\`&&(t.functionId===e.functionId||Ve(t).some(t=>t.functionId===e.functionId))||fl(e,t))}`,
  "$p",
);

lv = replaceOnce(
  lv,
  `isQualifier:!!(a&&a.isQualifier),isCustom:!0,description:a?.description||\`\`,kpiId:a?.kpiId,children:[]}}`,
  `isQualifier:!!(a&&a.isQualifier),isCustom:!0,description:a?.description||\`\`,kpiId:a?.kpiId,scope:a?.scope||\`individual\`,scopeId:a?.scopeId||\`\`,scopeLabel:a?.scopeLabel||\`\`,children:[]}}`,
  "em scope",
);

lv = replaceOnce(
  lv,
  `function As(e){if(e.achieved==null||Number.isNaN(e.achieved))return null;let t=Ss(e),n=Cs(e),r=e.achieved;`,
  `function As(e){let r=__effAch(e,${storeState()});if(r==null||Number.isNaN(r))return null;let t=Ss(e),n=Cs(e);`,
  "As linked actual",
);

lv = replaceOnce(
  lv,
  `if(k.achieved==null||Number.isNaN(Number(k.achieved)))continue;if(typeof k.floor!=\`number\`||Number.isNaN(k.floor))continue;let a=Number(k.achieved),tgt=typeof k.target==\`number\`?k.target:null,`,
  `let a=__effAch(k,${storeState()});if(a==null||Number.isNaN(Number(a)))continue;if(typeof k.floor!=\`number\`||Number.isNaN(k.floor))continue;a=Number(a);let tgt=typeof k.target==\`number\`?k.target:null,`,
  "qualifier linked actual",
);

// --- routes ---
rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0f.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0g.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0f.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0g.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `import{i as e,t}from"./react-SIfiwpqq.js";`,
  `import{i as e,t}from"./react-SIfiwpqq.js";import{linkedSbuActual as __lsa,kpiScopeChip as __kchip}from"./apms-org-scope.js";`,
  "routes helper import",
);

const scpFn = `function Scp({kpi:e}){let t=__kchip(e);if(!t)return null;return(0,Q.jsx)(\`span\`,{className:\`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium \`+(t.tone===\`studio\`?\`border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200\`:\`border-border bg-muted/70 text-muted-foreground\`),title:t.title,children:t.label})}function Lsa(e){try{return __lsa(e,K.getState())}catch{return null}}`;

rt = replaceOnce(
  rt,
  `function bu({onAdd:e,onCancel:t,includePillars:pill,defaultWeight:dw,takenIds:taken}){`,
  `${scpFn}function bu({onAdd:e,onCancel:t,includePillars:pill,defaultWeight:dw,takenIds:taken,personId:personId}){`,
  "inject Scp + bu personId",
);

rt = replaceOnce(
  rt,
  `[qual,setQual]=(0,Z.useState)(!1);let q=Number(c)>Number(o);function g(e){r(e);let t=Nr(e.unit)||\`score\`;d(t);e.target!=null&&s(String(e.target));e.floor!=null&&l(String(e.floor));e.blurb&&(h(e.blurb),p(!0));e.isQualifier&&setQual(!0)}function _(){n&&e(n.name,(Number(i)||0)/100,{target:Number(o)||0,floor:Number(c)||0,lowerIsBetter:q,isQualifier:qual},u,m.trim(),n.id)}`,
  `[qual,setQual]=(0,Z.useState)(!1),[scope,setScope]=(0,Z.useState)(\`individual\`),[scopeId,setScopeId]=(0,Z.useState)(\`\`),[scopeLabel,setScopeLabel]=(0,Z.useState)(\`\`);let st=K(),person=personId?st.people.find(p=>p.id===personId):null,sbus=(st.businessUnits||[]).filter(b=>!b.isGroup),personSbuIds=person?.buIds?.length?person.buIds.filter(Boolean):person?.buId?[person.buId]:[];let q=Number(c)>Number(o);function setSc(k){setScope(k);if(k===\`individual\`){setScopeId(\`\`),setScopeLabel(\`\`);return}if(k===\`sbu\`){let id=scopeId||personSbuIds[0]||sbus[0]?.id||\`\`;setScopeId(id),setScopeLabel((sbus.find(b=>b.id===id)||{}).name||\`\`);return}if(k===\`team\`){if(!scopeLabel){let mgr=person&&person.managerId?st.people.find(p=>p.id===person.managerId):null;setScopeLabel(mgr?mgr.name+\`'s team\`:person?person.name+\`'s team\`:\`\`)}}}function g(e){r(e);let t=Nr(e.unit)||\`score\`;d(t);e.target!=null&&s(String(e.target));e.floor!=null&&l(String(e.floor));e.blurb&&(h(e.blurb),p(!0));e.isQualifier&&setQual(!0)}function _(){n&&e(n.name,(Number(i)||0)/100,{target:Number(o)||0,floor:Number(c)||0,lowerIsBetter:q,isQualifier:qual,scope,scopeId:scope===\`sbu\`?scopeId:\`\`,scopeLabel:scope===\`individual\`?\`\`:scopeLabel},u,m.trim(),n.id)}`,
  "bu scope state",
);

const appliesUi = `(0,Q.jsxs)(\`div\`,{className:\`flex flex-wrap items-end gap-2\`,children:[(0,Q.jsxs)(\`div\`,{className:\`space-y-0.5\`,children:[(0,Q.jsx)(\`div\`,{className:\`text-[11px] font-medium text-muted-foreground\`,children:\`Applies as\`}),(0,Q.jsxs)(\`div\`,{className:\`flex flex-wrap gap-1\`,children:[(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`individual\`?\`secondary\`:\`outline\`,onClick:()=>setSc(\`individual\`),children:\`Self\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`team\`?\`secondary\`:\`outline\`,onClick:()=>setSc(\`team\`),children:\`Team\`}),(0,Q.jsx)(z,{type:\`button\`,size:\`sm\`,variant:scope===\`sbu\`?\`secondary\`:\`outline\`,onClick:()=>setSc(\`sbu\`),children:\`Studio\`})]}),(0,Q.jsx)(\`p\`,{className:\`text-[11px] text-muted-foreground\`,children:scope===\`individual\`?\`This person’s own number.\`:scope===\`team\`?\`Team KPI, scored on this person.\`:\`Studio KPI — one studio number, shown on this person.\`})]}),scope===\`team\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Whose team\`,(0,Q.jsx)(\`input\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeLabel,onChange:e=>setScopeLabel(e.target.value),placeholder:\`e.g. Vishal’s team\`})]}):scope===\`sbu\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Studio\`,(0,Q.jsx)(\`select\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:scopeId,onChange:e=>{let id=e.target.value;setScopeId(id),setScopeLabel((sbus.find(b=>b.id===id)||{}).name||\`\`)},children:(sbus.length?sbus:[{id:\`\`,name:\`No studios yet\`}]).map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):null]}),`;

rt = replaceOnce(
  rt,
  `\`Qualifier\`]})]}),(0,Q.jsx)(\`div\`,{children:f||m?(0,Q.jsxs)(\`label\`,{className:\`block text-sm font-medium\`,children:[\`Description\`,`,
  `\`Qualifier\`]})]}),${appliesUi}(0,Q.jsx)(\`div\`,{children:f||m?(0,Q.jsxs)(\`label\`,{className:\`block text-sm font-medium\`,children:[\`Description\`,`,
  "bu Applies as UI",
);

// Chip on L2/KPI table name
rt = replaceOnce(
  rt,
  `(0,Q.jsx)(_u,{tone:\`kpi\`,children:t?\`L2\`:\`KPI\`}),(0,Q.jsx)(\`span\`,{children:e.name})]})}),`,
  `(0,Q.jsx)(_u,{tone:\`kpi\`,children:t?\`L2\`:\`KPI\`}),(0,Q.jsx)(\`span\`,{children:e.name}),(0,Q.jsx)(Scp,{kpi:e})]})}),`,
  "hu chip",
);

// Chip on scorecard kpi.name row
rt = replaceOnce(
  rt,
  `(0,Q.jsx)(\`div\`,{className:\`font-medium\`,children:e.kpi.name}),(0,Q.jsxs)(\`div\`,{className:\`text-[11px] text-muted-foreground\`,children:[e.brand,\` · \`,e.kra]})`,
  `(0,Q.jsxs)(\`div\`,{className:\`flex flex-wrap items-center gap-1.5\`,children:[(0,Q.jsx)(\`span\`,{className:\`font-medium\`,children:e.kpi.name}),(0,Q.jsx)(Scp,{kpi:e})]}),(0,Q.jsxs)(\`div\`,{className:\`text-[11px] text-muted-foreground\`,children:[e.brand,\` · \`,e.kra]})`,
  "scorecard chip",
);

// Cu: sbus + chip + applies as
rt = replaceOnce(
  rt,
  `function Cu({kpi:e,canEdit:t,open:n,onToggle:r,onChange:i,onDelete:a}){let o=he(e),s=pn(e),c=ze(e),[l,u]=(0,Z.useState)(!!e.description),`,
  `function Cu({kpi:e,canEdit:t,open:n,onToggle:r,onChange:i,onDelete:a}){let o=he(e),s=pn(e),c=ze(e),st=K(),sbus=(st.businessUnits||[]).filter(b=>!b.isGroup),[l,u]=(0,Z.useState)(!!e.description),`,
  "Cu sbus",
);

// Chip next to Cu name
rt = replaceOnce(
  rt,
  `onDoubleClick:n=>{if(!t.targets)return;n.preventDefault(),n.stopPropagation(),setKpiEdit(!0),setKpiDraft(e.name)},children:e.name}),e.unit?(0,Q.jsx)(\`span\`,{className:\`shrink-0 text-[11px] text-muted-foreground\`,children:Pn(e.unit)}):null,(0,Q.jsx)(Tu,{`,
  `onDoubleClick:n=>{if(!t.targets)return;n.preventDefault(),n.stopPropagation(),setKpiEdit(!0),setKpiDraft(e.name)},children:e.name}),(0,Q.jsx)(Scp,{kpi:e}),e.unit?(0,Q.jsx)(\`span\`,{className:\`shrink-0 text-[11px] text-muted-foreground\`,children:Pn(e.unit)}):null,(0,Q.jsx)(Tu,{`,
  "Cu name chip",
);

rt = replaceOnce(
  rt,
  `lowerIsBetter:c>s}),(0,Q.jsx)(\`div\`,{className:\`mt-2\`,children:l||e.description?(0,Q.jsxs)(\`label\`,{className:\`block text-[11px] font-medium text-muted-foreground\`,children:[\`Description\`,`,
  `lowerIsBetter:c>s}),(0,Q.jsxs)(\`div\`,{className:\`mt-2 flex flex-wrap items-end gap-2\`,children:[(0,Q.jsxs)(\`label\`,{className:\`text-[11px] font-medium text-muted-foreground\`,children:[\`Applies as\`,(0,Q.jsxs)(\`select\`,{className:\`mt-0.5 h-9 rounded-md border border-border bg-card px-2 text-sm\`,disabled:!t.targets,value:e.scope||\`individual\`,onChange:ev=>{let id=ev.target.value;i(k=>{k.scope=id;if(id===\`individual\`){k.scopeId=\`\`;k.scopeLabel=\`\`}else if(id===\`sbu\`){k.scopeId=k.scopeId||sbus[0]&&sbus[0].id||\`\`;k.scopeLabel=(sbus.find(b=>b.id===k.scopeId)||{}).name||k.scopeLabel||\`\`}})},children:[(0,Q.jsx)(\`option\`,{value:\`individual\`,children:\`Self\`}),(0,Q.jsx)(\`option\`,{value:\`team\`,children:\`Team\`}),(0,Q.jsx)(\`option\`,{value:\`sbu\`,children:\`Studio\`})]})]}),t.targets&&e.scope===\`team\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Whose team\`,(0,Q.jsx)(\`input\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeLabel||\`\`,onChange:ev=>i(k=>{k.scopeLabel=ev.target.value}),placeholder:\`e.g. Vishal's team\`})]}):t.targets&&e.scope===\`sbu\`?(0,Q.jsxs)(\`label\`,{className:\`min-w-[12rem] flex-1 text-[11px] font-medium text-muted-foreground\`,children:[\`Studio\`,(0,Q.jsx)(\`select\`,{className:\`mt-0.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm\`,value:e.scopeId||\`\`,onChange:ev=>{let id=ev.target.value;i(k=>{k.scopeId=id;k.scopeLabel=(sbus.find(b=>b.id===id)||{}).name||\`\`})},children:sbus.map(b=>(0,Q.jsx)(\`option\`,{value:b.id,children:b.name},b.id))})]}):null]}),(0,Q.jsx)(\`div\`,{className:\`mt-2\`,children:l||e.description?(0,Q.jsxs)(\`label\`,{className:\`block text-[11px] font-medium text-muted-foreground\`,children:[\`Description\`,`,
  "Cu Applies as",
);

// Pass scope through add-KPI onAdd (person month)
rt = replaceOnce(
  rt,
  `isQualifier:o.isQualifier}))}),oe(null)}`,
  `isQualifier:o.isQualifier,scope:o.scope,scopeId:o.scopeId,scopeLabel:o.scopeLabel}))}),oe(null)}`,
  "person-month add KPI scope",
);

rt = replaceOnce(
  rt,
  `isQualifier:i?.isQualifier,description:o})}`,
  `isQualifier:i?.isQualifier,description:o,scope:i?.scope,scopeId:i?.scopeId,scopeLabel:i?.scopeLabel})}`,
  "role add KPI scope",
);

// personId on person-month bu
rt = replaceOnce(
  rt,
  `(0,Q.jsx)(bu,{onCancel:()=>oe(null),onAdd:(n,a,o,s,c,l)=>{S&&b(S,t.name,n);`,
  `(0,Q.jsx)(bu,{personId:e,onCancel:()=>oe(null),onAdd:(n,a,o,s,c,l)=>{S&&b(S,t.name,n);`,
  "bu personId",
);

// Linked actual on scorecard input
rt = replaceOnce(
  rt,
  `(0,Q.jsx)(\`input\`,{type:\`number\`,className:\`\${W} h-9 w-24\`,disabled:!n,value:e.kpi.achieved??\`\`,onChange:t=>l(e.path,t.target.value===\`\`?null:Number(t.target.value))})`,
  `(0,Q.jsx)(\`input\`,{type:\`number\`,className:\`\${W} h-9 w-24\`,disabled:!n||e.kpi.scope===\`sbu\`&&Lsa(e.kpi)!=null,value:(e.kpi.scope===\`sbu\`&&Lsa(e.kpi)!=null?Lsa(e.kpi):e.kpi.achieved)??\`\`,onChange:t=>l(e.path,t.target.value===\`\`?null:Number(t.target.value)),title:e.kpi.scope===\`sbu\`?\`Studio actual from the target sheet\`:void 0})`,
  "linked actual input",
);

// --- index + login chunk + html ---
idx = replaceAllCount(
  idx,
  "routes-e2g7y5q8-13m-p0f.js",
  "routes-e2g7y5q8-13m-p0g.js",
  2,
  "index routes stamp",
);
idx = replaceAllCount(
  idx,
  "login-ChZ1wVZ-p0f.js",
  "login-ChZ1wVZ-p0g.js",
  2,
  "index login stamp",
);

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0f.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0g.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0f.js"`,
  `from"./index-f4j9a7t3-11v-p0g.js"`,
  "login-ChZ index",
);

writeBoth("login-view-f2j6t0x4-11a3-p0g.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0g.js", rt);
writeBoth("index-f4j9a7t3-11v-p0g.js", idx);
writeBoth("login-ChZ1wVZ-p0g.js", login);
writeBoth("apms-org-scope.js", readFileSync(join(pub, "apms-org-scope.js"), "utf8"));

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0f.js").join("index-f4j9a7t3-11v-p0g.js");
  html = html.split("routes-e2g7y5q8-13m-p0f.js").join("routes-e2g7y5q8-13m-p0g.js");
  html = html.split("apms-sync.js?v=p0f1").join("apms-sync.js?v=p0g1");
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

console.log("p0g stamp ok", {
  lv: lv.length,
  rt: rt.length,
  idx: idx.length,
});
