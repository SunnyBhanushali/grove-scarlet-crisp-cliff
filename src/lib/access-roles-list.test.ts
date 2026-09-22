import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(
  new URL("../../public/assets/routes-e2g7y5q8-13m-p0ar.js", import.meta.url),
  "utf8",
);

test("Access roles list does not show the built-in power-set cheat sheet", () => {
  assert.equal(routes.includes("What each power set can do"), false);
  assert.equal(routes.includes("Create access role"), true);
  assert.equal(routes.includes("Edit access role"), true);
});

test("create/edit access role still has the module grant grid", () => {
  assert.equal(routes.includes("function bp({onClose:e,roleId:t})"), true);
  assert.match(routes, /children:`Module`/);
  assert.match(routes, /\[`View`,`Create`,`Edit`,`Delete`\]/);
});

test("people-row marks use real paint colors, not missing Tailwind classes", () => {
  const i = routes.indexOf("function MrHint");
  assert.ok(i > 0);
  const body = routes.slice(i, i + 3500);
  assert.equal(body.includes("#2563eb"), true);
  assert.equal(body.includes("#E25A3C"), true);
  assert.equal(body.includes("apms-mr"), true);
  assert.equal(body.includes("apms-mgr-sq"), true);
  assert.equal(body.includes("apms-mgr-dot"), true);
  assert.equal(routes.includes("hasManyReports"), false);
  assert.equal(body.includes("if(!isDualPerson(e))return null"), true);
});

test("My team Reports to sits on the people-count line, not a separate card", () => {
  const i = routes.indexOf("function TmBar");
  assert.ok(i > 0);
  const body = routes.slice(i, routes.indexOf("function Bu({name:e,shared:t})", i));
  assert.equal(body.includes("rounded-xl border border-border bg-card"), false);
  assert.equal(body.includes(" · Reports to "), true);
  assert.equal(body.includes("#2563eb"), true);
  assert.equal(body.includes("#E25A3C"), true);
  assert.equal(routes.includes("t?(0,Q.jsx)(TmBar,{viewer:t}):null]"), true);
});

test("People view tabs stay visible when filters are collapsed", () => {
  assert.equal(
    routes.includes(
      "]}):null,(0,Q.jsxs)(`div`,{className:`mt-3 flex flex-wrap gap-2`,children:[e.hasAccessFlag(`people_list`)&&(0,Q.jsx)(z,{size:`sm`,variant:v===`list`",
    ),
    true,
  );
  assert.equal(routes.includes("children:`My team`"), true);
  assert.equal(routes.includes("children:`Company`"), true);
  assert.equal(routes.includes("children:`SBU`"), true);
  assert.equal(routes.includes("children:`Function`"), true);
});

test("Org sidebar opens the People tab, not Overview", () => {
  assert.equal(routes.includes("m(`org`,`org-people`)"), true);
  assert.equal(routes.includes("m(`org`,`org`)"), false);
  assert.equal(routes.includes("go:()=>e.setView(`org-people`)"), true);
});

test("person file remounts when opening another person from Team", () => {
  assert.equal(routes.includes("key:n.id,person:n,onDone:()=>a(!1)"), true);
  assert.equal(routes.includes("key:n.id,person:n,onEdit:()=>a(!0)"), true);
  assert.equal(routes.includes("},[n&&n.id]"), true);
});

test("notification badge drops only for glanced items", () => {
  assert.equal(routes.includes("apms-glanced-v1:"), true);
  assert.equal(routes.includes("openN.filter(n=>!gl.has(n.id))"), true);
  assert.equal(routes.includes("glance([t.id])"), true);
  assert.equal(routes.includes("IntersectionObserver"), true);
});

test("sidebar brand is the lockup logo, not Aliens APMS text", () => {
  assert.equal(routes.includes("/aliens-logo.png"), true);
  assert.equal(routes.includes("function Brand("), true);
  assert.equal(routes.includes("apms-logo"), true);
  assert.equal(routes.includes("children:`Aliens APMS`"), false);
});

test("header logo is capped to a small bar height", () => {
  const css = readFileSync(new URL("../../public/assets/apms-brand.css", import.meta.url), "utf8");
  assert.equal(css.includes("max-height: 28px"), true);
  assert.equal(css.includes("max-width: 140px"), true);
  assert.equal(routes.includes("apms-brand"), true);
});
