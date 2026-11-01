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

describe("«Svuota orario»: che cosa resta", () => {
  it("restano sostegno e ore del pomeriggio; Costruisci rimette le lezioni del mattino dei docenti di materia", async () => {
    const { builtLessonTest, fixedKinds, fixedKindsNote, stayText } = await import("./svuota.ts");
    const data = buildSeed();
    const t = data.teachers.find((x) => x.role !== "sostegno" && x.role !== "potenziamento")!;
    const sost = { ...t, id: "t-sost", role: "sostegno" as const };
    const base = {
      ...data,
      teachers: [...data.teachers, sost],
      settings: { ...data.settings, periods: [...data.settings.periods, { id: "p7", label: "7ª ora", index: 99, tpOnly: true } as never] },
    };
    const isBuilt = builtLessonTest(base);
    const lesson = { id: "x", day: 1, periodId: "p1", classId: "c", teacherId: t.id, subject: "Italiano" } as never;
    assert.equal(isBuilt(lesson), true);
    assert.equal(isBuilt({ ...(lesson as object), periodId: "p7" } as never), false);
    assert.equal(isBuilt({ ...(lesson as object), teacherId: "t-sost" } as never), false);
    const kinds = fixedKinds(base, [{ ...(lesson as object), periodId: "p7" } as never, { ...(lesson as object), teacherId: "t-sost" } as never]);
    assert.deepEqual(kinds, ["sostegno", "ore del pomeriggio"]);
    assert.equal(fixedKindsNote(kinds), "Sostegno e ore del pomeriggio: andrebbero rimesse a mano.");
    assert.equal(stayText(61, 1), "Restano 61 ore che Costruisci non rimette e 1 ora bloccata.");
    assert.equal(stayText(1, 0), "Resta 1 ora che Costruisci non rimette.");
    assert.equal(stayText(0, 0), "");
  });
});
