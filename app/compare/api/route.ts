// app/compare/api/route.ts
import { NextResponse } from "next/server";
import { getAssetsData } from "@/lib/odoo";
import { getPMData } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [odoo, pm] = await Promise.all([getAssetsData(), getPMData()]);
    return NextResponse.json({ odoo, pm });
  } catch (error: unknown) {
    // typage strict de l'erreur
    const message =
      error instanceof Error ? error.message : String(error);
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
