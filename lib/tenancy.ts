// lib/tenancy.ts
import { OdooClient } from "@/lib/odoo";
import type { TenantData } from "@/types";
import { normRef } from "@/lib/banlist"; // ⬅️ même normalisation que la route

/** AM codes selon sales_person_id */
type AM = "CFR" | "BKO" | "FKE" | "MSC" | "";

/** "AA1 - 01 - Netto" => "Netto" (on garde seulement la 3e partie si elle existe) */
function cleanTenancyName(raw: string): string {
  // split sur tirets, trim, filtre vide
  const parts = String(raw).split("-").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";

  // Heuristique:
  // - 1er segment = code asset (toujours à ignorer)
  // - 2e segment: si c'est purement numérique (lot/numéro), on l'ignore aussi
  // - tout le reste = nom du tenant => on les REJOINT (pas seulement le 3e)
  const rest = parts.slice(1); // on retire le code asset
  let startIdx = 0;
  if (rest.length > 0 && /^[0-9]+$/.test(rest[0])) {
    startIdx = 1; // ignorer le lot numérique
  }
  const nameSegments = rest.slice(startIdx);
  if (nameSegments.length === 0) {
    // fallback : si on n'a rien, on prend le dernier segment connu
    return parts[parts.length - 1];
  }
  return nameSegments.join(" ");
}

/** Différence en années (avec 365.25 jours/an) */
function yearsDiff(from: Date, to: Date) {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000);
}

/**
 * Récupère toutes les tenancies (par main_property_id) et renvoie une liste TenantData.
 * - PAS de mapping via dictionnaire côté Odoo
 * - Nettoyage du libellé seulement (AA1 - 01 - X → X)
 * - Calcule WALT = max(0, date_end - today) en années
 * - Ajoute city et AM (via sales_person_id de la main_property)
 */

export async function getOdooTenants(banned?: Set<string>) {
  const odoo = new OdooClient();
  // charge les tenancies comme avant…
  const tenancies = await odoo.searchRead<any>(
    "property.tenancy",
    [["main_property_id", "!=", false]],
    ["id","name","main_property_id","total_current_rent","space","date_end_display"],
    5000
  );

  // map main ids -> reference_id
  const mainIds = Array.from(new Set(
    tenancies.map((t:any)=> Array.isArray(t.main_property_id) ? t.main_property_id[0] : null).filter(Boolean)
  ));
  const mains = mainIds.length
    ? await odoo.searchRead<any>("property.property", [["id","in",mainIds]], ["id","reference_id","sales_person_id","city"], 5000)
    : [];

  const byMain = new Map<number, {ref:string; city?:string; am?:string}>();
  for (const m of mains) {
    const ref = (m.reference_id ?? String(m.id)).trim();
    const city = m.city ?? "";
    // si tu as déjà une logique pour AM ici, garde-la, sinon laisse vide
    byMain.set(m.id, { ref, city });
  }

  const today = new Date();
  const out: any[] = [];

  for (const t of tenancies) {
    const mid = Array.isArray(t.main_property_id) ? t.main_property_id[0] : null;
    if (!mid) continue;
    const meta = byMain.get(mid);
    if (!meta) continue;

    const assetRef = meta.ref;
    // ⬅️ FILTRE BANLIST ICI (avant push)
    if (banned && banned.has(normRef(assetRef))) continue;

    // nettoie nom Odoo (version “join des segments restants”)
    const cleaned = cleanTenancyName(String(t.name ?? ""));
    // calcule WALT…
    let waltYears = 0;
    if (t.date_end_display) {
      const end = new Date(String(t.date_end_display));
      waltYears = Math.max(0, (end.getTime() - today.getTime()) / (365.25 * 24 * 3600 * 1000));
    }

    out.push({
      asset_ref: assetRef,
      city: meta.city ?? "",
      tenant_name: cleaned,
      space: Number(t.space) || 0,
      rent: Number(t.total_current_rent) || 0,
      walt: waltYears,
      // am: (si tu renseignes AM ici, garde-le)
    });
  }

  return out;
}

/**
 * Construit un map reference_id (asset) → AM (CFR/BKO/FKE/MSC)
 * basé sur property.property.sales_person_id.
 * Utile si ta route API a besoin d’annoter d’autres jeux de données avec l’AM.
 */
export async function getAssetAMMap(): Promise<Map<string, AM>> {
  const odoo = new OdooClient();

  const mains = await odoo.searchRead<any>(
    "property.property",
    [["reference_id", "!=", false]],
    ["reference_id", "sales_person_id"],
    10000
  );

  const map = new Map<string, AM>();
  for (const m of mains) {
    const ref: string = String(m.reference_id ?? "").trim();
    if (!ref) continue;

    const sp = Array.isArray(m.sales_person_id) ? m.sales_person_id[0] : null;
    let am: AM = "";
    if (sp === 12) am = "CFR";
    else if (sp === 7) am = "FKE";
    else if (sp === 8) am = "BKO";
    else if (sp === 9) am = "MSC";

    map.set(ref, am);
  }
  return map;
}
