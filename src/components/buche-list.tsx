export function BucheList({
  rows,
  className,
}: {
  rows: { id: string; name: string; gaps: number }[];
  className?: string;
}) {
  const withGaps = rows.filter((r) => r.gaps > 0);
  const zero = rows.length - withGaps.length;
  if (rows.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-sm font-medium">Ore buche per docente</p>
      {withGaps.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nessuna buca.</p>
      ) : (
        <ul className="mt-2 columns-1 gap-x-8 sm:columns-2 text-sm">
          {withGaps.map((r) => (
            <li key={r.id} className="mb-1 flex justify-between gap-4 break-inside-avoid">
              <span>{r.name}</span>
              <span className="tabular-nums text-muted-foreground">{r.gaps}</span>
            </li>
          ))}
        </ul>
      )}
      {zero > 0 && withGaps.length > 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">Gli altri: 0</p>
      ) : null}
    </div>
  );
}
