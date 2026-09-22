/**
 * Stamp p0k: group M1–M5 roll-ups survive Lock / Close plan.
 *
 * Root cause: lockTarget snapshots live uu().ladder, then setTargetCell
 * overwrites snapshot.ladder with the stored cell ladder. Roll groups
 * keep empty floors in the cell (import leaves them blank; live uu sums
 * children). After lock + month ended, uu reads the empty snapshot, so
 * floors/score vanish while actuals still live-sum.
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

copyFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0j.js"), join(pub, "login-view-f2j6t0x4-11a3-p0k.js"));
copyFileSync(join(pub, "routes-e2g7y5q8-13m-p0j.js"), join(pub, "routes-e2g7y5q8-13m-p0k.js"));
copyFileSync(join(pub, "index-f4j9a7t3-11v-p0j.js"), join(pub, "index-f4j9a7t3-11v-p0k.js"));
copyFileSync(join(pub, "login-ChZ1wVZ-p0j.js"), join(pub, "login-ChZ1wVZ-p0k.js"));

let lv = readFileSync(join(pub, "login-view-f2j6t0x4-11a3-p0k.js"), "utf8");
let rt = readFileSync(join(pub, "routes-e2g7y5q8-13m-p0k.js"), "utf8");
let idx = readFileSync(join(pub, "index-f4j9a7t3-11v-p0k.js"), "utf8");
let login = readFileSync(join(pub, "login-ChZ1wVZ-p0k.js"), "utf8");

lv = replaceOnce(
  lv,
  `from"./index-f4j9a7t3-11v-p0j.js";`,
  `from"./index-f4j9a7t3-11v-p0k.js";`,
  "login-view index import",
);

const uuOld = `function uu(e,t,n,r,i,a=[]){let o={ladder:ms(),actual:null,mode:\`set\`,status:\`open\`,rolledLadder:ms(),rolledActual:null};if(!e[r]||a.includes(r)||a.length>8)return o;let s=n[Y(r,i)];if(s?.status===\`locked\`&&s.snapshot&&wl(i)){let c=nu(t,r,i),l=c.map(o=>uu(e,t,n,o,i,[...a,r])),f=s.mode||(c.length?\`roll\`:\`set\`),d=c.length?(l.every(e=>e.actual==null)?null:l.reduce((e,t)=>e+(t.actual||0),0)):null,live=s.actual??s.snapshot.actual??null;return{ladder:s.snapshot.ladder||ms(),actual:c.length&&f===\`roll\`?(s.actual??d):live,mode:f,status:\`locked\`,rolledLadder:s.snapshot.ladder||ms(),rolledActual:d??live}}let c=nu(t,r,i),l=c.map(o=>uu(e,t,n,o,i,[...a,r])),u=c.length?l.reduce((e,t)=>{let L=t.ladder||ms();return{M1:e.M1+L.M1,M2:e.M2+L.M2,M3:e.M3+L.M3,M4:e.M4+L.M4,M5:e.M5+L.M5}},ms()):s?.ladder||ms(),d=c.length?l.every(e=>e.actual==null)?null:l.reduce((e,t)=>e+(t.actual||0),0):s?.actual??null,f=s?.mode||(c.length?\`roll\`:\`set\`),p=f===\`set\`&&s?.ladder?s.ladder:u;return f===\`set\`&&c.length&&s?.actual,{ladder:p,actual:c.length&&f===\`roll\`?d:s?.actual??d,mode:f,status:s?.status||\`open\`,rolledLadder:u,rolledActual:d}}`;

const uuNew = `function uu(e,t,n,r,i,a=[]){let o={ladder:ms(),actual:null,mode:\`set\`,status:\`open\`,rolledLadder:ms(),rolledActual:null};if(!e[r]||a.includes(r)||a.length>8)return o;let s=n[Y(r,i)],nL=e=>{let v=Number(e);return Number.isFinite(v)?v:0},sumL=(e,t)=>{t=t||ms();return{M1:e.M1+nL(t.M1),M2:e.M2+nL(t.M2),M3:e.M3+nL(t.M3),M4:e.M4+nL(t.M4),M5:e.M5+nL(t.M5)}},nz=e=>!!(e&&(nL(e.M1)||nL(e.M2)||nL(e.M3)||nL(e.M4)||nL(e.M5))),c=nu(t,r,i),l=c.map(o=>uu(e,t,n,o,i,[...a,r])),u=c.length?l.reduce((e,t)=>sumL(e,t.ladder),ms()):s?.ladder||ms(),d=c.length?l.every(e=>e.actual==null)?null:l.reduce((e,t)=>e+nL(t.actual),0):s?.actual??null,f=s?.mode||(c.length?\`roll\`:\`set\`),locked=s?.status===\`locked\`&&s.snapshot&&wl(i),snap=s?.snapshot?.ladder,p=f===\`roll\`&&c.length?(nz(u)?u:nz(snap)?snap:u):f===\`set\`&&s?.ladder?s.ladder:u;if(locked&&!(f===\`roll\`&&c.length))p=nz(snap)?snap:p;let actual=c.length&&f===\`roll\`?d:s?.actual??d;if(locked&&!(c.length&&f===\`roll\`))actual=s.actual??s.snapshot.actual??actual;return{ladder:p,actual,mode:f,status:s?.status||(locked?\`locked\`:\`open\`),rolledLadder:u,rolledActual:d}}`;

lv = replaceOnce(lv, uuOld, uuNew, "uu live-sum roll groups after lock");

lv = replaceOnce(
  lv,
  `t().setTargetCell(e,n,{status:\`locked\`,snapshot:{memberIds:a,ladder:{...i.ladder},actual:i.actual,at:new Date().toISOString(),by:o?.id||\`\`}},\`Locked\`,!0)}`,
  `t().setTargetCell(e,n,{status:\`locked\`,ladder:{...i.ladder},actual:i.actual,snapshot:{memberIds:a,ladder:{...i.ladder},actual:i.actual,at:new Date().toISOString(),by:o?.id||\`\`}},\`Locked\`,!0)}`,
  "lockTarget persist rolled ladder",
);

lv = replaceOnce(
  lv,
  `if(m.snapshot)m={...m,snapshot:{...m.snapshot,ladder:{...(m.ladder||m.snapshot.ladder)},actual:m.actual,at:new Date().toISOString()}};`,
  `if(m.snapshot){let sl=i.snapshot&&i.snapshot.ladder,cl=m.ladder,pick=e=>e&&(Number(e.M1)||Number(e.M2)||Number(e.M3)||Number(e.M4)||Number(e.M5));m={...m,snapshot:{...m.snapshot,ladder:{...(pick(sl)||pick(cl)||sl||cl||ms())},actual:m.actual??(i.snapshot&&i.snapshot.actual),at:new Date().toISOString()}}}`,
  "setTargetCell keep non-empty snapshot ladder",
);

rt = replaceOnce(
  rt,
  `from"./login-view-f2j6t0x4-11a3-p0j.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0k.js"`,
  "routes import login-view",
);
rt = replaceOnce(
  rt,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0j.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  `d=(m.f||(m.f=["assets/login-view-f2j6t0x4-11a3-p0k.js","assets/react-SIfiwpqq.js","assets/noop-preload.js"]))`,
  "routes mapDeps",
);

rt = replaceOnce(
  rt,
  `E=Lt(C.ladder,C.actual)`,
  `E=Lt((C.mode===\`roll\`&&C.rolledLadder&&(C.rolledLadder.M1||C.rolledLadder.M2)?C.rolledLadder:C.ladder)||C.ladder,C.actual)`,
  "score uses rolled ladder",
);

rt = replaceOnce(
  rt,
  `od,{ladder:C.ladder,rung:n+1}`,
  `od,{ladder:(C.mode===\`roll\`&&C.rolledLadder&&(C.rolledLadder.M1||C.rolledLadder.M2)?C.rolledLadder:C.ladder)||C.ladder,rung:n+1}`,
  "floor % uses rolled ladder",
);

rt = replaceOnce(
  rt,
  `value:C.ladder[t]||null`,
  `value:(C.ladder[t]||C.rolledLadder&&C.rolledLadder[t])||null`,
  "floor input uses rolled ladder",
);

rt = replaceOnce(
  rt,
  `onClick:()=>d.setTargetCell(e.id,t,{mode:C.mode===\`roll\`?\`set\`:\`roll\`})`,
  `onClick:()=>d.setTargetCell(e.id,t,C.mode===\`roll\`?{mode:\`set\`,ladder:{...(C.rolledLadder&&(C.rolledLadder.M1||C.rolledLadder.M2)?C.rolledLadder:C.ladder)}}:{mode:\`roll\`})`,
  "switch to set copies rolled floors",
);

idx = replaceAllCount(idx, "routes-e2g7y5q8-13m-p0j.js", "routes-e2g7y5q8-13m-p0k.js", 2, "index routes");
idx = replaceAllCount(idx, "login-ChZ1wVZ-p0j.js", "login-ChZ1wVZ-p0k.js", 2, "index login");

login = replaceOnce(
  login,
  `from"./login-view-f2j6t0x4-11a3-p0j.js"`,
  `from"./login-view-f2j6t0x4-11a3-p0k.js"`,
  "login-ChZ login-view",
);
login = replaceOnce(
  login,
  `from"./index-f4j9a7t3-11v-p0j.js"`,
  `from"./index-f4j9a7t3-11v-p0k.js"`,
  "login-ChZ index",
);

must(!lv.includes("rolledLadder:s.snapshot.ladder||ms()"), "old locked snapshot ladder still in uu");
must(lv.includes("f===`roll`&&c.length"), "new uu roll live-sum missing");
must(lv.includes("ladder:{...i.ladder},actual:i.actual,snapshot:"), "lockTarget ladder persist missing");

writeBoth("login-view-f2j6t0x4-11a3-p0k.js", lv);
writeBoth("routes-e2g7y5q8-13m-p0k.js", rt);
writeBoth("index-f4j9a7t3-11v-p0k.js", idx);
writeBoth("login-ChZ1wVZ-p0k.js", login);

function stampHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.split("index-f4j9a7t3-11v-p0j.js").join("index-f4j9a7t3-11v-p0k.js");
  html = html.split("routes-e2g7y5q8-13m-p0j.js").join("routes-e2g7y5q8-13m-p0k.js");
  html = html.split("apms-sync.js?v=p0j1").join("apms-sync.js?v=p0k1");
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

console.log("p0k stamp ok", { lv: lv.length, rt: rt.length, idx: idx.length });
