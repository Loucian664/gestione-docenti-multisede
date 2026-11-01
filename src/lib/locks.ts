/**
 * Ore bloccate: la lezione di quel giorno, ora e classe resta dov’è. Costruisci non la sposta, «Svuota orario» la
 * lascia (se non si sceglie di togliere anche quelle). Si bloccano da Orario → Docente o da Ritocchi.
 */
import type { DayOfWeek, Teacher, TimetableSlot } from "./types";

type Cell = { day: DayOfWeek; periodId: string };

/** La lezione `s` del docente `t` è bloccata (da sola o con tutta la settimana). */
export function isLockedLesson(t: Teacher | undefined, s: Cell & { classId: string }): boolean {
  if (!t) return false;
  if (t.lockWeek) return true;
  return (t.lockedSlots ?? []).some((a) => a.day === s.day && a.periodId === s.periodId && a.classId === s.classId);
}

/** I blocchi del docente con quell’ora bloccata sulla classe `classId`, o sbloccata se `classId` è null. */
export function lockAt(t: Teacher, cell: Cell, classId: string | null): NonNullable<Teacher["lockedSlots"]> {
  const rest = (t.lockedSlots ?? []).filter((a) => !(a.day === cell.day && a.periodId === cell.periodId));
  return classId ? [...rest, { day: cell.day, periodId: cell.periodId, classId }] : rest;
}

/**
 * I docenti senza i blocchi delle lezioni tolte: un blocco rimasto senza lezione bloccherebbe, senza che nessuno l’abbia
 * chiesto, la prossima lezione messa in quella casella.
 */
export function dropLocks(teachers: Teacher[], gone: TimetableSlot[]): Teacher[] {
  if (gone.length === 0) return teachers;
  return teachers.map((t) => {
    const list = t.lockedSlots ?? [];
    const next = list.filter(
      (a) => !gone.some((s) => s.teacherId === t.id && s.day === a.day && s.periodId === a.periodId && s.classId === a.classId),
    );
    return next.length === list.length ? t : { ...t, lockedSlots: next };
  });
}
