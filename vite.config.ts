import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Sito statico (GitHub Pages): un'app sola pagina, senza server. BASE_PATH è la cartella del sito
// (/gestione-docenti-multisede/ su GitHub, ./ per le anteprime).
export default defineConfig(() => {
  const pages = process.env.GITHUB_PAGES === "true";
  const base = pages ? process.env.BASE_PATH || "/gestione-docenti-multisede/" : "/";
  return {
    base,
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 8081,
      strictPort: true,
    },
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
  };
});
