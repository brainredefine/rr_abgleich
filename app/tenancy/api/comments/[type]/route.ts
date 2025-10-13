import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TableType = "am" | "pm";

function supa() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_API_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: TableType }> }) {
  try {
    const { type } = await ctx.params; // <-- important
    if (type !== "am" && type !== "pm") {
      return NextResponse.json({ error: "bad type" }, { status: 400 });
    }

    const idsParam = req.nextUrl.searchParams.get("ids") || "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return NextResponse.json({ items: [] });

    const table = type === "am" ? "comments_am" : "comments_pm";
    const sb = supa();
    const { data, error } = await sb.from(table).select("id, comment").in("id", ids);
    if (error) throw error;

    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ type: TableType }> }) {
  try {
    const { type } = await ctx.params; // <-- important
    if (type !== "am" && type !== "pm") {
      return NextResponse.json({ error: "bad type" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    const comment = String(body?.comment ?? "");
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const table = type === "am" ? "comments_am" : "comments_pm";
    const sb = supa();

    // upsert simple (id = clé)
    const { error } = await sb.from(table).upsert({ id, comment }, { onConflict: "id" });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
