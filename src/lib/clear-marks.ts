/**
 * «Cancella tutto» in Costruisci: i segni dei docenti divisi per tipo, quanti sono e come toglierli.
 * Le ore di progetto (scheda docente o Orario) e le ore a disposizione non sono segni: restano.
 */
import type { Teacher, TimetableSlot } from "./types";

export type MarkKind = "away" | "no" | "pref" | "must" | "lock" | "days" | "free";

export const MARK_KINDS: { kind: MarkKind; label: string }[] = [
  { kind: "away", label: "× altro plesso" },
  { kind: "no", label: "«no»" },
  { kind: "pref", label: "Classe, se possibile" },
  { kind: "must", label: "Classe, obbligo" },
  { kind: "lock", label: "Lezioni e settimane bloccate" },
  { kind: "days", label: "Ore al giorno e rientri" },
  { kind: "free", label: "Ore libere tra le lezioni" },
];

const isMust = (m: NonNullable<Teacher["mustSlots"]>[number]) => m.level === "obbligo";

/**
 * Quanti segni di quel tipo ha il docente (per ore al giorno e ore libere: 1 se ne ha).
 * `lessons`: l’orario; se c’è, contano solo i blocchi su lezioni che ci sono ancora (quelli che si vedono).
 */
export function markCount(t: Teacher, kind: MarkKind, lessons?: TimetableSlot[]): number {
  switch (kind) {
    case "away":
      return (t.awaySlots ?? []).filter((a) => !a.progetto).length;
    case "no":
      return (t.avoidSlots ?? []).length;
    case "pref":
      return (t.mustSlots ?? []).filter((m) => !isMust(m)).length + (t.preferSlots ?? []).length;
    case "must":
      return (t.mustSlots ?? []).filter(isMust).length;
    case "lock":
      return (
        (t.lockedSlots ?? []).filter(
          (a) =>
            !lessons ||
            lessons.some(
              (s) =>
                s.teacherId === t.id &&
                s.day === a.day &&
                s.periodId === a.periodId &&
                s.classId === a.classId,
            ),
        ).length + (t.lockWeek ? 1 : 0)
      );
    case "days":
      return (t.dayPatterns?.length || t.dayPattern?.length ? 1 : 0) + (t.rientroDays ?? []).length;
    case "free":
      return t.allowTwoFree || t.noGaps ? 1 : 0;
  }
}

/** I campi che tolgono i segni dei tipi scelti; null se il docente non ne ha. `lessons` come in `markCount`. */
export function clearMarks(
  t: Teacher,
  kinds: ReadonlySet<MarkKind>,
  lessons?: TimetableSlot[],
): Partial<Teacher> | null {
  const has = (k: MarkKind) => kinds.has(k) && markCount(t, k, lessons) > 0;
  const patch: Partial<Teacher> = {};
  if (has("away")) patch.awaySlots = (t.awaySlots ?? []).filter((a) => a.progetto);
  if (has("no")) patch.avoidSlots = [];
  if (has("pref") || has("must")) {
    patch.mustSlots = (t.mustSlots ?? []).filter((m) =>
      isMust(m) ? !kinds.has("must") : !kinds.has("pref"),
    );
    if (kinds.has("pref") && t.preferSlots?.length) patch.preferSlots = [];
  }
  if (has("lock")) {
    patch.lockedSlots = [];
    patch.lockWeek = false;
  }
  if (has("days")) {
    patch.dayPatterns = [];
    if (t.dayPattern) patch.dayPattern = undefined;
    patch.rientroDays = [];
  }
  if (has("free")) {
    patch.allowTwoFree = false;
    patch.noGaps = false;
  }
  return Object.keys(patch).length ? patch : null;
}

/** I valori di prima dei campi toccati da `patch`, per «Annulla». */
export function previousFields(t: Teacher, patch: Partial<Teacher>): Partial<Teacher> {
  const back: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) back[k] = (t as Record<string, unknown>)[k];
  return back as Partial<Teacher>;
}
