import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

function Notice({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={
        "flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-background text-foreground"
      }
    >
      <span className="text-destructive" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-md text-sm break-words text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const detail = error instanceof Error ? error.message : "";
  return (
    <Notice
      title="Qualcosa non ha funzionato"
      text="I dati salvati non sono stati toccati. Ricarica la pagina; se il problema resta, esporta un backup da Impostazioni."
    >
      {detail && <p className="max-w-md text-xs break-words text-ink-faint">Dettaglio: {detail}</p>}
      <Button variant="outline" onClick={() => window.location.reload()}>
        Ricarica la pagina
      </Button>
    </Notice>
  );
}

export function AppNotFoundComponent() {
  return (
    <Notice title="Pagina non trovata" text="Questo indirizzo non corrisponde a nessuna pagina dell’app.">
      <Button variant="outline" asChild>
        <Link to="/">Vai a Oggi</Link>
      </Button>
    </Notice>
  );
}
