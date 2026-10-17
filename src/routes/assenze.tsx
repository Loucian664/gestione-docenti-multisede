import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { AbsenceDialog } from "@/components/absence-dialog";
import { useAppStore, snapshot } from "@/lib/store";
import { officialData } from "@/lib/saved-timetables";
import { dayCoverage, teacherName, teacherShort } from "@/lib/coverage";
import { ABSENCE_REASONS, type Absence } from "@/lib/types";
import {
  formatItFileDate,
  formatMedium,
  formatMonthYear,
  monthRange,
  monthSchoolDays,
  sameMonth,
  shiftMonth,
  todayIso,
} from "@/lib/dates";
import { absencesRangeText, absencesRangeXlsx, assemblySummary } from "@/lib/export";
import { shareOrSaveFile, toastSave, openPdfTab, copyText } from "@/lib/share-file";
import { textToPdf } from "@/lib/pdf";
import { ChevronLeft, ChevronRight, Plus, Download, FileText, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assenze")({ component: AssenzePage });

const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function AssenzePage() {
  const store = useAppStore();
  // le assenze si coprono con l'orario in vigore (slot 0)
  const data = officialData(snapshot(store));
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Absence | null>(null);
  const [view, setView] = useState<"calendario" | "elenco">("calendario");
  const [monthIso, setMonthIso] = useState(data.selectedDate);
  const initialRange = monthRange(data.selectedDate);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);

  /** Elimina subito; per 8 secondi «Annulla» rimette l'assenza e le sue coperture com'erano. */
  function removeWithUndo(a: Absence) {
    const removed = store.removeAbsence(a.id);
    if (!removed) return;
    const t = data.teachers.find((x) => x.id === a.teacherId);
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

  return (
    <div>
      <PageHeader
        title="Assenze e supplenze"
        description="Calendario delle assenze e delle ore coperte. Seleziona un giorno per aprirne la bacheca."
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
                toastSave(tab.show(`assenze-${formatItFileDate(from)}-${formatItFileDate(to)}.pdf`, blob), "pdf");
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
              <div key={d} className="px-1 py-1 text-center text-[11px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {cells.map((iso) => {
              const inMonth = sameMonth(iso, monthIso);
              const summary = dayCoverage(data, iso);
              const selected = iso === data.selectedDate;
              const today = iso === todayIso();
              const names = summary.absences
                .map((a) => data.teachers.find((t) => t.id === a.teacherId))
                .filter((t): t is NonNullable<typeof t> => Boolean(t))
                .map((t) => teacherShort(t, data.teachers));
              const tone =
                summary.needs.length === 0
                  ? "idle"
                  : summary.uncovered === 0
                    ? "ok"
                    : summary.covered === 0
                      ? "warn"
                      : "partial";
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    store.setSelectedDate(iso);
                    void navigate({ to: "/" });
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
              const t = data.teachers.find((x) => x.id === a.teacherId);
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
                      <Badge variant="outline">{a.allDay ? "Giornata" : `${a.periodIds.length} ore`}</Badge>
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
