import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cattedreOfTeacher, isTimetableTeacher, timetableDemand } from "./build-timetable.ts";
import { backupJson, parseBackupJson } from "./export.ts";
import { encodePersist, mergeSlices, shouldAcceptWrite } from "./persist-storage.ts";
import {
  addSede,
  allSedi,
  blockingGroups,
  canRemoveRecord,
  canRemoveSede,
  cattedraTotal,
  classInUse,
  dropRemovedSede,
  editSede,
  elsewhereCells,
  exportSede,
  importSede,
  linkedElsewhere,
  missingBySede,
  nameMatches,
  newSedeData,
  persons,
  pickSede,
  removeSede,
  removedSediIssues,
  saveTeacherSedi,
  sedeAsData,
  sedeContents,
  sedeIdOf,
  sedeName,
  setSchoolYear,
  setTeacherSedi,
  switchSede,
  syncPersonFields,
  withOtherSedi,
} from "./sedi.ts";
import { buildSeed, EMPTY_DATA } from "./seed.ts";
import { buildInsieme } from "./sedi-insieme.ts";
import { snapshot, useAppStore } from "./store.ts";
import { evaluateCurrent, solveTimetable, TimetableEditor } from "./timetable-solver.ts";
import type { PersistedData, SedeData, Substitution, Teacher } from "./types.ts";

/** Senza le voci vuote (undefined), come nel salvataggio. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function ticks(): () => number {
  let t = 0;
  return () => t++;
}

/** Le due sedi degli esempi: la seconda ha francese, tecnologia, musica e religione in comune. */
const seed = () => buildSeed();
const other = (d: PersistedData) => d.altreSedi![0]!;

function teacher(id: string, lastName: string, firstName: string, extra: Partial<Teacher> = {}): Teacher {
  return {
    id,
    lastName,
    firstName,
    subjects: ["Francese"],
    weeklyHours: 6,
    role: "cattedra",
    notes: "",
    color: "",
    assignedClassIds: [],
    ...extra,
  };
}

describe("sedi: cambio e modifica", () => {
  it("gli esempi hanno due sedi, la prima in uso", () => {
    const d = seed();
    const sedi = allSedi(d);
    assert.equal(sedi.length, 2);
    assert.equal(sedi[0]!.active, true);
    assert.equal(sedeName(sedi[0]!.data.settings), "Sede A (esempio)");
    assert.equal(sedeName(sedi[1]!.data.settings), "Sede B (esempio)");
  });

  it("cambiando sede e tornando indietro i dati restano identici", () => {
    const d = seed();
    const a = pickSede(d);
    const b = other(d).data;
    const there = switchSede(d, other(d).id);
    assert.equal(sedeIdOf(there), other(d).id);
    assert.deepEqual(plain(pickSede(there)), plain(b));
    // l'ordine delle sedi non cambia con quella in uso
    assert.deepEqual(
      allSedi(there).map((s) => s.id),
      allSedi(d).map((s) => s.id),
    );
    const back = switchSede(there, sedeIdOf(d));
    assert.deepEqual(plain(pickSede(back)), plain(a));
    assert.deepEqual(plain(back.altreSedi?.[0]?.data), plain(b));
  });

  it("una sede non in uso si modifica senza toccare quella in uso", () => {
    const d = seed();
    const before = pickSede(d);
    const next = editSede(d, other(d).id, (s) => ({ ...s, settings: { ...s.settings, responsabile: "Esempio Uno" } }));
    assert.deepEqual(plain(pickSede(next)), plain(before));
    assert.equal(other(next).data.settings.responsabile, "Esempio Uno");
  });

  it("una sede nuova copia giorni e campanella ma parte vuota", () => {
    const d = { ...seed(), settings: { ...seed().settings, days: [1, 2, 3, 4, 5, 6] as PersistedData["settings"]["days"] } };
    const sede = newSedeData(d.settings, "Sede C");
    assert.equal(sede.settings.schoolName, "Sede C");
    assert.equal(sede.settings.responsabile, "");
    assert.deepEqual(sede.settings.days, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(sede.settings.periods, d.settings.periods);
    assert.notEqual(sede.settings.periods, d.settings.periods);
    assert.equal(sede.classes.length + sede.teachers.length + sede.slots.length, 0);
    const { data: next, id } = addSede(d, sede);
    assert.deepEqual(
      allSedi(next).map((s) => s.id),
      [...allSedi(d).map((s) => s.id), id],
    );
  });

  it("si elimina ogni sede tranne l'ultima, anche con le sue classi", () => {
    const d = seed();
    const b = other(d);
    assert.equal(canRemoveSede(d, b.id), true);
    // l'avviso dice cosa si perde; i docenti in comune restano nell'altra sede
    const info = sedeContents(d, b.id)!;
    assert.equal(info.classes, b.data.classes.length);
    assert.equal(info.lessons, b.data.slots.length);
    assert.equal(info.shared, 4);
    assert.equal(info.teachers, b.data.teachers.length - 4);
    // a parte le ore dei docenti in comune nella sede eliminata, l'altra sede resta com'era
    const untraced = (x: SedeData) => ({ ...x, teachers: x.teachers.map(({ removedSedi: _r, ...t }) => t) });
    const noB = removeSede(d, b.id);
    assert.equal(allSedi(noB).length, 1);
    assert.equal(allSedi(noB)[0]!.data.teachers.length, d.teachers.length);
    assert.deepEqual(plain(untraced(pickSede(noB))), plain(pickSede(d)));
    // eliminando la sede in uso si passa all'altra
    const noA = removeSede(d, sedeIdOf(d));
    assert.equal(sedeIdOf(noA), b.id);
    assert.deepEqual(plain(untraced(pickSede(noA))), plain(b.data));
    const { data: withC, id } = addSede(d, newSedeData(d.settings, "Sede C"));
    assert.equal(canRemoveSede(withC, id), true);
    assert.equal(allSedi(removeSede(withC, id)).length, 2);
    // la sede in uso si elimina passando a un'altra
    const inC = switchSede(withC, id);
    const gone = removeSede(inC, id);
    assert.notEqual(sedeIdOf(gone), id);
    assert.equal(allSedi(gone).length, 2);
    const alone: PersistedData = { ...EMPTY_DATA, altreSedi: [] };
    assert.equal(canRemoveSede(alone, sedeIdOf(alone)), false);
  });

  it("eliminando una sede i docenti in comune conservano le sue ore: l'orario aspetta le ×", () => {
    const d = seed();
    const b = other(d);
    const name = sedeName(b.data.settings);
    const after = removeSede(d, b.id, "2026-10-18");
    const fra = after.teachers.find((t) => t.id === "t-fra-1")!;
    assert.deepEqual(fra.removedSedi, [{ name, hours: 6, removedOn: "2026-10-18" }]);
    assert.ok(!after.teachers.find((t) => t.id === "t-ita-1")!.removedSedi);
    // con una sede sola resta «Su più plessi», così le × hanno l'ora di spostamento
    assert.equal(withOtherSedi(after).teachers.find((t) => t.id === "t-fra-1")!.otherPlesso, true);
    const pool = (x: PersistedData) => x.teachers.filter(isTimetableTeacher);
    assert.deepEqual(
      removedSediIssues(pool(after)).map((x) => [x.teacher.id, x.hours, x.marked]).sort(),
      [["t-fra-1", 6, 0], ["t-mus-1", 6, 0], ["t-rel-1", 3, 0], ["t-tec-1", 6, 0]],
    );
    // con le × che bastano l'avviso si spegne
    const morning = d.settings.periods.filter((p) => !p.tpOnly);
    const marked: PersistedData = {
      ...after,
      teachers: after.teachers.map((t) =>
        t.id === "t-fra-1" ? { ...t, awaySlots: morning.map((p) => ({ day: 1 as const, periodId: p.id })) } : t,
      ),
    };
    assert.ok(!removedSediIssues(pool(marked)).some((x) => x.teacher.id === "t-fra-1"));
    // «Non insegna più lì»
    const dropped = dropRemovedSede(after, fra.personId!, name);
    assert.equal(dropped.teachers.find((t) => t.id === "t-fra-1")!.removedSedi, undefined);
    assert.equal(removedSediIssues(pool(dropped)).length, 3);
    // con tutte le sedi insieme le ore della sede eliminata restano per chi è in una sede sola
    const { data: three } = addSede(d, newSedeData(d.settings, "Sede C"));
    const noB = removeSede(three, b.id, "2026-10-18");
    assert.equal(allSedi(noB).length, 2);
    assert.equal(buildInsieme(noB).joint.teachers.find((t) => t.id === "P~p-esempio-fra")!.otherPlesso, true);
  });

  it("l'anno scolastico vale per tutte le sedi", () => {
    const next = setSchoolYear(seed(), "2027/2028");
    assert.ok(allSedi(next).every((s) => s.data.settings.schoolYear === "2027/2028"));
  });

  it("una classe con lezioni non si sposta", () => {
    const d = seed();
    const a = pickSede(d);
    assert.equal(classInUse(a, a.classes[0]!.id), true);
    const empty: SedeData = { ...a, classes: [...a.classes, { id: "c-nuova", name: "1ª Z", grade: 1, section: "Z", students: 0, tempo: "TN" }] };
    assert.equal(classInUse(empty, "c-nuova"), false);
  });
});

describe("sedi: docenti in comune", () => {
  it("riconosce le schede della stessa persona nelle altre sedi", () => {
    const d = seed();
    const fra = d.teachers.find((t) => t.id === "t-fra-1")!;
    const links = linkedElsewhere(d, fra);
    assert.equal(links.length, 1);
    assert.equal(links[0]!.teacher.lastName, fra.lastName);
    const solo = d.teachers.find((t) => t.id === "t-ita-1")!;
    assert.equal(linkedElsewhere(d, solo).length, 0);
  });

  it("nell'elenco dei docenti chi insegna in due sedi è una riga sola", () => {
    const d = seed();
    const rows = persons(d);
    const fra = rows.find((r) => r.records.some((x) => x.teacher.id === "t-fra-1"))!;
    assert.equal(fra.records.length, 2);
    assert.deepEqual(
      fra.records.map((x) => x.hours),
      [12, 6],
    );
    const total = allSedi(d).reduce((n, s) => n + s.data.teachers.length, 0);
    assert.equal(rows.length, total - 4);
  });

  it("strumento: percussioni, clarinetto e violino senza orario; in due sedi le ore della scheda di ognuna", () => {
    for (const subject of ["Percussioni", "Clarinetto", "Violino", "Chitarra", "Strumento musicale"])
      assert.equal(isTimetableTeacher({ ...seed().teachers[0]!, subjects: [subject] }), false, subject);
    const base = seed();
    const idB = allSedi(base)[1]!.id;
    const strumento = (id: string, hours: number): Teacher => ({
      ...base.teachers[0]!,
      id,
      firstName: "Nora",
      lastName: "Fittizia",
      subjects: ["Violino"],
      weeklyHours: hours,
      personId: "p-violino",
      assignedClassIds: [],
      cardRows: [],
    });
    let d = { ...base, teachers: [...base.teachers, strumento("t-vio-1", 9)] };
    d = editSede(d, idB, (s) => ({ ...s, teachers: [...s.teachers, strumento("tb-vio-1", 9)] }));
    const row = persons(d).find((r) => r.records.some((x) => x.teacher.id === "t-vio-1"))!;
    assert.deepEqual(row.records.map((x) => x.hours), [9, 9]);
  });

  it("le ore nell'altra sede diventano × della sede in uso, senza toccare le × messe a mano", () => {
    const d = seed();
    const fra = d.teachers.find((t) => t.id === "t-fra-1")!;
    const cells = elsewhereCells(d, fra);
    const lessonsB = other(d).data.slots.filter((s) => s.teacherId === "tb-fra-1");
    assert.equal(cells.length, lessonsB.length);
    assert.ok(cells.every((c) => c.sedeName === "Sede B (esempio)"));
    const manual = { day: 5 as const, periodId: "p6" };
    const withManual = { ...d, teachers: d.teachers.map((t) => (t.id === fra.id ? { ...t, awaySlots: [manual] } : t)) };
    const out = withOtherSedi(withManual).teachers.find((t) => t.id === fra.id)!;
    assert.equal(out.otherPlesso, true);
    assert.ok(out.awaySlots!.some((a) => a.day === 5 && a.periodId === "p6"));
    for (const c of cells) assert.ok(out.awaySlots!.some((a) => a.day === c.day && a.periodId === c.periodId));
    const keys = out.awaySlots!.map((a) => `${a.day}|${a.periodId}`);
    assert.equal(new Set(keys).size, keys.length);
    // chi insegna in una sede sola resta com'è
    const ita = withOtherSedi(d).teachers.find((t) => t.id === "t-ita-1");
    assert.equal(ita, d.teachers.find((t) => t.id === "t-ita-1"));
  });

  it("con campanelle diverse l'ora altrove copre le ore che si sovrappongono", () => {
    const d = seed();
    const b = other(d);
    // nella seconda sede la 1ª ora va dalle 8:10 alle 9:05: tocca la 1ª e la 2ª della prima sede
    const late = editSede(d, b.id, (s) => ({
      ...s,
      settings: { ...s.settings, periods: s.settings.periods.map((p) => (p.id === "p1" ? { ...p, start: "08:10", end: "09:05" } : p)) },
      slots: [{ id: "x", day: 1, periodId: "p1", classId: "cb-1A", teacherId: "tb-fra-1", subject: "Francese" }],
      teachers: s.teachers.map((t) => (t.id === "tb-fra-1" ? { ...t, dispSlots: [] } : t)),
    }));
    const fra = late.teachers.find((t) => t.id === "t-fra-1")!;
    const cells = elsewhereCells(late, fra);
    assert.deepEqual(
      cells.map((c) => `${c.day}|${c.periodId}`).sort(),
      ["1|p1", "1|p2"],
    );
  });

  it("Costruisci non mette un docente in comune nelle ore in cui insegna nell'altra sede", () => {
    const d = seed();
    const res = solveTimetable(withOtherSedi(d), { timeMs: 1500, seed: 4, now: ticks() });
    for (const id of ["t-fra-1", "t-tec-1", "t-mus-1", "t-rel-1"]) {
      const busy = elsewhereCells(d, d.teachers.find((t) => t.id === id)!);
      for (const s of res.slots.filter((x) => x.teacherId === id)) {
        assert.ok(!busy.some((c) => c.day === s.day && c.periodId === s.periodId), `${id} ${s.day} ${s.periodId}`);
      }
    }
  });

  it("Ritocchi e «Trova» non mettono un docente in comune sulle ore altrove, neanche per togliere altri vincoli", () => {
    // l'orario di esempio ha giornate 1ª–6ª con due ore buche: una mossa che le toglie mettendo il docente
    // nell'ora in cui è nell'altra sede (o senza ora di spostamento) non si può fare
    const data = withOtherSedi(seed());
    const ed = new TimetableEditor(data);
    const p = ed.prep;
    const days = [...data.settings.days].sort((a, b) => a - b);
    const zOf = (x: { day: number; periodId: string }) =>
      days.indexOf(x.day as (typeof days)[number]) * p.M +
      p.morningPos.indexOf(data.settings.periods.findIndex((q) => q.id === x.periodId));
    let checked = 0;
    for (const id of ["t-fra-1", "t-tec-1"]) {
      const ti = p.teachers.findIndex((t) => t.id === id);
      const blocked = (z: number) => {
        const un = p.unavail[(ti * p.D + Math.floor(z / p.M)) * p.P + p.morningPos[z % p.M]!];
        return un === 1 || un === 2;
      };
      for (const s of data.slots.filter((x) => x.teacherId === id)) {
        const from = zOf(s);
        if (from < 0) continue;
        ed.effects(s.classId, from).forEach((eff, to) => {
          if (eff && blocked(to)) {
            checked += 1;
            assert.equal(eff.verdict, "breaks", `${id} ${s.classId} → ${to}`);
            assert.ok(eff.hard > 0);
          }
        });
        const gen = new TimetableEditor(data).findFixes({ kind: "lesson", classId: s.classId, z: from }, 60_000);
        let r = gen.next();
        while (!r.done) r = gen.next();
        for (const opt of r.value.options) {
          assert.notEqual(opt.effect.verdict, "breaks");
          const e2 = new TimetableEditor(data);
          let out: ReturnType<TimetableEditor["apply"]> = null;
          for (const st of opt.steps) out = e2.apply(st.classId, st.from, st.to);
          for (const x of out!.slots.filter((y) => y.teacherId === id)) assert.ok(!blocked(zOf(x)), `${id} ${x.day} ${x.periodId}`);
        }
      }
    }
    assert.ok(checked > 0);
  });

  it("nome, materie, ruolo e colore restano uguali in tutte le sedi", () => {
    const d = seed();
    const changed = {
      ...d,
      teachers: d.teachers.map((t) => (t.id === "t-fra-1" ? { ...t, firstName: "Nome Nuovo", color: "#C4D6E3", notes: "solo qui" } : t)),
    };
    const next = syncPersonFields(changed, "t-fra-1");
    const there = other(next).data.teachers.find((t) => t.id === "tb-fra-1")!;
    assert.equal(there.firstName, "Nome Nuovo");
    assert.equal(there.color, "#C4D6E3");
    assert.equal(there.notes, "");
  });

  it("aggiungere una sede al docente crea una scheda collegata; con lezioni non si toglie", () => {
    const d = seed();
    const idB = other(d).id;
    const { data: added, blocked } = setTeacherSedi(d, "t-ita-1", [sedeIdOf(d), idB]);
    assert.deepEqual(blocked, []);
    const ita = added.teachers.find((t) => t.id === "t-ita-1")!;
    assert.ok(ita.personId);
    const rec = other(added).data.teachers.find((t) => t.personId === ita.personId)!;
    assert.equal(rec.lastName, ita.lastName);
    assert.deepEqual(rec.cardRows ?? [], []);
    const { data: removed } = setTeacherSedi(added, "t-ita-1", [sedeIdOf(d)]);
    assert.ok(!other(removed).data.teachers.some((t) => t.personId === ita.personId));
    // francese ha lezioni nella seconda sede: resta
    const { data: kept, blocked: no } = setTeacherSedi(d, "t-fra-1", [sedeIdOf(d)]);
    assert.deepEqual(no, ["Sede B (esempio)"]);
    assert.ok(other(kept).data.teachers.some((t) => t.id === "tb-fra-1"));
    assert.equal(canRemoveRecord(other(d).data, "tb-fra-1"), false);
  });

  it("scheda docente con le classi di tutte le sedi: ogni riga va nella sua sede, le ore cattedra sono il totale", () => {
    const d = seed();
    const idA = sedeIdOf(d);
    const idB = other(d).id;
    const rowsOf = (x: PersistedData, sede: SedeData, id: string) =>
      cattedreOfTeacher(sedeAsData(x, sede), id)
        .map((c) => `${c.classId} ${c.subject} ${c.hours}`)
        .sort();
    const fra = d.teachers.find((t) => t.id === "t-fra-1")!;
    assert.equal(cattedraTotal(d, fra), 18);
    const rowsA = cattedreOfTeacher(d, fra.id).map(({ classId, subject, hours }) => ({ classId, subject, hours }));
    const before = cattedreOfTeacher(sedeAsData(d, other(d).data), "tb-fra-1");
    const rowsB = before.map(({ classId, subject, hours }) => ({ classId, subject, hours }));
    // senza cambiamenti l'altra sede resta identica
    const same = saveTeacherSedi(d, fra.id, [idA, idB], { [idA]: rowsA, [idB]: rowsB }, 18).data;
    assert.equal(other(same).data, other(d).data);
    assert.equal(same.teachers.find((t) => t.id === fra.id)!.weeklyHours, 12);
    // nell'altra sede una classe in meno e un'ora in più nella prima
    const fewer = [{ ...rowsB[0]!, hours: 3 }, rowsB[1]!];
    const { data: out, blocked } = saveTeacherSedi(d, fra.id, [idA, idB], { [idA]: rowsA, [idB]: fewer }, 18);
    assert.deepEqual(blocked, []);
    assert.deepEqual(rowsOf(out, other(out).data, "tb-fra-1"), fewer.map((c) => `${c.classId} ${c.subject} ${c.hours}`).sort());
    assert.equal(other(out).data.teachers.find((t) => t.id === "tb-fra-1")!.weeklyHours, 5);
    // alla sede in uso va quello che resta delle 18 ore
    const fraNow = out.teachers.find((t) => t.id === fra.id)!;
    assert.equal(fraNow.weeklyHours, 13);
    assert.equal(cattedraTotal(out, fraNow), 18);
    const dropped = rowsB[2]!;
    assert.ok(
      !(other(out).data.cattedre ?? []).some(
        (c) => c.classId === dropped.classId && c.subject === dropped.subject && c.teacherId === "tb-fra-1",
      ),
    );

    // una sede nuova con le sue classi; poi, tolte le classi, la sede si toglie
    const ita = d.teachers.find((t) => t.id === "t-ita-1")!;
    const total = ita.weeklyHours + 2;
    const classB = other(d).data.classes[0]!.id;
    const withB = saveTeacherSedi(d, ita.id, [idA, idB], { [idB]: [{ classId: classB, subject: "Italiano", hours: 2 }] }, total).data;
    const itaNow = withB.teachers.find((t) => t.id === ita.id)!;
    const rec = other(withB).data.teachers.find((t) => t.personId === itaNow.personId)!;
    assert.equal(rec.weeklyHours, 2);
    assert.deepEqual(rowsOf(withB, other(withB).data, rec.id), [`${classB} Italiano 2`]);
    assert.equal(itaNow.weeklyHours, ita.weeklyHours);
    const back = saveTeacherSedi(withB, ita.id, [idA], {}, ita.weeklyHours);
    assert.deepEqual(back.blocked, []);
    assert.ok(!other(back.data).data.teachers.some((t) => t.personId === itaNow.personId));
  });

  it("scheda docente: il salvataggio su tutte le sedi passa dallo stato dell'app", () => {
    useAppStore.getState().resetDemo();
    const st = () => useAppStore.getState();
    const d = snapshot(st());
    const idA = sedeIdOf(d);
    const idB = other(d).id;
    const { id: _id, ...patch } = d.teachers.find((t) => t.id === "t-fra-1")!;
    const rowsA = cattedreOfTeacher(d, "t-fra-1").map(({ classId, subject, hours }) => ({ classId, subject, hours }));
    const rowsB = cattedreOfTeacher(sedeAsData(d, other(d).data), "tb-fra-1")
      .slice(0, 1)
      .map(({ classId, subject, hours }) => ({ classId, subject, hours }));
    const res = st().saveTeacherCardSedi("t-fra-1", { ...patch, weeklyHours: 18 }, { [idA]: rowsA, [idB]: rowsB }, [idA, idB]);
    assert.deepEqual(res, { teacherId: "t-fra-1", blocked: [] });
    const now = snapshot(st());
    assert.equal(other(now).data.teachers.find((t) => t.id === "tb-fra-1")!.weeklyHours, 2);
    assert.equal(now.teachers.find((t) => t.id === "t-fra-1")!.weeklyHours, 16);
    st().resetDemo();
  });

  it("classi tolte dalla scheda: finché le lezioni restano nell'orario sono sue, poi la materia resta senza docente", () => {
    const d = seed();
    const idA = sedeIdOf(d);
    const idB = other(d).id;
    const rowsA = cattedreOfTeacher(d, "t-fra-1").map(({ classId, subject, hours }) => ({ classId, subject, hours }));
    const out = saveTeacherSedi(d, "t-fra-1", [idA, idB], { [idA]: rowsA, [idB]: [] }, 12).data;
    const b = () => sedeAsData(out, other(out).data);
    // le lezioni di francese sono ancora nell'orario della seconda sede: Costruisci le considera sue
    assert.ok(other(out).data.slots.some((s) => s.teacherId === "tb-fra-1"));
    assert.equal(timetableDemand(b()).unassigned.filter((u) => u.subject === "Francese").length, 0);
    // tolte dall'orario, il francese resta senza docente anche se lei è ancora in quella sede
    const empty = editSede(out, idB, (sede) => ({ ...sede, slots: sede.slots.filter((s) => s.teacherId !== "tb-fra-1") }));
    assert.ok(other(empty).data.teachers.some((t) => t.id === "tb-fra-1"));
    const missing = timetableDemand(sedeAsData(empty, other(empty).data)).unassigned.filter((u) => u.subject === "Francese");
    assert.equal(missing.length, 3);
    // una classe senza cattedre salvate continua a prendere il docente della materia
    const fresh = { ...d, cattedre: [], slots: [] };
    assert.ok(timetableDemand(fresh).lessons.some((l) => l.subject === "Francese" && l.teacherId === "t-fra-1"));
  });

  it("scheda docente: le lezioni delle classi tolte escono dall'orario e la sede si toglie", () => {
    useAppStore.getState().resetDemo();
    const st = () => useAppStore.getState();
    const d = snapshot(st());
    const idA = sedeIdOf(d);
    const idB = other(d).id;
    const { id: _id, ...patch } = d.teachers.find((t) => t.id === "t-fra-1")!;
    const rowsA = cattedreOfTeacher(d, "t-fra-1").map(({ classId, subject, hours }) => ({ classId, subject, hours }));
    const lessonsB = other(d).data.slots.filter((s) => s.teacherId === "tb-fra-1").map((s) => s.id);
    assert.ok(lessonsB.length > 0);
    const res = st().saveTeacherCardSedi("t-fra-1", { ...patch, weeklyHours: 12 }, { [idA]: rowsA }, [idA], {
      [idB]: lessonsB,
    });
    assert.deepEqual(res.blocked, []);
    const now = snapshot(st());
    assert.ok(!other(now).data.teachers.some((t) => t.id === "tb-fra-1"));
    assert.ok(!other(now).data.slots.some((s) => lessonsB.includes(s.id)));
    assert.equal(other(now).data.slots.length, other(d).data.slots.length - lessonsB.length);
    assert.equal(now.slots.length, d.slots.length);
    st().resetDemo();
  });

  it("le ore senza docente di ogni sede: materie, rientri e righe di Mensa o Laboratorio in tempo normale", () => {
    const d = seed();
    assert.deepEqual(missingBySede(d), []);
    const idA = sedeIdOf(d);
    const idB = other(d).id;
    const tn = d.classes.find((c) => c.tempo === "TN")!;
    // una riga di Laboratorio rimasta in una classe a tempo normale
    const withLab = editSede(d, idA, (sede) => ({
      ...sede,
      cattedre: [...(sede.cattedre ?? []), { classId: tn.id, subject: "Laboratorio", hours: 2, teacherId: "" }],
    }));
    // nella seconda sede il francese perde il docente e le sue lezioni
    const out = editSede(withLab, idB, (sede) => ({
      ...sede,
      cattedre: (sede.cattedre ?? []).map((c) => (c.teacherId === "tb-fra-1" ? { ...c, teacherId: "" } : c)),
      slots: sede.slots.filter((s) => s.teacherId !== "tb-fra-1"),
    }));
    const groups = missingBySede(out);
    assert.deepEqual(
      groups.map((g) => g.sedeId),
      [idA, idB],
    );
    assert.deepEqual(groups[0]!.items, [
      { classId: tn.id, className: tn.name, subject: "Laboratorio", hours: 2, tn: true },
    ]);
    assert.equal(groups[1]!.items.length, 3);
    assert.ok(groups[1]!.items.every((m) => m.subject === "Francese" && !m.tn));
    // «Proponi» si ferma solo per le materie della proposta, non per la riga di Laboratorio
    assert.deepEqual(
      blockingGroups(groups).map((g) => g.sedeId),
      [idB],
    );
  });

  it("aggiungendo una sede da backup collega i docenti con lo stesso nome", () => {
    const d = seed();
    const fra = d.teachers.find((t) => t.id === "t-fra-1")!;
    const ita = d.teachers.find((t) => t.id === "t-ita-1")!;
    const incoming: PersistedData = {
      ...EMPTY_DATA,
      settings: { ...EMPTY_DATA.settings, schoolName: "Sede C", schoolYear: "2020/2021" },
      teachers: [
        teacher("x1", fra.lastName.toUpperCase(), ` ${fra.firstName}`),
        teacher("x2", ita.lastName, ita.firstName),
        teacher("x3", "Esempio", "Nuovo"),
      ],
    };
    const matches = nameMatches(d, incoming.teachers);
    assert.deepEqual(
      matches.map((m) => m.incoming.id),
      ["x1", "x2"],
    );
    // la persona in due sedi conta una volta
    assert.equal(matches[0]!.matches.length, 1);
    const links = [{ incomingId: "x2", sedeId: sedeIdOf(d), teacherId: ita.id }];
    const { data: next, id } = importSede(d, incoming, links);
    const c = allSedi(next).find((s) => s.id === id)!;
    assert.equal(sedeName(c.data.settings), "Sede C");
    assert.equal(c.data.settings.schoolYear, d.settings.schoolYear);
    const itaNow = next.teachers.find((t) => t.id === ita.id)!;
    assert.ok(itaNow.personId);
    assert.equal(c.data.teachers.find((t) => t.id === "x2")!.personId, itaNow.personId);
    assert.equal(c.data.teachers.find((t) => t.id === "x1")!.personId, undefined);
  });
});

describe("sedi: salvataggio e backup", () => {
  it("il backup conserva tutte le sedi", () => {
    const d = seed();
    const back = parseBackupJson(backupJson(d));
    assert.equal(back.altreSedi?.length, 1);
    assert.deepEqual(back.altreSedi?.[0]?.data.classes, other(d).data.classes);
    assert.equal(back.sedeId, d.sedeId);
  });

  it("due salvataggi con sedi in uso diverse non si mescolano", () => {
    const d = { ...seed(), origin: "user" as const, savedAt: 10 };
    const there = { ...switchSede(d, other(d).id), savedAt: 20 };
    const merged = mergeSlices(d, there);
    assert.equal(merged.sedeId, there.sedeId);
    assert.deepEqual(plain(pickSede(merged)), plain(pickSede(there)));
  });

  it("si salva anche stando in una sede nuova con classi e ancora senza docenti", () => {
    const d = { ...seed(), origin: "user" as const, savedAt: 10 };
    const { data: withC, id } = addSede(d, newSedeData(d.settings, "Sede C"));
    const inC = switchSede(withC, id);
    const next: PersistedData = {
      ...inC,
      classes: [{ id: "c-z", name: "1ª Z", grade: 1, section: "Z", students: 10, tempo: "TN" }],
      savedAt: 20,
    };
    assert.equal(shouldAcceptWrite(encodePersist(next), encodePersist(d)), true);
  });

  it("importando un backup di una sede sola spariscono le sedi di prima", () => {
    useAppStore.getState().resetDemo();
    assert.equal(allSedi(snapshot(useAppStore.getState())).length, 2);
    const single: PersistedData = { ...buildSeed(), sedeId: undefined, altreSedi: undefined, ordineSedi: undefined };
    useAppStore.getState().importData(single, "una-sede.json");
    const now = snapshot(useAppStore.getState());
    assert.equal(allSedi(now).length, 1);
    assert.equal(now.altreSedi?.length ?? 0, 0);
  });

  it("importando o cancellando tutto non restano le cattedre della sede di prima", () => {
    const st = () => useAppStore.getState();
    st().resetDemo();
    const idNuova = st().addSede("Sede nuova");
    st().switchSede(idNuova);
    const file = backupJson(snapshot(st()));
    st().resetDemo();
    const cls = st().classes[0]!;
    st().setCattedre([{ classId: cls.id, subject: "Italiano", teacherId: st().teachers[0]!.id, hours: 6 }]);
    assert.equal((st().cattedre ?? []).length, 1);
    st().importData(parseBackupJson(file), "sede-nuova.json");
    assert.equal(sedeName(st().settings), "Sede nuova");
    assert.equal((st().cattedre ?? []).length, 0);
    st().resetDemo();
    st().setCattedre([{ classId: cls.id, subject: "Italiano", teacherId: st().teachers[0]!.id, hours: 6 }]);
    st().clearAll();
    assert.equal((st().cattedre ?? []).length, 0);
  });

  it("«Esporta sede»: un backup di una sede sola, con le × per le ore nelle altre sedi", () => {
    const d = buildSeed();
    const b = other(d);
    const out = exportSede(d, b.id);
    // solo quella sede, come un backup dell'app della singola scuola
    assert.equal(out.altreSedi, undefined);
    assert.equal(out.sedeId, undefined);
    assert.deepEqual(
      out.classes.map((c) => c.id),
      b.data.classes.map((c) => c.id),
    );
    assert.deepEqual(out.slots, b.data.slots);
    const morning = out.settings.periods.filter((p) => !p.tpOnly).map((p) => p.id);
    const shared = b.data.teachers.filter((t) => t.personId && d.teachers.some((x) => x.personId === t.personId));
    assert.ok(shared.length > 0);
    for (const t of shared) {
      const x = out.teachers.find((y) => y.id === t.id)!;
      assert.equal(x.otherPlesso, true);
      assert.equal(x.personId, undefined);
      const away = new Set((x.awaySlots ?? []).map((a) => `${a.day}|${a.periodId}`));
      const here = new Set(out.slots.filter((s) => s.teacherId === t.id).map((s) => s.day));
      const elsewhere = d.slots.filter((s) => s.teacherId === d.teachers.find((y) => y.personId === t.personId)!.id);
      for (const s of elsewhere) {
        // giorno solo altrove: × su tutta la mattina; giorno diviso: × su quell'ora
        if (!here.has(s.day)) for (const p of morning) assert.ok(away.has(`${s.day}|${p}`), `${s.day} ${p}`);
        else assert.ok(away.has(`${s.day}|${s.periodId}`), `${s.day} ${s.periodId}`);
      }
      // mai una × su un'ora in cui insegna qui
      for (const s of out.slots.filter((y) => y.teacherId === t.id)) assert.ok(!away.has(`${s.day}|${s.periodId}`));
    }
    // si apre come backup di una sede sola, con le stesse lezioni e senza lezioni su una ×
    useAppStore.getState().importData(parseBackupJson(backupJson(out)), "sede.json");
    const now = snapshot(useAppStore.getState());
    assert.equal(allSedi(now).length, 1);
    assert.equal(sedeName(now.settings), sedeName(b.data.settings));
    assert.equal(evaluateCurrent(now).hard.away.length, 0);
  });

  it("un backup senza orario, assenze e sostituzioni si apre con quelle parti vuote", () => {
    const st = () => useAppStore.getState();
    const { slots: _s, absences: _a, substitutions: _u, altreSedi: _o, sedeId: _i, ordineSedi: _r, ...rest } = buildSeed();
    const parsed = parseBackupJson(JSON.stringify(rest));
    assert.deepEqual([parsed.slots, parsed.absences, parsed.substitutions], [[], [], []]);
    st().importData(parsed, "vecchio.json");
    assert.deepEqual([st().slots, st().absences, st().substitutions], [[], [], []]);
  });

  it("assenza accorciata o docente eliminato: le sostituzioni tolte tornano da coprire", () => {
    const st = () => useAppStore.getState();
    st().resetDemo();
    const [assente, sostituto] = st().teachers;
    const [p1, p2] = st().settings.periods;
    const sub = (date: string, periodId: string, id: string): Substitution => ({
      id,
      date,
      periodId,
      classId: st().classes[0]!.id,
      absentTeacherId: assente!.id,
      substituteId: sostituto!.id,
      type: "disposizione",
      activity: "",
      notes: "",
      subject: "",
    });
    const id = st().addAbsence({
      teacherId: assente!.id,
      dateFrom: "2026-11-02",
      dateTo: "2026-11-04",
      reason: "malattia",
      notes: "",
      allDay: true,
      periodIds: [],
    });
    useAppStore.setState({
      substitutions: [
        sub("2026-11-02", p1!.id, "s1"),
        sub("2026-11-02", p2!.id, "s2"),
        sub("2026-11-03", p1!.id, "s3"),
        sub("2026-11-04", p1!.id, "s4"),
      ],
    });
    const ids = () => st().substitutions.map((s) => s.id);
    st().updateAbsence(id, { notes: "solo una nota" });
    assert.deepEqual(ids(), ["s1", "s2", "s3", "s4"]);
    st().updateAbsence(id, { dateTo: "2026-11-03" });
    assert.deepEqual(ids(), ["s1", "s2", "s3"]);
    st().updateAbsence(id, { allDay: false, periodIds: [p1!.id] });
    assert.deepEqual(ids(), ["s1", "s3"]);
    st().removeTeacher(sostituto!.id);
    assert.deepEqual(ids(), []);
  });

  it("classe eliminata in un'altra sede: via anche le righe delle schede, e la sede si toglie al docente", () => {
    const st = () => useAppStore.getState();
    st().resetDemo();
    const b = other(snapshot(st()));
    const tb = b.data.teachers.find((t) => t.personId && (t.cardRows ?? []).some((r) => r.hours > 0))!;
    const ta = st().teachers.find((t) => t.personId === tb.personId)!;
    const rowsB = tb.cardRows!.filter((r) => r.hours > 0);
    const before = cattedraTotal(snapshot(st()), ta);
    for (const r of rowsB) st().removeClassIn(b.id, r.classId);
    const now = snapshot(st());
    const b1 = other(now).data;
    const tb1 = b1.teachers.find((t) => t.id === tb.id)!;
    assert.equal((tb1.cardRows ?? []).length, 0);
    assert.equal(cattedraTotal(now, st().teachers.find((t) => t.id === ta.id)!), before - rowsB.reduce((n, r) => n + r.hours, 0));
    assert.equal(persons(now).find((p) => p.key === `p:${tb.personId}`)!.records.find((r) => r.teacher.id === tb.id)!.hours, 0);
    assert.equal(canRemoveRecord(b1, tb.id), true);
    const senzaB = removeSede(now, b.id, "2026-10-18");
    assert.equal((senzaB.teachers.find((t) => t.id === ta.id)!.removedSedi ?? []).length, 0);
  });

  it("nello store: cambio sede, classe in un'altra sede, sede nuova", () => {
    useAppStore.getState().resetDemo();
    const st = () => useAppStore.getState();
    const idB = other(snapshot(st())).id;
    st().addClassIn(idB, { name: "1ª B", grade: 1, section: "B", students: 12, tempo: "TN" });
    const b = other(snapshot(st())).data;
    const nuova = b.classes.find((c) => c.name === "1ª B")!;
    assert.ok(nuova);
    assert.ok(!st().classes.some((c) => c.id === nuova.id));
    assert.equal(st().moveClass(idB, nuova.id, sedeIdOf(snapshot(st()))), true);
    assert.ok(st().classes.some((c) => c.name === "1ª B" && c.grade === 1 && c.section === "B"));
    st().switchSede(idB);
    assert.equal(sedeName(st().settings), "Sede B (esempio)");
    const idC = st().addSede("Sede C");
    st().updateSede(idC, { responsabile: "Esempio Due" });
    const c = allSedi(snapshot(st())).find((s) => s.id === idC)!;
    assert.equal(c.data.settings.responsabile, "Esempio Due");
    assert.equal(sedeName(st().settings), "Sede B (esempio)");
    st().removeSede(idC);
    assert.equal(allSedi(snapshot(st())).length, 2);
    st().resetDemo();
  });
});
