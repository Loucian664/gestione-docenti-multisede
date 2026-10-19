import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore, snapshot } from "@/lib/store";
import { teacherName } from "@/lib/coverage";
import { cattedreOfTeacher, missingText } from "@/lib/build-timetable";
import {
  allSedi,
  canRemoveRecord,
  cattedraTotal,
  formerPersons,
  historyIn,
  hoursIn,
  missingBySede,
  persons,
  sedeAsData,
  sedeIdOf,
  sedeName,
  teacherRefs,
  type CardRow,
  type FormerPerson,
  type SedeEntry,
} from "@/lib/sedi";
import { DAY_SHORT, ROLE_LABELS, ACTIVITY_SUBJECTS, CURRICULAR_SUBJECTS, SUBJECTS, type DayOfWeek, type Teacher, type TeacherRole, type TimetableSlot } from "@/lib/types";
import { Plus, Search, LayoutGrid, UserRoundPen } from "lucide-react";
import { MissingTeachersBox } from "@/components/missing-teachers";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { corePeriods } from "@/lib/periods";
import { formatItDate, isoDate } from "@/lib/dates";
import {
  TEACHER_PALETTE,
  TONE_NAMES,
  VIVID_TONE,
  nextTeacherColor,
  teacherCell,
  teacherDotColor,
} from "@/lib/teacher-palette";

type DocentiSearch = { apri?: string };

export const Route = createFileRoute("/docenti")({
  component: DocentiPage,
  validateSearch: (raw: Record<string, unknown>): DocentiSearch => ({
    // scheda da aprire dopo il passaggio a un'altra sede
    apri: typeof raw.apri === "string" ? raw.apri : undefined,
  }),
});

const ALL = "tutte";

/** Mensa e Laboratorio: le ore del rientro, solo nelle classi a tempo prolungato. */
const rientro = (subject?: string) => /^(Mensa|Laboratorio)$/i.test(subject ?? "");

function DocentiPage() {
  const store = useAppStore();
  const data = snapshot(store);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [sedeFilter, setSedeFilter] = useState(ALL);
  const [subjectFilter, setSubjectFilter] = useState(ALL);
  const [editing, setEditing] = useState<Teacher | null | "new">(null);
  const sedi = allSedi(data);
  const several = sedi.length > 1;

  useEffect(() => {
    if (!search.apri) return;
    const t = data.teachers.find((x) => x.id === search.apri);
    if (t) setEditing(t);
    void navigate({ to: "/docenti", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.apri]);

  const people = useMemo(() => persons(data), [data]);
  // materie senza docente: si assegnano dalla scheda di un docente
  const missing = useMemo(() => missingBySede(data), [data]);
  const subjectsAll = useMemo(
    () =>
      [...new Set(people.flatMap((p) => p.records.flatMap((r) => r.teacher.subjects)))].sort((a, b) =>
        a.localeCompare(b, "it"),
      ),
    [people],
  );

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return people
      .map((p) => ({ ...p, main: p.records.find((r) => r.active) ?? p.records[0]! }))
      .filter((p) => {
        const t = p.main.teacher;
        if (sedeFilter !== ALL && !p.records.some((r) => r.sedeId === sedeFilter)) return false;
        if (subjectFilter !== ALL && !p.records.some((r) => r.teacher.subjects.includes(subjectFilter))) return false;
        if (!query) return true;
        return `${t.lastName} ${t.firstName} ${t.subjects.join(" ")}`.toLowerCase().includes(query);
      })
      .sort(
        (a, b) =>
          a.main.teacher.lastName.localeCompare(b.main.teacher.lastName, "it") ||
          a.main.teacher.firstName.localeCompare(b.main.teacher.firstName, "it"),
      );
  }, [people, q, sedeFilter, subjectFilter]);

  /** La scheda nella sede in uso; se il docente insegna solo altrove, si passa alla sua sede. */
  function open(row: (typeof list)[number], to: "scheda" | "orario") {
    const here = row.records.find((r) => r.active);
    if (here) {
      if (to === "scheda") setEditing(here.teacher);
      else void navigate({ to: "/orario", search: { docente: here.teacher.id } });
      return;
    }
    const rec = row.main;
    store.switchSede(rec.sedeId);
    toast.message(`Sede in uso: ${rec.sedeName}`);
    if (to === "scheda") void navigate({ to: "/docenti", search: { apri: rec.teacher.id } });
    else void navigate({ to: "/orario", search: { docente: rec.teacher.id } });
  }

  /** Classi; per chi insegna in più sedi, divise per sede. */
  function classesText(row: (typeof list)[number]): string {
    const parts = row.records
      .map((r) => ({ r, text: classLabels(sedeAsData(data, r.sede), r.teacher.id) }))
      .filter((x) => x.text);
    if (row.records.length < 2) return parts[0]?.text ?? "";
    return parts.map((x) => `${x.r.sedeName}: ${x.text}`).join(" · ");
  }

  const sediText = (row: (typeof list)[number]) => row.records.map((r) => r.sedeName).join(" · ");

  const hoursOf = (row: (typeof list)[number]): string[] =>
    row.records.length > 1
      ? row.records.map((r) => `${r.sedeName} ${r.hours} h`)
      : hoursLines(row.main.teacher);

  return (
    <div>
      <PageHeader
        title="Docenti"
        description={
          several
            ? "Docenti di tutte le sedi con materie, classi e ore. Seleziona un docente per modificarne i dati."
            : "Docenti del plesso con materie, classi e ore. Seleziona un docente per modificarne i dati."
        }
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Nuovo docente
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <Input className="pl-9" placeholder="Cerca per cognome o materia" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {several && (
          <NativeSelect
            value={sedeFilter}
            onChange={(e) => setSedeFilter(e.target.value)}
            aria-label="Sede"
            className="w-auto min-w-40 flex-1 sm:flex-none"
          >
            <option value={ALL}>Tutte le sedi</option>
            {sedi.map((s) => (
              <option key={s.id} value={s.id}>
                {sedeName(s.data.settings)}
              </option>
            ))}
          </NativeSelect>
        )}
        <NativeSelect
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          aria-label="Materia"
          className="w-auto min-w-40 flex-1 sm:flex-none"
        >
          <option value={ALL}>Tutte le materie</option>
          {subjectsAll.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </NativeSelect>
      </div>
      <MissingTeachersBox
        className="mb-4"
        groups={missing.filter((x) => sedeFilter === ALL || x.sedeId === sedeFilter)}
        showSede={several}
        note="Il docente si indica nella sua scheda, in «Classi e materie»."
      />
      <ul className="paper-panel divide-y divide-border rounded-xl md:hidden">
        {list.map((row) => {
          const t = row.main.teacher;
          return (
            <li key={row.key} className="flex items-start gap-2 py-3 pr-2 pl-4">
              <button type="button" onClick={() => open(row, "scheda")} className="min-w-0 flex-1 text-left">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: teacherDotColor(t.color) }} />
                  <span className="font-medium">{teacherName(t)}</span>
                  <Badge variant="outline">{ROLE_LABELS[t.role]}</Badge>
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{t.subjects.join(", ")}</span>
                <span className="block text-[13px] text-muted-foreground">{classesText(row) || "—"}</span>
                {several && <span className="block text-[12px] text-muted-foreground">{sediText(row)}</span>}
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="pt-0.5 text-right text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                  {hoursOf(row).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
                <Button size="sm" variant="ghost" onClick={() => open(row, "orario")}>
                  <LayoutGrid />
                  Orario
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="paper-panel hidden overflow-x-auto rounded-xl md:block">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="whitespace-nowrap px-4 py-2 font-medium">Docente</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Materie</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Ruolo</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Classi</th>
              <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Cattedra</th>
              <th className="whitespace-nowrap px-4 py-2 text-right font-medium">A disposizione</th>
              <th className="whitespace-nowrap px-4 py-2 font-medium">Orario</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const t = row.main.teacher;
              const away = !row.records.some((r) => r.active);
              return (
                <tr
                  key={row.key}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/60"
                  onClick={() => open(row, "scheda")}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: teacherDotColor(t.color) }} />
                      <span className="font-medium">{teacherName(t)}</span>
                    </div>
                    {several && <div className="mt-0.5 pl-4.5 text-[12px] text-muted-foreground">{sediText(row)}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.subjects.join(", ")}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge variant="outline">{ROLE_LABELS[t.role]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{classesText(row) || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {row.records.length > 1
                      ? row.records.map((r) => (
                          <span key={r.sedeId} className="block">
                            {r.sedeName} {r.hours} h
                          </span>
                        ))
                      : `${t.weeklyHours} h`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {away ? (
                      <span className="text-muted-foreground">—</span>
                    ) : t.role === "potenziamento" ? (
                      <DispHoursCell quota={t.weeklyHours} assigned={t.dispSlots?.length ?? 0} emptyLabel="0 h" />
                    ) : (
                      <DispHoursCell quota={t.dispHours ?? 0} assigned={t.dispSlots?.length ?? 0} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        open(row, "orario");
                      }}
                    >
                      <LayoutGrid />
                      Ore
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Nessun docente con questi filtri.</p>}
      <FormerTeachers data={data} sedeFilter={sedeFilter} several={several} />
      {editing && (
        <TeacherDialog
          key={editing === "new" ? "new" : editing.id}
          value={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * Chi non è più in servizio: resta per le assenze e le sostituzioni già segnate e per il report. Una riga per
 * persona anche se ha lasciato più sedi.
 */
function FormerTeachers({
  data,
  sedeFilter,
  several,
}: {
  data: ReturnType<typeof snapshot>;
  sedeFilter: string;
  several: boolean;
}) {
  const list = formerPersons(data).filter(
    (p) => sedeFilter === ALL || p.records.some((r) => r.sedeId === sedeFilter),
  );
  if (!list.length) return null;
  return (
    <details className="paper-panel mt-4 rounded-xl">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Non più in servizio ({list.length})</summary>
      <ul className="divide-y divide-border border-t border-border">
        {list.map((p) => (
          <li key={p.key} className="px-4 py-2.5">
            <span className="font-medium">{teacherName(p.records[0]!.teacher)}</span>
            {formerLines(p, several).map((line) => (
              <span key={line} className="block text-[13px] text-muted-foreground">
                {line}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
        Restano qui per le assenze e le sostituzioni già segnate e per il report{several ? " di ogni sede" : ""}. Non
        compaiono in Oggi, in Costruisci né tra i sostituti.
      </p>
    </details>
  );
}

/** Da quando non è più in servizio e chi c'è al suo posto; con più sedi, dove. */
function formerLines(p: FormerPerson, several: boolean): string[] {
  const line = (r: FormerPerson["records"][number]) =>
    `${r.teacher.leftOn ? `dal ${formatItDate(r.teacher.leftOn)}` : ""}${r.next ? ` · al suo posto ${teacherName(r.next)}` : ""}`;
  const still = p.stillAt.length ? [`Insegna ancora a ${p.stillAt.join(", ")}`] : [];
  const same = new Set(p.records.map(line)).size === 1;
  if (!several || same) {
    const first = `Non più in servizio ${line(p.records[0]!)}`.trim();
    return several ? [first, p.records.map((r) => r.sedeName).join(" · "), ...still] : [first];
  }
  return [...p.records.map((r) => `${r.sedeName}: non più in servizio ${line(r)}`.trim()), ...still];
}

/** «3 assenze e 5 ore di sostituzione (fatte o ricevute)», senza le voci a zero. */
function historyText(h: { absences: number; substitutions: number }): string {
  return [
    h.absences ? (h.absences === 1 ? "1 assenza" : `${h.absences} assenze`) : "",
    h.substitutions
      ? h.substitutions === 1
        ? "1 ora di sostituzione (fatta o ricevuta)"
        : `${h.substitutions} ore di sostituzione (fatte o ricevute)`
      : "",
  ]
    .filter(Boolean)
    .join(" e ");
}

/** Le ore di lezione e quelle a disposizione (il potenziamento ha solo ore a disposizione). */
function hoursLines(t: Teacher): string[] {
  if (t.role === "potenziamento") return [`${t.weeklyHours} h a disposizione`];
  const disp = t.dispHours ?? 0;
  return [`${t.weeklyHours} h di lezione`, ...(disp > 0 ? [`${disp} h a disposizione`] : [])];
}

function DispHoursCell({
  quota,
  assigned,
  emptyLabel,
}: {
  quota: number;
  assigned: number;
  emptyLabel?: string;
}) {
  if (quota <= 0) return <span className="text-muted-foreground">{emptyLabel ?? "—"}</span>;
  const done = assigned >= quota;
  return (
    <span className={done ? "font-medium text-success" : "font-medium text-destructive"}>
      {assigned}/{quota} h
    </span>
  );
}

function classLabels(data: ReturnType<typeof snapshot>, teacherId: string): string {
  const names = [
    ...new Set(
      cattedreOfTeacher(data, teacherId).map((c) => data.classes.find((x) => x.id === c.classId)?.name ?? ""),
    ),
  ].filter(Boolean);
  return names.join(", ");
}

function TeacherDialog({ value, onClose }: { value: Teacher | "new"; onClose: () => void }) {
  const store = useAppStore();
  const isNew = value === "new";
  const current = isNew || !value ? null : value;
  const [lastName, setLastName] = useState(current?.lastName ?? "");
  const [firstName, setFirstName] = useState(current?.firstName ?? "");
  const [subjects, setSubjects] = useState(current?.subjects.join(", ") ?? "");
  // con più sedi le ore cattedra sono quelle di tutte le sedi (il potenziamento resta per sede)
  const [weeklyHours, setWeeklyHours] = useState(() =>
    String(
      !current
        ? 18
        : current.role === "potenziamento"
          ? current.weeklyHours
          : cattedraTotal(snapshot(useAppStore.getState()), current),
    ),
  );
  const [dispHours, setDispHours] = useState(String(current?.dispHours ?? 0));
  const [role, setRole] = useState<TeacherRole>(current?.role ?? "cattedra");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [color, setColor] = useState(
    () => current?.color ?? nextTeacherColor(store.teachers.map((t) => t.color)),
  );
  const [dispSlots, setDispSlots] = useState<{ day: DayOfWeek; periodId: string }[]>(
    current?.dispSlots ?? [],
  );
  const data = snapshot(store);
  const sedi = allSedi(data);
  const several = sedi.length > 1;
  const activeId = sedeIdOf(data);
  const here = sedeName(data.settings);
  // le schede della stessa persona nelle altre sedi
  const elsewhere = current?.personId
    ? sedi
        .filter((x) => !x.active)
        .flatMap((x) => {
          const rec = x.data.teachers.find((y) => y.personId === current.personId);
          return rec ? [{ sede: x, teacher: rec }] : [];
        })
    : [];
  const [sediSel, setSediSel] = useState<string[]>(() => [activeId, ...elsewhere.map((e) => e.sede.id)]);
  // le righe di tutte le sedi in cui insegna, ognuna con la sua sede
  const [initialRows] = useState(() =>
    current
      ? [
          ...cattedreOfTeacher(data, current.id).map((c) => ({ ...c, sedeId: activeId })),
          ...elsewhere.flatMap((e) =>
            cattedreOfTeacher(sedeAsData(data, e.sede.data), e.teacher.id).map((c) => ({ ...c, sedeId: e.sede.id })),
          ),
        ].map((c) => ({ sedeId: c.sedeId, classId: c.classId, subject: c.subject, hours: String(c.hours) }))
      : [],
  );
  const [rows, setRows] = useState<{ sedeId: string; classId: string; subject: string; hours: string }[]>(initialRows);
  // «card» la scheda; «rename» l'avviso sul nome cambiato; «replace» arriva un'altra persona al suo posto
  const [step, setStep] = useState<"card" | "rename" | "replace">("card");
  const [newName, setNewName] = useState({ lastName: "", firstName: "" });
  const [fromDate, setFromDate] = useState(() => isoDate(new Date()));
  // con più sedi si sostituisce in tutte le sue sedi, salvo scelta diversa
  const [replaceAll, setReplaceAll] = useState(true);
  // le schede della persona: quella qui e, se insegna in più sedi, le altre
  const refsAll = current ? teacherRefs(data, current.id, true) : [];
  const history = historyIn(data, refsAll);
  const hasHistory = history.absences + history.substitutions > 0;
  const nameChanged = !!current && (lastName.trim() !== current.lastName || firstName.trim() !== current.firstName);
  const elsewhereNames = elsewhere.map((e) => sedeName(e.sede.data.settings));
  const hoursOf = (sedeId?: string) =>
    rows.filter((r) => !sedeId || r.sedeId === sedeId).reduce((n, r) => n + (Number(r.hours) || 0), 0);
  const assignedHours = hoursOf();
  const classesOf = (sedeId: string) => sedi.find((x) => x.id === sedeId)?.data.classes ?? [];
  // un riquadro per ogni sede in cui insegna, nell'ordine della pagina Sedi
  const blocks = sedi.filter((x) => sediSel.includes(x.id));
  const multi = blocks.length > 1;

  function addRow(sedeId: string, subject?: string) {
    setRows((all) => [
      ...all,
      {
        sedeId,
        classId: rientro(subject) ? tpClassFor(sedeId, all) : (classesOf(sedeId)[0]?.id ?? ""),
        subject: subject ?? subjects.split(",")[0]?.trim() ?? "",
        hours: "1",
      },
    ]);
  }

  /**
   * «+ Mensa» e «+ Laboratorio»: una classe a tempo prolungato, quella delle sue righe in quella sede se c'è,
   * altrimenti la prima; senza classi a tempo prolungato la classe resta da scegliere.
   */
  function tpClassFor(sedeId: string, all: typeof rows): string {
    const tp = classesOf(sedeId)
      .filter((c) => c.tempo === "TP")
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
    const used = tp.find((c) => all.some((r) => r.sedeId === sedeId && r.classId === c.id));
    return (used ?? tp[0])?.id ?? "";
  }

  /** Le righe valide di ogni sede. */
  function parsedBySede(list: typeof rows): Record<string, CardRow[]> {
    const out: Record<string, CardRow[]> = {};
    for (const r of list) {
      const row = { classId: r.classId, subject: r.subject.trim(), hours: Number(r.hours) || 0 };
      if (!row.classId || !row.subject || row.hours <= 0) continue;
      (out[r.sedeId] ??= []).push(row);
    }
    return out;
  }

  /** Le altre sedi in cui cambiano le classi, con le righe nuove: per l'avviso dopo il salvataggio. */
  function changedElsewhere(next: Record<string, CardRow[]>): string {
    const before = parsedBySede(initialRows);
    const key = (list: CardRow[] = []) =>
      list
        .map((r) => `${r.classId}|${r.subject}|${r.hours}`)
        .sort()
        .join("#");
    return sedi
      .filter((x) => !x.active && sediSel.includes(x.id) && key(before[x.id]) !== key(next[x.id]))
      .map((x) => {
        const list = (next[x.id] ?? []).map(
          (r) => `${x.data.classes.find((c) => c.id === r.classId)?.name ?? "classe"} ${r.subject} ${r.hours} h`,
        );
        return `${sedeName(x.data.settings)}: ${list.length ? list.join(", ") : "nessuna classe"}`;
      })
      .join(" · ");
  }

  // le lezioni nell'orario delle classi tolte dalla scheda (di tutta la sede, se la si toglie): senza toglierle,
  // Costruisci continua a considerarle sue
  const [keepLessons, setKeepLessons] = useState<string[]>([]);
  const recordIn = (sedeId: string) =>
    sedeId === activeId ? current?.id : elsewhere.find((e) => e.sede.id === sedeId)?.teacher.id;
  function lessonsOf(x: SedeEntry): TimetableSlot[] {
    const id = recordIn(x.id);
    return id ? x.data.slots.filter((s) => s.teacherId === id) : [];
  }
  function lessonsGone(x: SedeEntry): TimetableSlot[] {
    const mine = lessonsOf(x);
    if (!sediSel.includes(x.id)) return mine;
    const now = rows.filter((r) => r.sedeId === x.id && r.classId);
    const gone = initialRows.filter(
      (r) => r.sedeId === x.id && !now.some((n) => n.classId === r.classId && n.subject === r.subject),
    );
    return mine.filter((s) =>
      gone.some(
        (g) => g.classId === s.classId && (g.subject === s.subject || !now.some((n) => n.classId === s.classId)),
      ),
    );
  }
  /** Le lezioni che escono dall'orario salvando: quelle delle classi tolte, se non si è scelto di tenerle. */
  function lessonsToDrop(x: SedeEntry): TimetableSlot[] {
    if (sediSel.includes(x.id) && keepLessons.includes(x.id)) return [];
    return lessonsGone(x);
  }
  function lessonsText(x: SedeEntry, list: TimetableSlot[]): string {
    const count = new Map<string, number>();
    for (const s of list) {
      const key = `${x.data.classes.find((c) => c.id === s.classId)?.name ?? "classe"} ${s.subject}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return [...count].map(([k, n]) => (n > 1 ? `${k} (${n} ore)` : k)).join(", ");
  }

  /** Dopo il salvataggio o l'eliminazione: le classi che aveva e che ora restano senza docente. */
  function warnLeftWithout() {
    const groups = missingBySede(snapshot(useAppStore.getState()))
      .map((g) => ({
        ...g,
        items: g.items.filter((m) =>
          initialRows.some((r) => r.sedeId === g.sedeId && r.classId === m.classId && r.subject === m.subject),
        ),
      }))
      .filter((g) => g.items.length > 0);
    if (!groups.length) return;
    toast.warning(
      `Restano senza docente: ${groups
        .map((g) => `${several ? `${g.sede}: ` : ""}${g.items.map(missingText).join(", ")}`)
        .join(" · ")}.`,
      { description: "Il docente si indica nella sua scheda, in «Classi e materie»." },
    );
  }

  /**
   * Salva la scheda in tutte le sue sedi (con il nome `name`); restituisce cosa serve per l'avviso, o null senza
   * cognome.
   */
  function commit(name: { lastName: string; firstName: string }) {
    const payload = {
      lastName: name.lastName.trim(),
      firstName: name.firstName.trim(),
      subjects: subjects
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      weeklyHours: Number(weeklyHours) || 0,
      dispHours: Math.max(0, Number(dispHours) || 0),
      role,
      notes,
      color,
      assignedClassIds: [...new Set(rows.filter((r) => r.sedeId === activeId).map((r) => r.classId).filter(Boolean))],
      otherPlesso: current?.otherPlesso ?? false,
      awaySlots: current?.awaySlots ?? [],
      rientroDays: current?.rientroDays ?? [],
      dispSlots,
      preferSlots: current?.preferSlots ?? [],
      mustSlots: current?.mustSlots ?? [],
    };
    if (!payload.lastName) return null;
    let blocked: string[] = [];
    let elsewhereNote = "";
    const drop: Record<string, string[]> = {};
    for (const x of sedi) {
      const list = role === "potenziamento" ? [] : lessonsToDrop(x);
      if (list.length) drop[x.id] = list.map((s) => s.id);
    }
    const dropped = Object.values(drop).reduce((n, l) => n + l.length, 0);
    if (payload.role === "potenziamento") {
      const savedId = store.saveTeacherCard(isNew ? null : current!.id, payload, []);
      const before = [activeId, ...elsewhere.map((e) => e.sede.id)].sort().join("|");
      if ([...sediSel].sort().join("|") !== before) blocked = store.setTeacherSedi(savedId, sediSel);
    } else {
      // ogni riga va nella scheda del docente nella sua sede
      const bySede = parsedBySede(rows.filter((r) => sediSel.includes(r.sedeId)));
      const all = Object.values(bySede).flat();
      payload.subjects = [...new Set([...payload.subjects, ...all.map((r) => r.subject)])];
      if (several) {
        elsewhereNote = changedElsewhere(bySede);
        blocked = store.saveTeacherCardSedi(isNew ? null : current!.id, payload, bySede, sediSel, drop).blocked;
      } else {
        store.saveTeacherCard(isNew ? null : current!.id, payload, bySede[activeId] ?? [], drop[activeId]);
      }
    }
    if (blocked.length) toast.error(`Resta anche a ${blocked.join(", ")}: lì ha lezioni o cattedre.`);
    return { payload, elsewhereNote, dropped, drop };
  }

  /** `sameName`: il nome è solo corretto, anche se ha già assenze o sostituzioni segnate. */
  function save(sameName = false) {
    if (!sameName && nameChanged && hasHistory && lastName.trim()) {
      setStep("rename");
      return;
    }
    const done = commit({ lastName, firstName });
    if (!done) return;
    const { payload, elsewhereNote, dropped, drop } = done;
    toast.success(
      payload.role === "potenziamento"
        ? "Docente salvato. Nelle ore in sede è disponibile per le sostituzioni."
        : payload.role === "sostegno"
          ? "Docente salvato. Ora inserisci le sue ore in Orario → Docente."
          : "Docente salvato",
      elsewhereNote || dropped
        ? {
            description: [
              elsewhereNote ? `Classi aggiornate anche a ${elsewhereNote}.` : "",
              dropped
                ? `${dropped === 1 ? "Tolta 1 lezione" : `Tolte ${dropped} lezioni`} dall’orario${
                    several
                      ? ` di ${sedi
                          .filter((x) => drop[x.id])
                          .map((x) => sedeName(x.data.settings))
                          .join(", ")}`
                      : ""
                  }.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : undefined,
    );
    warnLeftWithout();
    onClose();
  }

  function openReplace() {
    // il nome già scritto nella scheda è quello di chi arriva
    setNewName(nameChanged ? { lastName: lastName.trim(), firstName: firstName.trim() } : { lastName: "", firstName: "" });
    setStep("replace");
  }

  function replace() {
    if (!current || !newName.lastName.trim() || !fromDate) return;
    const everywhere = replaceAll || !elsewhere.length;
    // le altre modifiche della scheda si salvano col nome di chi lascia, poi la scheda passa a chi arriva
    if (!commit({ lastName: current.lastName, firstName: current.firstName })) return;
    if (!store.replaceTeacher(current.id, newName, fromDate, everywhere)) return;
    const who = teacherName(current);
    toast.success(`${`${newName.lastName.trim()} ${newName.firstName.trim()}`.trim()} al posto di ${who}`, {
      description: [
        `Dal ${formatItDate(fromDate)}${elsewhere.length ? (everywhere ? ", in tutte le sue sedi" : `, solo a ${here}`) : ""}.`,
        `Le assenze e le sostituzioni dei giorni prima restano a ${who}, in Docenti → Non più in servizio.`,
        everywhere ? "" : `A ${elsewhereNames.join(", ")} resta ${who}.`,
      ]
        .filter(Boolean)
        .join(" "),
    });
    warnLeftWithout();
    onClose();
  }

  if (current && step === "rename") {
    // con più sedi: dove risultano già
    const sediWith =
      refsAll.length > 1
        ? refsAll
            .filter((r) => {
              const h = historyIn(data, [r]);
              return h.absences + h.substitutions > 0;
            })
            .map((r) => sedeName(sedi.find((x) => x.id === r.sedeId)!.data.settings))
        : [];
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nome cambiato</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p>
              Con il nome <span className="font-medium">{teacherName(current)}</span> risultano già:{" "}
              {historyText(history)}
              {sediWith.length ? ` (${sediWith.join(", ")})` : ""}.
            </p>
            <p className="text-muted-foreground">
              Se è la stessa persona e correggi solo il nome, il nome nuovo compare anche in quelle già segnate e nel
              report{refsAll.length > 1 ? ", in tutte le sue sedi" : ""}. Se al suo posto arriva un’altra persona, la
              scheda passa a chi arriva e quelle già segnate restano a {teacherName(current)}.
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={() => setStep("card")}>
                Indietro
              </Button>
              <Button variant="outline" className="ml-auto" onClick={() => save(true)}>
                Correggi solo il nome
              </Button>
              <Button onClick={openReplace}>È un’altra persona</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (current && step === "replace") {
    const everywhere = replaceAll || !elsewhere.length;
    const refs = everywhere ? refsAll : refsAll.slice(0, 1);
    // già segnate dalla data in poi, nelle sedi in cui si sostituisce
    const later = { absences: 0, substitutions: 0 };
    for (const r of refs) {
      const sede = sedi.find((x) => x.id === r.sedeId)?.data;
      if (!sede) continue;
      later.absences += sede.absences.filter((a) => a.teacherId === r.teacherId && a.dateTo >= fromDate).length;
      later.substitutions += sede.substitutions.filter(
        (x) => x.date >= fromDate && (x.absentTeacherId === r.teacherId || x.substituteId === r.teacherId),
      ).length;
    }
    const ready = !!newName.lastName.trim() && !!fromDate;
    const who = teacherName(current);
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sostituisci docente</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              replace();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Al posto di <span className="font-medium text-foreground">{who}</span> arriva un’altra persona: la scheda
              (classi, ore, orario, disposizioni e preferenze) passa a lei
              {elsewhere.length ? (everywhere ? " in tutte le sue sedi" : ` solo a ${here}`) : ""}. {who} va tra i
              docenti «Non più in servizio» e conserva le assenze e le sostituzioni segnate prima della data
              {elsewhere.length && everywhere ? ", sede per sede" : ""}: il report resta giusto.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cognome di chi arriva">
                <Input
                  value={newName.lastName}
                  onChange={(e) => setNewName((n) => ({ ...n, lastName: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Nome">
                <Input value={newName.firstName} onChange={(e) => setNewName((n) => ({ ...n, firstName: e.target.value }))} />
              </Field>
            </div>
            <Field label="In servizio dal">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
            </Field>
            {elsewhere.length > 0 && (
              <div className="grid gap-1">
                <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={replaceAll}
                    onChange={(e) => setReplaceAll(e.target.checked)}
                  />
                  In tutte le sue sedi ({[here, ...elsewhereNames].join(", ")})
                </label>
                {!replaceAll && (
                  <p className="text-[12px] leading-snug text-muted-foreground">
                    Solo a {here}: lì la scheda diventa di un’altra persona; a {elsewhereNames.join(", ")} resta {who}.
                  </p>
                )}
              </div>
            )}
            {later.absences + later.substitutions > 0 && fromDate && (
              <p className="rounded-md bg-warning-soft px-2.5 py-2 text-[12px] leading-snug">
                Dal {formatItDate(fromDate)} in poi risultano già: {historyText(later)}. Restano sulla scheda, cioè a chi
                arriva.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={() => setStep("card")}>
                Indietro
              </Button>
              <Button type="submit" className="ml-auto" disabled={!ready}>
                Sostituisci
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {/* intestazione e piede restano fermi, il contenuto scorre in mezzo */}
        <DialogHeader className="sticky top-0 z-10 mb-0 bg-popover pb-4">
          <DialogTitle>{isNew ? "Nuovo docente" : "Scheda docente"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cognome">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </Field>
            <Field label="Nome">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
          </div>
          {current && (
            <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-[12px] text-muted-foreground">Al suo posto arriva un’altra persona?</p>
              <Button type="button" size="sm" variant="outline" onClick={openReplace}>
                <UserRoundPen />
                Sostituisci docente
              </Button>
            </div>
          )}
          <Field label="Materie (separate da virgola)">
            <Input value={subjects} onChange={(e) => setSubjects(e.target.value)} list="subjects-list" placeholder="Matematica, Mensa, Laboratorio" />
            <datalist id="subjects-list">
              {SUBJECTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={role === "potenziamento" ? "Ore settimanali" : "Ore cattedra"}>
              <Input type="number" min={0} value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} />
            </Field>
            {role !== "potenziamento" && (
              <Field label="A disposizione (questo plesso)">
                <Input type="number" min={0} max={18} value={dispHours} onChange={(e) => setDispHours(e.target.value)} />
              </Field>
            )}
          </div>
          {role !== "potenziamento" && (
            <p className="-mt-1 text-[12px] text-muted-foreground">
              Ore cattedra: ore di lezione {several ? "in tutte le sedi" : "in questo plesso"}. Ore a disposizione: ore di
              servizio senza classe{several ? " in questa sede" : ""}, utilizzabili
              per le sostituzioni. Se l’orario generato deve lasciare ore buche, le assegna prima a chi ha ore a
              disposizione.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ruolo">
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as TeacherRole)}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {role === "potenziamento" && (
            <PresenceGrid
              days={data.settings.days}
              periods={corePeriods(data.settings.periods)}
              selected={dispSlots}
              onChange={setDispSlots}
              occupied={
                current
                  ? data.slots
                      .filter((s) => s.teacherId === current.id)
                      .map((s) => ({
                        day: s.day,
                        periodId: s.periodId,
                        label: data.classes.find((c) => c.id === s.classId)?.name ?? "lez",
                      }))
                  : []
              }
            />
          )}
          {several && (
            <Field label="Sedi in cui insegna">
              <div className="flex flex-col gap-1">
                {sedi.map((x) => {
                  const rec = elsewhere.find((e) => e.sede.id === x.id);
                  const rowsHere = rows.filter((r) => r.sedeId === x.id);
                  // lezioni che restano nell'orario di lì, salvando
                  const left = lessonsOf(x).length - lessonsToDrop(x).length;
                  // una sede si toglie quando lì non ha più classi né lezioni in orario
                  const locked =
                    x.active ||
                    (role === "potenziamento"
                      ? Boolean(rec && !canRemoveRecord(x.data, rec.teacher.id))
                      : left > 0 || rowsHere.length > 0);
                  const on = sediSel.includes(x.id);
                  const hours =
                    role === "potenziamento" ? (rec ? hoursIn(data, x.data, rec.teacher.id) : 0) : hoursOf(x.id);
                  return (
                    <label key={x.id} className="flex min-h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={on}
                        disabled={locked}
                        onChange={(e) =>
                          setSediSel((all) => (e.target.checked ? [...all, x.id] : all.filter((y) => y !== x.id)))
                        }
                      />
                      <span className="font-medium">{sedeName(x.data.settings)}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {x.active
                          ? "· sede in uso"
                          : on
                            ? `· ${hours} h${left > 0 ? ` · ${left === 1 ? "1 lezione" : `${left} lezioni`} in orario` : ""}`
                            : rec
                              ? "· si toglie salvando"
                              : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[12px] text-muted-foreground">
                Nome, materie, ruolo e colore sono uguali in tutte le sedi.
                {role === "potenziamento"
                  ? " Le ore di un’altra sede si inseriscono passando a quella sede."
                  : " Spuntando una sede, qui sotto compaiono le sue classi. Una sede si toglie quando non ha più classi qui sotto né lezioni nel suo orario; dalla sede in uso si toglie con «Elimina»."}
              </p>
              {sedi
                .filter((x) => !x.active && !sediSel.includes(x.id) && elsewhere.some((e) => e.sede.id === x.id))
                .map((x) => {
                  const n = lessonsToDrop(x).length;
                  return (
                    <p key={x.id} className="text-[12px] text-warning">
                      Salvando, il docente viene tolto da {sedeName(x.data.settings)}
                      {n ? ` e ${n === 1 ? "la sua lezione lì esce" : `le sue ${n} lezioni lì escono`} dall’orario` : ""}.
                    </p>
                  );
                })}
            </Field>
          )}
          {role !== "potenziamento" && (
          <Field label={multi ? "Classi e materie" : several ? `Classi e materie a ${here}` : "Classi e materie su questo plesso"}>
            <p className="text-[12px] text-muted-foreground">
              Per ogni classe indica materia e ore (anche Mensa o Laboratorio).
              {multi
                ? " Ogni sede ha le sue classi: salvando, le righe vanno nella scheda del docente in quella sede."
                : " Se il docente insegna anche in altri plessi, il totale può essere inferiore."}
            </p>
            {blocks.map((x) => (
              <div
                key={x.id}
                className={cn("mt-2 flex flex-col gap-2", multi && "rounded-lg border border-border p-2.5")}
              >
                {multi && (
                  <p className="flex items-baseline justify-between gap-2 text-[13px] font-medium">
                    <span>{sedeName(x.data.settings)}</span>
                    <span className="text-[12px] font-normal tabular-nums text-muted-foreground">{hoursOf(x.id)} h</span>
                  </p>
                )}
                {rows.map((row, i) =>
                  row.sedeId !== x.id ? null : (
                    <Fragment key={i}>
                    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_3.75rem_2rem] items-center gap-1.5">
                      <NativeSelect
                        value={row.classId}
                        onChange={(e) =>
                          setRows((all) => all.map((r, j) => (j === i ? { ...r, classId: e.target.value } : r)))
                        }
                        aria-label="Classe"
                      >
                        <option value="">Classe</option>
                        {x.data.classes
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name, "it"))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </NativeSelect>
                      <NativeSelect
                        value={row.subject}
                        onChange={(e) =>
                          setRows((all) => all.map((r, j) => (j === i ? { ...r, subject: e.target.value } : r)))
                        }
                        aria-label="Materia"
                      >
                        <option value="">Materia</option>
                        <optgroup label="Materie">
                          {CURRICULAR_SUBJECTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Altre attività">
                          {ACTIVITY_SUBJECTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </optgroup>
                        {row.subject && !SUBJECTS.includes(row.subject) && (
                          <option value={row.subject}>{row.subject}</option>
                        )}
                      </NativeSelect>
                      <Input
                        type="number"
                        min={1}
                        max={18}
                        inputMode="numeric"
                        className="text-right tabular-nums"
                        value={row.hours}
                        onChange={(e) =>
                          setRows((all) => all.map((r, j) => (j === i ? { ...r, hours: e.target.value } : r)))
                        }
                        aria-label="Ore"
                      />
                      <button
                        type="button"
                        className="inline-flex size-10 items-center justify-center text-muted-foreground"
                        aria-label="Togli riga"
                        onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </div>
                    {rientro(row.subject) && x.data.classes.find((c) => c.id === row.classId)?.tempo === "TN" && (
                      <p className="-mt-1 text-[12px] text-warning">
                        {x.data.classes.find((c) => c.id === row.classId)?.name} è a tempo normale: {row.subject} vale solo
                        per le classi a tempo prolungato.
                      </p>
                    )}
                    </Fragment>
                  ),
                )}
                {(() => {
                  const gone = lessonsGone(x);
                  if (!gone.length) return null;
                  const keep = keepLessons.includes(x.id);
                  return (
                    <div className="rounded-md bg-warning-soft px-2.5 py-2 text-[12px] leading-snug">
                      <p>
                        Nell’orario{several ? ` di ${sedeName(x.data.settings)}` : ""} restano{" "}
                        {gone.length === 1 ? "1 sua lezione" : `${gone.length} sue lezioni`} delle classi tolte:{" "}
                        {lessonsText(x, gone)}.
                      </p>
                      <label className="mt-1 flex min-h-8 items-center gap-2 font-medium">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={!keep}
                          onChange={(e) =>
                            setKeepLessons((all) =>
                              e.target.checked ? all.filter((y) => y !== x.id) : [...all, x.id],
                            )
                          }
                        />
                        Toglile dall’orario quando salvi
                      </label>
                      {keep && (
                        <p className="text-muted-foreground">
                          Se restano nell’orario, Costruisci continua a considerarle sue.
                        </p>
                      )}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => addRow(x.id)}>
                    Aggiungi classe
                  </Button>
                  <Button type="button" variant="outline" onClick={() => addRow(x.id, "Mensa")}>
                    + Mensa
                  </Button>
                  <Button type="button" variant="outline" onClick={() => addRow(x.id, "Laboratorio")}>
                    + Laboratorio
                  </Button>
                </div>
              </div>
            ))}
            <p className="mt-2 text-[12px] tabular-nums text-muted-foreground">
              {multi ? "Totale in tutte le sedi" : several ? `Totale a ${here}` : "Totale su questo plesso"}: {assignedHours} h
              {Number(weeklyHours) > 0 ? ` su ${weeklyHours} h di organico` : ""}
            </p>
          </Field>
          )}
          <Field label="Colore in orario">
            <ColorSwatches value={color} onChange={setColor} />
          </Field>
          <Field label="Note">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <p className="text-[12px] text-muted-foreground">
            Le ore nelle altre sedi dell’app Costruisci le conosce da solo. Se il docente insegna anche in una sede che
            non è nell’app, indica in Orario → Costruisci le ore in cui è altrove.
          </p>
          <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-popover pt-3">
            {!isNew && current && (
              <Button
                variant="outline"
                onClick={() => {
                  store.removeTeacher(current.id);
                  warnLeftWithout();
                  toast.message(
                    elsewhere.length
                      ? `Docente tolto da ${here}: resta a ${elsewhere.map((e) => sedeName(e.sede.data.settings)).join(", ")}.`
                      : "Docente rimosso",
                  );
                  onClose();
                }}
              >
                Elimina
              </Button>
            )}
            <Button variant="outline" className="ml-auto" onClick={onClose}>
              Annulla
            </Button>
            <Button onClick={() => save()}>Salva</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** «Colore in orario»: 12 tinte in due gruppi da 6; in ogni colonna tenue, medio, deciso e, staccato, il vivace. */
function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const isOn = (c: string) => value.toUpperCase() === c.toUpperCase();
  const groups = [TEACHER_PALETTE.slice(0, 6), TEACHER_PALETTE.slice(6)];
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group[0]!.name} className="grid grid-cols-6 gap-1">
          {group.map((hue) => (
            <div key={hue.name} className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-center text-[10px] tracking-tight text-muted-foreground" title={hue.name}>
                {hue.name}
              </span>
              {hue.tones.map((tone, i) => {
                const tc = teacherCell(tone);
                return (
                  <button
                    key={tone}
                    type="button"
                    aria-label={`${hue.name} ${TONE_NAMES[i]}`}
                    aria-pressed={isOn(tone)}
                    title={`${hue.name} ${TONE_NAMES[i]}`}
                    onClick={() => onChange(tone)}
                    className={cn(
                      "h-7 rounded-md border border-black/10 dark:border-white/10",
                      i === VIVID_TONE && "mt-1",
                      isOn(tone) && "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                      tc.className,
                    )}
                    style={tc.style}
                  />
                );
              })}
            </div>
          ))}
        </div>
      ))}
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

function PresenceGrid({
  days,
  periods,
  selected,
  onChange,
  occupied,
}: {
  days: DayOfWeek[];
  periods: { id: string; index: number; label: string }[];
  selected: { day: DayOfWeek; periodId: string }[];
  onChange: (next: { day: DayOfWeek; periodId: string }[]) => void;
  occupied: { day: DayOfWeek; periodId: string; label: string }[];
}) {
  const on = (day: DayOfWeek, periodId: string) =>
    selected.some((a) => a.day === day && a.periodId === periodId);
  const lesson = (day: DayOfWeek, periodId: string) =>
    occupied.find((a) => a.day === day && a.periodId === periodId);

  function toggle(day: DayOfWeek, periodId: string) {
    if (lesson(day, periodId)) return;
    onChange(
      on(day, periodId)
        ? selected.filter((a) => !(a.day === day && a.periodId === periodId))
        : [...selected, { day, periodId }],
    );
  }

  function toggleDay(day: DayOfWeek) {
    const n = periods.filter((p) => on(day, p.id) || lesson(day, p.id)).length;
    const free = periods.filter((p) => !lesson(day, p.id));
    if (n > 0) {
      onChange(selected.filter((a) => a.day !== day));
    } else {
      onChange([...selected.filter((a) => a.day !== day), ...free.map((p) => ({ day, periodId: p.id }))]);
    }
  }

  return (
    <Field label="Orario in sede (senza classe)">
      <p className="text-[12px] text-muted-foreground">
        Indica le ore di servizio in sede: senza classe assegnata, sono disponibili per le sostituzioni. Seleziona
        Lun, Mar… per l’intera giornata. {selected.length} ore segnate.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[280px] border-collapse text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-1 py-1 text-left font-medium">Ore</th>
              {days.map((d) => {
                const n = periods.filter((p) => on(d, p.id)).length;
                return (
                  <th key={d} className="px-0.5 py-1 font-medium">
                    <button
                      type="button"
                      aria-label={n > 0 ? `Togli ${DAY_SHORT[d]}` : `Segna ${DAY_SHORT[d]} intero`}
                      onClick={() => toggleDay(d)}
                      className={cn(
                        "mx-auto flex h-10 min-w-10 items-center justify-center rounded-md px-1.5 text-[11px] font-medium",
                        n === periods.length && periods.length > 0
                          ? "bg-primary text-primary-foreground"
                          : n > 0
                            ? "bg-primary/25 text-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {DAY_SHORT[d]}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td className="px-1 py-1 text-muted-foreground">{p.index}ª</td>
                {days.map((d) => {
                  const busy = lesson(d, p.id);
                  const marked = on(d, p.id);
                  return (
                    <td key={d} className="p-0.5 text-center">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        aria-label={
                          busy
                            ? `${DAY_SHORT[d]} ${p.label}: già in classe`
                            : marked
                              ? `${DAY_SHORT[d]} ${p.label}: togli`
                              : `${DAY_SHORT[d]} ${p.label}: in sede`
                        }
                        onClick={() => toggle(d, p.id)}
                        className={cn(
                          "inline-flex size-10 touch-manipulation items-center justify-center rounded-md text-[10px] font-semibold",
                          busy
                            ? "bg-muted text-muted-foreground"
                            : marked
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {busy ? busy.label.replace(/^(\d)ª\s*/u, "$1") : marked ? "D" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Field>
  );
}
