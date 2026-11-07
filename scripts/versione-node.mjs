// Calcolo lungo: controlla che la versione di Node vada bene prima di partire. Il minimo è in package.json, alla voce
// «engines» (lo chiedono i programmi che compilano il motore): così il messaggio dell'app non deve citare versioni.
import { readFileSync } from "node:fs";

/**
 * true se la versione (per esempio "22.12.0") rientra nell'intervallo ("^20.19.0 || >=22.12.0"); null se
 * l'intervallo ha un formato che qui non si sa leggere (allora non si blocca nulla).
 */
export function nodeVersionOk(version, range) {
  const num = (s) => s.split(".").map((x) => parseInt(x, 10) || 0);
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  const v = num(version.replace(/^v/, ""));
  let known = false;
  for (const part of range.split("||").map((p) => p.trim())) {
    const m = /^(\^|>=)\s*(\d+(?:\.\d+){0,2})$/.exec(part);
    if (!m) return null;
    known = true;
    const min = num(m[2]);
    if (cmp(v, min) >= 0 && (m[1] === ">=" || v[0] === min[0])) return true;
  }
  return known ? false : null;
}

/** Se la versione di Node non va bene, lo dice in chiaro ed esce. */
export function checkNode(packageJson) {
  let range;
  try {
    range = JSON.parse(readFileSync(packageJson, "utf8")).engines?.node;
  } catch {
    return;
  }
  if (!range || nodeVersionOk(process.versions.node, range) !== false) return;
  console.error(
    `Questa versione di Node (${process.versions.node}) non va bene per il calcolo lungo: serve ${range} ` +
      "(package.json, voce «engines»). Installa una versione adatta, per esempio con nvm, e riprova; " +
      "non aggiornare le dipendenze e non modificare il codice.",
  );
  process.exit(1);
}
