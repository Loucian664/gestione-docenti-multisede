import type {
  Absence,
  AbsenceReason,
  DayOfWeek,
  PersistedData,
  Substitution,
  SubstitutionType,
  Teacher,
  TimetableSlot,
} from "./types";
import { ABSENCE_REASONS } from "./types";
import { dateInRange, eachIsoInRange, isWeekend, monthRange, toSchoolDay } from "./dates";
import { findAnyTeacher } from "./replace-teacher";
import { isMensaPeriod } from "./periods";
import { subjectParts } from "./subject-groups";

export type CoverageNeed = {
  key: string;
  date: string;
  slot: TimetableSlot;
  absence: Absence;
  substitution: Substitution | null;
};

export function teacherName(t: Teacher): string {
  return `${t.lastName} ${t.firstName}`;
}

function firstStamp(firstName: string, letterCount: number): string {
  const parts = firstName.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts.map((p) => p.charAt(0).toUpperCase()).join(".")}.`;
  }
  const word = parts[0] ?? "";
  const n = Math.min(Math.max(letterCount, 1), word.length);
  const chunk = word.slice(0, n);
  return n === 1 ? `${chunk}.` : `${chunk}.`;
}

/** "Rossi A." se è unico; iniziali del nome più lunghe se lo stesso cognome collide. */
export function teacherShort(t: Teacher, all: readonly Teacher[] = []): string {
  const last = t.lastName;
  const first = t.firstName.trim();
  const same = all.filter((x) => x.lastName === last);
  const peers = same.length > 0 ? same : [t];
  const lengths = [1, 3, 4, 5, 6, 8, 12];
  for (const n of lengths) {
    const labels = peers.map((x) => firstStamp(x.firstName, n));
    const mine = firstStamp(first, n);
    if (labels.filter((l) => l === mine).length === 1) {
      return `${last} ${mine}`;
    }
  }
  return `${last} ${first}`;
}

/** Riepilogo sostituzioni: solo il cognome; parte del nome solo se ce ne sono due uguali. */
export function teacherSurname(t: Teacher, all: readonly Teacher[] = []): string {
  const peers = all.filter((x) => x.lastName === t.lastName);
  if (peers.length <= 1) return t.lastName;
  return teacherShort(t, all);
}

export function absencesOnDate(data: PersistedData, date: string): Absence[] {
  return data.absences.filter((a) => dateInRange(date, a.dateFrom, a.dateTo));
}

function periodMark(label: string): string {
  return label.match(/\d+ª/)?.[0] ?? label;
}

export function isTeacherAbsent(
  data: PersistedData,
  teacherId: string,
  date: string,
  periodId: string,
): boolean {
  return absencesOnDate(data, date).some((a) => {
    if (a.teacherId !== teacherId) return false;
    if (a.allDay) return true;
    return a.periodIds.includes(periodId);
  });
}

export function coverageNeeds(data: PersistedData, date: string): CoverageNeed[] {
  const day = toSchoolDay(date);
  if (!day || !data.settings.days.includes(day)) return [];
  const absences = absencesOnDate(data, date);
  const needs: CoverageNeed[] = [];

  for (const absence of absences) {
    // chi non è più in servizio: le sue ore sono quelle della scheda passata a chi l'ha sostituito
    const former = data.formerTeachers?.find((t) => t.id === absence.teacherId);
    const teacher = former ?? data.teachers.find((t) => t.id === absence.teacherId);
    if (teacher?.role === "sostegno") continue;
    const owner = former?.replacedBy ?? absence.teacherId;
    const slots = data.slots.filter((s) => {
      if (s.day !== day || s.teacherId !== owner) return false;
      if (!absence.allDay && !absence.periodIds.includes(s.periodId)) return false;
      return true;
    });
    for (const slot of slots) {
      const substitution =
        data.substitutions.find(
          (x) =>
            x.date === date &&
            x.periodId === slot.periodId &&
            x.classId === slot.classId &&
            x.absentTeacherId === absence.teacherId,
        ) ?? null;
      needs.push({
        key: `${date}-${slot.id}-${absence.id}`,
        date,
        slot,
        absence,
        substitution,
      });
    }
  }

  const periodOrder = new Map(data.settings.periods.map((p) => [p.id, p.index]));
  needs.sort((a, b) => {
    const pa = periodOrder.get(a.slot.periodId) ?? 0;
    const pb = periodOrder.get(b.slot.periodId) ?? 0;
    if (pa !== pb) return pa - pb;
    return a.slot.classId.localeCompare(b.slot.classId);
  });
  return needs;
}

export function isShiftType(type: SubstitutionType | null | undefined): boolean {
  return type === "entra" || type === "esce" || type === "non_entra";
}

export function isCovered(need: CoverageNeed): boolean {
  const sub = need.substitution;
  if (!sub) return false;
  if (sub.type === "divisione" || isShiftType(sub.type)) return true;
  return Boolean(sub.substituteId);
}

export type ClassShift = {
  classId: string;
  kind: "entra" | "esce" | "non_entra";
  /** «entra alla 5ª», «esce alla 3ª», «non entra». */
  phrase: string;
  needs: CoverageNeed[];
  applied: boolean;
};

/** Ore vuote di fila in testa o in coda: la classe entra dopo, esce prima, o non entra.
 *  Entra dopo o esce prima solo se chi tiene la classe manca per assemblea sindacale. */
export function classShifts(data: PersistedData, date: string): ClassShift[] {
  const day = toSchoolDay(date);
  if (!day) return [];
  const needs = coverageNeeds(data, date);

  function holdsClass(teacherId: string): boolean {
    const teacher = data.teachers.find((t) => t.id === teacherId);
    return teacher?.role !== "sostegno" && teacher?.role !== "potenziamento";
  }

  function lessonSlots(classId: string, periodId: string) {
    return cellSlots(data, classId, day!, periodId).filter((slot) => holdsClass(slot.teacherId));
  }

  function voidPeriod(classId: string, periodId: string): boolean {
    const slots = lessonSlots(classId, periodId);
    if (slots.length === 0) return false;
    const hourNeeds = needs.filter((n) => n.slot.classId === classId && n.slot.periodId === periodId);
    for (const slot of slots) {
      const need = hourNeeds.find((n) => n.slot.teacherId === slot.teacherId);
      if (!need) return false;
      if (need.substitution?.substituteId) return false;
      if (need.substitution?.type === "divisione") return false;
    }
    return true;
  }

  function assemblyVoid(classId: string, periodId: string): boolean {
    if (!voidPeriod(classId, periodId)) return false;
    const hourNeeds = needs.filter((n) => {
      if (n.slot.classId !== classId || n.slot.periodId !== periodId) return false;
      return holdsClass(n.slot.teacherId);
    });
    return hourNeeds.length > 0 && hourNeeds.every((n) => n.absence.reason === "assemblea_sindacale");
  }

  const out: ClassShift[] = [];
  const classIds = [...new Set(data.slots.filter((s) => s.day === day).map((s) => s.classId))];
  for (const classId of classIds) {
    const periodIds = [
      ...new Set(
        data.slots
          .filter((s) => s.day === day && s.classId === classId && lessonSlots(s.classId, s.periodId).length > 0)
          .map((s) => s.periodId),
      ),
    ];
    periodIds.sort((a, b) => periodIndex(data, a) - periodIndex(data, b));
    const states = periodIds.map((periodId) => ({ periodId, void: voidPeriod(classId, periodId) }));
    if (!states.some((s) => s.void)) continue;
    let lead = 0;
    while (lead < states.length && assemblyVoid(classId, states[lead].periodId)) lead += 1;
    let trail = 0;
    while (trail < states.length - lead && assemblyVoid(classId, states[states.length - 1 - trail].periodId)) trail += 1;

    const push = (kind: ClassShift["kind"], slice: { periodId: string }[], phrase: string) => {
      const ids = new Set(slice.map((s) => s.periodId));
      const blockNeeds = needs.filter((n) => {
        if (n.slot.classId !== classId || !ids.has(n.slot.periodId)) return false;
        const teacher = data.teachers.find((t) => t.id === n.slot.teacherId);
        return teacher?.role !== "sostegno" && teacher?.role !== "potenziamento";
      });
      if (blockNeeds.length === 0) return;
      out.push({
        classId,
        kind,
        phrase,
        needs: blockNeeds,
        applied: blockNeeds.every((n) => n.substitution?.type === kind),
      });
    };

    if (lead === states.length) {
      push("non_entra", states, "non entra");
      continue;
    }
    if (lead > 0) {
      const label = data.settings.periods.find((p) => p.id === states[lead].periodId)?.label ?? "";
      push("entra", states.slice(0, lead), `entra alla ${periodMark(label)}`);
    }
    if (trail > 0) {
      const kept = states[states.length - 1 - trail];
      const label = data.settings.periods.find((p) => p.id === kept.periodId)?.label ?? "";
      push("esce", states.slice(states.length - trail), `esce alla ${periodMark(label)}`);
    }
  }

  const name = (id: string) => data.classes.find((c) => c.id === id)?.name ?? id;
  const order = { entra: 0, esce: 1, non_entra: 2 };
  out.sort((a, b) => name(a.classId).localeCompare(name(b.classId), "it") || order[a.kind] - order[b.kind]);
  return out;
}

export type SubstituteBucket =
  | "disp"
  | "buco"
  | "sostegno-qui"
  | "sostegno-libera"
  | "pre-post"
  | "potenziamento"
  | "in-sede"
  | "senza-orario"
  | "sostegno"
  | "impegnato"
  /** sta già sostituendo in un'altra classe nella stessa ora: sarebbe in due classi insieme */
  | "in-copertura"
  | "non-in-sede"
  /** potenziamento non in servizio in quell'ora: va avvisato di spostare l'orario */
  | "fuori-orario"
  /** ora segnata altrove o in un progetto: non chiamabile */
  | "altrove";

export type RankedSubstitute = {
  teacher: Teacher;
  score: number;
  reasons: string[];
  monthCount: number;
  inferredType: SubstitutionType;
  onSite: boolean;
  presence: string;
  bucket: SubstituteBucket;
  busyLabel?: string;
  hole: boolean;
  alreadyCovering: boolean;
  /** ha lezione in un'altra sede l'ora prima o l'ora dopo: serve il tempo per spostarsi (solo con più sedi) */
  travel?: string;
};

function periodIndex(data: PersistedData, periodId: string): number {
  return data.settings.periods.find((p) => p.id === periodId)?.index ?? 0;
}

function periodLabel(data: PersistedData, index: number): string {
  return data.settings.periods.find((p) => p.index === index)?.label ?? `${index}ª`;
}

export function teacherDayWindow(
  data: PersistedData,
  teacherId: string,
  day: DayOfWeek,
): { first: number; last: number } | null {
  const indexes: number[] = [];
  for (const s of data.slots) {
    if (s.day !== day) continue;
    if (s.teacherId !== teacherId) continue;
    const p = data.settings.periods.find((x) => x.id === s.periodId);
    if (isMensaPeriod(p)) continue;
    indexes.push(periodIndex(data, s.periodId));
  }
  if (indexes.length === 0) return null;
  return { first: Math.min(...indexes), last: Math.max(...indexes) };
}

export function isDispHour(
  teacher: Teacher,
  day: DayOfWeek,
  periodId: string,
): boolean {
  return (teacher.dispSlots ?? []).some((a) => a.day === day && a.periodId === periodId);
}

/** L'ora segnata «altrove» o «progetto»: il docente non è a scuola e non si chiama per le sostituzioni. */
export function awayAt(
  teacher: Teacher,
  day: DayOfWeek,
  periodId: string,
): { progetto: boolean; sede?: string } | null {
  const hit = (teacher.awaySlots ?? []).find((a) => a.day === day && a.periodId === periodId);
  if (!hit) return null;
  const sede = hit.progetto ? hit.sede?.trim() : undefined;
  return { progetto: Boolean(hit.progetto), ...(sede && { sede }) };
}

/**
 * Il potenziamento in quel giorno: prima e ultima ora di servizio (lezioni e ore in sede).
 * Fuori da queste ore va avvisato di spostare l'orario.
 */
function serviceWindow(
  data: PersistedData,
  teacher: Teacher,
  day: DayOfWeek,
): { first: number; last: number } | null {
  const lessons = teacherDayWindow(data, teacher.id, day);
  const indexes = (teacher.dispSlots ?? [])
    .filter((a) => a.day === day)
    .map((a) => periodIndex(data, a.periodId));
  if (lessons) indexes.push(lessons.first, lessons.last);
  if (indexes.length === 0) return null;
  return { first: Math.min(...indexes), last: Math.max(...indexes) };
}

export function presenceFor(
  data: PersistedData,
  teacherId: string,
  day: DayOfWeek,
  periodId: string,
): { onSite: boolean; label: string } {
  const idx = periodIndex(data, periodId);
  const teacher = data.teachers.find((t) => t.id === teacherId);
  if (teacher && isDispHour(teacher, day, periodId)) {
    return { onSite: true, label: "A disposizione" };
  }
  const win = teacherDayWindow(data, teacherId, day);
  if (!win) return { onSite: false, label: "Senza orario oggi" };
  if (idx < win.first) return { onSite: false, label: `Entra alla ${periodLabel(data, win.first)}` };
  if (idx > win.last) return { onSite: false, label: `Esce dopo la ${periodLabel(data, win.last)}` };
  if (win.first === win.last) return { onSite: true, label: `In sede in ${periodLabel(data, win.first)}` };
  return { onSite: true, label: `In sede ${periodLabel(data, win.first)}–${periodLabel(data, win.last)}` };
}

export function freeTeachers(
  data: PersistedData,
  date: string,
  periodId: string,
  alreadyUsed: Set<string> = new Set(),
): Teacher[] {
  const day = toSchoolDay(date);
  if (!day) return [];
  const busy = new Set(
    data.slots.filter((s) => s.day === day && s.periodId === periodId).map((s) => s.teacherId),
  );
  const covering = new Set(
    data.substitutions
      .filter((s) => s.date === date && s.periodId === periodId && s.substituteId)
      .map((s) => s.substituteId as string),
  );
  return data.teachers.filter((t) => {
    if (alreadyUsed.has(t.id) || covering.has(t.id)) return false;
    if (busy.has(t.id) && t.role !== "potenziamento") return false;
    if (isTeacherAbsent(data, t.id, date, periodId)) return false;
    if (awayAt(t, day, periodId)) return false;
    return true;
  });
}

export function monthSubCounts(data: PersistedData, date: string): Record<string, number> {
  const { from, to } = monthRange(date);
  const counts: Record<string, number> = {};
  for (const s of data.substitutions) {
    if (!s.substituteId) continue;
    if (s.date < from || s.date > to) continue;
    counts[s.substituteId] = (counts[s.substituteId] ?? 0) + 1;
  }
  return counts;
}

export function cellSlots(
  data: PersistedData,
  classId: string,
  day: DayOfWeek,
  periodId: string,
): TimetableSlot[] {
  return data.slots.filter((s) => s.classId === classId && s.day === day && s.periodId === periodId);
}

/** Ora di sostegno: per il ruolo del docente o per la materia. */
export function isSostegnoSlot(data: PersistedData, slot: TimetableSlot): boolean {
  const teacher = data.teachers.find((t) => t.id === slot.teacherId);
  return teacher?.role === "sostegno" || /sostegno/i.test(slot.subject);
}

/**
 * Le ore nella casella di una classe: prima chi tiene la classe, poi il potenziamento, per ultimo il
 * sostegno. Non dipende dall'ordine in cui le ore sono salvate.
 */
export function classCellSlots(
  data: PersistedData,
  classId: string,
  day: DayOfWeek,
  periodId: string,
): TimetableSlot[] {
  const rank = (s: TimetableSlot) => {
    if (isSostegnoSlot(data, s)) return 2;
    const teacher = data.teachers.find((t) => t.id === s.teacherId);
    return teacher && isPotenziamentoSlot(teacher, s) ? 1 : 0;
  };
  return cellSlots(data, classId, day, periodId)
    .map((slot, i) => ({ slot, i, r: rank(slot) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.slot);
}

/**
 * Le lezioni da scrivere nella casella di una classe (fogli, foto, PDF, Excel): mai il sostegno, che
 * ha le sue colonne; il potenziamento solo se in quell'ora non c'è chi tiene la classe.
 */
export function classLessonSlots(
  data: PersistedData,
  classId: string,
  day: DayOfWeek,
  periodId: string,
): TimetableSlot[] {
  return classCellSlots(data, classId, day, periodId).filter((s) => !isSostegnoSlot(data, s));
}

export function teacherSlotAt(
  data: PersistedData,
  teacherId: string,
  day: DayOfWeek,
  periodId: string,
): TimetableSlot | undefined {
  return data.slots.find((s) => s.teacherId === teacherId && s.day === day && s.periodId === periodId);
}

export function defaultSubjectFor(teacher: Teacher): string {
  if (teacher.role === "potenziamento") return teacher.subjects[0] || "Potenziamento";
  if (teacher.role === "sostegno") return teacher.subjects[0] || "Sostegno";
  return teacher.subjects[0] || "Italiano";
}

export function teachesClass(data: PersistedData, teacherId: string, classId: string): boolean {
  return data.slots.some((s) => s.teacherId === teacherId && s.classId === classId);
}

function isPotenziamentoSlot(teacher: Teacher, slot: TimetableSlot | undefined): boolean {
  if (teacher.role === "potenziamento") return true;
  if (!slot) return false;
  return slot.subject.toLowerCase().includes("potenziamento");
}

const BUCKET_ORDER: Record<SubstituteBucket, number> = {
  disp: -1,
  buco: 0,
  "sostegno-qui": 1,
  "sostegno-libera": 2,
  "pre-post": 3,
  potenziamento: 4,
  "in-sede": 5,
  "senza-orario": 6,
  impegnato: 7,
  sostegno: 8,
  "non-in-sede": 9,
  "fuori-orario": 10,
  altrove: 11,
  "in-copertura": 12,
};

/**
 * Dove sta già un docente in quell'ora in un'altra sede (null se è libero). Lo passa solo l'app con più sedi:
 * chi ha lezione, è a disposizione, sostituisce o è assente in un'altra sede non può sostituire qui.
 */
export type ElsewhereCheck = ((teacherId: string, date: string, periodId: string) => string | null) & {
  /**
   * Chi in quell'ora è libero ma ha un impegno in un'altra sede l'ora prima o l'ora dopo: serve il tempo per
   * spostarsi, come in Costruisci. Va in fondo al suo gruppo e fuori dall'assegnazione automatica.
   */
  near?: (teacherId: string, date: string, periodId: string) => string | null;
};

export function rankSubstitutes(
  data: PersistedData,
  need: CoverageNeed,
  alreadyUsed: Set<string> = new Set(),
  elsewhere?: ElsewhereCheck,
): RankedSubstitute[] {
  const counts = monthSubCounts(data, need.date);
  const day = toSchoolDay(need.date);
  if (!day) return [];
  const skipped = new Map<string, string>();
  for (const shift of classShifts(data, need.date)) {
    if (!shift.applied) continue;
    if (!shift.needs.some((n) => n.slot.periodId === need.slot.periodId)) continue;
    skipped.set(shift.classId, shift.phrase);
  }

  const idx = periodIndex(data, need.slot.periodId);
  // chi sostituisce già in un'altra classe in quest'ora (nella stessa classe non conta: è la stessa ora da coprire)
  const coveringThisHour = new Map<string, string>();
  for (const s of data.substitutions) {
    if (s.date !== need.date || s.periodId !== need.slot.periodId || !s.substituteId) continue;
    if (s.classId === need.slot.classId || isShiftType(s.type) || s.type === "divisione") continue;
    if (!coveringThisHour.has(s.substituteId)) coveringThisHour.set(s.substituteId, s.classId);
  }

  const pool = data.teachers.filter((t) => t.id !== need.absence.teacherId);

  return pool
    .map((teacher) => {
      const reasons: string[] = [];
      let score = 0;
      let inferredType: SubstitutionType = "eccedente";
      const presence = presenceFor(data, teacher.id, day, need.slot.periodId);
      const win = teacherDayWindow(data, teacher.id, day);
      const occupation = teacherSlotAt(data, teacher.id, day, need.slot.periodId);
      const occupyingHere = occupation?.classId === need.slot.classId;
      const occupyingElse = Boolean(occupation && occupation.classId !== need.slot.classId);
      const pullable = isPotenziamentoSlot(teacher, occupation);
      const clsElse = occupyingElse
        ? data.classes.find((c) => c.id === occupation!.classId)
        : undefined;
      const busyCattedra = occupyingElse && !pullable;
      const otherSede = elsewhere?.(teacher.id, need.date, need.slot.periodId) ?? null;
      const travel = otherSede ? null : (elsewhere?.near?.(teacher.id, need.date, need.slot.periodId) ?? null);
      const alreadyCovering = coveringThisHour.has(teacher.id) || alreadyUsed.has(teacher.id);
      const coveringClass = data.classes.find((c) => c.id === coveringThisHour.get(teacher.id));
      const isSostegno = teacher.role === "sostegno";
      const hole =
        !isSostegno &&
        Boolean(win) &&
        idx > (win?.first ?? 0) &&
        idx < (win?.last ?? 0) &&
        !occupation &&
        !isTeacherAbsent(data, teacher.id, need.date, need.slot.periodId);
      const arriveEarly = Boolean(win) && idx === (win?.first ?? 0) - 1 && !occupation;
      const stayLate = Boolean(win) && idx === (win?.last ?? 0) + 1 && !occupation;
      const adjacent = !isSostegno && (arriveEarly || stayLate);

      let onSite = presence.onSite;
      let bucket: SubstituteBucket;
      let busyLabel: string | undefined;

      if (isTeacherAbsent(data, teacher.id, need.date, need.slot.periodId)) {
        bucket = "non-in-sede";
        onSite = false;
        score -= 80;
        reasons.push("Assente");
        inferredType = "eccedente";
      } else if (awayAt(teacher, day, need.slot.periodId)) {
        bucket = "altrove";
        onSite = false;
        score -= 100;
        reasons.push(awayAt(teacher, day, need.slot.periodId)!.progetto ? "In progetto" : "Altrove");
        inferredType = "eccedente";
      } else if (otherSede) {
        // in un'altra sede nella stessa ora: ancora più impossibilitato che in un'altra classe
        bucket = "altrove";
        onSite = false;
        score -= 100;
        busyLabel = otherSede;
        reasons.push(otherSede);
        inferredType = "eccedente";
      } else if (isSostegno && occupyingHere) {
        bucket = "sostegno-qui";
        onSite = true;
        score += 70;
        inferredType = "sostegno";
        reasons.push("Già in questa classe");
      } else if (isSostegno && occupyingElse && skipped.has(occupation!.classId)) {
        bucket = "sostegno-libera";
        onSite = true;
        score += 66;
        inferredType = "sostegno";
        reasons.push(`Libero: ${clsElse?.name ?? "la classe"} ${skipped.get(occupation!.classId)}`);
      } else if (isSostegno) {
        bucket = "sostegno";
        onSite = false;
        score -= 8;
        inferredType = "sostegno";
        if (occupyingHere) {
          reasons.push("Sostegno in questa classe");
        } else if (occupyingElse) {
          busyLabel = `In ${clsElse?.name ?? "altra classe"} · ${occupation!.subject}`;
          reasons.push(busyLabel);
        } else if (!win) {
          reasons.push("Sostegno — non in automatico");
        } else {
          reasons.push(presence.label);
        }
      } else if (occupyingHere) {
        onSite = true;
        bucket = "in-sede";
        score += 48;
        reasons.push("Già in classe");
        inferredType = teacher.role === "potenziamento" ? "potenziamento" : "compresenza";
      } else if (isDispHour(teacher, day, need.slot.periodId) && !occupation) {
        onSite = true;
        bucket = "disp";
        score += 95;
        reasons.push("Ora a disposizione");
        inferredType = "disposizione";
      } else if (teacher.role === "potenziamento" && !occupation) {
        bucket = "fuori-orario";
        onSite = false;
        score += 20;
        inferredType = "potenziamento";
        const sw = serviceWindow(data, teacher, day);
        if (!sw) {
          reasons.push("Oggi non in servizio");
        } else if (idx === sw.first - 1) {
          reasons.push("Entrerebbe un’ora prima");
        } else if (idx === sw.last + 1) {
          reasons.push("Uscirebbe un’ora dopo");
        } else if (idx > sw.first && idx < sw.last) {
          reasons.push("Ora libera tra le sue ore");
        } else {
          reasons.push(
            sw.first === sw.last
              ? `In servizio solo alla ${periodLabel(data, sw.first)}`
              : `In servizio dalla ${periodLabel(data, sw.first)} alla ${periodLabel(data, sw.last)}`,
          );
        }
        reasons.unshift("Da avvisare");
      } else if (hole) {
        onSite = true;
        bucket = "buco";
        score += 80;
        reasons.push(`Buco in sede (${presence.label.replace("In sede ", "")})`);
        const hasBefore = data.slots.some(
          (s) => s.teacherId === teacher.id && s.day === day && periodIndex(data, s.periodId) === idx - 1,
        );
        const hasAfter = data.slots.some(
          (s) => s.teacherId === teacher.id && s.day === day && periodIndex(data, s.periodId) === idx + 1,
        );
        if (hasBefore && hasAfter) {
          score += 16;
          reasons.push("Tra due lezioni");
        }
        inferredType = teacher.role === "potenziamento" ? "potenziamento" : "disposizione";
      } else if (adjacent) {
        bucket = "pre-post";
        onSite = false;
        score += 62;
        if (arriveEarly) {
          reasons.push(`Può entrare un’ora prima (${presence.label})`);
        } else {
          reasons.push(`Può uscire un’ora dopo (${presence.label})`);
        }
        inferredType = "eccedente";
      } else if (teacher.role === "potenziamento" || pullable) {
        bucket = "potenziamento";
        onSite = true;
        score += 55;
        inferredType = "potenziamento";
        if (occupyingElse) {
          busyLabel = `Richiamabile da ${clsElse?.name ?? "altra classe"}`;
          reasons.push(busyLabel);
        } else {
          reasons.push(presence.label);
        }
      } else if (busyCattedra) {
        bucket = "impegnato";
        onSite = true;
        score -= 25;
        busyLabel = `In ${clsElse?.name ?? "altra classe"} · ${occupation!.subject}`;
        reasons.push(busyLabel);
        inferredType = "eccedente";
      } else if (!win) {
        const hasWeekly = data.slots.some((s) => s.teacherId === teacher.id);
        if (hasWeekly) {
          bucket = "non-in-sede";
          onSite = false;
          score -= 30;
          reasons.push("Non in orario oggi");
          inferredType = "eccedente";
        } else {
          bucket = "senza-orario";
          onSite = false;
          score += 6;
          reasons.push("Senza orario — selezionabile comunque");
          inferredType = "eccedente";
        }
      } else if (onSite) {
        bucket = "in-sede";
        score += 32;
        reasons.push(presence.label);
        inferredType = "disposizione";
      } else {
        bucket = "non-in-sede";
        score -= 40;
        reasons.push(presence.label);
        inferredType = "eccedente";
      }

      if (teachesClass(data, teacher.id, need.slot.classId) && teacher.role !== "sostegno" && !occupyingHere) {
        score += 24;
        reasons.push("Stessa classe");
      }
      if (subjectParts(need.slot.subject).some((part) => teacher.subjects.includes(part))) {
        score += 18;
        reasons.push("Stessa materia");
      }

      if (alreadyCovering && bucket !== "altrove") {
        // due classi insieme: in fondo all'elenco e con il motivo per primo, che non si perda tra gli altri
        score -= 60;
        bucket = "in-copertura";
        busyLabel = coveringClass ? `Sostituisce già in ${coveringClass.name}` : "Sostituisce già in un’altra classe";
        reasons.unshift(busyLabel);
      }

      if (travel && bucket !== "altrove") {
        // l'altra sede è vicina nel tempo: se lo si sceglie va avvisato, e non si assegna da soli
        score -= 30;
        reasons.unshift(travel);
      }

      const monthCount = counts[teacher.id] ?? 0;
      score += Math.max(0, 10 - monthCount * 2);
      if (monthCount > 0) reasons.push(`${monthCount} ore questo mese`);

      return {
        teacher,
        score,
        reasons,
        monthCount,
        inferredType,
        onSite,
        presence: presence.label,
        bucket,
        busyLabel,
        hole,
        alreadyCovering,
        ...(travel && bucket !== "altrove" ? { travel } : {}),
      };
    })
    .sort((a, b) => {
      const bo = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
      if (bo !== 0) return bo;
      return b.score - a.score || a.teacher.lastName.localeCompare(b.teacher.lastName, "it");
    });
}

export function autoAssignPlan(data: PersistedData, date: string, elsewhere?: ElsewhereCheck): Substitution[] {
  const needs = coverageNeeds(data, date).filter((n) => !isCovered(n));
  const usedByPeriod = new Map<string, Set<string>>();
  for (const n of coverageNeeds(data, date)) {
    if (n.substitution?.substituteId) {
      const used = usedByPeriod.get(n.slot.periodId) ?? new Set();
      used.add(n.substitution.substituteId);
      usedByPeriod.set(n.slot.periodId, used);
    }
  }
  const created: Substitution[] = [];

  for (const need of needs) {
    const used = usedByPeriod.get(need.slot.periodId) ?? new Set();
    const ranked = rankSubstitutes(data, need, used, elsewhere);
    const pick = ranked.find(
      (r) =>
        !used.has(r.teacher.id) &&
        !r.alreadyCovering &&
        !r.travel &&
        r.teacher.role !== "sostegno" &&
        (r.bucket === "disp" ||
          r.bucket === "buco" ||
          r.bucket === "pre-post" ||
          r.bucket === "potenziamento" ||
          r.bucket === "in-sede"),
    );
    if (!pick) continue;
    used.add(pick.teacher.id);
    usedByPeriod.set(need.slot.periodId, used);
    created.push({
      id: need.substitution?.id ?? `auto-${need.key}`,
      date: need.date,
      periodId: need.slot.periodId,
      classId: need.slot.classId,
      absentTeacherId: need.absence.teacherId,
      substituteId: pick.teacher.id,
      type: pick.inferredType,
      activity: "",
      notes: "Assegnazione automatica",
      subject: need.slot.subject,
    });
  }
  return created;
}

/**
 * Lo stesso docente a sostituire in due classi diverse nella stessa ora: per ogni ora coinvolta (chiave dell'ora da
 * coprire) l'id del docente e le altre classi. Non è un errore se due assenti sono nella stessa classe.
 */
export type DoubleCover = {
  teacherId: string;
  otherClassIds: string[];
  /** dove è già in un'altra sede nella stessa ora (solo con più sedi) */
  elsewhere?: string;
};

export function doubleCovers(needs: CoverageNeed[], elsewhere?: ElsewhereCheck): Map<string, DoubleCover> {
  const groups = new Map<string, CoverageNeed[]>();
  for (const n of needs) {
    const id = n.substitution?.substituteId;
    if (!id || n.substitution?.type === "divisione" || isShiftType(n.substitution?.type)) continue;
    const key = `${n.slot.periodId}|${id}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const out = new Map<string, DoubleCover>();
  for (const list of groups.values()) {
    const classes = new Set(list.map((n) => n.slot.classId));
    if (classes.size < 2) continue;
    for (const n of list) {
      out.set(n.key, {
        teacherId: n.substitution!.substituteId as string,
        otherClassIds: [...classes].filter((c) => c !== n.slot.classId),
      });
    }
  }
  if (elsewhere) {
    for (const n of needs) {
      const id = n.substitution?.substituteId;
      if (!id || n.substitution?.type === "divisione" || isShiftType(n.substitution?.type)) continue;
      const where = elsewhere(id, n.date, n.slot.periodId);
      if (where) out.set(n.key, { teacherId: id, otherClassIds: out.get(n.key)?.otherClassIds ?? [], elsewhere: where });
    }
  }
  return out;
}

export function dayCoverage(data: PersistedData, date: string, elsewhere?: ElsewhereCheck): {
  absences: Absence[];
  needs: CoverageNeed[];
  covered: number;
  uncovered: number;
  /** ore con un sostituto già in un'altra classe nella stessa ora */
  doubled: number;
} {
  const absences = absencesOnDate(data, date);
  const needs = coverageNeeds(data, date);
  const covered = needs.filter(isCovered).length;
  return { absences, needs, covered, uncovered: needs.length - covered, doubled: doubleCovers(needs, elsewhere).size };
}

export type TeacherLoad = {
  teacherId: string;
  disposizione: number;
  potenziamento: number;
  recupero: number;
  eccedente: number;
  sostegno: number;
  altro: number;
  total: number;
};

export function loadByTeacher(data: PersistedData, from: string, to: string): TeacherLoad[] {
  const map = new Map<string, TeacherLoad>();
  for (const t of data.teachers) {
    map.set(t.id, {
      teacherId: t.id,
      disposizione: 0,
      potenziamento: 0,
      recupero: 0,
      eccedente: 0,
      sostegno: 0,
      altro: 0,
      total: 0,
    });
  }
  for (const s of data.substitutions) {
    if (!s.substituteId) continue;
    if (s.date < from || s.date > to) continue;
    const row = map.get(s.substituteId);
    if (!row) continue;
    row.total += 1;
    if (s.type === "disposizione") row.disposizione += 1;
    else if (s.type === "potenziamento") row.potenziamento += 1;
    else if (s.type === "recupero") row.recupero += 1;
    else if (s.type === "eccedente") row.eccedente += 1;
    else if (s.type === "sostegno") row.sostegno += 1;
    else row.altro += 1;
  }
  return [...map.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const ta = findAnyTeacher(data, a.teacherId);
    const tb = findAnyTeacher(data, b.teacherId);
    return (
      (ta?.lastName ?? "").localeCompare(tb?.lastName ?? "", "it") ||
      (ta?.firstName ?? "").localeCompare(tb?.firstName ?? "", "it")
    );
  });
}

export type EccedenteLine = {
  id: string;
  date: string;
  teacher: string;
  className: string;
  hour: string;
  from: string;
  to: string;
};

function roundClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const hour = Math.round((h * 60 + m) / 60);
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Ore segnate come eccedenti: chi ha coperto, la classe e l’orario arrotondato all’ora. */
export function eccedenteLines(data: PersistedData, from: string, to: string): EccedenteLine[] {
  return data.substitutions
    .filter((s) => s.type === "eccedente" && s.substituteId && s.date >= from && s.date <= to)
    .map((s) => {
      const teacher = findAnyTeacher(data, s.substituteId);
      const cls = data.classes.find((c) => c.id === s.classId);
      const period = data.settings.periods.find((p) => p.id === s.periodId);
      return {
        id: s.id,
        date: s.date,
        teacher: teacher ? teacherName(teacher) : "",
        className: cls?.name ?? "",
        hour: period ? (isMensaPeriod(period) ? "M" : `${period.index}ª`) : "",
        from: period ? roundClock(period.start) : "",
        to: period ? roundClock(period.end) : "",
        index: period?.index ?? 99,
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.index - b.index ||
        a.teacher.localeCompare(b.teacher, "it") ||
        a.className.localeCompare(b.className, "it"),
    )
    .map(({ index: _index, ...line }) => line);
}

/**
 * Motivi che si contano a ore, con il tetto per anno scolastico: assemblea sindacale 10 ore; permessi brevi fino
 * all'orario settimanale del docente (18 ore per una cattedra intera).
 */
export const HOUR_REASON_LIMITS: Partial<Record<AbsenceReason, number>> = {
  assemblea_sindacale: 10,
  permesso_breve: 18,
};

export function isHourReason(reason: AbsenceReason): boolean {
  return HOUR_REASON_LIMITS[reason] !== undefined;
}

/** Un tratto di assenza in un giorno, in minuti dalla mezzanotte. */
export type AbsenceSpan = { date: string; start: number; end: number };

function clockMinutes(hhmm: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Le ore di quel giorno in cui la scuola ha lezione (senza mensa); senza orario, tutte le ore della mattina e del pomeriggio. */
function schoolPeriodIdsOn(data: PersistedData, iso: string): string[] {
  const day = toSchoolDay(iso);
  const periods = data.settings.periods.filter((p) => !isMensaPeriod(p));
  const used = periods.filter((p) => data.slots.some((s) => s.day === day && s.periodId === p.id));
  return (used.length ? used : periods).map((p) => p.id);
}

/**
 * I tratti segnati da un'assenza, giorno di scuola per giorno, nel periodo `from`–`to`: le ore scelte, con gli orari
 * delle campanelle (senza orari, 60 minuti). A giornata intera, o senza ore scelte, le ore di lezione della scuola
 * quel giorno. Si contano anche se il docente in quelle ore non ha servizio.
 */
export function absenceSpans(
  data: PersistedData,
  a: Pick<Absence, "dateFrom" | "dateTo" | "allDay" | "periodIds">,
  from: string,
  to: string,
): AbsenceSpan[] {
  const start = a.dateFrom > from ? a.dateFrom : from;
  const end = a.dateTo < to ? a.dateTo : to;
  if (start > end) return [];
  const spans: AbsenceSpan[] = [];
  for (const iso of eachIsoInRange(start, end)) {
    if (isWeekend(iso, data.settings.days)) continue;
    const ids = new Set(a.allDay || a.periodIds.length === 0 ? schoolPeriodIdsOn(data, iso) : a.periodIds);
    for (const p of data.settings.periods) {
      if (!ids.has(p.id)) continue;
      const s = clockMinutes(p.start);
      const e = clockMinutes(p.end);
      if (s != null && e != null && e > s) spans.push({ date: iso, start: s, end: e });
      else spans.push({ date: iso, start: p.index * 60, end: p.index * 60 + 60 });
    }
  }
  return spans;
}

/** Minuti coperti dai tratti: un'ora segnata due volte (o in due sedi) conta una volta sola. */
export function spanMinutes(spans: readonly AbsenceSpan[]): number {
  const sorted = [...spans].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  let total = 0;
  let date = "";
  let reach = -1;
  for (const s of sorted) {
    if (s.date !== date) {
      date = s.date;
      reach = -1;
    }
    const from = Math.max(s.start, reach);
    if (s.end > from) total += s.end - from;
    reach = Math.max(reach, s.end);
  }
  return total;
}

/** I tratti delle assenze di un docente per quel motivo, nel periodo (senza l'assenza `skipId`, quella che si modifica). */
export function reasonSpans(
  data: PersistedData,
  teacherId: string,
  reason: AbsenceReason,
  from: string,
  to: string,
  skipId?: string,
): AbsenceSpan[] {
  return data.absences
    .filter((a) => a.teacherId === teacherId && a.reason === reason && a.id !== skipId)
    .flatMap((a) => absenceSpans(data, a, from, to));
}

/** Minuti in ore: «2», «1 h 35 min», «50 min». */
export function formatHours(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return String(h);
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

/** Minuti in ore con due decimali, per i fogli di calcolo. */
export function decimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export type AbsenceReasonRow = {
  teacherId: string;
  /** giorni di scuola con un'assenza per quel motivo (anche di poche ore) */
  byReason: Record<AbsenceReason, number>;
  /** minuti di assenza per i motivi che si contano a ore (assemblea, permesso breve); 0 per gli altri */
  minutes: Record<AbsenceReason, number>;
  /** giorni di assenza per i motivi che si contano a giorni */
  total: number;
};

function emptyReasons(): Record<AbsenceReason, number> {
  return Object.fromEntries(ABSENCE_REASONS.map((r) => [r.value, 0])) as Record<AbsenceReason, number>;
}

/** C'è almeno un'assenza: giorni per i motivi a giorni, ore per quelli a ore. */
export function hasAbsences(row: AbsenceReasonRow): boolean {
  return row.total > 0 || Object.values(row.minutes).some((m) => m > 0);
}

/** Valore da mostrare per un motivo: giorni, oppure ore per assemblea e permessi brevi. */
export function reasonValue(row: AbsenceReasonRow, reason: AbsenceReason): number {
  return isHourReason(reason) ? row.minutes[reason] : row.byReason[reason];
}

/**
 * Assenze nel periodo, per docente e motivo: giorni scolastici, ma ore per assemblea sindacale e permessi brevi
 * (le ore segnate, secondo le campanelle).
 */
export function absencesByReason(data: PersistedData, from: string, to: string): AbsenceReasonRow[] {
  const map = new Map<string, AbsenceReasonRow>();
  for (const t of data.teachers) {
    map.set(t.id, { teacherId: t.id, byReason: emptyReasons(), minutes: emptyReasons(), total: 0 });
  }
  const schoolDays = data.settings.days;
  const spans = new Map<string, AbsenceSpan[]>();
  for (const a of data.absences) {
    const row = map.get(a.teacherId);
    if (!row) continue;
    const start = a.dateFrom > from ? a.dateFrom : from;
    const end = a.dateTo < to ? a.dateTo : to;
    if (start > end) continue;
    let n = 0;
    for (const iso of eachIsoInRange(start, end)) {
      if (!isWeekend(iso, schoolDays)) n += 1;
    }
    if (n === 0) continue;
    const key = ABSENCE_REASONS.some((r) => r.value === a.reason) ? a.reason : "altro";
    row.byReason[key] += n;
    if (isHourReason(key)) {
      const k = `${a.teacherId}|${key}`;
      spans.set(k, [...(spans.get(k) ?? []), ...absenceSpans(data, a, from, to)]);
    } else {
      row.total += n;
    }
  }
  for (const [k, list] of spans) {
    const [teacherId, reason] = k.split("|") as [string, AbsenceReason];
    const row = map.get(teacherId);
    if (row) row.minutes[reason] = spanMinutes(list);
  }
  const hours = (r: AbsenceReasonRow) => Object.values(r.minutes).reduce((n, m) => n + m, 0);
  return [...map.values()].sort((a, b) => b.total - a.total || hours(b) - hours(a));
}
