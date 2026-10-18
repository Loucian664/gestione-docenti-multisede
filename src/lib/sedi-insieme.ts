/**
 * «Tutte le sedi insieme»: le classi di tutte le sedi in un problema solo per il motore di Costruisci.
 *
 * Ogni classe prende un id con davanti quello della sede; chi insegna in più sedi (stesso `personId`)
 * diventa un docente solo. Le × segnate in una sede valgono solo per quella sede (`insieme.sedeAway`),
 * le ore «no» sono personali e valgono ovunque. Le ore si abbinano per numero (1ª con 1ª…): le sedi
 * devono avere gli stessi giorni e le stesse ore del mattino.
 *
 * Il risultato del motore torna diviso per sede con `splitInsieme`; `insiemeParts` aggiunge a ogni sede le
 * ore a disposizione (nelle buche con «Da zero», come in una sede sola).
 */
import type { Cattedra, DayOfWeek, Period, PersistedData, SchoolClass, Teacher, TimetableSlot } from "./types";
import { resolveCattedre } from "./build-timetable";
import { allSedi, sedeAsData, sedeIdOf, sedeName, type SedeEntry } from "./sedi";
import { dispIntoGaps, dispOutcome, type InsiemeInfo, type SolveMode } from "./timetable-solver";
import { slotsWithLessons, timetablePart, type TimetablePart } from "./saved-timetables";

export type InsiemeData = PersistedData & { insieme: InsiemeInfo };

export type InsiemeMap = {
  sedi: { id: string; name: string }[];
  /** classe dell'insieme → sede e classe vera */
  classOf: Map<string, { sedeId: string; classId: string }>;
  /** docente dell'insieme → la sua scheda in ogni sede */
  recordOf: Map<string, Map<string, string>>;
  /** per sede: numero dell'ora → id dell'ora nella sede */
  periodOf: Map<string, Map<number, string>>;
  /** ora dell'insieme → numero */
  indexOf: Map<string, number>;
};

/** Si costruiscono insieme solo sedi con gli stessi giorni e le stesse ore del mattino. */
export function canBuildTogether(data: PersistedData): { ok: boolean; reason: string } {
  const sedi = allSedi(data);
  if (sedi.length < 2) return { ok: false, reason: "C’è una sede sola." };
  const days = (s: SedeEntry) => [...s.data.settings.days].sort().join(",");
  const morning = (s: SedeEntry) =>
    s.data.settings.periods
      .filter((p) => !p.tpOnly)
      .map((p) => p.index)
      .sort((a, b) => a - b)
      .join(",");
  const ref = sedi[0]!;
  for (const s of sedi.slice(1)) {
    if (days(s) !== days(ref))
      return { ok: false, reason: `${sedeName(s.data.settings)} ha giorni diversi da ${sedeName(ref.data.settings)}.` };
    if (morning(s) !== morning(ref))
      return {
        ok: false,
        reason: `${sedeName(s.data.settings)} ha ore del mattino diverse da ${sedeName(ref.data.settings)}.`,
      };
  }
  return { ok: true, reason: "" };
}

const jointPeriodId = (index: number) => `j${index}`;

/** Le classi, i docenti e l'orario di tutte le sedi come un problema solo. */
export function buildInsieme(data: PersistedData): { joint: InsiemeData; map: InsiemeMap; notes: string[] } {
  const sedi = allSedi(data);
  const activeId = sedeIdOf(data);
  const notes: string[] = [];

  // le ore: quelle della sede in uso, più quelle (pomeriggio) che ha solo un'altra sede
  const byIndex = new Map<number, Period>();
  for (const s of [sedi.find((x) => x.id === activeId)!, ...sedi.filter((x) => x.id !== activeId)]) {
    for (const p of s.data.settings.periods) if (!byIndex.has(p.index)) byIndex.set(p.index, p);
  }
  const periods: Period[] = [...byIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ ...p, id: jointPeriodId(p.index) }));
  const indexOf = new Map(periods.map((p) => [p.id, p.index]));

  const map: InsiemeMap = {
    sedi: sedi.map((s) => ({ id: s.id, name: sedeName(s.data.settings) })),
    classOf: new Map(),
    recordOf: new Map(),
    periodOf: new Map(),
    indexOf,
  };
  const classSede: Record<string, number> = {};
  const sedeAway: InsiemeInfo["sedeAway"] = {};
  const classes: SchoolClass[] = [];
  const slots: TimetableSlot[] = [];
  const cattedre: Cattedra[] = [];
  const groups = new Map<string, { si: number; sede: SedeEntry; t: Teacher }[]>();
  const keyOf = (sede: SedeEntry, t: Teacher) => (t.personId ? `P~${t.personId}` : `${sede.id}~${t.id}`);

  sedi.forEach((sede, si) => {
    const indexById = new Map(sede.data.settings.periods.map((p) => [p.id, p.index]));
    map.periodOf.set(sede.id, new Map(sede.data.settings.periods.map((p) => [p.index, p.id])));
    const pid = (periodId: string) => {
      const i = indexById.get(periodId);
      return i === undefined ? "" : jointPeriodId(i);
    };
    const cid = (classId: string) => `${sede.id}~${classId}`;
    const name = sedeName(sede.data.settings);
    for (const c of sede.data.classes) {
      classes.push({ ...c, id: cid(c.id), name: `${c.name} · ${name}` });
      classSede[cid(c.id)] = si;
      map.classOf.set(cid(c.id), { sedeId: sede.id, classId: c.id });
    }
    const keys = new Map<string, string>();
    for (const t of sede.data.teachers) {
      const key = keyOf(sede, t);
      keys.set(t.id, key);
      const list = groups.get(key) ?? [];
      list.push({ si, sede, t });
      groups.set(key, list);
      const rec = map.recordOf.get(key) ?? new Map<string, string>();
      rec.set(sede.id, t.id);
      map.recordOf.set(key, rec);
    }
    for (const s of sede.data.slots) {
      const teacherId = keys.get(s.teacherId);
      const periodId = pid(s.periodId);
      if (!teacherId || !periodId) continue;
      slots.push({ ...s, id: `${sede.id}~${s.id}`, classId: cid(s.classId), teacherId, periodId });
    }
    for (const row of resolveCattedre(sedeAsData(data, sede.data))) {
      cattedre.push({
        ...row,
        classId: cid(row.classId),
        teacherId: row.teacherId ? (keys.get(row.teacherId) ?? "") : "",
      });
    }
  });

  const teachers: Teacher[] = [];
  for (const [key, recs] of groups) {
    const first = recs.find((r) => r.sede.id === activeId) ?? recs[0]!;
    const multi = recs.length > 1;
    const pidIn = (r: (typeof recs)[number], periodId: string) => {
      const i = r.sede.data.settings.periods.find((p) => p.id === periodId)?.index;
      return i === undefined ? "" : jointPeriodId(i);
    };
    const cells = <T extends { day: DayOfWeek; periodId: string }>(r: (typeof recs)[number], list: T[] | undefined) =>
      (list ?? []).map((a) => ({ ...a, periodId: pidIn(r, a.periodId) })).filter((a) => a.periodId);
    const unique = <T extends { day: DayOfWeek; periodId: string }>(list: T[]) =>
      list.filter((a, i) => list.findIndex((b) => b.day === a.day && b.periodId === a.periodId) === i);
    const cid = (r: (typeof recs)[number], classId: string) => `${r.sede.id}~${classId}`;
    // classi della scheda nella sua sede (per le richieste su «tutte» le classi)
    const classesOf = (r: (typeof recs)[number]) =>
      cattedre.filter((c) => c.teacherId === key && c.classId.startsWith(`${r.sede.id}~`)).map((c) => c.classId);
    // tutta la settimana bloccata in una sede: le sue lezioni lì restano dove sono
    const lockWeekCells = (r: (typeof recs)[number]) =>
      r.t.lockWeek
        ? r.sede.data.slots
            .filter((s) => s.teacherId === r.t.id)
            .map((s) => ({ day: s.day, periodId: pidIn(r, s.periodId), classId: cid(r, s.classId) }))
            .filter((a) => a.periodId)
        : [];
    const t: Teacher = {
      ...first.t,
      id: key,
      subjects: [...new Set(recs.flatMap((r) => r.t.subjects))],
      weeklyHours: recs.reduce((n, r) => n + (r.t.weeklyHours ?? 0), 0),
      dispHours: recs.reduce((n, r) => n + (r.t.dispHours ?? 0), 0),
      dispSlots: unique(recs.flatMap((r) => cells(r, r.t.dispSlots))),
      assignedClassIds: recs.flatMap((r) => r.t.assignedClassIds.map((c) => cid(r, c))),
      cardRows: undefined,
      // × di una sede: per chi è in più sedi valgono solo lì; per gli altri come sempre
      awaySlots: multi ? [] : cells(first, first.t.awaySlots),
      otherPlesso: multi ? false : first.t.otherPlesso,
      avoidSlots: unique(recs.flatMap((r) => cells(r, r.t.avoidSlots))),
      preferSlots: unique(recs.flatMap((r) => cells(r, r.t.preferSlots))),
      mustSlots: recs.flatMap((r) =>
        cells(r, r.t.mustSlots).map((m) => ({
          ...m,
          classId: m.classId ? cid(r, m.classId) : undefined,
          classIds: m.allClasses ? classesOf(r) : (m.classIds ?? []).map((c) => cid(r, c)),
          allClasses: false,
        })),
      ),
      rientroDays: [...new Set(recs.flatMap((r) => r.t.rientroDays ?? []))],
      lockedSlots: [
        ...recs.flatMap((r) => cells(r, r.t.lockedSlots).map((a) => ({ ...a, classId: cid(r, a.classId) }))),
        ...recs.flatMap(lockWeekCells),
      ],
      lockWeek: false,
      allowTwoFree: recs.some((r) => r.t.allowTwoFree),
      noGaps: recs.some((r) => r.t.noGaps),
      dayPatterns: multi ? undefined : first.t.dayPatterns,
      dayPattern: multi ? undefined : first.t.dayPattern,
    };
    if (multi) {
      sedeAway[key] = recs.flatMap((r) => cells(r, r.t.awaySlots).map((a) => ({ s: r.si, day: a.day, periodId: a.periodId })));
      if (recs.some((r) => (r.t.dayPatterns?.length ?? 0) > 0 || r.t.dayPattern))
        notes.push(
          `${first.t.lastName} ${first.t.firstName}: le ore al giorno scelte valgono per una sede; con tutte le sedi insieme non si usano.`,
        );
    }
    teachers.push(t);
  }

  const active = sedi.find((s) => s.id === activeId)!.data.settings;
  const joint: InsiemeData = {
    settings: {
      ...active,
      days: [...active.days],
      periods,
      tpAfternoon: sedi.some((s) => s.data.settings.tpAfternoon),
    },
    teachers,
    classes,
    slots,
    absences: [],
    substitutions: [],
    cattedre,
    selectedDate: data.selectedDate,
    savedAt: 0,
    origin: "user",
    insieme: { sedi: map.sedi.map((s) => s.name), classSede, sedeAway },
  };
  return { joint, map, notes };
}

/** Le lezioni dell'insieme, tornate nelle loro sedi (classi, docenti e ore di ogni sede). */
export function splitInsieme(map: InsiemeMap, slots: TimetableSlot[]): Record<string, TimetableSlot[]> {
  const out: Record<string, TimetableSlot[]> = Object.fromEntries(map.sedi.map((s) => [s.id, []]));
  for (const s of slots) {
    const cls = map.classOf.get(s.classId);
    if (!cls) continue;
    const teacherId = map.recordOf.get(s.teacherId)?.get(cls.sedeId);
    const index = map.indexOf.get(s.periodId);
    const periodId = index === undefined ? undefined : map.periodOf.get(cls.sedeId)?.get(index);
    if (!teacherId || !periodId) continue;
    out[cls.sedeId]!.push({
      id: `slot-${cls.classId}-${s.day}-${periodId}-${teacherId}`,
      day: s.day,
      periodId,
      classId: cls.classId,
      teacherId,
      subject: s.subject,
    });
  }
  return out;
}

/**
 * Per ogni sede, l'orario da salvare: le lezioni nuove e le ore a disposizione (con «Da zero» nelle buche,
 * come in una sede sola; quelle che cadono su una lezione si tolgono).
 */
export function insiemeParts(
  data: PersistedData,
  lessons: Record<string, TimetableSlot[]>,
  mode: SolveMode,
): Record<string, TimetablePart> {
  const out: Record<string, TimetablePart> = {};
  for (const sede of allSedi(data)) {
    const base = sedeAsData(data, sede.data);
    const list = lessons[sede.id] ?? [];
    let propBase = base;
    if (mode === "scratch") {
      const plan = dispIntoGaps({ ...base, slots: slotsWithLessons(base, list) }, { replace: true });
      if (plan.moves.length)
        propBase = {
          ...base,
          teachers: base.teachers.map((t) => (plan.dispSlots[t.id] ? { ...t, dispSlots: plan.dispSlots[t.id] } : t)),
        };
    }
    out[sede.id] = timetablePart(propBase, list, dispOutcome(propBase, list, null).dispSlots);
  }
  return out;
}

/** Vista generale: ogni sede come archivio di un plesso, con le lezioni nuove al posto di quelle del mattino (se date). */
export type VistaSede = { id: string; name: string; letter: string; data: PersistedData };

export function vistaSedi(data: PersistedData, lessons?: Record<string, TimetableSlot[]>): VistaSede[] {
  return allSedi(data).map((s, i) => {
    const base = sedeAsData(data, s.data);
    return {
      id: s.id,
      name: sedeName(s.data.settings),
      letter: String.fromCharCode(65 + (i % 26)),
      data: lessons ? { ...base, slots: slotsWithLessons(base, lessons[s.id] ?? []) } : base,
    };
  });
}
