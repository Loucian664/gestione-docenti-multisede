/**
 * «Svuota orario»: toglie le lezioni che Costruisci rimette (quelle del mattino dei docenti di materia). Il resto
 * (sostegno, potenziamento, strumento, ore del pomeriggio) resta, se non si sceglie di togliere anche quello: Costruisci
 * non lo rimetterebbe e andrebbe inserito di nuovo a mano. Con le spunte toglie anche ore bloccate, ore a disposizione,
 * ore di progetto e segni di Costruisci; «Nuovo anno scolastico» toglie tutto.
 */
import { isTimetableTeacher } from "./build-timetable";
import { MARK_KINDS, clearMarks, markCount, type MarkKind } from "./clear-marks";
import type { PersistedData, Teacher, TimetableSlot } from "./types";

type Base = Pick<PersistedData, "teachers" | "settings">;

/** Le lezioni che Costruisci rimette: del mattino, nei giorni di scuola, di un docente di materia. */
export function builtLessonTest(data: Base): (s: TimetableSlot) => boolean {
  const pool = new Set(data.teachers.filter(isTimetableTeacher).map((t) => t.id));
  const morning = new Set(data.settings.periods.filter((p) => !p.tpOnly).map((p) => p.id));
  const days = new Set<number>(data.settings.days);
  return (s) => pool.has(s.teacherId) && morning.has(s.periodId) && days.has(s.day);
}

/** «a», «a e b», «a, b e c». */
export function listText(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

const KINDS = ["sostegno", "potenziamento", "strumento", "ore del pomeriggio", "altre ore"] as const;

/** Che cosa sono le lezioni che Costruisci non rimette, nell’ordine di KINDS. */
export function fixedKinds(data: Base, slots: TimetableSlot[]): string[] {
  const byId = new Map(data.teachers.map((t) => [t.id, t]));
  const afternoon = new Set(data.settings.periods.filter((p) => p.tpOnly).map((p) => p.id));
  const kinds = new Set<string>();
  for (const s of slots) {
    const t = byId.get(s.teacherId);
    if (t?.role === "sostegno") kinds.add("sostegno");
    else if (t?.role === "potenziamento") kinds.add("potenziamento");
    else if (t && !isTimetableTeacher(t)) kinds.add("strumento");
    else if (afternoon.has(s.periodId)) kinds.add("ore del pomeriggio");
    else kinds.add("altre ore");
  }
  return KINDS.filter((k) => kinds.has(k));
}

/** «Sostegno e ore del pomeriggio: andrebbero rimesse a mano.» (i tipi, anche di più sedi, senza ripetizioni) */
export function fixedKindsNote(kinds: string[]): string {
  const text = listText(KINDS.filter((k) => kinds.includes(k)));
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}: andrebbero rimesse a mano.`;
}

/** «Restano 61 ore che Costruisci non rimette e 1 ora bloccata.» (vuoto se non resta niente) */
export function stayText(fixed: number, locked: number): string {
  const parts = [
    fixed > 0 && `${fixed} ${fixed === 1 ? "ora che Costruisci non rimette" : "ore che Costruisci non rimette"}`,
    locked > 0 && `${locked} ${locked === 1 ? "ora bloccata" : "ore bloccate"}`,
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return `${fixed + locked === 1 ? "Resta" : "Restano"} ${parts.join(" e ")}.`;
}

/** I segni di Costruisci della spunta «segni»: tutti tranne i blocchi, che hanno la spunta «ore bloccate». */
export const EMPTY_MARK_KINDS: ReadonlySet<MarkKind> = new Set(
  MARK_KINDS.map((m) => m.kind).filter((k) => k !== "lock"),
);

/** Quanti segni di Costruisci toglie la spunta «segni» al docente, contati come in «Cancella tutto». */
export function marksOf(t: Teacher): number {
  let n = 0;
  for (const kind of EMPTY_MARK_KINDS) n += markCount(t, kind);
  return n;
}

/** Ore segnate «Progetto» (scheda docente o Orario). */
export function projectHoursOf(t: Teacher): number {
  return (t.awaySlots ?? []).filter((a) => a.progetto).length;
}

/** «× altro plesso, «no», classe.»: i tipi di segni che i docenti hanno, nell'ordine di Costruisci. */
export function marksNote(teachers: Teacher[]): string {
  const names: Partial<Record<MarkKind, string>> = {
    away: "× altro plesso",
    no: "«no»",
    pref: "classe",
    must: "classe",
    days: "ore al giorno e rientri",
    free: "ore libere tra le lezioni",
  };
  const out: string[] = [];
  for (const kind of EMPTY_MARK_KINDS) {
    const name = names[kind];
    if (name && !out.includes(name) && teachers.some((t) => markCount(t, kind) > 0)) out.push(name);
  }
  return out.length ? `${out.join(", ")}.` : "";
}

export type EmptyChoice = { disp: boolean; locked: boolean; project: boolean; marks: boolean };

/** Con il nuovo anno si toglie tutto. */
export const EMPTY_ALL: EmptyChoice = { disp: true, locked: true, project: true, marks: true };

/**
 * I campi del docente che cambiano svuotando l'orario con le spunte scelte; null se nessuno. `kept`: le lezioni che
 * restano. Con i segni vanno via anche i blocchi rimasti senza lezione, che non si vedono ma contano come segni.
 */
export function emptyTeacherPatch(t: Teacher, choice: EmptyChoice, kept: TimetableSlot[]): Partial<Teacher> | null {
  const patch: Partial<Teacher> = choice.marks ? { ...(clearMarks(t, EMPTY_MARK_KINDS) ?? {}) } : {};
  if (choice.disp && t.dispSlots?.length) patch.dispSlots = [];
  if (choice.project && projectHoursOf(t) > 0) {
    patch.awaySlots = (patch.awaySlots ?? t.awaySlots ?? []).filter((a) => !a.progetto);
  }
  if (choice.locked && (t.lockedSlots?.length || t.lockWeek)) {
    patch.lockedSlots = [];
    patch.lockWeek = false;
  } else if (choice.marks) {
    const mine = kept.filter((s) => s.teacherId === t.id);
    const locks = (t.lockedSlots ?? []).filter((a) =>
      mine.some((s) => s.day === a.day && s.periodId === a.periodId && s.classId === a.classId),
    );
    if (locks.length !== (t.lockedSlots ?? []).length) patch.lockedSlots = locks;
    if (t.lockWeek && mine.length === 0) patch.lockWeek = false;
  }
  return Object.keys(patch).length ? patch : null;
}

/** «Restano docenti, classi, cattedre, …, assenze, sostituzioni e orari salvati negli slot.» */
export function keptText(left: { disp: boolean; project: boolean; marks: boolean }): string {
  const items = [
    "docenti",
    "classi",
    "cattedre",
    left.disp && "ore a disposizione",
    left.project && "ore di progetto",
    left.marks && "segni di Costruisci",
    "assenze",
    "sostituzioni",
    "orari salvati negli slot",
  ].filter((x): x is string => Boolean(x));
  return `Restano ${listText(items)}.`;
}
