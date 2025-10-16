// lib/pm.ts
import { supabase } from "@/lib/supabase";

export type AM = "CFR" | "BKO" | "FKE" | "MSC" | "";
export interface TenantRow {
  asset_ref: string;
  tenant_name: string;
  space: number;
  rent: number;
  walt?: number;
  city?: string;
  am?: AM;
}

// util pour normaliser la clé de fusion
const normKey = (asset: string, tenant: string) =>
  `${(asset || "").trim().toUpperCase()}@@${(tenant || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}`;

/**
 * Lis pm_data (+ optionnellement pm_datatenant) et renvoie un TenantRow[]
 * avec le même shape que l’ancien CSV.
 */
export async function getPMTenantsFromSupabase(): Promise<TenantRow[]> {
  // 1) table principale
  const { data: base, error: e1 } = await supabase
    .from("pm_data")
    .select("asset_ref, tenant_name, space, rent, walt, city, am");
  if (e1) throw new Error(`Supabase pm_data: ${e1.message}`);

  // 2) table d’enrichissement / mapping (si elle existe)
  const { data: extra, error: e2 } = await supabase
    .from("pm_datatenant")
    .select("*");
  if (e2) {
    // pas bloquant si elle n’existe pas / vide
    console.warn("Supabase pm_datatenant:", e2.message);
  }

  // 3) fusion défensive
  const idx = new Map<string, Partial<TenantRow>>();
  for (const r of base ?? []) {
    idx.set(normKey(r.asset_ref, r.tenant_name), { ...r });
  }
  for (const e of extra ?? []) {
    const k = normKey(e.asset_ref ?? e.asset ?? "", e.tenant_name ?? e.tenant ?? "");
    const cur = idx.get(k) ?? {};
    idx.set(k, {
      ...cur,
      asset_ref: (e.asset_ref ?? e.asset ?? cur.asset_ref ?? "").toString(),
      tenant_name: (e.tenant_name ?? e.tenant ?? cur.tenant_name ?? "").toString(),
      space: Number(e.space ?? cur.space ?? 0),
      rent: Number(e.rent ?? cur.rent ?? 0),
      walt:
        e.walt == null && cur.walt == null
          ? undefined
          : Number(e.walt ?? cur.walt ?? 0),
      city: (e.city ?? cur.city) ?? undefined,
      am: (e.am ?? cur.am) as AM,
    });
  }

  // 4) casting final
  return Array.from(idx.values()).map((v) => ({
    asset_ref: String(v.asset_ref ?? ""),
    tenant_name: String(v.tenant_name ?? ""),
    space: Number(v.space ?? 0),
    rent: Number(v.rent ?? 0),
    walt: v.walt == null ? undefined : Number(v.walt),
    city: v.city == null ? undefined : String(v.city),
    am: (v.am as AM) ?? "",
  }));
}
