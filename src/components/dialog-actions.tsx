import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** I pulsanti del piede di un dialogo: della stessa misura, con il testo che va a capo invece di uscire. */
const CELL =
  "[&>*]:h-auto [&>*]:min-h-11 [&>*]:w-full [&>*]:whitespace-normal [&>*]:px-2 [&>*]:py-1.5 [&>*]:text-center [&>*]:leading-tight";

/**
 * Il piede dei dialoghi, uguale dappertutto. Con una sola alternativa («Annulla» e l'azione) due colonne uguali;
 * con due o tre alternative, queste della stessa misura sulla stessa riga e l'azione principale sotto, a tutta
 * larghezza. Le alternative sono i figli, l'azione principale è `primary` (se manca, resta solo il figlio).
 */
export function DialogActions({
  primary,
  children,
  className,
}: {
  primary?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const n = Children.toArray(children).length;
  if (n <= 1) {
    return (
      <div className={cn("grid gap-2", n === 1 && primary ? "grid-cols-2" : "grid-cols-1", CELL, className)}>
        {children}
        {primary}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className={cn("grid gap-2", n === 2 ? "grid-cols-2" : "grid-cols-3", CELL)}>{children}</div>
      {primary && <div className={CELL}>{primary}</div>}
    </div>
  );
}
