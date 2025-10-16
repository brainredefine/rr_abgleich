// app/api/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getOdooTenants } from "@/lib/tenancy";
import fs from "node:fs";

type AM = "CFR" | "BKO" | "FKE" | "MSC" | "";
type TenantRow = {
  asset_ref: string;
  tenant_name: string;   // ← côté PM on alimente via tenant_am_name
  space: number;
  rent: number;
  walt?: number;
  city?: string;
  am?: AM;
};

export const runtime = "nodejs";

/** Charge public/data/banlist.json et renvoie un Set d'asset_ref bannis (en MAJ). */
function loadBanSet(): Set<string> {
  try {
    const p = `${process.cwd()}/public/data/banlist.json`;
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    const banned = new Set<string>();
    const add = (v: unknown) => {
      if (!v) return;
      if (typeof v === "string" && v.trim()) banned.add(v.trim().toUpperCase());
      else if (typeof v === "object") {
        const ref = String((v as any).asset_ref ?? (v as any).reference_id ?? "").trim();
        if (ref) banned.add(ref.toUpperCase());
      }
    };
    if (Array.isArray(json)) json.forEach(add);
    else if (json && Array.isArray(json.assets)) json.assets.forEach(add);
    return banned;
  } catch {
    return new Set<string>();
  }
}

/**
 * Récupère TOUTES les lignes de pm_datatenant en paginant par OFFSET.
 * On calcule d'abord le total exact, puis on boucle. Trié par asset_ref pour stabilité.
 */
async function fetchAllPmRows(): Promise<any[]> {
  const pageSize = 1000;
  // 1) total exact (HEAD)
  const head = await supabase
    .from("pm_datatenant")
    .select("asset_ref", { count: "exact", head: true });
  if (head.error) throw new Error(`Supabase pm_datatenant (count): ${head.error.message}`);
  const total = head.count ?? 0;

  const out: any[] = [];
  let offset = 0;
  let safety = 0;

  while (offset < total) {
    const { data, error } = await supabase
      .from("pm_datatenant")
      .select("asset_ref, city, tenant_am_name, space, rent, walt")
      .order("asset_ref", { ascending: true, nullsFirst: true })
      .range(offset, offset + pageSize - 1); // inclusif

    if (error) throw new Error(`Supabase pm_datatenant: ${error.message}`);

    if (!data || data.length === 0) break; // plus rien
    out.push(...data);

    offset += data.length;
    safety++;
    if (safety > 200) break; // garde-fou (200k lignes)
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  try {
    const ban = loadBanSet();

    // PM (paginé pour dépasser la limite par défaut ~1000)
    const pmRows = await fetchAllPmRows();
    const pmAll: TenantRow[] = pmRows.map((r: any) => ({
      asset_ref: String(r.asset_ref ?? ""),
      tenant_name: String(r.tenant_am_name ?? ""), // ← ta colonne canonique
      space: Number(r.space ?? 0),
      rent: Number(r.rent ?? 0),
      walt: r.walt == null ? undefined : Number(r.walt),
      city: r.city == null ? undefined : String(r.city),
      am: "",
    }));

    // Odoo (pas touché)
    const odooAll: TenantRow[] = await getOdooTenants();

    // Filtre banlist sur asset_ref
    const pm = pmAll.filter((row) => !ban.has(row.asset_ref.toUpperCase()));
    const odoo = odooAll.filter((row) => !ban.has(row.asset_ref.toUpperCase()));

    if (debug) {
      const sampleTail = pm.slice(-5).map((r) => r.asset_ref);
      return NextResponse.json({
        counts: { pm_total_after_ban: pm.length, odoo_total_after_ban: odoo.length },
        pm_tail_assets: sampleTail, // pour voir si O1/V* apparaissent
        banned_count: ban.size,
      });
    }

    return NextResponse.json({ pm, odoo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api] 500:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
