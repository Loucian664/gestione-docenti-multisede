import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/dialog-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { useAppStore, snapshot } from "@/lib/store";
import { allSedi, classInUse, missingBySede, sedeIdOf, sedeName, type SedeEntry } from "@/lib/sedi";
import type { MissingTeacher } from "@/lib/build-timetable";
import { TN_NOTE } from "@/components/missing-teachers";
import type { SchoolClass, Tempo } from "@/lib/types";
import { Plus } from "lucide-react";
import { countOf } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/classi")({ component: ClassiPage });

function tempoLabel(tempo: Tempo): string {
  return tempo === "TN" ? "Tempo normale" : "Tempo prolungato";
}

const ALL = "tutte";

/** Alunni delle classi date (quelle senza numero contano 0). */
function pupils(list: SchoolClass[]): number {
  return list.reduce((n, c) => n + (c.students ?? 0), 0);
}

function listText(names: string[]): string {
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function ClassiPage() {
  const store = useAppStore();
  const data = snapshot(store);
  const sedi = allSedi(data);
  const [filter, setFilter] = useState(() => sedeIdOf(data));
  const [editing, setEditing] = useState<{ value: SchoolClass | "new"; sedeId: string } | null>(null);
  const shown = filter === ALL ? sedi : sedi.filter((s) => s.id === filter);
  const several = sedi.length > 1;
  // ore senza docente di ogni classe: accanto al suo nome
  const missing = useMemo(() => missingBySede(data), [data]);
  // alunni delle sedi mostrate: in tutto e per tempo scuola; le classi senza numero si dicono a parte
  const shownClasses = shown.flatMap((s) => s.data.classes);
  const total = pupils(shownClasses);
  const tn = pupils(shownClasses.filter((c) => c.tempo === "TN"));
  const tp = total - tn;
  const noCount = shown
    .flatMap((s) =>
      s.data.classes
        .filter((c) => !c.students)
        .map((c) => (filter === ALL && several ? `${c.name} (${sedeName(s.data.settings)})` : c.name)),
    )
    .sort((a, b) => a.localeCompare(b, "it"));

  function saveTempo(sedeId: string, c: SchoolClass, tempo: Tempo) {
    if (c.tempo === tempo) return;
    store.updateClassIn(sedeId, c.id, { tempo });
    toast.success(`${c.name}: ${tempoLabel(tempo)}`);
  }

  return (
    <div>
      <PageHeader
        title="Classi"
        description="Classi di ogni sede e tempo scuola (normale o prolungato). Il tempo scelto dalla tendina viene salvato subito."
        actions={
          <Button
            onClick={() => setEditing({ value: "new", sedeId: filter === ALL ? sedeIdOf(data) : filter })}
          >
            <Plus />
            Nuova classe
          </Button>
        }
      />
      {several && (
        <div className="mb-4 max-w-xs">
          <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Sede">
            <option value={ALL}>Tutte le sedi</option>
            {sedi.map((s) => (
              <option key={s.id} value={s.id}>
                {sedeName(s.data.settings)}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {shownClasses.length > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {total > 0 && (
            <>
              Totale: <span className="font-medium text-foreground">{countOf(total, "alunno", "alunni")}</span> in{" "}
              {countOf(shownClasses.length, "classe", "classi")}
              {tn > 0 && tp > 0 ? ` · ${tn} a tempo normale, ${tp} a tempo prolungato` : ""}.
            </>
          )}
          {noCount.length > 0 && ` ${total > 0 ? "Manca" : "Manca ancora"} il numero di alunni di ${listText(noCount)}.`}
        </p>
      )}
      <div className="flex flex-col gap-6">
        {shown.map((s) => (
          <SedeClasses
            key={s.id}
            sede={s}
            missing={missing.find((m) => m.sedeId === s.id)?.items ?? []}
            title={filter === ALL}
            onEdit={(c) => setEditing({ value: c, sedeId: s.id })}
            onTempo={(c, tempo) => saveTempo(s.id, c, tempo)}
          />
        ))}
      </div>
      {editing && (
        <ClassDialog
          key={editing.value === "new" ? "new" : editing.value.id}
          value={editing.value}
          sedeId={editing.sedeId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SedeClasses({
  sede,
  missing,
  title,
  onEdit,
  onTempo,
}: {
  sede: SedeEntry;
  missing: MissingTeacher[];
  title: boolean;
  onEdit: (c: SchoolClass) => void;
  onTempo: (c: SchoolClass, tempo: Tempo) => void;
}) {
  const grouped = [1, 2, 3] as const;
  const sedeSum = pupils(sede.data.classes);
  return (
    <section>
      {title && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg">{sedeName(sede.data.settings)}</h2>
          {sedeSum > 0 && (
            <span className="text-[13px] text-muted-foreground">{countOf(sedeSum, "alunno", "alunni")}</span>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {grouped.map((grade) => {
          const items = sede.data.classes
            .filter((c) => c.grade === grade)
            .sort((a, b) => a.section.localeCompare(b.section));
          const sum = pupils(items);
          return (
            <section key={grade} className="paper-panel rounded-xl p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-xl">{grade}ª</h3>
                {sum > 0 && (
                  <span className="text-[13px] text-muted-foreground">{countOf(sum, "alunno", "alunni")}</span>
                )}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5">
                {items.map((c) => {
                  const without = missing.filter((m) => m.classId === c.id && !m.tn);
                  const extra = missing.filter((m) => m.classId === c.id && m.tn);
                  return (
                  <li key={c.id} className="flex items-center gap-2 rounded-md px-1 hover:bg-muted">
                    <button
                      type="button"
                      onClick={() => onEdit(c)}
                      className="flex min-h-12 min-w-0 flex-1 flex-col justify-center text-left"
                    >
                      <span>
                        <span className="font-medium">{c.name}</span>
                        {c.students ? (
                          <span className="ml-2 text-[13px] text-muted-foreground">{c.students} alunni</span>
                        ) : null}
                      </span>
                      {without.length > 0 && (
                        <span className="text-[12px] leading-snug text-warning">
                          Senza docente: {without.map((m) => `${m.subject} ${m.hours} h`).join(", ")}
                        </span>
                      )}
                      {extra.length > 0 && (
                        <span className="text-[12px] leading-snug text-warning" title={`${TN_NOTE}.`}>
                          {extra.map((m) => `${m.subject} ${m.hours} h`).join(", ")} in una classe a tempo normale
                        </span>
                      )}
                    </button>
                    {/* larga quanto la scelta più lunga: «Tempo prolungato» si legge anche sul telefono */}
                    <NativeSelect
                      value={c.tempo}
                      aria-label={`Tempo ${c.name}`}
                      className="h-10 w-auto shrink-0"
                      onChange={(e) => onTempo(c, e.target.value as Tempo)}
                    >
                      <option value="TN">Tempo normale</option>
                      <option value="TP">Tempo prolungato</option>
                    </NativeSelect>
                  </li>
                  );
                })}
                {items.length === 0 && <p className="px-3 text-sm text-muted-foreground">Nessuna sezione presente.</p>}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ClassDialog({
  value,
  sedeId,
  onClose,
}: {
  value: SchoolClass | "new";
  sedeId: string;
  onClose: () => void;
}) {
  const store = useAppStore();
  const sedi = allSedi(snapshot(store));
  const isNew = value === "new";
  const current = isNew || !value ? null : value;
  const [grade, setGrade] = useState<1 | 2 | 3>(current?.grade ?? 1);
  const [section, setSection] = useState(current?.section ?? "A");
  const [students, setStudents] = useState(String(current?.students ?? 22));
  const [tempo, setTempo] = useState<Tempo>(current?.tempo ?? "TN");
  const [sede, setSede] = useState(sedeId);
  const home = sedi.find((s) => s.id === sedeId);
  // una classe con lezioni o cattedre resta nella sua sede
  const locked = Boolean(current && home && classInUse(home.data, current.id));
  const [askDelete, setAskDelete] = useState(false);
  const lessonsLost = current ? (home?.data.slots ?? []).filter((s) => s.classId === current.id).length : 0;
  const cattedreLost = current ? (home?.data.cattedre ?? []).filter((x) => x.classId === current.id).length : 0;
  const lostText = [
    lessonsLost > 0 && `${lessonsLost} ${lessonsLost === 1 ? "lezione" : "lezioni"} dell’orario`,
    cattedreLost > 0 && `${cattedreLost} ${cattedreLost === 1 ? "cattedra" : "cattedre"}`,
  ]
    .filter(Boolean)
    .join(" e ");
  const lostSentence = lostText ? `Si tolgono anche ${lostText}.` : "La classe non ha lezioni né cattedre.";

  function save() {
    const name = `${grade}ª ${section.trim().toUpperCase()}`;
    const payload = {
      name,
      grade,
      section: section.trim().toUpperCase(),
      students: Number(students) || 0,
      tempo,
    };
    if (isNew) store.addClassIn(sede, payload);
    else if (current) {
      store.updateClassIn(sedeId, current.id, payload);
      if (sede !== sedeId && !store.moveClass(sedeId, current.id, sede)) {
        toast.error("La classe ha già lezioni o cattedre: resta nella sua sede.");
        onClose();
        return;
      }
    }
    toast.success("Classe salvata");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "Nuova classe" : "Modifica classe"}</DialogTitle>
        </DialogHeader>
        {askDelete && current ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Eliminare la classe <strong>{current.name}</strong>?
            </p>
            <p className="text-sm text-muted-foreground">
              {lostSentence} Non si può annullare. Per conservarne una copia, prima esporta il backup in Impostazioni.
            </p>
            <DialogActions
              className="pt-2"
              primary={
                <Button
                  variant="destructive"
                  onClick={() => {
                    store.removeClassIn(sedeId, current.id);
                    toast.message("Classe eliminata");
                    onClose();
                  }}
                >
                  Sì, elimina
                </Button>
              }
            >
              <Button variant="outline" onClick={() => setAskDelete(false)}>
                Annulla
              </Button>
            </DialogActions>
          </div>
        ) : (
        <div className="grid min-w-0 gap-3">
          {sedi.length > 1 && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Sede</Label>
              <NativeSelect value={sede} onChange={(e) => setSede(e.target.value)} disabled={locked}>
                {sedi.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sedeName(s.data.settings)}
                  </option>
                ))}
              </NativeSelect>
              {locked && (
                <p className="text-[12px] text-muted-foreground">
                  Ha già lezioni o cattedre in questa sede: per spostarla toglile prima.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Anno</Label>
              <NativeSelect value={String(grade)} onChange={(e) => setGrade(Number(e.target.value) as 1 | 2 | 3)}>
                <option value="1">1ª</option>
                <option value="2">2ª</option>
                <option value="3">3ª</option>
              </NativeSelect>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Sezione</Label>
              <Input value={section} onChange={(e) => setSection(e.target.value)} maxLength={2} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Alunni</Label>
            <Input type="number" min={0} value={students} onChange={(e) => setStudents(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tempo</Label>
            <NativeSelect
              value={tempo}
              onChange={(e) => {
                const next = e.target.value as Tempo;
                setTempo(next);
                if (current) {
                  store.updateClassIn(sedeId, current.id, { tempo: next });
                  toast.success(`${current.name}: ${tempoLabel(next)}`);
                }
              }}
            >
              <option value="TN">Tempo normale</option>
              <option value="TP">Tempo prolungato</option>
            </NativeSelect>
          </div>
          <DialogActions className="pt-2" primary={<Button onClick={save}>Salva</Button>}>
            {!isNew && current && (
              <Button variant="outline" onClick={() => setAskDelete(true)}>
                Elimina
              </Button>
            )}
          </DialogActions>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
