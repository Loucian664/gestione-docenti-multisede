import { finishResult, prepare, TimetableSolver, type SolveMode } from "./timetable-solver";
import type { PersistedData } from "./types";

type StartMsg = { type: "start"; data: PersistedData; timeMs: number; seed: number; mode: SolveMode; sync?: boolean };
type StopMsg = { type: "stop" };
/** Ricerca in parallelo, a fine giro: riparti da questa proposta (la migliore di tutte), o dalla tua con null. */
type AdoptMsg = { type: "adopt"; cells: number[] | null };

type WorkerScope = {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent<StartMsg | StopMsg | AdoptMsg>) => void) | null;
};

const scope = self as unknown as WorkerScope;
let solver: TimetableSolver | null = null;
let resume: (() => void) | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "stop") {
    solver?.requestStop();
    // ferma anche se aspetta la migliore di tutte a fine giro
    if (solver?.waiting) {
      solver.adopt(null);
      resume?.();
    }
    return;
  }
  if (msg.type === "adopt") {
    if (!solver?.waiting) return;
    solver.adopt(msg.cells);
    resume?.();
    return;
  }
  try {
    const improve = msg.mode === "improve";
    const prep = prepare(msg.data, "demand", { keepDisp: improve, floatDisp: improve });
    const s = new TimetableSolver(prep, msg.seed);
    s.syncCycles = Boolean(msg.sync);
    solver = s;
    s.startRun(msg.timeMs, msg.mode);
    const now = () => performance.now();
    const loop = () => {
      try {
        const done = s.step(120, now);
        scope.postMessage({ type: "progress", progress: s.progress() });
        if (done) {
          scope.postMessage({ type: "done", result: finishResult(s, prep) });
          solver = null;
          resume = null;
          return;
        }
        if (s.waiting) {
          // fine del giro: la migliore finora va a chi coordina, che risponde con la migliore di tutte
          scope.postMessage({ type: "sync", cells: Array.from(s.bestCells()), score: s.bestScore() });
          return;
        }
        setTimeout(loop, 0);
      } catch (err) {
        scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    };
    resume = () => setTimeout(loop, 0);
    loop();
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
