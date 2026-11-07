import { DAY_SHORT, type DayOfWeek, type PersistedData, type Teacher } from "./types";

type Cell = { day: DayOfWeek; periodId: string };
type AwayCell = Cell & { progetto?: boolean };

/** Che cosa fa un docente in un'ora, come si vede nella scheda «Docenti» della proposta. */
export type HourState =
  | { kind: "lezione"; classId: string; className: string; subject: string }
  | { kind: "disp"; added: boolean }
  | { kind: "buca" }
  | { kind: "progetto" }
  | { kind: "altrove" }
  | { kind: "libera" };

/** Un orario da guardare nella scheda «Docenti»: la proposta (o lo slot aperto) oppure quello in vigore. */
export type WeekView = {
  data: PersistedData;
  /** i docenti mostrati, con le loro ore a disposizione e fuori sede */
  teachers: Teacher[];
  /** ore buche di ogni docente (dal resoconto dell'orario) */
  gaps: { id: string; cells: Cell[] }[];
  /** ore a disposizione dove cambiano; per gli altri docenti valgono quelle della scheda */
  disp?: Record<string, Cell[]>;
  /** ore a disposizione messe o spostate dall'app («+ disp.») */
  added?: { teacherId: string; to: Cell }[];
  /** ore fuori sede e di progetto, quando non sono quelle della scheda (più sedi insieme) */
  away?: (teacherId: string) => AwayCell[];
};

const isAt = (c: Cell, day: DayOfWeek, periodId: string) => c.day === day && c.periodId === periodId;
const has = (list: Cell[] | undefined, day: DayOfWeek, periodId: string) =>
  (list ?? []).some((c) => isAt(c, day, periodId));

/** L'ora di un docente nell'orario `view`, con le stesse precedenze della scheda «Docenti». */
export function hourState(view: WeekView, teacher: Teacher, day: DayOfWeek, periodId: string): HourState {
  const slot = view.data.slots.find((s) => s.teacherId === teacher.id && s.day === day && s.periodId === periodId);
  if (slot) {
    const cls = view.data.classes.find((c) => c.id === slot.classId);
    return { kind: "lezione", classId: slot.classId, className: cls?.name ?? "", subject: slot.subject };
  }
  if ((view.added ?? []).some((m) => m.teacherId === teacher.id && isAt(m.to, day, periodId))) {
    return { kind: "disp", added: true };
  }
  if (has(view.gaps.find((g) => g.id === teacher.id)?.cells, day, periodId)) return { kind: "buca" };
  if (has(view.disp?.[teacher.id] ?? teacher.dispSlots, day, periodId)) return { kind: "disp", added: false };
  const away = view.away ? view.away(teacher.id) : (teacher.awaySlots ?? []);
  if (away.some((a) => a.progetto && isAt(a, day, periodId))) return { kind: "progetto" };
  if (has(away, day, periodId)) return { kind: "altrove" };
  return { kind: "libera" };
}

/**
 * La stessa ora nei due orari? Una lezione è uguale se ha la stessa classe e la stessa materia; un'ora vuota resta
 * uguale anche se diventa (o non è più) una buca, e un'ora a disposizione anche se l'ha spostata l'app.
 */
export function sameHour(a: HourState, b: HourState): boolean {
  if (a.kind === "lezione" || b.kind === "lezione") {
    return a.kind === "lezione" && b.kind === "lezione" && a.classId === b.classId && a.subject === b.subject;
  }
  const empty = (s: HourState) => s.kind === "buca" || s.kind === "libera";
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  return a.kind === b.kind;
}

/** L'ora a parole, per l'elenco dei cambi: «2ª B Matematica», «a disposizione», «libera»… */
export function hourWords(s: HourState): string {
  switch (s.kind) {
    case "lezione": {
      // con tutte le sedi insieme la classe porta la sede («2ª B · Nicotera»): va dopo la materia
      const [cls, sede] = s.className.split(" · ");
      return `${cls} ${s.subject}${sede ? ` · ${sede}` : ""}`.trim();
    }
    case "disp":
      return s.added ? "a disposizione (spostata dall’app)" : "a disposizione";
    case "buca":
      return "buca";
    case "progetto":
      return "progetto";
    case "altrove":
      return "altrove";
    case "libera":
      return "libera";
  }
}

export type HourChange = { day: DayOfWeek; periodId: string; index: number; before: HourState; after: HourState };
export type TeacherChanges = { teacher: Teacher; changes: HourChange[] };

/**
 * Le ore che cambiano da `before` (l'orario in vigore) ad `after` (la proposta o lo slot aperto), docente per docente
 * nell'ordine di `after.teachers`; solo i docenti con almeno un cambio.
 */
export function weekChanges(
  before: WeekView,
  after: WeekView,
  days: DayOfWeek[],
  periods: { id: string; index: number }[],
): TeacherChanges[] {
  const out: TeacherChanges[] = [];
  for (const t of after.teachers) {
    const tBefore = before.teachers.find((x) => x.id === t.id) ?? t;
    const changes: HourChange[] = [];
    for (const day of days) {
      for (const p of periods) {
        const a = hourState(before, tBefore, day, p.id);
        const b = hourState(after, t, day, p.id);
        if (!sameHour(a, b)) changes.push({ day, periodId: p.id, index: p.index, before: a, after: b });
      }
    }
    if (changes.length) out.push({ teacher: t, changes });
  }
  return out;
}

/** «Mar 4ª · prima buca, ora 2ª B Matematica» */
export function changeText(c: HourChange): string {
  return `${DAY_SHORT[c.day]} ${c.index}ª · prima ${hourWords(c.before)}, ora ${hourWords(c.after)}`;
}
