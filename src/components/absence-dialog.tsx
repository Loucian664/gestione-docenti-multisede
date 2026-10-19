import { useEffect, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { ABSENCE_REASONS } from "@/lib/types";
import type { Absence, AbsenceReason } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { teacherName } from "@/lib/coverage";
import { isMensaPeriod, visiblePeriods } from "@/lib/periods";
import { toast } from "sonner";

export function AbsenceDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Absence | null;
}) {
  const current = useAppStore((s) => s.teachers);
  const formerTeachers = useAppStore((s) => s.formerTeachers);
  // chi non è più in servizio compare solo quando si modifica una sua assenza già segnata
  const former = initial ? (formerTeachers ?? []).find((t) => t.id === initial.teacherId) : undefined;
  const teachers = former ? [...current, former] : current;
  const settings = useAppStore((s) => s.settings);
  const periods = visiblePeriods(settings).filter((p) => !isMensaPeriod(p));
  const selectedDate = useAppStore((s) => s.selectedDate);
  const addAbsence = useAppStore((s) => s.addAbsence);
  const updateAbsence = useAppStore((s) => s.updateAbsence);

  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? teachers[0]?.id ?? "");
  const [dateFrom, setDateFrom] = useState(initial?.dateFrom ?? selectedDate);
  const [dateTo, setDateTo] = useState(initial?.dateTo ?? selectedDate);
  const [reason, setReason] = useState<AbsenceReason>(initial?.reason ?? "malattia");
  const [allDay, setAllDay] = useState(initial?.allDay ?? true);
  const [periodIds, setPeriodIds] = useState<string[]>(initial?.periodIds ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  useEffect(() => {
    if (!open || initial) return;
    setDateFrom(selectedDate);
    setDateTo(selectedDate);
  }, [open, initial, selectedDate]);

  function togglePeriod(id: string) {
    setPeriodIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!teacherId) return;
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
      toast.success("Assenza registrata. Assegna ora le sostituzioni.");
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
              onChange={(e) => setReason(e.target.value as AbsenceReason)}
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
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Note</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit">{initial ? "Salva" : "Registra"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
