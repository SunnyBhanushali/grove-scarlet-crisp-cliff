import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import {
  applyTargetImport,
  describeUnmapped,
  parseCsv,
  parseMoney,
  parseMonth,
  parseXlsx,
} from "./targets-import.ts";

const inflate = (d: Uint8Array) => inflateRawSync(d);

describe("targets import parse", () => {
  it("reads rupees with cr/l and month shapes", () => {
    assert.equal(parseMoney("1.5cr"), 15000000);
    assert.equal(parseMoney("₹24,000,000"), 24000000);
    assert.equal(parseMonth("2026-04"), "2026-04");
    assert.equal(parseMonth("2026/4"), "2026-04");
  });

  it("parses the dummy template xlsx", async () => {
    const buf = readFileSync(new URL("../../public/targets-template.xlsx", import.meta.url));
    const { rows, errors } = await parseXlsx(buf, inflate);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 38);
    const aprilStudios = rows.filter((r) => r.month === "2026-04" && r.kind === "target");
    assert.equal(aprilStudios.length, 15);
    const mumbai = rows.find((r) => r.name === "Mumbai > Bandra" && r.month === "2026-04");
    assert.equal(mumbai?.parent_group, "AT Cluster West");
    assert.equal(mumbai?.mode, "set");
    assert.equal(mumbai?.M1, 24000000);
    const south = rows.find((r) => r.name === "AT Cluster South" && r.month === "2026-04");
    assert.equal(south?.kind, "group");
    assert.equal(south?.mode, "roll");
    assert.equal(south?.parent_group, "Aliens Tattoo India");
    const lila = rows.find((r) => r.name === "LILA" && r.month === "2026-04");
    assert.equal(lila?.parent_group, "");
  });

  it("parses csv with the same columns", () => {
    const { rows, errors } = parseCsv(
      "month,kind,name,unit,parent_group,brand_or_sbu,mode,M1,M2,M3,M4,M5,actual\n2026-04,target,Goa,rupees,,Goa,set,100,200,300,400,500,\n2026-04,group,West,rupees,,,roll,,,,,,\n",
    );
    assert.deepEqual(errors, []);
    assert.equal(rows[0].name, "Goa");
    assert.equal(rows[0].M5, 500);
  });
});

describe("targets import apply", () => {
  it("nests only from parent_group and rolls groups as blank floors", async () => {
    const buf = readFileSync(new URL("../../public/targets-template.xlsx", import.meta.url));
    const { rows, errors } = await parseXlsx(buf, inflate);
    assert.equal(errors.length, 0);
    const seed = JSON.parse(readFileSync(new URL("./company-seed.json", import.meta.url), "utf8"));
    const org = {
      companies: seed.companies,
      brands: seed.brands,
      businessUnits: seed.businessUnits,
    };
    const { state, report } = applyTargetImport(org, rows, { allowClosed: true });
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    const nodes = Object.values(state.targetNodes || {});
    assert.equal(nodes.filter((n) => n.kind === "leaf").length, 15);
    assert.equal(nodes.filter((n) => n.kind === "group").length, 4);
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
    const aprilMembers = (state.targetMembers || []).filter((m) => m.month === "2026-04");
    const childIds = (group: string) =>
      aprilMembers.filter((m) => m.groupId === byName[group].id).map((m) => state.targetNodes![m.memberId].name).sort();
    assert.deepEqual(childIds("AT Cluster South"), ["Bangalore", "Chennai", "Hyderabad.", "Kochi"]);
    assert.ok(childIds("AT Cluster West").includes("Mumbai > Bandra"));
    assert.ok(childIds("AT Cluster West").includes("Ahmedabad"));
    assert.deepEqual(childIds("Aliens Tattoo India"), ["AT Cluster North", "AT Cluster South", "AT Cluster West"]);
    const roots = state.targetRootOrder!["2026-04"];
    assert.ok(roots.includes(byName["LILA"].id));
    assert.ok(roots.includes(byName["Aliens Tattoo India"].id));
    assert.ok(!roots.includes(byName["Mumbai > Bandra"].id));
    assert.equal(byName["Mumbai > Bandra"].sbuId, org.businessUnits.find((u: { name: string }) => u.name === "Mumbai > Bandra").id);
    const westCell = state.targetCells![`${byName["AT Cluster South"].id}::2026-04`];
    assert.equal(westCell.mode, "roll");
    const bang = state.targetCells![`${byName["Bangalore"].id}::2026-04`];
    const chen = state.targetCells![`${byName["Chennai"].id}::2026-04`];
    const hyd = state.targetCells![`${byName["Hyderabad."].id}::2026-04`];
    const kochi = state.targetCells![`${byName["Kochi"].id}::2026-04`];
    assert.equal(
      westCell.ladder.M1,
      (bang.ladder.M1 || 0) + (chen.ladder.M1 || 0) + (hyd.ladder.M1 || 0) + (kochi.ladder.M1 || 0),
    );
    assert.ok(westCell.ladder.M1 > 0);
    const bandra = state.targetCells![`${byName["Mumbai > Bandra"].id}::2026-04`];
    assert.equal(bandra.ladder.M1, 24000000);
    assert.equal(bandra.actual, 25920000);
  });

  it("does not invent a group when parent_group is blank", () => {
    const { state } = applyTargetImport(
      {},
      [
        {
          row: 2,
          month: "2026-04",
          kind: "target",
          name: "Mumbai",
          unit: "rupees",
          parent_group: "",
          brand_or_sbu: "",
          mode: "set",
          M1: 1,
          M2: 2,
          M3: 3,
          M4: 4,
          M5: 5,
          actual: null,
        },
      ],
      { allowClosed: true },
    );
    assert.equal(Object.values(state.targetNodes || {}).length, 1);
    assert.equal((state.targetMembers || []).length, 0);
    assert.deepEqual(state.targetRootOrder!["2026-04"].length, 1);
  });

  it("replaces an existing month instead of appending leftover targets", () => {
    const first = applyTargetImport(
      {},
      [
        {
          row: 2,
          month: "2026-04",
          kind: "target",
          name: "Mumbai",
          unit: "rupees",
          parent_group: "",
          brand_or_sbu: "",
          mode: "set",
          M1: 1,
          M2: 2,
          M3: 3,
          M4: 4,
          M5: 5,
          actual: null,
        },
        {
          row: 3,
          month: "2026-04",
          kind: "target",
          name: "Goa",
          unit: "rupees",
          parent_group: "",
          brand_or_sbu: "",
          mode: "set",
          M1: 1,
          M2: 2,
          M3: 3,
          M4: 4,
          M5: 5,
          actual: null,
        },
      ],
      { allowClosed: true },
    );
    assert.equal(Object.values(first.state.targetNodes || {}).length, 2);
    const second = applyTargetImport(
      first.state,
      [
        {
          row: 2,
          month: "2026-04",
          kind: "target",
          name: "Goa",
          unit: "rupees",
          parent_group: "",
          brand_or_sbu: "",
          mode: "set",
          M1: 10,
          M2: 20,
          M3: 30,
          M4: 40,
          M5: 50,
          actual: 12,
        },
      ],
      { allowClosed: true },
    );
    assert.deepEqual(second.report.replaced, ["2026-04"]);
    const nodes = Object.values(second.state.targetNodes || {});
    const goa = nodes.find((n) => n.name === "Goa")!;
    const mumbai = nodes.find((n) => n.name === "Mumbai")!;
    assert.equal(second.state.targetCells![`${goa.id}::2026-04`].ladder.M1, 10);
    assert.equal(second.state.targetCells![`${mumbai.id}::2026-04`], undefined);
    assert.deepEqual(second.state.targetRootOrder!["2026-04"], [goa.id]);
  });

  it("rolls Cluster > Soumyajit from blank group rows like the April sheet", () => {
    const csv = [
      "month,kind,name,unit,parent_group,brand_or_sbu,mode,M1,M2,M3,M4,M5,actual",
      "2026-04,target,Mumbai > Malad,rupees,Cluster > Soumyajit,,set,5208794,5871763,6534732,7197701,7860670,5399448",
      "2026-04,target,Pune,rupees,Cluster > Soumyajit,,set,2633795,2969021,3304247,3639474,3974700,2252046",
      "2026-04,target,Goa,rupees,Cluster > Soumyajit,,set,1046705,1179928,1313151,1446375,1579598,1117270",
      "2026-04,target,Mumbai > Seawoods,rupees,Cluster > Soumyajit,,set,833818,939944,1046072,1152199,1258327,687771",
      "2026-04,target,Aliens Tattoo School,rupees,,,set,900000,1050000,1200000,1350000,1500000,3132374",
      "2026-04,group,Cluster > Soumyajit,rupees,Aliens Tattoo India,,roll,,,,,,",
      "2026-04,group,Aliens Tattoo India,rupees,,,roll,,,,,,",
    ].join("\n");
    const { rows, errors } = parseCsv(csv);
    assert.deepEqual(errors, []);
    const { state, report } = applyTargetImport({}, rows, { allowClosed: true });
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    const byName = Object.fromEntries(Object.values(state.targetNodes || {}).map((n) => [n.name, n]));
    const soumya = state.targetCells![`${byName["Cluster > Soumyajit"].id}::2026-04`];
    const india = state.targetCells![`${byName["Aliens Tattoo India"].id}::2026-04`];
    const malad = state.targetCells![`${byName["Mumbai > Malad"].id}::2026-04`];
    const pune = state.targetCells![`${byName["Pune"].id}::2026-04`];
    const goa = state.targetCells![`${byName["Goa"].id}::2026-04`];
    const sea = state.targetCells![`${byName["Mumbai > Seawoods"].id}::2026-04`];
    const school = state.targetCells![`${byName["Aliens Tattoo School"].id}::2026-04`];
    assert.equal(soumya.mode, "roll");
    assert.equal(soumya.ladder.M1, malad.ladder.M1 + pune.ladder.M1 + goa.ladder.M1 + sea.ladder.M1);
    assert.equal(
      soumya.actual,
      (malad.actual ?? 0) + (pune.actual ?? 0) + (goa.actual ?? 0) + (sea.actual ?? 0),
    );
    assert.ok(soumya.ladder.M1 > 0);
    assert.equal(india.ladder.M1, soumya.ladder.M1);
    assert.equal(india.actual, soumya.actual);
    assert.equal(school.ladder.M1, 900000);
    const roots = state.targetRootOrder!["2026-04"];
    assert.ok(roots.includes(byName["Aliens Tattoo India"].id));
    assert.ok(roots.includes(byName["Aliens Tattoo School"].id));
    assert.ok(!roots.includes(byName["Mumbai > Malad"].id));
  });
});

function leaf(name: string, month = "2026-04", extra: Record<string, unknown> = {}) {
  return {
    row: 2,
    month,
    kind: "target" as const,
    name,
    unit: "rupees",
    parent_group: "",
    brand_or_sbu: "",
    mode: "set" as const,
    M1: 1,
    M2: 2,
    M3: 3,
    M4: 4,
    M5: 5,
    actual: null,
    ...extra,
  };
}

describe("targets import keeps reward pointers", () => {
  it("reimport same studios reuses targetNodes.id so reward_records still map", () => {
    const first = applyTargetImport({}, [leaf("Goa"), leaf("Mumbai", "2026-04", { row: 3 })], { allowClosed: true });
    const goa = Object.values(first.state.targetNodes || {}).find((n) => n.name === "Goa")!;
    const mumbai = Object.values(first.state.targetNodes || {}).find((n) => n.name === "Mumbai")!;
    const withRewards = {
      ...first.state,
      rewardRecords: {
        "2026-04": {
          p1: { targetNodeId: goa.id },
          p2: { targetNodeId: mumbai.id },
        },
      },
    };
    const second = applyTargetImport(
      withRewards,
      [
        leaf("Goa", "2026-04", { M1: 10, M2: 20, M3: 30, M4: 40, M5: 50 }),
        leaf("Mumbai", "2026-04", { row: 3 }),
      ],
      { allowClosed: true },
    );
    assert.equal(second.report.aborted, false);
    assert.equal(second.report.unmapped, 0);
    assert.equal(second.state.rewardRecords!["2026-04"].p1.targetNodeId, goa.id);
    assert.equal(second.state.rewardRecords!["2026-04"].p2.targetNodeId, mumbai.id);
    assert.equal(second.state.targetNodes![goa.id].name, "Goa");
    assert.ok(second.state.targetCells![`${goa.id}::2026-04`]);
    assert.equal(second.state.targetCells![`${goa.id}::2026-04`].ladder.M1, 10);
  });

  it("lists unmapped rewards and still applies the rest — does not abort", () => {
    const first = applyTargetImport({}, [leaf("Goa"), leaf("Mumbai", "2026-04", { row: 3 })], { allowClosed: true });
    const goa = Object.values(first.state.targetNodes || {}).find((n) => n.name === "Goa")!;
    const mumbai = Object.values(first.state.targetNodes || {}).find((n) => n.name === "Mumbai")!;
    const withRewards = {
      ...first.state,
      rewardRecords: { "2026-04": { p1: { targetNodeId: mumbai.id } } },
    };
    const second = applyTargetImport(withRewards, [leaf("Goa")], { allowClosed: true });
    assert.equal(second.report.aborted, false);
    assert.equal(second.report.needsConfirm, true);
    assert.equal(second.report.unmapped, 1);
    assert.equal(second.report.unmappedRows?.[0].personId, "p1");
    assert.equal(second.report.unmappedRows?.[0].nodeName, "Mumbai");
    assert.equal(second.report.unmappedRows?.[0].period, "2026-04");
    assert.ok(second.state.targetCells![`${goa.id}::2026-04`]);
    assert.equal(second.state.targetCells![`${mumbai.id}::2026-04`], undefined);
    assert.equal(second.state.rewardRecords!["2026-04"].p1.targetNodeId, mumbai.id);
  });

  it("describeUnmapped names the person, period and studio", () => {
    const lines = describeUnmapped(
      [{ kind: "record", period: "2026-04", personId: "p1", nodeId: "n1", nodeName: "Mumbai" }],
      [{ id: "p1", name: "Arjun" }],
    );
    assert.deepEqual(lines, ["Arjun · 2026-04 · Mumbai"]);
  });

  it("remaps reward_records.targetNodeId by name+sbu+metric when ids were not reused", () => {
    const nodes = {
      "new-goa": {
        id: "new-goa",
        name: "Goa",
        kind: "leaf" as const,
        metric: "rupees",
        sbuId: "bu-goa",
        brandId: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "old-goa": {
        id: "old-goa",
        name: "Goa",
        kind: "leaf" as const,
        metric: "rupees",
        sbuId: "bu-goa",
        brandId: "",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const state = {
      businessUnits: [{ id: "bu-goa", name: "Goa" }],
      targetNodes: nodes,
      targetCells: {
        "old-goa::2026-04": {
          nodeId: "old-goa",
          month: "2026-04",
          ladder: { M1: 1, M2: 2, M3: 3, M4: 4, M5: 5 },
          actual: null,
          mode: "set" as const,
          status: "open",
        },
      },
      rewardRecords: { "2026-04": { p1: { targetNodeId: "old-goa" } } },
    };
    const next = applyTargetImport(state, [leaf("Goa", "2026-04", { brand_or_sbu: "Goa" })], { allowClosed: true });
    assert.equal(next.report.aborted, false);
    const mapped = next.state.rewardRecords!["2026-04"].p1.targetNodeId;
    assert.ok(mapped === "new-goa" || mapped === "old-goa");
    assert.ok(next.state.targetCells![`${mapped}::2026-04`]);
    if (mapped === "new-goa") {
      assert.equal(next.report.remapped, 1);
      assert.equal(next.state.rewardRecords!["2026-04"].p1.targetSbuId, "bu-goa");
    }
  });
});
