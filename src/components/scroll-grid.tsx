import { useEffect, useRef, useState, type ReactNode } from "react";

type View = { first: number; last: number; total: number; overflow: boolean; more: boolean; scrolled: boolean };

/**
 * Contenitore delle griglie dell'orario che scorrono di lato.
 * Sotto i 768 px dice quali colonne si vedono («Classi 1–2 di 6») e sfuma il bordo destro se c'è altro.
 * La prima colonna resta ferma (sticky nella tabella) e prende un'ombra leggera appena si scorre.
 */
export function ScrollGrid({
  unit,
  children,
}: {
  /** singolare e plurale: ["Classe", "Classi"], ["Giorno", "Giorni"] */
  unit: [string, string];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const heads = Array.from(el.querySelectorAll<HTMLElement>("thead tr:first-child > th"));
      const box = el.getBoundingClientRect();
      const left = box.left + (heads[0]?.getBoundingClientRect().width ?? 0);
      const cols = heads.slice(1);
      const seen = cols.flatMap((h, i) => {
        const r = h.getBoundingClientRect();
        const w = Math.min(r.right, box.right) - Math.max(r.left, left);
        return w >= r.width * 0.6 ? [i] : [];
      });
      const next: View = {
        first: (seen[0] ?? 0) + 1,
        last: (seen[seen.length - 1] ?? 0) + 1,
        total: cols.length,
        overflow: el.scrollWidth > el.clientWidth + 1,
        more: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
        scrolled: el.scrollLeft > 0,
      };
      setView((prev) =>
        prev &&
        prev.first === next.first &&
        prev.last === next.last &&
        prev.total === next.total &&
        prev.overflow === next.overflow &&
        prev.more === next.more &&
        prev.scrolled === next.scrolled
          ? prev
          : next,
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div>
      {view?.overflow && (
        <p className="mb-1.5 text-[12px] text-muted-foreground tabular-nums md:hidden">
          {view.first === view.last
            ? `${unit[0]} ${view.first} di ${view.total}`
            : `${unit[1]} ${view.first}–${view.last} di ${view.total}`}
        </p>
      )}
      <div className="relative">
        <div
          ref={ref}
          data-scrolled={view?.scrolled ? "true" : undefined}
          className="group paper-panel overflow-x-auto rounded-xl"
        >
          {children}
        </div>
        {view?.more && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-xl bg-gradient-to-l from-card to-transparent md:hidden"
          />
        )}
      </div>
    </div>
  );
}
