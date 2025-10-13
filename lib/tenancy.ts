// lib/tenancy.ts
import { OdooClient, OdooM2O } from "@/lib/odoo";
import { normRef } from "@/lib/banlist";

export type AMCode = "CFR" | "BKO" | "FKE" | "MSC" | "";

/** Tenancies (date_end_display peut être false) */
interface TenancyRec {
  id: number;
  name: string | null;
  main_property_id: OdooM2O<number, string> | false | null;
  total_current_rent: number | null;
  space: number | null;
  date_end_display: string | null | false;
}

/** Mains: certains champs peuvent être false */
interface PropertyRec {
  id: number;
  reference_id: string | null | false;
  city?: string | null | false;
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

function m2oId(v: OdooM2O | false | null | undefined): number | null {
  if (!v) return null;
  const id = v[0];
  return typeof id === "number" ? id : null;
}

function salesToAM(id: number | null): AMCode {
  switch (id ?? 0) {
    case 12: return "CFR";
    case 7:  return "FKE";
    case 8:  return "BKO";
    case 9:  return "MSC";
    default: return "";
  }
}

function cleanTenancyName(raw: string | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const parts = s.split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.slice(2).join(" - ");
  if (parts.length >= 1) return parts[parts.length - 1];
  return s;
}

export async function getAssetAMMap(): Promise<Map<string, AMCode>> {
  const odoo = new OdooClient();
  const props = await odoo.searchRead<PropertyRec>(
    "property.property",
    [["reference_id","!=",false]],
    ["id","reference_id","sales_person_id"],
    10000
  );

  const map = new Map<string, AMCode>();
  for (const p of props) {
    const ref = typeof p.reference_id === "string" ? p.reference_id.trim() : "";
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
    10000
  );

  const mainIds = Array.from(
    new Set(
      tenancies
        .map((t) => m2oId(t.main_property_id))
        .filter((x): x is number => typeof x === "number")
    )
  );

  const mains: PropertyRec[] = mainIds.length
    ? await odoo.searchRead<PropertyRec>(
        "property.property",
        [["id","in",mainIds]],
        ["id","reference_id","city","sales_person_id"],
        10000
      )
    : [];

  const refById = new Map<number, { ref: string; city: string; am: AMCode }>();
  for (const m of mains) {
    // ⬅️ Coercitions sûres (gèrent false/null)
    const ref = typeof m.reference_id === "string" ? m.reference_id.trim() : "";
    if (!ref) continue;
    const city = typeof m.city === "string" ? m.city.trim() : "";
    const spId = m2oId(m.sales_person_id as OdooM2O | false | null);
    refById.set(m.id, { ref, city, am: salesToAM(spId) });
  }

  const today = Date.now();
  const out: TenancyRow[] = [];

  for (const t of tenancies) {
    const mid = m2oId(t.main_property_id);
    if (!mid) continue;

    const meta = refById.get(mid);
    if (!meta) continue; // tu as dit: toujours un reference_id → on garde ce comportement

    const assetRef = meta.ref;
    if (banned && banned.has(normRef(assetRef))) continue;

    let waltYears = 0;
    if (t.date_end_display) {
      const endMs = new Date(String(t.date_end_display)).getTime();
      const diffY = (endMs - today) / (365.25 * 24 * 3600 * 1000);
      waltYears = Math.max(0, diffY);
    }

    out.push({
      asset_ref: assetRef,
      tenant_name: cleanTenancyName(t.name),
      space: Number(t.space ?? 0) || 0,
      rent: Number(t.total_current_rent ?? 0) || 0,
      walt: waltYears,
      city: meta.city,
      am: meta.am,
    });
  }

  return out;
}
