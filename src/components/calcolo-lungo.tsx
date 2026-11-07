import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Copy, FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { snapshot, useAppStore } from "@/lib/store";
import { backupJson } from "@/lib/export";
import { shareOrSaveFile, toastSave } from "@/lib/share-file";
import { todayIso } from "@/lib/dates";
import { activeSlotOf, SAVE_SLOTS } from "@/lib/saved-timetables";
import {
  durationText,
  LONG_RUN_MINUTES,
  longRunMessage,
  occupiedSlots,
  requestProblems,
  type LongRunRequest,
} from "@/lib/calcolo-lungo";
import type { SolveMode } from "@/lib/timetable-solver";
import { cn } from "@/lib/utils";
import { allSedi, sedeAsData, sedeName } from "@/lib/sedi";
import { canBuildTogether } from "@/lib/sedi-insieme";
import { builtLessonTest } from "@/lib/svuota";

/** La repository di questa app: l'assistente la apre e vi trova il programma e le istruzioni (CALCOLO-LUNGO.md). */
const REPOSITORY = "Loucian664/gestione-docenti-multisede";

/**
 * «Calcolo lungo con un assistente di programmazione»: si scelgono partenza, slot e durata; «Prepara» esporta il backup
 * e copia il messaggio da incollare in Claude Code (o in un altro assistente che possa aprire la repository ed eseguire
 * programmi), che fa girare lo stesso motore per molto più tempo e restituisce il backup con le versioni negli slot scelti.
 */
export function CalcoloLungo() {
  const store = useAppStore();
  const data = snapshot(store);
  const sedi = allSedi(data);
  const together = useMemo(() => canBuildTogether(data), [data]);
  const [scopePick, setScope] = useState<LongRunRequest["scope"]>("sede");
  const scope = sedi.length > 1 && together.ok ? scopePick : "sede";
  const taken = useMemo(() => occupiedSlots(data, scope), [data, scope]);
  // slot in uso nell'app: nella sede in uso o, con tutte le sedi, in una qualunque
  const inUse = new Set(
    (scope === "tutte" ? sedi : sedi.filter((x) => x.active)).map((x) => activeSlotOf(sedeAsData(data, x.data))),
  );
  const canImprove = (scope === "tutte" ? sedi : sedi.filter((x) => x.active)).some((x) =>
    x.data.slots.some(builtLessonTest(x.data)),
  );
  const [mode, setMode] = useState<SolveMode>("scratch");
  const [minutes, setMinutes] = useState<number>(60);
  // all'inizio: gli slot liberi; quelli occupati si spuntano a mano (e si sostituiscono)
  const [picked, setPicked] = useState<number[] | null>(null);
  const chosen = (picked ?? SAVE_SLOTS.filter((n) => !taken.has(n))).filter((n) => !inUse.has(n));
  const [message, setMessage] = useState<string | null>(null);

  const effectiveMode: SolveMode = canImprove ? mode : "scratch";
  const request: LongRunRequest = {
    mode: effectiveMode,
    slots: [...chosen].sort((a, b) => a - b),
    replace: chosen.filter((n) => taken.has(n)),
    minutes,
    scope,
  };
  const problems = requestProblems(data, request);

  function toggle(n: number) {
    setMessage(null);
    setPicked(chosen.includes(n) ? chosen.filter((x) => x !== n) : [...chosen, n]);
  }

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function prepare() {
    if (problems.length) return;
    const name = `gestione-docenti-backup-${todayIso()}.json`;
    const text = longRunMessage(data, request, REPOSITORY, name);
    setMessage(text);
    // prima il messaggio negli appunti (serve il tocco), poi il backup
    void copy(text).then((ok) => {
      if (ok) toast.success("Messaggio copiato: incollalo nell’assistente");
    });
    // il file, mai negli appunti: lì c'è il messaggio
    const file = new File([backupJson(data)], name, { type: "application/json" });
    void shareOrSaveFile(file).then((outcome) =>
      outcome === "failed" ? toast.error("Backup non salvato: tocca di nuovo «Prepara».") : toastSave(outcome, "backup"),
    );
  }

  return (
    <details className="group paper-panel rounded-xl p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <h2 className="font-display text-lg">Calcolo lungo con un assistente di programmazione</h2>
        <ChevronDown
          className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        «Proponi orario» cerca al massimo 35 secondi. Con un assistente di programmazione (oggi Claude Code; va bene
        anche un altro che possa aprire la repository ed eseguire programmi) lo stesso motore cerca fino a un’ora e
        mezza e restituisce più versioni, le migliori e diverse tra loro, negli slot che scegli. L’orario in vigore e gli
        slot non scelti restano come sono.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {sedi.length > 1 && (
          <Field label="Che cosa calcolare">
            <Choice
              label="Che cosa calcolare"
              value={scope}
              onChange={(v) => {
                setScope(v);
                setPicked(null);
                setMessage(null);
              }}
              options={[
                { value: "sede", label: `Solo ${sedeName(data.settings)}` },
                { value: "tutte", label: "Tutte le sedi insieme", disabled: !together.ok },
              ]}
            />
            {!together.ok && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Tutte le sedi insieme non si può: {together.reason}
              </p>
            )}
            {scope === "tutte" && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Le versioni, una per slot, sono quelle di «Tutte le sedi insieme»: equilibrato, giorni in un plesso,
                meno ore buche. Vanno nello stesso slot di ogni sede.
              </p>
            )}
          </Field>
        )}
        <Field label="Punto di partenza">
          <Choice
            label="Punto di partenza"
            value={effectiveMode}
            onChange={(v) => {
              setMode(v);
              setMessage(null);
            }}
            options={[
              { value: "scratch", label: "Da zero" },
              { value: "improve", label: "Migliora l’attuale", disabled: !canImprove },
            ]}
          />
        </Field>

        <Field label="Slot per le versioni (una per slot)">
          <div className="flex flex-col gap-1">
            {SAVE_SLOTS.map((n) => {
              const used = inUse.has(n);
              const name = taken.get(n);
              return (
                <label
                  key={n}
                  className={cn(
                    "flex min-h-10 items-center gap-3 text-sm",
                    used ? "text-muted-foreground" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={chosen.includes(n)}
                    disabled={used}
                    onChange={() => toggle(n)}
                  />
                  <span>
                    <span className="font-medium text-foreground">Slot {n}</span>
                    {" · "}
                    {used ? "in uso nell’app, non si tocca" : name ? `«${name}»` : "libero"}
                    {!used && name && chosen.includes(n) && <span className="text-warning"> · si sostituisce</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <Field label="Durata del calcolo">
          <Choice
            label="Durata del calcolo"
            value={String(minutes)}
            onChange={(v) => {
              setMinutes(Number(v));
              setMessage(null);
            }}
            options={LONG_RUN_MINUTES.map((m) => ({ value: String(m), label: durationText(m) }))}
          />
        </Field>
      </div>

      {problems.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[13px] text-warning">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={prepare} disabled={problems.length > 0}>
          <FileDown aria-hidden />
          Prepara backup e messaggio
        </Button>
      </div>

      {message && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-foreground">Messaggio da incollare</p>
          <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-[13px] leading-snug">{message}</pre>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => {
              void copy(message).then((ok) =>
                ok ? toast.success("Messaggio copiato") : toast.error("Copia non riuscita: selezionalo e copialo a mano"),
              );
            }}
          >
            <Copy aria-hidden />
            Copia messaggio
          </Button>
        </div>
      )}

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>«Prepara» salva il backup e copia il messaggio.</li>
        <li>
          Apri l’assistente (Claude Code: claude.ai/code, o l’app Claude → Code), incolla il messaggio e allega il
          backup. Il messaggio contiene già l’indirizzo della repository {REPOSITORY} e il comando da eseguire.
        </li>
        <li>
          Finché il calcolo non è finito, non segnare assenze né sostituzioni: il backup che torna sostituisce i dati di
          questo dispositivo.
        </li>
        <li>Importa il backup che ricevi: Impostazioni → Importa backup.</li>
        <li>
          Importando, l’app controlla che le versioni siano proprio quelle calcolate dal programma. Poi aprile dagli
          slot, confrontale e usa quella che preferisci.
        </li>
      </ol>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
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
