import {
  finishResult,
  prepare,
  TimetableSolver,
  type SolveMode,
  type SolveProgress,
  type SolveResult,
} from "./timetable-solver";
import type { PersistedData } from "./types";

export type RunProgress = SolveProgress & { workers: number };

export type RunHandle = {
  stop: () => void;
  result: Promise<SolveResult>;
};

type Score = { hard: number; pen: number; soft: number };

function lessScore(a: Score, b: Score): boolean {
  if (a.hard !== b.hard) return a.hard < b.hard;
  if (a.pen !== b.pen) return a.pen < b.pen;
  return a.soft < b.soft;
}

function better(a: SolveResult, b: SolveResult | null): boolean {
  return !b || lessScore(a.report.score, b.report.score);
}

/** Quante ricerche in parallelo: una per processore, lasciandone uno alla pagina (al massimo 6). */
function workerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(6, cores - 1));
}

/**
 * Avvia la ricerca. Con più processori lancia più ricerche in parallelo (semi diversi): alla fine di ogni
 * giro tutte ripartono dalla migliore trovata finora, e alla fine si tiene la migliore. Se i worker non
 * partono, lavora nella pagina a piccoli passi.
 */
export function runTimetable(
  data: PersistedData,
  opts: { timeMs: number; mode: SolveMode; onProgress: (p: RunProgress) => void },
): RunHandle {
  const n = workerCount();
  const baseSeed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  let workers: Worker[] = [];
  let stopped = false;
  let fallback: RunHandle | null = null;

  const result = new Promise<SolveResult>((resolve, reject) => {
    const startInline = () => {
      for (const w of workers) w.terminate();
      workers = [];
      fallback = runInline(data, { ...opts, seed: baseSeed });
      if (stopped) fallback.stop();
      fallback.result.then(resolve, reject);
    };
    try {
      for (let i = 0; i < n; i++) {
        workers.push(new Worker(new URL("./timetable-worker.ts", import.meta.url), { type: "module" }));
      }
    } catch {
      startInline();
      return;
    }
    const progress: (SolveProgress | null)[] = workers.map(() => null);
    let best: SolveResult | null = null;
    let finished = 0;
    let failed = 0;
    // ricerca in parallelo: a fine giro ogni ricerca aspetta; quando aspettano tutte, ripartono dalla migliore
    const sync = workers.length > 1;
    const gone = workers.map(() => false);
    const waiting: ({ cells: number[]; score: Score } | null)[] = workers.map(() => null);
    const release = () => {
      const alive = workers.map((_, i) => i).filter((i) => !gone[i]);
      if (!alive.length || alive.some((i) => !waiting[i])) return;
      let top = waiting[alive[0]!]!;
      for (const i of alive) if (lessScore(waiting[i]!.score, top.score)) top = waiting[i]!;
      const cells = stopped ? null : top.cells;
      for (const i of alive) {
        waiting[i] = null;
        workers[i]!.postMessage({ type: "adopt", cells });
      }
    };
    const report = () => {
      const list = progress.filter((p): p is SolveProgress => Boolean(p));
      if (!list.length) return;
      const top = list.reduce((a, b) =>
        b.bestHard < a.bestHard || (b.bestHard === a.bestHard && b.bestSoft < a.bestSoft) ? b : a,
      );
      opts.onProgress({
        ...top,
        fraction: list.reduce((s, p) => s + p.fraction, 0) / list.length,
        iterations: list.reduce((s, p) => s + p.iterations, 0),
        workers: workers.length,
      });
    };
    const settle = () => {
      if (finished + failed < workers.length) return;
      for (const w of workers) w.terminate();
      if (best) resolve(best);
      else startInline();
    };
    workers.forEach((w, i) => {
      w.onmessage = (e: MessageEvent) => {
        const msg = e.data as
          | { type: "progress"; progress: SolveProgress }
          | { type: "sync"; cells: number[]; score: Score }
          | { type: "done"; result: SolveResult }
          | { type: "error"; message: string };
        if (msg.type === "progress") {
          progress[i] = msg.progress;
          report();
        } else if (msg.type === "sync") {
          waiting[i] = { cells: msg.cells, score: msg.score };
          release();
        } else if (msg.type === "done") {
          finished += 1;
          gone[i] = true;
          if (better(msg.result, best)) best = msg.result;
          release();
          settle();
        } else {
          failed += 1;
          gone[i] = true;
          release();
          settle();
        }
      };
      w.onerror = (ev) => {
        ev.preventDefault?.();
        if (gone[i]) return;
        failed += 1;
        gone[i] = true;
        release();
        settle();
      };
      w.postMessage({
        type: "start",
        data,
        timeMs: opts.timeMs,
        seed: (baseSeed + i * 7919) >>> 0,
        mode: opts.mode,
        sync,
      });
    });
  });

  return {
    stop: () => {
      stopped = true;
      if (fallback) fallback.stop();
      for (const w of workers) w.postMessage({ type: "stop" });
    },
    result,
  };
}

/** Ricerca nella pagina, a fette brevi, per non bloccare l'interfaccia. */
function runInline(
  data: PersistedData,
  opts: { timeMs: number; mode: SolveMode; seed: number; onProgress: (p: RunProgress) => void },
): RunHandle {
  const improve = opts.mode === "improve";
  const prep = prepare(data, "demand", { keepDisp: improve, floatDisp: improve });
  const solver = new TimetableSolver(prep, opts.seed);
  solver.startRun(opts.timeMs, opts.mode);
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const result = new Promise<SolveResult>((resolve, reject) => {
    const loop = () => {
      try {
        const done = solver.step(40, now);
        opts.onProgress({ ...solver.progress(), workers: 0 });
        if (done) resolve(finishResult(solver, prep));
        else setTimeout(loop, 0);
      } catch (err) {
        reject(err);
      }
    };
    setTimeout(loop, 0);
  });
  return { stop: () => solver.requestStop(), result };
}
