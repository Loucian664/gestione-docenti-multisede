import { Input } from "@/components/ui/input";
import { ensureTpPeriods } from "@/lib/periods";
import type { DayOfWeek, Period, Settings } from "@/lib/types";

/** Orari delle lezioni di una sede, fascia pomeridiana e sabato (prima stava in Impostazioni). */
export function CampanellaEditor({
  settings,
  onChange,
}: {
  settings: Pick<Settings, "periods" | "tpAfternoon" | "days">;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const setPeriod = (i: number, patch: Partial<Period>) =>
    onChange({ periods: settings.periods.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) });

  const row = (p: Period) => {
    const i = settings.periods.findIndex((x) => x.id === p.id);
    return (
      <li key={p.id} className="grid min-w-0 grid-cols-[1fr_5.5rem_5.5rem] gap-2">
        <Input value={p.label} onChange={(e) => setPeriod(i, { label: e.target.value })} aria-label="Nome dell'ora" />
        <Input type="time" value={p.start} onChange={(e) => setPeriod(i, { start: e.target.value })} aria-label="Inizio" />
        <Input type="time" value={p.end} onChange={(e) => setPeriod(i, { end: e.target.value })} aria-label="Fine" />
      </li>
    );
  };

  return (
    <div>
      <ul className="flex flex-col gap-2">{settings.periods.filter((p) => !p.tpOnly).map(row)}</ul>
      <label className="mt-4 flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={Boolean(settings.tpAfternoon)}
          onChange={(e) => {
            const on = e.target.checked;
            onChange({ tpAfternoon: on, periods: on ? ensureTpPeriods(settings.periods) : settings.periods });
          }}
        />
        Fascia pomeridiana: ore 14:00 per tutte le classi (mensa o lezione); 7ª e 8ª ora solo per il tempo prolungato.
      </label>
      {settings.tpAfternoon && (
        <ul className="mt-3 flex flex-col gap-2">{settings.periods.filter((p) => p.tpOnly).map(row)}</ul>
      )}
      <label className="mt-4 flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={settings.days.includes(6)}
          onChange={(e) => {
            const days: DayOfWeek[] = e.target.checked ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
            onChange({ days });
          }}
        />
        Includi il sabato
      </label>
    </div>
  );
}
