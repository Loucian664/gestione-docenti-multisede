import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppLayout } from "@/components/layout";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { useEffect, useRef } from "react";
import { Toaster, toast, useSonner } from "sonner";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import appCss from "../styles.css?url";

const APP_NAME = "Orario Generale";
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

export const Route = createRootRoute({
  head: () => {
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: APP_NAME },
        { name: "theme-color", content: "#1F4A3C" },
        { name: "color-scheme", content: "light dark" },
        {
          name: "description",
          content:
            "Orario delle sedi dell’istituto comprensivo — scuola secondaria di I grado.",
        },
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: asset("favicon.svg") },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: asset("manifest.webmanifest") },
        { rel: "apple-touch-icon", href: asset("icon-180.png") },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700&display=swap",
        },
      ],
    };
  },
  component: RootComponent,
});

/** Quanto resta un messaggio, in millisecondi (quelli con «Annulla» hanno la loro durata). */
const TOAST_MS = 4000;

/**
 * Chiude i messaggi anche se sonner li ha fermati: li ferma finché «ci si passa sopra» e su iPhone e iPad il tocco
 * può lasciarli fermi, così restavano finché non si toccava la X. Questo timer non si ferma mai.
 */
function ToastAutoClose() {
  const { toasts } = useSonner();
  const timers = useRef(new Map<string | number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    for (const t of toasts) {
      const ms = t.duration ?? TOAST_MS;
      if (timers.current.has(t.id) || t.type === "loading" || !Number.isFinite(ms)) continue;
      timers.current.set(
        t.id,
        setTimeout(() => toast.dismiss(t.id), ms + 1000),
      );
    }
  }, [toasts]);
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );
  return null;
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <>
      <Toaster position="bottom-right" richColors closeButton duration={TOAST_MS} theme={resolved} />
      <ToastAutoClose />
    </>
  );
}

function RootComponent() {
  return (
    <html lang="it" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <ThemeProvider>
          <AuthProvider>
            <AppLayout>
              <Outlet />
            </AppLayout>
            <ThemedToaster />
          </AuthProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
