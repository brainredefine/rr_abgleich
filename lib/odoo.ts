// lib/odoo.ts
import { AssetData } from "@/types";

/* ========= Config ========= */
export interface OdooConfig {
  url: string;
  db: string;
  user: string;
  apiKey: string;
}

/* ========= JSON-RPC infra ========= */
interface RpcError {
  code?: number;
  message: string;
  data?: { name?: string; message?: string; debug?: string };
}
interface RpcEnvelope<T> {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: RpcError;
}

async function postJsonRpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: payload }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Odoo RPC HTTP ${res.status}: ${body}`);
  }
  const data = (await res.json()) as RpcEnvelope<T>;
  if (data.error) {
    const dbg = data.error.data?.debug ? `\n${data.error.data.debug}` : "";
    throw new Error(`Odoo RPC error: ${data.error.message}${dbg}`);
  }
  if (typeof data.result === "undefined") {
    throw new Error("Odoo RPC: result undefined");
  }
  return data.result;
}
export function hasOdooEnv(cfg?: Partial<OdooConfig>): boolean {
  const url = cfg?.url ?? process.env.ODOO_URL ?? "";
  const db = cfg?.db ?? process.env.ODOO_DB ?? "";
  const user = cfg?.user ?? process.env.ODOO_USER ?? "";
  const apiKey = cfg?.apiKey ?? process.env.ODOO_API ?? "";
  return Boolean(url && db && user && apiKey);
}
/* ========= Types Odoo utiles ========= */
export interface OdooM2O<TId = number, TName = string> extends Array<TId | TName> {
  0: TId;
  1: TName;
}
const m2oId = (v: OdooM2O | false | null | undefined): number | null => {
  if (!v) return null; // couvre null/undefined/false
  const id = v[0];
  return typeof id === "number" ? id : null;
};

/* ========= Client Odoo ========= */
export class OdooClient {
  private cfg: OdooConfig;

  constructor(cfg?: Partial<OdooConfig>) {
    const url = cfg?.url ?? process.env.ODOO_URL ?? "";
    const db = cfg?.db ?? process.env.ODOO_DB ?? "";
    const user = cfg?.user ?? process.env.ODOO_USER ?? "";
    const apiKey = cfg?.apiKey ?? process.env.ODOO_API ?? "";
    this.cfg = { url, db, user, apiKey };
    if (!url || !db || !user || !apiKey) {
      throw new Error("Odoo env vars manquantes (ODOO_URL/DB/USER/API)");
    }
  }

  private async authenticate(): Promise<number> {
    const uid = await postJsonRpc<number>(`${this.cfg.url}/jsonrpc`, {
      service: "common",
      method: "authenticate",
      args: [this.cfg.db, this.cfg.user, this.cfg.apiKey, {}],
    });
    if (typeof uid !== "number" || Number.isNaN(uid)) {
      throw new Error("Échec d'authentification Odoo");
    }
    return uid;
  }

  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const uid = await this.authenticate();
    return postJsonRpc<T>(`${this.cfg.url}/jsonrpc`, {
      service: "object",
      method: "execute_kw",
      args: [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs ?? {}],
    });
  }

  /** search_read générique (pas de `any`) */
  async searchRead<T extends object>(
    model: string,
    domain: unknown[],
    fields: string[],
    limit = 5000,
    offset = 0
  ): Promise<T[]> {
    return this.executeKw<T[]>(model, "search_read", [domain], { fields, limit, offset });
  }
}

/* ========= Types des enregistrements pour getAssetsData ========= */
interface UnitRec {
  main_property_id: OdooM2O<number, string> | false | null;
  rentable_area: number | null;
}
interface TenancyRec {
  main_property_id: OdooM2O<number, string> | false | null;
  total_current_rent: number | null;
  date_end_display: string | null;
}
interface PropertyRefRec {
  id: number;
  reference_id: string | null;
}

/* ========= getAssetsData (ONLY units) =========
   - GLA: somme des units (property.property où main_property_id != false), puis /2 (choix actuel)
   - Rent: somme des tenancies par main_property_id
   - WALT: moyenne pondérée par le loyer des années restantes (>= 0)
   - reference_id: pris sur la main property
================================================ */
export async function getAssetsData(): Promise<AssetData[]> {
  const odoo = new OdooClient();

  // 1) GLA = sum of units by main_property_id
  const units = await odoo.searchRead<UnitRec>(
    "property.property",
    [["main_property_id", "!=", false]],
    ["main_property_id", "rentable_area"]
  );
  const glaByMain: Record<number, number> = {};
  for (const u of units) {
    const mid = m2oId(u.main_property_id);
    if (!mid) continue;
    const area = Number(u.rentable_area ?? 0) || 0;
    glaByMain[mid] = (glaByMain[mid] ?? 0) + area;
  }

  // 2) Tenancies for Rent + WALT inputs
  const tenancies = await odoo.searchRead<TenancyRec>(
    "property.tenancy",
    [["main_property_id", "!=", false]],
    ["main_property_id", "total_current_rent", "date_end_display"]
  );

  const rentByMain: Record<number, number> = {};
  const waltNumeratorByMain: Record<number, number> = {};   // Σ(rent * remainingYears)
  const waltDenominatorByMain: Record<number, number> = {}; // Σ(rent)

  const now = new Date();
  const msPerYear = 365.25 * 24 * 3600 * 1000;

  for (const t of tenancies) {
    const mid = m2oId(t.main_property_id);
    if (!mid) continue;

    const rent = Number(t.total_current_rent ?? 0) || 0;
    rentByMain[mid] = (rentByMain[mid] ?? 0) + rent;

    // WALT: remaining years from today to date_end_display (>=0)
    let remYears = 0;
    if (t.date_end_display) {
      const end = new Date(String(t.date_end_display));
      const diff = (end.getTime() - now.getTime()) / msPerYear;
      remYears = Math.max(0, diff);
    }
    if (rent > 0) {
      waltNumeratorByMain[mid] = (waltNumeratorByMain[mid] ?? 0) + rent * remYears;
      waltDenominatorByMain[mid] = (waltDenominatorByMain[mid] ?? 0) + rent;
    }
  }

  // 3) Main IDs to output
  const mainIds = Array.from(
    new Set([...Object.keys(glaByMain), ...Object.keys(rentByMain)].map((x) => Number(x)))
  );

  // 4) Get reference_id for each main
  const mains: PropertyRefRec[] = mainIds.length
    ? await odoo.searchRead<PropertyRefRec>(
        "property.property",
        [["id", "in", mainIds]],
        ["id", "reference_id"]
      )
    : [];

  const refById = new Map<number, string>(
    mains.map((m) => [m.id, (m.reference_id ?? String(m.id)).trim()])
  );

  // 5) Build output (GLA halved per your patch + thresholds)
  const out: AssetData[] = mainIds.map((id) => {
    const glaRaw = glaByMain[id] ?? 0;
    const glaFinal = glaRaw / 2; // choix actuel
    const walt =
      waltDenominatorByMain[id] && waltDenominatorByMain[id] > 0
        ? waltNumeratorByMain[id] / waltDenominatorByMain[id]
        : 0;

    return {
      reference_id: refById.get(id) ?? String(id),
      gla: glaFinal,
      rent: rentByMain[id] ?? 0,
      walt,
    };
  });

  out.sort((a, b) => (a.reference_id || "").localeCompare(b.reference_id || ""));
  return out;
}
