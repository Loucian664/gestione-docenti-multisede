import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupJson, parseBackupJson } from "./export.ts";
import { encodePersist, mergeSlices, shouldAcceptWrite } from "./persist-storage.ts";
import {
  addSede,
  allSedi,
  canRemoveRecord,
  canRemoveSede,
  classInUse,
  editSede,
  elsewhereCells,
  importSede,
  linkedElsewhere,
  nameMatches,
  newSedeData,
  persons,
  pickSede,
  removeSede,
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
import { snapshot, useAppStore } from "./store.ts";
import { solveTimetable, TimetableEditor } from "./timetable-solver.ts";
import type { PersistedData, SedeData, Teacher } from "./types.ts";

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
    const noB = removeSede(d, b.id);
    assert.equal(allSedi(noB).length, 1);
    assert.equal(allSedi(noB)[0]!.data.teachers.length, d.teachers.length);
    assert.deepEqual(plain(pickSede(noB)), plain(pickSede(d)));
    // eliminando la sede in uso si passa all'altra, che resta com'era
    const noA = removeSede(d, sedeIdOf(d));
    assert.equal(sedeIdOf(noA), b.id);
    assert.deepEqual(plain(pickSede(noA)), plain(b.data));
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
