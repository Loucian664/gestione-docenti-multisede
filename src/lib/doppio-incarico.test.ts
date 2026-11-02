import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoAssignPlan, coverageNeeds, dayCoverage, doubleCovers, rankSubstitutes } from "./coverage.ts";
import type { Absence, PersistedData, Substitution, Teacher, TimetableSlot } from "./types.ts";

const T = (id: string, lastName: string, role: Teacher["role"] = "cattedra"): Teacher => ({
  id,
  lastName,
  firstName: "X",
  subjects: ["Italiano"],
  weeklyHours: 18,
  role,
  notes: "",
  color: "#3d5a4c",
  assignedClassIds: [],
});
const S = (classId: string, periodId: string, teacherId: string): TimetableSlot => ({
  id: `s-${classId}-${periodId}-${teacherId}`,
  day: 1,
  periodId,
  classId,
  teacherId,
  subject: "Italiano",
});
const ABS = (teacherId: string): Absence => ({
  id: `a-${teacherId}`,
  teacherId,
  dateFrom: "2026-09-07",
  dateTo: "2026-09-07",
  reason: "malattia",
  notes: "",
  allDay: true,
  periodIds: [],
});
const SUB = (classId: string, absentTeacherId: string, substituteId: string): Substitution => ({
  id: `sub-${classId}`,
  date: "2026-09-07",
  periodId: "p3",
  classId,
  absentTeacherId,
  substituteId,
  type: "disposizione",
  activity: "",
  notes: "",
  subject: "Italiano",
});

function fixture(substitutions: Substitution[]): PersistedData {
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
        { id: "p3", index: 3, label: "3ª ora", start: "10:05", end: "11:00" },
        { id: "p4", index: 4, label: "4ª ora", start: "11:00", end: "11:55" },
      ],
    },
    // Disp ha un'ora a disposizione alla 3ª, e lezioni alla 1ª e alla 4ª
    teachers: [
      T("lent", "Lentini"),
      T("macc", "Maccarone"),
      { ...T("disp", "Giofre"), dispSlots: [{ day: 1, periodId: "p3" }] },
    ],
    classes: [
      { id: "c-1A", name: "1ª A", grade: 1, section: "A", students: 18, tempo: "TN" },
      { id: "c-1B", name: "1ª B", grade: 1, section: "B", students: 18, tempo: "TN" },
    ],
    slots: [
      S("c-1A", "p3", "lent"),
      S("c-1B", "p3", "macc"),
      S("c-1A", "p1", "disp"),
      S("c-1B", "p4", "disp"),
    ],
    absences: [ABS("lent"), ABS("macc")],
    substitutions,
    selectedDate: "2026-09-07",
  };
}

describe("doppio incarico dei sostituti", () => {
  it("chi sostituisce già in un’altra classe nella stessa ora va in fondo, col motivo per primo", () => {
    const d = fixture([SUB("c-1A", "lent", "disp")]);
    const need = coverageNeeds(d, d.selectedDate).find((n) => n.slot.classId === "c-1B")!;
    const row = rankSubstitutes(d, need).find((r) => r.teacher.id === "disp")!;
    assert.equal(row.bucket, "in-copertura");
    assert.equal(row.alreadyCovering, true);
    assert.equal(row.reasons[0], "Sostituisce già in 1ª A");
    // senza la sostituzione in 1ª A sarebbe la prima scelta, «a disposizione»
    const free = fixture([]);
    const need2 = coverageNeeds(free, free.selectedDate).find((n) => n.slot.classId === "c-1B")!;
    assert.equal(rankSubstitutes(free, need2).find((r) => r.teacher.id === "disp")!.bucket, "disp");
  });

  it("riaprendo l’ora già coperta dal docente, lui non risulta «già in copertura»", () => {
    const d = fixture([SUB("c-1A", "lent", "disp")]);
    const need = coverageNeeds(d, d.selectedDate).find((n) => n.slot.classId === "c-1A")!;
    const row = rankSubstitutes(d, need).find((r) => r.teacher.id === "disp")!;
    assert.equal(row.bucket, "disp");
    assert.equal(row.alreadyCovering, false);
  });

  it("l’assegnazione automatica non mette lo stesso docente in due classi", () => {
    const d = fixture([SUB("c-1A", "lent", "disp")]);
    const plan = autoAssignPlan(d, d.selectedDate);
    assert.ok(plan.every((p) => p.substituteId !== "disp"));
  });

  it("le ore già assegnate due volte si riconoscono, con le altre classi", () => {
    const d = fixture([SUB("c-1A", "lent", "disp"), SUB("c-1B", "macc", "disp")]);
    const needs = coverageNeeds(d, d.selectedDate);
    const doubles = doubleCovers(needs);
    assert.equal(doubles.size, 2);
    const b = needs.find((n) => n.slot.classId === "c-1B")!;
    assert.deepEqual(doubles.get(b.key), { teacherId: "disp", otherClassIds: ["c-1A"] });
    assert.equal(dayCoverage(d, d.selectedDate).doubled, 2);
    // un sostituto per ciascuna classe: nessun conflitto
    const ok = fixture([SUB("c-1A", "lent", "disp"), SUB("c-1B", "macc", "lent")]);
    assert.equal(doubleCovers(coverageNeeds(ok, ok.selectedDate)).size, 0);
  });

  it("due assenti nella stessa classe coperti dallo stesso docente non sono un conflitto", () => {
    const d = fixture([]);
    const two: PersistedData = {
      ...d,
      slots: [...d.slots, { ...S("c-1A", "p3", "macc"), id: "s-extra", subject: "Matematica" }],
      substitutions: [SUB("c-1A", "lent", "disp"), { ...SUB("c-1A", "macc", "disp"), id: "sub-2" }],
    };
    assert.equal(doubleCovers(coverageNeeds(two, two.selectedDate)).size, 0);
  });
});
