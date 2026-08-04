// lib/source.ts — Turns the raw SourceRR workbook into the flat AM/PM comparison rows.
//
// Source workbook (public/data/SourceRR.xlsx) has 3 sheets + 1 optional:
//
//   3PM      Asset ID | Name | Key | GLA | WALT | RENT      (PM side, several rows per Key)
//   Tabula   Asset ID | Name | Key | GLA | WALT | RENT | City   (AM side, one row per unit)
//   Mapping  Unit ID (Tabula) | Tenant ID (3PM)            (authoritative match,
//            repeat a unit on several rows when 3PM splits it over several leases)
//   AM       Asset ID | AM                                  (optional, overrides assetManagers.json)
//
// Rules:
//  • 3PM is aggregated per (Asset ID, Key): GLA and RENT are summed, WALT is taken
//    from the line with the largest GLA.
//  • A Tabula unit is matched to a 3PM tenancy only through the Mapping sheet
//    (empty "Tenant ID (3PM)" = no counterpart). No fuzzy name matching.
//  • Tabula units left without a 3PM tenancy  → present: "am"  (missing from 3PM).
//    3PM tenancies left without a Tabula unit → present: "pm"  (missing from Tabula).
//  • Output rows are keyed on (asset, tenant) — same identity as before, so the
//    comments stored in Supabase stay attached to their row.

import type { RentRollRow } from "@/types";
import { normalizeForKey } from "@/lib/textnorm";
import assetManagers from "@/lib/assetManagers.json";

export type RawRow = Record<string, unknown>;

export interface SourceSheets {
  pm: RawRow[];
  tabula: RawRow[];
  mapping: RawRow[];
  /** Optional "AM" sheet: Asset ID | AM */
  am?: RawRow[];
}

/* ── cell helpers ── */

/** Lower-cases + trims every header so "Asset ID", "asset id", "ASSET_ID" all work. */
function normalizeRow(r: RawRow): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(r)) out[k.toLowerCase().trim().replace(/\s+/g, " ")] = v;
  return out;
}

function str(r: RawRow, ...names: string[]): string {
  for (const n of names) {
    const v = r[n];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function num(r: RawRow, ...names: string[]): number {
  for (const n of names) {
    const v = r[n];
    if (v == null || v === "") continue;
    const x = Number(v);
    if (Number.isFinite(x)) return x; // non-numeric markers ("M2M", "n/a", …) fall through to 0
  }
  return 0;
}

/* Ampova / Amperio / Climova are one and the same counterparty for us. 3PM books them
   under a dozen different labels and sometimes merges the two entities into a single
   tenancy, so they are folded into one row per asset — otherwise nothing lines up. */
const AMPOVA_RE = /amperio|climova|ampova/i;
const AMPOVA_LABEL = "Ampova (Amperio/Climova)";
const canonicalTenant = (name: string) => (AMPOVA_RE.test(name) ? AMPOVA_LABEL : name);

/* Assets 3PM does not manage at all — they only ever produce "missing PM" noise.
   AA32 is listed twice because Tabula exports it under that Asset ID while its own
   unit keys already read "AD3 - 1". */
const EXCLUDED_ASSETS = new Set(["AA32", "AD3", "AC1", "AC2", "AC3", "AC4", "AD1", "AD2"]);

const ASSET = ["asset id", "assetid", "asset"];
const NAME = ["name", "tenant", "mieter"];
const KEY = ["key", "unit id", "tenant id"];
const CITY = ["city", "ort", "__empty", "__empty_6"];

/* ── aggregates ── */

interface Tenancy {
  asset: string;
  key: string;
  name: string;
  gla: number;
  rent: number;
  walt: number;
  /** GLA of the line the WALT was taken from — the largest one wins. */
  waltGla: number;
  city: string;
}

function newTenancy(asset: string, key: string): Tenancy {
  return { asset, key, name: "", gla: 0, rent: 0, walt: 0, waltGla: -Infinity, city: "" };
}

/** 3PM leaves the Name blank on ~40 lines — fall back to the lease id so the
 *  tenancies stay distinct instead of collapsing into one nameless row per asset. */
function label(t: Tenancy): string {
  return t.name || (t.key ? `#${t.key}` : "(no name)");
}

/** Folds one source line into a tenancy: GLA/RENT summed, WALT from the largest GLA. */
function fold(t: Tenancy, name: string, gla: number, rent: number, walt: number, city: string) {
  t.gla += gla;
  t.rent += rent;
  if (gla > t.waltGla) {
    t.waltGla = gla;
    t.walt = walt;
    t.name = name || t.name;
  }
  if (!t.name) t.name = name;
  if (!t.city) t.city = city;
}

/* ── main ── */

export function buildRentRoll(sheets: SourceSheets): RentRollRow[] {
  const pmRows = sheets.pm.map(normalizeRow);
  const tabulaRows = sheets.tabula.map(normalizeRow);
  const mappingRows = sheets.mapping.map(normalizeRow);

  /* 1 ─ 3PM aggregated per (asset, key).
        The Key alone is not unique: the same tenancy id shows up under two
        Asset IDs when a property exists twice in the systems. */
  const pmByAssetKey = new Map<string, Tenancy>();
  for (const r of pmRows) {
    const asset = str(r, ...ASSET);
    const key = str(r, ...KEY);
    if ((!asset && !key) || EXCLUDED_ASSETS.has(asset)) continue;
    const id = `${asset}||${key}`;
    let t = pmByAssetKey.get(id);
    if (!t) { t = newTenancy(asset, key); pmByAssetKey.set(id, t); }
    fold(t, str(r, ...NAME), num(r, "gla"), num(r, "rent"), num(r, "walt"), "");
  }

  /* 2 ─ Tabula units (one row each) */
  const tabulaByUnit = new Map<string, Tenancy>();
  for (const r of tabulaRows) {
    const asset = str(r, ...ASSET);
    const key = str(r, ...KEY);
    if ((!asset && !key) || EXCLUDED_ASSETS.has(asset)) continue;
    const t = newTenancy(asset, key);
    fold(t, str(r, ...NAME), num(r, "gla"), num(r, "rent"), num(r, "walt"), str(r, ...CITY));
    tabulaByUnit.set(key, t);
  }

  /* 3 ─ Mapping: Tabula unit → 3PM key(s). Empty = no counterpart. Repeat the unit on
        several rows when 3PM splits one Tabula unit over several leases (AA128: unit
        "AA128 - 1" = leases 754.10001.01 + 754.40001.01). */
  const unitToPmKeys = new Map<string, string[]>();
  for (const r of mappingRows) {
    const unit = str(r, "unit id (tabula)", "unit id", "tabula", "unit");
    const tenant = str(r, "tenant id (3pm)", "tenant id", "3pm", "key");
    if (!unit || !tenant) continue;
    const keys = unitToPmKeys.get(unit);
    if (!keys) unitToPmKeys.set(unit, [tenant]);
    else if (!keys.includes(tenant)) keys.push(tenant);
  }

  /* 4 ─ City + AM per asset */
  const cityByAsset = new Map<string, string>();
  for (const t of tabulaByUnit.values()) {
    if (t.city && !cityByAsset.has(t.asset)) cityByAsset.set(t.asset, t.city);
  }

  const amByAsset = new Map<string, string>(
    Object.entries(assetManagers as Record<string, string>),
  );
  for (const r of (sheets.am ?? []).map(normalizeRow)) {
    const asset = str(r, ...ASSET);
    const am = str(r, "am", "asset manager", "manager");
    if (asset && am) amByAsset.set(asset, am);
  }

  /* 5 ─ Output rows, keyed on asset + normalized tenant name */
  interface Out {
    asset: string;
    tenant: string;
    gla_am: number; rent_am: number; walt_am: number; waltGlaAm: number;
    gla_pm: number; rent_pm: number; walt_pm: number; waltGlaPm: number;
    hasAm: boolean; hasPm: boolean;
  }

  const out = new Map<string, Out>();
  const rowFor = (asset: string, rawTenant: string): Out => {
    const tenant = canonicalTenant(rawTenant);
    const id = `${asset.toUpperCase()}@@${normalizeForKey(tenant)}`;
    let r = out.get(id);
    if (!r) {
      r = {
        asset, tenant,
        gla_am: 0, rent_am: 0, walt_am: 0, waltGlaAm: -Infinity,
        gla_pm: 0, rent_pm: 0, walt_pm: 0, waltGlaPm: -Infinity,
        hasAm: false, hasPm: false,
      };
      out.set(id, r);
    }
    return r;
  };

  /* 5a ─ Units and 3PM leases form a bipartite graph. Both directions happen:
         one unit → several leases (3PM splits it, AA128) and one lease → several
         units (3PM merges them, AA56). Each connected component is one tenancy,
         so figures are summed once on each side whatever the shape. */
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined) { parent.set(x, x); return x; }
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const t of tabulaByUnit.values()) {
    find(`U:${t.key}`);
    for (const pmKey of unitToPmKeys.get(t.key) ?? []) {
      const pmId = `${t.asset}||${pmKey}`;
      if (pmByAssetKey.has(pmId)) union(`U:${t.key}`, `P:${pmId}`);
    }
  }

  interface Comp { units: Tenancy[]; pms: Tenancy[] }
  const comps = new Map<string, Comp>();
  const compOf = (node: string): Comp => {
    const root = find(node);
    let c = comps.get(root);
    if (!c) { c = { units: [], pms: [] }; comps.set(root, c); }
    return c;
  };
  for (const t of tabulaByUnit.values()) compOf(`U:${t.key}`).units.push(t);
  for (const [pmId, t] of pmByAssetKey) compOf(`P:${pmId}`).pms.push(t);

  /* 5b ─ One row per component. Tabula names the row when it has a say; the largest
         GLA (then rent) wins when a component holds several tenancies. */
  const biggest = (list: Tenancy[]) =>
    list.reduce((a, b) => (b.gla > a.gla || (b.gla === a.gla && b.rent > a.rent) ? b : a));

  for (const c of comps.values()) {
    const namer = biggest(c.units.length ? c.units : c.pms);
    const row = rowFor(namer.asset, label(namer));

    for (const u of c.units) {
      row.hasAm = true;
      row.gla_am += u.gla;
      row.rent_am += u.rent;
      if (u.gla > row.waltGlaAm) { row.waltGlaAm = u.gla; row.walt_am = u.walt; }
    }
    for (const p of c.pms) {
      row.hasPm = true;
      row.gla_pm += p.gla;
      row.rent_pm += p.rent;
      if (p.gla > row.waltGlaPm) { row.waltGlaPm = p.gla; row.walt_pm = p.walt; }
    }
  }

  return [...out.values()]
    .map((r): RentRollRow => ({
      asset: r.asset,
      tenant: r.tenant,
      am: (amByAsset.get(r.asset) ?? "").toUpperCase(),
      city: cityByAsset.get(r.asset) ?? "",
      present: r.hasAm && r.hasPm ? "both" : r.hasAm ? "am" : "pm",
      gla_am: r.gla_am, gla_pm: r.gla_pm,
      rent_am: r.rent_am, rent_pm: r.rent_pm,
      walt_am: r.walt_am, walt_pm: r.walt_pm,
    }))
    // No surface and no rent on either side — a lone WALT means nothing, drop it.
    .filter((r) => r.gla_am || r.gla_pm || r.rent_am || r.rent_pm)
    .sort((a, b) => (a.asset === b.asset ? a.tenant.localeCompare(b.tenant) : a.asset.localeCompare(b.asset)));
}
