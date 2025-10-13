// lib/odoo.ts
import { AssetData } from "@/types";

/* ========= Config ========= */
export interface OdooConfig {
  url: string;
  db: string;
  user: string;
  /** Mot de passe OU API key (on supporte les 2) */
  passwordOrKey: string;
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
  if (typeof data.result === "undefined") throw new Error("Odoo RPC: result undefined");
  return data.result;
}

/* ========= Types Odoo utiles ========= */
export interface OdooM2O<TId = number, TName = string> extends Array<TId | TName> {
  0: TId;
  1: TName;
}
const m2oId = (v: OdooM2O | false | null | undefined): number | null => {
  if (!v) return null;
  const id = v[0];
  return typeof id === "number" ? id : null;
};

/* ========= Helpers ========= */
export function hasOdooEnv(cfg?: Partial<OdooConfig>): boolean {
  const url = cfg?.url ?? process.env.ODOO_URL ?? "";
  const db = cfg?.db ?? process.env.ODOO_DB ?? "";
  const user = cfg?.user ?? process.env.ODOO_USER ?? "";
  // compat: ODOO_API (token) OU ODOO_PWD (password)
  const pwdOrKey = cfg?.passwordOrKey ?? process.env.ODOO_API ?? process.env.ODOO_PWD ?? "";
  return Boolean(url && db && user && pwdOrKey);
}

/* ========= Client Odoo ========= */
export class OdooClient {
  private cfg: OdooConfig;

  constructor(cfg?: Partial<OdooConfig>) {
    const url = cfg?.url ?? process.env.ODOO_URL ?? "";
    const db = cfg?.db ?? process.env.ODOO_DB ?? "";
    const user = cfg?.user ?? process.env.ODOO_USER ?? "";
    // compat: on prend d’abord ODOO_API (token), puis ODOO_PWD
    const passwordOrKey =
      cfg?.passwordOrKey ?? process.env.ODOO_API ?? process.env.ODOO_PWD ?? "";
    this.cfg = { url, db, user, passwordOrKey };
    if (!hasOdooEnv(this.cfg)) {
      throw new Error("Odoo env vars manquantes (ODOO_URL/DB/USER/API ou PWD)");
    }
  }

  /** Auth simple, renvoie uid */
  async authenticate(): Promise<number> {
    const uid = await postJsonRpc<number>(`${this.cfg.url}/jsonrpc`, {
      service: "common",
      method: "authenticate",
      args: [this.cfg.db, this.cfg.user, this.cfg.passwordOrKey, {}],
    });
    if (typeof uid !== "number" || !Number.isFinite(uid) || uid <= 0) {
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
      args: [this.cfg.db, uid, this.cfg.passwordOrKey, model, method, args, kwargs ?? {}],
    });
  }

  /** search_read générique */
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

/* ========= getAssetsData ========= */
export async function getAssetsData(): Promise<AssetData[]> {
  const odoo = new OdooClient();

  // 1) units → GLA
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

  // 2) tenancies → Rent + WALT
  const tenancies = await odoo.searchRead<TenancyRec>(
    "property.tenancy",
    [["main_property_id", "!=", false]],
    ["main_property_id", "total_current_rent", "date_end_display"]
  );
  const rentByMain: Record<number, number> = {};
  const waltNum: Record<number, number> = {};
  const waltDen: Record<number, number> = {};
  const now = new Date();
  const msPerYear = 365.25 * 24 * 3600 * 1000;

  for (const t of tenancies) {
    const mid = m2oId(t.main_property_id);
    if (!mid) continue;
    const rent = Number(t.total_current_rent ?? 0) || 0;
    rentByMain[mid] = (rentByMain[mid] ?? 0) + rent;

    let remYears = 0;
    if (t.date_end_display) {
      const end = new Date(String(t.date_end_display));
      remYears = Math.max(0, (end.getTime() - now.getTime()) / msPerYear);
    }
    if (rent > 0) {
      waltNum[mid] = (waltNum[mid] ?? 0) + rent * remYears;
      waltDen[mid] = (waltDen[mid] ?? 0) + rent;
    }
  }

  // 3) mains & refs
  const mainIds = Array.from(
    new Set([...Object.keys(glaByMain), ...Object.keys(rentByMain)].map(Number))
  );
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

  // 4) output
  const out: AssetData[] = mainIds.map((id) => {
    const glaRaw = glaByMain[id] ?? 0;
    const glaFinal = glaRaw / 2; // ton choix actuel
    const walt =
      waltDen[id] && waltDen[id] > 0 ? waltNum[id] / waltDen[id] : 0;

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

/* ========= util: ping ========= */
export async function odooPing(): Promise<number> {
  const c = new OdooClient();
  return c.authenticate(); // renvoie le uid si OK
}
