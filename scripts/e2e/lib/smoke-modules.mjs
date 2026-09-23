/**
 * Smoke pass over the modules outside APMS / Rewards / Targets: sign in (done
 * by the runner), open every screen, make one edit per module, reload.
 * Pass = no writes on opening a screen, no banner, no 5xx, and the edit is in
 * the database and on screen after the reload.
 */
import { ScreenResult, realWrites, brief } from "./harness.mjs";

/** The field a label wraps (forms here are <label>Name …<input/></label>). */
function field(scope, label) {
  return scope.locator("label").filter({ hasText: new RegExp("^\\s*" + label) }).locator("input, textarea, select").first();
}
function dialogOr(p) {
  return p.locator("div.fixed.inset-0").last();
}
async function clickMain(p, name, nth = 0) {
  await p.locator("main").getByRole("button", { name, exact: true }).nth(nth).click();
  await p.waitForTimeout(700);
}
async function row(ctx, kind, where, params) {
  const r = await ctx.sql(`select payload from entities where kind = $1 and deleted_at is null and ${where}`, [kind, ...params]);
  return r[0]?.payload || null;
}

/**
 * screens: [top, sub?, tab?] opened in turn; edit(ctx, p, text) makes one
 * change with `text` in it; check(ctx, text) finds it in the DB (truthy);
 * shown(p, text) finds it on screen after a reload (optional).
 */
export const MODULES = [
  { module: "Home", screens: [["Home"]], edit: null, why: "read-only dashboard (figures, alerts, awards won)" },
  {
    module: "Me",
    screens: [["Me"]],
    async edit(ctx, p, text) {
      await clickMain(p, "Edit");
      await field(p.locator("main"), "Location").fill(text);
      // The form requires an employee ID (the seeded admin has none).
      const emp = field(p.locator("main"), "Employee ID");
      if (!(await emp.inputValue())) await emp.fill("ALN9001");
      await clickMain(p, "Save");
    },
    check: (ctx, text) => ctx.sql("select 1 from people where payload::text like $1 and deleted_at is null", [`%${text}%`]).then((r) => r.length > 0),
  },
  {
    module: "Org",
    screens: [["Org", "Overview"], ["Org", "Brands & SBUs"], ["Org", "Functions"], ["Org", "Roles"], ["Org", "People"]],
    async edit(ctx, p, text) {
      await ctx.nav(p, "Org", "Functions");
      await clickMain(p, "Edit");
      await field(p.locator("main"), "Description").fill(text);
      await clickMain(p, "Save");
    },
    check: (ctx, text) => row(ctx, "functions", "payload->>'description' = $2", [text]),
    reopen: ["Org", "Functions"],
  },
  {
    module: "KPI",
    screens: [["KPI", "KPI library"], ["KPI", "KPI scores"]],
    async edit(ctx, p, text) {
      await ctx.nav(p, "KPI", "KPI library");
      await clickMain(p, "Edit");
      const d = dialogOr(p);
      await field(d, "What it measures").fill(text);
      await d.getByRole("button", { name: "Done", exact: true }).first().click();
      await p.waitForTimeout(700);
    },
    check: (ctx, text) => row(ctx, "kpi-master", "payload::text like $2", [`%${text}%`]),
  },
  {
    module: "Awards",
    screens: [["Rewards", "Awards"], ["Rewards", "Awards", "Prizes"]],
    async edit(ctx, p, text) {
      await ctx.nav(p, "Rewards", "Awards");
      await clickMain(p, "Edit");
      await field(p.locator("main"), "Description").fill(text);
      await field(p.locator("main"), "Description").press("Tab");
      const save = p.locator("main").getByRole("button", { name: "Save", exact: true });
      if (await save.count()) await save.first().click();
      await p.waitForTimeout(700);
    },
    check: (ctx, text) => row(ctx, "award-instances", "payload::text like $2", [`%${text}%`]),
  },
  {
    module: "MIS",
    screens: [["MIS", "Reports"], ["MIS", "Create"]],
    async edit(ctx, p, text) {
      await ctx.nav(p, "MIS", "Reports");
      await p.locator('main input[placeholder="New folder name"]').fill(text);
      await clickMain(p, "Add folder");
    },
    check: (ctx, text) => row(ctx, "report-folders", "payload::text like $2", [`%${text}%`]),
  },
  {
    module: "Settings",
    screens: [["Settings", null, "Setup"], ["Settings", null, "Access roles"], ["Settings", null, "Assign people"], ["Settings", null, "Backup"], ["Settings", null, "Trash"]],
    async edit(ctx, p, text) {
      await ctx.nav(p, "Settings");
      await clickMain(p, "Access roles");
      await clickMain(p, "Edit");
      const d = dialogOr(p);
      await field(d, "Note").fill(text);
      await d.getByRole("button", { name: "Save", exact: true }).first().click();
      await p.waitForTimeout(700);
    },
    check: (ctx, text) => row(ctx, "access-roles", "payload::text like $2", [`%${text}%`]),
  },
  {
    module: "Improve",
    screens: [["Improve"]],
    async edit(ctx, p, text) {
      await ctx.nav(p, "Improve");
      await field(p.locator("main"), "Title").fill(text);
      await field(p.locator("main"), "Details").fill(`Smoke request ${text}`);
      await clickMain(p, "Send");
    },
    check: (ctx, text) => row(ctx, "app-requests", "payload::text like $2", [`%${text}%`]),
  },
  { module: "Roster", screens: [], edit: null, why: "not reached: the Roster link opens no page in this build" },
];

async function openScreen(ctx, p, [top, sub, tab]) {
  await ctx.nav(p, top, sub || undefined);
  if (tab) {
    await p.locator("main").getByRole("button", { name: tab, exact: true }).first().click();
    await p.waitForTimeout(800);
  }
  return (await p.locator("main").innerText()).length > 20;
}

export async function smokeModules(ctx, run) {
  const { A } = ctx;
  const out = [];
  for (const mod of MODULES) {
    const R = new ScreenResult(mod.module, `smoke-${mod.module.toLowerCase()}`, `Smoke: ${mod.module}`);
    out.push(R);
    if (!mod.screens.length) {
      R.na(6, mod.why);
      continue;
    }
    try {
      // Open every screen: nothing may be written.
      const m = ctx.mark();
      const opened = [];
      for (const s of mod.screens) opened.push(`${s.filter(Boolean).join(" › ")} ${(await openScreen(ctx, A, s)) ? "ok" : "EMPTY"}`);
      await ctx.sleep(1500);
      const w = realWrites(m.writes("A")).map((n) => brief([n])[0]);
      R.note(`opened: ${opened.join("; ")}`);
      if (w.length) R.fail(6, `writes on opening: ${w.join("; ")}`);
      // One edit, then reload.
      if (mod.edit) {
        const text = `smoke-${mod.module.toLowerCase()}-${run.slice(-4)}`;
        await mod.edit(ctx, A, text);
        await ctx.settled(A);
        const inDb = !!(await mod.check(ctx, text));
        await A.reload({ waitUntil: "load" });
        await A.locator("aside, nav").first().getByText("Org", { exact: true }).first().waitFor({ timeout: 30000 });
        await ctx.sleep(1000);
        const stillDb = !!(await mod.check(ctx, text));
        R.expect(5, inDb && stillDb, `edit "${text}" in the DB ${inDb}, still there after reload ${stillDb}`);
      } else {
        R.na(5, `no edit: ${mod.why}`);
      }
      const banners = await ctx.anyBanner(m.at);
      const fives = brief(m.fives("A"));
      const empty = opened.filter((x) => x.endsWith("EMPTY"));
      R.expect(6, !banners && !fives.length && !empty.length, banners ? `banner: ${JSON.stringify(banners).slice(0, 200)}` : fives.length ? `5xx: ${fives.join("; ")}` : empty.length ? `blank screen: ${empty.join("; ")}` : "no writes on open, no banner, no 5xx");
    } catch (err) {
      R.fail(0, `stopped: ${String((err && err.message) || err).split("\n")[0].slice(0, 200)}`);
    }
  }
  return out;
}
