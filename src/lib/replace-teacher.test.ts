import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageNeeds } from "./coverage.ts";
import { allTeachers, findAnyTeacher, removalImpact, replaceTeacher, teacherHistory, withFormerTeachers } from "./replace-teacher.ts";
import { buildSeed } from "./seed.ts";
import {
  allSedi,
  editSede,
  exportSede,
  formerPersons,
  historyIn,
  linkedElsewhere,
  removalImpactSedi,
  removeTeacherRefs,
  replaceTeacherSedi,
  sedeIdOf,
  startNewSchoolYear,
  teacherRefs,
} from "./sedi.ts";
import { snapshot, useAppStore } from "./store.ts";
import type { Absence, PersistedData, SedeData, Substitution, Teacher } from "./types.ts";

function teacher(id: string, lastName: string, firstName = "X"): Teacher {
  return {
    id,
    lastName,
    firstName,
    subjects: ["Italiano"],
    weeklyHours: 18,
    role: "cattedra",
    notes: "",
    color: "#3d5a4c",
    assignedClassIds: ["c-1A"],
  };
}

function absence(id: string, teacherId: string, dateFrom: string, dateTo = dateFrom): Absence {
  return { id, teacherId, dateFrom, dateTo, reason: "malattia", notes: "", allDay: true, periodIds: [] };
}

function sub(id: string, date: string, absentTeacherId: string, substituteId: string | null): Substitution {
  return {
    id,
    date,
    periodId: "p1",
    classId: "c-1A",
    absentTeacherId,
    substituteId,
    type: "disposizione",
    activity: "",
    notes: "",
    subject: "Italiano",
  };
}

function data(over: Partial<PersistedData> = {}): PersistedData {
  return {
    settings: {
      schoolName: "Test",
      plesso: "Test",
      schoolYear: "2026/2027",
      responsabile: "",
      days: [1, 2, 3, 4, 5],
      periods: [
        { id: "p1", index: 1, label: "1ª ora", start: "08:00", end: "08:55" },
        { id: "p2", index: 2, label: "2ª ora", start: "08:55", end: "09:50" },
      ],
    },
    teachers: [teacher("t-old", "Rossi", "Anna"), teacher("t-cov", "Verdi")],
    classes: [{ id: "c-1A", name: "1ª A", grade: 1, section: "A", students: 18, tempo: "TN" }],
    // lunedì alla 1ª ora la 1ª A ha la scheda che passa di mano
    slots: [{ id: "s1", day: 1, periodId: "p1", classId: "c-1A", teacherId: "t-old", subject: "Italiano" }],
    absences: [],
    substitutions: [],
    selectedDate: "2026-10-19",
    ...over,
  };
}

const FROM = "2026-10-19"; // lunedì

describe("sostituisci docente", () => {
  it("la scheda prende il nome nuovo e chi lascia passa tra i non più in servizio", () => {
    const next = replaceTeacher(data(), "t-old", { lastName: " Bianchi ", firstName: "Maria " }, FROM)!;
    const card = next.teachers.find((t) => t.id === "t-old")!;
    assert.equal(card.lastName, "Bianchi");
    assert.equal(card.firstName, "Maria");
    assert.equal(card.leftOn, undefined);
    assert.equal(next.formerTeachers!.length, 1);
    const former = next.formerTeachers![0]!;
    assert.notEqual(former.id, "t-old");
    assert.equal(former.lastName, "Rossi");
    assert.equal(former.firstName, "Anna");
    assert.equal(former.leftOn, FROM);
    assert.equal(former.replacedBy, "t-old");
    // chi lascia non è tra i docenti in servizio (Oggi, Costruisci, sostituti)
    assert.ok(!next.teachers.some((t) => t.id === former.id));
  });

  it("assenze e coperture dei giorni prima restano a chi lascia, quelle dalla data in poi alla scheda", () => {
    const d = data({
      absences: [absence("a-old", "t-old", "2026-10-12"), absence("a-new", "t-old", "2026-10-20"), absence("a-cov", "t-cov", "2026-10-13")],
      substitutions: [
        sub("s-old", "2026-10-12", "t-old", "t-cov"),
        sub("s-did", "2026-10-13", "t-cov", "t-old"),
        sub("s-new", "2026-10-20", "t-old", "t-cov"),
      ],
    });
    const next = replaceTeacher(d, "t-old", { lastName: "Bianchi", firstName: "Maria" }, FROM)!;
    const formerId = next.formerTeachers![0]!.id;
    const a = new Map(next.absences.map((x) => [x.id, x]));
    assert.equal(a.get("a-old")!.teacherId, formerId);
    assert.equal(a.get("a-new")!.teacherId, "t-old");
    assert.equal(a.get("a-cov")!.teacherId, "t-cov");
    const s = new Map(next.substitutions.map((x) => [x.id, x]));
    assert.equal(s.get("s-old")!.absentTeacherId, formerId);
    assert.equal(s.get("s-old")!.substituteId, "t-cov");
    assert.equal(s.get("s-did")!.absentTeacherId, "t-cov");
    assert.equal(s.get("s-did")!.substituteId, formerId);
    assert.equal(s.get("s-new")!.absentTeacherId, "t-old");
    assert.deepEqual(teacherHistory({ ...d, ...next }, formerId), { absences: 1, substitutions: 2 });
    assert.deepEqual(teacherHistory({ ...d, ...next }, "t-old"), { absences: 1, substitutions: 1 });
  });

  it("un'assenza a cavallo della data si divide: i giorni prima a chi lascia", () => {
    const d = data({ absences: [absence("a1", "t-old", "2026-10-15", "2026-10-21")] });
    const next = replaceTeacher(d, "t-old", { lastName: "Bianchi", firstName: "" }, FROM)!;
    const formerId = next.formerTeachers![0]!.id;
    assert.equal(next.absences.length, 2);
    const before = next.absences.find((x) => x.teacherId === formerId)!;
    const after = next.absences.find((x) => x.teacherId === "t-old")!;
    assert.equal(before.dateFrom, "2026-10-15");
    assert.equal(before.dateTo, "2026-10-18");
    assert.notEqual(before.id, "a1");
    assert.equal(after.id, "a1");
    assert.equal(after.dateFrom, FROM);
    assert.equal(after.dateTo, "2026-10-21");
  });

  it("senza cognome, senza data o con un docente che non c'è non cambia niente", () => {
    assert.equal(replaceTeacher(data(), "t-old", { lastName: "  ", firstName: "Maria" }, FROM), null);
    assert.equal(replaceTeacher(data(), "t-old", { lastName: "Bianchi", firstName: "" }, ""), null);
    assert.equal(replaceTeacher(data(), "t-x", { lastName: "Bianchi", firstName: "" }, FROM), null);
  });

  it("le ore da coprire di chi lascia, nei giorni passati, sono quelle della scheda e restano coperte", () => {
    const d = data({
      absences: [absence("a-old", "t-old", "2026-10-12")],
      substitutions: [sub("s-old", "2026-10-12", "t-old", "t-cov")],
    });
    const next = { ...d, ...replaceTeacher(d, "t-old", { lastName: "Bianchi", firstName: "Maria" }, FROM)! };
    const needs = coverageNeeds(next, "2026-10-12");
    assert.equal(needs.length, 1);
    assert.equal(needs[0]!.slot.id, "s1");
    assert.equal(needs[0]!.substitution?.id, "s-old");
    assert.equal(needs[0]!.absence.teacherId, next.formerTeachers![0]!.id);
  });

  it("i nomi di chi lascia si trovano ancora per assenze, coperture e report", () => {
    const next = { ...data(), ...replaceTeacher(data(), "t-old", { lastName: "Bianchi", firstName: "Maria" }, FROM)! };
    const formerId = next.formerTeachers![0]!.id;
    assert.equal(findAnyTeacher(next, formerId)?.lastName, "Rossi");
    assert.equal(findAnyTeacher(next, "t-old")?.lastName, "Bianchi");
    assert.equal(allTeachers(next).length, 3);
    assert.equal(withFormerTeachers(next).teachers.length, 3);
    assert.equal(next.teachers.length, 2);
  });

  it("dal negozio: i dati restano salvati, anche tornando all'esempio si azzerano", () => {
    const st = () => useAppStore.getState();
    st().resetDemo();
    const t = st().teachers[0]!;
    assert.equal(st().replaceTeacher(t.id, { lastName: "Nuova", firstName: "Persona" }, FROM), true);
    assert.equal(st().teachers.find((x) => x.id === t.id)!.lastName, "Nuova");
    assert.equal(snapshot(st()).formerTeachers!.length, 1);
    assert.equal(snapshot(st()).formerTeachers![0]!.lastName, t.lastName);
    assert.equal(st().replaceTeacher("t-x", { lastName: "Nuova", firstName: "" }, FROM), false);
    st().resetDemo();
    assert.equal(snapshot(st()).formerTeachers?.length ?? 0, 0);
  });
});

describe("elimina docente", () => {
  it("conta ore in orario, assenze, ore coperte per i colleghi e ore coperte dai colleghi", () => {
    const d = data({
      absences: [absence("a1", "t-old", "2026-10-12"), absence("a2", "t-cov", "2026-10-13")],
      substitutions: [
        sub("s1", "2026-10-12", "t-old", "t-cov"),
        sub("s2", "2026-10-12", "t-old", null),
        sub("s3", "2026-10-13", "t-cov", "t-old"),
      ],
    });
    assert.deepEqual(removalImpact(d, "t-old"), { lessons: 1, absences: 1, coveredByThem: 1, coveredForThem: 1 });
    assert.deepEqual(removalImpact(d, "t-x"), { lessons: 0, absences: 0, coveredByThem: 0, coveredForThem: 0 });
  });

  it("dal negozio: si elimina anche chi non è più in servizio, con le sue assenze e le ore che ha coperto", () => {
    const st = () => useAppStore.getState();
    st().resetDemo();
    const [t, other] = st().teachers;
    assert.ok(t && other);
    useAppStore.setState({
      absences: [absence("a-x", t.id, "2026-10-12"), absence("a-y", other.id, "2026-10-13")],
      substitutions: [sub("s-x", "2026-10-12", t.id, other.id), sub("s-y", "2026-10-13", other.id, t.id)],
    });
    assert.equal(st().replaceTeacher(t.id, { lastName: "Nuova", firstName: "Persona" }, FROM), true);
    const formerId = st().formerTeachers![0]!.id;
    st().removeTeacher(formerId);
    assert.equal(st().formerTeachers?.length ?? 0, 0);
    assert.ok(st().teachers.some((x) => x.id === t.id));
    assert.ok(!st().absences.some((a) => a.teacherId === formerId));
    assert.ok(st().absences.some((a) => a.id === "a-y"));
    // l'ora che aveva coperto torna da coprire; quella coperta dal collega resta
    assert.ok(!st().substitutions.some((s) => s.id === "s-y"));
    assert.ok(st().substitutions.some((s) => s.id === "s-x"));
    st().resetDemo();
  });
});

// ---------------------------------------------------------------------------------------------
// Più sedi: gli esempi hanno due sedi con un docente di francese in comune (nomi inventati)

/** Gli esempi con assenze e sostituzioni del docente in comune in tutte e due le sedi. */
function twoSedi() {
  const d = buildSeed();
  const here = d.teachers.find((t) => t.personId === "p-esempio-fra")!;
  const bId = d.altreSedi![0]!.id;
  const there = d.altreSedi![0]!.data.teachers.find((t) => t.personId === "p-esempio-fra")!;
  const colleague = d.teachers.find((t) => t.id !== here.id)!;
  const colleagueB = d.altreSedi![0]!.data.teachers.find((t) => t.id !== there.id)!;
  const withHistory = (sede: SedeData, id: string, other: string, tag: string): SedeData => ({
    ...sede,
    absences: [
      absence(`${tag}-a1`, id, "2026-10-12"),
      // a cavallo della data: si divide
      absence(`${tag}-a2`, id, "2026-10-16", "2026-10-20"),
      absence(`${tag}-a3`, other, "2026-10-13"),
    ],
    substitutions: [
      sub(`${tag}-s1`, "2026-10-12", id, other),
      sub(`${tag}-s2`, "2026-10-13", other, id),
      sub(`${tag}-s3`, "2026-10-14", id, null),
    ],
  });
  let next = editSede(d, sedeIdOf(d), (s) => withHistory(s, here.id, colleague.id, "a"));
  next = editSede(next, bId, (s) => withHistory(s, there.id, colleagueB.id, "b"));
  return { d: next, here, there, bId };
}

const sedeB = (d: PersistedData, id: string) => allSedi(d).find((s) => s.id === id)!.data;

describe("più sedi: sostituisci docente", () => {
  it("in tutte le sue sedi: la scheda resta collegata, chi lascia va tra i non più in servizio di ogni sede", () => {
    const { d, here, there, bId } = twoSedi();
    assert.deepEqual(historyIn(d, teacherRefs(d, here.id, true)), { absences: 4, substitutions: 6 });
    const next = replaceTeacherSedi(d, here.id, { lastName: "Nuova", firstName: "Persona" }, FROM, true)!;
    const cardA = next.teachers.find((t) => t.id === here.id)!;
    const cardB = sedeB(next, bId).teachers.find((t) => t.id === there.id)!;
    assert.equal(`${cardA.lastName} ${cardA.firstName}`, "Nuova Persona");
    assert.equal(`${cardB.lastName} ${cardB.firstName}`, "Nuova Persona");
    // stessa persona nuova in tutte e due le sedi, diversa da chi lascia
    assert.ok(cardA.personId && cardA.personId === cardB.personId && cardA.personId !== "p-esempio-fra");
    assert.deepEqual(
      linkedElsewhere(next, cardA).map((r) => r.teacher.id),
      [there.id],
    );
    // classi e orario restano alla scheda
    assert.deepEqual(next.slots, d.slots);
    assert.deepEqual(sedeB(next, bId).slots, sedeB(d, bId).slots);
    for (const [sede, card] of [
      [pickHere(next), here.id],
      [sedeB(next, bId), there.id],
    ] as const) {
      const former = sede.formerTeachers!.find((t) => t.replacedBy === card)!;
      assert.equal(former.personId, "p-esempio-fra");
      assert.equal(former.leftOn, FROM);
      // prima della data a chi lascia (l'assenza a cavallo si divide), dopo alla scheda
      assert.equal(sede.absences.filter((a) => a.teacherId === former.id).length, 2);
      assert.deepEqual(
        sede.absences.filter((a) => a.teacherId === card).map((a) => [a.dateFrom, a.dateTo]),
        [[FROM, "2026-10-20"]],
      );
      assert.equal(sede.substitutions.filter((s) => s.absentTeacherId === card || s.substituteId === card).length, 0);
    }
    const rows = formerPersons(next);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.records.length, 2);
    assert.deepEqual(rows[0]!.stillAt, []);
  });

  it("solo nella sede in uso: lì la scheda è di un'altra persona, nell'altra sede resta chi c'era", () => {
    const { d, here, there, bId } = twoSedi();
    const next = replaceTeacherSedi(d, here.id, { lastName: "Nuova", firstName: "Persona" }, FROM, false)!;
    const cardA = next.teachers.find((t) => t.id === here.id)!;
    assert.equal(cardA.lastName, "Nuova");
    assert.notEqual(cardA.personId, "p-esempio-fra");
    assert.deepEqual(linkedElsewhere(next, cardA), []);
    // l'altra sede non cambia
    assert.deepEqual(sedeB(next, bId), sedeB(d, bId));
    const rows = formerPersons(next);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      rows[0]!.records.map((r) => r.sedeId),
      [sedeIdOf(d)],
    );
    assert.deepEqual(rows[0]!.stillAt, ["Sede B (esempio)"]);
    // poi anche nell'altra sede: sempre una riga sola per la persona, con le due sedi
    const there2 = switchTo(next, bId);
    const both = replaceTeacherSedi(there2, there.id, { lastName: "Altra", firstName: "Persona" }, "2026-11-02", true)!;
    const rows2 = formerPersons(both);
    assert.equal(rows2.length, 1);
    assert.equal(rows2[0]!.records.length, 2);
    assert.deepEqual(rows2[0]!.stillAt, []);
  });

  it("dal negozio, in tutte le sedi o solo qui", () => {
    const st = () => useAppStore.getState();
    const { d, here, there, bId } = twoSedi();
    st().importData(d);
    assert.equal(st().replaceTeacher(here.id, { lastName: "Nuova", firstName: "Persona" }, FROM, false), true);
    assert.equal(sedeB(snapshot(st()), bId).teachers.find((t) => t.id === there.id)!.lastName, here.lastName);
    st().importData(d);
    assert.equal(st().replaceTeacher(here.id, { lastName: "Nuova", firstName: "Persona" }, FROM), true);
    assert.equal(sedeB(snapshot(st()), bId).teachers.find((t) => t.id === there.id)!.lastName, "Nuova");
    st().resetDemo();
  });

  it("«Esporta sede» porta anche chi non è più in servizio in quella sede, senza il collegamento tra sedi", () => {
    const { d, here, bId } = twoSedi();
    const next = replaceTeacherSedi(d, here.id, { lastName: "Nuova", firstName: "Persona" }, FROM, true)!;
    const out = exportSede(next, bId);
    assert.equal(out.formerTeachers?.length, 1);
    assert.equal(out.formerTeachers![0]!.personId, undefined);
    assert.equal(out.formerTeachers![0]!.lastName, here.lastName);
    assert.ok(out.absences.some((a) => a.teacherId === out.formerTeachers![0]!.id));
  });
});

describe("più sedi: elimina docente", () => {
  it("le conseguenze sede per sede; solo nella sede in uso l'altra scheda resta", () => {
    const { d, here, there, bId } = twoSedi();
    const all = teacherRefs(d, here.id, true);
    const impact = removalImpactSedi(d, all);
    assert.deepEqual(
      impact.map((x) => [x.sedeName, x.absences, x.coveredByThem, x.coveredForThem]),
      [
        ["Sede A (esempio)", 2, 1, 1],
        ["Sede B (esempio)", 2, 1, 1],
      ],
    );
    assert.equal(impact[0]!.lessons, d.slots.filter((s) => s.teacherId === here.id).length);
    const onlyHere = removeTeacherRefs(d, teacherRefs(d, here.id, false));
    assert.ok(!onlyHere.teachers.some((t) => t.id === here.id));
    assert.ok(sedeB(onlyHere, bId).teachers.some((t) => t.id === there.id));
    assert.deepEqual(sedeB(onlyHere, bId), sedeB(d, bId));
    const everywhere = removeTeacherRefs(d, all);
    const b = sedeB(everywhere, bId);
    assert.ok(!b.teachers.some((t) => t.id === there.id));
    assert.ok(!b.slots.some((s) => s.teacherId === there.id));
    assert.ok(!b.absences.some((a) => a.teacherId === there.id));
    // le ore che ha coperto tornano da coprire, quelle coperte dai colleghi restano
    assert.deepEqual(
      b.substitutions.map((s) => s.id),
      ["b-s1", "b-s3"],
    );
  });

  it("chi non è più in servizio in più sedi si elimina da tutte, con tutta la sua storia", () => {
    const { d, here, there, bId } = twoSedi();
    const next = replaceTeacherSedi(d, here.id, { lastName: "Nuova", firstName: "Persona" }, FROM, true)!;
    const row = formerPersons(next)[0]!;
    const out = removeTeacherRefs(next, row.records);
    assert.deepEqual(formerPersons(out), []);
    for (const [sede, card] of [
      [pickHere(out), here.id],
      [sedeB(out, bId), there.id],
    ] as const) {
      assert.ok(sede.teachers.some((t) => t.id === card));
      assert.equal(sede.formerTeachers?.length, 0);
      assert.ok(sede.absences.every((a) => a.teacherId !== row.records[0]!.teacherId));
      // restano l'assenza dopo la data (della scheda) e quella del collega
      assert.equal(sede.absences.length, 2);
    }
  });
});

describe("più sedi: nuovo anno scolastico", () => {
  it("nuovo anno in tutte le sedi: via assenze, sostituzioni e chi non è più in servizio; il resto resta", () => {
    const { d, here, bId } = twoSedi();
    const before = replaceTeacherSedi(d, here.id, { lastName: "Nuova", firstName: "Persona" }, FROM, true)!;
    const after = startNewSchoolYear(before, " 2027/2028 ");
    for (const s of allSedi(after)) {
      assert.deepEqual([s.data.absences, s.data.substitutions, s.data.formerTeachers], [[], [], []]);
      assert.equal(s.data.settings.schoolYear, "2027/2028");
    }
    for (const id of [sedeIdOf(d), bId]) {
      const a = allSedi(before).find((s) => s.id === id)!.data;
      const b = allSedi(after).find((s) => s.id === id)!.data;
      assert.deepEqual([b.teachers, b.classes, b.slots, b.savedTimetables, b.settings.periods], [
        a.teachers,
        a.classes,
        a.slots,
        a.savedTimetables,
        a.settings.periods,
      ]);
    }
    // senza anno scritto resta quello di prima
    assert.equal(startNewSchoolYear(after, "  ").settings.schoolYear, "2027/2028");
  });

  it("dal negozio: nuovo anno in tutte le sedi", () => {
    const st = () => useAppStore.getState();
    const { d, bId } = twoSedi();
    st().importData(d);
    st().startNewSchoolYear("2027/2028");
    assert.deepEqual([st().absences, sedeB(snapshot(st()), bId).absences], [[], []]);
    assert.equal(sedeB(snapshot(st()), bId).settings.schoolYear, "2027/2028");
    st().resetDemo();
  });
});

function pickHere(d: PersistedData): SedeData {
  return allSedi(d).find((s) => s.active)!.data;
}

function switchTo(d: PersistedData, id: string): PersistedData {
  const st = () => useAppStore.getState();
  st().importData(d);
  st().switchSede(id);
  const out = snapshot(st());
  st().resetDemo();
  return out;
}
