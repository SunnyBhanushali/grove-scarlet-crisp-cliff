import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  applyRewardImport,
  parseCsv,
  parseStatus,
  parseWeight,
  parseXlsx,
} from "./rewards-import.ts";

const inflate = (d: Uint8Array) => inflateRawSync(d);

const header =
  "month,email,name,status,unlock_against,kra,kra_weight,kpi,parent_kpi,kpi_weight,unit,target,floor,achieved,lower_is_better,notes";

describe("rewards import parse", () => {
  it("reads percent weights and status aliases", () => {
    assert.equal(parseWeight("40%"), 0.4);
    assert.equal(parseWeight("0.3"), 0.3);
    assert.equal(parseWeight("25"), 0.25);
    assert.equal(parseStatus("locked"), "plan_locked");
    assert.equal(parseStatus(""), "plan_open");
  });

  it("parses csv rows including nested kpis", () => {
    const { rows, errors } = parseCsv(
      `${header}\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Revenue Delivery,0.4,All Studios Revenue vs Target,,0.45,%,100,60,104,no,\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Revenue Delivery,0.4,Hit Rate,,0.3,%,85,51,,no,\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Revenue Delivery,0.4,Studio Hit Rate,Hit Rate,0.6,%,85,51,88,no,\n`,
    );
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 3);
    assert.equal(rows[2].parent_kpi, "Hit Rate");
    assert.equal(rows[0].achieved, 104);
  });

  it("parses the dummy template xlsx", async () => {
    const buf = readFileSync("/workspace/public/rewards-template.xlsx");
    const { rows, errors } = await parseXlsx(buf, inflate);
    assert.deepEqual(errors, []);
    assert.ok(rows.length >= 10);
    assert.ok(rows.some((r) => r.parent_kpi === "Hit Rate (Studios + Clusters)"));
    assert.ok(rows.some((r) => r.month === "2026-05"));
  });
});

describe("rewards import apply", () => {
  it("builds kra/kpi trees and unlocks against a named target", () => {
    const { rows } = parseCsv(
      `${header}\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Revenue Delivery,40,All Studios Revenue vs Target,,45,%,100,60,104,,,\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Revenue Delivery,40,Hit Rate (Studios + Clusters),,30,%,85,51,,,,\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Revenue Delivery,40,Studio Hit Rate,Hit Rate (Studios + Clusters),60,%,85,51,88,,,\n2026-04,vishal@alienstattoos.com,Vishal Kumar,open,Bangalore,Studio Profitability,25,EBITDA vs Plan,,100,%,100,60,92,,,\n2026-05,uday.pati@aliens.local,Uday Patil,open,Mumbai > Bandra,Yield & Conversion,100,Consult to tattoo,,100,%,70,42,68,,,\n`,
    );
    const { state, report } = applyRewardImport(
      {
        people: [
          { id: "p-v", name: "Vishal Kumar", email: "vishal@alienstattoos.com" },
          { id: "p-u", name: "Uday Patil", email: "uday.pati@aliens.local" },
        ],
        targetNodes: {
          "tn-blr": { id: "tn-blr", name: "Bangalore" },
          "tn-ban": { id: "tn-ban", name: "Mumbai > Bandra" },
        },
        rewardRecords: {},
        months: [],
      },
      rows,
    );
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(report.created, 2);
    const april = state.rewardRecords!["2026-04"]["p-v"];
    assert.equal(april.targetNodeId, "tn-blr");
    assert.equal(april.kras.length, 2);
    assert.equal(april.kras[0].weight, 0.4);
    const hit = april.kras[0].kpis.find((k) => k.name === "Hit Rate (Studios + Clusters)");
    assert.ok(hit);
    assert.equal(hit!.children.length, 1);
    assert.equal(hit!.children[0].name, "Studio Hit Rate");
    assert.equal(hit!.children[0].achieved, 88);
    assert.deepEqual(state.months, ["2026-04", "2026-05"]);
  });

  it("errors when the person is missing", () => {
    const { rows } = parseCsv(`${header}\n2026-04,nobody@aliens.local,Nobody,open,,,,,,,%,100,,,,,\n`);
    const { report } = applyRewardImport({ people: [], rewardRecords: {} }, rows);
    assert.equal(report.created, 0);
    assert.ok(report.errors[0].message.includes("No person"));
  });
});
