/**
 * «Calcolo lungo»: lo stesso motore di Costruisci, fatto girare fuori dall'app (da Claude Code, con
 * `scripts/calcolo-lungo.mjs`) per molto più tempo. Dal backup dell'app escono più versioni dell'orario, le
 * migliori e diverse tra loro, che tornano negli slot scelti; gli altri slot e tutti gli altri dati restano
 * come nel backup.
 *
 * In questa app si calcola la sede in uso nel backup (con le ore dei docenti nelle altre sedi come ×, come in
 * Costruisci) oppure tutte le sedi insieme, con le versioni dell'app («giorni in un plesso», «equilibrato»,
 * «meno ore buche»), salvate come «Tutte le sedi insieme» (stesso codice nello slot di ogni sede).
 *
 * Qui stanno le parti senza processi né file: la richiesta (scritta dall'app, controllata dal programma),
 * come una soluzione del motore diventa un orario da slot (come «Salva nello slot…» in Costruisci), la
 * scelta delle versioni e il backup da restituire.
 */
import { missingText, timetableDemand } from "./build-timetable";
import { allSedi, blockingGroups, editSede, missingBySede, sedeAsData, sedeName, withOtherSedi } from "./sedi";
import {
  buildInsieme,
  canBuildTogether,
  INSIEME_VERSIONI,
  insiemeParts,
  splitInsieme,
  withInsiemeParts,
  withMixedWeight,
  type InsiemeMap,
  type InsiemeVersione,
} from "./sedi-insieme";
import { uid } from "./utils";
import { builtLessonTest } from "./svuota";
import {
  activeSlotOf,
  SAVE_SLOTS,
  slotsWithLessons,
  timetablePart,
  withPart,
  type TimetablePart,
} from "./saved-timetables";
import {
  dispIntoGaps,
  dispOutcome,
  evaluateCurrent,
  type SolveMode,
  type SolveResult,
  type TimetableReport,
} from "./timetable-solver";
import type { PersistedData, SavedTimetable, TimetableSlot } from "./types";

/** Ciò che si chiede al calcolo lungo. */
export type LongRunRequest = {
  mode: SolveMode;
  /** slot da riempire (1–5), una versione per slot */
  slots: number[];
  /** tra gli slot da riempire, quelli già occupati che si possono sostituire */
  replace: number[];
  /** durata del calcolo, in minuti */
  minutes: number;
  /** la sede in uso nel backup, o tutte le sedi insieme */
  scope: "sede" | "tutte";
};

/** Durate proposte: una sessione di Claude Code tiene un comando in esecuzione al massimo 2 ore. */
export const LONG_RUN_MINUTES = [30, 60, 90] as const;

/** «30 minuti», «1 ora», «1 ora e 30 minuti», «2 ore». */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? "1 ora" : `${h} ore`;
  const mins = m === 1 ? "1 minuto" : `${m} minuti`;
  if (h === 0) return mins;
  return m === 0 ? hours : `${hours} e ${mins}`;
}

/** Slot con un orario salvato (o in uso), con il nome; lo 0 escluso. Con tutte le sedi: occupato in almeno una. */
export function occupiedSlots(data: PersistedData, scope: LongRunRequest["scope"] = "sede"): Map<number, string> {
  const out = new Map<number, string>();
  const sedi = scope === "tutte" ? allSedi(data) : allSedi(data).filter((x) => x.active);
  for (const sede of sedi) {
    const several = sedi.length > 1;
    const label = (name: string) => (several ? `${name}, ${sedeName(sede.data.settings)}` : name);
    for (const s of sede.data.savedTimetables ?? []) if (s.n > 0 && !out.has(s.n)) out.set(s.n, label(s.name));
    const active = activeSlotOf(sedeAsData(data, sede.data));
    if (active > 0 && !out.has(active)) out.set(active, label(`Slot ${active}`));
  }
  return out;
}

/** Slot in uso nell'app: nella sede in uso o, con tutte le sedi, in una qualunque. */
function slotsInUse(data: PersistedData, scope: LongRunRequest["scope"]): Set<number> {
  const sedi = scope === "tutte" ? allSedi(data) : allSedi(data).filter((x) => x.active);
  return new Set(sedi.map((s) => activeSlotOf(sedeAsData(data, s.data))));
}

/** Il messaggio da incollare in Claude Code: dice cosa fare e dove trovare le istruzioni. */
export function longRunMessage(
  data: PersistedData,
  req: LongRunRequest,
  repository: string,
  backupName: string,
): string {
  const taken = occupiedSlots(data, req.scope);
  const slotText = [...req.slots]
    .sort((a, b) => a - b)
    .map((n) => (taken.has(n) ? `${n} (sostituisce «${taken.get(n)}»)` : String(n)))
    .join(", ");
  return [
    "Calcolo lungo dell’orario.",
    `Repository: ${repository}. Segui la sezione «Calcolo lungo dell’orario» del file CLAUDE.md.`,
    `Backup allegato: ${backupName}.`,
    req.scope === "tutte"
      ? `Sedi: tutte insieme (${allSedi(data)
          .map((x) => sedeName(x.data.settings))
          .join(", ")}).`
      : `Sede: ${sedeName(data.settings)} (quella in uso nel backup).`,
    `Partenza: ${req.mode === "improve" ? "migliora l’orario attuale" : "da zero"}.`,
    `Slot da usare: ${slotText}.${req.slots.length < SAVE_SLOTS.length ? " Gli altri slot restano come sono." : ""}`,
    `Durata: ${durationText(req.minutes)}.`,
    "Serve un ambiente che possa aprire la repository ed eseguire programmi a lungo (per esempio Claude Code): senza, non inventare un orario.",
  ].join("\n");
}

/** Che cosa impedisce il calcolo: niente da piazzare, materie senza docente, slot non utilizzabili. */
export function requestProblems(data: PersistedData, req: LongRunRequest): string[] {
  const out: string[] = [];
  const all = req.scope === "tutte";
  if (all) {
    const together = canBuildTogether(data);
    if (!together.ok) out.push(`Tutte le sedi insieme non si può: ${together.reason}`);
  }
  const demandData = all && !out.length ? buildInsieme(data).joint : withOtherSedi(data);
  if (timetableDemand(demandData).lessons.length === 0) out.push("Niente da piazzare: mancano docenti, classi o ore in orario.");
  const blocking = blockingGroups(missingBySede(data).filter((x) => all || x.active));
  for (const g of blocking) out.push(`Materie senza docente a ${g.sede}: ${g.items.map(missingText).join("; ")}.`);
  const sedi = all ? allSedi(data) : allSedi(data).filter((x) => x.active);
  if (req.mode === "improve" && !sedi.some((x) => x.data.slots.some(builtLessonTest(x.data)))) {
    out.push("«Migliora l’attuale» non si può: non c’è un orario da migliorare.");
  }
  if (req.slots.length === 0) out.push("Nessuno slot scelto.");
  if (new Set(req.slots).size !== req.slots.length) out.push("Uno slot è indicato due volte.");
  const taken = occupiedSlots(data, req.scope);
  const inUse = slotsInUse(data, req.scope);
  for (const n of req.slots) {
    if (!(SAVE_SLOTS as readonly number[]).includes(n)) {
      out.push(`Lo slot ${n} non esiste: si usano gli slot da 1 a 5 (lo 0 è l’orario in vigore).`);
    } else if (inUse.has(n)) {
      out.push(`Lo slot ${n} è quello in uso nell’app${all ? " in una delle sedi" : ""}: non si sostituisce da qui.`);
    } else if (taken.has(n) && !req.replace.includes(n)) {
      out.push(`Lo slot ${n} è occupato da «${taken.get(n)}» e la richiesta non dice di sostituirlo.`);
    }
  }
  if (!(req.minutes > 0)) out.push("Durata non valida.");
  return out;
}

/** Una soluzione del motore come la vede Costruisci: l'orario da slot e il suo confronto. */
export type Candidate = { part: TimetablePart; report: TimetableReport; lessons: TimetableSlot[] };

/**
 * Come «Salva nello slot…» dopo «Proponi»: con «Da zero» le ore a disposizione vanno nelle buche
 * (`dispIntoGaps`), con «Migliora» stanno dove le ha messe il motore. `data`: la sede in uso con le ore nelle
 * altre sedi come × (`withOtherSedi`), come la vede Costruisci.
 */
export function candidateOf(data: PersistedData, mode: SolveMode, result: Pick<SolveResult, "slots" | "disp">): Candidate {
  let base = data;
  if (!result.disp && mode === "scratch") {
    const plan = dispIntoGaps({ ...data, slots: slotsWithLessons(data, result.slots) }, { replace: true });
    if (plan.moves.length) {
      base = {
        ...data,
        teachers: data.teachers.map((t) => (plan.dispSlots[t.id] ? { ...t, dispSlots: plan.dispSlots[t.id] } : t)),
      };
    }
  }
  const part = timetablePart(base, result.slots, dispOutcome(base, result.slots, result.disp).dispSlots);
  return { part, report: evaluateCurrent({ ...data, ...withPart(data, part) }), lessons: part.lessons };
}

/** Prima la soluzione con meno vincoli violati, poi meno peggioramenti, poi il punteggio. */
export function compareReports(a: TimetableReport, b: TimetableReport): number {
  return a.score.hard - b.score.hard || a.score.pen - b.score.pen || a.score.soft - b.score.soft;
}

/** Valida: tutte le lezioni al loro posto e nessun docente o classe in due posti nella stessa ora. */
export function isComplete(report: TimetableReport): boolean {
  return report.lessons >= report.lessonsExpected && report.hard.conflicts.length === 0;
}

function lessonKeys(lessons: TimetableSlot[]): Set<string> {
  return new Set(lessons.map((s) => `${s.day}|${s.periodId}|${s.classId}|${s.teacherId}|${s.subject}`));
}

/** Quanto sono diversi due orari: la parte di lezioni che non stanno nello stesso posto (0–1). */
export function lessonDistance(a: TimetableSlot[], b: TimetableSlot[]): number {
  const ka = lessonKeys(a);
  const kb = lessonKeys(b);
  let same = 0;
  for (const k of ka) if (kb.has(k)) same += 1;
  const total = Math.max(ka.size, kb.size);
  return total === 0 ? 0 : 1 - same / total;
}

/**
 * Le versioni: le migliori, ma diverse tra loro almeno `minDistance` (parte di lezioni in un altro posto).
 * Se non bastano, la soglia si abbassa fino a prendere comunque orari non identici.
 */
export function pickVersions<T extends { report: TimetableReport; lessons: TimetableSlot[] }>(
  cands: T[],
  k: number,
  minDistance = 0.15,
): T[] {
  const sorted = cands.filter((c) => isComplete(c.report)).sort((a, b) => compareReports(a.report, b.report));
  for (let d = minDistance; ; d = d > 0.02 ? d / 2 : 0) {
    const chosen: T[] = [];
    for (const c of sorted) {
      if (chosen.length >= k) break;
      if (chosen.every((x) => lessonDistance(x.lessons, c.lessons) > d)) chosen.push(c);
    }
    if (chosen.length >= k || d === 0) return chosen;
  }
}

/** Le voci del confronto in breve, per il nome dello slot e il riepilogo. */
export function reportLine(report: TimetableReport): string {
  const hard = Object.values(report.hard).reduce((n, list) => n + list.length, 0);
  const parts = [`${report.gapsTotal} ${report.gapsTotal === 1 ? "ora buca" : "ore buche"}`];
  if (hard) parts.push(`${hard} da sistemare`);
  return parts.join(", ");
}

/**
 * Il backup da restituire: identico a quello ricevuto, con le versioni negli slot scelti. `savedAt` appena
 * dopo quello del backup: se nel frattempo sul dispositivo è cambiato qualcosa, all'importazione l'app avvisa
 * che il backup è più vecchio.
 */
export function withVersions(
  data: PersistedData,
  versions: { n: number; name: string; part: TimetablePart }[],
  now = Date.now(),
): PersistedData {
  const ns = new Set(versions.map((v) => v.n));
  const entries: SavedTimetable[] = versions.map((v) => ({ n: v.n, name: v.name, savedAt: now, ...v.part }));
  return {
    ...data,
    savedTimetables: [...(data.savedTimetables ?? []).filter((x) => !ns.has(x.n)), ...entries].sort((a, b) => a.n - b.n),
    savedAt: Number(data.savedAt) > 0 ? Number(data.savedAt) + 1 : now,
  };
}

/** Tutte le sedi insieme: una soluzione del motore, divisa per sede come la salva Costruisci. */
export type JointCandidate = {
  versione: InsiemeVersione["key"];
  parts: Record<string, TimetablePart>;
  report: TimetableReport;
  /** le lezioni di tutte le sedi nel problema unico, per confrontare le versioni */
  lessons: TimetableSlot[];
};

/**
 * Come la proposta «Tutte le sedi insieme» quando si salva: le lezioni divise per sede, le ore a disposizione
 * sistemate sede per sede, e i numeri di tutte le sedi con il peso dei giorni divisi della versione.
 */
export function jointCandidateOf(
  data: PersistedData,
  map: InsiemeMap,
  mode: SolveMode,
  versione: InsiemeVersione,
  slots: TimetableSlot[],
): JointCandidate {
  const parts = insiemeParts(data, splitInsieme(map, slots), mode);
  const after = withInsiemeParts(data, parts);
  const report = evaluateCurrent(withMixedWeight(buildInsieme(after).joint, versione.mixedW));
  return { versione: versione.key, parts, report, lessons: slots };
}

/**
 * Le versioni da calcolare con tutte le sedi insieme, una per slot: con uno slot «equilibrato», poi a turno
 * «giorni in un plesso», «meno ore buche»…
 */
export function jointVersionPlan(k: number): InsiemeVersione[] {
  const order = ["equilibrato", "plesso", "buche"] as const;
  return Array.from({ length: k }, (_, i) => INSIEME_VERSIONI.find((v) => v.key === order[i % order.length])!);
}

/** Tutte le sedi insieme: le migliori di ogni versione, diverse tra loro, nell'ordine del piano. */
export function pickJointVersions(cands: JointCandidate[], plan: InsiemeVersione[]): JointCandidate[] {
  const out: JointCandidate[] = [];
  for (const v of INSIEME_VERSIONI) {
    const want = plan.filter((x) => x.key === v.key).length;
    if (!want) continue;
    out.push(...pickVersions(cands.filter((c) => c.versione === v.key), want));
  }
  // nell'ordine del piano, senza due orari identici
  const ordered: JointCandidate[] = [];
  for (const v of plan) {
    const next = out.find((c) => c.versione === v.key && !ordered.includes(c));
    if (next && ordered.every((x) => lessonDistance(x.lessons, next.lessons) > 0)) ordered.push(next);
  }
  return ordered;
}

/**
 * Tutte le sedi insieme: il backup con ogni versione nello slot `n` di ogni sede, con lo stesso codice (come
 * «Salva nello slot…» della proposta per tutte le sedi). Il resto come in `withVersions`.
 */
export function withJointVersions(
  data: PersistedData,
  versions: { n: number; name: string; parts: Record<string, TimetablePart> }[],
  now = Date.now(),
): PersistedData {
  let next = data;
  for (const v of versions) {
    const insieme = uid("ins");
    for (const sede of allSedi(next)) {
      const part = v.parts[sede.id];
      if (!part) continue;
      next = editSede(next, sede.id, (d) => ({
        ...d,
        savedTimetables: [
          ...(d.savedTimetables ?? []).filter((x) => x.n !== v.n),
          { n: v.n, name: v.name, savedAt: now, ...part, insieme },
        ].sort((a, b) => a.n - b.n),
      }));
    }
  }
  return { ...next, savedAt: Number(data.savedAt) > 0 ? Number(data.savedAt) + 1 : now };
}
