import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  Absence,
  Cattedra,
  DayOfWeek,
  PersistedData,
  SavedTimetable,
  SchoolClass,
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
  saveTeacherCard: (
    id: string | null,
    patch: Omit<Teacher, "id">,
    rows: { classId: string; subject: string; hours: number }[],
  ) => string;
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
  /** «Rendi in vigore»: lo slot `n` diventa l’orario in vigore (slot 0) e quello in uso. */
  makeOfficial: (n: number) => void;
  /** Annulla l’ultimo «Rendi in vigore». */
  undoMakeOfficial: () => void;
  setCattedre: (cattedre: Cattedra[]) => void;
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
  };
  return [...list.filter((x) => x.n !== n), entry].sort((a, b) => a.n - b.n);
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
        ) => {
          const teacherId = id ?? uid("t");
          const nextPatch = { ...patch, cardRows: rows };
          const teachers = id
            ? get().teachers.map((t) => (t.id === id ? { ...t, ...nextPatch } : t))
            : [...get().teachers, { ...nextPatch, id: teacherId }];
          const cattedre = applyTeacherCattedre({ ...snapshot(get()), teachers }, teacherId, rows);
          save({ teachers, cattedre });
          return teacherId;
        },

        removeTeacher: (id) =>
          save({
            teachers: get().teachers.filter((t) => t.id !== id),
            slots: get().slots.filter((s) => s.teacherId !== id),
            absences: get().absences.filter((a) => a.teacherId !== id),
            cattedre: (get().cattedre ?? []).map((x) =>
              x.teacherId === id ? { ...x, teacherId: "" } : x,
            ),
          }),

        addClass: (c) => save({ classes: [...get().classes, { ...c, id: uid("c") }] }),

        updateClass: (id, patch) =>
          save({ classes: get().classes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),

        removeClass: (id) =>
          save({
            classes: get().classes.filter((c) => c.id !== id),
            slots: get().slots.filter((s) => s.classId !== id),
            cattedre: (get().cattedre ?? []).filter((x) => x.classId !== id),
          }),

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
          const state = snapshot(get());
          if (n === activeSlotOf(state)) return;
          const kept = keepActive(state);
          const target = kept.find((x) => x.n === n);
          if (!target) return;
          const { slots, teachers } = withPart(state, target);
          // lo slot in uso è l’orario dell’app: la sua copia salvata non serve (per lo 0 si toglie)
          save({ slots, teachers, activeSlot: n, savedTimetables: n === 0 ? kept.filter((x) => x.n !== 0) : kept });
        },

        putInSlot: (n, part, name) => {
          if (n < 1) return;
          const state = snapshot(get());
          const entry: SavedTimetable = { n, name, savedAt: Date.now(), ...part };
          const kept = activeSlotOf(state) === n ? (state.savedTimetables ?? []) : keepActive(state);
          const { slots, teachers } = withPart(state, part);
          save({
            slots,
            teachers,
            activeSlot: n,
            savedTimetables: [...kept.filter((x) => x.n !== n), entry].sort((a, b) => a.n - b.n),
          });
        },

        makeOfficial: (n) => {
          const state = snapshot(get());
          const target = slotPart(state, n);
          const official = slotPart(state, 0);
          if (n === 0 || !target) return;
          const kept = activeSlotOf(state) === 0 ? (state.savedTimetables ?? []) : keepActive(state);
          const { slots, teachers } = withPart(state, target);
          save({
            slots,
            teachers,
            activeSlot: 0,
            savedTimetables: kept.filter((x) => x.n !== 0),
            officialBackup: official
              ? { n: 0, name: OFFICIAL_NAME, savedAt: Date.now(), ...official }
              : undefined,
          });
        },

        undoMakeOfficial: () => {
          const state = snapshot(get());
          const backup = state.officialBackup;
          if (!backup) return;
          if (activeSlotOf(state) === 0) {
            const { slots, teachers } = withPart(state, backup);
            save({ slots, teachers, officialBackup: undefined });
            return;
          }
          save({
            savedTimetables: [...(state.savedTimetables ?? []).filter((x) => x.n !== 0), backup].sort(
              (a, b) => a.n - b.n,
            ),
            officialBackup: undefined,
          });
        },

        setCattedre: (cattedre) => save({ cattedre }),

        importData: (data, fileName) => {
          noteUserMutation();
          const importedBackupName = (fileName ?? data.importedBackupName)?.trim() || undefined;
          // gli slot diventano quelli del file (nessuno se è un backup di prima)
          set({
            ...applyOrganicoFixes(data),
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
          set({
            ...buildSeed(),
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
      name: "copertura-plesso",
      skipHydration: true,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => createDurableStorage()),
      migrate: (persisted) => {
        const data = applyOrganicoFixes(persisted as PersistedData);
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
      }),
    },
  ),
);
