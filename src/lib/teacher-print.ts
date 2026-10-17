/** Cognome in stampatello; se collide, aggiunge DOM / DAN / MR. */
export function teacherSheetName(
  t: { lastName: string; firstName: string },
  all: readonly { lastName: string; firstName: string }[],
): string {
  const last = t.lastName.trim().toUpperCase();
  const peers = all.filter((x) => x.lastName === t.lastName);
  if (peers.length <= 1) return last;
  const parts = t.firstName.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${last} ${parts.map((p) => p.charAt(0)).join("")}`;
  return `${last} ${(parts[0] ?? "").slice(0, 3)}`;
}

export function teacherPdfFileName(t: { lastName: string; firstName: string }): string {
  const raw = `${t.lastName}-${t.firstName}`.normalize("NFD").replace(/\p{M}/gu, "");
  const slug = raw.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "docente";
  return `orario-${slug}.pdf`;
}
