/**
 * «Svuota orario»: toglie le lezioni che Costruisci rimette (quelle del mattino dei docenti di materia). Il resto
 * (sostegno, potenziamento, strumento, ore del pomeriggio) resta, se non si sceglie di togliere anche quello: Costruisci
 * non lo rimetterebbe e andrebbe inserito di nuovo a mano.
 */
import { isTimetableTeacher } from "./build-timetable";
import type { PersistedData, TimetableSlot } from "./types";

type Base = Pick<PersistedData, "teachers" | "settings">;

/** Le lezioni che Costruisci rimette: del mattino, nei giorni di scuola, di un docente di materia. */
export function builtLessonTest(data: Base): (s: TimetableSlot) => boolean {
  const pool = new Set(data.teachers.filter(isTimetableTeacher).map((t) => t.id));
  const morning = new Set(data.settings.periods.filter((p) => !p.tpOnly).map((p) => p.id));
  const days = new Set<number>(data.settings.days);
  return (s) => pool.has(s.teacherId) && morning.has(s.periodId) && days.has(s.day);
}

/** «a», «a e b», «a, b e c». */
function listText(items: string[]): string {
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
