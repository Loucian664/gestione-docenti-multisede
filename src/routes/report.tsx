import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useAppStore, snapshot } from "@/lib/store";
import { officialData } from "@/lib/saved-timetables";
import { withFormerTeachers } from "@/lib/replace-teacher";
import { loadByTeacher, absencesByReason, eccedenteLines, teacherShort } from "@/lib/coverage";
import { formatItDate, isoDate, monthRange, schoolYearRange } from "@/lib/dates";
import { archivedSedi, archivedYearData, archivedYearLabels } from "@/lib/school-years";
import { allSedi, sedeIdOf, sedeName } from "@/lib/sedi";
import { reportXlsx, eccedenteXlsx, eccedentePdf, schoolFileTag } from "@/lib/export";
import { shareOrSaveFile, shareJpeg, toastSave, openPdfTab } from "@/lib/share-file";
import { jpegBlobToPdf } from "@/lib/pdf";
import { reportJpeg } from "@/lib/sheet-image";
import { ABSENCE_REASONS } from "@/lib/types";
import { Download, Images as ImageIcon, FileText } from "lucide-react";
import { toast } from "sonner";

type ReportSearch = { anno?: string; dal?: string; al?: string };

const isIso = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);

export const Route = createFileRoute("/report")({
  component: ReportPage,
  // l'anno in archivio e il periodo restano scelti anche cambiando sede in alto (la pagina riparte)
  validateSearch: (raw: Record<string, unknown>): ReportSearch => ({
    anno: typeof raw.anno === "string" ? raw.anno : undefined,
    dal: isIso(raw.dal) ? raw.dal : undefined,
    al: isIso(raw.al) ? raw.al : undefined,
  }),
});

function ReportPage() {
  const store = useAppStore();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const now = snapshot(store);
  const several = allSedi(now).length > 1;
  const archived = store.archivedYears ?? [];
  const yearLabels = archivedYearLabels(archived);
  // nessun anno = l'anno in corso; altrimenti un anno in archivio, così com'era (solo da consultare), della sede in uso
  const year = archived.find((y) => y.id === search.anno);
  const yearData = year ? archivedYearData(year, sedeIdOf(now), sedeName(now.settings)) : null;
  // le sostituzioni fatte riguardano l'orario in vigore (slot 0); nei conteggi anche chi non è più in servizio
  const data =
    yearData ??
    (year
      ? // quell'anno la sede non c'era: niente da contare
        { ...officialData(now), absences: [], substitutions: [], formerTeachers: [] }
      : withFormerTeachers(officialData(now)));
  const initial = year
    ? schoolYearRange(year.schoolYear, isoDate(new Date(year.archivedAt)))
    : monthRange(data.selectedDate);
  const from = search.dal ?? initial.from;
  const to = search.al ?? initial.to;

  function go(next: ReportSearch) {
    void navigate({ to: "/report", search: next, replace: true });
  }
  const setFrom = (dal: string) => go({ ...search, dal });
  const setTo = (al: string) => go({ ...search, al });
  /** Un anno in archivio si apre con tutto l'anno; quello in corso con il mese. */
  function chooseYear(id: string) {
    go(archived.some((y) => y.id === id) ? { anno: id } : {});
  }

  const loads = useMemo(() => loadByTeacher(data, from, to), [data, from, to]);
  const absenceRows = useMemo(
    () => absencesByReason(data, from, to).filter((r) => r.total > 0),
    [data, from, to],
  );
  const withName = loads
    .map((row) => {
      const t = data.teachers.find((x) => x.id === row.teacherId);
      return { ...row, name: t ? teacherShort(t, data.teachers) : row.teacherId };
    })
    .filter((r) => r.total > 0);

  // «Chi ha coperto di più»: tutti quelli con almeno un'ora, dal valore più alto
  const chartData = [...withName]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "it"))
    .map((r) => ({
      id: r.teacherId,
      name: r.name,
      total: r.total,
      detail: `Disposizione ${r.disposizione} · Potenziamento ${r.potenziamento} · Eccedenti ${r.eccedente} · Altro ${r.recupero + r.sostegno + r.altro}`,
    }));
  const chartMax = Math.max(1, ...chartData.map((r) => r.total));

  const totals = loads.reduce(
    (acc, r) => ({
      disposizione: acc.disposizione + r.disposizione,
      eccedente: acc.eccedente + r.eccedente,
      total: acc.total + r.total,
    }),
    { disposizione: 0, eccedente: 0, total: 0 },
  );
  const absenceTotals = absenceRows.reduce(
    (acc, r) => {
      acc.days += r.total;
      acc.assemblea += r.byReason.assemblea_sindacale;
      return acc;
    },
    { days: 0, assemblea: 0 },
  );
  const yearRange = useMemo(
    () => schoolYearRange(data.settings.schoolYear, data.selectedDate),
    [data.settings.schoolYear, data.selectedDate],
  );
  const yearAbsenceRows = useMemo(
    () => absencesByReason(data, yearRange.from, yearRange.to).filter((r) => r.total > 0),
    [data, yearRange],
  );
  const yearLoads = useMemo(() => loadByTeacher(data, yearRange.from, yearRange.to), [data, yearRange]);
  const yearEccedenteLines = useMemo(
    () => eccedenteLines(data, yearRange.from, yearRange.to),
    [data, yearRange],
  );
  const yearEccedenti = yearLoads.reduce((n, r) => n + r.eccedente, 0);
  const yearStatCards = [
    ...ABSENCE_REASONS.map((reason) => ({
      key: reason.value,
      label: REASON_CARD[reason.value] ?? reason.label,
      value: yearAbsenceRows.reduce((n, row) => n + (row.byReason[reason.value] ?? 0), 0),
    })),
    { key: "eccedenti", label: "Ore eccedenti", value: yearEccedenti },
  ].filter((card) => card.value > 0);

  return (
    <div>
      <PageHeader
        title="Equità e monte ore"
        description="Sostituzioni svolte da ciascun docente e assenze del periodo selezionato. In fondo, il riepilogo dell’anno scolastico."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                void shareOrSaveFile(reportXlsx(data, from, to, loads)).then((outcome) =>
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
                    const blob = await reportJpeg(data, from, to);
                    toastSave(await shareJpeg(`report-${from}-${to}.jpg`, blob), "image");
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
                    const blob = await reportJpeg(data, from, to);
                    const pdf = await jpegBlobToPdf(blob);
                    toastSave(tab.show(`report-${from}-${to}.pdf`, pdf), "pdf");
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

      <div className="mb-5 flex min-w-0 flex-wrap items-end gap-3">
        {archived.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="year">Anno scolastico</Label>
            <NativeSelect id="year" className="w-48" value={year?.id ?? ""} onChange={(e) => chooseYear(e.target.value)}>
              <option value="">{store.settings.schoolYear} (in corso)</option>
              {[...archived].reverse().map((y) => (
                <option key={y.id} value={y.id}>
                  {yearLabels.get(y.id)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="from">Dal</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="to">Al</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {year && (
        <p className="mb-5 rounded-md bg-muted px-3 py-2 text-[13px] leading-snug">
          {yearData
            ? `Anno in archivio dal ${formatItDate(isoDate(new Date(year.archivedAt)))}: docenti, classi e orario${
                several ? ` di ${sedeName(data.settings)}` : ""
              } sono quelli di allora. Si consulta e si esporta, non si modifica.${
                several ? " Per un’altra sede, sceglila in alto: l’anno resta questo." : ""
              }`
            : `Nell’anno ${yearLabels.get(year.id)} ${sedeName(now.settings)} non c’era. In archivio ci sono: ${archivedSedi(year)
                .map((x) => x.name)
                .join(", ")}; scegli una di queste sedi in alto.`}
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Ore coperte" value={totals.total} />
        <MiniStat label="A disposizione" value={totals.disposizione} />
        <MiniStat label="Eccedenti" value={totals.eccedente} />
        <MiniStat label="Assemblee sindacali" value={absenceTotals.assemblea} />
      </div>

      {chartData.length > 0 && (
        <div className="paper-panel mb-5 rounded-xl p-4">
          <h2 className="mb-3 font-display text-lg">Chi ha coperto di più</h2>
          <ul className="flex flex-col gap-1.5" aria-label="Ore di copertura per docente">
            {chartData.map((r) => (
              <li
                key={r.id}
                title={`${r.name}: ${r.total} ${r.total === 1 ? "ora" : "ore"} · ${r.detail}`}
                className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-3 text-[13px]"
              >
                <span className="truncate text-muted-foreground">{r.name}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-4 shrink-0 rounded-r-[4px] bg-primary"
                    style={{ width: `calc((100% - 2.5rem) * ${r.total / chartMax})` }}
                    aria-hidden
                  />
                  <span className="font-medium tabular-nums text-foreground">{r.total}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="paper-panel overflow-x-auto rounded-xl">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="px-4 py-2 font-medium">Docente</th>
              <th className="px-3 py-2 font-medium">Disp.</th>
              <th className="px-3 py-2 font-medium">Potenz.</th>
              <th className="px-3 py-2 font-medium">Recupero</th>
              <th className="px-3 py-2 font-medium">Eccedenti</th>
              <th className="px-3 py-2 font-medium">Sostegno</th>
              <th className="px-3 py-2 font-medium">Altro</th>
              <th className="px-3 py-2 font-medium">Totale</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((row) => {
              const t = data.teachers.find((x) => x.id === row.teacherId);
              if (!t) return null;
              return (
                <tr key={row.teacherId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium">
                    {t.lastName} {t.firstName}
                  </td>
                  <Cell n={row.disposizione} />
                  <Cell n={row.potenziamento} />
                  <Cell n={row.recupero} />
                  <Cell n={row.eccedente} warn />
                  <Cell n={row.sostegno} />
                  <Cell n={row.altro} />
                  <td className={row.total ? "px-3 py-2.5 tabular-nums font-semibold" : "px-3 py-2.5 tabular-nums text-muted-foreground/55"}>{row.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-3 font-display text-lg">Assenze per motivo</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Valori in giorni di scuola; per i permessi brevi si contano i giorni, non le ore.
      </p>
      <div className="paper-panel overflow-x-auto rounded-xl">
        {absenceRows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nessuna assenza in questo periodo.</p>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">Docente</th>
                {ABSENCE_REASONS.map((r) => (
                  <th key={r.value} className="px-3 py-2 font-medium">
                    {REASON_COL[r.value] ?? r.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Totale</th>
              </tr>
            </thead>
            <tbody>
              {absenceRows.map((row) => {
                const t = data.teachers.find((x) => x.id === row.teacherId);
                if (!t) return null;
                return (
                  <tr key={row.teacherId} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {t.lastName} {t.firstName}
                    </td>
                    {ABSENCE_REASONS.map((r) => (
                      <Cell key={r.value} n={row.byReason[r.value]} />
                    ))}
                    <td className={row.total ? "px-3 py-2.5 tabular-nums font-semibold" : "px-3 py-2.5 tabular-nums text-muted-foreground/55"}>{row.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mb-1 font-display text-lg">Ore eccedenti</h2>
          <p className="text-sm text-muted-foreground">
            Anno scolastico {data.settings.schoolYear}: per ogni ora eccedente, docente, classe e orario.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void shareOrSaveFile(eccedenteXlsx(data, yearRange.from, yearRange.to)).then((outcome) =>
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
              const tab = openPdfTab();
              void (async () => {
                try {
                  const blob = await eccedentePdf(data, yearRange.from, yearRange.to);
                  const name = `ore-eccedenti-${schoolFileTag(data.settings.schoolName)}.pdf`;
                  toastSave(tab.show(name, blob), "pdf");
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
        </div>
      </div>
      <div className="paper-panel overflow-x-auto rounded-xl">
        {yearEccedenteLines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nessuna ora eccedente in questo anno.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Docente</th>
                <th className="px-3 py-2 font-medium">Classe</th>
                <th className="px-3 py-2 font-medium">Ora</th>
                <th className="px-3 py-2 font-medium">Dalle</th>
                <th className="px-3 py-2 font-medium">Alle</th>
              </tr>
            </thead>
            <tbody>
              {yearEccedenteLines.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 tabular-nums">{formatItDate(row.date)}</td>
                  <td className="px-3 py-2.5 font-medium">{row.teacher}</td>
                  <td className="px-3 py-2.5">{row.className}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.hour}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.from}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="mt-8 mb-1 font-display text-lg">Anno scolastico {data.settings.schoolYear}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Dal {formatItDate(yearRange.from)} al {formatItDate(yearRange.to)}, indipendentemente dal periodo selezionato sopra.
      </p>
      {yearStatCards.length === 0 ? (
        <p className="mb-5 text-sm text-muted-foreground">
          Nessuna assenza né ora eccedente in anagrafe per quest’anno.
        </p>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {yearStatCards.map((card) => (
            <MiniStat key={card.key} label={card.label} value={card.value} />
          ))}
        </div>
      )}
      <div className="paper-panel overflow-x-auto rounded-xl">
        {yearAbsenceRows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nessuna assenza registrata in questo anno.</p>
        ) : (
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">Docente</th>
                {ABSENCE_REASONS.map((r) => (
                  <th key={r.value} className="px-3 py-2 font-medium">
                    {REASON_COL[r.value] ?? r.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Totale</th>
              </tr>
            </thead>
            <tbody>
              {yearAbsenceRows.map((row) => {
                const t = data.teachers.find((x) => x.id === row.teacherId);
                if (!t) return null;
                return (
                  <tr key={row.teacherId} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {t.lastName} {t.firstName}
                    </td>
                    {ABSENCE_REASONS.map((r) => (
                      <Cell key={r.value} n={row.byReason[r.value]} />
                    ))}
                    <td className={row.total ? "px-3 py-2.5 tabular-nums font-semibold" : "px-3 py-2.5 tabular-nums text-muted-foreground/55"}>{row.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const REASON_COL: Record<string, string> = {
  malattia: "Malattia",
  permesso: "Perm. pers.",
  l104: "L.104",
  formazione: "Formaz.",
  assemblea_sindacale: "Assemblea",
  visita: "Visita",
  permesso_breve: "P. breve",
  altro: "Altro",
};

const REASON_CARD: Record<string, string> = {
  malattia: "Malattia",
  permesso: "Permesso personale",
  l104: "L.104",
  formazione: "Formazione",
  assemblea_sindacale: "Assemblea sindacale",
  visita: "Visita medica",
  permesso_breve: "Permesso breve",
  altro: "Altro",
};

function Cell({ n, warn }: { n: number; warn?: boolean }) {
  // «—» (zero) attenuato: risaltano i numeri veri
  return (
    <td
      className={
        n === 0
          ? "px-3 py-2.5 tabular-nums text-muted-foreground/55"
          : warn
            ? "px-3 py-2.5 tabular-nums text-warning"
            : "px-3 py-2.5 tabular-nums text-foreground"
      }
    >
      {n || "—"}
    </td>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="paper-panel rounded-xl px-4 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}
