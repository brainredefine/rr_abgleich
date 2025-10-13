import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { buildPmToAmMatcher } from "@/lib/tenantMap";

function readCsvText(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  let utf8 = buf.toString("utf8");
  const hasHighBytes = buf.some((b) => b >= 0x80);
  const replacementCharCount = (utf8.match(/\uFFFD/g) || []).length;
  const asciiRatio = utf8.length > 0 ? (utf8.match(/[\x00-\x7F]/g) || []).length / utf8.length : 1;
  if (hasHighBytes && (replacementCharCount > 0 || asciiRatio > 0.98)) {
    try { return new TextDecoder("latin1").decode(buf); } catch {}
  }
  return utf8;
}

export async function GET() {
  try {
    const file = path.join(process.cwd(), "public", "data", "pm_datatenant.csv");
    if (!fs.existsSync(file)) return NextResponse.json({ items: [] });

    const text = readCsvText(file);
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const match = buildPmToAmMatcher();

    const items = parsed.data.map((row) => {
      const pm = String(row?.[2] ?? "").trim();
      if (!pm) return null;
      const r = match(pm);
      return { pm, mapped: r.mapped, reason: r.reason };
    }).filter(Boolean);

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
