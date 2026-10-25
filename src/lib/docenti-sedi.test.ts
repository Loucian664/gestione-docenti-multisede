import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { personCellKey, personSheets } from "./docenti-sedi.ts";
import { allSedi, editSede } from "./sedi.ts";
import { buildSeed } from "./seed.ts";
import type { DayOfWeek, PersistedData } from "./types.ts";

const seed = () => buildSeed();
const sheetOf = (data: PersistedData, lastName: string) => personSheets(data).find((s) => s.lastName === lastName);

describe("personSheets", () => {
  it("una persona in due sedi ha un foglio solo, con le ore di ogni sede", () => {
    const data = seed();
    const sheets = personSheets(data).filter((s) => s.lastName === "Marino");
    assert.equal(sheets.length, 1);
    const s = sheets[0]!;
    assert.equal(s.sedi.length, 2);
    assert.deepEqual(s.sedi.map((x) => x.lessons), [12, 6]);
    assert.equal(s.unplaced, 0);
    const bySede = new Set([...s.cells.values()].flatMap((c) => (c.kind === "away" ? [] : [c.sedeId])));
    assert.equal(bySede.size, 2);
    // le ore del foglio sono tutte e solo quelle delle due sedi
    assert.equal([...s.cells.values()].filter((c) => c.kind === "lesson").length, 18);
  });

  it("chi insegna in una sede sola ha una sede sola", () => {
    const data = seed();
    const s = sheetOf(data, "Rossi")!;
    assert.equal(s.sedi.length, 1);
    assert.ok(s.sedi[0]!.lessons > 0);
    assert.ok(s.sedi[0]!.classes.length > 0);
  });

  it("ogni persona compare una volta, in ordine di cognome", () => {
    const sheets = personSheets(seed());
    assert.equal(new Set(sheets.map((s) => s.key)).size, sheets.length);
    const names = sheets.map((s) => `${s.lastName} ${s.firstName}`);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "it")));
  });

  it("le ore a disposizione di una sede compaiono con la sede e sono contate", () => {
    let data = seed();
    const other = allSedi(data)[1]!;
    const t = other.data.teachers.find((x) => x.lastName === "Marino")!;
    // un'ora libera in tutte e due le sedi
    const busy = new Set(personSheets(data).find((x) => x.lastName === "Marino")!.cells.keys());
    const periodIds = other.data.settings.periods.filter((p) => !p.tpOnly).map((p) => p.id);
    const free = ([1, 2, 3, 4, 5] as DayOfWeek[])
      .flatMap((day) => periodIds.map((periodId) => ({ day, periodId })))
      .find((c) => !busy.has(personCellKey(c.day, c.periodId)))!;
    assert.ok(free);
    data = editSede(data, other.id, (sede) => ({
      ...sede,
      teachers: sede.teachers.map((x) => (x.id === t.id ? { ...x, dispSlots: [free] } : x)),
    }));
    const s = sheetOf(data, "Marino")!;
    const cell = s.cells.get(personCellKey(free.day, free.periodId))!;
    assert.equal(cell.kind, "disp");
    assert.equal(cell.sedeId, other.id);
    assert.equal(s.sedi.find((x) => x.id === other.id)!.disp, 1);
  });

  it("le ore con la × che nessuna sede spiega sono «altro plesso»; dove c'è una lezione resta la lezione", () => {
    let data = seed();
    const first = allSedi(data)[0]!;
    const t = first.data.teachers.find((x) => x.lastName === "Marino")!;
    const busy = new Set(personSheets(data).find((x) => x.lastName === "Marino")!.cells.keys());
    const periodIds = first.data.settings.periods.filter((p) => !p.tpOnly).map((p) => p.id);
    const all = ([1, 2, 3, 4, 5] as DayOfWeek[]).flatMap((day) => periodIds.map((periodId) => ({ day, periodId })));
    const free = all.find((c) => !busy.has(personCellKey(c.day, c.periodId)))!;
    const taken = all.find((c) => busy.has(personCellKey(c.day, c.periodId)))!;
    data = editSede(data, first.id, (sede) => ({
      ...sede,
      teachers: sede.teachers.map((x) => (x.id === t.id ? { ...x, awaySlots: [free, taken] } : x)),
    }));
    const s = sheetOf(data, "Marino")!;
    assert.equal(s.cells.get(personCellKey(free.day, free.periodId))!.kind, "away");
    assert.equal(s.cells.get(personCellKey(taken.day, taken.periodId))!.kind, "lesson");
    // le × non contano come ore di lezione né come disposizioni
    assert.deepEqual(s.sedi.map((x) => x.lessons), [12, 6]);
    assert.equal(s.sedi.reduce((n, x) => n + x.disp, 0), 0);
  });

  it("le ore di una campanella diversa si riportano per orario; quelle fuori campanella si contano a parte", () => {
    let data = seed();
    const other = allSedi(data)[1]!;
    // la seconda sede comincia 10 minuti dopo: ogni sua ora tocca la stessa ora della prima
    data = editSede(data, other.id, (sede) => ({
      ...sede,
      settings: {
        ...sede.settings,
        periods: sede.settings.periods.map((p) => {
          const shift = (hhmm: string) => {
            const [h, m] = hhmm.split(":").map(Number);
            const t = h! * 60 + m! + 10;
            return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
          };
          return { ...p, start: shift(p.start), end: shift(p.end) };
        }),
      },
    }));
    const s = sheetOf(data, "Marino")!;
    assert.equal(s.unplaced, 0);
    assert.equal(s.sedi[1]!.lessons, 6);

    // un'ora della seconda sede dopo la fine di tutta la prima: non si può riportare
    data = editSede(data, other.id, (sede) => ({
      ...sede,
      settings: {
        ...sede.settings,
        periods: sede.settings.periods.map((p, i) => (i === 0 ? { ...p, start: "20:00", end: "20:50" } : p)),
      },
    }));
    const late = sheetOf(data, "Marino")!;
    assert.ok(late.unplaced > 0);
  });
});
