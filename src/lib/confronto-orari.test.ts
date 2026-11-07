import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changeText, hourState, hourWords, sameHour, weekChanges, type WeekView } from "./confronto-orari.ts";
import type { PersistedData, Teacher, TimetableSlot } from "./types.ts";

function teacher(id: string, lastName: string, extras: Partial<Teacher> = {}): Teacher {
  return {
    id,
    lastName,
    firstName: "X",
    subjects: ["Matematica"],
    weeklyHours: 18,
    role: "cattedra",
    notes: "",
    color: "#3d5a4c",
    assignedClassIds: [],
    ...extras,
  };
}

function slot(classId: string, day: 1 | 2 | 3 | 4 | 5, periodId: string, teacherId: string, subject = "Matematica"): TimetableSlot {
  return { id: `s-${classId}-${day}-${periodId}-${teacherId}`, day, periodId, classId, teacherId, subject };
}

function data(teachers: Teacher[], slots: TimetableSlot[]): PersistedData {
  return {
    settings: {
      schoolName: "Scuola",
      plesso: "Secondaria di I grado",
      schoolYear: "2026/2027",
      responsabile: "",
      days: [1, 2],
      periods: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, index: i, label: `${i}ª ora`, start: "08:00", end: "09:00" })),
    },
    teachers,
    classes: [
      { id: "c-1B", name: "1ª B", grade: 1, section: "B", students: 20, tempo: "TN" },
      { id: "c-2B", name: "2ª B", grade: 2, section: "B", students: 20, tempo: "TN" },
    ],
    slots,
    absences: [],
    substitutions: [],
    selectedDate: "2026-09-07",
  };
}

const DAYS = [1, 2] as const;
const PERIODS = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, index: i }));

function view(d: PersistedData, extra: Partial<WeekView> = {}): WeekView {
  return { data: d, teachers: d.teachers, gaps: [], ...extra };
}

describe("confronto con l'orario in vigore", () => {
  const rossi = teacher("t1", "Rossi", { dispSlots: [{ day: 2, periodId: "p4" }] });
  const bianchi = teacher("t2", "Bianchi", { awaySlots: [{ day: 2, periodId: "p1" }, { day: 2, periodId: "p2", progetto: true }] });
  const vigore = data(
    [rossi, bianchi],
    [slot("c-1B", 1, "p1", "t1"), slot("c-2B", 1, "p3", "t1"), slot("c-1B", 1, "p2", "t2", "Scienze")],
  );

  it("reads each hour like the Docenti tab: lesson, + disp., buca, disp., progetto, altrove, libera", () => {
    const v = view(vigore, { gaps: [{ id: "t1", cells: [{ day: 1, periodId: "p2" }] }], added: [{ teacherId: "t1", to: { day: 2, periodId: "p3" } }] });
    assert.deepEqual(hourState(v, rossi, 1, "p1"), { kind: "lezione", classId: "c-1B", className: "1ª B", subject: "Matematica" });
    assert.deepEqual(hourState(v, rossi, 1, "p2"), { kind: "buca" });
    assert.deepEqual(hourState(v, rossi, 2, "p3"), { kind: "disp", added: true });
    assert.deepEqual(hourState(v, rossi, 2, "p4"), { kind: "disp", added: false });
    assert.deepEqual(hourState(v, rossi, 1, "p4"), { kind: "libera" });
    assert.deepEqual(hourState(v, bianchi, 2, "p1"), { kind: "altrove" });
    assert.deepEqual(hourState(v, bianchi, 2, "p2"), { kind: "progetto" });
  });

  it("the proposal's disp hours win over the teacher's, and the sedi can give their own away hours", () => {
    const v = view(vigore, {
      disp: { t1: [{ day: 1, periodId: "p4" }] },
      away: (id) => (id === "t1" ? [{ day: 2, periodId: "p2" }] : []),
    });
    assert.equal(hourState(v, rossi, 1, "p4").kind, "disp");
    assert.equal(hourState(v, rossi, 2, "p4").kind, "libera");
    assert.equal(hourState(v, rossi, 2, "p2").kind, "altrove");
    assert.equal(hourState(v, bianchi, 2, "p1").kind, "libera");
  });

  it("an hour is the same with the same class and subject; empty stays empty, buca or not", () => {
    const lez = (classId: string, subject = "Matematica") => ({ kind: "lezione" as const, classId, className: "", subject });
    assert.ok(sameHour(lez("c-1B"), lez("c-1B")));
    assert.ok(!sameHour(lez("c-1B"), lez("c-2B")));
    assert.ok(!sameHour(lez("c-1B"), lez("c-1B", "Scienze")));
    assert.ok(sameHour({ kind: "buca" }, { kind: "libera" }));
    assert.ok(sameHour({ kind: "disp", added: false }, { kind: "disp", added: true }));
    assert.ok(!sameHour({ kind: "disp", added: false }, { kind: "libera" }));
    assert.ok(!sameHour(lez("c-1B"), { kind: "libera" }));
  });

  it("lists only what changes, teacher by teacher, in the order of the new timetable", () => {
    const nuovo = data(
      [rossi, bianchi],
      [slot("c-1B", 1, "p1", "t1"), slot("c-2B", 1, "p2", "t1"), slot("c-1B", 1, "p2", "t2", "Scienze")],
    );
    const before = view(vigore, { gaps: [{ id: "t1", cells: [{ day: 1, periodId: "p2" }] }] });
    const after = view(nuovo, { teachers: [bianchi, rossi], added: [{ teacherId: "t1", to: { day: 1, periodId: "p3" } }] });
    const out = weekChanges(before, after, [...DAYS], PERIODS);
    assert.deepEqual(out.map((x) => x.teacher.id), ["t1"]);
    assert.deepEqual(out[0]!.changes.map(changeText), [
      "Lun 2ª · prima buca, ora 2ª B Matematica",
      "Lun 3ª · prima 2ª B Matematica, ora a disposizione (spostata dall’app)",
    ]);
  });

  it("nothing changes when the slot is the timetable in use", () => {
    assert.deepEqual(weekChanges(view(vigore), view(vigore), [...DAYS], PERIODS), []);
  });

  it("with all the sedi together the sede goes after the subject", () => {
    assert.equal(hourWords({ kind: "lezione", classId: "x", className: "2ª B · Nicotera", subject: "Inglese" }), "2ª B Inglese · Nicotera");
    assert.equal(hourWords({ kind: "lezione", classId: "x", className: "2ª B", subject: "Inglese" }), "2ª B Inglese");
  });
});
