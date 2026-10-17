import type { Period, PersistedData, Settings, Tempo } from "./types";

export const TP_PERIODS: Period[] = [
  { id: "p-mensa", index: 7, label: "Mensa", start: "14:00", end: "14:45", tpOnly: true },
  { id: "p7", index: 8, label: "7ª ora", start: "14:45", end: "15:35", tpOnly: true },
  { id: "p8", index: 9, label: "8ª ora", start: "15:35", end: "16:25", tpOnly: true },
];

export function isTpPeriod(p: Period | undefined): boolean {
  return Boolean(p?.tpOnly);
}

export function isTpPeriodId(periods: Period[], periodId: string): boolean {
  return isTpPeriod(periods.find((p) => p.id === periodId));
}

export function isMensaPeriod(p: Period | undefined): boolean {
  if (!p) return false;
  return p.id === "p-mensa" || /mensa/i.test(p.id) || /mensa/i.test(p.label ?? "");
}

/** 7ª / 8ª: solo classi T.P. La fascia 14:00 (mensa o lezione) è per tutte. */
export function isRestrictedTpPeriod(p: Period | undefined): boolean {
  return isTpPeriod(p) && !isMensaPeriod(p);
}

export function isMensaLesson(slot?: { subject?: string } | null): boolean {
  return Boolean(slot?.subject && /mensa/i.test(slot.subject));
}

export function isMensaSlot(
  period: Period | undefined,
  slot?: { periodId?: string; subject?: string },
): boolean {
  if (isMensaPeriod(period)) return true;
  if (slot?.periodId && /mensa/i.test(slot.periodId)) return true;
  if (slot?.subject && /mensa/i.test(slot.subject)) return true;
  return false;
}

export function corePeriods(periods: Period[]): Period[] {
  return periods.filter((p) => !p.tpOnly);
}

export function extraTpPeriods(settings: Settings): Period[] {
  const fromSettings = settings.periods.filter((p) => p.tpOnly);
  if (fromSettings.length > 0) return [...fromSettings].sort((a, b) => a.index - b.index);
  return TP_PERIODS;
}

export function ensureTpPeriods(periods: Period[]): Period[] {
  const ids = new Set(periods.map((p) => p.id));
  const missing = TP_PERIODS.filter((p) => !ids.has(p.id));
  if (missing.length === 0) return periods;
  return [...periods, ...missing];
}

export function visiblePeriods(settings: Settings, tempo?: Tempo): Period[] {
  const core = corePeriods(settings.periods);
  if (!settings.tpAfternoon) return core;
  const extra = extraTpPeriods(settings);
  if (tempo === "TN") return [...core, ...extra.filter(isMensaPeriod)];
  return [...core, ...extra];
}

export function lessonPeriodsOf(data: PersistedData): Period[] {
  return corePeriods(data.settings.periods);
}

export function hourMark(p: Period): string {
  if (isMensaPeriod(p)) return "M";
  if (p.id === "p7") return "7";
  if (p.id === "p8") return "8";
  return String(p.index);
}
