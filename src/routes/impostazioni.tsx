import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout";
import { ThemePicker } from "@/components/theme-toggle";
import { SaveSlots } from "@/components/save-slots";
import { Button } from "@/components/ui/button";
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
import { shareOrSave, toastSave } from "@/lib/share-file";
import type { PersistedData } from "@/lib/types";
import { sedeName } from "@/lib/sedi";
import { toast } from "sonner";

export const Route = createFileRoute("/impostazioni")({ component: ImpostazioniPage });

function ImpostazioniPage() {
  const store = useAppStore();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearStep, setClearStep] = useState<1 | 2>(1);
  const [pendingImport, setPendingImport] = useState<{ data: PersistedData; name: string } | null>(null);

  function applyImport(parsed: PersistedData, name: string) {
    store.importData(parsed, name);
    toast.success("Registro importato e salvato su questo dispositivo");
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseBackupJson(String(reader.result));
        const current = snapshot(store);
        const curAt = Number(current.savedAt) || 0;
        const incAt = Number(parsed.savedAt) || 0;
        const hasWork =
          current.origin === "user" &&
          ((current.teachers?.length ?? 0) > 0 || (current.slots?.length ?? 0) > 0);
        if (hasWork && curAt > 0 && incAt > 0 && incAt < curAt) {
          setPendingImport({ data: parsed, name: file.name });
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
          <Button
            variant="outline"
            onClick={() => {
              void shareOrSave(
                `gestione-docenti-backup-${store.selectedDate}.json`,
                backupJson(snapshot(store)),
                "application/json",
              ).then((outcome) => toastSave(outcome, "backup"));
            }}
          >
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setClearOpen(false);
                setClearStep(1);
              }}
            >
              Annulla
            </Button>
            {clearStep === 1 ? (
              <Button className="min-h-11" onClick={() => setClearStep(2)}>
                Sì, continua
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="min-h-11"
                onClick={() => {
                  store.clearAll();
                  setClearOpen(false);
                  setClearStep(1);
                  toast.message("Dati cancellati");
                }}
              >
                Cancella ora
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingImport)} onOpenChange={(o) => !o && setPendingImport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Questo backup è più vecchio</DialogTitle>
            <DialogDescription>
              Su questo dispositivo ci sono modifiche più recenti. Importandolo, si torna a quel backup e le modifiche successive andranno perse.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setPendingImport(null)}>
              Annulla
            </Button>
            <Button
              className="min-h-11"
              onClick={() => {
                if (!pendingImport) return;
                applyImport(pendingImport.data, pendingImport.name);
                setPendingImport(null);
              }}
            >
              Importa comunque
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
