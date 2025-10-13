// app/odoo/raw-tenancies/route.ts
import { NextResponse } from "next/server";
import { OdooClient } from "@/lib/odoo";

export const runtime = "nodejs";

export async function GET() {
  try {
    const odoo = new OdooClient();
    const tenancies = await odoo.searchRead<{
      id: number;
      name: string | null;
      main_property_id: [number, string] | false | null;
      total_current_rent: number | null;
      space: number | null;
      date_end_display: string | null;
    }>(
      "property.tenancy",
      [["main_property_id", "!=", false]],
      ["id","name","main_property_id","total_current_rent","space","date_end_display"],
      20
    );
    return NextResponse.json({ ok: true, sample: tenancies });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
