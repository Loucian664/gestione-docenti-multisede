// Calcolo lungo dell'orario (vedi CLAUDE.md, «Calcolo lungo dell'orario»).
// Uso: node scripts/calcolo-lungo.mjs --backup <file.json> --sedi sede|tutte --modo da-zero|migliora --slot 3,4,5
//        --minuti 120 [--sostituisci 4] [--uscita <file.json>] [--corsa 120] [--processi 3]
// Compila il motore dell'app (src/lib) in un file solo e lo fa girare in più processi.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(mkdtempSync(join(tmpdir(), "calcolo-lungo-")), "calcolo-lungo.mjs");
await build({
  input: join(here, "calcolo-lungo-run.ts"),
  platform: "node",
  logLevel: "silent",
  output: { file, format: "esm" },
});
const run = await import(pathToFileURL(file).href);
await run.main(process.argv.slice(2), file);
