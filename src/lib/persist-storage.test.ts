import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodePersist,
  isClearedRegister,
  isSeedLike,
  mergeSlices,
  persistRichness,
  persistSavedAt,
  shouldAcceptWrite,
  type PersistSlice,
} from "./persist-storage.ts";
import { DEFAULT_SCHOOL_NAME, SEED_TEACHER_IDS } from "./seed.ts";

function wrap(state: Record<string, unknown>): string {
  return encodePersist(state);
}

const seedTeachers = SEED_TEACHER_IDS.map((id) => ({ id, lastName: id, firstName: "X" }));

describe("persist guards", () => {
  it("reads savedAt from zustand persist wrapper", () => {
    assert.equal(persistSavedAt(wrap({ savedAt: 1700000000000, teachers: [] })), 1700000000000);
    assert.equal(persistSavedAt(wrap({ savedAt: 0 })), 0);
    assert.equal(persistSavedAt(null), 0);
  });

  it("never lets seed overwrite a real save", () => {
    const user = wrap({
      savedAt: 1_700_000_000_000,
      settings: { schoolName: "Plesso mio" },
      teachers: [{ id: "t1" }],
      classes: [],
    });
    const seed = wrap({
      savedAt: 0,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      classes: [],
    });
    assert.equal(shouldAcceptWrite(seed, user), false);
    assert.equal(shouldAcceptWrite(seed, null), false);
    assert.equal(shouldAcceptWrite(user, seed), true);
    assert.equal(shouldAcceptWrite(user, null), true);
  });

  it("never lets a newer stamped example overwrite an extra teacher", () => {
    const user = wrap({
      savedAt: 100,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: [...seedTeachers, { id: "t-nuovoextra" }],
      classes: [],
      absences: [],
      substitutions: [],
    });
    const seed = wrap({
      savedAt: 999999,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      classes: [],
      absences: [],
      substitutions: [],
    });
    assert.equal(shouldAcceptWrite(seed, user), false);
  });

  it("never lets an older timestamp overwrite a newer one", () => {
    const older = wrap({ savedAt: 100, teachers: [{ id: "t-nuovo" }], classes: [] });
    const newer = wrap({ savedAt: 200, teachers: [{ id: "t-nuovo" }], classes: [] });
    assert.equal(shouldAcceptWrite(older, newer), false);
    assert.equal(shouldAcceptWrite(newer, older), true);
  });

  it("ranks a stamped save far above seed-sized data", () => {
    const seed = wrap({
      savedAt: 0,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      slots: new Array(200).fill({ id: "s" }),
      absences: [],
      substitutions: [],
      classes: [{ id: "c-1A", tempo: "TN" }],
    });
    const user = wrap({
      savedAt: Date.now(),
      settings: { schoolName: "Istituto QA" },
      teachers: [...seedTeachers, { id: "t-extra" }],
      slots: new Array(180).fill({ id: "s" }),
      absences: [{ id: "a-user" }],
      substitutions: [],
      classes: [{ id: "c-1A", tempo: "TN" }],
    });
    assert.ok(persistRichness(user) > persistRichness(seed));
    assert.equal(isSeedLike(JSON.parse(user).state), false);
  });

  it("merges extra teachers from one copy and a custom school name from another", () => {
    const onlyName = {
      savedAt: 10,
      settings: { schoolName: "SMS Nome Nuovo", plesso: "P", schoolYear: "2026/2027", responsabile: "", days: [1], periods: [] },
      teachers: seedTeachers.map((t) => ({ ...t, firstName: "A", subjects: [], weeklyHours: 0, role: "cattedra" as const, notes: "", color: "#000", assignedClassIds: [] })),
      classes: [],
      slots: [],
      absences: [],
      substitutions: [],
      selectedDate: "2026-09-07",
    };
    const onlyTeacher = {
      savedAt: 5,
      settings: { schoolName: DEFAULT_SCHOOL_NAME, plesso: "P", schoolYear: "2026/2027", responsabile: "", days: [1], periods: [] },
      teachers: [
        ...onlyName.teachers,
        {
          id: "t-abcdef12",
          lastName: "Rossi",
          firstName: "Mario",
          subjects: ["Potenziamento"],
          weeklyHours: 18,
          role: "potenziamento" as const,
          notes: "",
          color: "#000",
          assignedClassIds: [],
        },
      ],
      classes: [],
      slots: [],
      absences: [],
      substitutions: [],
      selectedDate: "2026-09-07",
    };
    const merged = mergeSlices(onlyName as PersistSlice, onlyTeacher as PersistSlice);
    assert.equal(merged.settings.schoolName, "SMS Nome Nuovo");
    assert.ok(merged.teachers.some((t) => t.id === "t-abcdef12"));
    assert.equal(isSeedLike(merged), false);
  });

  it("marks origin=user as real data even if the organico looks like the example", () => {
    const user = {
      origin: "user" as const,
      savedAt: 10,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      classes: [],
      slots: [],
      absences: [],
      substitutions: [],
    };
    assert.equal(isSeedLike(user as unknown as PersistSlice), false);
    const seed = wrap({
      origin: "seed",
      savedAt: 999999,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      classes: [],
      slots: [],
      absences: [],
      substitutions: [],
    });
    assert.equal(shouldAcceptWrite(seed, wrap(user)), false);
  });

  it("treats a custom timetable as user data even with the example organico", () => {
    const user = {
      savedAt: 50,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      classes: [],
      slots: [
        {
          id: "slot-c-1A-1-p1",
          teacherId: "t-ita-1",
          subject: "Orario ufficiale",
          classId: "c-1A",
          day: 1 as const,
          periodId: "p1",
        },
      ],
      absences: [],
      substitutions: [],
    };
    assert.equal(isSeedLike(user as unknown as PersistSlice), false);
    const stampedSeed = wrap({
      savedAt: 999999,
      settings: { schoolName: DEFAULT_SCHOOL_NAME },
      teachers: seedTeachers,
      classes: [],
      slots: [],
      absences: [],
      substitutions: [],
    });
    assert.equal(shouldAcceptWrite(stampedSeed, wrap(user)), false);
  });

  it("never lets a newer seed copy replace user slots during merge", () => {
    const user = {
      origin: "user" as const,
      savedAt: 10,
      settings: { schoolName: "SMS Plesso Verdi", plesso: "P", schoolYear: "2026/2027", responsabile: "", days: [1], periods: [] },
      teachers: [
        ...seedTeachers.map((t) => ({
          ...t,
          firstName: "A",
          subjects: [],
          weeklyHours: 0,
          role: "cattedra" as const,
          notes: "",
          color: "#000",
          assignedClassIds: [],
        })),
        {
          id: "t-extra",
          lastName: "Verdi",
          firstName: "Luigi",
          subjects: ["Potenziamento"],
          weeklyHours: 18,
          role: "potenziamento" as const,
          notes: "",
          color: "#000",
          assignedClassIds: [],
        },
      ],
      classes: [],
      slots: [{ id: "slot-custom", classId: "c-1A", day: 1 as const, periodId: "p1", teacherId: "t-extra", subject: "Potenziamento" }],
      absences: [],
      substitutions: [],
      selectedDate: "2026-09-07",
    };
    const seed = {
      origin: "seed" as const,
      savedAt: 99_999,
      settings: { schoolName: DEFAULT_SCHOOL_NAME, plesso: "P", schoolYear: "2026/2027", responsabile: "", days: [1], periods: [] },
      teachers: seedTeachers.map((t) => ({
        ...t,
        firstName: "X",
        subjects: [],
        weeklyHours: 0,
        role: "cattedra" as const,
        notes: "",
        color: "#000",
        assignedClassIds: [],
      })),
      classes: [],
      slots: [{ id: "slot-custom", classId: "c-1A", day: 1 as const, periodId: "p1", teacherId: "t-ita-1", subject: "Italiano" }],
      absences: [],
      substitutions: [],
      selectedDate: "2026-09-07",
    };
    const merged = mergeSlices(user as PersistSlice, seed as PersistSlice);
    assert.equal(merged.settings.schoolName, "SMS Plesso Verdi");
    assert.ok(merged.teachers.some((t) => t.id === "t-extra"));
    assert.equal(merged.slots.find((s) => s.id === "slot-custom")?.teacherId, "t-extra");
    assert.equal(isSeedLike(merged), false);
  });

  it("accepts a newer emptied register and does not re-merge old teachers", () => {
    const full = wrap({
      origin: "user",
      savedAt: 100,
      settings: { schoolName: "Istituto comprensivo" },
      teachers: seedTeachers,
      classes: [{ id: "c-1A" }],
      slots: [{ id: "s1" }],
      absences: [],
      substitutions: [],
    });
    const empty = wrap({
      origin: "user",
      savedAt: 200,
      settings: { schoolName: "Istituto comprensivo" },
      teachers: [],
      classes: [],
      slots: [],
      absences: [],
      substitutions: [],
    });
    assert.equal(shouldAcceptWrite(empty, full), true);
    const merged = mergeSlices(
      JSON.parse(empty).state as PersistSlice,
      JSON.parse(full).state as PersistSlice,
    );
    assert.equal(isClearedRegister(merged), true);
    assert.equal(merged.teachers.length, 0);
    assert.equal(merged.classes.length, 0);
  });
});
