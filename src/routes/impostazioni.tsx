import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout";
import { ThemePicker } from "@/components/theme-toggle";
import { SaveSlots } from "@/components/save-slots";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/dialog-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore, snapshot } from "@/lib/store";
import { backupJson, parseBackupJson } from "@/lib/export";
import { longRunImportNote } from "@/lib/calcolo-lungo";
import { shareOrSave, toastSave } from "@/lib/share-file";
import type { Cattedra, PersistedData, SedeData, Teacher, TimetableSlot } from "@/lib/types";
import { allSedi, formerPersons, sedeAsData, sedeName } from "@/lib/sedi";
import { frozenCattedre } from "@/lib/build-timetable";
import { builtLessonTest, fixedKinds, fixedKindsNote, stayText } from "@/lib/svuota";
import { isLockedLesson } from "@/lib/locks";
import { previousFields } from "@/lib/clear-marks";
import { dateOnLaunch, nextSchoolYear, todayIso } from "@/lib/dates";
import { archivedCounts, archivedYearLabels } from "@/lib/school-years";
import { toast } from "sonner";

export const Route = createFileRoute("/impostazioni")({ component: ImpostazioniPage });

function ImpostazioniPage() {
  const store = useAppStore();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearStep, setClearStep] = useState<1 | 2>(1);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptyDisp, setEmptyDisp] = useState(false);
  // «Svuota orario» di tutte le sedi invece che di quella in uso
  const [emptyAll, setEmptyAll] = useState(false);
  // «Svuota orario» toglie anche le lezioni bloccate e i loro blocchi
  const [emptyLocked, setEmptyLocked] = useState(false);
  // «Svuota orario» toglie anche le lezioni che Costruisci non rimette (sostegno, pomeriggio…)
  const [emptyFixed, setEmptyFixed] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ data: PersistedData; name: string; older: boolean } | null>(null);
  const [newYear, setNewYear] = useState<string | null>(null);
  const [removingYear, setRemovingYear] = useState<string | null>(null);
  const sedi = allSedi(snapshot(store));
  const archived = store.archivedYears ?? [];
  const yearLabels = archivedYearLabels(archived);
  const sameYear = (newYear ?? "").trim() === store.settings.schoolYear.trim();

  /** L’orario in uso di una sede: quello in vigore o lo slot aperto. */
  const inUseNameOf = (sede: SedeData) => {
    const n = sede.activeSlot ?? 0;
    if (n === 0) return "orario in vigore";
    const name = sede.savedTimetables?.find((x) => x.n === n)?.name;
    return `orario dello slot ${n}${name ? ` «${name}»` : ""}`;
  };
  const dispOf = (sede: SedeData) => sede.teachers.reduce((n, t) => n + (t.dispSlots?.length ?? 0), 0);
  const here = sedi.find((s) => s.active) ?? sedi[0]!;
  const emptyScope = emptyAll ? sedi : [here];
  const scopeLessons = emptyScope.reduce((n, s) => n + s.data.slots.length, 0);
  const scopeDisp = emptyScope.reduce((n, s) => n + dispOf(s.data), 0);
  /** Le lezioni bloccate di una sede: «Svuota orario» le lascia, se non si sceglie di togliere anche quelle. */
  const lockedOf = (sede: SedeData) => {
    const byId = new Map(sede.teachers.map((t) => [t.id, t]));
    return sede.slots.filter((x) => isLockedLesson(byId.get(x.teacherId), x));
  };
  const scopeLocked = emptyScope.reduce((n, s) => n + lockedOf(s.data).length, 0);
  /** Le lezioni di una sede che Costruisci non rimette (non bloccate): restano, se non si sceglie di togliere anche quelle. */
  const fixedOf = (sede: SedeData) => {
    const locked = new Set(lockedOf(sede));
    const isBuilt = builtLessonTest(sede);
    return sede.slots.filter((x) => !locked.has(x) && !isBuilt(x));
  };
  const scopeFixed = emptyScope.reduce((n, s) => n + fixedOf(s.data).length, 0);
  const scopeKinds = emptyScope.flatMap((s) => fixedKinds(s.data, fixedOf(s.data)));
  // lezioni che il pulsante toglie: le bloccate e quelle che Costruisci non rimette solo con la spunta
  const removable = scopeLessons - (emptyLocked ? 0 : scopeLocked) - (emptyFixed ? 0 : scopeFixed);
  // nessuna lezione da togliere: «Svuota orario» serve a togliere le ore a disposizione rimaste
  const onlyDisp = removable === 0;
  const canEmpty = sedi.some((s) => s.data.slots.length > 0 || dispOf(s.data) > 0);

  function closeEmpty() {
    setEmptyOpen(false);
    setEmptyDisp(false);
    setEmptyAll(false);
    setEmptyLocked(false);
    setEmptyFixed(false);
  }

  /**
   * «Svuota orario»: via le lezioni (non le bloccate, se non è scelto) e, se scelto, le ore a disposizione delle
   * sedi scelte; con «Annulla».
   */
  function emptyTimetable() {
    const withDisp = emptyDisp || onlyDisp;
    type Part = { slots: TimetableSlot[]; patches: Record<string, Partial<Teacher>>; cattedre?: Cattedra[] };
    const all = snapshot(store);
    const before: Record<string, Part> = {};
    const after: Record<string, Part> = {};
    const slotOf: Record<string, number> = {};
    let lessons = 0;
    let disp = 0;
    let stayedLocked = 0;
    let stayedFixed = 0;
    // sedi in cui cambia davvero qualcosa
    let touched = 0;
    for (const { id, data } of emptyScope) {
      const locked = new Set(lockedOf(data));
      const fixed = new Set(fixedOf(data));
      const kept = data.slots.filter((x) => (locked.has(x) ? !emptyLocked : fixed.has(x) && !emptyFixed));
      const patches: Record<string, Partial<Teacher>> = {};
      const back: Record<string, Partial<Teacher>> = {};
      let sedeDisp = 0;
      let unlocked = false;
      for (const t of data.teachers) {
        const patch: Partial<Teacher> = {};
        if (withDisp && t.dispSlots?.length) {
          patch.dispSlots = [];
          sedeDisp += t.dispSlots.length;
        }
        if (emptyLocked && (t.lockedSlots?.length || t.lockWeek)) {
          patch.lockedSlots = [];
          patch.lockWeek = false;
          unlocked = true;
        }
        if (Object.keys(patch).length === 0) continue;
        patches[t.id] = patch;
        back[t.id] = previousFields(t, patch);
      }
      const gone = data.slots.length - kept.length;
      // le cattedre ricavate dall’orario restano, scritte, anche senza lezioni
      const frozen = gone > 0 ? frozenCattedre(sedeAsData(all, data)) : null;
      before[id] = { slots: data.slots, patches: back, ...(frozen && { cattedre: data.cattedre ?? [] }) };
      after[id] = { slots: kept, patches, ...(frozen && { cattedre: frozen }) };
      slotOf[id] = data.activeSlot ?? 0;
      lessons += gone;
      disp += sedeDisp;
      stayedLocked += kept.filter((x) => locked.has(x)).length;
      stayedFixed += kept.filter((x) => fixed.has(x)).length;
      if (gone + sedeDisp > 0 || unlocked) touched += 1;
    }
    store.setSediTimetables(after);
    closeEmpty();
    const many = touched > 1;
    const what = [
      lessons > 0 && countText(lessons, "lezione", "lezioni"),
      disp > 0 && countText(disp, "ora a disposizione", "ore a disposizione"),
    ].filter(Boolean);
    const head =
      lessons > 0
        ? many
          ? `Orario svuotato in ${touched} sedi: `
          : "Orario svuotato: "
        : many
          ? `In ${touched} sedi: `
          : "";
    const stay =
      stayedLocked + stayedFixed > 0 ? ` ${stayText(stayedFixed, stayedLocked)}` : "";
    toast(`${head}${what.join(" e ")} ${lessons + disp === 1 ? "tolta" : "tolte"}.${stay}`, {
      duration: 10000,
      action: {
        label: "Annulla",
        onClick: () => {
          const now = allSedi(snapshot(useAppStore.getState()));
          // nel frattempo una sede ha aperto un altro orario: l’orario di prima finirebbe nel posto sbagliato
          const moved = Object.keys(slotOf).some((id) => {
            const sede = now.find((x) => x.id === id);
            return !sede || (sede.data.activeSlot ?? 0) !== slotOf[id];
          });
          if (moved) {
            toast.error("Non si può annullare: nel frattempo è stato aperto un altro orario.");
            return;
          }
          useAppStore.getState().setSediTimetables(before);
        },
      },
    });
  }

  function exportBackup() {
    void shareOrSave(
      `gestione-docenti-backup-${todayIso()}.json`,
      backupJson(snapshot(store)),
      "application/json",
    ).then((outcome) => toastSave(outcome, "backup"));
  }

  function applyImport(parsed: PersistedData, name: string) {
    // dopo l'importazione Oggi riparte da oggi, non dal giorno aperto quando il backup è stato fatto
    store.importData({ ...parsed, selectedDate: dateOnLaunch() }, name);
    // versioni del calcolo lungo nel backup: dice se sono proprio quelle calcolate dal programma
    const longRun = longRunImportNote(parsed);
    if (longRun?.warn) {
      toast.success("Registro importato e salvato su questo dispositivo");
      toast.warning(longRun.text, { duration: 15000 });
    } else {
      toast.success("Registro importato e salvato su questo dispositivo", longRun ? { description: longRun.text } : undefined);
    }
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseBackupJson(String(reader.result));
        const current = snapshot(store);
        const curAt = Number(current.savedAt) || 0;
        const incAt = Number(parsed.savedAt) || 0;
        // lavoro fatto in una qualunque sede, non solo in quella in uso
        const hasWork =
          current.origin === "user" &&
          allSedi(current).some((x) => (x.data.teachers?.length ?? 0) > 0 || (x.data.slots?.length ?? 0) > 0);
        if (hasWork) {
          setPendingImport({ data: parsed, name: file.name, older: curAt > 0 && incAt > 0 && incAt < curAt });
          return;
        }
        applyImport(parsed, file.name);
      } catch {
        toast.error("File non riconosciuto: seleziona il file di backup (.json), non il file Excel.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Impostazioni"
        description="Anno scolastico, aspetto e copie di sicurezza di tutte le sedi."
      />

      <section className="paper-panel mb-4 rounded-xl p-5">
        <h2 className="font-display text-lg">Aspetto</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tema chiaro, scuro o automatico; in automatico il tema scuro si attiva negli orari impostati.
        </p>
        <ThemePicker />
      </section>

      <section className="paper-panel mb-4 rounded-xl p-5">
        <h2 className="font-display text-lg">Anno scolastico</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Uguale per tutte le sedi; compare nell’intestazione dei documenti esportati. Nome, responsabile e orari di
          ogni sede sono nella pagina Sedi.
        </p>
        <div className="mt-4 grid gap-3">
          <Field label="Anno scolastico">
            <Input value={store.settings.schoolYear} onChange={(e) => store.setSchoolYear(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="paper-panel mb-4 rounded-xl p-5">
        <h2 className="font-display text-lg">Salvataggio</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          I dati di tutte le sedi sono salvati solo su questo dispositivo: iPhone, iPad e Mac hanno ciascuno una propria copia. Per trasferirli usa il backup, non il file Excel.
        </p>
        {store.savedAt ? (
          <p className="mt-2 text-[13px] text-foreground">
            Ultimo salvataggio su questo dispositivo:{" "}
            {new Date(store.savedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-warning">Ancora nessun salvataggio su questo dispositivo.</p>
        )}
        <p className="mt-1 text-[13px] text-foreground">
          Backup in uso: {store.importedBackupName?.trim() || "nessuno (dati creati su questo dispositivo)"}
        </p>
        <h3 className="mt-4 text-sm font-medium">Orari salvati · {sedeName(store.settings)}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Lo 0 è l’orario in vigore a scuola; negli slot da 1 a 5 ci sono le prove fatte con Costruisci. Lo slot acceso è
          quello in uso nell’app. Sono compresi nel backup.
        </p>
        <SaveSlots
          className="mt-2"
          onOpen={(n) => void navigate({ to: "/orario", search: { slot: n } })}
        />
        <p className="mt-4 text-sm text-muted-foreground">
          Esporta il backup (su iPhone e iPad tramite Condividi, sul Mac nella cartella Download), poi sull’altro dispositivo usa «Importa backup». Il backup contiene tutte le sedi; importarlo sostituisce tutte le sedi di questo dispositivo. Per aggiungere una sede da un backup usa la pagina Sedi.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportBackup}>
            Esporta backup
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              Importa backup
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
      </section>

      <section className="paper-panel mb-4 rounded-xl p-5">
        <h2 className="font-display text-lg">Nuovo anno scolastico</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          L’anno finito va in archivio{sedi.length > 1 ? " con tutte le sedi insieme, ognuna con i suoi dati," : ""} e si
          consulta in Report; assenze e sostituzioni ripartono da zero, docenti, classi e orario restano. Poi in Docenti
          elimini chi non torna e aggiungi chi arriva.
        </p>
        {archived.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-medium">Anni in archivio</h3>
            <ul className="mt-1 flex flex-col">
              {[...archived].reverse().map((y) => {
                const n = archivedCounts(y);
                return (
                  <li
                    key={y.id}
                    className="flex min-w-0 items-center justify-between gap-3 border-b border-border py-1.5 last:border-0"
                  >
                    <span className="min-w-0 text-sm">
                      {yearLabels.get(y.id)}
                      <span className="text-muted-foreground">
                        {" "}
                        · {countText(n.absences, "assenza", "assenze")},{" "}
                        {countText(n.substitutions, "sostituzione", "sostituzioni")}
                        {n.sedi > 1 ? ` · ${n.sedi} sedi` : ""}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setRemovingYear(y.id)}>
                      Elimina
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="mt-4">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setNewYear(nextSchoolYear(store.settings.schoolYear))}
          >
            Inizia il nuovo anno
          </Button>
        </div>
      </section>

      <section className="paper-panel mb-4 rounded-xl p-5">
        <h2 className="font-display text-lg">Svuota orario</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Toglie le lezioni dell’orario in uso che Costruisci rimette, cioè quelle del mattino dei docenti di materia, e,
          se vuoi, le ore a disposizione: della sede in uso ({sedeName(store.settings)}) o di tutte le sedi. Le ore
          bloccate e quelle che Costruisci non rimette (sostegno, pomeriggio…) restano, se non scegli di togliere anche
          quelle. Restano docenti, classi, cattedre, segni di Costruisci, assenze, sostituzioni e orari salvati negli
          slot.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={!canEmpty}
            onClick={() => {
              // nella sede in uso niente da togliere: si parte da «Tutte le sedi»
              setEmptyAll(
                here.data.slots.length - lockedOf(here.data).length - fixedOf(here.data).length === 0 &&
                  dispOf(here.data) === 0,
              );
              setEmptyOpen(true);
            }}
          >
            Svuota orario
          </Button>
        </div>
      </section>

      <Dialog open={emptyOpen} onOpenChange={(open) => (open ? setEmptyOpen(true) : closeEmpty())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Svuotare l’orario?</DialogTitle>
            <DialogDescription>
              {scopeLessons === 0 && scopeDisp === 0
                ? emptyAll
                  ? "Gli orari di tutte le sedi sono già vuoti."
                  : `L’${inUseNameOf(here.data)} di ${sedeName(here.data.settings)} è già vuoto.`
                : emptyAll
                  ? onlyDisp
                    ? scopeDisp > 0
                      ? "Le sedi non hanno lezioni da togliere: si tolgono le ore a disposizione rimaste."
                      : "Le sedi non hanno lezioni da togliere."
                    : `Si ${removable === 1 ? "toglie" : "tolgono"} ${countText(removable, "lezione", "lezioni")} dall’orario in uso di tutte le sedi (${sedi.length}).`
                  : onlyDisp
                    ? scopeDisp > 0
                      ? `L’${inUseNameOf(here.data)} di ${sedeName(here.data.settings)} non ha lezioni da togliere: si tolgono le ore a disposizione rimaste.`
                      : `L’${inUseNameOf(here.data)} di ${sedeName(here.data.settings)} non ha lezioni da togliere.`
                    : `Si ${removable === 1 ? "toglie" : "tolgono"} ${countText(removable, "lezione", "lezioni")} dall’${inUseNameOf(here.data)} di ${sedeName(here.data.settings)}. Le altre sedi non cambiano.`}
              {stayText(emptyFixed ? 0 : scopeFixed, emptyLocked ? 0 : scopeLocked) &&
                ` ${stayText(emptyFixed ? 0 : scopeFixed, emptyLocked ? 0 : scopeLocked)}`}{" "}
              Restano docenti, classi, cattedre, segni di Costruisci, assenze, sostituzioni e orari salvati negli slot.
            </DialogDescription>
          </DialogHeader>
          {sedi.length > 1 && (
            <div role="radiogroup" aria-label="Quali sedi" className="mb-3 divide-y divide-border rounded-lg border border-border">
              {[false, true].map((all) => {
                const list = all ? sedi : [here];
                const n = list.reduce((k, x) => k + x.data.slots.length, 0);
                return (
                  <label key={String(all)} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="svuota-sedi"
                      className="size-4 shrink-0 accent-primary"
                      checked={emptyAll === all}
                      onChange={() => setEmptyAll(all)}
                    />
                    <span className="min-w-0 flex-1">
                      {all ? `Tutte le sedi (${sedi.length})` : `Solo ${sedeName(here.data.settings)}`}
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {countText(n, "lezione", "lezioni")}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {scopeLocked > 0 && (
            <label className="mb-2 flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={emptyLocked}
                onChange={(e) => setEmptyLocked(e.target.checked)}
              />
              Togli anche le ore bloccate ({scopeLocked})
            </label>
          )}
          {scopeFixed > 0 && (
            <label className="mb-2 flex min-h-10 items-start gap-2 py-1 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={emptyFixed}
                onChange={(e) => setEmptyFixed(e.target.checked)}
              />
              <span className="flex min-w-0 flex-col">
                <span>Togli anche le ore che Costruisci non rimette ({scopeFixed})</span>
                <span className="text-[12px] text-muted-foreground">{fixedKindsNote(scopeKinds)}</span>
              </span>
            </label>
          )}
          {scopeDisp > 0 && (
            <label className="mb-2 flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={emptyDisp || onlyDisp}
                disabled={onlyDisp}
                onChange={(e) => setEmptyDisp(e.target.checked)}
              />
              Togli anche le ore a disposizione ({scopeDisp})
            </label>
          )}
          <p className="mb-4 text-[12px] text-muted-foreground">
            Subito dopo puoi tornare indietro con «Annulla». Per conservare una copia, esporta il backup o salva
            l’orario in uno slot.
          </p>
          <DialogActions
            primary={
              <Button variant="destructive" disabled={removable === 0 && scopeDisp === 0} onClick={emptyTimetable}>
                {onlyDisp ? "Togli le ore a disposizione" : "Svuota orario"}
              </Button>
            }
          >
            <Button variant="outline" onClick={exportBackup}>
              Esporta backup
            </Button>
            <Button variant="outline" onClick={closeEmpty}>
              Annulla
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <section className="paper-panel rounded-xl p-5">
        <h2 className="font-display text-lg">Cancella tutti i dati</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elimina da questo dispositivo tutte le sedi con docenti, orario, assenze, sostituzioni e impostazioni.
          L’operazione è irreversibile: esporta prima un backup.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              setClearStep(1);
              setClearOpen(true);
            }}
          >
            Cancella tutti i dati
          </Button>
        </div>
      </section>

      <Dialog
        open={clearOpen}
        onOpenChange={(open) => {
          setClearOpen(open);
          if (!open) setClearStep(1);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {clearStep === 1 ? "Cancellare tutti i dati?" : "Ultima conferma"}
            </DialogTitle>
            <DialogDescription>
              {clearStep === 1
                ? "Verranno eliminate tutte le sedi, con docenti, orario, assenze, sostituzioni e impostazioni salvati su questo dispositivo."
                : "L’operazione è irreversibile: esporta prima un backup se vuoi conservarne una copia."}
            </DialogDescription>
          </DialogHeader>
          <DialogActions
            primary={
              clearStep === 1 ? (
                <Button onClick={() => setClearStep(2)}>Sì, continua</Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => {
                    store.clearAll();
                    setClearOpen(false);
                    setClearStep(1);
                    toast.message("Dati cancellati");
                  }}
                >
                  Cancella ora
                </Button>
              )
            }
          >
            <Button
              variant="outline"
              onClick={() => {
                setClearOpen(false);
                setClearStep(1);
              }}
            >
              Annulla
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={newYear !== null} onOpenChange={(o) => !o && setNewYear(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniziare il nuovo anno scolastico?</DialogTitle>
            <DialogDescription>
              {newYearText(
                store.settings.schoolYear,
                sedi.reduce((n, x) => n + x.data.absences.length, 0),
                sedi.reduce((n, x) => n + x.data.substitutions.length, 0),
                formerPersons(snapshot(store)).length,
                sedi.length > 1,
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            {sedi.length > 1 && (
              <ul className="grid gap-1 text-[13px]">
                {sedi.map((x) => {
                  const text = countsText(
                    x.data.absences.length,
                    x.data.substitutions.length,
                    x.data.formerTeachers?.length ?? 0,
                  );
                  return text ? (
                    <li key={x.id}>
                      <span className="font-medium">{sedeName(x.data.settings)}</span>: {text}
                    </li>
                  ) : null;
                })}
              </ul>
            )}
            <p>
              Assenze e sostituzioni ripartono da zero. Restano docenti, classi, orario (anche gli orari salvati negli
              slot{sedi.length > 1 ? ", compresi quelli di tutte le sedi insieme" : ""}),{" "}
              {sedi.length > 1 ? "campanelle e impostazioni di ogni sede" : "campanella e impostazioni"}. Dopo, in
              Docenti, elimini chi non torna e aggiungi chi arriva: gli anni in archivio non cambiano.
            </p>
            <Field label={sedi.length > 1 ? "Nuovo anno scolastico (tutte le sedi)" : "Nuovo anno scolastico"}>
              <Input value={newYear ?? ""} onChange={(e) => setNewYear(e.target.value)} />
            </Field>
            {sameYear && <p className="text-[12px] text-destructive">Scrivi un anno diverso da quello in corso.</p>}
            <p className="text-[12px] text-muted-foreground">
              Non si può annullare. Se vuoi anche una copia su file, prima esporta il backup.
            </p>
          </div>
          <DialogActions
            className="border-t border-border pt-3"
            primary={
              <Button
                variant="destructive"
                disabled={sameYear || !(newYear ?? "").trim()}
                onClick={() => {
                  store.startNewSchoolYear(newYear ?? "");
                  setNewYear(null);
                  toast.message("Nuovo anno scolastico iniziato");
                }}
              >
                Inizia il nuovo anno
              </Button>
            }
          >
            <Button variant="outline" onClick={exportBackup}>
              Esporta backup
            </Button>
            <Button variant="outline" onClick={() => setNewYear(null)}>
              Annulla
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={removingYear !== null} onOpenChange={(o) => !o && setRemovingYear(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminare l’anno {yearLabels.get(removingYear ?? "")} dall’archivio?</DialogTitle>
            <DialogDescription>
              Le sue assenze e sostituzioni{sedi.length > 1 ? ", di tutte le sedi," : ""} non si potranno più consultare
              in Report. L’anno in corso non cambia. Non si può annullare: se vuoi una copia, prima esporta il backup.
            </DialogDescription>
          </DialogHeader>
          <DialogActions
            primary={
              <Button
                variant="destructive"
                onClick={() => {
                  if (removingYear) store.removeArchivedYear(removingYear);
                  setRemovingYear(null);
                  toast.message("Anno eliminato dall’archivio");
                }}
              >
                Elimina
              </Button>
            }
          >
            <Button variant="outline" onClick={exportBackup}>
              Esporta backup
            </Button>
            <Button variant="outline" onClick={() => setRemovingYear(null)}>
              Annulla
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingImport)} onOpenChange={(o) => !o && setPendingImport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingImport?.older ? "Questo backup è più vecchio" : "Sostituire i dati di questo dispositivo?"}</DialogTitle>
            <DialogDescription>
              {pendingImport?.older
                ? "Su questo dispositivo ci sono modifiche più recenti. Importandolo, si torna a quel backup e le modifiche successive andranno perse."
                : "Importando il file, tutti i dati di questo dispositivo vengono sostituiti. Non si può annullare: per conservarli, prima esporta un backup."}
            </DialogDescription>
          </DialogHeader>
          {pendingImport && (
            <dl className="mt-3 grid gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <div>
                <dt className="text-[12px] text-muted-foreground">Ora sul dispositivo</dt>
                <dd>{registerSummary(snapshot(store))}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Nel file</dt>
                <dd>{registerSummary(pendingImport.data)}</dd>
              </div>
            </dl>
          )}
          {pendingImport && <LongRunNote data={pendingImport.data} />}
          <DialogActions
            primary={
              <Button
                onClick={() => {
                  if (!pendingImport) return;
                  applyImport(pendingImport.data, pendingImport.name);
                  setPendingImport(null);
                }}
              >
                {pendingImport?.older ? "Importa comunque" : "Sì, sostituisci"}
              </Button>
            }
          >
            <Button variant="outline" onClick={() => setPendingImport(null)}>
              Annulla
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function countText(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** Nel dialogo dell'importazione: le versioni del calcolo lungo nel file, e se vengono proprio dal programma. */
function LongRunNote({ data }: { data: PersistedData }) {
  const note = longRunImportNote(data);
  if (!note) return null;
  return (
    <p
      className={
        note.warn
          ? "mt-3 rounded-md border border-warning/60 bg-warning-soft px-3 py-2 text-sm"
          : "mt-3 text-sm text-muted-foreground"
      }
    >
      {note.text}
    </p>
  );
}

/** Cosa c'è in un registro, in una riga (tutte le sedi): serve a confrontare il file con i dati del dispositivo. */
function registerSummary(d: PersistedData): string {
  const sedi = allSedi(d);
  const sum = (f: (x: PersistedData) => number) => sedi.reduce((n, s) => n + f(s.data as unknown as PersistedData), 0);
  return [
    countText(sedi.length, "sede", "sedi"),
    countText(sum((x) => x.teachers?.length ?? 0), "docente", "docenti"),
    countText(sum((x) => x.classes?.length ?? 0), "classe", "classi"),
    countText(sum((x) => x.absences?.length ?? 0), "assenza", "assenze"),
    countText(sum((x) => x.substitutions?.length ?? 0), "sostituzione", "sostituzioni"),
  ].join(", ");
}

function newYearText(year: string, absences: number, substitutions: number, former: number, several: boolean): string {
  const name = year.trim() || "in corso";
  if (absences + substitutions === 0) {
    const left =
      former === 0
        ? ""
        : former === 1
          ? " Il docente non più in servizio esce dall’elenco."
          : ` I ${former} docenti non più in servizio escono dall’elenco.`;
    return `L’anno ${name} non ha assenze né sostituzioni${several ? " in nessuna sede" : ""}: non c’è niente da mettere in archivio.${left}`;
  }
  const left =
    former === 0
      ? ""
      : former === 1
        ? " Il docente non più in servizio esce dall’elenco e resta nell’anno in archivio."
        : ` I ${former} docenti non più in servizio escono dall’elenco e restano nell’anno in archivio.`;
  return `L’anno ${name} va in archivio${several ? ", con tutte le sedi," : ""} con ${countText(absences, "assenza", "assenze")} e ${countText(substitutions, "sostituzione", "sostituzioni")}: lo ritrovi in Report, scegliendo l’anno, così com’è oggi.${left}`;
}

/** Le voci di una sede per la finestra del nuovo anno, senza quelle a zero. */
function countsText(absences: number, substitutions: number, former: number): string {
  const parts = [
    absences ? (absences === 1 ? "1 assenza" : `${absences} assenze`) : "",
    substitutions ? (substitutions === 1 ? "1 sostituzione" : `${substitutions} sostituzioni`) : "",
    former ? (former === 1 ? "1 docente non più in servizio" : `${former} docenti non più in servizio`) : "",
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : (parts[0] ?? "");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

