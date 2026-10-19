import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  Absence,
  Cattedra,
  DayOfWeek,
  PersistedData,
  SavedTimetable,
  SchoolClass,
  SedeData,
  Settings,
  Substitution,
  Teacher,
  TimetableSlot,
} from "./types";
import { buildSeed, EMPTY_DATA, applyOrganicoFixes } from "./seed";
import { uid } from "./utils";
import { isTimetableTeacher, applyTeacherCattedre } from "./build-timetable";
import { isTpPeriodId } from "./periods";
import { OFFICIAL_NAME, activeSlotOf, slotPart, timetableKey, withPart, type TimetablePart } from "./saved-timetables";
import { todayIso } from "./dates";
import {
  createDurableStorage,
  noteUserMutation,
  PERSIST_VERSION,
  withOrigin,
  writePersistSync,
} from "./persist-storage";
import {
  addSede as addSedeTo,
  allSedi,
  classInUse,
  dropRemovedSede as dropRemovedSedeFrom,
  editSede,
  importSede as importSedeInto,
  newSedeData,
  pickSede,
  removeSede as removeSedeFrom,
  sedeAsData,
  sedeIdOf,
  setSchoolYear as setSchoolYearIn,
  saveTeacherSedi as saveTeacherSediIn,
  setTeacherSedi as setTeacherSediIn,
  type CardRow,
  switchSede as switchSedeTo,
  syncPersonFields,
} from "./sedi";

/** Un'assenza eliminata e le coperture tolte con lei, ciascuna con la sua posizione. */
export type RemovedAbsence = {
  absence: { item: Absence; index: number };
  substitutions: { item: Substitution; index: number }[];
};

/** Rimette gli elementi al loro posto, senza doppioni se nel frattempo ci sono già. */
function reinsert<T extends { id: string }>(list: T[], removed: { item: T; index: number }[]): T[] {
  const out = [...list];
  for (const r of [...removed].sort((a, b) => a.index - b.index)) {
    if (out.some((x) => x.id === r.item.id)) continue;
    out.splice(Math.min(r.index, out.length), 0, r.item);
  }
  return out;
}

type Actions = {
  snapToToday: () => void;
  resumeTodayIfStale: () => void;
  setSelectedDate: (date: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addTeacher: (t: Omit<Teacher, "id">) => string;
  updateTeacher: (id: string, patch: Partial<Teacher>) => void;
  /** `drop`: lezioni del docente da togliere dall'orario (classi tolte dalla scheda). */
  saveTeacherCard: (
    id: string | null,
    patch: Omit<Teacher, "id">,
    rows: { classId: string; subject: string; hours: number }[],
    drop?: string[],
  ) => string;
  /**
   * La scheda docente con le classi di tutte le sedi: `rows` per id della sede, `sedeIds` le sedi in cui
   * insegna, `patch.weeklyHours` le ore cattedra di tutte le sedi, `drop` le lezioni da togliere dall'orario
   * di ogni sede. Restituisce l'id e le sedi da cui non si è potuto togliere.
   */
  saveTeacherCardSedi: (
    id: string | null,
    patch: Omit<Teacher, "id">,
    rows: Record<string, CardRow[]>,
    sedeIds: string[],
    drop?: Record<string, string[]>,
  ) => { teacherId: string; blocked: string[] };
  removeTeacher: (id: string) => void;
  addClass: (c: Omit<SchoolClass, "id">) => void;
  updateClass: (id: string, patch: Partial<SchoolClass>) => void;
  removeClass: (id: string) => void;
  upsertSlot: (slot: Omit<TimetableSlot, "id"> & { id?: string }) => void;
  clearSlot: (id: string) => void;
  addAbsence: (a: Omit<Absence, "id">) => string;
  updateAbsence: (id: string, patch: Partial<Absence>) => void;
  /** Restituisce cosa ha tolto, per poterlo rimettere con restoreAbsence. */
  removeAbsence: (id: string) => RemovedAbsence | null;
  restoreAbsence: (removed: RemovedAbsence) => void;
  saveSubstitution: (s: Omit<Substitution, "id"> & { id?: string }) => void;
  removeSubstitution: (id: string) => void;
  applyAutoAssign: (items: Substitution[]) => void;
  replaceCattedraSlots: (
    slots: TimetableSlot[],
    dispSlots?: Record<string, { day: DayOfWeek; periodId: string }[]>,
  ) => void;
  undoCattedraSlots: () => void;
  /** Salva un orario nello slot `entry.n` (1–5), al posto di quello che c’era; non cambia lo slot in uso. */
  saveTimetable: (entry: SavedTimetable) => void;
  renameSavedTimetable: (n: number, name: string) => void;
  /** Svuota uno slot di prova (non quello in uso). */
  clearSavedTimetable: (n: number) => void;
  /** Usa lo slot `n` (0–5): l’orario in uso resta salvato nel suo slot e al suo posto va quello di `n`. */
  activateSlot: (n: number) => void;
  /** Mette un orario nello slot di prova `n` (1–5) e lo usa. */
  putInSlot: (n: number, part: TimetablePart, name: string) => void;
  /** «Tutte le sedi insieme»: l'orario di ogni sede nel suo slot di prova `n`, in uso in tutte le sedi. */
  putInSlotAll: (n: number, parts: Record<string, TimetablePart>, name: string) => void;
  /** «Tutte le sedi insieme»: salva l'orario di ogni sede nel suo slot `n`; gli orari in uso non cambiano. */
  saveTimetableAll: (n: number, parts: Record<string, TimetablePart>, name: string) => void;
  /** «Rendi in vigore»: lo slot `n` diventa l’orario in vigore (slot 0) e quello in uso. */
  makeOfficial: (n: number) => void;
  /** Annulla l’ultimo «Rendi in vigore» (in tutte le sedi, se era per tutte le sedi insieme). */
  undoMakeOfficial: () => void;
  /** Slot salvato per tutte le sedi insieme: lo usa in tutte le sedi. */
  activateSlotAll: (n: number) => void;
  /** Slot salvato per tutte le sedi insieme: diventa l’orario in vigore in tutte le sedi. */
  makeOfficialAll: (n: number) => void;
  /** Slot salvato per tutte le sedi insieme: lo svuota in tutte le sedi (dove non è in uso). */
  clearSavedTimetableAll: (n: number) => void;
  /** Slot salvato per tutte le sedi insieme: gli cambia nome in tutte le sedi. */
  renameSavedTimetableAll: (n: number, name: string) => void;
  setCattedre: (cattedre: Cattedra[]) => void;
  /** La sede `id` diventa quella in uso in tutte le pagine. */
  switchSede: (id: string) => void;
  /** Nuova sede vuota, con giorni e campanella della sede in uso; restituisce il suo id. */
  addSede: (name: string) => string;
  /** Aggiunge come nuova sede quella in uso nel backup, collegando i docenti indicati; restituisce l'id. */
  importSede: (data: PersistedData, links: { incomingId: string; sedeId: string; teacherId: string }[]) => string;
  updateSede: (id: string, patch: Partial<Settings>) => void;
  /** Mai l'ultima; i docenti in comune conservano le ore di quella sede (`removedSedi`). */
  removeSede: (id: string) => void;
  /** «Non insegna più lì»: toglie una sede eliminata dalle schede della persona. */
  dropRemovedSede: (personId: string, name: string) => void;
  /** Uguale per tutte le sedi. */
  setSchoolYear: (schoolYear: string) => void;
  addClassIn: (sedeId: string, c: Omit<SchoolClass, "id">) => void;
  updateClassIn: (sedeId: string, id: string, patch: Partial<SchoolClass>) => void;
  removeClassIn: (sedeId: string, id: string) => void;
  /** Sposta una classe senza lezioni né cattedre in un'altra sede. */
  moveClass: (fromSedeId: string, id: string, toSedeId: string) => boolean;
  /** Le sedi in cui insegna il docente della sede in uso; restituisce le sedi da cui non si è potuto togliere. */
  setTeacherSedi: (teacherId: string, sedeIds: string[]) => string[];
  importData: (data: PersistedData, fileName?: string) => void;
  resetDemo: () => void;
  clearAll: () => void;
};

export type AppStore = PersistedData & Actions;

export function snapshot(state: AppStore): PersistedData {
  return {
    settings: state.settings,
    teachers: state.teachers,
    classes: state.classes,
    slots: state.slots,
    absences: state.absences,
    substitutions: state.substitutions,
    selectedDate: state.selectedDate,
    cattedre: state.cattedre,
    cattedraBackup: state.cattedraBackup,
    cattedraDispBackup: state.cattedraDispBackup,
    savedTimetables: state.savedTimetables,
    activeSlot: state.activeSlot,
    officialBackup: state.officialBackup,
    savedAt: state.savedAt,
    origin: state.origin,
    importedBackupName: state.importedBackupName,
    sedeId: state.sedeId,
    altreSedi: state.altreSedi,
    ordineSedi: state.ordineSedi,
  };
}

/** Le correzioni dell'organico, per la sede in uso e per le altre. */
function fixAllSedi(data: PersistedData): PersistedData {
  const top = applyOrganicoFixes(data);
  return {
    ...top,
    altreSedi: (data.altreSedi ?? []).map((a) => ({ id: a.id, data: pickSede(applyOrganicoFixes(sedeAsData(data, a.data))) })),
  };
}

/**
 * «Usa…»: l'orario va nello slot di prova `n` e diventa quello in uso; l'orario in vigore (0) resta.
 * `insieme`: il codice dello slot di tutte le sedi insieme.
 */
function putInSlotData(
  state: PersistedData,
  n: number,
  part: TimetablePart,
  name: string,
  insieme?: string,
): PersistedData {
  const entry: SavedTimetable = { n, name, savedAt: Date.now(), ...part, ...(insieme ? { insieme } : {}) };
  const kept = activeSlotOf(state) === n ? (state.savedTimetables ?? []) : keepActive(state);
  const { slots, teachers } = withPart(state, part);
  return {
    ...state,
    slots,
    teachers,
    activeSlot: n,
    savedTimetables: [...kept.filter((x) => x.n !== n), entry].sort((a, b) => a.n - b.n),
  };
}

/** Lezioni tolte dall'orario di ogni sede (id della sede → id delle lezioni). */
function withoutSlots(data: PersistedData, drop: Record<string, string[]>): PersistedData {
  let next = data;
  for (const [sedeId, ids] of Object.entries(drop)) {
    if (!ids.length) continue;
    const gone = new Set(ids);
    next = editSede(next, sedeId, (sede) => ({ ...sede, slots: sede.slots.filter((x) => !gone.has(x.id)) }));
  }
  return next;
}

/** La scheda docente salvata nella sede in uso: righe, cattedre e campi uguali nelle altre sedi. */
function teacherCardData(
  state: PersistedData,
  id: string | null,
  patch: Omit<Teacher, "id">,
  rows: CardRow[],
): { teacherId: string; data: PersistedData } {
  const teacherId = id ?? uid("t");
  const nextPatch = { ...patch, cardRows: rows };
  const teachers = id
    ? state.teachers.map((t) => (t.id === id ? { ...t, ...nextPatch } : t))
    : [...state.teachers, { ...nextPatch, id: teacherId }];
  const cattedre = applyTeacherCattedre({ ...state, teachers }, teacherId, rows);
  // nome, materie, ruolo e colore uguali nelle altre sedi in cui insegna
  return { teacherId, data: syncPersonFields({ ...state, teachers, cattedre }, teacherId) };
}

/**
 * Classe tolta da una sede, con le sue lezioni e cattedre e le righe delle schede dei docenti. `otherSede`: non è
 * la sede in uso, dove le ore del docente sono quelle delle sue righe (senza le righe tolte).
 */
function withoutClass(sede: SedeData, id: string, otherSede: boolean): SedeData {
  return {
    ...sede,
    classes: sede.classes.filter((c) => c.id !== id),
    slots: sede.slots.filter((s) => s.classId !== id),
    cattedre: (sede.cattedre ?? []).filter((x) => x.classId !== id),
    teachers: sede.teachers.map((t) => {
      const gone = (t.cardRows ?? []).filter((r) => r.classId === id);
      if (!gone.length && !t.assignedClassIds.includes(id)) return t;
      const hours = gone.reduce((n, r) => n + r.hours, 0);
      return {
        ...t,
        assignedClassIds: t.assignedClassIds.filter((c) => c !== id),
        ...(t.cardRows ? { cardRows: t.cardRows.filter((r) => r.classId !== id) } : {}),
        ...(otherSede && hours > 0 ? { weeklyHours: Math.max(0, (t.weeklyHours ?? 0) - hours) } : {}),
      };
    }),
  };
}

/**
 * Gli slot dopo aver lasciato quello in uso: il suo orario (l’app) resta salvato lì. Lo slot 0 si salva
 * col suo nome; una prova tiene il nome e prende la data nuova solo se l’orario è cambiato.
 */
function keepActive(state: PersistedData): SavedTimetable[] {
  const n = activeSlotOf(state);
  const part = slotPart(state, n)!;
  const list = state.savedTimetables ?? [];
  const old = list.find((x) => x.n === n);
  const same = old && timetableKey(old) === timetableKey(part);
  const entry: SavedTimetable = {
    n,
    name: old?.name ?? (n === 0 ? OFFICIAL_NAME : `Slot ${n}`),
    savedAt: same ? old.savedAt : Date.now(),
    ...part,
    // salvato per tutte le sedi insieme: lo resta
    ...(old?.insieme && n !== 0 ? { insieme: old.insieme } : {}),
  };
  return [...list.filter((x) => x.n !== n), entry].sort((a, b) => a.n - b.n);
}

/** Usa lo slot `n` (0–5): l’orario in uso resta salvato nel suo slot e al suo posto va quello di `n`. */
function activateSlotData(state: PersistedData, n: number): PersistedData | null {
  if (n === activeSlotOf(state)) return null;
  const kept = keepActive(state);
  const target = kept.find((x) => x.n === n);
  if (!target) return null;
  const { slots, teachers } = withPart(state, target);
  // lo slot in uso è l’orario dell’app: la sua copia salvata non serve (per lo 0 si toglie)
  return { ...state, slots, teachers, activeSlot: n, savedTimetables: n === 0 ? kept.filter((x) => x.n !== 0) : kept };
}

/** «Rendi in vigore»: lo slot `n` diventa l’orario in vigore e quello in uso; `insieme`: per tutte le sedi. */
function makeOfficialData(state: PersistedData, n: number, insieme?: string): PersistedData | null {
  const target = slotPart(state, n);
  const official = slotPart(state, 0);
  if (n === 0 || !target) return null;
  const kept = activeSlotOf(state) === 0 ? (state.savedTimetables ?? []) : keepActive(state);
  const { slots, teachers } = withPart(state, target);
  return {
    ...state,
    slots,
    teachers,
    activeSlot: 0,
    savedTimetables: kept.filter((x) => x.n !== 0),
    officialBackup: official
      ? { n: 0, name: OFFICIAL_NAME, savedAt: Date.now(), ...official, ...(insieme ? { insieme } : {}) }
      : undefined,
  };
}

/** Annulla «Rendi in vigore» in una sede. */
function undoOfficialData(state: PersistedData): PersistedData | null {
  const backup = state.officialBackup;
  if (!backup) return null;
  const clean: SavedTimetable = { ...backup };
  delete clean.insieme;
  if (activeSlotOf(state) === 0) {
    const { slots, teachers } = withPart(state, clean);
    return { ...state, slots, teachers, officialBackup: undefined };
  }
  return {
    ...state,
    savedTimetables: [...(state.savedTimetables ?? []).filter((x) => x.n !== 0), clean].sort((a, b) => a.n - b.n),
    officialBackup: undefined,
  };
}

/** Lo stesso cambio in ogni sede (le sedi dove non si può restano come sono). */
function inAllSedi(state: PersistedData, fn: (data: PersistedData) => PersistedData | null): PersistedData {
  let next = state;
  for (const sede of allSedi(state)) {
    const changed = fn(sedeAsData(next, allSedi(next).find((x) => x.id === sede.id)!.data));
    if (changed) next = editSede(next, sede.id, () => pickSede(changed));
  }
  return next;
}

const seed = buildSeed();

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => {
      const save = (partial: Partial<AppStore>) => {
        noteUserMutation();
        set({ ...partial, savedAt: Date.now(), origin: "user" });
        writePersistSync(snapshot(get()));
      };
      return {
        ...seed,

        snapToToday: () => {
          const today = todayIso();
          if (get().selectedDate !== today) set({ selectedDate: today });
        },
        resumeTodayIfStale: () => {
          const today = todayIso();
          if (get().selectedDate < today) set({ selectedDate: today });
        },

        setSelectedDate: (selectedDate) => save({ selectedDate }),

        updateSettings: (patch) => save({ settings: { ...get().settings, ...patch } }),

        addTeacher: (t) => {
          const id = uid("t");
          save({ teachers: [...get().teachers, { ...t, id }] });
          return id;
        },

        updateTeacher: (id, patch) =>
          save({ teachers: get().teachers.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),

        saveTeacherCard: (
          id: string | null,
          patch: Omit<Teacher, "id">,
          rows: { classId: string; subject: string; hours: number }[],
          drop?: string[],
        ) => {
          const start = snapshot(get());
          const { teacherId, data } = teacherCardData(withoutSlots(start, { [sedeIdOf(start)]: drop ?? [] }), id, patch, rows);
          save(data);
          return teacherId;
        },

        saveTeacherCardSedi: (id, patch, rows, sedeIds, drop) => {
          const before = withoutSlots(snapshot(get()), drop ?? {});
          const own = rows[sedeIdOf(before)] ?? [];
          const { teacherId, data } = teacherCardData(before, id, patch, own);
          const out = saveTeacherSediIn(data, teacherId, sedeIds, rows, patch.weeklyHours);
          save(out.data);
          return { teacherId, blocked: out.blocked };
        },

        removeTeacher: (id) =>
          save({
            teachers: get().teachers.filter((t) => t.id !== id),
            slots: get().slots.filter((s) => s.teacherId !== id),
            absences: get().absences.filter((a) => a.teacherId !== id),
            // le ore che copriva come sostituto tornano da coprire
            substitutions: get().substitutions.filter((s) => s.substituteId !== id),
            cattedre: (get().cattedre ?? []).map((x) =>
              x.teacherId === id ? { ...x, teacherId: "" } : x,
            ),
          }),

        addClass: (c) => save({ classes: [...get().classes, { ...c, id: uid("c") }] }),

        updateClass: (id, patch) =>
          save({ classes: get().classes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),

        removeClass: (id) => get().removeClassIn(sedeIdOf(snapshot(get())), id),

        upsertSlot: (slot) => {
          const id = slot.id ?? `slot-${slot.classId}-${slot.day}-${slot.periodId}-${slot.teacherId}`;
          const next: TimetableSlot = { ...slot, id };
          const slots = get().slots.filter(
            (s) =>
              s.id !== next.id &&
              !(
                s.classId === next.classId &&
                s.day === next.day &&
                s.periodId === next.periodId &&
                s.teacherId === next.teacherId
              ),
          );
          save({ slots: [...slots, next] });
        },

        clearSlot: (id) => save({ slots: get().slots.filter((s) => s.id !== id) }),

        addAbsence: (a) => {
          const id = uid("a");
          save({ absences: [...get().absences, { ...a, id }], selectedDate: a.dateFrom });
          return id;
        },

        updateAbsence: (id, patch) =>
          save({ absences: get().absences.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),

        removeAbsence: (id) => {
          const absences = get().absences;
          const subs = get().substitutions;
          const absIndex = absences.findIndex((a) => a.id === id);
          const abs = absences[absIndex];
          const linked = (s: Substitution) =>
            Boolean(abs) && s.absentTeacherId === abs!.teacherId && s.date >= abs!.dateFrom && s.date <= abs!.dateTo;
          save({
            absences: absences.filter((a) => a.id !== id),
            substitutions: abs ? subs.filter((s) => !linked(s)) : subs,
          });
          if (!abs) return null;
          return {
            absence: { item: abs, index: absIndex },
            substitutions: subs.flatMap((item, index) => (linked(item) ? [{ item, index }] : [])),
          };
        },

        restoreAbsence: (removed) =>
          save({
            absences: reinsert(get().absences, [removed.absence]),
            substitutions: reinsert(get().substitutions, removed.substitutions),
          }),

        saveSubstitution: (s) => {
          const existing = get().substitutions.find(
            (x) =>
              (s.id && x.id === s.id) ||
              (x.date === s.date &&
                x.periodId === s.periodId &&
                x.classId === s.classId &&
                x.absentTeacherId === s.absentTeacherId),
          );
          if (existing) {
            save({
              substitutions: get().substitutions.map((x) =>
                x.id === existing.id ? { ...existing, ...s, id: existing.id } : x,
              ),
            });
          } else {
            save({ substitutions: [...get().substitutions, { ...s, id: s.id ?? uid("sub") }] });
          }
        },

        removeSubstitution: (id) =>
          save({ substitutions: get().substitutions.filter((s) => s.id !== id) }),

        applyAutoAssign: (items) => {
          for (const item of items) get().saveSubstitution(item);
        },

        replaceCattedraSlots: (next, dispSlots) => {
          const teachers = get().teachers;
          const periods = get().settings.periods;
          const keep = get().slots.filter((s) => {
            if (isTpPeriodId(periods, s.periodId)) return true;
            const t = teachers.find((x) => x.id === s.teacherId);
            return !t || !isTimetableTeacher(t);
          });
          const backup = get().slots.filter((s) => {
            if (isTpPeriodId(periods, s.periodId)) return false;
            const t = teachers.find((x) => x.id === s.teacherId);
            return Boolean(t && isTimetableTeacher(t));
          });
          if (!dispSlots) {
            save({ cattedraBackup: backup, cattedraDispBackup: undefined, slots: [...keep, ...next] });
            return;
          }
          const dispBackup: Record<string, { day: DayOfWeek; periodId: string }[]> = {};
          const nextTeachers = teachers.map((t) => {
            if (!(t.id in dispSlots)) return t;
            dispBackup[t.id] = t.dispSlots ?? [];
            return { ...t, dispSlots: dispSlots[t.id] };
          });
          save({
            cattedraBackup: backup,
            cattedraDispBackup: dispBackup,
            slots: [...keep, ...next],
            teachers: nextTeachers,
          });
        },

        undoCattedraSlots: () => {
          const backup = get().cattedraBackup;
          if (!backup) return;
          const teachers = get().teachers;
          const periods = get().settings.periods;
          const keep = get().slots.filter((s) => {
            if (isTpPeriodId(periods, s.periodId)) return true;
            const t = teachers.find((x) => x.id === s.teacherId);
            return !t || !isTimetableTeacher(t);
          });
          const dispBackup = get().cattedraDispBackup;
          const nextTeachers = dispBackup
            ? teachers.map((t) => (t.id in dispBackup ? { ...t, dispSlots: dispBackup[t.id] } : t))
            : teachers;
          save({
            slots: [...keep, ...backup],
            cattedraBackup: undefined,
            cattedraDispBackup: undefined,
            teachers: nextTeachers,
          });
        },

        saveTimetable: (entry) =>
          save({
            savedTimetables: [...(get().savedTimetables ?? []).filter((x) => x.n !== entry.n), entry].sort(
              (a, b) => a.n - b.n,
            ),
          }),

        renameSavedTimetable: (n, name) =>
          save({ savedTimetables: (get().savedTimetables ?? []).map((x) => (x.n === n ? { ...x, name } : x)) }),

        clearSavedTimetable: (n) => {
          if (n === 0 || n === activeSlotOf(get())) return;
          save({ savedTimetables: (get().savedTimetables ?? []).filter((x) => x.n !== n) });
        },

        activateSlot: (n) => {
          const next = activateSlotData(snapshot(get()), n);
          if (next) save(next);
        },

        activateSlotAll: (n) => save(inAllSedi(snapshot(get()), (d) => activateSlotData(d, n))),

        makeOfficialAll: (n) => {
          const code = uid("ins");
          save(inAllSedi(snapshot(get()), (d) => makeOfficialData(d, n, code)));
        },

        clearSavedTimetableAll: (n) => {
          if (n === 0) return;
          save(
            inAllSedi(snapshot(get()), (d) =>
              n === activeSlotOf(d) ? null : { ...d, savedTimetables: (d.savedTimetables ?? []).filter((x) => x.n !== n) },
            ),
          );
        },

        renameSavedTimetableAll: (n, name) =>
          save(
            inAllSedi(snapshot(get()), (d) => ({
              ...d,
              savedTimetables: (d.savedTimetables ?? []).map((x) => (x.n === n ? { ...x, name } : x)),
            })),
          ),

        putInSlot: (n, part, name) => {
          if (n < 1) return;
          save(putInSlotData(snapshot(get()), n, part, name));
        },

        putInSlotAll: (n, parts, name) => {
          if (n < 1) return;
          let next = snapshot(get());
          const code = uid("ins");
          for (const sede of allSedi(next)) {
            const part = parts[sede.id];
            if (!part) continue;
            next = editSede(next, sede.id, (data) => pickSede(putInSlotData(sedeAsData(next, data), n, part, name, code)));
          }
          save(next);
        },

        saveTimetableAll: (n, parts, name) => {
          if (n < 1) return;
          let next = snapshot(get());
          const savedAt = Date.now();
          const insieme = uid("ins");
          for (const sede of allSedi(next)) {
            const part = parts[sede.id];
            if (!part) continue;
            next = editSede(next, sede.id, (data) => ({
              ...data,
              savedTimetables: [
                ...(data.savedTimetables ?? []).filter((x) => x.n !== n),
                { n, name, savedAt, ...part, insieme },
              ].sort((a, b) => a.n - b.n),
            }));
          }
          save(next);
        },

        makeOfficial: (n) => {
          const next = makeOfficialData(snapshot(get()), n);
          if (next) save(next);
        },

        undoMakeOfficial: () => {
          const state = snapshot(get());
          const code = state.officialBackup?.insieme;
          // fatto per tutte le sedi insieme: si annulla in tutte
          if (code)
            save(inAllSedi(state, (d) => (d.officialBackup?.insieme === code ? undoOfficialData(d) : null)));
          else {
            const next = undoOfficialData(state);
            if (next) save(next);
          }
        },

        setCattedre: (cattedre) => save({ cattedre }),

        switchSede: (id) => {
          const state = snapshot(get());
          if (id === sedeIdOf(state)) return;
          save(switchSedeTo(state, id));
        },

        addSede: (name) => {
          const state = snapshot(get());
          const { data, id } = addSedeTo(state, newSedeData(state.settings, name));
          save(data);
          return id;
        },

        importSede: (incoming, links) => {
          const fixed = fixAllSedi({ ...incoming, altreSedi: [] });
          const { data, id } = importSedeInto(snapshot(get()), fixed, links);
          save(data);
          return id;
        },

        updateSede: (id, patch) =>
          save(editSede(snapshot(get()), id, (sede) => ({ ...sede, settings: { ...sede.settings, ...patch } }))),

        removeSede: (id) => save(removeSedeFrom(snapshot(get()), id)),

        dropRemovedSede: (personId, name) => save(dropRemovedSedeFrom(snapshot(get()), personId, name)),

        setSchoolYear: (schoolYear) => save(setSchoolYearIn(snapshot(get()), schoolYear)),

        addClassIn: (sedeId, c) =>
          save(editSede(snapshot(get()), sedeId, (sede) => ({ ...sede, classes: [...sede.classes, { ...c, id: uid("c") }] }))),

        updateClassIn: (sedeId, id, patch) =>
          save(
            editSede(snapshot(get()), sedeId, (sede) => ({
              ...sede,
              classes: sede.classes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            })),
          ),

        removeClassIn: (sedeId, id) => {
          const state = snapshot(get());
          save(editSede(state, sedeId, (sede) => withoutClass(sede, id, sedeId !== sedeIdOf(state))));
        },

        moveClass: (fromSedeId, id, toSedeId) => {
          const state = snapshot(get());
          if (fromSedeId === toSedeId) return false;
          const from = fromSedeId === sedeIdOf(state) ? pickSede(state) : state.altreSedi?.find((a) => a.id === fromSedeId)?.data;
          const cls = from?.classes.find((c) => c.id === id);
          if (!from || !cls) return false;
          if (classInUse(from, id)) return false;
          let next = editSede(state, fromSedeId, (sede) => withoutClass(sede, id, fromSedeId !== sedeIdOf(state)));
          next = editSede(next, toSedeId, (sede) => {
            const taken = sede.classes.some((c) => c.id === cls.id);
            return { ...sede, classes: [...sede.classes, taken ? { ...cls, id: uid("c") } : cls] };
          });
          save(next);
          return true;
        },

        setTeacherSedi: (teacherId, sedeIds) => {
          const { data, blocked } = setTeacherSediIn(snapshot(get()), teacherId, sedeIds);
          save(data);
          return blocked;
        },

        importData: (data, fileName) => {
          noteUserMutation();
          const importedBackupName = (fileName ?? data.importedBackupName)?.trim() || undefined;
          const fixed = fixAllSedi(data);
          // gli slot diventano quelli del file (nessuno se è un backup di prima); ogni voce della sede, anche
          // quelle che il file non ha (pickSede), prende il posto di quella di prima
          set({
            ...fixed,
            ...pickSede(fixed),
            // un backup dell'app di Rombiolo ha una sede sola
            sedeId: data.sedeId,
            ordineSedi: data.ordineSedi,
            savedTimetables: data.savedTimetables ?? [],
            activeSlot: data.activeSlot ?? 0,
            officialBackup: data.officialBackup,
            savedAt: Date.now(),
            origin: "user",
            importedBackupName,
          });
          writePersistSync(snapshot(get()), { force: true });
        },

        resetDemo: () => {
          noteUserMutation();
          const seed = buildSeed();
          set({
            ...seed,
            ...pickSede(seed),
            savedTimetables: [],
            activeSlot: 0,
            officialBackup: undefined,
            savedAt: Date.now(),
            origin: "seed",
            importedBackupName: undefined,
          });
          writePersistSync(snapshot(get()), { force: true });
        },

        clearAll: () => {
          noteUserMutation();
          set({
            ...EMPTY_DATA,
            ...pickSede(EMPTY_DATA),
            sedeId: undefined,
            altreSedi: [],
            ordineSedi: undefined,
            savedTimetables: [],
            activeSlot: 0,
            officialBackup: undefined,
            savedAt: Date.now(),
            origin: "user",
            importedBackupName: undefined,
          });
          writePersistSync(snapshot(get()), { force: true });
        },
      };
    },
    {
      name: "gestione-docenti-multisede",
      skipHydration: true,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => createDurableStorage()),
      migrate: (persisted) => {
        const data = fixAllSedi(persisted as PersistedData);
        return withOrigin(data);
      },
      partialize: (state) => ({
        settings: state.settings,
        teachers: state.teachers,
        classes: state.classes,
        slots: state.slots,
        absences: state.absences,
        substitutions: state.substitutions,
        selectedDate: state.selectedDate,
        cattedre: state.cattedre,
        cattedraBackup: state.cattedraBackup,
        cattedraDispBackup: state.cattedraDispBackup,
        savedTimetables: state.savedTimetables,
        activeSlot: state.activeSlot,
        officialBackup: state.officialBackup,
        savedAt: state.savedAt,
        origin: state.origin,
        importedBackupName: state.importedBackupName,
        sedeId: state.sedeId,
        altreSedi: state.altreSedi,
        ordineSedi: state.ordineSedi,
      }),
    },
  ),
);
