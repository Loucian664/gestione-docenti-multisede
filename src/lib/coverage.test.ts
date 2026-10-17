import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoAssignPlan, classShifts, coverageNeeds, eccedenteLines, isCovered, rankSubstitutes, type CoverageNeed } from "./coverage.ts";
import { assemblySummary, dailySheetText, eccedenteXlsx } from "./export.ts";
import type { PersistedData, Teacher, TimetableSlot } from "./types.ts";

function teacher(
  id: string,
  lastName: string,
  role: Teacher["role"] = "cattedra",
  subjects: string[] = ["Italiano"],
): Teacher {
  return {
    id,
    lastName,
    firstName: "X",
    subjects,
    weeklyHours: 18,
    role,
    notes: "",
    color: "#3d5a4c",
    assignedClassIds: [],
  };
}

function slot(classId: string, periodId: string, teacherId: string, subject = "Italiano"): TimetableSlot {
  return {
    id: `slot-${classId}-1-${periodId}-${teacherId}`,
    day: 1,
    periodId,
    classId,
    teacherId,
    subject,
  };
}

function data(over: Partial<PersistedData> = {}): PersistedData {
  const settings: PersistedData["settings"] = {
    schoolName: "Test",
    plesso: "Test",
    schoolYear: "2026/2027",
    responsabile: "",
    days: [1, 2, 3, 4, 5],
    periods: [
      { id: "p1", index: 1, label: "1ª ora", start: "08:00", end: "08:55" },
      { id: "p2", index: 2, label: "2ª ora", start: "08:55", end: "09:50" },
      { id: "p3", index: 3, label: "3ª ora", start: "10:05", end: "11:00" },
      { id: "p4", index: 4, label: "4ª ora", start: "11:00", end: "11:55" },
      { id: "p5", index: 5, label: "5ª ora", start: "12:00", end: "12:55" },
      { id: "p6", index: 6, label: "6ª ora", start: "13:05", end: "14:00" },
    ],
  };
  return {
    settings,
    teachers: [],
    classes: [
      { id: "c-1A", name: "1ª A", grade: 1, section: "A", students: 18, tempo: "TN" },
      { id: "c-2A", name: "2ª A", grade: 2, section: "A", students: 20, tempo: "TN" },
    ],
    slots: [],
    absences: [],
    substitutions: [],
    selectedDate: "2026-09-07",
    ...over,
  };
}

function needFor(d: PersistedData): CoverageNeed {
  const needs = coverageNeeds(d, d.selectedDate);
  assert.ok(needs[0], "expected at least one coverage need");
  return needs[0];
}

describe("rankSubstitutes", () => {
  const hole = teacher("t-hole", "Buco");
  const potBusy = teacher("t-pot-busy", "PotBusy", "potenziamento", ["Potenziamento"]);
  const potFree = teacher("t-pot-free", "PotFree", "potenziamento", ["Potenziamento"]);
  const noOrario = teacher("t-new", "Nuovo");
  const busy = teacher("t-busy", "Impegnato", "cattedra", ["Matematica"]);
  const late = teacher("t-late", "Sesta");
  const absent = teacher("t-absent", "Assente");
  const early = teacher("t-early", "Anticipo");
  const stay = teacher("t-stay", "Resta");
  const sost = teacher("t-sost", "Sostegno", "sostegno", ["Sostegno"]);
  sost.assignedClassIds = ["c-1A"];

  const fixture = data({
    teachers: [absent, hole, potBusy, potFree, noOrario, busy, late, early, stay, sost],
    slots: [
      slot("c-1A", "p2", "t-absent"),
      slot("c-2A", "p1", "t-hole"),
      slot("c-2A", "p3", "t-hole"),
      slot("c-2A", "p2", "t-pot-busy", "Potenziamento"),
      slot("c-2A", "p2", "t-busy", "Matematica"),
      slot("c-2A", "p6", "t-late"),
      slot("c-2A", "p3", "t-early"),
      slot("c-2A", "p1", "t-stay"),
    ],
    absences: [
      {
        id: "a1",
        teacherId: "t-absent",
        dateFrom: "2026-09-07",
        dateTo: "2026-09-07",
        reason: "malattia",
        notes: "",
        allDay: true,
        periodIds: [],
      },
    ],
  });

  it("lists every teacher except the absent one", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const ids = ranked.map((r) => r.teacher.id).sort();
    assert.deepEqual(
      ids,
      ["t-busy", "t-early", "t-hole", "t-late", "t-new", "t-pot-busy", "t-pot-free", "t-sost", "t-stay"].sort(),
    );
  });

  it("puts the in-sede hole first (1ª e 3ª, libero alla 2ª)", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    assert.equal(ranked[0]?.teacher.id, "t-hole");
    assert.equal(ranked[0]?.bucket, "buco");
    assert.ok(ranked[0]?.reasons.some((r) => /buco|tra due/i.test(r)));
  });

  it("ranks arriving one hour early / leaving one hour late after true holes", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const e = ranked.find((r) => r.teacher.id === "t-early");
    const s = ranked.find((r) => r.teacher.id === "t-stay");
    const holeIdx = ranked.findIndex((r) => r.teacher.id === "t-hole");
    const earlyIdx = ranked.findIndex((r) => r.teacher.id === "t-early");
    assert.ok(e && s);
    assert.equal(e.bucket, "pre-post");
    assert.equal(s.bucket, "pre-post");
    assert.ok(e.reasons.some((r) => /entrare un.ora prima/i.test(r)));
    assert.ok(s.reasons.some((r) => /uscire un.ora dopo/i.test(r)));
    assert.ok(earlyIdx > holeIdx);
  });

  it("does not treat a teacher only on 6ª as available for 2ª", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const row = ranked.find((r) => r.teacher.id === "t-late");
    assert.ok(row);
    assert.equal(row.bucket, "non-in-sede");
  });

  it("keeps potenziamento available even with a scheduled hour", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const pot = ranked.find((r) => r.teacher.id === "t-pot-busy");
    assert.ok(pot);
    assert.equal(pot.bucket, "potenziamento");
    assert.equal(pot.inferredType, "potenziamento");
  });

  it("includes teachers without a timetable", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const neu = ranked.find((r) => r.teacher.id === "t-new");
    assert.ok(neu);
    assert.equal(neu.bucket, "senza-orario");
  });

  it("does not put sostegno among recommended names", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const row = ranked.find((r) => r.teacher.id === "t-sost");
    assert.ok(row);
    assert.equal(row.bucket, "sostegno");
    assert.ok(ranked[0]?.teacher.id !== "t-sost");
    assert.ok(!["buco", "pre-post", "in-sede", "potenziamento", "sostegno-qui"].includes(row.bucket));
  });

  it("mette in evidenza il sostegno già in quell’ora e in quella classe", () => {
    const d = data({
      teachers: [teacher("t1", "Staropoli"), teacher("t-sos", "Pagnotta", "sostegno", ["Sostegno"]), teacher("t-hole", "Buco")],
      slots: [
        slot("c-3B", "p2", "t1", "Tecnologia"),
        slot("c-3B", "p2", "t-sos", "Sostegno"),
        slot("c-2A", "p1", "t-hole"),
        slot("c-2A", "p3", "t-hole"),
      ],
      absences: [
        {
          id: "a1",
          teacherId: "t1",
          dateFrom: "2026-09-07",
          dateTo: "2026-09-07",
          reason: "visita",
          notes: "",
          allDay: true,
          periodIds: [],
        },
      ],
    });
    const need = coverageNeeds(d, "2026-09-07").find((n) => n.slot.periodId === "p2")!;
    const ranked = rankSubstitutes(d, need);
    const sos = ranked.find((r) => r.teacher.id === "t-sos");
    const hole = ranked.find((r) => r.teacher.id === "t-hole");
    assert.equal(sos?.bucket, "sostegno-qui");
    assert.ok(sos && hole && ranked.indexOf(sos) > ranked.indexOf(hole));
    assert.equal(autoAssignPlan(d, "2026-09-07").some((s) => s.substituteId === "t-sos"), false);
  });

  it("il sostegno di una classe che entra dopo può coprire un’altra", () => {
    const d = data({
      teachers: [
        teacher("t1", "Lentini"),
        teacher("t2", "Staropoli"),
        teacher("t-sos", "Lorenzo", "sostegno", ["Sostegno"]),
      ],
      slots: [
        slot("c-1A", "p1", "t1", "Italiano"),
        slot("c-1A", "p2", "t1", "Italiano"),
        slot("c-1A", "p2", "t-sos", "Sostegno"),
        slot("c-1A", "p3", "t1", "Italiano"),
        slot("c-2A", "p2", "t2", "Tecnologia"),
      ],
      absences: [
        {
          id: "a1",
          teacherId: "t1",
          dateFrom: "2026-09-07",
          dateTo: "2026-09-07",
          reason: "assemblea_sindacale",
          notes: "",
          allDay: false,
          periodIds: ["p1", "p2"],
        },
        {
          id: "a2",
          teacherId: "t2",
          dateFrom: "2026-09-07",
          dateTo: "2026-09-07",
          reason: "visita",
          notes: "",
          allDay: true,
          periodIds: [],
        },
      ],
      substitutions: ["p1", "p2"].map((periodId) => ({
        id: `s-${periodId}`,
        date: "2026-09-07",
        periodId,
        classId: "c-1A",
        absentTeacherId: "t1",
        substituteId: null,
        type: "entra" as const,
        activity: "",
        notes: "",
        subject: "Italiano",
      })),
    });
    const need = coverageNeeds(d, "2026-09-07").find((n) => n.slot.classId === "c-2A")!;
    const row = rankSubstitutes(d, need).find((r) => r.teacher.id === "t-sos");
    assert.equal(row?.bucket, "sostegno-libera");
    assert.match(row?.reasons.join(" ") ?? "", /entra alla 3ª/);
    assert.equal(autoAssignPlan(d, "2026-09-07").some((s) => s.substituteId === "t-sos"), false);
  });

  it("lists busy cattedra after available names, not hidden", () => {
    const ranked = rankSubstitutes(fixture, needFor(fixture));
    const idxHole = ranked.findIndex((r) => r.teacher.id === "t-hole");
    const idxBusy = ranked.findIndex((r) => r.teacher.id === "t-busy");
    assert.ok(idxBusy > idxHole);
    assert.equal(ranked[idxBusy]?.bucket, "impegnato");
  });

  it("does not auto-assign sostegno, a busy cattedra, or someone far from sede", () => {
    const plan = autoAssignPlan(fixture, fixture.selectedDate);
    assert.equal(plan.length, 1);
    assert.equal(plan[0]?.substituteId, "t-hole");
  });
});

describe("classShifts", () => {
  const date = "2026-09-07";
  function absent(id: string) {
    return {
      id: `a-${id}`,
      teacherId: id,
      dateFrom: date,
      dateTo: date,
      reason: "assemblea_sindacale" as const,
      notes: "",
      allDay: true,
      periodIds: [] as string[],
    };
  }

  it("non fa entrare dopo se l’assenza non è assemblea", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Staropoli"), teacher("t3", "Capria")],
      slots: [
        slot("c-2A", "p1", "t1", "Tecnologia"),
        slot("c-2A", "p2", "t1", "Tecnologia"),
        slot("c-2A", "p3", "t3", "Inglese"),
      ],
      absences: [
        {
          ...absent("t1"),
          reason: "visita",
          allDay: false,
          periodIds: ["p1", "p2"],
        },
      ],
    });
    assert.equal(classShifts(d, date).length, 0);
    const needs = coverageNeeds(d, date);
    assert.equal(needs.length, 2);
    assert.equal(needs.every((n) => !isCovered(n)), true);
  });

  it("entra alla 5ª se le prime quattro ore di 2A sono vuote", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Lentini"), teacher("t2", "Giofrè"), teacher("t3", "Capria")],
      slots: [
        slot("c-2A", "p1", "t1"),
        slot("c-2A", "p2", "t2"),
        slot("c-2A", "p3", "t1"),
        slot("c-2A", "p4", "t2"),
        slot("c-2A", "p5", "t3"),
        slot("c-2A", "p6", "t3"),
      ],
      absences: [absent("t1"), absent("t2")],
    });
    const shifts = classShifts(d, date);
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0]?.kind, "entra");
    assert.equal(shifts[0]?.phrase, "entra alla 5ª");
    assert.equal(shifts[0]?.applied, false);
    assert.equal(shifts[0]?.needs.length, 4);
  });

  it("esce alla 3ª se mancano solo le ultime ore", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Lentini"), teacher("t3", "Capria")],
      slots: ["p1", "p2", "p3", "p4", "p5", "p6"].map((p, i) => slot("c-2A", p, i < 3 ? "t3" : "t1")),
      absences: [absent("t1")],
    });
    const shifts = classShifts(d, date);
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0]?.phrase, "esce alla 3ª");
  });

  it("non fa uscire prima se l’assenza non è assemblea", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Staropoli"), teacher("t3", "Capria")],
      slots: ["p1", "p2", "p3", "p4", "p5", "p6"].map((p, i) => slot("c-2A", p, i < 3 ? "t3" : "t1")),
      absences: [{ ...absent("t1"), reason: "visita" }],
    });
    assert.equal(classShifts(d, date).length, 0);
    assert.equal(coverageNeeds(d, date).length, 3);
  });

  it("sintesi: solo chi è in assemblea, orari arrotondati", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Lentini"), teacher("t2", "Capria"), teacher("t3", "Staropoli"), teacher("t4", "Gallo")],
      classes: [
        { id: "c-1A", name: "1ª A", grade: 1, section: "A", students: 18, tempo: "TN" },
        { id: "c-2A", name: "2ª A", grade: 2, section: "A", students: 20, tempo: "TN" },
        { id: "c-3A", name: "3ª A", grade: 3, section: "A", students: 18, tempo: "TN" },
      ],
      slots: [
        slot("c-1A", "p1", "t1"),
        slot("c-1A", "p2", "t1"),
        slot("c-1A", "p3", "t2"),
        slot("c-2A", "p1", "t2"),
        slot("c-2A", "p2", "t3"),
        slot("c-3B", "p1", "t3"),
        slot("c-3A", "p1", "t4"),
      ],
      absences: [
        { ...absent("t1"), allDay: false, periodIds: ["p1", "p2"] },
        { ...absent("t2"), allDay: false, periodIds: ["p1", "p2"] },
        { ...absent("t3"), reason: "visita" },
      ],
    });
    assert.equal(
      assemblySummary(d, date),
      [
        "Assemblea sindacale",
        "Test",
        "Lunedì 7 settembre, 08:00-10:00",
        "",
        "Aderiscono:",
        "Capria, Lentini.",
        "",
        "Ingresso posticipato:",
        "2A: 09:00",
        "1A: 10:00",
        "Le altre classi entreranno regolarmente alle ore 08:00.",
      ].join("\n"),
    );
    assert.equal(assemblySummary(data({ selectedDate: date }), date), null);
  });

  it("elenca solo le ore eccedenti, con classe e orario", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Lentini"), teacher("t2", "Capria")],
      substitutions: [
        {
          id: "s-ecc",
          date,
          periodId: "p1",
          classId: "c-1A",
          absentTeacherId: "t1",
          substituteId: "t2",
          type: "eccedente",
          activity: "",
          notes: "",
          subject: "Italiano",
        },
        {
          id: "s-disp",
          date,
          periodId: "p2",
          classId: "c-2A",
          absentTeacherId: "t1",
          substituteId: "t2",
          type: "disposizione",
          activity: "",
          notes: "",
          subject: "Italiano",
        },
      ],
    });
    const lines = eccedenteLines(d, "2026-09-01", "2027-08-31");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.teacher, "Capria X");
    assert.equal(lines[0]?.className, "1ª A");
    assert.equal(lines[0]?.hour, "1ª");
    assert.equal(lines[0]?.from, "08:00");
    assert.equal(lines[0]?.to, "09:00");
    const file = eccedenteXlsx(d, "2026-09-01", "2027-08-31");
    assert.match(file.name, /ore-eccedenti-/);
    assert.ok(file.size > 0);
  });

  it("non entra se la giornata della classe è tutta vuota", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Lentini")],
      slots: ["p1", "p2", "p3", "p4", "p5", "p6"].map((p) => slot("c-1A", p, "t1")),
      absences: [absent("t1")],
    });
    assert.equal(classShifts(d, date)[0]?.phrase, "non entra");
  });

  it("il sostegno in compresenza non tiene la classe: Lentini 1ª e 2ª, entra alla 3ª", () => {
    const d = data({
      selectedDate: date,
      teachers: [
        teacher("t1", "Lentini"),
        teacher("t-sos", "Lorenzo", "sostegno", ["Sostegno"]),
        teacher("t3", "Staropoli", "cattedra", ["Tecnologia"]),
      ],
      slots: [
        slot("c-1A", "p1", "t1", "Italiano"),
        slot("c-1A", "p2", "t1", "Italiano"),
        slot("c-1A", "p2", "t-sos", "Sostegno"),
        slot("c-1A", "p3", "t3", "Tecnologia"),
      ],
      absences: [
        {
          id: "a-t1",
          teacherId: "t1",
          dateFrom: date,
          dateTo: date,
          reason: "assemblea_sindacale",
          notes: "",
          allDay: false,
          periodIds: ["p1", "p2"],
        },
      ],
    });
    const shifts = classShifts(d, date);
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0]?.classId, "c-1A");
    assert.equal(shifts[0]?.phrase, "entra alla 3ª");
    assert.deepEqual(
      shifts[0]?.needs.map((n) => n.slot.periodId).sort(),
      ["p1", "p2"],
    );
  });

  it("un buco in mezzo non è un cambio di orario", () => {
    const d = data({
      selectedDate: date,
      teachers: [teacher("t1", "Lentini"), teacher("t3", "Capria")],
      slots: ["p1", "p2", "p3", "p4", "p5", "p6"].map((p) => slot("c-1A", p, p === "p3" ? "t1" : "t3")),
      absences: [absent("t1")],
    });
    assert.equal(classShifts(d, date).length, 0);
    assert.equal(isCovered(coverageNeeds(d, date)[0]!), false);
  });

  it("un docente di sostegno assente non si sostituisce e non sposta la classe", () => {
    const d = data({
      selectedDate: date,
      teachers: [
        teacher("t1", "Pata"),
        teacher("t-sos", "Pontoriero", "sostegno", ["Sostegno"]),
      ],
      slots: [
        slot("c-3A", "p1", "t1", "Matematica"),
        slot("c-3A", "p1", "t-sos", "Sostegno"),
        slot("c-3A", "p2", "t1", "Matematica"),
        slot("c-3A", "p2", "t-sos", "Sostegno"),
        slot("c-3A", "p3", "t1", "Matematica"),
      ],
      absences: [absent("t-sos")],
    });
    assert.equal(coverageNeeds(d, date).length, 0);
    assert.equal(classShifts(d, date).length, 0);
  });

  it("il potenziamento non tiene la classe e non sposta ingresso o uscita", () => {
    const base = {
      selectedDate: date,
      teachers: [
        teacher("t1", "Capria"),
        teacher("t-pot", "Arcella", "potenziamento", ["Potenziamento"]),
      ],
      slots: [
        slot("c-2A", "p1", "t1", "Inglese"),
        slot("c-2A", "p1", "t-pot", "Potenziamento"),
        slot("c-2A", "p2", "t1", "Inglese"),
        slot("c-2A", "p3", "t1", "Inglese"),
      ],
    };
    const onlyPot = data({ ...base, absences: [absent("t-pot")] });
    assert.equal(classShifts(onlyPot, date).length, 0);

    const curricular = data({
      ...base,
      absences: [
        {
          id: "a-t1",
          teacherId: "t1",
          dateFrom: date,
          dateTo: date,
          reason: "assemblea_sindacale" as const,
          notes: "",
          allDay: false,
          periodIds: ["p1"],
        },
      ],
    });
    const shifts = classShifts(curricular, date);
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0]?.phrase, "entra alla 2ª");
    assert.deepEqual(
      shifts[0]?.needs.map((n) => n.absence.teacherId),
      ["t1"],
    );
  });

  it("il foglio nomina chi è in assemblea, anche sostegno", () => {
    const lentini = teacher("t1", "Lentini");
    lentini.firstName = "Giuseppina";
    const pont = teacher("t-sos", "Pontoriero", "sostegno", ["Sostegno"]);
    pont.firstName = "Grazia";
    const d = data({
      selectedDate: date,
      teachers: [lentini, pont],
      slots: [
        slot("c-1A", "p1", "t1"),
        slot("c-1A", "p2", "t1"),
        slot("c-1A", "p3", "t1"),
        slot("c-1A", "p1", "t-sos", "Sostegno"),
        slot("c-1A", "p2", "t-sos", "Sostegno"),
      ],
      absences: [
        { ...absent("t1"), allDay: false, periodIds: ["p1", "p2"] },
        { ...absent("t-sos"), allDay: false, periodIds: ["p1", "p2"] },
      ],
    });
    const shift = classShifts(d, date)[0]!;
    d.substitutions = shift.needs.map((n) => ({
      id: `s-${n.slot.id}`,
      date,
      periodId: n.slot.periodId,
      classId: n.slot.classId,
      absentTeacherId: n.absence.teacherId,
      substituteId: null,
      type: shift.kind,
      activity: "",
      notes: "",
      subject: n.slot.subject,
    }));
    const text = dailySheetText(d, date, coverageNeeds(d, date));
    assert.doesNotMatch(text, /Assemblea sindacale,/);
    assert.match(text, /assente Lentini \(assemblea\)/);
    assert.match(text, /entra alla 3ª/);
  });
});