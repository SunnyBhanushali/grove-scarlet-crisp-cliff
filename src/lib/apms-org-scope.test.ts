import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountableSbuSet,
  companyAccess,
  effectiveAchieved,
  filterDescendantIds,
  isDirectBridge,
  kpiScopeChip,
  linkedSbuActual,
  patchAddPersonToSbu,
  patchRemovePersonFromSbu,
  groupNoticesByKey,
  siblingNoticeIds,
  collapseOpenNotices,
  noticeGroupKey,
  empAlertDuplicatesNotice,
  empAlertKeyForNotice,
  personSbuIds,
  pickerHomeBuId,
  sitsOnSbu,
  scopedTeamIds,
  leaderScopeLabel,
  nestPeopleByPrimary,
  nestPeopleInSection,
  peopleOnSbu,
  peopleInFunction,
  peopleWithTeams,
  teamLabel,
  stampSharedAchieved,
  type NoticeLike,
  type OrgPerson,
} from "./apms-org-scope.ts";

const MALAD = "bu-malad";
const BANDRA = "bu-bandra";

const sarvajeet: OrgPerson = {
  id: "p-sarvajeet",
  name: "Sarvajeet",
  access: "manager",
  buId: MALAD,
  managerId: "p-ceo",
};
const deepa: OrgPerson = {
  id: "p-deepa",
  name: "Deepa",
  access: "manager",
  buId: BANDRA,
  managerId: "p-ceo",
};
const vishal: OrgPerson = {
  id: "p-vishal",
  name: "Vishal",
  access: "manager",
  buId: MALAD,
  buIds: [MALAD, BANDRA],
  managerId: "p-sarvajeet",
  dottedLine: [{ managerId: "p-deepa" }],
};
const malad = (n: number): OrgPerson => ({
  id: `p-malad-${n}`,
  name: `Malad ${n}`,
  access: "employee",
  buId: MALAD,
  managerId: "p-vishal",
});
const bandra = (n: number): OrgPerson => ({
  id: `p-bandra-${n}`,
  name: `Bandra ${n}`,
  access: "employee",
  buId: BANDRA,
  managerId: "p-vishal",
});
const admin: OrgPerson = { id: "p-admin", name: "Admin", access: "admin" };

const people: OrgPerson[] = [
  sarvajeet,
  deepa,
  vishal,
  ...[1, 2, 3, 4, 5, 6, 7].map(malad),
  ...[1, 2, 3, 4, 5, 6, 7].map(bandra),
];

const allIds = new Set(people.map((p) => p.id));

function names(ids: Iterable<string>) {
  const byId = new Map(people.map((p) => [p.id, p.name]));
  return [...ids].map((id) => byId.get(id)).sort();
}

describe("person SBU ids", () => {
  it("unions home and extras", () => {
    assert.deepEqual(personSbuIds(vishal).sort(), [BANDRA, MALAD].sort());
    assert.deepEqual(personSbuIds(sarvajeet), [MALAD]);
  });

  it("blank person sits on no studio — brand does not count", () => {
    const p: OrgPerson = { id: "p-new", name: "New" };
    assert.deepEqual(personSbuIds(p), []);
    assert.equal(sitsOnSbu(p, "bu-bangalore"), false);
    assert.equal(sitsOnSbu({ ...p, buId: "" }, MALAD), false);
  });
});

describe("SBU seat — no Bangalore dump", () => {
  const DELHI = "bu-delhi";
  const BANGALORE = "bu-bangalore";

  it("create stays blank until a studio is picked", () => {
    assert.equal(pickerHomeBuId({ buIds: [], prevBuId: "" }), "");
    assert.equal(pickerHomeBuId({ buIds: [BANGALORE, DELHI], prevBuId: "" }), "");
    assert.equal(pickerHomeBuId({ buIds: [DELHI], prevBuId: "" }), DELHI);
  });

  it("Make primary wins while that studio stays ticked", () => {
    assert.equal(
      pickerHomeBuId({ buIds: [BANGALORE, DELHI], prevBuId: DELHI, primaryId: BANGALORE }),
      BANGALORE,
    );
    assert.equal(
      pickerHomeBuId({ buIds: [DELHI], prevBuId: DELHI, primaryId: BANGALORE }),
      DELHI,
    );
  });

  it("keeps home if it is still ticked; does not promote buIds[0]", () => {
    assert.equal(
      pickerHomeBuId({ buIds: [BANGALORE, DELHI], prevBuId: DELHI }),
      DELHI,
    );
    assert.equal(pickerHomeBuId({ buIds: [BANGALORE], prevBuId: DELHI }), "");
  });

  it("add from an SBU page: blank home takes that studio", () => {
    assert.deepEqual(patchAddPersonToSbu({ buId: "", buIds: [] }, DELHI), {
      buId: DELHI,
      buIds: [DELHI],
    });
  });

  it("remove from an SBU page: home goes blank, extras stay, no promote", () => {
    assert.deepEqual(
      patchRemovePersonFromSbu({ buId: DELHI, buIds: [DELHI] }, DELHI),
      { buId: "", buIds: [] },
    );
    assert.deepEqual(
      patchRemovePersonFromSbu({ buId: DELHI, buIds: [DELHI, BANGALORE] }, DELHI),
      { buId: "", buIds: [BANGALORE] },
    );
    assert.deepEqual(
      patchRemovePersonFromSbu({ buId: BANGALORE, buIds: [BANGALORE, DELHI] }, DELHI),
      { buId: BANGALORE, buIds: [BANGALORE] },
    );
  });

  it("after remove they do not sit on Bangalore unless it remained an extra", () => {
    const gone: OrgPerson = {
      id: "p-gone",
      ...patchRemovePersonFromSbu({ buId: DELHI, buIds: [DELHI] }, DELHI),
    };
    assert.equal(sitsOnSbu(gone, DELHI), false);
    assert.equal(sitsOnSbu(gone, BANGALORE), false);
  });
});

describe("spanning captain people tree", () => {
  it("Sarvajeet is accountable only for Malad, not Vishal's extra Bandra", () => {
    const acc = accountableSbuSet(sarvajeet, people);
    assert.equal(acc.has(MALAD), true);
    assert.equal(acc.has(BANDRA), false);
  });

  it("Vishal is accountable for Malad and Bandra", () => {
    const acc = accountableSbuSet(vishal, people);
    assert.equal(acc.has(MALAD), true);
    assert.equal(acc.has(BANDRA), true);
  });

  it("dotted Vishal does not donate Malad to Deepa", () => {
    const acc = accountableSbuSet(deepa, people);
    assert.equal(acc.has(BANDRA), true);
    assert.equal(acc.has(MALAD), false);
  });

  it("Vishal is a bridge for both SMs", () => {
    assert.equal(isDirectBridge(vishal, sarvajeet.id), true);
    assert.equal(isDirectBridge(vishal, deepa.id), true);
    assert.equal(isDirectBridge(malad(1), sarvajeet.id), false);
  });

  it("Sarvajeet sees Vishal + 7 Malad, not Bandra", () => {
    const kept = filterDescendantIds(people, sarvajeet, allIds);
    assert.equal(kept.has("p-vishal"), true);
    assert.equal(kept.has("p-malad-1"), true);
    assert.equal(kept.has("p-bandra-1"), false);
    assert.equal(
      [...kept].filter((id) => id.startsWith("p-malad-")).length,
      7,
    );
    assert.equal(
      [...kept].filter((id) => id.startsWith("p-bandra-")).length,
      0,
    );
  });

  it("Deepa sees Vishal + 7 Bandra, not Malad", () => {
    const kept = filterDescendantIds(people, deepa, allIds);
    assert.equal(kept.has("p-vishal"), true);
    assert.equal(kept.has("p-bandra-1"), true);
    assert.equal(kept.has("p-malad-1"), false);
    assert.equal(
      [...kept].filter((id) => id.startsWith("p-bandra-")).length,
      7,
    );
  });

  it("Vishal sees all 14", () => {
    const kept = filterDescendantIds(people, vishal, allIds);
    assert.equal(
      [...kept].filter((id) => id.startsWith("p-malad-") || id.startsWith("p-bandra-"))
        .length,
      14,
    );
  });

  it("direct with empty SBU still shows as a bridge", () => {
    const seedCaptain: OrgPerson = {
      id: "p-seed",
      name: "Seed captain",
      managerId: sarvajeet.id,
      buId: null,
    };
    const kept = filterDescendantIds(
      [...people, seedCaptain],
      sarvajeet,
      new Set(["p-seed", "p-bandra-1"]),
    );
    assert.equal(kept.has("p-seed"), true);
    assert.equal(kept.has("p-bandra-1"), false);
  });

  it("admin helper still flags company access", () => {
    assert.equal(companyAccess(admin), true);
    assert.equal(companyAccess(sarvajeet), false);
  });

  it("names for the worked picture", () => {
    const kept = filterDescendantIds(people, sarvajeet, allIds);
    assert.deepEqual(
      names(kept).filter((n) => n === "Vishal" || String(n).startsWith("Malad")),
      ["Malad 1", "Malad 2", "Malad 3", "Malad 4", "Malad 5", "Malad 6", "Malad 7", "Vishal"],
    );
  });
});

describe("scoped team — never widen", () => {
  const ART = "fn-artistry";
  const OPS = "fn-ops";
  const SCHOOL = "bu-school";
  const functions = [
    { id: ART, name: "Artistry" },
    { id: OPS, name: "Operations - ATS" },
  ];
  const units = [
    { id: MALAD, name: "Mumbai > Malad" },
    { id: BANDRA, name: "Mumbai > Bandra" },
    { id: SCHOOL, name: "Aliens Tattoo School" },
  ];
  const allan: OrgPerson = {
    id: "p-allan",
    name: "Allan",
    access: "function_head",
    functionId: ART,
  };
  const siddhesh: OrgPerson = {
    id: "p-siddhesh",
    name: "Siddhesh",
    access: "employee",
    functionId: ART,
    buId: MALAD,
    managerId: "p-allan",
  };
  const tushar: OrgPerson = {
    id: "p-tushar",
    name: "Tushar",
    access: "employee",
    functionId: OPS,
    buId: SCHOOL,
    dottedLine: [{ managerId: "p-allan" }],
  };
  const dhruv: OrgPerson = {
    id: "p-dhruv",
    name: "Dhruv",
    access: "employee",
    functionId: OPS,
    buId: SCHOOL,
    managerId: "p-tushar",
  };
  const bebo: OrgPerson = {
    id: "p-bebo",
    name: "Bebo",
    access: "employee",
    functionId: ART,
    buId: SCHOOL,
    managerId: "p-tushar",
  };
  const artVishal: OrgPerson = {
    ...vishal,
    access: "employee",
    functionId: ART,
    dottedLine: [{ managerId: "p-deepa" }, { managerId: "p-siddhesh" }],
  };
  const maladArt = (n: number): OrgPerson => ({
    ...malad(n),
    functionId: ART,
  });
  const bandraArt = (n: number): OrgPerson => ({
    ...bandra(n),
    functionId: ART,
  });
  const org: OrgPerson[] = [
    allan,
    siddhesh,
    tushar,
    dhruv,
    bebo,
    { ...sarvajeet },
    { ...deepa },
    artVishal,
    ...[1, 2, 3, 4, 5, 6, 7].map(maladArt),
    ...[1, 2, 3, 4, 5, 6, 7].map(bandraArt),
  ];

  it("Sarvajeet (Malad SM) sees Vishal + 7 Malad, not Bandra", () => {
    const kept = scopedTeamIds(org, sarvajeet, functions, units);
    assert.equal(kept.has("p-vishal"), true);
    assert.equal(kept.has("p-malad-1"), true);
    assert.equal(kept.has("p-bandra-1"), false);
    assert.equal([...kept].filter((id) => id.startsWith("p-malad-")).length, 7);
    assert.equal([...kept].filter((id) => id.startsWith("p-bandra-")).length, 0);
  });

  it("Allan (DOA) sees both studios through Siddhesh, and Tushar's whole team", () => {
    const kept = scopedTeamIds(org, allan, functions, units);
    assert.equal(kept.has("p-siddhesh"), true);
    assert.equal(kept.has("p-vishal"), true);
    assert.equal(kept.has("p-malad-1"), true);
    assert.equal(kept.has("p-bandra-1"), true);
    assert.equal([...kept].filter((id) => id.startsWith("p-malad-") || id.startsWith("p-bandra-")).length, 14);
    assert.equal(kept.has("p-tushar"), true);
    assert.equal(kept.has("p-bebo"), true);
    assert.equal(kept.has("p-dhruv"), true);
    assert.equal(kept.has("p-sarvajeet"), false);
    const { kids } = nestPeopleInSection(org.filter((p) => kept.has(p.id)));
    assert.equal(kids("p-tushar").some((p) => p.id === "p-dhruv"), true);
    assert.equal(kids("p-tushar").some((p) => p.id === "p-bebo"), true);
  });

  it("scope labels name the cut, not the whole company", () => {
    assert.equal(
      leaderScopeLabel(sarvajeet, org, functions, units),
      "Mumbai > Malad · All functions",
    );
    assert.equal(leaderScopeLabel(allan, org, functions, units), "all studios · Artistry");
  });

  it("Company tree: Vishal once, under Sarvajeet, with both studios of primary reports", () => {
    const { roots, kids } = nestPeopleByPrimary(org);
    assert.equal(roots.some((p) => p.id === "p-vishal"), false);
    assert.equal(kids("p-sarvajeet").some((p) => p.id === "p-vishal"), true);
    assert.equal(kids("p-vishal").length, 14);
  });

  it("SBU tree: Malad has 7 artists, Bandra has 7, Vishal in both", () => {
    const maladPeople = peopleOnSbu(org, MALAD);
    const bandraPeople = peopleOnSbu(org, BANDRA);
    assert.equal(maladPeople.filter((p) => p.id.startsWith("p-malad-")).length, 7);
    assert.equal(bandraPeople.filter((p) => p.id.startsWith("p-bandra-")).length, 7);
    assert.equal(maladPeople.some((p) => p.id === "p-vishal"), true);
    assert.equal(bandraPeople.some((p) => p.id === "p-vishal"), true);
  });

  it("Function tree: Vishal under Siddhesh, Dhruv not in Artistry", () => {
    const art = peopleInFunction(org, ART);
    const { kids, roots } = nestPeopleInSection(art);
    assert.equal(kids("p-siddhesh").some((p) => p.id === "p-vishal"), true);
    assert.equal(art.some((p) => p.id === "p-dhruv"), false);
    assert.equal(art.some((p) => p.id === "p-bebo"), true);
    assert.equal(roots.some((p) => p.id === "p-allan"), true);
  });
});

describe("KPI scope chip and linked studio actual", () => {
  it("hides the chip on a personal KPI", () => {
    assert.equal(kpiScopeChip({ scope: "individual" }), null);
    assert.equal(kpiScopeChip({}), null);
  });

  it("reads SBU · Malad, not a private copy", () => {
    const chip = kpiScopeChip({
      scope: "sbu",
      scopeId: MALAD,
      scopeLabel: "Malad",
    });
    assert.equal(chip?.label, "SBU · Malad");
    assert.equal(chip?.tone, "studio");
  });

  it("does not steal the SBU revenue cell for a score KPI", () => {
    const kpi = {
      name: "Tattoo Art Score",
      scope: "sbu" as const,
      scopeId: MALAD,
      achieved: 4.5,
    };
    const state = {
      currentMonth: "2026-09",
      targetNodes: {
        "tn-malad": { id: "tn-malad", name: "Malad", sbuId: MALAD },
      },
      targetCells: {
        "tn-malad::2026-09": { actual: 695540 },
      },
    };
    assert.equal(linkedSbuActual(kpi, state), null);
    assert.equal(effectiveAchieved(kpi, state), 4.5);
  });

  it("falls back to the person's number when there is no cell", () => {
    const kpi = { scope: "individual" as const, achieved: 7 };
    assert.equal(effectiveAchieved(kpi, { currentMonth: "2026-09" }), 7);
  });

  it("names a team from the full name", () => {
    assert.equal(teamLabel({ firstName: "Vishal", name: "Vishal Kumar" }), "Vishal Kumar's team");
    assert.equal(teamLabel({ name: "Sarvajeet Kaur" }), "Sarvajeet Kaur's team");
    assert.equal(teamLabel({ firstName: "Nikhil" }), "Nikhil's team");
  });

  it("lists people who have someone reporting to them", () => {
    const people = [
      { id: "boss", name: "Vishal Kumar", firstName: "Vishal" },
      { id: "a", name: "Artist A", managerId: "boss" },
      { id: "b", name: "Artist B", managerId: "boss" },
      { id: "alone", name: "Solo" },
    ] as OrgPerson[];
    const teams = peopleWithTeams(people);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].id, "boss");
  });

  it("writes one SBU actual onto every matching plan", () => {
    const kpi = { name: "Studio Audit", scope: "sbu", scopeId: MALAD };
    const recA = { kras: [{ kpis: [{ ...kpi, achieved: null }] }] };
    const recB = { kras: [{ kpis: [{ ...kpi, achieved: null }] }] };
    stampSharedAchieved(recA, kpi, 88);
    stampSharedAchieved(recB, kpi, 88);
    assert.equal(recA.kras[0].kpis[0].achieved, 88);
    assert.equal(recB.kras[0].kpis[0].achieved, 88);
  });
});

describe("home alerts — group lock/unlock copies", () => {
  const SAMEER = "p-sameer";
  const locked = (id: string, at: string) => ({
    id,
    kind: "plan_ready",
    title: "Your Rewards plan is locked",
    body: "September 2026 targets are locked.",
    status: "open",
    toIds: [SAMEER],
    subjectId: SAMEER,
    month: "2026-09",
    planKind: "rewards",
    createdAt: at,
  });

  it("three lock notices for Sameer collapse to one", () => {
    const notices = [
      locked("nt-1", "2026-09-17T10:00:00Z"),
      locked("nt-2", "2026-09-17T10:01:00Z"),
      locked("nt-3", "2026-09-17T10:02:00Z"),
    ];
    const grouped = groupNoticesByKey(notices);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, "nt-3");
    assert.deepEqual(siblingNoticeIds(notices, grouped[0], SAMEER).sort(), [
      "nt-1",
      "nt-2",
      "nt-3",
    ]);
  });

  it("a different month stays its own alert", () => {
    const notices = [
      locked("nt-a", "2026-09-17T10:00:00Z"),
      { ...locked("nt-b", "2026-09-17T10:01:00Z"), month: "2026-10" },
    ];
    assert.equal(groupNoticesByKey(notices).length, 2);
    assert.notEqual(noticeGroupKey(notices[0]), noticeGroupKey(notices[1]));
  });

  it("locking again does not stack another open copy", () => {
    let list: NoticeLike[] = [locked("nt-1", "2026-09-17T10:00:00Z")];
    const second = collapseOpenNotices(list, locked("nt-2", "2026-09-17T10:05:00Z"));
    assert.equal(second.added, false);
    assert.equal(second.notices.length, 1);
    assert.equal(second.notices[0].id, "nt-1");
    list = second.notices;
    const third = collapseOpenNotices(list, locked("nt-3", "2026-09-17T10:06:00Z"));
    assert.equal(third.notices.length, 1);
    assert.equal(groupNoticesByKey(third.notices).length, 1);
  });

  it("done copies do not group with a fresh open one", () => {
    const notices = [
      { ...locked("nt-old", "2026-09-17T09:00:00Z"), status: "done" },
      locked("nt-new", "2026-09-17T10:00:00Z"),
    ];
    const open = notices.filter((n) => n.status === "open");
    assert.equal(groupNoticesByKey(open).length, 1);
    const again = collapseOpenNotices(notices, locked("nt-again", "2026-09-17T11:00:00Z"));
    assert.equal(again.added, false);
    assert.equal(again.notices.filter((n) => n.status === "open").length, 1);
    assert.equal(again.notices.filter((n) => n.status === "done").length, 1);
  });

  it("lock notice + login-cycle notice + home ready row collapse to one", () => {
    const fromLock = locked("nt-lock", "2026-09-17T10:00:00Z");
    const fromLogin = {
      ...locked("nt-cycle", "2026-09-17T10:01:00Z"),
      phase: "plan_ready",
      title: "September 2026 Rewards is ready",
      body: "Your manager locked the rewards plan.",
    };
    const notices = [fromLock, fromLogin];
    assert.equal(noticeGroupKey(fromLock), noticeGroupKey(fromLogin));
    const grouped = groupNoticesByKey(notices);
    assert.equal(grouped.length, 1);
    const emp = {
      kind: "rewards",
      month: "2026-09",
      phase: "plan_ready",
      title: "September 2026 Rewards is ready",
    };
    assert.equal(empAlertDuplicatesNotice(emp, grouped, SAMEER), true);
    assert.equal(
      empAlertKeyForNotice(SAMEER, grouped[0]),
      `emp:${SAMEER}:rewards:2026-09:plan_ready`,
    );
    const stacked = collapseOpenNotices([fromLock], fromLogin);
    assert.equal(stacked.added, false);
    assert.equal(stacked.notices.length, 1);
  });
});
