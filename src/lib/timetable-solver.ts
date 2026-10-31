/**
 * Motore di Costruisci orario: ricerca locale con ricottura simulata (simulated annealing).
 * Sistema solo le lezioni: le ore a disposizione le gestisce il responsabile.
 *
 * Vincoli rigidi (non si violano): nessun docente in due classi insieme, ore segnate altrove (×),
 * un'ora libera prima e dopo l'altro plesso, al massimo un cambio di plesso al giorno (un'andata e
 * ritorno, qui → altrove → qui, la ricerca non la accetta mai), ore «no» (solo quell'ora, senza spostamento),
 * obblighi di classe, rientro (prima della 4ª no), classi senza buchi in mezzo, ore al giorno
 * scelte per il docente (es. 4-4-4-3-3 in qualsiasi ordine; se ne sceglie più d'una, ne basta una),
 * ore bloccate (restano dove sono).
 * Preferenze bilanciate in un unico punteggio: a scuola dalla 1ª alla 6ª e 5 lezioni in un giorno
 * solo se non c'è altro modo, pochissime ore buche, al massimo 2 ore di fila della stessa materia
 * (le lingue meglio non attaccate), niente blocchi pesanti per la classe, giorni puliti per chi
 * è su due plessi, ultime ore distribuite, preferenze ✓ e di classe.
 *
 * Italiano, storia e geografia (o matematica e scienze) dello stesso docente nella stessa classe
 * contano come una sola materia; italiano e matematica almeno una volta a settimana alla 1ª–2ª ora
 * (alla 2ª–3ª se il docente alla 1ª non può mai).
 *
 * Il pomeriggio (mensa, 7ª, 8ª) resta com'è: è un vincolo fisso. Sostegno, potenziamento e
 * strumento non entrano.
 */
import type { DayOfWeek, Period, PersistedData, TimetableSlot } from "./types";
import { isTimetableTeacher, timetableDemand } from "./build-timetable";
import { teacherName } from "./coverage";
import { isMensaPeriod } from "./periods";
import { buildMergeMap, canonicalSubject, isMergedSubject, splitMerged, subjectParts } from "./subject-groups";

/** Pesi del punteggio. Più alto = più grave. "hard" moltiplica i vincoli rigidi. */
export const WEIGHTS = {
  hard: 10000,
  // ore buche: la seconda nello stesso giorno pesa più di una giornata con 5 lezioni
  gap: 100,
  gap2: 700,
  gapWeek: 150,
  // a scuola dalla 1ª alla 6ª, 5 o 6 lezioni in un giorno: solo se non c'è altro modo
  six: 3000,
  five: 400,
  span6: 1500,
  single: 60,
  mixed: 200,
  mixedSingle: 100,
  emptyFull: 400,
  emptyPart: 0,
  lastHour: 30,
  prefer: 60,
  classPref: 40,
  sameRun: 800,
  sameDay: 800,
  split: 300,
  mergedSplit: 40,
  firstNone: 600,
  firstPartial: 300,
  langBlock: 80,
  coreRun: 250,
  noLight: 120,
  teacherDay: 300,
  teacherSplit: 15,
  spread: 40,
  holeFirst: 60,
  // materie da 2 ore: in due giorni diversi (blocco da 2 solo se serve)
  twoBlock: 400,
  // scienze motorie: almeno un'ora nelle ultime 3 del mattino, più tardi è meglio
  peLate: 300,
  peLater: 40,
  // chi ha la cattedra intera qui (18 ore): niente ore buche e mai dalla 1ª alla 6ª
  gapFull: 1500,
  span6Full: 3000,
  change: 30,
} as const;

const CORE_RE = /^(italiano|storia|geografia|matematica|scienze|latino|educazione civica|approfondimento)$/i;
const LANG_RE = /inglese|francese|spagnolo|tedesco/i;
const PE_RE = /motori|educazione fisica/i;

/** 2 = materia "pesante" (italiano, storia, geografia, matematica, scienze), 1 = lingua, 0 = leggera. */
export function subjectWeight(subject: string): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  for (const part of subjectParts(subject.trim())) {
    if (CORE_RE.test(part)) return 2;
    if (LANG_RE.test(part)) best = 1;
  }
  return best;
}

type TeacherInfo = {
  id: string;
  name: string;
  otherPlesso: boolean;
  lessons: number;
  /** ore qui: lezioni (anche del pomeriggio) e ore a disposizione */
  hours: number;
  /** cattedra intera qui (18 ore con le disposizioni) */
  full: boolean;
  emptyW: number;
  expectedLast: number;
  /** ore al giorno scelte (ne basta una), ciascuna dalla più alta e lunga D; vuoto = decide l'app */
  patterns: Int16Array[];
  /**
   * «Da zero»: ore a disposizione ancora da mettere. Vanno nelle buche (le riempie il responsabile),
   * quindi fino a questo numero le buche non pesano. 0 quando le disposizioni sono già al loro posto.
   */
  fill: number;
  /** accetta 2 ore libere tra le lezioni nello stesso giorno (di norma al massimo una) */
  allow2: boolean;
  /** non accetta ore buche: tra le lezioni di un giorno nessuna ora vuota */
  noGaps: boolean;
};

type ClassInfo = { id: string; name: string };

/**
 * «Tutte le sedi insieme»: le classi di tutte le sedi in un problema solo. Il docente in più sedi è una
 * persona sola; le × segnate in una sede valgono solo per quella sede.
 */
export type InsiemeInfo = {
  /** nomi delle sedi, nell'ordine */
  sedi: string[];
  /** sede (indice) di ogni classe */
  classSede: Record<string, number>;
  /** × segnate in una sede: lì il docente in quell'ora non può essere (ma in un'altra sede sì) */
  sedeAway: Record<string, { s: number; day: DayOfWeek; periodId: string; progetto?: boolean }[]>;
  /**
   * Chi insegna in più sedi: per ogni sua sede le ore a disposizione (quante e dove sono segnate). La sua giornata
   * si conta come nell'app di ogni sede: le ore nelle altre sedi sono ×, con l'ora di spostamento accanto.
   */
  sedeDisp?: Record<string, { s: number; hours: number; slots: { day: DayOfWeek; periodId: string }[] }[]>;
  /** quanto pesa un giorno diviso tra due sedi (o qui e nell'altro plesso); di base `WEIGHTS.mixed` */
  mixedW?: number;
};

type SlotWish = { d: number; m: number; classes: number[] };

export type Prep = {
  days: DayOfWeek[];
  D: number;
  periods: Period[];
  P: number;
  morningPos: number[];
  M: number;
  DM: number;
  /** posizione (0..P-1) → indice di periodo (1ª = 1, …) */
  pIndex: number[];
  /** posizione → ora del mattino (0..M-1) o -1 */
  mOfPos: Int16Array;
  mensaPos: number;
  lastM: number;
  classes: ClassInfo[];
  C: number;
  teachers: TeacherInfo[];
  T: number;
  subjects: string[];
  S: number;
  subjCat: Uint8Array;
  /** ore di fila (e al giorno) ammesse: 2, oppure 3 per le materie unite */
  subjMaxRun: Uint8Array;
  subjSplitW: Float64Array;
  /** C*2: materia di italiano e di matematica della classe (per le prime ore), -1 se manca */
  testSubj: Int16Array;
  /** C*2: prima ora del blocco per i compiti (0 = 1ª–2ª, 1 = 2ª–3ª se alla 1ª il docente non può mai) */
  testFirst: Uint8Array;
  /** C: materia di scienze motorie della classe, -1 se manca */
  peSubj: Int16Array;
  unitClass: Int16Array;
  unitTeacher: Int16Array;
  unitSubj: Int16Array;
  /** Materia vera di ogni ora (per le materie unite: italiano, storia, geografia…). */
  unitReal: string[];
  /** Posizione iniziale (cella d*M+m) se nota, altrimenti -1. */
  unitStart: Int32Array;
  /** 1 = ora bloccata: resta nella sua posizione iniziale */
  locked: Uint8Array;
  /** id della lezione dell'orario da cui viene l'ora (solo per l'orario in uso), altrimenti "" */
  unitSlotId: string[];
  U: number;
  classUnits: number[][];
  /** Ore fisse (pomeriggio): occupano il docente. */
  fixed: { t: number; c: number; s: number; d: number; pos: number }[];
  /** T*D*P: 1 = altrove, 2 = ora di spostamento, 3 = «no» (solo quell'ora), 4 = a disposizione (presenza). */
  unavail: Uint8Array;
  dayHasAway: Uint8Array;
  rientro: Uint8Array;
  must: SlotWish[][];
  mustOffset: Int16Array;
  cpref: SlotWish[][];
  cprefOffset: Int16Array;
  prefer: { d: number; m: number }[][];
  csHours: Int16Array;
  /** Per cella di classe: chiave docente*S+materia dell'orario attuale; -1 vuota. */
  orig: Int32Array;
  warnings: string[];
  unplaced: { classId: string; teacherId: string; subject: string; hours: number }[];
  /** ritocchi a mano: una lezione su una disposizione non è un errore (la disposizione si sposta o si toglie) */
  dispYield: boolean;
  /**
   * «Migliora l'attuale» e ritocchi: le ore a disposizione del mattino si spostano nello stesso giorno
   * dove servono (per chiudere un'ora buca); altrimenti restano dove sono.
   */
  floatDisp: boolean;
  /** T*D: le ore a disposizione segnate (bit = posizione) */
  dispMask0: Uint32Array;
  /** T*D: dove può stare una disposizione (mattino, senza ×, «no» e prima della 4ª nei giorni di rientro) */
  dispCand: Uint32Array;
  /** «Tutte le sedi insieme»: quante sedi (1 = una sede, come sempre) */
  nSedi: number;
  /** peso di un giorno diviso tra due sedi (o qui e nell'altro plesso) */
  mixedW: number;
  /** C: sede di ogni classe */
  classSede: Int8Array;
  sedeNames: string[];
  /** T*D*P (solo con più sedi): sedi, un bit per sede, in cui il docente in quell'ora non può essere */
  sedeUnavail: Uint32Array;
  /** T (solo con più sedi): 1 = insegna in più sedi; la sua giornata si conta sede per sede */
  multi: Uint8Array;
  /** T (solo con più sedi): le sedi del docente in più sedi (bit = sede) */
  sedeBits: Uint32Array;
  /** T*D*nSedi (solo con più sedi): le × segnate in ogni sede (bit = posizione) */
  sedeAwayMask: Uint32Array;
  /** T*D*nSedi (solo con più sedi): le ore a disposizione in ogni sede (bit = posizione) */
  dispSede: Uint32Array;
  /** T*nSedi («Da zero», solo con più sedi): le ore a disposizione da mettere nelle buche di ogni sede */
  fillSede: Int16Array;
  /** T*D: le ore del mattino dove può stare un'ora a disposizione (senza ×, «no» e prima della 4ª nei giorni di rientro) */
  dispFreeBase: Uint32Array;
  /** P: le posizioni accanto (ora prima e ora dopo), bit = posizione */
  nbrMask: Uint32Array;
  /** le posizioni del mattino (bit = posizione) */
  morningBits: number;
};

/** Ore a disposizione del docente su questo plesso (dichiarate o segnate). */
function dispCount(t: { dispHours?: number; dispSlots?: unknown[] }): number {
  return Math.max(0, Math.round(t.dispHours ?? 0), t.dispSlots?.length ?? 0);
}

/** Le suddivisioni scelte per il docente (anche dal campo della versione precedente, con una sola). */
export function teacherDayPatterns(t: { dayPatterns?: number[][]; dayPattern?: number[] }): number[][] {
  const list = t.dayPatterns ?? (t.dayPattern ? [t.dayPattern] : []);
  return list.filter((x) => Array.isArray(x) && x.some((v) => v > 0));
}

/** Ore al giorno scelte: numeri interi dalla più alta, uno per giorno (0 = giorno libero). */
function normalizePattern(raw: number[] | undefined, D: number, P: number): Int16Array | null {
  if (!raw || raw.length === 0) return null;
  const vals = raw.map((x) => Math.max(0, Math.min(P, Math.round(Number(x) || 0)))).sort((a, b) => b - a);
  if (!vals.some((x) => x > 0)) return null;
  const out = new Int16Array(D);
  for (let i = 0; i < D && i < vals.length; i++) out[i] = vals[i]!;
  return out;
}

function patternText(pat: ArrayLike<number>): string {
  return Array.from(pat).join("-");
}

/**
 * Di quante ore le giornate superano le ore al giorno scelte (0 = rispettate).
 * L'ordine dei giorni è libero: si confrontano le giornate dalla più piena con la scelta dalla più alta.
 * Se mancano ore (disposizioni ancora da mettere), basta che nessuna giornata vada oltre.
 */
export function patternExcess(perDay: ArrayLike<number>, pattern: ArrayLike<number>): number {
  const a = Array.from(perDay).sort((x, y) => y - x);
  let ex = 0;
  for (let i = 0; i < a.length; i++) {
    const cap = i < pattern.length ? pattern[i]! : 0;
    if (a[i]! > cap) ex += a[i]! - cap;
  }
  return ex;
}

/** Quante caselle si possono soddisfare al massimo (abbinamento caselle ↔ ore per classe). */
function maxMatch(slots: SlotWish[], cap: Map<number, number>): number {
  const used = new Map<number, number[]>();
  const tryAssign = (i: number, seen: Set<number>): boolean => {
    for (const c of slots[i]!.classes) {
      if (seen.has(c)) continue;
      seen.add(c);
      const holders = used.get(c) ?? [];
      if (holders.length < (cap.get(c) ?? 0)) {
        holders.push(i);
        used.set(c, holders);
        return true;
      }
      for (let h = 0; h < holders.length; h++) {
        if (tryAssign(holders[h]!, seen)) {
          holders[h] = i;
          return true;
        }
      }
    }
    return false;
  };
  let matched = 0;
  for (let i = 0; i < slots.length; i++) if (tryAssign(i, new Set())) matched += 1;
  return matched;
}

/**
 * Prepara il problema. `source`:
 * - "demand": ore da piazzare dalle cattedre (Costruisci);
 * - "slots": le lezioni del mattino già in orario (per valutare l'orario attuale).
 * `keepDisp`: le ore a disposizione già segnate contano come presenza a scuola (non sono buche)
 * e nessuna lezione ci va sopra. Vale per l'orario in uso e per «Migliora l'attuale».
 * `dispYield` (ritocchi a mano): una lezione può prendere il posto di una disposizione, che si sposta.
 * `floatDisp` (con `keepDisp`): le disposizioni si spostano nello stesso giorno se così si chiude un'ora buca.
 */
export function prepare(
  data: PersistedData,
  source: "demand" | "slots" = "demand",
  opts: { keepDisp?: boolean; dispYield?: boolean; floatDisp?: boolean } = {},
): Prep {
  const keepDisp = opts.keepDisp ?? source === "slots";
  const dispYield = Boolean(opts.dispYield);
  // «Tutte le sedi insieme»: le ore a disposizione restano dove sono (dopo, sede per sede)
  const insieme = (data as PersistedData & { insieme?: InsiemeInfo }).insieme;
  const floatDisp = keepDisp && Boolean(opts.floatDisp) && !insieme;
  const nSedi = insieme ? Math.max(1, insieme.sedi.length) : 1;
  // chi insegna in più sedi (con una sede sola non serve)
  const multiIds = new Set(nSedi > 1 ? Object.keys(insieme?.sedeDisp ?? insieme?.sedeAway ?? {}) : []);
  const warnings: string[] = [];
  const days = [...data.settings.days].sort((a, b) => a - b);
  const D = days.length;
  const dayIdx = new Map<number, number>(days.map((d, i) => [d, i]));
  const periods = [...data.settings.periods].sort((a, b) => a.index - b.index);
  const P = periods.length;
  const posOf = new Map(periods.map((p, i) => [p.id, i]));
  const morningPos: number[] = [];
  periods.forEach((p, i) => {
    if (!p.tpOnly) morningPos.push(i);
  });
  const M = morningPos.length;
  const mOfMap = new Map(morningPos.map((pos, m) => [pos, m]));
  const mOfPos = new Int16Array(P).fill(-1);
  morningPos.forEach((pos, m) => (mOfPos[pos] = m));
  const pIndex = periods.map((p) => p.index);
  const mensaPos = periods.findIndex((p) => isMensaPeriod(p) && p.tpOnly);
  const morningCell = (day: number, periodId: string): number => {
    const d = dayIdx.get(day);
    const pos = posOf.get(periodId);
    const m = pos === undefined ? undefined : mOfMap.get(pos);
    return d === undefined || m === undefined ? -1 : d * M + m;
  };

  const pool = data.teachers.filter(isTimetableTeacher);
  const poolSet = new Set(pool.map((t) => t.id));
  const isMorning = (periodId: string) => mOfMap.has(posOf.get(periodId) ?? -1);

  // Ore fisse del pomeriggio (docenti curricolari): restano dove sono.
  const fixedRaw = data.slots.filter(
    (s) => poolSet.has(s.teacherId) && posOf.has(s.periodId) && !isMorning(s.periodId) && dayIdx.has(s.day),
  );
  const fixedCount = new Map<string, number>();
  for (const s of fixedRaw) {
    const key = `${s.classId}|${s.teacherId}|${s.subject}`;
    fixedCount.set(key, (fixedCount.get(key) ?? 0) + 1);
  }

  type Raw = { classId: string; teacherId: string; subject: string; real: string; start: number; slot?: TimetableSlot };
  const rawUnits: Raw[] = [];
  const unplaced: Prep["unplaced"] = [];
  let mergeMap: Map<string, string>;
  if (source === "demand") {
    const { lessons, unassigned } = timetableDemand(data);
    for (const u of unassigned) {
      warnings.push(`${u.className}: ${u.subject} (${u.hours} h) senza docente, non entra.`);
    }
    mergeMap = buildMergeMap(lessons);
    for (const l of lessons) {
      const key = `${l.classId}|${l.teacherId}|${l.subject}`;
      const already = fixedCount.get(key) ?? 0;
      const n = Math.max(0, l.hours - already);
      const subject = mergeMap.get(key) ?? l.subject;
      for (let i = 0; i < n; i++)
        rawUnits.push({ classId: l.classId, teacherId: l.teacherId, subject, real: l.subject, start: -1 });
    }
  } else {
    const morningSlots = data.slots.filter(
      (s) => poolSet.has(s.teacherId) && isMorning(s.periodId) && dayIdx.has(s.day),
    );
    mergeMap = buildMergeMap(morningSlots);
    for (const s of morningSlots) {
      const subject = mergeMap.get(`${s.classId}|${s.teacherId}|${s.subject}`) ?? canonicalSubject(s.subject);
      rawUnits.push({
        classId: s.classId,
        teacherId: s.teacherId,
        subject,
        real: s.subject,
        start: morningCell(s.day, s.periodId),
        slot: s,
      });
    }
  }

  // Classi e docenti coinvolti.
  const classIds = new Set(rawUnits.map((u) => u.classId));
  const classes: ClassInfo[] = data.classes
    .filter((c) => classIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));
  const classIdx = new Map(classes.map((c, i) => [c.id, i]));
  const teacherIds = new Set<string>([...rawUnits.map((u) => u.teacherId), ...fixedRaw.map((s) => s.teacherId)]);
  const tList = pool.filter((t) => teacherIds.has(t.id));
  const teacherIdx = new Map(tList.map((t, i) => [t.id, i]));

  const subjects: string[] = [];
  const subjIdx = new Map<string, number>();
  const subjOf = (s: string) => {
    let i = subjIdx.get(s);
    if (i === undefined) {
      i = subjects.length;
      subjects.push(s);
      subjIdx.set(s, i);
    }
    return i;
  };

  const DM = D * M;
  const units = rawUnits.filter((u) => classIdx.has(u.classId) && teacherIdx.has(u.teacherId));
  // Capienza: una classe non può avere più ore del mattino.
  const byClass = new Map<string, Raw[]>();
  for (const u of units) {
    const arr = byClass.get(u.classId) ?? [];
    arr.push(u);
    byClass.set(u.classId, arr);
  }
  const kept: Raw[] = [];
  for (const c of classes) {
    const arr = byClass.get(c.id) ?? [];
    if (arr.length > DM) {
      const extra = arr.slice(DM);
      warnings.push(`${c.name}: ${arr.length} ore ma solo ${DM} al mattino. ${extra.length} restano fuori.`);
      const agg = new Map<string, Prep["unplaced"][number]>();
      for (const e of extra) {
        const key = `${e.teacherId}|${e.real}`;
        const row = agg.get(key) ?? { classId: c.id, teacherId: e.teacherId, subject: e.real, hours: 0 };
        row.hours += 1;
        agg.set(key, row);
      }
      unplaced.push(...agg.values());
      kept.push(...arr.slice(0, DM));
    } else kept.push(...arr);
  }

  const U = kept.length;
  const unitClass = new Int16Array(U);
  const unitTeacher = new Int16Array(U);
  const unitSubj = new Int16Array(U);
  const unitStart = new Int32Array(U).fill(-1);
  const unitReal = kept.map((u) => u.real);
  const classUnits: number[][] = classes.map(() => []);
  kept.forEach((u, i) => {
    const c = classIdx.get(u.classId)!;
    unitClass[i] = c;
    unitTeacher[i] = teacherIdx.get(u.teacherId)!;
    unitSubj[i] = subjOf(u.subject);
    unitStart[i] = u.start;
    classUnits[c]!.push(i);
  });

  // Ore bloccate: la lezione dell'orario in uso resta in quella casella, con la sua materia.
  const locked = new Uint8Array(U);
  const unitSlotId = kept.map((u) => u.slot?.id ?? "");
  const tById = new Map(tList.map((t) => [t.id, t]));
  const isLocked = (s: TimetableSlot) => {
    const t = tById.get(s.teacherId);
    return Boolean(
      t &&
        (t.lockWeek ||
          (t.lockedSlots ?? []).some((a) => a.day === s.day && a.periodId === s.periodId && a.classId === s.classId)),
    );
  };
  if (source === "slots") {
    kept.forEach((u, i) => {
      if (u.slot && isLocked(u.slot)) locked[i] = 1;
    });
  } else {
    for (const s of data.slots) {
      if (!poolSet.has(s.teacherId) || !isMorning(s.periodId) || !dayIdx.has(s.day) || !isLocked(s)) continue;
      const z = morningCell(s.day, s.periodId);
      const c = classIdx.get(s.classId);
      const t = teacherIdx.get(s.teacherId);
      if (z < 0 || c === undefined || t === undefined) continue;
      const si =
        subjIdx.get(mergeMap.get(`${s.classId}|${s.teacherId}|${s.subject}`) ?? s.subject) ??
        subjIdx.get(canonicalSubject(s.subject));
      let pick = -1;
      for (const u of classUnits[c]!) {
        if (locked[u] || unitTeacher[u] !== t || unitSubj[u] !== si) continue;
        if (pick < 0 || (unitReal[u] === s.subject && unitReal[pick] !== s.subject)) pick = u;
      }
      if (pick < 0) {
        warnings.push(`${teacherName(tById.get(s.teacherId)!)}: l’ora bloccata di ${s.subject} in ${classes[c]!.name} non è più nelle cattedre.`);
        continue;
      }
      locked[pick] = 1;
      unitStart[pick] = z;
      unitReal[pick] = s.subject;
    }
  }

  const fixed: Prep["fixed"] = [];
  for (const s of fixedRaw) {
    const t = teacherIdx.get(s.teacherId);
    if (t === undefined) continue;
    fixed.push({ t, c: classIdx.get(s.classId) ?? -1, s: subjOf(s.subject), d: dayIdx.get(s.day)!, pos: posOf.get(s.periodId)! });
  }

  const S = subjects.length;
  const subjCat = new Uint8Array(S);
  const subjMaxRun = new Uint8Array(S);
  const subjSplitW = new Float64Array(S);
  subjects.forEach((s, i) => {
    subjCat[i] = subjectWeight(s);
    const merged = isMergedSubject(s);
    subjMaxRun[i] = merged ? 3 : 2;
    subjSplitW[i] = merged ? WEIGHTS.mergedSplit : WEIGHTS.split;
  });

  const T = tList.length;
  const busyNow = new Set(data.slots.map((x) => `${x.teacherId}|${x.day}|${x.periodId}`));
  const unavail = new Uint8Array(T * D * P);
  /** ore a disposizione segnate sotto una lezione (indice T*D*P), da spostare nello stesso giorno */
  const dispUnder: number[] = [];
  const dayHasAway = new Uint8Array(T * D);
  const rientro = new Uint8Array(T * D);
  const must: SlotWish[][] = tList.map(() => []);
  const cpref: SlotWish[][] = tList.map(() => []);
  const prefer: { d: number; m: number }[][] = tList.map(() => []);
  // le classi di ogni docente, per le richieste su «tutte» le sue classi
  const classesOf: number[][] = tList.map(() => []);
  for (let u = 0; u < U; u++) {
    const list = classesOf[unitTeacher[u]!]!;
    if (!list.includes(unitClass[u]!)) list.push(unitClass[u]!);
  }
  tList.forEach((t, ti) => {
    for (const a of t.awaySlots ?? []) {
      const d = dayIdx.get(a.day);
      const pos = posOf.get(a.periodId);
      if (d === undefined || pos === undefined) continue;
      unavail[(ti * D + d) * P + pos] = 1;
      dayHasAway[ti * D + d] = 1;
    }
    if (t.otherPlesso) {
      for (let d = 0; d < D; d++) {
        for (const pos of morningPos) {
          const base = (ti * D + d) * P;
          if (unavail[base + pos] === 1) continue;
          for (let q = 0; q < P; q++) {
            if (unavail[base + q] === 1 && Math.abs(pIndex[q]! - pIndex[pos]!) === 1) {
              unavail[base + pos] = 2;
              break;
            }
          }
        }
      }
    }
    // «no»: mai in quell'ora, ma solo quella (non è un altro plesso: niente ora di spostamento).
    for (const a of t.avoidSlots ?? []) {
      const z = morningCell(a.day, a.periodId);
      if (z < 0) continue;
      const k = (ti * D + ((z / M) | 0)) * P + morningPos[z % M]!;
      if (!unavail[k]) unavail[k] = 3;
    }
    if (keepDisp) {
      for (const a of t.dispSlots ?? []) {
        const z = morningCell(a.day, a.periodId);
        if (z < 0) continue;
        const k = (ti * D + ((z / M) | 0)) * P + morningPos[z % M]!;
        if (busyNow.has(`${t.id}|${a.day}|${a.periodId}`)) {
          // sotto una lezione: con floatDisp si sposta in un'altra ora dello stesso giorno
          if (floatDisp && !unavail[k]) dispUnder.push(k);
          continue;
        }
        if (!unavail[k]) unavail[k] = 4;
      }
    }
    for (const rd of t.rientroDays ?? []) {
      const d = dayIdx.get(rd);
      if (d !== undefined) rientro[ti * D + d] = 1;
    }
    for (const a of t.mustSlots ?? []) {
      const z = morningCell(a.day, a.periodId);
      if (z < 0) continue;
      const d = (z / M) | 0;
      const m = z % M;
      const ids = a.classIds && a.classIds.length ? a.classIds : a.classId ? [a.classId] : [];
      const cl = a.allClasses
        ? classesOf[ti]!
        : ids.map((id) => classIdx.get(id)).filter((x): x is number => x !== undefined);
      if (cl.length === 0) continue;
      const hardOne = a.level === "obbligo";
      const un = unavail[(ti * D + d) * P + morningPos[m]!]!;
      if (un) {
        const where =
          un === 4 ? "a disposizione" : un === 3 ? "«no»" : un === 2 ? "di spostamento tra plessi" : "segnata altrove";
        warnings.push(`${teacherName(t)}: ${hardOne ? "obbligo" : "preferenza di classe"} in un'ora ${where}, ignorata.`);
        continue;
      }
      (hardOne ? must : cpref)[ti]!.push({ d, m, classes: cl });
    }
    for (const a of t.preferSlots ?? []) {
      const z = morningCell(a.day, a.periodId);
      if (z < 0) continue;
      prefer[ti]!.push({ d: (z / M) | 0, m: z % M });
    }
  });

  // «Tutte le sedi insieme»: sede di ogni classe e × segnate in una sola sede
  const classSede = new Int8Array(classes.length);
  const sedeUnavail = new Uint32Array(nSedi > 1 ? T * D * P : 0);
  if (insieme && nSedi > 1) {
    classes.forEach((c, i) => (classSede[i] = insieme.classSede[c.id] ?? 0));
    for (const [id, list] of Object.entries(insieme.sedeAway)) {
      const ti = teacherIdx.get(id);
      if (ti === undefined) continue;
      for (const a of list) {
        const d = dayIdx.get(a.day);
        const pos = posOf.get(a.periodId);
        if (d === undefined || pos === undefined) continue;
        sedeUnavail[(ti * D + d) * P + pos]! |= 1 << a.s;
      }
    }
  }

  // Chi insegna in più sedi: la sua giornata si conta come nell'app di ogni sede. Per ogni sede le × segnate lì e
  // le ore a disposizione lì (dove è a scuola); le ore nelle altre sedi le aggiunge il risolutore, come ×.
  const NSm = nSedi > 1 ? nSedi : 0;
  const multi = new Uint8Array(NSm ? T : 0);
  const sedeBits = new Uint32Array(NSm ? T : 0);
  const sedeAwayMask = new Uint32Array(T * D * NSm);
  const dispSede = new Uint32Array(T * D * NSm);
  const fillSede = new Int16Array(T * NSm);
  const dispFreeBase = new Uint32Array(T * D);
  for (let ti = 0; ti < T; ti++)
    for (let d = 0; d < D; d++)
      for (const pos of morningPos)
        if (!unavail[(ti * D + d) * P + pos] && !(rientro[ti * D + d] && pIndex[pos]! < 4)) dispFreeBase[ti * D + d]! |= 1 << pos;
  const nbrMask = new Uint32Array(P);
  for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) if (Math.abs(pIndex[a]! - pIndex[b]!) === 1) nbrMask[a]! |= 1 << b;
  let morningBits = 0;
  for (const pos of morningPos) morningBits |= 1 << pos;
  if (insieme && NSm) {
    tList.forEach((t, ti) => {
      if (!multiIds.has(t.id)) return;
      multi[ti] = 1;
      for (let d = 0; d < D; d++)
        for (let pos = 0; pos < P; pos++) {
          const bits = sedeUnavail[(ti * D + d) * P + pos]!;
          for (let x = 0; x < nSedi; x++) if ((bits >>> x) & 1) sedeAwayMask[(ti * D + d) * nSedi + x]! |= 1 << pos;
        }
      for (const r of insieme.sedeDisp?.[t.id] ?? []) {
        if (r.s < 0 || r.s >= nSedi) continue;
        sedeBits[ti]! |= 1 << r.s;
        // le ore a disposizione segnate restano ferme durante la ricerca (si sistemano dopo, sede per sede: così
        // trovano sempre posto); con «Da zero» quelle dichiarate ma non segnate vanno nelle buche
        let marked = 0;
        for (const a of r.slots) {
          const z = morningCell(a.day, a.periodId);
          if (z < 0 || (keepDisp && busyNow.has(`${t.id}|${a.day}|${a.periodId}`))) continue;
          const d = (z / M) | 0;
          const pos = morningPos[z % M]!;
          const k = (ti * D + d) * P + pos;
          if (!keepDisp && !unavail[k]) unavail[k] = 4;
          // come le ore a disposizione segnate: non dove c'è già un altro impegno
          if (unavail[k] !== 4) continue;
          dispSede[(ti * D + d) * nSedi + r.s]! |= 1 << pos;
          marked += 1;
        }
        if (!keepDisp) fillSede[ti * nSedi + r.s]! += Math.max(0, r.hours - marked);
      }
    });
  }

  // ore a disposizione segnate (bit = posizione) e ore del mattino dove una disposizione può stare
  const dispMask0 = new Uint32Array(T * D);
  const dispCand = new Uint32Array(T * D);
  for (let ti = 0; ti < T; ti++)
    for (let d = 0; d < D; d++) {
      const base = (ti * D + d) * P;
      for (const pos of morningPos) {
        const un = unavail[base + pos]!;
        if (un === 4) {
          dispMask0[ti * D + d]! |= 1 << pos;
          dispCand[ti * D + d]! |= 1 << pos;
        } else if (un === 0 && !(rientro[ti * D + d] && pIndex[pos]! < 4)) dispCand[ti * D + d]! |= 1 << pos;
      }
    }
  for (const k of dispUnder) {
    const kd = (k / P) | 0;
    dispMask0[kd]! |= 1 << (k % P);
  }

  const lessonsOf = new Int16Array(T);
  for (let u = 0; u < U; u++) lessonsOf[unitTeacher[u]!]! += 1;
  const fixedOf = new Int16Array(T);
  for (const f of fixed) fixedOf[f.t]! += 1;

  const lastCells = classes.length * D;
  const teachers: TeacherInfo[] = tList.map((t, ti) => {
    const lessons = lessonsOf[ti]!;
    // chi ha (quasi) tutta la cattedra qui viene tutti i giorni: pomeriggio e disposizioni contano per il carico
    const load = lessons + fixedOf[ti]! + dispCount(t);
    const otherPlesso = Boolean(t.otherPlesso);
    const patterns: Int16Array[] = [];
    for (const raw of teacherDayPatterns(t)) {
      const pat = normalizePattern(raw, D, P);
      if (pat && !patterns.some((x) => patternText(x) === patternText(pat))) patterns.push(pat);
    }
    if (patterns.length && lessons + fixedOf[ti]! > 0) {
      const off = patterns.filter((x) => x.reduce((a, b) => a + b, 0) !== load);
      if (off.length)
        warnings.push(
          `${teacherName(t)}: le ore al giorno scelte (${off.map((x) => patternText(x)).join(" o ")}) non tornano con le sue ${load} ore qui. Rivedile.`,
        );
    }
    // un giorno libero scelto non è un giorno vuoto da evitare
    const freeDay = patterns.some((x) => x.includes(0));
    // in più sedi: come nell'app di ogni sede, dove è «su più plessi» (niente giorni vuoti né cattedra intera)
    const multi = multiIds.has(t.id);
    const emptyW = otherPlesso || freeDay || multi ? 0 : load >= 10 ? WEIGHTS.emptyFull : load >= 5 ? WEIGHTS.emptyPart : 0;
    return {
      id: t.id,
      name: teacherName(t),
      otherPlesso,
      lessons,
      hours: load,
      full: !otherPlesso && !multi && Math.max(t.weeklyHours ?? 0, load) >= 18,
      emptyW,
      expectedLast: U > 0 ? (lessons * lastCells) / U : 0,
      patterns,
      fill: keepDisp ? 0 : multi && insieme?.sedeDisp ? fillSede.subarray(ti * nSedi, ti * nSedi + nSedi).reduce((n, x) => n + x, 0) : dispCount(t),
      allow2: Boolean(t.allowTwoFree) && !t.noGaps,
      noGaps: Boolean(t.noGaps),
    };
  });

  const mustOffset = new Int16Array(T);
  const cprefOffset = new Int16Array(T);
  for (let ti = 0; ti < T; ti++) {
    if (!must[ti]!.length && !cpref[ti]!.length) continue;
    const cap = new Map<number, number>();
    for (let u = 0; u < U; u++) {
      if (unitTeacher[u] !== ti) continue;
      cap.set(unitClass[u]!, (cap.get(unitClass[u]!) ?? 0) + 1);
    }
    if (must[ti]!.length) mustOffset[ti] = must[ti]!.length - maxMatch(must[ti]!, cap);
    if (cpref[ti]!.length) cprefOffset[ti] = cpref[ti]!.length - maxMatch(cpref[ti]!, cap);
  }

  const C = classes.length;
  const csHours = new Int16Array(C * S);
  for (let u = 0; u < U; u++) csHours[unitClass[u]! * S + unitSubj[u]!]! += 1;
  // Per i compiti: la materia con italiano e quella con matematica di ogni classe.
  const testSubj = new Int16Array(C * 2).fill(-1);
  for (let c = 0; c < C; c++) {
    (["Italiano", "Matematica"] as const).forEach((name, k) => {
      let best = -1;
      for (let x = 0; x < S; x++) {
        if (!csHours[c * S + x] || !subjectParts(subjects[x]!).includes(name)) continue;
        if (best < 0 || csHours[c * S + x]! > csHours[c * S + best]!) best = x;
      }
      testSubj[c * 2 + k] = best;
    });
  }
  // Se il docente alla 1ª non può mai (×, «no», rientro), le prime ore per i compiti sono la 2ª e la 3ª.
  const testFirst = new Uint8Array(C * 2);
  const freeAt = (t: number, d: number, m: number) => {
    const pos = morningPos[m]!;
    return !unavail[(t * D + d) * P + pos] && !(rientro[t * D + d] && pIndex[pos]! < 4);
  };
  const blockFree = (ts: Set<number>, m0: number) => {
    for (const t of ts) for (let d = 0; d < D; d++) if (freeAt(t, d, m0) && freeAt(t, d, m0 + 1)) return true;
    return false;
  };
  if (M >= 3) {
    for (let c = 0; c < C; c++) {
      for (let k = 0; k < 2; k++) {
        const x = testSubj[c * 2 + k]!;
        if (x < 0) continue;
        const ts = new Set<number>();
        for (const u of classUnits[c]!) if (unitSubj[u] === x) ts.add(unitTeacher[u]!);
        if (!blockFree(ts, 0) && blockFree(ts, 1)) testFirst[c * 2 + k] = 1;
      }
    }
  }

  const peSubj = new Int16Array(C).fill(-1);
  for (let c = 0; c < C; c++) {
    for (let x = 0; x < S; x++) if (csHours[c * S + x] && PE_RE.test(subjects[x]!)) peSubj[c] = x;
  }

  const orig = new Int32Array(C * DM).fill(-1);
  for (const s of data.slots) {
    if (!poolSet.has(s.teacherId) || !isMorning(s.periodId)) continue;
    const c = classIdx.get(s.classId);
    const z = morningCell(s.day, s.periodId);
    const t = teacherIdx.get(s.teacherId);
    const si = subjIdx.get(mergeMap.get(`${s.classId}|${s.teacherId}|${s.subject}`) ?? canonicalSubject(s.subject));
    if (c === undefined || z < 0) continue;
    orig[c * DM + z] = t === undefined || si === undefined ? -2 : t * S + si;
  }

  return {
    days,
    D,
    periods,
    P,
    morningPos,
    M,
    DM,
    pIndex,
    mOfPos,
    mensaPos,
    lastM: M - 1,
    classes,
    C,
    teachers,
    T,
    subjects,
    S,
    subjCat,
    subjMaxRun,
    subjSplitW,
    testSubj,
    testFirst,
    peSubj,
    unitClass,
    unitTeacher,
    unitSubj,
    unitReal,
    unitStart,
    locked,
    unitSlotId,
    U,
    classUnits,
    fixed,
    unavail,
    dayHasAway,
    rientro,
    must,
    mustOffset,
    cpref,
    cprefOffset,
    prefer,
    csHours,
    orig,
    warnings,
    unplaced,
    dispYield,
    floatDisp,
    dispMask0,
    dispCand,
    nSedi,
    mixedW: insieme?.mixedW ?? WEIGHTS.mixed,
    classSede,
    sedeNames: insieme?.sedi ?? [],
    sedeUnavail,
    multi,
    sedeBits,
    sedeAwayMask,
    dispSede,
    fillSede,
    dispFreeBase,
    nbrMask,
    morningBits,
  };
}

/** Quante posizioni nella maschera. */
function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Le posizioni tra a e b, esclusi a e b (a < b). */
function between(a: number, b: number): number {
  return b - a > 1 ? ((1 << b) - 1) & ~((2 << a) - 1) : 0;
}

/** La prima e l'ultima posizione della maschera (non vuota). */
function lowBit(x: number): number {
  return 31 - Math.clz32(x & -x);
}
function highBit(x: number): number {
  return 31 - Math.clz32(x);
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SolveMode = "scratch" | "improve";

/** Una mossa provata: variazioni del punteggio e dei vincoli, voci dopo la mossa, classi spostate. */
export type PeekResult = {
  ds: number;
  dh: number;
  /**
   * Vincoli che nessuna mossa può scambiare con altri (docente in due classi alla stessa ora, lezione su una
   * ×, senza ora di spostamento, regole tra sedi): quanti in più (positivo) o in meno, per i docenti toccati
   */
  dphys: number;
  G: Int32Array;
  lastMax: number;
  patOk: number;
  classes: number[];
  /** giornate di docente in cui le ore a disposizione cambiano posto (bit = posizione) */
  disp: { t: number; d: number; before: number; after: number }[];
  /** andate e ritorni tra plessi in più (> 0: la mossa non si propone) */
  shuttle: number;
};

export type SolveProgress = {
  fraction: number;
  iterations: number;
  bestHard: number;
  bestSoft: number;
  bestGaps: number;
  /** la migliore finora, se non rispetta ancora qualche vincolo: di chi e quando (es. «Rossi Mario · Lun») */
  bestHardWho?: string[];
};

const INF = 1e15;

/**
 * Voci del confronto, contate per parte dell'orario. «Migliora l'attuale» non ne peggiora nessuna.
 * Giornata di docente (8): 1ª–6ª, 6 lezioni, 5 lezioni, buche, giornate con 2+ buche, docenti a 18 ore,
 * giorni divisi tra plessi, giornate con una sola ora. Docente (2): ultime ore oltre il massimo di
 * partenza, classi preferite mancate. Classe (2): prime ore mancate, scienze motorie fuori dalle ultime
 * ore. Materia della classe (1): da 2 ore nello stesso giorno. Giornata di classe (5): pesante, senza
 * materie leggere, lingue 2 ore di fila, 3 ore di fila, materia spezzata.
 */
const MET_TD = 8;
const MET_TW = 2;
const MET_CW = 2;
const MET_CD = 5;
const OFF_TW = MET_TD;
const OFF_CW = OFF_TW + MET_TW;
const OFF_CS = OFF_CW + MET_CW;
const OFF_CD = OFF_CS + 1;
const NMET = OFF_CD + MET_CD;

/** Parametri della ricerca (temperature, cicli, quote delle mosse). */
export const TUNE = { t0a: 200, t0b: 80, t1: 3, cycles: 5, kempe: 0.25 };

/** Stato della ricerca. Le celle sono per classe: indice d*M + m (giorno, ora del mattino). */
export class TimetableSolver {
  readonly p: Prep;
  grid: Int16Array;
  unitCell: Int32Array;
  tOcc: Uint8Array;
  /** «Tutte le sedi insieme»: lezioni del docente per ora e per sede (T*D*P*nSedi; vuoto con una sede) */
  tSede: Uint8Array;
  ccount: Uint8Array;
  lastCount: Int16Array;
  cdCost: Float64Array;
  cdHard: Int32Array;
  csCost: Float64Array;
  tdCost: Float64Array;
  tdGaps: Int16Array;
  tdHard: Int32Array;
  /** andate e ritorni tra plessi per giornata di docente (qui → altrove → qui): la ricerca non li accetta mai */
  tdShuttle: Uint8Array;
  /** ore a scuola per giornata di docente (lezioni, pomeriggio, disposizioni segnate) */
  tdDuties: Int16Array;
  /** dove sono adesso le ore a disposizione del mattino, per giornata di docente (bit = posizione) */
  tdDisp: Uint32Array;
  twCost: Float64Array;
  twHard: Int32Array;
  twGaps: Int16Array;
  cwCost: Float64Array;
  soft = 0;
  hard = 0;
  hw: number = WEIGHTS.hard;
  /** peso pieno dei vincoli rigidi (in «Migliora» vale più delle voci che peggiorano) */
  private hardW: number = WEIGHTS.hard;
  /** «Migliora»: quanto vale sistemare un vincolo (0 = come hw) */
  private fixW = 0;
  trackChanges = false;
  rnd: () => number;
  iterations = 0;
  bestGrid: Int16Array;
  bestSoft = INF;
  bestHard = INF;
  private bestGaps = 0;
  lastGaps = 0;
  /** l'ultima giornata calcolata va dalla 1ª alla 6ª (senza pomeriggio) */
  lastSpan6 = false;
  /** l'ultima giornata calcolata: ore libere tra la prima e l'ultima lezione (buche e disposizioni) */
  lastMiddle = 0;
  private lastDuties = 0;
  private lastMixed = false;
  /** l'ultima giornata calcolata: vincoli tra sedi non rispettati */
  private lastSedeHard = 0;
  /** l'ultima giornata calcolata di un docente in più sedi: andate e ritorni (vedi viewsShuttle) */
  private lastSedeShuttle = 0;
  /** l'ultima giornata calcolata, una per sede: dalla 1ª alla 6ª, 6 e 5 lezioni, 2+ buche, un'ora sola */
  private lastSpanN = 0;
  private lastSixN = 0;
  private lastFiveN = 0;
  private lastMultiGapN = 0;
  private lastSingleN = 0;
  /** l'ultima giornata di un docente in più sedi: ore libere oltre il consentito (-1: una sede, da lastGaps) */
  private lastHardFree = -1;
  /**
   * Docente in più sedi: la giornata come la vede l'app di ogni sede in cui è a scuola (vedi sedeViews), per sede
   * e con bit = posizione: lezioni, ore a disposizione, ×, ore di spostamento, ore buche.
   */
  private vLes: Uint32Array;
  private vDisp: Uint32Array;
  private vX: Uint32Array;
  private vTravel: Uint32Array;
  private vGap: Uint32Array;
  private vSedi: Int16Array;
  private vN = 0;
  /** dove è a scuola, in qualsiasi sede (lezioni e ore a disposizione) */
  private vAll = 0;
  /** «Da zero», docente in più sedi: buche, impegni e disposizioni da mettere per giorno e sede (D*nSedi) */
  private gapSedeBuf: Int16Array;
  private dutySedeBuf: Int16Array;
  private fillSedeBuf: Int16Array;
  // voci del confronto per parte dell'orario e totali
  private tdMet: Int16Array;
  private twMet: Int16Array;
  private cwMet: Int16Array;
  private csMet: Uint8Array;
  private cdMet: Int16Array;
  private G = new Int32Array(NMET);
  private G0 = new Int32Array(NMET);
  private base = new Int32Array(NMET);
  /** «Migliora l'attuale»: nessuna voce sopra il valore di partenza */
  private pareto = false;
  private baseLastMax = Infinity;
  /** quanto le voci superano i valori di partenza (0 = nessun peggioramento) */
  pen = 0;
  bestPen = INF;
  private pw = 0;

  private wishTeachers: number[];
  // scratch
  private sCnt: Int16Array;
  private sSeg: Int16Array;
  private tCnt: Int16Array;
  private tSeg: Int16Array;
  private touched: Int16Array;
  private touchedT: Int16Array;
  private stampCD: Int32Array;
  private stampCS: Int32Array;
  private stampTD: Int32Array;
  private stampT: Int32Array;
  private stampCW: Int32Array;
  private stampC: Int32Array;
  private stamp = 1;
  private affCD: Int32Array;
  private affCS: Int32Array;
  private affTD: Int32Array;
  private affT: Int32Array;
  private affCW: Int32Array;
  private nCW = 0;
  private nCD = 0;
  private nCS = 0;
  private nTD = 0;
  private nT = 0;
  private uCD: Float64Array;
  private uCDh: Int32Array;
  private uCS: Float64Array;
  private uTD: Float64Array;
  private uTDg: Int16Array;
  private uTDh: Int32Array;
  private uTDs: Uint8Array;
  private uTDd: Int16Array;
  private uTDdisp: Uint32Array;
  private uT: Float64Array;
  private uTh: Int32Array;
  private uTg: Int16Array;
  private uCW: Float64Array;
  private uCDm: Int16Array;
  private uCSm: Uint8Array;
  private uTDm: Int16Array;
  private uTm: Int16Array;
  private uCWm: Int16Array;
  private kempeList: Int16Array;
  private patBuf: Int16Array;
  private fillBuf: Int16Array;
  private candBuf: Int16Array;
  private combBuf: Int16Array;
  /** docenti con ore al giorno scelte e loro lezioni */
  private patTeachers: number[];
  private teacherUnits: number[][];
  private dayOrder: Int16Array;

  constructor(prep: Prep, seed = 1) {
    this.p = prep;
    const { C, D, M, P, T, S, U } = prep;
    const DM = D * M;
    this.rnd = mulberry32(seed);
    this.grid = new Int16Array(C * DM).fill(-1);
    this.unitCell = new Int32Array(U).fill(-1);
    this.tOcc = new Uint8Array(T * D * P);
    this.tSede = new Uint8Array(prep.nSedi > 1 ? T * D * P * prep.nSedi : 0);
    const NS = Math.max(1, prep.nSedi);
    this.vLes = new Uint32Array(NS);
    this.vDisp = new Uint32Array(NS);
    this.vX = new Uint32Array(NS);
    this.vTravel = new Uint32Array(NS);
    this.vGap = new Uint32Array(NS);
    this.vSedi = new Int16Array(NS);
    this.gapSedeBuf = new Int16Array(Math.max(1, D) * NS);
    this.dutySedeBuf = new Int16Array(Math.max(1, D) * NS);
    this.fillSedeBuf = new Int16Array(Math.max(1, D) * NS);
    this.ccount = new Uint8Array(C * S * D);
    this.lastCount = new Int16Array(T);
    this.cdCost = new Float64Array(C * D);
    this.cdHard = new Int32Array(C * D);
    this.csCost = new Float64Array(C * S);
    this.tdCost = new Float64Array(T * D);
    this.tdGaps = new Int16Array(T * D);
    this.tdHard = new Int32Array(T * D);
    this.tdShuttle = new Uint8Array(T * D);
    this.tdDuties = new Int16Array(T * D);
    this.tdDisp = new Uint32Array(T * D);
    this.twCost = new Float64Array(T);
    this.twHard = new Int32Array(T);
    this.twGaps = new Int16Array(T);
    this.cwCost = new Float64Array(C);
    this.bestGrid = new Int16Array(C * DM).fill(-1);
    this.wishTeachers = [];
    for (let t = 0; t < T; t++) if (prep.must[t]!.length || prep.cpref[t]!.length) this.wishTeachers.push(t);
    this.sCnt = new Int16Array(Math.max(1, S));
    this.sSeg = new Int16Array(Math.max(1, S));
    this.tCnt = new Int16Array(Math.max(1, T));
    this.tSeg = new Int16Array(Math.max(1, T));
    this.touched = new Int16Array(M + 1);
    this.touchedT = new Int16Array(M + 1);
    this.stampCD = new Int32Array(C * D);
    this.stampCS = new Int32Array(C * S);
    this.stampTD = new Int32Array(T * D);
    this.stampT = new Int32Array(T);
    this.stampCW = new Int32Array(C);
    this.stampC = new Int32Array(C);
    const cap = 4 * (C * D + T * D + C * S + T) + 16;
    this.affCD = new Int32Array(cap);
    this.affCS = new Int32Array(cap);
    this.affTD = new Int32Array(cap);
    this.affT = new Int32Array(cap);
    this.affCW = new Int32Array(cap);
    this.uCD = new Float64Array(cap);
    this.uCDh = new Int32Array(cap);
    this.uCS = new Float64Array(cap);
    this.uTD = new Float64Array(cap);
    this.uTDg = new Int16Array(cap);
    this.uTDh = new Int32Array(cap);
    this.uTDs = new Uint8Array(cap);
    this.uTDd = new Int16Array(cap);
    this.uTDdisp = new Uint32Array(cap);
    this.uT = new Float64Array(cap);
    this.uTh = new Int32Array(cap);
    this.uTg = new Int16Array(cap);
    this.uCW = new Float64Array(cap);
    this.tdMet = new Int16Array(T * D * MET_TD);
    this.twMet = new Int16Array(T * MET_TW);
    this.cwMet = new Int16Array(C * MET_CW);
    this.csMet = new Uint8Array(C * S);
    this.cdMet = new Int16Array(C * D * MET_CD);
    this.uCDm = new Int16Array(cap * MET_CD);
    this.uCSm = new Uint8Array(cap);
    this.uTDm = new Int16Array(cap * MET_TD);
    this.uTm = new Int16Array(cap * MET_TW);
    this.uCWm = new Int16Array(cap * MET_CW);
    this.kempeList = new Int16Array(Math.max(1, C));
    this.patBuf = new Int16Array(Math.max(1, D));
    this.fillBuf = new Int16Array(Math.max(1, D));
    this.candBuf = new Int16Array(Math.max(1, P));
    this.combBuf = new Int16Array(Math.max(1, P));
    this.dayOrder = new Int16Array(Math.max(1, D));
    this.teacherUnits = prep.teachers.map(() => []);
    for (let u = 0; u < U; u++) this.teacherUnits[prep.unitTeacher[u]!]!.push(u);
    this.patTeachers = [];
    for (let t = 0; t < T; t++) if (prep.teachers[t]!.patterns.length && this.teacherUnits[t]!.length) this.patTeachers.push(t);
    this.resetOcc();
  }

  private resetOcc() {
    const p = this.p;
    this.tOcc.fill(0);
    this.tSede.fill(0);
    for (const f of p.fixed) {
      this.tOcc[(f.t * p.D + f.d) * p.P + f.pos]! += 1;
      this.bumpSede(f.t, f.d, f.pos, f.c, 1);
    }
  }

  /** «Tutte le sedi insieme»: una lezione in più (o in meno) del docente in quell'ora, nella sede della classe. */
  private bumpSede(t: number, d: number, pos: number, c: number, delta: number) {
    const p = this.p;
    if (p.nSedi < 2) return;
    this.tSede[((t * p.D + d) * p.P + pos) * p.nSedi + p.classSede[c]!]! += delta;
  }

  private occAt(t: number, z: number): number {
    const p = this.p;
    return this.tOcc[(t * p.D + ((z / p.M) | 0)) * p.P + p.morningPos[z % p.M]!]!;
  }

  // ---------- costruzione iniziale ----------

  private placeUnit(u: number, cell: number) {
    const p = this.p;
    const c = p.unitClass[u]!;
    this.grid[c * p.DM + cell] = u;
    this.unitCell[u] = cell;
    const t = p.unitTeacher[u]!;
    this.tOcc[(t * p.D + ((cell / p.M) | 0)) * p.P + p.morningPos[cell % p.M]!]! += 1;
    this.bumpSede(t, (cell / p.M) | 0, p.morningPos[cell % p.M]!, c, 1);
  }

  /** Mette le lezioni: dalla posizione iniziale se c'è, altrimenti a caso ma con criterio. */
  initialize(mode: SolveMode) {
    const p = this.p;
    const { C, D, M, P, DM } = p;
    this.grid.fill(-1);
    this.unitCell.fill(-1);
    this.resetOcc();
    const pending: number[] = [];
    if (mode === "improve") {
      // le ore bloccate al loro posto, poi le altre dove sono nell'orario in uso
      for (let u = 0; u < p.U; u++) {
        const z = p.unitStart[u]!;
        if (p.locked[u] && z >= 0 && this.grid[p.unitClass[u]! * DM + z] === -1) this.placeUnit(u, z);
      }
      for (let c = 0; c < C; c++) {
        const free = new Map<number, number[]>();
        for (const u of p.classUnits[c]!) {
          if (this.unitCell[u]! >= 0) continue;
          const key = p.unitTeacher[u]! * p.S + p.unitSubj[u]!;
          const arr = free.get(key) ?? [];
          arr.push(u);
          free.set(key, arr);
        }
        for (let cell = 0; cell < DM; cell++) {
          const key = p.orig[c * DM + cell]!;
          if (key < 0 || this.grid[c * DM + cell] !== -1) continue;
          const arr = free.get(key);
          if (arr && arr.length) this.placeUnit(arr.pop()!, cell);
        }
        for (const arr of free.values()) pending.push(...arr);
      }
    } else {
      for (let u = 0; u < p.U; u++) {
        if (p.unitStart[u]! >= 0 && this.grid[p.unitClass[u]! * DM + p.unitStart[u]!] === -1) this.placeUnit(u, p.unitStart[u]!);
        else pending.push(u);
      }
    }
    const room = (u: number) => {
      const t = p.unitTeacher[u]!;
      let n = 0;
      for (let d = 0; d < D; d++)
        for (let m = 0; m < M; m++) if (!p.unavail[(t * D + d) * P + p.morningPos[m]!]) n += 1;
      return n;
    };
    const shuffled = pending.map((u) => ({ u, r: room(u) + this.rnd() }));
    shuffled.sort((a, b) => a.r - b.r);
    for (const { u } of shuffled) {
      const c = p.unitClass[u]!;
      const t = p.unitTeacher[u]!;
      const options: number[] = [];
      const fallback: number[] = [];
      // un'andata e ritorno tra plessi solo se non c'è proprio altro posto (poi la ricerca la toglie)
      const shuttle: number[] = [];
      for (let cell = 0; cell < DM; cell++) {
        if (this.grid[c * DM + cell] !== -1) continue;
        const d = (cell / M) | 0;
        const pos = p.morningPos[cell % M]!;
        const k = (t * D + d) * P + pos;
        const ok =
          !p.unavail[k] &&
          this.tOcc[k] === 0 &&
          !(p.rientro[t * D + d] && p.pIndex[pos]! < 4) &&
          !(p.nSedi > 1 && (p.sedeUnavail[k]! >>> p.classSede[c]!) & 1);
        (this.addsShuttle(t, d, pos, c) ? shuttle : ok ? options : fallback).push(cell);
      }
      const list = options.length ? options : fallback.length ? fallback : shuttle;
      if (!list.length) continue;
      this.placeUnit(u, list[(this.rnd() * list.length) | 0]!);
    }
    this.recomputeAll();
  }

  /** Imposta direttamente le lezioni (per valutare un orario dato). */
  setState(cells: Int32Array) {
    const p = this.p;
    const DM = p.DM;
    this.grid.fill(-1);
    this.resetOcc();
    for (let u = 0; u < p.U; u++) {
      const cell = cells[u]!;
      this.unitCell[u] = cell;
      if (cell < 0) continue;
      const c = p.unitClass[u]!;
      if (this.grid[c * DM + cell] === -1) this.grid[c * DM + cell] = u;
      const t = p.unitTeacher[u]!;
      this.tOcc[(t * p.D + ((cell / p.M) | 0)) * p.P + p.morningPos[cell % p.M]!]! += 1;
      this.bumpSede(t, (cell / p.M) | 0, p.morningPos[cell % p.M]!, c, 1);
    }
    this.recomputeAll();
  }

  private loadBest() {
    const p = this.p;
    const { C, DM } = p;
    this.grid.set(this.bestGrid);
    this.resetOcc();
    this.unitCell.fill(-1);
    for (let c = 0; c < C; c++) {
      for (let cell = 0; cell < DM; cell++) {
        const u = this.bestGrid[c * DM + cell]!;
        if (u < 0) continue;
        this.unitCell[u] = cell;
        const t = p.unitTeacher[u]!;
        this.tOcc[(t * p.D + ((cell / p.M) | 0)) * p.P + p.morningPos[cell % p.M]!]! += 1;
        this.bumpSede(t, (cell / p.M) | 0, p.morningPos[cell % p.M]!, c, 1);
      }
    }
    this.recomputeAll();
  }

  recomputeAll() {
    const p = this.p;
    const { C, D, M, S, T } = p;
    this.ccount.fill(0);
    this.lastCount.fill(0);
    for (let u = 0; u < p.U; u++) {
      const cell = this.unitCell[u]!;
      if (cell < 0) continue;
      const d = (cell / M) | 0;
      const m = cell % M;
      this.ccount[(p.unitClass[u]! * S + p.unitSubj[u]!) * D + d]! += 1;
      if (m === p.lastM) this.lastCount[p.unitTeacher[u]!]! += 1;
    }
    this.soft = 0;
    this.hard = 0;
    for (let c = 0; c < C; c++)
      for (let d = 0; d < D; d++) {
        this.computeClassDay(c, d);
        this.soft += this.cdCost[c * D + d]!;
        this.hard += this.cdHard[c * D + d]!;
      }
    for (let c = 0; c < C; c++)
      for (let s = 0; s < S; s++) {
        this.computeSpread(c, s);
        this.soft += this.csCost[c * S + s]!;
      }
    for (let c = 0; c < C; c++) {
      this.computeClassWeek(c);
      this.soft += this.cwCost[c]!;
    }
    for (let t = 0; t < T; t++) {
      for (let d = 0; d < D; d++) this.computeTeacherDay(t, d);
      this.computeTeacherWeek(t);
      this.soft += this.twCost[t]!;
      this.hard += this.twHard[t]!;
    }
    const G = this.G;
    G.fill(0);
    for (let i = 0; i < T * D; i++) for (let j = 0; j < MET_TD; j++) G[j]! += this.tdMet[i * MET_TD + j]!;
    for (let t = 0; t < T; t++) for (let j = 0; j < MET_TW; j++) G[OFF_TW + j]! += this.twMet[t * MET_TW + j]!;
    for (let c = 0; c < C; c++) for (let j = 0; j < MET_CW; j++) G[OFF_CW + j]! += this.cwMet[c * MET_CW + j]!;
    for (let i = 0; i < C * S; i++) G[OFF_CS]! += this.csMet[i]!;
    for (let i = 0; i < C * D; i++) for (let j = 0; j < MET_CD; j++) G[OFF_CD + j]! += this.cdMet[i * MET_CD + j]!;
    this.pen = this.penalty();
  }

  /** Di quanto le voci superano i valori dell'orario di partenza (solo in «Migliora l'attuale»). */
  private penalty(): number {
    if (!this.pareto) return 0;
    let s = 0;
    for (let k = 0; k < NMET; k++) if (this.G[k]! > this.base[k]!) s += this.G[k]! - this.base[k]!;
    return s;
  }

  /** Totali delle voci (per i test). */
  metrics(): number[] {
    return Array.from(this.G);
  }

  // ---------- costi ----------

  private computeClassDay(c: number, d: number) {
    const p = this.p;
    const { M, S } = p;
    const W = WEIGHTS;
    const base = c * p.DM + d * M;
    let cost = 0;
    let hard = 0;
    let prevS = -1;
    let prevT = -1;
    let run = 0;
    let coreRun = 0;
    let theory = 0;
    let filled = 0;
    let nTouched = 0;
    let nTouchedT = 0;
    let firstFilled = -1;
    let lastFilled = -1;
    let maxCore = 0;
    let mLang = 0;
    let mSame = 0;
    let mSplit = 0;
    for (let m = 0; m < M; m++) {
      const u = this.grid[base + m]!;
      if (u < 0) {
        if (prevS >= 0) {
          if (run > p.subjMaxRun[prevS]!) mSame += 1;
          else if (run === 2 && p.subjCat[prevS] === 1) mLang += 1;
        }
        prevS = -1;
        prevT = -1;
        run = 0;
        coreRun = 0;
        continue;
      }
      filled += 1;
      if (firstFilled < 0) firstFilled = m;
      lastFilled = m;
      const s = p.unitSubj[u]!;
      const t = p.unitTeacher[u]!;
      const cat = p.subjCat[s]!;
      if (s === prevS) {
        run += 1;
        if (run > p.subjMaxRun[s]!) cost += W.sameRun;
        if (cat === 1 && run === 2) cost += W.langBlock;
      } else {
        if (prevS >= 0) {
          if (run > p.subjMaxRun[prevS]!) mSame += 1;
          else if (run === 2 && p.subjCat[prevS] === 1) mLang += 1;
        }
        run = 1;
      }
      if (this.sCnt[s] === 0 && this.sSeg[s] === 0) this.touched[nTouched++] = s;
      this.sCnt[s]! += 1;
      if (s !== prevS) this.sSeg[s]! += 1;
      if (cat === 2) {
        coreRun += 1;
        if (coreRun > maxCore) maxCore = coreRun;
        if (coreRun >= 4) cost += W.coreRun * (2 * coreRun - 7);
      } else coreRun = 0;
      if (cat >= 1) theory += 1;
      if (this.tCnt[t] === 0 && this.tSeg[t] === 0) this.touchedT[nTouchedT++] = t;
      this.tCnt[t]! += 1;
      if (t !== prevT) this.tSeg[t]! += 1;
      prevS = s;
      prevT = t;
      if (this.trackChanges) {
        const o = p.orig[base + m]!;
        if (o !== -1 && o !== t * S + s) cost += W.change;
      }
    }
    if (prevS >= 0) {
      if (run > p.subjMaxRun[prevS]!) mSame += 1;
      else if (run === 2 && p.subjCat[prevS] === 1) mLang += 1;
    }
    if (this.trackChanges) {
      for (let m = 0; m < M; m++) {
        if (this.grid[base + m]! < 0 && p.orig[base + m]! >= 0) cost += W.change;
      }
    }
    for (let i = 0; i < nTouched; i++) {
      const s = this.touched[i]!;
      const n = this.sCnt[s]!;
      const max = p.subjMaxRun[s]!;
      if (n > max) cost += W.sameDay * (n - max);
      const seg = this.sSeg[s]!;
      if (seg > 1) cost += p.subjSplitW[s]! * (seg - 1);
      if (seg > 1 && p.subjMaxRun[s] === 2) mSplit += 1;
      this.sCnt[s] = 0;
      this.sSeg[s] = 0;
    }
    for (let i = 0; i < nTouchedT; i++) {
      const t = this.touchedT[i]!;
      const n = this.tCnt[t]!;
      if (n > 3) cost += W.teacherDay * (n - 3);
      const seg = this.tSeg[t]!;
      if (seg > 1) cost += W.teacherSplit * (seg - 1);
      this.tCnt[t] = 0;
      this.tSeg[t] = 0;
    }
    if (filled === M && theory === M) cost += W.noLight;
    if (filled > 0 && filled < M) {
      for (let m = firstFilled + 1; m < lastFilled; m++) if (this.grid[base + m]! < 0) hard += 1;
      if (firstFilled > 0) cost += W.holeFirst;
    }
    this.cdCost[c * p.D + d] = cost;
    this.cdHard[c * p.D + d] = hard;
    const o = (c * p.D + d) * MET_CD;
    this.cdMet[o] = maxCore >= 4 ? 1 : 0;
    this.cdMet[o + 1] = filled === M && theory === M ? 1 : 0;
    this.cdMet[o + 2] = mLang;
    this.cdMet[o + 3] = mSame;
    this.cdMet[o + 4] = mSplit;
  }

  private computeSpread(c: number, s: number) {
    const p = this.p;
    const h = p.csHours[c * p.S + s]!;
    const base = (c * p.S + s) * p.D;
    this.csMet[c * p.S + s] = 0;
    if (h === 2) {
      let both = false;
      for (let d = 0; d < p.D; d++) if (this.ccount[base + d]! >= 2) both = true;
      this.csCost[c * p.S + s] = both ? WEIGHTS.twoBlock : 0;
      this.csMet[c * p.S + s] = both ? 1 : 0;
      return;
    }
    if (h < 4) {
      this.csCost[c * p.S + s] = 0;
      return;
    }
    let used = 0;
    for (let d = 0; d < p.D; d++) if (this.ccount[base + d]! > 0) used += 1;
    const need = Math.min(p.D, Math.ceil(h / 2) + 1);
    this.csCost[c * p.S + s] = used < need ? WEIGHTS.spread * (need - used) : 0;
  }

  /** Italiano e matematica: almeno un giorno con 1ª e 2ª ora, o 2ª e 3ª se serve (per i compiti). */
  private computeClassWeek(c: number) {
    const p = this.p;
    const { D, M, DM } = p;
    let cost = 0;
    let firstMiss = 0;
    let peMiss = 0;
    if (M >= 2) {
      for (let k = 0; k < 2; k++) {
        const s = p.testSubj[c * 2 + k]!;
        if (s < 0) continue;
        const m0 = p.testFirst[c * 2 + k]!;
        let best = 0;
        for (let d = 0; d < D && best < 2; d++) {
          const a = this.grid[c * DM + d * M + m0]!;
          const b = this.grid[c * DM + d * M + m0 + 1]!;
          const ha = a >= 0 && p.unitSubj[a] === s;
          const hb = b >= 0 && p.unitSubj[b] === s;
          const sc = ha && hb ? 2 : ha || hb ? 1 : 0;
          if (sc > best) best = sc;
        }
        cost += best === 2 ? 0 : best === 1 ? WEIGHTS.firstPartial : WEIGHTS.firstNone;
        if (best < 2) firstMiss += 1;
      }
    }
    const pe = p.peSubj[c]!;
    if (pe >= 0 && M >= 4) {
      let latest = -1;
      for (let z = 0; z < DM; z++) {
        const u = this.grid[c * DM + z]!;
        if (u >= 0 && p.unitSubj[u] === pe) latest = Math.max(latest, z % M);
      }
      if (latest >= 0) cost += latest < M - 3 ? WEIGHTS.peLate : WEIGHTS.peLater * (M - 1 - latest);
      if (latest < M - 3) peMiss = 1;
    }
    this.cwCost[c] = cost;
    this.cwMet[c * MET_CW] = firstMiss;
    this.cwMet[c * MET_CW + 1] = peMiss;
  }

  /**
   * Ora buca: un'ora vuota tra due impegni a scuola nella stessa giornata (da chiamare per le ore
   * tra il primo e l'ultimo). Non sono buche le ore a disposizione, quelle altrove (×) e di
   * spostamento, la mensa; un'ora «no» in mezzo invece sì (il docente resta senza lezione), e così
   * l'ora lasciata da una disposizione che si è spostata.
   */
  isGap(t: number, d: number, pos: number): boolean {
    const p = this.p;
    const k = (t * p.D + d) * p.P + pos;
    if (this.tOcc[k]! > 0 || pos === p.mensaPos || (this.tdDisp[t * p.D + d]! >>> pos) & 1) return false;
    const un = p.unavail[k]!;
    return un === 0 || un === 3 || un === 4;
  }

  /** Le ore a disposizione del mattino dove sono adesso (bit = posizione). */
  dispMask(t: number, d: number): number {
    return this.tdDisp[t * this.p.D + d]!;
  }

  /** Le ore a disposizione del mattino seguite dal motore: dove erano segnate e dove stanno adesso. */
  dispChange(): DispChange {
    const p = this.p;
    const before: DispCell[] = [];
    const after: DispCell[] = [];
    for (let t = 0; t < p.T; t++)
      for (let d = 0; d < p.D; d++) {
        const kd = t * p.D + d;
        const m0 = p.dispMask0[kd]!;
        if (!m0) continue;
        const m1 = this.tdDisp[kd]!;
        for (let pos = 0; pos < p.P; pos++) {
          const cell = { teacherId: p.teachers[t]!.id, day: p.days[d]!, periodId: p.periods[pos]!.id };
          if ((m0 >>> pos) & 1) before.push(cell);
          if ((m1 >>> pos) & 1) after.push({ ...cell });
        }
      }
    return { before, after };
  }

  /**
   * Prova le ore a disposizione del mattino del docente in `masks` (per giorno, bit = posizione) e dice
   * come va la sua settimana. Cambia p.dispMask0: da usare su un risolutore fatto apposta.
   */
  dispTry(t: number, masks: ArrayLike<number>): DispScore {
    const p = this.p;
    const D = p.D;
    for (let d = 0; d < D; d++) {
      p.dispMask0[t * D + d] = masks[d]!;
      this.computeTeacherDay(t, d);
    }
    this.computeTeacherWeek(t);
    // voci che una disposizione può peggiorare: dalla 1ª alla 6ª, 2 buche, cattedra intera, due plessi, un'ora sola, giorno vuoto
    const rows = [0, 0, 0, 0, 0, 0];
    const emptyW = p.teachers[t]!.emptyW;
    for (let d = 0; d < D; d++) {
      const o = (t * D + d) * MET_TD;
      rows[0]! += this.tdMet[o]!;
      rows[1]! += this.tdMet[o + 4]!;
      rows[2]! += this.tdMet[o + 5]!;
      rows[3]! += this.tdMet[o + 6]!;
      rows[4]! += this.tdMet[o + 7]!;
      if (emptyW > 0 && this.tdDuties[t * D + d] === 0) rows[5]! += 1;
    }
    return { hard: this.twHard[t]!, gaps: this.twGaps[t]!, rows, soft: this.twCost[t]! };
  }

  /**
   * Costo di una giornata di un docente: lezioni (il pomeriggio fisso conta) e, se segnate,
   * ore a disposizione, che sono presenza a scuola e non ore buche.
   */
  dayCost(t: number, d: number): number {
    const p = this.p;
    if (p.nSedi > 1 && p.multi[t]) return this.dayCostSedi(t, d);
    const P = p.P;
    const W = WEIGHTS;
    const info = p.teachers[t]!;
    const base = (t * p.D + d) * P;
    const disp = this.tdDisp[t * p.D + d]!;
    let first = -1;
    let last = -1;
    let lFirst = -1;
    let lLast = -1;
    let duties = 0;
    let lessonsM = 0;
    let afternoon = false;
    let mFirst = -1;
    let mLast = -1;
    let cost = 0;
    for (let pos = 0; pos < P; pos++) {
      const n = this.tOcc[base + pos]!;
      if (n === 0 && !((disp >>> pos) & 1)) continue;
      if (first < 0) first = pos;
      last = pos;
      duties += 1;
      const morning = p.mOfPos[pos]! >= 0;
      if (n > 0) {
        if (lFirst < 0) lFirst = pos;
        lLast = pos;
        if (morning) lessonsM += 1;
        else afternoon = true;
      }
      if (morning) {
        if (mFirst < 0) mFirst = pos;
        mLast = pos;
      }
    }
    this.lastDuties = duties;
    this.lastSedeHard = 0;
    this.lastHardFree = -1;
    this.lastSixN = lessonsM >= 6 ? 1 : 0;
    this.lastFiveN = lessonsM === 5 ? 1 : 0;
    this.lastSingleN = duties === 1 ? 1 : 0;
    if (duties === 0) {
      this.lastGaps = 0;
      this.lastSpan6 = false;
      this.lastMixed = false;
      this.lastMiddle = 0;
      this.lastSpanN = 0;
      this.lastMultiGapN = 0;
      return info.emptyW;
    }
    let gaps = 0;
    for (let pos = first + 1; pos < last; pos++) if (this.isGap(t, d, pos)) gaps += 1;
    // ore libere tra la prima e l'ultima lezione: buche (anche quelle da riempire) e disposizioni
    let middle = 0;
    for (let pos = lFirst + 1; pos < lLast; pos++)
      if (this.tOcc[base + pos] === 0 && ((disp >>> pos) & 1 || this.isGap(t, d, pos))) middle += 1;
    this.lastMiddle = middle;
    // chi ha disposizioni da mettere: le buche si contano sulla settimana (le prime si riempiono)
    if (info.fill === 0) {
      cost += W.gap * gaps;
      if (info.full) cost += W.gapFull * gaps;
    }
    if (gaps > 1) cost += W.gap2 * (gaps - 1);
    if (lessonsM >= 5) cost += W.five;
    if (lessonsM >= 6) cost += W.six * (lessonsM - 5);
    const span6 = !afternoon && mFirst >= 0 && p.pIndex[mLast]! - p.pIndex[mFirst]! + 1 >= 6;
    if (span6) cost += info.full ? W.span6 + W.span6Full : W.span6;
    if (duties === 1) cost += W.single;
    const mixed = info.otherPlesso && p.dayHasAway[t * p.D + d] === 1 && mFirst >= 0;
    if (mixed) {
      cost += p.mixedW;
      if (lessonsM <= 1) cost += W.mixedSingle;
    }
    this.lastGaps = gaps;
    this.lastSpan6 = span6;
    this.lastMixed = mixed;
    this.lastSpanN = span6 ? 1 : 0;
    this.lastMultiGapN = gaps >= 2 ? 1 : 0;
    return cost;
  }

  /**
   * «Tutte le sedi insieme», docente in più sedi: la giornata come la vede l'app di ogni sede in cui è a scuola,
   * dove le ore nelle altre sedi sono × e accanto alle × c'è l'ora di spostamento (che non è un'ora buca). Per
   * ogni sede (bit = posizione): lezioni, ore a disposizione, ×, ore di spostamento e ore buche, cioè le ore vuote
   * tra il primo e l'ultimo impegno lì. Restituisce in quante sedi è a scuola (le sedi in vSedi).
   */
  sedeViews(t: number, d: number): number {
    const p = this.p;
    const NS = p.nSedi;
    const base = (t * p.D + d) * p.P;
    const dk = (t * p.D + d) * NS;
    for (let s = 0; s < NS; s++) this.vLes[s] = 0;
    for (let pos = 0; pos < p.P; pos++) {
      const k = (base + pos) * NS;
      for (let s = 0; s < NS; s++) if (this.tSede[k + s]) this.vLes[s]! |= 1 << pos;
    }
    let lessons = 0;
    for (let s = 0; s < NS; s++) lessons |= this.vLes[s]!;
    let all = lessons;
    for (let s = 0; s < NS; s++) {
      // un'ora a disposizione sotto una lezione non c'è più
      this.vDisp[s] = p.dispSede[dk + s]! & ~lessons;
      all |= this.vDisp[s]!;
    }
    this.vAll = all;
    const mensa = p.mensaPos >= 0 ? 1 << p.mensaPos : 0;
    let n = 0;
    for (let s = 0; s < NS; s++) {
      const mine = this.vLes[s]! | this.vDisp[s]!;
      if (!mine) continue;
      this.vSedi[n++] = s;
      const x = p.sedeAwayMask[dk + s]! | (all & ~mine);
      let nb = 0;
      for (let m = x; m; m &= m - 1) nb |= p.nbrMask[lowBit(m)]!;
      const travel = nb & p.morningBits & ~x;
      this.vX[s] = x;
      this.vTravel[s] = travel;
      this.vGap[s] = between(lowBit(mine), highBit(mine)) & ~mine & ~x & ~travel & ~mensa;
    }
    this.vN = n;
    return n;
  }

  /**
   * Costo della giornata di un docente in più sedi: la somma delle giornate come le conta l'app di ogni sede
   * (buche, 5 e 6 lezioni, dalla 1ª alla 6ª, un'ora sola, ore libere oltre il consentito); la giornata divisa tra
   * più sedi conta una volta, come «qui e nell'altro plesso».
   */
  private dayCostSedi(t: number, d: number): number {
    const p = this.p;
    const W = WEIGHTS;
    const info = p.teachers[t]!;
    const NS = p.nSedi;
    const n = this.sedeViews(t, d);
    let cost = 0;
    let gaps = 0;
    let duties = 0;
    let span = 0;
    let six = 0;
    let five = 0;
    let multiGap = 0;
    let single = 0;
    let hardFree = 0;
    let mixed = false;
    let mixedSingle = false;
    for (let i = 0; i < n; i++) {
      const s = this.vSedi[i]!;
      const les = this.vLes[s]!;
      const disp = this.vDisp[s]!;
      const mine = les | disp;
      const g = popcount(this.vGap[s]!);
      const lm = popcount(les & p.morningBits);
      const mm = mine & p.morningBits;
      const sp = (les & ~p.morningBits) === 0 && mm !== 0 && p.pIndex[highBit(mm)]! - p.pIndex[lowBit(mm)]! + 1 >= 6;
      const du = popcount(mine);
      // ore libere tra la prima e l'ultima lezione lì: buche e disposizioni
      const middle = les ? popcount(between(lowBit(les), highBit(les)) & ~les & (disp | this.vGap[s]!)) : 0;
      // con disposizioni da mettere lì, le buche si contano sulla settimana (le prime si riempiono)
      if (p.fillSede[t * NS + s] === 0) cost += W.gap * g;
      if (g > 1) cost += W.gap2 * (g - 1);
      if (lm >= 5) cost += W.five;
      if (lm >= 6) cost += W.six * (lm - 5);
      if (sp) cost += W.span6;
      if (du === 1) cost += W.single;
      if (this.vX[s] !== 0 && mm !== 0) {
        mixed = true;
        if (lm <= 1) mixedSingle = true;
      }
      hardFree += Math.max(sp && g >= 2 ? g - 1 : 0, info.allow2 ? 0 : Math.max(0, middle - 1), info.noGaps ? g : 0);
      gaps += g;
      duties += du;
      if (sp) span += 1;
      if (lm >= 6) six += 1;
      else if (lm === 5) five += 1;
      if (g >= 2) multiGap += 1;
      if (du === 1) single += 1;
    }
    this.lastSedeHard = n ? this.sedeHardOf(t, d) : 0;
    this.lastSedeShuttle = n ? this.viewsShuttle() : 0;
    if (mixed) {
      cost += p.mixedW;
      if (mixedSingle) cost += W.mixedSingle;
    }
    this.lastGaps = gaps;
    this.lastSpan6 = span > 0;
    this.lastMixed = mixed;
    this.lastMiddle = 0;
    this.lastDuties = duties;
    this.lastHardFree = hardFree;
    this.lastSpanN = span;
    this.lastSixN = six;
    this.lastFiveN = five;
    this.lastMultiGapN = multiGap;
    this.lastSingleN = single;
    return duties === 0 ? info.emptyW : cost;
  }

  /**
   * Vincoli tra sedi della giornata (dopo sedeViews): niente lezioni in una sede dove l'ora è segnata ×, né
   * accanto a una × di quella sede (senza ora di spostamento); da una sede all'altra (lezioni e ore a
   * disposizione) almeno un'ora libera. Le andate e ritorni le conta viewsShuttle.
   */
  private sedeHardOf(t: number, d: number): number {
    const p = this.p;
    const dk = (t * p.D + d) * p.nSedi;
    let hard = 0;
    for (let i = 0; i < this.vN; i++) {
      const s = this.vSedi[i]!;
      const les = this.vLes[s]!;
      const away = p.sedeAwayMask[dk + s]!;
      hard += popcount(les & away);
      // accanto a una × dove non è in un'altra sede (se lo è, conta il cambio di sede qui sotto)
      let nb = 0;
      for (let m = away & ~this.vAll; m; m &= m - 1) nb |= p.nbrMask[lowBit(m)]!;
      hard += popcount(les & nb & p.morningBits & ~away);
    }
    let prevS = -1;
    let prevPos = -1;
    let prevLesson = false;
    for (let pos = 0; pos < p.P; pos++) {
      if (!((this.vAll >>> pos) & 1)) continue;
      let here = -1;
      let lesson = false;
      for (let i = 0; i < this.vN && here < 0; i++) {
        const s = this.vSedi[i]!;
        if ((this.vLes[s]! >>> pos) & 1) {
          here = s;
          lesson = true;
        }
      }
      for (let i = 0; i < this.vN && here < 0; i++) if ((this.vDisp[this.vSedi[i]!]! >>> pos) & 1) here = this.vSedi[i]!;
      if (prevS >= 0 && here !== prevS && (lesson || prevLesson) && p.pIndex[pos]! - p.pIndex[prevPos]! < 2) hard += 1;
      prevS = here;
      prevPos = pos;
      prevLesson = lesson;
    }
    return hard;
  }

  /**
   * Andate e ritorni della giornata di un docente in più sedi (dopo sedeViews), come li vede l'app di ogni sede
   * in cui è a scuola: lì le ore nelle altre sedi e le × sono «altrove»; ogni cambio dopo il primo ne conta uno.
   */
  private viewsShuttle(): number {
    let shuttle = 0;
    for (let i = 0; i < this.vN; i++) {
      const s = this.vSedi[i]!;
      const x = this.vX[s]!;
      let prev = 0;
      let changes = 0;
      for (let m = this.vLes[s]! | this.vDisp[s]! | x; m; m &= m - 1) {
        // l'ora × resta altrove anche con una lezione sopra (che è già un vincolo violato)
        const cur = (x >>> lowBit(m)) & 1 ? 2 : 1;
        if (prev && cur !== prev) changes += 1;
        prev = cur;
      }
      if (changes > 1) shuttle += changes - 1;
    }
    return shuttle;
  }

  /**
   * «Tutte le sedi insieme»: i vincoli tra sedi della giornata del docente (0 per chi è in una sede sola) e in
   * quante sedi è a scuola.
   */
  sedeDay(t: number, d: number): { hard: number; sedi: number } {
    const p = this.p;
    if (p.nSedi < 2 || !p.multi[t]) return { hard: 0, sedi: 1 };
    const sedi = this.sedeViews(t, d);
    return { hard: sedi ? this.sedeHardOf(t, d) + this.viewsShuttle() : 0, sedi };
  }

  /**
   * Per il resoconto: la giornata del docente in più sedi, sede per sede (vedi sedeViews).
   */
  sedeViewsOf(t: number, d: number): { s: number; les: number; disp: number; x: number; travel: number; gap: number }[] {
    const n = this.sedeViews(t, d);
    const out: { s: number; les: number; disp: number; x: number; travel: number; gap: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = this.vSedi[i]!;
      out.push({ s, les: this.vLes[s]!, disp: this.vDisp[s]!, x: this.vX[s]!, travel: this.vTravel[s]!, gap: this.vGap[s]! });
    }
    return out;
  }

  /** Lezioni accanto a una × della sede, dove il docente non è in un'altra sede (bit = posizione), per il resoconto. */
  sedeTravelMiss(t: number, d: number, s: number): number {
    const p = this.p;
    const away = p.sedeAwayMask[(t * p.D + d) * p.nSedi + s]!;
    let nb = 0;
    for (let m = away & ~this.vAll; m; m &= m - 1) nb |= p.nbrMask[lowBit(m)]!;
    return this.vLes[s]! & nb & p.morningBits & ~away;
  }

  /**
   * Vincoli della giornata che dipendono da dove stanno le ore libere (dopo dayCost):
   * al massimo un'ora libera tra le lezioni, buca o disposizione (salvo chi ne accetta 2), mai
   * dalla 1ª alla 6ª con 2 ore buche e nessuna buca per chi non le accetta.
   */
  private dayHardFree(t: number): number {
    if (this.lastHardFree >= 0) return this.lastHardFree;
    const g = this.lastGaps;
    const info = this.p.teachers[t]!;
    const span = this.lastSpan6 && g >= 2 ? g - 1 : 0;
    const middle = info.allow2 ? 0 : Math.max(0, this.lastMiddle - 1);
    return Math.max(span, middle, info.noGaps ? g : 0);
  }

  /**
   * Dove stanno le ore a disposizione del mattino nella giornata: dove le ha messe il responsabile,
   * tranne quelle sotto una lezione. Con `floatDisp` si spostano nello stesso giorno se così la
   * giornata va meglio (es. chiudono un'ora buca); a parità restano dove sono, o il più vicino possibile.
   */
  private placeDisp(t: number, d: number) {
    const p = this.p;
    const kd = t * p.D + d;
    const orig = p.dispMask0[kd]!;
    if (!orig) {
      this.tdDisp[kd] = 0;
      return;
    }
    const base = kd * p.P;
    let lessons = 0;
    for (let pos = 0; pos < p.P; pos++) if (this.tOcc[base + pos]! > 0) lessons |= 1 << pos;
    if (!p.floatDisp) {
      this.tdDisp[kd] = orig & ~lessons;
      return;
    }
    const cand = p.dispCand[kd]! & ~lessons;
    const list = this.candBuf;
    let n = 0;
    for (let pos = 0; pos < p.P; pos++) if ((cand >>> pos) & 1) list[n++] = pos;
    let k = 0;
    for (let x = orig; x; x &= x - 1) k += 1;
    k = Math.min(k, n);
    if (k === 0) {
      this.tdDisp[kd] = 0;
      return;
    }
    const idx = this.combBuf;
    for (let i = 0; i < k; i++) idx[i] = i;
    let best = Infinity;
    let bestMask = 0;
    let bestKeep = -1;
    let bestDist = Infinity;
    for (;;) {
      let mask = 0;
      for (let i = 0; i < k; i++) mask |= 1 << list[idx[i]!]!;
      this.tdDisp[kd] = mask;
      const cost = this.dayCost(t, d) + WEIGHTS.hard * (this.dayHardFree(t) + this.shuttleOf(t, d));
      if (cost <= best) {
        let keep = 0;
        for (let x = mask & orig; x; x &= x - 1) keep += 1;
        // distanza dalle ore segnate, nell'ordine
        let dist = 0;
        let a = orig;
        let b = mask;
        while (a && b) {
          const pa = 31 - Math.clz32(a & -a);
          const pb = 31 - Math.clz32(b & -b);
          dist += Math.abs(p.pIndex[pa]! - p.pIndex[pb]!);
          a &= a - 1;
          b &= b - 1;
        }
        if (cost < best || keep > bestKeep || (keep === bestKeep && dist < bestDist)) {
          best = cost;
          bestMask = mask;
          bestKeep = keep;
          bestDist = dist;
        }
      }
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i -= 1;
      if (i < 0) break;
      idx[i]! += 1;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
    }
    this.tdDisp[kd] = bestMask;
  }

  /**
   * Andate e ritorni tra plessi nella giornata del docente su due plessi: le ore a scuola qui (lezioni e
   * disposizioni) e quelle segnate altrove (×), in ordine; ogni cambio di plesso dopo il primo ne conta uno.
   * Per chi è in più sedi con «Tutte le sedi insieme», come li vede l'app di ogni sede (vedi viewsShuttle).
   */
  shuttleOf(t: number, d: number): number {
    const p = this.p;
    if (p.nSedi > 1 && p.multi[t]) return this.sedeViews(t, d) ? this.viewsShuttle() : 0;
    const kd = t * p.D + d;
    if (!p.teachers[t]!.otherPlesso || !p.dayHasAway[kd]) return 0;
    const base = kd * p.P;
    const disp = this.tdDisp[kd]!;
    let prev = 0;
    let changes = 0;
    for (let pos = 0; pos < p.P; pos++) {
      // l'ora × resta altrove anche con una lezione sopra (che è già un vincolo violato)
      const here = this.tOcc[base + pos]! > 0 || ((disp >>> pos) & 1) === 1;
      const cur = p.unavail[base + pos] === 1 ? 2 : here ? 1 : 0;
      if (!cur) continue;
      if (prev && cur !== prev) changes += 1;
      prev = cur;
    }
    return changes > 1 ? changes - 1 : 0;
  }

  /**
   * Una lezione in più del docente in quell'ora, nella classe, porterebbe un'andata e ritorno tra plessi?
   * (disposizioni dove segnate)
   */
  private addsShuttle(t: number, d: number, pos: number, c: number): boolean {
    const p = this.p;
    const kd = t * p.D + d;
    if (!(p.nSedi > 1 && p.multi[t]) && (!p.teachers[t]!.otherPlesso || !p.dayHasAway[kd])) return false;
    const k = kd * p.P + pos;
    const disp = this.tdDisp[kd]!;
    this.tdDisp[kd] = p.dispMask0[kd]!;
    const before = this.shuttleOf(t, d);
    this.tOcc[k]! += 1;
    this.bumpSede(t, d, pos, c, 1);
    const after = this.shuttleOf(t, d);
    this.tOcc[k]! -= 1;
    this.bumpSede(t, d, pos, c, -1);
    this.tdDisp[kd] = disp;
    return after > before;
  }

  private computeTeacherDay(t: number, d: number) {
    const p = this.p;
    const { P, M, D } = p;
    const base = (t * D + d) * P;
    let hard = 0;
    for (let pos = 0; pos < P; pos++) {
      const n = this.tOcc[base + pos]!;
      if (n > 1) hard += n - 1;
    }
    const early = p.rientro[t * D + d] === 1;
    for (let m = 0; m < M; m++) {
      const pos = p.morningPos[m]!;
      const n = this.tOcc[base + pos]!;
      if (n === 0) continue;
      const un = p.unavail[base + pos]!;
      if (un && !(un === 4 && p.dispYield)) hard += n;
      if (early && p.pIndex[pos]! < 4) hard += n;
    }
    this.placeDisp(t, d);
    this.tdCost[t * D + d] = this.dayCost(t, d);
    this.tdGaps[t * D + d] = this.lastGaps;
    this.tdDuties[t * D + d] = this.lastDuties;
    hard += this.lastSedeHard;
    // chi è in più sedi: già contate da dayCost (sedeViews)
    const shuttle = p.nSedi > 1 && p.multi[t] ? this.lastSedeShuttle : this.shuttleOf(t, d);
    this.tdShuttle[t * D + d] = shuttle;
    hard += shuttle;
    hard += this.dayHardFree(t);
    this.tdHard[t * D + d] = hard;
    const o = (t * D + d) * MET_TD;
    const g = this.lastGaps;
    const sp = this.lastSpan6;
    this.tdMet[o] = this.lastSpanN;
    this.tdMet[o + 1] = this.lastSixN;
    this.tdMet[o + 2] = this.lastFiveN;
    this.tdMet[o + 3] = g;
    this.tdMet[o + 4] = this.lastMultiGapN;
    this.tdMet[o + 5] = p.teachers[t]!.full ? (g > 0 ? 1 : 0) + (sp ? 1 : 0) : 0;
    this.tdMet[o + 6] = this.lastMixed ? 1 : 0;
    this.tdMet[o + 7] = this.lastSingleN;
  }

  private computeTeacherWeek(t: number) {
    const p = this.p;
    const { D, M, DM } = p;
    const W = WEIGHTS;
    const info = p.teachers[t]!;
    let hard = 0;
    let cost = 0;
    let gaps = 0;
    for (let d = 0; d < D; d++) {
      hard += this.tdHard[t * D + d]!;
      cost += this.tdCost[t * D + d]!;
      gaps += this.tdGaps[t * D + d]!;
    }
    // le disposizioni da mettere vanno nelle buche: restano buche solo quelle in più
    let real = gaps;
    if (info.fill > 0 && p.nSedi > 1 && p.multi[t]) {
      // in più sedi: le disposizioni di una sede vanno nelle buche di quella sede (e lì deve esserci posto)
      const filled = this.planFillSedi(t);
      real = gaps - filled;
      cost += W.gap * (this.fillGaps - filled);
      hard += this.fillDeficit;
    } else if (info.fill > 0) {
      real = gaps - this.planFill(t);
      cost += W.gap * real;
      if (info.full) cost += W.gapFull * real;
    }
    if (real > 2) cost += W.gapWeek * (real - 2);
    const excess = this.lastCount[t]! - info.expectedLast - 0.5;
    if (excess > 0) cost += W.lastHour * excess * excess;
    const prefs = p.prefer[t]!;
    if (prefs.length) {
      let hit = 0;
      for (const a of prefs) if (this.tOcc[(t * D + a.d) * p.P + p.morningPos[a.m]!]! > 0) hit += 1;
      const want = Math.min(prefs.length, info.lessons);
      if (hit < want) cost += W.prefer * (want - hit);
    }
    const missOf = (list: SlotWish[]) => {
      let miss = 0;
      for (const a of list) {
        let ok = false;
        for (const c of a.classes) {
          const u = this.grid[c * DM + a.d * M + a.m]!;
          if (u >= 0 && p.unitTeacher[u] === t) {
            ok = true;
            break;
          }
        }
        if (!ok) miss += 1;
      }
      return miss;
    };
    const prefMiss = p.cpref[t]!.length ? Math.max(0, missOf(p.cpref[t]!) - p.cprefOffset[t]!) : 0;
    cost += W.classPref * prefMiss;
    if (p.must[t]!.length) hard += Math.max(0, missOf(p.must[t]!) - p.mustOffset[t]!);
    if (info.patterns.length) hard += this.patternExcessOf(t, info.patterns, info.fill > 0 ? this.fillBuf : null);
    this.twCost[t] = cost;
    this.twHard[t] = hard;
    this.twGaps[t] = real;
    this.twMet[t * MET_TW] = this.pareto ? Math.max(0, this.lastCount[t]! - this.baseLastMax) : 0;
    this.twMet[t * MET_TW + 1] = prefMiss;
  }

  /**
   * «Da zero»: le disposizioni del docente vanno nelle sue buche (al massimo quante ne ha), prima nei
   * giorni meno pieni e senza superare le ore al giorno scelte. Mette in fillBuf quante per giorno e
   * restituisce quante in tutto.
   */
  private planFill(t: number): number {
    const p = this.p;
    const D = p.D;
    const info = p.teachers[t]!;
    const f = this.fillBuf;
    f.fill(0);
    let left = info.fill;
    let filled = 0;
    const pats = info.patterns;
    const start = pats.length ? this.patternExcessOf(t, pats, f) : 0;
    while (left > 0) {
      let best = -1;
      for (let d = 0; d < D; d++) {
        if (this.tdGaps[t * D + d]! - f[d]! <= 0) continue;
        if (best >= 0 && this.tdDuties[t * D + d]! + f[d]! >= this.tdDuties[t * D + best]! + f[best]!) continue;
        if (pats.length) {
          f[d]! += 1;
          const ok = this.patternExcessOf(t, pats, f) <= start;
          f[d]! -= 1;
          if (!ok) continue;
        }
        best = d;
      }
      if (best < 0) break;
      f[best]! += 1;
      left -= 1;
      filled += 1;
    }
    return filled;
  }

  /** Buche delle sedi con disposizioni da mettere (dopo planFillSedi). */
  private fillGaps = 0;
  /** Disposizioni che non trovano un'ora libera nella loro sede (dopo planFillSedi). */
  fillDeficit = 0;
  /** Per sede: disposizioni senza un'ora libera lì (dopo planFillSedi). */
  private deficitSede: Int16Array = new Int16Array(1);

  /**
   * «Da zero», docente in più sedi: le disposizioni di ogni sede nelle buche di quella sede, prima nei giorni meno
   * pieni lì. Mette in fillSedeBuf quante per giorno e sede, in fillBuf quante per giorno, in fillGaps le buche
   * delle sedi con disposizioni da mettere; restituisce quante in tutto.
   */
  private planFillSedi(t: number): number {
    const p = this.p;
    const { D } = p;
    const NS = p.nSedi;
    const g = this.gapSedeBuf;
    const du = this.dutySedeBuf;
    const fs = this.fillSedeBuf;
    g.fill(0);
    du.fill(0);
    fs.fill(0);
    this.fillBuf.fill(0);
    if (this.deficitSede.length < NS) this.deficitSede = new Int16Array(NS);
    const room = this.deficitSede;
    room.fill(0);
    for (let d = 0; d < D; d++) {
      const n = this.sedeViews(t, d);
      for (let i = 0; i < n; i++) {
        const s = this.vSedi[i]!;
        g[d * NS + s] = popcount(this.vGap[s]!);
        du[d * NS + s] = popcount(this.vLes[s]! | this.vDisp[s]!);
      }
      // ore libere per le disposizioni di ogni sede: non dove è in un'altra sede né accanto (ora di spostamento)
      const dk = (t * D + d) * NS;
      for (let s = 0; s < NS; s++) {
        if (p.fillSede[t * NS + s]! <= 0) continue;
        const mine = this.vLes[s]! | this.vDisp[s]!;
        const x = p.sedeAwayMask[dk + s]! | (this.vAll & ~mine);
        let nb = 0;
        for (let m = x; m; m &= m - 1) nb |= p.nbrMask[lowBit(m)]!;
        room[s]! += popcount(p.dispFreeBase[t * D + d]! & ~this.vAll & ~x & ~nb);
      }
    }
    let filled = 0;
    this.fillGaps = 0;
    this.fillDeficit = 0;
    for (let s = 0; s < NS; s++) {
      let left = p.fillSede[t * NS + s]!;
      if (left <= 0) continue;
      // senza abbastanza ore libere lì, le disposizioni non si possono mettere tutte
      room[s] = Math.max(0, left - room[s]!);
      this.fillDeficit += room[s]!;
      for (let d = 0; d < D; d++) this.fillGaps += g[d * NS + s]!;
      while (left > 0) {
        let best = -1;
        for (let d = 0; d < D; d++) {
          const k = d * NS + s;
          if (g[k]! - fs[k]! <= 0) continue;
          if (best >= 0 && du[k]! + fs[k]! >= du[best * NS + s]! + fs[best * NS + s]!) continue;
          best = d;
        }
        if (best < 0) break;
        fs[best * NS + s]! += 1;
        this.fillBuf[best]! += 1;
        left -= 1;
        filled += 1;
      }
    }
    return filled;
  }

  /** Disposizioni da mettere nelle buche, per giorno (solo «Da zero»). */
  fillPlan(t: number): number[] {
    if (this.p.teachers[t]!.fill <= 0) return new Array<number>(this.p.D).fill(0);
    if (this.p.nSedi > 1 && this.p.multi[t]) this.planFillSedi(t);
    else this.planFill(t);
    return Array.from(this.fillBuf);
  }

  /** Docente in più sedi: disposizioni da mettere nelle buche, per giorno e sede (D*nSedi; solo «Da zero»). */
  fillPlanSedi(t: number): number[] {
    const p = this.p;
    if (p.teachers[t]!.fill <= 0 || p.nSedi < 2 || !p.multi[t]) return new Array<number>(p.D * Math.max(1, p.nSedi)).fill(0);
    this.planFillSedi(t);
    return Array.from(this.fillSedeBuf);
  }

  /** Docente in più sedi, «Da zero»: per sede, le disposizioni che non trovano un'ora libera lì. */
  fillRoomMissing(t: number): number[] {
    const p = this.p;
    const NS = Math.max(1, p.nSedi);
    if (p.teachers[t]!.fill <= 0 || p.nSedi < 2 || !p.multi[t]) return new Array<number>(NS).fill(0);
    this.planFillSedi(t);
    return Array.from(this.deficitSede.subarray(0, NS));
  }

  /**
   * Come patternExcess (la scelta più vicina), senza allocare: giornate del docente dalla più piena.
   * `extra`: ore in più per giorno (le disposizioni messe nelle buche).
   */
  private patternExcessOf(t: number, pats: Int16Array[], extra: Int16Array | null = null): number {
    const D = this.p.D;
    const a = this.patBuf;
    for (let i = 0; i < D; i++) {
      const v = this.tdDuties[t * D + i]! + (extra ? extra[i]! : 0);
      let j = i - 1;
      while (j >= 0 && a[j]! < v) {
        a[j + 1] = a[j]!;
        j -= 1;
      }
      a[j + 1] = v;
    }
    let best = Infinity;
    for (const pat of pats) {
      let ex = 0;
      for (let i = 0; i < D; i++) if (a[i]! > pat[i]!) ex += a[i]! - pat[i]!;
      if (ex < best) best = ex;
      if (best === 0) break;
    }
    return best;
  }

  /** Docenti che rispettano le ore al giorno scelte. */
  patternOkCount(): number {
    let n = 0;
    for (const t of this.patTeachers) if (this.presenceExcess(t) === 0) n += 1;
    return n;
  }

  /** Di quanto il docente va oltre le ore al giorno scelte, con le disposizioni messe nelle buche. */
  private presenceExcess(t: number): number {
    const info = this.p.teachers[t]!;
    if (!info.patterns.length) return 0;
    if (info.fill > 0) {
      this.planFill(t);
      return this.patternExcessOf(t, info.patterns, this.fillBuf);
    }
    return this.patternExcessOf(t, info.patterns);
  }

  /** Ultime ore del docente che ne ha di più. */
  lastMax(): number {
    let m = 0;
    for (let t = 0; t < this.p.T; t++) if (this.p.teachers[t]!.lessons > 0 && this.lastCount[t]! > m) m = this.lastCount[t]!;
    return m;
  }

  // ---------- mosse ----------

  private beginAffect() {
    this.stamp += 1;
    if (this.stamp > 2_000_000_000) {
      this.stamp = 1;
      this.stampCD.fill(0);
      this.stampCS.fill(0);
      this.stampTD.fill(0);
      this.stampT.fill(0);
      this.stampCW.fill(0);
      this.stampC.fill(0);
    }
    this.nCD = this.nCS = this.nTD = this.nT = this.nCW = 0;
  }

  private addCD(i: number) {
    if (this.stampCD[i] === this.stamp) return;
    this.stampCD[i] = this.stamp;
    this.affCD[this.nCD++] = i;
    const c = (i / this.p.D) | 0;
    if (this.stampCW[c] !== this.stamp) {
      this.stampCW[c] = this.stamp;
      this.affCW[this.nCW++] = c;
    }
  }
  private addCS(i: number) {
    if (this.stampCS[i] === this.stamp) return;
    this.stampCS[i] = this.stamp;
    this.affCS[this.nCS++] = i;
  }
  private addTD(i: number) {
    if (this.stampTD[i] === this.stamp) return;
    this.stampTD[i] = this.stamp;
    this.affTD[this.nTD++] = i;
  }
  private addT(i: number) {
    if (this.stampT[i] === this.stamp) return;
    this.stampT[i] = this.stamp;
    this.affT[this.nT++] = i;
  }

  private affectUnitMove(u: number, fromCell: number, toCell: number) {
    const p = this.p;
    const { M, D, S } = p;
    const c = p.unitClass[u]!;
    const t = p.unitTeacher[u]!;
    const s = p.unitSubj[u]!;
    const df = (fromCell / M) | 0;
    const dt = (toCell / M) | 0;
    this.addCD(c * D + df);
    this.addCD(c * D + dt);
    if (df !== dt) this.addCS(c * S + s);
    this.addTD(t * D + df);
    this.addTD(t * D + dt);
    this.addT(t);
  }

  /** Cambia di posto le celle x e y della classe c. */
  private rawSwap(c: number, x: number, y: number) {
    const DM = this.p.DM;
    const ua = this.grid[c * DM + x]!;
    const ub = this.grid[c * DM + y]!;
    this.grid[c * DM + x] = ub;
    this.grid[c * DM + y] = ua;
    if (ua >= 0) this.moveUnit(ua, x, y, c);
    if (ub >= 0) this.moveUnit(ub, y, x, c);
  }

  private moveUnit(u: number, from: number, to: number, c: number) {
    const p = this.p;
    const { M, D, P, S } = p;
    this.unitCell[u] = to;
    const t = p.unitTeacher[u]!;
    const s = p.unitSubj[u]!;
    const df = (from / M) | 0;
    const mf = from % M;
    const dt = (to / M) | 0;
    const mt = to % M;
    this.tOcc[(t * D + df) * P + p.morningPos[mf]!]! -= 1;
    this.tOcc[(t * D + dt) * P + p.morningPos[mt]!]! += 1;
    this.bumpSede(t, df, p.morningPos[mf]!, c, -1);
    this.bumpSede(t, dt, p.morningPos[mt]!, c, 1);
    if (mf === p.lastM) this.lastCount[t]! -= 1;
    if (mt === p.lastM) this.lastCount[t]! += 1;
    if (df !== dt) {
      this.ccount[(c * S + s) * D + df]! -= 1;
      this.ccount[(c * S + s) * D + dt]! += 1;
    }
  }

  /**
   * Ricalcola le parti toccate (dopo aver salvato i vecchi valori).
   * Restituisce [Δsoft, Δhard, Δpeggioramenti delle voci].
   */
  private evaluateApplied(): [number, number, number] {
    const p = this.p;
    const { D, S } = p;
    const G = this.G;
    this.G0.set(G);
    this.dShuttle = 0;
    let oldSoft = 0;
    let oldHard = 0;
    let newSoft = 0;
    let newHard = 0;
    for (let i = 0; i < this.nCD; i++) {
      const k = this.affCD[i]!;
      this.uCD[i] = this.cdCost[k]!;
      this.uCDh[i] = this.cdHard[k]!;
      oldSoft += this.cdCost[k]!;
      oldHard += this.cdHard[k]!;
      for (let j = 0; j < MET_CD; j++) {
        const v = this.cdMet[k * MET_CD + j]!;
        this.uCDm[i * MET_CD + j] = v;
        G[OFF_CD + j]! -= v;
      }
      this.computeClassDay((k / D) | 0, k % D);
      newSoft += this.cdCost[k]!;
      newHard += this.cdHard[k]!;
      for (let j = 0; j < MET_CD; j++) G[OFF_CD + j]! += this.cdMet[k * MET_CD + j]!;
    }
    for (let i = 0; i < this.nCS; i++) {
      const k = this.affCS[i]!;
      this.uCS[i] = this.csCost[k]!;
      this.uCSm[i] = this.csMet[k]!;
      G[OFF_CS]! -= this.csMet[k]!;
      oldSoft += this.csCost[k]!;
      this.computeSpread((k / S) | 0, k % S);
      newSoft += this.csCost[k]!;
      G[OFF_CS]! += this.csMet[k]!;
    }
    for (let i = 0; i < this.nTD; i++) {
      const k = this.affTD[i]!;
      this.uTD[i] = this.tdCost[k]!;
      this.uTDg[i] = this.tdGaps[k]!;
      this.uTDh[i] = this.tdHard[k]!;
      this.uTDs[i] = this.tdShuttle[k]!;
      this.uTDd[i] = this.tdDuties[k]!;
      this.uTDdisp[i] = this.tdDisp[k]!;
      for (let j = 0; j < MET_TD; j++) {
        const v = this.tdMet[k * MET_TD + j]!;
        this.uTDm[i * MET_TD + j] = v;
        G[j]! -= v;
      }
      this.computeTeacherDay((k / D) | 0, k % D);
      this.dShuttle += this.tdShuttle[k]! - this.uTDs[i]!;
      for (let j = 0; j < MET_TD; j++) G[j]! += this.tdMet[k * MET_TD + j]!;
    }
    for (let i = 0; i < this.nT; i++) {
      const t = this.affT[i]!;
      this.uT[i] = this.twCost[t]!;
      this.uTh[i] = this.twHard[t]!;
      this.uTg[i] = this.twGaps[t]!;
      for (let j = 0; j < MET_TW; j++) {
        const v = this.twMet[t * MET_TW + j]!;
        this.uTm[i * MET_TW + j] = v;
        G[OFF_TW + j]! -= v;
      }
      oldSoft += this.twCost[t]!;
      oldHard += this.twHard[t]!;
      this.computeTeacherWeek(t);
      newSoft += this.twCost[t]!;
      newHard += this.twHard[t]!;
      for (let j = 0; j < MET_TW; j++) G[OFF_TW + j]! += this.twMet[t * MET_TW + j]!;
    }
    for (let i = 0; i < this.nCW; i++) {
      const c = this.affCW[i]!;
      this.uCW[i] = this.cwCost[c]!;
      for (let j = 0; j < MET_CW; j++) {
        const v = this.cwMet[c * MET_CW + j]!;
        this.uCWm[i * MET_CW + j] = v;
        G[OFF_CW + j]! -= v;
      }
      oldSoft += this.cwCost[c]!;
      this.computeClassWeek(c);
      newSoft += this.cwCost[c]!;
      for (let j = 0; j < MET_CW; j++) G[OFF_CW + j]! += this.cwMet[c * MET_CW + j]!;
    }
    return [newSoft - oldSoft, newHard - oldHard, this.penalty() - this.pen];
  }

  private restoreCaches() {
    for (let i = 0; i < this.nCD; i++) {
      const k = this.affCD[i]!;
      this.cdCost[k] = this.uCD[i]!;
      this.cdHard[k] = this.uCDh[i]!;
      for (let j = 0; j < MET_CD; j++) this.cdMet[k * MET_CD + j] = this.uCDm[i * MET_CD + j]!;
    }
    for (let i = 0; i < this.nCS; i++) {
      this.csCost[this.affCS[i]!] = this.uCS[i]!;
      this.csMet[this.affCS[i]!] = this.uCSm[i]!;
    }
    for (let i = 0; i < this.nTD; i++) {
      const k = this.affTD[i]!;
      this.tdCost[k] = this.uTD[i]!;
      this.tdGaps[k] = this.uTDg[i]!;
      this.tdHard[k] = this.uTDh[i]!;
      this.tdShuttle[k] = this.uTDs[i]!;
      this.tdDuties[k] = this.uTDd[i]!;
      this.tdDisp[k] = this.uTDdisp[i]!;
      for (let j = 0; j < MET_TD; j++) this.tdMet[k * MET_TD + j] = this.uTDm[i * MET_TD + j]!;
    }
    for (let i = 0; i < this.nT; i++) {
      const t = this.affT[i]!;
      this.twCost[t] = this.uT[i]!;
      this.twHard[t] = this.uTh[i]!;
      this.twGaps[t] = this.uTg[i]!;
      for (let j = 0; j < MET_TW; j++) this.twMet[t * MET_TW + j] = this.uTm[i * MET_TW + j]!;
    }
    for (let i = 0; i < this.nCW; i++) {
      const c = this.affCW[i]!;
      this.cwCost[c] = this.uCW[i]!;
      for (let j = 0; j < MET_CW; j++) this.cwMet[c * MET_CW + j] = this.uCWm[i * MET_CW + j]!;
    }
    this.G.set(this.G0);
  }

  /** Chi ha obblighi o preferenze di classe nella casella x o y va ricalcolato. */
  private markWishTeachers(c: number, x: number, y: number) {
    const p = this.p;
    for (const t of this.wishTeachers) {
      let hit = false;
      for (const list of [p.must[t]!, p.cpref[t]!]) {
        for (const a of list) {
          const cell = a.d * p.M + a.m;
          if ((cell === x || cell === y) && a.classes.includes(c)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) this.addT(t);
    }
  }

  /** Solo prova: la mossa si valuta e si annulla sempre (per scegliere la migliore). */
  private peeking = false;
  private peeked: [number, number, number] = [0, 0, 0];
  /** andate e ritorni tra plessi in più con la mossa appena valutata (o provata) */
  private dShuttle = 0;
  private peekedShuttle = 0;
  private peekClasses: number[] = [];
  /** per i ritocchi: le voci dopo la mossa provata */
  private peekDetail = false;
  private peekOut: PeekResult | null = null;

  private decide(temp: number, undo: () => void): boolean {
    const [ds, dh, dp] = this.evaluateApplied();
    if (this.peeking) {
      this.peeked = [ds, dh, dp];
      this.peekedShuttle = this.dShuttle;
      let physAfter = 0;
      if (this.peekDetail) {
        const disp: PeekResult["disp"] = [];
        for (let i = 0; i < this.nTD; i++) {
          const k = this.affTD[i]!;
          physAfter += this.physicalTD(k);
          if (this.uTDdisp[i] !== this.tdDisp[k])
            disp.push({ t: (k / this.p.D) | 0, d: k % this.p.D, before: this.uTDdisp[i]!, after: this.tdDisp[k]! });
        }
        this.peekOut = {
          ds,
          dh,
          dphys: 0,
          G: Int32Array.from(this.G),
          lastMax: this.lastMax(),
          patOk: this.patternOkCount(),
          classes: this.peekClasses.slice(),
          disp,
          shuttle: this.dShuttle,
        };
      }
      undo();
      if (this.peekOut && this.peekDetail) {
        let physBefore = 0;
        for (let i = 0; i < this.nTD; i++) physBefore += this.physicalTD(this.affTD[i]!);
        this.peekOut.dphys = physAfter - physBefore;
      }
      this.restoreCaches();
      return false;
    }
    // un'andata e ritorno tra plessi in più non si accetta mai (solo le mosse a mano, a temperatura infinita)
    if (this.dShuttle > 0 && Number.isFinite(temp)) {
      undo();
      this.restoreCaches();
      return false;
    }
    // in «Migliora» un vincolo si sistema volentieri solo se costa al massimo una voce peggiorata
    const wh = dh < 0 && this.fixW > 0 ? this.fixW : this.hw;
    const delta = ds + wh * dh + this.pw * dp;
    if (delta <= 0 || (temp > 0 && this.rnd() < Math.exp(-delta / temp))) {
      this.soft += ds;
      this.hard += dh;
      this.pen += dp;
      return true;
    }
    undo();
    this.restoreCaches();
    return false;
  }

  /**
   * I vincoli della giornata `k` (docente * D + giorno) che nessuna mossa può scambiare con altri: il docente
   * in due classi alla stessa ora, una lezione su una ×, senza l'ora di spostamento, le regole tra sedi.
   */
  private physicalTD(k: number): number {
    const p = this.p;
    const base = k * p.P;
    let n = 0;
    for (let pos = 0; pos < p.P; pos++) {
      const occ = this.tOcc[base + pos]!;
      if (occ > 1) n += occ - 1;
    }
    for (let m = 0; m < p.M; m++) {
      const pos = p.morningPos[m]!;
      const occ = this.tOcc[base + pos]!;
      const un = p.unavail[base + pos]!;
      if (occ && (un === 1 || un === 2)) n += occ;
    }
    if (p.nSedi > 1) n += this.sedeDay((k / p.D) | 0, k % p.D).hard;
    return n;
  }

  /** Prova a scambiare due celle di una classe. */
  private trySwap(c: number, x: number, y: number, temp: number): boolean {
    const p = this.p;
    const DM = p.DM;
    const ua = this.grid[c * DM + x]!;
    const ub = this.grid[c * DM + y]!;
    if (ua === ub) return false;
    if (ua >= 0 && ub >= 0 && p.unitTeacher[ua] === p.unitTeacher[ub] && p.unitSubj[ua] === p.unitSubj[ub]) return false;
    if ((ua >= 0 && p.locked[ua]) || (ub >= 0 && p.locked[ub])) return false;
    if (this.peeking) this.peekClasses = [c];
    this.beginAffect();
    if (ua >= 0) this.affectUnitMove(ua, x, y);
    if (ub >= 0) this.affectUnitMove(ub, y, x);
    if (ua < 0 || ub < 0) {
      this.addCD(c * p.D + ((x / p.M) | 0));
      this.addCD(c * p.D + ((y / p.M) | 0));
    }
    this.markWishTeachers(c, x, y);
    this.rawSwap(c, x, y);
    return this.decide(temp, () => this.rawSwap(c, x, y));
  }

  /** Catena di Kempe tra le celle x e y partendo dalla classe c. */
  private tryKempe(c0: number, x: number, y: number, temp: number): boolean {
    const p = this.p;
    const { C, D, M, DM } = p;
    if (x === y) return false;
    this.stamp += 1;
    const mark = this.stamp;
    let n = 0;
    this.kempeList[n++] = c0;
    this.stampC[c0] = mark;
    for (let i = 0; i < n; i++) {
      const c = this.kempeList[i]!;
      for (let side = 0; side < 2; side++) {
        const cell = side === 0 ? x : y;
        const target = side === 0 ? y : x;
        const u = this.grid[c * DM + cell]!;
        if (u < 0) continue;
        const t = p.unitTeacher[u]!;
        for (let c2 = 0; c2 < C; c2++) {
          if (this.stampC[c2] === mark) continue;
          const v = this.grid[c2 * DM + target]!;
          if (v >= 0 && p.unitTeacher[v] === t) {
            this.stampC[c2] = mark;
            this.kempeList[n++] = c2;
          }
        }
      }
    }
    if (n === 1) return this.trySwap(c0, x, y, temp);
    const list = Array.from(this.kempeList.subarray(0, n));
    for (const c of list) {
      const ua = this.grid[c * DM + x]!;
      const ub = this.grid[c * DM + y]!;
      if ((ua >= 0 && p.locked[ua]) || (ub >= 0 && p.locked[ub])) return false;
    }
    if (this.peeking) this.peekClasses = list;
    this.beginAffect();
    for (const c of list) {
      const ua = this.grid[c * DM + x]!;
      const ub = this.grid[c * DM + y]!;
      if (ua >= 0) this.affectUnitMove(ua, x, y);
      if (ub >= 0) this.affectUnitMove(ub, y, x);
      this.addCD(c * D + ((x / M) | 0));
      this.addCD(c * D + ((y / M) | 0));
      this.markWishTeachers(c, x, y);
    }
    for (const c of list) this.rawSwap(c, x, y);
    return this.decide(temp, () => {
      for (const c of list) this.rawSwap(c, x, y);
    });
  }

  // ---------- ritocchi a mano ----------

  /** Prova lo scambio delle celle x e y della classe c (o la catena) senza applicarlo; null se non si può. */
  peekMove(c: number, x: number, y: number, kempe: boolean): PeekResult | null {
    this.peeking = true;
    this.peekDetail = true;
    this.peekOut = null;
    if (kempe) this.tryKempe(c, x, y, 0);
    else this.trySwap(c, x, y, 0);
    this.peeking = false;
    this.peekDetail = false;
    return this.peekOut;
  }

  /** Applica lo scambio (o la catena); restituisce le classi spostate, null se non si può. */
  applyMove(c: number, x: number, y: number, kempe: boolean): number[] | null {
    const peek = this.peekMove(c, x, y, kempe);
    if (!peek) return null;
    if (kempe) this.tryKempe(c, x, y, Number.POSITIVE_INFINITY);
    else this.trySwap(c, x, y, Number.POSITIVE_INFINITY);
    return peek.classes;
  }

  /** Scambia le celle x e y nelle classi date così come sono (anche due ore unite dello stesso docente). */
  swapClasses(classes: number[], x: number, y: number) {
    for (const c of classes) this.rawSwap(c, x, y);
    this.recomputeAll();
  }

  // ---------- ricerca ----------

  /**
   * Vincoli rigidi ancora da sistemare (es. ore al giorno scelte): prova tutti gli scambi e le catene
   * e applica ogni volta quello che ne sistema di più peggiorando meno le voci del confronto.
   */
  repairHard(maxSteps = 40) {
    const p = this.p;
    const DM = p.DM;
    for (let step = 0; step < maxSteps && this.hard > 0; step++) {
      let best: { c: number; x: number; y: number; kempe: boolean; d: [number, number, number] } | null = null;
      this.peeking = true;
      for (let c = 0; c < p.C; c++) {
        for (let x = 0; x < DM; x++) {
          for (let y = x + 1; y < DM; y++) {
            for (const kempe of [false, true]) {
              this.peeked = [0, 0, 0];
              this.peekedShuttle = 0;
              if (kempe) this.tryKempe(c, x, y, 0);
              else this.trySwap(c, x, y, 0);
              const d = this.peeked;
              if (d[1] >= 0 || this.peekedShuttle > 0) continue;
              // meno voci peggiorate per ogni vincolo sistemato, poi più vincoli sistemati, poi il punteggio
              const r = d[2] / -d[1];
              const rb = best ? best.d[2] / -best.d[1] : 0;
              if (!best || r < rb || (r === rb && (d[1] < best.d[1] || (d[1] === best.d[1] && d[0] < best.d[0]))))
                best = { c, x, y, kempe, d: [d[0], d[1], d[2]] };
            }
          }
        }
      }
      this.peeking = false;
      if (!best) break;
      // applica la mossa scelta (a temperatura infinita: si accetta comunque)
      if (best.kempe) this.tryKempe(best.c, best.x, best.y, Number.POSITIVE_INFINITY);
      else this.trySwap(best.c, best.x, best.y, Number.POSITIVE_INFINITY);
      this.saveBest();
    }
  }

  /** La migliore finora: dove sono i vincoli non rispettati (giornata di docente k, di classe -1-k, settimana -1e6-t). */
  private bestHardAt: number[] = [];

  private saveBest() {
    const better =
      this.hard < this.bestHard ||
      (this.hard === this.bestHard &&
        (this.pen < this.bestPen || (this.pen === this.bestPen && this.soft < this.bestSoft - 1e-9)));
    if (better) {
      this.bestHard = this.hard;
      this.bestPen = this.pen;
      this.bestSoft = this.soft;
      this.bestGrid.set(this.grid);
      let g = 0;
      for (let t = 0; t < this.p.T; t++) g += this.twGaps[t]!;
      this.bestGaps = g;
      this.bestHardAt = this.hard > 0 ? this.hardSpots(3) : [];
    }
  }

  /** Dove sono i vincoli non rispettati, al massimo `max`: giornate di docente e di classe, settimane di docente. */
  private hardSpots(max: number): number[] {
    const p = this.p;
    const { D } = p;
    const out: number[] = [];
    for (let k = 0; k < p.T * D && out.length < max; k++) if (this.tdHard[k]! > 0) out.push(k);
    for (let k = 0; k < p.C * D && out.length < max; k++) if (this.cdHard[k]! > 0) out.push(-1 - k);
    for (let t = 0; t < p.T && out.length < max; t++) {
      let days = 0;
      for (let d = 0; d < D; d++) days += this.tdHard[t * D + d]!;
      if (this.twHard[t]! > days) out.push(-1_000_000 - t);
    }
    return out;
  }

  /** Chiude la ricerca al prossimo passo e tiene il migliore trovato. */
  requestStop() {
    this.schedule.totalMs = Math.max(1, Math.min(this.schedule.totalMs, this.schedule.elapsed));
  }

  /**
   * Mossa mirata: un docente che supera le ore al giorno scelte sposta una lezione da un giorno troppo
   * pieno a un giorno che ha posto (stessa classe, scambio o catena).
   */
  private tryPatternMove(temp: number): boolean {
    const p = this.p;
    const { D, M } = p;
    const n = this.patTeachers.length;
    let t = -1;
    for (let k = 0, start = (this.rnd() * n) | 0; k < n; k++) {
      const cand = this.patTeachers[(start + k) % n]!;
      if (this.presenceExcess(cand) > 0) {
        t = cand;
        break;
      }
    }
    if (t < 0) return false;
    // la scelta più vicina alle giornate di adesso (patBuf: giornate dalla più piena)
    const fills = p.teachers[t]!.fill > 0;
    this.presenceExcess(t);
    let pat = p.teachers[t]!.patterns[0]!;
    let bestEx = Infinity;
    for (const cand of p.teachers[t]!.patterns) {
      let ex = 0;
      for (let i = 0; i < D; i++) if (this.patBuf[i]! > cand[i]!) ex += this.patBuf[i]! - cand[i]!;
      if (ex < bestEx) {
        bestEx = ex;
        pat = cand;
      }
    }
    // giorni dal più pieno (a pari ore, ordine casuale) abbinati alle ore scelte dalla più alta
    const order = this.dayOrder;
    for (let d = 0; d < D; d++) order[d] = d;
    for (let i = D - 1; i > 0; i--) {
      const j = (this.rnd() * (i + 1)) | 0;
      const x = order[i]!;
      order[i] = order[j]!;
      order[j] = x;
    }
    const duty = (d: number) => this.tdDuties[t * D + d]! + (fills ? this.fillBuf[d]! : 0);
    for (let i = 1; i < D; i++) {
      const v = order[i]!;
      let j = i - 1;
      while (j >= 0 && duty(order[j]!) < duty(v)) {
        order[j + 1] = order[j]!;
        j -= 1;
      }
      order[j + 1] = v;
    }
    let over = -1;
    let under = -1;
    let nOver = 0;
    let nUnder = 0;
    for (let i = 0; i < D; i++) {
      const d = order[i]!;
      if (duty(d) > pat[i]! && this.rnd() * ++nOver < 1) over = d;
      if (duty(d) < pat[i]! && this.rnd() * ++nUnder < 1) under = d;
    }
    if (over < 0) return false;
    const units = this.teacherUnits[t]!;
    let u = -1;
    let seen = 0;
    for (const x of units) {
      const cell = this.unitCell[x]!;
      if (cell >= 0 && ((cell / M) | 0) === over && this.rnd() * ++seen < 1) u = x;
    }
    if (u < 0) return false;
    const c = p.unitClass[u]!;
    const from = this.unitCell[u]!;
    let toDay = under;
    if (toDay < 0) {
      toDay = (this.rnd() * (D - 1)) | 0;
      if (toDay >= over) toDay += 1;
    }
    const to = toDay * M + ((this.rnd() * M) | 0);
    return this.rnd() < 0.5 ? this.tryKempe(c, from, to, temp) : this.trySwap(c, from, to, temp);
  }

  /**
   * Mossa mirata: una giornata di docente con un vincolo non rispettato (es. una lezione su una ×, senza l'ora di
   * spostamento, due classi insieme) sposta una delle sue lezioni di quel giorno (scambio o catena).
   */
  private tryHardMove(temp: number): boolean {
    const p = this.p;
    const { D, M, DM } = p;
    let pick = -1;
    let seen = 0;
    for (let k = 0; k < p.T * D; k++) if (this.tdHard[k]! > 0 && this.rnd() * ++seen < 1) pick = k;
    if (pick < 0) return false;
    const t = (pick / D) | 0;
    const d = pick % D;
    let u = -1;
    seen = 0;
    for (const x of this.teacherUnits[t]!) {
      const cell = this.unitCell[x]!;
      if (cell >= 0 && ((cell / M) | 0) === d && !p.locked[x] && this.rnd() * ++seen < 1) u = x;
    }
    if (u < 0) return false;
    const from = this.unitCell[u]!;
    let to = (this.rnd() * (DM - 1)) | 0;
    if (to >= from) to += 1;
    const c = p.unitClass[u]!;
    return this.rnd() < 0.5 ? this.tryKempe(c, from, to, temp) : this.trySwap(c, from, to, temp);
  }

  private randomMove(temp: number) {
    const p = this.p;
    const DM = p.DM;
    if (this.hard > 0 && this.rnd() < 0.15 && this.tryHardMove(temp)) return;
    if (this.hard > 0 && this.patTeachers.length && this.rnd() < 0.2 && this.tryPatternMove(temp)) return;
    const c = (this.rnd() * p.C) | 0;
    const x = (this.rnd() * DM) | 0;
    let y = (this.rnd() * (DM - 1)) | 0;
    if (y >= x) y += 1;
    if (this.rnd() < TUNE.kempe) this.tryKempe(c, x, y, temp);
    else this.trySwap(c, x, y, temp);
  }

  private schedule = { totalMs: 0, elapsed: 0, cycles: 5 };
  /** «Migliora»: vincoli rigidi non rispettati dall'orario di partenza */
  private startHard = 0;
  /** giro che sistema i vincoli accettando qualche voce peggiorata (poi si recupera) */
  private fixing = false;

  /**
   * «Migliora», un giro per volta. Se l'orario in uso non rispetta un vincolo (es. ore al giorno appena
   * scelte), il 1° giro lo sistema anche peggiorando qualche voce e i giri dopo recuperano le voci;
   * se il vincolo resta o una voce resta peggiorata, il 3° giro riprova dall'orario in uso per un'altra strada.
   */
  private improveCycle(cyc: number) {
    this.hw = this.hardW;
    this.pw = WEIGHTS.hard;
    this.fixing =
      this.startHard > 0 &&
      (cyc === 0 || (cyc === 2 && this.schedule.cycles >= 5 && (this.bestHard > 0 || this.bestPen > 0)));
    if (cyc > 0) {
      if (this.fixing) this.initialize("improve");
      else this.loadBest();
    }
    this.fixW = this.fixing ? this.hardW : WEIGHTS.hard * 1.5;
    if (!this.fixing && this.hard > 0) this.repairHard(8);
  }
  private cycle = -1;
  private mode: SolveMode = "scratch";

  startRun(totalMs: number, mode: SolveMode) {
    this.trackChanges = mode === "improve";
    this.mode = mode;
    this.fixing = false;
    this.pareto = false;
    this.pw = 0;
    this.initialize(mode);
    if (mode === "improve") {
      // nessuna voce del confronto può peggiorare rispetto all'orario di partenza
      this.base.set(this.G);
      let max = 0;
      for (let t = 0; t < this.p.T; t++) max = Math.max(max, this.lastCount[t]!);
      this.baseLastMax = max;
      this.pareto = true;
      this.pw = WEIGHTS.hard;
      this.recomputeAll();
    }
    this.startHard = this.hard;
    this.schedule = { totalMs: Math.max(200, totalMs), elapsed: 0, cycles: totalMs >= 4000 ? TUNE.cycles : 3 };
    // in «Migliora» un vincolo rigido da sistemare (es. ore al giorno scelte) conta più di una voce che peggiora
    this.hardW = mode === "improve" ? WEIGHTS.hard * 10 : WEIGHTS.hard;
    this.fixW = mode === "improve" ? WEIGHTS.hard * 1.5 : 0;
    this.hw = mode === "improve" ? this.hardW : 400;
    this.bestHard = INF;
    this.bestPen = INF;
    this.bestSoft = INF;
    this.saveBest();
    this.cycle = -1;
  }

  /**
   * Ricerca in parallelo: alla fine di ogni giro (tranne l'ultimo) la ricerca si ferma (`waiting`) finché
   * adopt() non le dà la migliore proposta di tutte le ricerche, da cui riparte il giro dopo.
   */
  syncCycles = false;
  waiting = false;
  /** l'ultimo giro per cui la ricerca ha già preso la migliore di tutte */
  private syncedTo = 0;

  /** Le ore della proposta migliore trovata finora (cella per ogni ora, -1 se fuori). */
  bestCells(): Int32Array {
    const p = this.p;
    const out = new Int32Array(p.U).fill(-1);
    for (let c = 0; c < p.C; c++)
      for (let cell = 0; cell < p.DM; cell++) {
        const u = this.bestGrid[c * p.DM + cell]!;
        if (u >= 0) out[u] = cell;
      }
    return out;
  }

  /** Il punteggio della proposta migliore trovata finora. */
  bestScore(): { hard: number; pen: number; soft: number } {
    return { hard: this.bestHard, pen: this.bestPen, soft: this.bestSoft };
  }

  /** Ricerca in parallelo, a fine giro: riparte da `cells` (la migliore di tutte) o, con null, dalla sua. */
  adopt(cells: ArrayLike<number> | null) {
    const sc = this.schedule;
    this.syncedTo = Math.min(sc.cycles - 1, Math.floor(Math.min(1, sc.elapsed / sc.totalMs) * sc.cycles));
    this.waiting = false;
    if (!cells || cells.length !== this.p.U) return;
    this.setState(Int32Array.from(cells));
    this.bestHard = this.hard;
    this.bestPen = this.pen;
    this.bestSoft = this.soft;
    this.bestGrid.set(this.grid);
    let g = 0;
    for (let t = 0; t < this.p.T; t++) g += this.twGaps[t]!;
    this.bestGaps = g;
  }

  /** Lavora per circa `sliceMs` millisecondi. Restituisce true quando ha finito. */
  step(sliceMs: number, now: () => number): boolean {
    const sc = this.schedule;
    const start = now();
    const p = this.p;
    if (p.U === 0 || p.DM < 2) {
      this.finish();
      return true;
    }
    while (now() - start < sliceMs) {
      const frac = Math.min(1, sc.elapsed / sc.totalMs);
      if (frac >= 1) break;
      const cyc = Math.min(sc.cycles - 1, Math.floor(frac * sc.cycles));
      if (cyc !== this.cycle) {
        // in parallelo: prima di un giro nuovo si prende la migliore di tutte le ricerche
        if (this.syncCycles && cyc > this.syncedTo) {
          this.waiting = true;
          return false;
        }
        this.cycle = cyc;
        if (this.mode === "improve") this.improveCycle(cyc);
        else if (cyc > 0) {
          this.hw = this.hardW;
          this.loadBest();
          if (this.hard > 0) this.repairHard(8);
        }
      }
      const cf = frac * sc.cycles - cyc;
      const t0 = this.mode === "improve" ? (cyc === 0 || this.fixing ? 60 : 35) : cyc === 0 ? TUNE.t0a : TUNE.t0b;
      const t1 = this.mode === "improve" ? 1 : TUNE.t1;
      const temp = t0 * Math.pow(t1 / t0, cf);
      const t0ms = now();
      for (let i = 0; i < 2000; i++) {
        this.randomMove(temp);
        this.iterations += 1;
        if (this.hard <= this.bestHard) this.saveBest();
      }
      sc.elapsed += now() - t0ms;
    }
    if (sc.elapsed >= sc.totalMs) {
      this.finish();
      return true;
    }
    return false;
  }

  private finished = false;
  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.hw = this.hardW;
    if (this.bestHard < INF) this.loadBest();
    if (this.hard > 0) this.repairHard();
    this.polish();
    this.saveBest();
    this.loadBest();
  }

  /** Discesa finale: prova tutti gli scambi e le catene. */
  polish(maxPasses = 6) {
    const p = this.p;
    const DM = p.DM;
    for (let pass = 0; pass < maxPasses; pass++) {
      const before = this.soft + this.hw * this.hard + this.pw * this.pen;
      for (let c = 0; c < p.C; c++) {
        for (let x = 0; x < DM; x++) {
          for (let y = x + 1; y < DM; y++) {
            this.trySwap(c, x, y, 0);
            this.tryKempe(c, x, y, 0);
          }
        }
      }
      const after = this.soft + this.hw * this.hard + this.pw * this.pen;
      if (after >= before - 1e-9) break;
    }
  }

  progress(): SolveProgress {
    const p = this.p;
    const day = (d: number) => DAY_NAMES[p.days[d]!] ?? String(p.days[d]);
    const who = this.bestHard > 0 && this.bestHard < INF
      ? this.bestHardAt.map((k) =>
          k >= 0
            ? `${p.teachers[(k / p.D) | 0]!.name} · ${day(k % p.D)}`
            : k > -1_000_000
              ? `${p.classes[((-1 - k) / p.D) | 0]!.name} · ${day((-1 - k) % p.D)}`
              : p.teachers[-1_000_000 - k]!.name,
        )
      : undefined;
    return {
      fraction: Math.min(1, this.schedule.elapsed / Math.max(1, this.schedule.totalMs)),
      iterations: this.iterations,
      bestHard: this.bestHard,
      bestSoft: Math.round(this.bestSoft),
      bestGaps: this.bestGaps,
      bestHardWho: who,
    };
  }

  /**
   * Lezioni del mattino come slot dell'app. `keepReal`: ogni ora tiene la sua materia e il suo id
   * (ritocchi a mano); altrimenti le ore unite si ridistribuiscono tra le materie vere.
   */
  toSlots(makeId: () => string, opts: { keepReal?: boolean } = {}): TimetableSlot[] {
    const p = this.p;
    const real = opts.keepReal ? p.unitReal : this.realSubjects();
    const out: TimetableSlot[] = [];
    for (let u = 0; u < p.U; u++) {
      const cell = this.unitCell[u]!;
      if (cell < 0) continue;
      const d = (cell / p.M) | 0;
      const m = cell % p.M;
      out.push({
        id: (opts.keepReal && p.unitSlotId[u]) || makeId(),
        day: p.days[d]!,
        periodId: p.periods[p.morningPos[m]!]!.id,
        classId: p.classes[p.unitClass[u]!]!.id,
        teacherId: p.teachers[p.unitTeacher[u]!]!.id,
        subject: real[u]!,
      });
    }
    return out;
  }

  /** Materia vera di ogni ora: le ore delle materie unite tornano a italiano, storia, geografia… */
  realSubjects(): string[] {
    const p = this.p;
    const out = p.unitReal.slice();
    const groups = new Map<string, number[]>();
    for (let u = 0; u < p.U; u++) {
      // le ore bloccate tengono la loro materia
      if (this.unitCell[u]! < 0 || p.locked[u] || !isMergedSubject(p.subjects[p.unitSubj[u]!]!)) continue;
      const key = `${p.unitClass[u]}|${p.unitTeacher[u]}|${p.unitSubj[u]}`;
      const list = groups.get(key) ?? [];
      list.push(u);
      groups.set(key, list);
    }
    for (const [key, units] of groups) {
      const [c, , x] = key.split("|").map(Number) as [number, number, number];
      units.sort((a, b) => this.unitCell[a]! - this.unitCell[b]!);
      const mine = new Set(units);
      const counts = new Map<string, number>();
      for (const u of units) counts.set(p.unitReal[u]!, (counts.get(p.unitReal[u]!) ?? 0) + 1);
      const parts = subjectParts(p.subjects[x]!);
      const main = parts.includes("Italiano")
        ? "Italiano"
        : parts.includes("Matematica")
          ? "Matematica"
          : ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? parts[0]!);
      // le prime ore per i compiti vanno alla materia principale
      const test = new Set<number>();
      for (let k = 0; k < 2; k++) {
        if (p.testSubj[c * 2 + k] !== x) continue;
        const m0 = p.testFirst[c * 2 + k]!;
        for (let d = 0; d < p.D; d++) {
          const a = this.grid[c * p.DM + d * p.M + m0]!;
          const b = this.grid[c * p.DM + d * p.M + m0 + 1]!;
          if (mine.has(a) && mine.has(b)) {
            test.add(d * p.M + m0);
            test.add(d * p.M + m0 + 1);
            break;
          }
        }
      }
      const subs = splitMerged(
        units.map((u) => this.unitCell[u]!),
        p.M,
        counts,
        main,
        test,
      );
      units.forEach((u, i) => (out[u] = subs[i]!));
    }
    return out;
  }
}

// ---------- resoconto ----------

/** Un'ora a cui si riferisce una voce del resoconto (per evidenziarla): del docente, della classe o di tutti e due. */
export type IssueCell = { day: DayOfWeek; periodId: string; teacherId?: string; classId?: string };

/** Una voce del resoconto; `cells`: le ore a cui si riferisce, se si sa; `teacherId`: il docente, se è uno solo. */
export type Issue = { text: string; cells?: IssueCell[]; teacherId?: string };

/** Un docente o una classe. */
export type Who = { kind: "teacher" | "class"; id: string; name: string };

/**
 * Una voce del confronto che riguarda un docente o una classe, in un giorno (`d`, `day`) o nella settimana
 * (`d` -1): confrontando quelle di prima e di dopo una mossa si vede a chi cambia cosa.
 */
export type Fact = {
  row: RowKey;
  who: Who;
  d: number;
  day: string;
  /** cosa la distingue per lo stesso docente o classe e giorno: la materia, l'ora della buca… */
  key: string;
  /** quante (per le classi preferite non rispettate) o quanto (ore di fila, lezioni nel giorno…) */
  n: number;
  /** le ore al giorno, le ore delle classi preferite non rispettate, le prime ore */
  extra?: string;
};

export type TimetableReport = {
  lessons: number;
  lessonsExpected: number;
  /** pen: di quanto le voci superano l'orario di partenza («Migliora l'attuale») */
  score: { soft: number; hard: number; pen: number };
  hard: {
    conflicts: Issue[];
    away: Issue[];
    travel: Issue[];
    /** più di un cambio di plesso nello stesso giorno (qui → altrove → qui) */
    shuttle: Issue[];
    no: Issue[];
    /** ore libere tra le lezioni oltre il consentito: a scuola dalla 1ª alla 6ª con 2 o più ore buche, o buche per chi non le accetta */
    longGaps: Issue[];
    rientro: Issue[];
    must: Issue[];
    holes: Issue[];
    /** ore al giorno oltre quelle scelte per il docente */
    pattern: Issue[];
    /** «Tutte le sedi insieme», «Da zero»: ore a disposizione senza un'ora libera nella loro sede */
    dispRoom: Issue[];
  };
  /**
   * Ore al giorno scelte: docenti che le rispettano. `rows`: ore a scuola per giorno (lezioni, pomeriggio,
   * disposizioni segnate), le scelte, quelle rispettate (`fits`), di quanto si va oltre la più vicina e
   * quante ore mancano per arrivarci (disposizioni da mettere).
   */
  patterns: {
    ok: number;
    total: number;
    rows: {
      id: string;
      name: string;
      perDay: number[];
      patterns: number[][];
      fits: number[][];
      excess: number;
      missing: number;
    }[];
  };
  gapsTotal: number;
  /**
   * ore buche per docente: dove sono (testo) e le caselle; `fill`: le buche dove vanno le sue ore a
   * disposizione («Da zero»), che quindi non contano
   */
  gapsByTeacher: {
    id: string;
    name: string;
    gaps: number;
    where: string;
    cells: { day: DayOfWeek; periodId: string }[];
    fill: { day: DayOfWeek; periodId: string }[];
  }[];
  /** «Da zero»: dove mettere le ore a disposizione (nelle buche, così non contano) */
  dispFill: Issue[];
  /** ore vuote tra due lezioni che non sono buche: a disposizione, altrove (×) o di spostamento */
  notGaps: { disp: Issue[]; away: Issue[] };
  classPref: { hit: number; want: number; missing: Issue[] };
  /** italiano e matematica con almeno un blocco 1ª–2ª (o 2ª–3ª, `shifted`) nella settimana (per classe) */
  firstHours: { ok: number; total: number; missing: Issue[]; shifted: Issue[] };
  didattica: {
    sameRun: Issue[];
    sameDay: Issue[];
    split: Issue[];
    langBlock: Issue[];
    heavy: Issue[];
    noLight: Issue[];
    spread: Issue[];
    teacherMany: Issue[];
    /** materie da 2 ore tutte nello stesso giorno */
    twoBlock: Issue[];
  };
  /** scienze motorie con almeno un'ora nelle ultime 3 del mattino (per classe) */
  pe: { ok: number; total: number; missing: Issue[] };
  docenti: {
    six: Issue[];
    five: Issue[];
    span6: Issue[];
    /** giornate con 2 o più ore buche */
    multiGap: Issue[];
    /** cattedra intera qui: ore buche o giornate dalla 1ª alla 6ª */
    full: Issue[];
    empty: Issue[];
    mixed: Issue[];
    single: Issue[];
    lastHours: { name: string; count: number }[];
  };
  warnings: string[];
  /** le voci per docente e per classe, per dire a chi cambia cosa con una mossa */
  facts: Fact[];
};

const DAY_NAMES: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio", 5: "Ven", 6: "Sab" };

/** Resoconto dettagliato dello stato attuale del risolutore. */
export function buildReport(s: TimetableSolver, expected: number): TimetableReport {
  const p = s.p;
  const { D, M, P, C, T, S, DM } = p;
  const hourLabel = (pos: number) => p.periods[pos]!.label.replace(" ora", "");
  const dayName = (d: number) => DAY_NAMES[p.days[d]!] ?? String(p.days[d]);
  const rep: TimetableReport = {
    lessons: 0,
    lessonsExpected: expected,
    score: { soft: 0, hard: 0, pen: 0 },
    hard: { conflicts: [], away: [], travel: [], shuttle: [], no: [], longGaps: [], rientro: [], must: [], holes: [], pattern: [], dispRoom: [] },
    patterns: { ok: 0, total: 0, rows: [] },
    gapsTotal: 0,
    gapsByTeacher: [],
    notGaps: { disp: [], away: [] },
    dispFill: [],
    classPref: { hit: 0, want: 0, missing: [] },
    firstHours: { ok: 0, total: 0, missing: [], shifted: [] },
    didattica: {
      sameRun: [],
      sameDay: [],
      split: [],
      langBlock: [],
      heavy: [],
      noLight: [],
      spread: [],
      teacherMany: [],
      twoBlock: [],
    },
    pe: { ok: 0, total: 0, missing: [] },
    docenti: { six: [], five: [], span6: [], multiGap: [], full: [], empty: [], mixed: [], single: [], lastHours: [] },
    warnings: [...p.warnings],
    facts: [],
  };
  // la stessa voce due volte per lo stesso docente o classe e giorno (raro): la seconda ha «#1» nella chiave
  const factKeys = new Map<string, number>();
  const fact = (row: RowKey, who: Who, d: number, key: string, n: number, extra?: string) => {
    const id = `${row}|${who.kind}|${who.id}|${d}|${key}`;
    const k = factKeys.get(id) ?? 0;
    factKeys.set(id, k + 1);
    rep.facts.push({ row, who, d, day: d < 0 ? "" : dayName(d), key: k ? `${key}#${k}` : key, n, extra });
  };
  for (let u = 0; u < p.U; u++) if (s.unitCell[u]! >= 0) rep.lessons += 1;

  // Classi
  for (let c = 0; c < C; c++) {
    const cname = p.classes[c]!.name;
    const cwho: Who = { kind: "class", id: p.classes[c]!.id, name: cname };
    for (let d = 0; d < D; d++) {
      const row: number[] = [];
      for (let m = 0; m < M; m++) row.push(s.grid[c * DM + d * M + m]!);
      const subj = row.map((u) => (u >= 0 ? p.unitSubj[u]! : -1));
      let run = 1;
      for (let m = 1; m <= M; m++) {
        if (m < M && subj[m]! >= 0 && subj[m] === subj[m - 1]) run += 1;
        else {
          const x = subj[m - 1]!;
          if (x >= 0 && run > p.subjMaxRun[x]!) {
            rep.didattica.sameRun.push({ text: `${cname} · ${dayName(d)}: ${p.subjects[x]} ${run} ore di fila` });
            fact("sameRun", cwho, d, p.subjects[x]!, run);
          } else if (x >= 0 && run === 2 && p.subjCat[x] === 1) {
            rep.didattica.langBlock.push({ text: `${cname} · ${dayName(d)}: ${p.subjects[x]} 2 ore di fila` });
            fact("langBlock", cwho, d, p.subjects[x]!, 1);
          }
          run = 1;
        }
      }
      const cnt = new Map<number, number>();
      const seg = new Map<number, number>();
      subj.forEach((x, m) => {
        if (x < 0) return;
        cnt.set(x, (cnt.get(x) ?? 0) + 1);
        if (m === 0 || subj[m - 1] !== x) seg.set(x, (seg.get(x) ?? 0) + 1);
      });
      for (const [x, n] of cnt) {
        if (n > p.subjMaxRun[x]!) rep.didattica.sameDay.push({ text: `${cname} · ${dayName(d)}: ${p.subjects[x]} ${n} ore nello stesso giorno` });
        if ((seg.get(x) ?? 0) > 1 && p.subjMaxRun[x] === 2) {
          rep.didattica.split.push({ text: `${cname} · ${dayName(d)}: ${p.subjects[x]} spezzata (non attaccata)` });
          fact("split", cwho, d, p.subjects[x]!, 1);
        }
      }
      let core = 0;
      let maxCore = 0;
      let theory = 0;
      let filled = 0;
      for (const x of subj) {
        if (x < 0) {
          core = 0;
          continue;
        }
        filled += 1;
        if (p.subjCat[x] === 2) {
          core += 1;
          maxCore = Math.max(maxCore, core);
        } else core = 0;
        if (p.subjCat[x]! >= 1) theory += 1;
      }
      if (maxCore >= 4) {
        rep.didattica.heavy.push({
          text: `${cname} · ${dayName(d)}: ${maxCore} ore pesanti di fila (${subj.map((x) => (x >= 0 ? p.subjects[x]!.slice(0, 3) : "—")).join(" ")})`,
        });
        fact("heavy", cwho, d, "", maxCore);
      }
      if (filled === M && theory === M) {
        rep.didattica.noLight.push({ text: `${cname} · ${dayName(d)}: nessuna materia leggera` });
        fact("noLight", cwho, d, "", 1);
      }
      const tc = new Map<number, number>();
      row.forEach((u) => {
        if (u >= 0) tc.set(p.unitTeacher[u]!, (tc.get(p.unitTeacher[u]!) ?? 0) + 1);
      });
      for (const [t, n] of tc) if (n > 3) rep.didattica.teacherMany.push({ text: `${cname} · ${dayName(d)}: ${p.teachers[t]!.name} ${n} ore` });
      if (filled > 0 && filled < M) {
        const first = row.findIndex((u) => u >= 0);
        let last = M - 1;
        while (last >= 0 && row[last]! < 0) last -= 1;
        for (let m = first + 1; m < last; m++)
          if (row[m]! < 0)
            rep.hard.holes.push({
              text: `${cname} · ${dayName(d)} ${hourLabel(p.morningPos[m]!)}: classe senza docente`,
              cells: [{ day: p.days[d]!, periodId: p.periods[p.morningPos[m]!]!.id, classId: p.classes[c]!.id }],
            });
      }
    }
    if (M >= 2) {
      for (let k = 0; k < 2; k++) {
        const x = p.testSubj[c * 2 + k]!;
        if (x < 0) continue;
        const m0 = p.testFirst[c * 2 + k]!;
        const block = `${hourLabel(p.morningPos[m0]!)}–${hourLabel(p.morningPos[m0 + 1]!)}`;
        rep.firstHours.total += 1;
        if (m0 > 0) rep.firstHours.shifted.push({ text: `${cname}: ${p.subjects[x]} alla ${block} (alla 1ª il docente non può)` });
        let best = 0;
        for (let d = 0; d < D; d++) {
          const a = s.grid[c * DM + d * M + m0]!;
          const b = s.grid[c * DM + d * M + m0 + 1]!;
          const ha = a >= 0 && p.unitSubj[a] === x;
          const hb = b >= 0 && p.unitSubj[b] === x;
          best = Math.max(best, ha && hb ? 2 : ha || hb ? 1 : 0);
        }
        if (best === 2) rep.firstHours.ok += 1;
        else {
          rep.firstHours.missing.push({
            text: `${cname}: ${p.subjects[x]} ${best === 1 ? "solo un’ora" : "mai"} alla ${block} ora`,
          });
          fact("firstHours", cwho, -1, p.subjects[x]!, 2 - best, block);
        }
      }
    }
    const pe = p.peSubj[c]!;
    if (pe >= 0 && M >= 4) {
      let latest = -1;
      for (let z = 0; z < DM; z++) {
        const u = s.grid[c * DM + z]!;
        if (u >= 0 && p.unitSubj[u] === pe) latest = Math.max(latest, z % M);
      }
      rep.pe.total += 1;
      if (latest >= M - 3) rep.pe.ok += 1;
      else {
        rep.pe.missing.push({ text: `${cname}: ${p.subjects[pe]} mai nelle ultime 3 ore` });
        fact("pe", cwho, -1, p.subjects[pe]!, 1);
      }
    }
    for (let x = 0; x < S; x++) {
      const h = p.csHours[c * S + x]!;
      if (h === 2) {
        for (let d = 0; d < D; d++)
          if (s.ccount[(c * S + x) * D + d]! >= 2) {
            rep.didattica.twoBlock.push({ text: `${cname} · ${dayName(d)}: ${p.subjects[x]}, tutte e 2 le ore` });
            fact("twoBlock", cwho, d, p.subjects[x]!, 1);
          }
      }
      if (h < 4) continue;
      let used = 0;
      for (let d = 0; d < D; d++) if (s.ccount[(c * S + x) * D + d]! > 0) used += 1;
      const need = Math.min(D, Math.ceil(h / 2) + 1);
      if (used < need) rep.didattica.spread.push({ text: `${cname}: ${p.subjects[x]} ${h} ore in soli ${used} giorni` });
    }
  }

  // Docenti (lezioni; le disposizioni segnate contano come presenza, non come ore buche)
  const lastRows: { name: string; count: number }[] = [];
  for (let t = 0; t < T; t++) {
    const info = p.teachers[t]!;
    const twho: Who = { kind: "teacher", id: info.id, name: info.name };
    let gaps = 0;
    const gapWhere: string[] = [];
    const gapCells: { day: DayOfWeek; periodId: string }[] = [];
    // «Da zero»: le disposizioni del docente vanno nelle prime buche (quante per giorno)
    const fillDay = s.fillPlan(t);
    const fillWhere: string[] = [];
    const fillCells: { day: DayOfWeek; periodId: string }[] = [];
    const perDay: number[] = [];
    // in più sedi («Tutte le sedi insieme»): la giornata come la conta l'app di ogni sede
    const multiT = p.nSedi > 1 && p.multi[t] === 1;
    const fillSedi = multiT ? s.fillPlanSedi(t) : null;
    const tid = info.id;
    // le ore del docente da evidenziare, con le classi delle sue lezioni
    const at = (d: number, positions: number[]): IssueCell[] =>
      positions.flatMap((pos) => {
        const cell = { day: p.days[d]!, periodId: p.periods[pos]!.id, teacherId: tid };
        const m = p.mOfPos[pos]!;
        const cls: IssueCell[] = [];
        if (m >= 0)
          for (let c = 0; c < C; c++) {
            const u = s.grid[c * DM + d * M + m]!;
            if (u >= 0 && p.unitTeacher[u] === t) cls.push({ ...cell, classId: p.classes[c]!.id });
          }
        return cls.length ? cls : [cell];
      });
    const bitsOf = (mask: number) => {
      const out: number[] = [];
      for (let pos = 0; pos < P; pos++) if ((mask >>> pos) & 1) out.push(pos);
      return out;
    };
    /**
     * Al massimo un'ora libera tra le lezioni, buca o disposizione (salvo chi ne accetta 2); dalla 1ª alla 6ª mai
     * 2 ore senza lezione, anche se le riempie una disposizione; chi non accetta ore buche non ne ha, nemmeno
     * quelle dove andrebbe una disposizione. `lo`: « a Rombiolo» per chi è in più sedi.
     */
    const longGapsOf = (
      d: number,
      lo: string,
      raw: number[],
      middle: number[],
      middleDisp: number,
      span6: boolean,
    ) => {
      const head = `${info.name} · ${dayName(d)}${lo}`;
      if (info.noGaps && raw.length > 0)
        rep.hard.longGaps.push({
          text: `${head}: ${raw.length === 1 ? "1 ora buca" : `${raw.length} ore buche`}, che il docente non accetta`,
          cells: at(d, raw),
        });
      else if (!info.allow2 && middle.length >= 2 && !(span6 && raw.length > middle.length))
        rep.hard.longGaps.push({
          text: `${head}: ${middle.length} ore libere tra le lezioni${
            middleDisp === 0 ? "" : middleDisp === middle.length ? " (a disposizione)" : ` (${middleDisp} a disposizione)`
          }`,
          cells: at(d, middle),
        });
      else if (span6 && raw.length >= 2)
        rep.hard.longGaps.push({
          text: `${head}: dalla 1ª alla 6ª con ${raw.length} ore senza lezione in mezzo`,
          cells: at(d, raw),
        });
    };
    /** Docente in più sedi: la giornata di ogni sede, come la conta l'app di quella sede, e le regole tra sedi. */
    const reportSediDay = (d: number): number => {
      const views = s.sedeViewsOf(t, d);
      let dayTotal = 0;
      let mixed = false;
      for (const v of views) {
        const sn = p.sedeNames[v.s]!;
        const lo = ` a ${sn}`;
        const mine = v.les | v.disp;
        // buche: le prime vanno alle disposizioni da mettere in quella sede
        const fill = fillSedi![d * p.nSedi + v.s]!;
        const raw = bitsOf(v.gap);
        raw.forEach((pos, k) => {
          if (k < fill) {
            fillWhere.push(`${dayName(d)} ${hourLabel(pos)}${lo}`);
            fillCells.push({ day: p.days[d]!, periodId: p.periods[pos]!.id });
            return;
          }
          dayTotal += 1;
          gapWhere.push(`${dayName(d)} ${hourLabel(pos)}${lo}`);
          fact("gaps", twho, d, hourLabel(pos), 1);
          gapCells.push({ day: p.days[d]!, periodId: p.periods[pos]!.id });
        });
        const dayGaps = Math.max(0, raw.length - fill);
        // tra due lezioni lì, ma non buche: ore a disposizione, × e spostamento
        const middle: number[] = [];
        let middleDisp = 0;
        if (v.les)
          for (let pos = lowBit(v.les) + 1; pos < highBit(v.les); pos++) {
            if ((v.les >>> pos) & 1) continue;
            const where = `${info.name} · ${dayName(d)} ${hourLabel(pos)}`;
            if ((v.disp >>> pos) & 1) {
              rep.notGaps.disp.push({ text: `${where}: a disposizione${lo}` });
              middle.push(pos);
              middleDisp += 1;
            } else if ((v.gap >>> pos) & 1) middle.push(pos);
            else if ((v.x >>> pos) & 1) rep.notGaps.away.push({ text: `${where}: altrove (×)` });
            else if ((v.travel >>> pos) & 1) rep.notGaps.away.push({ text: `${where}: spostamento tra sedi` });
          }
        if (dayGaps >= 2) {
          rep.docenti.multiGap.push({ text: `${info.name} · ${dayName(d)}: ${dayGaps} ore buche${lo}` });
          fact("multiGap", twho, d, sn, dayGaps);
        }
        const lm = popcount(v.les & p.morningBits);
        if (lm >= 6) {
          rep.docenti.six.push({ text: `${info.name} · ${dayName(d)}: ${lm} lezioni${lo}` });
          fact("six", twho, d, sn, lm);
        } else if (lm === 5) {
          rep.docenti.five.push({ text: `${info.name} · ${dayName(d)}: 5 lezioni${lo}` });
          fact("five", twho, d, sn, 1);
        }
        const mm = mine & p.morningBits;
        const span6 = (v.les & ~p.morningBits) === 0 && mm !== 0 && p.pIndex[highBit(mm)]! - p.pIndex[lowBit(mm)]! + 1 >= 6;
        if (span6) {
          rep.docenti.span6.push({ text: `${info.name} · ${dayName(d)}: a scuola dalla 1ª alla 6ª${lo}` });
          fact("span6", twho, d, sn, 1);
        }
        longGapsOf(d, lo, raw, middle, middleDisp, span6);
        if (popcount(mine) === 1) {
          rep.docenti.single.push({ text: `${info.name} · ${dayName(d)}: una sola ora${lo}` });
          fact("single", twho, d, sn, 1);
        }
        if (v.x !== 0 && mm !== 0) mixed = true;
        // regole tra sedi: mai su una × della sede, né accanto senza l'ora di spostamento
        const away = p.sedeAwayMask[(t * D + d) * p.nSedi + v.s]!;
        for (const pos of bitsOf(v.les & away))
          rep.hard.away.push({
            text: `${info.name} · ${dayName(d)} ${hourLabel(pos)}: a ${sn} in un'ora segnata ×`,
            cells: at(d, [pos]),
          });
        for (const pos of bitsOf(s.sedeTravelMiss(t, d, v.s)))
          rep.hard.travel.push({
            text: `${info.name} · ${dayName(d)} ${hourLabel(pos)}: a ${sn} senza ora di spostamento dopo la ×`,
            cells: at(d, [pos]),
          });
      }
      if (mixed) {
        const names = views.map((v) => p.sedeNames[v.s]!);
        rep.docenti.mixed.push({
          text: `${info.name} · ${dayName(d)}: ${names.length > 1 ? names.join(" e ") : `${names[0]} e altrove (×)`}`,
        });
        fact("mixed", twho, d, "", 1);
      }
      // da una sede all'altra: un'ora libera in mezzo; dove è, ora per ora (es. «Sede A → Sede B → Sede A»)
      let prevS = -1;
      let prevPos = -1;
      let prevLesson = false;
      const seq: string[] = [];
      for (let pos = 0; pos < P; pos++) {
        let here = -1;
        let lesson = false;
        for (const v of views)
          if ((v.les >>> pos) & 1) {
            here = v.s;
            lesson = true;
            break;
          }
        if (here < 0) for (const v of views) if ((v.disp >>> pos) & 1) here = v.s;
        const where = here >= 0 ? p.sedeNames[here]! : views.some((v) => (v.x >>> pos) & 1) ? "altrove" : "";
        if (where && seq[seq.length - 1] !== where) seq.push(where);
        if (here < 0) continue;
        if (prevS >= 0 && here !== prevS && (lesson || prevLesson) && p.pIndex[pos]! - p.pIndex[prevPos]! < 2)
          rep.hard.travel.push({
            text: `${info.name} · ${dayName(d)}: da ${p.sedeNames[prevS]} a ${p.sedeNames[here]} senza un'ora libera`,
            cells: at(d, [prevPos, pos]),
          });
        prevS = here;
        prevPos = pos;
        prevLesson = lesson;
      }
      if (s.shuttleOf(t, d) > 0)
        rep.hard.shuttle.push({
          text: `${info.name} · ${dayName(d)}: ${seq.join(" → ")}`,
          cells: at(d, bitsOf(views.reduce((m, v) => m | v.les, 0))),
        });
      return dayTotal;
    };
    for (let d = 0; d < D; d++) {
      const base = (t * D + d) * P;
      const disp = s.dispMask(t, d);
      let first = -1;
      let last = -1;
      let lFirst = -1;
      let lLast = -1;
      let duties = 0;
      let lessonsM = 0;
      let afternoon = false;
      let mFirst = -1;
      let mLast = -1;
      for (let pos = 0; pos < P; pos++) {
        const n = s.tOcc[base + pos]!;
        if (n === 0 && !((disp >>> pos) & 1)) continue;
        const isM = p.mOfPos[pos]! >= 0;
        if (n > 0) {
          if (lFirst < 0) lFirst = pos;
          lLast = pos;
          const where = `${info.name} · ${dayName(d)} ${hourLabel(pos)}`;
          const cells = at(d, [pos]);
          if (n > 1) rep.hard.conflicts.push({ text: `${where}: ${n} classi insieme`, cells });
          if (isM) {
            const un = p.unavail[base + pos];
            if (un === 1) rep.hard.away.push({ text: `${where}: lezione in un'ora segnata altrove`, cells });
            if (un === 2) rep.hard.travel.push({ text: `${where}: senza ora di spostamento dall'altro plesso`, cells });
            if (un === 3) rep.hard.no.push({ text: `${where}: lezione in un'ora «no»`, cells });
            if (un === 4 && !p.dispYield) rep.hard.away.push({ text: `${where}: lezione in un'ora a disposizione`, cells });
            if (p.rientro[t * D + d] && p.pIndex[pos]! < 4)
              rep.hard.rientro.push({ text: `${where}: giorno di rientro, prima della 4ª`, cells });
            lessonsM += 1;
          } else afternoon = true;
        }
        duties += 1;
        if (first < 0) first = pos;
        last = pos;
        if (isM) {
          if (mFirst < 0) mFirst = pos;
          mLast = pos;
        }
      }
      perDay.push(duties + fillDay[d]!);
      if (duties === 0 && info.emptyW >= WEIGHTS.emptyFull) rep.docenti.empty.push({ text: `${info.name} · ${dayName(d)}: nessuna ora` });
      if (multiT) {
        gaps += reportSediDay(d);
        continue;
      }
      // buche vere; raw: anche quelle dove vanno le disposizioni
      let dayGaps = 0;
      const raw: number[] = [];
      for (let pos = first + 1; pos < last; pos++) {
        if (!s.isGap(t, d, pos)) continue;
        raw.push(pos);
        if (raw.length <= fillDay[d]!) {
          fillWhere.push(`${dayName(d)} ${hourLabel(pos)}`);
          fillCells.push({ day: p.days[d]!, periodId: p.periods[pos]!.id });
          continue;
        }
        dayGaps += 1;
        gapWhere.push(`${dayName(d)} ${hourLabel(pos)}`);
        fact("gaps", twho, d, hourLabel(pos), 1);
        gapCells.push({ day: p.days[d]!, periodId: p.periods[pos]!.id });
      }
      // tra due lezioni, ma non buche: ore a disposizione e ore altrove (o di spostamento)
      const middle: number[] = [];
      let middleDisp = 0;
      for (let pos = lFirst + 1; pos < lLast; pos++) {
        if (s.tOcc[base + pos]! > 0) continue;
        const un = p.unavail[base + pos]!;
        const where = `${info.name} · ${dayName(d)} ${hourLabel(pos)}`;
        if ((disp >>> pos) & 1) {
          rep.notGaps.disp.push({ text: `${where}: a disposizione` });
          middle.push(pos);
          middleDisp += 1;
        } else if (s.isGap(t, d, pos)) middle.push(pos);
        else if (un === 1) rep.notGaps.away.push({ text: `${where}: altrove (×)` });
        else if (un === 2) rep.notGaps.away.push({ text: `${where}: spostamento tra plessi` });
      }
      gaps += dayGaps;
      if (dayGaps >= 2) {
        rep.docenti.multiGap.push({ text: `${info.name} · ${dayName(d)}: ${dayGaps} ore buche` });
        fact("multiGap", twho, d, "", dayGaps);
      }
      if (info.full && dayGaps > 0)
        rep.docenti.full.push({ text: `${info.name} · ${dayName(d)}: ${dayGaps === 1 ? "1 ora buca" : `${dayGaps} ore buche`}` });
      if (lessonsM >= 6) {
        rep.docenti.six.push({ text: `${info.name} · ${dayName(d)}: ${lessonsM} lezioni` });
        fact("six", twho, d, "", lessonsM);
      } else if (lessonsM === 5) {
        rep.docenti.five.push({ text: `${info.name} · ${dayName(d)}: 5 lezioni` });
        fact("five", twho, d, "", 1);
      }
      const span6 = !afternoon && mFirst >= 0 && p.pIndex[mLast]! - p.pIndex[mFirst]! + 1 >= 6;
      if (span6) {
        rep.docenti.span6.push({ text: `${info.name} · ${dayName(d)}: a scuola dalla 1ª alla 6ª` });
        fact("span6", twho, d, "", 1);
        if (info.full) rep.docenti.full.push({ text: `${info.name} · ${dayName(d)}: dalla 1ª alla 6ª` });
      }
      longGapsOf(d, "", raw, middle, middleDisp, span6);
      if (duties === 1) {
        rep.docenti.single.push({ text: `${info.name} · ${dayName(d)}: una sola ora` });
        fact("single", twho, d, "", 1);
      }
      if (s.shuttleOf(t, d) > 0) {
        // dove è, ora per ora (es. «qui → altrove → qui»)
        const seq: string[] = [];
        const lessons: number[] = [];
        for (let pos = 0; pos < P; pos++) {
          const n = s.tOcc[base + pos]!;
          if (n > 0) lessons.push(pos);
          const where = p.unavail[base + pos] === 1 ? "altrove" : n > 0 || (disp >>> pos) & 1 ? "qui" : "";
          if (where && seq[seq.length - 1] !== where) seq.push(where);
        }
        rep.hard.shuttle.push({ text: `${info.name} · ${dayName(d)}: ${seq.join(" → ")}`, cells: at(d, lessons) });
      }
      if (info.otherPlesso && p.dayHasAway[t * D + d] && mFirst >= 0) {
        rep.docenti.mixed.push({ text: `${info.name} · ${dayName(d)}: qui e nell'altro plesso` });
        fact("mixed", twho, d, "", 1);
      }
    }
    rep.gapsTotal += gaps;
    if (info.patterns.length && info.lessons > 0) {
      const patterns = info.patterns.map((x) => Array.from(x));
      const exs = patterns.map((x) => patternExcess(perDay, x));
      const excess = Math.min(...exs);
      const fits = patterns.filter((_, i) => exs[i] === 0);
      const have = perDay.reduce((a, b) => a + b, 0);
      const missing = fits.length ? Math.max(0, Math.min(...fits.map((x) => x.reduce((a, b) => a + b, 0))) - have) : 0;
      rep.patterns.total += 1;
      if (excess === 0) rep.patterns.ok += 1;
      else {
        const now = perDay.map((n, d) => `${dayName(d)} ${n}`).join(", ");
        rep.hard.pattern.push({ text: `${info.name}: ${now}; scelte ${patterns.map((x) => patternText(x)).join(" o ")}`, teacherId: info.id });
        fact("patterns", twho, -1, "", excess, now);
      }
      rep.patterns.rows.push({ id: info.id, name: info.name, perDay, patterns, fits, excess, missing });
    }
    if (info.lessons > 0)
      rep.gapsByTeacher.push({ id: info.id, name: info.name, gaps, where: gapWhere.join(", "), cells: gapCells, fill: fillCells });
    if (fillCells.length) rep.dispFill.push({ text: `${info.name}: ${fillWhere.join(", ")}` });
    if (multiT)
      s.fillRoomMissing(t).forEach((n, x) => {
        if (n > 0)
          rep.hard.dispRoom.push({
            text: `${info.name}: ${n === 1 ? "1 ora a disposizione" : `${n} ore a disposizione`} a ${p.sedeNames[x]} senza un’ora libera lì`,
            teacherId: info.id,
          });
      });
    if (info.lessons > 0) lastRows.push({ name: info.name, count: s.lastCount[t]! });
    const missCells: IssueCell[] = [];
    const missOf = (list: SlotWish[]) => {
      const missing: string[] = [];
      missCells.length = 0;
      for (const a of list) {
        const ok = a.classes.some((c) => {
          const u = s.grid[c * DM + a.d * M + a.m]!;
          return u >= 0 && p.unitTeacher[u] === t;
        });
        if (ok) continue;
        missing.push(`${dayName(a.d)} ${hourLabel(p.morningPos[a.m]!)}`);
        const cell = { day: p.days[a.d]!, periodId: p.periods[p.morningPos[a.m]!]!.id };
        missCells.push({ ...cell, teacherId: info.id }, ...a.classes.map((c) => ({ ...cell, classId: p.classes[c]!.id })));
      }
      return missing;
    };
    if (p.must[t]!.length) {
      const missing = missOf(p.must[t]!);
      if (missing.length > p.mustOffset[t]!)
        rep.hard.must.push({
          text: `${info.name}: ${missing.length - p.mustOffset[t]! === 1 ? "1 obbligo non rispettato" : `${missing.length - p.mustOffset[t]!} obblighi non rispettati`} (${missing.join(", ")})`,
          cells: [...missCells],
          teacherId: info.id,
        });
    }
    if (p.cpref[t]!.length) {
      const missing = missOf(p.cpref[t]!);
      const want = p.cpref[t]!.length - p.cprefOffset[t]!;
      const hit = p.cpref[t]!.length - missing.length;
      rep.classPref.want += want;
      rep.classPref.hit += Math.min(want, hit);
      if (hit < want) {
        rep.classPref.missing.push({ text: `${info.name}: ${want - hit} non rispettate (libere: ${missing.join(", ")})` });
        fact("classPref", twho, -1, "", want - hit, missing.join(", "));
      }
    }
  }
  rep.gapsByTeacher.sort((a, b) => b.gaps - a.gaps || a.name.localeCompare(b.name, "it"));
  rep.docenti.lastHours = lastRows.sort((a, b) => b.count - a.count).slice(0, 5);
  rep.score = { soft: Math.round(s.soft), hard: s.hard, pen: s.pen };
  return rep;
}

/** Valuta l'orario attuale: le lezioni del mattino già in orario (le disposizioni non contano). */
export function evaluateCurrent(data: PersistedData): TimetableReport {
  const prep = prepare(data, "slots");
  const s = new TimetableSolver(prep, 1);
  s.setState(prep.unitStart);
  const expected = prepare(data, "demand").U;
  return buildReport(s, expected);
}

/** Ore di ogni docente su questo plesso (lezioni, anche del pomeriggio, e disposizioni). */
export function teacherHoursHere(data: PersistedData): Map<string, number> {
  const prep = prepare(data, "demand", { keepDisp: false });
  return new Map(prep.teachers.map((t) => [t.id, t.hours]));
}

export type TeacherDayInfo = {
  /** ore qui: lezioni (anche del pomeriggio) e ore a disposizione */
  hours: number;
  lessons: number;
  disp: number;
  /** ore possibili per giorno (senza ×, ore di spostamento, «no» e mattine di rientro) */
  cap: number[];
  /** ore a scuola per giorno nell'orario in uso, disposizioni comprese; null se il docente non ha ore in orario */
  now: number[] | null;
};

/** Per scegliere le ore al giorno di un docente. */
export function teacherDayInfo(data: PersistedData, teacherId: string): TeacherDayInfo | null {
  const dem = prepare(data, "demand", { keepDisp: false });
  const t = dem.teachers.findIndex((x) => x.id === teacherId);
  if (t < 0) return null;
  const { D, P, M } = dem;
  const info = dem.teachers[t]!;
  const fixedCells = new Set<number>();
  for (const f of dem.fixed) if (f.t === t) fixedCells.add(f.d * P + f.pos);
  const cap: number[] = [];
  for (let d = 0; d < D; d++) {
    let n = 0;
    for (let pos = 0; pos < P; pos++) if (fixedCells.has(d * P + pos)) n += 1;
    for (let m = 0; m < M; m++) {
      const pos = dem.morningPos[m]!;
      if (fixedCells.has(d * P + pos)) continue;
      if (!dem.unavail[(t * D + d) * P + pos] && !(dem.rientro[t * D + d] && dem.pIndex[pos]! < 4)) n += 1;
    }
    cap.push(n);
  }
  const lessons = info.lessons + dem.fixed.filter((f) => f.t === t).length;
  let now: number[] | null = null;
  if (data.slots.some((x) => x.teacherId === teacherId)) {
    const cur = prepare(data, "slots", { keepDisp: true });
    const tc = cur.teachers.findIndex((x) => x.id === teacherId);
    if (tc >= 0) {
      const s = new TimetableSolver(cur, 1);
      s.setState(cur.unitStart);
      now = Array.from(s.tdDuties.subarray(tc * cur.D, tc * cur.D + cur.D));
    }
  }
  return { hours: info.hours, lessons, disp: info.hours - lessons, cap, now };
}

/**
 * Le ore al giorno possibili per `hours` ore (una per giorno, dalla più alta; 0 = giorno libero),
 * al massimo 5 al giorno (6 solo se non bastano) e compatibili con le ore possibili per giorno.
 * Prima le più equilibrate e quelle senza giornate di un'ora sola.
 */
export function dayPatternOptions(hours: number, cap: number[]): number[][] {
  const D = cap.length;
  if (hours <= 0 || D === 0) return [];
  const capSorted = [...cap].sort((a, b) => b - a);
  const maxPart = hours > 5 * D ? 6 : 5;
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (left: number, i: number, max: number) => {
    if (i === D) {
      if (left === 0) out.push([...cur]);
      return;
    }
    for (let v = Math.min(max, left, capSorted[i]!); v >= 0; v--) {
      if (v * (D - i) < left) break;
      cur.push(v);
      rec(left - v, i + 1, v);
      cur.pop();
    }
  };
  rec(hours, 0, maxPart);
  const ones = (a: number[]) => a.filter((x) => x === 1).length;
  const sq = (a: number[]) => a.reduce((n, x) => n + x * x, 0);
  return out.sort((a, b) => ones(a) - ones(b) || sq(a) - sq(b) || a[0]! - b[0]!);
}

export type SolveResult = {
  slots: TimetableSlot[];
  report: TimetableReport;
  iterations: number;
  /** «Migliora l'attuale»: le ore a disposizione del mattino, dove erano e dove stanno (null con «Da zero») */
  disp: DispChange | null;
};

/** Un'ora a disposizione di un docente. */
export type DispCell = { teacherId: string; day: DayOfWeek; periodId: string };

/** Le ore a disposizione del mattino seguite dal motore: dove le aveva segnate il responsabile e dove stanno ora. */
export type DispChange = { before: DispCell[]; after: DispCell[] };

/** Esecuzione completa (per test e per il worker). */
export function solveTimetable(
  data: PersistedData,
  opts: { timeMs: number; seed?: number; mode?: SolveMode; now?: () => number; onProgress?: (p: SolveProgress) => void },
): SolveResult {
  const improve = opts.mode === "improve";
  const prep = prepare(data, "demand", { keepDisp: improve, floatDisp: improve });
  const solver = new TimetableSolver(prep, opts.seed ?? Date.now());
  const now = opts.now ?? (() => Date.now());
  solver.startRun(opts.timeMs, opts.mode ?? "scratch");
  let done = false;
  while (!done) {
    done = solver.step(100, now);
    opts.onProgress?.(solver.progress());
  }
  return finishResult(solver, prep);
}

/**
 * Ore a disposizione dopo le lezioni nuove: restano dove sono, tranne quelle che cadono su una
 * lezione dello stesso docente (le rimette a mano il responsabile).
 */
export function dispAfterLessons(
  data: PersistedData,
  slots: TimetableSlot[],
): {
  dispSlots: Record<string, { day: DayOfWeek; periodId: string }[]>;
  removed: { teacherId: string; day: DayOfWeek; periodId: string }[];
} {
  const busy = new Set(slots.map((s) => `${s.teacherId}|${s.day}|${s.periodId}`));
  const dispSlots: Record<string, { day: DayOfWeek; periodId: string }[]> = {};
  const removed: { teacherId: string; day: DayOfWeek; periodId: string }[] = [];
  for (const t of data.teachers) {
    const list = t.dispSlots ?? [];
    const keep = list.filter((a) => !busy.has(`${t.id}|${a.day}|${a.periodId}`));
    if (keep.length === list.length) continue;
    dispSlots[t.id] = keep;
    for (const a of list) if (!keep.includes(a)) removed.push({ teacherId: t.id, day: a.day, periodId: a.periodId });
  }
  return { dispSlots, removed };
}

let idCounter = 0;
function newSlotId(): string {
  idCounter += 1;
  return `slot-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function finishResult(solver: TimetableSolver, prep: Prep): SolveResult {
  return {
    slots: solver.toSlots(newSlotId),
    report: buildReport(solver, prep.U),
    iterations: solver.iterations,
    disp: prep.floatDisp ? solver.dispChange() : null,
  };
}

/**
 * Ore a disposizione dopo le lezioni nuove. Quelle del mattino seguite dal motore (`change`) stanno
 * dove le ha messe lui: nello stesso giorno, spostate solo se così si chiude un'ora buca o se ci va
 * una lezione. Le altre restano dove sono, tranne quelle che cadono su una lezione dello stesso docente.
 * `dispSlots`: solo i docenti che cambiano; `moved`: «da» e «a» (id delle ore) nello stesso giorno.
 */
export function dispOutcome(
  data: PersistedData,
  slots: TimetableSlot[],
  change: DispChange | null,
): {
  dispSlots: Record<string, { day: DayOfWeek; periodId: string }[]>;
  removed: DispCell[];
  moved: { teacherId: string; day: DayOfWeek; from: string; to: string }[];
} {
  const base = dispAfterLessons(data, slots);
  const removed: DispCell[] = [...base.removed];
  const moved: { teacherId: string; day: DayOfWeek; from: string; to: string }[] = [];
  if (!change || change.before.length === 0) return { dispSlots: base.dispSlots, removed, moved };
  const dispSlots = { ...base.dispSlots };
  const order = new Map(data.settings.periods.map((x) => [x.id, x.index]));
  const key = (a: { day: DayOfWeek; periodId: string }) => `${a.day}|${a.periodId}`;
  const busy = new Set(slots.map((x) => `${x.teacherId}|${x.day}|${x.periodId}`));
  for (const t of data.teachers) {
    const before = change.before.filter((c) => c.teacherId === t.id);
    if (!before.length) continue;
    const after = change.after.filter((c) => c.teacherId === t.id);
    const managed = new Set(before.map(key));
    // le altre (pomeriggio…) come prima; quelle del mattino dove stanno ora
    const rest = (t.dispSlots ?? []).filter((a) => !managed.has(key(a)) && !busy.has(`${t.id}|${a.day}|${a.periodId}`));
    const next = [...rest, ...after.map((c) => ({ day: c.day, periodId: c.periodId }))];
    const restRemoved = (t.dispSlots ?? []).filter((a) => !managed.has(key(a)) && busy.has(`${t.id}|${a.day}|${a.periodId}`));
    // tolte prima (cadevano su una lezione): le rifà sotto, giorno per giorno
    for (let i = removed.length - 1; i >= 0; i--) if (removed[i]!.teacherId === t.id) removed.splice(i, 1);
    for (const a of restRemoved) removed.push({ teacherId: t.id, day: a.day, periodId: a.periodId });
    const same =
      next.length === (t.dispSlots ?? []).length && next.every((a) => (t.dispSlots ?? []).some((b) => key(b) === key(a)));
    if (same) delete dispSlots[t.id];
    else dispSlots[t.id] = next;
    const afterKeys = new Set(after.map(key));
    const beforeKeys = new Set(before.map(key));
    const days = [...new Set(before.map((c) => c.day))];
    for (const day of days) {
      const idx = (c: DispCell) => order.get(c.periodId) ?? 0;
      const gone = before.filter((c) => c.day === day && !afterKeys.has(key(c))).sort((a, b) => idx(a) - idx(b));
      const come = after.filter((c) => c.day === day && !beforeKeys.has(key(c))).sort((a, b) => idx(a) - idx(b));
      gone.forEach((c, i) => {
        const to = come[i];
        if (to) moved.push({ teacherId: t.id, day, from: c.periodId, to: to.periodId });
        else removed.push(c);
      });
    }
  }
  return { dispSlots, removed, moved };
}

/** Un'ora a disposizione del mattino spostata dall'app; `from` null: una in più (dichiarata ma non segnata). */
export type DispMove = {
  teacherId: string;
  from: { day: DayOfWeek; periodId: string } | null;
  to: { day: DayOfWeek; periodId: string };
};

/** Ore a disposizione sistemate dall'app. `dispSlots`: solo i docenti che cambiano, con tutte le loro. */
export type DispPlan = { dispSlots: Record<string, { day: DayOfWeek; periodId: string }[]>; moves: DispMove[] };

/** Come va la settimana di un docente con le disposizioni in un certo posto (vedi dispTry). */
type DispScore = { hard: number; gaps: number; rows: number[]; soft: number };

/** confronto voce per voce: a viene prima di b */
function keyLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/**
 * Ore a disposizione del mattino nelle ore buche, in automatico. `data.slots`: tutto l'orario, lezioni
 * nuove comprese. Una disposizione si sposta (anche in un altro giorno) solo se calano le buche del
 * docente o i suoi vincoli non rispettati (es. le ore al giorno scelte) e nient'altro peggiora: buche,
 * vincoli, giornate dalla 1ª alla 6ª, con 2 buche, di un'ora sola o vuote. Quelle che cadono su una
 * lezione e quelle dichiarate ma non segnate vanno dove servono, se serve; altrimenti restano come
 * prima (le prime le toglie poi dispOutcome).
 * `replace` («Da zero»): le lezioni sono nuove, quindi le disposizioni del mattino si rimettono tutte,
 * prima nelle buche e poi nel posto migliore; a parità dove erano o lì vicino. `relocate` (con `replace`):
 * le ore dove una disposizione non può restare anche se lì non c'è una lezione (es. il docente ora è in
 * un'altra sede): si rimettono anche quelle.
 */
export function dispIntoGaps(
  data: PersistedData,
  opts: { replace?: boolean; relocate?: (teacherId: string, day: DayOfWeek, periodId: string) => boolean } = {},
): DispPlan {
  const out: DispPlan = { dispSlots: {}, moves: [] };
  const replace = Boolean(opts.replace);
  const prep = prepare(data, "slots", { keepDisp: true });
  if (!prep.U) return out;
  const { D, P } = prep;
  const s = new TimetableSolver(prep, 1);
  s.setState(prep.unitStart);
  const dayIdx = new Map<number, number>(prep.days.map((d, i) => [d, i]));
  const posIdx = new Map(prep.periods.map((x, i) => [x.id, i]));
  // cella d*P+pos del mattino, -1 se non c'è
  const cellOf = (a: { day: DayOfWeek; periodId: string }) => {
    const d = dayIdx.get(a.day);
    const pos = posIdx.get(a.periodId);
    return d === undefined || pos === undefined || prep.mOfPos[pos]! < 0 ? -1 : d * P + pos;
  };
  const toCell = (z: number) => ({ day: prep.days[(z / P) | 0]!, periodId: prep.periods[z % P]!.id });
  const dayOf = (z: number) => (z / P) | 0;
  const hourOf = (z: number) => prep.pIndex[z % P]!;
  const byId = new Map(data.teachers.map((t) => [t.id, t]));

  for (let t = 0; t < prep.T; t++) {
    const teacher = byId.get(prep.teachers[t]!.id);
    if (!teacher) continue;
    const total = dispCount(teacher);
    if (total === 0) continue;
    const list = teacher.dispSlots ?? [];
    const occ = (z: number) => s.tOcc[t * D * P + z]!;
    // dove può andare: mattino, senza ×, «no», prima della 4ª nei giorni di rientro, e senza lezione
    const free = (z: number) => ((prep.dispCand[t * D + dayOf(z)]! >>> (z % P)) & 1) === 1 && occ(z) === 0;
    // orig: da dove viene (-1 = in più); cur: dove sta (-1 = ancora da mettere)
    type Item = { orig: number; cur: number };
    const items: Item[] = [];
    const masksOf = (cells: number[]) => {
      const m = new Array<number>(D).fill(0);
      for (const z of cells) if (z >= 0) m[dayOf(z)]! |= 1 << (z % P);
      return m;
    };
    const itemMasks = () => masksOf(items.map((it) => it.cur));
    const seen = new Set<number>();
    const olds: number[] = [];
    for (const a of list) {
      const z = cellOf(a);
      if (z < 0 || seen.has(z)) continue;
      seen.add(z);
      if (replace) {
        // quelle in un'ora dove non possono stare (e senza lezione) restano dove sono, fuori dal conto
        if (free(z) || occ(z) > 0 || opts.relocate?.(teacher.id, a.day, a.periodId)) olds.push(z);
      } else if ((prep.dispMask0[t * D + dayOf(z)]! >>> (z % P)) & 1) items.push({ orig: z, cur: z });
      else if (occ(z) > 0) items.push({ orig: z, cur: -1 });
    }

    if (replace && olds.length) {
      // tutte di nuovo, una alla volta nel posto migliore; a parità dov'erano o lì vicino
      const placed: number[] = [];
      for (let i = 0; i < olds.length; i++) {
        let bestZ = -1;
        let bestKey: number[] = [];
        for (let z = 0; z < D * P; z++) {
          if (!free(z) || placed.includes(z)) continue;
          const sc = s.dispTry(t, masksOf([...placed, z]));
          let near = 99;
          for (const o of olds) if (dayOf(o) === dayOf(z)) near = Math.min(near, Math.abs(hourOf(o) - hourOf(z)));
          const key = [sc.hard, sc.gaps, sc.rows.reduce((x, y) => x + y, 0), near, Math.round(sc.soft * 1000)];
          if (bestZ < 0 || keyLess(key, bestKey)) {
            bestZ = z;
            bestKey = key;
          }
        }
        if (bestZ < 0) break;
        placed.push(bestZ);
      }
      // da dove a dove: prima nello stesso giorno, poi la più vicina
      const gone = olds.filter((z) => !placed.includes(z));
      for (const z of placed) {
        if (olds.includes(z)) {
          items.push({ orig: z, cur: z });
          continue;
        }
        let gi = -1;
        let gKey: number[] = [];
        gone.forEach((g, i) => {
          const key = [Math.abs(dayOf(g) - dayOf(z)), Math.abs(hourOf(g) - hourOf(z))];
          if (gi < 0 || keyLess(key, gKey)) {
            gi = i;
            gKey = key;
          }
        });
        items.push({ orig: gi >= 0 ? gone.splice(gi, 1)[0]! : -1, cur: z });
      }
      for (const g of gone) items.push({ orig: g, cur: -1 });
    }
    for (let i = list.length; i < total; i++) items.push({ orig: -1, cur: -1 });
    if (!items.length) continue;

    // poi una alla volta, finché calano buche o vincoli e nient'altro peggiora
    let now = s.dispTry(t, itemMasks());
    for (;;) {
      let pick: Item | null = null;
      let pickZ = -1;
      let pickKey: number[] = [];
      for (const it of items) {
        const ref = it.cur >= 0 ? it.cur : it.orig;
        for (let z = 0; z < D * P; z++) {
          if (!free(z) || items.some((x) => x.cur === z)) continue;
          const was = it.cur;
          it.cur = z;
          const sc = s.dispTry(t, itemMasks());
          it.cur = was;
          if (sc.hard > now.hard || sc.gaps > now.gaps || (sc.hard === now.hard && sc.gaps === now.gaps)) continue;
          if (sc.rows.some((v, i) => v > now.rows[i]!)) continue;
          const key = [
            sc.hard,
            sc.gaps,
            sc.rows.reduce((x, y) => x + y, 0),
            // prima quelle da mettere (quelle sotto una lezione, poi quelle in più), poi quelle già al loro posto
            was >= 0 ? 2 : it.orig >= 0 ? 0 : 1,
            Math.round(sc.soft * 1000),
            ref >= 0 ? Math.abs(dayOf(ref) - dayOf(z)) : 0,
            ref >= 0 ? Math.abs(hourOf(ref) - hourOf(z)) : 0,
          ];
          if (!pick || keyLess(key, pickKey)) {
            pick = it;
            pickZ = z;
            pickKey = key;
          }
        }
      }
      if (!pick) break;
      pick.cur = pickZ;
      now = s.dispTry(t, itemMasks());
    }

    const moved = items.filter((it) => it.cur >= 0 && it.cur !== it.orig).sort((a, b) => a.cur - b.cur);
    if (!moved.length) continue;
    const next = [...list];
    for (const it of moved) {
      if (it.orig < 0) continue;
      const i = next.findIndex((a) => cellOf(a) === it.orig);
      if (i >= 0) next.splice(i, 1);
    }
    for (const it of moved) {
      next.push(toCell(it.cur));
      out.moves.push({ teacherId: teacher.id, from: it.orig >= 0 ? toCell(it.orig) : null, to: toCell(it.cur) });
    }
    out.dispSlots[teacher.id] = next;
  }
  return out;
}

// ---------- ritocchi a mano ----------

/** Voci del confronto che un ritocco può cambiare (le stesse chiavi le usa l'interfaccia). */
export type RowKey =
  | "span6"
  | "six"
  | "five"
  | "gaps"
  | "multiGap"
  | "full"
  | "mixed"
  | "single"
  | "lastMax"
  | "firstHours"
  | "twoBlock"
  | "pe"
  | "heavy"
  | "noLight"
  | "langBlock"
  | "sameRun"
  | "split"
  | "patterns"
  | "classPref";

/** Voce del confronto per ogni posizione delle voci contate dal motore (null: si guarda a parte). */
const G_ROWS: (RowKey | null)[] = [
  "span6",
  "six",
  "five",
  "gaps",
  "multiGap",
  "full",
  "mixed",
  "single",
  null,
  "classPref",
  "firstHours",
  "pe",
  "twoBlock",
  "heavy",
  "noLight",
  "langBlock",
  "sameRun",
  "split",
];

/** Quanto pesa un'unità di ogni voce (gli stessi pesi del motore), per mettere in fila le proposte di «Trova». */
const ROW_WEIGHT: Record<RowKey, number> = {
  span6: WEIGHTS.span6,
  six: WEIGHTS.six,
  five: WEIGHTS.five,
  gaps: WEIGHTS.gap,
  multiGap: WEIGHTS.gap2,
  full: WEIGHTS.gapFull,
  mixed: WEIGHTS.mixed,
  single: WEIGHTS.single,
  lastMax: 100,
  firstHours: WEIGHTS.firstNone,
  twoBlock: WEIGHTS.twoBlock,
  pe: WEIGHTS.peLate,
  heavy: WEIGHTS.coreRun,
  noLight: WEIGHTS.noLight,
  langBlock: WEIGHTS.langBlock,
  sameRun: WEIGHTS.sameRun,
  split: WEIGHTS.split,
  patterns: WEIGHTS.hard,
  classPref: WEIGHTS.classPref,
};

/** Voci in cui il motore conta le mancanze, mentre il confronto mostra quante vanno bene. */
type HighRow = "firstHours" | "pe" | "classPref" | "patterns";
const HIGH_ROWS = new Set<RowKey>(["firstHours", "pe", "classPref", "patterns"]);

export type MoveEffect = {
  /** breaks: non rispetta un vincolo rigido in più */
  verdict: "better" | "same" | "mixed" | "worse" | "breaks";
  /** vincoli rigidi in più (positivo) o in meno (negativo) */
  hard: number;
  /** voci che cambiano; per prime ore, motoria, classi preferite e ore al giorno: quante vanno bene su `total` */
  rows: { key: RowKey; from: number; to: number; total?: number; better: boolean }[];
  /** altre classi che si spostano insieme (catena di scambi) */
  also: string[];
  /** ore a disposizione che non trovano più posto nel giorno (ci va una lezione): «Nome · Lun 3ª» */
  dispLost: string[];
  /** ore a disposizione che si spostano nello stesso giorno: «Nome · Lun 3ª → 4ª» */
  dispMoved: string[];
  /** a chi cambia cosa (nelle proposte di «Trova»; per uno spostamento si chiede a parte) */
  who?: WhoChange[];
};

/** Per un docente o una classe: cosa migliora e cosa peggiora con le mosse, giorno per giorno. */
export type WhoChange = {
  who: Who;
  /** day "": voci della settimana (ore al giorno, classi preferite, prime ore, motoria) */
  parts: { day: string; items: { text: string; better: boolean }[] }[];
  better: number;
  worse: number;
};

/** L'ordine delle voci per lo stesso docente o classe e giorno. */
const FACT_ORDER: RowKey[] = [
  "span6",
  "six",
  "five",
  "gaps",
  "multiGap",
  "single",
  "mixed",
  "patterns",
  "classPref",
  "firstHours",
  "pe",
  "twoBlock",
  "heavy",
  "noLight",
  "langBlock",
  "sameRun",
  "split",
];

/** La voce com'è adesso (`now`: è nuova) o che non c'è più. */
function factText(f: Fact, now: boolean): string {
  const k = f.key.replace(/#\d+$/, "");
  switch (f.row) {
    case "span6":
      return now ? "a scuola dalla 1ª alla 6ª" : "non più dalla 1ª alla 6ª";
    case "six":
      return now ? `${f.n} lezioni` : `non più ${f.n} lezioni`;
    case "five":
      return now ? "5 lezioni" : "non più 5 lezioni";
    case "multiGap":
      return now ? `${f.n} ore buche nel giorno` : `non più ${f.n} ore buche nel giorno`;
    case "single":
      return now ? "una sola ora" : "non più una sola ora";
    case "mixed":
      return now ? "qui e nell’altro plesso" : "non più su due plessi";
    case "patterns":
      return now ? `ore al giorno non come scelte (${f.extra})` : "ore al giorno di nuovo come scelte";
    case "classPref":
      return now
        ? `${f.n === 1 ? "1 classe preferita non rispettata" : `${f.n} classi preferite non rispettate`} (${f.extra})`
        : "classi preferite di nuovo rispettate";
    case "firstHours":
      return now ? `${k} ${f.n === 1 ? "solo un’ora" : "mai"} alla ${f.extra} ora` : `${k} di nuovo alla ${f.extra} ora`;
    case "pe":
      return now ? `${k} mai nelle ultime 3 ore` : `${k} di nuovo nelle ultime 3 ore`;
    case "twoBlock":
      return now ? `${k}, tutte e 2 le ore` : `${k} non più tutte e 2 le ore`;
    case "heavy":
      return now ? `${f.n} ore pesanti di fila` : "non più ore pesanti di fila";
    case "noLight":
      return now ? "nessuna materia leggera" : "di nuovo una materia leggera";
    case "langBlock":
      return now ? `${k} 2 ore di fila` : `${k} non più 2 ore di fila`;
    case "sameRun":
      return now ? `${k} ${f.n} ore di fila` : `${k} non più ${f.n} ore di fila`;
    case "split":
      return now ? `${k} spezzata` : `${k} non più spezzata`;
    default:
      return "";
  }
}

/**
 * A chi cambia cosa tra due orari: le voci per docente e per classe che ci sono solo dopo (peggio) o solo
 * prima (meglio); per le classi preferite conta anche quante non sono rispettate. Le ore buche nuove o tolte
 * nello stesso giorno stanno in una voce sola. Prima i docenti, poi le classi, in ordine di nome.
 */
export function diffFacts(before: Fact[], after: Fact[]): WhoChange[] {
  const id = (f: Fact) => `${f.row}|${f.who.kind}|${f.who.id}|${f.d}|${f.key}`;
  const A = new Map(before.map((f) => [id(f), f]));
  const B = new Map(after.map((f) => [id(f), f]));
  type Item = { f: Fact; text: string; better: boolean };
  const items: Item[] = [];
  const gapHours = new Map<string, { f: Fact; now: boolean; hours: string[] }>();
  const gap = (f: Fact, now: boolean) => {
    const k = `${f.who.kind}|${f.who.id}|${f.d}|${now}`;
    const g = gapHours.get(k) ?? { f, now, hours: [] };
    g.hours.push(f.key);
    gapHours.set(k, g);
  };
  for (const [k, b] of B) {
    const a = A.get(k);
    if (!a) {
      if (b.row === "gaps") gap(b, true);
      else items.push({ f: b, text: factText(b, true), better: false });
    } else if (a.n !== b.n && b.row === "classPref")
      items.push({ f: b, text: `classi preferite non rispettate ${a.n} → ${b.n} (${b.extra})`, better: b.n < a.n });
  }
  for (const [k, a] of A) {
    if (B.has(k)) continue;
    if (a.row === "gaps") gap(a, false);
    else items.push({ f: a, text: factText(a, false), better: true });
  }
  for (const g of gapHours.values()) {
    const one = g.hours.length === 1;
    const text = g.now
      ? `${one ? "ora buca nuova" : "ore buche nuove"} (${g.hours.join(", ")})`
      : `${one ? "ora buca tolta" : "ore buche tolte"} (${g.hours.join(", ")})`;
    items.push({ f: g.f, text, better: !g.now });
  }
  const byWho = new Map<string, Item[]>();
  for (const it of items) {
    const k = `${it.f.who.kind}|${it.f.who.id}`;
    byWho.set(k, [...(byWho.get(k) ?? []), it]);
  }
  const out: WhoChange[] = [];
  for (const list of byWho.values()) {
    // giorno per giorno (le voci della settimana in fondo), poi nell'ordine delle voci
    list.sort(
      (x, y) =>
        (x.f.d < 0 ? 99 : x.f.d) - (y.f.d < 0 ? 99 : y.f.d) || FACT_ORDER.indexOf(x.f.row) - FACT_ORDER.indexOf(y.f.row),
    );
    const parts: WhoChange["parts"] = [];
    for (const it of list) {
      const last = parts[parts.length - 1];
      const item = { text: it.text, better: it.better };
      if (last && last.day === it.f.day) last.items.push(item);
      else parts.push({ day: it.f.day, items: [item] });
    }
    const better = list.filter((x) => x.better).length;
    out.push({ who: list[0]!.f.who, parts, better, worse: list.length - better });
  }
  return out.sort(
    (x, y) => (x.who.kind === y.who.kind ? 0 : x.who.kind === "teacher" ? -1 : 1) || x.who.name.localeCompare(y.who.name, "it"),
  );
}

export type TeacherCell =
  | {
      kind: "lesson";
      classId: string;
      className: string;
      subject: string;
      locked: boolean;
      /** altre classi del docente nella stessa ora (vincolo violato: più classi insieme) */
      also: { classId: string; className: string; subject: string }[];
    }
  /** gap: ora buca (vuota tra due impegni a scuola) */
  | { kind: "disp" | "away" | "travel" | "no" | "free"; gap?: boolean };

type EditMove = { kind: "same" | "swap" | "kempe"; classes: number[]; peek: PeekResult | null };

/** Cosa cercare con «Trova»: come togliere una buca di un docente o dove spostare una lezione. */
export type FindTarget = { kind: "gap"; teacherId: string; z: number } | { kind: "lesson"; classId: string; z: number };

/** Una mossa proposta: le due lezioni della classe che si scambiano (b null: ora libera). */
export type FixStep = {
  classId: string;
  from: number;
  to: number;
  a: { subject: string; teacherId: string } | null;
  b: { subject: string; teacherId: string } | null;
  also: string[];
};

/** Una proposta di «Trova»: una o due mosse e l'effetto di tutte insieme. */
export type FixOption = { steps: FixStep[]; effect: MoveEffect };

/** Le proposte di «Trova»; `partial`: la ricerca si è fermata prima della fine (le migliori trovate fin lì). */
export type FindResult = { options: FixOption[]; partial: boolean };

/**
 * Vincoli in più (positivo) o in meno di una mossa. Se mette qualcuno su una × o senza ora di spostamento, o
 * porta un'andata e ritorno tra plessi, non «sistema» nulla, anche se toglie altri vincoli: conta come vincoli in più.
 */
function hardOf(peek: PeekResult): number {
  return peek.dphys > 0 || peek.shuttle > 0 ? Math.max(peek.dh, peek.dphys, peek.shuttle) : peek.dh;
}

/**
 * I vincoli rigidi non rispettati, ognuno con quale è (chi e dove, senza i numeri) e quanto vale: dal testo
 * della voce, dove il numero che può cambiare (classi insieme, ore libere, obblighi) è il «quanto».
 */
function hardUnitsOf(r: TimetableReport): [text: string, key: string, n: number][] {
  const excess = new Map(r.patterns.rows.map((x) => [x.id, x.excess]));
  const out: [string, string, number][] = [];
  for (const [kind, list] of Object.entries(r.hard))
    for (const i of list) {
      const head = `${kind}|${i.text.split(": ")[0]}`;
      const num = (re: RegExp) => Number(re.exec(i.text)?.[1] ?? 1);
      if (kind === "conflicts") out.push([i.text, head, num(/: (\d+) classi insieme/) - 1]);
      else if (kind === "longGaps") out.push([i.text, head, num(/(\d+) or[ae]\b/)]);
      else if (kind === "must") out.push([i.text, head, num(/: (\d+) obblig/)]);
      else if (kind === "pattern") out.push([i.text, head, excess.get(i.teacherId ?? "") ?? 1]);
      else if (kind === "shuttle") out.push([i.text, head, 1]);
      else out.push([i.text, `${kind}|${i.text}`, 1]);
    }
  return out;
}

function hardUnits(r: TimetableReport): Map<string, number> {
  return new Map(hardUnitsOf(r).map(([, k, n]) => [k, n]));
}

/** Le voci dei vincoli rigidi nuovi o peggiorati rispetto a `before` (testi del resoconto). */
function worseIssues(before: Map<string, number>, r: TimetableReport): string[] {
  return hardUnitsOf(r)
    .filter(([, k, n]) => n > (before.get(k) ?? 0))
    .map(([text]) => text);
}

/**
 * Ritocchi a mano: le lezioni del mattino di un orario, su cui provare gli scambi (con l'effetto
 * sulle voci del confronto) e farli. Le ore bloccate non si spostano.
 */
export class TimetableEditor {
  readonly prep: Prep;
  private s: TimetableSolver;
  private G0: Int32Array;
  private last0: number;
  private pat0: number;
  private totals: Record<HighRow, number>;
  /** le voci per docente e classe dell'orario di adesso (si rifanno dopo uno spostamento) */
  private facts0: Fact[] | null = null;
  /** i vincoli rigidi non rispettati nell'orario di adesso (si rifanno dopo uno spostamento) */
  private units0: Map<string, number> | null = null;

  constructor(data: PersistedData) {
    this.prep = prepare(data, "slots", { keepDisp: true, dispYield: true, floatDisp: true });
    this.s = new TimetableSolver(this.prep, 1);
    this.s.setState(this.prep.unitStart);
    const r = buildReport(this.s, 0);
    this.totals = {
      firstHours: r.firstHours.total,
      pe: r.pe.total,
      classPref: r.classPref.want,
      patterns: r.patterns.total,
    };
    this.G0 = Int32Array.from(this.s.metrics());
    this.last0 = this.s.lastMax();
    this.pat0 = this.s.patternOkCount();
  }

  private refresh() {
    this.G0 = Int32Array.from(this.s.metrics());
    this.last0 = this.s.lastMax();
    this.pat0 = this.s.patternOkCount();
    this.facts0 = null;
    this.units0 = null;
  }

  /**
   * Fa le mosse una dopo l'altra, guarda com'è l'orario con `look` e le disfa; null se una mossa non si può
   * fare.
   */
  private onSteps<T>(steps: { classId: string; from: number; to: number }[], look: () => T): T | null {
    const s = this.s;
    const hard0 = s.hard;
    const done: { cls: number[]; x: number; y: number }[] = [];
    let ok = true;
    for (const st of steps) {
      const c = this.classOf(st.classId);
      const mv = this.plan(c, st.from, st.to);
      let cls: number[] | null = null;
      if (mv?.kind === "same") {
        s.swapClasses([c], st.from, st.to);
        cls = [c];
      } else if (mv) cls = s.applyMove(c, st.from, st.to, mv.kind === "kempe");
      if (!cls) {
        ok = false;
        break;
      }
      done.push({ cls, x: st.from, y: st.to });
    }
    const out = ok ? look() : null;
    for (let i = done.length - 1; i >= 0; i--) s.swapClasses(done[i]!.cls, done[i]!.x, done[i]!.y);
    if (s.hard !== hard0) s.recomputeAll();
    return out;
  }

  /**
   * A chi cambia cosa con le mosse, fatte una dopo l'altra come in una proposta di «Trova», senza farle
   * davvero; null se una mossa non si può fare.
   */
  whoChanges(steps: { classId: string; from: number; to: number }[]): WhoChange[] | null {
    const facts0 = (this.facts0 ??= buildReport(this.s, 0).facts);
    const after = this.onSteps(steps, () => buildReport(this.s, 0).facts);
    return after && diffFacts(facts0, after);
  }

  /**
   * I vincoli rigidi che le mosse, fatte una dopo l'altra, non rispettano più o rispettano meno (testi del
   * resoconto), senza farle davvero: anche quando ne sistemano altri e il conto resta uguale. null se una
   * mossa non si può fare.
   */
  private brokenBy(steps: { classId: string; from: number; to: number }[]): string[] | null {
    const units0 = (this.units0 ??= hardUnits(buildReport(this.s, 0)));
    return this.onSteps(steps, () => worseIssues(units0, buildReport(this.s, 0)));
  }

  /**
   * Lo scambio tra le caselle x e y delle classi tocca un docente o una giornata di classe che ha già un vincolo
   * non rispettato (in `tw` e `cd`, di partenza: twHard e cdHard)? Solo così può sistemarne uno e romperne un
   * altro senza che il conto cambi; se no un vincolo rotto si vede già dal conto.
   */
  private nearHard(cls: number[], x: number, y: number, tw: Int32Array, cd: Int32Array): boolean {
    const p = this.prep;
    for (const c of cls)
      for (const z of [x, y]) {
        if (cd[c * p.D + ((z / p.M) | 0)]! > 0) return true;
        const u = this.s.grid[c * p.DM + z]!;
        if (u >= 0 && tw[p.unitTeacher[u]!]! > 0) return true;
      }
    return false;
  }

  /** Casella del mattino (giorno, ora) → indice; -1 se non è un'ora del mattino. */
  cell(day: DayOfWeek, periodId: string): number {
    const p = this.prep;
    const d = p.days.indexOf(day);
    const pos = p.periods.findIndex((x) => x.id === periodId);
    const m = pos < 0 ? -1 : p.mOfPos[pos]!;
    return d < 0 || m < 0 ? -1 : d * p.M + m;
  }

  private classOf(classId: string): number {
    return this.prep.classes.findIndex((c) => c.id === classId);
  }

  /** La lezione della classe nella casella. */
  lessonAt(classId: string, z: number): { teacherId: string; subject: string; locked: boolean } | null {
    const p = this.prep;
    const c = this.classOf(classId);
    if (c < 0 || z < 0) return null;
    const u = this.s.grid[c * p.DM + z]!;
    if (u < 0) return null;
    return { teacherId: p.teachers[p.unitTeacher[u]!]!.id, subject: p.unitReal[u]!, locked: Boolean(p.locked[u]) };
  }

  /** Cosa fa il docente nella casella. */
  teacherAt(teacherId: string, z: number): TeacherCell {
    const p = this.prep;
    const t = p.teachers.findIndex((x) => x.id === teacherId);
    if (t < 0 || z < 0) return { kind: "free" };
    let hit: TeacherCell | null = null;
    for (let c = 0; c < p.C; c++) {
      const u = this.s.grid[c * p.DM + z]!;
      if (u < 0 || p.unitTeacher[u] !== t) continue;
      const one = { classId: p.classes[c]!.id, className: p.classes[c]!.name, subject: p.unitReal[u]! };
      if (hit?.kind === "lesson") hit.also.push(one);
      else hit = { kind: "lesson", ...one, locked: Boolean(p.locked[u]), also: [] };
    }
    if (hit) return hit;
    const d = (z / p.M) | 0;
    const pos = p.morningPos[z % p.M]!;
    const base = (t * p.D + d) * p.P;
    if (p.nSedi > 1 && p.multi[t]) return this.teacherAtSedi(t, d, pos);
    const un = p.unavail[base + pos];
    const disp = this.s.dispMask(t, d);
    let first = -1;
    let last = -1;
    for (let q = 0; q < p.P; q++) {
      if (this.s.tOcc[base + q]! > 0 || (disp >>> q) & 1) {
        if (first < 0) first = q;
        last = q;
      }
    }
    const gap = first < pos && pos < last && this.s.isGap(t, d, pos);
    if ((disp >>> pos) & 1) return { kind: "disp", gap: false };
    return { kind: un === 1 ? "away" : un === 2 ? "travel" : un === 3 ? "no" : "free", gap };
  }

  /**
   * Docente in più sedi, ora senza lezione: a disposizione in una sede, × in tutte le sue sedi, ora di spostamento
   * tra due sedi, «no» o libera; buca se lo è per l'app di una sede.
   */
  private teacherAtSedi(t: number, d: number, pos: number): TeacherCell {
    const p = this.prep;
    const views = this.s.sedeViewsOf(t, d);
    if (views.some((v) => (v.disp >>> pos) & 1)) return { kind: "disp", gap: false };
    const gap = views.some((v) => (v.gap >>> pos) & 1);
    const bit = 1 << pos;
    const dk = (t * p.D + d) * p.nSedi;
    const mine = p.sedeBits[t]!;
    let awayAll = mine !== 0;
    for (let x = 0; x < p.nSedi; x++) if ((mine >>> x) & 1 && !(p.sedeAwayMask[dk + x]! & bit)) awayAll = false;
    if (awayAll) return { kind: "away", gap: false };
    // tra l'ultima ora in una sede e la prima nell'altra
    let before = -1;
    let beforePos = -1;
    let after = -1;
    let afterPos = p.P;
    for (const v of views) {
      const m = v.les | v.disp;
      const lo = m & (bit - 1);
      const hi = m & ~((bit << 1) - 1);
      if (lo && highBit(lo) > beforePos) {
        beforePos = highBit(lo);
        before = v.s;
      }
      if (hi && lowBit(hi) < afterPos) {
        afterPos = lowBit(hi);
        after = v.s;
      }
    }
    if (before >= 0 && after >= 0 && before !== after) return { kind: "travel", gap: false };
    return { kind: p.unavail[(t * p.D + d) * p.P + pos] === 3 ? "no" : "free", gap };
  }

  /** Come spostare la lezione della classe c dalla casella x alla y: scambio semplice o catena. */
  private plan(c: number, x: number, y: number): EditMove | null {
    const p = this.prep;
    if (c < 0 || x < 0 || y < 0 || x === y) return null;
    const ua = this.s.grid[c * p.DM + x]!;
    const ub = this.s.grid[c * p.DM + y]!;
    if (ua < 0 && ub < 0) return null;
    if ((ua >= 0 && p.locked[ua]) || (ub >= 0 && p.locked[ub])) return null;
    if (ua >= 0 && ub >= 0 && p.unitTeacher[ua] === p.unitTeacher[ub] && p.unitSubj[ua] === p.unitSubj[ub]) {
      // stesso docente e stessa materia (o materie unite): per le voci non cambia niente
      return p.unitReal[ua] === p.unitReal[ub] ? null : { kind: "same", classes: [c], peek: null };
    }
    const a = this.s.peekMove(c, x, y, false);
    const b = this.s.peekMove(c, x, y, true);
    // prima chi non mette nessuno su una × o senza ora di spostamento (né in andata e ritorno), poi meno vincoli
    const rank = (r: PeekResult) => (r.dphys > 0 || r.shuttle > 0 ? 1_000_000 : 0) + r.dh;
    if (b && b.classes.length > 1 && (!a || rank(b) < rank(a))) return { kind: "kempe", classes: b.classes, peek: b };
    return a ? { kind: "swap", classes: [c], peek: a } : null;
  }

  /**
   * Le ore a disposizione che cambiano posto (nello stesso giorno: «Nome · Lun 3ª → 4ª») e quelle che
   * non trovano più posto (ci va una lezione e il giorno è pieno: «Nome · Lun 3ª»).
   */
  private dispTexts(list: { t: number; d: number; before: number; after: number }[]): { moved: string[]; lost: string[] } {
    const p = this.prep;
    const moved: string[] = [];
    const lost: string[] = [];
    const bits = (m: number) => {
      const out: number[] = [];
      for (let pos = 0; pos < p.P; pos++) if ((m >>> pos) & 1) out.push(pos);
      return out;
    };
    const hour = (pos: number) => p.periods[pos]!.label.replace(" ora", "");
    for (const x of list) {
      const who = `${p.teachers[x.t]!.name} · ${DAY_NAMES[p.days[x.d]!]}`;
      const come = bits(x.after & ~x.before);
      bits(x.before & ~x.after).forEach((pos, i) => {
        const to = come[i];
        if (to !== undefined) moved.push(`${who} ${hour(pos)} → ${hour(to)}`);
        else lost.push(`${who} ${hour(pos)}`);
      });
    }
    return { moved, lost };
  }

  /** Dove stanno le ore a disposizione adesso (per confrontare prima e dopo delle mosse). */
  private dispSnapshot(): Uint32Array {
    return Uint32Array.from(this.s.tdDisp);
  }

  private dispDiff(before: Uint32Array): { t: number; d: number; before: number; after: number }[] {
    const p = this.prep;
    const out: { t: number; d: number; before: number; after: number }[] = [];
    for (let kd = 0; kd < p.T * p.D; kd++)
      if (before[kd] !== this.s.tdDisp[kd])
        out.push({ t: (kd / p.D) | 0, d: kd % p.D, before: before[kd]!, after: this.s.tdDisp[kd]! });
    return out;
  }

  /** Dove si spostano le ore a disposizione con le mosse, fatte una dopo l'altra, senza farle davvero. */
  private dispForSteps(steps: { classId: string; from: number; to: number }[]): { moved: string[]; lost: string[] } {
    const s = this.s;
    const hard0 = s.hard;
    const snap = this.dispSnapshot();
    const done: { cls: number[]; x: number; y: number }[] = [];
    for (const st of steps) {
      const c = this.classOf(st.classId);
      const mv = this.plan(c, st.from, st.to);
      let cls: number[] | null = null;
      if (mv?.kind === "same") {
        s.swapClasses([c], st.from, st.to);
        cls = [c];
      } else if (mv) cls = s.applyMove(c, st.from, st.to, mv.kind === "kempe");
      if (!cls) break;
      done.push({ cls, x: st.from, y: st.to });
    }
    const out = this.dispTexts(this.dispDiff(snap));
    for (let i = done.length - 1; i >= 0; i--) s.swapClasses(done[i]!.cls, done[i]!.x, done[i]!.y);
    if (s.hard !== hard0) s.recomputeAll();
    return out;
  }

  /**
   * Le voci dopo una o più mosse, rispetto a com'era all'inizio: quali cambiano, il giudizio e quanto
   * peggiorano e migliorano in tutto (per mettere in fila le proposte di «Trova»).
   */
  private judge(peek: PeekResult): {
    verdict: MoveEffect["verdict"];
    rows: MoveEffect["rows"];
    worse: number;
    better: number;
    worseW: number;
    betterW: number;
  } {
    const rows: MoveEffect["rows"] = [];
    let worse = 0;
    let better = 0;
    G_ROWS.forEach((key, k) => {
      if (!key) return;
      const a = this.G0[k]!;
      const b = peek.G[k]!;
      if (a === b) return;
      if (b > a) worse += b - a;
      else better += a - b;
      if (HIGH_ROWS.has(key)) {
        const total = this.totals[key as HighRow];
        rows.push({ key, from: total - a, to: total - b, total, better: b < a });
      } else rows.push({ key, from: a, to: b, better: b < a });
    });
    if (peek.lastMax !== this.last0) {
      if (peek.lastMax > this.last0) worse += peek.lastMax - this.last0;
      else better += this.last0 - peek.lastMax;
      rows.push({ key: "lastMax", from: this.last0, to: peek.lastMax, better: peek.lastMax < this.last0 });
    }
    if (peek.patOk !== this.pat0) {
      if (peek.patOk < this.pat0) worse += this.pat0 - peek.patOk;
      else better += peek.patOk - this.pat0;
      rows.push({ key: "patterns", from: this.pat0, to: peek.patOk, total: this.totals.patterns, better: peek.patOk > this.pat0 });
    }
    const hard = peek.dh;
    const nb = rows.filter((r) => r.better).length + (hard < 0 ? 1 : 0);
    const nw = rows.filter((r) => !r.better).length;
    // una ×, l'ora di spostamento e l'andata e ritorno non si scambiano con altri vincoli: la mossa non si può fare
    const verdict: MoveEffect["verdict"] =
      hard > 0 || peek.dphys > 0 || peek.shuttle > 0
        ? "breaks"
        : nb && !nw
          ? "better"
          : nw && !nb
            ? "worse"
            : nb && nw
              ? "mixed"
              : "same";
    let worseW = 0;
    let betterW = 0;
    for (const r of rows) {
      const w = (r.key === "mixed" ? this.prep.mixedW : ROW_WEIGHT[r.key]) * Math.abs(r.to - r.from);
      if (r.better) betterW += w;
      else worseW += w;
    }
    return { verdict, rows, worse, better, worseW, betterW };
  }

  /** L'effetto dello spostamento della lezione della classe c dalla casella x alla y (mossa già pensata). */
  private describe(c: number, x: number, y: number, mv: EditMove): MoveEffect {
    const p = this.prep;
    const s = this.s;
    const also = mv.classes.slice(1).map((k) => p.classes[k]!.name);
    if (!mv.peek) return { verdict: "same", hard: 0, rows: [], also, dispLost: [], dispMoved: [] };
    const j = this.judge(mv.peek);
    const dt = this.dispTexts(mv.peek.disp);
    let verdict = j.verdict;
    let hard = hardOf(mv.peek);
    // sistema un vincolo ma ne rompe un altro: il conto resta uguale, ma è vietato lo stesso
    if (
      verdict !== "breaks" &&
      s.hard > 0 &&
      this.nearHard(mv.classes, x, y, s.twHard, s.cdHard) &&
      this.brokenBy([{ classId: p.classes[c]!.id, from: x, to: y }])?.length
    ) {
      verdict = "breaks";
      hard = Math.max(1, hard);
    }
    return { verdict, hard, rows: j.rows, also, dispLost: dt.lost, dispMoved: dt.moved };
  }

  // ---------- «Trova»: le migliori combinazioni di una o due mosse ----------

  /** La casella è ancora un'ora buca del docente (vuota tra due impegni)? */
  private gapStill(t: number, d: number, pos: number): boolean {
    const p = this.prep;
    const base = (t * p.D + d) * p.P;
    const disp = this.s.dispMask(t, d);
    let first = -1;
    let last = -1;
    for (let q = 0; q < p.P; q++) {
      if (this.s.tOcc[base + q]! > 0 || (disp >>> q) & 1) {
        if (first < 0) first = q;
        last = q;
      }
    }
    return first < pos && pos < last && this.s.isGap(t, d, pos);
  }

  private stepOf(c: number, x: number, y: number, mv: EditMove): FixStep {
    const p = this.prep;
    const at = (z: number) => {
      const u = this.s.grid[c * p.DM + z]!;
      return u < 0 ? null : { subject: p.unitReal[u]!, teacherId: p.teachers[p.unitTeacher[u]!]!.id };
    };
    return {
      classId: p.classes[c]!.id,
      from: x,
      to: y,
      a: at(x),
      b: at(y),
      also: mv.classes.slice(1).map((k) => p.classes[k]!.name),
    };
  }

  /** Com'è l'orario dopo le mosse, nelle caselle toccate (per riconoscere proposte uguali); null se non si può. */
  private endState(steps: FixStep[]): string | null {
    const p = this.prep;
    const done: { cls: number[]; x: number; y: number }[] = [];
    let ok = true;
    for (const st of steps) {
      const c = this.classOf(st.classId);
      const mv = this.plan(c, st.from, st.to);
      const cls = mv && mv.kind !== "same" ? this.s.applyMove(c, st.from, st.to, mv.kind === "kempe") : null;
      if (!cls) {
        ok = false;
        break;
      }
      done.push({ cls, x: st.from, y: st.to });
    }
    const cells = new Set<string>();
    if (ok)
      for (const m of done)
        for (const c of m.cls) for (const z of [m.x, m.y]) cells.add(`${c}:${z}:${this.s.grid[c * p.DM + z]}`);
    for (let i = done.length - 1; i >= 0; i--) this.s.swapClasses(done[i]!.cls, done[i]!.x, done[i]!.y);
    return ok ? [...cells].sort().join(",") : null;
  }

  /**
   * Seconde mosse da provare: una delle lezioni appena spostate va altrove (nelle stesse classi), oppure si
   * sposta un'altra lezione, in quei giorni, dei docenti spostati.
   */
  private repairMoves(cls: number[], x: number, y: number): [number, number, number][] {
    const p = this.prep;
    const DM = p.DM;
    const out: [number, number, number][] = [];
    for (const c of cls)
      for (const a of [x, y])
        for (let b = 0; b < DM; b++) if (b !== x && b !== y) out.push([c, a, b]);
    const moved = new Set<number>();
    for (const c of cls)
      for (const z of [x, y]) {
        const u = this.s.grid[c * DM + z]!;
        if (u >= 0) moved.add(p.unitTeacher[u]!);
      }
    const days = new Set([(x / p.M) | 0, (y / p.M) | 0]);
    for (let c = 0; c < p.C; c++) {
      if (cls.includes(c)) continue;
      for (let z = 0; z < DM; z++) {
        const u = this.s.grid[c * DM + z]!;
        if (u < 0 || !moved.has(p.unitTeacher[u]!) || !days.has((z / p.M) | 0)) continue;
        for (let w = 0; w < DM; w++) if (w !== z) out.push([c, z, w]);
      }
    }
    return out;
  }

  /**
   * Cerca le combinazioni di una o due mosse che tolgono la buca (e le ore buche calano davvero, non si
   * spostano altrove) o spostano la lezione, e le mette in fila: prima nessun vincolo in più, poi quelle che
   * non peggiorano nulla, poi quanto peggiorano (con i pesi del motore: una giornata di 6 lezioni pesa più
   * di una di un'ora sola), poi meno mosse, poi quanto migliorano. La seconda mossa sposta una delle
   * lezioni toccate dalla prima e vale solo se rimette a posto qualcosa. Proposte che portano allo stesso
   * orario contano una volta. Non propone mai mosse che sistemano un vincolo rompendone un altro.
   * Lavora a pezzi: restituisce di tanto in tanto quanto ha fatto (da 0 a 1); alla fine le 3 migliori.
   * Si ferma prima, tenendo il meglio trovato, se chi chiama passa `true` a `next()` o dopo `maxMs`.
   */
  *findFixes(target: FindTarget, maxMs = 8000): Generator<number, FindResult, boolean | undefined> {
    const p = this.prep;
    const s = this.s;
    const { DM, M } = p;
    const hard0 = s.hard;
    const startedAt = Date.now();
    let t = -1;
    let d = -1;
    let pos = -1;
    let cT = -1;
    let unit = -1;
    const cands: [number, number, number][] = [];
    if (target.kind === "gap") {
      t = p.teachers.findIndex((x) => x.id === target.teacherId);
      if (t < 0 || target.z < 0) return { options: [], partial: false };
      d = (target.z / M) | 0;
      pos = p.morningPos[target.z % M]!;
      if (!this.gapStill(t, d, pos)) return { options: [], partial: false };
      // una sua lezione nella buca, oppure via una sua lezione di quel giorno (la buca resta fuori)
      for (let c = 0; c < p.C; c++)
        for (let x = 0; x < DM; x++) {
          const u = s.grid[c * DM + x]!;
          if (u < 0 || p.unitTeacher[u] !== t || p.locked[u]) continue;
          if (x !== target.z) cands.push([c, x, target.z]);
          if (((x / M) | 0) === d) for (let y = 0; y < DM; y++) if (y !== x && y !== target.z) cands.push([c, x, y]);
        }
    } else {
      cT = this.classOf(target.classId);
      if (cT < 0 || target.z < 0) return { options: [], partial: false };
      unit = s.grid[cT * DM + target.z]!;
      if (unit < 0 || p.locked[unit]) return { options: [], partial: false };
      for (let y = 0; y < DM; y++) if (y !== target.z) cands.push([cT, target.z, y]);
    }
    const met = () => {
      if (target.kind === "gap") return !this.gapStill(t, d, pos);
      // la lezione non è più lì, e al suo posto non è tornata la stessa materia con lo stesso docente
      const u = s.grid[cT * DM + target.z]!;
      return u < 0 || p.unitTeacher[u] !== p.unitTeacher[unit] || p.unitReal[u] !== p.unitReal[unit];
    };
    // ore buche in tutto (voce 3): per una buca devono calare
    const GAPS = 3;
    const fewerGaps = (peek: PeekResult) => target.kind !== "gap" || peek.G[GAPS]! < this.G0[GAPS]!;
    // la seconda mossa può rimettere le cose come prima? (allora si prova davvero)
    const touches = (mv: EditMove, x: number, y: number) => {
      if (target.kind === "lesson") return mv.classes.includes(cT);
      for (const c of mv.classes)
        for (const z of [x, y]) {
          const u = s.grid[c * DM + z]!;
          if (u >= 0 && p.unitTeacher[u] === t && (((x / M) | 0) === d || ((y / M) | 0) === d)) return true;
        }
      return false;
    };
    // chi ha già un vincolo non rispettato, nell'orario di partenza: le mosse che lo toccano possono sistemarne
    // uno e romperne un altro senza che il conto cambi (si controlla sul resoconto, solo per loro)
    const tw0 = Int32Array.from(s.twHard);
    const cd0 = Int32Array.from(s.cdHard);
    const near = (cls: number[], x: number, y: number) => hard0 > 0 && this.nearHard(cls, x, y, tw0, cd0);
    /** near: da controllare sul resoconto; ok: controllata, non rompe nessun vincolo */
    type Found = { steps: FixStep[]; peek: PeekResult; key: number[]; near: boolean; ok?: boolean };
    const cmp = (a: Found, b: Found) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
      return 0;
    };
    let found: Found[] = [];
    const keep = (steps: FixStep[], peek: PeekResult, near: boolean) => {
      const j = this.judge(peek);
      found.push({ steps, peek, key: [peek.dh, j.worse > 0 ? 1 : 0, j.worseW, steps.length, -j.betterW, peek.ds], near });
    };
    let partial = false;
    let stop = false;
    for (let i = 0; i < cands.length; i++) {
      if (stop || (i % 2 === 0 && (yield i / cands.length)) || Date.now() - startedAt > maxMs) {
        partial = true;
        break;
      }
      const [c, x, y] = cands[i]!;
      const mv = this.plan(c, x, y);
      if (!mv || mv.kind === "same" || !mv.peek) continue;
      const step1 = this.stepOf(c, x, y, mv);
      const cls = s.applyMove(c, x, y, mv.kind === "kempe");
      if (!cls) continue;
      if (met()) {
        const peek1 = mv.peek;
        const ok1 = fewerGaps(peek1);
        const worse1 = this.judge(peek1).worse;
        const near1 = near(cls, x, y);
        if (peek1.dh <= 0 && peek1.dphys <= 0 && peek1.shuttle <= 0 && ok1) keep([step1], peek1, near1);
        // se la prima mossa lascia qualcosa di storto, una seconda può rimetterlo a posto
        if (peek1.dh > 0 || peek1.dphys > 0 || peek1.shuttle > 0 || worse1 > 0 || !ok1) {
          for (const [c2, x2, y2] of this.repairMoves(cls, x, y)) {
            if (cls.includes(c2) && ((x2 === x && y2 === y) || (x2 === y && y2 === x))) continue;
            const mv2 = this.plan(c2, x2, y2);
            if (!mv2 || mv2.kind === "same" || !mv2.peek) continue;
            const dh = peek1.dh + mv2.peek.dh;
            const dphys = peek1.dphys + mv2.peek.dphys;
            const shuttle = peek1.shuttle + mv2.peek.shuttle;
            if (dh > 0 || dphys > 0 || shuttle > 0) continue;
            const both: PeekResult = { ...mv2.peek, dh, dphys, ds: peek1.ds + mv2.peek.ds, shuttle };
            if (!fewerGaps(both)) continue;
            // utile solo se sistema qualcosa rispetto alla prima mossa da sola
            if (!(dh < peek1.dh || dphys < peek1.dphys || shuttle < peek1.shuttle || this.judge(both).worse < worse1 || !ok1))
              continue;
            const step2 = this.stepOf(c2, x2, y2, mv2);
            if (touches(mv2, x2, y2)) {
              const cls2 = s.applyMove(c2, x2, y2, mv2.kind === "kempe");
              const ok = Boolean(cls2) && met();
              if (cls2) s.swapClasses(cls2, x2, y2);
              if (!ok) continue;
            }
            keep([step1, step2], both, near1 || near(mv2.classes, x2, y2));
          }
        }
      }
      s.swapClasses(cls, x, y);
      if (s.hard !== hard0) s.recomputeAll();
      if (found.length > 600) {
        // le 120 migliori che non rompono vincoli (si controllano qui, sull'orario di partenza)
        found.sort(cmp);
        const top: Found[] = [];
        for (const f of found) {
          if (top.length >= 120) break;
          if (f.near && f.ok === undefined && !stop) {
            f.ok = this.brokenBy(f.steps)?.length === 0;
            if (yield i / cands.length) stop = true;
          }
          if (!f.near || f.ok) top.push(f);
        }
        found = top;
      }
    }
    yield 1;
    found.sort(cmp);
    const out: FixOption[] = [];
    const seen = new Set<string>();
    const effects = new Set<string>();
    for (const f of found) {
      const j = this.judge(f.peek);
      // effetto uguale a una proposta già scelta (con meno mosse o migliore): non serve
      const sig = `${f.peek.dh}|${j.rows.map((r) => `${r.key}:${r.from}>${r.to}`).join(",")}`;
      if (effects.has(sig)) continue;
      const k = this.endState(f.steps);
      if (!k || seen.has(k)) continue;
      // sistema un vincolo ma ne rompe un altro: non si propone
      if (f.near && f.ok === undefined && !stop) {
        f.ok = this.brokenBy(f.steps)?.length === 0;
        if (yield 1) stop = true;
      }
      if (f.near && !f.ok) continue;
      seen.add(k);
      effects.add(sig);
      out.push({
        steps: f.steps,
        effect: {
          verdict: j.verdict,
          hard: hardOf(f.peek),
          rows: j.rows,
          also: [...new Set(f.steps.flatMap((x) => x.also))],
          ...(() => {
            const dt = this.dispForSteps(f.steps);
            return { dispLost: dt.lost, dispMoved: dt.moved };
          })(),
          who: this.whoChanges(f.steps) ?? undefined,
        },
      });
      if (out.length >= 3) break;
    }
    return { options: out, partial: partial || stop };
  }

  /** Effetto dello spostamento della lezione della classe dalla casella `from` a `to`; null se non si può. */
  effect(classId: string, from: number, to: number): MoveEffect | null {
    const c = this.classOf(classId);
    const mv = this.plan(c, from, to);
    return mv ? this.describe(c, from, to, mv) : null;
  }

  /** Effetto per ogni casella della classe (null: la casella stessa, ore bloccate, nessun cambiamento). */
  effects(classId: string, from: number): (MoveEffect | null)[] {
    const c = this.classOf(classId);
    const out: (MoveEffect | null)[] = [];
    for (let z = 0; z < this.prep.DM; z++) {
      const mv = z === from ? null : this.plan(c, from, z);
      out.push(mv ? this.describe(c, from, z, mv) : null);
    }
    return out;
  }

  /**
   * I vincoli rigidi che lo spostamento non rispetterebbe o rispetterebbe meno (testi del resoconto), anche
   * se ne sistema altri, senza farlo.
   */
  newHardIssues(classId: string, from: number, to: number): string[] {
    return this.brokenBy([{ classId, from, to }]) ?? [];
  }

  /**
   * Fa lo spostamento: restituisce le lezioni del mattino dopo, le altre classi spostate e le ore a
   * disposizione che cambiano posto o si tolgono.
   */
  apply(
    classId: string,
    from: number,
    to: number,
  ): { slots: TimetableSlot[]; also: string[]; dispMoved: string[]; dispLost: string[] } | null {
    const c = this.classOf(classId);
    const mv = this.plan(c, from, to);
    if (!mv) return null;
    const snap = this.dispSnapshot();
    if (mv.kind === "same") this.s.swapClasses([c], from, to);
    else if (!this.s.applyMove(c, from, to, mv.kind === "kempe")) return null;
    this.refresh();
    const dt = this.dispTexts(this.dispDiff(snap));
    return {
      slots: this.slots(),
      also: mv.classes.slice(1).map((x) => this.prep.classes[x]!.name),
      dispMoved: dt.moved,
      dispLost: dt.lost,
    };
  }

  /** Le ore a disposizione del mattino: dove le aveva segnate il responsabile e dove stanno ora. */
  dispChange(): DispChange {
    return this.s.dispChange();
  }

  /** Lezioni del mattino (ogni ora con la sua materia e il suo id). */
  slots(): TimetableSlot[] {
    return this.s.toSlots(newSlotId, { keepReal: true });
  }

  report(expected: number): TimetableReport {
    return buildReport(this.s, expected);
  }
}
