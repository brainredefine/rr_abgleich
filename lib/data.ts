// lib/data.ts — Reads public/data/SourceRR.xlsx and returns typed rows.
//
// The workbook holds the raw exports (sheets 3PM / Tabula / Mapping [+ optional AM]);
// lib/source.ts turns them into the flat AM-vs-PM comparison rows.
import fs from "node:fs";
import path from "node:path";
import type { RentRollRow } from "@/types";
import { buildRentRoll, type RawRow } from "@/lib/source";

const DATA_DIR = path.join(process.cwd(), "public", "data");

/** Picked up by name pattern so "SourceRR.xlsx", "SourceRR (2).xlsx", … all work. */
function findWorkbook(): string {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Folder not found: ${DATA_DIR}`);

  const file = fs
    .readdirSync(DATA_DIR)
    .find((f) => /^source.*\.xlsx?$/i.test(f) && !f.startsWith("~$") && !f.startsWith("."));

  if (!file) throw new Error(`No SourceRR.xlsx found in ${DATA_DIR}`);
  return path.join(DATA_DIR, file);
}

export async function readRentRoll(): Promise<RentRollRow[]> {
  const XLSX = await import("xlsx");
  const file = findWorkbook();

  // Read as buffer to avoid Windows file-lock issues
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });

  const sheet = (...names: string[]): RawRow[] | undefined => {
    const found = wb.SheetNames.find((s) =>
      names.some((n) => s.toLowerCase().trim() === n.toLowerCase()),
    );
    if (!found) return undefined;
    return XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[found], { defval: "" });
  };

  const pm = sheet("3PM", "PM", "3 PM");
  const tabula = sheet("Tabula", "Tabula AM");
  const mapping = sheet("Mapping", "Map");

  if (!pm || !tabula || !mapping) {
    const missing = [!pm && "3PM", !tabula && "Tabula", !mapping && "Mapping"].filter(Boolean);
    throw new Error(
      `${path.basename(file)}: missing sheet(s) ${missing.join(", ")} — found ${wb.SheetNames.join(", ")}`,
    );
  }

  return buildRentRoll({ pm, tabula, mapping, am: sheet("AM", "Asset Manager") });
}
