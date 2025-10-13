// app/tenancy/api/ban-debug/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { loadBannedAssets } from "@/lib/banlist";

export async function GET() {
  const banned = Array.from(loadBannedAssets().values());
  return NextResponse.json({ banned, count: banned.length });
}
