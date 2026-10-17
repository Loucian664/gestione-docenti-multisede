import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimetableTeacher } from "./build-timetable.ts";
import { classTimetableSheet } from "./class-grid.ts";
import { backupJson, parseBackupJson, timetableXlsx } from "./export.ts";
import { TP_PERIODS } from "./periods.ts";
import { mergeSlices } from "./persist-storage.ts";
import {
  officialData,
  openSavedTimetable,
  poolDisp,
  slotPart,
  slotsLikeOfficial,
  slotsWithLessons,
  timetableKey,
  timetablePart,
  trialFileTag,
  trialLabel,
} from "./saved-timetables.ts";
import { buildSeed } from "./seed.ts";
import { snapshot, useAppStore } from "./store.ts";
import type { PersistedData, SavedTimetable } from "./types.ts";

/** L'esempio con pomeriggio T.P., un'ora di sostegno, lezioni e disposizioni anche del pomeriggio. */
function data(): PersistedData {
  const d = buildSeed();
  const pool = d.teachers.filter(isTimetableTeacher);
  const sos = d.teachers.find((t) => t.role === "sostegno")!;
  const a = pool[0]!;
  const b = pool[1]!;
  const lesson = d.slots.find((s) => s.teacherId === a.id)!;
  return {
    ...d,
    settings: { ...d.settings, tpAfternoon: true, periods: [...d.settings.periods, ...TP_PERIODS] },
    teachers: d.teachers.map((t) =>
      t.id === a.id
        ? {
            ...t,
            dispSlots: [
              { day: 5, periodId: "p6" },
              { day: 2, periodId: "p7" },
            ],
          }
        : t.id === b.id
          ? { ...t, dispSlots: [{ day: 3, periodId: "p1" }] }
          : t,
    ),
    slots: [
      ...d.slots,
      {
        id: "sos-1",
        day: lesson.day,
        periodId: lesson.periodId,
        classId: lesson.classId,
        teacherId: sos.id,
        subject: "Sostegno",
      },
      {
        id: "pom-1",
        day: 2,
        periodId: "p8",
        classId: lesson.classId,
        teacherId: a.id,
        subject: "Italiano",
      },
    ],
  };
}

function save(d: PersistedData, n: number, over: Partial<SavedTimetable> = {}): SavedTimetable {
  return { n, name: `Prova ${n}`, savedAt: 1_800_000_000_000, ...timetablePart(d), ...over };
}

describe("slot degli orari", () => {
  it("salva solo il mattino dei docenti di materia: lezioni e ore a disposizione", () => {
    const d = data();
    const part = timetablePart(d);
    assert.ok(part.lessons.length > 100);
    assert.ok(!part.lessons.some((s) => s.id === "sos-1" || s.id === "pom-1"));
    const a = d.teachers.filter(isTimetableTeacher)[0]!;
    assert.deepEqual(part.disp[a.id], [{ day: 5, periodId: "p6" }]);
    assert.equal(Object.keys(part.disp).length, d.teachers.filter(isTimetableTeacher).length);
    assert.ok(!Object.keys(part.disp).includes(d.teachers.find((t) => t.role === "sostegno")!.id));
  });

  it("riconosce lo stesso orario anche con id e ordine diversi, non se cambia un’ora", () => {
    const d = data();
    const part = timetablePart(d);
    const same = {
      lessons: [...part.lessons].reverse().map((s, i) => ({ ...s, id: `x${i}` })),
      disp: part.disp,
    };
    assert.equal(timetableKey(same), timetableKey(part));
    const moved = {
      ...part,
      lessons: part.lessons.map((s, i) => (i === 0 ? { ...s, day: s.day === 1 ? 2 : 1 } : s)),
    } as typeof part;
    assert.notEqual(timetableKey(moved), timetableKey(part));
    const b = d.teachers.filter(isTimetableTeacher)[1]!;
    const dispMoved = {
      ...part,
      disp: { ...part.disp, [b.id]: [{ day: 3 as const, periodId: "p2" }] },
    };
    assert.notEqual(timetableKey(dispMoved), timetableKey(part));
  });

  it("aprendo uno slot: lezioni valide e ore a disposizione del mattino salvate, il pomeriggio resta", () => {
    const d = data();
    const pool = d.teachers.filter(isTimetableTeacher);
    const a = pool[0]!;
    const gone = pool[2]!;
    const s = save(d, 3, {
      disp: { ...timetablePart(d).disp, [a.id]: [{ day: 1, periodId: "p2" }] },
    });
    // nel frattempo un docente non c'è più
    const now = { ...d, teachers: d.teachers.filter((t) => t.id !== gone.id) };
    const open = openSavedTimetable(now, s);
    const goneLessons = s.lessons.filter((x) => x.teacherId === gone.id).length;
    assert.ok(goneLessons > 0);
    assert.equal(open.dropped, goneLessons);
    assert.equal(open.lessons.length, s.lessons.length - goneLessons);
    const ta = open.base.teachers.find((t) => t.id === a.id)!;
    assert.deepEqual(ta.dispSlots, [
      { day: 2, periodId: "p7" },
      { day: 1, periodId: "p2" },
    ]);
    // gli altri docenti e i dati in vigore non cambiano
    assert.equal(now.teachers.find((t) => t.id === a.id)!.dispSlots!.length, 2);
    assert.equal(open.base.slots, now.slots);
  });

  it("sostituisce solo le lezioni del mattino dei docenti di materia", () => {
    const d = data();
    const part = timetablePart(d);
    const next = slotsWithLessons(d, part.lessons.slice(0, 10));
    assert.ok(next.some((s) => s.id === "sos-1"));
    assert.ok(next.some((s) => s.id === "pom-1"));
    assert.equal(next.length, 10 + 2);
  });

  it("ore a disposizione di tutti i docenti di materia dopo i cambi", () => {
    const d = data();
    const pool = d.teachers.filter(isTimetableTeacher);
    const out = poolDisp(d, { [pool[1]!.id]: [] });
    assert.equal(Object.keys(out).length, pool.length);
    assert.deepEqual(out[pool[1]!.id], []);
    assert.equal(out[pool[0]!.id]!.length, 2);
  });

  it("trova gli slot di prova uguali all’orario in vigore", () => {
    const d = data();
    const other = save(d, 2, { lessons: timetablePart(d).lessons.slice(1) });
    assert.deepEqual(slotsLikeOfficial({ ...d, savedTimetables: [other] }), []);
    assert.deepEqual(slotsLikeOfficial({ ...d, savedTimetables: [other, save(d, 4)] }), [4]);
  });

  it("mentre si prova uno slot, Oggi e le sostituzioni usano l’orario in vigore", () => {
    const d = data();
    const official = save(d, 0, { name: "Orario in vigore" });
    // in uso lo slot 2: l'app ha un'altra disposizione delle lezioni
    const trialLessons = timetablePart(d).lessons.map((s) => ({
      ...s,
      day: (s.day === 1 ? 2 : s.day === 2 ? 1 : s.day) as typeof s.day,
    }));
    const trial = {
      ...d,
      slots: slotsWithLessons(d, trialLessons),
      activeSlot: 2,
      savedTimetables: [official],
    };
    assert.equal(
      timetableKey(slotPart(trial, 2)!),
      timetableKey({ lessons: trialLessons, disp: timetablePart(d).disp }),
    );
    const off = officialData(trial);
    assert.equal(timetableKey(timetablePart(off)), timetableKey(timetablePart(d)));
    assert.ok(off.slots.some((s) => s.id === "sos-1") && off.slots.some((s) => s.id === "pom-1"));
    // con lo slot 0 in uso, i dati restano quelli
    assert.equal(officialData(d), d);
  });

  it("gli slot passano nel backup e restano nell’unione delle copie salvate", () => {
    const d = { ...data(), savedTimetables: [save(data(), 2), save(data(), 5)] };
    const back = parseBackupJson(backupJson(d));
    assert.deepEqual(
      back.savedTimetables?.map((s) => s.n),
      [2, 5],
    );
    assert.equal(back.savedTimetables?.[0]?.lessons.length, d.savedTimetables[0]!.lessons.length);
    const older = { ...d, savedAt: 1, origin: "user" as const, savedTimetables: [] };
    const newer = { ...d, savedAt: 2, origin: "user" as const };
    assert.equal(mergeSlices(older, newer).savedTimetables?.length, 2);
    assert.equal(
      mergeSlices(newer, { ...older, savedTimetables: undefined }).savedTimetables?.length,
      2,
    );
  });
});

describe("slot in uso, «Rendi in vigore» e «Annulla»", () => {
  const store = () => useAppStore.getState();
  const key = () => timetableKey(timetablePart(snapshot(store())));
  function start() {
    store().importData(data(), "prova.json");
    return key();
  }
  /** un orario diverso: lunedì e martedì scambiati */
  function other(): ReturnType<typeof timetablePart> {
    const part = timetablePart(snapshot(store()));
    return {
      lessons: part.lessons.map((s) => ({
        ...s,
        day: (s.day === 1 ? 2 : s.day === 2 ? 1 : s.day) as typeof s.day,
      })),
      disp: part.disp,
    };
  }

  it("«Usa questo orario» va in uno slot di prova: l’orario in vigore non cambia", () => {
    const official = start();
    const trial = other();
    store().putInSlot(3, trial, "Prova A");
    assert.equal(store().activeSlot, 3);
    assert.equal(key(), timetableKey(trial));
    assert.equal(timetableKey(slotPart(snapshot(store()), 0)!), official);
    assert.equal(timetableKey(timetablePart(officialData(snapshot(store())))), official);
    // sostegno e pomeriggio restano
    assert.ok(
      store().slots.some((s) => s.id === "sos-1") && store().slots.some((s) => s.id === "pom-1"),
    );
  });

  it("le modifiche durante la prova restano nello slot; si torna all’orario in vigore", () => {
    const official = start();
    store().putInSlot(2, other(), "Prova B");
    const moved = store().slots.find((s) => s.id !== "sos-1" && s.id !== "pom-1" && s.day === 3)!;
    store().upsertSlot({ ...moved, day: 4 });
    const edited = key();
    store().activateSlot(0);
    assert.equal(store().activeSlot, 0);
    assert.equal(key(), official);
    assert.ok(!(store().savedTimetables ?? []).some((s) => s.n === 0));
    assert.equal(timetableKey(slotPart(snapshot(store()), 2)!), edited);
    assert.equal(store().savedTimetables?.find((s) => s.n === 2)?.name, "Prova B");
    // e di nuovo nello slot 2
    store().activateSlot(2);
    assert.equal(key(), edited);
  });

  it("«Rendi in vigore» e «Annulla»", () => {
    const official = start();
    const trial = other();
    store().putInSlot(4, trial, "Prova C");
    store().makeOfficial(4);
    assert.equal(store().activeSlot, 0);
    assert.equal(key(), timetableKey(trial));
    assert.equal(timetableKey(slotPart(snapshot(store()), 4)!), timetableKey(trial));
    assert.deepEqual(slotsLikeOfficial(snapshot(store())), [4]);
    assert.equal(timetableKey(store().officialBackup!), official);
    store().undoMakeOfficial();
    assert.equal(key(), official);
    assert.equal(store().officialBackup, undefined);
    // anche con un’altra prova in uso: l’orario in vigore cambia, quello in uso no
    store().saveTimetable({ n: 5, name: "Prova D", savedAt: 1, ...trial });
    store().putInSlot(1, timetablePart(snapshot(store())), "Prova E");
    store().makeOfficial(5);
    assert.equal(store().activeSlot, 0);
    assert.equal(key(), timetableKey(trial));
    store().undoMakeOfficial();
    assert.equal(key(), official);
  });

  it("non si svuota lo slot in uso; il backup porta slot in uso e copia di prima", () => {
    start();
    store().putInSlot(2, other(), "Prova F");
    store().clearSavedTimetable(2);
    assert.ok((store().savedTimetables ?? []).some((s) => s.n === 2));
    const back = parseBackupJson(backupJson(snapshot(store())));
    assert.equal(back.activeSlot, 2);
    assert.deepEqual(
      (back.savedTimetables ?? []).map((s) => s.n),
      [0, 2],
    );
  });
});

describe("stampe e file di una prova", () => {
  it("con una prova in uso c’è la scritta «PROVA – SLOT n», con l’orario in vigore no", () => {
    const d = data();
    const official = { n: 0, name: "Orario in vigore", savedAt: 1, ...timetablePart(d) };
    const trial = { ...d, activeSlot: 2, savedTimetables: [official] };
    assert.equal(trialLabel(d), null);
    assert.equal(trialFileTag(d), "");
    assert.equal(trialLabel(trial), "PROVA – SLOT 2");
    assert.equal(trialFileTag(trial), "-prova-slot2");
    // Oggi, sostituzioni e report: orario in vigore, senza scritta
    assert.equal(trialLabel(officialData(trial)), null);
    const title = (x: typeof d) => String(classTimetableSheet(x).rows[1]?.[0]?.v);
    assert.equal(title(d), "ORARIO SETTIMANALE DELLE LEZIONI");
    assert.equal(title(trial), "ORARIO SETTIMANALE DELLE LEZIONI · PROVA – SLOT 2");
    assert.match(timetableXlsx(trial).name, /^orario-prova-slot2-/);
    assert.match(timetableXlsx(d).name, /^orario-[^p]/);
  });
});
