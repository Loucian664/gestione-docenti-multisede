import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  jointVersionPlan,
  withJointVersions,
  candidateOf,
  durationText,
  isComplete,
  lessonDistance,
  longRunImportNote,
  longRunMessage,
  longRunSlotStatus,
  longRunStatus,
  occupiedSlots,
  pickVersions,
  requestProblems,
  withVersions,
  type Candidate,
  type LongRunRequest,
} from "./calcolo-lungo.ts";
import { applyOrganicoFixes, buildSeed } from "./seed.ts";
import { allSedi, editSede, sedeName, withOtherSedi } from "./sedi.ts";
import { solveTimetable, type TimetableReport } from "./timetable-solver.ts";
import type { PersistedData, SavedTimetable, TimetableSlot } from "./types.ts";

const saved = (n: number, name: string): SavedTimetable => ({ n, name, savedAt: 1, lessons: [], disp: {} });

function seed(over: Partial<PersistedData> = {}): PersistedData {
  return { ...applyOrganicoFixes(buildSeed()), savedAt: 1000, ...over };
}

const req = (over: Partial<LongRunRequest> = {}): LongRunRequest => ({
  mode: "scratch",
  slots: [3, 4],
  replace: [],
  minutes: 60,
  scope: "sede",
  ...over,
});

describe("calcolo lungo: la richiesta", () => {
  it("slot liberi: nessun problema; il messaggio dice partenza, slot e durata", () => {
    const data = seed({ savedTimetables: [saved(2, "Prova A")] });
    assert.deepEqual(requestProblems(data, req()), []);
    const text = longRunMessage(data, req({ slots: [4, 2], replace: [2] }), "Utente/app", "backup.json");
    assert.match(text, /^Calcolo lungo dell’orario/);
    assert.match(text, /Repository: https:\/\/github\.com\/Utente\/app — istruzioni complete nel file CALCOLO-LUNGO\.md/);
    assert.match(text, /Sede: .* \(quella in uso nel backup\)\./);
    assert.match(text, /Partenza: da zero\. Slot: 2 \(sostituisce «Prova A»\), 4; gli altri restano come sono\. Durata: 1 ora\./);
    // il comando è già pronto: chi lo esegue mette solo il percorso del backup
    assert.match(
      text,
      /\n   node scripts\/calcolo-lungo\.mjs --backup <percorso del backup> --sedi sede --modo da-zero --slot 2,4 --sostituisci 2 --minuti 60\n/,
    );
    assert.match(text, /Non scrivere mai un orario a mano\./);
  });

  it("si ferma su slot occupati non da sostituire, sullo slot in uso, sullo 0 e sugli slot inesistenti", () => {
    const data = seed({ savedTimetables: [saved(2, "Prova A"), saved(5, "Prova B")], activeSlot: 5 });
    assert.equal(occupiedSlots(data).get(5), "Prova B");
    const problems = requestProblems(data, req({ slots: [0, 2, 5, 6] }));
    assert.equal(problems.length, 4);
    assert.ok(problems.some((p) => /slot 2 è occupato da «Prova A»/.test(p)));
    assert.ok(problems.some((p) => /slot 5 è quello in uso/.test(p)));
    assert.deepEqual(requestProblems(data, req({ slots: [2], replace: [2] })), []);
  });

  it("la durata in parole; con tutti e 5 gli slot il messaggio non parla degli altri", () => {
    assert.deepEqual([1, 30, 60, 61, 90, 120].map(durationText), [
      "1 minuto",
      "30 minuti",
      "1 ora",
      "1 ora e 1 minuto",
      "1 ora e 30 minuti",
      "2 ore",
    ]);
    const text = longRunMessage(seed(), req({ slots: [1, 2, 3, 4, 5] }), "Utente/app", "backup.json");
    assert.match(text, /Slot: 1, 2, 3, 4, 5\. Durata/);
  });

  it("«Migliora» senza un orario da migliorare non si può", () => {
    const data = seed({ slots: [] });
    assert.ok(requestProblems(data, req({ mode: "improve" })).some((p) => /Migliora/.test(p)));
  });
});

describe("calcolo lungo: le versioni", () => {
  it("una soluzione del motore diventa un orario da slot completo", () => {
    const data = seed();
    const view = withOtherSedi(data);
    const res = solveTimetable(view, { timeMs: 1500, seed: 7, mode: "scratch" });
    const c = candidateOf(view, "scratch", res);
    assert.ok(c.part.lessons.length > 0);
    assert.ok(isComplete(c.report));
  });

  it("sceglie le migliori ma diverse; con poche diverse abbassa la soglia, mai due identiche", () => {
    const lesson = (i: number, day: number): TimetableSlot =>
      ({ id: `s${i}`, day, periodId: `p${i}`, classId: "c", teacherId: "t", subject: "X" }) as TimetableSlot;
    const base = Array.from({ length: 10 }, (_, i) => lesson(i, 1));
    const report = (soft: number) =>
      ({ lessons: 10, lessonsExpected: 10, score: { hard: 0, pen: 0, soft }, hard: { conflicts: [] } }) as unknown as TimetableReport;
    const cand = (lessons: TimetableSlot[], soft: number): Candidate => ({ part: { lessons, disp: {} }, report: report(soft), lessons });
    const a = cand(base, 1);
    const aCopy = cand(base.map((s) => ({ ...s, id: `${s.id}b` })), 2);
    const near = cand([...base.slice(0, 9), lesson(9, 2)], 3);
    const far = cand(base.map((s, i) => (i < 5 ? { ...s, day: 3 as const } : s)), 4);
    assert.equal(lessonDistance(base, aCopy.lessons), 0);
    assert.deepEqual(pickVersions([far, near, aCopy, a], 2), [a, far]);
    assert.deepEqual(pickVersions([far, near, aCopy, a], 3), [a, near, far]);
  });

  it("il backup restituito cambia solo gli slot scelti; savedAt subito dopo quello del backup", () => {
    const data = seed({ savedTimetables: [saved(2, "Prova A"), saved(3, "Vecchia")] });
    const part = { lessons: [], disp: {} };
    const out = withVersions(data, [{ n: 3, name: "Calcolo lungo 1 di 2", part }, { n: 4, name: "Calcolo lungo 2 di 2", part }], 5);
    assert.deepEqual(
      out.savedTimetables?.map((s) => [s.n, s.name]),
      [
        [2, "Prova A"],
        [3, "Calcolo lungo 1 di 2"],
        [4, "Calcolo lungo 2 di 2"],
      ],
    );
    assert.equal(out.savedAt, 1001);
    assert.equal(out.slots, data.slots);
    assert.equal(out.absences, data.absences);
  });
});

describe("calcolo lungo: tutte le sedi insieme", () => {
  it("uno slot occupato in un'altra sede conta come occupato; il messaggio nomina le sedi", () => {
    const data = editSede(seed(), allSedi(seed())[1]!.id, (d) => ({ ...d, savedTimetables: [saved(3, "Prova B")] }));
    assert.deepEqual(requestProblems(data, req({ slots: [1, 2], scope: "tutte" })), []);
    assert.ok(requestProblems(data, req({ slots: [3], scope: "tutte" })).some((p) => /slot 3 è occupato da «Prova B, /.test(p)));
    assert.deepEqual(requestProblems(data, req({ slots: [3], scope: "sede" })), []);
    const text = longRunMessage(data, req({ scope: "tutte" }), "U/r", "b.json");
    assert.match(text, /Sedi: tutte insieme \(.*\); ogni versione va nello stesso slot di ogni sede\./);
    assert.match(text, /--sedi tutte --modo da-zero --slot 3,4 --minuti 60/);
  });

  it("le versioni: equilibrato, poi giorni in un plesso, meno ore buche", () => {
    assert.deepEqual(
      jointVersionPlan(4).map((v) => v.key),
      ["equilibrato", "plesso", "buche", "equilibrato"],
    );
  });

  it("ogni versione va nello stesso slot di ogni sede, con lo stesso codice", () => {
    const data = seed();
    const parts = Object.fromEntries(allSedi(data).map((x) => [x.id, { lessons: [], disp: {} }]));
    const out = withJointVersions(data, [{ n: 2, name: "Calcolo lungo 1 di 1 · equilibrato", parts }], 5);
    const entries = allSedi(out).map((x) => x.data.savedTimetables?.find((s) => s.n === 2));
    assert.ok(entries.every((e) => e?.name === "Calcolo lungo 1 di 1 · equilibrato"));
    assert.ok(entries[0]?.insieme && entries.every((e) => e?.insieme === entries[0]?.insieme));
    assert.equal(out.savedAt, 1001);
    // il codice di controllo in ogni sede; se in una sede l'orario cambia, all'importazione lo slot va controllato
    assert.ok(entries.every((e) => e && longRunStatus(e, e) === "verificato"));
    assert.deepEqual(longRunImportNote(out), { text: "Slot 2: calcolato dal programma del calcolo lungo.", warn: false });
    const other = allSedi(out)[1]!;
    const changed = editSede(out, other.id, (d) => ({
      ...d,
      savedTimetables: (d.savedTimetables ?? []).map((x) => (x.n === 2 ? { ...x, disp: { t: [{ day: 1, periodId: "p1" }] } } : x)),
    }));
    const note = longRunImportNote(changed)!;
    assert.equal(note.warn, true);
    assert.match(note.text, /^Attenzione: lo slot 2 \(.+\) non risulta calcolato dal programma/);
    // nel dialogo dello slot: insieme conta ogni sede, e dice in quale è cambiato; da solo, solo la sede in uso
    assert.deepEqual(longRunSlotStatus(out, 2, true), { status: "verificato", sedi: [] });
    assert.deepEqual(longRunSlotStatus(changed, 2, true), { status: "cambiato", sedi: [sedeName(other.data.settings)] });
    assert.deepEqual(longRunSlotStatus(changed, 2, false), { status: "verificato", sedi: [] });
    assert.deepEqual(longRunSlotStatus(changed, 4, true), { status: null, sedi: [] });
  });
});
