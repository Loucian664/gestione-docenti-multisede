import { cellSlots, classLessonSlots, isDispHour } from "./coverage";
import { hourMark, isMensaLesson, isMensaPeriod, isRestrictedTpPeriod, visiblePeriods } from "./periods";
import { teacherSheetName } from "./teacher-print";
import { trialLabel } from "./saved-timetables";
import { mergedUpper } from "./subject-groups";
import {
  dayNameUpper,
  type DayOfWeek,
  type PersistedData,
  type Period,
  type SchoolClass,
  type Teacher,
  type TimetableSlot,
} from "./types";

export const XLSX_S = {
  title: 2,
  kicker: 3,
  year: 3,
  th: 4,
  day: 5,
  hour: 6,
  body: 7,
  disp: 7,
  ink: 9,
} as const;

export type GridCell = { v: string | number | null; s: number };

export type ClassSheetMode = "cognomi" | "materie";

export type ClassTimetableSheet = {
  rows: GridCell[][];
  merges: string[];
  colWidths: number[];
  rowHeights: number[];
  freezeRow: number;
  freezeCol: number;
};

const SCHOOL_SUBJECT: Record<string, string> = {
  Italiano: "ITALIANO",
  Storia: "STORIA",
  Geografia: "GEOGRAFIA",
  Matematica: "MATEMATICA",
  Scienze: "SCIENZE",
  Inglese: "INGLESE",
  Francese: "FRANCESE",
  Spagnolo: "SPAGNOLO",
  Tecnologia: "TECNOLOGIA",
  "Arte e Immagine": "ARTE",
  Musica: "MUSICA",
  "Scienze Motorie": "SC. MOT",
  Religione: "RELIGIONE",
  "Educazione civica": "CIVICA",
  Altro: "ALTRO",
  Mensa: "MENSA",
  Laboratorio: "LABORATORIO",
  Latino: "LATINO",
};

function schoolSubjectLabel(subject: string): string {
  return SCHOOL_SUBJECT[subject] ?? mergedUpper(subject) ?? subject.toUpperCase();
}

export function classOrder(data: PersistedData): SchoolClass[] {
  return [...data.classes].sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section));
}

export function classHeader(c: { grade: number; section: string }): string {
  return `${c.grade}${c.section}`;
}

function periodsOnDay(data: PersistedData, day: DayOfWeek): Period[] {
  return visiblePeriods(data.settings).filter((p) => {
    if (!p.tpOnly) return true;
    if (data.slots.some((s) => s.day === day && s.periodId === p.id)) return true;
    return data.teachers.some((t) => isDispHour(t, day, p.id));
  });
}

function dispNamesAt(data: PersistedData, day: DayOfWeek, periodId: string): string[] {
  return data.teachers
    .filter((t) => t.role !== "sostegno" && t.role !== "potenziamento")
    .filter((t) => isDispHour(t, day, periodId))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it"))
    .map((t) => teacherSheetName(t, data.teachers));
}

function plessoHeading(data: PersistedData): string {
  const name = (data.settings.schoolName || "").trim();
  return name ? `Plesso di ${name}` : "Plesso";
}

function asYearLine(data: PersistedData): string {
  const kind = (data.settings.plesso || "").trim();
  const raw = (data.settings.schoolYear || "").trim();
  const year = raw ? (/a\.?\s*s\.?/i.test(raw) ? raw : `a.s. ${raw}`) : "";
  if (kind && year) return `${kind}  ·  ${year}`;
  return kind || year;
}

/**
 * La lezione da scrivere nella casella di una classe, o «MENSA». Il sostegno non c'è mai: ha le sue
 * colonne, e la casella si legge come se non ci fosse.
 */
export function classCellLesson(
  data: PersistedData,
  classId: string,
  day: DayOfWeek,
  period: Period,
): TimetableSlot | "MENSA" | null {
  const lessons = classLessonSlots(data, classId, day, period.id);
  if (isMensaPeriod(period)) {
    const here = lessons.length ? lessons : cellSlots(data, classId, day, period.id);
    if (here.length > 0 && here.every((s) => isMensaLesson(s))) return "MENSA";
  }
  return lessons[0] ?? null;
}

function classCell(
  data: PersistedData,
  cls: SchoolClass,
  day: DayOfWeek,
  period: Period,
  mode: ClassSheetMode,
): string {
  if (isRestrictedTpPeriod(period) && cls.tempo !== "TP") return "";
  const lesson = classCellLesson(data, cls.id, day, period);
  if (lesson === "MENSA") return "MENSA";
  if (!lesson) return "";
  if (mode === "materie") return schoolSubjectLabel(lesson.subject);
  const t = data.teachers.find((x) => x.id === lesson.teacherId);
  return t ? teacherSheetName(t, data.teachers) : "";
}

function teachersByRole(data: PersistedData, role: "sostegno" | "potenziamento"): Teacher[] {
  return data.teachers
    .filter((t) => t.role === role)
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it"));
}

function classLabels(data: PersistedData, ids: string[]): string[] {
  const want = new Set(ids);
  return classOrder(data)
    .filter((c) => want.has(c.id))
    .map(classHeader);
}

/** Sostegno in sede: la classe di quell'ora (o `3B+` se sono due). Potenziamento: riquadro pieno. */
export function sideMark(
  data: PersistedData,
  teacherId: string,
  day: DayOfWeek,
  periodId: string,
): string | "block" | null {
  const teacher = data.teachers.find((t) => t.id === teacherId);
  if (!teacher) return null;
  if (teacher.role !== "sostegno" && teacher.role !== "potenziamento") return null;
  if (teacher.awaySlots?.some((s) => s.day === day && s.periodId === periodId)) return null;
  const fromSlots = classLabels(
    data,
    data.slots
      .filter((s) => s.teacherId === teacherId && s.day === day && s.periodId === periodId)
      .map((s) => s.classId),
  );
  const onSite = fromSlots.length > 0 || isDispHour(teacher, day, periodId);
  if (!onSite) return null;
  if (teacher.role !== "sostegno") return "block";
  const labels = fromSlots.length ? fromSlots : classLabels(data, teacher.assignedClassIds ?? []);
  if (labels.length === 0) return "block";
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]}+`;
}

function dispCell(data: PersistedData, day: DayOfWeek, periodId: string, mode: ClassSheetMode): string {
  const names = dispNamesAt(data, day, periodId);
  if (!names.length) return "";
  return mode === "materie" ? "X" : names.join(" / ");
}

function colRef(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cell(v: string | number | null, s: number): GridCell {
  return { v, s };
}

function emptyRow(width: number, s: number): GridCell[] {
  return Array.from({ length: width }, () => cell("", s));
}

/** Griglia Excel: giorni in riga, classi in colonna. `cognomi` o `materie`. */
export function classTimetableSheet(
  data: PersistedData,
  mode: ClassSheetMode = "cognomi",
): ClassTimetableSheet {
  const classes = classOrder(data);
  const days = data.settings.days;
  const periodsByDay = days.map((d) => periodsOnDay(data, d));
  const side = [...teachersByRole(data, "sostegno"), ...teachersByRole(data, "potenziamento")];
  const width = 2 + classes.length + 1 + side.length;
  const lastCol = colRef(width - 1);

  const rows: GridCell[][] = [];
  const merges: string[] = [];
  const rowHeights: number[] = [];

  const titleRow = (text: string, s: number, h: number) => {
    const row = emptyRow(width, s);
    row[0] = cell(text, s);
    rows.push(row);
    rowHeights.push(h);
    merges.push(`A${rows.length}:${lastCol}${rows.length}`);
  };

  titleRow(plessoHeading(data), XLSX_S.kicker, 18);
  const trial = trialLabel(data);
  titleRow(`ORARIO SETTIMANALE DELLE LEZIONI${trial ? ` · ${trial}` : ""}`, XLSX_S.title, 22);
  titleRow(asYearLine(data), XLSX_S.year, 16);

  const header: GridCell[] = [
    cell("", XLSX_S.th),
    cell("H", XLSX_S.th),
    ...classes.map((c) => cell(classHeader(c), XLSX_S.th)),
    cell("Ore a disposizione", XLSX_S.th),
    ...side.map((t) =>
      cell(
        mode === "materie" ? (t.role === "sostegno" ? "SOSTEGNO" : "POTENZIAMENTO") : teacherSheetName(t, data.teachers),
        XLSX_S.day,
      ),
    ),
  ];
  rows.push(header);
  rowHeights.push(side.length ? 72 : 28);
  const headerRow = rows.length;
  merges.push(`A${headerRow}:B${headerRow}`);

  days.forEach((day, di) => {
    const periods = periodsByDay[di] ?? [];
    if (periods.length === 0) return;
    const start = rows.length + 1;
    periods.forEach((p, pi) => {
      const row: GridCell[] = [
        cell(pi === 0 ? dayNameUpper(day) : "", XLSX_S.day),
        cell(hourMark(p), XLSX_S.hour),
      ];
      for (const c of classes) row.push(cell(classCell(data, c, day, p, mode), XLSX_S.body));
      row.push(cell(dispCell(data, day, p.id, mode), XLSX_S.disp));
      for (const t of side) {
        const mark = sideMark(data, t.id, day, p.id);
        if (mark === "block") row.push(cell("", XLSX_S.ink));
        else row.push(cell(mark ?? "", XLSX_S.body));
      }
      rows.push(row);
      rowHeights.push(18);
    });
    const end = rows.length;
    if (end > start) merges.push(`A${start}:A${end}`);
  });

  const colWidths = [3.5, 4, ...classes.map(() => 12), 22, ...side.map(() => 5.5)];

  return {
    rows,
    merges,
    colWidths,
    rowHeights,
    freezeRow: headerRow,
    freezeCol: 2,
  };
}
