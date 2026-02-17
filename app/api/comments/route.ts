// app/api/comments/route.ts — Live comments via Supabase
//
// Table schema (create once in Supabase):
//
//   create table comments (
//     id          text primary key,
//     comment_am  text not null default '',
//     comment_pm  text not null default '',
//     updated_at  timestamptz not null default now()
//   );
//
//   -- optional: RLS policy allowing anon insert/update/select
//   alter table comments enable row level security;
//   create policy "open" on comments for all using (true) with check (true);

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

interface CommentRecord {
  id: string;
  comment_am: string;
  comment_pm: string;
}

/** GET /api/comments → all comments */
export async function GET() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("comments")
      .select("id, comment_am, comment_pm");

    if (error) throw new Error(error.message);

    // Return as a map { "AA1@@müller gmbh": { am: "...", pm: "..." }, ... }
    const map: Record<string, { am: string; pm: string }> = {};
    for (const r of (data ?? []) as CommentRecord[]) {
      map[r.id] = { am: r.comment_am ?? "", pm: r.comment_pm ?? "" };
    }

    return NextResponse.json({ comments: map });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/comments  body: { id, type: "am"|"pm", comment } */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const { id, type, comment } = body as Record<string, unknown>;

    if (typeof id !== "string" || !id.trim()) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    if (type !== "am" && type !== "pm") {
      return NextResponse.json({ error: "type must be am or pm" }, { status: 400 });
    }
    const text = typeof comment === "string" ? comment : "";

    const sb = getSupabase();
    const col = type === "am" ? "comment_am" : "comment_pm";

    // Upsert: create row if missing, update only the relevant column
    const { error } = await sb
      .from("comments")
      .upsert(
        { id: id.trim(), [col]: text, updated_at: new Date().toISOString() },
        { onConflict: "id", ignoreDuplicates: false },
      );

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}