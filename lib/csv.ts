import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { AssetData } from "@/types";

export function getPMData(): AssetData[] {
  const filePath = path.join(process.cwd(), "public/data/pm_data.csv");
  const csvFile = fs.readFileSync(filePath, "utf8");

  const { data } = Papa.parse(csvFile, {
    header: true,
    skipEmptyLines: true,
  });

  return data.map((row: any) => ({
    reference_id: row.Asset?.trim(),
    gla: parseFloat(row.GLA) || 0,
    rent: parseFloat(row.Rent) || 0,
    walt: parseFloat(row.Walt) || 0, // ← ajout important
  }));
}
