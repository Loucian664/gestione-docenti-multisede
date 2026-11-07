// Calcolo lungo dell'orario (istruzioni: CALCOLO-LUNGO.md).
// Uso: node scripts/calcolo-lungo.mjs --backup <file.json> --sedi sede|tutte --modo da-zero|migliora --slot 3,4,5
//        --minuti 60 [--sostituisci 4] [--uscita <file.json>] [--corsa 120] [--processi 3] [--salva-ogni 5]
// Il file di uscita si scrive ogni 5 minuti e quando il programma viene fermato (le versioni migliori trovate finora).
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
