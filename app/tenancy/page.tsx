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

/* ===== Helpers (formatting) ===== */
const fmtInt = (v?: number) =>
  v == null || !Number.isFinite(v) || v === 0 ? "–" : Math.round(v).toLocaleString();
const fmtYears = (v?: number) =>
  v == null || !Number.isFinite(v) || v === 0 ? "–" : v.toFixed(2);
const fmtDeltaInt = (d: number | null, th: number) =>
  d == null || Math.abs(d) < th ? "–" : Math.round(d).toLocaleString();
const fmtDeltaYears = (d: number | null, th: number) =>
  d == null || Math.abs(d) < th ? "–" : d.toFixed(2);

/* ===== Helpers (filters/keys) ===== */
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

/* ===== Helpers (safe JSON & comments parsing, no any) ===== */
type CommentsResponse = { items: Array<{ id: string; comment: string | null }> };

function safeJson<T>(txt: string): T | null {
  try { return JSON.parse(txt) as T; } catch { return null; }
}
function parseComments(json: unknown): Array<{ id: string; comment: string | null }> {
  if (json && typeof json === "object" && json !== null && Array.isArray((json as { items?: unknown }).items)) {
    return (json as CommentsResponse).items;
  }
  if (Array.isArray(json)) {
    return (json as Array<{ id: unknown; comment?: unknown }>).filter(
      (x) => x && typeof x.id === "string"
    ) as Array<{ id: string; comment: string | null }>;
  }
  return [];
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

  /* Load base data (typed, no any) */
  useEffect(() => {
    (async () => {
      const res = await fetch("/tenancy/api", { cache: "no-store" });
      let json: unknown = null;
      try { json = await res.json(); } catch {}
      const obj = (json && typeof json === "object")
        ? (json as { pm?: TenantRow[]; odoo?: TenantRow[] })
        : {};

      const pmArr = Array.isArray(obj.pm) ? obj.pm : [];
      const odArr = Array.isArray(obj.odoo) ? obj.odoo : [];

      setPm(pmArr.filter((x) => !isHiddenTenant(x.tenant_name)));
      setOdoo(odArr.filter((x) => !isHiddenTenant(x.tenant_name)));
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

  /* Comments load (typed parse, no any) */
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
          const txt = await res.text();
          if (!txt) continue;
          const parsed = safeJson<CommentsResponse>(txt);
          const items = parseComments(parsed);
          for (const it of items) amObj[it.id] = it.comment ?? "";
        } catch {}
      }
      for (const group of chunk(ids, 120)) {
        try {
          const res = await fetch(`/tenancy/api/comments/pm?ids=${encodeURIComponent(group.join(","))}`, { cache: "no-store" });
          const txt = await res.text();
          if (!txt) continue;
          const parsed = safeJson<CommentsResponse>(txt);
          const items = parseComments(parsed);
          for (const it of items) pmObj[it.id] = it.comment ?? "";
        } catch {}
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
    } catch {}
  }

  /* ===== Dynamic grid with properly synced separators =====
     Layout order:
     [Asset, City, Tenant] | (SEP + GLA?) | SEP + Rent | (SEP + WALT?) | Comments x2
  */
  const gridMeta = useMemo(() => {
    const cols: string[] = [
      "70px",              // Asset
      "110px",             // City
      "minmax(180px,1fr)", // Tenant
    ];

    const wantGLA = !hideGLA;
    const wantWALT = !hideWALT;

    const pushSep = () => { cols.push("2px"); };
    const pushGLA = () => { cols.push("85px","85px","70px"); };
    const pushRent = () => { cols.push("95px","95px","70px"); };
    const pushWALT = () => { cols.push("70px","70px","70px"); };

    if (wantGLA) {
      pushSep();
      pushGLA();
    }

    // Always one SEP before Rent
    pushSep();
    pushRent();

    // If WALT is visible: SEP + WALT
    if (wantWALT) {
      pushSep();
      pushWALT();
    }

    // Comments (always at the end)
    cols.push("220px","220px");

    return { gridTemplate: cols.join(" ") };
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
        </header>

        {/* Table */}
        <div className="rowsWrapper">
          {/* Header row */}
          <div className="row headerRow" style={{ gridTemplateColumns: gridMeta.gridTemplate }}>
            <div>Asset</div>
            <div>City</div>
            <div>Tenant (AM)</div>

            {/* SEP + GLA (only if visible) */}
            {!hideGLA && <div className="sep" aria-hidden />}
            {!hideGLA && (
              <>
                <div className="right">Space Odoo</div>
                <div className="right">Space PM</div>
                <div className="right">Δ Space</div>
              </>
            )}

            {/* SEP before Rent (always once) */}
            <div className="sep" aria-hidden />

            {/* Rent group (always) */}
            <>
              <div className="right">Rent Odoo</div>
              <div className="right">Rent PM</div>
              <div className="right">Δ Rent</div>
            </>

            {/* SEP + WALT (only if visible) */}
            {!hideWALT && <div className="sep" aria-hidden />}
            {!hideWALT && (
              <>
                <div className="right">WALT Odoo</div>
                <div className="right">WALT PM</div>
                <div className="right">Δ WALT</div>
              </>
            )}

            {/* Comments */}
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
                <div
                  key={r.id + i}
                  className={`row dataRow ${rowClass}`}
                  style={{ gridTemplateColumns: gridMeta.gridTemplate }}
                >
                  <div>{r.asset}</div>
                  <div>{r.city || "–"}</div>
                  <div>{r.tenant}</div>

                  {/* SEP + GLA (only if visible) */}
                  {!hideGLA && <div className="sep" aria-hidden />}
                  {!hideGLA && (
                    <>
                      <div className="right">{fmtInt(r.odRow?.space)}</div>
                      <div className="right">{fmtInt(r.pmRow?.space)}</div>
                      <div className={`right ${showDS ? "deltaStrong" : ""}`}>{fmtDeltaInt(r.dS, SPACE_D)}</div>
                    </>
                  )}

                  {/* SEP before Rent (always once) */}
                  <div className="sep" aria-hidden />

                  {/* Rent group (always) */}
                  <>
                    <div className="right">{fmtInt(r.odRow?.rent)}</div>
                    <div className="right">{fmtInt(r.pmRow?.rent)}</div>
                    <div className={`right ${showDR ? "deltaStrong" : ""}`}>{fmtDeltaInt(r.dR, RENT_D)}</div>
                  </>

                  {/* SEP + WALT (only if visible) */}
                  {!hideWALT && <div className="sep" aria-hidden />}
                  {!hideWALT && (
                    <>
                      <div className="right">{fmtYears(r.odRow?.walt)}</div>
                      <div className="right">{fmtYears(r.pmRow?.walt)}</div>
                      <div className={`right ${showDW ? "deltaStrong" : ""}`}>{fmtDeltaYears(r.dW, WALT_D)}</div>
                    </>
                  )}

                  {/* Comments */}
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

        /* Header */
        .header { display:flex; flex-direction:column; align-items:center; gap:10px; margin-bottom:12px; }
        .title { margin:0; font-size:22px; font-weight:600; text-align:center; }

        .toolbar { display:flex; gap:12px; align-items:stretch; width:100%; max-width:1100px; }
        .search { position:relative; flex:1 1 360px; min-width:260px; }
        .search input { width:100%; box-sizing:border-box; padding:8px 28px 8px 10px; border:1px solid #d1d5db; border-radius:8px; background:#fff; }
        .search button { position:absolute; right:6px; top:4px; bottom:4px; width:22px; border:1px solid #d1d5db; border-radius:6px; background:#f3f4f6; }
        .toolbarRight { display:flex; flex:0 0 auto; gap:10px; align-items:center; }
        .toggle { display:flex; gap:6px; align-items:center; padding:0 6px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; height:36px; }
        .toolbarRight select { width:182px; min-width:160px; border:1px solid #d1d5db; border-radius:8px; padding:8px 10px; background:#fff; }

        @media (max-width: 1024px) {
          .toolbar { flex-wrap:wrap; }
          .toolbarRight { width:100%; justify-content:flex-end; flex-wrap:wrap; }
        }

        /* Table wrapper */
        .rowsWrapper { border:1px solid #e5e7eb; border-radius:10px; overflow-x:auto; overflow-y:auto; max-height:78vh; background:#fff; }

        /* Grid rows */
        .row { display:grid; align-items:center; column-gap:8px; }
        .row > div { padding:10px 12px; font-size:13px; min-width:0; border-top:0; }

        /* A single divider per row (avoid per-cell borders = no white stripes) */
        .rowsWrapper .row + .row { border-top: 1px solid #f1f5f9; }

        .headerRow { position:sticky; top:0; z-index:3; background:#f9fafb; font-weight:600; border-bottom:1px solid #e5e7eb; }
        .headerRow > div { white-space:nowrap; }
        .right { text-align:right; }

        /* True vertical separators as grid columns, drawn above highlight */
        .sep { padding:0 !important; border:0 !important; background:#111; min-width:0; position:relative; z-index:2; }

        /* Row highlight as a continuous ribbon under cells (fills gaps) */
        .dataRow { position: relative; background: transparent; }
        .dataRow.hl-red::before,
        .dataRow.hl-orange::before,
        .dataRow.hl-blue::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 0;
        }
        .dataRow.hl-red::before    { background: rgba(239, 68, 68, 0.22); }
        .dataRow.hl-orange::before { background: rgba(253, 186, 116, 0.25); }
        .dataRow.hl-blue::before   { background: rgba(147, 197, 253, 0.22); }
        .dataRow > div { position: relative; z-index: 1; }

        .deltaStrong { font-weight:700; }

        .commentCell { display:flex; align-items:center; gap:8px; }
        .comment { width:100%; min-height:34px; padding:6px 8px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; }

        /* Slight outline for textareas on colored rows to keep legibility */
        .dataRow.hl-red .comment,
        .dataRow.hl-orange .comment,
        .dataRow.hl-blue .comment {
          background:#fff;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.6);
        }

        .loading { padding:14px; }
      `}</style>
    </main>
  );
}
