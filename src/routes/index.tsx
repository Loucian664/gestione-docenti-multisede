import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ListChecks,
  UserPlus,
  ExternalLink,
  Share2,
  Images as ImageIcon,
  FileText,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout";
import { AbsenceDialog } from "@/components/absence-dialog";
import { AssignSheet } from "@/components/assign-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore, snapshot } from "@/lib/store";
import { officialData } from "@/lib/saved-timetables";
import {
  autoAssignPlan,
  classShifts,
  coverageNeeds,
  dayCoverage,
  isCovered,
  isShiftType,
  teacherName,
  teacherShort,
  type ClassShift,
  type CoverageNeed,
} from "@/lib/coverage";
import { allTeachers, findAnyTeacher } from "@/lib/replace-teacher";
import { dailySheetCopyPlain, dailySheetHeading, dailySheetHtml, dailySheetText, substitutionsXlsx } from "@/lib/export";
import { copyText, shareOrSaveFile, shareJpeg, toastSave, openPdfTab } from "@/lib/share-file";
import { textToPdf } from "@/lib/pdf";
import { bachecaJpeg } from "@/lib/sheet-image";
import { formatDayMonth, formatLong, isWeekend, shiftSchoolDay, weekDaysIso, toSchoolDay, todayIso } from "@/lib/dates";
import { ABSENCE_REASONS, DAY_SHORT, SUBSTITUTION_TYPES } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: OggiPage });

function OggiPage() {
  const store = useAppStore();
  // Oggi e le sostituzioni usano sempre l'orario in vigore (slot 0)
  const data = officialData(snapshot(store));
  const date = store.selectedDate;
  const weekend = isWeekend(date, data.settings.days);
  const needs = useMemo(() => coverageNeeds(data, date), [data, date]);
  const absences = useMemo(
    () => data.absences.filter((a) => a.dateFrom <= date && a.dateTo >= date),
    [data.absences, date],
  );
  const shifts = useMemo(() => classShifts(data, date), [data, date]);
  const varied = needs.filter((n) => isShiftType(n.substitution?.type)).length;
  const covered = needs.filter((n) => isCovered(n) && !isShiftType(n.substitution?.type)).length;
  const uncovered = needs.length - covered - varied;

  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [assignNeed, setAssignNeed] = useState<CoverageNeed | null>(null);
  const [pdf, setPdf] = useState<{ url: string; name: string; text: string } | null>(null);

  const byPeriod = useMemo(() => {
    const map = new Map<string, CoverageNeed[]>();
    for (const n of needs) {
      const list = map.get(n.slot.periodId) ?? [];
      list.push(n);
      map.set(n.slot.periodId, list);
    }
    return data.settings.periods
      .map((p) => ({ period: p, items: map.get(p.id) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [needs, data.settings.periods]);

  function applyShift(shift: ClassShift) {
    for (const n of shift.needs) {
      store.saveSubstitution({
        id: n.substitution?.id,
        date: n.date,
        periodId: n.slot.periodId,
        classId: n.slot.classId,
        absentTeacherId: n.absence.teacherId,
        substituteId: null,
        type: shift.kind,
        activity: "",
        notes: "",
        subject: n.slot.subject,
      });
    }
    const cls = data.classes.find((c) => c.id === shift.classId);
    const code = (cls?.name ?? "Classe").replace(/ª\s*/g, "").replace(/\s+/g, "");
    toast.success(`${code} ${shift.phrase}`);
  }

  function undoShift(shift: ClassShift) {
    for (const n of shift.needs) {
      if (n.substitution?.id && isShiftType(n.substitution.type)) store.removeSubstitution(n.substitution.id);
    }
    toast.message("Ore di nuovo da coprire");
  }

  function autoFill() {
    const plan = autoAssignPlan(data, date);
    if (plan.length === 0) {
      toast.message("Nessuna sostituzione da assegnare: le ore sono già coperte o non ci sono docenti disponibili.");
      return;
    }
    store.applyAutoAssign(plan);
    toast.success(
      plan.length === 1
        ? "1 sostituzione assegnata automaticamente: puoi modificarla dalla bacheca."
        : `${plan.length} sostituzioni assegnate automaticamente: puoi modificarle dalla bacheca.`,
    );
  }

  async function copySheet() {
    const ok = await copyText(dailySheetCopyPlain(data, date, needs), dailySheetHtml(data, date, needs));
    toastSave(ok ? "copied" : "failed", "copy");
  }

  async function exportCsv() {
    const outcome = await shareOrSaveFile(substitutionsXlsx(data, date));
    toastSave(outcome, "excel");
  }

  async function exportPhoto() {
    try {
      const blob = await bachecaJpeg(data, date);
      const outcome = await shareJpeg(`sostituzioni-${date}.jpg`, blob);
      toastSave(outcome, "image");
    } catch {
      toast.error("Non sono riuscito a creare la foto.");
    }
  }

  function exportPdf() {
    const text = `${dailySheetText(data, date, needs)}\n\nFirma del responsabile di plesso ________________`;
    const blob = textToPdf(text);
    const name = `sostituzioni-${date}.pdf`;
    const url = URL.createObjectURL(blob);
    if (pdf?.url) URL.revokeObjectURL(pdf.url);
    setPdf({ url, name, text });
  }

  function closePdf() {
    if (pdf?.url) URL.revokeObjectURL(pdf.url);
    setPdf(null);
  }

  async function sharePdf() {
    if (!pdf) return;
    const tab = openPdfTab();
    try {
      const blob = await fetch(pdf.url).then((r) => r.blob());
      toastSave(tab.show(pdf.name, blob), "pdf");
    } catch {
      tab.cancel();
      toast.error("Non sono riuscito a salvare. Prova Apri PDF.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Bacheca del giorno"
        description="Registra le assenze e le sostituzioni orarie. Scarica il riepilogo giornaliero."
        actionsFullWidth
        actions={
          <>
            <Button onClick={() => setAbsenceOpen(true)}>
              <UserPlus />
              Assenza
            </Button>
            <Button variant="outline" onClick={autoFill} disabled={uncovered === 0}>
              <ListChecks />
              Auto-assegna
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-col items-center gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/*
          Frecce ferme: ‹ allineata al lunedì della settimana e la data sempre nello spazio della più lunga
          («Mercoledì 20 Novembre»). Da 400 px tutto su una riga; più stretto, «Oggi» e il calendario vanno
          nella riga sotto. Sul computer la data ha uno spazio fisso.
        */}
        <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-2 min-[400px]:grid-cols-[auto_minmax(11.5rem,1fr)_auto_auto_auto] sm:grid-cols-[auto_minmax(15rem,1fr)_auto_auto_auto] sm:gap-x-2 lg:flex lg:w-auto lg:gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-9 shrink-0 sm:w-10"
            aria-label="Giorno precedente"
            onClick={() => store.setSelectedDate(shiftSchoolDay(date, -1, data.settings.days))}
          >
            <ChevronLeft />
          </Button>
          <p className="text-center font-display text-base capitalize leading-tight whitespace-nowrap sm:px-1 sm:text-xl lg:w-60">
            {formatDayMonth(date)}
          </p>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-9 shrink-0 sm:w-10"
            aria-label="Giorno successivo"
            onClick={() => store.setSelectedDate(shiftSchoolDay(date, 1, data.settings.days))}
          >
            <ChevronRight />
          </Button>
          <div className="col-span-3 flex items-center justify-center gap-2 min-[400px]:contents">
            {date === todayIso() ? (
              <span className="inline-flex h-10 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground sm:px-4">
                Oggi
              </span>
            ) : (
              <Button variant="outline" className="h-10 shrink-0 px-3 sm:px-4" onClick={() => store.setSelectedDate(todayIso())}>
                Oggi
              </Button>
            )}
            <label
              className={cn(
                buttonVariants({ variant: "outline", size: "icon" }),
                "relative h-10 w-9 shrink-0 focus-within:ring-2 focus-within:ring-ring/40 sm:w-10",
              )}
              title="Scegli data"
            >
              <CalendarDays aria-hidden />
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && store.setSelectedDate(e.target.value)}
                aria-label="Scegli data"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", maxHeight: "none", opacity: 0 }}
              />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2 lg:justify-end" data-print-hide>
          <Button variant="outline" size="sm" className="shrink-0" onClick={copySheet} title="Copia il testo per WhatsApp o mail">
            <Copy />
            Copia foglio
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void exportCsv()} title="Salva o condividi la tabella Excel">
            <Download />
            Excel
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void exportPhoto()} title="Salva o condividi un’immagine del foglio">
            <ImageIcon />
            Foto
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={exportPdf} title="Apri il PDF da stampare o condividere">
            <FileText />
            PDF
          </Button>
        </div>
        <p className="text-center text-[12px] text-muted-foreground md:hidden" data-print-hide>
          Foto e PDF si aprono per salvarli, stamparli o condividerli.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-5 gap-1.5" data-print-hide>
        {weekDaysIso(date, 5).map((iso) => {
          const summary = dayCoverage(data, iso);
          const active = iso === date;
          const day = Number(iso.slice(8, 10));
          const dow = toSchoolDay(iso);
          if (!dow) return null;
          return (
            <button
              key={iso}
              type="button"
              aria-current={active ? "date" : undefined}
              onClick={() => store.setSelectedDate(iso)}
              className={cn(
                "flex min-h-14 flex-col items-start rounded-lg px-2 py-1.5 text-left",
                active ? "bg-primary text-primary-foreground" : "paper-panel",
              )}
            >
              <span className={cn("text-[11px] font-medium", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {DAY_SHORT[dow]} {day}
              </span>
              <span
                className={cn(
                  "mt-0.5 flex flex-col text-[12px] font-medium leading-tight md:flex-row md:gap-1",
                  active
                    ? "text-primary-foreground"
                    : summary.absences.length === 0
                      ? "text-muted-foreground"
                      : summary.uncovered > 0
                        ? "text-destructive"
                        : "text-success",
                )}
              >
                {summary.absences.length === 0 ? (
                  <>
                    <span aria-hidden>–</span>
                    <span>
                      nessuna<span className="hidden md:inline"> assenza</span>
                    </span>
                  </>
                ) : summary.uncovered > 0 ? (
                  <>
                    <span className="tabular-nums">{summary.uncovered}</span>
                    <span>{summary.uncovered === 1 ? "scoperta" : "scoperte"}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden>✓</span>
                    <span>coperto</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Assenti" value={absences.length} />
        <Stat label="Ore da coprire" value={needs.length - varied} />
        <Stat label="Coperte" value={covered} tone="ok" />
        <Stat
          label="Scoperte"
          value={uncovered}
          tone={uncovered ? "warn" : "ok"}
          outOf={uncovered > 0 ? needs.length - varied : undefined}
        />
      </div>

      {shifts.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card px-4 py-3" data-print-hide>
          <p className="font-display text-lg">Orario variato</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Classi scoperte nelle prime o nelle ultime ore: puoi posticiparne l’ingresso o anticiparne l’uscita. Con
            «Conferma» le ore non risultano più da coprire e la variazione compare nel riepilogo.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {shifts.map((s) => {
              const cls = data.classes.find((c) => c.id === s.classId);
              const code = (cls?.name ?? "?").replace(/ª\s*/g, "").replace(/\s+/g, "");
              return (
                <li key={`${s.classId}-${s.kind}`} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {code} {s.phrase}
                  </span>
                  <Button size="sm" variant={s.applied ? "outline" : "default"} onClick={() => (s.applied ? undoShift(s) : applyShift(s))}>
                    {s.applied ? "Annulla" : "Conferma"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {uncovered > 0 && (
        <div className="mb-5 rounded-xl border border-destructive/25 bg-danger-soft px-4 py-3">
          <p className="font-display text-lg text-destructive">
            {uncovered === 1 ? "Ancora 1 ora da coprire" : `Ancora ${uncovered} ore da coprire`}
          </p>
          <p className="mt-1 hidden text-sm text-destructive/90 md:block">
            Scegli un’ora qui sotto per assegnarla, oppure usa Auto-assegna.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {needs
              .filter((n) => !isCovered(n))
              .map((n) => {
                const cls = data.classes.find((c) => c.id === n.slot.classId);
                const per = data.settings.periods.find((p) => p.id === n.slot.periodId);
                const absent = findAnyTeacher(data, n.absence.teacherId);
                return (
                  <li key={n.key}>
                    <button
                      type="button"
                      onClick={() => setAssignNeed(n)}
                      aria-label={`${per?.label ?? "Ora"} · ${cls?.name ?? "classe"} · assente ${
                        absent ? teacherShort(absent, allTeachers(data)) : "—"
                      }`}
                      className="h-8 whitespace-nowrap rounded-full border border-destructive/30 bg-card px-3 text-[13px] font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10"
                    >
                      {per?.label ?? "Ora"} · {cls?.name ?? "classe"}
                    </button>
                  </li>
                );
              })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const first = needs.find((n) => !isCovered(n));
                if (first) setAssignNeed(first);
              }}
            >
              Assegna
            </Button>
            <Button variant="outline" onClick={autoFill}>
              <ListChecks />
              Auto-assegna
            </Button>
          </div>
        </div>
      )}

      {weekend && (
        <p className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          Giorno senza lezioni. Seleziona un altro giorno con le frecce; se la scuola fa lezione il sabato, attivalo in Impostazioni.
        </p>
      )}

      {absences.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-display text-lg">Docenti assenti</h2>
          <ul className="flex flex-col gap-2">
            {absences.map((a) => {
              const t = findAnyTeacher(data, a.teacherId);
              const reason = ABSENCE_REASONS.find((r) => r.value === a.reason)?.label;
              return (
                <li key={a.id} className="paper-panel flex items-center justify-between gap-3 rounded-lg px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{t ? teacherName(t) : a.teacherId}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {reason}
                      {a.allDay ? " · giornata intera" : ` · ${a.periodIds.length} ore`}
                      {a.dateFrom !== a.dateTo ? ` · fino al ${a.dateTo}` : ""}
                    </p>
                  </div>
                  <Badge variant="warning">{t ? teacherShort(t, allTeachers(data)) : ""}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {needs.length === 0 && !weekend && (
        <div className="paper-panel rounded-xl px-6 py-14 text-center">
          <p className="font-display text-2xl">Nessuna ora da coprire</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Registra l’assenza di un docente: le sue ore compariranno qui, con i colleghi disponibili in ordine di
            priorità.
          </p>
          <Button className="mt-5" onClick={() => setAbsenceOpen(true)}>
            Registra assenza
          </Button>
        </div>
      )}

      <div className="grid gap-5 min-[1100px]:grid-cols-2 min-[1100px]:gap-x-6">
        {byPeriod.map(({ period, items }) => (
          <section key={period.id}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-display text-lg">
                {period.label}
                <span className="ml-2 text-sm font-sans font-normal text-muted-foreground">
                  {period.start}–{period.end}
                </span>
              </h2>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {items.filter(isCovered).length}/{items.length} coperte
              </span>
            </div>
            <ul className="grid gap-2 md:max-[1100px]:grid-cols-2">
              {items.map((n) => {
                const cls = data.classes.find((c) => c.id === n.slot.classId);
                const absent = findAnyTeacher(data, n.absence.teacherId);
                const sub = findAnyTeacher(data, n.substitution?.substituteId);
                const ok = isCovered(n);
                const shift = shifts.find((s) => s.applied && s.needs.some((x) => x.key === n.key));
                const tipo =
                  n.substitution?.type && n.substitution.type !== "divisione"
                    ? SUBSTITUTION_TYPES.find((x) => x.value === n.substitution?.type)?.short
                    : "";
                return (
                  <li key={n.key}>
                    <button
                      type="button"
                      onClick={() => setAssignNeed(n)}
                      className={cn(
                        "paper-panel flex min-h-[7.5rem] w-full flex-col items-start rounded-xl p-4 text-left transition-[box-shadow] duration-150 hover:shadow-border-hover",
                        !ok && !shift && "border border-destructive/30 bg-danger-soft",
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="font-display text-lg">{cls?.name}</span>
                        <Badge variant={shift ? "warning" : ok ? "success" : "danger"}>
                          {shift ? shift.phrase : ok ? "Coperta" : "Scoperta"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">{n.slot.subject}</p>
                      <p className="mt-3 text-sm">
                        <span className="text-muted-foreground">Assente </span>
                        {absent ? teacherShort(absent, allTeachers(data)) : "—"}
                      </p>
                      {shift ? (
                        <p className="text-sm">{shift.phrase}</p>
                      ) : (
                        <p className="text-sm">
                          {n.substitution?.type === "divisione" || sub ? (
                            <>
                              <span className="text-muted-foreground">Copre </span>
                              {n.substitution?.type === "divisione" || !sub ? "classe divisa" : teacherShort(sub, allTeachers(data))}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Sostituto da assegnare</span>
                          )}
                          {tipo ? <span className="text-muted-foreground"> · {tipo}</span> : null}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <PrintSheet date={date} needs={needs} />

      <Dialog open={pdf != null} onOpenChange={(open) => !open && closePdf()}>
        <DialogContent className="max-w-2xl p-4 sm:p-5">
          <DialogHeader className="pr-8">
            <DialogTitle>Foglio sostituzioni in PDF</DialogTitle>
            <DialogDescription>
              Puoi condividerlo, salvarlo in File o aprirlo per la stampa.
            </DialogDescription>
          </DialogHeader>
          {pdf && (
            <>
              <pre className="mt-1 max-h-[min(52vh,28rem)] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-4 font-sans text-[13px] leading-relaxed">
                {pdf.text}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void sharePdf()}>
                  <Share2 />
                  Condividi / salva PDF
                </Button>
                <Button variant="outline" asChild>
                  <a href={pdf.url} target="_blank" rel="noopener" download={pdf.name}>
                    <ExternalLink />
                    Apri PDF
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AbsenceDialog open={absenceOpen} onOpenChange={setAbsenceOpen} />
      <AssignSheet key={assignNeed?.key ?? "chiuso"} need={assignNeed} onClose={() => setAssignNeed(null)} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  outOf,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
  /** Se c'è, la card si evidenzia come l'avviso e mostra «su N». */
  outOf?: number;
}) {
  const alert = outOf !== undefined;
  return (
    <div
      className={
        alert ? "rounded-xl border border-destructive/25 bg-danger-soft px-4 py-3" : "paper-panel rounded-xl px-4 py-3"
      }
    >
      <p className={cn("text-[12px]", alert ? "text-destructive/90" : "text-muted-foreground")}>{label}</p>
      <p className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-display tabular-nums",
            alert ? "text-3xl leading-tight" : "text-2xl",
            tone === "ok" && "text-success",
            tone === "warn" && "text-destructive",
          )}
        >
          {value}
        </span>
        {alert && <span className="text-[13px] text-destructive/90 tabular-nums">su {outOf}</span>}
      </p>
    </div>
  );
}

function PrintSheet({ date, needs }: { date: string; needs: CoverageNeed[] }) {
  const store = useAppStore();
  const data = officialData(snapshot(store));
  const heading = dailySheetHeading(date);
  const body = dailySheetText(data, date, needs)
    .split("\n")
    .slice(1)
    .join("\n");
  return (
    <section data-print-only className="print-sheet mt-10 hidden font-sans text-sm leading-relaxed">
      <p className="font-bold uppercase">{heading}</p>
      <pre className="mt-2 whitespace-pre-wrap font-sans">{body}</pre>
      <p className="mt-10 text-[12px]">Firma del responsabile di plesso ________________________________</p>
    </section>
  );
}
