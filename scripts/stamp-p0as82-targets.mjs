// @ts-nocheck -- BATCH-3 part C stamp pairs (Targets / Rewards broken links), applied by stamp-p0as82-batch3.mjs
/**
 * BATCH-3 part C — Targets / Rewards broken links. Exact string replacements
 * (old → new, asserted n times) on the routes chunk and the login-view chunk.
 *
 * 1. Delete guard: deleting a target (month-page row, Target tab, whole month
 *    from the list) that rewards unlock against lists them (person · month)
 *    with Cancel / Delete anyway. No links → the old confirm, unchanged.
 * 2. targetLinkBroken is computed at render time (never stored): reward's
 *    targetNodeId names a node that is missing or has no cell in the reward's
 *    month. Rewards month list row: orange warning icon + tooltip. Reward page
 *    (Unlock against): orange banner + Re-link → that month's targets; the pick
 *    saves through the existing Unlock against handler (patchRecord → entity
 *    PATCH of the reward record).
 * 3. Relink offer: the store's create actions (addTargetLeaf / placeOrgTarget /
 *    addTargetGroup, login-view) fire `apms-target-made` {id, months}. A
 *    watcher on the Targets screens and the reward page lists rewards in those
 *    months whose broken link pointed at a deleted target with the same name
 *    (and kind) and offers "Relink" / "Not now". Relink = Mass update's save
 *    path (window.__apmsSync.massPatch, one entity PATCH per reward record).
 *    When the create reused the node id the links are whole again and nothing
 *    is offered.
 * 5. Import (TargetsX, the bundled src/lib/targets-import.ts): a blank value
 *    cell keeps the stored value, an explicit value (0 included) changes it;
 *    Import always shows "X changed, Y unchanged, Z blank-kept" before Apply.
 *
 * Pure helpers live in TL_PURE_JS (same logic as src/lib/targets-links.ts;
 * src/lib/targets-links.test.ts runs both on the same cases). The helper code
 * uses only "double quotes" (no backticks / ${}) so it sits in String.raw.
 */

/** Pure link helpers (mirrors src/lib/targets-links.ts). */
export const TL_PURE_JS = String.raw`function __tlCellIn(st,id,m){let c=st.targetCells||{};if(c[id+"::"+m])return!0;for(let k in c){let x=c[k];if(!x||x.nodeId!==id)continue;let mm=x.month||(k.indexOf("::")>=0?k.slice(k.lastIndexOf("::")+2):"");if(mm===m)return!0}return!1}function __tlBroken(rec,m,st){let id=rec&&rec.targetNodeId;if(!id)return!1;if(!(st.targetNodes||{})[id])return!0;return!__tlCellIn(st,String(id),m)}function __tlName(st,id){let n=(st.targetNodes||{})[id];if(n&&n.name)return{name:n.name,kind:n.kind};let tr=st.trash||[];for(let i=tr.length-1;i>=0;i--){let s=tr[i]&&tr[i].snapshot,x=s&&s.targetNodes&&s.targetNodes[id];if(x&&x.name)return{name:x.name,kind:x.kind}}return null}function __tlLinked(st,ids,months){let want=ids?new Set(ids):null,ms=new Set(months),out=[];for(let[p,by]of Object.entries(st.rewardRecords||{})){if(!ms.has(p))continue;for(let[pid,r]of Object.entries(by||{})){let id=r&&r.targetNodeId;id&&(!want||want.has(String(id)))&&out.push({kind:"record",period:p,personId:pid,nodeId:String(id)})}}for(let[rid,bm]of Object.entries(st.rewardRoleMonths||{})){for(let[p,r]of Object.entries(bm||{})){if(!ms.has(p))continue;let id=r&&r.targetNodeId;id&&(!want||want.has(String(id)))&&out.push({kind:"roleMonth",period:p,roleId:rid,nodeId:String(id)})}}return out.sort((a,b)=>(a.period+(a.personId||a.roleId)).localeCompare(b.period+(b.personId||b.roleId)))}function __tlWho(st,r){return r.kind==="roleMonth"?((st.roles||{})[r.roleId]||{}).name||r.roleId||"Role":((st.people||[]).find(p=>p.id===r.personId)||{}).name||r.personId||"Person"}function __tlNorm(s){return String(s||"").replace(/\s+/g," ").trim().toLowerCase()}function __tlRec(st,r){return r.kind==="record"?((st.rewardRecords||{})[r.period]||{})[r.personId]:((st.rewardRoleMonths||{})[r.roleId]||{})[r.period]}function __tlCands(st,newId,months){let n=(st.targetNodes||{})[newId];if(!n)return[];let nm=__tlNorm(n.name),out=[];for(let r of __tlLinked(st,null,months)){if(r.nodeId===newId||!__tlCellIn(st,newId,r.period))continue;if(!__tlBroken(__tlRec(st,r),r.period,st))continue;let w=__tlName(st,r.nodeId);if(!w||__tlNorm(w.name)!==nm)continue;if(w.kind&&n.kind&&w.kind!==n.kind)continue;out.push({...r,fromName:w.name})}return out}`;

const ORANGE = "#E25A3C";
const WARN_BOX = `{borderColor:"${ORANGE}",background:"#FDF1EC",color:"#7C2D12"}`;

/** React pieces (routes chunk scope: Q = jsx runtime, Z = React, K = store, H = modal, z = Button, bi = confirm dialog, V = month label). */
export const TL_UI_JS = String.raw`function ApmsTlIcon(p){return(0,Q.jsxs)("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"${ORANGE}",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p&&p.className||"size-4 shrink-0","aria-hidden":!0,children:[(0,Q.jsx)("path",{d:"M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"}),(0,Q.jsx)("line",{x1:"12",y1:"9",x2:"12",y2:"13"}),(0,Q.jsx)("line",{x1:"12",y1:"17",x2:"12.01",y2:"17"})]})}function ApmsTlDel({node:nd,months:ms,title:ti,body:bo,confirmLabel:cl,onClose:oc,onConfirm:ok}){let st=K(),links=__tlLinked(st,nd?[nd.id]:null,ms||[]).filter(r=>__tlCellIn(st,r.nodeId,r.period));if(!links.length)return(0,Q.jsx)(bi,{title:ti,body:bo,confirmLabel:cl,onClose:oc,onConfirm:ok});let n=links.length;return(0,Q.jsxs)(H,{title:ti,onClose:oc,children:[(0,Q.jsxs)("div",{"data-apms-tl-guard":"",className:"rounded-md border p-3 text-sm",style:${WARN_BOX},children:[(0,Q.jsxs)("div",{className:"flex items-start gap-2",children:[(0,Q.jsx)(ApmsTlIcon,{}),(0,Q.jsx)("p",{className:"font-medium",children:n+" reward"+(n===1?" unlocks":"s unlock")+" against "+(nd?"this target":"targets in this month")})]}),(0,Q.jsx)("p",{className:"mt-1 text-xs leading-relaxed",children:"Deleting breaks their target link. They keep the link and show a warning until someone re-links them (or the target is re-created with the same name)."}),(0,Q.jsx)("ul",{className:"mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-4 text-xs leading-relaxed",children:links.slice(0,40).map((r,i)=>(0,Q.jsx)("li",{children:__tlWho(st,r)+" · "+V(r.period)+(nd?"":" · "+((__tlName(st,r.nodeId)||{}).name||r.nodeId))},i))}),n>40&&(0,Q.jsx)("p",{className:"mt-1 text-xs",children:"… and "+(n-40)+" more"})]}),bo&&(0,Q.jsx)("p",{className:"mt-3 text-sm text-muted-foreground",children:bo}),(0,Q.jsxs)("div",{className:"mt-4 flex justify-end gap-2",children:[(0,Q.jsx)(z,{type:"button",variant:"outline",onClick:oc,children:"Cancel"}),(0,Q.jsx)(z,{type:"button",variant:"destructive",onClick:ok,children:"Delete anyway"})]})]})}function ApmsTlBanner({rec:rc,month:m,nodes:ns,canPick:cp,onPick:op}){let st=K(),[open,setOpen]=(0,Z.useState)(!1);if(!rc||!__tlBroken(rc,m,st))return null;let was=__tlName(st,rc.targetNodeId),list=ns||[],grp=[["Groups",list.filter(x=>x.kind==="group")],["Studios",list.filter(x=>x.kind==="leaf"&&x.sbuId)],["Other metrics",list.filter(x=>x.kind==="leaf"&&!x.sbuId)]].filter(g=>g[1].length);return(0,Q.jsxs)("div",{"data-apms-tl":"broken",role:"alert",className:"mb-4 rounded-lg border p-3 text-sm",style:${WARN_BOX},children:[(0,Q.jsxs)("div",{className:"flex flex-wrap items-start gap-2",children:[(0,Q.jsx)(ApmsTlIcon,{className:"mt-0.5 size-4 shrink-0"}),(0,Q.jsxs)("div",{className:"min-w-0 flex-1",children:[(0,Q.jsx)("p",{className:"font-medium",children:"Target link broken"}),(0,Q.jsx)("p",{className:"mt-0.5 text-xs leading-relaxed",children:"This reward unlocked against "+(was?"“"+was.name+"”":"a target")+", which was deleted from "+V(m)+". Nothing unlocks until it is re-linked."}),!cp&&(0,Q.jsx)("p",{className:"mt-1 text-xs leading-relaxed",children:"To re-link, unlock the plan (or use Mass update on the Rewards list)."})]}),cp&&(0,Q.jsx)(z,{type:"button",size:"sm",variant:"outline",onClick:()=>setOpen(o=>!o),children:open?"Cancel":"Re-link"})]}),cp&&open&&(list.length?(0,Q.jsx)("div",{"data-apms-tl-picker":"",className:"mt-3 max-h-64 space-y-2 overflow-auto rounded-md border border-border bg-card p-2 text-foreground",children:grp.map(g=>(0,Q.jsxs)("div",{children:[(0,Q.jsx)("p",{className:"px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",children:g[0]}),g[1].map(x=>(0,Q.jsx)("button",{type:"button",className:"block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted/60",onClick:()=>{op(x.id);setOpen(!1)},children:x.name},x.id))]},g[0]))}):(0,Q.jsx)("p",{className:"mt-2 text-xs",children:"No targets for "+V(m)+" yet. Create one in Targets, then re-link."}))]})}function ApmsTlWatch(){let[of,setOf]=(0,Z.useState)(null),[busy,setBusy]=(0,Z.useState)(!1),[msg,setMsg]=(0,Z.useState)("");(0,Z.useEffect)(()=>{let h=ev=>{let d=ev&&ev.detail;if(!d||!d.id||d.tlSeen)return;d.tlSeen=!0;let c=__tlCands(K.getState(),d.id,d.months||[]);c.length&&(setMsg(""),setOf({id:d.id,list:c}))};window.addEventListener("apms-target-made",h);return()=>window.removeEventListener("apms-target-made",h)},[]);if(!of)return null;let st=K.getState(),nd=(st.targetNodes||{})[of.id],names=[...new Set(of.list.map(x=>x.fromName))],n=of.list.length;async function go(){setBusy(!0);let s=K.getState(),node=(s.targetNodes||{})[of.id];if(!node){setBusy(!1);setOf(null);return}let recs=of.list.filter(x=>x.kind==="record"),rms=of.list.filter(x=>x.kind==="roleMonth"),ops=recs.map(x=>{let rec={...(((s.rewardRecords||{})[x.period]||{})[x.personId]||{})};rec.targetNodeId=node.id;rec.targetSbuId=node.sbuId||void 0;rec.targetMetric=node.metric;rec.updatedAt=Date.now();return{kind:"reward_records",url:"/api/reward-records/"+encodeURIComponent(x.period)+"/"+encodeURIComponent(x.personId),payload:rec,personId:x.personId,period:x.period,revKey:"reward_records:"+x.period+":"+x.personId}}),sync=window.__apmsSync,out=ops.length?sync&&sync.massPatch?await sync.massPatch(ops):{updated:0,failed:ops.length,results:[]}:{updated:0,failed:0,results:[]},byP={};(out.results||[]).forEach(x=>{x.status===200&&x.json&&x.json.payload&&((byP[x.period]=byP[x.period]||{})[x.personId]=x.json.payload)});K.setState(s2=>{let nx={};if(Object.keys(byP).length){let rr={...(s2.rewardRecords||{})};for(let p of Object.keys(byP))rr[p]={...(rr[p]||{}),...byP[p]};nx.rewardRecords=rr}if(rms.length){let rm={...(s2.rewardRoleMonths||{})};for(let x of rms){let byM={...(rm[x.roleId]||{})},cur=byM[x.period];cur&&(byM[x.period]={...cur,targetNodeId:node.id,targetSbuId:node.sbuId||void 0,targetMetric:node.metric,updatedAt:Date.now()});rm[x.roleId]=byM}nx.rewardRoleMonths=rm}Object.keys(nx).length&&(nx.notebookUpdatedAt=Date.now());return nx});setBusy(!1);let bad=ops.length-(out.updated||0);if(bad>0){setMsg((out.updated||0)+rms.length+" relinked; "+bad+" could not be saved (changed by someone else) — open those rewards and use Re-link.");return}setOf(null)}return(0,Q.jsxs)(H,{title:"Relink rewards?",onClose:()=>setOf(null),children:[(0,Q.jsxs)("div",{"data-apms-tl-relink":"",className:"rounded-md border p-3 text-sm",style:${WARN_BOX},children:[(0,Q.jsx)("p",{className:"font-medium",children:n+" reward"+(n===1?" was":"s were")+" linked to a deleted target named "+names.map(x=>"“"+x+"”").join(", ")+" — relink "+(n===1?"it":"them")+" to "+(nd?"“"+nd.name+"”":"the new target")+"?"}),(0,Q.jsx)("ul",{className:"mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-4 text-xs leading-relaxed",children:of.list.slice(0,40).map((r,i)=>(0,Q.jsx)("li",{children:__tlWho(st,r)+" · "+V(r.period)},i))})]}),msg&&(0,Q.jsx)("p",{className:"mt-3 text-sm",children:msg}),(0,Q.jsxs)("div",{className:"mt-4 flex justify-end gap-2",children:[(0,Q.jsx)(z,{type:"button",variant:"outline",onClick:()=>setOf(null),children:msg?"Close":"Not now"}),!msg&&(0,Q.jsx)(z,{type:"button",disabled:busy,onClick:go,children:busy?"Relinking…":"Relink"})]})]})}`;

/** Routes chunk: [{ what, old, new, n }] — exact string replacements. */
export const TARGETS_ROUTES_FIXES = [
  {
    what: "part C: link helpers (broken-link check, linked rewards, relink candidates) + guard dialog, reward-page banner, relink watcher",
    old: "function bs({person:e,month:t,showName:n,canMass:massOk,selected:isOn,onToggle:tog}){",
    new: TL_PURE_JS + TL_UI_JS + "function bs({person:e,month:t,showName:n,canMass:massOk,selected:isOn,onToggle:tog}){",
    n: 1,
  },
  {
    what: "part C 2: Rewards month list row — orange warning icon (tooltip) when the reward's target link is broken",
    old: "(0,Q.jsx)(Ro,{status:a?.status||`plan_open`,month:t}),r.kind===`rewards`?(0,Q.jsx)(`span`,{className:`text-sm tabular-nums`",
    new: "r.kind===`rewards`&&__tlBroken(a,t,r)&&(0,Q.jsx)(`span`,{\"data-apms-tl\":`broken`,title:`Target link broken — the linked target was deleted`,\"aria-label\":`Target link broken`,className:`inline-flex shrink-0`,children:(0,Q.jsx)(ApmsTlIcon,{})}),(0,Q.jsx)(Ro,{status:a?.status||`plan_open`,month:t}),r.kind===`rewards`?(0,Q.jsx)(`span`,{className:`text-sm tabular-nums`",
    n: 1,
  },
  {
    what: "part C 1: month page row Delete — guard lists linked rewards (Cancel / Delete anyway)",
    old: "x&&(0,Q.jsx)(bi,{title:`Delete “${e.name}”?`,body:`Moves to Trash for 30 days. Other months stay.`,confirmLabel:`Delete`,onClose:()=>S(!1),onConfirm:()=>{d.deleteTargetFromMonth(e.id,t),S(!1)}})",
    new: "x&&(0,Q.jsx)(ApmsTlDel,{node:e,months:[t],title:`Delete “${e.name}”?`,body:`Moves to Trash for 30 days. Other months stay.`,confirmLabel:`Delete`,onClose:()=>S(!1),onConfirm:()=>{d.deleteTargetFromMonth(e.id,t),S(!1)}})",
    n: 1,
  },
  {
    what: "part C 1: Target / Group tab Delete (all open months) — dialog state + guard (was window.confirm)",
    old: "let t=K(),[n,r]=(0,Z.useState)(!1),[i,a]=(0,Z.useState)(e.name),o=Gr(t.targetCells||{},t.targetMembers||[],e.id),s=o[o.length-1]||t.currentMonth;return(0,Q.jsxs)(`div`,{className:`flex shrink-0 items-center gap-0.5`,onClick:e=>e.stopPropagation(),children:[",
    new: "let t=K(),[n,r]=(0,Z.useState)(!1),[i,a]=(0,Z.useState)(e.name),[tlq,setTlq]=(0,Z.useState)(!1),o=Gr(t.targetCells||{},t.targetMembers||[],e.id),s=o[o.length-1]||t.currentMonth;return(0,Q.jsxs)(`div`,{className:`flex shrink-0 items-center gap-0.5`,onClick:e=>e.stopPropagation(),children:[tlq&&(0,Q.jsx)(ApmsTlDel,{node:e,months:o,title:`Delete “${e.name}”?`,body:`Moves “${e.name}” to Trash from open months. Locked months stay.`,confirmLabel:`Delete`,onClose:()=>setTlq(!1),onConfirm:()=>{for(let n of o)t.deleteTargetFromMonth(e.id,n);setTlq(!1)}}),",
    n: 1,
  },
  {
    what: "part C 1: Target / Group tab Delete button opens the guard",
    old: "onClick:()=>{if(window.confirm(`Move “${e.name}” to Trash from open months? Locked months stay.`))for(let n of o)t.deleteTargetFromMonth(e.id,n)}",
    new: "onClick:()=>setTlq(!0)",
    n: 1,
  },
  {
    what: "part C 1: Targets list — Delete a whole month: guard lists rewards unlocking against its targets",
    old: "t&&(0,Q.jsx)(bi,{title:`Delete ${V(e)}?`,body:`This target month and its floors move to Trash for 30 days. Other months stay.`,confirmLabel:`Delete month`,onClose:()=>n(!1),onConfirm:()=>{K.getState().deleteTargetMonth(e),n(!1)}})",
    new: "t&&(0,Q.jsx)(ApmsTlDel,{node:null,months:[e],title:`Delete ${V(e)}?`,body:`This target month and its floors move to Trash for 30 days. Other months stay.`,confirmLabel:`Delete month`,onClose:()=>n(!1),onConfirm:()=>{K.getState().deleteTargetMonth(e),n(!1)}})",
    n: 1,
  },
  {
    what: "part C 2/3: reward page (Unlock against) — broken-link banner with Re-link (saves via the Unlock against handler y) + relink watcher",
    old: "return(0,Q.jsxs)(`section`,{className:`rounded-xl border border-border bg-card p-5`,children:[(0,Q.jsxs)(`div`,{className:`flex flex-wrap items-start justify-between gap-3`,children:[(0,Q.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[(0,Q.jsx)(`h3`,{className:`font-display text-lg`,children:`Unlock against`})",
    new: "return(0,Q.jsxs)(`section`,{className:`rounded-xl border border-border bg-card p-5`,children:[(0,Q.jsx)(ApmsTlBanner,{rec:t,month:s,nodes:h,canPick:r,onPick:x=>y(`node:`+x)}),(0,Q.jsx)(ApmsTlWatch,{}),(0,Q.jsxs)(`div`,{className:`flex flex-wrap items-start justify-between gap-3`,children:[(0,Q.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[(0,Q.jsx)(`h3`,{className:`font-display text-lg`,children:`Unlock against`})",
    n: 1,
  },
  {
    what: "part C 3: Targets screens (list + month) mount the relink watcher",
    old: "function bd(){return K(e=>e.view)===`targets-month`?(0,Q.jsx)(kd,{}):(0,Q.jsx)(xd,{})}",
    new: "function bd(){let v=K(e=>e.view);return(0,Q.jsxs)(Q.Fragment,{children:[v===`targets-month`?(0,Q.jsx)(kd,{},`m`):(0,Q.jsx)(xd,{},`l`),(0,Q.jsx)(ApmsTlWatch,{},`w`)]})}",
    n: 1,
  },
  // ---- 5. Targets import: always a summary before Apply ----
  {
    what: "part C 5: Import always shows the summary first (recomputed on the current store), then Apply",
    old: "if((rep.length||o.report&&o.report.unmapped)&&!ask){setAsk(!0);return}",
    new: "if(!ask){let pv=TargetsX.applyTargetImport(K.getState(),o.rows,{allowClosed:c});s({...o,report:pv.report});setAsk(!0);return}",
    n: 1,
  },
  {
    what: "part C 5: existing-months note says what replace means now (blank keeps)",
    old: "`${rep.map(m=>V(m)).join(`, `)} — import replaces them completely. Current studios, groups, and numbers for those months will be lost.`",
    new: "`${rep.map(m=>V(m)).join(`, `)} — import replaces their list of studios and groups with the file's. A blank cell keeps the current number; only a value (0 included) changes it. Targets not in the file leave those months.`",
    n: 1,
  },
  {
    what: "part C 5: summary box X changed, Y unchanged, Z blank-kept (+ targets that leave)",
    old: "},ix)})})]}),n&&(0,Q.jsx)(`p`,{className:`mt-3 text-sm`,children:n}),",
    new: "},ix)})})]}),ask&&o&&o.report&&(0,Q.jsxs)(`div`,{\"data-apms-import-summary\":``,className:`mt-3 rounded-md border border-border bg-muted/50 p-3 text-sm`,children:[(0,Q.jsx)(`p`,{className:`font-medium`,children:`Apply this import?`}),(0,Q.jsx)(`p`,{className:`mt-1`,children:`${o.report.changed||0} changed, ${o.report.unchanged||0} unchanged, ${o.report.blankKept||0} blank-kept`}),(o.report.removed||0)>0&&(0,Q.jsx)(`p`,{className:`mt-1 text-xs`,children:`${o.report.removed} target${o.report.removed===1?``:`s`} not in the file will leave ${rep.map(m=>V(m)).join(`, `)}.`}),(0,Q.jsx)(`p`,{className:`mt-1 text-xs text-muted-foreground`,children:`Counts are value cells (M1–M5, actual). A blank cell keeps the current value; only a value (0 included) changes it.`})]}),n&&(0,Q.jsx)(`p`,{className:`mt-3 text-sm`,children:n}),",
    n: 1,
  },
  {
    what: "part C 5: import preview line ended with a stray `}` (\"… Will replace May 2027.}\")",
    old: "confirm to apply the rest.`:`}`}`)",
    new: "confirm to apply the rest.`:``}`)",
    n: 1,
  },
  {
    what: "part C 5: second press is Apply (Apply anyway when rewards stay unmapped)",
    old: "children:ask?(umRows.length?`Apply anyway`:`Replace months`):`Import`",
    new: "children:ask?(umRows.length?`Apply anyway`:`Apply`):`Import`",
    n: 1,
  },
  // ---- 5. TargetsX (bundled src/lib/targets-import.ts): blank keeps ----
  {
    what: "part C 5: TargetsX exports mergeImportRow",
    old: "    applyTargetImport: () => applyTargetImport,\n    cellKey: () => cellKey,",
    new: "    applyTargetImport: () => applyTargetImport,\n    mergeImportRow: () => mergeImportRow,\n    cellKey: () => cellKey,",
    n: 1,
  },
  {
    what: "part C 5: TargetsX parse — blank floors are allowed (checked against the stored value on apply); given floors must go up",
    old: "      if (mode === \"set\") {\n        const ladder = [M1, M2, M3, M4, M5];\n        if (ladder.some((n) => n == null)) {\n          errors.push({ row, message: \"mode=set needs M1\\u2013M5.\" });\n          return;\n        }\n",
    new: "      if (mode === \"set\") {\n        const ladder = [M1, M2, M3, M4, M5].filter((n) => n != null);\n",
    n: 1,
  },
  {
    what: "part C 5: TargetsX mergeImportRow (blank = keep stored value; counts changed / unchanged / blank-kept)",
    old: "  function emptyLadder() {\n    return { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0 };\n  }\n",
    new: [
      "  function emptyLadder() {",
      "    return { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0 };",
      "  }",
      "  var RUNGS = [\"M1\", \"M2\", \"M3\", \"M4\", \"M5\"];",
      "  function mergeImportRow(r, prev) {",
      "    const counts = { changed: 0, unchanged: 0, blankKept: 0 };",
      "    const count = (v, old) => {",
      "      if (v == null) {",
      "        if (prev && old != null) counts.blankKept++;",
      "        else counts.unchanged++;",
      "      } else if (prev && old === v) counts.unchanged++;",
      "      else counts.changed++;",
      "    };",
      "    const prevLadder = prev && prev.ladder || null;",
      "    let ladder;",
      "    let error;",
      "    if (r.mode === \"set\") {",
      "      const out = emptyLadder();",
      "      let missing = false;",
      "      for (const k of RUNGS) {",
      "        const v = r[k];",
      "        const old = prevLadder ? prevLadder[k] : void 0;",
      "        count(v, old);",
      "        if (v != null) out[k] = v;",
      "        else if (old != null) out[k] = old;",
      "        else missing = true;",
      "      }",
      "      ladder = out;",
      "      if (missing) error = \"mode=set needs M1\\u2013M5 (a blank keeps the current value; this target has none).\";",
      "      else {",
      "        for (let i = 1; i < RUNGS.length; i++) {",
      "          if (out[RUNGS[i]] <= out[RUNGS[i - 1]]) {",
      "            error = \"M1\\u2013M5 must each be higher than the one before (blank cells keep the current value).\";",
      "            break;",
      "          }",
      "        }",
      "      }",
      "    } else {",
      "      ladder = prevLadder ? { ...emptyLadder(), ...prevLadder } : emptyLadder();",
      "    }",
      "    const oldActual = prev ? prev.actual : void 0;",
      "    count(r.actual, oldActual);",
      "    const actual = r.actual != null ? r.actual : oldActual != null ? oldActual : null;",
      "    return { ladder, actual, error, counts };",
      "  }",
      "",
    ].join("\n"),
    n: 1,
  },
  {
    what: "part C 5: TargetsX apply — keep the stored cells (before the month is cleared) and the counters",
    old: "    const status = { ...state.targetMonthStatus || {} };\n    const errors = [];\n",
    new: "    const status = { ...state.targetMonthStatus || {} };\n    const errors = [];\n    const prevCells = state.targetCells || {};\n    const merged = /* @__PURE__ */ new Map();\n    let changed = 0;\n    let unchanged = 0;\n    let blankKept = 0;\n",
    n: 1,
  },
  {
    what: "part C 5: TargetsX apply — merge each row with the stored cell first; a row that cannot be completed is refused before the month is touched",
    old: "          skipped++;\n          continue;\n        }\n      }\n    }\n    const usable = rows.filter((r) => !errors.some((e) => e.row === r.row));\n    const wipeMonths",
    new: [
      "          skipped++;",
      "          continue;",
      "        }",
      "      }",
      "      const org0 = r.brand_or_sbu ? findOrg(r.brand_or_sbu, state) : null;",
      "      const scope0 = org0 && org0 !== \"missing\" ? org0 : { sbuId: null };",
      "      const hit0 = findReusableNode(nodes, r.kind, r.name, scope0.sbuId, r.unit);",
      "      const m0 = mergeImportRow(r, hit0 ? prevCells[cellKey(hit0.id, r.month)] : void 0);",
      "      if (m0.error) {",
      "        errors.push({ row: r.row, message: m0.error });",
      "        skipped++;",
      "        continue;",
      "      }",
      "      merged.set(r.row, m0);",
      "    }",
      "    const usable = rows.filter((r) => !errors.some((e) => e.row === r.row));",
      "    const wipeMonths",
    ].join("\n"),
    n: 1,
  },
  {
    what: "part C 5: TargetsX apply — cell = merged ladder / actual (blank kept)",
    old: "      const had = !!cells[key];\n      const ladder = r.mode === \"set\" ? { M1: r.M1 || 0, M2: r.M2 || 0, M3: r.M3 || 0, M4: r.M4 || 0, M5: r.M5 || 0 } : cells[key]?.ladder || emptyLadder();\n      cells[key] = {\n        nodeId: node.id,\n        month: r.month,\n        ladder,\n        actual: r.mode === \"roll\" ? cells[key]?.actual ?? r.actual : r.actual,\n",
    new: "      const had = !!prevCells[key];\n      const mr = merged.get(r.row) || mergeImportRow(r, prevCells[key]);\n      changed += mr.counts.changed;\n      unchanged += mr.counts.unchanged;\n      blankKept += mr.counts.blankKept;\n      cells[key] = {\n        nodeId: node.id,\n        month: r.month,\n        ladder: mr.ladder,\n        actual: mr.actual,\n",
    n: 1,
  },
  {
    what: "part C 5: TargetsX apply — count targets that leave a replaced month",
    old: "    const usedIds = usedNodeIdsForMonths(cells, members, root, wipeMonths);\n",
    new: "    const usedIds = usedNodeIdsForMonths(cells, members, root, wipeMonths);\n    let removed = 0;\n    for (const [key, c] of Object.entries(prevCells)) {\n      const month = c && (c.month || key.slice(key.lastIndexOf(\"::\") + 2));\n      if (c && wipeMonths.includes(month) && !usedIds.has(c.nodeId)) removed++;\n    }\n",
    n: 1,
  },
  {
    what: "part C 5: TargetsX report carries changed / unchanged / blankKept / removed",
    old: "        needsConfirm: unmapped.length > 0,\n        errors\n",
    new: "        needsConfirm: unmapped.length > 0,\n        changed,\n        unchanged,\n        blankKept,\n        removed,\n        errors\n",
    n: 1,
  },
];

/** Fires `apms-target-made` after a create (id + months), for the relink offer. */
const TMADE_FN =
  "function __tmade(r,m){try{r&&r.ok&&r.id&&typeof window<`u`&&setTimeout(()=>{try{window.dispatchEvent(new CustomEvent(`apms-target-made`,{detail:{id:r.id,months:[...(m||[])]}}))}catch{}},0)}catch{}return r}";

/** login-view chunk (edited in place): [{ what, old, new, n }]. */
export const TARGETS_LOGIN_FIXES = [
  {
    what: "part C 3: __tmade helper (create → apms-target-made event)",
    old: "function targetMonthBlocked(e,t){",
    new: TMADE_FN + "function targetMonthBlocked(e,t){",
    n: 1,
  },
  {
    what: "part C 3: addTargetLeaf (same name → same node) announces the create",
    old: "targetMembers:(e.targetMembers||[]).filter(n=>!o.includes(n.month)||n.memberId!==l.id)}}),{ok:!0,id:l.id}}",
    new: "targetMembers:(e.targetMembers||[]).filter(n=>!o.includes(n.month)||n.memberId!==l.id)}}),__tmade({ok:!0,id:l.id},o)}",
    n: 1,
  },
  {
    what: "part C 3: addTargetLeaf (new node) announces the create",
    old: "targetRootOrder:t}}),{ok:!0,id:u}},placeOrgTarget:",
    new: "targetRootOrder:t}}),__tmade({ok:!0,id:u},o)},placeOrgTarget:",
    n: 1,
  },
  {
    what: "part C 3: placeOrgTarget (Brand or SBU) announces the create",
    old: "targetRootOrder:t}}),{ok:!0,id:p}},setTargetOrgScope:",
    new: "targetRootOrder:t}}),__tmade({ok:!0,id:p},a)},setTargetOrgScope:",
    n: 1,
  },
  {
    what: "part C 3: addTargetGroup announces the create",
    old: "targetRootOrder:t}}),{ok:!0,id:u}},addTargetMetric:",
    new: "targetRootOrder:t}}),__tmade({ok:!0,id:u},o)},addTargetMetric:",
    n: 1,
  },
];
