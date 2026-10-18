import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ScrollGrid } from "@/components/scroll-grid";
import { NativeSelect } from "@/components/ui/native-select";
import { classCellSlots, teacherName, teacherShort } from "@/lib/coverage";
import { isTimetableTeacher } from "@/lib/build-timetable";
import { isRestrictedTpPeriod, visiblePeriods } from "@/lib/periods";
import { righeSedi, type VistaSede } from "@/lib/sedi-insieme";
import { weekCellLines } from "@/lib/sheet-image";
import { teacherCell, teacherDotColor } from "@/lib/teacher-palette";
import { DAY_SHORT, type DayOfWeek, type SchoolClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Vista generale: l'orario di tutte le sedi insieme, in sola lettura. Serve per la proposta di «Tutte le
 * sedi insieme» in Costruisci e, in Orario, per Quadro e Settimana con «Tutte le sedi».
 */

const STICKY_COL =
  "sticky left-0 z-10 bg-card group-data-[scrolled=true]:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.28)]";

const classSort = (a: SchoolClass, b: SchoolClass) => a.grade - b.grade || a.section.localeCompare(b.section);

/** Le ore delle righe: quelle della prima sede (le sedi insieme hanno le stesse ore), per numero. */
function rowPeriods(sedi: VistaSede[]) {
  const first = sedi[0];
  return first ? visiblePeriods(first.data.settings) : [];
}

/** Vista Giorno: larghezza minima di una classe e della colonna delle ore, in px. */
const DAY_COL_W = 100;
const DAY_HOUR_W = 96;

/** La larghezza del contenitore, aggiornata quando cambia (finestra, telefono girato). */
function useWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1100 : Math.max(320, window.innerWidth - 64)));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(1, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Un giorno, tutte le classi di tutte le sedi: le sedi affiancate su più file, quante ne servono perché ogni
 * fila stia nello schermo (una sede troppo larga sta da sola nella sua fila e scorre di lato).
 */
export function GiornoGenerale({ sedi, day }: { sedi: VistaSede[]; day: DayOfWeek }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const periods = rowPeriods(sedi);
  const cols = sedi.map((s) => ({ s, classes: [...s.data.classes].sort(classSort) }));
  const sizes = cols.map((c) => Math.max(1, c.classes.length));
  const cap = Math.max(1, Math.floor((width - DAY_HOUR_W) / DAY_COL_W));
  const rows = righeSedi(sizes, cap);
  // la stessa larghezza delle classi in tutte le file: la fila più larga occupa lo schermo
  const widest = Math.max(1, ...rows.map((r) => r.reduce((n, i) => n + sizes[i]!, 0)));
  const colW = Math.max(DAY_COL_W, Math.floor((width - DAY_HOUR_W) / Math.min(widest, cap)));
  return (
    <div ref={box} className="flex w-full min-w-0 flex-col gap-4">
      {rows.map((row) => {
        const band = row.map((i) => cols[i]!);
        const total = row.reduce((n, i) => n + sizes[i]!, 0);
        const tableW = DAY_HOUR_W + total * colW;
        return (
          <div key={band.map((c) => c.s.id).join("|")} style={{ maxWidth: `${tableW}px` }}>
            <ScrollGrid unit={["Classe", "Classi"]} columns="thead tr:nth-child(2) > th">
              <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: `${DAY_HOUR_W + total * DAY_COL_W}px` }}>
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground">
                    <th className={cn(STICKY_COL, "w-24 px-3 pt-2 font-medium")} rowSpan={2}>
                      Ora
                    </th>
                    {band.map(({ s, classes }) => (
                      <th
                        key={s.id}
                        colSpan={Math.max(1, classes.length)}
                        className="border-l border-border px-2 pt-2 font-display text-[14px] font-medium text-foreground"
                      >
                        {s.name}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                    {band.map(({ s, classes }) =>
                      classes.length ? (
                        classes.map((c, i) => (
                          <th key={`${s.id}-${c.id}`} className={cn("px-2 py-1.5 font-medium", i === 0 && "border-l border-border")}>
                            {c.name}
                          </th>
                        ))
                      ) : (
                        <th key={`${s.id}-vuota`} className="border-l border-border px-2 py-1.5 font-normal">
                          nessuna classe
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className={cn(STICKY_COL, "px-3 py-2 align-top")}>
                        <div className="text-[13px] font-medium">{p.label}</div>
                        <div className="text-[11px] text-ink-faint">
                          {p.start}–{p.end}
                        </div>
                      </td>
                      {band.map(({ s, classes }) => {
                        const sp = s.data.settings.periods.find((x) => x.index === p.index);
                        if (!classes.length) return <td key={`${s.id}-vuota`} className="border-l border-border" />;
                        return classes.map((c, i) => {
                          const allowed = sp && (!isRestrictedTpPeriod(sp) || c.tempo === "TP");
                          const first = i === 0 && "border-l border-border";
                          if (!sp || !allowed)
                            return <td key={`${s.id}-${c.id}`} className={cn("bg-muted/40 p-1 align-top", first)} />;
                          const occupants = classCellSlots(s.data, c.id, day, sp.id);
                          const t = occupants[0] ? s.data.teachers.find((x) => x.id === occupants[0]!.teacherId) : null;
                          const tc = teacherCell(t?.color);
                          return (
                            <td key={`${s.id}-${c.id}`} className={cn("p-1 align-top", first)}>
                              <div
                                className={cn("flex min-h-[4.25rem] w-full flex-col rounded-md px-2 py-1.5", tc.className)}
                                style={tc.style}
                              >
                                {occupants.length === 0 ? (
                                  <span className="text-[11px] text-ink-faint">—</span>
                                ) : (
                                  occupants.map((x, k) => {
                                    const doc = s.data.teachers.find((y) => y.id === x.teacherId);
                                    return (
                                      <span key={x.id} className={cn("flex flex-col leading-tight", k > 0 && "mt-1")}>
                                        <span className="text-[12px] font-medium">
                                          {doc ? teacherShort(doc, s.data.teachers) : ""}
                                        </span>
                                        <span className={cn("text-[11px]", tc.text2)}>
                                          {x.subject}
                                          {k > 0 ? " · compr." : ""}
                                        </span>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                            </td>
                          );
                        });
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollGrid>
          </div>
        );
      })}
    </div>
  );
}

/** Tutta la settimana di tutte le classi, una sede dopo l'altra. */
export function SettimanaGenerale({ sedi }: { sedi: VistaSede[] }) {
  return (
    <div className="flex flex-col gap-5">
      {sedi.map((s) => (
        <section key={s.id}>
          <h3 className="mb-2 font-display text-lg">{s.name}</h3>
          {s.data.classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna classe.</p>
          ) : (
            <ScrollGrid unit={["Giorno", "Giorni"]}>
              <table className="w-full min-w-[720px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className={cn(STICKY_COL, "w-20 px-3 py-2 font-medium")}>Classe</th>
                    {s.data.settings.days.map((d) => (
                      <th key={d} className="px-2 py-2 font-medium text-foreground">
                        {DAY_SHORT[d]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...s.data.classes].sort(classSort).map((c) => (
                    <tr key={c.id} className="border-b border-border align-top last:border-0">
                      <td className={cn(STICKY_COL, "px-3 py-2")}>
                        <div className="text-[13px] font-medium">{c.name}</div>
                        <div className="text-[10px] tracking-wide text-ink-faint">{c.tempo}</div>
                      </td>
                      {s.data.settings.days.map((d) => (
                        <td key={d} className="px-2 py-2 text-[11px] leading-[1.35] font-normal">
                          {weekCellLines(s.data, c.id, d).map((line, i) => (
                            <div key={i} className={line.teacher ? "text-foreground" : "text-ink-faint"}>
                              {line.teacher ? (
                                <>
                                  {line.mark} {line.subject} <span className="font-semibold">{line.teacher}</span>
                                </>
                              ) : line.subject === "Mensa" ? (
                                "Mensa"
                              ) : (
                                `${line.mark}  —`
                              )}
                            </div>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollGrid>
          )}
        </section>
      ))}
    </div>
  );
}

type PersonLesson = { sede: string; day: DayOfWeek; index: number; label: string };

/** La settimana di ogni docente in tutte le sedi; per chi è in più sedi ogni ora ha il nome della sede. */
export function DocentiGenerale({ sedi }: { sedi: VistaSede[] }) {
  const [onlyShared, setOnlyShared] = useState(false);
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; color: string; sedi: Set<string>; lessons: PersonLesson[] }>();
    for (const s of sedi) {
      const idx = new Map(s.data.settings.periods.map((p) => [p.id, p.index]));
      for (const t of s.data.teachers.filter(isTimetableTeacher)) {
        const key = t.personId ? `p:${t.personId}` : `t:${s.id}:${t.id}`;
        const row = map.get(key) ?? { key, name: teacherName(t), color: t.color, sedi: new Set<string>(), lessons: [] };
        row.sedi.add(s.id);
        for (const x of s.data.slots.filter((y) => y.teacherId === t.id)) {
          row.lessons.push({
            sede: s.name,
            day: x.day,
            index: idx.get(x.periodId) ?? 0,
            label: s.data.classes.find((c) => c.id === x.classId)?.name.replace("ª ", "") ?? "",
          });
        }
        map.set(key, row);
      }
    }
    return [...map.values()]
      .filter((r) => r.lessons.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [sedi]);
  const shown = onlyShared ? rows.filter((r) => r.sedi.size > 1) : rows;
  const days = sedi[0]?.data.settings.days ?? [];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        <label className="flex min-h-9 items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={onlyShared}
            onChange={(e) => setOnlyShared(e.target.checked)}
          />
          Solo i docenti in più sedi
        </label>
      </div>
      <ScrollGrid unit={["Giorno", "Giorni"]}>
        <table className="w-full min-w-[760px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className={cn(STICKY_COL, "w-44 px-3 py-2 font-medium")}>Docente</th>
              {days.map((d) => (
                <th key={d} className="px-2 py-2 font-medium text-foreground">
                  {DAY_SHORT[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const multi = r.sedi.size > 1;
              return (
                <tr key={r.key} className="border-b border-border align-top last:border-0">
                  <td className={cn(STICKY_COL, "px-3 py-2")}>
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: teacherDotColor(r.color) }} />
                      {r.name}
                    </div>
                    {multi && (
                      <div className="pl-4.5 text-[11px] text-muted-foreground">
                        {sedi
                          .filter((s) => r.sedi.has(s.id))
                          .map((s) => s.name)
                          .join(" + ")}
                      </div>
                    )}
                  </td>
                  {days.map((d) => {
                    const today = r.lessons.filter((x) => x.day === d).sort((a, b) => a.index - b.index);
                    return (
                      <td key={d} className="px-2 py-2 text-[11px] leading-[1.35]">
                        {today.length === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          today.map((x, i) => (
                            <div key={i}>
                              {x.index}ª {x.label}
                              {multi && <span className="text-muted-foreground"> · {x.sede}</span>}
                            </div>
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollGrid>
    </div>
  );
}

/** La settimana di una classe di qualsiasi sede. */
export function ClasseGenerale({ sedi }: { sedi: VistaSede[] }) {
  const first = sedi.find((s) => s.data.classes.length);
  const [pick, setPick] = useState(first ? `${first.id}|${[...first.data.classes].sort(classSort)[0]!.id}` : "");
  const [sedeId, classId] = pick.split("|");
  const s = sedi.find((x) => x.id === sedeId);
  const cls = s?.data.classes.find((c) => c.id === classId);
  return (
    <div>
      <NativeSelect className="mb-3 sm:max-w-xs" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Classe">
        {sedi.map((x) => (
          <optgroup key={x.id} label={x.name}>
            {[...x.data.classes].sort(classSort).map((c) => (
              <option key={c.id} value={`${x.id}|${c.id}`}>
                {c.name} ({c.tempo})
              </option>
            ))}
          </optgroup>
        ))}
      </NativeSelect>
      {s && cls && (
        <ScrollGrid unit={["Giorno", "Giorni"]}>
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className={cn(STICKY_COL, "w-24 px-3 py-2 font-medium")}>Ora</th>
                {s.data.settings.days.map((d) => (
                  <th key={d} className="px-2 py-2 font-medium">
                    {DAY_SHORT[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePeriods(s.data.settings, cls.tempo).map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={cn(STICKY_COL, "px-3 py-2 align-top")}>
                    <div className="text-[13px] font-medium">{p.label}</div>
                    <div className="text-[11px] text-ink-faint">
                      {p.start}–{p.end}
                    </div>
                  </td>
                  {s.data.settings.days.map((d) => {
                    const occupants = classCellSlots(s.data, cls.id, d, p.id);
                    const t = occupants[0] ? s.data.teachers.find((x) => x.id === occupants[0]!.teacherId) : null;
                    const tc = teacherCell(t?.color);
                    return (
                      <td key={d} className="p-1.5 align-top">
                        <div className={cn("flex min-h-16 w-full flex-col rounded-md px-2 py-1.5", tc.className)} style={tc.style}>
                          {occupants.length === 0 ? (
                            <span className="text-[12px] text-ink-faint">Vuoto</span>
                          ) : (
                            occupants.map((x, k) => {
                              const doc = s.data.teachers.find((y) => y.id === x.teacherId);
                              return (
                                <span key={x.id} className={cn("flex flex-col leading-tight", k > 0 && "mt-1")}>
                                  <span className="text-[13px] font-medium">{x.subject}</span>
                                  <span className={cn("text-[12px]", tc.text2)}>
                                    {doc ? teacherShort(doc, s.data.teachers) : ""}
                                    {k > 0 ? " · compr." : ""}
                                  </span>
                                </span>
                              );
                            })
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollGrid>
      )}
    </div>
  );
}
