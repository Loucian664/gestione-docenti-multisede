import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { AbsenceDialog } from "@/components/absence-dialog";
import { useAppStore, snapshot } from "@/lib/store";
import { officialData } from "@/lib/saved-timetables";
import { dayCoverage, isCovered, teacherName, teacherShort } from "@/lib/coverage";
import { allTeachers, findAnyTeacher } from "@/lib/replace-teacher";
import { substituteElsewhere } from "@/lib/sedi";
import { ABSENCE_REASONS, type Absence, type Period } from "@/lib/types";
import {
  formatDayMonth,
  formatItFileDate,
  formatMedium,
  formatMonthYear,
  monthRange,
  monthSchoolDays,
  sameMonth,
  shiftMonth,
  todayIso,
} from "@/lib/dates";
import { absencesRangeText, absencesRangeXlsx, assemblySummary, orarioDownloadName } from "@/lib/export";
import { shareOrSaveFile, toastSave, openPdfTab, copyText } from "@/lib/share-file";
import { textToPdf } from "@/lib/pdf";
import { ChevronLeft, ChevronRight, Plus, Download, FileText, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, countOf } from "@/lib/utils";

export const Route = createFileRoute("/assenze")({ component: AssenzePage });

const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

/** «1ª, 2ª e 3ª ora» dalle ore scelte, nell'ordine della campanella. */
function hoursText(ids: readonly string[], periods: readonly Period[]): string {
  const labels = periods.filter((p) => ids.includes(p.id)).map((p) => p.label);
  if (labels.length === 0) return "nessuna ora indicata";
  if (!labels.every((l) => / ora$/.test(l))) return labels.join(", ");
  const nums = labels.map((l) => l.replace(/ ora$/, ""));
  const list = nums.length === 1 ? nums[0] : `${nums.slice(0, -1).join(", ")} e ${nums[nums.length - 1]}`;
  return `${list} ora`;
}

function AssenzePage() {
  const store = useAppStore();
  // le assenze si coprono con l'orario in vigore (slot 0)
  const data = officialData(snapshot(store));
  const elsewhere = useMemo(() => substituteElsewhere(data), [data]);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Absence | null>(null);
  const [view, setView] = useState<"calendario" | "elenco">("calendario");
  const [monthIso, setMonthIso] = useState(data.selectedDate);
  // il primo tocco su un giorno ne mostra il riepilogo sotto il calendario, il secondo apre la bacheca; all'inizio
  // nessun giorno è scelto, così servono sempre due tocchi
  const [peek, setPeek] = useState<string | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const tapped = useRef<HTMLElement | null>(null);
  const [summaryMin, setSummaryMin] = useState(0);
  const initialRange = monthRange(data.selectedDate);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);

  /** Elimina subito; per 8 secondi «Annulla» rimette l'assenza e le sue coperture com'erano. */
  function removeWithUndo(a: Absence) {
    const removed = store.removeAbsence(a.id);
    if (!removed) return;
    const t = findAnyTeacher(data, a.teacherId);
    toast(`Assenza di ${t ? teacherName(t) : "un docente rimosso"} eliminata`, {
      duration: 8000,
      action: { label: "Annulla", onClick: () => store.restoreAbsence(removed) },
    });
  }

  const list = useMemo(
    () =>
      [...data.absences].sort((a, b) => b.dateFrom.localeCompare(a.dateFrom) || a.teacherId.localeCompare(b.teacherId)),
    [data.absences],
  );

  // sabato solo se è giorno di scuola (Impostazioni → «Includi il sabato»), domenica mai: più spazio per i nomi
  const withSaturday = data.settings.days.includes(6);
  const cells = useMemo(() => monthSchoolDays(monthIso, withSaturday), [monthIso, withSaturday]);
  const sintesi = useMemo(() => assemblySummary(data, data.selectedDate), [data]);
  const peekDay = peek ? dayCoverage(data, peek, elsewhere) : null;
  const peekRows = (peekDay?.absences ?? [])
    .map((a) => {
      const t = findAnyTeacher(data, a.teacherId);
      const needs = (peekDay?.needs ?? []).filter((n) => n.absence.id === a.id);
      const covered = needs.filter(isCovered).length;
      return { a, name: t ? teacherName(t) : "Docente rimosso", hours: needs.length, covered };
    })
    .sort((x, y) => x.name.localeCompare(y.name, "it"));

  // Il riepilogo sta sotto il calendario. Due cose perché la pagina stia ferma mentre si toccano i giorni:
  // - il suo spazio non si accorcia mai: passando a un giorno con meno assenti la pagina resterebbe più corta e il
  //   telefono la farebbe scendere;
  // - dopo un tocco, se l'inizio del riepilogo (sempre gli stessi 160 px, non la sua altezza) è fuori dallo schermo,
  //   la pagina sale quanto basta, ma non oltre il giorno toccato, che deve restare a portata per il secondo tocco.
  //   Dal secondo giorno in poi di solito è già in vista e non si muove niente.
  useLayoutEffect(() => {
    const box = summaryRef.current;
    if (!box) return;
    setSummaryMin((m) => Math.max(m, box.offsetHeight));
    const day = tapped.current;
    tapped.current = null;
    if (!day) return;
    const nav = document.querySelector<HTMLElement>("nav.fixed"); // barra in basso del telefono
    const bottom = window.innerHeight - (nav?.offsetHeight ?? 0);
    const want = box.getBoundingClientRect().top + 160 + 12 - bottom;
    const room = day.getBoundingClientRect().top - 12;
    const by = Math.min(want, room);
    // sotto i 24 px non vale la pena: sarebbero piccoli scatti a ogni tocco
    if (by > 24) window.scrollBy({ top: by, behavior: "smooth" });
  }, [peek]);

  return (
    <div>
      <PageHeader
        title="Assenze e supplenze"
        description="Calendario delle assenze e delle ore coperte. Tocca un giorno per vederne il riepilogo, toccalo di nuovo per aprirne la bacheca."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus />
            Nuova assenza
          </Button>
        }
      />

      <div className="paper-panel mb-4 flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ass-from">Dal</Label>
          <Input id="ass-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ass-to">Al</Label>
          <Input id="ass-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void shareOrSaveFile(absencesRangeXlsx(data, from, to)).then((outcome) =>
              toastSave(outcome, "excel"),
            );
          }}
        >
          <Download />
          Excel
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const tab = openPdfTab();
            void (async () => {
              try {
                const text = absencesRangeText(data, from, to);
                const blob = textToPdf(text);
                toastSave(tab.show(orarioDownloadName(data.settings.schoolName, `assenze-${formatItFileDate(from)}-${formatItFileDate(to)}`, "pdf"), blob), "pdf");
              } catch {
                tab.cancel();
                toast.error("Non sono riuscito a creare il PDF.");
              }
            })();
          }}
        >
          <FileText />
          PDF
        </Button>
        {sintesi && (
          <Button
            variant="outline"
            onClick={() => {
              void copyText(sintesi).then((ok) => toastSave(ok ? "copied" : "failed", "copy"));
            }}
          >
            <Copy />
            Sintesi
          </Button>
        )}
        <p className="text-[12px] text-muted-foreground sm:max-w-xs">
          Excel: una riga per ogni ora, con data, docente assente, materia, sostituto, tipo e stato della copertura.
          {sintesi ? " Sintesi: copia il riepilogo dell’assemblea sindacale per il dirigente." : ""}
        </p>
      </div>

      <Tabs
        className="mb-4 sm:max-w-sm"
        value={view}
        onValueChange={(v) => setView(v as "calendario" | "elenco")}
        items={[
          { value: "calendario", label: "Calendario" },
          { value: "elenco", label: "Elenco" },
        ]}
      />

      {view === "calendario" && (
        <div className="paper-panel rounded-xl p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Mese precedente"
              onClick={() => setMonthIso(shiftMonth(monthIso, -1))}
            >
              <ChevronLeft />
            </Button>
            <p className="font-display text-xl capitalize">{formatMonthYear(monthIso)}</p>
            <Button
              variant="outline"
              size="icon"
              aria-label="Mese successivo"
              onClick={() => setMonthIso(shiftMonth(monthIso, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className={cn("grid gap-1", withSaturday ? "grid-cols-6" : "grid-cols-5")}>
            {WEEKDAYS.slice(0, withSaturday ? 6 : 5).map((d) => (
              <div key={d} className="px-1.5 py-1 text-[11px] font-medium text-muted-foreground sm:px-2">
                {d}
              </div>
            ))}
            {cells.map((iso) => {
              const inMonth = sameMonth(iso, monthIso);
              const summary = dayCoverage(data, iso, elsewhere);
              const selected = iso === peek;
              const today = iso === todayIso();
              const names = summary.absences
                .map((a) => findAnyTeacher(data, a.teacherId))
                .filter((t): t is NonNullable<typeof t> => Boolean(t))
                .map((t) => teacherShort(t, allTeachers(data)));
              const tone =
                summary.needs.length === 0
                  ? "idle"
                  : summary.uncovered === 0 && summary.doubled === 0
                    ? "ok"
                    : summary.covered === 0
                      ? "warn"
                      : "partial";
              return (
                <button
                  key={iso}
                  type="button"
                  aria-label={selected ? `${formatDayMonth(iso)}: apri la bacheca` : undefined}
                  onClick={(e) => {
                    if (selected) {
                      store.setSelectedDate(iso);
                      void navigate({ to: "/" });
                      return;
                    }
                    tapped.current = e.currentTarget;
                    setPeek(iso);
                  }}
                  className={cn(
                    "flex min-h-[4.75rem] flex-col rounded-lg px-1.5 py-1.5 text-left sm:min-h-[5.5rem] sm:px-2",
                    !inMonth && "opacity-40",
                    tone === "ok" && "bg-success-soft",
                    tone === "warn" && "bg-danger-soft",
                    tone === "partial" && "bg-warning-soft",
                    selected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                  )}
                >
                  <span
                    className={cn(
                      "text-[12px] font-medium tabular-nums",
                      today && "text-primary",
                    )}
                  >
                    {iso.slice(-2).replace(/^0/, "")}
                  </span>
                  {names.length > 0 && (
                    <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-foreground sm:text-[11px]">
                      {names.slice(0, 2).join(" · ")}
                      {names.length > 2 ? ` +${names.length - 2}` : ""}
                    </span>
                  )}
                  {summary.needs.length > 0 && (
                    <span
                      className={cn(
                        "mt-auto pt-1 text-[10px] font-medium tabular-nums",
                        tone === "ok" ? "text-success" : "text-destructive",
                      )}
                    >
                      {summary.uncovered === 0
                        ? `${summary.covered} cop.`
                        : `${summary.uncovered} scop.`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-success-soft ring-1 ring-border" /> Tutto coperto
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-warning-soft ring-1 ring-border" /> Parziale
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-danger-soft ring-1 ring-border" /> Scoperto
            </li>
          </ul>
          <section
            ref={summaryRef}
            aria-live="polite"
            className="mt-4 border-t border-border pt-4"
            style={{ minHeight: summaryMin || undefined }}
          >
            {peek && peekDay ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="font-display text-lg first-letter:uppercase">{formatDayMonth(peek)}</h2>
                  {peekRows.length > 0 && (
                    <p
                      className={cn(
                        "text-[13px] font-medium",
                        peekDay.needs.length === 0
                          ? "text-muted-foreground"
                          : peekDay.uncovered > 0 || peekDay.doubled > 0
                            ? "text-destructive"
                            : "text-success",
                      )}
                    >
                      {peekDay.needs.length === 0
                        ? "Nessuna ora da coprire"
                        : peekDay.uncovered > 0
                          ? `${peekDay.uncovered} ${peekDay.uncovered === 1 ? "ora scoperta" : "ore scoperte"} su ${peekDay.needs.length}`
                          : peekDay.doubled > 0
                            ? `${countOf(peekDay.doubled, "ora", "ore")} con doppio incarico`
                            : peekDay.needs.length === 1
                              ? "1 ora, coperta"
                              : `${peekDay.needs.length} ore, tutte coperte`}
                    </p>
                  )}
                </div>
                {peekRows.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">Nessuna assenza.</p>
                ) : (
                  <ul className="mt-1 flex flex-col divide-y divide-border/70">
                    {peekRows.map(({ a, name, hours, covered }) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{name}</p>
                          <p className="text-[12px] text-muted-foreground">
                            {ABSENCE_REASONS.find((r) => r.value === a.reason)?.label ?? "Assenza"}
                            {" · "}
                            {a.allDay ? "tutto il giorno" : hoursText(a.periodIds, data.settings.periods)}
                            {a.dateFrom !== a.dateTo ? ` · dal ${formatMedium(a.dateFrom)} al ${formatMedium(a.dateTo)}` : ""}
                          </p>
                          {a.notes && <p className="line-clamp-2 text-[12px] text-muted-foreground">{a.notes}</p>}
                        </div>
                        {/* con un solo assente il conto è già in alto, accanto alla data */}
                        {peekRows.length > 1 && (
                          <p
                            className={cn(
                              "shrink-0 text-right text-[12px] font-medium tabular-nums",
                              hours === 0 ? "text-muted-foreground" : covered === hours ? "text-success" : "text-destructive",
                            )}
                          >
                            {hours === 0
                              ? "nessuna ora da coprire"
                              : covered === hours
                                ? countOf(hours, "ora coperta", "ore coperte")
                                : `${hours - covered} ${hours - covered === 1 ? "scoperta" : "scoperte"} su ${hours}`}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[12px] text-muted-foreground">Tocca di nuovo il giorno per aprirne la bacheca.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Tocca un giorno per vederne qui il riepilogo; toccalo di nuovo per aprirne la bacheca.
              </p>
            )}
          </section>
        </div>
      )}

      {view === "elenco" &&
        (list.length === 0 ? (
          <div className="paper-panel rounded-xl px-6 py-12 text-center">
            <p className="font-display text-xl">Nessuna assenza</p>
            <p className="mt-1 text-sm text-muted-foreground">Le assenze registrate compariranno qui.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((a) => {
              const t = findAnyTeacher(data, a.teacherId);
              const reason = ABSENCE_REASONS.find((r) => r.value === a.reason)?.label;
              return (
                <li key={a.id} className="paper-panel flex items-center gap-1 rounded-xl pr-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(a);
                      setOpen(true);
                    }}
                    className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl py-3 pl-4 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{t ? teacherName(t) : "Docente rimosso"}</p>
                      <p className="text-[13px] text-muted-foreground">
                        {formatMedium(a.dateFrom)}
                        {a.dateFrom !== a.dateTo ? ` – ${formatMedium(a.dateTo)}` : ""}
                        {a.notes ? ` · ${a.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{a.allDay ? "Giornata" : countOf(a.periodIds.length, "ora", "ore")}</Badge>
                      <Badge variant="warning">{reason}</Badge>
                    </div>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Elimina"
                    className="shrink-0 text-destructive/80 hover:bg-danger-soft hover:text-destructive"
                    onClick={() => removeWithUndo(a)}
                  >
                    <Trash2 className="sm:hidden" aria-hidden />
                    <span className="hidden sm:inline">Elimina</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ))}

      <AbsenceDialog
        key={editing?.id ?? "new"}
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
        initial={editing}
      />
    </div>
  );
}
