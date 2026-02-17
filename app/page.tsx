"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeForKey } from "@/lib/textnorm";

/* ══════════ Types ══════════ */

interface Row {
  asset: string;
  tenant: string;
  am: string;
  present: "am" | "pm" | "both";
  gla_am: number;
  gla_pm: number;
  rent_am: number;
  rent_pm: number;
  walt_am: number;
  walt_pm: number;
}

type Comments = Record<string, { am: string; pm: string }>;
type ViewFilter = "all" | "diffs" | "missing";
type PresenceFilter = "all" | "both" | "am" | "pm";
type LoadState = "loading" | "ready" | "error";

/* ══════════ Helpers ══════════ */

const fmt = (v: number) =>
  v === 0 ? "–" : Math.round(v).toLocaleString("de-DE");
const fmtW = (v: number) =>
  v === 0 ? "–" : v.toFixed(2);
const fmtDelta = (a: number, b: number, th: number, formatter: (n: number) => string) => {
  const d = a - b;
  return Math.abs(d) < th ? "" : formatter(d);
};

const isHidden = (name: string) => {
  const n = normalizeForKey(name);
  return n.includes("leerstand") || n.includes("vacant");
};

const mkKey = (r: Row) => `${r.asset.toUpperCase()}@@${normalizeForKey(r.tenant)}`;

/* ══════════ Thresholds ══════════ */

// Severe: GLA diff > 10 or Rent diff > 5
const TH_SEVERE = { GLA: 10, RENT: 5 } as const;
// Minor: any WALT diff > 0.3 (on top of severe checks)
const TH_WALT = 0.3;

/* ══════════ Row status ══════════ */

type RowStatus = "ok" | "minor" | "severe" | "missing_pm" | "missing_am";

function getStatus(r: { present: string; dGla: number; dRent: number; dWalt: number }): RowStatus {
  if (r.present === "am") return "missing_pm";
  if (r.present === "pm") return "missing_am";

  const severe = Math.abs(r.dGla) > TH_SEVERE.GLA || Math.abs(r.dRent) > TH_SEVERE.RENT;
  if (severe) return "severe";

  const minor = Math.abs(r.dWalt) > TH_WALT;
  if (minor) return "minor";

  return "ok";
}

/* ══════════ Debounced save ══════════ */

function useDebouncedSave(ms = 600) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  return useCallback(
    (id: string, type: "am" | "pm", comment: string) => {
      const k = `${type}:${id}`;
      const prev = timers.current.get(k);
      if (prev) clearTimeout(prev);
      timers.current.set(
        k,
        setTimeout(async () => {
          timers.current.delete(k);
          try {
            await fetch("/api/comments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, type, comment }),
            });
          } catch { /* non-critical */ }
        }, ms),
      );
    },
    [ms],
  );
}

/* ══════════ Display row ══════════ */

interface DisplayRow extends Row {
  id: string;
  dGla: number;
  dRent: number;
  dWalt: number;
  status: RowStatus;
}

/* ═══════════════════════════════════════
   Component
   ═══════════════════════════════════════ */

const POLL_INTERVAL = 10_000;

export default function RentRollPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const [q, setQ] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const [presFilter, setPresFilter] = useState<PresenceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<RowStatus | "all">("all");
  const [amFilter, setAmFilter] = useState("ALL");
  const [hideGLA, setHideGLA] = useState(false);
  const [hideWALT, setHideWALT] = useState(false);

  const [comments, setComments] = useState<Comments>({});
  const save = useDebouncedSave();
  const editingRef = useRef<string | null>(null);

  /* ── Load Excel rows ── */
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        if (!Array.isArray(json.rows)) throw new Error("unexpected response");
        if (!off) {
          setRows((json.rows as Row[]).filter((r) => !isHidden(r.tenant)));
          setLoadState("ready");
        }
      } catch (e) {
        if (!off) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setLoadState("error");
        }
      }
    })();
    return () => { off = true; };
  }, []);

  /* ── AM codes ── */
  const amCodes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.am) set.add(r.am);
    return [...set].sort();
  }, [rows]);

  /* ── Poll comments ── */
  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch("/api/comments", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.comments) {
        setComments((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(json.comments as Comments)) {
            const ed = editingRef.current;
            if (ed === `am:${k}`) next[k] = { am: next[k]?.am ?? v.am, pm: v.pm };
            else if (ed === `pm:${k}`) next[k] = { am: v.am, pm: next[k]?.pm ?? v.pm };
            else next[k] = v;
          }
          return next;
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchComments();
    const id = setInterval(fetchComments, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchComments]);

  /* ── Enriched + filtered rows ── */
  const qn = normalizeForKey(q);

  const display = useMemo<DisplayRow[]>(() => {
    return rows
      .map((r): DisplayRow => {
        const dGla = r.gla_am - r.gla_pm;
        const dRent = r.rent_am - r.rent_pm;
        const dWalt = r.walt_am - r.walt_pm;
        return { ...r, id: mkKey(r), dGla, dRent, dWalt, status: getStatus({ present: r.present, dGla, dRent, dWalt }) };
      })
      .filter((r) => {
        if (qn && !normalizeForKey(`${r.asset} ${r.tenant}`).includes(qn)) return false;
        if (amFilter !== "ALL" && r.am !== amFilter) return false;
        if (presFilter === "both" && r.present !== "both") return false;
        if (presFilter === "am" && r.present !== "am") return false;
        if (presFilter === "pm" && r.present !== "pm") return false;
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (view === "diffs" && r.status === "ok") return false;
        if (view === "missing" && r.present === "both") return false;
        return true;
      })
      .sort((a, b) =>
        a.asset === b.asset ? a.tenant.localeCompare(b.tenant) : a.asset.localeCompare(b.asset),
      );
  }, [rows, qn, amFilter, presFilter, statusFilter, view]);

  /* ── Comment handlers ── */
  const onFocus = useCallback((type: "am" | "pm", id: string) => { editingRef.current = `${type}:${id}`; }, []);
  const onBlur = useCallback(() => { editingRef.current = null; }, []);
  const onComment = useCallback(
    (id: string, type: "am" | "pm", val: string) => {
      setComments((prev) => ({
        ...prev,
        [id]: { am: prev[id]?.am ?? "", pm: prev[id]?.pm ?? "", [type]: val },
      }));
      save(id, type, val);
    },
    [save],
  );

  /* ── Grid columns ── */
  const gridCols = useMemo(() => {
    const c = ["70px", "48px", "minmax(150px, 1.2fr)", "1px"];
    if (!hideGLA) c.push("78px", "78px", "66px", "1px");
    c.push("90px", "90px", "70px");
    if (!hideWALT) c.push("1px", "64px", "64px", "64px");
    c.push("1px", "minmax(130px, 1fr)", "minmax(130px, 1fr)");
    return c.join(" ");
  }, [hideGLA, hideWALT]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    const severe = display.filter((r) => r.status === "severe").length;
    const minor = display.filter((r) => r.status === "minor").length;
    const missPm = display.filter((r) => r.status === "missing_pm").length;
    const missAm = display.filter((r) => r.status === "missing_am").length;
    return { severe, minor, missPm, missAm };
  }, [display]);

  /* ═══════ Render ═══════ */

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{font-size:13px;-webkit-font-smoothing:antialiased}
        body{font-family:'DM Sans',system-ui,sans-serif;background:#f7f6f3;color:#1c1917}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#c7c4bc;border-radius:3px}
      `}</style>

      <style jsx>{`
        .shell{min-height:100vh;display:flex;flex-direction:column}

        /* ── Navbar ── */
        .nav{
          background:#1a1d21;color:#d4d0c8;
          padding:8px 24px;min-height:50px;
          display:flex;align-items:center;gap:14px;
          position:sticky;top:0;z-index:30;
          border-bottom:2px solid #c9a84c;
          flex-wrap:wrap;
        }
        .brand{font-weight:700;font-size:15px;letter-spacing:.05em;color:#c9a84c;white-space:nowrap}
        .brand em{font-style:normal;color:#7c7a72;font-weight:400;margin-left:6px;font-size:12px}

        .search{position:relative;flex:1;max-width:300px;min-width:160px}
        .search input{
          width:100%;padding:7px 30px 7px 10px;
          background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
          border-radius:5px;color:#e0ddd5;font-family:inherit;font-size:12px;outline:none;
          transition:border-color .15s;
        }
        .search input::placeholder{color:#555}
        .search input:focus{border-color:#c9a84c}
        .search .x{
          position:absolute;right:5px;top:50%;transform:translateY(-50%);
          width:18px;height:18px;border:none;background:rgba(255,255,255,.08);
          border-radius:3px;color:#888;cursor:pointer;font-size:14px;
          display:flex;align-items:center;justify-content:center;
        }

        /* pill groups */
        .pills{display:flex}
        .pill{
          padding:6px 11px;
          background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
          color:#888;font-family:inherit;font-size:10.5px;font-weight:500;
          cursor:pointer;transition:all .1s;letter-spacing:.02em;
        }
        .pill:first-child{border-radius:5px 0 0 5px}
        .pill:last-child{border-radius:0 5px 5px 0}
        .pill.on{background:#c9a84c;border-color:#c9a84c;color:#1a1d21;font-weight:600}

        .am-pills{display:flex}
        .am-pill{
          padding:6px 10px;
          background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
          color:#777;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:500;
          cursor:pointer;transition:all .1s;letter-spacing:.04em;
        }
        .am-pill:first-child{border-radius:5px 0 0 5px}
        .am-pill:last-child{border-radius:0 5px 5px 0}
        .am-pill.on{background:#5b8a72;border-color:#5b8a72;color:#fff}

        .pres-pills{display:flex}
        .pres-pill{
          padding:6px 10px;
          background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
          color:#777;font-family:inherit;font-size:10.5px;font-weight:500;
          cursor:pointer;transition:all .1s;
        }
        .pres-pill:first-child{border-radius:5px 0 0 5px}
        .pres-pill:last-child{border-radius:0 5px 5px 0}
        .pres-pill.on{background:#6484aa;border-color:#6484aa;color:#fff;font-weight:600}

        .chk{display:flex;align-items:center;gap:4px;font-size:10.5px;color:#777;cursor:pointer;white-space:nowrap;user-select:none}
        .chk input{accent-color:#c9a84c}

        .color-pills{display:flex}
        .cpill{
          padding:6px 11px;
          background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
          color:#888;font-family:inherit;font-size:10.5px;font-weight:500;
          cursor:pointer;transition:all .1s;letter-spacing:.02em;
        }
        .cpill:first-child{border-radius:5px 0 0 5px}
        .cpill:last-child{border-radius:0 5px 5px 0}
        .cpill.on{background:var(--cpill-bg);border-color:var(--cpill-color);color:var(--cpill-color);font-weight:600}

        /* ── Status bar ── */
        .bar{
          display:flex;align-items:center;justify-content:space-between;
          padding:9px 24px;background:#eceae4;border-bottom:1px solid #d9d6ce;
          font-size:11.5px;color:#666;flex-wrap:wrap;gap:8px;
        }
        .bar .nums{display:flex;gap:16px;align-items:center}
        .bar b{color:#1c1917;font-variant-numeric:tabular-nums}
        .legend{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
        .leg{display:flex;align-items:center;gap:5px;font-size:10.5px}
        .dot{width:12px;height:5px;border-radius:2px;flex-shrink:0}
        .live{display:flex;align-items:center;gap:4px;font-size:10px;color:#888}
        .live::before{content:"";width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

        /* ── Grid ── */
        .wrap{flex:1;overflow:auto;padding:0 8px 24px}

        .hdr,.rw{display:grid;column-gap:5px;padding:0 14px}

        /* vertical center for all cells */
        .hdr{align-items:center}
        .rw{align-items:center}

        .hdr{
          position:sticky;top:0;z-index:10;
          background:#e2e0d9;border-bottom:2px solid #1a1d21;
        }
        .hdr .c{
          font-weight:600;font-size:10px;text-transform:uppercase;
          letter-spacing:.06em;color:#555;padding:10px 4px;white-space:nowrap;
        }

        .rw{
          border-bottom:1px solid #dddbd4;
          transition:background .06s;
          min-height:42px;
        }
        /* alternating subtle stripe */
        .rw:nth-child(even){background:rgba(0,0,0,.015)}
        .rw:hover{background:rgba(201,168,76,.06) !important}

        .c{padding:8px 4px;font-size:12.5px;min-width:0;line-height:1.4}
        .c.r{text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11.5px;white-space:nowrap}
        .c.nowrap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .c.am-badge{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.04em;color:#5b8a72}

        .sp{padding:0!important;position:relative;align-self:stretch}
        .sp::after{content:"";position:absolute;top:6px;bottom:6px;left:0;width:1px;background:#c5c3bb}

        /* ── Row status colors (4 tiers) — STRONG ── */

        /* Severe difference — bold red */
        .rw.st-severe{
          background:rgba(200,40,40,.22);
          border-left:4px solid #c82828;
        }
        .rw.st-severe:hover{background:rgba(200,40,40,.30) !important}

        /* Minor difference — warm amber */
        .rw.st-minor{
          background:rgba(217,170,50,.22);
          border-left:4px solid #d4a830;
        }
        .rw.st-minor:hover{background:rgba(217,170,50,.30) !important}

        /* Missing in PM (present=am) — orange */
        .rw.st-missing_pm{
          background:rgba(230,130,50,.22);
          border-left:4px solid #e07830;
        }
        .rw.st-missing_pm:hover{background:rgba(230,130,50,.30) !important}

        /* Missing in AM (present=pm) — blue */
        .rw.st-missing_am{
          background:rgba(60,120,200,.20);
          border-left:4px solid #3878c8;
        }
        .rw.st-missing_am:hover{background:rgba(60,120,200,.28) !important}

        /* OK rows get transparent left border for alignment */
        .rw.st-ok{border-left:4px solid transparent}

        .delta-minor{font-weight:600;color:#a08520}
        .delta-severe{font-weight:700;color:#c82828}

        /* ── Comments ── */
        .cm{
          width:100%;padding:5px 7px;border:1px solid transparent;border-radius:4px;
          background:transparent;font-family:inherit;font-size:11.5px;color:#333;
          resize:vertical;min-height:30px;
          white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;
          transition:border-color .12s,background .12s;
          field-sizing:content;
          line-height:1.4;
        }
        .cm:hover{background:rgba(0,0,0,.025);border-color:#d5d3cc}
        .cm:focus{outline:none;background:#fff;border-color:#c9a84c;box-shadow:0 0 0 2px rgba(201,168,76,.12)}

        /* ── States ── */
        .state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;gap:10px;color:#999}
        .spin{width:28px;height:28px;border:3px solid #e2e0da;border-top-color:#c9a84c;border-radius:50%;animation:sp .7s linear infinite}
        @keyframes sp{to{transform:rotate(360deg)}}
        .err{padding:8px 16px;background:rgba(220,53,69,.07);border:1px solid rgba(220,53,69,.18);border-radius:6px;color:#b83230;font-size:12px}

        @media(max-width:900px){
          .nav{padding:10px 16px;gap:10px}
          .wrap{padding:0 4px 16px}
          .hdr,.rw{padding:0 8px}
        }
      `}</style>

      <div className="shell">
        {/* ── Navbar ── */}
        <div className="nav">
          <div className="brand">RENT ROLL<em>AM vs PM</em></div>

          <div className="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset / tenant…" />
            {q && <button className="x" onClick={() => setQ("")}>×</button>}
          </div>

          <div className="pills">
            {(["all", "diffs", "missing"] as ViewFilter[]).map((v) => (
              <button key={v} className={`pill ${view === v ? "on" : ""}`} onClick={() => setView(v)}>
                {v === "all" ? "All" : v === "diffs" ? "Diffs" : "Missing"}
              </button>
            ))}
          </div>

          <div className="pres-pills">
            {(["all", "both", "am", "pm"] as PresenceFilter[]).map((p) => (
              <button key={p} className={`pres-pill ${presFilter === p ? "on" : ""}`} onClick={() => setPresFilter(p)}>
                {p === "all" ? "All" : p === "both" ? "Both" : p === "am" ? "AM only" : "PM only"}
              </button>
            ))}
          </div>

          {amCodes.length > 0 && (
            <div className="am-pills">
              <button className={`am-pill ${amFilter === "ALL" ? "on" : ""}`} onClick={() => setAmFilter("ALL")}>ALL</button>
              {amCodes.map((code) => (
                <button key={code} className={`am-pill ${amFilter === code ? "on" : ""}`} onClick={() => setAmFilter(amFilter === code ? "ALL" : code)}>
                  {code}
                </button>
              ))}
            </div>
          )}

          <div className="color-pills">
            <button className={`cpill ${statusFilter === "all" ? "on" : ""}`} onClick={() => setStatusFilter("all")} style={{"--cpill-color":"#888","--cpill-bg":"rgba(255,255,255,.08)"} as React.CSSProperties}>All</button>
            <button className={`cpill ${statusFilter === "severe" ? "on" : ""}`} onClick={() => setStatusFilter(statusFilter === "severe" ? "all" : "severe")} style={{"--cpill-color":"#c82828","--cpill-bg":"rgba(200,40,40,.25)"} as React.CSSProperties}>Severe</button>
            <button className={`cpill ${statusFilter === "minor" ? "on" : ""}`} onClick={() => setStatusFilter(statusFilter === "minor" ? "all" : "minor")} style={{"--cpill-color":"#b89420","--cpill-bg":"rgba(217,170,50,.25)"} as React.CSSProperties}>Minor</button>
            <button className={`cpill ${statusFilter === "missing_pm" ? "on" : ""}`} onClick={() => setStatusFilter(statusFilter === "missing_pm" ? "all" : "missing_pm")} style={{"--cpill-color":"#d06820","--cpill-bg":"rgba(230,130,50,.25)"} as React.CSSProperties}>Miss PM</button>
            <button className={`cpill ${statusFilter === "missing_am" ? "on" : ""}`} onClick={() => setStatusFilter(statusFilter === "missing_am" ? "all" : "missing_am")} style={{"--cpill-color":"#3070c0","--cpill-bg":"rgba(60,120,200,.25)"} as React.CSSProperties}>Miss AM</button>
            <button className={`cpill ${statusFilter === "ok" ? "on" : ""}`} onClick={() => setStatusFilter(statusFilter === "ok" ? "all" : "ok")} style={{"--cpill-color":"#5a8a5a","--cpill-bg":"rgba(80,140,80,.20)"} as React.CSSProperties}>OK</button>
          </div>

          <label className="chk"><input type="checkbox" checked={hideGLA} onChange={(e) => setHideGLA(e.target.checked)} />Hide GLA</label>
          <label className="chk"><input type="checkbox" checked={hideWALT} onChange={(e) => setHideWALT(e.target.checked)} />Hide WALT</label>
        </div>

        {/* ── Status bar ── */}
        {loadState === "ready" && (
          <div className="bar">
            <div className="nums">
              <span>Rows: <b>{display.length}</b></span>
            </div>
            <div className="legend">
              <span className="leg"><span className="dot" style={{ background: "#c82828" }} />{stats.severe} severe</span>
              <span className="leg"><span className="dot" style={{ background: "#d4a830" }} />{stats.minor} minor</span>
              <span className="leg"><span className="dot" style={{ background: "#e07830" }} />{stats.missPm} missing PM</span>
              <span className="leg"><span className="dot" style={{ background: "#3878c8" }} />{stats.missAm} missing AM</span>
              <div className="live">Live</div>
            </div>
          </div>
        )}

        {/* ── Grid ── */}
        <div className="wrap">
          {/* Header */}
          <div className="hdr" style={{ gridTemplateColumns: gridCols }}>
            <div className="c">Asset</div>
            <div className="c">AM</div>
            <div className="c">Tenant</div>
            <div className="c sp" />
            {!hideGLA && (<><div className="c r">GLA AM</div><div className="c r">GLA PM</div><div className="c r">Δ</div><div className="c sp" /></>)}
            <div className="c r">Rent AM</div>
            <div className="c r">Rent PM</div>
            <div className="c r">Δ</div>
            {!hideWALT && (<><div className="c sp" /><div className="c r">WALT AM</div><div className="c r">WALT PM</div><div className="c r">Δ</div></>)}
            <div className="c sp" />
            <div className="c">Comment AM</div>
            <div className="c">Comment PM</div>
          </div>

          {/* States */}
          {loadState === "loading" && <div className="state"><div className="spin" />Loading…</div>}
          {loadState === "error" && (
            <div className="state">
              <div className="err">⚠ {errorMsg}</div>
              <span style={{ fontSize: 11 }}>Check <code>public/data/rentroll.xlsx</code></span>
            </div>
          )}
          {loadState === "ready" && display.length === 0 && <div className="state">No rows match your filters.</div>}

          {/* Data rows */}
          {loadState === "ready" && display.map((r) => {
            const cm = comments[r.id] ?? { am: "", pm: "" };

            const deltaClassGR = (a: number, b: number, thSevere: number) => {
              const d = Math.abs(a - b);
              if (d > thSevere) return "delta-severe";
              return "";
            };
            const deltaClassW = (a: number, b: number) => {
              const d = Math.abs(a - b);
              if (d > TH_WALT) return "delta-minor";
              return "";
            };

            return (
              <div key={r.id} className={`rw st-${r.status}`} style={{ gridTemplateColumns: gridCols }}>
                <div className="c nowrap" title={r.asset}>{r.asset}</div>
                <div className="c am-badge">{r.am || "–"}</div>
                <div className="c nowrap" title={r.tenant}>{r.tenant}</div>
                <div className="c sp" />

                {!hideGLA && (<>
                  <div className="c r">{fmt(r.gla_am)}</div>
                  <div className="c r">{fmt(r.gla_pm)}</div>
                  <div className={`c r ${deltaClassGR(r.gla_am, r.gla_pm, TH_SEVERE.GLA)}`}>
                    {fmtDelta(r.gla_am, r.gla_pm, 1, (n) => Math.round(n).toLocaleString("de-DE"))}
                  </div>
                  <div className="c sp" />
                </>)}

                <div className="c r">{fmt(r.rent_am)}</div>
                <div className="c r">{fmt(r.rent_pm)}</div>
                <div className={`c r ${deltaClassGR(r.rent_am, r.rent_pm, TH_SEVERE.RENT)}`}>
                  {fmtDelta(r.rent_am, r.rent_pm, 1, (n) => Math.round(n).toLocaleString("de-DE"))}
                </div>

                {!hideWALT && (<>
                  <div className="c sp" />
                  <div className="c r">{fmtW(r.walt_am)}</div>
                  <div className="c r">{fmtW(r.walt_pm)}</div>
                  <div className={`c r ${deltaClassW(r.walt_am, r.walt_pm)}`}>
                    {fmtDelta(r.walt_am, r.walt_pm, 0.01, (n) => n.toFixed(2))}
                  </div>
                </>)}

                <div className="c sp" />
                <div className="c">
                  <textarea
                    className="cm"
                    value={cm.am}
                    onFocus={() => onFocus("am", r.id)}
                    onBlur={onBlur}
                    onChange={(e) => onComment(r.id, "am", e.target.value)}
                    placeholder="AM…"
                    rows={1}
                  />
                </div>
                <div className="c">
                  <textarea
                    className="cm"
                    value={cm.pm}
                    onFocus={() => onFocus("pm", r.id)}
                    onBlur={onBlur}
                    onChange={(e) => onComment(r.id, "pm", e.target.value)}
                    placeholder="PM…"
                    rows={1}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}