import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppLayout } from "@/components/layout";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Toaster } from "sonner";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import appCss from "../styles.css?url";

const APP_NAME = "Gestione Docenti";
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
            "Strumento personale per le sostituzioni — responsabile di plesso, scuola secondaria di I grado.",
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

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster position="bottom-right" richColors closeButton theme={resolved} />;
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
