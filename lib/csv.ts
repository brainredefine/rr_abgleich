import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { AssetData } from "@/types";

type PMCsvRow = Record<string, string | undefined>;

export function getPMData(): AssetData[] {
  const filePath = path.join(process.cwd(), "public/data/pm_data.csv");
  const csvFile = fs.readFileSync(filePath, "utf8");

  const parsed = Papa.parse<PMCsvRow>(csvFile, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = parsed.data ?? [];

  const toNum = (v: string | undefined): number => {
    if (!v) return 0;
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
    };

  return rows.map((row): AssetData => ({
    reference_id: (row.Asset ?? "").trim(),
    gla: toNum(row.GLA),
    rent: toNum(row.Rent),
    walt: toNum(row.Walt), // ← toujours présent côté retour
  }));
}
