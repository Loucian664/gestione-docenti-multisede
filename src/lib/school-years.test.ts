import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupJson, parseBackupJson } from "./export.ts";
import { mergeSlices, type PersistSlice } from "./persist-storage.ts";
import {
  archivedCounts,
  archivedSedi,
  archivedYearData,
  archivedYearLabels,
  startNewSchoolYear,
} from "./school-years.ts";
import { buildSeed } from "./seed.ts";
import { allSedi, editSede, exportSede, FIRST_SEDE_ID, replaceTeacherSedi, sedeIdOf, switchSede } from "./sedi.ts";
import { snapshot, useAppStore } from "./store.ts";
import type { Absence, ArchivedYear, PersistedData, SedeData, Substitution } from "./types.ts";

function absence(id: string, teacherId: string, date: string): Absence {
  return { id, teacherId, dateFrom: date, dateTo: date, reason: "malattia", notes: "", allDay: true, periodIds: [] };
}

function sub(id: string, date: string, absentTeacherId: string, substituteId: string | null): Substitution {
  return {
    id,
    date,
    periodId: "p1",
    classId: "c-1A",
    absentTeacherId,
    substituteId,
    type: "disposizione",
    activity: "",
    notes: "",
    subject: "Italiano",
  };
}

/** Gli esempi (due sedi, nomi inventati) a fine anno: assenze e sostituzioni in tutte e due, un docente sostituito. */
function finishedYear(): PersistedData {
  const seed = buildSeed();
  const withYear = (sede: SedeData, tag: string): SedeData => {
    const [t, other] = sede.teachers;
    return {
      ...sede,
      settings: { ...sede.settings, schoolYear: "2026/2027" },
      absences: [absence(`${tag}-a1`, t!.id, "2027-03-01")],
      substitutions: [sub(`${tag}-s1`, "2027-03-01", t!.id, other!.id)],
    };
  };
  let d = editSede(seed, sedeIdOf(seed), (s) => withYear(s, "a"));
  d = editSede(d, seed.altreSedi![0]!.id, (s) => withYear(s, "b"));
  const shared = d.teachers.find((t) => t.personId === "p-esempio-fra")!;
  return replaceTeacherSedi(d, shared.id, { lastName: "Nuova", firstName: "Persona" }, "2027-04-01", true)!;
}

const JUNE = Date.parse("2027-06-30T12:00:00");
const bOf = (d: PersistedData) => d.altreSedi![0]!.id;

describe("anni in archivio con più sedi", () => {
  it("l'anno finito va in archivio com'era, con tutte le sedi; quello nuovo riparte da zero in ogni sede", () => {
    const d = finishedYear();
    const next = startNewSchoolYear(d, " 2027/2028 ", JUNE);
    for (const s of allSedi(next)) {
      assert.deepEqual([s.data.absences, s.data.substitutions, s.data.formerTeachers], [[], [], []]);
      assert.equal(s.data.settings.schoolYear, "2027/2028");
    }
    assert.equal(next.archivedYears!.length, 1);
    const year = next.archivedYears![0]!;
    assert.equal(year.schoolYear, "2026/2027");
    assert.equal(year.archivedAt, JUNE);
    assert.equal(year.sedeId, sedeIdOf(d));
    const sedi = archivedSedi(year);
    assert.deepEqual(
      sedi.map((x) => x.id),
      allSedi(d).map((x) => x.id),
    );
    for (const s of allSedi(d)) {
      const kept = sedi.find((x) => x.id === s.id)!.data;
      assert.deepEqual(kept.absences, s.data.absences);
      assert.deepEqual(kept.substitutions, s.data.substitutions);
      assert.deepEqual(kept.formerTeachers, s.data.formerTeachers);
      assert.deepEqual(kept.teachers, s.data.teachers);
      assert.deepEqual(kept.slots, s.data.slots);
      assert.equal(kept.settings.schoolYear, "2026/2027");
    }
    assert.deepEqual(archivedCounts(year), { absences: 2, substitutions: 2, sedi: 2 });
  });

  it("per il Report: i dati della sede scelta in quell'anno, anche dell'altra sede", () => {
    const d = finishedYear();
    const year = startNewSchoolYear(d, "2027/2028", JUNE).archivedYears![0]!;
    const here = archivedYearData(year, sedeIdOf(d))!;
    const there = archivedYearData(year, bOf(d))!;
    assert.equal(here.settings.schoolName, d.settings.schoolName);
    assert.equal(there.settings.schoolName, d.altreSedi![0]!.data.settings.schoolName);
    // chi non è più in servizio c'è; la data cade nell'anno archiviato
    assert.equal(there.teachers.length, d.altreSedi![0]!.data.teachers.length + 1);
    assert.equal(there.selectedDate, "2027-08-31");
    assert.deepEqual(
      there.absences.map((a) => a.id).sort(),
      d.altreSedi![0]!.data.absences.map((a) => a.id).sort(),
    );
    // una sede che quell'anno non c'era; con un id diverso ma lo stesso nome si ritrova
    assert.equal(archivedYearData(year, "sede-nuova"), null);
    assert.equal(archivedYearData(year, "sede-nuova", there.settings.schoolName)?.settings.schoolName, there.settings.schoolName);
  });

  it("si archivia anche se solo una sede ha assenze; senza niente in nessuna sede no", () => {
    const seed = buildSeed();
    const empty = editSede(
      { ...seed, absences: [], substitutions: [] },
      bOf(seed),
      (s) => ({ ...s, absences: [], substitutions: [] }),
    );
    assert.deepEqual(startNewSchoolYear(empty, "2027/2028", JUNE).archivedYears, []);
    const onlyB = editSede(empty, bOf(seed), (s) => ({ ...s, absences: [absence("x", s.teachers[0]!.id, "2027-03-01")] }));
    assert.equal(startNewSchoolYear(onlyB, "2027/2028", JUNE).archivedYears!.length, 1);
  });

  it("gli archivi precedenti restano, il nuovo va in fondo; lo stesso anno due volte prende «(2)»", () => {
    const d = finishedYear();
    const first = startNewSchoolYear(d, "2027/2028", JUNE);
    const again = startNewSchoolYear({ ...first, absences: d.absences }, "2028/2029", JUNE + 1);
    assert.deepEqual(
      again.archivedYears!.map((y) => y.schoolYear),
      ["2026/2027", "2027/2028"],
    );
    const y = (id: string, schoolYear: string) => ({ id, schoolYear, archivedAt: 0, data: {} }) as unknown as ArchivedYear;
    const labels = archivedYearLabels([y("a", "2026/2027"), y("b", "2026/2027"), y("c", "")]);
    assert.deepEqual([...labels.values()], ["2026/2027", "2026/2027 (2)", "Anno senza nome"]);
  });

  it("cambiando sede l'archivio resta lo stesso, con tutte le sedi", () => {
    const d = startNewSchoolYear(finishedYear(), "2027/2028", JUNE);
    const there = switchSede(d, bOf(d));
    assert.deepEqual(there.archivedYears, d.archivedYears);
    assert.ok(archivedYearData(there.archivedYears![0]!, sedeIdOf(there)));
  });

  it("all'avvio una copia vecchia non riporta nell'anno in corso le assenze già in archivio, in nessuna sede", () => {
    const d = finishedYear();
    const now = startNewSchoolYear(d, "2027/2028", JUNE);
    for (const merged of [mergeSlices(d as PersistSlice, now as PersistSlice), mergeSlices(now as PersistSlice, d as PersistSlice)]) {
      assert.equal(merged.absences.length, 0);
      assert.equal(merged.substitutions.length, 0);
      assert.equal(merged.formerTeachers?.length ?? 0, 0);
      assert.equal(merged.archivedYears?.length, 1);
      assert.equal(merged.altreSedi![0]!.data.absences.length, 0);
      assert.equal(merged.altreSedi![0]!.data.substitutions.length, 0);
    }
  });

  it("un archivio dell'app della singola scuola (una sede) si legge come la sua sede", () => {
    const d = finishedYear();
    const year = startNewSchoolYear(d, "2027/2028", JUNE).archivedYears![0]!;
    const single: ArchivedYear = { id: year.id, schoolYear: year.schoolYear, archivedAt: year.archivedAt, data: year.data };
    assert.deepEqual(
      archivedSedi(single).map((x) => x.id),
      [FIRST_SEDE_ID],
    );
    assert.ok(archivedYearData(single, FIRST_SEDE_ID));
  });

  it("«Esporta sede» porta gli anni in archivio con i dati di quella sede sola", () => {
    const d = startNewSchoolYear(finishedYear(), "2027/2028", JUNE);
    const b = bOf(d);
    const out = exportSede(d, b);
    assert.equal(out.archivedYears!.length, 1);
    const y = out.archivedYears![0]!;
    assert.equal(y.altreSedi, undefined);
    assert.equal(y.data.settings.schoolName, d.altreSedi!.find((x) => x.id === b)!.data.settings.schoolName);
    assert.ok([...y.data.teachers, ...(y.data.formerTeachers ?? [])].every((t) => t.personId === undefined));
    assert.deepEqual(
      y.data.absences.map((a) => a.id),
      ["b-a1"],
    );
  });

  it("dal negozio: archivio, elimina, backup, dati di esempio", () => {
    const st = () => useAppStore.getState();
    st().importData(finishedYear());
    st().startNewSchoolYear("2027/2028");
    assert.equal(st().archivedYears?.length, 1);
    const id = st().archivedYears![0]!.id;
    const file = parseBackupJson(backupJson(snapshot(st())));
    st().removeArchivedYear(id);
    assert.equal(st().archivedYears?.length, 0);
    assert.equal(st().settings.schoolYear, "2027/2028");
    st().importData(file, "backup.json");
    assert.equal(st().archivedYears?.[0]?.id, id);
    // senza anno scritto resta quello di prima; senza assenze né sostituzioni non si archivia niente
    st().startNewSchoolYear("  ");
    assert.equal(st().settings.schoolYear, "2027/2028");
    assert.equal(st().archivedYears?.length, 1);
    // un backup senza archivio porta via quello di prima
    st().importData(buildSeed(), "esempio.json");
    assert.equal(st().archivedYears?.length ?? 0, 0);
    st().importData(file, "backup.json");
    st().resetDemo();
    assert.equal(st().archivedYears?.length ?? 0, 0);
  });
});
