"use client";
import { useEffect, useState } from "react";

/* ==== Auth partagée (24h) ==== */
const AUTH_KEY = "tenancy_auth_v3";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isAuthValid(): boolean {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw) as { ok?: string; ts?: number };
    if (obj?.ok !== "1" || typeof obj.ts !== "number") return false;
    return Date.now() - obj.ts < ONE_DAY_MS;
  } catch {
    return false;
  }
}
function setAuthNow() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ ok: "1", ts: Date.now() }));
}
function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export default function LandingProtected() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAuthed(isAuthValid());
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/tenancy/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthNow();     // session 24h
        setAuthed(true);
      } else setError("Incorrect password.");
    } catch {
      setError("Erreur de connexion.");
    }
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
        <form
          onSubmit={handleLogin}
          className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-gray-300 bg-gray-50 p-6 shadow-lg"
        >
          <h1 className="text-lg font-semibold text-center mb-2">Restricted access.</h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2"
          />
          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          <button
            type="submit"
            className="rounded-lg bg-black text-white py-2 mt-2 hover:bg-gray-800"
          >
            Entrer
          </button>
          <p className="text-xs text-gray-500 text-center mt-1">
            Automatic logout after 24h.
          </p>
        </form>
      </main>
    );
  }

  // Page visible APRÈS auth
  return (
    <main className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
      <div className="max-w-xl w-full p-6">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Select a view</h1>
          <button
            onClick={() => { clearAuth(); location.reload(); }}
            className="ml-auto rounded-lg border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
            title="Se déconnecter"
          >
            Logout
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a
            href="/compare"
            className="rounded-xl border border-gray-300 p-5 text-center hover:bg-gray-50 transition"
          >
            <div className="text-lg font-medium mb-1">Asset view</div>
            <div className="text-sm text-gray-500">Compare by Asset</div>
          </a>
          <a
            href="/tenancy"
            className="rounded-xl border border-gray-300 p-5 text-center hover:bg-gray-50 transition"
          >
            <div className="text-lg font-medium mb-1">Tenant view</div>
            <div className="text-sm text-gray-500">Compare by Tenant</div>
          </a>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          Session active pour 24h sur cet appareil.
        </p>
      </div>
    </main>
  );
}
