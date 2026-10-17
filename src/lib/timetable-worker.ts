import { finishResult, prepare, TimetableSolver, type SolveMode } from "./timetable-solver";
import type { PersistedData } from "./types";

type StartMsg = { type: "start"; data: PersistedData; timeMs: number; seed: number; mode: SolveMode };
type StopMsg = { type: "stop" };

type WorkerScope = {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent<StartMsg | StopMsg>) => void) | null;
};

const scope = self as unknown as WorkerScope;
let solver: TimetableSolver | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "stop") {
    solver?.requestStop();
    return;
  }
  try {
    const improve = msg.mode === "improve";
    const prep = prepare(msg.data, "demand", { keepDisp: improve, floatDisp: improve });
    const s = new TimetableSolver(prep, msg.seed);
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
          return;
        }
        setTimeout(loop, 0);
      } catch (err) {
        scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    };
    loop();
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
