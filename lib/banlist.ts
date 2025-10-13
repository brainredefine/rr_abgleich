import fs from "fs";
import path from "path";

/** normalise un ref: uppercase, sans espaces */
const normRef = (s: string) => String(s).toUpperCase().replace(/\s+/g, "").trim();

/**
 * Accepte :
 * - JSON tableau : ["AD1","ZZ9"]
 * - JSON objet  : { "assets": ["AD1","ZZ9"] } ou { "ban": [...] } ou { "list": [...] }
 * - JSON map    : { "AD1": true, "ZZ9": 1 }
 * - CSV         : une ref par ligne
 */
export function loadBannedAssets(): Set<string> {
  const base = path.join(process.cwd(), "public", "data");
  const out = new Set<string>();

  const tryPush = (v: any) => {
    if (Array.isArray(v)) {
      for (const x of v) out.add(normRef(x));
      return;
    }
    if (v && typeof v === "object") {
      // cas { assets: [...]} / { ban: [...] } / { list: [...] }
      for (const key of ["assets", "ban", "list"]) {
        if (Array.isArray((v as any)[key])) {
          for (const x of (v as any)[key]) out.add(normRef(x));
          return;
        }
      }
      // cas map { "AD1": true, "ZZ9": 1 }
      for (const k of Object.keys(v)) {
        const val = (v as any)[k];
        if (val) out.add(normRef(k));
      }
    }
  };

  // JSON
  const jsonPath = path.join(base, "banlist.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      tryPush(j);
    } catch {}
  }

  // CSV
  if (out.size === 0) {
    const csvPath = path.join(base, "banlist.csv");
    if (fs.existsSync(csvPath)) {
      const text = fs.readFileSync(csvPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const v = line.trim();
        if (v) out.add(normRef(v));
      }
    }
  }

  return out;
}

/** exporté pour réutiliser la même normalisation côté route */
export { normRef };
