// lib/tenantMap.ts
import fs from "fs";
import path from "path";

/** Normalisation de base (accents/espaces/casse) */
export function normBasic(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Enlève tout ce qui crée du bruit juridique ou administratif */
function stripJuridique(raw: string): string {
  let s = " " + raw + " ";
  // cut “c/o …” et assimilés
  s = s.replace(/\bc\/o\b.*$/i, " ");
  s = s.replace(/\bobjektmanagement\b.*$/i, " ");

  // supprime mentions “Zweigniederlassung …”, “Vertragswesen …”, “Region …”
  s = s.replace(/\bzweigniederlassung\b.*$/i, " ");
  s = s.replace(/\bvertragswesen\b.*$/i, " ");
  s = s.replace(/\bregion\b.*$/i, " ");

  // company suffixes & formes sociales
  const legalBits = [
    "gmbh", "gmbh & co", "gmbh & co. kg", "gmbh & co. kg", "kg", "se", "ag", "eg", "e\\.k\\.", "ohg", "ug",
    "stiftung", "stiftung & co\\. kg", "stiftung & co kg",
    "gesellschaft", "gesellschaft mbh",
    "vermessungs", "verwaltung", "immobilien", "immobilien-?service", "service", "handelsgesellschaft",
    "vertrieb", "vertriebs-?gmbh", "discothekenbetriebs", "qualitatswerkzeuge", "qualitätswerkzeuge",
    "center", "center gmbh", "beteiligungs", "holding", "objekt", "objektmanagement", "niederlassung"
  ];
  const re = new RegExp(`\\b(?:${legalBits.join("|")})\\b`, "gi");
  s = s.replace(re, " ");

  // ponctuations et séparateurs parasites
  s = s.replace(/[.,/()[\]&]+/g, " ").replace(/-/g, " ");

  return normBasic(s);
}

/** Découpe en tokens & enlève les mots très génériques */
function toTokensKey(s: string): string[] {
  const stop = new Set([
    "gmbh","kg","se","ag","eg","ohg","ug","stiftung","gesellschaft","verwaltung","immobilien","service",
    "handelsgesellschaft","vertrieb","center","holding","beteiligungs","niederlassung","region","markt",
    "discothekenbetriebs","qualitatswerkzeuge","qualitats","qualitäts","werkzeuge","objekt","objektmanagement",
    "abteilung","mietwesen","immobilienmanagement","immobilien-","vertragswesen","zweigniederlassung","co","und","&","der","die","das"
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

/** Charge tenant_map.json et construit structure de recherche */
export function buildPmToAmMatcher(): (pmLabel: string) => { mapped: string | null; reason: string } {
  const p = path.join(process.cwd(), "public", "data", "tenant_map.json");
  let json: any = null;
  if (fs.existsSync(p)) {
    try { json = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  }

  type Entry = { canonical: string; variants: string[] };
  const entries: Entry[] = [];

  const pushGroup = (canonical: string, list: string[]) => {
    const clean = (s: string) => s && s.trim();
    const variants = Array.from(new Set([canonical, ...list].map(clean).filter(Boolean)));
    entries.push({ canonical, variants });
  };

  if (Array.isArray(json)) {
    // format simple [{ pm, am }]
    const grouped = new Map<string, Set<string>>();
    for (const x of json) {
      if (x && typeof x.pm === "string" && typeof x.am === "string") {
        const can = x.am.trim();
        if (!grouped.has(can)) grouped.set(can, new Set());
        grouped.get(can)!.add(x.pm.trim());
      }
    }
    for (const [canonical, set] of grouped) {
      pushGroup(canonical, Array.from(set));
    }
  } else if (json && Array.isArray(json.groups)) {
    for (const g of json.groups) {
      if (!g || typeof g.canonical !== "string") continue;
      const canonical = g.canonical.trim();
      const amList = Array.isArray(g.am) ? g.am.filter((x: any) => typeof x === "string") : [];
      const pmList = Array.isArray(g.pm) ? g.pm.filter((x: any) => typeof x === "string") : [];
      pushGroup(canonical, [...amList, ...pmList]);
    }
  }

  // Indexes
  const idxExact = new Map<string, string>();           // normBasic(variant) -> canonical
  const idxExactStrip = new Map<string, string>();      // stripJuridique-normalized -> canonical
  const idxTokens = new Map<string, string>();          // tokensSignature(variant) -> canonical
  const tokenCache = new Map<string, string[]>();       // cache tokens

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
      // warm cache
      getTokens(v);
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

    // 4) fuzzy léger sur Jaccard de tokens contre toutes les variantes
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
