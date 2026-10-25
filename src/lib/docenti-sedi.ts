/**
 * L'orario di ogni docente su tutte le sedi dove lavora, per il PDF «PDF docenti»: una persona sola anche se ha
 * una scheda in più sedi (stesso `personId`, oppure una sola scheda), con le ore di ogni sede riportate sulla
 * campanella della prima sede (le ore di campanelle diverse si toccano se i loro orari si sovrappongono).
 */
import { isMensaLesson, isMensaPeriod, visiblePeriods } from "./periods";
import { allSedi, overlaps, persons, sedeName } from "./sedi";
import type { DayOfWeek, Period, PersistedData } from "./types";

export type PersonCell =
  | { kind: "lesson"; sedeId: string; cls: string; subject: string }
  | { kind: "disp"; sedeId: string }
  | { kind: "mensa"; sedeId: string }
  /** segnata con la × (altro plesso) e non spiegata da nessuna sede dell'archivio */
  | { kind: "away" };

export type PersonSede = {
  id: string;
  name: string;
  /** posizione della sede nella pagina Sedi: dà il suo colore, come in Orario */
  index: number;
  lessons: number;
  disp: number;
  classes: string[];
};

export type PersonSheet = {
  key: string;
  lastName: string;
  firstName: string;
  /** le sedi dove ha lezioni o disposizioni, nell'ordine delle sedi */
  sedi: PersonSede[];
  /** la campanella di riferimento: mattina sempre, mensa / 7ª / 8ª solo dove c'è qualcosa */
  periods: Period[];
  cells: Map<string, PersonCell>;
  /** ore di altre campanelle che non cadono su nessuna ora di quella di riferimento */
  unplaced: number;
};

export const personCellKey = (day: DayOfWeek, periodId: string) => `${day}|${periodId}`;

/** Un foglio per persona che ha almeno una lezione o una disposizione in una sede. */
export function personSheets(data: PersistedData): PersonSheet[] {
  const order = allSedi(data).map((s) => s.id);
  const sheets: PersonSheet[] = [];
  for (const person of persons(data)) {
    const first = person.records[0];
    if (!first) continue;
    const used = person.records
      .map((r) => ({
        r,
        slots: r.sede.slots.filter((s) => s.teacherId === r.teacher.id),
        disp: r.teacher.dispSlots ?? [],
      }))
      .filter((x) => x.slots.length > 0 || x.disp.length > 0);
    if (used.length === 0) continue;

    // campanella di riferimento: quella con più ore, a parità la prima sede
    const base = used.reduce((best, x) =>
      visiblePeriods(x.r.sede.settings).length > visiblePeriods(best.r.sede.settings).length ? x : best,
    );
    const basePeriods = base.r.sede.settings.periods;
    const cells = new Map<string, PersonCell>();
    const sedi: PersonSede[] = [];
    let unplaced = 0;

    for (const { r, slots, disp } of used) {
      const theirs = r.sede.settings.periods;
      const classOf = (id: string) => {
        const c = r.sede.classes.find((x) => x.id === id);
        return c ? `${c.grade}${c.section}` : "";
      };
      const onBase = (periodId: string) => {
        const pb = theirs.find((p) => p.id === periodId);
        return pb ? basePeriods.filter((pa) => overlaps(pa, pb)) : [];
      };
      const put = (day: DayOfWeek, periodId: string, cell: PersonCell) => {
        const targets = onBase(periodId);
        if (targets.length === 0) unplaced += 1;
        for (const pa of targets) {
          const key = personCellKey(day, pa.id);
          if (!cells.has(key)) cells.set(key, cell);
        }
      };
      const classes = new Set<string>();
      let lessons = 0;
      for (const s of slots) {
        const p = theirs.find((x) => x.id === s.periodId);
        if (isMensaLesson(s) || isMensaPeriod(p)) {
          put(s.day, s.periodId, { kind: "mensa", sedeId: r.sedeId });
          continue;
        }
        lessons += 1;
        classes.add(classOf(s.classId));
        put(s.day, s.periodId, { kind: "lesson", sedeId: r.sedeId, cls: classOf(s.classId), subject: s.subject });
      }
      for (const d of disp) put(d.day, d.periodId, { kind: "disp", sedeId: r.sedeId });
      sedi.push({
        id: r.sedeId,
        name: r.sedeName || sedeName(r.sede.settings),
        index: Math.max(0, order.indexOf(r.sedeId)),
        lessons,
        disp: disp.length,
        classes: [...classes].filter(Boolean).sort((a, b) => a.localeCompare(b, "it", { numeric: true })),
      });
    }

    // ore segnate con la × che nessuna sede dell'archivio spiega: il docente è in un altro plesso
    for (const { r } of used) {
      const theirs = r.sede.settings.periods;
      for (const a of r.teacher.awaySlots ?? []) {
        const pb = theirs.find((x) => x.id === a.periodId);
        if (!pb) continue;
        for (const pa of basePeriods.filter((x) => overlaps(x, pb))) {
          const key = personCellKey(a.day, pa.id);
          if (!cells.has(key)) cells.set(key, { kind: "away" });
        }
      }
    }

    const days = base.r.sede.settings.days;
    const periods = visiblePeriods(base.r.sede.settings).filter(
      (p) =>
        !p.tpOnly ||
        days.some((d) => {
          const c = cells.get(personCellKey(d, p.id));
          return c !== undefined && c.kind !== "away";
        }),
    );
    sheets.push({
      key: person.key,
      lastName: first.teacher.lastName,
      firstName: first.teacher.firstName,
      sedi: sedi.sort((a, b) => a.index - b.index),
      periods,
      cells,
      unplaced,
    });
  }
  return sheets.sort(
    (a, b) => a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it"),
  );
}
