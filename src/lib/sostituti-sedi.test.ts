import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoAssignPlan, coverageNeeds, dayCoverage, doubleCovers, rankSubstitutes } from "./coverage.ts";
import { buildSeed } from "./seed.ts";
import { editSede, substituteElsewhere } from "./sedi.ts";
import type { PersistedData } from "./types.ts";

const MON = "2026-11-02";
const WED = "2026-11-04";

/** La sede in uso con una persona in comune con l'altra sede (t-fra-1 qui, tb-fra-1 là) e una sede B nota. */
function setup() {
  return { data: buildSeed() };
}

function absenceOf(teacherId: string, date: string) {
  return { id: `a-${teacherId}-${date}`, teacherId, dateFrom: date, dateTo: date, reason: "malattia" as const, notes: "", allDay: true, periodIds: [] };
}

/** La prima ora del giorno in cui la persona non ha lezione né disposizione nella sede B. */
function freeCellInB(data: PersistedData, day: number) {
  const b = data.altreSedi!.find((s) => s.id === "sede-esempio-b")!.data;
  const busy = new Set([
    ...b.slots.filter((s) => s.teacherId === "tb-fra-1").map((s) => `${s.day}|${s.periodId}`),
    ...(b.teachers.find((t) => t.id === "tb-fra-1")?.dispSlots ?? []).map((d) => `${d.day}|${d.periodId}`),
  ]);
  const p = b.settings.periods.find((x) => !busy.has(`${day}|${x.id}`));
  assert.ok(p, "serve un'ora libera");
  return p.id;
}

describe("sostituti che lavorano anche in un'altra sede", () => {
  it("chi ha lezione in un'altra sede alla stessa ora risulta occupato, gli altri liberi", () => {
    const { data } = setup();
    const check = substituteElsewhere(data);
    // lunedì alla 1ª ora t-fra-1 ha lezione in 1ª A della sede B
    assert.match(check("t-fra-1", MON, "p1")!, /^In .* · 1ª A$/);
    // un docente senza scheda nell'altra sede non è mai «altrove»
    const solo = data.teachers.find((t) => !t.personId)!;
    assert.equal(check(solo.id, MON, "p1"), null);
    // senza lezione lì in quell'ora: libero
    const free = freeCellInB(data, 1);
    assert.equal(check("t-fra-1", MON, free), null);
  });

  it("nell'elenco dei sostituti va in «altrove», con la sede, e l'assegnazione automatica non lo sceglie", () => {
    const { data } = setup();
    const absent = data.slots.find((s) => s.day === 1 && s.periodId === "p1" && s.teacherId !== "t-fra-1")!.teacherId;
    const d: PersistedData = { ...data, absences: [absenceOf(absent, MON)], selectedDate: MON };
    const need = coverageNeeds(d, MON).find((n) => n.slot.periodId === "p1")!;
    const check = substituteElsewhere(d);
    const row = rankSubstitutes(d, need, undefined, check).find((r) => r.teacher.id === "t-fra-1")!;
    assert.equal(row.bucket, "altrove");
    assert.match(row.busyLabel!, /^In /);
    // senza il controllo l'app non sapeva dell'altra sede
    const blind = rankSubstitutes(d, need).find((r) => r.teacher.id === "t-fra-1")!;
    assert.notEqual(blind.bucket, "altrove");
    assert.ok(autoAssignPlan(d, MON, check).every((p) => p.substituteId !== "t-fra-1"));
  });

  it("sostituire o essere assenti nell'altra sede, nella stessa ora, lo rende occupato", () => {
    const { data } = setup();
    const free = freeCellInB(data, 3);
    const withSub = editSede(data, "sede-esempio-b", (b) => ({
      ...b,
      substitutions: [
        ...b.substitutions,
        { id: "sb", date: WED, periodId: free, classId: b.classes[0]!.id, absentTeacherId: "tb-x", substituteId: "tb-fra-1", type: "disposizione", activity: "", notes: "", subject: "Italiano" },
      ],
    }));
    assert.match(substituteElsewhere(withSub)("t-fra-1", WED, free)!, /^Sostituisce in .* · /);
    // un altro giorno non conta
    assert.equal(substituteElsewhere(withSub)("t-fra-1", "2026-11-11", free), null);
    const absent = editSede(data, "sede-esempio-b", (b) => ({ ...b, absences: [...b.absences, absenceOf("tb-fra-1", WED)] }));
    assert.match(substituteElsewhere(absent)("t-fra-1", WED, free)!, /^Assente in /);
  });

  it("un doppio incarico con l'altra sede già inserito è segnalato nel giorno", () => {
    const { data } = setup();
    const absent = data.slots.find((s) => s.day === 1 && s.periodId === "p1" && s.teacherId !== "t-fra-1")!;
    const d: PersistedData = {
      ...data,
      absences: [absenceOf(absent.teacherId, MON)],
      substitutions: [
        { id: "s1", date: MON, periodId: "p1", classId: absent.classId, absentTeacherId: absent.teacherId, substituteId: "t-fra-1", type: "disposizione", activity: "", notes: "", subject: absent.subject },
      ],
      selectedDate: MON,
    };
    const check = substituteElsewhere(d);
    const needs = coverageNeeds(d, MON);
    assert.equal(doubleCovers(needs).size, 0);
    const doubles = doubleCovers(needs, check);
    assert.equal(doubles.size, 1);
    assert.match([...doubles.values()][0]!.elsewhere!, /^In /);
    assert.equal(dayCoverage(d, MON, check).doubled, 1);
    assert.equal(dayCoverage(d, MON).doubled, 0);
  });
});
