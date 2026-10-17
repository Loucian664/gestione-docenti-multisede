import {
  classCellSlots,
  coverageNeeds,
  isCovered,
  isDispHour,
  isSostegnoSlot,
  classShifts,
  loadByTeacher,
  absencesByReason,
  eccedenteLines,
  teacherDayWindow,
  teacherName,
  teacherShort,
  teacherSurname,
  teacherSlotAt,
} from "./coverage";
import { formatItDate, formatLong } from "./dates";
import { ABSENCE_REASONS, dayNameUpper, DAY_SHORT, SUBSTITUTION_TYPES, type DayOfWeek, type PersistedData } from "./types";
import { hourMark, isMensaLesson, isMensaPeriod, isRestrictedTpPeriod, visiblePeriods } from "./periods";
import { teacherSheetName } from "./teacher-print";
import { classCellLesson, sideMark } from "./class-grid";
import { trialLabel } from "./saved-timetables";
import { mergedAbbr, mergedUpper } from "./subject-groups";


const PAPER = "#F3EFE6";
const INK = "#1C1915";
const GREEN = "#1F4A3C";
const CREAM = "#F4EFE4";
const MUTED = "#6B6458";
const LINE = "#D8CFC0";
const SHEET_DPR = 3;
const JPEG_Q = 0.95;

type Col = { title: string; sub?: string };
type Row = { title: string; sub?: string; cells: string[] };

function fillCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  font = "600 9px 'Source Sans 3', system-ui, sans-serif",
) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111";
  ctx.font = font;
  ctx.fillText(text, cx, cy + 0.6);
}


function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.split(" ").filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0]!;
    for (const w of words.slice(1)) {
      const trial = `${line} ${w}`;
      if (ctx.measureText(trial).width <= max) line = trial;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines.slice(0, 4);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_Q): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("jpeg"))), "image/jpeg", quality);
  });
}

async function stackJpegBlobs(blobs: Blob[]): Promise<Blob> {
  const images = await Promise.all(blobs.map((b) => createImageBitmap(b)));
  const width = Math.max(...images.map((im) => im.width));
  const gap = 24;
  const height = images.reduce((n, im) => n + im.height, 0) + gap * (images.length - 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const im of images) {
    ctx.drawImage(im, 0, y);
    y += im.height + gap;
  }
  return canvasToJpeg(canvas);
}

async function paintTable(spec: {
  kicker: string;
  title: string;
  corner: string;
  columns: Col[];
  rows: Row[];
}): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const dpr = SHEET_DPR;
  const pad = 36;
  const headH = 92;
  const labelW = 108;
  const colW = Math.max(112, Math.min(168, Math.floor(980 / Math.max(1, spec.columns.length))));
  const width = pad * 2 + labelW + spec.columns.length * colW;
  const rowH = 78;
  const height = pad + headH + 36 + spec.rows.length * rowH + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, width, headH);
  ctx.fillStyle = "rgba(244,239,228,0.7)";
  ctx.font = "600 13px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText(spec.kicker, pad, 34);
  ctx.fillStyle = CREAM;
  ctx.font = "600 28px Fraunces, Georgia, serif";
  ctx.fillText(spec.title, pad, 70);

  const tableTop = headH + 20;
  const tableLeft = pad;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;

  ctx.fillStyle = MUTED;
  ctx.font = "600 12px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText(spec.corner, tableLeft + 8, tableTop + 22);
  spec.columns.forEach((c, i) => {
    const x = tableLeft + labelW + i * colW;
    ctx.fillStyle = INK;
    ctx.font = "600 13px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText(c.title, x + 8, tableTop + 20);
    if (c.sub) {
      ctx.fillStyle = MUTED;
      ctx.font = "500 11px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(c.sub, x + 8, tableTop + 36);
    }
  });

  spec.rows.forEach((row, r) => {
    const y = tableTop + 44 + r * rowH;
    ctx.beginPath();
    ctx.moveTo(tableLeft, y);
    ctx.lineTo(tableLeft + labelW + spec.columns.length * colW, y);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "600 13px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText(row.title, tableLeft + 8, y + 24);
    if (row.sub) {
      ctx.fillStyle = MUTED;
      ctx.font = "500 11px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(row.sub, tableLeft + 8, y + 40);
    }
    row.cells.forEach((cell, i) => {
      const x = tableLeft + labelW + i * colW;
      ctx.fillStyle = INK;
      ctx.font = "500 12px 'Source Sans 3', system-ui, sans-serif";
      const lines = wrap(ctx, cell || "—", colW - 16);
      lines.forEach((line, li) => {
        ctx.fillStyle = line === "—" ? MUTED : INK;
        ctx.fillText(line, x + 8, y + 22 + li * 15);
      });
    });
  });

  return canvasToJpeg(canvas);
}

function classOrder(data: PersistedData) {
  return [...data.classes].sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section));
}

type ExcelCell = { lines?: string[]; disp?: boolean };

async function paintExcelGrid(opts: {
  data: PersistedData;
  who: string;
  columns: string[];
  rows: { mark: string; cells: ExcelCell[] }[];
}): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const pageW = 842;
  const pageH = 595;
  const padX = 18;
  const padY = 14;
  const titleH = 72;
  const x0 = padX;
  const headY = padY + titleH;
  const tableW = pageW - padX * 2;
  const tableH = pageH - padY * 2 - titleH;
  const headH = 22;
  const hourW = 28;
  const nRows = Math.max(1, opts.rows.length);
  const nCols = Math.max(1, opts.columns.length);
  const rowH = (tableH - headH) / nRows;
  const colW = (tableW - hourW) / nCols;
  const dpr = SHEET_DPR;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pageW * dpr);
  canvas.height = Math.round(pageH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, pageW, pageH);

  drawSheetHeading(ctx, opts.data, pageW, padY, "ORARIO SETTIMANALE DELLE LEZIONI");
  ctx.fillStyle = "#111";
  ctx.font = "700 13px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(opts.who, pageW / 2, padY + 66);

  function stroke(x: number, y: number, w: number, h: number) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.7;
    ctx.strokeRect(x, y, w, h);
  }

  ctx.fillStyle = "#eee8dc";
  ctx.fillRect(x0, headY, tableW, headH);
  stroke(x0, headY, hourW, headH);
  ctx.fillStyle = "#111";
  ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H", x0 + hourW / 2, headY + headH / 2);
  opts.columns.forEach((col, i) => {
    const x = x0 + hourW + i * colW;
    stroke(x, headY, colW, headH);
    ctx.font = col.length > 16 ? "600 8px 'Source Sans 3', system-ui, sans-serif" : "700 10px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText(col, x + colW / 2, headY + headH / 2);
  });

  opts.rows.forEach((row, ri) => {
    const y = headY + headH + ri * rowH;
    stroke(x0, y, hourW, rowH);
    ctx.fillStyle = "#f7f4ee";
    ctx.fillRect(x0 + 0.4, y + 0.4, hourW - 0.8, rowH - 0.8);
    ctx.fillStyle = "#111";
    ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(row.mark, x0 + hourW / 2, y + rowH / 2);
    row.cells.forEach((cell, i) => {
      const x = x0 + hourW + i * colW;
      stroke(x, y, colW, rowH);
      if (cell.disp) {
        ctx.fillStyle = "#111";
        ctx.fillRect(x + 0.5, y + 0.5, colW - 1, rowH - 1);
        ctx.fillStyle = "#fff";
        ctx.font = "700 16px 'Source Sans 3', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("D", x + colW / 2, y + rowH / 2);
        return;
      }
      const lines = (cell.lines ?? []).filter(Boolean);
      if (!lines.length) return;
      const lineH = 11;
      const block = lines.length * lineH;
      let ty = y + (rowH - block) / 2 + lineH / 2;
      for (const line of lines) {
        fillCentered(ctx, line, x + colW / 2, ty);
        ty += lineH;
      }
    });
  });

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x0, headY, tableW, tableH);

  return canvasToJpeg(canvas);
}

export function orarioQuadroJpeg(data: PersistedData, day: DayOfWeek): Promise<Blob> {
  const classes = classOrder(data);
  const periods = periodsOnDay(data, day);
  return paintExcelGrid({
    data,
    who: dayNameUpper(day),
    columns: [...classes.map(classHeader), "Ore a disposizione"],
    rows: periods.map((p) => ({
      mark: hourMark(p),
      cells: [
        ...classes.map((c) => {
          if (isRestrictedTpPeriod(p) && c.tempo !== "TP") return {};
          const lesson = classCellLesson(data, c.id, day, p);
          if (lesson === "MENSA") return { lines: ["MENSA"] };
          if (!lesson) return {};
          const t = data.teachers.find((x) => x.id === lesson.teacherId);
          return t ? { lines: [teacherSheetName(t, data.teachers)] } : {};
        }),
        (() => {
          const names = dispNamesAt(data, day, p.id);
          return names.length ? { lines: [names.join(" / ")] } : {};
        })(),
      ],
    })),
  });
}

export function orarioClassJpeg(data: PersistedData, classId: string): Promise<Blob> {
  const cls = data.classes.find((c) => c.id === classId);
  const days = data.settings.days;
  return paintExcelGrid({
    data,
    who: `CLASSE ${cls ? classHeader(cls) : ""}`,
    columns: days.map((d) => dayNameUpper(d)),
    rows: visiblePeriods(data.settings, cls?.tempo).map((p) => ({
      mark: hourMark(p),
      cells: days.map((d) => {
        const lesson = classCellLesson(data, classId, d, p);
        if (lesson === "MENSA") return { lines: ["MENSA"] };
        if (!lesson) return {};
        const t = data.teachers.find((x) => x.id === lesson.teacherId);
        return {
          lines: [t ? teacherSheetName(t, data.teachers) : "", schoolSubjectLabel(lesson.subject)].filter(Boolean),
        };
      }),
    })),
  });
}

export function orarioTeacherJpeg(data: PersistedData, teacherId: string): Promise<Blob> {
  const t = data.teachers.find((x) => x.id === teacherId);
  const days = data.settings.days;
  return paintExcelGrid({
    data,
    who: t ? teacherSheetName(t, data.teachers) : "DOCENTE",
    columns: days.map((d) => dayNameUpper(d)),
    rows: visiblePeriods(data.settings).map((p) => ({
      mark: hourMark(p),
      cells: days.map((d) => {
        if (t && isDispHour(t, d, p.id)) return { disp: true };
        const slot = teacherSlotAt(data, teacherId, d, p.id);
        if (!slot) return {};
        if (isMensaLesson(slot) || isMensaPeriod(p)) return { lines: ["MENSA"] };
        const cls = data.classes.find((c) => c.id === slot.classId);
        return {
          lines: [cls ? classHeader(cls) : "", schoolSubjectLabel(slot.subject)].filter(Boolean),
        };
      }),
    })),
  });
}

export async function bachecaJpeg(data: PersistedData, date: string): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const needs = coverageNeeds(data, date);
  const applied = classShifts(data, date).filter((s) => s.applied);
  const taken = new Set(applied.flatMap((s) => s.needs.map((n) => n.key)));
  const openNeeds = needs.filter((n) => !taken.has(n.key));
  const dpr = SHEET_DPR;
  const width = 1080;
  const pad = 40;
  const rowH = 72;
  const groups = data.settings.periods
    .map((p) => ({ period: p, items: openNeeds.filter((n) => n.slot.periodId === p.id) }))
    .filter((g) => g.items.length > 0);
  const bodyRows = applied.length + groups.reduce((n, g) => n + 1 + g.items.length, 0);
  const height = Math.max(640, pad + 100 + bodyRows * rowH + pad);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, width, 108);
  ctx.fillStyle = "rgba(244,239,228,0.7)";
  ctx.font = "600 14px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText(`${data.settings.schoolName} · ${data.settings.schoolYear}`, pad, 40);
  ctx.fillStyle = CREAM;
  ctx.font = "600 30px Fraunces, Georgia, serif";
  const dayTitle = formatLong(date);
  ctx.fillText(dayTitle.charAt(0).toUpperCase() + dayTitle.slice(1), pad, 78);

  let y = 140;
  if (applied.length > 0) {
    ctx.fillStyle = GREEN;
    ctx.font = "600 16px Fraunces, Georgia, serif";
    ctx.fillText("Orario variato", pad, y);
    y += 28;
    for (const shift of applied) {
      const cls = data.classes.find((c) => c.id === shift.classId);
      const code = (cls?.name ?? "?").replace(/ª\s*/g, "").replace(/\s+/g, "");
      const names = [...new Set(shift.needs.map((n) => {
        const t = data.teachers.find((x) => x.id === n.absence.teacherId);
        const name = t ? teacherSurname(t, data.teachers) : "?";
        return n.absence.reason === "assemblea_sindacale" ? `${name} (assemblea)` : name;
      }))].sort((a, b) => a.localeCompare(b, "it"));
      ctx.fillStyle = INK;
      ctx.font = "600 16px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(`${code} ${shift.phrase}`, pad, y);
      ctx.fillStyle = MUTED;
      ctx.font = "500 14px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(`Assente ${names.join(", ")}`, pad, y + 22);
      y += rowH - 8;
    }
    y += 12;
  }
  if (groups.length === 0 && applied.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = "500 18px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText("Nessuna ora da coprire.", pad, y);
    return canvasToJpeg(canvas);
  }

  for (const g of groups) {
    ctx.fillStyle = GREEN;
    ctx.font = "600 16px Fraunces, Georgia, serif";
    ctx.fillText(`${g.period.label}  ${g.period.start}–${g.period.end}`, pad, y);
    y += 28;
    for (const n of g.items) {
      const cls = data.classes.find((c) => c.id === n.slot.classId);
      const absent = data.teachers.find((t) => t.id === n.absence.teacherId);
      const absentName = absent ? teacherSurname(absent, data.teachers) : "—";
      const absentLabel =
        n.absence.reason === "assemblea_sindacale" ? `${absentName} (assemblea)` : absentName;
      const sub = data.teachers.find((t) => t.id === n.substitution?.substituteId);
      const copre =
        n.substitution?.type === "divisione"
          ? "classe divisa"
          : sub
            ? teacherSurname(sub, data.teachers)
            : "da assegnare";
      const tipo =
        n.substitution?.type && n.substitution.type !== "divisione"
          ? (SUBSTITUTION_TYPES.find((x) => x.value === n.substitution?.type)?.short ?? "")
          : "";
      ctx.fillStyle = INK;
      ctx.font = "600 16px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(`${cls?.name ?? "?"}  ·  ${n.slot.subject}`, pad, y);
      ctx.fillStyle = MUTED;
      ctx.font = "500 14px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(
        `Assente ${absentLabel}   →   Copre ${copre}${tipo ? ` (${tipo})` : ""}`,
        pad,
        y + 22,
      );
      ctx.strokeStyle = LINE;
      ctx.beginPath();
      ctx.moveTo(pad, y + 36);
      ctx.lineTo(width - pad, y + 36);
      ctx.stroke();
      y += rowH - 8;
    }
    y += 12;
  }
  const uncovered = openNeeds.filter((n) => !isCovered(n)).length;
  const listed = openNeeds.length;
  ctx.fillStyle = GREEN;
  ctx.font = "600 14px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText(
    `Coperture ${listed - uncovered}/${listed}` +
      (uncovered ? `  ·  ${uncovered} scoperte` : "  ·  giornata completa"),
    pad,
    Math.min(y + 8, height - 28),
  );
  return canvasToJpeg(canvas);
}

export async function reportJpeg(data: PersistedData, from: string, to: string): Promise<Blob> {
  const loads = loadByTeacher(data, from, to).filter((r) => r.total > 0);
  const rows: Row[] = loads.map((r) => {
    const t = data.teachers.find((x) => x.id === r.teacherId);
    return {
      title: t ? teacherShort(t, data.teachers) : r.teacherId,
      cells: [
        String(r.disposizione),
        String(r.potenziamento),
        String(r.recupero),
        String(r.eccedente),
        String(r.sostegno),
        String(r.altro),
        String(r.total),
      ],
    };
  });
  const subBlob = await paintTable({
    kicker: `${data.settings.schoolName} · ${formatItDate(from)} → ${formatItDate(to)}`,
    title: "Monte ore sostituzioni",
    corner: "Docente",
    columns: [
      { title: "Disp." },
      { title: "Pot." },
      { title: "Rec." },
      { title: "Ecc." },
      { title: "Sos." },
      { title: "Altro" },
      { title: "Tot." },
    ],
    rows: rows.length ? rows : [{ title: "—", cells: ["0", "0", "0", "0", "0", "0", "0"] }],
  });

  const abs = absencesByReason(data, from, to).filter((r) => r.total > 0);
  if (abs.length === 0) return subBlob;
  const absRows: Row[] = abs.map((r) => {
    const t = data.teachers.find((x) => x.id === r.teacherId);
    return {
      title: t ? teacherShort(t, data.teachers) : r.teacherId,
      cells: [...ABSENCE_REASONS.map((x) => String(r.byReason[x.value])), String(r.total)],
    };
  });
  const absBlob = await paintTable({
    kicker: `${data.settings.schoolName} · ${formatItDate(from)} → ${formatItDate(to)}`,
    title: "Assenze per motivo",
    corner: "Docente",
    columns: [...ABSENCE_REASONS.map((x) => ({ title: REASON_SHORT[x.value] ?? x.label })), { title: "Tot." }],
    rows: absRows,
  });
  return stackJpegBlobs([subBlob, absBlob]);
}

const REASON_SHORT: Record<string, string> = {
  malattia: "Malattia",
  permesso: "Perm. pers.",
  l104: "L.104",
  formazione: "Formaz.",
  assemblea_sindacale: "Assemblea",
  visita: "Visita",
  permesso_breve: "P. breve",
  altro: "Altro",
};

const SUBJECT_ABBR: Record<string, string> = {
  Italiano: "ITA",
  Storia: "STO",
  Geografia: "GEO",
  Matematica: "MAT",
  Scienze: "SCI",
  Inglese: "ING",
  Francese: "FRA",
  Spagnolo: "SPA",
  Tecnologia: "TEC",
  "Arte e Immagine": "ART",
  Musica: "MUS",
  "Scienze Motorie": "MOT",
  Religione: "IRC",
  "Educazione civica": "CIV",
  Sostegno: "SOS",
  Potenziamento: "POT",
  Altro: "ALT",
  Mensa: "MEN",
  Laboratorio: "LAB",
};

export function subjectAbbr(subject: string): string {
  return SUBJECT_ABBR[subject] ?? mergedAbbr(subject) ?? subject.slice(0, 3).toUpperCase();
}

export function weekCellLines(data: PersistedData, classId: string, day: DayOfWeek): {
  mark: string;
  period: number;
  subject: string;
  teacher: string;
}[] {
  const cls = data.classes.find((c) => c.id === classId);
  return visiblePeriods(data.settings, cls?.tempo).map((p) => {
    // il sostegno non è mai la lezione della casella, e la compresenza non lascia segni
    const occupants = classCellSlots(data, classId, day, p.id);
    const primary = occupants.find((s) => !isSostegnoSlot(data, s));
    if (!primary) {
      const mensa = isMensaPeriod(p) && occupants.length > 0 && occupants.every((s) => isMensaLesson(s));
      return { mark: hourMark(p), period: p.index, subject: mensa ? "Mensa" : "", teacher: "" };
    }
    const t = data.teachers.find((x) => x.id === primary.teacherId);
    const mensaLesson = isMensaPeriod(p) && isMensaLesson(primary);
    return {
      mark: hourMark(p),
      period: p.index,
      subject: mensaLesson ? "Mensa" : subjectAbbr(primary.subject),
      teacher: t ? teacherShort(t, data.teachers) : "",
    };
  });
}

export async function orarioWeekJpeg(data: PersistedData): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const classes = classOrder(data);
  const days = data.settings.days;
  const periodsByDay = days.map((d) => periodsOnDay(data, d));
  const nRows = Math.max(1, periodsByDay.reduce((n, ps) => n + ps.length, 0));

  const pageW = 842;
  const pageH = 595;
  const padX = 16;
  const padY = 14;
  const titleH = 56;
  const x0 = padX;
  const headY = padY + titleH;
  const tableW = pageW - padX * 2;
  const tableH = pageH - padY * 2 - titleH;
  const headH = 20;
  const rowH = (tableH - headH) / nRows;
  const dayW = 18;
  const hourW = 20;
  const dispW = Math.min(118, Math.max(72, tableW * 0.16));
  const colW = (tableW - dayW - hourW - dispW) / Math.max(1, classes.length);
  const dpr = SHEET_DPR;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pageW * dpr);
  canvas.height = Math.round(pageH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, pageW, pageH);

  drawSheetHeading(ctx, data, pageW, padY, "ORARIO SETTIMANALE DELLE LEZIONI");

  function stroke(x: number, y: number, w: number, h: number, width = 0.7) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = width;
    ctx.strokeRect(x, y, w, h);
  }

  ctx.fillStyle = "#eee8dc";
  ctx.fillRect(x0, headY, tableW, headH);
  stroke(x0, headY, dayW + hourW, headH);
  ctx.fillStyle = "#111";
  ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H", x0 + (dayW + hourW) / 2, headY + headH / 2);
  classes.forEach((c, i) => {
    const x = x0 + dayW + hourW + i * colW;
    stroke(x, headY, colW, headH);
    ctx.fillText(classHeader(c), x + colW / 2, headY + headH / 2);
  });
  const dispX = x0 + dayW + hourW + classes.length * colW;
  stroke(dispX, headY, dispW, headH);
  ctx.font = "600 8px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText("Ore a disposizione", dispX + dispW / 2, headY + headH / 2);

  let y = headY + headH;
  days.forEach((day, di) => {
    const periods = periodsByDay[di] ?? [];
    const blockH = periods.length * rowH;
    const dayTop = y;
    stroke(x0, y, dayW, blockH);
    ctx.save();
    ctx.fillStyle = "#111";
    ctx.font = "700 9px 'Source Sans 3', system-ui, sans-serif";
    ctx.translate(x0 + dayW / 2, y + blockH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(dayNameUpper(day), 0, 0.6);
    ctx.restore();

    periods.forEach((p, pi) => {
      const yy = y + pi * rowH;
      const mid = yy + rowH / 2;
      stroke(x0 + dayW, yy, hourW, rowH);
      fillCentered(ctx, hourMark(p), x0 + dayW + hourW / 2, mid, "700 9px 'Source Sans 3', system-ui, sans-serif");
      classes.forEach((c, i) => {
        const x = x0 + dayW + hourW + i * colW;
        stroke(x, yy, colW, rowH);
        if (isRestrictedTpPeriod(p) && c.tempo !== "TP") return;
        const lesson = classCellLesson(data, c.id, day, p);
        if (lesson === "MENSA") {
          fillCentered(ctx, "MENSA", x + colW / 2, mid);
          return;
        }
        if (!lesson) return;
        const t = data.teachers.find((x) => x.id === lesson.teacherId);
        if (!t) return;
        fillCentered(ctx, teacherSheetName(t, data.teachers), x + colW / 2, mid);
      });
      stroke(dispX, yy, dispW, rowH);
      const onDisp = dispNamesAt(data, day, p.id);
      if (onDisp.length) fillCentered(ctx, onDisp.join(" / "), dispX + dispW / 2, mid);
    });

    ctx.strokeStyle = "#111";
    ctx.lineWidth = di === 0 ? 0.9 : 1.25;
    ctx.beginPath();
    ctx.moveTo(x0, dayTop);
    ctx.lineTo(x0 + tableW, dayTop);
    ctx.stroke();
    y += blockH;
  });

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x0, headY, tableW, tableH);

  return canvasToJpeg(canvas);
}

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
};

function schoolSubjectLabel(subject: string): string {
  return SCHOOL_SUBJECT[subject] ?? mergedUpper(subject) ?? subject.toUpperCase();
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

function drawSheetHeading(
  ctx: CanvasRenderingContext2D,
  data: PersistedData,
  width: number,
  pad: number,
  title: string,
) {
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 12px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText(plessoHeading(data), width / 2, pad + 14);
  ctx.font = "700 15px 'Source Sans 3', system-ui, sans-serif";
  // un orario di prova (slot 1–5) non si scambia per quello in vigore
  const trial = trialLabel(data);
  ctx.fillText(trial ? `${title} · ${trial}` : title, width / 2, pad + 34);
  ctx.font = "500 10px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = "#444";
  ctx.fillText(asYearLine(data), width / 2, pad + 50);
  ctx.textAlign = "left";
  ctx.fillStyle = "#111";
}

function classHeader(c: { name: string; grade: number; section: string }): string {
  return `${c.grade}${c.section}`;
}

function dispNamesAt(data: PersistedData, day: DayOfWeek, periodId: string): string[] {
  return data.teachers
    .filter((t) => t.role !== "sostegno" && t.role !== "potenziamento")
    .filter((t) => isDispHour(t, day, periodId))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it"))
    .map((t) => teacherSheetName(t, data.teachers));
}

function teachersByRole(data: PersistedData, role: "sostegno" | "potenziamento") {
  return data.teachers
    .filter((t) => t.role === role)
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it"));
}

function sostegnoClassLabel(
  data: PersistedData,
  t: { assignedClassIds?: string[] },
): string {
  const ids = new Set(t.assignedClassIds ?? []);
  const labels = classOrder(data)
    .filter((c) => ids.has(c.id))
    .map(classHeader);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

function wrapCaptionItems(
  ctx: CanvasRenderingContext2D,
  items: string[],
  firstMax: number,
  nextMax: number,
  sep: string,
): string[] {
  const lines: string[] = [];
  let cur = "";
  let max = firstMax;
  for (const item of items) {
    const trial = cur ? `${cur}${sep}${item}` : item;
    if (!cur || ctx.measureText(trial).width <= max) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = item;
      max = nextMax;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Riga sotto il quadro: Sostegno · DE VITA 1A · …  /  Potenziamento · ARCELLA */
function drawLabeledCaption(
  ctx: CanvasRenderingContext2D,
  prefix: string,
  items: string[],
  x: number,
  y: number,
  w: number,
  drawRule: boolean,
): number {
  if (items.length === 0) return y;
  if (drawRule) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }
  const sep = "  ·  ";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
  const prefixW = ctx.measureText(prefix).width;
  ctx.font = "500 9px 'Source Sans 3', system-ui, sans-serif";
  const sepW = ctx.measureText(sep).width;
  const lines = wrapCaptionItems(ctx, items, w - prefixW - sepW, w, sep);
  ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = "#111";
  ctx.fillText(prefix, x, y + 14);
  ctx.font = "500 9px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = "#444";
  ctx.fillText(sep + (lines[0] ?? ""), x + prefixW, y + 14);
  for (let i = 1; i < lines.length; i++) {
    ctx.fillText(lines[i]!, x, y + 14 + i * 12);
  }
  return y + 16 + Math.max(1, lines.length) * 12;
}

function drawDispNames(
  ctx: CanvasRenderingContext2D,
  names: string[],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (!names.length) return;
  fillCentered(ctx, names.join(" / "), x + w / 2, y + h / 2);
}

/** Foglio ufficiale da appendere: giorni in colonna, classi in riga. Non sostituisce orarioWeekJpeg. */
export async function orarioScuolaJpeg(data: PersistedData, withTeachers: boolean): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const classes = classOrder(data);
  const days = data.settings.days;
  const periodsByDay = days.map((d) => periodsOnDay(data, d));
  const dpr = SHEET_DPR;
  const pad = 18;
  const titleH = 64;
  const hourW = 28;
  const dispW = 120;
  const colW = Math.max(72, Math.min(96, Math.floor((680 - hourW - dispW) / Math.max(1, classes.length))));
  const rowH = withTeachers ? 34 : 24;
  const dayHeadH = 20;
  const tableW = hourW + classes.length * colW + dispW;
  const bodyH = periodsByDay.reduce((n, ps) => n + dayHeadH + ps.length * rowH, 0);
  const width = pad * 2 + tableW;
  const height = pad + titleH + dayHeadH + bodyH + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  drawSheetHeading(ctx, data, width, pad, "ORARIO SETTIMANALE DELLE LEZIONI");

  let y = pad + titleH;
  const x0 = pad;

  function strokeRect(x: number, yy: number, w: number, h: number) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, yy, w, h);
  }

  ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = "#111";
  strokeRect(x0, y, hourW, dayHeadH);
  classes.forEach((c, i) => {
    const x = x0 + hourW + i * colW;
    strokeRect(x, y, colW, dayHeadH);
    ctx.textAlign = "center";
    ctx.fillText(classHeader(c), x + colW / 2, y + 14);
  });
  strokeRect(x0 + hourW + classes.length * colW, y, dispW, dayHeadH);
  ctx.font = "600 8px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText("Ore a disposizione", x0 + hourW + classes.length * colW + dispW / 2, y + 14);
  ctx.textAlign = "left";
  y += dayHeadH;

  days.forEach((day, di) => {
    const periods = periodsByDay[di] ?? [];
    strokeRect(x0, y, tableW, dayHeadH);
    ctx.fillStyle = "#f3f3f3";
    ctx.fillRect(x0 + 0.5, y + 0.5, tableW - 1, dayHeadH - 1);
    ctx.fillStyle = "#111";
    ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(dayNameUpper(day), x0 + tableW / 2, y + 14);
    ctx.textAlign = "left";
    y += dayHeadH;

    periods.forEach((p) => {
      strokeRect(x0, y, hourW, rowH);
      ctx.fillStyle = "#111";
      ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(hourMark(p), x0 + hourW / 2, y + (withTeachers ? 21 : 16));
      ctx.textAlign = "left";

      classes.forEach((c, i) => {
        const x = x0 + hourW + i * colW;
        strokeRect(x, y, colW, rowH);
        if (isRestrictedTpPeriod(p) && c.tempo !== "TP") return;
        const primary = classCellLesson(data, c.id, day, p);
        if (primary === "MENSA") {
          ctx.textAlign = "center";
          ctx.fillStyle = "#111";
          ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText("MENSA", x + colW / 2, y + (withTeachers ? 21 : 16));
          ctx.textAlign = "left";
          return;
        }
        if (!primary) return;
        const t = data.teachers.find((x) => x.id === primary.teacherId);
        ctx.textAlign = "center";
        ctx.fillStyle = "#111";
        if (withTeachers) {
          ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText(t ? teacherShort(t, data.teachers) : "", x + colW / 2, y + 14);
          ctx.font = "500 10px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText(subjectAbbr(primary.subject), x + colW / 2, y + 28);
        } else {
          ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText(schoolSubjectLabel(primary.subject), x + colW / 2, y + 17);
        }
        ctx.textAlign = "left";
      });

      const dx = x0 + hourW + classes.length * colW;
      strokeRect(dx, y, dispW, rowH);
      drawDispNames(ctx, dispNamesAt(data, day, p.id), dx, y, dispW, rowH);
      y += rowH;
    });
  });

  return canvasToJpeg(canvas);
}

function sheetPeriods(data: PersistedData) {
  return visiblePeriods(data.settings);
}

/** Mattina sempre; mensa / 7ª / 8ª solo se in quel giorno c’è almeno una cella compilata. */
function periodsOnDay(data: PersistedData, day: DayOfWeek) {
  return sheetPeriods(data).filter((p) => {
    if (!p.tpOnly) return true;
    if (data.slots.some((s) => s.day === day && s.periodId === p.id)) return true;
    return data.teachers.some((t) => isDispHour(t, day, p.id));
  });
}

function teachersOnTimetable(data: PersistedData) {
  const ids = new Set(data.slots.map((s) => s.teacherId));
  return data.teachers
    .filter((t) => ids.has(t.id))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it"));
}

function slotClassAt(
  data: PersistedData,
  teacherId: string,
  day: DayOfWeek,
  periodId: string,
): string {
  const slot = teacherSlotAt(data, teacherId, day, periodId);
  if (!slot) return "";
  const cls = data.classes.find((c) => c.id === slot.classId);
  return cls ? classHeader(cls) : "";
}

/** Foglio docenti × ore, un giorno accanto all’altro (layout orizzontale da appendere). */
export async function orarioOrizzontaleJpeg(data: PersistedData): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const days = data.settings.days;
  const periodsByDay = days.map((d) => periodsOnDay(data, d));
  const teachers = teachersOnTimetable(data);
  const dpr = SHEET_DPR;
  const pad = 18;
  const titleH = 72;
  const nameW = 128;
  const hourW = 34;
  const dayWidths = periodsByDay.map((ps) => ps.length * hourW);
  const rowH = 22;
  const dayHeadH = 20;
  const hourHeadH = 16;
  const hoursW = dayWidths.reduce((n, w) => n + w, 0);
  const width = pad * 2 + nameW + hoursW;
  const height = pad + titleH + dayHeadH + hourHeadH + Math.max(1, teachers.length) * rowH + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const g = ctx;
  g.scale(dpr, dpr);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);

  drawSheetHeading(g, data, width, pad, "ORARIO SETTIMANALE DEI DOCENTI");
  g.font = "500 9px 'Source Sans 3', system-ui, sans-serif";
  g.fillStyle = "#333";
  g.textAlign = "center";
  g.fillText("D nera = a disposizione     righe = ora buca", width / 2, pad + 64);
  g.textAlign = "left";

  const x0 = pad;
  const gridTop = pad + titleH;
  let y = gridTop;

  function box(x: number, yy: number, w: number, h: number) {
    g.strokeStyle = "#111";
    g.lineWidth = 0.7;
    g.strokeRect(x, yy, w, h);
  }

  function hatch(x: number, yy: number, w: number, h: number) {
    g.save();
    g.beginPath();
    g.rect(x + 0.6, yy + 0.6, w - 1.2, h - 1.2);
    g.clip();
    g.strokeStyle = "#111";
    g.lineWidth = 1.1;
    const step = 4;
    for (let i = -h; i < w + h; i += step) {
      g.beginPath();
      g.moveTo(x + i, yy);
      g.lineTo(x + i + h, yy + h);
      g.stroke();
    }
    g.restore();
  }

  function fillD(x: number, yy: number, w: number, h: number) {
    g.fillStyle = "#111";
    g.fillRect(x + 0.5, yy + 0.5, w - 1, h - 1);
    g.fillStyle = "#fff";
    g.font = "700 15px 'Source Sans 3', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("D", x + w / 2, yy + h / 2 + 0.5);
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
  }

  box(x0, y, nameW, dayHeadH + hourHeadH);
  let dayX = x0 + nameW;
  days.forEach((day, di) => {
    const periods = periodsByDay[di] ?? [];
    const dayW = dayWidths[di] ?? 0;
    box(dayX, y, dayW, dayHeadH);
    ctx.fillStyle = "#111";
    ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(dayNameUpper(day), dayX + dayW / 2, y + 14);
    periods.forEach((p, pi) => {
      const hx = dayX + pi * hourW;
      box(hx, y + dayHeadH, hourW, hourHeadH);
      ctx.font = "600 10px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(hourMark(p), hx + hourW / 2, y + dayHeadH + 12);
    });
    dayX += dayW;
  });
  ctx.textAlign = "left";
  y += dayHeadH + hourHeadH;

  const tableW = nameW + hoursW;
  teachers.forEach((t, ti) => {
    if (ti % 2 === 1) {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(x0 + 0.5, y + 0.5, tableW - 1, rowH - 1);
    }
    box(x0, y, nameW, rowH);
    ctx.fillStyle = "#111";
    ctx.font = "700 9px 'Source Sans 3', system-ui, sans-serif";
    const label = teacherSheetName(t, data.teachers);
    const hours = t.weeklyHours ? String(t.weeklyHours) : "";
    ctx.fillText(label, x0 + 4, y + 15);
    if (hours) {
      ctx.textAlign = "right";
      ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText(hours, x0 + nameW - 4, y + 15);
      ctx.textAlign = "left";
    }
    let x = x0 + nameW;
    days.forEach((day, di) => {
      const periods = periodsByDay[di] ?? [];
      const win = teacherDayWindow(data, t.id, day);
      periods.forEach((p) => {
        const mensa = isMensaPeriod(p);
        const slot = teacherSlotAt(data, t.id, day, p.id);
        const cell = slotClassAt(data, t.id, day, p.id);
        const disp = !cell && isDispHour(t, day, p.id);
        const buca = Boolean(!mensa && !cell && !disp && win && p.index > win.first && p.index < win.last);
        if (disp) fillD(x, y, hourW, rowH);
        else if (buca) hatch(x, y, hourW, rowH);
        box(x, y, hourW, rowH);
        const mark = mensa && slot && isMensaLesson(slot) ? "M" : cell;
        if (mark) {
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillStyle = "#111";
          ctx.fillText(mark, x + hourW / 2, y + 15);
          ctx.textAlign = "left";
        }
        x += hourW;
      });
    });
    y += rowH;
  });

  const gridBottom = y;
  g.strokeStyle = "#111";
  g.lineWidth = 2.2;
  g.lineCap = "butt";
  let dx = x0 + nameW;
  days.forEach((_, di) => {
    g.beginPath();
    g.moveTo(dx, gridTop);
    g.lineTo(dx, gridBottom);
    g.stroke();
    dx += dayWidths[di] ?? 0;
  });
  g.beginPath();
  g.moveTo(dx, gridTop);
  g.lineTo(dx, gridBottom);
  g.stroke();

  return canvasToJpeg(canvas);
}

/** Quadro settimanale per classe: giorni in colonna, cognomi o materie in cella (foglio da appendere). */
export async function orarioClassiGridJpeg(
  data: PersistedData,
  mode: boolean | "materie" = false,
): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const subjectsOnly = mode === "materie";
  const withSubjects = mode === true;
  const classes = classOrder(data);
  const days = data.settings.days;
  const periodsByDay = days.map((d) => periodsOnDay(data, d));
  const sos = teachersByRole(data, "sostegno");
  const pot = teachersByRole(data, "potenziamento");
  const side = [...sos, ...pot];
  const dpr = SHEET_DPR;
  const pad = 12;
  const titleH = 64;
  const dayW = 20;
  const hourW = 26;
  const dispW = 112;
  const sosW = 26;
  const colW = Math.max(
    withSubjects ? 72 : 68,
    Math.min(
      withSubjects ? 96 : 88,
      Math.floor((620 - dayW - hourW - dispW) / Math.max(1, classes.length)),
    ),
  );
  const rowH = withSubjects ? 34 : 22;
  const gap = 8;
  const headH = side.length > 0 ? 68 : 22;
  const footH = subjectsOnly || !(sos.length || pot.length) ? 0 : 16 + (sos.length ? 24 : 0) + (pot.length ? 24 : 0);
  const tableW = dayW + hourW + classes.length * colW + dispW + side.length * sosW;
  const width = pad * 2 + tableW;
  const height =
    pad +
    titleH +
    headH +
    periodsByDay.reduce((n, ps) => n + ps.length * rowH, 0) +
    (days.length - 1) * gap +
    footH +
    pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  drawSheetHeading(ctx, data, width, pad, "ORARIO SETTIMANALE DELLE LEZIONI");

  const x0 = pad;
  let y = pad + titleH;

  function box(x: number, yy: number, w: number, h: number) {
    ctx!.strokeStyle = "#111";
    ctx!.lineWidth = 0.7;
    ctx!.strokeRect(x, yy, w, h);
  }

  box(x0, y, dayW + hourW, headH);
  ctx.fillStyle = "#111";
  ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("H", x0 + (dayW + hourW) / 2, y + headH - 8);
  classes.forEach((c, i) => {
    const x = x0 + dayW + hourW + i * colW;
    box(x, y, colW, headH);
    ctx.fillText(classHeader(c), x + colW / 2, y + headH - 8);
  });
  const dispX = x0 + dayW + hourW + classes.length * colW;
  box(dispX, y, dispW, headH);
  ctx.font = "600 8px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillText("Ore a disposizione", dispX + dispW / 2, y + headH - 8);
  side.forEach((t, i) => {
    const x = dispX + dispW + i * sosW;
    box(x, y, sosW, headH);
    ctx.save();
    ctx.translate(x + sosW / 2, y + headH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111";
    const sideLabel = subjectsOnly
      ? t.role === "sostegno"
        ? "SOSTEGNO"
        : "POTENZIAMENTO"
      : teacherSheetName(t, data.teachers);
    ctx.font = subjectsOnly
      ? "600 8px 'Source Sans 3', system-ui, sans-serif"
      : "600 9px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText(sideLabel, 0, 0);
    ctx.restore();
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  y += headH;

  days.forEach((day, di) => {
    if (di > 0) y += gap;
    const periods = periodsByDay[di] ?? [];
    const blockH = periods.length * rowH;
    box(x0, y, dayW, blockH);
    ctx.save();
    ctx.fillStyle = "#111";
    ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
    ctx.translate(x0 + dayW / 2, y + blockH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(dayNameUpper(day), 0, 0);
    ctx.restore();

    periods.forEach((p, pi) => {
      const yy = y + pi * rowH;
      box(x0 + dayW, yy, hourW, rowH);
      ctx.fillStyle = "#111";
      ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(hourMark(p), x0 + dayW + hourW / 2, yy + (withSubjects ? 22 : 16));
      classes.forEach((c, i) => {
        const x = x0 + dayW + hourW + i * colW;
        box(x, yy, colW, rowH);
        if (isRestrictedTpPeriod(p) && c.tempo !== "TP") return;
        const primary = classCellLesson(data, c.id, day, p);
        if (primary === "MENSA") {
          ctx.fillStyle = "#111";
          ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText("MENSA", x + colW / 2, yy + (withSubjects ? 22 : 16));
          return;
        }
        if (!primary) return;
        const t = data.teachers.find((x) => x.id === primary.teacherId);
        ctx.fillStyle = "#111";
        ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
        if (subjectsOnly) {
          ctx.fillText(schoolSubjectLabel(primary.subject), x + colW / 2, yy + 16);
        } else if (withSubjects && t) {
          ctx.font = "700 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText(teacherSheetName(t, data.teachers), x + colW / 2, yy + 14);
          ctx.font = "500 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillText(subjectAbbr(primary.subject), x + colW / 2, yy + 28);
        } else if (t) {
          ctx.fillText(teacherSheetName(t, data.teachers), x + colW / 2, yy + 16);
        }
      });
      const dx = x0 + dayW + hourW + classes.length * colW;
      box(dx, yy, dispW, rowH);
      const onDisp = dispNamesAt(data, day, p.id);
      if (subjectsOnly) {
        if (onDisp.length) {
          ctx.fillStyle = "#111";
          ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillText("X", dx + dispW / 2, yy + 16);
        }
      } else {
        drawDispNames(ctx, onDisp, dx, yy, dispW, rowH);
      }
      side.forEach((t, i) => {
        const sx = dx + dispW + i * sosW;
        box(sx, yy, sosW, rowH);
        const mark = sideMark(data, t.id, day, p.id);
        if (!mark) return;
        if (mark === "block") {
          ctx.fillStyle = "#111";
          const m = 4;
          ctx.fillRect(sx + m, yy + m, sosW - m * 2, rowH - m * 2);
          return;
        }
        ctx.fillStyle = "#111";
        ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(mark, sx + sosW / 2, yy + (withSubjects ? 22 : 16));
      });
    });
    y += blockH;
  });

  let fy = y + 12;
  if (!subjectsOnly && sos.length > 0) {
    fy = drawLabeledCaption(
      ctx,
      "Sostegno",
      sos.map((t) => {
        const name = teacherSheetName(t, data.teachers);
        const cl = sostegnoClassLabel(data, t);
        return cl ? `${name} ${cl}` : name;
      }),
      x0,
      fy,
      tableW,
      true,
    );
  }
  if (!subjectsOnly && pot.length > 0) {
    drawLabeledCaption(
      ctx,
      "Potenziamento",
      pot.map((t) => teacherSheetName(t, data.teachers)),
      x0,
      fy,
      tableW,
      sos.length === 0,
    );
  }

  return canvasToJpeg(canvas);
}

const ECCEDENTE_COLS = [
  { label: "Data", share: 0.16 },
  { label: "Docente", share: 0.34 },
  { label: "Classe", share: 0.14 },
  { label: "Ora", share: 0.1 },
  { label: "Dalle", share: 0.13 },
  { label: "Alle", share: 0.13 },
];

/** Foglio ore eccedenti, stesso impianto del settimanale: titolo centrato, fascia crema, griglia nera. */
export async function eccedenteJpegs(
  data: PersistedData,
  from: string,
  to: string,
): Promise<{ blob: Blob; w: number; h: number }[]> {
  await document.fonts.ready.catch(() => undefined);
  const lines = eccedenteLines(data, from, to);
  const pageW = 842;
  const pageH = 595;
  const padX = 16;
  const padY = 14;
  const titleH = 56;
  const headH = 22;
  const rowH = 18;
  const tableW = pageW - padX * 2;
  const slots = Math.max(1, Math.floor((pageH - padY * 2 - titleH - headH) / rowH));
  const chunks = lines.length === 0 ? [[]] : Array.from({ length: Math.ceil(lines.length / slots) }, (_, i) => lines.slice(i * slots, (i + 1) * slots));
  const widths = ECCEDENTE_COLS.map((col) => col.share * tableW);
  const out: { blob: Blob; w: number; h: number }[] = [];

  for (const chunk of chunks) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(pageW * SHEET_DPR);
    canvas.height = Math.round(pageH * SHEET_DPR);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.scale(SHEET_DPR, SHEET_DPR);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, pageW, pageH);
    drawSheetHeading(ctx, data, pageW, padY, "ORE ECCEDENTI");

    const headY = padY + titleH;
    let x = padX;
    ctx.fillStyle = "#eee8dc";
    ctx.fillRect(padX, headY, tableW, headH);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.7;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111";
    ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
    ECCEDENTE_COLS.forEach((col, i) => {
      const w = widths[i] ?? 0;
      ctx.strokeRect(x, headY, w, headH);
      ctx.fillText(col.label, x + w / 2, headY + headH / 2 + 0.6);
      x += w;
    });

    if (chunk.length === 0) {
      ctx.font = "500 11px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillText("Nessuna ora eccedente.", pageW / 2, headY + headH + 28);
    } else {
      chunk.forEach((line, ri) => {
        const y = headY + headH + ri * rowH;
        const values = [formatItDate(line.date), line.teacher, line.className, line.hour, line.from, line.to];
        let cx = padX;
        values.forEach((value, i) => {
          const w = widths[i] ?? 0;
          ctx.strokeRect(cx, y, w, rowH);
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx + 2, y, w - 4, rowH);
          ctx.clip();
          ctx.font = "600 9px 'Source Sans 3', system-ui, sans-serif";
          ctx.fillStyle = "#111";
          ctx.fillText(value, cx + w / 2, y + rowH / 2 + 0.6);
          ctx.restore();
          cx += w;
        });
      });
    }
    out.push({ blob: await canvasToJpeg(canvas), w: canvas.width, h: canvas.height });
  }
  return out;
}

export { teachersOnTimetable };

