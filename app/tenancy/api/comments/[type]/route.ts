// app/tenancy/api/comments/[type]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TableType = "am" | "pm";
interface CommentRow {
  id: string;
  comment: string | null;
}

function isTableType(x: unknown): x is TableType {
  return x === "am" || x === "pm";
}

function supa() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_API_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_API_KEY manquants");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function toRows(v: unknown): CommentRow[] {
  if (!Array.isArray(v)) return [];
  const out: CommentRow[] = [];
  for (const it of v) {
    if (it && typeof it === "object") {
      const obj = it as Record<string, unknown>;
      const idv = obj.id;
      const cv = obj.comment;
      if (typeof idv === "string") {
        out.push({
          id: idv,
          comment:
            typeof cv === "string"
              ? cv
              : cv == null
              ? null
              : String(cv), // coercition prudente
        });
      }
    }
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { type: TableType } }
) {
  try {
    const { type } = params;
    if (!isTableType(type)) {
      return NextResponse.json({ error: "bad type" }, { status: 400 });
    }

    const idsParam = req.nextUrl.searchParams.get("ids") || "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return NextResponse.json({ items: [] });

    const table = type === "am" ? "comments_am" : "comments_pm";
    const sb = supa();

    const { data, error } = await sb.from(table).select("id, comment").in("id", ids);
    if (error) throw new Error(error.message);

    const items = toRows(data);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message?: unknown }).message)
        : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { type: TableType } }
) {
  try {
    const { type } = params;
    if (!isTableType(type)) {
      return NextResponse.json({ error: "bad type" }, { status: 400 });
    }

    const bodyUnknown: unknown = await req.json().catch(() => ({}));
    const bodyObj =
      bodyUnknown && typeof bodyUnknown === "object"
        ? (bodyUnknown as Record<string, unknown>)
        : {};
    const id = typeof bodyObj.id === "string" ? bodyObj.id.trim() : "";
    const comment =
      typeof bodyObj.comment === "string" ? bodyObj.comment : String(bodyObj.comment ?? "");

    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const table = type === "am" ? "comments_am" : "comments_pm";
    const sb = supa();

    // upsert simple (id = clé)
    const { error } = await sb.from(table).upsert({ id, comment }, { onConflict: "id" });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message?: unknown }).message)
        : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
