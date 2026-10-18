import type { CSSProperties } from "react";
import type { Teacher } from "./types";

export type PastelHue = {
  name: string;
  tones: readonly [string, string, string, string];
  dot: string;
};

/**
 * «Colore in orario»: 12 tinte × 4 intensità (tenue, medio, deciso, vivace); il pallino è la tinta piena.
 * Il vivace serve a far risaltare un docente: non si dà mai in automatico.
 */
export const TEACHER_PALETTE: readonly PastelHue[] = [
  { name: "Salvia", tones: ["#E9F1EC", "#D9E8DE", "#C9DED0", "#93DAAE"], dot: "#3C8655" },
  { name: "Acqua", tones: ["#E9F2F1", "#D8E8E6", "#C8DFDC", "#78DCD3"], dot: "#3A887D" },
  { name: "Celeste", tones: ["#E7F0F3", "#D5E5E9", "#C4DBE1", "#78D7ED"], dot: "#247A8B" },
  { name: "Azzurro", tones: ["#E7EEF4", "#D5E2EB", "#C4D6E3", "#8BD1FE"], dot: "#306991" },
  { name: "Pervinca", tones: ["#E7EBF4", "#D6DDEC", "#C5CFE5", "#AEC7FF"], dot: "#375194" },
  { name: "Lavanda", tones: ["#E9E7F3", "#DAD7EA", "#CAC6E2", "#C9BCFF"], dot: "#43348D" },
  { name: "Malva", tones: ["#F1E9F1", "#E7DAE7", "#DDCADD", "#E8B2E9"], dot: "#843E84" },
  { name: "Rosa", tones: ["#F4E6E8", "#EDD4D8", "#E5C2C8", "#FDAEBD"], dot: "#952D3E" },
  { name: "Corallo", tones: ["#F7E8E5", "#F1D7D3", "#EBC7C1", "#FFB0A5"], dot: "#A03C31" },
  { name: "Pesca", tones: ["#F8EAE3", "#F2DCCF", "#EDCDBB", "#F9B68D"], dot: "#A74E1B" },
  { name: "Sabbia", tones: ["#F6F1E5", "#EFE6D2", "#E8DCBF", "#E2C47E"], dot: "#9D7925" },
  { name: "Pistacchio", tones: ["#EEF2E8", "#E2E8D6", "#D6DEC5", "#BDD28C"], dot: "#6F8335" },
];

export const TONE_NAMES = ["tenue", "medio", "deciso", "vivace"] as const;

/** Tinte per le sedi, le più diverse tra loro per prime (Celeste, Pesca, Salvia, Lavanda, Sabbia, Rosa…). */
const SEDE_HUES = [2, 9, 0, 5, 10, 7, 11, 4, 8, 1, 6, 3] as const;

/**
 * Il colore di una sede, dalla sua posizione nella pagina Sedi: nell'orario di chi insegna in più sedi ogni
 * sede si riconosce a colpo d'occhio. Intensità «deciso» per le lezioni, «tenue» per le ore a disposizione.
 */
export function sedeColor(index: number, tone: 0 | 2 = 2): string {
  return TEACHER_PALETTE[SEDE_HUES[index % SEDE_HUES.length]!]!.tones[tone];
}
export const VIVID_TONE = 3;

/** In scuro: quanta tinta piena va sul fondo della card, per intensità. */
const DARK_MIX = [20, 28, 36, 58] as const;

/** Il colore della tavolozza, se il colore salvato è uno dei 48; i colori di prima restano fuori. */
export function findPastel(color: string | undefined): { hue: PastelHue; tone: number } | null {
  if (!color) return null;
  const c = color.trim().toUpperCase();
  for (const hue of TEACHER_PALETTE) {
    const tone = hue.tones.indexOf(c);
    if (tone >= 0) return { hue, tone };
  }
  return null;
}

/** Pallino accanto al nome: la tinta piena per i colori della tavolozza, il colore com'è per quelli di prima. */
export function teacherDotColor(color: string): string {
  return findPastel(color)?.hue.dot ?? color;
}

/** Testo secondario nelle celle colorate: più scuro in chiaro, più chiaro in scuro, così si legge su ogni intensità. */
export const PASTEL_TEXT_2 = "text-[#57514A] dark:text-[#B5AFA6]";
export const VIVID_TEXT_2 = "text-[#4E4842] dark:text-[#D4CCC2]";

/**
 * Fondo della cella d'orario e colore del testo secondario.
 * Tavolozza: pieno in chiaro; in scuro la tinta piena sul fondo della card (più forte a ogni intensità).
 * Colore di prima: identico a prima (tinta leggera sul fondo).
 */
export function teacherCell(color: string | undefined): {
  className?: string;
  style?: CSSProperties;
  text2: string;
} {
  if (!color) return { text2: "text-muted-foreground" };
  const p = findPastel(color);
  if (!p)
    return {
      style: { background: `color-mix(in srgb, ${color} var(--teacher-wash), transparent)` },
      text2: "text-muted-foreground",
    };
  return {
    className: "[--tc-bg:var(--tc-light)] dark:[--tc-bg:var(--tc-dark)]",
    style: {
      background: "var(--tc-bg)",
      "--tc-light": p.hue.tones[p.tone],
      "--tc-dark": `color-mix(in srgb, ${p.hue.dot} ${DARK_MIX[p.tone]}%, var(--color-card))`,
    } as CSSProperties,
    text2: p.tone === VIVID_TONE ? VIVID_TEXT_2 : PASTEL_TEXT_2,
  };
}

/**
 * Ordine dei colori dati in automatico (mai i vivaci): ognuno è il più diverso possibile da quelli prima
 * e dal fondo della card, in chiaro e in scuro.
 */
const AUTO_ORDER = [
  "Pesca deciso",
  "Lavanda deciso",
  "Celeste medio",
  "Pistacchio deciso",
  "Rosa tenue",
  "Rosa deciso",
  "Malva medio",
  "Sabbia medio",
  "Salvia tenue",
  "Acqua deciso",
  "Pesca medio",
  "Sabbia deciso",
  "Pervinca deciso",
  "Malva deciso",
  "Pervinca tenue",
  "Corallo deciso",
  "Rosa medio",
  "Salvia medio",
  "Azzurro deciso",
  "Pervinca medio",
  "Sabbia tenue",
  "Salvia deciso",
  "Pesca tenue",
  "Lavanda medio",
  "Pistacchio medio",
  "Celeste deciso",
  "Corallo medio",
  "Malva tenue",
  "Acqua medio",
  "Celeste tenue",
  "Lavanda tenue",
  "Azzurro medio",
  "Pistacchio tenue",
  "Corallo tenue",
  "Acqua tenue",
  "Azzurro tenue",
];

export const AUTO_COLORS: readonly string[] = AUTO_ORDER.map((label) => {
  const [name, tone] = label.split(" ");
  const hue = TEACHER_PALETTE.find((h) => h.name === name);
  const i = TONE_NAMES.indexOf(tone as (typeof TONE_NAMES)[number]);
  if (!hue || i < 0) throw new Error(`Colore sconosciuto: ${label}`);
  return hue.tones[i];
});

/** Il primo colore non ancora usato (se sono tutti usati, il meno usato), per un nuovo docente. */
export function nextTeacherColor(used: Iterable<string | undefined>): string {
  const count = new Map<string, number>();
  for (const c of used) {
    const p = findPastel(c);
    if (p) count.set(p.hue.tones[p.tone], (count.get(p.hue.tones[p.tone]) ?? 0) + 1);
  }
  let best = AUTO_COLORS[0]!;
  let min = Infinity;
  for (const c of AUTO_COLORS) {
    const n = count.get(c) ?? 0;
    if (n < min) {
      min = n;
      best = c;
    }
  }
  return best;
}

/**
 * Chi non ha un colore della tavolozza (i colori di prima) ne prende uno libero, in ordine alfabetico.
 * Chi ce l'ha già lo tiene: si può rifare a ogni apertura.
 */
export function withPaletteColors<T extends Pick<Teacher, "lastName" | "firstName" | "color">>(
  teachers: T[],
): T[] {
  const missing = teachers
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !findPastel(t.color))
    .sort(
      (a, b) =>
        (a.t.lastName ?? "").localeCompare(b.t.lastName ?? "", "it", { sensitivity: "base" }) ||
        (a.t.firstName ?? "").localeCompare(b.t.firstName ?? "", "it", { sensitivity: "base" }) ||
        a.i - b.i,
    );
  if (missing.length === 0) return teachers;
  const used = teachers.map((t) => t.color);
  const out = [...teachers];
  for (const { t, i } of missing) {
    const color = nextTeacherColor(used);
    used.push(color);
    out[i] = { ...t, color };
  }
  return out;
}
