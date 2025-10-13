export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { loadPmCsvTenants } from "@/lib/csvTenants";
import { getOdooTenants, getAssetAMMap } from "@/lib/tenancy";
import { loadBannedAssets, normRef } from "@/lib/banlist";

export async function GET() {
  try {
    const banned = loadBannedAssets();

    // Odoo déjà filtré à la source
    const odoo = await getOdooTenants(banned);

    // Map ref -> AM pour enrichir le CSV
    const amMap = await getAssetAMMap();

    // CSV PM filtré aussi
    const pmRaw = await loadPmCsvTenants();
    const pm = pmRaw
      .filter((r) => !banned.has(normRef(r.asset_ref)))
      .map((r) => ({ ...r, am: amMap.get(r.asset_ref) || "" }));

    return NextResponse.json({ pm, odoo });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
