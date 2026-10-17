import { useState } from "react";
import { ACTIVITY_SUBJECTS, CURRICULAR_SUBJECTS, SUBJECTS } from "@/lib/types";
import { cn } from "@/lib/utils";

const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" fill="none"><path d="M1 1.5 6 6.5 11 1.5" stroke="%236b6458" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')}")`;

export function SubjectSelect({
  value,
  onChange,
  placeholder = "Materia",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const extra = value && !SUBJECTS.includes(value) ? [value] : [];

  function pick(s: string) {
    onChange(s);
    setOpen(false);
  }

  return (
    <div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full min-w-0 items-center rounded-md border border-input bg-card bg-[length:12px] bg-[right_12px_center] bg-no-repeat px-3 pr-9 text-left text-base text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-10 sm:text-sm"
        style={{ backgroundImage: CHEVRON }}
      >
        <span className={cn("min-w-0 flex-1 overflow-visible whitespace-normal break-words leading-tight", !value && "text-ink-faint")}>
          {value || placeholder}
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          className="mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 shadow-border"
        >
          {CURRICULAR_SUBJECTS.map((s) => (
            <SubjectOption key={s} label={s} active={s === value} onPick={pick} />
          ))}
          <div className="my-1 border-t border-border" />
          {ACTIVITY_SUBJECTS.map((s) => (
            <SubjectOption key={s} label={s} active={s === value} onPick={pick} />
          ))}
          {extra.map((s) => (
            <SubjectOption key={s} label={s} active={s === value} onPick={pick} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubjectOption({
  label,
  active,
  onPick,
}: {
  label: string;
  active: boolean;
  onPick: (s: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onPick(label)}
      className={cn(
        "flex min-h-11 w-full items-center rounded-md px-3 text-left text-base leading-snug sm:min-h-10 sm:text-sm",
        active ? "bg-accent font-medium text-accent-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
