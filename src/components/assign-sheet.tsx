import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SUBSTITUTION_TYPES, type SubstitutionType } from "@/lib/types";
import { useAppStore, snapshot } from "@/lib/store";
import { officialData } from "@/lib/saved-timetables";
import {
  classShifts,
  isCovered,
  isShiftType,
  rankSubstitutes,
  teacherName,
  teacherShort,
  type CoverageNeed,
  type RankedSubstitute,
  type SubstituteBucket,
} from "@/lib/coverage";
import { findAnyTeacher } from "@/lib/replace-teacher";
import { toast } from "sonner";
import { teacherDotColor } from "@/lib/teacher-palette";

const GROUPS: { bucket: SubstituteBucket | SubstituteBucket[]; title: string; hint: string }[] = [
  {
    bucket: "disp",
    title: "A disposizione",
    hint: "Rientra nell’orario di servizio: non è un’ora eccedente.",
  },
  {
    bucket: "buco",
    title: "Prima scelta: ora libera tra due lezioni",
    hint: "In servizio, senza lezione in quest’ora.",
  },
  {
    bucket: "sostegno-qui",
    title: "Sostegno già in questa classe",
    hint: "Già presente nella classe in quest’ora.",
  },
  {
    bucket: "sostegno-libera",
    title: "Sostegno libero",
    hint: "La sua classe non è presente in quest’ora (ingresso posticipato o uscita anticipata).",
  },
  {
    bucket: "pre-post",
    title: "Un’ora prima o un’ora dopo",
    hint: "Disponibile anticipando l’ingresso o posticipando l’uscita di un’ora.",
  },
  {
    bucket: "potenziamento",
    title: "Potenziamento in un’altra classe",
    hint: "In servizio in un’ora di potenziamento: si può spostare in questa classe.",
  },
  {
    bucket: "in-sede",
    title: "Già a scuola",
    hint: "In servizio in quest’ora o già in classe.",
  },
  {
    bucket: "senza-orario",
    title: "Senza orario",
    hint: "Orario non ancora inserito: verifica la disponibilità.",
  },
  {
    bucket: "impegnato",
    title: "In un’altra classe",
    hint: "Solo se necessario: la sua classe resterebbe scoperta.",
  },
  {
    bucket: "sostegno",
    title: "Sostegno in altre classi",
    hint: "In un’altra classe o non in servizio in quest’ora. Escluso dall’assegnazione automatica.",
  },
  {
    bucket: "non-in-sede",
    title: "Non a scuola",
    hint: "Non in servizio in quest’ora. Solo se necessario.",
  },
  {
    bucket: "fuori-orario",
    title: "Potenziamento fuori orario",
    hint: "Non è in servizio in quest’ora: se lo scegli, va avvisato di spostare l’orario. Escluso dall’assegnazione automatica.",
  },
  {
    bucket: "altrove",
    title: "Altrove o in progetto",
    hint: "In quest’ora è in un altro plesso o in un progetto. Escluso dall’assegnazione automatica.",
  },
];

export function AssignSheet({
  need,
  onClose,
}: {
  need: CoverageNeed | null;
  onClose: () => void;
}) {
  const store = useAppStore();
  // le sostituzioni usano sempre l'orario in vigore (slot 0)
  const data = officialData(snapshot(store));
  const ranked = useMemo(() => (need ? rankSubstitutes(data, need) : []), [need, data]);
  const [query, setQuery] = useState("");

  const current = need?.substitution;
  // Si riparte da capo a ogni ora: se è già coperta è scelto chi la copre, altrimenti nessuno.
  const coveredNow = Boolean(need && current && isCovered(need) && !isShiftType(current.type));
  const [substituteId, setSubstituteId] = useState(coveredNow ? (current?.substituteId ?? "") : "");
  const [type, setType] = useState<SubstitutionType | "divisione">(
    coveredNow && current?.type ? current.type : "disposizione",
  );
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [barOpen, setBarOpen] = useState(coveredNow);
  // L'avviso dell'ora appena salvata coprirebbe la conferma in fondo: si chiude quando apri un'altra ora.
  useEffect(() => {
    if (need) toast.dismiss();
  }, [need]);

  if (!need) return null;

  const active = need;
  const period = data.settings.periods.find((p) => p.id === active.slot.periodId);
  const cls = data.classes.find((c) => c.id === active.slot.classId);
  const absent = findAnyTeacher(data, active.absence.teacherId);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? ranked.filter((r) => {
        const n = teacherName(r.teacher).toLowerCase();
        return n.includes(q) || r.teacher.subjects.some((s) => s.toLowerCase().includes(q));
      })
    : ranked;

  function pick(id: string) {
    setSubstituteId(id);
    const r = ranked.find((x) => x.teacher.id === id);
    if (r) setType(r.inferredType);
    setBarOpen(true);
  }

  function pickDivisione() {
    setSubstituteId("");
    setType("divisione");
    setBarOpen(true);
  }

  function goToNotes() {
    const el = document.getElementById("assign-notes");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }

  const divisione = SUBSTITUTION_TYPES.find((t) => t.value === "divisione");
  // Chi copre già l'ora (dati salvati, non la scelta in corso)
  const coveringTeacher = coveredNow ? findAnyTeacher(data, current?.substituteId) : undefined;
  const coveringType = SUBSTITUTION_TYPES.find((t) => t.value === current?.type)?.label;
  /** cosa vuol dire il tipo di copertura scelto */
  const typeHint = SUBSTITUTION_TYPES.find((t) => t.value === type)?.hint;
  const shiftPhrase =
    current && isShiftType(current.type)
      ? classShifts(data, active.date).find((sh) => sh.needs.some((x) => x.key === active.key))?.phrase
      : undefined;
  const chosenTeacher = type === "divisione" ? undefined : data.teachers.find((t) => t.id === substituteId);
  const chosenLabel =
    type === "divisione"
      ? (divisione?.label ?? "Divisione classe")
      : chosenTeacher
        ? teacherShort(chosenTeacher, data.teachers)
        : "—";

  function save() {
    store.saveSubstitution({
      id: current?.id,
      date: active.date,
      periodId: active.slot.periodId,
      classId: active.slot.classId,
      absentTeacherId: active.absence.teacherId,
      substituteId: type === "divisione" ? null : substituteId || null,
      type,
      activity: "",
      notes,
      subject: active.slot.subject,
    });
    toast.success("Copertura salvata");
    onClose();
  }

  function clear() {
    if (current?.id) store.removeSubstitution(current.id);
    else {
      store.saveSubstitution({
        date: active.date,
        periodId: active.slot.periodId,
        classId: active.slot.classId,
        absentTeacherId: active.absence.teacherId,
        substituteId: null,
        type: null,
        activity: "",
        notes: "",
        subject: active.slot.subject,
      });
    }
    toast.message("Ora lasciata scoperta");
    onClose();
  }

  return (
    <Sheet open={Boolean(need)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {cls?.name} · {period?.label}
          </SheetTitle>
          <SheetDescription>
            {need.slot.subject}
            {absent ? ` — assente ${teacherName(absent)}` : ""}
            {` · ${ranked.length} docenti in elenco`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-5">
          {(coveredNow || shiftPhrase) && (
            <div
              className={
                coveredNow
                  ? "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-success-soft px-3 py-2.5"
                  : "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-warning-soft px-3 py-2.5"
              }
            >
              <p className="min-w-0 text-sm">
                {coveredNow ? (
                  <>
                    <span className="font-medium text-success">Copre ora:</span>{" "}
                    {current?.type === "divisione"
                      ? "classe divisa"
                      : `${coveringTeacher ? teacherShort(coveringTeacher, data.teachers) : "—"}${coveringType ? ` · ${coveringType}` : ""}`}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-warning">Orario variato:</span> {shiftPhrase}
                  </>
                )}
              </p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={clear}>
                Lascia scoperta
              </Button>
            </div>
          )}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per nome o materia…"
            aria-label="Cerca docente"
          />
          <p className="-mt-2 text-[12px] text-muted-foreground">Docenti in ordine di priorità: prima chi è in servizio senza lezione.</p>

          {GROUPS.map((group) => {
            const buckets = Array.isArray(group.bucket) ? group.bucket : [group.bucket];
            const items = filtered.filter((r) => buckets.includes(r.bucket));
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                <p className="text-[13px] font-medium text-muted-foreground">{group.title}</p>
                <p className="text-[12px] text-muted-foreground">{group.hint}</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {items.map((r) => (
                    <TeacherPickRow
                      key={r.teacher.id}
                      row={r}
                      selected={substituteId === r.teacher.id && type !== "divisione"}
                      onPick={() => pick(r.teacher.id)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">Nessun docente trovato.</p>
          )}

          {divisione && (
            <button
              type="button"
              onClick={pickDivisione}
              aria-pressed={type === "divisione"}
              className={
                type === "divisione"
                  ? "flex w-full flex-col items-start rounded-lg bg-accent px-3 py-2.5 text-left"
                  : "flex w-full flex-col items-start rounded-lg px-3 py-2.5 text-left hover:bg-muted"
              }
            >
              <span className="font-medium">{divisione.label}</span>
              <span className="text-[12px] text-muted-foreground">{divisione.hint}</span>
            </button>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-notes">Note</Label>
            <Textarea id="assign-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

        </div>

        {barOpen && (
          <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t border-border bg-popover px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate font-medium">{chosenLabel}</p>
              <button
                type="button"
                onClick={goToNotes}
                className="shrink-0 text-[13px] font-medium text-primary underline-offset-2 hover:underline"
              >
                Aggiungi una nota
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <NativeSelect
                aria-label="Tipo di copertura"
                className="sm:flex-1"
                value={type}
                onChange={(e) => setType(e.target.value as SubstitutionType)}
              >
                {SUBSTITUTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
              <Button onClick={save} className="h-11 w-full sm:h-10 sm:w-auto">
                {isCovered(need) ? "Aggiorna copertura" : "Assegna"}
              </Button>
            </div>
            {typeHint && <p className="text-[12px] text-muted-foreground">{typeHint}</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TeacherPickRow({
  row,
  selected,
  onPick,
}: {
  row: RankedSubstitute;
  selected: boolean;
  onPick: () => void;
}) {
  const warning =
    row.bucket === "impegnato" ||
    row.bucket === "non-in-sede" ||
    row.bucket === "sostegno" ||
    row.bucket === "fuori-orario" ||
    row.bucket === "altrove";
  const teachers = useAppStore((s) => s.teachers);
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={
          selected
            ? "flex w-full items-start gap-3 rounded-lg bg-accent px-3 py-2.5 text-left"
            : warning
              ? "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left opacity-80 hover:bg-muted"
              : "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted"
        }
      >
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: teacherDotColor(row.teacher.color) }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{teacherShort(row.teacher, teachers)}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{row.monthCount} ore/mese</span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-1">
            {row.reasons.slice(0, 3).map((reason) => (
              <Badge key={reason} variant={warning ? "warning" : "outline"}>
                {reason}
              </Badge>
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}
