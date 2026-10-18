import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Eraser, Lock, LockOpen, Save, Search, TriangleAlert, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs } from "@/components/ui/tabs";
import { useAppStore, snapshot } from "@/lib/store";
import { SaveSlots, SaveToSlotDialog } from "@/components/save-slots";
import {
  OFFICIAL_COPY_NAME,
  activeSlotOf,
  openSavedTimetable,
  slotsWithLessons,
  timetablePart,
  type TimetablePart,
} from "@/lib/saved-timetables";
import {
  isTimetableTeacher,
  timetableDemand,
  resolveCattedre,
  cattedreOfTeacher,
  MONTE_ORE,
} from "@/lib/build-timetable";
import {
  dayPatternOptions,
  dispIntoGaps,
  dispOutcome,
  evaluateCurrent,
  teacherDayInfo,
  teacherDayPatterns,
  teacherHoursHere,
  TimetableEditor,
  type DispMove,
  type FindResult,
  type FindTarget,
  type FixOption,
  type FixStep,
  type MoveEffect,
  type RowKey,
  type SolveMode,
  type SolveResult,
  type TimetableReport,
  type Who,
  type WhoChange,
} from "@/lib/timetable-solver";
import { runTimetable, type RunHandle, type RunProgress } from "@/lib/timetable-runner";
import { teacherName, teacherShort } from "@/lib/coverage";
import { subjectAbbr, weekCellLines } from "@/lib/sheet-image";
import {
  DAY_SHORT,
  SUBJECTS,
  type Cattedra,
  type DayOfWeek,
  type PersistedData,
  type SavedTimetable,
  type Teacher,
  type TimetableSlot,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { teacherCell } from "@/lib/teacher-palette";
import { corePeriods, isTpPeriodId } from "@/lib/periods";
import { autoAwayCells, linkedElsewhere, sedeName, withOtherSedi, type ElsewhereCell } from "@/lib/sedi";

type Cell = { day: DayOfWeek; periodId: string };
type CellState = "empty" | "no" | "away" | "class";
type Brush = "away" | "no" | "class" | "erase";
type ClassPick = {
  teacherId: string;
  day: DayOfWeek;
  periodId: string;
  selected: string[];
  level: "preferenza" | "obbligo";
  existing: boolean;
};
type MorningPeriod = ReturnType<typeof corePeriods>[number];

const BRUSHES: { value: Brush; label: string; hint: string }[] = [
  { value: "away", label: "Altrove", hint: "altro plesso o impegno" },
  { value: "no", label: "No", hint: "mai a quell’ora" },
  { value: "class", label: "Classe", hint: "una o tutte le sue classi" },
  { value: "erase", label: "Cancella", hint: "decide l’app" },
];

const sameCell = (a: Cell, day: DayOfWeek, periodId: string) => a.day === day && a.periodId === periodId;

function cellState(t: Teacher, day: DayOfWeek, periodId: string): CellState {
  if ((t.awaySlots ?? []).some((a) => sameCell(a, day, periodId))) return "away";
  if ((t.mustSlots ?? []).some((a) => sameCell(a, day, periodId))) return "class";
  if ((t.avoidSlots ?? []).some((a) => sameCell(a, day, periodId))) return "no";
  return "empty";
}

/** Le caselle date passano allo stato voluto; tutto il resto del docente resta com’è. */
function withCells(t: Teacher, cells: Cell[], state: Exclude<CellState, "class">): Partial<Teacher> {
  const hit = (a: Cell) => cells.some((c) => sameCell(a, c.day, c.periodId));
  const rest = <T extends Cell>(list: T[] | undefined) => (list ?? []).filter((a) => !hit(a));
  return {
    awaySlots: [...rest(t.awaySlots), ...(state === "away" ? cells : [])],
    avoidSlots: [...rest(t.avoidSlots), ...(state === "no" ? cells : [])],
    mustSlots: rest(t.mustSlots),
  };
}

/** Pieno = va sempre rispettato, chiaro con bordo = se possibile. Divieto rosso, obbligo blu. */
const CELL_STYLE: Record<CellState, string> = {
  empty: "bg-muted text-muted-foreground hover:bg-secondary",
  away: "bg-primary text-primary-foreground",
  no: "bg-destructive text-destructive-foreground text-[12px] font-semibold",
  class: "bg-class-mark/20 text-foreground text-[11px] font-semibold ring-1 ring-inset ring-class-mark/65",
};
const HARD_CLASS_STYLE = "bg-class-mark text-class-mark-foreground text-[11px] font-semibold";

/** Il segno nella casella: la × è un’icona, così ha la stessa misura del resto. */
function MarkGlyph({ state, label }: { state: CellState; label?: string }) {
  if (state === "away") return <X className="size-4" strokeWidth={2.5} aria-hidden />;
  if (state === "no") return <>no</>;
  if (state === "class") return <>{label}</>;
  return null;
}

export function CostruisciOrario({
  openSlot,
  onSlotOpened,
}: {
  /** slot da aprire subito (da Impostazioni) */
  openSlot?: number;
  onSlotOpened?: () => void;
} = {}) {
  const store = useAppStore();
  // i dati come li salva l'app; per il motore e i controlli, con le ore dei docenti nelle altre sedi come ×
  const rawData = snapshot(store);
  const data = withOtherSedi(rawData);
  const previewRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<SolveMode>("scratch");
  const [speed, setSpeed] = useState<"rapida" | "accurata">("rapida");
  const [running, setRunning] = useState<RunProgress | null>(null);
  const handleRef = useRef<RunHandle | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [resultMode, setResultMode] = useState<SolveMode>("scratch");
  const [currentReport, setCurrentReport] = useState<TimetableReport | null>(null);
  const [confirmFor, setConfirmFor] = useState<"proposta" | "ritocchi" | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  // slot aperto come proposta: le sue ore a disposizione del mattino al posto di quelle in vigore
  const [openSave, setOpenSave] = useState<SavedTimetable | null>(null);
  // proposta salvata in uno slot
  const [savedIn, setSavedIn] = useState<number | null>(null);
  // «Salva nello slot…»: la proposta o i ritocchi
  const [saveFor, setSaveFor] = useState<"proposta" | "ritocchi" | null>(null);
  const editRef = useRef<HTMLElement>(null);
  // testata di «Proposta» (fissa in alto): se è in vista porta lei la barra, altrimenti la fascia in cima
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newHours, setNewHours] = useState("1");
  const [previewMode, setPreviewMode] = useState<"settimana" | "docenti" | "class" | "quadro">("settimana");
  const [previewClassId, setPreviewClassId] = useState(data.classes[0]?.id ?? "");
  const [previewDay, setPreviewDay] = useState<DayOfWeek>(data.settings.days[0] ?? 1);
  const [classPick, setClassPick] = useState<ClassPick | null>(null);
  const [patternFor, setPatternFor] = useState<string | null>(null);
  const [cattedraClassId, setCattedraClassId] = useState(data.classes[0]?.id ?? "");
  const morning = corePeriods(data.settings.periods);

  const byName = (a: Teacher, b: Teacher) =>
    a.lastName.localeCompare(b.lastName, "it") || a.firstName.localeCompare(b.firstName, "it");
  const included = useMemo(() => data.teachers.filter(isTimetableTeacher).sort(byName), [data.teachers]);
  // nelle schede «Quando ci sono i docenti» si cambiano solo i segni messi a mano
  const rawIncluded = useMemo(() => rawData.teachers.filter(isTimetableTeacher).sort(byName), [rawData.teachers]);
  const elsewhere = useMemo(() => {
    const map = new Map<string, { cells: ElsewhereCell[]; sedi: string[] }>();
    for (const t of rawData.teachers) {
      const links = linkedElsewhere(rawData, t);
      if (!links.length) continue;
      map.set(t.id, {
        cells: autoAwayCells(rawData, t),
        sedi: [...new Set(links.map((l) => sedeName(l.sede.settings)))],
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData.teachers, rawData.altreSedi, rawData.settings.periods]);
  const skipped = useMemo(() => data.teachers.filter((t) => !isTimetableTeacher(t)).sort(byName), [data.teachers]);
  const demand = useMemo(() => timetableDemand(data), [data]);
  const hoursHere = useMemo(() => teacherHoursHere(data), [data]);
  const cattedre = useMemo(() => resolveCattedre(data), [data]);
  const classOrder = useMemo(
    () => [...data.classes].sort((a, b) => a.name.localeCompare(b.name, "it")),
    [data.classes],
  );

  // Anteprima: solo docenti di materia (sostegno, potenziamento e strumento non si vedono).
  const pendingSlots: TimetableSlot[] | null = result?.slots ?? null;
  const previewSlots = useMemo(() => {
    if (!pendingSlots) return null;
    const keep = data.slots.filter((s) => {
      if (!isTpPeriodId(data.settings.periods, s.periodId)) return false;
      const t = data.teachers.find((x) => x.id === s.teacherId);
      return Boolean(t && isTimetableTeacher(t));
    });
    return [...keep, ...pendingSlots];
  }, [pendingSlots, data.slots, data.teachers, data.settings.periods]);
  const slotBase = useMemo(() => (openSave ? openSavedTimetable(data, openSave).base : data), [openSave, data]);
  // ore a disposizione messe dall'app nelle buche: «Da zero» (tutte da capo) e slot aperti (non lo 0);
  // «Migliora» le sposta già da sé, nello stesso giorno
  const dispPlan = useMemo(() => {
    if (!result || result.disp || openSave?.n === 0 || (!openSave && resultMode !== "scratch")) return null;
    const plan = dispIntoGaps({ ...slotBase, slots: slotsWithLessons(slotBase, result.slots) }, { replace: !openSave });
    return plan.moves.length ? plan : null;
  }, [result, openSave, resultMode, slotBase]);
  // da dove partono le ore a disposizione della proposta: quelle in vigore o dello slot, più quelle messe dall'app
  const propBase = useMemo(
    () =>
      dispPlan
        ? {
            ...slotBase,
            teachers: slotBase.teachers.map((t) =>
              dispPlan.dispSlots[t.id] ? { ...t, dispSlots: dispPlan.dispSlots[t.id] } : t,
            ),
          }
        : slotBase,
    [slotBase, dispPlan],
  );
  // il confronto della proposta, con le ore a disposizione dove finiranno
  const proposalReport = useMemo(() => {
    if (!result) return null;
    if (result.disp || (!openSave && resultMode !== "scratch")) return result.report;
    return evaluateCurrent({ ...propBase, slots: slotsWithLessons(propBase, result.slots) });
  }, [result, openSave, resultMode, propBase]);
  // scheda «Docenti» dell'anteprima: con uno slot aperto, le ore a disposizione sono quelle salvate nello slot
  const previewTeachers = useMemo(
    () => (propBase !== data ? propBase.teachers.filter(isTimetableTeacher).sort(byName) : included),
    [propBase, data, included],
  );
  const previewData = useMemo(
    () => (previewSlots ? { ...propBase, slots: previewSlots } : null),
    [propBase, previewSlots],
  );
  // la testata di «Proposta» (fissa in alto) è in vista? Allora la barra di avanzamento sta lì
  const showHeader = Boolean(!edit && previewSlots && previewData && result);
  useEffect(() => {
    const el = headerRef.current;
    if (!showHeader || !el || typeof IntersectionObserver === "undefined") {
      setHeaderVisible(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setHeaderVisible(Boolean(e?.isIntersecting)), { threshold: 0.99 });
    io.observe(el);
    return () => io.disconnect();
  }, [showHeader]);
  // cambiando pagina o sede la ricerca in corso si ferma
  useEffect(() => () => handleRef.current?.stop(), []);
  // lezioni del mattino dei docenti di materia: quelle che Costruisci e i ritocchi cambiano
  const pool = useMemo(() => new Set(included.map((t) => t.id)), [included]);
  const inUseDraft = useMemo(
    () => data.slots.filter((s) => pool.has(s.teacherId) && !isTpPeriodId(data.settings.periods, s.periodId)),
    [data.slots, data.settings.periods, pool],
  );
  const applySlots =
    confirmFor === "ritocchi" ? (edit?.draft ?? null) : confirmFor === "proposta" ? (result?.slots ?? null) : null;
  // da dove partono le ore a disposizione: quelle in vigore o quelle della proposta (slot aperto, messe dall'app)
  const editBase = edit?.from === "proposta" ? propBase : data;
  const applyBase = confirmFor === "proposta" ? propBase : editBase;
  // «Usa…»: ore a disposizione dello slot aperto, e quelle sistemate dall'app nella proposta
  const applyFromSlot = Boolean(openSave) && (confirmFor === "proposta" || edit?.from === "proposta");
  const applyMoves =
    confirmFor === "proposta" || (confirmFor === "ritocchi" && edit?.from === "proposta") ? (dispPlan?.moves ?? []) : [];
  // ore a disposizione del mattino: dove le lascia la proposta o dove stanno dopo i ritocchi
  const editDispChange = (draft: TimetableSlot[]) =>
    new TimetableEditor({ ...editBase, slots: slotsWithLessons(editBase, draft) }).dispChange();
  const applyChange = useMemo(() => {
    if (confirmFor === "proposta") return result?.disp ?? null;
    if (confirmFor !== "ritocchi" || !edit) return null;
    return new TimetableEditor({ ...editBase, slots: slotsWithLessons(editBase, edit.draft) }).dispChange();
  }, [confirmFor, result, edit, editBase]);
  const applyInfo = useMemo(
    () => (applySlots ? dispOutcome(applyBase, applySlots, applyChange) : null),
    [applyBase, applySlots, applyChange],
  );
  // slot dell'orario in uso nell'app (0 = in vigore)
  const active = activeSlotOf(data);
  // ritocchi dell'orario in uso mentre si prova uno slot: restano in quello slot
  const fixedUseSlot = confirmFor === "ritocchi" && edit?.from === "uso" && active !== 0 ? active : null;
  const shortOf = (id: string) => {
    const t = data.teachers.find((x) => x.id === id);
    return t ? teacherShort(t, data.teachers) : id;
  };
  const hourOf = (id: string) => `${data.settings.periods.find((x) => x.id === id)?.index ?? "?"}ª`;
  const dispMovedText = (m: { teacherId: string; day: DayOfWeek; from: string; to: string }) =>
    `${shortOf(m.teacherId)} · ${DAY_SHORT[m.day]} ${hourOf(m.from)} → ${hourOf(m.to)}`;
  // es. «Vavalà · Ven 3ª → Mar 4ª», «Rossi · Lun 3ª → 4ª», «Bianchi · aggiunta Mer 2ª»
  const dispPlanText = (m: DispMove) => {
    const to = `${DAY_SHORT[m.to.day]} ${hourOf(m.to.periodId)}`;
    if (!m.from) return `${shortOf(m.teacherId)} · aggiunta ${to}`;
    const from = `${DAY_SHORT[m.from.day]} ${hourOf(m.from.periodId)}`;
    return `${shortOf(m.teacherId)} · ${from} → ${m.from.day === m.to.day ? hourOf(m.to.periodId) : to}`;
  };
  // ore al giorno scelte: con le disposizioni che restano dopo «Usa…», chi va sistemato a mano
  const patternTodo = useMemo(() => {
    if (!applySlots || !applyInfo || !applyBase.teachers.some((t) => teacherDayPatterns(t).length))
      return [[], []];
    const teachers = applyBase.teachers.map((t) =>
      applyInfo.dispSlots[t.id] ? { ...t, dispSlots: applyInfo.dispSlots[t.id] } : t,
    );
    const ids = new Set(inUseDraft.map((s) => s.id));
    const keep = data.slots.filter((s) => !ids.has(s.id));
    const rows = evaluateCurrent({ ...applyBase, teachers, slots: [...keep, ...applySlots] }).patterns.rows;
    return [
      rows.filter((r) => r.excess > 0).map((r) => r.name),
      rows.filter((r) => r.excess === 0 && r.missing > 0).map((r) => r.name),
    ];
  }, [applyInfo, applySlots, applyBase, data.slots, inUseDraft]);
  // ore bloccate che corrispondono a una lezione dell'orario in uso
  const lockCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.teachers) {
      const n = (t.lockedSlots ?? []).filter((a) =>
        data.slots.some((s) => s.teacherId === t.id && s.day === a.day && s.periodId === a.periodId && s.classId === a.classId),
      ).length;
      if (n) m.set(t.id, n);
    }
    return m;
  }, [data.teachers, data.slots]);

  function propose() {
    if (handleRef.current) return;
    if (timetableDemand(data).lessons.length === 0) {
      toast.message("Niente da piazzare: inserisci prima docenti, classi e ore in orario.");
      return;
    }
    setCurrentReport(evaluateCurrent(data));
    setRunning({ fraction: 0, iterations: 0, bestHard: 0, bestSoft: 0, bestGaps: 0, workers: 0 });
    const runMode = mode;
    const handle = runTimetable(data, {
      timeMs: speed === "accurata" ? 35000 : 12000,
      mode: runMode,
      onProgress: (p) => setRunning(p),
    });
    handleRef.current = handle;
    handle.result
      .then((res) => {
        setResult(res);
        setResultMode(runMode);
        setOpenSave(null);
        setSavedIn(null);
        window.setTimeout(() => {
          previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      })
      .catch((err: unknown) => {
        toast.error(`La costruzione si è fermata: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        handleRef.current = null;
        setRunning(null);
      });
  }

  /** «Usa questo orario»: va nello slot di prova `n` e diventa quello in uso; lo slot 0 non cambia. */
  function putInUse(n: number, name: string) {
    if (!confirmFor || !applyInfo) return;
    store.putInSlot(n, partFor(confirmFor), name);
    const removed = applyInfo.removed.length;
    const moved = applyInfo.moved.length;
    const fixed = applyMoves.length;
    setConfirmFor(null);
    setResult(null);
    setEdit(null);
    setOpenSave(null);
    setSavedIn(null);
    const notes = [
      fixed ? (fixed === 1 ? "Sistemata 1 ora a disposizione dall’app." : `Sistemate ${fixed} ore a disposizione dall’app.`) : "",
      moved ? (moved === 1 ? "Spostata 1 ora a disposizione nello stesso giorno." : `Spostate ${moved} ore a disposizione nello stesso giorno.`) : "",
      removed ? `Tolte ${removed} ore a disposizione che cadevano su una lezione.` : "",
    ].filter(Boolean);
    toast.success([`Slot ${n} in uso. L’orario in vigore resta nello slot 0.`, ...notes].join(" "));
  }

  /** Uno slot aperto diventa quello in uso; le ore a disposizione sistemate dall’app restano nello slot. */
  function activateOpened() {
    if (!openSave) return;
    const fixed = openSave.n > 0 ? (dispPlan?.moves.length ?? 0) : 0;
    if (fixed) store.putInSlot(openSave.n, partFor("proposta"), openSave.name);
    else store.activateSlot(openSave.n);
    closeProposal();
    const withFixed = fixed
      ? `, con ${fixed === 1 ? "1 ora a disposizione sistemata" : `${fixed} ore a disposizione sistemate`} dall’app`
      : "";
    toast.success(
      openSave.n === 0
        ? "In uso l’orario in vigore."
        : `Slot ${openSave.n} in uso${withFixed}. L’orario in vigore resta nello slot 0.`,
    );
  }

  function openEdit(from: EditState["from"]) {
    setEdit({ draft: from === "proposta" && result ? result.slots : inUseDraft, history: [], from });
    window.setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  /** Apre uno slot come proposta: si confronta con l’orario in vigore, si ritocca, si usa. */
  function showSaved(save: SavedTimetable, keepEdit = false) {
    const open = openSavedTimetable(data, save);
    setCurrentReport(evaluateCurrent(data));
    setResult({
      slots: open.lessons,
      report: evaluateCurrent({ ...open.base, slots: slotsWithLessons(data, open.lessons) }),
      iterations: 0,
      disp: null,
    });
    setResultMode("improve");
    setOpenSave(save);
    setSavedIn(null);
    if (!keepEdit) setEdit(null);
    return open.dropped;
  }

  function openSaved(n: number) {
    const save = (data.savedTimetables ?? []).find((s) => s.n === n);
    if (!save) return;
    if (handleRef.current) {
      toast.message("Aspetta che finisca la ricerca, oppure fermala.");
      return;
    }
    const dropped = showSaved(save);
    if (dropped) {
      toast.message(
        dropped === 1
          ? "1 lezione di docenti o classi che non ci sono più non è stata caricata."
          : `${dropped} lezioni di docenti o classi che non ci sono più non sono state caricate.`,
      );
    }
    window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  // da Impostazioni: apre lo slot richiesto una volta sola
  const openSavedRef = useRef(openSaved);
  openSavedRef.current = openSaved;
  const onSlotOpenedRef = useRef(onSlotOpened);
  onSlotOpenedRef.current = onSlotOpened;
  const handledSlot = useRef<number | null>(null);
  useEffect(() => {
    if (openSlot === undefined || handledSlot.current === openSlot) return;
    handledSlot.current = openSlot;
    openSavedRef.current(openSlot);
    onSlotOpenedRef.current?.();
  }, [openSlot]);

  function closeProposal() {
    setResult(null);
    setOpenSave(null);
    setSavedIn(null);
  }

  /** L’orario da salvare o da usare: la proposta o i ritocchi. */
  function partFor(what: "proposta" | "ritocchi"): TimetablePart {
    if (what === "proposta" && result) {
      return timetablePart(propBase, result.slots, dispOutcome(propBase, result.slots, result.disp).dispSlots);
    }
    if (what === "ritocchi" && edit) {
      return timetablePart(editBase, edit.draft, dispOutcome(editBase, edit.draft, editDispChange(edit.draft)).dispSlots);
    }
    return timetablePart(data);
  }

  function saveName(what: "proposta" | "ritocchi"): string {
    if (what === "ritocchi" && edit?.from === "uso") {
      if (active === 0) return "Ritoccato";
      return (data.savedTimetables ?? []).find((s) => s.n === active)?.name ?? `Slot ${active}`;
    }
    if (openSave) {
      if (openSave.n === 0) return what === "proposta" ? OFFICIAL_COPY_NAME : "Orario in vigore ritoccato";
      return openSave.name;
    }
    const proposal = resultMode === "scratch" ? "Da zero" : "Migliorato";
    return what === "proposta" ? proposal : `${proposal} e ritoccato`;
  }

  function afterSave(what: "proposta" | "ritocchi", n: number) {
    const entry = (useAppStore.getState().savedTimetables ?? []).find((s) => s.n === n);
    if (what === "proposta") {
      setSavedIn(n);
      if (entry && openSave?.n === n) setOpenSave(entry);
    }
    if (what === "ritocchi" && edit) {
      setEdit({ ...edit, savedIn: n, savedLen: edit.history.length });
      // ritocchi dello slot aperto, salvati nello stesso slot: la proposta diventa il nuovo contenuto
      if (entry && edit.from === "proposta" && openSave?.n === n) showSaved(entry, true);
    }
  }

  const editDirty = Boolean(edit && edit.history.length !== (edit.savedLen ?? 0));
  const openWarning =
    [
      editDirty ? "I ritocchi non salvati andranno persi." : "",
      result && !openSave && !savedIn ? "La proposta non salvata andrà persa." : "",
    ]
      .filter(Boolean)
      .join(" ") || null;

  function openClassPick(t: Teacher, day: DayOfWeek, periodId: string) {
    const must = (t.mustSlots ?? []).find((a) => sameCell(a, day, periodId));
    const ids = must?.allClasses
      ? [...new Set(cattedreOfTeacher(data, t.id).map((c) => c.classId))]
      : must
        ? must.classIds?.length
          ? must.classIds
          : must.classId
            ? [must.classId]
            : []
        : [];
    setClassPick({
      teacherId: t.id,
      day,
      periodId,
      selected: ids,
      level: must?.level === "obbligo" ? "obbligo" : "preferenza",
      existing: Boolean(must),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {running && !headerVisible && (
        <div
          role="status"
          className="sticky top-0 z-30 -mx-1 flex items-center gap-2 border-b border-border bg-background px-1 py-2 md:bg-background/95 md:backdrop-blur-sm"
        >
          <span className="font-display text-lg">Proposta</span>
          <SearchBar progress={running} className="min-w-0 flex-1 md:mr-auto md:flex-none" />
          <Button variant="outline" onClick={() => handleRef.current?.stop()}>
            Basta così
          </Button>
        </div>
      )}
      <section className="paper-panel rounded-xl p-4 sm:p-5">
        <h2 className="font-display text-lg">Orari salvati</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Lo 0 è l’orario in vigore a scuola; negli slot da 1 a 5 conservi le prove. Lo slot acceso è quello in uso
          nell’app.
        </p>
        <SaveSlots
          className="mt-3"
          onOpen={openSaved}
          openWarning={openWarning}
          onInUseChange={() => {
            // è cambiato l'orario in uso: proposta e ritocchi aperti erano confrontati con l'altro
            setResult(null);
            setEdit(null);
            setOpenSave(null);
            setSavedIn(null);
          }}
        />
      </section>

      <HowItWorks />

      <AvailabilityPanel
        teachers={rawIncluded}
        elsewhere={elsewhere}
        skipped={skipped}
        days={data.settings.days}
        morning={morning}
        classes={data.classes}
        hoursHere={hoursHere}
        lockCount={lockCount}
        onUpdate={(id, patch) => store.updateTeacher(id, patch)}
        onClassPick={openClassPick}
        onPattern={(t) => setPatternFor(t.id)}
      />

      <CattedrePanel
        classId={cattedraClassId || classOrder[0]?.id || ""}
        onClassId={setCattedraClassId}
        classes={classOrder}
        teachers={included}
        cattedre={cattedre}
        unassigned={demand.unassigned}
        newSubject={newSubject}
        newHours={newHours}
        onNewSubject={setNewSubject}
        onNewHours={setNewHours}
        onWrite={(next) => store.setCattedre(next)}
      />

      <section className="paper-panel rounded-xl p-5">
        <StepTitle n={3} title="Proponi l’orario" />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented
            label="Punto di partenza"
            value={mode}
            onChange={setMode}
            disabled={Boolean(running)}
            options={[
              { value: "scratch", label: "Da zero" },
              { value: "improve", label: "Migliora l’attuale" },
            ]}
          />
          <Segmented
            label="Tempo di ricerca"
            value={speed}
            onChange={setSpeed}
            disabled={Boolean(running)}
            options={[
              { value: "rapida", label: "Rapida · 12 s" },
              { value: "accurata", label: "Accurata · 35 s" },
            ]}
          />
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {mode === "scratch"
            ? "Genera un nuovo orario e poi mette le ore a disposizione nelle ore buche. Nella ricerca le ore buche colmabili con ore a disposizione non vengono conteggiate, ma al massimo una al giorno."
            : "Migliora l’orario in uso senza peggiorare nessuna voce. Le ore a disposizione si spostano solo nello stesso giorno, per chiudere un’ora buca."}
          {speed === "accurata" ? " Richiede più tempo, ma in genere trova soluzioni migliori." : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={propose} disabled={Boolean(running)}>
            {running ? "Sto cercando…" : "Proponi orario"}
          </Button>
          <Button variant="outline" onClick={() => openEdit("uso")} disabled={Boolean(running) || !inUseDraft.length}>
            Ritocca a mano
          </Button>
        </div>
        {running && <SearchProgress progress={running} onStop={() => handleRef.current?.stop()} />}
      </section>

      {edit && (
        <Ritocchi
          sectionRef={editRef}
          edit={edit}
          settings={data.settings}
          teachersAll={data.teachers}
          baseTeachers={edit.from === "proposta" && propBase !== data ? propBase.teachers : undefined}
          classesAll={data.classes}
          slots={data.slots}
          cattedre={data.cattedre}
          teachers={included}
          classes={classOrder}
          morning={morning}
          onChange={setEdit}
          onClose={() => setEdit(null)}
          onApply={() => setConfirmFor("ritocchi")}
          onSave={() => setSaveFor("ritocchi")}
          onUpdateTeacher={(id, patch) => store.updateTeacher(id, patch)}
        />
      )}

      {!edit && previewSlots && previewData && result && proposalReport && (
        <section ref={previewRef} className="mt-1 max-md:pb-16">
          <div
            ref={headerRef}
            className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b border-border bg-background px-1 py-2 md:bg-background/95 md:backdrop-blur-sm"
          >
            <h2 className={cn("min-w-0 font-display text-lg", !running && "mr-auto")}>
              {openSave ? `Slot ${openSave.n} · ${openSave.name}` : "Proposta"}
            </h2>
            {running ? (
              <SearchBar progress={running} className="min-w-0 flex-1 md:mr-auto md:flex-none" />
            ) : (
              <span className="hidden text-[13px] text-muted-foreground sm:inline">
                {savedIn ? `Salvata nello slot ${savedIn}` : openSave ? "Aperto dallo slot" : "Non ancora salvata"}
              </span>
            )}
            {/* «Salva» resta in alto anche sul telefono; sul computer va prima di «Usa…» */}
            <Button
              variant="outline"
              className="md:order-1"
              onClick={() => setSaveFor("proposta")}
              aria-label="Salva nello slot"
            >
              <Save aria-hidden />
              <span className="md:hidden">Salva</span>
              <span className="hidden md:inline">Salva nello slot…</span>
            </Button>
            {/* sul telefono i bottoni stanno in una barra fissa in basso */}
            <div className="fixed inset-x-0 bottom-14 z-30 flex items-center gap-2 border-t border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:contents">
              {running ? (
                <Button variant="outline" className="max-md:px-3" onClick={() => handleRef.current?.stop()}>
                  Basta così
                </Button>
              ) : openSave ? (
                <Button variant="outline" className="max-md:px-3" onClick={closeProposal}>
                  Chiudi
                </Button>
              ) : (
                <Button variant="outline" className="max-md:px-3" onClick={propose}>
                  Riprova
                </Button>
              )}
              <Button variant="outline" className="max-md:px-3" onClick={() => openEdit("proposta")}>
                Ritocca
              </Button>
              <Button
                className="max-md:flex-1 md:order-2"
                onClick={() => (openSave ? activateOpened() : setConfirmFor("proposta"))}
              >
                {openSave ? "Usa questo orario" : "Usa questa proposta"}
              </Button>
            </div>
          </div>
          {dispPlan && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              Ore a disposizione sistemate dall’app, per togliere ore buche o rispettare i vincoli (nella scheda
              «Docenti» con <span className="rounded bg-success-soft px-1 font-medium text-success">+ disp.</span>):{" "}
              {dispPlan.moves.map(dispPlanText).join("; ")}.
              {openSave ? " Restano nello slot con «Usa questo orario» o «Salva nello slot…»." : ""}
            </p>
          )}
          <ReportPanel
            current={currentReport}
            proposal={proposalReport}
            mode={openSave ? "edit" : resultMode}
            label={openSave ? `Slot ${openSave.n}` : undefined}
          />
          <div className="mt-4 flex flex-col gap-3">
            <Tabs
              className="flex-wrap overflow-visible"
              value={previewMode}
              onValueChange={(v) => setPreviewMode(v as "settimana" | "docenti" | "class" | "quadro")}
              items={[
                { value: "settimana", label: "Settimana" },
                { value: "docenti", label: "Docenti" },
                { value: "class", label: "Classe" },
                { value: "quadro", label: "Giorno" },
              ]}
            />
            {previewMode === "class" && (
              <NativeSelect
                className="sm:max-w-xs"
                value={previewClassId}
                onChange={(e) => setPreviewClassId(e.target.value)}
              >
                {classOrder.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.tempo})
                  </option>
                ))}
              </NativeSelect>
            )}
            {previewMode === "quadro" && (
              <div className="flex flex-wrap gap-1.5">
                {data.settings.days.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setPreviewDay(d)}
                    className={cn(
                      "h-10 min-w-14 rounded-md px-3 text-sm font-medium",
                      previewDay === d
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {DAY_SHORT[d]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {previewMode === "settimana" && (
            <div className="paper-panel mt-3 overflow-x-auto rounded-xl">
              <table className="w-full min-w-[720px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="sticky left-0 z-10 w-20 bg-card px-3 py-2 font-medium">Classe</th>
                    {data.settings.days.map((d) => (
                      <th key={d} className="px-2 py-2 font-medium text-foreground">
                        {DAY_SHORT[d]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {classOrder.map((c) => (
                    <tr key={c.id} className="border-b border-border align-top last:border-0">
                      <td className="sticky left-0 z-10 bg-card px-3 py-2">
                        <div className="text-[13px] font-medium">{c.name}</div>
                        <div className="text-[10px] tracking-wide text-ink-faint">{c.tempo}</div>
                      </td>
                      {data.settings.days.map((d) => (
                        <td key={d} className="px-2 py-2 text-[11px] font-normal leading-[1.35]">
                          {weekCellLines(previewData, c.id, d).map((line, i) => (
                            <div
                              key={`${c.id}-${d}-${i}`}
                              className={line.teacher ? "text-foreground" : "text-ink-faint"}
                            >
                              {line.teacher ? (
                                <>
                                  {line.period} {line.subject}{" "}
                                  <span className="font-semibold">{line.teacher}</span>
                                </>
                              ) : (
                                `${line.period}  —`
                              )}
                            </div>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {previewMode === "docenti" && (
            <TeacherWeekPreview
              data={previewData}
              report={proposalReport}
              added={dispPlan?.moves ?? []}
              disp={dispOutcome(propBase, result.slots, result.disp).dispSlots}
              teachers={previewTeachers}
              days={data.settings.days}
              periods={morning}
            />
          )}

          {previewMode === "class" && (
            <ClassPreview
              slots={previewSlots}
              classId={previewClassId || classOrder[0]?.id || ""}
              days={data.settings.days}
              periods={morning}
              teachers={data.teachers}
            />
          )}
          {previewMode === "quadro" && (
            <DayPreview
              slots={previewSlots}
              day={previewDay}
              classes={classOrder}
              periods={morning}
              teachers={data.teachers}
            />
          )}
        </section>
      )}

      <ClassPickDialog
        pick={classPick}
        data={data}
        morning={morning}
        onChange={setClassPick}
        onSave={(pick, remove, all) => {
          const t = rawData.teachers.find((x) => x.id === pick.teacherId);
          if (!t) return;
          const cell = { day: pick.day, periodId: pick.periodId };
          const patch = withCells(t, [cell], "empty");
          store.updateTeacher(t.id, {
            ...patch,
            mustSlots: remove
              ? patch.mustSlots
              : [
                  ...(patch.mustSlots ?? []),
                  { ...cell, classIds: pick.selected, level: pick.level, ...(all ? { allClasses: true } : {}) },
                ],
          });
          setClassPick(null);
        }}
      />

      <DayPatternDialog
        teacher={patternFor ? (data.teachers.find((t) => t.id === patternFor) ?? null) : null}
        data={data}
        onClose={() => setPatternFor(null)}
        onChange={(t, list) => store.updateTeacher(t.id, { dayPatterns: list, dayPattern: undefined })}
        onTwoFree={(t, on) => store.updateTeacher(t.id, { allowTwoFree: on })}
        onNoGaps={(t, noGaps) => store.updateTeacher(t.id, { noGaps })}
      />

      <SaveToSlotDialog
        open={confirmFor !== null}
        mode="use"
        onClose={() => setConfirmFor(null)}
        title={confirmFor === "ritocchi" ? "Usare questo orario?" : "Usare questa proposta?"}
        description={
          fixedUseSlot
            ? `Cambiano le lezioni del mattino dei docenti di materia dello slot ${fixedUseSlot}, quello in uso. L’orario in vigore (slot 0) non cambia.`
            : "Cambiano solo le lezioni del mattino dei docenti di materia. Va in uno slot di prova e diventa quello in uso: l’orario in vigore (slot 0) non cambia."
        }
        notes={
          <ul className="mb-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            {applyMoves.length > 0 && (
              <li>
                Ore a disposizione sistemate dall’app, per togliere ore buche o rispettare i vincoli:{" "}
                {applyMoves.map(dispPlanText).join("; ")}.
              </li>
            )}
            <li>
              {applyMoves.length ? "Le altre ore a disposizione" : "Le ore a disposizione"}
              {applyFromSlot ? " del mattino sono quelle salvate nello slot" : " restano dove sono"}
              {applyInfo?.moved.length
                ? `, tranne ${applyInfo.moved.length === 1 ? "una, spostata" : `${applyInfo.moved.length}, spostate`} nello stesso giorno: ${applyInfo.moved.map(dispMovedText).join("; ")}`
                : ""}
              {applyInfo?.removed.length
                ? `; ${applyInfo.removed.length} cadono su una lezione nuova e vengono tolte.`
                : "."}
            </li>
            {patternTodo[0]!.length > 0 && (
              <li className="text-destructive">Ore al giorno scelte non rispettate: {joinNames(patternTodo[0]!)}.</li>
            )}
            {patternTodo[1]!.length > 0 && (
              <li>Ore al giorno scelte: poi aggiungi le disposizioni di {joinNames(patternTodo[1]!)}.</li>
            )}
            <li>Le ore di sostegno vanno sistemate manualmente.</li>
          </ul>
        }
        defaultName={confirmFor ? saveName(confirmFor) : ""}
        openSlot={openSave?.n ?? null}
        fixedSlot={fixedUseSlot}
        onPick={(n, name) => putInUse(n, name)}
      />

      <SaveToSlotDialog
        open={saveFor !== null}
        onClose={() => setSaveFor(null)}
        defaultName={saveFor ? saveName(saveFor) : ""}
        getPart={() => partFor(saveFor ?? "proposta")}
        openSlot={openSave?.n ?? null}
        onSaved={(n) => {
          if (saveFor) afterSave(saveFor, n);
        }}
      />
    </div>
  );
}

type EditState = {
  /** lezioni del mattino dei docenti di materia, con i ritocchi */
  draft: TimetableSlot[];
  /** per «Annulla»: com’era prima di ogni cambio */
  history: TimetableSlot[][];
  /** da dove si parte: l’orario in uso o una proposta */
  from: "uso" | "proposta";
  /** salvati in uno slot: quale, e a quanti cambi */
  savedIn?: number;
  savedLen?: number;
};

const VERDICT_CELL: Record<MoveEffect["verdict"], string> = {
  better: "bg-success-soft ring-1 ring-inset ring-success/70",
  mixed: "bg-warning-soft ring-1 ring-inset ring-warning/70",
  worse: "bg-danger-soft ring-1 ring-inset ring-destructive/50",
  // vietato: resta in secondo piano, con il segnale
  breaks: "bg-muted opacity-60",
  same: "bg-muted",
};
const VERDICT_WORD: Record<MoveEffect["verdict"], string> = {
  better: "meglio",
  mixed: "in parte meglio, in parte peggio",
  worse: "peggio",
  breaks: "non rispetta un vincolo",
  same: "non cambia niente",
};
/** Legenda dei Ritocchi: quadratini come le celle, con lo stesso simbolo. */
const LEGEND: { label: string; verdict: MoveEffect["verdict"]; swatch: string }[] = [
  { label: "meglio", verdict: "better", swatch: VERDICT_CELL.better },
  { label: "in parte", verdict: "mixed", swatch: VERDICT_CELL.mixed },
  { label: "peggio", verdict: "worse", swatch: VERDICT_CELL.worse },
  { label: "vietato", verdict: "breaks", swatch: "bg-muted" },
];
/** L'esito non è affidato solo al colore: ↑ meglio, ≈ in parte, ↓ peggio, ⚠ vietato. */
const VERDICT_SYMBOL: Record<MoveEffect["verdict"], string> = {
  better: "↑",
  mixed: "≈",
  worse: "↓",
  breaks: "⚠",
  same: "=",
};
const VERDICT_TEXT: Record<MoveEffect["verdict"], string> = {
  better: "text-success",
  mixed: "text-warning",
  worse: "text-destructive",
  breaks: "text-destructive",
  same: "text-muted-foreground",
};

function VerdictMark({ verdict, className }: { verdict: MoveEffect["verdict"]; className?: string }) {
  if (verdict === "breaks") return <TriangleAlert className={cn("size-3 shrink-0 text-destructive", className)} aria-hidden />;
  return (
    <span className={cn("shrink-0 text-[12px] font-bold leading-none", VERDICT_TEXT[verdict], className)} aria-hidden>
      {VERDICT_SYMBOL[verdict]}
    </span>
  );
}

/** «Trova»: cosa si cerca, su quale orario (se cambia, le proposte non valgono più) e a che punto è. */
type FindJob = { target: FindTarget; forEditor: TimetableEditor; data: PersistedData };
/** Il messaggio dopo un cambio; `changed`: i docenti a cui cambia l'orario (si toccano per vederne la settimana). */
type Notice = { text: string; changed?: string[] };

/** I docenti a cui cambiano le lezioni (giorno, ora, classe o materia), in ordine di nome. */
function changedTeachers(before: TimetableSlot[], after: TimetableSlot[], nameOf: (id: string) => string): string[] {
  const byTeacher = (list: TimetableSlot[]) => {
    const m = new Map<string, string[]>();
    for (const x of list) m.set(x.teacherId, [...(m.get(x.teacherId) ?? []), `${x.day}|${x.periodId}|${x.classId}|${x.subject}`]);
    return new Map([...m].map(([id, v]) => [id, v.sort().join(",")]));
  };
  const a = byTeacher(before);
  const b = byTeacher(after);
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((id) => a.get(id) !== b.get(id))
    .sort((x, y) => nameOf(x).localeCompare(nameOf(y), "it"));
}
type FindState = { job: FindJob; progress: number; result: FindResult | null };

function sameTarget(a: FindTarget, b: FindTarget): boolean {
  if (a.z !== b.z) return false;
  if (a.kind === "gap") return b.kind === "gap" && a.teacherId === b.teacherId;
  return b.kind === "lesson" && a.classId === b.classId;
}

function describeRow(r: MoveEffect["rows"][number]): string {
  return `${ROW_SHORT[r.key]} ${r.from} → ${r.to}${r.total !== undefined ? ` su ${r.total}` : ""}`;
}

function sortRows(list: MoveEffect["rows"]): MoveEffect["rows"] {
  return [...list].sort((a, b) => ROW_ORDER.indexOf(a.key) - ROW_ORDER.indexOf(b.key));
}

/** Gli esiti in breve, per il riquadro in basso. */
const VERDICT_SHORT: Record<MoveEffect["verdict"], string> = {
  better: "meglio",
  mixed: "in parte",
  worse: "peggio",
  breaks: "vietato",
  same: "non cambia niente",
};

/**
 * Cosa cambia con uno spostamento o con le mosse di una proposta: per ogni docente o classe cosa migliora e
 * cosa peggiora, con giorno e ora, e le voci in tutto; se non si sa per chi, le voci migliori e peggiori.
 */
function EffectLines({
  effect,
  who = effect.who,
  nameOf = (w) => w.name,
}: {
  effect: MoveEffect;
  who?: WhoChange[] | null;
  nameOf?: (who: Who) => string;
}) {
  const better = effect.rows.filter((r) => r.better);
  const worse = effect.rows.filter((r) => !r.better);
  return (
    <>
      {effect.hard < 0 && (
        <p className="text-success">
          Sistema {effect.hard === -1 ? "un vincolo non rispettato" : `${-effect.hard} vincoli non rispettati`}.
        </p>
      )}
      {who && who.length > 0 ? (
        <>
          <p className="text-muted-foreground">Per chi cambia:</p>
          <ul className="flex flex-col gap-0.5">
            {who.map((w) => (
              <li key={`${w.who.kind}:${w.who.id}`} className="grid grid-cols-[0.875rem_1fr] items-baseline gap-x-1">
                <VerdictMark verdict={w.worse === 0 ? "better" : w.better === 0 ? "worse" : "mixed"} />
                <span>
                  <span className="font-semibold">{nameOf(w.who)}</span>
                  {w.parts.map((part, i) => (
                    <Fragment key={part.day || "settimana"}>
                      {part.day ? ` · ${part.day}: ` : i === 0 ? ": " : " · "}
                      {part.items.map((it, k) => (
                        <Fragment key={k}>
                          {k > 0 && "; "}
                          <span className={it.better ? "text-success" : "text-destructive"}>{it.text}</span>
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {effect.rows.length > 0 && (
            <p className="text-muted-foreground">In tutto: {sortRows(effect.rows).map(describeRow).join(" · ")}</p>
          )}
        </>
      ) : (
        <>
          {better.length > 0 && <p className="text-success">Meglio: {sortRows(better).map(describeRow).join(" · ")}</p>}
          {worse.length > 0 && <p className="text-destructive">Peggio: {sortRows(worse).map(describeRow).join(" · ")}</p>}
          {effect.rows.length === 0 && effect.hard === 0 && (
            <p className="text-muted-foreground">Nessuna voce del confronto cambia.</p>
          )}
        </>
      )}
      {effect.also.length > 0 && (
        <p className="text-muted-foreground">
          Si spostano anche: {effect.also.join(", ")} (un docente non può stare in due classi).
        </p>
      )}
      {effect.dispMoved.length > 0 && (
        <p className="text-muted-foreground">
          {effect.dispMoved.length === 1 ? "Si sposta l’ora a disposizione: " : "Si spostano le ore a disposizione: "}
          {effect.dispMoved.join(", ")}.
        </p>
      )}
      {effect.dispLost.length > 0 && (
        <p className="text-muted-foreground">Toglie l’ora a disposizione: {effect.dispLost.join(", ")}.</p>
      )}
    </>
  );
}

/** Ritocchi: i dettagli dello spostamento restano aperti (memoria del browser, solo su questo dispositivo). */
const DETAILS_KEY = "gestione-docenti-ritocchi-dettagli";

/** Schermo largo (computer): i dettagli dei ritocchi stanno a destra della tabella, sempre aperti. */
function useWide(): boolean {
  const query = "(min-width: 1280px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function Ritocchi({
  sectionRef,
  edit,
  settings,
  teachersAll,
  baseTeachers,
  classesAll,
  slots,
  cattedre,
  teachers,
  classes,
  morning,
  onChange,
  onClose,
  onApply,
  onSave,
  onUpdateTeacher,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  edit: EditState;
  settings: PersistedData["settings"];
  teachersAll: Teacher[];
  /** docenti con le ore a disposizione da cui si parte (quelle dello slot aperto), se diverse */
  baseTeachers?: Teacher[];
  classesAll: PersistedData["classes"];
  slots: TimetableSlot[];
  cattedre: PersistedData["cattedre"];
  /** docenti di materia */
  teachers: Teacher[];
  classes: { id: string; name: string; tempo: string }[];
  morning: MorningPeriod[];
  onChange: (next: EditState) => void;
  onClose: () => void;
  onApply: () => void;
  onSave: () => void;
  onUpdateTeacher: (id: string, patch: Partial<Teacher>) => void;
}) {
  const days = useMemo(() => [...settings.days].sort((a, b) => a - b), [settings.days]);
  const rows = useMemo(() => [...morning].sort((a, b) => a.index - b.index), [morning]);
  const pool = useMemo(() => new Set(teachers.map((t) => t.id)), [teachers]);
  const inUse = useMemo<PersistedData>(
    () => ({
      settings,
      teachers: teachersAll,
      classes: classesAll,
      slots,
      cattedre,
      absences: [],
      substitutions: [],
      selectedDate: "",
    }),
    [settings, teachersAll, classesAll, slots, cattedre],
  );
  // le altre ore (pomeriggio, sostegno…) restano; cambiano solo le lezioni del mattino dei docenti di materia
  const keep = useMemo(
    () => slots.filter((s) => !(pool.has(s.teacherId) && !isTpPeriodId(settings.periods, s.periodId))),
    [slots, pool, settings.periods],
  );
  // da uno slot: si parte dalle sue ore a disposizione; il confronto resta con l'orario in uso
  const base = useMemo<PersistedData>(
    () => (baseTeachers ? { ...inUse, teachers: baseTeachers } : inUse),
    [inUse, baseTeachers],
  );
  const draftData = useMemo<PersistedData>(
    () => ({ ...base, slots: [...keep, ...edit.draft] }),
    [base, keep, edit.draft],
  );
  const editor = useMemo(() => new TimetableEditor(draftData), [draftData]);
  const current = useMemo(() => evaluateCurrent(inUse), [inUse]);
  const report = useMemo(() => editor.report(current.lessonsExpected), [editor, current]);
  const tById = useMemo(() => new Map(teachersAll.map((t) => [t.id, t])), [teachersAll]);
  // ore a disposizione spostate nello stesso giorno (per chiudere un’ora buca) rispetto alla partenza
  const dispMoved = useMemo(
    () =>
      dispOutcome(base, edit.draft, editor.dispChange()).moved.map((m) => {
        const t = tById.get(m.teacherId);
        const hour = (id: string) => `${settings.periods.find((x) => x.id === id)?.index ?? "?"}ª`;
        return `${t ? teacherShort(t, teachersAll) : m.teacherId} · ${DAY_SHORT[m.day]} ${hour(m.from)} → ${hour(m.to)}`;
      }),
    [base, edit.draft, editor, tById, settings.periods, teachersAll],
  );
  const withLessons = useMemo(() => new Set(edit.draft.map((s) => s.teacherId)), [edit.draft]);
  const cells = useMemo(() => {
    const out: { day: DayOfWeek; periodId: string; label: string }[] = [];
    for (const day of days)
      for (const p of rows) {
        const z = editor.cell(day, p.id);
        if (z >= 0) out[z] = { day, periodId: p.id, label: `${DAY_SHORT[day]} ${p.index}ª` };
      }
    return out;
  }, [editor, days, rows]);

  const [view, setView] = useState<"class" | "teacher">("class");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(teachers.find((t) => withLessons.has(t.id))?.id ?? "");
  const [sel, setSel] = useState<{ classId: string; z: number } | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    dispMoved.length
      ? {
          text: `${dispMoved.length === 1 ? "L’ora a disposizione si sposta" : "Le ore a disposizione si spostano"} nello stesso giorno per chiudere un’ora buca: ${dispMoved.join(", ")}.`,
        }
      : null,
  );
  const [confirmClose, setConfirmClose] = useState(false);
  /** ora buca scelta nella vista per docente */
  const [gapZ, setGapZ] = useState<number | null>(null);
  const [find, setFind] = useState<FindState | null>(null);
  /** «Ferma»: la ricerca finisce e tiene le migliori trovate fin lì */
  const findStop = useRef(false);
  /**
   * Esito di uno spostamento: tutte le righe o solo il riassunto. Aperti una volta, i dettagli restano
   * aperti per le mosse seguenti (e la volta dopo) finché non si preme «meno»; sul computer largo sempre.
   */
  const [details, setDetails] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(DETAILS_KEY, details ? "1" : "0");
    } catch {
      // senza memoria del browser vale solo finché la pagina resta aperta
    }
  }, [details]);
  const wide = useWide();
  const showDetails = details || wide;

  const findJob = find?.job ?? null;
  const findDone = Boolean(find?.result);
  useEffect(() => {
    // la ricerca va avanti a pezzi, così la pagina resta libera; si ferma se l'orario cambia
    if (!findJob || findDone || findJob.forEditor !== editor) return;
    let alive = true;
    let timer = 0;
    let gen: Generator<number, FindResult, boolean | undefined> | null = null;
    const pump = () => {
      if (!alive) return;
      // le mosse si provano su una copia: l'orario mostrato non si tocca
      gen ??= new TimetableEditor(findJob.data).findFixes(findJob.target);
      const end = performance.now() + 24;
      let r = gen.next(findStop.current);
      while (!r.done && performance.now() < end) r = gen.next(findStop.current);
      if (r.done) {
        const result = r.value;
        setFind((f) => (f && f.job === findJob ? { ...f, progress: 1, result } : f));
      } else {
        const progress = r.value;
        setFind((f) => (f && f.job === findJob ? { ...f, progress } : f));
        timer = window.setTimeout(pump, 0);
      }
    };
    timer = window.setTimeout(pump, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [findJob, findDone, editor]);

  const effects = useMemo(() => (sel ? editor.effects(sel.classId, sel.z) : null), [editor, sel]);
  const effect = target !== null && effects ? (effects[target] ?? null) : null;
  const issues = useMemo(
    () => (sel && target !== null && effect?.verdict === "breaks" ? editor.newHardIssues(sel.classId, sel.z, target) : []),
    [editor, sel, target, effect],
  );
  const whoNow = useMemo(
    () =>
      showDetails && sel && target !== null && effect
        ? editor.whoChanges([{ classId: sel.classId, from: sel.z, to: target }])
        : null,
    [editor, sel, target, effect, showDetails],
  );
  const selLesson = sel ? editor.lessonAt(sel.classId, sel.z) : null;
  const selTeacher = selLesson ? tById.get(selLesson.teacherId) : undefined;
  const tgtLesson = sel && target !== null ? editor.lessonAt(sel.classId, target) : null;
  const tgtTeacher = tgtLesson ? tById.get(tgtLesson.teacherId) : undefined;
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? "";
  const short = (t: Teacher | undefined) => (t ? teacherShort(t, teachersAll) : "");
  const teacherLabel = (id: string) => short(tById.get(id)) || id;
  const nameOf = (w: Who) => (w.kind === "teacher" ? short(tById.get(w.id)) || w.name : w.name);
  const canApply = edit.from === "proposta" || edit.history.length > 0 || dispMoved.length > 0;
  const gapCell = view === "teacher" && gapZ !== null ? editor.teacherAt(teacherId, gapZ) : null;
  const gapNow = gapCell && gapCell.kind !== "lesson" && gapCell.gap ? gapZ : null;
  const shownFind = find && find.job.forEditor === editor ? find : null;

  function reset() {
    setSel(null);
    setTarget(null);
    setConfirmClose(false);
    setGapZ(null);
    setFind(null);
  }

  function tap(z: number, lessonClassId: string | null, gap = false) {
    setConfirmClose(false);
    setNotice(null);
    setFind(null);
    if (!sel) {
      if (lessonClassId) {
        setGapZ(null);
        setSel({ classId: lessonClassId, z });
      } else setGapZ(gap && gapNow !== z ? z : null);
      return;
    }
    if (z === sel.z && (lessonClassId === sel.classId || view === "teacher")) {
      reset();
      return;
    }
    if (effects?.[z]) {
      if (target === z) move();
      else setTarget(z);
      return;
    }
    if (lessonClassId) {
      setSel({ classId: lessonClassId, z });
      setTarget(null);
    }
  }

  function move() {
    if (!sel || target === null) return;
    const out = editor.apply(sel.classId, sel.z, target);
    if (!out) return;
    const ids = new Set(out.slots.map((x) => x.id));
    const draft = [...out.slots, ...edit.draft.filter((x) => !ids.has(x.id))];
    onChange({ ...edit, draft, history: [...edit.history, edit.draft] });
    const parts = ["Fatto."];
    if (out.also.length) parts.push(`Si sono spostate anche: ${out.also.join(", ")}.`);
    if (out.dispMoved.length)
      parts.push(
        `${out.dispMoved.length === 1 ? "Si sposta l’ora a disposizione" : "Si spostano le ore a disposizione"}: ${out.dispMoved.join(", ")}.`,
      );
    if (out.dispLost.length) parts.push(`Toglie l’ora a disposizione: ${out.dispLost.join(", ")}.`);
    setNotice({ text: parts.join(" "), changed: changedTeachers(edit.draft, draft, teacherLabel) });
    reset();
  }

  function startFind(t: FindTarget) {
    findStop.current = false;
    setNotice(null);
    setFind({ job: { target: t, forEditor: editor, data: draftData }, progress: 0, result: null });
  }

  /** Fa le mosse di una proposta di «Trova», tutte insieme: un solo «Annulla» le toglie. */
  function applyFix(opt: FixOption) {
    // si rifanno sull'orario di adesso, lo stesso su cui sono state trovate
    const ed = new TimetableEditor(draftData);
    let out: { slots: TimetableSlot[]; also: string[] } | null = null;
    const also = new Set<string>();
    for (const st of opt.steps) {
      out = ed.apply(st.classId, st.from, st.to);
      if (!out) break;
      for (const x of out.also) also.add(x);
    }
    if (!out) {
      setFind(null);
      setNotice({ text: "Queste mosse non si possono più fare: riprova «Trova»." });
      return;
    }
    const ids = new Set(out.slots.map((x) => x.id));
    const draft = [...out.slots, ...edit.draft.filter((x) => !ids.has(x.id))];
    onChange({ ...edit, draft, history: [...edit.history, edit.draft] });
    reset();
    const n = opt.steps.length;
    setNotice({
      text: `Fatto: ${n === 1 ? "1 mossa" : `${n} mosse`}.${also.size ? ` Si sono spostate anche: ${[...also].join(", ")}.` : ""}`,
      changed: changedTeachers(edit.draft, draft, teacherLabel),
    });
  }

  function undo() {
    const prev = edit.history[edit.history.length - 1];
    if (!prev) return;
    onChange({ ...edit, draft: prev, history: edit.history.slice(0, -1) });
    setNotice({ text: "Annullato l’ultimo cambio.", changed: changedTeachers(edit.draft, prev, teacherLabel) });
    reset();
  }

  /** Dal messaggio dopo un cambio: la settimana del docente, nella vista per docente. */
  function showTeacher(id: string) {
    setView("teacher");
    setTeacherId(id);
    reset();
  }

  function toggleLock() {
    if (!sel || !selTeacher) return;
    const c = cells[sel.z];
    if (!c) return;
    const list = selTeacher.lockedSlots ?? [];
    const hit = (a: { day: DayOfWeek; periodId: string; classId: string }) =>
      a.day === c.day && a.periodId === c.periodId && a.classId === sel.classId;
    onUpdateTeacher(selTeacher.id, {
      lockedSlots: list.some(hit) ? list.filter((a) => !hit(a)) : [...list, { day: c.day, periodId: c.periodId, classId: sel.classId }],
    });
    setTarget(null);
  }

  const shownTeacher = tById.get(teacherId);
  const verdictOf = (z: number) => (sel && effects ? effects[z] : undefined);
  const cellClass = (z: number, isSel: boolean, hasLesson: boolean) => {
    const eff = verdictOf(z);
    return cn(
      "relative flex h-14 w-full min-w-0 touch-manipulation flex-col items-start justify-center rounded-md px-1.5 text-left leading-tight transition-colors",
      isSel && "ring-2 ring-primary",
      !isSel && eff && VERDICT_CELL[eff.verdict],
      !isSel && sel && eff === null && "border border-dashed border-ink-faint",
      !isSel && eff && eff.verdict !== "same" && "pr-4",
      !isSel && target === z && "outline outline-2 outline-offset-1 outline-foreground",
      !hasLesson && !eff && "bg-muted",
    );
  };
  const lessonText = (l: { subject: string; teacherId: string }) => `${l.subject} · ${short(tById.get(l.teacherId))}`;
  const stepText = (st: FixStep) => {
    const at = (z: number) => cells[z]?.label ?? "";
    if (st.a && st.b) return `${className(st.classId)}: ${lessonText(st.a)} (${at(st.from)}) ↔ ${lessonText(st.b)} (${at(st.to)})`;
    const l = st.a ?? st.b;
    if (!l) return "";
    const [x, y] = st.a ? [st.from, st.to] : [st.to, st.from];
    return `${className(st.classId)}: ${lessonText(l)} da ${at(x)} a ${at(y)} (ora libera)`;
  };

  /** La ricerca di «Trova» (in corso o finita) per la buca o la lezione scelta, se c'è. */
  const findFor = (t: FindTarget) => (shownFind && sameTarget(shownFind.job.target, t) ? shownFind : null);
  /** Il tasto «Trova» (prova una o due mosse e propone le migliori); sparisce mentre cerca o mostra le proposte. */
  const findButton = (t: FindTarget) =>
    findFor(t) ? null : (
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        title="Prova una o due mosse e propone le migliori"
        onClick={() => startFind(t)}
      >
        <Search className="size-3.5" aria-hidden />
        {t.kind === "gap" ? "Trova come toglierla" : "Trova dove spostarla"}
      </Button>
    );
  /** Blocca / sblocca la lezione scelta (con la settimana bloccata si sblocca la settimana). */
  const lockButton = () => {
    if (!sel || !selLesson || selTeacher?.lockWeek) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={toggleLock}
        aria-pressed={selLesson.locked}
        className={cn("shrink-0", selLesson.locked && "border-primary text-primary")}
      >
        {selLesson.locked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
        {selLesson.locked ? "Bloccata" : "Blocca"}
      </Button>
    );
  };
  /** Avanzamento e proposte di «Trova», al posto della seconda riga del riquadro. */
  const findBlock = (t: FindTarget) => {
    const f = findFor(t);
    if (!f) return null;
    if (!f.result) {
      const pct = Math.round(f.progress * 100);
      return (
        <div className="flex items-center gap-3">
          <div
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Ricerca"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[13px] text-muted-foreground">
            Cerco…<span className="tabular-nums" aria-hidden>{` ${pct}%`}</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              findStop.current = true;
            }}
          >
            Ferma
          </Button>
        </div>
      );
    }
    const { options, partial } = f.result;
    return (
      <div className="flex flex-col gap-2 text-[13px] leading-snug">
        {partial ? (
          <p className="text-muted-foreground">
            Ricerca fermata prima della fine:{" "}
            {options.length ? "ecco le migliori trovate fin lì." : "nessuna proposta trovata fin lì."}
          </p>
        ) : options.length === 0 ? (
          <p className="text-muted-foreground">
            {t.kind === "gap"
              ? "Nessuna combinazione di una o due mosse toglie questa buca senza crearne un’altra o senza violare un vincolo rigido."
              : "Nessuna combinazione di una o due mosse sposta questa lezione senza violare un vincolo rigido."}
          </p>
        ) : null}
        {options.map((opt, i) => (
          <div key={i} className="rounded-lg border border-border bg-background/70 p-2.5">
            <p className="flex items-center gap-1.5 font-medium">
              <VerdictMark verdict={opt.effect.verdict} />
              Proposta {i + 1} · {opt.steps.length === 1 ? "1 mossa" : `${opt.steps.length} mosse`}
              <span className="sr-only">: {VERDICT_WORD[opt.effect.verdict]}</span>
            </p>
            <ol className="mt-1 flex flex-col gap-0.5">
              {opt.steps.map((st, k) => (
                <li key={k}>
                  {opt.steps.length > 1 ? `${k + 1}. ` : ""}
                  {stepText(st)}
                </li>
              ))}
            </ol>
            <div className="mt-1 flex flex-col gap-0.5">
              <EffectLines effect={opt.effect} nameOf={nameOf} />
            </div>
            <Button size="sm" className="mt-2" onClick={() => applyFix(opt)}>
              {opt.steps.length === 1 ? "Fai la mossa" : `Fai le ${opt.steps.length} mosse`}
            </Button>
          </div>
        ))}
      </div>
    );
  };

  return (
    // sul computer largo: tabella a sinistra e riquadro a destra, con i dettagli sempre aperti
    <section
      ref={sectionRef}
      className="mt-1 max-md:pb-16 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-x-4"
    >
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b border-border bg-background px-1 py-2 md:bg-background/95 md:backdrop-blur-sm xl:col-span-2">
        <h2 className="mr-auto font-display text-lg">Ritocchi</h2>
        <span className="hidden text-[13px] text-muted-foreground sm:inline">
          {edit.savedIn && edit.history.length === edit.savedLen
            ? `Salvato nello slot ${edit.savedIn}`
            : edit.history.length === 0
            ? edit.from === "proposta"
              ? "Sulla proposta"
              : dispMoved.length === 1
                ? "1 disposizione spostata, non ancora salvata"
                : dispMoved.length > 1
                  ? `${dispMoved.length} disposizioni spostate, non ancora salvate`
                  : "Nessun cambio"
            : edit.history.length === 1
              ? "1 cambio, non ancora salvato"
              : `${edit.history.length} cambi, non ancora salvati`}
        </span>
        {/* «Salva» resta in alto anche sul telefono; sul computer va prima di «Usa questo orario» */}
        <Button
          variant="outline"
          className="md:order-1"
          onClick={() => {
            setConfirmClose(false);
            onSave();
          }}
          aria-label="Salva nello slot"
        >
          <Save aria-hidden />
          <span className="md:hidden">Salva</span>
          <span className="hidden md:inline">Salva nello slot…</span>
        </Button>
        {/* sul telefono i bottoni stanno in una barra fissa in basso */}
        <div className="fixed inset-x-0 bottom-14 z-30 flex items-center gap-2 border-t border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:contents">
          <Button
            variant="outline"
            size="icon"
            aria-label="Annulla l’ultimo cambio"
            title="Annulla l’ultimo cambio"
            onClick={undo}
            disabled={!edit.history.length}
          >
            <Undo2 className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            className={cn(confirmClose && "border-destructive text-destructive")}
            onClick={() => {
              if (edit.history.length !== (edit.savedLen ?? 0) && !confirmClose) setConfirmClose(true);
              else onClose();
            }}
          >
            {confirmClose ? "Esci senza salvare?" : "Chiudi"}
          </Button>
          <Button
            className="max-md:flex-1 md:order-2"
            onClick={onApply}
            disabled={!canApply}
            aria-label="Usa questo orario"
          >
            <span className="md:hidden">{confirmClose ? "Usa" : "Usa questo orario"}</span>
            <span className="hidden md:inline">Usa questo orario</span>
          </Button>
        </div>
      </div>

      <div className="xl:col-span-2">
        <ReportPanel current={current} proposal={report} mode="edit" />
      </div>

      <div className="paper-panel mt-3 rounded-xl p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">
          Seleziona una lezione e poi l’ora in cui spostarla: il colore indica se l’orario migliora o peggiora. Con
          il lucchetto la lezione resta fissa anche nelle proposte automatiche.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          {LEGEND.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1">
              <span className={cn("inline-flex size-4 items-center justify-center rounded-[3px]", l.swatch)} aria-hidden>
                <VerdictMark verdict={l.verdict} />
              </span>
              {l.label}
            </span>
          ))}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented
            label="Vista"
            value={view}
            onChange={(v) => {
              setView(v);
              setTarget(null);
              setGapZ(null);
              if (find?.job.target.kind === "gap") setFind(null);
              if (sel && v === "teacher" && selLesson) setTeacherId(selLesson.teacherId);
              if (sel && v === "class") setClassId(sel.classId);
            }}
            options={[
              { value: "class", label: "Per classe" },
              { value: "teacher", label: "Per docente" },
            ]}
          />
          {view === "class" ? (
            <NativeSelect
              className="w-auto min-w-28"
              aria-label="Classe"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                reset();
              }}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <NativeSelect
              className="w-auto min-w-40"
              aria-label="Docente"
              value={teacherId}
              onChange={(e) => {
                setTeacherId(e.target.value);
                reset();
              }}
            >
              {teachers
                .filter((t) => withLessons.has(t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {teacherName(t)}
                  </option>
                ))}
            </NativeSelect>
          )}
          {view === "teacher" && shownTeacher && (
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(shownTeacher.lockWeek)}
              onClick={() => {
                onUpdateTeacher(shownTeacher.id, { lockWeek: !shownTeacher.lockWeek });
                setTarget(null);
              }}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors",
                shownTeacher.lockWeek
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {shownTeacher.lockWeek ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
              {shownTeacher.lockWeek ? "Settimana bloccata" : "Blocca la settimana"}
            </button>
          )}
        </div>

        {view === "teacher" && shownTeacher && (
          <p className="mt-3 text-[13px] text-muted-foreground">
            {(() => {
              const g = report.gapsByTeacher.find((x) => x.id === shownTeacher.id);
              return g && g.gaps > 0 ? (
                <>
                  <span className="font-medium text-warning">{g.gaps === 1 ? "1 ora buca" : `${g.gaps} ore buche`}</span>: {g.where}.{" "}
                  {g.gaps === 1 ? "Selezionala" : "Selezionane una"} per cercare come eliminarla.
                </>
              ) : (
                "Nessuna ora buca."
              );
            })()}
          </p>
        )}
        <table className="mt-3 w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th className="w-8 sm:w-10" />
              {days.map((d) => (
                <th key={d} className="pb-1 text-[12px] font-medium text-muted-foreground">
                  {DAY_SHORT[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="pr-1 text-center text-[11px] font-medium text-muted-foreground">{p.index}ª</td>
                {days.map((d) => {
                  const z = editor.cell(d, p.id);
                  if (z < 0) return <td key={d} />;
                  const eff = verdictOf(z);
                  if (view === "class") {
                    const lesson = editor.lessonAt(classId, z);
                    const t = lesson ? tById.get(lesson.teacherId) : undefined;
                    const isSel = Boolean(sel && sel.classId === classId && sel.z === z);
                    const tint = !isSel && eff && eff.verdict !== "same";
                    const tc = teacherCell(t && !tint ? t.color : undefined);
                    return (
                      <td key={d} className="p-0.5">
                        <button
                          type="button"
                          aria-label={`${DAY_SHORT[d]} ${p.index}ª: ${lesson ? `${lesson.subject}, ${short(t)}` : "libera"}${lesson?.locked ? ", bloccata" : ""}${eff ? `. Spostando qui: ${VERDICT_WORD[eff.verdict]}` : ""}`}
                          aria-pressed={isSel}
                          onClick={() => tap(z, lesson ? classId : null)}
                          className={cn(cellClass(z, isSel, Boolean(lesson)), tc.className)}
                          style={tc.style}
                        >
                          {lesson ? (
                            <>
                              <span className="w-full truncate text-[12px] font-medium">
                                <span className="sm:hidden">{subjectAbbr(lesson.subject)}</span>
                                <span className="hidden sm:inline">{lesson.subject}</span>
                              </span>
                              <span
                                className={cn("w-full truncate text-[11px]", tc.text2)}
                              >
                                {short(t)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[12px] text-ink-faint">—</span>
                          )}
                          {lesson?.locked && <Lock className={cn("absolute right-1 top-1 size-3", tc.text2)} aria-hidden />}
                          {!isSel && eff && eff.verdict !== "same" && (
                            <VerdictMark
                              verdict={eff.verdict}
                              className={cn("absolute top-1", lesson?.locked ? "right-5" : "right-1")}
                            />
                          )}
                        </button>
                      </td>
                    );
                  }
                  const cellT = editor.teacherAt(teacherId, z);
                  const isGap = cellT.kind !== "lesson" && Boolean(cellT.gap);
                  const isSel =
                    Boolean(sel && sel.z === z && cellT.kind === "lesson" && cellT.classId === sel.classId) ||
                    (!sel && gapNow === z);
                  const lessonClass = cellT.kind === "lesson" ? cellT.classId : null;
                  const tcT = teacherCell(
                    cellT.kind === "lesson" && shownTeacher && !(eff && eff.verdict !== "same" && !isSel)
                      ? shownTeacher.color
                      : undefined,
                  );
                  return (
                    <td key={d} className="p-0.5">
                      <button
                        type="button"
                        aria-label={`${DAY_SHORT[d]} ${p.index}ª: ${
                          cellT.kind === "lesson"
                            ? `${cellT.className}, ${cellT.subject}${cellT.locked ? ", bloccata" : ""}`
                            : cellT.kind === "disp"
                              ? "a disposizione"
                              : cellT.kind === "away"
                                ? "altrove"
                                : cellT.kind === "travel"
                                  ? "spostamento tra plessi"
                                  : `${cellT.kind === "no" ? "no" : "libera"}${cellT.gap ? ", ora buca" : ""}`
                        }${eff ? `. Spostando qui: ${VERDICT_WORD[eff.verdict]}` : ""}`}
                        aria-pressed={isSel}
                        onClick={() => tap(z, lessonClass, isGap)}
                        className={cn(cellClass(z, isSel, cellT.kind === "lesson"), tcT.className)}
                        style={tcT.style}
                      >
                        {cellT.kind === "lesson" ? (
                          <>
                            <span className="w-full truncate text-[12px] font-medium">{cellT.className}</span>
                            <span
                              className={cn("w-full truncate text-[11px]", tcT.text2)}
                            >
                              <span className="sm:hidden">{subjectAbbr(cellT.subject)}</span>
                              <span className="hidden sm:inline">{cellT.subject}</span>
                            </span>
                          </>
                        ) : cellT.kind === "away" ? (
                          <X className="size-4 text-muted-foreground" aria-hidden />
                        ) : cellT.gap ? (
                          <span className="rounded bg-warning-soft px-1 text-[11px] font-medium text-warning">
                            {cellT.kind === "no" ? "no · buca" : "buca"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-faint">
                            {cellT.kind === "disp" ? "disp." : cellT.kind === "travel" ? "spost." : cellT.kind === "no" ? "no" : "—"}
                          </span>
                        )}
                        {cellT.kind === "lesson" && cellT.locked && (
                          <Lock className={cn("absolute right-1 top-1 size-3", tcT.text2)} aria-hidden />
                        )}
                        {!isSel && eff && eff.verdict !== "same" && (
                          <VerdictMark
                            verdict={eff.verdict}
                            className={cn("absolute top-1", cellT.kind === "lesson" && cellT.locked ? "right-5" : "right-1")}
                          />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Riquadro in basso ad altezza fissa (due righe) in ogni stato: toccando le caselle non cresce e non
        copre la tabella più di prima, e la pagina non si muove. Si allunga solo a richiesta («dettagli» e
        proposte di «Trova»). Sul telefono sta sopra la barra dei tasti e il menu in basso (113 px), con 8 px
        di stacco. Sul computer largo sta a destra della tabella, con i dettagli sempre aperti.
      */}
      <div
        className="sticky bottom-[121px] z-10 mt-3 max-h-[46dvh] overflow-y-auto rounded-xl border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur md:bottom-3 xl:top-16 xl:bottom-auto xl:max-h-[calc(100dvh-5rem)] xl:px-4 xl:py-3"
        aria-live="polite"
      >
        {(!sel || !selLesson) && gapNow !== null ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex h-8 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold text-warning">Ora buca</span> · {short(shownTeacher)} · {cells[gapNow]?.label}
              </p>
              <Button variant="ghost" size="icon-sm" aria-label="Deseleziona" onClick={reset}>
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {findBlock({ kind: "gap", teacherId, z: gapNow }) ?? (
              <div className="flex h-8 items-center gap-2">{findButton({ kind: "gap", teacherId, z: gapNow })}</div>
            )}
          </div>
        ) : !sel || !selLesson ? (
          // l'altezza delle due righe (32 + 6 + 32 px): il messaggio può andare a capo
          <p className="flex min-h-[70px] items-center justify-center text-balance text-center text-sm text-muted-foreground">
            {notice ? (
              <span>
                {notice.text}
                {notice.changed && notice.changed.length > 0 && (
                  <>
                    {" "}
                    Cambia l’orario di{" "}
                    {notice.changed.map((id, i, all) => (
                      <Fragment key={id}>
                        {i > 0 && (i === all.length - 1 ? " e " : ", ")}
                        <button
                          type="button"
                          className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          onClick={() => showTeacher(id)}
                        >
                          {teacherLabel(id)}
                        </button>
                      </Fragment>
                    ))}
                    : seleziona {notice.changed.length === 1 ? "il nome" : "un nome"} per vederne l’orario settimanale.
                  </>
                )}
              </span>
            ) : view === "teacher" ? (
              "Seleziona una lezione da spostare o un’ora buca da eliminare."
            ) : (
              "Seleziona una lezione da spostare."
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex h-8 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold">
                  <span className="sm:hidden">{subjectAbbr(selLesson.subject)}</span>
                  <span className="hidden sm:inline">{selLesson.subject}</span>
                </span>{" "}
                {target !== null && effect ? (
                  <>
                    {cells[sel.z]?.label} → {cells[target]?.label}
                    {tgtLesson ? ` · ${tgtLesson.subject}, ${short(tgtTeacher)}` : " · ora libera"}
                  </>
                ) : (
                  <>
                    · {short(selTeacher)} · {view === "teacher" ? `${className(sel.classId)} · ` : ""}
                    {cells[sel.z]?.label}
                  </>
                )}
              </p>
              <Button variant="ghost" size="icon-sm" aria-label="Deseleziona" onClick={reset}>
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {selLesson.locked ? (
              <div className="flex h-8 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground md:mr-2 md:flex-none">
                  {!selTeacher?.lockWeek
                    ? "Bloccata: per spostarla, sbloccala."
                    : view === "teacher"
                      ? "Settimana bloccata: si sblocca qui sopra."
                      : "Settimana bloccata: si sblocca in «Per docente»."}
                </p>
                {lockButton()}
              </div>
            ) : target !== null && effect ? (
              <>
                <div className="flex h-8 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDetails((d) => !d)}
                    aria-expanded={showDetails}
                    disabled={wide}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] disabled:cursor-default md:mr-2 md:flex-none xl:mr-auto"
                  >
                    <VerdictMark verdict={effect.verdict} />
                    <span className="truncate">{VERDICT_SHORT[effect.verdict]}</span>
                    {!wide && (
                      <span className="shrink-0 text-muted-foreground underline underline-offset-4">
                        {details ? "meno" : "dettagli"}
                      </span>
                    )}
                  </button>
                  <Button
                    size="sm"
                    className="shrink-0"
                    variant={effect.verdict === "breaks" ? "outline" : "default"}
                    onClick={move}
                  >
                    {effect.verdict === "breaks" ? "Sposta lo stesso" : tgtLesson ? "Scambia" : "Sposta"}
                  </Button>
                  <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setTarget(null)}>
                    Annulla
                  </Button>
                </div>
                {showDetails && (
                  <div className="flex flex-col gap-1 text-[13px] leading-snug">
                    {issues.length > 0 && <p className="text-destructive">Non rispetta: {issues.join("; ")}.</p>}
                    <EffectLines effect={effect} who={whoNow} nameOf={nameOf} />
                  </div>
                )}
              </>
            ) : (
              <>
                {findBlock({ kind: "lesson", classId: sel.classId, z: sel.z }) ?? (
                  <div className="flex h-8 items-center gap-2">
                    {findButton({ kind: "lesson", classId: sel.classId, z: sel.z })}
                    {lockButton()}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StepTitle({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground tabular-nums">
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-lg leading-snug">{title}</h2>
        {children && <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}

function HowItWorks() {
  const groups: { title: string; items: string[] }[] = [
    {
      title: "Sempre",
      items: [
        "Rispetta le ore Altrove e No, gli obblighi di classe e i rientri",
        "Rispetta le ore al giorno scelte per un docente",
        "Non sposta le ore bloccate",
        "Lascia un’ora per spostarsi tra due plessi",
        "Al massimo un’ora libera tra le lezioni di un giorno, buca o a disposizione (2 per chi le accetta, nessuna buca per chi non le accetta)",
        "Mai dalla 1ª alla 6ª con 2 ore buche",
      ],
    },
    {
      title: "Se possibile",
      items: [
        "Docenti a 18 ore senza buche e mai dalla 1ª alla 6ª",
        "Italiano e matematica alla 1ª–2ª ora almeno una volta",
        "Materie da 2 ore in due giorni diversi",
        "Scienze motorie nelle ultime ore",
        "Evita giornate troppo pesanti per le classi",
        "Giornate intere in un solo plesso",
      ],
    },
  ];
  return (
    <details open className="group paper-panel rounded-xl p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <h2 className="font-display text-lg">Come lavora</h2>
        <ChevronDown
          className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1.4fr]">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="text-sm font-semibold text-foreground">{g.title}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {g.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">Non cambia</span> sostegno, potenziamento, strumento e
        pomeriggio. Le ore a disposizione restano dove sono; con «Migliora l’attuale» si spostano nello stesso giorno
        solo per chiudere un’ora buca.
      </p>
    </details>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-60",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BrushSwatch({ brush }: { brush: Brush }) {
  const base = "inline-flex size-7 shrink-0 items-center justify-center rounded-md";
  if (brush === "erase") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <Eraser className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className={cn(base, CELL_STYLE[brush])}>
      <MarkGlyph state={brush} label="1A" />
    </span>
  );
}

function AvailabilityPanel({
  teachers,
  elsewhere,
  skipped,
  days,
  morning,
  classes,
  hoursHere,
  lockCount,
  onUpdate,
  onClassPick,
  onPattern,
}: {
  teachers: Teacher[];
  /** docenti che insegnano anche in altre sedi dell'app: le loro ore là e i nomi delle sedi */
  elsewhere: Map<string, { cells: ElsewhereCell[]; sedi: string[] }>;
  skipped: Teacher[];
  days: DayOfWeek[];
  morning: MorningPeriod[];
  classes: PersistedData["classes"];
  hoursHere: Map<string, number>;
  lockCount: Map<string, number>;
  onUpdate: (id: string, patch: Partial<Teacher>) => void;
  onClassPick: (t: Teacher, day: DayOfWeek, periodId: string) => void;
  onPattern: (t: Teacher) => void;
}) {
  const [brush, setBrush] = useState<Brush>("away");
  const [query, setQuery] = useState("");
  // Sul telefono le schede partono chiuse, sul computer aperte; lo stato non si salva.
  // «flipped»: le schede aperte o chiuse a mano, al contrario di come partono.
  const [startOpen, setStartOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const current = BRUSHES.find((b) => b.value === brush) ?? BRUSHES[0]!;
  const q = query.trim().toLowerCase();
  const shown = q
    ? teachers.filter((t) => `${teacherName(t)} ${t.subjects.join(" ")}`.toLowerCase().includes(q))
    : teachers;
  const isOpen = (id: string) => startOpen !== flipped.has(id);

  /** «Apri tutte» / «Chiudi tutte»: le schede mostrate (con la ricerca, solo quelle trovate). */
  function setAllOpen(open: boolean) {
    if (!q) {
      setStartOpen(open);
      setFlipped(new Set());
      return;
    }
    setFlipped((prev) => {
      const next = new Set(prev);
      for (const t of shown) {
        if (open === startOpen) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }

  function paintCell(t: Teacher, day: DayOfWeek, periodId: string) {
    const there = elsewhere.get(t.id)?.cells.find((c) => sameCell(c, day, periodId));
    if (there) {
      toast.message(`A quell’ora è a ${there.sedeName} (${there.label}): si cambia dall’orario di quella sede.`);
      return;
    }
    if (brush === "class") {
      onClassPick(t, day, periodId);
      return;
    }
    const cur = cellState(t, day, periodId);
    onUpdate(t.id, withCells(t, [{ day, periodId }], brush === "erase" || cur === brush ? "empty" : brush));
  }

  /** Una colonna o una riga intera: × copre tutto, «no» lascia stare × e classi. */
  function paintLine(t: Teacher, cells: Cell[]) {
    if (brush === "class") {
      toast.message("La classe si segna una casella alla volta.");
      return;
    }
    const target =
      brush === "erase" || brush === "away"
        ? cells
        : cells.filter((c) => {
            const s = cellState(t, c.day, c.periodId);
            return s !== "away" && s !== "class";
          });
    if (!target.length) return;
    const allSet = brush !== "erase" && target.every((c) => cellState(t, c.day, c.periodId) === brush);
    onUpdate(t.id, withCells(t, target, brush === "erase" || allSet ? "empty" : brush));
  }

  return (
    <section className="paper-panel rounded-xl p-5">
      <StepTitle n={1} title="Quando ci sono i docenti">
        Seleziona un segno, poi le caselle. Selezionando un giorno o un’ora segni l’intera colonna o riga.
      </StepTitle>

      <div className="sticky top-0 z-20 -mx-5 mt-4 border-y border-border bg-card/95 px-5 py-2 backdrop-blur-sm">
        <div role="radiogroup" aria-label="Segno da mettere" className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap">
          {BRUSHES.map((b) => (
            <button
              key={b.value}
              type="button"
              role="radio"
              aria-checked={brush === b.value}
              aria-label={`${b.label}: ${b.hint}`}
              onClick={() => setBrush(b.value)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition-colors sm:flex-row sm:gap-2 sm:pl-1.5 sm:pr-3 sm:text-left",
                brush === b.value ? "border-primary bg-accent ring-1 ring-primary" : "border-transparent hover:bg-muted",
              )}
            >
              <BrushSwatch brush={b.value} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[12px] font-medium text-foreground sm:text-[13px]">{b.label}</span>
                <span className="hidden text-[11px] text-muted-foreground sm:block">{b.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-center text-[12px] text-muted-foreground sm:hidden">
          {current.label}: {current.hint}
        </p>
      </div>

      {teachers.length > 6 && (
        <label className="relative mt-4 block max-w-xs">
          <span className="sr-only">Cerca docente</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca docente o materia"
            className="pl-9"
          />
        </label>
      )}

      {shown.length > 0 && (
        <div className="mt-4 flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAllOpen(true)}>
            Apri tutte
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAllOpen(false)}>
            Chiudi tutte
          </Button>
        </div>
      )}

      {/* sul computer le schede si distribuiscono da sole: 2 per riga a 1024 px, 3 a 1440, 4 sugli schermi molto larghi */}
      <ul className="mt-2 grid gap-3 md:grid-cols-[repeat(auto-fill,minmax(min(100%,20.5rem),1fr))]">
        {shown.map((t) => (
          <TeacherCard
            key={t.id}
            open={isOpen(t.id)}
            onToggle={() =>
              setFlipped((prev) => {
                const next = new Set(prev);
                if (next.has(t.id)) next.delete(t.id);
                else next.add(t.id);
                return next;
              })
            }
            t={t}
            elsewhere={elsewhere.get(t.id)}
            days={days}
            morning={morning}
            classes={classes}
            hours={hoursHere.get(t.id) ?? 0}
            locked={lockCount.get(t.id) ?? 0}
            onUpdate={onUpdate}
            onCell={(day, periodId) => paintCell(t, day, periodId)}
            onLine={(cells) => paintLine(t, cells)}
            onPattern={() => onPattern(t)}
          />
        ))}
      </ul>
      {shown.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nessun docente trovato.</p>}
      {skipped.length > 0 && (
        <p className="mt-4 text-[12px] text-muted-foreground">
          Non entrano nell’orario: {skipped.map((t) => teacherName(t)).join(", ")}.
        </p>
      )}
    </section>
  );
}

function TeacherCard({
  open,
  onToggle,
  t,
  elsewhere,
  days,
  morning,
  classes,
  hours,
  locked,
  onUpdate,
  onCell,
  onLine,
  onPattern,
}: {
  /** Solo sotto i 768 px: scheda aperta o chiusa. */
  open: boolean;
  onToggle: () => void;
  t: Teacher;
  elsewhere?: { cells: ElsewhereCell[]; sedi: string[] };
  days: DayOfWeek[];
  morning: MorningPeriod[];
  classes: PersistedData["classes"];
  hours: number;
  locked: number;
  onUpdate: (id: string, patch: Partial<Teacher>) => void;
  onCell: (day: DayOfWeek, periodId: string) => void;
  onLine: (cells: Cell[]) => void;
  onPattern: () => void;
}) {
  const rientro = t.rientroDays ?? [];
  const pats = teacherDayPatterns(t);
  const stale = pats.some((x) => x.reduce((a, b) => a + b, 0) !== hours);
  const patText = pats.length === 0 ? "" : `${patternLabel(pats[0]!)}${pats.length > 1 ? ` +${pats.length - 1}` : ""}`;
  const subtitle = `${t.subjects.slice(0, 3).join(", ")} · ${t.weeklyHours} h${(t.dispHours ?? 0) > 0 ? ` · ${t.dispHours} disp.` : ""}`;
  // Riassunto dei segni per la scheda chiusa: quanti e di che tipo.
  const marks = { away: 0, no: 0, hard: 0, soft: 0 };
  for (const d of days) {
    for (const p of morning) {
      const st = cellState(t, d, p.id);
      if (st === "away") marks.away++;
      else if (st === "no") marks.no++;
      else if (st === "class") {
        const must = (t.mustSlots ?? []).find((a) => sameCell(a, d, p.id));
        if (must?.level === "obbligo") marks.hard++;
        else marks.soft++;
      }
    }
  }
  const markCount = marks.away + marks.no + marks.hard + marks.soft;
  return (
    <li className={cn("rounded-lg border border-border bg-card px-3 py-3", !open && "self-start")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex w-full min-w-0 items-start gap-1.5 text-left"
          >
            <ChevronDown
              className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium">{teacherName(t)}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{subtitle}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                {markCount === 0 ? "nessun segno" : `${markCount} ${markCount === 1 ? "segno" : "segni"}`}
                {marks.away > 0 && <span className="size-2.5 rounded-[3px] bg-primary" aria-hidden />}
                {marks.no > 0 && <span className="size-2.5 rounded-[3px] bg-destructive" aria-hidden />}
                {marks.hard > 0 && <span className="size-2.5 rounded-[3px] bg-class-mark" aria-hidden />}
                {marks.soft > 0 && (
                  <span
                    className="size-2.5 rounded-[3px] bg-class-mark/20 ring-1 ring-inset ring-class-mark/65"
                    aria-hidden
                  />
                )}
              </span>
            </span>
          </button>
        </div>
        {elsewhere ? (
          <span
            className="shrink-0 rounded-full border border-primary bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground"
            title={`Insegna anche a ${elsewhere.sedi.join(", ")}`}
          >
            Su più sedi
          </span>
        ) : (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(t.otherPlesso)}
          onClick={() => onUpdate(t.id, { otherPlesso: !t.otherPlesso })}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
            t.otherPlesso
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {t.otherPlesso ? "Su più plessi" : "Solo qui"}
        </button>
        )}
      </div>

      <div className={cn(!open && "hidden")}>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[12px] text-muted-foreground">Rientro T.P.</span>
          {days.map((d) => {
            const on = rientro.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={on ? `Togli rientro ${DAY_SHORT[d]}` : `Rientro ${DAY_SHORT[d]}: 4ª–6ª`}
                onClick={() => onUpdate(t.id, { rientroDays: on ? rientro.filter((x) => x !== d) : [...rientro, d] })}
                className={cn(
                  "h-7 min-w-9 rounded-full border px-2 text-[11px] font-medium transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {DAY_SHORT[d]}
              </button>
            );
          })}
        </div>

        {hours > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[12px] text-muted-foreground">Ore al giorno</span>
            <button
              type="button"
              onClick={onPattern}
              aria-label={`${
                pats.length
                  ? `Ore al giorno: ${pats.map(patternLabel).join(" o ")}${stale ? ", da rivedere" : ""}`
                  : "Ore al giorno: decide l’app"
              }${t.noGaps ? "; non accetta ore libere" : t.allowTwoFree ? "; accetta 2 ore libere in mezzo" : ""}. ${pats.length ? "Cambia" : "Scegli"}`}
              className={cn(
                "h-7 rounded-full border px-2.5 text-[11px] font-medium tabular-nums transition-colors",
                !pats.length && "border-border text-muted-foreground hover:bg-muted",
                pats.length > 0 && !stale && "border-primary bg-primary text-primary-foreground",
                pats.length > 0 && stale && "border-warning bg-warning-soft text-warning",
              )}
            >
              {pats.length ? patText : "Libere"}
            </button>
            {stale && <span className="text-[11px] text-warning">da rivedere: ora le ore sono {hours}</span>}
            {t.noGaps ? (
              <span className="text-[11px] text-muted-foreground">· non accetta ore libere</span>
            ) : (
              t.allowTwoFree && <span className="text-[11px] text-muted-foreground">· accetta 2 ore libere in mezzo</span>
            )}
          </div>
        )}

        {(t.lockWeek || locked > 0) && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            {t.lockWeek ? "Settimana bloccata" : locked === 1 ? "1 ora bloccata" : `${locked} ore bloccate`}
            <span className="text-ink-faint">· si cambia in «Ritocca a mano»</span>
          </p>
        )}

        <table className="mt-2 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="w-9" />
              {days.map((d) => {
                const away = morning.filter((p) => cellState(t, d, p.id) === "away").length;
                return (
                  <th key={d} className="p-0.5 font-medium">
                    <button
                      type="button"
                      aria-label={`${DAY_SHORT[d]}: tutto il giorno`}
                      onClick={() => onLine(morning.map((p) => ({ day: d, periodId: p.id })))}
                      className={cn(
                        "mx-auto flex h-8 w-full min-w-9 items-center justify-center rounded-md text-[11px] font-medium transition-colors",
                        away === morning.length && away > 0
                          ? "bg-primary/20 text-foreground"
                          : "text-muted-foreground hover:bg-muted",
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
            {morning.map((p) => (
              <tr key={p.id}>
                <td className="p-0.5">
                  <button
                    type="button"
                    aria-label={`${p.label}: tutti i giorni`}
                    onClick={() => onLine(days.map((d) => ({ day: d, periodId: p.id })))}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {p.index}ª
                  </button>
                </td>
                {days.map((d) => {
                  const there = elsewhere?.cells.find((c) => sameCell(c, d, p.id));
                  if (there) {
                    return (
                      <td key={d} className="p-0.5 text-center">
                        <button
                          type="button"
                          aria-label={`${DAY_SHORT[d]} ${p.label}: a ${there.sedeName}, ${there.label}`}
                          title={`${DAY_SHORT[d]} ${p.label}: a ${there.sedeName} (${there.label}${there.subject ? ` · ${there.subject}` : ""})`}
                          onClick={() => onCell(d, p.id)}
                          className="inline-flex h-9 w-full min-w-9 touch-manipulation items-center justify-center rounded-md bg-primary/45 text-primary-foreground"
                        >
                          <X className="size-4" strokeWidth={2.5} aria-hidden />
                        </button>
                      </td>
                    );
                  }
                  const state = cellState(t, d, p.id);
                  const must = state === "class" ? (t.mustSlots ?? []).find((a) => sameCell(a, d, p.id)) : undefined;
                  const ids = must ? (must.classIds?.length ? must.classIds : must.classId ? [must.classId] : []) : [];
                  const tags = ids
                    .map((id) => classes.find((c) => c.id === id))
                    .filter((c): c is NonNullable<typeof c> => Boolean(c))
                    .map((c) => `${c.grade}${c.section}`);
                  const classLabel = must?.allClasses
                    ? "tutte"
                    : tags.length <= 1
                      ? (tags[0] ?? "")
                      : tags.length === 2
                        ? `${tags[0]}·${tags[1]}`
                        : `${tags[0]} +${tags.length - 1}`;
                  const what =
                    state === "away"
                      ? "altrove"
                      : state === "no"
                        ? "no"
                        : state === "class"
                          ? `classe ${must?.level === "obbligo" ? "obbligatoria" : "se possibile"}: ${must?.allClasses ? "tutte le sue classi" : tags.join(", ")}`
                          : "libera";
                  return (
                    <td key={d} className="p-0.5 text-center">
                      <button
                        type="button"
                        aria-label={`${DAY_SHORT[d]} ${p.label}: ${what}`}
                        title={state === "class" ? `${DAY_SHORT[d]} ${p.label}: ${what}` : undefined}
                        onClick={() => onCell(d, p.id)}
                        className={cn(
                          "inline-flex h-9 w-full min-w-9 touch-manipulation items-center justify-center rounded-md transition-colors",
                          state === "class" && must?.level === "obbligo" ? HARD_CLASS_STYLE : CELL_STYLE[state],
                        )}
                      >
                        <MarkGlyph state={state} label={classLabel} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {elsewhere && elsewhere.cells.length > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block size-3 rounded-[3px] bg-primary/45" aria-hidden />
            Ore a {elsewhere.sedi.join(", ")}: le mette l’app dall’orario di quella sede
          </p>
        )}
      </div>
    </li>
  );
}

/** 4-4-4-3-3 (i giorni liberi non si scrivono). */
function patternLabel(pattern: number[]): string {
  return [...pattern]
    .filter((x) => x > 0)
    .sort((a, b) => b - a)
    .join("-");
}

function samePattern(a: number[] | undefined, b: number[]): boolean {
  return Boolean(a) && patternLabel(a!) === patternLabel(b);
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function DayPatternDialog({
  teacher,
  data,
  onClose,
  onChange,
  onTwoFree,
  onNoGaps,
}: {
  teacher: Teacher | null;
  data: PersistedData;
  onClose: () => void;
  onChange: (t: Teacher, list: number[][]) => void;
  /** «Accetta 2 ore libere in mezzo»: l'eccezione chiesta dal docente */
  onTwoFree: (t: Teacher, on: boolean) => void;
  /** «Accetta ore libere» spento: nessuna ora buca per il docente */
  onNoGaps: (t: Teacher, noGaps: boolean) => void;
}) {
  const info = useMemo(() => (teacher ? teacherDayInfo(data, teacher.id) : null), [teacher, data]);
  const options = useMemo(() => (info ? dayPatternOptions(info.hours, info.cap) : []), [info]);
  const groups = useMemo(() => {
    const byDays = new Map<number, number[][]>();
    for (const o of options) {
      const n = o.filter((x) => x > 0).length;
      byDays.set(n, [...(byDays.get(n) ?? []), o]);
    }
    return [...byDays.entries()].sort((a, b) => b[0] - a[0]);
  }, [options]);
  const days = [...data.settings.days].sort((a, b) => a - b);
  const current = teacher ? teacherDayPatterns(teacher) : [];
  const stale = info ? current.filter((x) => x.reduce((a, b) => a + b, 0) !== info.hours) : [];
  const nowLabel = info?.now ? patternLabel(info.now) : null;
  const chip = (selected: boolean) =>
    cn(
      "min-h-10 rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors",
      selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
    );
  const toggle = (o: number[]) => {
    if (!teacher) return;
    const on = current.some((x) => samePattern(x, o));
    onChange(teacher, on ? current.filter((x) => !samePattern(x, o)) : [...current, o]);
  };
  return (
    <Dialog open={Boolean(teacher)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ore al giorno</DialogTitle>
          <DialogDescription>
            {teacher && info
              ? `${teacherName(teacher)}: ${info.hours} ore qui${
                  info.disp > 0 ? ` (${info.lessons} di lezione e ${info.disp} a disposizione)` : ""
                }.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {info?.now && (
            <p className="text-sm text-muted-foreground">
              Ora:{" "}
              <span className="tabular-nums text-foreground">
                {days.map((d, i) => `${DAY_SHORT[d]} ${info.now![i] ?? 0}`).join(" · ")}
              </span>
            </p>
          )}
          <button
            type="button"
            aria-pressed={current.length === 0}
            className={cn(chip(current.length === 0), "w-full text-left")}
            onClick={() => teacher && onChange(teacher, [])}
          >
            Libere{" "}
            <span className={cn("font-normal", current.length ? "text-muted-foreground" : "opacity-80")}>
              · decide l’app
            </span>
          </button>
          {stale.length > 0 && (
            <div>
              <p className="text-[13px] font-semibold text-warning">Da rivedere: ora le ore sono {info?.hours}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {stale.map((o) => (
                  <button
                    key={patternLabel(o)}
                    type="button"
                    aria-label={`Togli ${patternLabel(o)}`}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-warning bg-warning-soft px-3 text-sm font-medium tabular-nums text-warning"
                    onClick={() => toggle(o)}
                  >
                    {patternLabel(o)}
                    <X className="size-3.5" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.map(([n, list]) => (
            <div key={n}>
              <p className="text-[13px] font-semibold text-foreground">{n === 1 ? "1 giorno" : `${n} giorni`}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {list.map((o) => {
                  const label = patternLabel(o);
                  const selected = current.some((x) => samePattern(x, o));
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${label}${label === nowLabel ? ", come ora" : ""}`}
                      className={chip(selected)}
                      onClick={() => toggle(o)}
                    >
                      {label}
                      {label === nowLabel && (
                        <span className={cn("ml-1.5 text-[11px] font-normal", selected ? "opacity-80" : "text-muted-foreground")}>
                          ora
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {info && options.length === 0 && (
            <p className="text-sm text-muted-foreground">Con le ore segnate (× e «no») non c’è una suddivisione possibile.</p>
          )}
          <p className="text-[13px] text-muted-foreground">
            Puoi sceglierne più di una: ne basta una. I giorni li sceglie l’app.
            {info && info.disp > 0 ? " Le ore a disposizione contano: con «Da zero» le aggiungi tu dopo." : ""}
          </p>
          <div className="border-t border-border pt-4">
            <p className="text-[13px] font-semibold text-foreground">Ore libere tra le lezioni</p>
            <button
              type="button"
              role="switch"
              aria-checked={!teacher?.noGaps}
              className={cn(chip(!teacher?.noGaps), "mt-1.5 w-full text-left")}
              onClick={() => teacher && onNoGaps(teacher, !teacher.noGaps)}
            >
              Accetta ore libere
            </button>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Acceso, il docente può avere un’ora libera tra le lezioni di un giorno (buca o a disposizione). Spento,
              l’app non gli lascia mai ore buche.
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(teacher?.allowTwoFree) && !teacher?.noGaps}
              disabled={Boolean(teacher?.noGaps)}
              className={cn(
                chip(Boolean(teacher?.allowTwoFree) && !teacher?.noGaps),
                "mt-3 w-full text-left disabled:cursor-not-allowed disabled:opacity-50",
              )}
              onClick={() => teacher && onTwoFree(teacher, !teacher.allowTwoFree)}
            >
              Accetta 2 ore libere in mezzo
            </button>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Di norma, tra la prima e l’ultima lezione di un giorno, è ammessa al massimo un’ora libera (buca o a
              disposizione). Attivalo solo se il docente chiede di averne 2.
              {teacher?.noGaps ? " Non vale finché «Accetta ore libere» è spento." : ""}
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Fatto
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClassPickDialog({
  pick,
  data,
  morning,
  onChange,
  onSave,
}: {
  pick: ClassPick | null;
  data: PersistedData;
  morning: MorningPeriod[];
  onChange: (next: ClassPick | null) => void;
  /** all: scelte tutte le sue classi («Tutte»): vale anche per quelle assegnate dopo */
  onSave: (pick: ClassPick, remove: boolean, all: boolean) => void;
}) {
  const t = pick ? data.teachers.find((x) => x.id === pick.teacherId) : undefined;
  const hour = pick ? (morning.find((p) => p.id === pick.periodId)?.label ?? pick.periodId) : "";
  const options = pick
    ? [
        ...new Map(
          cattedreOfTeacher(data, pick.teacherId)
            .map((c) => data.classes.find((cl) => cl.id === c.classId))
            .filter((c): c is NonNullable<typeof c> => Boolean(c))
            .map((c) => [c.id, c]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name, "it"))
    : [];
  const allOn = options.length > 1 && options.every((c) => pick?.selected.includes(c.id));
  const chip = (on: boolean) =>
    cn(
      "inline-flex min-h-10 min-w-14 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
      on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
    );
  return (
    <Dialog open={Boolean(pick)} onOpenChange={(open) => !open && onChange(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pick ? `${DAY_SHORT[pick.day]} ${hour}` : ""}
          </DialogTitle>
          <DialogDescription>{t ? `${teacherName(t)}: quale classe a quest’ora? Ne basta una.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 1 && (
            <>
              <button
                type="button"
                aria-pressed={allOn}
                onClick={() => pick && onChange({ ...pick, selected: allOn ? [] : options.map((c) => c.id) })}
                className={chip(allOn)}
              >
                {allOn && <Check className="size-4" aria-hidden />}
                Tutte
              </button>
              <span className="h-7 w-px bg-border" aria-hidden />
            </>
          )}
          {options.map((cls) => {
            const on = Boolean(pick?.selected.includes(cls.id));
            return (
              <button
                key={cls.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  pick &&
                  onChange({
                    ...pick,
                    selected: on ? pick.selected.filter((id) => id !== cls.id) : [...pick.selected, cls.id],
                  })
                }
                className={chip(on)}
              >
                {cls.name}
              </button>
            );
          })}
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground">Nessuna classe: assegna prima le cattedre.</p>
          )}
        </div>
        {allOn && (
          <p className="text-[13px] text-muted-foreground">
            Va bene una qualsiasi delle sue classi, anche quelle che gli assegnerai dopo.
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Segmented
            label="Quanto conta"
            value={pick?.level ?? "preferenza"}
            onChange={(level) => pick && onChange({ ...pick, level })}
            options={[
              { value: "preferenza", label: "Se possibile" },
              { value: "obbligo", label: "Obbligatorio" },
            ]}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-4">
          {pick?.existing ? (
            <Button variant="ghost" type="button" onClick={() => pick && onSave(pick, true, false)}>
              Togli
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            disabled={!pick || pick.selected.length === 0}
            onClick={() => pick && pick.selected.length > 0 && onSave(pick, false, allOn)}
          >
            Salva
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeacherWeekPreview({
  data,
  report,
  added,
  disp,
  teachers,
  days,
  periods,
}: {
  data: PersistedData;
  /** per le ore buche (le stesse del confronto) */
  report: TimetableReport;
  /** ore a disposizione messe o spostate dall’app («+ disp.») */
  added: DispMove[];
  /** disposizioni dopo la proposta (dove cambiano) */
  disp: Record<string, { day: DayOfWeek; periodId: string }[]>;
  teachers: Teacher[];
  days: DayOfWeek[];
  periods: { id: string; index: number }[];
}) {
  const gapsOf = new Map(report.gapsByTeacher.map((g) => [g.id, g]));
  const has = (list: { day: DayOfWeek; periodId: string }[] | undefined, day: DayOfWeek, periodId: string) =>
    (list ?? []).some((a) => a.day === day && a.periodId === periodId);
  const isAdded = (teacherId: string, day: DayOfWeek, periodId: string) =>
    added.some((m) => m.teacherId === teacherId && m.to.day === day && m.to.periodId === periodId);
  return (
    <div className="paper-panel mt-3 overflow-x-auto rounded-xl">
      <p className="px-3 pt-3 text-[12px] text-muted-foreground">
        <span className="rounded bg-warning-soft px-1 font-medium text-warning">buca</span> ora vuota tra due lezioni ·{" "}
        <span className="text-ink-faint">disp.</span> a disposizione (non è una buca)
        {added.length > 0 && (
          <>
            {" "}
            · <span className="rounded bg-success-soft px-1 font-medium text-success">+ disp.</span> ora a disposizione
            spostata qui dall’app
          </>
        )}
      </p>
      <table className="w-full min-w-[720px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="sticky left-0 z-10 w-28 bg-card px-3 py-2 font-medium">Docente</th>
            {days.map((d) => (
              <th key={d} className="px-2 py-2 font-medium text-foreground">
                {DAY_SHORT[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teachers.map((t) => {
            const g = gapsOf.get(t.id);
            const tDisp = disp[t.id] ?? t.dispSlots;
            return (
              <tr key={t.id} className="border-b border-border align-top last:border-0">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  <div className="text-[13px] font-medium">{teacherName(t)}</div>
                  <div className="text-[10px] tracking-wide text-ink-faint">
                    {t.weeklyHours} h
                    {g && g.gaps > 0 && (
                      <span className="font-medium text-warning"> · {g.gaps === 1 ? "1 buca" : `${g.gaps} buche`}</span>
                    )}
                  </div>
                </td>
                {days.map((d) => (
                  <td key={d} className="px-2 py-2 text-[11px] font-normal leading-[1.35]">
                    {periods.map((p) => {
                      const slot = data.slots.find((s) => s.teacherId === t.id && s.day === d && s.periodId === p.id);
                      const cls = slot ? data.classes.find((c) => c.id === slot.classId) : null;
                      if (slot)
                        return (
                          <div key={p.id} className="text-foreground">
                            {p.index} {cls?.name ?? ""} <span className="font-semibold">{slot.subject}</span>
                          </div>
                        );
                      if (isAdded(t.id, d, p.id))
                        return (
                          <div key={p.id}>
                            {p.index} <span className="rounded bg-success-soft px-1 font-medium text-success">+ disp.</span>
                          </div>
                        );
                      if (has(g?.cells, d, p.id))
                        return (
                          <div key={p.id}>
                            {p.index} <span className="rounded bg-warning-soft px-1 font-medium text-warning">buca</span>
                          </div>
                        );
                      return (
                        <div key={p.id} className="text-ink-faint">
                          {p.index}{" "}
                          {has(tDisp, d, p.id) ? "disp." : has(t.awaySlots, d, p.id) ? "altrove" : " —"}
                        </div>
                      );
                    })}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CellBody({
  occupants,
  teachers,
  text2 = "text-muted-foreground",
}: {
  occupants: TimetableSlot[];
  teachers: Teacher[];
  /** Colore del testo secondario: nelle celle col colore del docente lo dà teacherCell. */
  text2?: string;
}) {
  if (occupants.length === 0) {
    return <span className="text-[12px] text-ink-faint">—</span>;
  }
  return (
    <>
      {occupants.map((s, i) => {
        const doc = teachers.find((x) => x.id === s.teacherId);
        return (
          <span key={s.id} className={cn("flex flex-col leading-tight", i > 0 && "mt-1")}>
            <span className="text-[13px] font-medium">{s.subject}</span>
            <span className={cn("text-[12px]", text2)}>
              {doc ? teacherShort(doc, teachers) : ""}
              {i > 0 ? " · compr." : ""}
            </span>
          </span>
        );
      })}
    </>
  );
}

function ClassPreview({
  slots,
  classId,
  days,
  periods,
  teachers,
}: {
  slots: TimetableSlot[];
  classId: string;
  days: DayOfWeek[];
  periods: { id: string; label: string; start: string; end: string }[];
  teachers: Teacher[];
}) {
  return (
    <div className="paper-panel mt-3 overflow-x-auto rounded-xl">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th className="w-24 px-3 py-2 font-medium">Ora</th>
            {days.map((d) => (
              <th key={d} className="px-2 py-2 font-medium text-foreground">
                {DAY_SHORT[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 align-top">
                <div className="text-[13px] font-medium">{p.label}</div>
                <div className="text-[11px] text-ink-faint">
                  {p.start}–{p.end}
                </div>
              </td>
              {days.map((d) => {
                const occupants = slots.filter((s) => s.classId === classId && s.day === d && s.periodId === p.id);
                const t = occupants[0] ? teachers.find((x) => x.id === occupants[0]!.teacherId) : null;
                return (
                  <td key={d} className="p-1.5 align-top">
                    <div
                      className={cn("flex min-h-16 w-full flex-col rounded-md px-2 py-1.5", teacherCell(t?.color).className)}
                      style={teacherCell(t?.color).style}
                    >
                      <CellBody occupants={occupants} teachers={teachers} text2={teacherCell(t?.color).text2} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayPreview({
  slots,
  day,
  classes,
  periods,
  teachers,
}: {
  slots: TimetableSlot[];
  day: DayOfWeek;
  classes: { id: string; name: string; tempo: string }[];
  periods: { id: string; label: string; start: string; end: string }[];
  teachers: Teacher[];
}) {
  return (
    <div className="paper-panel mt-3 overflow-x-auto rounded-xl">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th className="sticky left-0 z-10 w-24 bg-card px-3 py-2 font-medium">Ora</th>
            {classes.map((c) => (
              <th key={c.id} className="px-2 py-2 font-medium">
                <div className="text-foreground">{c.name}</div>
                <div className="text-[10px] font-medium tracking-wide text-ink-faint">{c.tempo}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top">
                <div className="text-[13px] font-medium">{p.label}</div>
                <div className="text-[11px] text-ink-faint">
                  {p.start}–{p.end}
                </div>
              </td>
              {classes.map((c) => {
                const occupants = slots.filter((s) => s.classId === c.id && s.day === day && s.periodId === p.id);
                const t = occupants[0] ? teachers.find((x) => x.id === occupants[0]!.teacherId) : null;
                return (
                  <td key={c.id} className="p-1 align-top">
                    <div
                      className={cn("flex min-h-[4.25rem] w-full flex-col rounded-md px-2 py-1.5", teacherCell(t?.color).className)}
                      style={teacherCell(t?.color).style}
                    >
                      <CellBody occupants={occupants} teachers={teachers} text2={teacherCell(t?.color).text2} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CattedrePanel({
  classId,
  onClassId,
  classes,
  teachers,
  cattedre,
  unassigned,
  newSubject,
  newHours,
  onNewSubject,
  onNewHours,
  onWrite,
}: {
  classId: string;
  onClassId: (id: string) => void;
  classes: { id: string; name: string; tempo: string }[];
  teachers: Teacher[];
  cattedre: Cattedra[];
  unassigned: { classId: string; className: string; subject: string }[];
  newSubject: string;
  newHours: string;
  onNewSubject: (v: string) => void;
  onNewHours: (v: string) => void;
  onWrite: (next: Cattedra[]) => void;
}) {
  const rows = cattedre.filter((c) => c.classId === classId);
  const totale = rows.reduce((n, r) => n + r.hours, 0);
  const missing = unassigned.filter((u) => u.classId === classId);
  const allHours = cattedre.reduce((n, r) => n + r.hours, 0);

  function patch(subject: string, change: Partial<Cattedra>) {
    onWrite(cattedre.map((r) => (r.classId === classId && r.subject === subject ? { ...r, ...change } : r)));
  }

  return (
    <details className="group paper-panel rounded-xl p-5">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <StepTitle n={2} title="Cattedre e ore">
          {classes.length} classi · {allHours} ore
          {unassigned.length ? ` · ${unassigned.length} materie senza docente` : " · tutte con il docente"}
        </StepTitle>
        <ChevronDown
          className="mt-1.5 size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-4">
        <p className="text-sm text-muted-foreground">
          Per ogni classe: materia, ore e docente. Poi puoi copiare le ore sulle altre classi.
        </p>
        <NativeSelect className="mt-3 sm:max-w-xs" value={classId} onChange={(e) => onClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.tempo})
            </option>
          ))}
        </NativeSelect>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="py-1.5 font-medium">Materia</th>
              <th className="py-1.5 pr-2 text-right font-medium">Ore</th>
              <th className="py-1.5 font-medium">Docente</th>
              <th className="w-10 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.subject} className="border-b border-border/70 last:border-0">
                <td className="py-1.5 pr-2">{row.subject}</td>
                <td className="py-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={18}
                    inputMode="numeric"
                    className="ml-auto h-10 w-16 text-right tabular-nums"
                    value={row.hours}
                    onChange={(e) => patch(row.subject, { hours: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={`Ore di ${row.subject}`}
                  />
                </td>
                <td className="py-1.5">
                  <NativeSelect value={row.teacherId} onChange={(e) => patch(row.subject, { teacherId: e.target.value })}>
                    <option value="">— scegli —</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {teacherName(t)}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    className="inline-flex size-10 items-center justify-center text-muted-foreground"
                    aria-label={`Togli ${row.subject}`}
                    onClick={() => onWrite(cattedre.filter((r) => !(r.classId === classId && r.subject === row.subject)))}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-2 font-medium">Totale</td>
              <td className="pt-2 pr-2 text-right font-medium tabular-nums">{totale}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <Input
              list="cattedra-subjects"
              placeholder="Altra materia"
              value={newSubject}
              onChange={(e) => onNewSubject(e.target.value)}
            />
            <datalist id="cattedra-subjects">
              {SUBJECTS.filter((s) => !rows.some((r) => r.subject === s)).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <Input
            type="number"
            min={1}
            max={18}
            inputMode="numeric"
            className="h-10 w-16 text-right"
            value={newHours}
            onChange={(e) => onNewHours(e.target.value)}
            aria-label="Ore della nuova materia"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const subject = newSubject.trim();
              const hours = Math.max(0, Number(newHours) || 0);
              if (!subject || hours <= 0) return;
              if (rows.some((r) => r.subject.toLowerCase() === subject.toLowerCase())) {
                toast.message("Questa materia c’è già in questa classe.");
                return;
              }
              onWrite([...cattedre, { classId, subject, hours, teacherId: "" }]);
              onNewSubject("");
              onNewHours("1");
            }}
          >
            Aggiungi
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const rest = cattedre.filter((r) => r.classId !== classId);
              const next = MONTE_ORE.map((r) => {
                const prev = rows.find((x) => x.subject === r.subject);
                return { classId, subject: r.subject, hours: r.hours, teacherId: prev?.teacherId ?? "" };
              });
              const extras = rows.filter((r) => !MONTE_ORE.some((m) => m.subject === r.subject));
              onWrite([...rest, ...next, ...extras]);
              toast.message("Questa classe: quadro ministeriale (30 ore).");
            }}
          >
            Ministeriale su questa classe
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const src = cattedre.filter((r) => r.classId === classId);
              if (src.length === 0) return;
              const others = classes.filter((c) => c.id !== classId);
              let next = cattedre.filter((r) => r.classId === classId);
              for (const cls of others) {
                const existing = cattedre.filter((r) => r.classId === cls.id);
                const rebuilt = src.map((row) => {
                  const prev = existing.find((x) => x.subject === row.subject);
                  return { classId: cls.id, subject: row.subject, hours: row.hours, teacherId: prev?.teacherId ?? "" };
                });
                next = [...next, ...rebuilt];
              }
              onWrite(next);
              toast.message("Ore copiate a tutte le classi (i docenti restano i loro).");
            }}
          >
            Copia ore alle altre classi
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="mt-3 text-sm text-destructive">Senza docente: {missing.map((u) => u.subject).join(" · ")}.</p>
        )}
      </div>
    </details>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} milioni di`;
  if (n >= 1000) return `${Math.round(n / 1000)} mila`;
  return String(n);
}

/** La migliore proposta trovata finora: vincoli ancora da sistemare (se ce ne sono) e ore buche. */
function bestSoFar(p: RunProgress): string {
  const hard = p.bestHard > 0 ? `${p.bestHard === 1 ? "1 vincolo" : `${p.bestHard} vincoli`} ancora da sistemare, ` : "";
  return `${hard}${p.bestGaps === 1 ? "1 ora buca" : `${p.bestGaps} ore buche`}`;
}

/** Barra di avanzamento della ricerca, accanto al titolo «Proposta». */
function SearchBar({ progress, className }: { progress: RunProgress; className?: string }) {
  const pct = Math.round(progress.fraction * 100);
  const detail = progress.iterations > 0 ? `migliore finora: ${bestSoFar(progress)}` : "preparo i dati…";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted md:h-2 md:w-48 md:flex-none"
        role="progressbar"
        aria-label="Avanzamento della ricerca"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="min-w-9 text-right text-[13px] font-semibold tabular-nums">{pct}%</span>
      <span className="hidden whitespace-nowrap text-[13px] tabular-nums text-muted-foreground 2xl:inline">{detail}</span>
    </div>
  );
}

function SearchProgress({ progress, onStop }: { progress: RunProgress; onStop: () => void }) {
  const pct = Math.round(progress.fraction * 100);
  return (
    <div className="mt-4 rounded-lg border border-border p-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium tabular-nums">Sto cercando l’orario migliore… {pct}%</p>
        <Button variant="outline" size="sm" onClick={onStop}>
          Basta così
        </Button>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Avanzamento della ricerca"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground tabular-nums">
        {progress.iterations > 0
          ? `Migliore finora: ${bestSoFar(progress)} · ${formatCount(progress.iterations)} combinazioni provate`
          : "Preparo i dati…"}
        {progress.workers > 1 ? ` · ${progress.workers} ricerche in parallelo` : ""}
      </p>
    </div>
  );
}

type CompareRow = {
  label: string;
  cur: number | null;
  prop: number;
  better: "low" | "high";
  curText?: string;
  propText?: string;
};

function hardCount(r: TimetableReport): number {
  const h = r.hard;
  return (
    h.conflicts.length +
    h.away.length +
    h.travel.length +
    h.no.length +
    h.longGaps.length +
    h.rientro.length +
    h.must.length +
    h.holes.length +
    h.pattern.length
  );
}

/** Le voci del confronto (anche per l’effetto dei ritocchi). */
const ROW_LABELS: Record<RowKey, string> = {
  span6: "A scuola dalla 1ª alla 6ª",
  six: "Giornate con 6 lezioni",
  five: "Giornate con 5 lezioni",
  gaps: "Ore buche tra le lezioni",
  multiGap: "Giornate con 2 o più ore buche",
  full: "Docenti a 18 ore: buche o 1ª–6ª",
  mixed: "Giorni divisi tra due plessi",
  single: "Giornate con una sola ora",
  lastMax: "Ultime ore: il docente che ne ha di più",
  firstHours: "Italiano e matematica alle prime ore",
  twoBlock: "Materie da 2 ore nello stesso giorno",
  pe: "Scienze motorie nelle ultime 3 ore",
  heavy: "Giornate pesanti",
  noLight: "Giornate senza materie leggere",
  langBlock: "Lingue 2 ore di fila",
  sameRun: "Stessa materia 3 ore di fila",
  split: "Materia spezzata nello stesso giorno",
  patterns: "Ore al giorno come scelte",
  classPref: "Classi preferite rispettate",
};
const ROW_ORDER = Object.keys(ROW_LABELS) as RowKey[];

/** Le stesse voci, in breve (per l’effetto di un ritocco). */
const ROW_SHORT: Record<RowKey, string> = {
  span6: "1ª–6ª",
  six: "giornate di 6 lezioni",
  five: "giornate di 5 lezioni",
  gaps: "ore buche",
  multiGap: "giornate con 2+ buche",
  full: "docenti a 18 ore",
  mixed: "giorni su due plessi",
  single: "giornate di un’ora",
  lastMax: "ultime ore",
  firstHours: "prime ore",
  twoBlock: "materie da 2 ore",
  pe: "motoria",
  heavy: "giornate pesanti",
  noLight: "senza materie leggere",
  langBlock: "lingue di fila",
  sameRun: "3 ore di fila",
  split: "materie spezzate",
  patterns: "ore al giorno",
  classPref: "classi preferite",
};

function compareGroups(cur: TimetableReport | null, prop: TimetableReport): { title: string; rows: CompareRow[] }[] {
  const c = cur && cur.lessons > 0 ? cur : null;
  const n = (f: (r: TimetableReport) => number) => ({ cur: c ? f(c) : null, prop: f(prop) });
  const L = ROW_LABELS;
  const docenti: CompareRow[] = [
    { label: L.span6, ...n((r) => r.docenti.span6.length), better: "low" },
    { label: L.six, ...n((r) => r.docenti.six.length), better: "low" },
    { label: L.five, ...n((r) => r.docenti.five.length), better: "low" },
    { label: L.gaps, ...n((r) => r.gapsTotal), better: "low" },
    { label: L.multiGap, ...n((r) => r.docenti.multiGap.length), better: "low" },
    { label: L.full, ...n((r) => r.docenti.full.length), better: "low" },
    { label: L.mixed, ...n((r) => r.docenti.mixed.length), better: "low" },
    { label: L.single, ...n((r) => r.docenti.single.length), better: "low" },
    { label: L.lastMax, ...n((r) => r.docenti.lastHours[0]?.count ?? 0), better: "low" },
  ];
  const classi: CompareRow[] = [
    {
      label: L.firstHours,
      ...n((r) => r.firstHours.ok),
      better: "high",
      curText: c ? `${c.firstHours.ok} su ${c.firstHours.total}` : undefined,
      propText: `${prop.firstHours.ok} su ${prop.firstHours.total}`,
    },
    { label: L.twoBlock, ...n((r) => r.didattica.twoBlock.length), better: "low" },
    {
      label: L.pe,
      ...n((r) => r.pe.ok),
      better: "high",
      curText: c ? `${c.pe.ok} su ${c.pe.total}` : undefined,
      propText: `${prop.pe.ok} su ${prop.pe.total}`,
    },
    { label: L.heavy, ...n((r) => r.didattica.heavy.length), better: "low" },
    { label: L.noLight, ...n((r) => r.didattica.noLight.length), better: "low" },
    { label: L.langBlock, ...n((r) => r.didattica.langBlock.length), better: "low" },
    { label: L.sameRun, ...n((r) => r.didattica.sameRun.length), better: "low" },
    { label: L.split, ...n((r) => r.didattica.split.length), better: "low" },
  ];
  const regole: CompareRow[] = [{ label: "Vincoli rigidi non rispettati", ...n(hardCount), better: "low" }];
  if (prop.patterns.total > 0) {
    regole.push({
      label: L.patterns,
      ...n((r) => r.patterns.ok),
      better: "high",
      curText: c ? `${c.patterns.ok} su ${c.patterns.total}` : undefined,
      propText: `${prop.patterns.ok} su ${prop.patterns.total}`,
    });
  }
  if (prop.classPref.want > 0) {
    regole.push({
      label: L.classPref,
      ...n((r) => r.classPref.hit),
      better: "high",
      curText: c ? `${c.classPref.hit} su ${c.classPref.want}` : undefined,
      propText: `${prop.classPref.hit} su ${prop.classPref.want}`,
    });
  }
  return [
    { title: "Docenti", rows: docenti },
    { title: "Classi", rows: classi },
    { title: "Regole", rows: regole },
  ];
}

function IssueList({ title, items }: { title: string; items: { text: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-[13px] font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
        {items.map((it, i) => (
          <li key={`${title}-${i}`}>{it.text}</li>
        ))}
      </ul>
    </div>
  );
}

function ReportDetails({ r }: { r: TimetableReport }) {
  const d = r.didattica;
  const t = r.docenti;
  const hard = [
    ...r.hard.conflicts,
    ...r.hard.away,
    ...r.hard.travel,
    ...r.hard.no,
    ...r.hard.longGaps,
    ...r.hard.rientro,
    ...r.hard.must,
    ...r.hard.holes,
    ...r.hard.pattern,
  ];
  const dispToAdd = r.patterns.rows
    .filter((x) => x.excess === 0 && x.missing > 0)
    .map((x) => ({
      text: `${x.name}: ${x.missing === 1 ? "1 ora" : `${x.missing} ore`} a disposizione da mettere, per arrivare a ${x.fits.map(patternLabel).join(" o ")}`,
    }));
  const gaps = r.gapsByTeacher
    .filter((g) => g.gaps > 0)
    .map((g) => ({ text: `${g.name}: ${g.gaps} (${g.where})` }));
  const didattica = [
    ...d.twoBlock,
    ...d.sameRun,
    ...d.sameDay,
    ...d.split,
    ...d.langBlock,
    ...d.heavy,
    ...d.noLight,
    ...d.teacherMany,
  ];
  return (
    <div className="text-sm">
      <IssueList title="Vincoli rigidi" items={hard} />
      <IssueList title="Ore al giorno" items={dispToAdd} />
      <IssueList title="Docenti a 18 ore" items={t.full} />
      <IssueList title="Giornate lunghe" items={[...t.six, ...t.span6, ...t.five]} />
      <IssueList title="Ore buche (ore vuote tra due lezioni)" items={gaps} />
      <IssueList title="Tra due lezioni, ma non sono buche" items={[...r.notGaps.disp, ...r.notGaps.away]} />
      <IssueList title="Giornate con più ore buche" items={t.multiGap} />
      <IssueList title="Altro per i docenti" items={[...t.empty, ...t.mixed, ...t.single]} />
      <IssueList title="Compiti: italiano e matematica alle prime ore" items={r.firstHours.missing} />
      <IssueList title="Prime ore spostate alla 2ª–3ª" items={r.firstHours.shifted} />
      <IssueList title="Classi" items={didattica} />
      <IssueList title="Scienze motorie" items={r.pe.missing} />
      <IssueList title="Materie concentrate in pochi giorni" items={d.spread} />
      <IssueList title="Classi preferite non rispettate" items={r.classPref.missing} />
      {t.lastHours.length > 0 && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Più ultime ore: {t.lastHours.map((x) => `${x.name} ${x.count}`).join(", ")}.
        </p>
      )}
      {r.warnings.length > 0 && <IssueList title="Avvisi" items={r.warnings.map((w) => ({ text: w }))} />}
    </div>
  );
}

function ReportPanel({
  current,
  proposal,
  mode,
  label: labelProp,
}: {
  current: TimetableReport | null;
  proposal: TimetableReport;
  /** edit: ritocchi a mano (la tabella si apre a richiesta) */
  mode: SolveMode | "edit";
  /** nome della colonna dell'orario nuovo (es. «Slot 3») */
  label?: string;
}) {
  const groups = compareGroups(current, proposal);
  const hasCurrent = Boolean(current && current.lessons > 0);
  const hard = hardCount(proposal);
  let better = 0;
  let worse = 0;
  for (const g of groups) {
    for (const row of g.rows) {
      if (row.cur === null || row.cur === row.prop) continue;
      if (row.better === "low" ? row.prop < row.cur : row.prop > row.cur) better += 1;
      else worse += 1;
    }
  }
  const counts = `${better === 0 ? "nessuna voce migliora" : better === 1 ? "migliora 1 voce" : `migliorano ${better} voci`}, ${
    worse === 0 ? "nessuna peggiora" : worse === 1 ? "1 peggiora" : `${worse} peggiorano`
  }`;
  const summary = !hasCurrent
    ? ""
    : mode === "edit"
      ? better === 0 && worse === 0
        ? "Nessuna voce del confronto cambia rispetto all’orario in uso."
        : `Rispetto all’orario in uso: ${counts}.`
      : mode === "improve"
      ? better === 0 && worse === 0
        ? "Nessun miglioramento trovato: ogni modifica provata peggiorava almeno una voce. L’orario in uso resta invariato."
        : worse === 0
          ? `${better === 1 ? "Migliora 1 voce" : `Migliorano ${better} voci`}, nessuna peggiora.`
          : `${better === 1 ? "Migliora 1 voce" : `Migliorano ${better} voci`}; per rispettare le tue scelte ${worse === 1 ? "ne peggiora 1" : `ne peggiorano ${worse}`}.`
      : `${better === 1 ? "1 voce migliora" : `${better} voci migliorano`}, ${worse === 0 ? "nessuna peggiora" : worse === 1 ? "1 peggiora" : `${worse} peggiorano`}.`;
  const label = labelProp ?? (mode === "edit" ? "Nuovo" : "Proposta");
  const table = (
    <table className="mt-3 w-full table-fixed border-collapse text-[13px] sm:text-sm">
      <colgroup>
        <col />
        {hasCurrent && <col className="w-[4.25rem] sm:w-24" />}
        <col className="w-[4.75rem] sm:w-28" />
      </colgroup>
      <thead>
        <tr className="text-left text-[12px] text-muted-foreground">
          <th className="pb-1 pr-2 font-medium" />
          {hasCurrent && <th className="whitespace-nowrap px-1 pb-1 text-right font-medium">In uso</th>}
          <th className="whitespace-nowrap pb-1 pl-1 text-right font-medium">{label}</th>
        </tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.title}>
          <tr>
            <th colSpan={hasCurrent ? 3 : 2} className="pb-1 pt-4 text-left text-[13px] font-semibold text-foreground">
              {g.title}
            </th>
          </tr>
          {g.rows.map((row) => {
            const cmp =
              row.cur === null || row.cur === row.prop
                ? 0
                : (row.better === "low" ? row.prop < row.cur : row.prop > row.cur)
                  ? 1
                  : -1;
            return (
              <tr key={row.label} className="border-t border-border">
                <td className="py-1.5 pr-2 leading-snug">{row.label}</td>
                {hasCurrent && (
                  <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums text-muted-foreground">
                    {row.cur === null ? "—" : (row.curText ?? row.cur)}
                  </td>
                )}
                <td className="whitespace-nowrap py-1.5 pl-1 text-right tabular-nums">
                  <span
                    className={cn(
                      "inline-flex min-w-8 justify-end rounded-md px-1.5 py-0.5 font-medium",
                      cmp > 0 && "bg-success-soft text-success",
                      cmp < 0 && "bg-danger-soft text-destructive",
                    )}
                  >
                    {row.propText ?? row.prop}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
  return (
    <div className="paper-panel mt-3 rounded-xl p-5">
      <p className={cn("text-sm", hard > 0 ? "text-destructive" : "text-muted-foreground")}>
        {hard === 0
          ? "Tutti i vincoli rispettati"
          : hard === 1
            ? "1 vincolo rigido non rispettato"
            : `${hard} vincoli rigidi non rispettati`}{" "}
        · {proposal.lessons} ore su{" "}
        {proposal.lessonsExpected}
      </p>
      {summary && <p className="mt-1 text-sm font-medium text-foreground">{summary}</p>}
      {mode === "edit" ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">Confronto voce per voce</summary>
          {table}
        </details>
      ) : (
        table
      )}
      <details className={cn("border-t border-border pt-3", mode === "edit" ? "mt-3" : "mt-4")}>
        <summary className="cursor-pointer text-sm font-medium">
          {mode === "edit" ? "Dettagli del nuovo orario" : "Dettagli della proposta"}
        </summary>
        <ReportDetails r={proposal} />
      </details>
      {hasCurrent && current && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">Dettagli dell’orario in uso</summary>
          <ReportDetails r={current} />
        </details>
      )}
    </div>
  );
}
