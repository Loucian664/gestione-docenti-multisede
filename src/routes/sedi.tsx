import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout";
import { CampanellaEditor } from "@/components/campanella-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore, snapshot } from "@/lib/store";
import { parseBackupJson } from "@/lib/export";
import { allSedi, canRemoveSede, nameMatches, pickSede, sedeName, type SedeEntry } from "@/lib/sedi";
import { teacherName } from "@/lib/coverage";
import { DAY_SHORT, type PersistedData, type SedeData, type Teacher } from "@/lib/types";
import { FileUp, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/sedi")({ component: SediPage });

function SediPage() {
  const store = useAppStore();
  const data = snapshot(store);
  const sedi = allSedi(data);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<{ data: PersistedData; fileName: string } | null>(null);

  // docenti che insegnano anche in un'altra sede (stessa persona)
  const sharedIds = new Map<string, Set<string>>();
  for (const s of sedi) {
    for (const t of s.data.teachers) {
      if (!t.personId) continue;
      const set = sharedIds.get(t.personId) ?? new Set<string>();
      set.add(s.id);
      sharedIds.set(t.personId, set);
    }
  }
  const sharedCount = (s: SedeEntry) =>
    s.data.teachers.filter((t) => t.personId && (sharedIds.get(t.personId)?.size ?? 0) > 1).length;

  function readBackup(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setPending({ data: parseBackupJson(String(reader.result)), fileName: file.name });
      } catch {
        toast.error("File non riconosciuto: seleziona il file di backup (.json), non il file Excel.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div>
      <PageHeader
        title="Sedi"
        description="Le sedi dell’istituto, ciascuna con classi, docenti e campanella. Quella in uso si sceglie nel menu."
        actions={
          <>
            <Button onClick={() => setAdding(true)}>
              <Plus />
              Aggiungi sede
            </Button>
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <FileUp />
                Aggiungi da backup
                <input
                  type="file"
                  accept=".json,application/json,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readBackup(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {sedi.map((s) => (
          <SedeCard
            key={s.id}
            sede={s}
            shared={sharedCount(s)}
            onUse={() => {
              store.switchSede(s.id);
              toast.message(`Sede in uso: ${sedeName(s.data.settings)}`);
            }}
            onEdit={() => setEditing(s.id)}
          />
        ))}
      </div>
      {editing && <SedeDialog key={editing} sedeId={editing} onClose={() => setEditing(null)} />}
      {adding && <AddSedeDialog onClose={() => setAdding(false)} />}
      {pending && (
        <ImportSedeDialog incoming={pending.data} fileName={pending.fileName} onClose={() => setPending(null)} />
      )}
    </div>
  );
}

function daysLabel(days: number[]): string {
  const sorted = [...days].sort();
  if (!sorted.length) return "nessun giorno";
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  const short = (d: number) => DAY_SHORT[d as keyof typeof DAY_SHORT];
  return contiguous && sorted.length > 2
    ? `${short(sorted[0]!)}–${short(sorted[sorted.length - 1]!)}`
    : sorted.map(short).join(", ");
}

/** «6 ore, 8:00–14:00 · pomeriggio fino alle 16:25» */
function campanellaLabel(sede: SedeData): string {
  const morning = sede.settings.periods.filter((p) => !p.tpOnly);
  const afternoon = sede.settings.periods.filter((p) => p.tpOnly);
  const lessons = morning.filter((p) => !/mensa/i.test(p.label));
  const first = morning[0];
  const last = morning[morning.length - 1];
  const strip = (t: string) => t.replace(/^0/, "");
  let out = `${lessons.length} ${lessons.length === 1 ? "ora" : "ore"}`;
  if (first && last) out += `, ${strip(first.start)}–${strip(last.end)}`;
  const end = afternoon[afternoon.length - 1];
  if (sede.settings.tpAfternoon && end) out += ` · pomeriggio fino alle ${strip(end.end)}`;
  return out;
}

function SedeCard({
  sede,
  shared,
  onUse,
  onEdit,
}: {
  sede: SedeEntry;
  shared: number;
  onUse: () => void;
  onEdit: () => void;
}) {
  const { settings, classes, teachers } = sede.data;
  const tp = classes.filter((c) => c.tempo === "TP").length;
  return (
    <section className="paper-panel flex flex-col rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl">{sedeName(settings)}</h2>
        {sede.active && <Badge>In uso</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <Row label="Responsabile">{settings.responsabile.trim() || <span className="text-muted-foreground">non indicato</span>}</Row>
        <Row label="Giorni">{daysLabel(settings.days)}</Row>
        <Row label="Campanella">{campanellaLabel(sede.data)}</Row>
        <Row label="Classi">
          {classes.length}
          {tp > 0 ? ` (${tp} a tempo prolungato)` : ""}
        </Row>
        <Row label="Docenti">
          {teachers.length}
          {shared > 0 ? ` · ${shared} in comune con altre sedi` : ""}
        </Row>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        {!sede.active && <Button onClick={onUse}>Usa questa sede</Button>}
        <Button variant="outline" onClick={onEdit}>
          Modifica
        </Button>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </>
  );
}

function SedeDialog({ sedeId, onClose }: { sedeId: string; onClose: () => void }) {
  const store = useAppStore();
  const data = snapshot(store);
  const sede = allSedi(data).find((s) => s.id === sedeId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!sede) return null;
  const settings = sede.data.settings;
  const removable = canRemoveSede(data, sedeId);
  const update = (patch: Parameters<typeof store.updateSede>[1]) => store.updateSede(sedeId, patch);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader className="sticky top-0 z-10 mb-0 bg-popover pb-4">
          <DialogTitle>{sedeName(settings)}</DialogTitle>
          <DialogDescription>Le modifiche si salvano subito.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Nome della sede">
            <Input value={settings.schoolName} onChange={(e) => update({ schoolName: e.target.value })} placeholder="Es. il paese" />
          </Field>
          <Field label="Responsabile di plesso">
            <Input
              value={settings.responsabile}
              onChange={(e) => update({ responsabile: e.target.value })}
              placeholder="Cognome e nome"
            />
          </Field>
          <div className="mt-2">
            <h3 className="text-sm font-medium">Orario giornaliero</h3>
            <p className="mt-0.5 mb-3 text-[13px] text-muted-foreground">
              Orari di inizio e fine delle lezioni di questa sede. Mensa, 7ª e 8ª ora compaiono solo se attivi la fascia
              pomeridiana.
            </p>
            <CampanellaEditor settings={settings} onChange={update} />
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-popover pt-3">
            {confirmDelete ? (
              <>
                <span className="text-sm">Eliminare questa sede?</span>
                <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                  No
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    store.removeSede(sedeId);
                    toast.message("Sede eliminata");
                    onClose();
                  }}
                >
                  Sì, elimina
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={!removable}
                onClick={() => setConfirmDelete(true)}
                title={removable ? undefined : "Si elimina solo una sede senza classi, e mai l’ultima"}
              >
                Elimina sede
              </Button>
            )}
            <Button className="ml-auto" onClick={onClose}>
              Fatto
            </Button>
          </div>
          {!removable && (
            <p className="-mt-1 text-[12px] text-muted-foreground">
              Per eliminare una sede togli prima le sue classi; l’ultima sede non si elimina.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddSedeDialog({ onClose }: { onClose: () => void }) {
  const store = useAppStore();
  const [name, setName] = useState("");
  const taken = allSedi(snapshot(store)).some(
    (s) => sedeName(s.data.settings).toLowerCase() === name.trim().toLowerCase(),
  );

  function add() {
    if (!name.trim()) return;
    const id = store.addSede(name.trim());
    toast.success(`Sede «${name.trim()}» aggiunta`, {
      action: { label: "Usala ora", onClick: () => useAppStore.getState().switchSede(id) },
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova sede</DialogTitle>
          <DialogDescription>
            Parte senza classi né docenti, con giorni e campanella della sede in uso: se sono diversi li cambi con
            «Modifica».
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label="Nome della sede">
            <Input id="nuova-sede" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. il paese" autoFocus />
          </Field>
          {taken && <p className="-mt-1 text-[12px] text-warning">C’è già una sede con questo nome.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Aggiungi
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportSedeDialog({
  incoming,
  fileName,
  onClose,
}: {
  incoming: PersistedData;
  fileName: string;
  onClose: () => void;
}) {
  const store = useAppStore();
  const data = snapshot(store);
  const sede = pickSede(incoming);
  const [name, setName] = useState(sedeName(sede.settings));
  const matches = nameMatches(data, sede.teachers);
  // per ogni docente del backup già presente: collegato (stessa persona) salvo scelta diversa
  const [linked, setLinked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(matches.map((m) => [m.incoming.id, true])),
  );
  const taken = allSedi(data).some((s) => sedeName(s.data.settings).toLowerCase() === name.trim().toLowerCase());
  const several = (incoming.altreSedi?.length ?? 0) > 0;

  function confirm() {
    const links = matches
      .filter((m) => linked[m.incoming.id])
      .map((m) => ({ incomingId: m.incoming.id, sedeId: m.matches[0]!.sedeId, teacherId: m.matches[0]!.teacher.id }));
    const named: PersistedData = { ...incoming, settings: { ...incoming.settings, schoolName: name.trim() || sedeName(sede.settings) } };
    const id = store.importSede(named, links);
    toast.success(`Sede «${sedeName(named.settings)}» aggiunta da ${fileName}`, {
      action: { label: "Usala ora", onClick: () => useAppStore.getState().switchSede(id) },
    });
    onClose();
  }

  const otherSedi = (t: Teacher) =>
    matches
      .find((m) => m.incoming.id === t.id)
      ?.matches.map((x) => x.sedeName)
      .join(", ");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader className="sticky top-0 z-10 mb-0 bg-popover pb-4">
          <DialogTitle>Aggiungi sede da backup</DialogTitle>
          <DialogDescription>
            Le sedi già presenti restano come sono. Dal file: {sede.classes.length} classi, {sede.teachers.length} docenti
            {sede.slots.length ? ", con il loro orario" : ""}.
            {several ? " Il backup contiene più sedi: prendo solo quella che era in uso." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Nome della sede">
            <Input id="sede-da-backup" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {taken && <p className="-mt-1 text-[12px] text-warning">C’è già una sede con questo nome.</p>}
          {matches.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium">Docenti già presenti in altre sedi</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Stesso cognome e nome: se è la stessa persona, l’app la tratta come docente in comune (× automatiche e
                ora di spostamento). Togli la spunta se è un omonimo.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {matches.map((m) => (
                  <li key={m.incoming.id}>
                    <label className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={Boolean(linked[m.incoming.id])}
                        onChange={(e) => setLinked((all) => ({ ...all, [m.incoming.id]: e.target.checked }))}
                      />
                      <span className="font-medium">{teacherName(m.incoming)}</span>
                      <span className="text-muted-foreground">· anche a {otherSedi(m.incoming)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Nessun docente del file è già presente nelle altre sedi.</p>
          )}
          <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-popover pt-3">
            <Button variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button onClick={confirm}>Aggiungi sede</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
