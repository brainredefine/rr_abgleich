// lib/textnorm.ts
export function normalizeForKey(s: string) {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")   // ü/ö/ä/ß → u/o/a/ss
    .toLowerCase()
    .replace(/[-–—_/.,;:()&]/g, " ")  // tirets & ponctuation → espace
    .replace(/\s+/g, " ")
    .trim();
}
