import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";

export const Route = createFileRoute("/classi")({ component: ClassiPage });

function tempoLabel(tempo: Tempo): string {
  return tempo === "TN" ? "Tempo normale" : "Tempo prolungato";
}

const ALL = "tutte";

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
  return (
    <section>
      {title && <h2 className="mb-2 font-display text-lg">{sedeName(sede.data.settings)}</h2>}
      <div className="grid gap-4 md:grid-cols-3">
        {grouped.map((grade) => {
          const items = sede.data.classes
            .filter((c) => c.grade === grade)
            .sort((a, b) => a.section.localeCompare(b.section));
          return (
            <section key={grade} className="paper-panel rounded-xl p-4">
              <h3 className="font-display text-xl">{grade}ª</h3>
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
                    <NativeSelect
                      value={c.tempo}
                      aria-label={`Tempo ${c.name}`}
                      className="h-10 w-40 shrink-0"
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
          <div className="flex justify-between pt-2">
            {!isNew && current && (
              <Button
                variant="outline"
                onClick={() => {
                  store.removeClassIn(sedeId, current.id);
                  toast.message("Classe rimossa");
                  onClose();
                }}
              >
                Elimina
              </Button>
            )}
            <Button className="ml-auto" onClick={save}>
              Salva
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
