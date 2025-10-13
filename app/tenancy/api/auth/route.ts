import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { password } = await req.json();
  const valid = process.env.PASSWORD;

  if (!valid || password !== valid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}