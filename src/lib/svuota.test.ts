import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "./seed.ts";
import { frozenCattedre, timetableDemand } from "./build-timetable.ts";
import type { PersistedData } from "./types.ts";

/** Ore da costruire per docente. */
function hoursByTeacher(data: PersistedData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of timetableDemand(data).lessons) out[l.teacherId] = (out[l.teacherId] ?? 0) + l.hours;
  return out;
}

describe("«Svuota orario» e cattedre", () => {
  it("le cattedre ricavate dall’orario restano uguali anche senza lezioni", () => {
    const data = { ...buildSeed(), cattedre: [] };
    const frozen = frozenCattedre(data);
    assert.ok(frozen && frozen.length > 0);
    const emptied = { ...data, slots: [], cattedre: frozen };
    assert.deepEqual(hoursByTeacher(emptied), hoursByTeacher(data));
    // senza le cattedre scritte, a orario vuoto le ore andrebbero a un docente solo per materia
    assert.notDeepEqual(hoursByTeacher({ ...data, slots: [] }), hoursByTeacher(data));
  });

  it("le cattedre già salvate non cambiano; se lo sono tutte non c’è niente da scrivere", () => {
    const data = buildSeed();
    const all = frozenCattedre({ ...data, cattedre: [] })!;
    assert.equal(frozenCattedre({ ...data, cattedre: all }), null);
    const firstClass = all[0]!.classId;
    const mine = all.filter((c) => c.classId === firstClass).map((c) => ({ ...c, hours: c.hours + 1 }));
    const out = frozenCattedre({ ...data, cattedre: mine })!;
    assert.deepEqual(out.filter((c) => c.classId === firstClass), mine);
  });
});
