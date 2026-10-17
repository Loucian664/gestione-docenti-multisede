import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { cycleTheme, formatScheduleHint, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/components/theme-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Automatico", icon: Monitor },
  { value: "light", label: "Chiaro", icon: Sun },
  { value: "dark", label: "Scuro", icon: Moon },
];

function optionHint(value: ThemePreference, scheduleFrom: string, scheduleUntil: string): string {
  if (value === "system") return formatScheduleHint({ from: scheduleFrom, until: scheduleUntil });
  if (value === "light") return "Carta e inchiostro, sempre";
  return "Notturno, a occhio riposato";
}

export function ThemeCycleButton({ className }: { className?: string }) {
  const { preference, resolved, setPreference, schedule } = useTheme();
  const next = cycleTheme(preference);
  const Icon = preference === "system" ? Monitor : preference === "light" ? Sun : Moon;
  const label =
    preference === "system"
      ? `Aspetto automatico (${resolved === "dark" ? "scuro" : "chiaro"}, ${formatScheduleHint(schedule).toLowerCase()}). Passa a chiaro`
      : preference === "light"
        ? "Aspetto chiaro. Passa a scuro"
        : "Aspetto scuro. Passa ad automatico";

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      className={cn(
        "flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-label={label}
      title={OPTIONS.find((o) => o.value === preference)?.label}
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { preference, resolved, schedule, setPreference, setSchedule } = useTheme();

  if (compact) {
    return (
      <div
        role="radiogroup"
        aria-label="Aspetto"
        className="grid grid-cols-3 gap-1 rounded-lg bg-white/8 p-1"
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = preference === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(opt.value)}
              className={cn(
                "flex h-9 items-center justify-center rounded-md text-sidebar-muted transition-colors duration-150",
                active
                  ? "bg-white/12 text-sidebar-foreground"
                  : "hover:bg-white/6 hover:text-sidebar-foreground",
              )}
              aria-label={opt.label}
              title={`${opt.label}. ${optionHint(opt.value, schedule.from, schedule.until)}`}
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-2">
      <div role="radiogroup" aria-label="Aspetto" className="grid gap-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = preference === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(opt.value)}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
                active
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {optionHint(opt.value, schedule.from, schedule.until)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {preference === "system" && (
        <div className="rounded-lg border border-border bg-card px-3 py-3">
          <p className="text-sm font-medium text-foreground">Orario dello scuro</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Alle ore di inizio passa allo scuro, alle ore di fine torna al chiaro. Funziona anche a mezzanotte.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="theme-dark-from">Inizio</Label>
              <Input
                id="theme-dark-from"
                type="time"
                className="h-10 text-center"
                value={schedule.from}
                onChange={(e) => setSchedule({ ...schedule, from: e.target.value })}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="theme-dark-until">Fine</Label>
              <Input
                id="theme-dark-until"
                type="time"
                className="h-10 text-center"
                value={schedule.until}
                onChange={(e) => setSchedule({ ...schedule, until: e.target.value })}
              />
            </div>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Adesso è {resolved === "dark" ? "scuro" : "chiaro"}.
          </p>
        </div>
      )}
    </div>
  );
}
