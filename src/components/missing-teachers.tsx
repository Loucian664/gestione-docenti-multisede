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
