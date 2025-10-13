// lib/tenancy.ts
import { OdooClient } from "@/lib/odoo";
import { normRef } from "@/lib/banlist";

export type AMCode = "CFR" | "BKO" | "FKE" | "MSC" | "";

export interface OdooM2O<TId = number, TName = string> extends Array<TId | TName> {
  0: TId;
  1: TName;
}

interface TenancyRec {
  id: number;
  name: string;
  main_property_id: OdooM2O<number, string> | false | null;
  total_current_rent: number | null;
  space: number | null;
  date_end_display: string | null; // ISO
}

interface PropertyRec {
  id: number;
  reference_id: string | null;
  city?: string | null;
  sales_person_id?: OdooM2O<number, string> | false | null;
}

export interface TenancyRow {
  asset_ref: string;
  tenant_name: string;
  space: number;
  rent: number;
  walt?: number;
  city?: string;
  am?: AMCode;
}

/** Nettoie "AA1 - 01 - SCHWARZ-Außenwerbung" -> "SCHWARZ-Außenwerbung" */
function cleanTenancyName(raw: string): string {
  const parts = String(raw).split("-").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.slice(2).join(" - "); // jointure robuste
  if (parts.length >= 1) return parts[parts.length - 1];
  return String(raw).trim();
}

function m2oId(v: OdooM2O | false | null | undefined): number | null {
  if (v === null || v === undefined || v === false) return null;
  const id = v[0];
  return typeof id === "number" ? id : null;
}


function salesToAM(id: number | null): AMCode {
  // CFR : 12, FKE : 7, BKO : 8, MSC : 9
  switch (id ?? 0) {
    case 12: return "CFR";
    case 7:  return "FKE";
    case 8:  return "BKO";
    case 9:  return "MSC";
    default: return "";
  }
}

export async function getAssetAMMap(): Promise<Map<string, AMCode>> {
  const odoo = new OdooClient();
  const props = await odoo.searchRead<PropertyRec>(
    "property.property",
    [["reference_id","!=",false]],
    ["id","reference_id","sales_person_id"],
    5000
  );

  const map = new Map<string, AMCode>();
  for (const p of props) {
    const ref = (p.reference_id ?? "").trim();
    if (!ref) continue;
    const spId = m2oId(p.sales_person_id as OdooM2O | false | null);
    map.set(ref, salesToAM(spId));
  }
  return map;
}

export async function getOdooTenants(banned?: Set<string>): Promise<TenancyRow[]> {
  const odoo = new OdooClient();

  const tenancies = await odoo.searchRead<TenancyRec>(
    "property.tenancy",
    [["main_property_id","!=",false]],
    ["id","name","main_property_id","total_current_rent","space","date_end_display"],
    5000
  );

  const mainIds = Array.from(
    new Set(
      tenancies
        .map((t) => m2oId(t.main_property_id as OdooM2O | false | null))
        .filter((x): x is number => typeof x === "number")
    )
  );

  const mains = mainIds.length
    ? await odoo.searchRead<PropertyRec>(
        "property.property",
        [["id","in",mainIds]],
        ["id","reference_id","city","sales_person_id"],
        5000
      )
    : [];

  const refById = new Map<number, { ref: string; city: string; am: AMCode }>();
  for (const m of mains) {
    const ref = (m.reference_id ?? String(m.id)).trim();
    const city = (m.city ?? "").trim();
    const spId = m2oId(m.sales_person_id as OdooM2O | false | null);
    refById.set(m.id, { ref, city, am: salesToAM(spId) });
  }

  const today = Date.now();
  const out: TenancyRow[] = [];

  for (const t of tenancies) {
    const mid = m2oId(t.main_property_id as OdooM2O | false | null);
    if (!mid) continue;
    const meta = refById.get(mid);
    if (!meta) continue;

    const assetRef = meta.ref;
    if (banned && banned.has(normRef(assetRef))) continue;

    const cleaned = cleanTenancyName(String(t.name ?? ""));

    let waltYears = 0;
    if (t.date_end_display) {
      const end = new Date(String(t.date_end_display)).getTime();
      const diffY = (end - today) / (365.25 * 24 * 3600 * 1000);
      waltYears = Math.max(0, diffY);
    }

    out.push({
      asset_ref: assetRef,
      tenant_name: cleaned,
      space: Number(t.space ?? 0) || 0,
      rent: Number(t.total_current_rent ?? 0) || 0,
      walt: waltYears,
      city: meta.city,
      am: meta.am,
    });
  }

  return out;
}
