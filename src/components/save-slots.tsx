import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import {
  OFFICIAL_COPY_NAME,
  SAVE_SLOTS,
  activeSlotOf,
  openSavedTimetable,
  slotPart,
  slotsLikeOfficial,
  timetablePart,
  withPart,
  type TimetablePart,
} from "@/lib/saved-timetables";
import { evaluateCurrent } from "@/lib/timetable-solver";
import type { PersistedData, SavedTimetable } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAME_MAX = 40;

type SlotInfo = {
  n: number;
  /** la copia salvata (nome e data); quella dello slot in uso può essere vecchia */
  save: SavedTimetable | null;
  full: boolean;
  lessons: number;
  gaps: number | null;
  /** lezioni di docenti o classi che non ci sono più */
  dropped: number;
  /** prova uguale all’orario in vigore */
  same: boolean;
  inUse: boolean;
};

/** I dati che servono agli slot, con riferimenti stabili (si ricalcola solo quando cambiano). */
function useSlotsData(): PersistedData {
  const settings = useAppStore((s) => s.settings);
  const teachers = useAppStore((s) => s.teachers);
  const classes = useAppStore((s) => s.classes);
  const slots = useAppStore((s) => s.slots);
  const cattedre = useAppStore((s) => s.cattedre);
  const savedTimetables = useAppStore((s) => s.savedTimetables);
  const activeSlot = useAppStore((s) => s.activeSlot);
  const officialBackup = useAppStore((s) => s.officialBackup);
  return useMemo(
    () => ({
      settings,
      teachers,
      classes,
      slots,
      cattedre,
      savedTimetables,
      activeSlot,
      officialBackup,
      absences: [],
      substitutions: [],
      selectedDate: "",
    }),
    [settings, teachers, classes, slots, cattedre, savedTimetables, activeSlot, officialBackup],
  );
}

function gapsTotal(data: PersistedData): number | null {
  try {
    return evaluateCurrent(data).gapsTotal;
  } catch {
    return null;
  }
}

/** Lo slot 0 (in vigore) e le prove 1–5: contenuto, ore buche, quale è in uso. */
function slotsInfo(data: PersistedData): SlotInfo[] {
  const active = activeSlotOf(data);
  const like = new Set(slotsLikeOfficial(data));
  return [0, ...SAVE_SLOTS].map((n) => {
    const save = (data.savedTimetables ?? []).find((x) => x.n === n) ?? null;
    const inUse = n === active;
    const part = slotPart(data, n);
    if (!part) {
      return { n, save, full: false, lessons: 0, gaps: null, dropped: 0, same: false, inUse };
    }
    const open = inUse ? null : openSavedTimetable(data, { n, name: "", savedAt: 0, ...part });
    const lessons = open ? open.lessons.length : part.lessons.length;
    let gaps: number | null = null;
    if (lessons && inUse) gaps = gapsTotal(data);
    else if (lessons) {
      const w = withPart(data, part);
      gaps = gapsTotal({ ...data, slots: w.slots, teachers: w.teachers });
    }
    return {
      n,
      save,
      full: true,
      lessons,
      gaps,
      dropped: open?.dropped ?? 0,
      same: like.has(n),
      inUse,
    };
  });
}

const gapsText = (g: number | null) => (g === null ? "" : g === 1 ? "1 buca" : `${g} buche`);

function savedWhen(at: number, long = false): string {
  const d = new Date(at);
  return long
    ? d.toLocaleString("it-IT", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

const slotName = (i: SlotInfo) =>
  i.n === 0 ? "In vigore" : (i.save?.name ?? (i.full ? `Slot ${i.n}` : "Vuoto"));

/**
 * Riga degli slot: lo 0 è l’orario in vigore a scuola, dall’1 al 5 le prove fatte con Costruisci.
 * Lo slot in uso nell’app è «acceso». Toccando uno slot si apre la finestra con quello che si può fare.
 */
export function SaveSlots({
  onOpen,
  openWarning,
  onInUseChange,
  className,
}: {
  /** apre lo slot in Costruisci, come proposta da confrontare con l’orario in uso */
  onOpen: (n: number) => void;
  /** cosa si perde aprendo o usando un altro slot (proposta o ritocchi non salvati) */
  openWarning?: string | null;
  /** è cambiato l’orario in uso nell’app (un altro slot, «Rendi in vigore», «Annulla») */
  onInUseChange?: () => void;
  className?: string;
}) {
  const store = useAppStore();
  const data = useSlotsData();
  const info = useMemo(() => slotsInfo(data), [data]);
  const [picked, setPicked] = useState<number | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const active = activeSlotOf(data);

  const tile =
    "flex h-full min-h-[4.75rem] w-full min-w-0 flex-col items-start rounded-lg px-2 py-1.5 text-left transition-colors sm:px-2.5";
  const lit =
    "bg-primary text-primary-foreground ring-2 ring-primary/40 ring-offset-2 ring-offset-card";
  const inUseChip = (
    <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide">
      in uso
    </span>
  );

  // sul telefono lo 0 sta sopra, a tutta larghezza, poi le prove 3 + 2; dal tablet in su, tutti in fila
  return (
    <div className={className}>
      <ul className="grid grid-cols-6 gap-1.5 sm:gap-2" aria-label="Slot degli orari">
        {info.map((i) => {
          const label = `Slot ${i.n}: ${i.n === 0 ? "orario in vigore" : i.full ? slotName(i) : "vuoto"}${
            i.full && i.gaps !== null ? `, ${gapsText(i.gaps)}` : ""
          }${i.same ? ", uguale all’orario in vigore" : ""}${i.inUse ? ", in uso" : ""}`;
          if (i.n === 0) {
            return (
              <li key={i.n} className="col-span-6 min-w-0 sm:col-span-1">
                <button
                  type="button"
                  onClick={() => setPicked(0)}
                  aria-label={label}
                  aria-current={i.inUse ? "true" : undefined}
                  className={cn(
                    tile,
                    "min-h-11 flex-row items-center gap-2 sm:min-h-[4.75rem] sm:flex-col sm:items-start sm:gap-0",
                    i.inUse ? lit : "border-2 border-primary/70 bg-card hover:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold tabular-nums sm:w-full">
                    <span className={i.inUse ? "opacity-80" : "text-muted-foreground"}>0</span>
                    <BadgeCheck
                      className={cn("size-3.5", !i.inUse && "text-primary")}
                      aria-hidden
                    />
                    {i.inUse && <span className="ml-auto hidden sm:inline">{inUseChip}</span>}
                  </span>
                  <span className="text-[13px] font-semibold leading-tight sm:w-full sm:truncate">
                    In vigore
                  </span>
                  <span
                    className={cn(
                      "ml-auto text-[12px] leading-tight sm:ml-0 sm:w-full sm:truncate sm:text-[11px]",
                      i.inUse ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    {i.full ? gapsText(i.gaps) : "vuoto"}
                  </span>
                  {i.inUse && <span className="sm:hidden">{inUseChip}</span>}
                </button>
              </li>
            );
          }
          return (
            <li
              key={i.n}
              className={cn("min-w-0 sm:col-span-1", i.n <= 3 ? "col-span-2" : "col-span-3")}
            >
              <button
                type="button"
                onClick={() => setPicked(i.n)}
                aria-label={label}
                aria-current={i.inUse ? "true" : undefined}
                className={cn(
                  tile,
                  i.inUse
                    ? lit
                    : i.full
                      ? "border border-border bg-card hover:bg-muted"
                      : "border border-dashed border-border text-ink-faint hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "flex w-full items-center gap-1 text-[11px] font-semibold tabular-nums",
                    i.inUse ? "" : "text-muted-foreground",
                  )}
                >
                  <span className={i.inUse ? "opacity-80" : ""}>{i.n}</span>
                  {i.same && (
                    <Check className={cn("size-3", !i.inUse && "text-primary")} aria-hidden />
                  )}
                  {i.inUse ? (
                    <span className="ml-auto">{inUseChip}</span>
                  ) : (
                    i.save && (
                      <span className="ml-auto hidden font-normal sm:inline">
                        {savedWhen(i.save.savedAt)}
                      </span>
                    )
                  )}
                </span>
                <span
                  className={cn(
                    "line-clamp-2 w-full text-[13px] leading-tight [overflow-wrap:anywhere]",
                    i.full && "font-medium",
                  )}
                >
                  {slotName(i)}
                </span>
                {i.full && (
                  <span
                    className={cn(
                      "w-full truncate text-[11px] leading-tight",
                      i.inUse ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    {gapsText(i.gaps)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {data.officialBackup && (
        <button
          type="button"
          onClick={() => {
            store.undoMakeOfficial();
            onInUseChange?.();
            toast.message("Ripristinato l’orario in vigore di prima.");
          }}
          className="mt-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Annulla l’ultimo «Rendi in vigore»
        </button>
      )}

      <SlotDialog
        info={picked === null ? null : (info[picked] ?? null)}
        activeName={slotName(info[active] ?? info[0]!)}
        active={active}
        sameAs={info.filter((x) => x.same).map((x) => x.n)}
        openWarning={openWarning ?? null}
        onInUseChange={onInUseChange}
        data={data}
        onClose={() => setPicked(null)}
        onOpen={(n) => {
          setPicked(null);
          onOpen(n);
        }}
        onCopy={() => {
          setPicked(null);
          setCopyOpen(true);
        }}
      />
      <SaveToSlotDialog
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Salva una copia dell’orario in vigore"
        defaultName={OFFICIAL_COPY_NAME}
        getPart={() => slotPart(data, 0) ?? timetablePart(data)}
      />
    </div>
  );
}

function SlotDialog({
  info,
  activeName,
  active,
  sameAs,
  openWarning,
  onInUseChange,
  data,
  onClose,
  onOpen,
  onCopy,
}: {
  info: SlotInfo | null;
  /** nome dell’orario in uso */
  activeName: string;
  active: number;
  /** prove uguali all’orario in vigore */
  sameAs: number[];
  openWarning: string | null;
  onInUseChange?: () => void;
  data: PersistedData;
  onClose: () => void;
  onOpen: (n: number) => void;
  /** «Salva una copia» dell’orario in vigore (slot 0) */
  onCopy: () => void;
}) {
  const store = useAppStore();
  const n = info?.n ?? null;
  const [name, setName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmOfficial, setConfirmOfficial] = useState(false);
  useEffect(() => {
    setName(info?.save?.name ?? "");
    setConfirmClear(false);
    setConfirmOfficial(false);
  }, [n, info?.save?.name]);

  // gli stessi tasti, sempre negli stessi posti: quelli che non servono sono spenti
  const grid = "mt-5 grid grid-cols-2 gap-2";
  const btn = "w-full px-2";
  const lessonsLine = (i: SlotInfo) =>
    [i.lessons === 1 ? "1 lezione" : `${i.lessons} lezioni`, gapsText(i.gaps)]
      .filter(Boolean)
      .join(" · ");
  const use = (k: number) => {
    store.activateSlot(k);
    onInUseChange?.();
    toast.success(
      k === 0
        ? "In uso l’orario in vigore."
        : `Slot ${k} in uso. L’orario in vigore resta nello slot 0.`,
    );
    onClose();
  };

  let body: ReactNode = null;
  if (info && info.n === 0) {
    body = (
      <>
        <DialogHeader>
          <DialogTitle>Slot 0 · In vigore</DialogTitle>
          <DialogDescription>
            L’orario in uso a scuola: Oggi, assenze e sostituzioni usano sempre questo. Cambia solo
            con «Rendi in vigore» o con le correzioni a mano quando è in uso.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {info.full && info.lessons ? lessonsLine(info) : "Ancora nessuna lezione in orario."}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {info.inUse
            ? "È quello in uso nell’app."
            : `In uso nell’app ora: slot ${active} · ${activeName}.`}
          {sameAs.length > 0 &&
            ` È uguale ${sameAs.length === 1 ? `allo slot ${sameAs[0]}` : `agli slot ${sameAs.join(", ")}`}.`}
        </p>
        {!info.inUse && openWarning && <p className="mt-3 text-sm text-warning">{openWarning}</p>}
        <div className={grid}>
          <Button
            variant="outline"
            className={btn}
            onClick={() => onOpen(0)}
            disabled={info.inUse || !info.lessons}
          >
            Apri
          </Button>
          <Button variant="outline" className={btn} onClick={onCopy} disabled={!info.lessons}>
            Salva una copia…
          </Button>
          <Button className={cn(btn, "col-span-2")} onClick={() => use(0)} disabled={info.inUse}>
            {info.inUse ? "In uso" : "Usa questo orario"}
          </Button>
        </div>
      </>
    );
  } else if (info && !info.full) {
    body = (
      <>
        <DialogHeader>
          <DialogTitle>Slot {info.n} · vuoto</DialogTitle>
          <DialogDescription>
            Per metterci un orario usa «Salva nello slot…» o «Usa questo orario» in una proposta o
            nei ritocchi di Costruisci.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Oppure salva qui una copia dell’orario in uso ({activeName}).
        </p>
        <div className={grid}>
          <Button
            className={cn(btn, "col-span-2")}
            disabled={!data.slots.length}
            onClick={() => {
              const part = timetablePart(data);
              const copyName = active === 0 ? OFFICIAL_COPY_NAME : `${activeName} (copia)`;
              store.saveTimetable({ n: info.n, name: copyName, savedAt: Date.now(), ...part });
              toast.success(`Copia salvata nello slot ${info.n}.`);
              onClose();
            }}
          >
            Salva qui l’orario in uso
          </Button>
        </div>
      </>
    );
  } else if (info) {
    const k = info.n;
    const clean = name.trim().slice(0, NAME_MAX);
    body = (
      <>
        <DialogHeader>
          <DialogTitle>Slot {k}</DialogTitle>
          <DialogDescription>
            {info.inUse
              ? "È quello in uso nell’app: le modifiche restano in questo slot."
              : info.save
                ? `Salvato il ${savedWhen(info.save.savedAt, true)}.`
                : ""}
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nome
          <span className="flex gap-2">
            <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
            <Button
              variant="outline"
              disabled={!clean || clean === info.save?.name}
              onClick={() => {
                store.renameSavedTimetable(k, clean);
                toast.success("Nome cambiato.");
              }}
            >
              Rinomina
            </Button>
          </span>
        </label>
        <p className="mt-3 text-sm">{lessonsLine(info)}</p>
        {info.same && <p className="mt-1 text-sm text-primary">È uguale all’orario in vigore.</p>}
        {info.dropped > 0 && (
          <p className="mt-1 text-sm text-warning">
            {info.dropped === 1 ? "1 lezione è" : `${info.dropped} lezioni sono`} di docenti o
            classi che non ci sono più: non {info.dropped === 1 ? "viene usata" : "vengono usate"}.
          </p>
        )}
        {confirmOfficial && (
          <p className="mt-3 rounded-lg border border-warning/60 bg-warning-soft px-3 py-2 text-sm">
            Lo slot {k} prende il posto dell’orario in vigore (slot 0), quello che usano Oggi e le
            sostituzioni. Potrai annullarlo subito dopo.
          </p>
        )}
        {!info.inUse && openWarning && <p className="mt-3 text-sm text-warning">{openWarning}</p>}
        <div className={grid}>
          <Button
            variant="outline"
            className={btn}
            onClick={() => onOpen(k)}
            disabled={info.inUse || !info.lessons}
          >
            Apri
          </Button>
          <Button
            variant="outline"
            className={cn(btn, confirmOfficial && "border-warning text-warning")}
            disabled={!info.lessons || info.same}
            onClick={() => {
              if (!confirmOfficial) {
                setConfirmOfficial(true);
                return;
              }
              store.makeOfficial(k);
              onInUseChange?.();
              toast.success(`Lo slot ${k} è ora l’orario in vigore.`);
              onClose();
            }}
          >
            {confirmOfficial ? "Sì, rendi in vigore" : "Rendi in vigore"}
          </Button>
          <Button
            variant="outline"
            className={cn(btn, confirmClear && "border-destructive text-destructive")}
            disabled={info.inUse}
            title={info.inUse ? "È in uso: prima usa un altro slot" : undefined}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              store.clearSavedTimetable(k);
              toast.message(`Slot ${k} svuotato.`);
              onClose();
            }}
          >
            {confirmClear ? "Sì, svuota" : "Svuota"}
          </Button>
          <Button className={btn} onClick={() => use(k)} disabled={info.inUse || !info.lessons}>
            {info.inUse ? "In uso" : "Usa questo orario"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{body}</DialogContent>
    </Dialog>
  );
}

/**
 * Sceglie uno slot di prova (1–5) per un orario. «save»: lo salva e basta (lo slot in uso non si
 * tocca); «use»: lo mette nello slot e lo usa (`onPick`). Uno slot pieno si sostituisce dopo una
 * conferma. Lo slot 0, l’orario in vigore, non c’è mai.
 */
export function SaveToSlotDialog({
  open,
  onClose,
  mode = "save",
  title,
  description,
  notes,
  defaultName,
  getPart,
  openSlot,
  fixedSlot,
  onPick,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  mode?: "save" | "use";
  title?: string;
  description?: string;
  /** note sotto la descrizione (es. ore a disposizione) */
  notes?: ReactNode;
  defaultName: string;
  /** l’orario da salvare, letto al momento del salvataggio */
  getPart?: () => TimetablePart;
  /** slot aperto in Costruisci, se c’è */
  openSlot?: number | null;
  /** «use»: lo slot è già deciso (quello in uso) */
  fixedSlot?: number | null;
  onPick?: (n: number, name: string) => void;
  onSaved?: (n: number) => void;
}) {
  const store = useAppStore();
  const savedTimetables = useAppStore((s) => s.savedTimetables);
  const active = useAppStore((s) => s.activeSlot) ?? 0;
  const saves = useMemo(
    () => new Map((savedTimetables ?? []).map((s) => [s.n, s])),
    [savedTimetables],
  );
  const [name, setName] = useState(defaultName);
  const [confirmN, setConfirmN] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setConfirmN(null);
  }, [open, defaultName]);

  const clean = name.trim().slice(0, NAME_MAX) || defaultName;
  const pick = (n: number) => {
    if (mode === "use") {
      onPick?.(n, clean);
      onClose();
      return;
    }
    const part = getPart?.();
    if (!part) return;
    store.saveTimetable({
      n,
      name: clean,
      savedAt: Date.now(),
      lessons: part.lessons,
      disp: part.disp,
    });
    toast.success(`Salvato nello slot ${n}: «${clean}».`);
    onSaved?.(n);
    onClose();
  };
  const row =
    "flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title ?? (mode === "use" ? "Usa questo orario" : "Salva nello slot")}
          </DialogTitle>
          <DialogDescription>
            {description ??
              (mode === "use"
                ? "Va in uno slot di prova e diventa quello in uso nell’app. L’orario in vigore (slot 0) non cambia."
                : "Si salvano le lezioni e le ore a disposizione del mattino dei docenti di materia.")}
          </DialogDescription>
        </DialogHeader>
        {notes}
        <label className="mt-1 flex flex-col gap-1.5 text-sm font-medium">
          Nome
          <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </label>
        {fixedSlot ? (
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button onClick={() => pick(fixedSlot)}>Usa nello slot {fixedSlot}</Button>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-1.5">
            {SAVE_SLOTS.map((n) => {
              const s = saves.get(n);
              const inUse = n === active;
              const full = Boolean(s) || inUse;
              const blocked = mode === "save" && inUse;
              if (confirmN === n && full) {
                return (
                  <li key={n} className="rounded-lg border border-destructive/60 px-3 py-2 text-sm">
                    <p>
                      {inUse
                        ? `Sostituire l’orario in uso nello slot ${n}${s ? ` («${s.name}»)` : ""}?`
                        : `Sostituire «${s?.name ?? ""}» del ${s ? savedWhen(s.savedAt) : ""} nello slot ${n}?`}
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setConfirmN(null)}>
                        No
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => pick(n)}>
                        Sostituisci
                      </Button>
                    </div>
                  </li>
                );
              }
              const meta = [
                s ? savedWhen(s.savedAt) : "",
                inUse ? "in uso" : "",
                openSlot === n ? "aperto ora" : "",
                blocked ? "per cambiarlo usa «Usa questo orario»" : full ? "si sostituisce" : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={n}>
                  <button
                    type="button"
                    disabled={blocked}
                    className={cn(
                      row,
                      full
                        ? "border-border bg-card hover:bg-muted"
                        : "border-dashed border-border hover:bg-muted",
                    )}
                    onClick={() => (full ? setConfirmN(n) : pick(n))}
                  >
                    <span className="w-4 shrink-0 text-center font-semibold tabular-nums">{n}</span>
                    <span className="min-w-0 flex-1">
                      {full ? (
                        <>
                          <span className="block truncate font-medium">
                            {s?.name ?? `Slot ${n}`}
                          </span>
                          <span className="block text-[12px] text-muted-foreground">{meta}</span>
                        </>
                      ) : (
                        <span className="block text-ink-faint">Vuoto</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
