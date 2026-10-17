/**
 * Materie dello stesso docente nella stessa classe che, per costruire l'orario, contano come una
 * sola: italiano, storia e geografia; matematica e scienze. Alla fine le ore tornano alle materie
 * vere (`splitMerged`); il docente può poi scambiarle.
 */

const GROUPS: string[][] = [
  ["Italiano", "Storia", "Geografia"],
  ["Matematica", "Scienze"],
];

const LABELS: { parts: string[]; label: string; abbr: string; upper: string }[] = [
  {
    parts: ["Italiano", "Storia", "Geografia"],
    label: "Italiano, Storia e Geografia",
    abbr: "ITA/STO/GEO",
    upper: "ITALIANO, STORIA E GEOGRAFIA",
  },
  { parts: ["Italiano", "Storia"], label: "Italiano e Storia", abbr: "ITA/STO", upper: "ITALIANO E STORIA" },
  { parts: ["Italiano", "Geografia"], label: "Italiano e Geografia", abbr: "ITA/GEO", upper: "ITALIANO E GEOGRAFIA" },
  { parts: ["Storia", "Geografia"], label: "Storia e Geografia", abbr: "STO/GEO", upper: "STORIA E GEOGRAFIA" },
  { parts: ["Matematica", "Scienze"], label: "Matematica e Scienze", abbr: "MAT/SC", upper: "MATEMATICA E SCIENZE" },
  // nome usato dalle versioni precedenti: solo per leggere orari già salvati
  { parts: ["Italiano", "Storia", "Geografia"], label: "Lettere", abbr: "LET", upper: "LETTERE" },
];

/** Gruppo (0 = lettere, 1 = matematica e scienze) o -1. */
export function subjectGroup(subject: string): number {
  return GROUPS.findIndex((g) => g.includes(subject));
}

/** Etichetta della materia unita per le parti date (almeno due dello stesso gruppo). */
export function mergedLabel(parts: string[]): string {
  const set = new Set(parts);
  const hit = LABELS.find((l) => l.parts.length === set.size && l.parts.every((p) => set.has(p)));
  return hit ? hit.label : [...set].join(" e ");
}

/** Parti di una materia (unita o no). */
export function subjectParts(subject: string): string[] {
  const hit = LABELS.find((l) => l.label === subject);
  return hit ? hit.parts : [subject];
}

export function isMergedSubject(subject: string): boolean {
  return LABELS.some((l) => l.label === subject);
}

/** Nome attuale di una materia unita (anche se salvata col nome di una versione precedente). */
export function canonicalSubject(subject: string): string {
  return isMergedSubject(subject) ? mergedLabel(subjectParts(subject)) : subject;
}

export function mergedAbbr(subject: string): string | undefined {
  return LABELS.find((l) => l.label === subject)?.abbr;
}

export function mergedUpper(subject: string): string | undefined {
  return LABELS.find((l) => l.label === subject)?.upper;
}

/**
 * Per ogni (classe, docente, materia) l'etichetta da usare nell'orario: unita quando lo stesso
 * docente ha almeno due materie dello stesso gruppo in quella classe.
 */
export function buildMergeMap(rows: { classId: string; teacherId: string; subject: string }[]): Map<string, string> {
  const byKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const g = subjectGroup(r.subject);
    if (g < 0) continue;
    const k = `${r.classId}|${r.teacherId}|${g}`;
    const set = byKey.get(k) ?? new Set<string>();
    set.add(r.subject);
    byKey.set(k, set);
  }
  const out = new Map<string, string>();
  for (const [k, set] of byKey) {
    if (set.size < 2) continue;
    const [classId, teacherId] = k.split("|");
    const label = mergedLabel([...set]);
    for (const s of set) out.set(`${classId}|${teacherId}|${s}`, label);
  }
  return out;
}

/**
 * Divide le ore di una materia unita (stessa classe e docente) tra le materie vere.
 * `cells`: celle d*M+m in ordine; `counts`: ore di ogni materia; `main`: italiano o matematica;
 * `test`: celle che devono andare alla materia principale (le prime ore per i compiti).
 * Cerca la divisione migliore: principale prima e alle prime ore, le altre una al giorno,
 * al massimo 2 ore di fila della stessa materia.
 */
export function splitMerged(
  cells: number[],
  M: number,
  counts: Map<string, number>,
  main: string,
  test: Set<number>,
): string[] {
  const subjects = [...counts.keys()];
  const left = subjects.map((x) => counts.get(x) ?? 0);
  const mainIdx = subjects.indexOf(main);
  const n = cells.length;
  const day = cells.map((z) => Math.floor(z / M));
  const hour = cells.map((z) => z % M);
  const cur = new Array<number>(n).fill(-1);
  let best: number[] | null = null;
  let bestCost = Infinity;

  /** Costo delle celle da `from` a `to` (escluso), tutte dello stesso giorno. */
  const dayCost = (from: number, to: number) => {
    let cost = 0;
    let run = 1;
    const seen = new Map<number, number>();
    for (let i = from; i < to; i++) {
      const s = cur[i]!;
      if (test.has(cells[i]!) && s !== mainIdx) cost += 1000;
      seen.set(s, (seen.get(s) ?? 0) + 1);
      if (i > from && hour[i] === hour[i - 1]! + 1) {
        if (s === cur[i - 1]) {
          run += 1;
          if (run > 2) cost += 100;
        } else run = 1;
        if (s === mainIdx && cur[i - 1] !== mainIdx) cost += 5;
      } else run = 1;
    }
    let others = 0;
    for (const [s, k] of seen) {
      if (s === mainIdx) continue;
      others += 1;
      if (k > 1) cost += 30 * (k - 1);
    }
    if (others > 1) cost += 10 * (others - 1);
    return cost;
  };

  const dfs = (i: number, dayStart: number, acc: number) => {
    if (acc >= bestCost) return;
    if (i === n) {
      const total = acc + dayCost(dayStart, n);
      if (total < bestCost) {
        bestCost = total;
        best = cur.slice();
      }
      return;
    }
    let start = dayStart;
    let sum = acc;
    if (i > 0 && day[i] !== day[i - 1]) {
      sum += dayCost(dayStart, i);
      start = i;
      if (sum >= bestCost) return;
    }
    for (let s = 0; s < subjects.length; s++) {
      if (!left[s]) continue;
      left[s] -= 1;
      cur[i] = s;
      dfs(i + 1, start, sum);
      left[s] += 1;
    }
  };
  dfs(0, 0, 0);
  const pick = best ?? cur;
  return pick.map((s) => subjects[s] ?? main);
}
