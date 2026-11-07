import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { absenceSpans, absencesByReason, formatHours, hasAbsences, reasonSpans, spanMinutes } from "./coverage.ts";
import type { Absence, PersistedData } from "./types.ts";

function data(absences: Absence[]): PersistedData {
  return {
    settings: {
      schoolName: "Test",
      plesso: "Test",
      schoolYear: "2026/2027",
      responsabile: "",
      days: [1, 2, 3, 4, 5],
      periods: [
        { id: "p1", index: 1, label: "1ª ora", start: "08:00", end: "09:00" },
        { id: "p2", index: 2, label: "2ª ora", start: "09:00", end: "10:00" },
        { id: "p3", index: 3, label: "3ª ora", start: "10:00", end: "11:00" },
        { id: "p7", index: 7, label: "7ª ora", start: "14:00", end: "14:45" },
      ],
    },
    teachers: [
      { id: "t1", lastName: "Uno", firstName: "X", subjects: ["Italiano"], weeklyHours: 18, role: "cattedra", notes: "", color: "#000", assignedClassIds: [] },
    ],
    classes: [{ id: "c1", name: "1ª A", grade: 1, section: "A", students: 18, tempo: "TN" }],
    // giovedì 8 ottobre 2026: la scuola ha lezione alla 1ª e alla 2ª ora
    slots: [
      { id: "s1", day: 4, periodId: "p1", classId: "c1", teacherId: "t1", subject: "Italiano" },
      { id: "s2", day: 4, periodId: "p2", classId: "c1", teacherId: "t1", subject: "Italiano" },
    ],
    absences,
    substitutions: [],
    selectedDate: "2026-10-08",
  } as unknown as PersistedData;
}

function absence(id: string, over: Partial<Absence>): Absence {
  return {
    id,
    teacherId: "t1",
    dateFrom: "2026-10-08",
    dateTo: "2026-10-08",
    reason: "assemblea_sindacale",
    notes: "",
    allDay: false,
    periodIds: ["p1", "p2"],
    ...over,
  };
}

describe("assemblee e permessi brevi a ore", () => {
  it("un'assemblea di due ore vale 2 ore, non un giorno", () => {
    const d = data([absence("a1", {})]);
    const [row] = absencesByReason(d, "2026-09-01", "2027-08-31");
    assert.equal(row.minutes.assemblea_sindacale, 120);
    assert.equal(row.total, 0, "i giorni contano solo i motivi a giorni");
    assert.ok(hasAbsences(row));
  });

  it("si contano le ore segnate anche senza lezione del docente", () => {
    const d = data([absence("a1", { periodIds: ["p3"] })]);
    assert.equal(spanMinutes(reasonSpans(d, "t1", "assemblea_sindacale", "2026-09-01", "2027-08-31")), 60);
  });

  it("la stessa ora segnata due volte conta una volta", () => {
    const d = data([absence("a1", {}), absence("a2", { periodIds: ["p2", "p3"] })]);
    assert.equal(spanMinutes(reasonSpans(d, "t1", "assemblea_sindacale", "2026-09-01", "2027-08-31")), 180);
    assert.equal(spanMinutes(reasonSpans(d, "t1", "assemblea_sindacale", "2026-09-01", "2027-08-31", "a2")), 120);
  });

  it("a giornata intera: le ore di lezione della scuola quel giorno", () => {
    const d = data([]);
    const spans = absenceSpans(d, { dateFrom: "2026-10-08", dateTo: "2026-10-08", allDay: true, periodIds: [] }, "2026-09-01", "2027-08-31");
    assert.equal(spanMinutes(spans), 120);
  });

  it("le ore del pomeriggio valgono i loro minuti; i motivi a giorni restano a giorni", () => {
    const d = data([
      absence("a1", { reason: "permesso_breve", periodIds: ["p3", "p7"] }),
      absence("a2", { reason: "malattia", allDay: true, periodIds: [], dateFrom: "2026-10-09", dateTo: "2026-10-12" }),
    ]);
    const [row] = absencesByReason(d, "2026-09-01", "2027-08-31");
    assert.equal(row.minutes.permesso_breve, 105);
    assert.equal(formatHours(row.minutes.permesso_breve), "1 h 45 min");
    assert.equal(row.byReason.malattia, 2, "venerdì e lunedì");
    assert.equal(row.total, 2);
  });

  it("formatHours", () => {
    assert.equal(formatHours(120), "2");
    assert.equal(formatHours(45), "45 min");
  });
});
