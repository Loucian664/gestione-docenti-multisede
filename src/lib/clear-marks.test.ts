import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearMarks, markCount, previousFields } from "./clear-marks";
import type { Teacher, TimetableSlot } from "./types";

const t: Teacher = {
  id: "t1",
  lastName: "Prova",
  firstName: "Uno",
  subjects: ["Italiano"],
  weeklyHours: 18,
  role: "cattedra",
  notes: "",
  color: "#ccc",
  assignedClassIds: [],
  awaySlots: [
    { day: 1, periodId: "p1" },
    { day: 2, periodId: "p3", progetto: true, sede: "Biblioteca" },
  ],
  avoidSlots: [{ day: 3, periodId: "p6" }],
  mustSlots: [
    { day: 1, periodId: "p6", classIds: ["c1"], level: "obbligo" },
    { day: 2, periodId: "p1", classIds: ["c2"] },
  ],
  lockedSlots: [{ day: 4, periodId: "p2", classId: "c1" }],
  dayPatterns: [[4, 4, 4, 3, 3]],
  rientroDays: [2],
  noGaps: true,
  dispSlots: [{ day: 5, periodId: "p4" }],
};

describe("Cancella tutto in Costruisci", () => {
  it("conta i segni per tipo, senza progetto e disposizioni", () => {
    assert.equal(markCount(t, "away"), 1);
    assert.equal(markCount(t, "no"), 1);
    assert.equal(markCount(t, "pref"), 1);
    assert.equal(markCount(t, "must"), 1);
    assert.equal(markCount(t, "lock"), 1);
    assert.equal(markCount(t, "days"), 2);
    assert.equal(markCount(t, "free"), 1);
  });

  it("toglie tutto ma lascia progetto e ore a disposizione", () => {
    const patch = clearMarks(t, new Set(["away", "no", "pref", "must", "lock", "days", "free"]))!;
    const after = { ...t, ...patch };
    for (const k of ["away", "no", "pref", "must", "lock", "days", "free"] as const) assert.equal(markCount(after, k), 0, k);
    assert.deepEqual(after.awaySlots, [{ day: 2, periodId: "p3", progetto: true, sede: "Biblioteca" }]);
    assert.deepEqual(after.dispSlots, t.dispSlots);
  });

  it("togliendo solo le preferenze di classe, gli obblighi restano", () => {
    const patch = clearMarks(t, new Set(["pref"]))!;
    assert.deepEqual(patch.mustSlots, [t.mustSlots![0]]);
    assert.equal(Object.keys(patch).length, 1);
  });

  it("Annulla rimette i campi di prima", () => {
    const patch = clearMarks(t, new Set(["away", "days"]))!;
    const back = previousFields(t, patch);
    assert.deepEqual({ ...t, ...patch, ...back }, t);
  });

  it("con l’orario, contano solo i blocchi su lezioni che ci sono", () => {
    const lesson = { id: "s1", day: 4, periodId: "p2", classId: "c1", teacherId: "t1", subject: "Italiano" } as TimetableSlot;
    assert.equal(markCount(t, "lock", [lesson]), 1);
    assert.equal(markCount(t, "lock", []), 0);
    assert.equal(clearMarks(t, new Set(["lock"]), []), null);
  });

  it("niente da togliere: null", () => {
    assert.equal(clearMarks({ ...t, avoidSlots: [] }, new Set(["no"])), null);
  });
});
