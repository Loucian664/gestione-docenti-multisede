import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { useAppStore, snapshot } from "@/lib/store";
import type { SchoolClass, Tempo } from "@/lib/types";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/classi")({ component: ClassiPage });

function tempoLabel(tempo: Tempo): string {
  return tempo === "TN" ? "Tempo normale" : "Tempo prolungato";
}

function ClassiPage() {
  const store = useAppStore();
  const data = snapshot(store);
  const [editing, setEditing] = useState<SchoolClass | null | "new">(null);
  const grouped = [1, 2, 3] as const;

  function saveTempo(c: SchoolClass, tempo: Tempo) {
    if (c.tempo === tempo) return;
    store.updateClass(c.id, { tempo });
    toast.success(`${c.name}: ${tempoLabel(tempo)}`);
  }

  return (
    <div>
      <PageHeader
        title="Classi"
        description="Classi del plesso e tempo scuola (normale o prolungato). Il tempo scelto dalla tendina viene salvato subito."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Nuova classe
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {grouped.map((grade) => {
          const items = data.classes.filter((c) => c.grade === grade).sort((a, b) => a.section.localeCompare(b.section));
          return (
            <section key={grade} className="paper-panel rounded-xl p-4">
              <h2 className="font-display text-xl">{grade}ª</h2>
              <ul className="mt-3 flex flex-col gap-1.5">
                {items.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-md px-1 hover:bg-muted">
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      className="flex min-h-12 min-w-0 flex-1 items-center text-left"
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.students ? (
                        <span className="ml-2 text-[13px] text-muted-foreground">{c.students} alunni</span>
                      ) : null}
                    </button>
                    <NativeSelect
                      value={c.tempo}
                      aria-label={`Tempo ${c.name}`}
                      className="h-10 w-40 shrink-0"
                      onChange={(e) => saveTempo(c, e.target.value as Tempo)}
                    >
                      <option value="TN">Tempo normale</option>
                      <option value="TP">Tempo prolungato</option>
                    </NativeSelect>
                  </li>
                ))}
                {items.length === 0 && <p className="px-3 text-sm text-muted-foreground">Nessuna sezione presente.</p>}
              </ul>
            </section>
          );
        })}
      </div>
      {editing && (
        <ClassDialog
          key={editing === "new" ? "new" : editing.id}
          value={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ClassDialog({ value, onClose }: { value: SchoolClass | "new"; onClose: () => void }) {
  const store = useAppStore();
  const isNew = value === "new";
  const current = isNew || !value ? null : value;
  const [grade, setGrade] = useState<1 | 2 | 3>(current?.grade ?? 1);
  const [section, setSection] = useState(current?.section ?? "A");
  const [students, setStudents] = useState(String(current?.students ?? 22));
  const [tempo, setTempo] = useState<Tempo>(current?.tempo ?? "TN");

  function save() {
    const name = `${grade}ª ${section.trim().toUpperCase()}`;
    const payload = {
      name,
      grade,
      section: section.trim().toUpperCase(),
      students: Number(students) || 0,
      tempo,
    };
    if (isNew) store.addClass(payload);
    else if (current) store.updateClass(current.id, payload);
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
                  store.updateClass(current.id, { tempo: next });
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
                  store.removeClass(current.id);
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
