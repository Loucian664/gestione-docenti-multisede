import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_SHOWN = 5;
/** Altezza di una riga dell'elenco (h-10) e del suo bordo interno (p-1). */
const ROW = 40;
const PAD = 8;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Antenato che taglia il contenuto (per esempio il corpo di una finestra): l'elenco deve restarci dentro. */
function clipParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") return p;
  }
  return null;
}

/**
 * Casella con le materie scelte come etichette: mentre si scrive, sotto (o sopra, se sotto non c'è posto, per
 * esempio con la tastiera aperta) compaiono le materie che contengono quelle lettere. Il tasto di cancellazione,
 * a casella vuota, toglie l'ultima.
 */
export function SubjectPicker({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = fold(text.trim());
    if (!q) return [];
    const chosen = new Set(value.map(fold));
    return options
      .filter((s) => !chosen.has(fold(s)) && fold(s).includes(q))
      .sort((a, b) => Number(!fold(a).startsWith(q)) - Number(!fold(b).startsWith(q)) || a.localeCompare(b, "it"))
      .slice(0, MAX_SHOWN);
  }, [text, value, options]);
  const open = focused && shown.length > 0;
  const current = Math.min(active, Math.max(0, shown.length - 1));

  // sotto o sopra la casella: dove c'è più posto visibile, tenendo conto della tastiera e dei bordi della finestra
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const box = boxRef.current;
      if (!box) return;
      const r = box.getBoundingClientRect();
      const vv = window.visualViewport;
      let top = (vv?.offsetTop ?? 0) + 8;
      let bottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight);
      // barre fisse in basso (le schede sul telefono) coprono l'elenco
      for (const bar of document.querySelectorAll<HTMLElement>(".fixed.bottom-0")) {
        const b = bar.getBoundingClientRect();
        if (b.height > 0 && getComputedStyle(bar).display !== "none") bottom = Math.min(bottom, b.top);
      }
      const clip = clipParent(box);
      if (clip) {
        const c = clip.getBoundingClientRect();
        top = Math.max(top, c.top);
        bottom = Math.min(bottom, c.bottom);
      }
      const need = shown.length * ROW + PAD + 6;
      const below = bottom - r.bottom;
      const above = r.top - top;
      setUp(below < need && above > below);
    }
    place();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    return () => {
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open, shown.length]);

  useEffect(() => setActive(0), [text]);

  function pick(subject: string) {
    onChange([...value, subject]);
    setText("");
    inputRef.current?.focus();
  }

  return (
    <div className="relative min-w-0">
      <div
        ref={boxRef}
        className="flex min-h-10 w-full min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-1.5 py-[5px] shadow-sm transition-[box-shadow,border-color] duration-150 focus-within:ring-2 focus-within:ring-ring/30"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {value.map((subject) => (
          <span
            key={subject}
            className="inline-flex h-7 items-center rounded-full bg-accent px-2.5 text-sm leading-none font-medium text-accent-foreground [@media(pointer:coarse)]:text-base"
          >
            {subject}
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open ? `${id}-opt-${current}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          value={text}
          placeholder={value.length ? "" : "Scrivi una materia"}
          className="h-7 min-w-20 flex-1 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-ink-faint"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && open) {
              e.preventDefault();
              setActive((current + 1) % shown.length);
            } else if (e.key === "ArrowUp" && open) {
              e.preventDefault();
              setActive((current - 1 + shown.length) % shown.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open) pick(shown[current]!);
            } else if (e.key === "Escape" && text) {
              e.preventDefault();
              setText("");
            } else if ((e.key === "Backspace" || e.key === "Delete") && text === "" && value.length > 0) {
              e.preventDefault();
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className={cn(
            "absolute inset-x-0 z-30 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-border-hover",
            up ? "bottom-full mb-1" : "top-full mt-1",
          )}
          onPointerDown={(e) => e.preventDefault()}
        >
          {shown.map((subject, i) => {
            const q = fold(text.trim());
            const at = fold(subject).indexOf(q);
            return (
              <li
                key={subject}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === current}
                className={cn(
                  "flex h-10 cursor-pointer items-center rounded-sm px-2.5 text-sm",
                  i === current && "bg-accent text-accent-foreground",
                )}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(subject)}
              >
                <span className="truncate">
                  {subject.slice(0, at)}
                  <span className="font-semibold">{subject.slice(at, at + q.length)}</span>
                  {subject.slice(at + q.length)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
