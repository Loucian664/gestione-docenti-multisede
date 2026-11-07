/**
 * Icone centrate «a occhio» nei tasti.
 *
 * Ogni icona è disegnata in un quadrato 24×24, ma non lo riempie allo stesso modo: il foglio del PDF lascia 2 px vuoti
 * ai lati, la freccia del download poco più di 1, il «+» quasi 3. L'app centra i quadrati, non i disegni, e così in
 * un tasto con icona e scritta il contenuto sembra spostato verso l'icona; anche le lettere lasciano un po' di vuoto,
 * diverso da lettera a lettera. Qui si misurano il disegno vero (getBBox) e la scritta vera (disegnata a parte) e si
 * compensa la differenza:
 * - icona prima della scritta: margine a sinistra, perché il vuoto prima dell'icona pareggi quello dopo la scritta;
 * - icona dopo la scritta: lo stesso a destra;
 * - icona da sola, o sopra la scritta: spostata perché il centro del disegno stia al centro;
 * - sempre: il centro del disegno sulla riga di mezzo, in verticale.
 * Gli spostamenti sono in `--oi-*` (vedi `styles.css`); si ricalcolano quando cambiano la pagina, le scritte o i font.
 */

const VIEW = 24;
const CONTROL = "button, a, label, summary, [role]";

let canvas: CanvasRenderingContext2D | null = null;
const inkCache = new Map<string, { lead: number; trail: number } | null>();
/**
 * Vuoto prima della prima lettera e dopo l'ultima. Le misure del browser (measureText) qui sono arrotondate al pixel,
 * troppo poco: la scritta si disegna 8 volte più grande e si guardano i pixel.
 */
function ink(text: string, cs: CSSStyleDeclaration) {
  const size = parseFloat(cs.fontSize);
  const key = `${cs.fontStyle}|${cs.fontWeight}|${size}|${cs.fontFamily}|${text}`;
  if (inkCache.has(key)) return inkCache.get(key)!;
  const Z = 8;
  canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!canvas || !size) return null;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${size * Z}px ${cs.fontFamily}`;
  canvas.font = font;
  const advance = canvas.measureText(text).width;
  const pad = Math.ceil(size * Z);
  const w = Math.ceil(advance) + 2 * pad;
  const h = Math.ceil(size * Z * 2);
  canvas.canvas.width = w;
  canvas.canvas.height = h;
  canvas.font = font; // cambiare le misure del foglio azzera il font
  canvas.textBaseline = "middle";
  canvas.fillStyle = "#000";
  canvas.fillText(text, pad, h / 2);
  const data = canvas.getImageData(0, 0, w, h).data;
  const column = (x: number) => {
    let max = 0;
    for (let y = 0; y < h; y++) max = Math.max(max, data[(y * w + x) * 4 + 3]);
    return max;
  };
  let first = -1;
  let last = -1;
  for (let x = 0; x < w && first < 0; x++) if (column(x) > 0) first = x;
  for (let x = w - 1; x >= 0 && last < 0; x--) if (column(x) > 0) last = x;
  const out =
    first < 0
      ? null
      : {
          // con la parte di pixel coperta, per stare sotto l'ottavo di pixel
          lead: (first + (1 - column(first) / 255) - pad) / Z,
          trail: (pad + advance - (last + column(last) / 255)) / Z,
        };
  if (document.fonts?.status === "loaded") inkCache.set(key, out);
  return out;
}

/** Le scritte visibili accanto all'icona, prima e dopo; null se accanto c'è altro (un'etichetta colorata, un campo…). */
function neighbours(svg: SVGSVGElement, parent: Element) {
  const before: string[] = [];
  const after: string[] = [];
  let seen = false;
  let font: CSSStyleDeclaration | null = null;
  for (const node of parent.childNodes) {
    if (node === svg) {
      seen = true;
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t.trim()) (seen ? after : before).push(t);
      continue;
    }
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue;
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.position === "absolute" || cs.position === "fixed") continue;
    if (node instanceof SVGElement) return null; // due icone di fila: lasciamo stare
    const t = node.innerText.trim();
    if (!t) continue;
    const plain =
      parseFloat(cs.paddingLeft) +
        parseFloat(cs.paddingRight) +
        parseFloat(cs.borderLeftWidth) +
        parseFloat(cs.borderRightWidth) ===
        0 && cs.backgroundColor.replace(/\s/g, "").match(/rgba\(.*,0\)|transparent/) !== null;
    if (!plain) return null;
    if (node.innerText.includes("\n")) return null;
    font ??= cs;
    (seen ? after : before).push(node.innerText);
  }
  return { before: before.join("").trim(), after: after.join("").trim(), font };
}

function fix(svg: SVGSVGElement) {
  const parent = svg.parentElement;
  if (!parent || !parent.matches(CONTROL)) return clear(svg);
  const pcs = getComputedStyle(parent);
  if (!pcs.display.includes("flex")) return clear(svg);
  const scale = svg.getBoundingClientRect().width / VIEW;
  if (!scale) return;
  let box: DOMRect;
  try {
    box = svg.getBBox();
  } catch {
    return;
  }
  if (!box.width && !box.height) return;
  const stroke = parseFloat(svg.getAttribute("stroke-width") ?? "2") || 0;
  const x0 = box.x - stroke / 2;
  const x1 = box.x + box.width + stroke / 2;
  const y0 = box.y - stroke / 2;
  const y1 = box.y + box.height + stroke / 2;
  const tx = (VIEW / 2 - (x0 + x1) / 2) * scale;
  const ty = (VIEW / 2 - (y0 + y1) / 2) * scale;
  const around = neighbours(svg, parent);
  if (!around) return clear(svg);
  const column = pcs.flexDirection.startsWith("column");
  const set = (ml: number, mr: number, x: number, y: number) => {
    svg.dataset.oi = "";
    svg.style.setProperty("--oi-ml", `${ml.toFixed(2)}px`);
    svg.style.setProperty("--oi-mr", `${mr.toFixed(2)}px`);
    svg.style.setProperty("--oi-tx", `${x.toFixed(2)}px`);
    svg.style.setProperty("--oi-ty", `${y.toFixed(2)}px`);
  };
  if (column || (!around.before && !around.after)) return set(0, 0, tx, column ? 0 : ty);
  // contenuto allineato a sinistra in una riga più larga (voci di menu, intestazioni): le scritte devono restare in
  // colonna con quelle sopra e sotto, quindi niente spostamenti in orizzontale
  if (!/center|space/.test(pcs.justifyContent)) {
    const range = document.createRange();
    range.selectNodeContents(parent);
    const used = range.getBoundingClientRect().width;
    const inner = parent.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
    if (inner - used > 1.5) return set(0, 0, 0, ty);
  }
  const textCs = around.font ?? pcs;
  let ml = 0;
  let mr = 0;
  if (!around.before && around.after) {
    const t = ink(around.after, textCs);
    if (t) ml = -(x0 * scale - t.trail);
  } else if (around.before && !around.after) {
    const t = ink(around.before, textCs);
    if (t) mr = -((VIEW - x1) * scale - t.lead);
  }
  set(ml, mr, 0, ty);
}

function clear(svg: SVGSVGElement) {
  if (!("oi" in svg.dataset)) return;
  delete svg.dataset.oi;
  for (const k of ["--oi-ml", "--oi-mr", "--oi-tx", "--oi-ty"]) svg.style.removeProperty(k);
}

function fixAll(root: ParentNode = document) {
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg.lucide")) fix(svg);
}

/** Avvia le correzioni; restituisce la funzione che le ferma. */
export function startOpticalIcons(): () => void {
  if (typeof window === "undefined") return () => {};
  let queued = false;
  const run = () => {
    queued = false;
    fixAll();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", schedule);
  document.fonts?.addEventListener?.("loadingdone", schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    document.fonts?.removeEventListener?.("loadingdone", schedule);
  };
}
