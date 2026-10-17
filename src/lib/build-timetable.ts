import { uid } from "./utils";
import { teacherName } from "./coverage";
import { lessonPeriodsOf, isMensaPeriod, isMensaSlot } from "./periods";
import { DAY_SHORT, type Cattedra, type DayOfWeek, type PersistedData, type Teacher, type TimetableSlot } from "./types";

export type LessonDemand = {
  classId: string;
  teacherId: string;
  subject: string;
  hours: number;
};

export type BuildOptions = {
  avoidGaps: boolean;
  balanceLastHour: boolean;
  noAdjacentPlessi: boolean;
  noFreeDay: boolean;
  variety: boolean;
  avoidFiveHours: boolean;
  allowThreeConsecutive: boolean;
  maxFiveAtSchool: boolean;
  /** Niente 4 ore di fila ITA/STO/GEO/MAT/SCI nella stessa classe. */
  avoidHeavyBlocks: boolean;
};

export type BuildReport = {
  placed: number;
  total: number;
  leftover: number;
  gaps: number;
  lastHourByTeacher: { id: string; name: string; count: number }[];
  plessoIssues: number;
  notes: string[];
};

export type BuildResult = {
  slots: TimetableSlot[];
  report: BuildReport;
};

export const MONTE_ORE: { subject: string; hours: number }[] = [
  { subject: "Italiano", hours: 6 },
  { subject: "Storia", hours: 2 },
  { subject: "Geografia", hours: 2 },
  { subject: "Matematica", hours: 4 },
  { subject: "Scienze", hours: 2 },
  { subject: "Inglese", hours: 3 },
  { subject: "Francese", hours: 2 },
  { subject: "Tecnologia", hours: 2 },
  { subject: "Arte e Immagine", hours: 2 },
  { subject: "Musica", hours: 2 },
  { subject: "Scienze Motorie", hours: 2 },
  { subject: "Religione", hours: 1 },
];

export function monteOreOf(data: PersistedData): { subject: string; hours: number }[] {
  const custom = data.settings.monteOre;
  if (custom && custom.length > 0) {
    return custom.map((r) => ({ subject: r.subject, hours: Math.max(0, Number(r.hours) || 0) }));
  }
  return MONTE_ORE.map((r) => ({ ...r }));
}

const HEAVY = new Set(["Italiano", "Matematica", "Inglese"]);
const CORE_LOAD = new Set(["Italiano", "Storia", "Geografia", "Matematica", "Scienze"]);

const STRUMENTO = /strumento|chitarra|flauto|oboe|pianoforte/i;

export function isTimetableTeacher(t: Teacher): boolean {
  if (t.role === "sostegno" || t.role === "potenziamento") return false;
  return !t.subjects.some((s) => STRUMENTO.test(s));
}

function busyKey(day: DayOfWeek, periodId: string, who: string): string {
  return `${day}|${periodId}|${who}`;
}

function awaySet(t: Teacher): Set<string> {
  const set = new Set<string>();
  for (const a of t.awaySlots ?? []) set.add(busyKey(a.day, a.periodId, t.id));
  return set;
}

function isDualPlesso(t: Teacher | undefined): boolean {
  if (!t) return false;
  return Boolean(t.otherPlesso) || (t.awaySlots?.length ?? 0) > 0;
}

function periodIndex(data: PersistedData, periodId: string): number {
  return data.settings.periods.find((p) => p.id === periodId)?.index ?? 0;
}

function lastPeriod(data: PersistedData) {
  return [...lessonPeriodsOf(data)].sort((a, b) => b.index - a.index)[0];
}

function mustClassIds(a: { classId?: string; classIds?: string[] }): string[] {
  if (a.classIds && a.classIds.length) return a.classIds;
  return a.classId ? [a.classId] : [];
}

function coreRunIfPlaced(
  places: Place[],
  data: PersistedData,
  classId: string,
  day: DayOfWeek,
  periodId: string,
  subject: string,
): number {
  const periods = lessonPeriodsOf(data).slice().sort((a, b) => a.index - b.index);
  const row = periods.map((per) => {
    if (per.id === periodId) return subject;
    return places.find((p) => p.classId === classId && p.day === day && p.periodId === per.id)?.subject ?? "";
  });
  const at = periods.findIndex((p) => p.id === periodId);
  if (at < 0 || !CORE_LOAD.has(subject)) return 0;
  let run = 1;
  for (let i = at - 1; i >= 0 && CORE_LOAD.has(row[i] ?? ""); i--) run += 1;
  for (let i = at + 1; i < row.length && CORE_LOAD.has(row[i] ?? ""); i++) run += 1;
  return run;
}

function heavyBlockCount(places: Place[], data: PersistedData): number {
  let n = 0;
  for (const cls of data.classes) {
    for (const day of data.settings.days) {
      const row = lessonPeriodsOf(data)
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((per) => places.find((p) => p.classId === cls.id && p.day === day && p.periodId === per.id)?.subject ?? "");
      let run = 0;
      for (const sub of row) {
        if (CORE_LOAD.has(sub)) {
          run += 1;
          if (run >= 4) {
            n += 1;
            break;
          }
        } else run = 0;
      }
    }
  }
  return n;
}

export type DemandResult = {
  lessons: LessonDemand[];
  unassigned: { classId: string; className: string; subject: string; hours: number }[];
  fromOrganico: boolean;
};

function teachesSubject(t: Teacher, subject: string): boolean {
  if (subject === "Francese" || subject === "Spagnolo") {
    return t.subjects.some((s) => s === "Francese" || s === "Spagnolo");
  }
  return t.subjects.includes(subject);
}

function resolveSubject(t: Teacher, subject: string): string {
  if (subject === "Francese" && t.subjects.includes("Spagnolo") && !t.subjects.includes("Francese")) {
    return "Spagnolo";
  }
  return subject;
}

export function inferTeacherId(
  data: PersistedData,
  classId: string,
  subject: string,
): string {
  const pool = data.teachers.filter(isTimetableTeacher);
  const slotHits = new Map<string, number>();
  for (const s of data.slots) {
    if (s.classId !== classId) continue;
    const t = pool.find((x) => x.id === s.teacherId);
    if (!t || !teachesSubject(t, subject)) continue;
    if (s.subject !== subject && !(subject === "Francese" && s.subject === "Spagnolo")) continue;
    slotHits.set(s.teacherId, (slotHits.get(s.teacherId) ?? 0) + 1);
  }
  const candidates = pool.filter((t) => teachesSubject(t, subject));
  candidates.sort((a, b) => (slotHits.get(b.id) ?? 0) - (slotHits.get(a.id) ?? 0));
  return candidates[0]?.id ?? "";
}

export function resolveCattedre(data: PersistedData): Cattedra[] {
  const saved = data.cattedre ?? [];
  const out: Cattedra[] = [];
  for (const cls of data.classes) {
    const custom = saved.filter((c) => c.classId === cls.id);
    const rows =
      custom.length > 0
        ? custom.map((r) => ({ subject: r.subject, hours: Math.max(0, Number(r.hours) || 0) }))
        : monteOreOf(data);
    for (const row of rows) {
      if (!row.subject) continue;
      const existing = custom.find((c) => c.subject === row.subject);
      const teacherId = existing?.teacherId || inferTeacherId(data, cls.id, row.subject);
      out.push({ classId: cls.id, subject: row.subject, hours: row.hours, teacherId });
    }
  }
  return out;
}

export function cattedreOfTeacher(data: PersistedData, teacherId: string): Cattedra[] {
  const t = data.teachers.find((x) => x.id === teacherId);
  if (t && Array.isArray(t.cardRows)) {
    return t.cardRows
      .filter((r) => r.classId && r.subject && r.hours > 0)
      .map((r) => ({ classId: r.classId, subject: r.subject, hours: r.hours, teacherId }));
  }
  const saved = data.cattedre ?? [];
  if (saved.length > 0) {
    return saved.filter((c) => c.teacherId === teacherId && c.hours > 0);
  }
  return resolveCattedre(data).filter((c) => c.teacherId === teacherId && c.hours > 0);
}

export function applyTeacherCattedre(
  data: PersistedData,
  teacherId: string,
  rows: { classId: string; subject: string; hours: number }[],
): Cattedra[] {
  const base = (data.cattedre && data.cattedre.length > 0) ? data.cattedre : resolveCattedre(data);
  const next = base.map((r) => (r.teacherId === teacherId ? { ...r, teacherId: "" } : r));
  for (const row of rows) {
    if (!row.classId || !row.subject || row.hours <= 0) continue;
    const i = next.findIndex((r) => r.classId === row.classId && r.subject === row.subject);
    if (i >= 0) next[i] = { ...next[i]!, teacherId, hours: row.hours };
    else next.push({ classId: row.classId, subject: row.subject, hours: row.hours, teacherId });
  }
  return next;
}

export function timetableDemand(data: PersistedData): DemandResult {
  const pool = new Set(data.teachers.filter(isTimetableTeacher).map((t) => t.id));
  const lessons: LessonDemand[] = [];
  const unassigned: DemandResult["unassigned"] = [];
  let fromOrganico = Boolean(data.cattedre && data.cattedre.length > 0);
  const skipBuild = /^(Mensa|Laboratorio|Sostegno|Potenziamento|Altro)$/i;

  for (const row of resolveCattedre(data)) {
    if (row.hours <= 0) continue;
    if (skipBuild.test(row.subject)) continue;
    const cls = data.classes.find((c) => c.id === row.classId);
    if (!row.teacherId || !pool.has(row.teacherId)) {
      unassigned.push({
        classId: row.classId,
        className: cls?.name ?? row.classId,
        subject: row.subject,
        hours: row.hours,
      });
      continue;
    }
    const t = data.teachers.find((x) => x.id === row.teacherId);
    const subject = t ? resolveSubject(t, row.subject) : row.subject;
    if ((data.slots ?? []).some((s) => s.classId === row.classId && s.teacherId === row.teacherId && s.subject === subject)) {
      fromOrganico = true;
    }
    lessons.push({ classId: row.classId, teacherId: row.teacherId, subject, hours: row.hours });
  }

  return { lessons, unassigned, fromOrganico };
}

type Place = {
  classId: string;
  teacherId: string;
  subject: string;
  day: DayOfWeek;
  periodId: string;
};

function pairKey(classId: string, teacherId: string, subject: string): string {
  return `${classId}|${teacherId}|${subject}`;
}

function minSpreadDays(subject: string, hours: number): number {
  if (subject === "Italiano") return Math.min(5, Math.max(4, hours - 1));
  if (subject === "Matematica") return Math.min(5, hours);
  if (hours <= 2) return hours;
  return Math.min(hours, 3);
}

function hasThreeConsecutive(idxs: number[]): boolean {
  const set = new Set(idxs);
  for (const i of set) if (set.has(i + 1) && set.has(i + 2)) return true;
  return false;
}

function pedagogyOk(
  places: Place[],
  item: { classId: string; teacherId: string; subject: string; day?: DayOfWeek; periodId?: string },
  day: DayOfWeek,
  periodId: string,
  data: PersistedData,
  _weekly: Map<string, number>,
  teacher: Teacher | undefined,
  allowThree: boolean,
): boolean {
  const rest = places.filter((p) => p !== item);
  const already = places.filter(
    (p) => p.teacherId === item.teacherId && p.classId === item.classId && p.day === day,
  );
  const sameTeacher = rest.filter(
    (p) => p.teacherId === item.teacherId && p.classId === item.classId && p.day === day,
  );
  const maxSame = teacher?.otherPlesso || allowThree ? 3 : 2;
  const newCount = sameTeacher.length + 1;
  if (newCount > maxSame && newCount > already.length) return false;

  const alreadySub = places.filter(
    (p) =>
      p.classId === item.classId &&
      p.teacherId === item.teacherId &&
      p.subject === item.subject &&
      p.day === day,
  ).length;
  const sameSub = rest.filter((p) => p.classId === item.classId && p.subject === item.subject && p.day === day);
  const newSub = sameSub.length + 1;
  if (newSub > 2 && newSub > alreadySub) return false;

  const idx = periodIndex(data, periodId);
  const idxs = sameTeacher.map((p) => periodIndex(data, p.periodId));
  if (!teacher?.otherPlesso && !allowThree) {
    const oldIdxs = already.map((p) => periodIndex(data, p.periodId));
    const newIdxs = [...idxs, idx];
    if (hasThreeConsecutive(newIdxs) && !hasThreeConsecutive(oldIdxs)) return false;
    const set = new Set(newIdxs);
    if (set.has(idx - 1) && set.has(idx + 1) && !(new Set(oldIdxs).has(idx - 1) && new Set(oldIdxs).has(idx + 1))) {
      return false;
    }
  }
  return true;
}

function feasible(
  data: PersistedData,
  item: { teacherId: string; classId: string; subject: string; day?: DayOfWeek; periodId?: string },
  day: DayOfWeek,
  periodId: string,
  teacherBusy: Set<string>,
  classBusy: Set<string>,
  opts: BuildOptions,
  teachers: Map<string, Teacher>,
  places: Place[],
  weekly: Map<string, number>,
  relaxFive = false,
  relaxPedagogy = false,
): boolean {
  if (teacherBusy.has(busyKey(day, periodId, item.teacherId))) return false;
  if (classBusy.has(busyKey(day, periodId, item.classId))) return false;
  const t = teachers.get(item.teacherId);
  if (!t) return false;
  const away = awaySet(t);
  if (away.has(busyKey(day, periodId, t.id))) return false;
  if ((t.rientroDays ?? []).includes(day)) {
    const idx = periodIndex(data, periodId);
    if (idx < 4 || idx > 6) return false;
  }
  if (opts.noAdjacentPlessi && (t.awaySlots?.length ?? 0) > 0) {
    const idx = periodIndex(data, periodId);
    for (const p of lessonPeriodsOf(data)) {
      if (Math.abs(p.index - idx) !== 1) continue;
      if (away.has(busyKey(day, p.id, t.id))) return false;
    }
  }
  if (opts.variety && !relaxPedagogy && !pedagogyOk(places, item, day, periodId, data, weekly, t, opts.allowThreeConsecutive)) return false;
  if (opts.avoidHeavyBlocks && !relaxPedagogy) {
    if (coreRunIfPlaced(places, data, item.classId, day, periodId, item.subject) >= 4) return false;
  }
  if (opts.avoidFiveHours && !relaxFive) {
    const already = hoursOnDay(places, item.teacherId, day);
    const without = item.day === day ? Math.max(0, already - 1) : already;
    if (without >= 5) return false;
  }
  if (opts.maxFiveAtSchool) {
    const exclude =
      item.day === day && item.periodId ? periodIndex(data, item.periodId) : null;
    if (spanIfPlaced(places, data, item.teacherId, day, periodId, exclude) > 5) return false;
  }
  return true;
}

function spanIfPlaced(
  places: Place[],
  data: PersistedData,
  teacherId: string,
  day: DayOfWeek,
  periodId: string,
  excludeIdx: number | null,
): number {
  const idxs = places
    .filter((p) => p.teacherId === teacherId && p.day === day)
    .map((p) => periodIndex(data, p.periodId))
    .filter((i) => excludeIdx === null || i !== excludeIdx);
  idxs.push(periodIndex(data, periodId));
  if (idxs.length <= 1) return 1;
  return Math.max(...idxs) - Math.min(...idxs) + 1;
}

function schoolSpanDays(places: Place[], data: PersistedData, teacherId: string): number {
  let n = 0;
  for (const day of data.settings.days) {
    const idxs = places
      .filter((p) => p.teacherId === teacherId && p.day === day)
      .map((p) => periodIndex(data, p.periodId))
      .sort((a, b) => a - b);
    if (idxs.length < 2) continue;
    if (idxs[idxs.length - 1]! - idxs[0]! + 1 > 5) n += 1;
  }
  return n;
}

function gapsFor(places: Place[], data: PersistedData, teacherId: string): number {
  return gapsOf(data, places, teacherId);
}

function taughtLessonIndexes(
  data: PersistedData,
  slots: { teacherId: string; day: DayOfWeek; periodId: string }[],
  teacherId: string,
  day: DayOfWeek,
  countDisp = false,
): number[] {
  const idxs: number[] = [];
  for (const p of slots) {
    if (p.teacherId !== teacherId || p.day !== day) continue;
    const period = data.settings.periods.find((x) => x.id === p.periodId);
    if (!period || isMensaSlot(period, p) || isMensaPeriod(period)) continue;
    idxs.push(period.index);
  }
  if (countDisp) {
    const teacher = data.teachers.find((t) => t.id === teacherId);
    for (const a of teacher?.dispSlots ?? []) {
      if (a.day !== day) continue;
      const period = data.settings.periods.find((x) => x.id === a.periodId);
      if (period && !isMensaPeriod(period)) idxs.push(period.index);
    }
  }
  return [...new Set(idxs)].sort((a, b) => a - b);
}

function lessonTimeline(data: PersistedData): number[] {
  return data.settings.periods
    .filter((p) => !isMensaPeriod(p))
    .map((p) => p.index)
    .sort((a, b) => a - b);
}

/** Ore vuote tra la prima e l’ultima lezione. La mensa non è una buca. */
function gapsOnDay(taught: number[], timeline: number[]): number {
  if (taught.length < 2) return 0;
  const first = taught[0]!;
  const last = taught[taught.length - 1]!;
  const have = new Set(taught);
  let g = 0;
  for (const idx of timeline) {
    if (idx > first && idx < last && !have.has(idx)) g += 1;
  }
  return g;
}

export function gapsOf(
  data: PersistedData,
  slots: { teacherId: string; day: DayOfWeek; periodId: string }[],
  teacherId: string,
  countDisp = false,
): number {
  const timeline = lessonTimeline(data);
  let g = 0;
  for (const day of data.settings.days) {
    g += gapsOnDay(taughtLessonIndexes(data, slots, teacherId, day, countDisp), timeline);
  }
  return g;
}

export function gapsRanking(
  data: PersistedData,
  slots: { teacherId: string; day: DayOfWeek; periodId: string }[] = data.slots,
  countDisp = false,
): { id: string; name: string; gaps: number }[] {
  return data.teachers
    .filter(isTimetableTeacher)
    .map((t) => ({
      id: t.id,
      name: teacherName(t),
      gaps: gapsOf(data, slots, t.id, countDisp),
    }))
    .filter((x) => slots.some((s) => s.teacherId === x.id))
    .sort((a, b) => b.gaps - a.gaps || a.name.localeCompare(b.name, "it"));
}

/** Buche consecutive più lunghe (es. 1ª–2ª poi 6ª → tre di fila). */
function holeStreak(places: Place[], data: PersistedData, teacherId: string): number {
  const timeline = lessonTimeline(data);
  let mx = 0;
  for (const day of data.settings.days) {
    const taught = taughtLessonIndexes(data, places, teacherId, day);
    if (taught.length < 2) continue;
    const have = new Set(taught);
    const first = taught[0]!;
    const last = taught[taught.length - 1]!;
    let cur = 0;
    for (const idx of timeline) {
      if (idx <= first || idx >= last) {
        cur = 0;
        continue;
      }
      if (!have.has(idx)) {
        cur += 1;
        if (cur > mx) mx = cur;
      } else cur = 0;
    }
  }
  return mx;
}

function pairGapState(
  places: Place[],
  data: PersistedData,
  a: string,
  b: string,
  disp: Map<string, number>,
) {
  const ga = gapsFor(places, data, a);
  const gb = gapsFor(places, data, b);
  const extra = Math.max(0, ga - (disp.get(a) ?? 0)) + Math.max(0, gb - (disp.get(b) ?? 0));
  return {
    tot: ga + gb,
    mx: Math.max(ga, gb),
    st: Math.max(holeStreak(places, data, a), holeStreak(places, data, b)),
    long: schoolSpanDays(places, data, a) + schoolSpanDays(places, data, b),
    extra,
  };
}

/** Giornate in cui si resta dalla 1ª alla 6ª con almeno due buche (4 lezioni, 6 ore a scuola). */
function longPresenceDays(places: Place[], data: PersistedData, teacherId: string): number {
  let n = 0;
  for (const day of data.settings.days) {
    const idxs = places
      .filter((p) => p.teacherId === teacherId && p.day === day)
      .map((p) => periodIndex(data, p.periodId))
      .sort((a, b) => a - b);
    if (idxs.length < 2) continue;
    const span = idxs[idxs.length - 1]! - idxs[0]! + 1;
    if (span >= 6 && span - idxs.length >= 2) n += 1;
  }
  return n;
}

/** Meno buche in tutto; a parità, i buchi oltre la disposizione stanno sui meno carichi. */
function fairerGaps(
  before: { tot: number; mx: number; st: number; long: number; extra: number },
  after: { tot: number; mx: number; st: number; long: number; extra: number },
): boolean {
  if (after.tot < before.tot) return true;
  if (after.tot > before.tot) return false;
  if (after.long < before.long) return true;
  if (after.long > before.long) return false;
  if (after.extra < before.extra) return true;
  if (after.extra > before.extra) return false;
  if (after.mx < before.mx) return true;
  if (after.mx > before.mx) return false;
  return after.st < before.st;
}

function hoursOnDay(places: Place[], teacherId: string, day: DayOfWeek): number {
  return places.filter((p) => p.teacherId === teacherId && p.day === day).length;
}

function freeDaysOf(places: Place[], days: DayOfWeek[], teacherId: string): DayOfWeek[] {
  return days.filter((d) => hoursOnDay(places, teacherId, d) === 0);
}

function targetPlessoDays(hours: number, maxInOneClass = 0): number {
  const byLoad = Math.max(1, Math.ceil(hours / 6));
  const byClass = maxInOneClass > 0 ? Math.ceil(maxInOneClass / 3) : 1;
  return Math.max(byLoad, byClass);
}

function maxClassHours(weekly: Map<string, number>, teacherId: string): number {
  const byClass = new Map<string, number>();
  for (const [key, hours] of weekly) {
    const [classId, tid] = key.split("|");
    if (tid !== teacherId) continue;
    byClass.set(classId, (byClass.get(classId) ?? 0) + hours);
  }
  let mx = 0;
  for (const n of byClass.values()) if (n > mx) mx = n;
  return mx;
}

function daysFromSlots(data: PersistedData, teacherId: string): Set<DayOfWeek> {
  const set = new Set<DayOfWeek>();
  for (const s of data.slots) {
    if (s.teacherId === teacherId) set.add(s.day);
  }
  return set;
}

function awayDaysOf(t: Teacher): Set<DayOfWeek> {
  const set = new Set<DayOfWeek>();
  for (const a of t.awaySlots ?? []) set.add(a.day);
  return set;
}

function evaluatePlaces(
  places: Place[],
  data: PersistedData,
  opts: BuildOptions,
  load: Map<string, number>,
  weekly: Map<string, number>,
): number {
  const last = lastPeriod(data);
  const lastCounts = new Map<string, number>();
  let cost = 0;
  const teachers = new Map(data.teachers.map((t) => [t.id, t]));
  const nDays = data.settings.days.length;

  for (const id of new Set(places.map((p) => p.teacherId))) {
    if (opts.avoidGaps) {
      const cap = teachers.get(id)?.dispHours ?? 0;
      const g = gapsFor(places, data, id);
      cost += Math.max(0, g - cap) * 90 + Math.min(g, cap) * 12;
    }
    if (opts.avoidGaps) cost += holeStreak(places, data, id) * 35;
    if (opts.avoidGaps) cost += longPresenceDays(places, data, id) * 260;
    if (opts.maxFiveAtSchool) cost += schoolSpanDays(places, data, id) * 420;
    else cost += schoolSpanDays(places, data, id) * 1600;
    lastCounts.set(id, places.filter((p) => p.teacherId === id && p.periodId === last?.id).length);
    const t = teachers.get(id);
    if (opts.avoidFiveHours) {
      for (const day of data.settings.days) {
        const h = hoursOnDay(places, id, day);
        if (h >= 6) cost += (h - 5) * 520;
      }
    }
    if (opts.noFreeDay && (load.get(id) ?? 0) >= nDays && !isDualPlesso(t)) {
      cost += freeDaysOf(places, data.settings.days, id).length * 900;
    }
    if (t?.otherPlesso) {
      const hours = load.get(id) ?? 0;
      const target = targetPlessoDays(hours, maxClassHours(weekly, id));
      const used = data.settings.days.filter((d) => hoursOnDay(places, id, d) > 0).length;
      if (used > target) cost += (used - target) * 320;
      const locked = daysFromSlots(data, id);
      if (locked.size > 0) {
        for (const d of data.settings.days) {
          if (hoursOnDay(places, id, d) > 0 && !locked.has(d)) cost += 140;
        }
      }
      const away = awayDaysOf(t);
      for (const d of data.settings.days) {
        if (away.has(d) && hoursOnDay(places, id, d) > 0) cost += 45;
      }
    }
  }
  if (opts.balanceLastHour && last) {
    const vals = [...lastCounts.values()];
    if (vals.length) {
      const mx = Math.max(...vals);
      const mn = Math.min(...vals);
      cost += (mx - mn) * 28 + mx * 6;
    }
  }
  if (opts.noAdjacentPlessi) {
    for (const p of places) {
      const t = teachers.get(p.teacherId);
      if (!t || !(t.awaySlots?.length)) continue;
      const away = awaySet(t);
      const idx = periodIndex(data, p.periodId);
      for (const q of lessonPeriodsOf(data)) {
        if (Math.abs(q.index - idx) !== 1) continue;
        if (away.has(busyKey(p.day, q.id, t.id))) cost += 800;
      }
    }
  }
  for (const cls of data.classes) {
    for (const day of data.settings.days) {
      const row = lessonPeriodsOf(data)
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((per) => places.find((p) => p.classId === cls.id && p.day === day && p.periodId === per.id));
      const teachersToday = new Set(row.filter(Boolean).map((p) => p!.teacherId));
      if (opts.variety && teachersToday.size > 0 && teachersToday.size < 4) {
        cost += (4 - teachersToday.size) * 55;
      }
      const byTeacher = new Map<string, number>();
      for (const p of row) {
        if (!p) continue;
        byTeacher.set(p.teacherId, (byTeacher.get(p.teacherId) ?? 0) + 1);
      }
      for (const [tid, n] of byTeacher) {
        const max = teachers.get(tid)?.otherPlesso || opts.allowThreeConsecutive ? 3 : 2;
        if (n > max) cost += (n - max) * 220;
      }
      for (let i = 0; i < row.length - 2; i++) {
        const a = row[i];
        const b = row[i + 1];
        const c = row[i + 2];
        if (a && b && c && HEAVY.has(a.subject) && HEAVY.has(b.subject) && HEAVY.has(c.subject)) cost += 40;
      }
      if (opts.avoidHeavyBlocks) {
        let run = 0;
        for (const p of row) {
          if (p && CORE_LOAD.has(p.subject)) {
            run += 1;
            if (run >= 4) {
              cost += 480;
              break;
            }
          } else run = 0;
        }
      }
    }
    if (opts.variety) {
      for (const subject of ["Italiano", "Matematica"]) {
        const rows = places.filter((p) => p.classId === cls.id && p.subject === subject);
        if (rows.length === 0) continue;
        if (teachers.get(rows[0]!.teacherId)?.otherPlesso) continue;
        const daysUsed = new Set(rows.map((p) => p.day));
        const need = minSpreadDays(subject, rows.length);
        if (daysUsed.size < need) cost += (need - daysUsed.size) * 90;
      }
      for (const [key, hours] of weekly) {
        if (hours > 2) continue;
        const [classId, teacherId, subject] = key.split("|");
        if (classId !== cls.id) continue;
        const byDay = new Map<DayOfWeek, number>();
        for (const p of places) {
          if (p.classId === classId && p.teacherId === teacherId && p.subject === subject) {
            byDay.set(p.day, (byDay.get(p.day) ?? 0) + 1);
          }
        }
        for (const n of byDay.values()) {
          if (n >= 2) cost += 55;
        }
      }
    }
  }
  return cost;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTimetable(data: PersistedData, opts: BuildOptions, seed = Date.now()): BuildResult {
  const { lessons } = timetableDemand(data);
  const units: { classId: string; teacherId: string; subject: string }[] = [];
  const load = new Map<string, number>();
  const weekly = new Map<string, number>();
  for (const l of lessons) {
    for (let i = 0; i < l.hours; i++) units.push({ classId: l.classId, teacherId: l.teacherId, subject: l.subject });
    load.set(l.teacherId, (load.get(l.teacherId) ?? 0) + l.hours);
    weekly.set(pairKey(l.classId, l.teacherId, l.subject), l.hours);
  }
  const teachers = new Map(data.teachers.map((t) => [t.id, t]));
  const disp = new Map(data.teachers.map((t) => [t.id, t.dispHours ?? 0]));
  const last = lastPeriod(data);

  function lastCountOf(list: Place[], tid: string) {
    return list.filter((p) => p.teacherId === tid && p.periodId === last?.id).length;
  }

  let teacherBusy = new Set<string>();
  let classBusy = new Set<string>();
  let places: Place[] = [];
  const leftover: typeof units = [];

  function lastCount(tid: string) {
    return lastCountOf(places, tid);
  }

  function slotScore(item: (typeof units)[0], day: DayOfWeek, periodId: string): number {
    const idx = periodIndex(data, periodId);
    const hours = places
      .filter((p) => p.teacherId === item.teacherId && p.day === day)
      .map((p) => periodIndex(data, p.periodId));
    let s = 10;
    const t = teachers.get(item.teacherId);
    if (opts.noFreeDay && !isDualPlesso(t)) {
      const nDays = data.settings.days.length;
      const total = load.get(item.teacherId) ?? 0;
      if (total >= nDays) {
        const placedN = places.filter((p) => p.teacherId === item.teacherId).length;
        const empty = freeDaysOf(places, data.settings.days, item.teacherId);
        const left = total - placedN;
        if (empty.length > 0) {
          const onEmpty = empty.includes(day);
          if (left <= empty.length) s += onEmpty ? 220 : -180;
          else s += onEmpty ? 95 : 0;
        }
      }
    }
    if (t?.otherPlesso) {
      const total = load.get(item.teacherId) ?? 0;
      const target = targetPlessoDays(total, maxClassHours(weekly, item.teacherId));
      const used = new Set(
        places.filter((p) => p.teacherId === item.teacherId).map((p) => p.day),
      );
      const locked = daysFromSlots(data, item.teacherId);
      const away = awayDaysOf(t);
      if (away.has(day)) s -= 75;
      if (locked.size > 0) s += locked.has(day) ? 90 : -55;
      if (used.has(day)) s += 70 + hoursOnDay(places, item.teacherId, day) * 12;
      else if (used.size >= target) s -= 160;
    }
    if (opts.avoidGaps && hours.length) {
      const first = Math.min(...hours);
      const hi = Math.max(...hours);
      if (idx > first && idx < hi) s += 40;
      else if (idx === hi + 1 || idx === first - 1) s += 28;
      else s += 4 - Math.min(Math.abs(idx - first), Math.abs(idx - hi));
    }
    if (opts.avoidFiveHours && hours.length >= 5) s -= 220;
    if (!opts.maxFiveAtSchool && hours.length) {
      const lo = Math.min(...hours);
      const hi = Math.max(...hours);
      if ((lo === 1 && idx === 6) || (hi === 6 && idx === 1)) s -= 220;
    }
    if ((t?.rientroDays ?? []).includes(day)) {
      if (idx === 6) s += 95;
      else if (idx === 5) {
        s += 90;
        if (hours.includes(6)) s += 25;
      } else if (idx === 4) {
        s += 55;
        if (hours.includes(5)) s += 25;
      } else s -= 200;
      const cls = data.classes.find((c) => c.id === item.classId);
      if (cls?.tempo === "TP" && idx >= 4) s += 50;
    }
    const prefers = t?.preferSlots ?? [];
    if (prefers.length) {
      const onDay = prefers.filter((a) => a.day === day);
      if (onDay.some((a) => a.periodId === periodId)) s += 140;
      else if (onDay.length) s -= 45;
    }
    const musts = t?.mustSlots ?? [];
    if (musts.length) {
      const hit = musts.find((a) => a.day === day && a.periodId === periodId);
      if (hit) s += mustClassIds(hit).includes(item.classId) ? 1400 : -800;
    }
    if (opts.avoidHeavyBlocks) {
      const run = coreRunIfPlaced(places, data, item.classId, day, periodId, item.subject);
      if (run >= 4) s -= 520;
      else if (run === 3) s -= 70;
    }
    if (opts.balanceLastHour && last && periodId === last.id) s -= 10 + lastCount(item.teacherId) * 14;
    if (opts.variety) {
      const w = weekly.get(pairKey(item.classId, item.teacherId, item.subject)) ?? 1;
      const distinct = new Set(
        places.filter((p) => p.classId === item.classId && p.day === day).map((p) => p.teacherId),
      );
      if (!distinct.has(item.teacherId)) s += 24;
      const subDays = new Set(
        places.filter((p) => p.classId === item.classId && p.subject === item.subject).map((p) => p.day),
      );
      const placedSub = places.filter(
        (p) => p.classId === item.classId && p.subject === item.subject,
      ).length;
      const leftSub = w - placedSub;
      const emptySubDays = data.settings.days.filter((d) => !subDays.has(d)).length;
      if (w <= 2) {
        const sameDaySub = places.filter(
          (p) => p.classId === item.classId && p.teacherId === item.teacherId && p.subject === item.subject && p.day === day,
        );
        if (sameDaySub.length) {
          const adj = sameDaySub.some((p) => Math.abs(periodIndex(data, p.periodId) - idx) === 1);
          s += adj ? 8 : -75;
        } else {
          s += 45;
        }
      } else if (item.subject === "Italiano" || item.subject === "Matematica") {
        const adj = places.some(
          (p) =>
            p.classId === item.classId &&
            p.teacherId === item.teacherId &&
            p.day === day &&
            Math.abs(periodIndex(data, p.periodId) - idx) === 1,
        );
        if (adj) s += 36;
        if (!t?.otherPlesso) {
          const need = minSpreadDays(item.subject, w);
          if (!subDays.has(day)) s += 28;
          if (leftSub <= emptySubDays && !subDays.has(day)) s += 40;
          if (subDays.size < need && !subDays.has(day)) s += 30;
        }
      }
    }
    return s;
  }

  function placeItem(item: (typeof units)[0], day: DayOfWeek, periodId: string) {
    teacherBusy.add(busyKey(day, periodId, item.teacherId));
    classBusy.add(busyKey(day, periodId, item.classId));
    places.push({ ...item, day, periodId });
  }

  function isMustPlace(p: { teacherId: string; classId: string; day: DayOfWeek; periodId: string }) {
    return (teachers.get(p.teacherId)?.mustSlots ?? []).some(
      (a) => a.day === p.day && a.periodId === p.periodId && mustClassIds(a).includes(p.classId),
    );
  }

  function pinMust(order: typeof units): typeof units {
    const rest = order.slice();
    for (const t of data.teachers) {
      for (const a of t.mustSlots ?? []) {
        const ids = mustClassIds(a);
        if (!ids.length) continue;
        if (teacherBusy.has(busyKey(a.day, a.periodId, t.id))) continue;
        if (awaySet(t).has(busyKey(a.day, a.periodId, t.id))) continue;
        let placed = false;
        for (const relax of [false, true]) {
          for (const classId of ids) {
            if (classBusy.has(busyKey(a.day, a.periodId, classId))) continue;
            for (let i = 0; i < rest.length; i++) {
              const item = rest[i]!;
              if (item.teacherId !== t.id || item.classId !== classId) continue;
              if (
                !feasible(
                  data,
                  item,
                  a.day,
                  a.periodId,
                  teacherBusy,
                  classBusy,
                  opts,
                  teachers,
                  places,
                  weekly,
                  true,
                  relax,
                )
              )
                continue;
              placeItem(item, a.day, a.periodId);
              rest.splice(i, 1);
              placed = true;
              break;
            }
            if (placed) break;
          }
          if (placed) break;
        }
      }
    }
    return rest;
  }

  function mustMissCount(list: Place[]) {
    let n = 0;
    for (const t of data.teachers) {
      for (const a of t.mustSlots ?? []) {
        const ids = mustClassIds(a);
        if (!ids.length) continue;
        if (
          !list.some(
            (p) =>
              p.teacherId === t.id &&
              p.day === a.day &&
              p.periodId === a.periodId &&
              ids.includes(p.classId),
          )
        )
          n += 1;
      }
    }
    return n;
  }

  function greedyFill(order: typeof units) {
    leftover.length = 0;
    for (const item of order) {
      let best: { day: DayOfWeek; periodId: string; score: number } | null = null;
      for (const day of data.settings.days) {
        for (const period of lessonPeriodsOf(data)) {
          if (!feasible(data, item, day, period.id, teacherBusy, classBusy, opts, teachers, places, weekly)) continue;
          const score = slotScore(item, day, period.id);
          if (!best || score > best.score) best = { day, periodId: period.id, score };
        }
      }
      if (!best) leftover.push(item);
      else placeItem(item, best.day, best.periodId);
    }
  }

  function packLeftover(relaxFive = false) {
    for (let guard = 0; guard < 5; guard++) {
      let moved = false;
      for (let i = leftover.length - 1; i >= 0; i--) {
        const item = leftover[i]!;
        let best: { day: DayOfWeek; periodId: string; score: number } | null = null;
        for (const day of data.settings.days) {
          for (const period of lessonPeriodsOf(data)) {
            if (
              !feasible(
                data,
                item,
                day,
                period.id,
                teacherBusy,
                classBusy,
                opts,
                teachers,
                places,
                weekly,
                relaxFive,
              )
            )
              continue;
            const score = slotScore(item, day, period.id);
            if (!best || score > best.score) best = { day, periodId: period.id, score };
          }
        }
        if (best) {
          placeItem(item, best.day, best.periodId);
          leftover.splice(i, 1);
          moved = true;
          continue;
        }
        const occs = places.filter((p) => p.classId === item.classId);
        for (const occ of occs) {
          if (isMustPlace(occ)) continue;
          const od = occ.day;
          const op = occ.periodId;
          const occIdx = places.indexOf(occ);
          if (occIdx < 0) continue;
          teacherBusy.delete(busyKey(od, op, occ.teacherId));
          classBusy.delete(busyKey(od, op, occ.classId));
          places.splice(occIdx, 1);
          const itemFits = feasible(
            data,
            item,
            od,
            op,
            teacherBusy,
            classBusy,
            opts,
            teachers,
            places,
            weekly,
            relaxFive,
          );
          let dest: { day: DayOfWeek; periodId: string } | null = null;
          if (itemFits) {
            for (const day of data.settings.days) {
              for (const period of lessonPeriodsOf(data)) {
                if (day === od && period.id === op) continue;
                if (feasible(data, occ, day, period.id, teacherBusy, classBusy, opts, teachers, places, weekly)) {
                  dest = { day, periodId: period.id };
                  break;
                }
              }
              if (dest) break;
            }
          }
          if (!itemFits || !dest) {
            places.splice(occIdx, 0, occ);
            teacherBusy.add(busyKey(od, op, occ.teacherId));
            classBusy.add(busyKey(od, op, occ.classId));
            continue;
          }
          occ.day = dest.day;
          occ.periodId = dest.periodId;
          places.push(occ);
          teacherBusy.add(busyKey(occ.day, occ.periodId, occ.teacherId));
          classBusy.add(busyKey(occ.day, occ.periodId, occ.classId));
          placeItem(item, od, op);
          leftover.splice(i, 1);
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }

  function packAll() {
    packLeftover(false);
    if (leftover.length) packLeftover(true);
  }

  let bestPlaces: Place[] = [];
  let bestLeft: typeof units = units.slice();
  let bestTB = new Set<string>();
  let bestCB = new Set<string>();
  let bestSix = 99;
  let bestMust = 99;
  let bestHeavy = 99;
  let bestDualKept = 99;
  let bestGaps = 999;
  function sixCount(list: Place[]) {
    let n = 0;
    for (const tid of load.keys()) n += schoolSpanDays(list, data, tid);
    return n;
  }
  function gapSum(list: Place[]) {
    let n = 0;
    for (const tid of load.keys()) n += gapsFor(list, data, tid);
    return n;
  }
  for (let t = 0; t < 12; t++) {
    const randA = rng((seed + t * 7919) >>> 0);
    const order = units.slice();
    order.sort(() => randA() - 0.5);
    order.sort((a, b) => {
      const wa = weekly.get(pairKey(a.classId, a.teacherId, a.subject)) ?? 9;
      const wb = weekly.get(pairKey(b.classId, b.teacherId, b.subject)) ?? 9;
      if (wa !== wb) return wa - wb;
      return (load.get(b.teacherId) ?? 0) - (load.get(a.teacherId) ?? 0);
    });
    teacherBusy = new Set();
    classBusy = new Set();
    places = [];
    greedyFill(pinMust(order));
    packAll();
    const dualDays = [...load.keys()].reduce((n, tid) => {
      if (!teachers.get(tid)?.otherPlesso) return n;
      return n + data.settings.days.filter((d) => hoursOnDay(places, tid, d) > 0).length;
    }, 0);
    const six = sixCount(places);
    const gapsN = gapSum(places);
    const miss = mustMissCount(places);
    const heavyN = opts.avoidHeavyBlocks ? heavyBlockCount(places, data) : 0;
    const better =
      leftover.length < bestLeft.length ||
      (leftover.length === bestLeft.length && miss < bestMust) ||
      (leftover.length === bestLeft.length && miss === bestMust && six < bestSix) ||
      (leftover.length === bestLeft.length && miss === bestMust && six === bestSix && heavyN < bestHeavy) ||
      (leftover.length === bestLeft.length &&
        miss === bestMust &&
        six === bestSix &&
        heavyN === bestHeavy &&
        gapsN < bestGaps) ||
      (leftover.length === bestLeft.length &&
        miss === bestMust &&
        six === bestSix &&
        heavyN === bestHeavy &&
        gapsN === bestGaps &&
        dualDays < bestDualKept);
    if (better) {
      bestPlaces = places.map((p) => ({ ...p }));
      bestLeft = leftover.slice();
      bestTB = new Set(teacherBusy);
      bestCB = new Set(classBusy);
      bestSix = six;
      bestMust = miss;
      bestHeavy = heavyN;
      bestDualKept = dualDays;
      bestGaps = gapsN;
    }
    if (leftover.length === 0 && six === 0 && miss === 0) break;
  }
  places = bestPlaces;
  leftover.length = 0;
  leftover.push(...bestLeft);
  teacherBusy = bestTB;
  classBusy = bestCB;
  const rand = rng(seed);

  function swap(i: number, j: number): boolean {
    const a = places[i]!;
    const b = places[j]!;
    if (a.day === b.day && a.periodId === b.periodId) return false;
    if (isMustPlace(a) || isMustPlace(b)) return false;
    teacherBusy.delete(busyKey(a.day, a.periodId, a.teacherId));
    teacherBusy.delete(busyKey(b.day, b.periodId, b.teacherId));
    classBusy.delete(busyKey(a.day, a.periodId, a.classId));
    classBusy.delete(busyKey(b.day, b.periodId, b.classId));
    const okA = feasible(data, a, b.day, b.periodId, teacherBusy, classBusy, opts, teachers, places, weekly);
    const okB = feasible(data, b, a.day, a.periodId, teacherBusy, classBusy, opts, teachers, places, weekly);
    if (!okA || !okB) {
      teacherBusy.add(busyKey(a.day, a.periodId, a.teacherId));
      teacherBusy.add(busyKey(b.day, b.periodId, b.teacherId));
      classBusy.add(busyKey(a.day, a.periodId, a.classId));
      classBusy.add(busyKey(b.day, b.periodId, b.classId));
      return false;
    }
    const da = a.day;
    const pa = a.periodId;
    a.day = b.day;
    a.periodId = b.periodId;
    b.day = da;
    b.periodId = pa;
    teacherBusy.add(busyKey(a.day, a.periodId, a.teacherId));
    teacherBusy.add(busyKey(b.day, b.periodId, b.teacherId));
    classBusy.add(busyKey(a.day, a.periodId, a.classId));
    classBusy.add(busyKey(b.day, b.periodId, b.classId));
    return true;
  }

  let bestCost = evaluatePlaces(places, data, opts, load, weekly);
  for (let k = 0; k < 2800; k++) {
    if (places.length < 2) break;
    const i = Math.floor(rand() * places.length);
    const j = Math.floor(rand() * places.length);
    if (i === j) continue;
    const a = places[i]!;
    const b = places[j]!;
    const snapshot = { ad: a.day, ap: a.periodId, bd: b.day, bp: b.periodId };
    if (!swap(i, j)) continue;
    const next = evaluatePlaces(places, data, opts, load, weekly);
    if (next <= bestCost || (rand() < 0.03 && next - bestCost < 200)) {
      bestCost = next;
    } else {
      teacherBusy.delete(busyKey(a.day, a.periodId, a.teacherId));
      teacherBusy.delete(busyKey(b.day, b.periodId, b.teacherId));
      classBusy.delete(busyKey(a.day, a.periodId, a.classId));
      classBusy.delete(busyKey(b.day, b.periodId, b.classId));
      a.day = snapshot.ad;
      a.periodId = snapshot.ap;
      b.day = snapshot.bd;
      b.periodId = snapshot.bp;
      teacherBusy.add(busyKey(a.day, a.periodId, a.teacherId));
      teacherBusy.add(busyKey(b.day, b.periodId, b.teacherId));
      classBusy.add(busyKey(a.day, a.periodId, a.classId));
      classBusy.add(busyKey(b.day, b.periodId, b.classId));
    }
  }

  packAll();

  function movePlace(place: Place, day: DayOfWeek, periodId: string): boolean {
    if (isMustPlace(place)) return false;
    teacherBusy.delete(busyKey(place.day, place.periodId, place.teacherId));
    classBusy.delete(busyKey(place.day, place.periodId, place.classId));
    const ok = feasible(data, place, day, periodId, teacherBusy, classBusy, opts, teachers, places, weekly);
    if (!ok) {
      teacherBusy.add(busyKey(place.day, place.periodId, place.teacherId));
      classBusy.add(busyKey(place.day, place.periodId, place.classId));
      return false;
    }
    place.day = day;
    place.periodId = periodId;
    teacherBusy.add(busyKey(day, periodId, place.teacherId));
    classBusy.add(busyKey(day, periodId, place.classId));
    return true;
  }

  if (opts.noFreeDay) {
    const nDays = data.settings.days.length;
    for (const tid of load.keys()) {
      if ((load.get(tid) ?? 0) < nDays) continue;
      if (isDualPlesso(teachers.get(tid))) continue;
      for (const empty of [...freeDaysOf(places, data.settings.days, tid)]) {
        const donors = data.settings.days.filter((d) => hoursOnDay(places, tid, d) >= 2);
        let filled = false;
        for (const donorDay of donors) {
          const cands = places.filter((p) => p.teacherId === tid && p.day === donorDay);
          for (const place of cands) {
            for (const period of lessonPeriodsOf(data)) {
              if (movePlace(place, empty, period.id)) {
                filled = true;
                break;
              }
            }
            if (filled) break;
          }
          if (filled) break;
        }
        if (filled) continue;
        const mine = places.filter((p) => p.teacherId === tid && hoursOnDay(places, tid, p.day) >= 2);
        const others = places.filter((p) => p.day === empty && p.teacherId !== tid);
        outer: for (const a of mine) {
          for (const b of others) {
            const i = places.indexOf(a);
            const j = places.indexOf(b);
            if (i < 0 || j < 0) continue;
            if (!swap(i, j)) continue;
            if (hoursOnDay(places, tid, empty) > 0) break outer;
            swap(i, j);
          }
        }
      }
    }
  }

  if (opts.avoidFiveHours) {
    for (let guard = 0; guard < 40; guard++) {
      let improved = false;
      outer: for (const tid of load.keys()) {
        for (const day of data.settings.days) {
          if (hoursOnDay(places, tid, day) < 6) continue;
          const mine = places.filter((p) => p.teacherId === tid && p.day === day);
          const lighter = data.settings.days.filter((d) => d !== day && hoursOnDay(places, tid, d) < 4);
          for (const place of mine) {
            for (const dest of lighter) {
              for (const period of lessonPeriodsOf(data)) {
                if (movePlace(place, dest, period.id)) {
                  improved = true;
                  break outer;
                }
              }
            }
          }
        }
      }
      if (!improved) break;
    }
  }

  if (opts.avoidGaps) {
    for (let guard = 0; guard < 80; guard++) {
      let improved = false;
      for (const tid of load.keys()) {
        const before = gapsFor(places, data, tid);
        const cap = disp.get(tid) ?? 0;
        if (before === 0 || before <= cap) continue;
        for (const day of data.settings.days) {
          const mine = places.filter((p) => p.teacherId === tid && p.day === day);
          if (mine.length < 2) continue;
          const idxs = mine.map((p) => periodIndex(data, p.periodId)).sort((a, b) => a - b);
          const first = idxs[0]!;
          const lastIdx = idxs[idxs.length - 1]!;
          const occupied = new Set(idxs);
          const holes: number[] = [];
          for (let i = first; i <= lastIdx; i++) if (!occupied.has(i)) holes.push(i);
          if (holes.length === 0) continue;
          const cands = mine;
          for (const place of cands) {
            for (const h of holes) {
              const per = lessonPeriodsOf(data).find((p) => p.index === h);
              if (!per) continue;
              const fd = place.day;
              const fp = place.periodId;
              if (movePlace(place, day, per.id)) {
                const after = gapsFor(places, data, tid);
                if (after < before && after >= cap) {
                  improved = true;
                  break;
                }
                movePlace(place, fd, fp);
              }
              const other = places.find(
                (p) => p.classId === place.classId && p.day === day && p.periodId === per.id,
              );
              if (!other) continue;
              const i = places.indexOf(place);
              const j = places.indexOf(other);
              if (i < 0 || j < 0) continue;
              const prev = pairGapState(places, data, tid, other.teacherId, disp);
              if (!swap(i, j)) continue;
              if (fairerGaps(prev, pairGapState(places, data, tid, other.teacherId, disp))) {
                improved = true;
                break;
              }
              swap(i, j);
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (!improved) break;
    }

    // Qualsiasi docente: scambio di due ore nella stessa classe e giorno.
    for (let guard = 0; guard < 50; guard++) {
      let improved = false;
      outer: for (const cls of data.classes) {
        for (const day of data.settings.days) {
          const row = places.filter((p) => p.classId === cls.id && p.day === day);
          for (let a = 0; a < row.length; a++) {
            for (let b = a + 1; b < row.length; b++) {
              const pa = row[a]!;
              const pb = row[b]!;
              if (pa.teacherId === pb.teacherId) continue;
              const i = places.indexOf(pa);
              const j = places.indexOf(pb);
              if (i < 0 || j < 0) continue;
              const prev = pairGapState(places, data, pa.teacherId, pb.teacherId, disp);
              if (!swap(i, j)) continue;
              if (fairerGaps(prev, pairGapState(places, data, pa.teacherId, pb.teacherId, disp))) {
                improved = true;
                break outer;
              }
              swap(i, j);
            }
          }
        }
      }
      if (!improved) break;
    }

    // 1ª–6ª con due buche: sposta un’ala su un altro giorno (sotto 4 ore).
    for (let guard = 0; guard < 30; guard++) {
      let improved = false;
      outerLong: for (const tid of load.keys()) {
        if (longPresenceDays(places, data, tid) === 0) continue;
        for (const day of data.settings.days) {
          const mine = places.filter((p) => p.teacherId === tid && p.day === day);
          if (mine.length < 2) continue;
          const idxs = mine.map((p) => periodIndex(data, p.periodId)).sort((a, b) => a - b);
          const span = idxs[idxs.length - 1]! - idxs[0]! + 1;
          if (span < 6 || span - idxs.length < 2) continue;
          const first = idxs[0]!;
          const lastI = idxs[idxs.length - 1]!;
          const wings = mine.filter((p) => {
            const i = periodIndex(data, p.periodId);
            return i === first || i === lastI;
          });
          const dests = data.settings.days.filter((d) => d !== day && hoursOnDay(places, tid, d) < 4);
          for (const place of wings) {
            const fd = place.day;
            const fp = place.periodId;
            const beforeLong = longPresenceDays(places, data, tid);
            const beforeGaps = gapsFor(places, data, tid);
            for (const dest of dests) {
              for (const period of lessonPeriodsOf(data)) {
                if (!movePlace(place, dest, period.id)) continue;
                if (
                  longPresenceDays(places, data, tid) < beforeLong ||
                  gapsFor(places, data, tid) < beforeGaps
                ) {
                  improved = true;
                  break outerLong;
                }
                movePlace(place, fd, fp);
              }
            }
          }
        }
      }
      if (!improved) break;
    }
  }

  if (!opts.maxFiveAtSchool && leftover.length === 0) {
    for (let guard = 0; guard < 40; guard++) {
      let improved = false;
      outerSix: for (const tid of load.keys()) {
        if (schoolSpanDays(places, data, tid) === 0) continue;
        for (const day of data.settings.days) {
          const mine = places.filter((p) => p.teacherId === tid && p.day === day);
          if (mine.length < 2) continue;
          const idxs = mine.map((p) => periodIndex(data, p.periodId)).sort((a, b) => a - b);
          if (idxs[idxs.length - 1]! - idxs[0]! + 1 < 6) continue;
          const first = idxs[0]!;
          const lastI = idxs[idxs.length - 1]!;
          const wings = mine.filter((p) => {
            const i = periodIndex(data, p.periodId);
            return i === first || i === lastI;
          });
          const dests = data.settings.days.filter((d) => d !== day && hoursOnDay(places, tid, d) < 5);
          for (const place of wings) {
            const fd = place.day;
            const fp = place.periodId;
            const before = schoolSpanDays(places, data, tid);
            for (const dest of dests) {
              for (const period of lessonPeriodsOf(data)) {
                if (!movePlace(place, dest, period.id)) continue;
                const after = schoolSpanDays(places, data, tid);
                if (after < before) {
                  improved = true;
                  break outerSix;
                }
                movePlace(place, fd, fp);
              }
            }
          }
        }
      }
      if (!improved) break;
    }
  }

  const slots: TimetableSlot[] = places.map((p) => ({
    id: uid("slot"),
    day: p.day,
    periodId: p.periodId,
    classId: p.classId,
    teacherId: p.teacherId,
    subject: p.subject,
  }));

  const lastId = last?.id;
  const lastHourByTeacher = data.teachers
    .filter(isTimetableTeacher)
    .map((t) => ({
      id: t.id,
      name: teacherName(t),
      count: places.filter((p) => p.teacherId === t.id && p.periodId === lastId).length,
    }))
    .filter((x) => places.some((p) => p.teacherId === x.id))
    .sort((a, b) => b.count - a.count);

  let gaps = 0;
  for (const t of data.teachers.filter(isTimetableTeacher)) gaps += gapsFor(places, data, t.id);

  let plessoIssues = 0;
  if (opts.noAdjacentPlessi) {
    for (const p of places) {
      const t = teachers.get(p.teacherId);
      if (!t || !(t.awaySlots?.length)) continue;
      const away = awaySet(t);
      const idx = periodIndex(data, p.periodId);
      for (const q of lessonPeriodsOf(data)) {
        if (Math.abs(q.index - idx) === 1 && away.has(busyKey(p.day, q.id, t.id))) plessoIssues += 1;
      }
    }
  }

  const notes: string[] = [];
  if (leftover.length) notes.push(`${leftover.length} ore non piazzate: manca uno slot libero senza scontri.`);
  {
    let want = 0;
    let hit = 0;
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      for (const a of t.preferSlots ?? []) {
        want += 1;
        if (places.some((p) => p.teacherId === t.id && p.day === a.day && p.periodId === a.periodId)) hit += 1;
      }
    }
    if (want) notes.push(`Preferenze ✓: ${hit} su ${want} caselle (non è un vincolo duro).`);
  }
  {
    let want = 0;
    let hit = 0;
    const miss: string[] = [];
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      for (const a of t.mustSlots ?? []) {
        want += 1;
        const ids = mustClassIds(a);
        const ok = places.some(
          (p) =>
            p.teacherId === t.id && p.day === a.day && p.periodId === a.periodId && ids.includes(p.classId),
        );
        if (ok) hit += 1;
        else {
          const names = ids
            .map((id) => data.classes.find((c) => c.id === id)?.name ?? "")
            .filter(Boolean)
            .join("/");
          miss.push(`${teacherName(t)} ${DAY_SHORT[a.day]} ${a.periodId.replace("p", "")}ª ${names}`.trim());
        }
      }
    }
    if (want) {
      notes.push(
        miss.length
          ? `Obblighi classe: ${hit} su ${want}. Manca: ${miss.join("; ")}.`
          : `Obblighi classe: ${hit} su ${want}.`,
      );
    }
  }
  if (opts.avoidHeavyBlocks) {
    const n = heavyBlockCount(places, data);
    notes.push(
      n === 0
        ? "Nessun blocco di 4 ore pesanti di fila (ita/sto/geo/mate/scienze)."
        : `${n} giornate-classe con 4 ore pesanti di fila (ita/sto/geo/mate/scienze).`,
    );
  }
  if (opts.avoidGaps) notes.push(gaps === 0 ? "Nessun buco in orario." : `${gaps} buchi in tutto (qualcuno è normale).`);
  {
    const marked = data.teachers.filter((t) => (t.dispHours ?? 0) > 0);
    if (marked.length) {
      notes.push(
        `A disposizione (buchi ammessi): ${marked
          .map((t) => {
            const g = gapsFor(places, data, t.id);
            const cap = t.dispHours ?? 0;
            return `${teacherName(t)} ${g}/${cap}`;
          })
          .join("; ")}.`,
      );
    }
  }
  if (opts.avoidGaps) {
    const longNames: string[] = [];
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      if (longPresenceDays(places, data, t.id) > 0) longNames.push(teacherName(t));
    }
    if (longNames.length) {
      notes.push(
        `Giornata 1ª–6ª con due buche (si resta 6 ore): ${longNames.slice(0, 4).join(", ")}.`,
      );
    }
  }
  if (!opts.maxFiveAtSchool) {
    const sixNames: string[] = [];
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      if (schoolSpanDays(places, data, t.id) > 0) sixNames.push(teacherName(t));
    }
    notes.push(
      sixNames.length === 0
        ? "Nessuna giornata 1ª–6ª (6 ore a scuola)."
        : `Giornate 1ª–6ª tenute solo perché altrimenti restavano ore fuori: ${sixNames.slice(0, 4).join(", ")}.`,
    );
  }
  if (opts.avoidFiveHours) {
    const heavy: string[] = [];
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      for (const day of data.settings.days) {
        if (hoursOnDay(places, t.id, day) >= 6) {
          heavy.push(teacherName(t));
          break;
        }
      }
    }
    notes.push(
      heavy.length === 0
        ? "Nessuno a 6 lezioni in un giorno."
        : `Ancora 6 lezioni nello stesso giorno: ${[...new Set(heavy)].slice(0, 4).join(", ")}.`,
    );
  }
  if (opts.maxFiveAtSchool) {
    const long: string[] = [];
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      if (schoolSpanDays(places, data, t.id) > 0) long.push(teacherName(t));
    }
    notes.push(
      long.length === 0
        ? "Nessuno a scuola più di 5 ore (lezione + buche)."
        : `Ancora 6 ore a scuola (1ª e 6ª): ${long.slice(0, 4).join(", ")}.`,
    );
  }
  if (opts.balanceLastHour && lastHourByTeacher.length) {
    const mx = lastHourByTeacher[0]!.count;
    const names = lastHourByTeacher
      .filter((x) => x.count === mx && mx > 0)
      .map((x) => x.name)
      .slice(0, 4);
    notes.push(
      mx === 0
        ? "Nessuno all’ultima ora."
        : `Chi ha più ultime ore (${mx}): ${names.join(", ")}.`,
    );
  }
  if (opts.noFreeDay) {
    const nDays = data.settings.days.length;
    const names: string[] = [];
    for (const t of data.teachers.filter(isTimetableTeacher)) {
      if (isDualPlesso(t)) continue;
      if ((load.get(t.id) ?? 0) < nDays) continue;
      const free = freeDaysOf(places, data.settings.days, t.id);
      if (free.length) names.push(teacherName(t));
    }
    notes.push(
      names.length === 0
        ? "Nessun docente (solo questo plesso) con un giorno senza lezioni."
        : `Giorno libero da evitare: ${names.slice(0, 5).join(", ")}.`,
    );
  }
  const dual = data.teachers.filter((t) => t.otherPlesso && isTimetableTeacher(t));
  if (dual.length) {
    notes.push(
      "Docenti su più plessi: ore concentrate in giorni pieni. Un giorno vuoto qui può essere l’altro plesso. I giorni già in orario restano, se possibile.",
    );
  }
  if (opts.variety) {
    let pile = 0;
    let twoBlock = 0;
    for (const cls of data.classes) {
      for (const day of data.settings.days) {
        const byT = new Map<string, number>();
        for (const p of places) {
          if (p.classId === cls.id && p.day === day) byT.set(p.teacherId, (byT.get(p.teacherId) ?? 0) + 1);
        }
        for (const n of byT.values()) if (n > (opts.allowThreeConsecutive ? 3 : 2)) pile += 1;
      }
    }
    for (const [key, hours] of weekly) {
      if (hours > 2) continue;
      const [classId, teacherId, subject] = key.split("|");
      const byDay = new Map<string, number>();
      for (const p of places) {
        if (p.classId === classId && p.teacherId === teacherId && p.subject === subject) {
          byDay.set(String(p.day), (byDay.get(String(p.day)) ?? 0) + 1);
        }
      }
      for (const n of byDay.values()) if (n >= 2) twoBlock += 1;
    }
    if (pile === 0 && twoBlock === 0) {
      notes.push(
        opts.allowThreeConsecutive
          ? "Varietà: al massimo 3 ore dello stesso docente in una classe; le materie da 2 ore preferite su giorni distinti (blocco da 2 solo se serve)."
          : "Varietà: niente giornate con lo stesso docente per 3+ ore; materie da 2 ore preferite su giorni distinti.",
      );
    } else {
      if (pile) notes.push(`${pile} giornate ancora con troppe ore dello stesso docente in una classe.`);
      if (twoBlock) notes.push(`${twoBlock} blocchi da 2 ore (materie da 2 ore settimanali): ammessi se evitano buchi o ore fuori.`);
    }
  }
  if (opts.noAdjacentPlessi) {
    const marked = data.teachers.filter((t) => t.otherPlesso).length;
    if (marked === 0) notes.push("Nessun docente segnato su più plessi: attiva la spunta e le ore altrove.");
    else if (plessoIssues === 0) notes.push("Nessuna ora attaccata a un altro plesso.");
    else notes.push(`${plessoIssues} ore ancora attaccate a un altro plesso.`);
  }
  const rientri = data.teachers.filter((t) => isTimetableTeacher(t) && (t.rientroDays?.length ?? 0) > 0);
  if (rientri.length) {
    notes.push(
      `Rientro T.P. (4ª–6ª al mattino, 7ª–8ª a mano): ${rientri
        .map((t) => `${teacherName(t)} ${(t.rientroDays ?? []).map((d) => DAY_SHORT[d]).join("/")}`)
        .join("; ")}.`,
    );
  }

  return {
    slots,
    report: {
      placed: places.length,
      total: units.length,
      leftover: leftover.length,
      gaps,
      lastHourByTeacher,
      plessoIssues,
      notes,
    },
  };
}
