// app/tenancy/api/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { loadPmCsvTenants } from "@/lib/csvTenants";
import { getOdooTenants, getAssetAMMap } from "@/lib/tenancy";
import { loadBannedAssets, normRef } from "@/lib/banlist";
import { hasOdooEnv } from "@/lib/odoo";

export async function GET() {
  try {
    const banned = loadBannedAssets();

    // PM CSV
    const pmRaw = await loadPmCsvTenants();
    const pmFiltered = pmRaw.filter((r) => !banned.has(normRef(r.asset_ref)));

    const debug: Record<string, unknown> = {
      ban_count: banned.size,
      pm_raw_count: pmRaw.length,
      pm_after_ban_count: pmFiltered.length,
    };

    if (!hasOdooEnv()) {
      const warnings = ["Odoo not configured on server (missing env vars)"];
      return NextResponse.json({ pm: pmFiltered.map((r) => ({ ...r, am: "" })), odoo: [], warnings, debug });
    }

    // IMPORTANT: on récupère Odoo SANS banlist pour diagnostiquer
    const [odooRes, amMapRes] = await Promise.allSettled([
      getOdooTenants(undefined),
      getAssetAMMap(),
    ]);

    const warnings: string[] = [];
    if (odooRes.status === "rejected") warnings.push(`getOdooTenants error: ${String(odooRes.reason)}`);
    if (amMapRes.status === "rejected") warnings.push(`getAssetAMMap error: ${String(amMapRes.reason)}`);

    const odooAll = odooRes.status === "fulfilled" ? odooRes.value : [];
    const odoo = odooAll.filter((r) => !banned.has(normRef(r.asset_ref)));

    const amMap = amMapRes.status === "fulfilled" ? amMapRes.value : new Map<string, string>();
    const pm = pmFiltered.map((r) => ({ ...r, am: amMap.get(r.asset_ref) || "" }));

    debug.odoo_all_count = odooAll.length;
    debug.odoo_after_ban_count = odoo.length;

    return NextResponse.json({ pm, odoo, ...(warnings.length ? { warnings } : {}), debug });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
