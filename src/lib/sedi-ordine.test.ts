import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupJson, parseBackupJson } from "./export.ts";
import { mergeSlices } from "./persist-storage.ts";
import {
  addSede,
  allSedi,
  exportSede,
  moveSede,
  newSedeData,
  personKey,
  pickSede,
  planSedeUpdate,
  removeSede,
  sedeColorIndex,
  sedeIdOf,
  sedeName,
  sortSediByName,
  switchSede,
  updateSedeFromBackup,
} from "./sedi.ts";
import { buildSeed } from "./seed.ts";
import type { Absence, PersistedData, Teacher } from "./types.ts";

const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const names = (d: PersistedData) => allSedi(d).map((s) => sedeName(s.data.settings));
const colors = (d: PersistedData) => Object.fromEntries(allSedi(d).map((s) => [sedeName(s.data.settings), sedeColorIndex(d, s.id)]));

/** Le due sedi degli esempi più «Zeta», «Alfa» e «Beta» in fondo (in quest'ordine). */
function withThree(): PersistedData {
  let d = buildSeed();
  for (const n of ["Zeta", "Alfa", "Beta"]) d = addSede(d, newSedeData(d.settings, n)).data;
  return d;
}

function teacher(id: string, lastName: string, firstName: string): Teacher {
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
  };
}

describe("sedi: ordine e colori", () => {
  it("sposta una sede di un posto, ai bordi non fa nulla", () => {
    const d = withThree();
    assert.deepEqual(names(d), ["Sede A (esempio)", "Sede B (esempio)", "Zeta", "Alfa", "Beta"]);
    const zeta = allSedi(d)[2]!.id;
    assert.deepEqual(names(moveSede(d, zeta, -1)), ["Sede A (esempio)", "Zeta", "Sede B (esempio)", "Alfa", "Beta"]);
    assert.deepEqual(names(moveSede(d, zeta, 1)), ["Sede A (esempio)", "Sede B (esempio)", "Alfa", "Zeta", "Beta"]);
    const first = allSedi(d)[0]!.id;
    const last = allSedi(d)[4]!.id;
    assert.equal(moveSede(d, first, -1), d);
    assert.equal(moveSede(d, last, 1), d);
    assert.equal(moveSede(d, "non-esiste", 1), d);
  });

  it("il colore resta alla sede quando cambia posto", () => {
    const d = withThree();
    const before = colors(d);
    const zeta = allSedi(d)[2]!.id;
    const moved = moveSede(moveSede(d, zeta, -1), zeta, -1);
    assert.deepEqual(names(moved).slice(0, 2), ["Zeta", "Sede A (esempio)"]);
    assert.deepEqual(colors(moved), before);
    assert.deepEqual(colors(sortSediByName(d)), before);
  });

  it("senza colori salvati vale la posizione, e chi li ha già non cambia", () => {
    const d = buildSeed();
    assert.equal(d.coloriSedi, undefined);
    const [a, b] = allSedi(d);
    assert.equal(sedeColorIndex(d, a!.id), 0);
    assert.equal(sedeColorIndex(d, b!.id), 1);
    // spostare la seconda sede in alto non cambia i colori di prima
    const swapped = moveSede(d, b!.id, -1);
    assert.equal(sedeColorIndex(swapped, a!.id), 0);
    assert.equal(sedeColorIndex(swapped, b!.id), 1);
    assert.deepEqual(names(swapped), ["Sede B (esempio)", "Sede A (esempio)"]);
  });

  it("ordine alfabetico senza badare a maiuscole e accenti", () => {
    let d = buildSeed();
    for (const n of ["zeta", "Àlfa", "beta"]) d = addSede(d, newSedeData(d.settings, n)).data;
    assert.deepEqual(names(sortSediByName(d)), ["Àlfa", "beta", "Sede A (esempio)", "Sede B (esempio)", "zeta"]);
  });

  it("una sede nuova va in fondo con un colore libero; eliminare ne libera uno", () => {
    const d = withThree();
    const used = Object.values(colors(d));
    assert.equal(new Set(used).size, used.length);
    const beta = allSedi(d)[4]!.id;
    const betaColor = sedeColorIndex(d, beta);
    const without = removeSede(d, beta);
    assert.equal(names(without).length, 4);
    assert.equal(without.coloriSedi?.[beta], undefined);
    const again = addSede(without, newSedeData(without.settings, "Gamma")).data;
    assert.equal(names(again).at(-1), "Gamma");
    const gamma = allSedi(again).at(-1)!.id;
    assert.equal(sedeColorIndex(again, gamma), betaColor);
    // eliminando una sede in mezzo, le altre tengono il colore
    const alfa = allSedi(d)[3]!.id;
    const rest = removeSede(d, alfa);
    for (const s of allSedi(rest)) assert.equal(sedeColorIndex(rest, s.id), sedeColorIndex(d, s.id));
  });

  it("cambiare la sede in uso non cambia colori né ordine", () => {
    const d = withThree();
    const zeta = allSedi(d)[2]!.id;
    const there = switchSede(d, zeta);
    assert.deepEqual(names(there), names(d));
    assert.deepEqual(colors(there), colors(d));
  });

  it("l'ordine e i colori restano nel backup e nell'unione dei salvataggi", () => {
    const d = { ...sortSediByName(withThree()), origin: "user" as const, savedAt: 10 };
    const back = parseBackupJson(backupJson(d));
    assert.deepEqual(back.coloriSedi, d.coloriSedi);
    assert.deepEqual(names(back), names(d));
    const merged = mergeSlices({ ...buildSeed(), origin: "user" as const, savedAt: 5 }, d);
    assert.deepEqual(merged.coloriSedi, d.coloriSedi);
    assert.deepEqual(merged.ordineSedi, d.ordineSedi);
  });

  it("l'esportazione di una sede non porta con sé i colori delle altre", () => {
    const d = withThree();
    const out = exportSede(d, allSedi(d)[1]!.id);
    assert.equal(out.coloriSedi, undefined);
    assert.equal(out.ordineSedi, undefined);
  });
});

describe("sedi: aggiornare una sede da backup", () => {
  /** Il backup della sede B degli esempi, modificato: un docente in meno, uno nuovo, un'altra classe. */
  function setup() {
    const d = buildSeed();
    const b = allSedi(d)[1]!;
    const backup = exportSede(d, b.id);
    const gone = backup.teachers[0]!;
    const incoming: PersistedData = {
      ...backup,
      settings: { ...backup.settings, schoolName: "Altro nome", responsabile: "" },
      teachers: [...backup.teachers.slice(1), teacher("n1", "Nuovo", "Docente")],
      classes: backup.classes.slice(0, -1),
      slots: [],
      absences: [],
      substitutions: [],
    };
    return { d, b, backup, incoming, gone };
  }

  it("tiene id, nome, posto, colore e responsabile; cambia il contenuto", () => {
    const { d, b, incoming } = setup();
    const withBoss = editSedeResp(d, b.id, "Rossi Anna");
    const next = updateSedeFromBackup(withBoss, b.id, incoming, []);
    const nb = allSedi(next)[1]!;
    assert.equal(nb.id, b.id);
    assert.equal(sedeName(nb.data.settings), sedeName(b.data.settings));
    assert.equal(nb.data.settings.responsabile, "Rossi Anna");
    assert.equal(nb.data.settings.schoolYear, d.settings.schoolYear);
    assert.deepEqual(names(next), names(d));
    assert.deepEqual(colors(next), colors(d));
    assert.equal(nb.data.classes.length, b.data.classes.length - 1);
    assert.equal(nb.data.slots.length, 0);
    assert.ok(nb.data.teachers.some((t) => personKey(t) === personKey({ lastName: "Nuovo", firstName: "Docente" })));
    // la sede A non cambia
    assert.deepEqual(plain(pickSede(next)), plain(pickSede(d)));
  });

  it("assenze e sostituzioni diventano quelle del backup", () => {
    const { d, b, incoming } = setup();
    const absence: Absence = {
      id: "ab1",
      teacherId: "n1",
      dateFrom: "2026-10-12",
      dateTo: "2026-10-12",
      reason: "malattia",
      notes: "",
      allDay: true,
      periodIds: [],
    };
    const old: Absence = { ...absence, id: "vecchia", teacherId: b.data.teachers[0]!.id };
    const start = { ...d, altreSedi: d.altreSedi!.map((a) => (a.id === b.id ? { ...a, data: { ...a.data, absences: [old] } } : a)) };
    const next = updateSedeFromBackup(start, b.id, { ...incoming, absences: [absence] }, []);
    assert.deepEqual(allSedi(next)[1]!.data.absences.map((a) => a.id), ["ab1"]);
  });

  it("il responsabile del backup, se c'è, sostituisce quello di prima", () => {
    const { d, b, incoming } = setup();
    const next = updateSedeFromBackup(d, b.id, { ...incoming, settings: { ...incoming.settings, responsabile: "Bianchi Luca" } }, []);
    assert.equal(allSedi(next)[1]!.data.settings.responsabile, "Bianchi Luca");
  });

  it("chi ha lo stesso nome tiene la persona in comune con le altre sedi", () => {
    const { d, b } = setup();
    // un docente di B che è anche di A: stessa persona
    const shared = b.data.teachers.find((t) => t.personId);
    if (!shared) throw new Error("gli esempi dovrebbero avere un docente in comune");
    const backup = exportSede(d, b.id);
    const next = updateSedeFromBackup(d, b.id, backup, []);
    const after = allSedi(next)[1]!.data.teachers.find((t) => personKey(t) === personKey(shared))!;
    assert.equal(after.personId, shared.personId);
    // il resto dei dati del docente è quello del backup, non quello di prima
    assert.equal(after.id, backup.teachers.find((t) => personKey(t) === personKey(shared))!.id);
  });

  it("un docente nuovo si collega alla stessa persona di un'altra sede solo se richiesto", () => {
    const { d, b, incoming } = setup();
    const a = allSedi(d)[0]!;
    const inA = a.data.teachers.find((t) => !b.data.teachers.some((x) => personKey(x) === personKey(t)))!;
    const extra = teacher("n2", inA.lastName, inA.firstName);
    const inc = { ...incoming, teachers: [...incoming.teachers, extra] };
    const plan = planSedeUpdate(d, b.id, inc)!;
    assert.ok(plan.matches.some((m) => m.incoming.id === "n2" && m.matches[0]!.sedeId === a.id));
    const linkedNext = updateSedeFromBackup(d, b.id, inc, [{ incomingId: "n2", sedeId: a.id, teacherId: inA.id }]);
    const inB = allSedi(linkedNext)[1]!.data.teachers.find((t) => t.id === "n2")!;
    const inANow = pickSede(linkedNext).teachers.find((t) => t.id === inA.id)!;
    assert.ok(inB.personId);
    assert.equal(inB.personId, inANow.personId);
    const plainNext = updateSedeFromBackup(d, b.id, inc, []);
    assert.equal(allSedi(plainNext)[1]!.data.teachers.find((t) => t.id === "n2")!.personId, undefined);
  });

  it("si può aggiornare anche la sede in uso", () => {
    const d = buildSeed();
    const a = allSedi(d)[0]!;
    const backup = exportSede(d, a.id);
    const incoming: PersistedData = { ...backup, classes: [], slots: [] };
    const next = updateSedeFromBackup(d, a.id, incoming, []);
    assert.equal(sedeIdOf(next), a.id);
    assert.equal(next.classes.length, 0);
    assert.equal(next.slots.length, 0);
    assert.equal(sedeName(next.settings), sedeName(a.data.settings));
    assert.deepEqual(plain(allSedi(next)[1]!.data), plain(allSedi(d)[1]!.data));
  });

  it("il riepilogo dice cosa cambia", () => {
    const { d, b, incoming, gone } = setup();
    const plan = planSedeUpdate(d, b.id, incoming)!;
    assert.equal(plan.before.classes, b.data.classes.length);
    assert.equal(plan.after.classes, b.data.classes.length - 1);
    assert.equal(plan.before.lessons, b.data.slots.length);
    assert.equal(plan.after.lessons, 0);
    assert.deepEqual(plan.added.map((t) => t.id), ["n1"]);
    assert.deepEqual(plan.removed.map((t) => personKey(t)), [personKey(gone)]);
    assert.equal(planSedeUpdate(d, "non-esiste", incoming), null);
  });
});

function editSedeResp(d: PersistedData, id: string, responsabile: string): PersistedData {
  return {
    ...d,
    altreSedi: (d.altreSedi ?? []).map((a) => (a.id === id ? { ...a, data: { ...a.data, settings: { ...a.data.settings, responsabile } } } : a)),
  };
}
