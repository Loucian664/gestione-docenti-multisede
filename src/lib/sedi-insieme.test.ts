import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimetableTeacher } from "./build-timetable.ts";
import { buildSeed } from "./seed.ts";
import { allSedi, editSede, sedeIdOf } from "./sedi.ts";
import { buildInsieme, canBuildTogether, insiemeParts, righeSedi, splitInsieme } from "./sedi-insieme.ts";
import { prepare, solveTimetable, TimetableEditor } from "./timetable-solver.ts";
import type { PersistedData, TimetableSlot } from "./types.ts";

function ticks(): () => number {
  let t = 0;
  return () => t++;
}

const key = (s: TimetableSlot) => `${s.classId}|${s.teacherId}|${s.day}|${s.periodId}|${s.subject}`;

/** Le lezioni di ogni persona, con la sede, per controllare le regole tra sedi senza il motore. */
function personWeek(d: PersistedData, perSede: Record<string, TimetableSlot[]>) {
  const out = new Map<string, { sede: string; day: number; index: number }[]>();
  for (const s of allSedi(d)) {
    const idx = new Map(s.data.settings.periods.map((p) => [p.id, p.index]));
    for (const x of perSede[s.id] ?? []) {
      const t = s.data.teachers.find((y) => y.id === x.teacherId)!;
      const who = t.personId ?? `${s.id}~${t.id}`;
      const list = out.get(who) ?? [];
      list.push({ sede: s.id, day: x.day, index: idx.get(x.periodId)! });
      out.set(who, list);
    }
  }
  return out;
}

function violations(d: PersistedData, perSede: Record<string, TimetableSlot[]>) {
  let clash = 0;
  let travel = 0;
  let changes = 0;
  for (const list of personWeek(d, perSede).values()) {
    for (const day of new Set(list.map((x) => x.day))) {
      const today = list.filter((x) => x.day === day).sort((a, b) => a.index - b.index);
      let n = 0;
      for (let i = 1; i < today.length; i++) {
        if (today[i]!.index === today[i - 1]!.index) clash += 1;
        else if (today[i]!.sede !== today[i - 1]!.sede) {
          n += 1;
          if (today[i]!.index - today[i - 1]!.index < 2) travel += 1;
        }
      }
      if (n > 1) changes += n - 1;
    }
  }
  return { clash, travel, changes };
}

/** Lezioni del mattino dei docenti di materia di ogni sede, nell'orario in uso. */
function morningLessons(d: PersistedData): Record<string, TimetableSlot[]> {
  const out: Record<string, TimetableSlot[]> = {};
  for (const s of allSedi(d)) {
    const morning = new Set(s.data.settings.periods.filter((p) => !p.tpOnly).map((p) => p.id));
    const pool = new Set(s.data.teachers.filter(isTimetableTeacher).map((t) => t.id));
    out[s.id] = s.data.slots.filter((x) => pool.has(x.teacherId) && morning.has(x.periodId));
  }
  return out;
}

describe("tutte le sedi insieme", () => {
  it("si costruiscono insieme solo sedi con gli stessi giorni e le stesse ore del mattino", () => {
    const d = buildSeed();
    assert.equal(canBuildTogether(d).ok, true);
    const b = allSedi(d)[1]!;
    const sabato = editSede(d, b.id, (s) => ({ ...s, settings: { ...s.settings, days: [1, 2, 3, 4, 5, 6] } }));
    assert.equal(canBuildTogether(sabato).ok, false);
    const settima = editSede(d, b.id, (s) => ({
      ...s,
      settings: { ...s.settings, periods: [...s.settings.periods, { id: "p7x", index: 7, label: "7ª ora", start: "14:00", end: "14:55" }] },
    }));
    assert.equal(canBuildTogether(settima).ok, false);
  });

  it("un docente in comune è una persona sola; le classi tengono la loro sede", () => {
    const d = buildSeed();
    const { joint, map } = buildInsieme(d);
    const sedi = allSedi(d);
    assert.equal(joint.classes.length, sedi.reduce((n, s) => n + s.data.classes.length, 0));
    const records = sedi.reduce((n, s) => n + s.data.teachers.length, 0);
    assert.equal(joint.teachers.length, records - 4);
    const fra = joint.teachers.find((t) => t.id === "P~p-esempio-fra")!;
    assert.equal(fra.weeklyHours, 12 + 6);
    assert.equal(map.recordOf.get(fra.id)?.size, 2);
    assert.deepEqual(joint.insieme.sedi, sedi.map((s) => s.data.settings.schoolName));
    for (const c of joint.classes) assert.equal(joint.insieme.classSede[c.id], sedi.findIndex((s) => c.id.startsWith(`${s.id}~`)));
  });

  it("l'orario attuale, diviso di nuovo per sede, è quello di partenza", () => {
    const d = buildSeed();
    const { joint, map } = buildInsieme(d);
    const back = splitInsieme(map, joint.slots);
    for (const s of allSedi(d)) {
      assert.deepEqual(
        back[s.id]!.map(key).sort(),
        s.data.slots.map(key).sort(),
      );
    }
  });

  it("la proposta rispetta le regole tra sedi: mai due sedi insieme, ora libera, un cambio al giorno", () => {
    const d = buildSeed();
    const { joint, map } = buildInsieme(d);
    const res = solveTimetable(joint, { timeMs: 3000, seed: 7, now: ticks() });
    const perSede = splitInsieme(map, res.slots);
    const v = violations(d, perSede);
    assert.equal(v.clash, 0);
    assert.equal(v.travel, res.report.hard.travel.filter((x) => x.text.includes("senza un'ora libera")).length);
    assert.equal(v.travel, 0);
    assert.equal(v.changes, 0);
    // tutte le ore delle cattedre messe
    assert.equal(res.slots.length, prepare(joint, "demand").U);
  });

  it("le × di una sede valgono solo lì: il docente può insegnare nell'altra", () => {
    const base = buildSeed();
    const idA = sedeIdOf(base);
    // francese: lunedì tutto il giorno × nella prima sede
    const d = editSede(base, idA, (s) => ({
      ...s,
      teachers: s.teachers.map((t) =>
        t.id === "t-fra-1"
          ? { ...t, awaySlots: s.settings.periods.filter((p) => !p.tpOnly).map((p) => ({ day: 1 as const, periodId: p.id })) }
          : t,
      ),
    }));
    const { joint, map } = buildInsieme(d);
    assert.equal(joint.teachers.find((t) => t.id === "P~p-esempio-fra")!.awaySlots!.length, 0);
    assert.equal(joint.insieme.sedeAway["P~p-esempio-fra"]!.length, 6);
    const res = solveTimetable(joint, { timeMs: 3000, seed: 3, now: ticks() });
    const perSede = splitInsieme(map, res.slots);
    assert.ok(!perSede[idA]!.some((s) => s.teacherId === "t-fra-1" && s.day === 1));
  });

  it("per ogni sede: lezioni nuove e ore a disposizione da salvare", () => {
    const d = buildSeed();
    const parts = insiemeParts(d, morningLessons(d), "improve");
    for (const s of allSedi(d)) {
      assert.equal(parts[s.id]!.lessons.length, morningLessons(d)[s.id]!.length);
      assert.ok(parts[s.id]!.disp);
    }
  });

  it("ritocchi su tutte le sedi: «Trova» propone catene tra sedi e rispetta le regole tra sedi", () => {
    const d = buildSeed();
    const { joint, map } = buildInsieme(d);
    const before = violations(d, splitInsieme(map, joint.slots));
    const days = [...joint.settings.days].sort((a, b) => a - b);
    const ed = new TimetableEditor(joint);
    const p = ed.prep;
    const sedeOf = (classId: string) => classId.split("~")[0];
    let cross = 0;
    let options = 0;
    for (const s of joint.slots.filter((x) => x.teacherId === "P~p-esempio-fra").slice(0, 5)) {
      const m = p.morningPos.indexOf(joint.settings.periods.findIndex((q) => q.id === s.periodId));
      if (m < 0) continue;
      const gen = new TimetableEditor(joint).findFixes({ kind: "lesson", classId: s.classId, z: days.indexOf(s.day) * p.M + m }, 60_000);
      let r = gen.next();
      while (!r.done) r = gen.next();
      for (const opt of r.value.options) {
        options += 1;
        if (new Set(opt.steps.map((st) => sedeOf(st.classId))).size > 1) cross += 1;
        const e2 = new TimetableEditor(joint);
        let out: ReturnType<TimetableEditor["apply"]> = null;
        for (const st of opt.steps) out = e2.apply(st.classId, st.from, st.to);
        const after = violations(d, splitInsieme(map, out!.slots));
        assert.ok(after.clash <= before.clash && after.travel <= before.travel && after.changes <= before.changes);
      }
    }
    assert.ok(options > 0);
    assert.ok(cross > 0, "nessuna proposta con mosse in due sedi");
  });

  it("vista Giorno: le sedi in file, in ordine, meno file possibile e il più pari possibile", () => {
    const sizes = [6, 6, 3, 3, 1, 1];
    // schermo largo: tutte in una fila
    assert.deepEqual(righeSedi(sizes, 20), [[0, 1, 2, 3, 4, 5]]);
    // 12 classi per fila: due file da 12 e 8
    assert.deepEqual(righeSedi(sizes, 12), [[0, 1], [2, 3, 4, 5]]);
    // 9 per fila: tre file, la più larga da 8 (non 6 | 6+3 | 3+1+1)
    assert.deepEqual(righeSedi(sizes, 9), [[0], [1], [2, 3, 4, 5]]);
    // telefono: una sede troppo larga sta da sola; le piccole insieme
    assert.deepEqual(righeSedi(sizes, 2), [[0], [1], [2], [3], [4, 5]]);
    assert.deepEqual(righeSedi([], 5), []);
  });
});
