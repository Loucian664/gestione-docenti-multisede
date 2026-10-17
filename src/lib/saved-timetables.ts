import { isTimetableTeacher } from "./build-timetable";
import { isTpPeriodId } from "./periods";
import type { DayOfWeek, PersistedData, SavedTimetable, TimetableSlot } from "./types";

export type DispMap = Record<string, { day: DayOfWeek; periodId: string }[]>;

/** Ciò che uno slot conserva. */
export type TimetablePart = { lessons: TimetableSlot[]; disp: DispMap };

/** Slot delle prove; lo 0 è l’orario in vigore. */
export const SAVE_SLOTS = [1, 2, 3, 4, 5] as const;

export const OFFICIAL_NAME = "Orario in vigore";
/** Nome di una copia dell’orario in vigore in uno slot di prova. */
export const OFFICIAL_COPY_NAME = "Copia dell’orario in vigore";

/** Slot dell’orario in uso nell’app (0 = in vigore). */
export function activeSlotOf(data: PersistedData): number {
  return data.activeSlot ?? 0;
}

function poolIds(data: PersistedData): Set<string> {
  return new Set(data.teachers.filter(isTimetableTeacher).map((t) => t.id));
}

/** Ora del mattino: non la mensa, la 7ª o l’8ª del tempo prolungato. */
function isMorning(data: PersistedData, periodId: string): boolean {
  return !isTpPeriodId(data.settings.periods, periodId);
}

/**
 * La parte dell’orario che Costruisci cambia e che uno slot conserva: lezioni e ore a disposizione del
 * mattino dei docenti di materia. `slots`: l’orario (di norma quello in vigore); `disp`: le ore a
 * disposizione che cambiano (gli altri docenti come in `data`).
 */
export function timetablePart(
  data: PersistedData,
  slots: TimetableSlot[] = data.slots,
  disp: DispMap = {},
): TimetablePart {
  const pool = poolIds(data);
  const lessons = slots
    .filter((s) => pool.has(s.teacherId) && isMorning(data, s.periodId))
    .map((s) => ({ ...s }));
  const out: DispMap = {};
  for (const t of data.teachers) {
    if (!pool.has(t.id)) continue;
    out[t.id] = (disp[t.id] ?? t.dispSlots ?? [])
      .filter((a) => isMorning(data, a.periodId))
      .map((a) => ({ day: a.day, periodId: a.periodId }));
  }
  return { lessons, disp: out };
}

/** Impronta per riconoscere due orari uguali (senza gli id delle lezioni). */
export function timetableKey(part: TimetablePart): string {
  const lines = part.lessons.map(
    (s) => `L|${s.day}|${s.periodId}|${s.classId}|${s.teacherId}|${s.subject}`,
  );
  for (const [id, list] of Object.entries(part.disp)) {
    for (const a of list) lines.push(`D|${a.day}|${a.periodId}|${id}`);
  }
  return lines.sort().join("\n");
}

/**
 * Un orario salvato pronto da aprire: le lezioni ancora valide (docenti di materia e classi che ci sono
 * ancora, giorni e ore del mattino) e i dati con le ore a disposizione del mattino salvate nello slot.
 * `dropped`: lezioni lasciate fuori.
 */
export function openSavedTimetable(
  data: PersistedData,
  save: SavedTimetable,
): { lessons: TimetableSlot[]; dropped: number; base: PersistedData } {
  const pool = poolIds(data);
  const classes = new Set(data.classes.map((c) => c.id));
  const periods = new Set(data.settings.periods.map((p) => p.id));
  const fits = (day: DayOfWeek, periodId: string) =>
    data.settings.days.includes(day) && periods.has(periodId) && isMorning(data, periodId);
  const lessons = save.lessons
    .filter((s) => pool.has(s.teacherId) && classes.has(s.classId) && fits(s.day, s.periodId))
    .map((s) => ({ ...s }));
  const teachers = data.teachers.map((t) => {
    const saved = save.disp[t.id];
    if (!saved || !pool.has(t.id)) return t;
    const afternoon = (t.dispSlots ?? []).filter((a) => !isMorning(data, a.periodId));
    const morning = saved
      .filter((a) => fits(a.day, a.periodId))
      .map((a) => ({ day: a.day, periodId: a.periodId }));
    return { ...t, dispSlots: [...afternoon, ...morning] };
  });
  return { lessons, dropped: save.lessons.length - lessons.length, base: { ...data, teachers } };
}

/** Le ore dell’orario con quelle del mattino dei docenti di materia sostituite da `lessons`. */
export function slotsWithLessons(data: PersistedData, lessons: TimetableSlot[]): TimetableSlot[] {
  const pool = poolIds(data);
  return [
    ...data.slots.filter((s) => !(pool.has(s.teacherId) && isMorning(data, s.periodId))),
    ...lessons,
  ];
}

/** Ore a disposizione di ogni docente di materia, dopo i cambi (`changed`), partendo da `base`. */
export function poolDisp(base: PersistedData, changed: DispMap): DispMap {
  const pool = poolIds(base);
  const out: DispMap = {};
  for (const t of base.teachers) if (pool.has(t.id)) out[t.id] = changed[t.id] ?? t.dispSlots ?? [];
  return out;
}

/** Il contenuto di uno slot: quello in uso è l’orario dell’app, gli altri sono salvati. */
export function slotPart(data: PersistedData, n: number): TimetablePart | null {
  if (n === activeSlotOf(data)) return timetablePart(data);
  const s = (data.savedTimetables ?? []).find((x) => x.n === n);
  return s ? { lessons: s.lessons, disp: s.disp } : null;
}

/** Lezioni e docenti dell’app con l’orario `part` al posto di quello del mattino dei docenti di materia. */
export function withPart(
  data: PersistedData,
  part: TimetablePart,
): Pick<PersistedData, "slots" | "teachers"> & { dropped: number } {
  const open = openSavedTimetable(data, { n: -1, name: "", savedAt: 0, ...part });
  return {
    slots: slotsWithLessons(data, open.lessons),
    teachers: open.base.teachers,
    dropped: open.dropped,
  };
}

/**
 * I dati con l’orario in vigore (slot 0): quelli della scuola vera, per Oggi, assenze e sostituzioni,
 * anche mentre nell’app si usa una prova.
 */
export function officialData(data: PersistedData): PersistedData {
  if (activeSlotOf(data) === 0) return data;
  const official = slotPart(data, 0);
  if (!official) return { ...data, activeSlot: 0 };
  const { slots, teachers } = withPart(data, official);
  return { ...data, slots, teachers, activeSlot: 0 };
}

/** Scritta sui fogli e sui file fatti mentre si usa una prova (slot 1–5); null con l’orario in vigore. */
export function trialLabel(data: PersistedData): string | null {
  const n = activeSlotOf(data);
  return n ? `PROVA – SLOT ${n}` : null;
}

/** Aggiunta al nome dei file fatti mentre si usa una prova: «-prova-slot2». */
export function trialFileTag(data: PersistedData): string {
  const n = activeSlotOf(data);
  return n ? `-prova-slot${n}` : "";
}

/** Gli slot di prova uguali all’orario in vigore. */
export function slotsLikeOfficial(data: PersistedData): number[] {
  const official = slotPart(data, 0);
  if (!official) return [];
  const key = timetableKey(official);
  return SAVE_SLOTS.filter((n) => {
    const part = slotPart(data, n);
    return Boolean(part && part.lessons.length && timetableKey(part) === key);
  });
}
