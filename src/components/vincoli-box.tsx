import { useState } from "react";
import { teacherName, teacherShort } from "@/lib/coverage";
import type { Issue, TimetableReport } from "@/lib/timetable-solver";
import { DAY_SHORT, type DayOfWeek, type PersistedData } from "@/lib/types";
import { cn } from "@/lib/utils";

type HardKey = keyof TimetableReport["hard"];

/** I vincoli rigidi, uno per tipo, in parole semplici. */
const HARD_INFO: Record<HardKey, string> = {
  conflicts: "Docente in due classi alla stessa ora",
  away: "Lezione in un’ora segnata × (o a disposizione)",
  travel: "Manca l’ora libera per spostarsi tra due sedi",
  shuttle: "Più di un cambio di sede nello stesso giorno (andata e ritorno)",
  no: "Lezione in un’ora «no» del docente",
  longGaps: "Più ore libere tra le lezioni di quante il docente ne accetti",
  rientro: "Nei giorni di rientro le lezioni del mattino cominciano dalla 4ª ora",
  must: "Obbligo di classe non rispettato",
  holes: "Classe con un’ora vuota tra due lezioni",
  pattern: "Ore al giorno diverse da quelle scelte per il docente",
  dispRoom: "Ore a disposizione senza un’ora libera nella loro sede",
};

/** I vincoli rigidi non rispettati, per tipo. */
function hardGroups(r: TimetableReport): { key: HardKey; title: string; items: Issue[] }[] {
  return (Object.keys(HARD_INFO) as HardKey[])
    .map((key) => ({ key, title: HARD_INFO[key], items: r.hard[key] ?? [] }))
    .filter((g) => g.items.length > 0);
}

type MiniCell = { text: string; sub?: string; kind: "lesson" | "disp" | "away" | "free" };

type MiniWeek = {
  title: string;
  days: DayOfWeek[];
  rows: { id: string; label: string }[];
  cell: (day: DayOfWeek, periodId: string) => MiniCell;
  marked: Set<string>;
};

/** La settimana del docente (o della classe) di un vincolo, con le ore del vincolo da evidenziare. */
function miniWeekOf(data: PersistedData, issue: Issue): MiniWeek | null {
  const cells = issue.cells ?? [];
  const teacherId = issue.teacherId ?? cells.find((c) => c.teacherId)?.teacherId;
  const teacher = teacherId ? data.teachers.find((t) => t.id === teacherId) : undefined;
  const classId = teacher ? undefined : cells.find((c) => c.classId)?.classId;
  const cls = classId ? data.classes.find((c) => c.id === classId) : undefined;
  if (!teacher && !cls) return null;
  const marked = new Set(
    cells
      .filter((c) => (teacher ? c.teacherId === teacher.id : c.classId === cls!.id))
      .map((c) => `${c.day}|${c.periodId}`),
  );
  const mine = data.slots.filter((s) => (teacher ? s.teacherId === teacher.id : s.classId === cls!.id));
  const used = new Set([...mine.map((s) => s.periodId), ...[...marked].map((k) => k.split("|")[1]!)]);
  const rows = [...data.settings.periods]
    .sort((a, b) => a.index - b.index)
    .filter((p) => !p.tpOnly || used.has(p.id))
    .map((p) => ({ id: p.id, label: p.label.replace(" ora", "") }));
  const has = (list: { day: DayOfWeek; periodId: string }[] | undefined, day: DayOfWeek, periodId: string) =>
    (list ?? []).some((a) => a.day === day && a.periodId === periodId);
  const cell = (day: DayOfWeek, periodId: string): MiniCell => {
    const here = mine.filter((s) => s.day === day && s.periodId === periodId);
    if (here.length) {
      if (teacher)
        return {
          kind: "lesson",
          text: here.map((s) => data.classes.find((c) => c.id === s.classId)?.name ?? "").join(" + "),
          sub: here[0]!.subject,
        };
      const doc = data.teachers.find((t) => t.id === here[0]!.teacherId);
      return { kind: "lesson", text: here[0]!.subject, sub: doc ? teacherShort(doc, data.teachers) : "" };
    }
    if (teacher && has(teacher.dispSlots, day, periodId)) return { kind: "disp", text: "disp." };
    if (teacher && has(teacher.awaySlots, day, periodId)) return { kind: "away", text: "×" };
    return { kind: "free", text: "—" };
  };
  return {
    title: teacher ? teacherName(teacher) : cls!.name,
    days: [...data.settings.days].sort((a, b) => a - b),
    rows,
    cell,
    marked,
  };
}

function MiniWeekGrid({ week }: { week: MiniWeek }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card">
      <p className="px-2.5 pt-2 text-[12px] font-medium">{week.title}</p>
      <table className="w-full min-w-[420px] border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="w-12 px-2 py-1 font-medium" />
            {week.days.map((d) => (
              <th key={d} className="px-1 py-1 font-medium">
                {DAY_SHORT[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {week.rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-2 py-1 text-muted-foreground">{r.label}</td>
              {week.days.map((d) => {
                const c = week.cell(d, r.id);
                const hit = week.marked.has(`${d}|${r.id}`);
                return (
                  <td key={d} className="p-0.5 align-top">
                    <div
                      className={cn(
                        "min-h-8 rounded px-1.5 py-1 leading-tight",
                        c.kind === "lesson" ? "bg-muted text-foreground" : "text-ink-faint",
                        hit && "bg-danger-soft font-semibold text-destructive ring-2 ring-inset ring-destructive",
                      )}
                    >
                      <div className="truncate">{c.text}</div>
                      {c.sub && <div className="truncate text-[10px] font-normal opacity-80">{c.sub}</div>}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * «Da sistemare»: i vincoli rigidi che l'orario non rispetta, per tipo e in parole semplici. Toccando una voce
 * si apre la settimana del docente o della classe, con le ore del vincolo evidenziate in rosso.
 */
export function HardIssuesBox({
  report,
  data,
  hint,
  className,
}: {
  report: TimetableReport;
  /** l'orario a cui si riferiscono le voci (per la settimana del docente o della classe) */
  data: PersistedData | null;
  hint: string;
  className?: string;
}) {
  const groups = hardGroups(report);
  const [open, setOpen] = useState<string | null>(null);
  if (!groups.length) return null;
  return (
    <div className={cn("rounded-xl border border-destructive/25 bg-danger-soft px-4 py-3 text-sm", className)}>
      <p className="font-medium text-destructive">Da sistemare</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {hint} {data ? "Tocca una voce per vedere dove." : ""}
      </p>
      {groups.map((g) => (
        <div key={g.key} className="mt-2.5">
          <p className="text-[13px] font-medium">{g.title}</p>
          <ul className="mt-1 grid gap-1.5">
            {g.items.map((it, i) => {
              const id = `${g.key}-${i}`;
              const week = data && open === id ? miniWeekOf(data, it) : null;
              const canShow = Boolean(data && (it.teacherId || it.cells?.length));
              return (
                <li key={id}>
                  {canShow ? (
                    <button
                      type="button"
                      className="min-h-8 text-left text-[13px] underline decoration-destructive/40 underline-offset-4 hover:decoration-destructive"
                      aria-expanded={open === id}
                      onClick={() => setOpen(open === id ? null : id)}
                    >
                      {it.text}
                    </button>
                  ) : (
                    <span className="text-[13px]">{it.text}</span>
                  )}
                  {week && <MiniWeekGrid week={week} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
