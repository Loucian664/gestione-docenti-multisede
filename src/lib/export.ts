import { eachIsoInRange, formatDayMonth, formatDayName, formatItDate, formatItFileDate, formatLong, isWeekend, toSchoolDay } from "./dates";
import { coverageNeeds, isCovered, isShiftType, classShifts, eccedenteLines, teacherName, teacherSurname, absencesByReason, absencesOnDate, type CoverageNeed, type ClassShift } from "./coverage";
import { allTeachers, findAnyTeacher } from "./replace-teacher";
import type { PersistedData, SubstitutionType } from "./types";
import { ABSENCE_REASONS, SUBSTITUTION_TYPES } from "./types";
import { classTimetableSheet, XLSX_S } from "./class-grid";
import { trialFileTag } from "./saved-timetables";
import { xlsxFile, xlsxSpecFile, xlsxWorkbookFile, XLSX_GRID_DAY, XLSX_GRID_TEXT, type XlsxCellInput } from "./xlsx";
import { jpegBlobToPdf, jpegsToPdf } from "./pdf";
import { orarioTeacherJpeg, teachersOnTimetable, eccedenteJpegs } from "./sheet-image";
import { teacherPdfFileName } from "./teacher-print";
import { zipFile } from "./zip";

function typeLabel(t: SubstitutionType | null, short = false): string {
  if (!t || isShiftType(t)) return "";
  const row = SUBSTITUTION_TYPES.find((x) => x.value === t);
  if (!row) return t;
  return short ? row.short : row.label;
}

function shiftPhrase(data: PersistedData, date: string, key: string): string {
  const shift = classShifts(data, date).find((s) => s.applied && s.needs.some((n) => n.key === key));
  return shift?.phrase ?? "";
}

/** Nome scuola per i file: «Rombiolo», senza caratteri che i sistemi non accettano. */
export function schoolFileTag(name: string): string {
  const tag = name
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return tag || "scuola";
}

export function orarioDownloadName(schoolName: string, stem: string, ext: string): string {
  return `${stem}-${schoolFileTag(schoolName)}.${ext}`;
}

function findTeacher(data: PersistedData, id: string | null) {
  // anche chi non è più in servizio: assenze e coperture dei giorni passati
  return findAnyTeacher(data, id) ?? null;
}

function findClass(data: PersistedData, id: string) {
  return data.classes.find((c) => c.id === id) ?? null;
}

function findPeriod(data: PersistedData, id: string) {
  return data.settings.periods.find((p) => p.id === id) ?? null;
}

export function substitutionsXlsx(data: PersistedData, date: string): File {
  const needs = coverageNeeds(data, date);
  const rows: (string | number)[][] = [
    ["Data", "Ora", "Classe", "Materia", "Assente", "Motivo", "Sostituto", "Tipo", "Note"],
  ];
  for (const n of needs) {
    const period = findPeriod(data, n.slot.periodId);
    const cls = findClass(data, n.slot.classId);
    const absent = findTeacher(data, n.absence.teacherId);
    const sub = findTeacher(data, n.substitution?.substituteId ?? null);
    const reason = ABSENCE_REASONS.find((r) => r.value === n.absence.reason)?.label ?? "";
    rows.push([
      formatItDate(n.date),
      period?.label ?? "",
      cls?.name ?? "",
      n.slot.subject,
      absent ? teacherSurname(absent, allTeachers(data)) : "",
      reason,
      n.substitution?.type === "divisione" ? "(classe divisa)" : sub ? teacherSurname(sub, allTeachers(data)) : "",
      shiftPhrase(data, date, n.key) || typeLabel(n.substitution?.type ?? null),
      n.substitution?.notes ?? "",
    ]);
  }
  return xlsxFile(`sostituzioni-${formatItFileDate(date)}.xlsx`, rows, "Sostituzioni");
}

function roundHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const hour = Math.round((h * 60 + m) / 60);
  return `${String(hour).padStart(2, "0")}:00`;
}

function assemblyPeriods(data: PersistedData, date: string) {
  const marked = absencesOnDate(data, date).filter((a) => a.reason === "assemblea_sindacale");
  const ids = new Set<string>();
  for (const absence of marked) {
    const chosen = absence.allDay || absence.periodIds.length === 0 ? data.settings.periods.map((p) => p.id) : absence.periodIds;
    for (const id of chosen) ids.add(id);
  }
  return data.settings.periods.filter((p) => ids.has(p.id)).sort((a, b) => a.index - b.index);
}

function schoolLine(data: PersistedData): string {
  const name = data.settings.schoolName.trim();
  const plesso = data.settings.plesso.trim();
  if (/secondaria/i.test(plesso) && name) return `Scuola Secondaria di ${name}`;
  if (name && plesso && plesso !== name) return `${plesso} di ${name}`;
  return name || plesso;
}

function shiftClock(data: PersistedData, date: string, shift: ClassShift): { kind: ClassShift["kind"]; code: string; time: string | null } | null {
  const day = toSchoolDay(date);
  const cls = data.classes.find((c) => c.id === shift.classId);
  const code = classCode(cls?.name ?? "");
  if (!code) return null;
  if (!day || shift.kind === "non_entra") return { kind: "non_entra", code, time: null };
  const periods = data.settings.periods
    .filter((p) => data.slots.some((s) => s.day === day && s.classId === shift.classId && s.periodId === p.id))
    .sort((a, b) => a.index - b.index);
  const skipped = new Set(shift.needs.map((n) => n.slot.periodId));
  if (shift.kind === "entra") {
    const lastSkipped = Math.max(...periods.filter((p) => skipped.has(p.id)).map((p) => p.index));
    const entry = periods.find((p) => p.index > lastSkipped);
    return entry ? { kind: "entra", code, time: roundHour(entry.start) } : null;
  }
  const firstSkipped = Math.min(...periods.filter((p) => skipped.has(p.id)).map((p) => p.index));
  const kept = [...periods].reverse().find((p) => p.index < firstSkipped);
  return kept ? { kind: "esce", code, time: roundHour(kept.end) } : null;
}

function groupedTimes(rows: { code: string; time: string }[]): string[] {
  const byTime = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTime.get(row.time) ?? [];
    list.push(row.code);
    byTime.set(row.time, list);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, codes]) => `${codes.sort((a, b) => a.localeCompare(b, "it")).join(", ")}: ${time}`);
}

/** Testo breve per il dirigente: solo assemblea, orari arrotondati all’ora. */
export function assemblySummary(data: PersistedData, date: string): string | null {
  const marked = absencesOnDate(data, date).filter((a) => a.reason === "assemblea_sindacale");
  if (marked.length === 0) return null;
  const periods = assemblyPeriods(data, date);
  if (periods.length === 0) return null;
  const names = [
    ...new Set(
      marked
        .map((a) => findAnyTeacher(data, a.teacherId))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => teacherSurname(t, allTeachers(data))),
    ),
  ].sort((a, b) => a.localeCompare(b, "it"));
  const clocks = classShifts(data, date)
    .map((shift) => shiftClock(data, date, shift))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const list = names.join(", ");
  const namesLine = list.endsWith(".") ? list : `${list}.`;
  const day = formatDayMonth(date);
  const dated = day.charAt(0).toLocaleUpperCase("it-IT") + day.slice(1);
  const lines = [
    "Assemblea sindacale",
    schoolLine(data),
    `${dated}, ${roundHour(periods[0].start)}-${roundHour(periods[periods.length - 1].end)}`,
    "",
    "Aderiscono:",
    namesLine,
  ];
  const entra = groupedTimes(clocks.filter((row) => row.kind === "entra" && row.time).map((row) => ({ code: row.code, time: row.time! })));
  const esce = groupedTimes(clocks.filter((row) => row.kind === "esce" && row.time).map((row) => ({ code: row.code, time: row.time! })));
  const assenti = clocks.filter((row) => row.kind === "non_entra").map((row) => row.code);
  if (entra.length > 0) lines.push("", "Ingresso posticipato:", ...entra);
  if (esce.length > 0) lines.push("", "Uscita anticipata:", ...esce);
  if (assenti.length > 0) lines.push("", "Non entra:", assenti.sort((a, b) => a.localeCompare(b, "it")).join(", "));
  const dayNum = toSchoolDay(date);
  const opening = roundHour([...data.settings.periods].sort((a, b) => a.index - b.index)[0]?.start ?? "08:00");
  const delayed = new Set(clocks.filter((row) => row.kind === "entra" || row.kind === "non_entra").map((row) => row.code));
  const inSchool = new Set(
    data.slots
      .filter((slot) => slot.day === dayNum)
      .map((slot) => classCode(data.classes.find((c) => c.id === slot.classId)?.name ?? ""))
      .filter(Boolean),
  );
  if (entra.length > 0 && [...inSchool].some((code) => !delayed.has(code))) {
    lines.push(`Le altre classi entreranno regolarmente alle ore ${opening}.`);
  }
  return lines.join("\n");
}

export function absencesRangeXlsx(data: PersistedData, from: string, to: string): File {
  const header = ["Data", "Giorno", "Ora", "Classe", "Assente", "Motivo", "Sostituto", "Tipo", "Note assenza", "Stato"].map(
    (v) => ({ v, s: XLSX_S.th }),
  );
  const rows: XlsxCellInput[][] = [header];
  const merges: string[] = [];
  let previous = "";
  let blockStart = 0;
  const closeBlock = (end: number) => {
    if (blockStart > 0 && end > blockStart) {
      merges.push(`A${blockStart}:A${end}`, `B${blockStart}:B${end}`);
    }
  };
  for (const date of eachIsoInRange(from, to)) {
    if (isWeekend(date, data.settings.days)) continue;
    for (const n of coverageNeeds(data, date)) {
      const period = findPeriod(data, n.slot.periodId);
      const cls = findClass(data, n.slot.classId);
      const absent = findTeacher(data, n.absence.teacherId);
      const sub = findTeacher(data, n.substitution?.substituteId ?? null);
      const reason = ABSENCE_REASONS.find((r) => r.value === n.absence.reason)?.label ?? "";
      const phrase = shiftPhrase(data, date, n.key);
      const stato =
        n.substitution?.type === "divisione" ? "Classe divisa" : phrase || (isCovered(n) ? "Coperta" : "Scoperta");
      const dayStart = n.date !== previous;
      if (dayStart) {
        closeBlock(rows.length);
        blockStart = rows.length + 1;
        previous = n.date;
      }
      const values = [
        dayStart ? formatItDate(n.date) : "",
        dayStart ? formatDayName(n.date).toLocaleUpperCase("it-IT") : "",
        period?.label ?? "",
        classCode(cls?.name ?? ""),
        absent ? teacherSurname(absent, allTeachers(data)) : "",
        reason,
        n.substitution?.type === "divisione" ? "classe divisa" : sub ? teacherSurname(sub, allTeachers(data)) : "",
        phrase ? "" : typeLabel(n.substitution?.type ?? null, true),
        n.absence.notes ?? "",
        stato,
      ];
      rows.push(values.map((v, i) => ({ v, s: i < 2 ? XLSX_GRID_DAY : XLSX_GRID_TEXT })));
    }
  }
  closeBlock(rows.length);
  return xlsxSpecFile(`assenze-${formatItFileDate(from)}-${formatItFileDate(to)}.xlsx`, {
    rows,
    sheetName: "Assenze",
    merges,
    headerRow: false,
    freezeRow: 1,
    autoFilter: false,
    colWidths: [14, 16, 12, 10, 24, 22, 18, 10, 18, 16],
    rowHeights: rows.map((_, i) => (i === 0 ? 22 : 18)),
  });
}

export function absencesRangeText(data: PersistedData, from: string, to: string): string {
  const lines: string[] = [];
  lines.push("ASSENZE");
  lines.push(`${data.settings.schoolName} - ${data.settings.schoolYear}`);
  lines.push(`Dal ${formatItDate(from)} al ${formatItDate(to)}`);
  lines.push("");
  let count = 0;
  for (const date of eachIsoInRange(from, to)) {
    if (isWeekend(date, data.settings.days)) continue;
    const needs = coverageNeeds(data, date);
    if (needs.length === 0) continue;
    lines.push(dailySheetText(data, date, needs));
    lines.push("");
    count += needs.length;
  }
  if (count === 0) lines.push("Nessuna assenza nel periodo selezionato.");
  return lines.join("\n");
}

export function reportXlsx(
  data: PersistedData,
  from: string,
  to: string,
  loads: {
    teacherId: string;
    disposizione: number;
    potenziamento: number;
    recupero: number;
    eccedente: number;
    sostegno: number;
    altro: number;
    total: number;
  }[],
): File {
  const rows: (string | number)[][] = [
    ["Docente", "Disposizione", "Potenziamento", "Recupero", "Eccedenti", "Sostegno", "Altro", "Totale"],
  ];
  for (const row of loads) {
    const t = findTeacher(data, row.teacherId);
    rows.push([
      t ? teacherName(t) : row.teacherId,
      row.disposizione,
      row.potenziamento,
      row.recupero,
      row.eccedente,
      row.sostegno,
      row.altro,
      row.total,
    ]);
  }
  rows.push([]);
  rows.push(["Assenze per motivo (giorni scolastici)"]);
  rows.push(["Docente", ...ABSENCE_REASONS.map((r) => r.label), "Totale"]);
  for (const row of absencesByReason(data, from, to).filter((r) => r.total > 0)) {
    const t = findTeacher(data, row.teacherId);
    rows.push([
      t ? teacherName(t) : row.teacherId,
      ...ABSENCE_REASONS.map((r) => row.byReason[r.value]),
      row.total,
    ]);
  }
  return xlsxFile(`report-sostituzioni-${from}-${to}.xlsx`, rows, "Monte ore");
}

function eccedenteHeading(data: PersistedData): [string, string, string] {
  const name = data.settings.schoolName.trim();
  const kind = data.settings.plesso.trim();
  const raw = data.settings.schoolYear.trim();
  const year = raw ? (/a\.?\s*s\.?/i.test(raw) ? raw : `a.s. ${raw}`) : "";
  const yearLine = kind && year ? `${kind}  ·  ${year}` : kind || year;
  return [name ? `Plesso di ${name}` : "Plesso", "ORE ECCEDENTI", yearLine];
}

export function eccedenteXlsx(data: PersistedData, from: string, to: string): File {
  const lines = eccedenteLines(data, from, to);
  const span = (text: string, s: number): XlsxCellInput[] => [
    { v: text, s },
    { v: "", s },
    { v: "", s },
    { v: "", s },
    { v: "", s },
    { v: "", s },
  ];
  const [kicker, title, year] = eccedenteHeading(data);
  const sheet: XlsxCellInput[][] = [
    span(kicker, XLSX_S.kicker),
    span(title, XLSX_S.title),
    span(year, XLSX_S.year),
    ["Data", "Docente", "Classe", "Ora", "Dalle", "Alle"].map((v) => ({ v, s: XLSX_S.th })),
  ];
  if (lines.length === 0) {
    sheet.push(span("Nessuna ora eccedente.", XLSX_S.body));
  } else {
    for (const line of lines) {
      sheet.push(
        [formatItDate(line.date), line.teacher, line.className, line.hour, line.from, line.to].map((v) => ({
          v,
          s: XLSX_S.body,
        })),
      );
    }
  }
  return xlsxSpecFile(orarioDownloadName(data.settings.schoolName, "ore-eccedenti", "xlsx"), {
    rows: sheet,
    merges: ["A1:F1", "A2:F2", "A3:F3", ...(lines.length === 0 ? ["A5:F5"] : [])],
    sheetName: "Ore eccedenti",
    headerRow: false,
    freezeRow: 4,
    colWidths: [16, 32, 14, 10, 12, 12],
    rowHeights: [18, 22, 16, 22, ...lines.map(() => 18)],
    landscape: true,
  });
}

export async function eccedentePdf(data: PersistedData, from: string, to: string): Promise<Blob> {
  const pages = await eccedenteJpegs(data, from, to);
  const images = await Promise.all(
    pages.map(async (page) => ({ jpeg: new Uint8Array(await page.blob.arrayBuffer()), w: page.w, h: page.h })),
  );
  return jpegsToPdf(images);
}

export function timetableXlsx(data: PersistedData): File {
  const toSpec = (mode: "cognomi" | "materie", sheetName: string) => {
    const grid = classTimetableSheet(data, mode);
    return {
      rows: grid.rows,
      sheetName,
      merges: grid.merges,
      colWidths: grid.colWidths,
      rowHeights: grid.rowHeights,
      freezeRow: grid.freezeRow,
      freezeCol: grid.freezeCol,
      autoFilter: false,
      headerRow: false,
      landscape: true,
    };
  };
  return xlsxWorkbookFile(orarioDownloadName(data.settings.schoolName, `orario${trialFileTag(data)}`, "xlsx"), [
    toSpec("cognomi", "Cognomi"),
    toSpec("materie", "Materie"),
  ]);
}

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function classCode(name: string): string {
  return name.replace(/ª\s*/g, "").replace(/\s+/g, "");
}

export function dailySheetHeading(date: string): string {
  return formatLong(date).toLocaleUpperCase("it-IT");
}

function withAssembly(name: string, reason: string | undefined): string {
  return reason === "assemblea_sindacale" ? `${name} (assemblea)` : name;
}

function dailySheetBody(data: PersistedData, date: string, needs: CoverageNeed[]): string[] {
  const lines: string[] = [];

  if (needs.length === 0) {
    lines.push("Nessuna sostituzione.");
    return lines;
  }

  const applied = classShifts(data, date).filter((s) => s.applied);
  const taken = new Set(applied.flatMap((s) => s.needs.map((n) => n.key)));

  const rows = needs
    .filter((n) => !taken.has(n.key))
    .map((n) => {
      const period = findPeriod(data, n.slot.periodId);
      const cls = findClass(data, n.slot.classId);
      const absent = findTeacher(data, n.absence.teacherId);
      const sub = findTeacher(data, n.substitution?.substituteId ?? null);
      let who = "DA COPRIRE";
      if (n.substitution?.type === "divisione") who = "classe divisa";
      else if (sub) who = teacherSurname(sub, allTeachers(data));
      const tipo =
        n.substitution?.type && n.substitution.type !== "divisione"
          ? typeLabel(n.substitution.type, true)
          : "";
      return {
        shift: false,
        sort: period?.index ?? 0,
        ora: (period?.label ?? n.slot.periodId).toUpperCase(),
        cls: classCode(cls?.name ?? "?"),
        absent: withAssembly(absent ? teacherSurname(absent, allTeachers(data)) : "?", n.absence.reason),
        tail: `copre ${who}${tipo ? ` (${tipo})` : ""}`,
      };
    });

  for (const shift of applied) {
    const cls = findClass(data, shift.classId);
    const periods = [...new Set(shift.needs.map((n) => n.slot.periodId))]
      .map((id) => findPeriod(data, id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .sort((a, b) => a.index - b.index);
    const marks = periods.map((p) => periodMark(p.label));
    const ora = marks.length <= 1 ? (marks[0] ?? "") : `${marks[0]}–${marks[marks.length - 1]}`;
    const people = new Map<string, { name: string; reason: string }>();
    for (const n of shift.needs) {
      const t = findTeacher(data, n.absence.teacherId);
      if (!people.has(n.absence.teacherId)) {
        people.set(n.absence.teacherId, {
          name: t ? teacherSurname(t, allTeachers(data)) : "?",
          reason: n.absence.reason,
        });
      }
    }
    const absent = [...people.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "it"))
      .map((p) => withAssembly(p.name, p.reason))
      .join(", ");
    rows.push({
      shift: true,
      sort: periods[0]?.index ?? 0,
      ora,
      cls: classCode(cls?.name ?? "?"),
      absent,
      tail: shift.phrase,
    });
  }

  rows.sort((a, b) => a.sort - b.sort || a.cls.localeCompare(b.cls, "it"));
  const oraW = Math.max(...rows.map((r) => r.ora.length));
  const clsW = Math.max(...rows.map((r) => r.cls.length));
  const absW = Math.max(...rows.map((r) => r.absent.length));
  const format = (r: (typeof rows)[number]) =>
    `${padEnd(r.ora, oraW)}  -  ${padEnd(r.cls, clsW)}  |  assente ${padEnd(r.absent, absW)}  |  ${r.tail}`;
  const varied = rows.filter((r) => r.shift);
  const rest = rows.filter((r) => !r.shift);
  for (const r of varied) lines.push(format(r));
  if (varied.length > 0 && rest.length > 0) lines.push("");
  for (const r of rest) lines.push(format(r));
  return lines;
}

function periodMark(label: string): string {
  return label.match(/\d+ª/)?.[0] ?? label;
}

export function dailySheetText(data: PersistedData, date: string, needs: CoverageNeed[]): string {
  return [dailySheetHeading(date), ...dailySheetBody(data, date, needs)].join("\n");
}

const BOLD_ACCENT: Record<string, string> = {
  "\u00c0": String.fromCodePoint(0x1d5d4) + "\u0300",
  "\u00c8": String.fromCodePoint(0x1d5d8) + "\u0300",
  "\u00c9": String.fromCodePoint(0x1d5d8) + "\u0301",
  "\u00cc": String.fromCodePoint(0x1d5dc) + "\u0300",
  "\u00d2": String.fromCodePoint(0x1d5e2) + "\u0300",
  "\u00d9": String.fromCodePoint(0x1d5e8) + "\u0300",
};

/** Grassetto visibile anche dove si incolla solo testo (Note di Apple). */
export function toPlainBold(s: string): string {
  let out = "";
  for (const ch of s) {
    if (BOLD_ACCENT[ch]) {
      out += BOLD_ACCENT[ch];
      continue;
    }
    if (ch >= "A" && ch <= "Z") {
      out += String.fromCodePoint(0x1d5d4 + (ch.charCodeAt(0) - 65));
      continue;
    }
    if (ch >= "a" && ch <= "z") {
      out += String.fromCodePoint(0x1d5ee + (ch.charCodeAt(0) - 97));
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      out += String.fromCodePoint(0x1d7ec + (ch.charCodeAt(0) - 48));
      continue;
    }
    out += ch;
  }
  return out;
}

export function dailySheetCopyPlain(data: PersistedData, date: string, needs: CoverageNeed[]): string {
  return [toPlainBold(dailySheetHeading(date)), ...dailySheetBody(data, date, needs)].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function dailySheetHtml(data: PersistedData, date: string, needs: CoverageNeed[]): string {
  const heading = escapeHtml(dailySheetHeading(date));
  const rows = dailySheetBody(data, date, needs)
    .map((line) => `<div>${escapeHtml(line) || "&nbsp;"}</div>`)
    .join("");
  return `<b>${heading}</b>${rows}`;
}

export function backupJson(data: PersistedData): string {
  return JSON.stringify({ ...data, savedAt: data.savedAt || Date.now(), origin: "user" }, null, 2);
}

export function parseBackupJson(raw: string): PersistedData {
  const parsed = JSON.parse(raw) as PersistedData & { state?: PersistedData };
  const data = !parsed.settings && parsed.state ? parsed.state : parsed;
  if (!data.settings || !Array.isArray(data.teachers) || !Array.isArray(data.classes)) {
    throw new Error("file non valido");
  }
  // un backup senza orario, assenze o sostituzioni (molto vecchio o modificato a mano) si apre con quelle parti vuote
  const lists = <T extends { slots?: unknown; absences?: unknown; substitutions?: unknown }>(x: T): T => ({
    ...x,
    slots: Array.isArray(x.slots) ? x.slots : [],
    absences: Array.isArray(x.absences) ? x.absences : [],
    substitutions: Array.isArray(x.substitutions) ? x.substitutions : [],
  });
  return {
    ...lists(data),
    ...(Array.isArray(data.altreSedi)
      ? { altreSedi: data.altreSedi.filter((a) => a?.data).map((a) => ({ ...a, data: lists(a.data) })) }
      : {}),
  };
}

export async function docentiPdfZip(data: PersistedData): Promise<File> {
  const teachers = teachersOnTimetable(data);
  if (teachers.length === 0) throw new Error("nessun docente in orario");
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const t of teachers) {
    const jpeg = await orarioTeacherJpeg(data, t.id);
    const pdf = await jpegBlobToPdf(jpeg);
    entries.push({
      name: teacherPdfFileName(t),
      data: new Uint8Array(await pdf.arrayBuffer()),
    });
  }
  return zipFile(orarioDownloadName(data.settings.schoolName, `orari-docenti${trialFileTag(data)}`, "zip"), entries);
}
