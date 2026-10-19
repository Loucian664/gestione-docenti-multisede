import {
  addDays,
  addMonths,
  format,
  getDay,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { it } from "date-fns/locale";
import type { DayOfWeek } from "./types";

export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parseDate(iso: string): Date {
  return startOfDay(parseISO(iso));
}

export function formatLong(iso: string): string {
  return format(parseDate(iso), "EEEE d MMMM yyyy", { locale: it });
}

export function formatDayMonth(iso: string): string {
  return format(parseDate(iso), "EEEE d MMMM", { locale: it });
}

export function formatMedium(iso: string): string {
  return format(parseDate(iso), "EEE d MMM", { locale: it });
}

export function formatDayName(iso: string): string {
  return format(parseDate(iso), "EEEE", { locale: it });
}

export function formatItDate(iso: string): string {
  return format(parseDate(iso), "dd/MM/yyyy");
}

export function formatItFileDate(iso: string): string {
  return format(parseDate(iso), "dd-MM-yyyy");
}

export function formatMonthYear(iso: string): string {
  return format(parseDate(iso), "MMMM yyyy", { locale: it });
}

export function toSchoolDay(iso: string): DayOfWeek | null {
  const d = getDay(parseDate(iso));
  if (d === 0) return null;
  return d as DayOfWeek;
}

export function isWeekend(iso: string, schoolDays: DayOfWeek[]): boolean {
  const day = toSchoolDay(iso);
  return day === null || !schoolDays.includes(day);
}

export function nextSchoolDay(iso: string, schoolDays: DayOfWeek[]): string {
  let d = parseDate(iso);
  for (let i = 0; i < 14; i++) {
    const id = isoDate(d);
    if (!isWeekend(id, schoolDays)) return id;
    d = addDays(d, 1);
  }
  return iso;
}

export function shiftSchoolDay(iso: string, dir: number, schoolDays: DayOfWeek[]): string {
  let d = addDays(parseDate(iso), dir);
  for (let i = 0; i < 14; i++) {
    const id = isoDate(d);
    if (!isWeekend(id, schoolDays)) return id;
    d = addDays(d, dir);
  }
  return iso;
}

export function dateInRange(iso: string, from: string, to: string): boolean {
  const d = parseDate(iso);
  return isWithinInterval(d, { start: parseDate(from), end: parseDate(to) });
}

export function eachIsoInRange(from: string, to: string): string[] {
  const start = parseDate(from <= to ? from : to);
  const end = parseDate(from <= to ? to : from);
  const out: string[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    out.push(isoDate(d));
  }
  return out;
}

export function monthRange(iso: string): { from: string; to: string } {
  const d = parseDate(iso);
  return { from: isoDate(startOfMonth(d)), to: isoDate(endOfMonth(d)) };
}

export function weekStartIso(iso: string): string {
  return isoDate(startOfWeek(parseDate(iso), { weekStartsOn: 1 }));
}

export function weekDaysIso(iso: string, count = 5): string[] {
  const start = parseDate(weekStartIso(iso));
  return Array.from({ length: count }, (_, i) => isoDate(addDays(start, i)));
}

export function monthCalendarDays(iso: string): string[] {
  const d = parseDate(iso);
  const start = startOfWeek(startOfMonth(d), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(d), { weekStartsOn: 1 });
  const days: string[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) {
    days.push(isoDate(x));
  }
  return days;
}

/**
 * Il mese a settimane per il calendario delle assenze: da lunedì a venerdì, o a sabato se è giorno di
 * scuola; la domenica mai. Le settimane che restano senza giorni del mese si tolgono.
 */
export function monthSchoolDays(iso: string, withSaturday: boolean): string[] {
  const all = monthCalendarDays(iso);
  const perWeek = withSaturday ? 6 : 5;
  const out: string[] = [];
  for (let i = 0; i < all.length; i += 7) {
    const week = all.slice(i, i + perWeek);
    if (week.some((x) => sameMonth(x, iso))) out.push(...week);
  }
  return out;
}

export function shiftMonth(iso: string, dir: number): string {
  return isoDate(addMonths(parseDate(iso), dir));
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function todayIso(): string {
  return isoDate(new Date());
}

/** A new opening of the app always lands on today. */
export function dateOnLaunch(today = todayIso()): string {
  return today;
}

/** App left open overnight: if the chosen day is in the past, jump to today. */
export function dateOnResume(saved: string, today = todayIso()): string {
  return saved < today ? today : saved;
}

/** Anno scolastico italiano: 1 settembre → 31 agosto. Accetta "2026/2027". */
export function schoolYearRange(label: string, fallbackIso = todayIso()): { from: string; to: string } {
  const m = label.match(/(20\d{2})\s*[/\-–]\s*(20\d{2})/);
  if (m) return { from: `${m[1]}-09-01`, to: `${m[2]}-08-31` };
  const y = Number(fallbackIso.slice(0, 4));
  const month = Number(fallbackIso.slice(5, 7));
  const start = month >= 9 ? y : y - 1;
  return { from: `${start}-09-01`, to: `${start + 1}-08-31` };
}

/** L’anno dopo: "2026/2027" → "2027/2028" (il resto del testo non cambia). Senza un anno riconoscibile, quello dell’anno solare. */
export function nextSchoolYear(label: string, fallbackIso = todayIso()): string {
  const re = /(20\d{2})(\s*[/\-–]\s*)(20\d{2})/;
  if (re.test(label)) return label.replace(re, (_, a: string, sep: string, b: string) => `${Number(a) + 1}${sep}${Number(b) + 1}`).trim();
  const { from } = schoolYearRange("", fallbackIso);
  const y = Number(from.slice(0, 4)) + 1;
  return `${y}/${y + 1}`;
}
