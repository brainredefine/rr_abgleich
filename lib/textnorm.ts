// lib/textnorm.ts
export function normalizeForKey(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-–—_/.,;:()&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}