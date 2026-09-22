/**
 * Stamp p0p: Improve requests can attach screenshots; reviewers can view them.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0o.js"), join(pub, "login-view-f2j6t0x4-11a3-p0p.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0o.js"), join(pub, "routes-e2g7y5q8-13m-p0p.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0o.js"), join(pub, "index-f4j9a7t3-11v-p0p.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0o.js"), join(pub, "login-ChZ1wVZ-p0p.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0p.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0p.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0p.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0p.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0o.js";`,
  `from"./index-f4j9a7t3-11v-p0p.js";`,
  "login-view index import",
);

lv = replaceOnce(
  lv,
  `addAppRequest:({kind:n,title:r,body:i})=>{let a=t(),o=a.people.find(e=>e.id===a.currentUserId);if(!o)return\`\`;let s=new Date().toISOString(),c=\`ar-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,6)}\`,l={id:c,kind:n,title:r.trim(),body:i.trim(),fromId:o.id,status:\`open\`,createdAt:s,updatedAt:s,messages:[]};`,
  `addAppRequest:({kind:n,title:r,body:i,images:imgs})=>{let a=t(),o=a.people.find(e=>e.id===a.currentUserId);if(!o)return\`\`;let s=new Date().toISOString(),c=\`ar-\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,6)}\`,pics=Array.isArray(imgs)?imgs.filter(x=>x&&x.data).slice(0,4).map(x=>({id:x.id,name:x.name||\`screenshot\`,type:x.type||\`image/jpeg\`,data:x.data})): [],l={id:c,kind:n,title:r.trim(),body:i.trim(),fromId:o.id,status:\`open\`,createdAt:s,updatedAt:s,messages:[],images:pics};`,
  "addAppRequest stores images",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0o.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0p.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0o.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0p.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `function Tp(){`,
  `function readImproveImage(file){return new Promise((resolve,reject)=>{if(!file||!String(file.type||"").startsWith("image/")){reject();return}let fail=()=>{let r=new FileReader();r.onload=()=>resolve({id:"im-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,5),name:file.name||"screenshot",type:file.type||"image/png",data:String(r.result||"")});r.onerror=reject;r.readAsDataURL(file)};let url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);try{let max=1600,w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,sc=Math.min(1,max/Math.max(w,h,1)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(w*sc));c.height=Math.max(1,Math.round(h*sc));c.getContext("2d").drawImage(img,0,0,c.width,c.height);resolve({id:"im-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,5),name:file.name||"screenshot.jpg",type:"image/jpeg",data:c.toDataURL("image/jpeg",.72)})}catch(err){fail()}};img.onerror=()=>{URL.revokeObjectURL(url);fail()};img.src=url})}function Tp(){`,
  "readImproveImage helper",
);

rt = replaceOnce(
  rt,
  `[r,i]=(0,Z.useState)(\`feature\`),[a,o]=(0,Z.useState)(\`\`),[s,c]=(0,Z.useState)(\`\`),[l,u]=(0,Z.useState)(\`\`),[d,f]=(0,Z.useState)(\`open\`),[p,m]=(0,Z.useState)(\`\`),`,
  `[r,i]=(0,Z.useState)(\`feature\`),[a,o]=(0,Z.useState)(\`\`),[s,c]=(0,Z.useState)(\`\`),[l,u]=(0,Z.useState)(\`\`),[d,f]=(0,Z.useState)(\`open\`),[p,m]=(0,Z.useState)(\`\`),[imgs,setImgs]=(0,Z.useState)([]),`,
  "Tp images state",
);

rt = replaceOnce(
  rt,
  `function y(){if(!a.trim()||!s.trim())return;let t=e.addAppRequest({kind:r,title:a,body:s});o(\`\`),c(\`\`),u(\`Sent. Admin will see it in Improve.\`),t&&e.setSelectedAppRequest(t),window.setTimeout(()=>u(\`\`),2500)}`,
  `function y(){if(!a.trim()||!s.trim())return;let t=e.addAppRequest({kind:r,title:a,body:s,images:imgs});o(\`\`),c(\`\`),setImgs([]),u(\`Sent. Admin will see it in Improve.\`),t&&e.setSelectedAppRequest(t),window.setTimeout(()=>u(\`\`),2500)}function addShots(files){let list=[...files||[]].filter(f=>String(f.type||"").startsWith("image/")).slice(0,4);if(!list.length)return;Promise.all(list.map(readImproveImage)).then(rows=>setImgs(x=>[...x,...rows].slice(0,4)),()=>{})}`,
  "Tp send + addShots",
);

rt = replaceOnce(
  rt,
  `(0,Q.jsx)(B,{label:\`Details\`,children:(0,Q.jsx)(\`textarea\`,{className:\`\${W} min-h-24 py-2\`,value:s,onChange:e=>c(e.target.value),placeholder:\`What should change, or what went wrong?\`})}),(0,Q.jsxs)(\`div\`,{className:\`flex items-center gap-2\`,children:[(0,Q.jsx)(z,{onClick:y,disabled:!a.trim()||!s.trim(),children:\`Send\`})`,
  `(0,Q.jsx)(B,{label:\`Details\`,children:(0,Q.jsx)(\`textarea\`,{className:\`\${W} min-h-24 py-2\`,value:s,onChange:e=>c(e.target.value),placeholder:\`What should change, or what went wrong?\`,onPaste:e=>{let files=[...(e.clipboardData&&e.clipboardData.files||[])].filter(f=>String(f.type||"").startsWith("image/"));if(!files.length)return;e.preventDefault();addShots(files)}})}),(0,Q.jsxs)(\`div\`,{children:[(0,Q.jsx)(\`div\`,{className:\`text-xs font-medium text-muted-foreground\`,children:\`Screenshots\`}),(0,Q.jsx)(\`p\`,{className:\`mt-0.5 text-[11px] text-muted-foreground\`,children:\`Up to 4. Paste a screenshot into details, or add a file.\`}),(0,Q.jsx)(\`input\`,{id:\`improve-shots\`,type:\`file\`,accept:\`image/*\`,multiple:!0,className:\`hidden\`,onChange:e=>{addShots(e.target.files),e.target.value=\`\`}}),(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,className:\`mt-2\`,onClick:()=>{let el=document.getElementById(\`improve-shots\`);el&&el.click()},children:\`Add image\`}),imgs.length?(0,Q.jsx)(\`div\`,{className:\`improve-thumbs\`,children:imgs.map(im=>(0,Q.jsxs)(\`div\`,{className:\`improve-thumb\`,children:[(0,Q.jsx)(\`img\`,{src:im.data,alt:im.name||\`Screenshot\`}),(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`improve-thumb-x\`,"aria-label":\`Remove\`,onClick:()=>setImgs(x=>x.filter(t=>t.id!==im.id)),children:\`×\`})]},im.id))}):null]}),(0,Q.jsxs)(\`div\`,{className:\`flex items-center gap-2\`,children:[(0,Q.jsx)(z,{onClick:y,disabled:!a.trim()||!s.trim(),children:\`Send\`})`,
  "Tp screenshot field",
);

rt = replaceOnce(
  rt,
  `function Ep({row:e,staff:t,meId:n,reply:r,setReply:i,people:a,onReply:o,onResolve:s}){let c=e=>a.find(t=>t.id===e)?.name||\`Someone\`;return(0,Q.jsxs)(\`div\`,{className:\`border-t border-border bg-muted/20 px-4 py-3\`,children:[(0,Q.jsx)(\`p\`,{className:\`whitespace-pre-wrap text-sm\`,children:e.body}),(e.messages||[]).length>0&&`,
  `function Ep({row:e,staff:t,meId:n,reply:r,setReply:i,people:a,onReply:o,onResolve:s}){let[open,setOpen]=(0,Z.useState)(null);let c=e=>a.find(t=>t.id===e)?.name||\`Someone\`;return(0,Q.jsxs)(\`div\`,{className:\`border-t border-border bg-muted/20 px-4 py-3\`,children:[(0,Q.jsx)(\`p\`,{className:\`whitespace-pre-wrap text-sm\`,children:e.body}),(e.images||[]).length?(0,Q.jsx)(\`div\`,{className:\`improve-thumbs\`,children:e.images.map(im=>(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`improve-thumb\`,title:im.name||\`Screenshot\`,onClick:()=>setOpen(im),children:(0,Q.jsx)(\`img\`,{src:im.data,alt:im.name||\`Screenshot\`})},im.id))}):null,(e.messages||[]).length>0&&`,
  "Ep image thumbs",
);

rt = replaceOnce(
  rt,
  `t&&(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:s,children:\`Mark resolved\`})]})]})]})}function Dp(`,
  `t&&(0,Q.jsx)(z,{size:\`sm\`,variant:\`outline\`,onClick:s,children:\`Mark resolved\`})]})]}),open?(0,Q.jsxs)(\`div\`,{className:\`improve-lightbox\`,onClick:()=>setOpen(null),role:\`dialog\`,"aria-modal":!0,children:[(0,Q.jsx)(\`img\`,{className:\`improve-lightbox-img\`,src:open.data,alt:open.name||\`Screenshot\`,onClick:e=>e.stopPropagation()}),(0,Q.jsx)(\`button\`,{type:\`button\`,className:\`improve-lightbox-close\`,onClick:e=>{e.stopPropagation(),setOpen(null)},children:\`Close\`})]}):null]})}function Dp(`,
  "Ep lightbox",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0o.js", "routes-e2g7y5q8-13m-p0p.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0o.js", "login-ChZ1wVZ-p0p.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0o.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0p.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0o.js"`,
  `from"./index-f4j9a7t3-11v-p0p.js"`,
  "login-ChZ index",
);

must(lv.includes("images:pics"), "addAppRequest images missing");
must(rt.includes("readImproveImage"), "reader missing");
must(rt.includes("Add image"), "add image button missing");
must(rt.includes("improve-lightbox"), "lightbox missing");
must(rt.includes("e.images||[]"), "review thumbs missing");

writeBoth("login-view-f2j6t0x4-11a3-p0p.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0p.js", rt);
writeBoth("index-f4j9a7t3-11v-p0p.js", idx);
writeBoth("login-ChZ1wVZ-p0p.js", login);

const cssExtra = `
/* Improve: screenshot thumbs + lightbox */
.improve-thumbs { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.5rem; }
.improve-thumb {
  position: relative;
  width: 5.5rem; height: 5.5rem;
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--border, rgba(255,255,255,.12));
  padding: 0; margin: 0;
  background: transparent;
  cursor: zoom-in;
}
.improve-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.improve-thumb-x {
  position:absolute; top:3px; right:3px;
  width:1.25rem; height:1.25rem; border-radius:999px;
  background: rgba(0,0,0,.72); color:#fff; border:0; cursor:pointer;
  font-size:14px; line-height:1.25rem; padding:0;
}
.improve-lightbox {
  position: fixed; inset: 0; z-index: 300;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.72); padding: 1.5rem;
}
.improve-lightbox-img {
  max-width: min(1100px, 92vw);
  max-height: min(86vh, 900px);
  object-fit: contain;
  border-radius: 0.5rem;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
}
.improve-lightbox-close {
  position: absolute; top: 1rem; right: 1rem;
  height: 2rem; padding: 0 0.75rem;
  border-radius: 0.5rem; border: 1px solid rgba(255,255,255,.2);
  background: rgba(0,0,0,.55); color: #fff; cursor: pointer;
}
`;

for (const p of [
  join(root, "public/assets/form-controls.css"),
  join(root, "recovered-site/assets/form-controls.css"),
  join(root, "dist/client/assets/form-controls.css"),
]) {
  try {
    let css = readFileSync(p, "utf8");
    if (!css.includes(".improve-thumbs")) css += cssExtra;
    writeFileSync(p, css);
  } catch {
    /* dist optional */
  }
}

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0o.js").join("index-f4j9a7t3-11v-p0p.js");
  html = html.split("routes-e2g7y5q8-13m-p0o.js").join("routes-e2g7y5q8-13m-p0p.js");
  html = html.split("apms-sync.js?v=p0o1").join("apms-sync.js?v=p0p1");
  html = html.split("form-controls.css?v=p0o1").join("form-controls.css?v=p0p1");
  html = html.split('href="/assets/form-controls.css"').join('href="/assets/form-controls.css?v=p0p1"');
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

console.log("p0p stamp ok", { lv: lv.length, rt: rt.length });
