import type {
  Absence,
  DayOfWeek,
  PersistedData,
  SchoolClass,
  Settings,
  Substitution,
  Teacher,
  TeacherRole,
  Tempo,
  TimetableSlot,
} from "./types";
import { addDays, format, getDay, nextMonday, startOfDay } from "date-fns";
import { withPaletteColors } from "./teacher-palette";

export const DEFAULT_SCHOOL_NAME = "Istituto comprensivo";
export const LEGACY_SCHOOL_NAMES = [] as const;

export const SEED_TEACHER_IDS = [
  "t-ita-1",
  "t-ita-2",
  "t-ita-3",
  "t-ita-4",
  "t-ita-5",
  "t-mat-1",
  "t-mat-2",
  "t-ing-1",
  "t-ing-2",
  "t-fra-1",
  "t-tec-1",
  "t-art-1",
  "t-art-2",
  "t-mus-1",
  "t-mot-1",
  "t-mot-2",
  "t-rel-1",
  "t-sos-1",
  "t-sos-2",
  "t-sos-3",
  "t-sos-4",
  "t-sos-5",
] as const;

export const SEED_CLASS_TEMPO: Record<string, Tempo> = {
  "c-1A": "TN",
  "c-2A": "TN",
  "c-2B": "TP",
  "c-2C": "TN",
  "c-3A": "TP",
  "c-3B": "TP",
};

export const SEED_ABSENCE_IDS = ["a-demo-1", "a-demo-2", "a-demo-3", "a-demo-4"];

const DAYS: DayOfWeek[] = [1, 2, 3, 4, 5];

const PERIODS: Settings["periods"] = [
  { id: "p1", index: 1, label: "1ª ora", start: "08:00", end: "08:55" },
  { id: "p2", index: 2, label: "2ª ora", start: "08:55", end: "09:50" },
  { id: "p3", index: 3, label: "3ª ora", start: "10:05", end: "11:00" },
  { id: "p4", index: 4, label: "4ª ora", start: "11:00", end: "11:55" },
  { id: "p5", index: 5, label: "5ª ora", start: "12:00", end: "12:55" },
  { id: "p6", index: 6, label: "6ª ora", start: "13:05", end: "14:00" },
];

function iso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function demoWeekMonday(): Date {
  const today = startOfDay(new Date());
  const dow = getDay(today);
  let monday: Date;
  if (dow === 1) monday = today;
  else if (dow === 0 || dow === 6) monday = nextMonday(today);
  else monday = nextMonday(addDays(today, -7));
  if (monday.getDate() >= 28) monday = nextMonday(monday);
  return monday;
}

export function buildSeed(): PersistedData {
  const monday = demoWeekMonday();
  const d = (offset: number) => iso(addDays(monday, offset));

  const classes: SchoolClass[] = [
    { id: "c-1A", name: "1ª A", grade: 1, section: "A", students: 18, tempo: "TN" },
    { id: "c-2A", name: "2ª A", grade: 2, section: "A", students: 20, tempo: "TN" },
    { id: "c-2B", name: "2ª B", grade: 2, section: "B", students: 19, tempo: "TP" },
    { id: "c-2C", name: "2ª C", grade: 2, section: "C", students: 17, tempo: "TN" },
    { id: "c-3A", name: "3ª A", grade: 3, section: "A", students: 21, tempo: "TP" },
    { id: "c-3B", name: "3ª B", grade: 3, section: "B", students: 18, tempo: "TP" },
  ];

  const teachers: Teacher[] = withPaletteColors([
    t("t-ita-1", "Rossi", "Anna", ["Italiano", "Storia", "Geografia", "Educazione civica"], 14, "cattedra"),
    t("t-ita-2", "Bianchi", "Luca", ["Italiano"], 6, "cattedra"),
    t("t-ita-3", "Verdi", "Maria", ["Italiano", "Storia", "Geografia", "Educazione civica"], 14, "cattedra"),
    t("t-ita-4", "Neri", "Paolo", ["Italiano", "Storia", "Geografia"], 14, "cattedra"),
    t("t-ita-5", "Russo", "Elena", ["Italiano"], 12, "cattedra"),
    t("t-mat-1", "Ferrari", "Giulia", ["Matematica", "Scienze"], 18, "cattedra"),
    t("t-mat-2", "Esposito", "Marco", ["Matematica", "Scienze"], 18, "cattedra"),
    t("t-ing-1", "Colombo", "Sara", ["Inglese"], 6, "cattedra"),
    t("t-ing-2", "Ricci", "Davide", ["Inglese"], 12, "cattedra"),
    t("t-fra-1", "Marino", "Laura", ["Francese"], 12, "cattedra"),
    t("t-tec-1", "Greco", "Pietro", ["Tecnologia"], 12, "cattedra"),
    t("t-art-1", "Bruno", "Chiara", ["Arte e Immagine"], 6, "cattedra"),
    t("t-art-2", "Galli", "Andrea", ["Arte e Immagine"], 6, "cattedra"),
    t("t-mus-1", "Conti", "Silvia", ["Musica"], 12, "cattedra"),
    t("t-mot-1", "De Luca", "Fabio", ["Scienze Motorie"], 6, "cattedra"),
    t("t-mot-2", "Costa", "Marta", ["Scienze Motorie"], 6, "cattedra"),
    t("t-rel-1", "Fontana", "Irene", ["Religione"], 6, "religione"),
    t("t-sos-1", "Moretti", "Luca", ["Sostegno"], 18, "sostegno", "2ª A", ["c-2A"]),
    t("t-sos-2", "Barbieri", "Anna", ["Sostegno"], 18, "sostegno", "3ª A", ["c-3A"]),
    t("t-sos-3", "Lombardi", "Eva", ["Sostegno"], 9, "sostegno", "2ª B", ["c-2B"]),
    t("t-sos-4", "Romano", "Daniele", ["Sostegno"], 9, "sostegno", "3ª B", ["c-3B"]),
    t("t-sos-5", "Serra", "Giorgio", ["Sostegno"], 9, "sostegno", "2ª C", ["c-2C"]),
  ]);

  type Lesson = { classId: string; subject: string; teacherId: string; hours: number };
  const L = (classId: string, subject: string, teacherId: string, hours: number): Lesson => ({
    classId,
    subject,
    teacherId,
    hours,
  });

  const lessons: Lesson[] = [
    L("c-1A", "Italiano", "t-ita-1", 6),
    L("c-1A", "Storia", "t-ita-1", 2),
    L("c-1A", "Geografia", "t-ita-1", 2),
    L("c-1A", "Matematica", "t-mat-1", 4),
    L("c-1A", "Scienze", "t-mat-1", 2),
    L("c-1A", "Inglese", "t-ing-1", 3),
    L("c-1A", "Francese", "t-fra-1", 2),
    L("c-1A", "Tecnologia", "t-tec-1", 2),
    L("c-1A", "Arte e Immagine", "t-art-1", 2),
    L("c-1A", "Musica", "t-mus-1", 2),
    L("c-1A", "Scienze Motorie", "t-mot-1", 2),
    L("c-1A", "Religione", "t-rel-1", 1),
    L("c-2A", "Italiano", "t-ita-2", 6),
    L("c-2A", "Storia", "t-ita-3", 2),
    L("c-2A", "Geografia", "t-ita-3", 2),
    L("c-2A", "Matematica", "t-mat-1", 4),
    L("c-2A", "Scienze", "t-mat-1", 2),
    L("c-2A", "Inglese", "t-ing-2", 3),
    L("c-2A", "Francese", "t-fra-1", 2),
    L("c-2A", "Tecnologia", "t-tec-1", 2),
    L("c-2A", "Arte e Immagine", "t-art-2", 2),
    L("c-2A", "Musica", "t-mus-1", 2),
    L("c-2A", "Scienze Motorie", "t-mot-2", 2),
    L("c-2A", "Religione", "t-rel-1", 1),
    L("c-2B", "Italiano", "t-ita-3", 6),
    L("c-2B", "Storia", "t-ita-3", 2),
    L("c-2B", "Geografia", "t-ita-3", 2),
    L("c-2B", "Matematica", "t-mat-2", 4),
    L("c-2B", "Scienze", "t-mat-2", 2),
    L("c-2B", "Inglese", "t-ing-2", 3),
    L("c-2B", "Francese", "t-fra-1", 2),
    L("c-2B", "Tecnologia", "t-tec-1", 2),
    L("c-2B", "Arte e Immagine", "t-art-1", 2),
    L("c-2B", "Musica", "t-mus-1", 2),
    L("c-2B", "Scienze Motorie", "t-mot-1", 2),
    L("c-2B", "Religione", "t-rel-1", 1),
    L("c-2C", "Italiano", "t-ita-5", 6),
    L("c-2C", "Storia", "t-ita-1", 2),
    L("c-2C", "Geografia", "t-ita-1", 2),
    L("c-2C", "Matematica", "t-mat-1", 4),
    L("c-2C", "Scienze", "t-mat-1", 2),
    L("c-2C", "Inglese", "t-ing-1", 3),
    L("c-2C", "Francese", "t-fra-1", 2),
    L("c-2C", "Tecnologia", "t-tec-1", 2),
    L("c-2C", "Arte e Immagine", "t-art-2", 2),
    L("c-2C", "Musica", "t-mus-1", 2),
    L("c-2C", "Scienze Motorie", "t-mot-2", 2),
    L("c-2C", "Religione", "t-rel-1", 1),
    L("c-3A", "Italiano", "t-ita-4", 6),
    L("c-3A", "Storia", "t-ita-4", 2),
    L("c-3A", "Geografia", "t-ita-4", 2),
    L("c-3A", "Matematica", "t-mat-2", 4),
    L("c-3A", "Scienze", "t-mat-2", 2),
    L("c-3A", "Inglese", "t-ing-2", 3),
    L("c-3A", "Francese", "t-fra-1", 2),
    L("c-3A", "Tecnologia", "t-tec-1", 2),
    L("c-3A", "Arte e Immagine", "t-art-2", 2),
    L("c-3A", "Musica", "t-mus-1", 2),
    L("c-3A", "Scienze Motorie", "t-mot-2", 2),
    L("c-3A", "Religione", "t-rel-1", 1),
    L("c-3B", "Italiano", "t-ita-5", 6),
    L("c-3B", "Storia", "t-ita-4", 2),
    L("c-3B", "Geografia", "t-ita-4", 2),
    L("c-3B", "Matematica", "t-mat-2", 4),
    L("c-3B", "Scienze", "t-mat-2", 2),
    L("c-3B", "Inglese", "t-ing-2", 3),
    L("c-3B", "Francese", "t-fra-1", 2),
    L("c-3B", "Tecnologia", "t-tec-1", 2),
    L("c-3B", "Arte e Immagine", "t-art-1", 2),
    L("c-3B", "Musica", "t-mus-1", 2),
    L("c-3B", "Scienze Motorie", "t-mot-1", 2),
    L("c-3B", "Religione", "t-rel-1", 1),
  ];

  const slots = placeLessons(lessons);

  const absences: Absence[] = [
    {
      id: "a-demo-1",
      teacherId: "t-ita-1",
      dateFrom: d(0),
      dateTo: d(0),
      reason: "malattia",
      notes: "Chiamata alle 7:35.",
      allDay: true,
      periodIds: [],
    },
    {
      id: "a-demo-2",
      teacherId: "t-mat-1",
      dateFrom: d(1),
      dateTo: d(1),
      reason: "permesso",
      notes: "Permesso 3 ore.",
      allDay: false,
      periodIds: ["p1", "p2", "p3"],
    },
    {
      id: "a-demo-3",
      teacherId: "t-tec-1",
      dateFrom: d(4),
      dateTo: d(4),
      reason: "formazione",
      notes: "Aggiornamento in ambito.",
      allDay: true,
      periodIds: [],
    },
    {
      id: "a-demo-4",
      teacherId: "t-ing-1",
      dateFrom: d(3),
      dateTo: d(3),
      reason: "visita",
      notes: "",
      allDay: true,
      periodIds: [],
    },
  ];

  return {
    settings: {
      schoolName: DEFAULT_SCHOOL_NAME,
      plesso: "Secondaria di I grado",
      schoolYear: "2026/2027",
      responsabile: "",
      days: DAYS,
      periods: PERIODS,
      tpAfternoon: false,
    },
    teachers,
    classes,
    slots,
    absences,
    substitutions: seedAssignments(slots, d(0)),
    selectedDate: d(0),
    savedAt: 0,
    origin: "seed",
  };
}

function t(
  id: string,
  lastName: string,
  firstName: string,
  subjects: string[],
  weeklyHours: number,
  role: TeacherRole,
  notes = "",
  assignedClassIds: string[] = [],
): Teacher {
  return {
    id,
    lastName,
    firstName,
    subjects,
    weeklyHours,
    role,
    notes,
    color: "", // lo dà la tavolozza (withPaletteColors)
    assignedClassIds,
  };
}

const CORE = new Set(["Italiano", "Matematica", "Inglese", "Francese", "Storia", "Geografia"]);
const AFTERNOONISH = new Set(["Scienze Motorie", "Arte e Immagine", "Musica", "Tecnologia", "Religione"]);

function placeLessons(
  lessons: { classId: string; subject: string; teacherId: string; hours: number }[],
): TimetableSlot[] {
  const teacherBusy = new Set<string>();
  const classBusy = new Set<string>();
  const slots: TimetableSlot[] = [];
  const key = (day: number, periodId: string, who: string) => `${day}-${periodId}-${who}`;

  const remaining = new Map<string, { classId: string; subject: string; teacherId: string }[]>();
  for (const lesson of lessons) {
    const list = remaining.get(lesson.classId) ?? [];
    for (let i = 0; i < lesson.hours; i++) {
      list.push({ classId: lesson.classId, subject: lesson.subject, teacherId: lesson.teacherId });
    }
    remaining.set(lesson.classId, list);
  }

  function teacherHours(teacherId: string, day: DayOfWeek): number[] {
    return PERIODS.filter((p) => teacherBusy.has(key(day, p.id, teacherId))).map((p) => p.index);
  }

  function score(
    item: { classId: string; subject: string; teacherId: string },
    day: DayOfWeek,
    period: (typeof PERIODS)[number],
  ): number {
    if (teacherBusy.has(key(day, period.id, item.teacherId))) return -1;
    if (classBusy.has(key(day, period.id, item.classId))) return -1;
    const hours = teacherHours(item.teacherId, day);
    let s = 0;
    if (hours.length === 0) {
      s = 8 - DAYS.filter((d) => PERIODS.some((p) => teacherBusy.has(key(d, p.id, item.teacherId)))).length;
    } else {
      const first = Math.min(...hours);
      const last = Math.max(...hours);
      s =
        period.index > first && period.index < last
          ? 42
          : period.index === last + 1 || period.index === first - 1
            ? 34
            : period.index === last + 2 || period.index === first - 2
              ? 12
              : 5 - Math.min(Math.abs(period.index - first), Math.abs(period.index - last));
      if (hours.length >= 5) s -= 6;
    }
    const prev = PERIODS.find((p) => p.index === period.index - 1);
    if (
      prev &&
      slots.some(
        (x) =>
          x.day === day &&
          x.periodId === prev.id &&
          x.teacherId === item.teacherId &&
          x.classId === item.classId,
      )
    ) {
      s += 16;
    }
    if (CORE.has(item.subject) && period.index <= 4) s += 4;
    if (AFTERNOONISH.has(item.subject) && period.index >= 4) s += 4;
    return s;
  }

  function bestSlot(item: { classId: string; subject: string; teacherId: string }) {
    let pick: { day: DayOfWeek; periodId: string; score: number } | null = null;
    for (const day of DAYS) {
      for (const period of PERIODS) {
        const sc = score(item, day, period);
        if (sc < 0) continue;
        if (!pick || sc > pick.score) pick = { day, periodId: period.id, score: sc };
      }
    }
    return pick;
  }

  function place(
    item: { classId: string; subject: string; teacherId: string },
    day: DayOfWeek,
    periodId: string,
  ) {
    teacherBusy.add(key(day, periodId, item.teacherId));
    classBusy.add(key(day, periodId, item.classId));
    slots.push({
      id: `slot-${item.classId}-${day}-${periodId}`,
      day,
      periodId,
      classId: item.classId,
      teacherId: item.teacherId,
      subject: item.subject,
    });
  }

  function take(classId: string, teacherId: string, subject: string) {
    const list = remaining.get(classId);
    if (!list) return null;
    const idx = list.findIndex((x) => x.teacherId === teacherId && x.subject === subject);
    if (idx < 0) return null;
    return list.splice(idx, 1)[0] ?? null;
  }

  for (const pin of [
    { classId: "c-1A", subject: "Italiano", teacherId: "t-ita-1", day: 1 as DayOfWeek, periodId: "p1" },
    { classId: "c-1A", subject: "Italiano", teacherId: "t-ita-1", day: 1 as DayOfWeek, periodId: "p2" },
    { classId: "c-1A", subject: "Italiano", teacherId: "t-ita-1", day: 1 as DayOfWeek, periodId: "p3" },
    { classId: "c-1A", subject: "Italiano", teacherId: "t-ita-1", day: 1 as DayOfWeek, periodId: "p4" },
    { classId: "c-2C", subject: "Storia", teacherId: "t-ita-1", day: 1 as DayOfWeek, periodId: "p5" },
    { classId: "c-2C", subject: "Geografia", teacherId: "t-ita-1", day: 1 as DayOfWeek, periodId: "p6" },
  ]) {
    const item = take(pin.classId, pin.teacherId, pin.subject);
    if (item) place(item, pin.day, pin.periodId);
  }

  const classIds = [...remaining.keys()];
  let guard = 0;
  while (guard++ < 400) {
    let placed = false;
    for (const classId of classIds) {
      const list = remaining.get(classId);
      if (!list || list.length === 0) continue;
      let bestIdx = -1;
      let best: { day: DayOfWeek; periodId: string; score: number } | null = null;
      for (let i = 0; i < list.length; i++) {
        const cand = bestSlot(list[i]);
        if (cand && (!best || cand.score > best.score)) {
          best = cand;
          bestIdx = i;
        }
      }
      if (bestIdx < 0 || !best) continue;
      const item = list.splice(bestIdx, 1)[0];
      place(item, best.day, best.periodId);
      placed = true;
    }
    if (!placed) break;
  }

  const leftover = classIds.flatMap((id) => remaining.get(id) ?? []);

  function tryFreeTeacher(teacherId: string, day: DayOfWeek, periodId: string): boolean {
    if (!teacherBusy.has(key(day, periodId, teacherId))) return true;
    const blocking = slots.find((s) => s.day === day && s.periodId === periodId && s.teacherId === teacherId);
    if (!blocking) return true;
    const others = slots.filter((s) => s.classId === blocking.classId && s.id !== blocking.id);
    for (const other of others) {
      if (teacherBusy.has(key(other.day, other.periodId, blocking.teacherId))) continue;
      if (teacherBusy.has(key(day, periodId, other.teacherId))) continue;
      teacherBusy.delete(key(blocking.day, blocking.periodId, blocking.teacherId));
      teacherBusy.delete(key(other.day, other.periodId, other.teacherId));
      const d = blocking.day;
      const p = blocking.periodId;
      blocking.day = other.day;
      blocking.periodId = other.periodId;
      blocking.id = `slot-${blocking.classId}-${blocking.day}-${blocking.periodId}`;
      other.day = d;
      other.periodId = p;
      other.id = `slot-${other.classId}-${other.day}-${other.periodId}`;
      teacherBusy.add(key(blocking.day, blocking.periodId, blocking.teacherId));
      teacherBusy.add(key(other.day, other.periodId, other.teacherId));
      return true;
    }
    return false;
  }

  for (const item of leftover) {
    let done = false;
    for (const day of DAYS) {
      for (const period of PERIODS) {
        if (classBusy.has(key(day, period.id, item.classId))) continue;
        if (!tryFreeTeacher(item.teacherId, day, period.id)) continue;
        if (teacherBusy.has(key(day, period.id, item.teacherId))) continue;
        place(item, day, period.id);
        done = true;
        break;
      }
      if (done) break;
    }
  }

  return slots;
}

function seedAssignments(slots: TimetableSlot[], monday: string): Substitution[] {
  return slots
    .filter((s) => s.teacherId === "t-ita-1" && s.day === 1)
    .map((slot) => {
      const useSostegno = slot.classId === "c-2C";
      return {
        id: `sub-seed-${slot.id}`,
        date: monday,
        periodId: slot.periodId,
        classId: slot.classId,
        absentTeacherId: "t-ita-1",
        substituteId: useSostegno ? "t-sos-5" : null,
        type: useSostegno ? "sostegno" : null,
        activity: "",
        notes: "",
        subject: slot.subject,
      };
    });
}

/** Idempotent: keep user absences/orario; adjust monte ore if needed. */
/**
 * I vecchi «Vorrei» (✓) diventano «Classe → Se possibile → Tutte»: la stessa richiesta, che ora si vede nella
 * casella e si conta nel confronto. Le caselle che hanno già un altro segno restano come sono.
 */
function preferToClassMarks(t: Teacher, data: PersistedData): Teacher {
  const rows = Array.isArray(t.cardRows)
    ? t.cardRows.filter((r) => r.hours > 0)
    : (data.cattedre ?? []).filter((c) => c.teacherId === t.id && c.hours > 0);
  const classIds = [...new Set([...rows.map((r) => r.classId), ...(rows.length ? [] : (t.assignedClassIds ?? []))])].filter(
    (id) => data.classes.some((c) => c.id === id),
  );
  const seen = new Set(
    [...(t.awaySlots ?? []), ...(t.avoidSlots ?? []), ...(t.mustSlots ?? [])].map((a) => `${a.day}|${a.periodId}`),
  );
  const added: NonNullable<Teacher["mustSlots"]> = [];
  for (const a of t.preferSlots ?? []) {
    const key = `${a.day}|${a.periodId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ day: a.day, periodId: a.periodId, classIds, allClasses: true, level: "preferenza" });
  }
  return { ...t, preferSlots: undefined, mustSlots: [...(t.mustSlots ?? []), ...added] };
}

export function applyOrganicoFixes(data: PersistedData): PersistedData {
  let teachers = [...data.teachers];
  const slots = [...data.slots];

  teachers = teachers.map((x) => {
    if (x.role === "sostegno") return x;
    if ((x.weeklyHours ?? 0) > 0) return x;
    const hours = slots.filter((s) => s.teacherId === x.id).length;
    return hours > 0 ? { ...x, weeklyHours: hours } : x;
  });
  teachers = teachers.map((x) => (x.preferSlots?.length ? preferToClassMarks(x, data) : x));
  teachers = withPaletteColors(teachers);

  let settings = data.settings;
  const ore = settings?.monteOre;
  if (ore?.some((r) => /educazione civica/i.test(r.subject))) {
    const civica = ore.find((r) => /educazione civica/i.test(r.subject));
    const next = ore
      .filter((r) => !/educazione civica/i.test(r.subject))
      .map((r) =>
        r.subject === "Geografia"
          ? { ...r, hours: Math.max(r.hours + (civica?.hours ?? 0), 2) }
          : r,
      );
    if (!next.some((r) => r.subject === "Geografia")) {
      next.splice(2, 0, { subject: "Geografia", hours: 2 });
    }
    settings = { ...settings, monteOre: next };
  }

  return { ...data, settings, teachers, slots };
}

export const EMPTY_DATA: PersistedData = {
  settings: {
    schoolName: DEFAULT_SCHOOL_NAME,
    plesso: "Secondaria di I grado",
    schoolYear: "2026/2027",
    responsabile: "",
    days: DAYS,
    periods: PERIODS,
    tpAfternoon: false,
  },
  teachers: [],
  classes: [],
  slots: [],
  absences: [],
  substitutions: [],
  selectedDate: iso(new Date()),
  savedAt: 0,
  origin: "user",
};
