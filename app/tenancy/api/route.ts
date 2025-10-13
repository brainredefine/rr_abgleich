export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { loadPmCsvTenants } from "@/lib/csvTenants";
import { getOdooTenants, getAssetAMMap } from "@/lib/tenancy";
import { loadBannedAssets, normRef } from "@/lib/banlist";
import { hasOdooEnv } from "@/lib/odoo";

export async function GET() {
  try {
    const banned = loadBannedAssets();

    // CSV PM (toujours dispo si le fichier est présent)
    const pmRaw = await loadPmCsvTenants();
    const pmBase = pmRaw.filter((r) => !banned.has(normRef(r.asset_ref)));

    // Par défaut: on renvoie PM seul si Odoo est indisponible
    if (!hasOdooEnv()) {
      return NextResponse.json({
        pm: pmBase.map((r) => ({ ...r, am: "" })),
        odoo: [],
        warnings: ["Odoo not configured on server (missing env vars)"],
      });
    }

    // Sinon, on tente Odoo — sans faire chuter la route en cas d’échec
    const [odooRes, amMapRes] = await Promise.allSettled([
      getOdooTenants(banned),
      getAssetAMMap(),
    ]);

    const odoo =
      odooRes.status === "fulfilled" ? odooRes.value : [];
    const amMap =
      amMapRes.status === "fulfilled" ? amMapRes.value : new Map<string, string>();

    const pm = pmBase.map((r) => ({ ...r, am: amMap.get(r.asset_ref) || "" }));


    const warnings: string[] = [];
    if (odooRes.status === "rejected") warnings.push(`Odoo tenants error: ${String(odooRes.reason)}`);
    if (amMapRes.status === "rejected") warnings.push(`Odoo AM map error: ${String(amMapRes.reason)}`);

    return NextResponse.json({ pm, odoo, ...(warnings.length ? { warnings } : {}) });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message?: unknown }).message)
        : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
