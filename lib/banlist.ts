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

  const tryPush = (v: unknown) => {
    // cas tableau direct
    if (Array.isArray(v)) {
      for (const x of v) out.add(normRef(String(x)));
      return;
    }
    // cas objet contenant assets/ban/list
    if (v && typeof v === "object") {
      const maybeObj = v as Record<string, unknown>;

      for (const key of ["assets", "ban", "list"] as const) {
        const arr = maybeObj[key];
        if (Array.isArray(arr)) {
          for (const x of arr) out.add(normRef(String(x)));
          return;
        }
      }
      // cas map { "AD1": true, "ZZ9": 1 }
      for (const k of Object.keys(maybeObj)) {
        const val = maybeObj[k];
        if (val) out.add(normRef(k));
      }
    }
  };

  // JSON
  const jsonPath = path.join(base, "banlist.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const txt = fs.readFileSync(jsonPath, "utf8");
      const j: unknown = JSON.parse(txt);
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
