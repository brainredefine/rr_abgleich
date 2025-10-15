"use client";
import { useEffect, useMemo, useState } from "react";
import { normalizeForKey } from "@/lib/textnorm";

/* ===== Types ===== */
type AM = "CFR" | "BKO" | "FKE" | "MSC" | "";
type TenantRow = {
  asset_ref: string;
  tenant_name: string;
  space: number;
  rent: number;
  walt?: number;
  city?: string;
  am?: AM;
};
type FilterMode = "none" | "highlighted" | "missing_rent";
type AMFilter = "ALL" | "CFR" | "BKO" | "FKE" | "MSC";

/* ===== Helpers ===== */
const fmtInt = (v?: number) =>
  v == null || !Number.isFinite(v) || v === 0 ? "–" : Math.round(v).toLocaleString();
const fmtYears = (v?: number) =>
  v == null || !Number.isFinite(v) || v === 0 ? "–" : v.toFixed(2);
const fmtDeltaInt = (d: number | null, th: number) =>
  d == null || Math.abs(d) < th ? "–" : Math.round(d).toLocaleString();
const fmtDeltaYears = (d: number | null, th: number) =>
  d == null || Math.abs(d) < th ? "–" : d.toFixed(2);

const isHiddenTenant = (name: string) => {
  const n = normalizeForKey(name);
  return n.includes("leerstand") || n.includes("vacant") || n.includes("stpfl") || n.includes("stfr");
};

const rowKey = (asset: string, tenant: string) =>
  `${asset.toUpperCase()}@@${normalizeForKey(tenant)}`;

const chunk = <T,>(arr: T[], size = 120): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/* ===== Safe parsing helpers (no any) ===== */
type ApiOk = {
  pm?: unknown;
  odoo?: unknown;
};

function safeJson<T>(txt: string): T | null {
  try { return JSON.parse(txt) as T; } catch { return null; }
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isTenantRow(v: unknown): v is TenantRow {
  if (!isRecord(v)) return false;
  const hasAsset = typeof v.asset_ref === "string";
  const hasTenant = typeof v.tenant_name === "string";
  const spaceOk = !("space" in v) || typeof v.space === "number";
  const rentOk  = !("rent" in v) || typeof v.rent === "number";
  const waltOk  = !("walt" in v) || typeof v.walt === "number" || typeof v.walt === "undefined";
  const cityOk  = !("city" in v) || typeof v.city === "string" || typeof v.city === "undefined";
  const amOk    = !("am" in v) || typeof v.am === "string" || typeof v.am === "undefined";
  return hasAsset && hasTenant && spaceOk && rentOk && waltOk && cityOk && amOk;
}
function toTenantList(v: unknown): TenantRow[] {
  if (!Array.isArray(v)) return [];
  const out: TenantRow[] = [];
  for (const it of v) if (isTenantRow(it)) out.push(it);
  return out;
}

/* ===== Component ===== */
export default function TenancyComparePage() {
  /* Data */
  const [pm, setPm] = useState<TenantRow[] | null>(null);
  const [odoo, setOdoo] = useState<TenantRow[] | null>(null);

  /* Filters */
  const [q, setQ] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("none");
  const [amFilter, setAmFilter] = useState<AMFilter>("ALL");
  const [hideGLA, setHideGLA] = useState(false);
  const [hideWALT, setHideWALT] = useState(false);

  /* Comments */
  const [comAM, setComAM] = useState<Record<string, string>>({});
  const [comPM, setComPM] = useState<Record<string, string>>({});

  /* Thresholds */
  const SPACE_HL = 1, RENT_HL = 5, WALT_HL = 0.5;
  const SPACE_D  = 1, RENT_D  = 5, WALT_D  = 0.2;

  /* Load */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/tenancy/api", { cache: "no-store" });
        const txt = await res.text();
        const obj = safeJson<ApiOk>(txt) ?? {};
        const rawPm = toTenantList(obj.pm);
        const rawOdoo = toTenantList(obj.odoo);

        const filterVisible = (x: TenantRow) => !isHiddenTenant(x.tenant_name);
        setPm(rawPm.filter(filterVisible));
        setOdoo(rawOdoo.filter(filterVisible));
      } catch {
        setPm([]);
        setOdoo([]);
      }
    })();
  }, []);

  /* Indexes */
  const pmIdx = useMemo(() => {
    const m = new Map<string, TenantRow>();
    for (const r of pm ?? []) m.set(rowKey(r.asset_ref, r.tenant_name), r);
    return m;
  }, [pm]);
  const odooIdx = useMemo(() => {
    const m = new Map<string, TenantRow>();
    for (const r of odoo ?? []) m.set(rowKey(r.asset_ref, r.tenant_name), r);
    return m;
  }, [odoo]);
  const allKeys = useMemo(
    () => new Set<string>([...pmIdx.keys(), ...odooIdx.keys()]),
    [pmIdx, odooIdx]
  );

  /* Guess AM by asset if missing */
  const assetAMGuess = useMemo(() => {
    const map = new Map<string, AM>();
    const feed = (rows: TenantRow[] | null) => {
      for (const r of rows ?? []) {
        const am = (r.am ?? "") as AM;
        if (am && !map.has(r.asset_ref)) map.set(r.asset_ref, am);
      }
    };
    feed(pm);
    feed(odoo);
    return map;
  }, [pm, odoo]);

  const qn = normalizeForKey(q);

  /* Combined rows */
  const rows = useMemo(() => {
    const list = Array.from(allKeys).map((k) => {
      const [asset, tKey] = k.split("@@");
      const pmRow = pmIdx.get(k) || null;
      const odRow = odooIdx.get(k) || null;

      const tenant = pmRow?.tenant_name ?? odRow?.tenant_name ?? tKey.replaceAll(" ", " ");
      const city = odRow?.city || pmRow?.city || "";
      const am: AM =
        (pmRow?.am as AM) ||
        (odRow?.am as AM) ||
        (assetAMGuess.get(pmRow?.asset_ref ?? odRow?.asset_ref ?? asset) as AM) ||
        "";

      const dS = odRow && pmRow ? odRow.space - pmRow.space : null;
      const dR = odRow && pmRow ? odRow.rent - pmRow.rent : null;
      const dW = odRow && pmRow ? (odRow.walt ?? 0) - (pmRow.walt ?? 0) : null;

      const diff =
        (dS !== null && Math.abs(dS) > SPACE_HL) ||
        (dR !== null && Math.abs(dR) > RENT_HL) ||
        (dW !== null && Math.abs(dW) > WALT_HL);

      return {
        id: k, asset, city, am, tenant, pmRow, odRow, dS, dR, dW,
        onlyPM: !!pmRow && !odRow,
        onlyOdoo: !!odRow && !pmRow,
        diff,
      };
    });

    return list
      .filter((r) => !qn || normalizeForKey(`${r.asset} ${r.city} ${r.tenant}`).includes(qn))
      .filter((r) => (amFilter === "ALL" ? true : r.am === amFilter))
      .filter((r) => {
        if (filterMode === "highlighted") return r.diff || r.onlyPM || r.onlyOdoo;
        if (filterMode === "missing_rent")
          return r.onlyPM || r.onlyOdoo || (r.dR !== null && Math.abs(r.dR) > 5);
        return true;
      })
      .sort((a, b) =>
        a.asset === b.asset ? a.tenant.localeCompare(b.tenant) : a.asset.localeCompare(b.asset)
      );
  }, [allKeys, pmIdx, odooIdx, qn, amFilter, filterMode, assetAMGuess]);

  /* Subtotal (rows after filters) */
  const subtotal = rows.length;

  /* Comments load */
  useEffect(() => {
    if (!pm || !odoo) return;
    const idsSet = new Set<string>();
    for (const r of pm) idsSet.add(rowKey(r.asset_ref, r.tenant_name));
    for (const r of odoo) idsSet.add(rowKey(r.asset_ref, r.tenant_name));
    const ids = Array.from(idsSet);
    if (!ids.length) return;

    (async () => {
      const amObj: Record<string, string> = {};
      const pmObj: Record<string, string> = {};

      for (const group of chunk(ids, 120)) {
        try {
          const res = await fetch(`/tenancy/api/comments/am?ids=${encodeURIComponent(group.join(","))}`, { cache: "no-store" });
          const txt = await res.text(); if (!txt) continue;
          const json = safeJson<{ items: Array<{ id: string; comment: string | null }> }>(txt);
          const items = Array.isArray(json?.items) ? json!.items : [];
          for (const it of items) amObj[it.id] = it.comment ?? "";
        } catch { /* ignore */ }
      }

      for (const group of chunk(ids, 120)) {
        try {
          const res = await fetch(`/tenancy/api/comments/pm?ids=${encodeURIComponent(group.join(","))}`, { cache: "no-store" });
          const txt = await res.text(); if (!txt) continue;
          const json = safeJson<{ items: Array<{ id: string; comment: string | null }> }>(txt);
          const items = Array.isArray(json?.items) ? json!.items : [];
          for (const it of items) pmObj[it.id] = it.comment ?? "";
        } catch { /* ignore */ }
      }

      setComAM(amObj);
      setComPM(pmObj);
    })();
  }, [pm, odoo]);

  async function saveComment(type: "am" | "pm", id: string, comment: string) {
    try {
      await fetch(`/tenancy/api/comments/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, comment }),
      });
    } catch { /* ignore */ }
  }

  /* ===== Dynamic grid with true separators that don't kill background ===== */
  const gridTemplateColumns = useMemo(() => {
    const cols: string[] = [
      "70px",                  // Asset
      "110px",                 // City
      "minmax(160px, 420px)",  // Tenant
    ];
    const pushSep = () => cols.push("1px");
    const pushGLA = () => cols.push("85px","85px","70px");
    const pushRent = () => cols.push("95px","95px","70px");
    const pushWALT = () => cols.push("70px","70px","70px");

    const wantGLA = !hideGLA;
    const wantWALT = !hideWALT;

    pushSep();
    if (wantGLA) { pushGLA(); pushSep(); }
    pushRent();
    if (wantWALT) { pushSep(); pushWALT(); }
    cols.push("220px","220px");
    return cols.join(" ");
  }, [hideGLA, hideWALT]);

  const loading = !pm || !odoo;

  return (
    <main className="white-root">
      <div className="container">
        {/* Header */}
        <header className="header">
          <h1 className="title">Rent Roll — Odoo vs PM</h1>

          <div className="toolbar">
            <div className="search">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search: Asset / City / Tenant…"
                aria-label="Search"
              />
              {q && (
                <button onClick={() => setQ("")} aria-label="Clear">
                  ×
                </button>
              )}
            </div>

            <div className="toolbarRight">
              <label className="toggle">
                <input type="checkbox" checked={hideGLA} onChange={(e) => setHideGLA(e.target.checked)} />
                Hide GLA
              </label>
              <label className="toggle">
                <input type="checkbox" checked={hideWALT} onChange={(e) => setHideWALT(e.target.checked)} />
                Hide WALT
              </label>

              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                aria-label="View"
              >
                <option value="none">View: All</option>
                <option value="highlighted">View: Highlighted</option>
                <option value="missing_rent">View: Missing & rent diff</option>
              </select>

              <select
                value={amFilter}
                onChange={(e) => setAmFilter(e.target.value as AMFilter)}
                aria-label="AM filter"
              >
                <option value="ALL">AM — All</option>
                <option value="CFR">CFR</option>
                <option value="BKO">BKO</option>
                <option value="FKE">FKE</option>
                <option value="MSC">MSC</option>
              </select>
            </div>
          </div>

          {/* Legend + Subtotal (same row) */}
          <div className="legendBar">
            <div className="subtotal">
              Subtotal&nbsp;: <strong>{subtotal}</strong>
            </div>
            <div className="legend">
              <span className="legendItem hl-red">Matching issues</span>
              <span className="legendItem hl-orange">Missing in Odoo</span>
              <span className="legendItem hl-blue">Missing in 3PM</span>
            </div>
          </div>
        </header>

        {/* Table */}
        <div className="rowsWrapper">
          {/* Header row */}
          <div className="row headerRow" style={{ gridTemplateColumns }}>
            <div>Asset</div>
            <div>City</div>
            <div>Tenant (AM)</div>

            <div className="sep" aria-hidden />

            {!hideGLA && (
              <>
                <div className="right">GLA Odoo</div>
                <div className="right">GLA PM</div>
                <div className="right">Δ GLA</div>
                <div className="sep" aria-hidden />
              </>
            )}

            <div className="right">Rent Odoo</div>
            <div className="right">Rent PM</div>
            <div className="right">Δ Rent</div>

            {!hideWALT && (
              <>
                <div className="sep" aria-hidden />
                <div className="right">WALT Odoo</div>
                <div className="right">WALT PM</div>
                <div className="right">Δ WALT</div>
              </>
            )}

            <div>AM comment</div>
            <div>PM comment</div>
          </div>

          {/* Data rows */}
          {loading ? (
            <div className="loading">Loading…</div>
          ) : (
            rows.map((r, i) => {
              const rowClass = r.diff ? "hl-red" : r.onlyPM ? "hl-orange" : r.onlyOdoo ? "hl-blue" : "";
              const showDS = r.dS !== null && Math.abs(r.dS) >= SPACE_D;
              const showDR = r.dR !== null && Math.abs(r.dR) >= RENT_D;
              const showDW = r.dW !== null && Math.abs(r.dW) >= WALT_D;

              return (
                <div key={r.id + i} className={`row dataRow ${rowClass}`} style={{ gridTemplateColumns }}>
                  <div>{r.asset}</div>
                  <div>{r.city || "–"}</div>
                  <div>{r.tenant}</div>

                  <div className="sep" aria-hidden />

                  {!hideGLA && (
                    <>
                      <div className="right">{fmtInt(r.odRow?.space)}</div>
                      <div className="right">{fmtInt(r.pmRow?.space)}</div>
                      <div className={`right ${showDS ? "deltaStrong" : ""}`}>{fmtDeltaInt(r.dS, SPACE_D)}</div>
                      <div className="sep" aria-hidden />
                    </>
                  )}

                  <div className="right">{fmtInt(r.odRow?.rent)}</div>
                  <div className="right">{fmtInt(r.pmRow?.rent)}</div>
                  <div className={`right ${showDR ? "deltaStrong" : ""}`}>{fmtDeltaInt(r.dR, RENT_D)}</div>

                  {!hideWALT && (
                    <>
                      <div className="sep" aria-hidden />
                      <div className="right">{fmtYears(r.odRow?.walt)}</div>
                      <div className="right">{fmtYears(r.pmRow?.walt)}</div>
                      <div className={`right ${showDW ? "deltaStrong" : ""}`}>{fmtDeltaYears(r.dW, WALT_D)}</div>
                    </>
                  )}

                  <div className="commentCell">
                    <textarea
                      className="comment"
                      value={comAM[r.id] ?? ""}
                      onChange={(e) => setComAM((s) => ({ ...s, [r.id]: e.target.value }))}
                      onBlur={(e) => saveComment("am", r.id, e.target.value)}
                      placeholder="AM note…"
                    />
                  </div>
                  <div className="commentCell">
                    <textarea
                      className="comment"
                      value={comPM[r.id] ?? ""}
                      onChange={(e) => setComPM((s) => ({ ...s, [r.id]: e.target.value }))}
                      onBlur={(e) => saveComment("pm", r.id, e.target.value)}
                      placeholder="PM note…"
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style jsx>{`
        .white-root { min-height: 100vh; background:#fff; color:#111; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif; }
        .container { max-width: 1600px; margin: 0 auto; padding: 16px 28px 24px; }

        .header { display:flex; flex-direction:column; align-items:center; gap:10px; margin-bottom:8px; }
        .title { margin:0; font-size:22px; font-weight:600; text-align:center; }

        .toolbar { display:flex; gap:12px; align-items:stretch; width:100%; max-width:1100px; }
        .search { position:relative; flex:1 1 360px; min-width:260px; }
        .search input { width:100%; box-sizing:border-box; padding:8px 28px 8px 10px; border:1px solid #d1d5db; border-radius:8px; background:#fff; }
        .search button { position:absolute; right:6px; top:4px; bottom:4px; width:22px; border:1px solid #d1d5db; border-radius:6px; background:#f3f4f6; }
        .toolbarRight { display:flex; flex:0 0 auto; gap:10px; align-items:center; }
        .toggle { display:flex; gap:6px; align-items:center; padding:0 6px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; height:36px; }
        .toolbarRight select { width:182px; min-width:160px; border:1px solid #d1d5db; border-radius:8px; padding:8px 10px; background:#fff; }

        /* Legend row with subtotal on the left */
        .legendBar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
          max-width: 1100px;
          margin-top: 6px;
        }
        .subtotal {
          font-size: 13px;
          color: #374151;
        }
        .legend {
          display: flex;
          gap: 12px;
          font-size: 13px;
          color: #374151;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .legendItem {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 6px;
          background: #f3f4f6;
        }
        .hl-red.legendItem { background: rgba(239, 68, 68, 0.22); }
        .hl-orange.legendItem { background: rgba(253, 186, 116, 0.25); }
        .hl-blue.legendItem { background: rgba(147, 197, 253, 0.22); }

        .rowsWrapper { border:1px solid #e5e7eb; border-radius:10px; overflow-x:auto; overflow-y:auto; max-height:78vh; }

        .row { display:grid; align-items:center; column-gap:10px; }
        .row > div { padding:10px 12px; font-size:13px; min-width:0; }

        .headerRow { position:sticky; top:0; z-index:1; background:#f9fafb; font-weight:600; border-bottom:1px solid #e5e7eb; }
        .headerRow > div { white-space:nowrap; }

        .dataRow { border-top:1px solid #f1f5f9; }
        .dataRow:hover { background:rgba(0,0,0,0.02); }
        .right { text-align:right; }

        /* Vertical separator that doesn't kill row background */
        .sep { padding:0 !important; position:relative; }
        .sep::after { content:""; position:absolute; top:0; bottom:0; left:0; width:1px; background:#111; }

        .hl-red    { background: rgba(239, 68, 68, 0.22); }
        .hl-orange { background: rgba(253, 186, 116, 0.25); }
        .hl-blue   { background: rgba(147, 197, 253, 0.22); }

        .deltaStrong { font-weight:700; }

        .commentCell { display:flex; align-items:center; gap:8px; }
        .comment { width:100%; min-height:34px; padding:6px 8px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; }

        .loading { padding:14px; }
        @media (max-width: 640px) {
          .legendBar { flex-direction: column; align-items: stretch; }
          .legend { justify-content: center; }
        }
      `}</style>
    </main>
  );
}
