import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/dialog-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { ABSENCE_REASONS } from "@/lib/types";
import type { Absence, AbsenceReason } from "@/lib/types";
import { snapshot, useAppStore } from "@/lib/store";
import { absenceMirrors, personReasonSpans } from "@/lib/sedi";
import {
  absenceSpans,
  formatHours,
  HOUR_REASON_LIMITS,
  isHourReason,
  spanMinutes,
  teacherName,
} from "@/lib/coverage";
import { officialData } from "@/lib/saved-timetables";
import { schoolYearRange } from "@/lib/dates";
import { isMensaPeriod, visiblePeriods } from "@/lib/periods";
import { toast } from "sonner";

export function AbsenceDialog({
  open,
  onOpenChange,
  initial,
  date,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Absence | null;
  /** giorno da cui parte una nuova assenza; se manca, quello scelto in «Oggi» */
  date?: string;
}) {
  const current = useAppStore((s) => s.teachers);
  const formerTeachers = useAppStore((s) => s.formerTeachers);
  // chi non è più in servizio compare solo quando si modifica una sua assenza già segnata
  const former = initial ? (formerTeachers ?? []).find((t) => t.id === initial.teacherId) : undefined;
  const teachers = former ? [...current, former] : current;
  const settings = useAppStore((s) => s.settings);
  const periods = visiblePeriods(settings).filter((p) => !isMensaPeriod(p));
  const oggi = useAppStore((s) => s.selectedDate);
  const selectedDate = date ?? oggi;
  const addAbsence = useAppStore((s) => s.addAbsence);
  const addAbsenceIn = useAppStore((s) => s.addAbsenceIn);
  const updateAbsence = useAppStore((s) => s.updateAbsence);

  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? "");
  const [dateFrom, setDateFrom] = useState(initial?.dateFrom ?? selectedDate);
  const [dateTo, setDateTo] = useState(initial?.dateTo ?? selectedDate);
  const [reason, setReason] = useState<AbsenceReason>(initial?.reason ?? "malattia");
  const [allDay, setAllDay] = useState(initial?.allDay ?? true);
  const [periodIds, setPeriodIds] = useState<string[]>(initial?.periodIds ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // chi lavora anche in un'altra sede: lì le sue ore restano da coprire solo se l'assenza è segnata anche lì
  const [noMirror, setNoMirror] = useState<Record<string, boolean>>({});
  const store = useAppStore();
  const mirrors = useMemo(
    () =>
      initial || !open || !teacherId
        ? []
        : absenceMirrors(snapshot(store), teacherId, {
            dateFrom,
            dateTo,
            allDay,
            periodIds: allDay ? [] : periodIds,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial, open, teacherId, dateFrom, dateTo, allDay, periodIds, store.teachers, store.altreSedi],
  );

  // a ogni apertura il modulo riparte pulito, o dall'assenza da modificare: niente dati dell'assenza di prima
  useEffect(() => {
    if (!open) return;
    setTeacherId(initial?.teacherId ?? "");
    setDateFrom(initial?.dateFrom ?? selectedDate);
    setDateTo(initial?.dateTo ?? selectedDate);
    setReason(initial?.reason ?? "malattia");
    setAllDay(initial?.allDay ?? true);
    setPeriodIds(initial?.periodIds ?? []);
    setNotes(initial?.notes ?? "");
    setNoMirror({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // assemblea e permessi brevi si contano a ore: quante ne ha già usate nell'anno, e quante con questa
  const usage = useMemo(() => {
    if (!open || !teacherId || !isHourReason(reason)) return null;
    const data = officialData(snapshot(store));
    const year = schoolYearRange(data.settings.schoolYear, dateFrom);
    const before = personReasonSpans(data, teacherId, reason, year.from, year.to, initial?.id);
    const draft =
      !allDay && periodIds.length === 0
        ? []
        : absenceSpans(data, { dateFrom, dateTo: dateTo < dateFrom ? dateFrom : dateTo, allDay, periodIds }, year.from, year.to);
    return {
      before: spanMinutes(before),
      after: spanMinutes([...before, ...draft]),
      draft: draft.length > 0,
      limit: HOUR_REASON_LIMITS[reason] ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teacherId, reason, dateFrom, dateTo, allDay, periodIds, initial, store.absences, store.altreSedi]);
  const usageOver = usage ? usage.after > usage.limit * 60 : false;

  function togglePeriod(id: string) {
    setPeriodIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // senza «Giornata intera» serve almeno un'ora: un'assenza senza ore non si copre in Oggi, ma il report la conterebbe
  const noHours = !allDay && periodIds.length === 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!teacherId || noHours) return;
    const payload = {
      teacherId,
      dateFrom,
      dateTo: dateTo < dateFrom ? dateFrom : dateTo,
      reason,
      notes,
      allDay,
      periodIds: allDay ? [] : periodIds,
    };
    if (initial) {
      updateAbsence(initial.id, payload);
      toast.success("Assenza aggiornata");
    } else {
      addAbsence(payload);
      const also = mirrors.filter((m) => !noMirror[m.sedeId]);
      for (const m of also) {
        addAbsenceIn(m.sedeId, { ...payload, teacherId: m.teacherId, allDay: m.allDay, periodIds: m.periodIds });
      }
      toast.success("Assenza registrata. Assegna ora le sostituzioni.", {
        duration: also.length ? 8000 : undefined,
        description: also.length ? `Segnata anche a ${also.map((m) => m.sedeName).join(", ")}.` : undefined,
      });
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Modifica assenza" : "Registra assenza"}</DialogTitle>
          <DialogDescription>
            Indica docente, periodo e motivo: le sue ore di lezione compariranno in bacheca, da coprire.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="teacher">Docente</Label>
            <NativeSelect id="teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} required>
              <option value="" disabled>
                Scegli il docente…
              </option>
              {teachers
                .slice()
                .sort((a, b) => a.lastName.localeCompare(b.lastName, "it"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {teacherName(t)}
                    {t.leftOn ? " (non più in servizio)" : ""}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="from">Dal</Label>
              <Input id="from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} required />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="to">Al</Label>
              <Input id="to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} required />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <NativeSelect
              id="reason"
              value={reason}
              onChange={(e) => {
                const next = e.target.value as AbsenceReason;
                setReason(next);
                // assemblea e permessi brevi: di solito poche ore, da scegliere
                if (isHourReason(next)) setAllDay(false);
              }}
            >
              {ABSENCE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="size-4 accent-primary"
            />
            Giornata intera
          </label>
          {allDay && (
            <p className="-mt-2 text-[12px] text-muted-foreground">
              Deseleziona per indicare solo alcune ore (ad esempio un permesso breve).
            </p>
          )}
          {!allDay && (
            <div>
              <Label>Ore interessate</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {periods.map((p) => {
                  const on = periodIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePeriod(p.id)}
                      className={
                        on
                          ? "h-9 rounded-md bg-primary px-3 text-[13px] text-primary-foreground"
                          : "h-9 rounded-md bg-secondary px-3 text-[13px]"
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {noHours && (
                <p className="mt-1.5 text-[12px] text-warning">Scegli almeno un’ora, oppure «Giornata intera».</p>
              )}
            </div>
          )}
          {mirrors.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-1">
              {mirrors.map((m) => (
                <label key={m.sedeId} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!noMirror[m.sedeId]}
                    onChange={(e) => setNoMirror((prev) => ({ ...prev, [m.sedeId]: !e.target.checked }))}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="font-medium">Segna l’assenza anche a {m.sedeName}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      Lì ha lezione: {m.lessons.slice(0, 4).join(", ")}
                      {m.lessons.length > 4 ? ` e altre ${m.lessons.length - 4}` : ""}. Se poi la modifichi o la elimini,
                      fallo anche nell’altra sede.
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {usage && (
            <p
              role="status"
              className={
                usageOver
                  ? "rounded-md bg-warning-soft px-3 py-2 text-[13px] leading-snug text-foreground"
                  : "rounded-md bg-muted px-3 py-2 text-[13px] leading-snug"
              }
            >
              {reason === "assemblea_sindacale" ? (
                <>
                  Assemblea sindacale in quest’anno scolastico: {hoursText(usage.before)} su 10
                  {usage.draft ? `; con questa ${hoursText(usage.after)}` : ""}.
                  {usageOver && <strong className="mt-0.5 block text-warning">Si superano le 10 ore annue.</strong>}
                </>
              ) : (
                <>
                  Permessi brevi in quest’anno scolastico: {hoursText(usage.before)}
                  {usage.draft ? `; con questo ${hoursText(usage.after)}` : ""}. Limite: l’orario settimanale del docente
                  (18 ore per una cattedra intera).
                  {usageOver && <strong className="mt-0.5 block text-warning">Si superano le 18 ore.</strong>}
                </>
              )}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Note</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogActions className="mt-2" primary={<Button type="submit" disabled={noHours}>{initial ? "Salva" : "Registra"}</Button>}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «nessuna ora», «1 ora», «2 ore», «1 h 35 min». */
function hoursText(minutes: number): string {
  if (minutes <= 0) return "nessuna ora";
  if (minutes % 60 !== 0) return formatHours(minutes);
  const h = minutes / 60;
  return `${h} ${h === 1 ? "ora" : "ore"}`;
}
