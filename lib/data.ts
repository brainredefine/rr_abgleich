// lib/data.ts — Reads rentroll.xlsx, returns typed rows
import fs from "node:fs";
import path from "node:path";
import type { RentRollRow } from "@/types";

const EXCEL_PATH = path.join(process.cwd(), "public", "data", "rentroll.xlsx");

export async function readRentRoll(): Promise<RentRollRow[]> {
  const XLSX = await import("xlsx");

  if (!fs.existsSync(EXCEL_PATH)) {
    throw new Error(`File not found: ${EXCEL_PATH}`);
  }

  // Read as buffer to avoid Windows file-lock issues
  const buf = fs.readFileSync(EXCEL_PATH);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Excel file has no sheets");

  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  // Normalize headers to lowercase so "AM", "Am", "am" all work
  const normalized = raw.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k.toLowerCase().trim()] = v;
    return out;
  });

  const rows: RentRollRow[] = [];
  for (const r of normalized) {
    const asset = String(r.asset ?? "").trim();
    const tenant = String(r.tenant ?? "").trim();
    if (!asset && !tenant) continue;

    const presentRaw = String(r.present ?? "both").trim().toLowerCase();
    const present: "am" | "pm" | "both" =
      presentRaw === "am" ? "am" : presentRaw === "pm" ? "pm" : "both";

    rows.push({
      asset,
      tenant,
      am: String(r.am ?? "").trim().toUpperCase(),
      city: String(r.city ?? "").trim(),
      present,
      gla_am: toNum(r.gla_am),
      gla_pm: toNum(r.gla_pm),
      rent_am: toNum(r.rent_am),
      rent_pm: toNum(r.rent_pm),
      walt_am: toNum(r.walt_am),
      walt_pm: toNum(r.walt_pm),
    });
  }

  return rows;
}

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}