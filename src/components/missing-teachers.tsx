import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { missingText, type MissingTeacher } from "@/lib/build-timetable";
import { cn } from "@/lib/utils";

export type MissingGroup = { sedeId: string; sede: string; items: MissingTeacher[] };

/** Per le righe «(tempo normale)»: dove si tolgono. */
export const TN_NOTE =
  "«Tempo normale»: Mensa o Laboratorio in una classe senza rientri, una riga da togliere in Orario → Costruisci → «Cattedre e ore»";

/**
 * Riquadro «Materie senza docente»: per ogni sede le ore delle classi senza docente. Compare in Costruisci e in
 * Docenti (in Classi e Sedi c'è una riga accanto alla classe o alla sede), così non passa inosservata.
 */
export function MissingTeachersBox({
  groups,
  showSede,
  note,
  className,
}: {
  groups: MissingGroup[];
  showSede: boolean;
  note: string;
  className?: string;
}) {
  if (!groups.length) return null;
  const tn = groups.some((g) => g.items.some((i) => i.tn));
  const without = groups.some((g) => g.items.some((i) => !i.tn));
  return (
    <div className={cn("rounded-xl bg-warning-soft px-4 py-3 text-sm", className)}>
      <p className="font-medium">{without ? "Materie senza docente" : "Righe da controllare"}</p>
      <ul className="mt-1.5 grid gap-1">
        {groups.map((g) => (
          <li key={g.sedeId}>
            {showSede && <span className="font-medium">{g.sede}: </span>}
            {g.items.map(missingText).join(", ")}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {[without ? note : "", tn ? `${TN_NOTE}${showSede ? " della sua sede" : ""}.` : ""].filter(Boolean).join(" ")}
      </p>
    </div>
  );
}

/** «Proponi» con materie senza docente: la finestra che spiega perché l'orario non si propone. */
export function MissingTeachersDialog({
  groups,
  showSede,
  onClose,
}: {
  groups: MissingGroup[];
  showSede: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Materie senza docente</DialogTitle>
          <DialogDescription>L’orario si propone quando ogni materia ha il suo docente. Mancano:</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5 text-sm">
          {groups.map((g) => (
            <li key={g.sedeId}>
              {showSede && <span className="font-medium">{g.sede}: </span>}
              {g.items.map(missingText).join(", ")}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Il docente si indica nella sua scheda, in Docenti → «Classi e materie», oppure in «Cattedre e ore».
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Chiudi
          </Button>
          <Button asChild>
            <Link to="/docenti">Apri Docenti</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
