import Papa from "papaparse";
import fs from "fs";
import path from "path";
import type { TenantData } from "@/types";
import { buildPmToAmMatcher } from "@/lib/tenantMap";

/** Lecture robuste UTF-8 → fallback Latin-1 (pour ü/ö/ä/ß quand CSV mal encodé) */
function readCsvText(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const utf8 = buf.toString("utf8"); // ← const (prefer-const)
  const hasHighBytes = buf.some((b) => b >= 0x80);
  const replacementCharCount = (utf8.match(/\uFFFD/g) || []).length;
  const asciiRatio = utf8.length > 0 ? (utf8.match(/[\x00-\x7F]/g) || []).length / utf8.length : 1;
  if (hasHighBytes && (replacementCharCount > 0 || asciiRatio > 0.98)) {
    try {
      return new TextDecoder("latin1").decode(buf);
    } catch {}
  }
  return utf8;
}

/** Charge le CSV PM (A:Asset, B:City, C:Tenant PM, D:Space, E:Rent, F:WALT) et mappe PM→AM */
export async function loadPmCsvTenants(): Promise<TenantData[]> {
  const p = path.join(process.cwd(), "public", "data", "pm_datatenant.csv");
  if (!fs.existsSync(p)) return [];

  const text = readCsvText(p);
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });

  const match = buildPmToAmMatcher();

  const out: TenantData[] = [];
  for (const row of parsed.data) {
    if (!row || row.length < 5) continue;

    const asset = String(row[0] ?? "").trim();
    const city = String(row[1] ?? "").trim();
    const pmLabelRaw = String(row[2] ?? "").trim();
    const space = Number(String(row[3] ?? "0").replace(",", ".")) || 0;
    const rent  = Number(String(row[4] ?? "0").replace(",", ".")) || 0;
    const walt  = row[5] != null ? Number(String(row[5]).replace(",", ".")) || 0 : undefined;

    const { mapped } = match(pmLabelRaw);
    const finalName = mapped ?? pmLabelRaw;

    out.push({
      asset_ref: asset,
      city,
      tenant_name: finalName,
      space,
      rent,
      walt,
    });
  }

  return out;
}

// Alias si tu en as besoin
export async function getPMTenants() {
  return loadPmCsvTenants();
}
