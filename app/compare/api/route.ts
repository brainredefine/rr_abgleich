import { NextResponse } from "next/server";
import { getAssetsData } from "@/lib/odoo";
import { getPMData } from "@/lib/csv";
export const runtime = "nodejs";
export async function GET() {
  try {
    const [odoo, pm] = await Promise.all([getAssetsData(), getPMData()]);
    return NextResponse.json({ odoo, pm });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
