import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Protège toutes les pages sauf /api et les assets
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map|txt)).*)",
  ],
};

function parseUsers(): Array<{ u: string; p: string }> {
  const raw = process.env.TENANCY_USERS_JSON || "[]";
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .filter(x => x && typeof x.u === "string" && typeof x.p === "string")
        .map(x => ({ u: x.u, p: x.p }));
    }
  } catch { /* ignore */ }
  return [];
}

export function middleware(req: NextRequest) {
  const users = parseUsers();

  // Dev-friendly: si pas configuré, ne bloque pas
  if (users.length === 0) {
    console.warn("[middleware] TENANCY_USERS_JSON vide → pas d'auth appliquée.");
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return challenge();

  try {
    const decoded = atob(auth.slice(6)); // "user:pass"
    const i = decoded.indexOf(":");
    if (i < 0) return challenge();
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);

    if (users.some(({ u, p }) => u === user && p === pass)) {
      return NextResponse.next();
    }
  } catch { /* ignore */ }

  return challenge();
}

function challenge() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Restricted"' },
  });
}
