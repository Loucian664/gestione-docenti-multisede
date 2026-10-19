import { addDays } from "date-fns";
import { isoDate, parseDate } from "./dates";
import type { Absence, PersistedData, Teacher } from "./types";
import { uid } from "./utils";

/** Chi è in servizio e chi non lo è più: per i nomi nelle assenze, nelle coperture e nel report. */
export function allTeachers(data: Pick<PersistedData, "teachers" | "formerTeachers">): Teacher[] {
  return data.formerTeachers?.length ? [...data.teachers, ...data.formerTeachers] : data.teachers;
}

export function findAnyTeacher(
  data: Pick<PersistedData, "teachers" | "formerTeachers">,
  id: string | null | undefined,
): Teacher | undefined {
  if (!id) return undefined;
  return data.teachers.find((t) => t.id === id) ?? data.formerTeachers?.find((t) => t.id === id);
}

/** Gli stessi dati con anche chi non è più in servizio tra i docenti: solo per report e riepiloghi delle date passate. */
export function withFormerTeachers<T extends PersistedData>(data: T): T {
  return data.formerTeachers?.length ? { ...data, teachers: allTeachers(data) } : data;
}

/** Assenze e ore di sostituzione già segnate con questo docente (assente o sostituto). */
export function teacherHistory(data: PersistedData, id: string): { absences: number; substitutions: number } {
  return {
    absences: data.absences.filter((a) => a.teacherId === id).length,
    substitutions: data.substitutions.filter((s) => s.absentTeacherId === id || s.substituteId === id).length,
  };
}

/**
 * Cosa cambia eliminando il docente (in servizio o no): le sue ore in orario, le sue assenze, le ore che ha coperto
 * (tornano da coprire) e quelle che i colleghi hanno coperto per lui (restano nel loro report).
 */
export function removalImpact(
  data: PersistedData,
  id: string,
): { lessons: number; absences: number; coveredByThem: number; coveredForThem: number } {
  return {
    lessons: data.slots.filter((s) => s.teacherId === id).length,
    absences: data.absences.filter((a) => a.teacherId === id).length,
    coveredByThem: data.substitutions.filter((s) => s.substituteId === id).length,
    coveredForThem: data.substitutions.filter((s) => s.absentTeacherId === id && s.substituteId).length,
  };
}

/**
 * Arriva un'altra persona al posto del docente: la scheda (classi, ore, orario, preferenze) resta la stessa e prende
 * il nome nuovo; chi lascia passa tra i docenti non più in servizio con le assenze e le coperture dei giorni prima di
 * `fromDate`. Da `fromDate` in poi quello che era già segnato resta sulla scheda, cioè alla persona nuova.
 */
export function replaceTeacher(
  data: PersistedData,
  id: string,
  name: { lastName: string; firstName: string },
  fromDate: string,
): Pick<PersistedData, "teachers" | "formerTeachers" | "absences" | "substitutions"> | null {
  const current = data.teachers.find((t) => t.id === id);
  if (!current || !name.lastName.trim() || !fromDate) return null;
  const formerId = uid("t");
  const former: Teacher = { ...current, id: formerId, leftOn: fromDate, replacedBy: id };
  const lastDay = isoDate(addDays(parseDate(fromDate), -1));

  const absences: Absence[] = [];
  for (const a of data.absences) {
    if (a.teacherId !== id || a.dateFrom >= fromDate) absences.push(a);
    else if (a.dateTo < fromDate) absences.push({ ...a, teacherId: formerId });
    else {
      // a cavallo del cambio: i giorni prima a chi lascia, gli altri restano sulla scheda
      absences.push({ ...a, id: uid("a"), teacherId: formerId, dateTo: lastDay });
      absences.push({ ...a, dateFrom: fromDate });
    }
  }
  const substitutions = data.substitutions.map((s) =>
    s.date < fromDate && (s.absentTeacherId === id || s.substituteId === id)
      ? {
          ...s,
          absentTeacherId: s.absentTeacherId === id ? formerId : s.absentTeacherId,
          substituteId: s.substituteId === id ? formerId : s.substituteId,
        }
      : s,
  );

  return {
    teachers: data.teachers.map((t) =>
      t.id === id ? { ...t, lastName: name.lastName.trim(), firstName: name.firstName.trim() } : t,
    ),
    formerTeachers: [...(data.formerTeachers ?? []), former],
    absences,
    substitutions,
  };
}
