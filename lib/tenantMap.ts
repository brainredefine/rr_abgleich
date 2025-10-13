// lib/tenantMap.ts
import fs from "fs";
import path from "path";

export interface TenantRule {
  pm: string; // motif côté PM
  am: string; // libellé cible (AM canonical)
}

/** normalise pour comparaison (minuscules, accents retirés, espaces unique) */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** mappe un libellé PM -> libellé AM selon règles (contient/égal) */
export function mapLabelWithRules(label: string, rules: TenantRule[]): string {
  const L = normalize(label);
  for (const r of rules) {
    const pat = normalize(r.pm);
    if (!pat) continue;
    if (L === pat || L.includes(pat) || pat.includes(L)) {
      return r.am;
    }
  }
  return label;
}

/** charge public/data/tenant_map.json (2 formats supportés) */
export function loadTenantMap(): TenantRule[] {
  const p = path.join(process.cwd(), "public", "data", "tenant_map.json");
  if (!fs.existsSync(p)) return [];

  const raw = fs.readFileSync(p, "utf8").trim();
  if (!raw) return [];

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return []; }

  // Format A: tableau direct [{ pm, am }]
  if (Array.isArray(json)) {
    const arr = json as unknown[];
    const out: TenantRule[] = [];
    for (const x of arr) {
      if (x && typeof x === "object" && "pm" in x && "am" in x) {
        const pm = String((x as { pm: unknown }).pm ?? "").trim();
        const am = String((x as { am: unknown }).am ?? "").trim();
        if (pm && am) out.push({ pm, am });
      }
    }
    return out;
  }

  // Format B: { version, groups: [{ canonical, am?: string[], pm?: string[] }] }
  if (json && typeof json === "object" && "groups" in (json as Record<string, unknown>)) {
    const big = json as { groups?: unknown };
    const groups = Array.isArray(big.groups) ? (big.groups as unknown[]) : [];
    const out: TenantRule[] = [];
    const seen = new Set<string>();

    for (const g of groups) {
      if (!g || typeof g !== "object") continue;
      const canonicalRaw = (g as { canonical?: unknown }).canonical;
      const canonical = typeof canonicalRaw === "string" ? canonicalRaw.trim() : "";
      if (!canonical) continue;

      const amListRaw = (g as { am?: unknown }).am;
      const pmListRaw = (g as { pm?: unknown }).pm;
      const amList = Array.isArray(amListRaw) ? (amListRaw as unknown[]) : [];
      const pmList = Array.isArray(pmListRaw) ? (pmListRaw as unknown[]) : [];

      const variants: string[] = [];
      for (const v of [...amList, ...pmList]) {
        if (typeof v === "string" && v.trim()) variants.push(v.trim());
      }

      for (const v of variants) {
        const key = `${v}>>>${canonical}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pm: v, am: canonical });
      }

      const selfKey = `${canonical}>>>${canonical}`;
      if (!seen.has(selfKey)) {
        seen.add(selfKey);
        out.push({ pm: canonical, am: canonical });
      }
    }
    return out;
  }

  return [];
}
