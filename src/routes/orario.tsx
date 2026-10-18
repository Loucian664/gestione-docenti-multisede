import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Tabs } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useAppStore, snapshot } from "@/lib/store";
import { trialFileTag } from "@/lib/saved-timetables";
import {
  cellSlots,
  classCellSlots,
  defaultSubjectFor,
  isDispHour,
  teacherDayWindow,
  teacherName,
  teacherShort,
  teacherSlotAt,
} from "@/lib/coverage";
import { SubjectSelect } from "@/components/subject-select";
import { DAY_SHORT, type DayOfWeek } from "@/lib/types";
import { toSchoolDay } from "@/lib/dates";
import { Download, Images as ImageIcon, FileText, Archive, BookOpen, LayoutGrid, Users, StretchHorizontal } from "lucide-react";
import { docentiPdfZip, schoolFileTag, timetableXlsx } from "@/lib/export";
import { shareJpeg, shareOrSaveFile, toastSave, openPdfTab } from "@/lib/share-file";
import { jpegBlobToPdf } from "@/lib/pdf";
import {
  orarioClassJpeg,
  orarioQuadroJpeg,
  orarioTeacherJpeg,
  orarioWeekJpeg,
  orarioOrizzontaleJpeg,
  orarioClassiGridJpeg,
  weekCellLines,
} from "@/lib/sheet-image";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ScrollGrid } from "@/components/scroll-grid";
import { teacherCell } from "@/lib/teacher-palette";
import { CostruisciOrario } from "@/components/costruisci-orario";
import { allSedi, elsewhereCells, sedeName } from "@/lib/sedi";
import { GiornoGenerale, SettimanaGenerale } from "@/components/vista-generale";
import { vistaSedi } from "@/lib/sedi-insieme";
import { BucheList } from "@/components/buche-list";
import { gapsOf, gapsRanking, isTimetableTeacher } from "@/lib/build-timetable";
import { ensureTpPeriods, isMensaPeriod, isRestrictedTpPeriod, visiblePeriods } from "@/lib/periods";

type OrarioSearch = { docente?: string; slot?: number };

/** Prima colonna ferma delle griglie: fondo pieno e ombra leggera quando la griglia è scorsa di lato. */
const STICKY_COL =
  "sticky left-0 z-10 bg-card group-data-[scrolled=true]:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.28)]";

export const Route = createFileRoute("/orario")({
  component: OrarioPage,
  validateSearch: (raw: Record<string, unknown>): OrarioSearch => ({
    docente: typeof raw.docente === "string" ? raw.docente : undefined,
    // slot da aprire in Costruisci (da Impostazioni)
    slot: raw.slot !== undefined && [0, 1, 2, 3, 4, 5].includes(Number(raw.slot)) ? Number(raw.slot) : undefined,
  }),
});

type CellEdit = { day: DayOfWeek; periodId: string; classId: string };
type TeacherEdit = { day: DayOfWeek; periodId: string; teacherId: string };

function OrarioPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const store = useAppStore();
  const data = snapshot(store);
  const [view, setView] = useState<"quadro" | "settimana" | "class" | "teacher" | "costruisci">(
    search.docente ? "teacher" : search.slot !== undefined ? "costruisci" : "quadro",
  );
  const [classId, setClassId] = useState(data.classes[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(search.docente ?? data.teachers[0]?.id ?? "");
  const weekday = toSchoolDay(data.selectedDate);
  const [quadroDay, setQuadroDay] = useState<DayOfWeek>(
    weekday && data.settings.days.includes(weekday) ? weekday : 1,
  );
  const [cellEdit, setCellEdit] = useState<CellEdit | null>(null);
  // Quadro e Settimana: la sede in uso o tutte le sedi (vista generale, in sola lettura)
  const several = allSedi(data).length > 1;
  const [allSediView, setAllSediView] = useState(false);
  const generale = several && allSediView && (view === "quadro" || view === "settimana");
  const [teacherEdit, setTeacherEdit] = useState<TeacherEdit | null>(null);

  useEffect(() => {
    if (search.docente) {
      setView("teacher");
      setTeacherId(search.docente);
    }
  }, [search.docente]);

  useEffect(() => {
    if (search.slot !== undefined) setView("costruisci");
  }, [search.slot]);

  const days = data.settings.days;
  const quadroPeriods = visiblePeriods(data.settings);
  const classPeriods = visiblePeriods(
    data.settings,
    data.classes.find((c) => c.id === classId)?.tempo,
  );
  const teacherPeriods = visiblePeriods(data.settings);
  const classOrder = [...data.classes].sort(
    (a, b) => a.grade - b.grade || a.section.localeCompare(b.section),
  );
  const currentTeacher = data.teachers.find((t) => t.id === teacherId);
  const teacherHours = data.slots.filter((s) => s.teacherId === teacherId).length;
  // ore dello stesso docente nelle altre sedi, sulla campanella di questa
  const elsewhere = currentTeacher ? elsewhereCells(data, currentTeacher) : [];
  const elsewhereLessons = elsewhere.filter((c) => c.label !== "disp.");
  const elsewhereSedi = [...new Set(elsewhere.map((c) => c.sedeName))];
  // chi insegna anche in altre sedi: ogni ora dice in quale sede è, anche quelle della sede in uso
  const hereName = elsewhere.length > 0 ? sedeName(data.settings) : "";
  const teacherDisp = currentTeacher?.dispSlots?.length ?? 0;
  const teacherGaps =
    currentTeacher && isTimetableTeacher(currentTeacher)
      ? gapsOf(data, data.slots, teacherId, true)
      : 0;
  const weekGaps = useMemo(() => gapsRanking(data, data.slots, true), [data]);
  const className = data.classes.find((c) => c.id === classId)?.name ?? "classe";

  const schoolTag = schoolFileTag(data.settings.schoolName);
  // prova in uso (slot 1–5): l'orario in vigore resta nello slot 0
  const activeSlot = data.activeSlot ?? 0;
  const activeName = activeSlot ? (data.savedTimetables ?? []).find((s) => s.n === activeSlot)?.name : undefined;

  function fileStem(stem: string) {
    // un orario di prova si riconosce anche dal nome del file
    return `${stem}${trialFileTag(data)}-${schoolTag}`;
  }

  async function currentOrarioJpeg(): Promise<{ blob: Blob; base: string }> {
    if (view === "settimana") {
      return { blob: await orarioWeekJpeg(data), base: fileStem("orario-settimanale") };
    }
    if (view === "class") {
      return { blob: await orarioClassJpeg(data, classId), base: fileStem(`orario-${className}`) };
    }
    if (view === "teacher") {
      const name = currentTeacher ? teacherShort(currentTeacher, data.teachers) : "docente";
      return { blob: await orarioTeacherJpeg(data, teacherId), base: fileStem(`orario-${name}`) };
    }
    return { blob: await orarioQuadroJpeg(data, quadroDay), base: fileStem(`orario-${DAY_SHORT[quadroDay]}`) };
  }

  function saveJpegAsPdf(makeJpeg: () => Promise<Blob>, filename: string) {
    const tab = openPdfTab();
    void (async () => {
      try {
        const jpeg = await makeJpeg();
        const pdf = await jpegBlobToPdf(jpeg);
        toastSave(tab.show(filename, pdf), "pdf");
      } catch {
        tab.cancel();
        toast.error("Non sono riuscito a creare il PDF.");
      }
    })();
  }

  return (
    <div>
      <PageHeader
        title="Orario"
        description="Consulta, modifica e stampa l’orario di classi e docenti. In «Costruisci» puoi generare una proposta di orario."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                void shareOrSaveFile(timetableXlsx(data)).then((outcome) =>
                  toastSave(outcome, "excel"),
                );
              }}
            >
              <Download />
              Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void (async () => {
                  try {
                    const { blob, base } = await currentOrarioJpeg();
                    toastSave(await shareJpeg(`${base}.jpg`, blob), "image");
                  } catch {
                    toast.error("Non sono riuscito a creare la foto.");
                  }
                })();
              }}
            >
              <ImageIcon />
              Foto
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const tab = openPdfTab();
                void (async () => {
                  try {
                    const { blob, base } = await currentOrarioJpeg();
                    const pdf = await jpegBlobToPdf(blob);
                    toastSave(tab.show(`${base}.pdf`, pdf), "pdf");
                  } catch {
                    tab.cancel();
                    toast.error("Non sono riuscito a creare il PDF.");
                  }
                })();
              }}
            >
              <FileText />
              PDF
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {activeSlot !== 0 && (
          <p className="inline-flex max-w-full items-center self-start rounded-full bg-primary px-3 py-1 text-[13px] font-medium text-primary-foreground">
            <span className="truncate">
              Slot {activeSlot} in uso{activeName ? ` · ${activeName}` : ""}
            </span>
          </p>
        )}
        <Tabs
          className="flex-wrap overflow-visible"
          value={view}
          onValueChange={(v) => setView(v as "quadro" | "settimana" | "class" | "teacher" | "costruisci")}
          items={[
            { value: "quadro", label: "Quadro", title: "Tutte le classi, un giorno alla volta" },
            { value: "settimana", label: "Settimana", title: "Tutte le classi, tutta la settimana" },
            { value: "class", label: "Classe", title: "Orario settimanale di una classe" },
            { value: "teacher", label: "Docente", title: "Orario settimanale di un docente" },
            { value: "costruisci", label: "Costruisci", title: "Generazione guidata dell’orario" },
          ]}
        />
        {several && (view === "quadro" || view === "settimana") && (
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Sedi" className="inline-flex flex-wrap rounded-lg bg-muted p-1">
              {([
                [false, "Questa sede"],
                [true, "Tutte le sedi"],
              ] as const).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={allSediView === v}
                  onClick={() => setAllSediView(v)}
                  className={cn(
                    "min-h-9 rounded-md px-3 text-[13px] font-medium transition-colors",
                    allSediView === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {generale && (
              <span className="text-[13px] text-muted-foreground">
                Vista generale, da consultare: le ore si cambiano nella loro sede. Stampe ed esportazioni restano della
                sede in uso.
              </span>
            )}
          </div>
        )}
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={Boolean(data.settings.tpAfternoon)}
            onChange={(e) => {
              const on = e.target.checked;
              store.updateSettings({
                tpAfternoon: on,
                periods: on ? ensureTpPeriods(data.settings.periods) : data.settings.periods,
              });
            }}
          />
          Mensa, 7ª e 8ª per le classi a tempo prolungato
        </label>
        {view !== "costruisci" && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Fogli da stampare
            </p>
            <div className="grid grid-cols-6 gap-1.5 md:flex md:flex-wrap md:items-center">
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 h-9 min-w-0 w-full px-1.5 text-[12px] md:h-8 md:w-auto md:px-3 md:text-[13px]"
                onClick={() => saveJpegAsPdf(() => orarioClassiGridJpeg(data, "materie"), `${fileStem("orario-materie")}.pdf`)}
              >
                <BookOpen />
                Materie
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 h-9 min-w-0 w-full px-1.5 text-[12px] md:h-8 md:w-auto md:px-3 md:text-[13px]"
                onClick={() => saveJpegAsPdf(() => orarioClassiGridJpeg(data), `${fileStem("orario-classi")}.pdf`)}
              >
                <LayoutGrid />
                Per classe
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 h-9 min-w-0 w-full px-1.5 text-[12px] md:h-8 md:w-auto md:px-3 md:text-[13px]"
                title="Per classe + docenti"
                onClick={() => saveJpegAsPdf(() => orarioClassiGridJpeg(data, true), `${fileStem("orario-classi-docenti")}.pdf`)}
              >
                <Users />
                <span className="md:hidden">+ docenti</span>
                <span className="hidden md:inline">Per classe + docenti</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="col-span-3 h-9 min-w-0 w-full px-1.5 text-[12px] md:h-8 md:w-auto md:px-3 md:text-[13px]"
                onClick={() => saveJpegAsPdf(() => orarioOrizzontaleJpeg(data), `${fileStem("orario-orizzontale")}.pdf`)}
              >
                <StretchHorizontal />
                Orizzontale
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="col-span-3 h-9 min-w-0 w-full px-1.5 text-[12px] md:h-8 md:w-auto md:px-3 md:text-[13px]"
                onClick={() => {
                  toast.message("Preparo lo zip dei PDF…");
                  void (async () => {
                    try {
                      const file = await docentiPdfZip(data);
                      toastSave(await shareOrSaveFile(file), "zip");
                    } catch {
                      toast.error("Non sono riuscito a creare lo zip dei docenti.");
                    }
                  })();
                }}
              >
                <Archive />
                PDF docenti
              </Button>
            </div>
          </div>
        )}
        {view === "quadro" && (
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setQuadroDay(d)}
                className={cn(
                  "h-10 min-w-14 rounded-md px-3 text-sm font-medium",
                  quadroDay === d ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                )}
              >
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        )}
        {view === "class" && (
          <NativeSelect className="sm:max-w-xs" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classOrder.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.tempo})
              </option>
            ))}
          </NativeSelect>
        )}
        {view === "teacher" && (
          <div className="flex flex-col gap-1 sm:max-w-xs">
            <NativeSelect value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {data.teachers
                .slice()
                .sort((a, b) => a.lastName.localeCompare(b.lastName, "it"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {teacherName(t)}
                    {t.role === "potenziamento" ? " · potenz." : t.role === "sostegno" ? " · sost." : ""}
                  </option>
                ))}
            </NativeSelect>
            <p className="text-[12px] text-muted-foreground">
              {teacherHours === 1 ? "1 ora in orario" : `${teacherHours} ore in orario`}
              {teacherDisp > 0
                ? teacherDisp === 1
                  ? " · 1 a disposizione"
                  : ` · ${teacherDisp} a disposizione`
                : ""}
              {currentTeacher && isTimetableTeacher(currentTeacher)
                ? teacherGaps === 1
                  ? " · 1 buca"
                  : ` · ${teacherGaps} buche`
                : ""}
              {elsewhereSedi.length > 0
                ? ` · ${elsewhereLessons.length === 1 ? "1 ora" : `${elsewhereLessons.length} ore`} a ${elsewhereSedi.join(", ")}`
                : ""}
              . Seleziona una casella per inserire o modificare un’ora, anche in compresenza.
            </p>
          </div>
        )}
      </div>

      {view === "costruisci" && (
        <CostruisciOrario
          openSlot={search.slot}
          onSlotOpened={() => void navigate({ search: (prev) => ({ ...prev, slot: undefined }), replace: true })}
        />
      )}

      {view === "quadro" && generale && <GiornoGenerale sedi={vistaSedi(data)} day={quadroDay} />}

      {view === "settimana" && generale && <SettimanaGenerale sedi={vistaSedi(data)} />}

      {view === "quadro" && !generale && (
        <ScrollGrid unit={["Classe", "Classi"]}>
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className={cn(STICKY_COL, "w-24 px-3 py-2 font-medium")}>Ora</th>
                {classOrder.map((c) => (
                  <th key={c.id} className="px-2 py-2 font-medium">
                    <div className="text-foreground">{c.name}</div>
                    <div className="text-[10px] font-medium tracking-wide text-ink-faint">{c.tempo}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quadroPeriods.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={cn(STICKY_COL, "px-3 py-2 align-top")}>
                    <div className="text-[13px] font-medium">{p.label}</div>
                    <div className="text-[11px] text-ink-faint">
                      {p.start}–{p.end}
                    </div>
                  </td>
                  {classOrder.map((c) => {
                    const tpCell = isRestrictedTpPeriod(p);
                    const allowed = !tpCell || c.tempo === "TP";
                    const occupants = allowed ? classCellSlots(data, c.id, quadroDay, p.id) : [];
                    const primary = occupants[0];
                    const t = primary ? data.teachers.find((x) => x.id === primary.teacherId) : null;
                    if (!allowed) {
                      return (
                        <td key={c.id} className="bg-muted/40 p-1 align-top" />
                      );
                    }
                    const tc = teacherCell(t?.color);
                    return (
                      <td key={c.id} className="p-1 align-top">
                        <button
                          type="button"
                          onClick={() => setCellEdit({ day: quadroDay, periodId: p.id, classId: c.id })}
                          className={cn(
                            "flex min-h-[4.25rem] w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted",
                            tc.className,
                          )}
                          style={tc.style}
                        >
                          {occupants.length === 0 ? (
                            <span className="text-[11px] text-ink-faint">—</span>
                          ) : (
                            occupants.map((s, i) => {
                              const doc = data.teachers.find((x) => x.id === s.teacherId);
                              return (
                                <span
                                  key={s.id}
                                  className={cn("flex flex-col leading-tight", i > 0 && "mt-1")}
                                >
                                  <span className="text-[12px] font-medium">{doc ? teacherShort(doc, data.teachers) : ""}</span>
                                  <span className={cn("text-[11px]", tc.text2)}>
                                    {s.subject}
                                    {i > 0 ? " · compr." : ""}
                                  </span>
                                </span>
                              );
                            })
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollGrid>
      )}

      {view === "settimana" && !generale && (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            Quadro settimanale di lavoro: con Foto e PDF, in alto, lo esporti così com’è, con i docenti.
          </p>
          <ScrollGrid unit={["Giorno", "Giorni"]}>
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className={cn(STICKY_COL, "w-20 px-3 py-2 font-medium")}>Classe</th>
                  {days.map((d) => (
                    <th key={d} className="px-2 py-2 font-medium text-foreground">
                      {DAY_SHORT[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classOrder.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 align-top">
                    <td className={cn(STICKY_COL, "px-3 py-2")}>
                      <div className="text-[13px] font-medium">{c.name}</div>
                      <div className="text-[10px] tracking-wide text-ink-faint">{c.tempo}</div>
                    </td>
                    {days.map((d) => (
                      <td key={d} className="px-2 py-2 font-normal leading-[1.35] text-[11px]">
                        {weekCellLines(data, c.id, d).map((line, i) => (
                          <div
                            key={`${c.id}-${d}-${i}`}
                            className={line.teacher ? "text-foreground" : "text-ink-faint"}
                          >
                            {line.teacher ? (
                              <>
                                {line.mark} {line.subject}{" "}
                                <span className="font-semibold">{line.teacher}</span>
                              </>
                            ) : line.subject === "Mensa" ? (
                              "Mensa"
                            ) : (
                              `${line.mark}  —`
                            )}
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollGrid>
          <BucheList className="paper-panel mt-3 rounded-xl p-5" rows={weekGaps} />
        </div>
      )}

      {view === "class" && (
        <ScrollGrid unit={["Giorno", "Giorni"]}>
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className={cn(STICKY_COL, "w-24 px-3 py-2 font-medium")}>Ora</th>
                {days.map((d) => (
                  <th key={d} className="px-2 py-2 font-medium">
                    {DAY_SHORT[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {classPeriods.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={cn(STICKY_COL, "px-3 py-2 align-top")}>
                    <div className="text-[13px] font-medium">{p.label}</div>
                    <div className="text-[11px] text-ink-faint">
                      {p.start}–{p.end}
                    </div>
                  </td>
                  {days.map((d) => {
                    const occupants = classCellSlots(data, classId, d, p.id);
                    const primary = occupants[0];
                    const t = primary ? data.teachers.find((x) => x.id === primary.teacherId) : null;
                    const tc = teacherCell(t?.color);
                    return (
                      <td key={d} className="p-1.5 align-top">
                        <button
                          type="button"
                          onClick={() => setCellEdit({ day: d, periodId: p.id, classId })}
                          className={cn(
                            "flex min-h-16 w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted",
                            tc.className,
                          )}
                          style={tc.style}
                        >
                          {occupants.length === 0 ? (
                            <span className="text-[12px] text-ink-faint">Vuoto</span>
                          ) : (
                            occupants.map((s, i) => {
                              const doc = data.teachers.find((x) => x.id === s.teacherId);
                              return (
                                <span
                                  key={s.id}
                                  className={cn("flex flex-col leading-tight", i > 0 && "mt-1")}
                                >
                                  <span className="text-[13px] font-medium">{s.subject}</span>
                                  <span className={cn("text-[12px]", tc.text2)}>
                                    {doc ? teacherShort(doc, data.teachers) : ""}
                                    {i > 0 ? " · compr." : ""}
                                  </span>
                                </span>
                              );
                            })
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollGrid>
      )}

      {view === "teacher" && (
        <ScrollGrid unit={["Giorno", "Giorni"]}>
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className={cn(STICKY_COL, "w-24 px-3 py-2 font-medium")}>Ora</th>
                {days.map((d) => (
                  <th key={d} className="px-2 py-2 font-medium">
                    {DAY_SHORT[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teacherPeriods.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={cn(STICKY_COL, "px-3 py-2 align-top")}>
                    <div className="text-[13px] font-medium">{p.label}</div>
                    <div className="text-[11px] text-ink-faint">
                      {p.start}–{p.end}
                    </div>
                  </td>
                  {days.map((d) => {
                    const slot = teacherSlotAt(data, teacherId, d, p.id);
                    const cls = slot ? data.classes.find((c) => c.id === slot.classId) : null;
                    const others = slot ? cellSlots(data, slot.classId, d, p.id).filter((s) => s.teacherId !== teacherId) : [];
                    const win = teacherDayWindow(data, teacherId, d);
                    const inWindow = Boolean(
                      win &&
                        !isMensaPeriod(p) &&
                        p.index >= win.first &&
                        p.index <= win.last,
                    );
                    const disp = Boolean(currentTeacher && !slot && isDispHour(currentTeacher, d, p.id));
                    const tc = teacherCell(slot ? currentTeacher?.color : undefined);
                    const there = slot ? undefined : elsewhere.find((c) => c.day === d && c.periodId === p.id);
                    if (there) {
                      // ora in un'altra sede: stessi colori delle ore di qui, si cambia passando a quella sede
                      const thereDisp = there.label === "disp.";
                      const thc = teacherCell(thereDisp ? undefined : currentTeacher?.color);
                      return (
                        <td key={d} className="p-1.5 align-top">
                          <button
                            type="button"
                            onClick={() =>
                              toast.message(`Ora a ${there.sedeName}: si cambia passando a quella sede dal menu.`)
                            }
                            className={cn(
                              "flex min-h-16 w-full cursor-default flex-col rounded-md px-2 py-1.5 text-left",
                              thc.className,
                            )}
                            style={
                              thc.style ??
                              (thereDisp
                                ? { background: "color-mix(in oklab, var(--color-accent) 45%, transparent)" }
                                : undefined)
                            }
                            title="Ora in un’altra sede: si cambia passando a quella sede"
                          >
                            <span className={cn("text-[12px] font-medium", thc.text2)}>{there.sedeName}</span>
                            {thereDisp ? (
                              <span className="text-[12px] text-ink-faint">A disposizione</span>
                            ) : (
                              <>
                                <span className="text-[13px] font-medium">{there.label}</span>
                                <span className={cn("text-[12px]", thc.text2)}>{there.subject}</span>
                              </>
                            )}
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={d} className="p-1.5 align-top">
                        <button
                          type="button"
                          onClick={() => setTeacherEdit({ day: d, periodId: p.id, teacherId })}
                          className={cn(
                            "flex min-h-16 w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted",
                            tc.className,
                          )}
                          style={
                            tc.style ??
                            (disp ? { background: "color-mix(in oklab, var(--color-accent) 45%, transparent)" } : undefined)
                          }
                        >
                          {slot ? (
                            <>
                              {hereName && (
                                <span className={cn("text-[12px] font-medium", tc.text2)}>{hereName}</span>
                              )}
                              <span className="text-[13px] font-medium">{cls?.name}</span>
                              <span className={cn("text-[12px]", tc.text2)}>
                                {slot.subject}
                              </span>
                              {others.length > 0 && (
                                <span className={cn("text-[11px]", tc.text2)}>Compresenza</span>
                              )}
                            </>
                          ) : (
                            <>
                              {disp && hereName && (
                                <span className="text-[12px] font-medium text-muted-foreground">{hereName}</span>
                              )}
                              <span className="text-[12px] text-ink-faint">
                                {disp ? "A disposizione" : inWindow ? "Buca · in sede" : "Aggiungi"}
                              </span>
                            </>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollGrid>
      )}

      {cellEdit && (
        <CellEditor
          key={`${cellEdit.classId}-${cellEdit.day}-${cellEdit.periodId}`}
          editing={cellEdit}
          onClose={() => setCellEdit(null)}
        />
      )}
      {teacherEdit && (
        <TeacherHourEditor
          key={`${teacherEdit.teacherId}-${teacherEdit.day}-${teacherEdit.periodId}`}
          editing={teacherEdit}
          onClose={() => setTeacherEdit(null)}
        />
      )}
    </div>
  );
}

function CellEditor({
  editing,
  onClose,
}: {
  editing: CellEdit;
  onClose: () => void;
}) {
  const store = useAppStore();
  const data = snapshot(store);
  const occupants = classCellSlots(data, editing.classId, editing.day, editing.periodId);
  const period = data.settings.periods.find((p) => p.id === editing.periodId);
  const cls = data.classes.find((c) => c.id === editing.classId);
  const mensa = isMensaPeriod(period);
  const used = new Set(occupants.map((s) => s.teacherId));
  const [teacherId, setTeacherId] = useState(
    data.teachers.find((t) => !used.has(t.id))?.id ?? data.teachers[0]?.id ?? "",
  );
  const picked = data.teachers.find((t) => t.id === teacherId);
  const defaultMensaSubject = cls?.tempo === "TP" ? "Mensa" : "Altro";
  const [subject, setSubject] = useState(
    occupants[0]?.subject ?? (mensa ? defaultMensaSubject : picked ? defaultSubjectFor(picked) : "Italiano"),
  );

  function add() {
    if (!teacherId) return;
    if (isRestrictedTpPeriod(period) && cls?.tempo !== "TP") {
      toast.error("La 7ª e l’8ª ora sono riservate alle classi a tempo prolungato.");
      return;
    }
    const busy = teacherSlotAt(data, teacherId, editing.day, editing.periodId);
    if (busy && busy.classId !== editing.classId) {
      const other = data.classes.find((c) => c.id === busy.classId);
      toast.error(`Il docente è già in ${other?.name ?? "un’altra classe"} in quest’ora.`);
      return;
    }
    store.upsertSlot({
      day: editing.day,
      periodId: editing.periodId,
      classId: editing.classId,
      teacherId,
      subject,
    });
    toast.success(occupants.length ? "Compresenza aggiunta" : "Cella aggiornata");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {cls?.name} · {DAY_SHORT[editing.day]} · {period?.label}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {occupants.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {occupants.map((s, i) => {
                const t = data.teachers.find((x) => x.id === s.teacherId);
                return (
                  <li
                    key={s.id}
                    className="flex min-h-10 items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{t ? teacherName(t) : s.teacherId}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {s.subject}
                        {i > 0 ? " · compresenza" : ""}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => store.clearSlot(s.id)}>
                      Togli
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{occupants.length ? "Aggiungi in compresenza" : "Docente"}</Label>
            <NativeSelect
              value={teacherId}
              onChange={(e) => {
                const id = e.target.value;
                setTeacherId(id);
                const t = data.teachers.find((x) => x.id === id);
                if (t && !mensa) setSubject(defaultSubjectFor(t));
              }}
            >
              {data.teachers
                .slice()
                .sort((a, b) => a.lastName.localeCompare(b.lastName, "it"))
                .map((t) => (
                  <option key={t.id} value={t.id} disabled={used.has(t.id)}>
                    {teacherName(t)}
                    {t.role === "potenziamento" ? " (potenz.)" : t.role === "sostegno" ? " (sost.)" : ""}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Materia</Label>
            <SubjectSelect value={subject} onChange={setSubject} />
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" placeholder="O scrivi un nome" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Chiudi
            </Button>
            <Button onClick={add}>{occupants.length ? "Aggiungi" : "Salva"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeacherHourEditor({
  editing,
  onClose,
}: {
  editing: TeacherEdit;
  onClose: () => void;
}) {
  const store = useAppStore();
  const data = snapshot(store);
  const teacher = data.teachers.find((t) => t.id === editing.teacherId);
  const existing = teacherSlotAt(data, editing.teacherId, editing.day, editing.periodId);
  const period = data.settings.periods.find((p) => p.id === editing.periodId);
  const mensa = isMensaPeriod(period);
  const dispOn = Boolean(teacher && isDispHour(teacher, editing.day, editing.periodId));
  const classChoices = isRestrictedTpPeriod(period)
    ? data.classes.filter((c) => c.tempo === "TP")
    : data.classes;
  const pickedClass = data.classes.find((c) => c.id === (existing?.classId ?? classChoices[0]?.id ?? ""));
  const [classId, setClassId] = useState(
    existing?.classId ?? (teacher?.role === "potenziamento" ? "" : classChoices[0]?.id ?? ""),
  );
  const [subject, setSubject] = useState(
    existing?.subject ??
      (mensa
        ? pickedClass?.tempo === "TP"
          ? "Mensa"
          : "Altro"
        : teacher
          ? defaultSubjectFor(teacher)
          : "Italiano"),
  );

  const others = classId ? cellSlots(data, classId, editing.day, editing.periodId).filter((s) => s.teacherId !== editing.teacherId) : [];

  function save() {
    if (!teacher) return;
    if (!classId) {
      if (!dispOn) toggleDisp();
      else onClose();
      return;
    }
    const cls = data.classes.find((c) => c.id === classId);
    if (isRestrictedTpPeriod(period) && cls?.tempo !== "TP") {
      toast.error("La 7ª e l’8ª ora sono riservate alle classi a tempo prolungato.");
      return;
    }
    const busy = teacherSlotAt(data, editing.teacherId, editing.day, editing.periodId);
    if (busy && busy.classId !== classId) {
      store.clearSlot(busy.id);
    }
    store.upsertSlot({
      id: existing && existing.classId === classId ? existing.id : undefined,
      day: editing.day,
      periodId: editing.periodId,
      classId,
      teacherId: editing.teacherId,
      subject,
    });
    if (teacher && dispOn) {
      store.updateTeacher(teacher.id, {
        dispSlots: (teacher.dispSlots ?? []).filter(
          (a) => !(a.day === editing.day && a.periodId === editing.periodId),
        ),
      });
    }
    toast.success(others.length ? "Ora inserita in compresenza" : "Ora inserita");
    onClose();
  }

  function toggleDisp() {
    if (!teacher) return;
    if (existing) store.clearSlot(existing.id);
    const cur = teacher.dispSlots ?? [];
    const next = dispOn
      ? cur.filter((a) => !(a.day === editing.day && a.periodId === editing.periodId))
      : [...cur, { day: editing.day, periodId: editing.periodId }];
    store.updateTeacher(teacher.id, { dispSlots: next });
    toast.success(dispOn ? "Disposizione tolta" : "Ora a disposizione");
    onClose();
  }

  function remove() {
    if (existing) store.clearSlot(existing.id);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {teacher ? teacherName(teacher) : "Docente"} · {DAY_SHORT[editing.day]} · {period?.label}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Classe</Label>
            <NativeSelect value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Solo in sede (senza classe)</option>
              {classChoices
                .slice()
                .sort((a, b) => a.grade - b.grade || a.section.localeCompare(b.section))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.tempo})
                  </option>
                ))}
            </NativeSelect>
          </div>
          {others.length > 0 && (
            <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
              In quest’ora c’è già{" "}
              {others
                .map((s) => {
                  const t = data.teachers.find((x) => x.id === s.teacherId);
                  return t ? `${teacherShort(t, data.teachers)} (${s.subject})` : s.subject;
                })
                .join(", ")}
              . Verrà registrata come compresenza.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Materia / attività</Label>
            <SubjectSelect value={subject} onChange={setSubject} />
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" placeholder="O scrivi un nome" />
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {existing && (
              <Button variant="outline" onClick={remove}>
                Togli ora
              </Button>
            )}
            <Button variant="outline" onClick={toggleDisp}>
              {dispOn ? "Togli disposizione" : "A disposizione"}
            </Button>
            <Button onClick={save}>{classId ? "Salva lezione" : "Salva in sede"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
