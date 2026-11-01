/**
 * Ore bloccate: la lezione di quel giorno, ora e classe resta dov’è. Costruisci non la sposta, «Svuota orario» la
 * lascia (se non si sceglie di togliere anche quelle). Si bloccano da Orario → Docente o da Ritocchi.
 */
import type { DayOfWeek, Teacher } from "./types";

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
