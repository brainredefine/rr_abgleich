// lib/tenantMap.ts
import fs from "fs";
import path from "path";

export interface TenantRule {
  pm: string; // motif côté PM
  am: string; // libellé cible (AM canonical)
}

/** Normalisation de base (accents/espaces/casse) */
export function normBasic(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Enlève ce qui crée du bruit juridique/administratif */
function stripJuridique(raw: string): string {
  let s = ` ${raw} `;
  s = s.replace(/\bc\/o\b.*$/i, " ");
  s = s.replace(/\bobjektmanagement\b.*$/i, " ");
  s = s.replace(/\bzweigniederlassung\b.*$/i, " ");
  s = s.replace(/\bvertragswesen\b.*$/i, " ");
  s = s.replace(/\bregion\b.*$/i, " ");

  const legalBits = [
    "gmbh","gmbh & co","gmbh & co. kg","kg","se","ag","eg","e\\.k\\.","ohg","ug",
    "stiftung","stiftung & co\\. kg","stiftung & co kg",
    "gesellschaft","gesellschaft mbh",
    "vermessungs","verwaltung","immobilien","immobilien-?service","service","handelsgesellschaft",
    "vertrieb","vertriebs-?gmbh","discothekenbetriebs","qualitatswerkzeuge","qualitätswerkzeuge",
    "center","center gmbh","beteiligungs","holding","objekt","objektmanagement","niederlassung"
  ];
  const re = new RegExp(`\\b(?:${legalBits.join("|")})\\b`, "gi");
  s = s.replace(re, " ");
  s = s.replace(/[.,/()[\]&]+/g, " ").replace(/-/g, " ");

  return normBasic(s);
}

/** Découpe en tokens & enlève les mots très génériques */
function toTokensKey(s: string): string[] {
  const stop = new Set([
    "gmbh","kg","se","ag","eg","ohg","ug","stiftung","gesellschaft","verwaltung","immobilien","service",
    "handelsgesellschaft","vertrieb","center","holding","beteiligungs","niederlassung","region","markt",
    "discothekenbetriebs","qualitatswerkzeuge","qualitats","qualitäts","werkzeuge","objekt","objektmanagement",
    "abteilung","mietwesen","immobilienmanagement","immobilien-","vertragswesen","zweigniederlassung","co",
    "und","&","der","die","das"
  ]);
  return stripJuridique(s)
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !stop.has(w));
}

/** token-set signature (ordre ignoré, doublons supprimés) */
function tokensSignature(s: string): string {
  return Array.from(new Set(toTokensKey(s))).sort().join(" ");
}

/** Similarité Jaccard simple entre 2 ensembles de tokens */
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
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

/**
 * Construit un matcher PM -> AM.
 * Signature compatible : () => (pmLabel) => { mapped: string | null; reason: string }
 */
export function buildPmToAmMatcher(): (pmLabel: string) => { mapped: string | null; reason: string } {
  // On part des règles (formats A/B) et on regroupe par canonical (am)
  const rules = loadTenantMap();

  type Entry = { canonical: string; variants: string[] };
  const grouped = new Map<string, Set<string>>();
  for (const r of rules) {
    const can = r.am.trim();
    const pm = r.pm.trim();
    if (!can || !pm) continue;
    if (!grouped.has(can)) grouped.set(can, new Set<string>());
    grouped.get(can)!.add(pm);
  }

  const entries: Entry[] = [];
  for (const [canonical, set] of grouped) {
    const variants = Array.from(new Set([canonical, ...Array.from(set)]));
    entries.push({ canonical, variants });
  }

  // Indexes
  const idxExact = new Map<string, string>();      // normBasic(variant) -> canonical
  const idxExactStrip = new Map<string, string>(); // stripJuridique-normalized -> canonical
  const idxTokens = new Map<string, string>();     // tokensSignature(variant) -> canonical
  const tokenCache = new Map<string, string[]>();  // cache tokens

  const getTokens = (s: string) => {
    const key = `#${s}`;
    let t = tokenCache.get(key);
    if (!t) { t = toTokensKey(s); tokenCache.set(key, t); }
    return t;
  };

  for (const e of entries) {
    const canonical = e.canonical;
    for (const v of e.variants) {
      idxExact.set(normBasic(v), canonical);
      idxExactStrip.set(stripJuridique(v), canonical);
      idxTokens.set(tokensSignature(v), canonical);
      getTokens(v); // warm cache
    }
    // s’assure que le canonical lui-même passe partout
    idxExact.set(normBasic(canonical), canonical);
    idxExactStrip.set(stripJuridique(canonical), canonical);
    idxTokens.set(tokensSignature(canonical), canonical);
    getTokens(canonical);
  }

  // Matcher final
  return (pmLabel: string) => {
    const raw = pmLabel ?? "";
    const nb = normBasic(raw);
    const sj = stripJuridique(raw);
    const sig = tokensSignature(raw);

    // 1) exact normalisé
    const e1 = idxExact.get(nb);
    if (e1) return { mapped: e1, reason: "exact" };

    // 2) exact après strip juridique
    const e2 = idxExactStrip.get(sj);
    if (e2) return { mapped: e2, reason: "exact_strip" };

    // 3) token-set exact
    const e3 = idxTokens.get(sig);
    if (e3) return { mapped: e3, reason: "token_set" };

    // 4) fuzzy léger : meilleur Jaccard sur tokens
    const pmToks = getTokens(raw);
    let best: { can: string; score: number } | null = null;

    for (const e of entries) {
      for (const v of e.variants) {
        const score = jaccard(pmToks, getTokens(v));
        if (!best || score > best.score) best = { can: e.canonical, score };
      }
    }
    if (best && best.score >= 0.85) {
      return { mapped: best.can, reason: `jaccard_${best.score.toFixed(2)}` };
    }

    return { mapped: null, reason: "no_match" };
  };
}
