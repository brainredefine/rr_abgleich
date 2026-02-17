// app/api/route.ts — GET rows from Excel
import { NextResponse } from "next/server";
import { readRentRoll } from "@/lib/data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await readRentRoll();
    return NextResponse.json({ rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}