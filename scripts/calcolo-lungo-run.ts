/**
 * Calcolo lungo dell'orario: la parte che gira (processo principale e processi di calcolo). Si avvia con
 * `node scripts/calcolo-lungo.mjs …` (vedi CLAUDE.md, «Calcolo lungo dell'orario»).
 *
 * Ogni processo ripete il motore di Costruisci con semi diversi, una corsa dopo l'altra, finché il tempo non
 * finisce; il processo principale trasforma ogni soluzione nell'orario da slot (come «Salva nello slot…»),
 * tiene le migliori e alla fine sceglie le versioni, diverse tra loro, da mettere negli slot richiesti.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  candidateOf,
  compareReports,
  durationText,
  isComplete,
  jointCandidateOf,
  jointVersionPlan,
  pickJointVersions,
  pickVersions,
  reportLine,
  requestProblems,
  withJointVersions,
  withVersions,
  type Candidate,
  type JointCandidate,
  type LongRunRequest,
} from "../src/lib/calcolo-lungo";
import { allSedi, sedeName, withOtherSedi } from "../src/lib/sedi";
import { buildInsieme, INSIEME_VERSIONI, withMixedWeight } from "../src/lib/sedi-insieme";
import { backupJson, parseBackupJson } from "../src/lib/export";
import { evaluateCurrent, finishResult, prepare, TimetableSolver, type SolveMode } from "../src/lib/timetable-solver";
import type { PersistedData } from "../src/lib/types";

/** `weights`: con tutte le sedi insieme, il peso dei giorni divisi di ogni versione da calcolare, a turno. */
type WorkerIn = {
  data: PersistedData;
  mode: SolveMode;
  runMs: number;
  deadline: number;
  seed: number;
  weights: { key: string; mixedW: number }[] | null;
};
type WorkerOut =
  | {
      type: "result";
      key: string | null;
      slots: ReturnType<typeof finishResult>["slots"];
      disp: ReturnType<typeof finishResult>["disp"];
    }
  | { type: "done" }
  | { type: "error"; message: string };

function workerLoop() {
  const input = workerData as WorkerIn;
  const port = parentPort!;
  let seed = input.seed >>> 0;
  const now = () => performance.now();
  const endAt = now() + (input.deadline - Date.now());
  let run = 0;
  try {
    const improve = input.mode === "improve";
    while (now() < endAt - 5000) {
      const w = input.weights ? input.weights[run % input.weights.length]! : null;
      run += 1;
      const data = w ? withMixedWeight(input.data as never, w.mixedW) : input.data;
      const prep = prepare(data, "demand", { keepDisp: improve, floatDisp: improve });
      const solver = new TimetableSolver(prep, seed);
      solver.startRun(Math.min(input.runMs, endAt - now()), input.mode);
      while (!solver.step(500, now)) {
        /* corsa in corso */
      }
      const res = finishResult(solver, prep);
      port.postMessage({ type: "result", key: w?.key ?? null, slots: res.slots, disp: res.disp } satisfies WorkerOut);
      seed = (seed + 7919) >>> 0;
    }
    port.postMessage({ type: "done" } satisfies WorkerOut);
  } catch (err) {
    port.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) } satisfies WorkerOut);
  }
}

type Args = {
  backup: string;
  out: string;
  request: LongRunRequest;
  runSeconds: number;
  workers: number;
  /** ogni quanti minuti si scrive il file di uscita con le versioni migliori trovate finora */
  saveMinutes: number;
};

function numbers(v: string | undefined): number[] {
  return (v ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const backup = get("backup");
  if (!backup) throw new Error("manca --backup <file del backup>");
  const modo = get("modo") ?? "";
  const sedi = get("sedi") ?? "sede";
  if (sedi !== "sede" && sedi !== "tutte") throw new Error("--sedi deve essere sede oppure tutte");
  if (modo !== "da-zero" && modo !== "migliora") throw new Error("--modo deve essere da-zero oppure migliora");
  const minutes = Number(get("minuti"));
  return {
    backup,
    out: get("uscita") ?? backup.replace(/\.json$/i, "") + "-calcolo-lungo.json",
    request: {
      mode: modo === "migliora" ? "improve" : "scratch",
      slots: numbers(get("slot")),
      replace: numbers(get("sostituisci")),
      minutes,
      scope: sedi,
    },
    runSeconds: Number(get("corsa") ?? 120),
    workers: Number(get("processi") ?? Math.max(1, availableParallelism() - 1)),
    saveMinutes: Number(get("salva-ogni") ?? 5),
  };
}

function clock(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** Il calcolo: `bundle` è questo stesso file già compilato, da cui partono i processi di calcolo. */
export async function main(argv: string[], bundle: string): Promise<void> {
  const args = parseArgs(argv);
  const data = parseBackupJson(readFileSync(args.backup, "utf8"));
  const problems = requestProblems(data, args.request);
  if (problems.length) {
    console.error("Calcolo non avviato:\n- " + problems.join("\n- "));
    process.exitCode = 1;
    return;
  }
  const { mode, slots, minutes, scope } = args.request;
  const all = scope === "tutte";
  const start = Date.now();
  const deadline = start + minutes * 60_000;
  // come in Costruisci: la sede in uso con le ore nelle altre sedi come ×, oppure tutte le sedi in un problema solo
  const view = withOtherSedi(data);
  const built = all ? buildInsieme(data) : null;
  const plan = all ? jointVersionPlan(slots.length) : [];
  const weights = all
    ? INSIEME_VERSIONI.filter((v) => plan.some((p) => p.key === v.key)).map((v) => ({ key: v.key, mixedW: v.mixedW }))
    : null;
  console.log(
    `Calcolo lungo: ${all ? `tutte le sedi insieme (${allSedi(data).map((x) => sedeName(x.data.settings)).join(", ")})` : `sede ${sedeName(data.settings)}`}, ` +
      `${mode === "improve" ? "migliora l’attuale" : "da zero"}, slot ${slots.join(", ")}, ` +
      `${durationText(minutes)}, ${args.workers} processi, corse da ${args.runSeconds} s.`,
  );
  if (all) console.log(`Versioni: ${plan.map((v) => v.short).join(", ")}.`);
  console.log(`Orario attuale: ${reportLine(evaluateCurrent(all ? built!.joint : view))}.`);

  const pool: Candidate[] = [];
  const jointPool: JointCandidate[] = [];
  let runs = 0;
  let complete = 0;
  let changed = false;
  const keep = <T extends Candidate | JointCandidate>(list: T[], c: T, cap: number) => {
    list.push(c);
    list.sort((a, b) => compareReports(a.report, b.report));
    if (list.length > cap) list.length = cap;
    changed = true;
  };

  const ordered = [...slots].sort((a, b) => a - b);
  /** Scrive le versioni migliori trovate finora; `null` se non ce n'è ancora nessuna completa. */
  const writeVersions = (): { lines: string[]; written: number } | null => {
    let out: PersistedData;
    let lines: string[];
    if (all) {
      const versions = pickJointVersions(jointPool, plan);
      if (versions.length === 0) return null;
      const placed = versions.map((v, i) => ({
        n: ordered[i]!,
        name: `Calcolo lungo ${i + 1} di ${versions.length} · ${INSIEME_VERSIONI.find((x) => x.key === v.versione)!.short}`,
        parts: v.parts,
      }));
      out = withJointVersions(data, placed);
      for (const p of placed) {
        for (const sede of allSedi(out)) {
          const saved = sede.data.savedTimetables?.find((s) => s.n === p.n);
          if (!saved || saved.lessons.length !== (p.parts[sede.id]?.lessons.length ?? -1) || !saved.calcoloLungo) {
            throw new Error(`slot ${p.n} non scritto in ${sedeName(sede.data.settings)}`);
          }
        }
      }
      lines = placed.map((p, i) => `- slot ${p.n} (tutte le sedi): «${p.name}» (${reportLine(versions[i]!.report)})`);
    } else {
      const versions = pickVersions(pool, slots.length);
      if (versions.length === 0) return null;
      const placed = versions.map((v, i) => ({ n: ordered[i]!, name: `Calcolo lungo ${i + 1} di ${versions.length}`, part: v.part }));
      out = withVersions(data, placed);
      for (const p of placed) {
        const saved = out.savedTimetables?.find((s) => s.n === p.n);
        if (!saved || saved.lessons.length !== p.part.lessons.length || !saved.calcoloLungo) throw new Error(`slot ${p.n} non scritto`);
      }
      lines = placed.map((p, i) => `- slot ${p.n}: «${p.name}» (${reportLine(versions[i]!.report)})`);
    }
    writeFileSync(args.out, backupJson(out));
    changed = false;
    return { lines, written: lines.length };
  };

  const workers: Worker[] = [];
  // fermato prima della fine (Ctrl+C, tempo massimo dell'assistente…): salva quello che c'è ed esce
  const stop = (signal: string) => {
    const done = pool.length || jointPool.length ? writeVersions() : null;
    console.log(
      done
        ? `\nFermato (${signal}) dopo ${runs} corse: ${done.written} versioni scritte in ${args.out}.`
        : `\nFermato (${signal}) dopo ${runs} corse: ancora nessuna versione completa, il backup non è stato scritto.`,
    );
    for (const l of done?.lines ?? []) console.log(l);
    for (const w of workers) void w.terminate();
    process.exit(done ? 0 : 1);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP", () => stop("SIGHUP"));
  const every = setInterval(() => {
    if (!changed) return;
    const done = writeVersions();
    if (done) console.log(`[${clock(Date.now() - start)}] salvate ${done.written} versioni in ${args.out}`);
  }, args.saveMinutes * 60_000);

  await new Promise<void>((resolve, reject) => {
    let open = args.workers;
    const seed0 = (start ^ Math.floor(Math.random() * 1e9)) >>> 0;
    for (let i = 0; i < args.workers; i++) {
      // ogni processo parte da una versione diversa, poi le alterna
      const rotated = weights ? [...weights.slice(i % weights.length), ...weights.slice(0, i % weights.length)] : null;
      const w = new Worker(bundle, {
        workerData: {
          data: all ? built!.joint : view,
          mode,
          runMs: args.runSeconds * 1000,
          deadline,
          seed: (seed0 + i * 104729) >>> 0,
          weights: rotated,
        } satisfies WorkerIn,
      });
      workers.push(w);
      w.on("message", (msg: WorkerOut) => {
        if (msg.type === "result") {
          runs += 1;
          let line: string;
          if (all) {
            const versione = INSIEME_VERSIONI.find((v) => v.key === msg.key)!;
            const c = jointCandidateOf(data, built!.map, mode, versione, msg.slots);
            if (isComplete(c.report)) complete += 1;
            // per versione: le 40 migliori
            keep(jointPool, c, 40 * INSIEME_VERSIONI.length);
            line = INSIEME_VERSIONI.filter((v) => weights!.some((x) => x.key === v.key))
              .map((v) => {
                const best = jointPool.find((x) => x.versione === v.key);
                return `${v.short}: ${best ? reportLine(best.report) : "—"}`;
              })
              .join("; ");
          } else {
            const c = candidateOf(view, mode, msg);
            if (isComplete(c.report)) complete += 1;
            keep(pool, c, 120);
            line = pool[0] ? reportLine(pool[0].report) : "—";
          }
          console.log(`[${clock(Date.now() - start)}] corse ${runs} (complete ${complete}); migliore: ${line}`);
        } else if (msg.type === "error") {
          reject(new Error(msg.message));
        }
      });
      w.on("error", reject);
      w.on("exit", () => {
        open -= 1;
        if (open === 0) resolve();
      });
    }
  }).finally(() => clearInterval(every));

  const done = writeVersions();
  if (!done) {
    console.error("Nessuna versione completa: il backup non è stato scritto.");
    process.exitCode = 1;
    return;
  }
  console.log(`\nCorse: ${runs}. Versioni scritte in ${args.out}:`);
  for (const l of done.lines) console.log(l);
  if (done.written < slots.length) {
    console.log(`Solo ${done.written} versioni diverse su ${slots.length}: gli slot rimasti non sono stati toccati.`);
  }
}

if (!isMainThread) workerLoop();
