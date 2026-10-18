import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimetableTeacher } from "./build-timetable.ts";
import { buildSeed } from "./seed.ts";
import { allSedi, editSede, sedeIdOf, switchSede, withOtherSedi } from "./sedi.ts";
import {
  buildInsieme,
  canBuildTogether,
  insiemeParts,
  insiemeSlot,
  insiemeSlotData,
  righeSedi,
  splitInsieme,
  withInsiemeParts,
} from "./sedi-insieme.ts";
import { snapshot, useAppStore } from "./store.ts";
import {
  evaluateCurrent,
  finishResult,
  prepare,
  solveTimetable,
  TimetableEditor,
  TimetableSolver,
  type TimetableReport,
} from "./timetable-solver.ts";
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

/** Le voci dei docenti e delle classi (quelle che si sommano sede per sede) e i vincoli rigidi. */
function voci(r: TimetableReport) {
  return {
    buche: r.gapsTotal,
    span6: r.docenti.span6.length,
    sei: r.docenti.six.length,
    cinque: r.docenti.five.length,
    dueBuche: r.docenti.multiGap.length,
    unOra: r.docenti.single.length,
    pesanti: r.didattica.heavy.length,
    vincoli: Object.values(r.hard).reduce((n, l) => n + l.length, 0),
  };
}

/** Ogni sede contata come la conta la sua app (le ore nelle altre sedi sono ×), sommata. */
function sommaSedi(d: PersistedData) {
  const out = voci(evaluateCurrent(withOtherSedi(d)));
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = 0;
  for (const s of allSedi(d)) {
    const v = voci(evaluateCurrent(withOtherSedi(switchSede(d, s.id))));
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += v[k];
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

  it("tutte le sedi insieme contano come la somma delle sedi, ognuna come nella sua app", () => {
    const d = buildSeed();
    assert.deepEqual(voci(evaluateCurrent(buildInsieme(d).joint)), sommaSedi(d));
    // anche la proposta, con le ore a disposizione sistemate sede per sede
    const { joint, map } = buildInsieme(d);
    const res = solveTimetable(joint, { timeMs: 3000, seed: 5, now: ticks() });
    const after = withInsiemeParts(d, insiemeParts(d, splitInsieme(map, res.slots), "scratch"));
    assert.deepEqual(voci(evaluateCurrent(buildInsieme(after).joint)), sommaSedi(after));
  });

  it("l'ora per spostarsi tra due sedi non è un'ora buca; senza, è un vincolo non rispettato", () => {
    const d = buildSeed();
    const { joint } = buildInsieme(d);
    const fra = "P~p-esempio-fra";
    const [idA, idB] = allSedi(d).map((s) => s.id) as [string, string];
    const clsA = joint.slots.find((s) => s.teacherId === fra && s.classId.startsWith(`${idA}~`))!.classId;
    const clsB = joint.slots.find((s) => s.teacherId === fra && s.classId.startsWith(`${idB}~`))!.classId;
    // lunedì: 1ª e 2ª nella prima sede, 4ª nella seconda (la 3ª per spostarsi)
    const day = d.settings.days[0]!;
    const busy = (cls: string, p: string) => (s: TimetableSlot) => s.day === day && s.classId === cls && s.periodId === p;
    const monday = (pB: string): PersistedData => {
      const free = [busy(clsA, "j1"), busy(clsA, "j2"), busy(clsB, pB)];
      const slots = joint.slots.filter((s) => !(s.teacherId === fra && s.day === day) && !free.some((f) => f(s)));
      const add = (classId: string, periodId: string) => ({ id: `x-${classId}-${periodId}`, day, periodId, classId, teacherId: fra, subject: "Francese" });
      return { ...joint, slots: [...slots, add(clsA, "j1"), add(clsA, "j2"), add(clsB, pB)] };
    };
    const ok = evaluateCurrent(monday("j4"));
    const g = ok.gapsByTeacher.find((x) => x.id === fra);
    assert.ok(!g?.cells.some((c) => c.day === day && c.periodId === "j3"), "la 3ª è l'ora di spostamento, non una buca");
    assert.ok(!ok.hard.travel.some((x) => x.text.includes("senza un'ora libera")));
    const ko = evaluateCurrent(monday("j3"));
    const travel = ko.hard.travel.find((x) => x.text.includes("senza un'ora libera"));
    assert.ok(travel, "dalla 2ª alla 3ª in un'altra sede manca l'ora per spostarsi");
    // il vincolo dice di chi è e in quali ore
    assert.ok(travel.cells?.some((c) => c.teacherId === fra && c.periodId === "j3"));
  });

  it("le ore a disposizione di chi è in più sedi restano nella loro sede, mai dove insegna altrove", () => {
    const base = buildSeed();
    const idB = allSedi(base)[1]!.id;
    // francese: 2 ore a disposizione nella seconda sede, lunedì 1ª e 2ª
    const d = editSede(base, idB, (s) => ({
      ...s,
      teachers: s.teachers.map((t) =>
        t.id === "tb-fra-1"
          ? { ...t, dispHours: 2, dispSlots: [{ day: 1 as const, periodId: "p1" }, { day: 1 as const, periodId: "p2" }] }
          : t,
      ),
    }));
    const { joint, map } = buildInsieme(d);
    const res = solveTimetable(joint, { timeMs: 3000, seed: 9, now: ticks() });
    const after = withInsiemeParts(d, insiemeParts(d, splitInsieme(map, res.slots), "scratch"));
    for (const s of allSedi(after)) {
      const r = evaluateCurrent(withOtherSedi(switchSede(after, s.id)));
      const bad = [...r.hard.away, ...r.hard.travel, ...r.hard.conflicts].filter((x) => x.text.startsWith("Marino"));
      assert.deepEqual(bad, [], `${s.data.settings.schoolName}: ${bad.map((x) => x.text).join("; ")}`);
    }
    const tb = allSedi(after)[1]!.data.teachers.find((t) => t.id === "tb-fra-1")!;
    assert.equal(tb.dispSlots?.length, 2);
  });

  it("ricerca in parallelo: a fine giro si riparte dalla migliore di tutte", () => {
    const d = buildSeed();
    const { joint } = buildInsieme(d);
    const prep = prepare(joint, "demand");
    const clock = ticks();
    const solvers = [3, 4].map((seed) => {
      const x = new TimetableSolver(prep, seed);
      x.syncCycles = true;
      x.startRun(6000, "scratch");
      return x;
    });
    let syncs = 0;
    const done = [false, false];
    while (done.some((x) => !x)) {
      solvers.forEach((x, i) => {
        if (!done[i] && !x.waiting) done[i] = x.step(100, clock);
      });
      if (solvers.every((x, i) => done[i] || x.waiting) && solvers.some((x) => x.waiting)) {
        const [a, b] = solvers.map((x) => x.bestScore());
        const best = a!.hard < b!.hard || (a!.hard === b!.hard && a!.soft <= b!.soft) ? solvers[0]! : solvers[1]!;
        const cells = best.bestCells();
        const score = best.bestScore();
        for (const x of solvers) {
          if (!x.waiting) continue;
          x.adopt(cells);
          // la migliore di tutte è anche la sua (il punteggio rifatto da capo può differire negli ultimi decimali)
          const mine = x.bestScore();
          assert.equal(mine.hard, score.hard);
          assert.equal(mine.pen, score.pen);
          assert.ok(Math.abs(mine.soft - score.soft) < 1e-6);
        }
        syncs += 1;
      }
    }
    assert.ok(syncs >= 2, `giri ${syncs}`);
    for (const x of solvers) assert.equal(finishResult(x, prep).slots.length, prep.U);
  });

  it("slot salvato per tutte le sedi: si riconosce, si riapre con tutte le sedi, si usa e si svuota in tutte", () => {
    useAppStore.getState().resetDemo();
    const st = () => useAppStore.getState();
    const d = snapshot(st());
    const parts = insiemeParts(d, splitInsieme(buildInsieme(d).map, buildInsieme(d).joint.slots), "improve");
    st().saveTimetableAll(2, parts, "Prova insieme");
    let now = snapshot(st());
    assert.deepEqual(insiemeSlot(now, 2), { name: "Prova insieme" });
    const codes = allSedi(now).map((s) => s.data.savedTimetables?.find((x) => x.n === 2)?.insieme);
    assert.ok(codes[0] && codes.every((c) => c === codes[0]));
    // riaperto: ogni sede ha il suo slot 2
    const opened = insiemeSlotData(now, 2);
    for (const s of allSedi(opened)) assert.ok(s.data.slots.length > 0);
    // il nome cambia in tutte le sedi
    st().renameSavedTimetableAll(2, "Rinominato");
    now = snapshot(st());
    assert.deepEqual(insiemeSlot(now, 2), { name: "Rinominato" });
    st().activateSlotAll(2);
    now = snapshot(st());
    assert.deepEqual(allSedi(now).map((s) => s.data.activeSlot), [2, 2]);
    // rimane di tutte le sedi anche in uso
    assert.ok(insiemeSlot(now, 2));
    st().activateSlotAll(0);
    st().clearSavedTimetableAll(2);
    now = snapshot(st());
    assert.ok(allSedi(now).every((s) => !s.data.savedTimetables?.some((x) => x.n === 2)));
    // uno slot salvato in una sede sola non è di tutte le sedi
    st().saveTimetableAll(3, parts, "Insieme");
    st().saveTimetable({ n: 3, name: "Solo qui", savedAt: Date.now(), ...parts[sedeIdOf(snapshot(st()))]! });
    assert.equal(insiemeSlot(snapshot(st()), 3), null);
    st().resetDemo();
  });

  it("«Rendi in vigore» per tutte le sedi si annulla in tutte le sedi", () => {
    useAppStore.getState().resetDemo();
    const st = () => useAppStore.getState();
    const d = snapshot(st());
    const before = allSedi(d).map((s) => s.data.slots.length);
    const parts = insiemeParts(d, splitInsieme(buildInsieme(d).map, buildInsieme(d).joint.slots), "improve");
    st().saveTimetableAll(4, parts, "Da usare");
    st().makeOfficialAll(4);
    let now = snapshot(st());
    assert.ok(allSedi(now).every((s) => s.data.officialBackup?.insieme));
    st().undoMakeOfficial();
    now = snapshot(st());
    assert.ok(allSedi(now).every((s) => !s.data.officialBackup));
    assert.deepEqual(allSedi(now).map((s) => s.data.slots.length), before);
    st().resetDemo();
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
