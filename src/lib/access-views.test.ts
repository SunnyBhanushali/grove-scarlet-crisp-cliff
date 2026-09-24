import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const login = readFileSync(
  new URL("../../public/assets/login-view-f2j6t0x4-11a3-p0ar.js", import.meta.url),
  "utf8",
);
const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const sync = readFileSync(new URL("../../public/assets/apms-sync.js", import.meta.url), "utf8");

const VIEW_FLAGS = [
  "mass_rewards",
  "mass_people",
  "people_list",
  "people_my",
  "people_company",
  "people_sbu",
  "people_function",
  "people_summary",
] as const;

const MONTH_FLAGS = ["month_actuals", "changelog", "lock_rewards", "lock_apms"] as const;

function loadPack() {
  const start = login.indexOf("var ACCESS_MODULES=");
  const end = login.indexOf("function roleOfPerson");
  assert.ok(start > 0 && end > start);
  const src = login.slice(start, end);
  const fn = new Function(`${src}; return { ACCESS_FLAGS, packForBase, overlayPack, flagSet };`);
  return fn() as {
    ACCESS_FLAGS: { id: string; label: string }[];
    packForBase: (base: string) => { flags: Record<string, boolean>; scope: string };
    overlayPack: (role: {
      base?: string;
      flags?: Record<string, boolean>;
    }) => { flags: Record<string, boolean> };
  };
}

test("ACCESS_FLAGS lists mass update and people-view options", () => {
  for (const id of VIEW_FLAGS) {
    assert.equal(login.includes(`id:\`${id}\``), true, id);
    assert.equal(routes.includes(`id:\`${id}\``), true, `editor ${id}`);
  }
  assert.match(login, /label:`Mass update · Rewards`/);
  assert.match(login, /label:`People view · My team`/);
  assert.match(routes, /function bp\(\{onClose:e,roleId:t\}\)/);
});

test("ACCESS_FLAGS lists month actuals, changelog, lock & close", () => {
  for (const id of MONTH_FLAGS) {
    assert.equal(login.includes(`id:\`${id}\``), true, id);
    assert.equal(routes.includes(`id:\`${id}\``), true, `editor ${id}`);
  }
  assert.match(login, /label:`Fill monthly actuals`/);
  assert.match(login, /label:`See change log`/);
  assert.match(login, /label:`Lock & close · Rewards`/);
  assert.match(login, /label:`Lock & close · APMS`/);
});

test("builtin packs keep current buttons until an editor unchecks them", () => {
  const { packForBase, overlayPack, ACCESS_FLAGS } = loadPack();
  const ids = ACCESS_FLAGS.map((f) => f.id);
  for (const id of VIEW_FLAGS) assert.equal(ids.includes(id), true, id);
  assert.deepEqual(ids.slice(-4), [...MONTH_FLAGS]);

  const sa = packForBase("super_admin");
  for (const id of [...VIEW_FLAGS, ...MONTH_FLAGS]) assert.equal(sa.flags[id], true, `sa ${id}`);

  const admin = packForBase("admin");
  for (const id of [...VIEW_FLAGS, ...MONTH_FLAGS]) assert.equal(admin.flags[id], true, `admin ${id}`);
  assert.equal(admin.flags.frozen_edit, false);

  const hr = packForBase("hr");
  for (const id of [...VIEW_FLAGS, ...MONTH_FLAGS]) assert.equal(hr.flags[id], true, `hr ${id}`);

  const fh = packForBase("function_head");
  assert.equal(fh.flags.mass_rewards, true);
  assert.equal(fh.flags.mass_people, false);
  assert.equal(fh.flags.people_my, true);
  assert.equal(fh.flags.people_summary, true);
  assert.equal(fh.flags.month_actuals, true);
  assert.equal(fh.flags.lock_rewards, true);
  assert.equal(fh.flags.lock_apms, true);
  assert.equal(fh.flags.changelog, false);

  const mgr = packForBase("manager");
  assert.equal(mgr.flags.mass_rewards, true);
  assert.equal(mgr.flags.mass_people, false);
  assert.equal(mgr.flags.people_list, true);
  assert.equal(mgr.flags.month_actuals, true);
  assert.equal(mgr.flags.lock_rewards, true);
  assert.equal(mgr.flags.lock_apms, true);
  assert.equal(mgr.flags.changelog, false);

  const emp = packForBase("employee");
  for (const id of [...VIEW_FLAGS, ...MONTH_FLAGS]) assert.equal(emp.flags[id], false, `emp ${id}`);

  const savedMgr = overlayPack({ base: "manager", flags: { approve: true } });
  assert.equal(savedMgr.flags.people_list, true);
  assert.equal(savedMgr.flags.mass_rewards, true);
  assert.equal(savedMgr.flags.mass_people, false);
  assert.equal(savedMgr.flags.month_actuals, true);
  assert.equal(savedMgr.flags.changelog, false);

  const off = overlayPack({
    base: "admin",
    flags: { people_list: false, mass_people: false, month_actuals: false, changelog: false },
  });
  assert.equal(off.flags.people_list, false);
  assert.equal(off.flags.mass_people, false);
  assert.equal(off.flags.month_actuals, false);
  assert.equal(off.flags.changelog, false);
  assert.equal(off.flags.people_my, true);
});

test("Rewards and People Mass update are gated by access flags", () => {
  assert.match(
    routes,
    /i\.kind===`rewards`&&t&&i\.hasAccessFlag\(`mass_rewards`\)&&\(0,Q\.jsx\)\(z,\{size:`sm`,variant:`outline`,disabled:massOn===r/,
  );
  assert.match(
    routes,
    /U\(t\)&&!w&&e\.hasAccessFlag\(`mass_people`\)&&\(0,Q\.jsx\)\(z,\{size:`sm`,variant:`outline`,className:`ml-auto`/,
  );
  assert.match(routes, /canMass:t&&massOn===r/);
  assert.equal(routes.includes("children:[`Field`"), false);
});

test("People List / My team / SBU / Company / Function / Summary are gated by flags", () => {
  for (const id of [
    "people_list",
    "people_my",
    "people_company",
    "people_sbu",
    "people_function",
    "people_summary",
  ]) {
    assert.equal(routes.includes(`e.hasAccessFlag(\`${id}\`)&&(0,Q.jsx)(z,{size:\`sm\``), true, id);
  }
  assert.equal(
    routes.includes(
      "n&&(0,Q.jsx)(z,{size:`sm`,variant:v===`summary`?`default`:`outline`,onClick:()=>y(`summary`),children:`Summary`})",
    ),
    false,
  );
  assert.match(routes, /st\.hasAccessFlag\(`people_\$\{id\}`\)/);
  assert.match(routes, /if\(!e\.hasAccessFlag\(`people_\$\{v\}`\)\)/);
});

test("Achieved is a value when the viewer cannot write monthly actuals", () => {
  assert.match(routes, /"data-actuals":`1`/);
  assert.match(routes, /"data-actuals":`ro`/);
  assert.match(login, /score=o&&hasAccessFlag\(e,`month_actuals`\)/);
  assert.match(routes, /e\.hasAccessFlag\(`month_actuals`\)/);
  assert.equal(routes.includes("disabled:!n,value:e.kpi.achieved??``"), false);
});

test("Change log and lock/close are Extra flags", () => {
  assert.match(
    routes,
    /e\.hasAccessFlag\(`changelog`\)&&\(0,Q\.jsx\)\(z,\{size:`icon`,variant:`outline`,title:`Change log`/,
  );
  assert.match(routes, /e\.hasAccessFlag\(g\?`lock_rewards`:`lock_apms`\)/);
  assert.match(
    routes,
    /T===`plan_open`&&\(0,Q\.jsx\)\(z,\{onClick:\(\)=>te\(`plan_locked`\),children:`Lock plan`\}/,
  );
});

test("the person can write Self comments while the plan is open or locked", () => {
  assert.match(
    routes,
    /canEditSelf:!_&&!!y&&y\.id===b\?\.id&&\(T===`plan_open`\|\|T===`plan_locked`\|\|!!e\.editUnlock\)/,
  );
  assert.equal(routes.includes("canEditSelf:!_&&!!y&&y.id===b?.id&&zi(T)"), false);
  assert.match(routes, /"data-self-notes":`1`/);
  assert.match(routes, /"data-self-notes":`ro`/);
  assert.match(routes, /"data-mgr-notes":`ro`/);
});

test("stamp p0as81 (on p0as80); fallbackPost still absent; G9 path kept", () => {
  assert.match(html, /routes-e2g7y5q8-13m-p0as81\.js/);
  assert.match(html, /apms-collections\.js\?v=p0as81/);
  assert.match(html, /apms-sync\.js\?v=p0as81/);
  assert.match(routes, /login-view-f2j6t0x4-11a3-p0ar\.js\?v=p0as68/);
  assert.equal(login.includes("fallbackPost"), false);
  assert.equal(routes.includes("fallbackPost"), false);
  assert.equal(sync.includes("fallbackPost"), false);
  assert.equal(sync.includes("p0as60"), true);
  assert.equal(routes.includes("function Virt("), true);
});

test("p0as78 routes: a live (book pull) apply clears its own dirty flag so later row applies are taken", () => {
  const stamped = readFileSync(new URL("../../public/assets/routes-e2g7y5q8-13m-p0as78.js", import.meta.url), "utf8");
  assert.equal(stamped.split("let ok=h(t,`live`);D.current=!1;").length - 1, 3);
  assert.equal(stamped.split("h(t,`live`),D.current=!1,").length - 1, 1);
  assert.equal(stamped.includes("let ok=h(t,`live`);setTimeout("), false, "no live apply left without the reset");
  assert.equal(stamped.split("window.__apmsSync.pickDataFields(t)").length - 1, 3);
  assert.equal(stamped.includes("function _(){D.current=!0;l.current&&("), true, "edits during an apply window still schedule a save");
});

test("p0as80 routes: a live-entity (feed) apply clears the dirty flag its own setState raised", () => {
  const stamped = readFileSync(new URL("../../public/assets/routes-e2g7y5q8-13m-p0as80.js", import.meta.url), "utf8");
  const base = readFileSync(new URL("../../public/assets/routes-e2g7y5q8-13m-p0as78.js", import.meta.url), "utf8");
  assert.equal(stamped.split("notebookUpdatedAt:t.notebookUpdatedAt}));D.current=!1;p.current&&(clearTimeout(p.current),p.current=0);return!0}").length - 1, 3);
  assert.equal(stamped.split("let ok=h(t,`live`);D.current=!1;").length - 1, 3, "p0as78 live apply reset kept");
  assert.equal(stamped.split("getSnapshot:()=>K.getState().exportSnapshot(),stateRef:()=>K.getState(),").length - 1, 4, "live hooks expose the store state");
  assert.equal(stamped.includes("onBlur:()=>{setF(!1);let t=G(i);a(ld(t,r)),t!==e&&i!==F0.current&&n(t)}"), true, "a value commits only what was typed since focus");
  assert.equal(stamped.includes("title:`Edit`,onClick:()=>{a(e.name),r(!0)}"), true, "target tab rename starts from the current name");
  assert.equal(stamped.split("login-view-f2j6t0x4-11a3-p0ar.js?v=p0as80").length - 1, 2, "routes load the fixed login-view chunk");
  assert.equal(login.includes("customReports:e.customReports||[],reportFolders:e.reportFolders||[],notices:e.notices,"), true, "exportSnapshot carries MIS report folders");
  assert.equal(
    stamped.length - base.length,
    3 * "D.current=!1;p.current&&(clearTimeout(p.current),p.current=0);".length +
      4 * "stateRef:()=>K.getState(),".length +
      "let F0=(0,Z.useRef)(null);".length +
      ",F0.current=ld(e,r)".length +
      "&&i!==F0.current".length +
      "{a(e.name),}".length +
      ("return(0,Z.useEffect)(()=>{if(F&&i!==F0.current)return;let v=ld(e,r);a(v),F&&(F0.current=v)},[e,r,F])".length -
        "return(0,Z.useEffect)(()=>{F||a(ld(e,r))},[e,r,F])".length),
    "nothing else changed",
  );
  const index = readFileSync(new URL("../../public/assets/index-f4j9a7t3-11v-p0ar.js", import.meta.url), "utf8");
  assert.equal(index.includes("routes-e2g7y5q8-13m-p0as81.js"), true);
  assert.equal(index.includes("routes-e2g7y5q8-13m-p0as78.js"), false);
});

test("p0as81 routes (BATCH-2): restore apply, access-role Save sends only changes, setupDone saved, backup list live", async () => {
  const { stampRoutes } = await import("../../scripts/stamp-p0as81-batch2.mjs");
  const base = readFileSync(new URL("../../public/assets/routes-e2g7y5q8-13m-p0as80.js", import.meta.url), "utf8");
  const stamped = readFileSync(new URL("../../public/assets/routes-e2g7y5q8-13m-p0as81.js", import.meta.url), "utf8");
  assert.equal(stamped, stampRoutes(base), "p0as81 = p0as80 + the batch-2 stamp, nothing else");
  assert.equal(stamped.split("apply:(t,reason)=>{if(reason===`restore`){").length - 1, 3, "every live hook takes a restore");
  assert.equal(stamped.includes("n.patchAccessRole(r.id,{name:i.trim(),base:o,note:c,scope:sc,grants:g,flags:fl})"), false, "Save no longer sends the whole role");
  assert.equal(stamped.includes("Object.keys(d).length&&n.patchAccessRole(r.id,d)"), true);
  assert.equal(stamped.includes("`tombstones`,`setupDone`,`companyFactor`])"), true, "setupDone triggers a save");
  assert.equal(stamped.includes("setInterval(async()=>{try{let e=await fetch(`/api/company-backups`"), true, "backup list re-reads");
});
