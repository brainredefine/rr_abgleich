"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeForKey } from "@/lib/textnorm";

/* ══════════ Types ══════════ */

interface Row {
  asset: string;
  tenant: string;
  am: string;
  city: string;
  present: "am" | "pm" | "both";
  gla_am: number;
  gla_pm: number;
  rent_am: number;
  rent_pm: number;
  walt_am: number;
  walt_pm: number;
}

type Comments = Record<string, { am: string; pm: string }>;
type LoadState = "loading" | "ready" | "error";

/* ══════════ Helpers ══════════ */

const fmt = (v: number) =>
  v === 0 ? "–" : Math.round(v).toLocaleString("de-DE");
const fmtW = (v: number) =>
  v === 0 ? "–" : v.toFixed(2);
const signed = (n: number, body: string) => (n > 0 ? `+${body}` : body);
const fmtDelta = (a: number, b: number, th: number, formatter: (n: number) => string) => {
  const d = a - b;
  return Math.abs(d) < th ? "" : signed(d, formatter(d));
};

/* One colour per asset manager — the badge and its filter pill stay in step. */
const AM_COLORS: Record<string, string> = {
  BKO: "#4a7ba7",
  CFR: "#5b8a72",
  JSC: "#a8763e",
};
const amColor = (code: string) => AM_COLORS[code] ?? "#7c7a72";

const isHidden = (name: string) => {
  const n = normalizeForKey(name);
  return n.includes("leerstand") || n.includes("vacant") || n === "available";
};

const mkKey = (r: Row) => `${r.asset.toUpperCase()}@@${normalizeForKey(r.tenant)}`;

/* ══════════ Thresholds ══════════ */

// Severe: GLA diff > 10 or Rent diff > 5
const TH_SEVERE = { GLA: 10, RENT: 5 } as const;
// Minor: any WALT diff > 0.3 (on top of severe checks)
const TH_WALT = 0.3;

/* ══════════ Row status ══════════ */

type RowStatus = "ok" | "minor" | "severe" | "missing_pm" | "missing_am";

/* One filter, one meaning. "missing" always holds both sides at once — never one or
   the other — so an asset where a tenant drops out of Tabula and shows up in 3PM
   under another name puts the two rows side by side. */
type Filter = "all" | "severe" | "minor" | "missing" | "severe_missing" | "ok";

const MISS_DOT = "linear-gradient(90deg,#e07830 50%,#3878c8 50%)";
const SEV_MISS_DOT = "linear-gradient(90deg,#c82828 34%,#e07830 34% 67%,#3878c8 67%)";

const FILTERS: { id: Filter; label: string; color?: string; bg?: string; dot?: string; title?: string }[] = [
  { id: "all", label: "All" },
  {
    id: "severe", label: "Δ GLA/Rent", color: "#c82828", bg: "rgba(200,40,40,.18)",
    title: `GLA off by more than ${TH_SEVERE.GLA} m² or rent by more than ${TH_SEVERE.RENT} €`,
  },
  {
    id: "minor", label: "Δ WALT", color: "#a08520", bg: "rgba(217,170,50,.20)",
    title: `WALT off by more than ${TH_WALT} y, GLA and rent in line`,
  },
  {
    id: "missing", label: "Missing AM + PM", color: "#8a5a2b", bg: "rgba(190,120,50,.18)", dot: MISS_DOT,
    title: "Missing on either side — 3PM-only and Tabula-only rows together",
  },
  {
    id: "severe_missing", label: "Δ + Missing", color: "#9c3a4a", bg: "rgba(160,60,80,.16)", dot: SEV_MISS_DOT,
    title: "GLA/Rent differences and missing rows together — a lease merged on one side and split on the other shows up as both at once",
  },
  { id: "ok", label: "OK", color: "#5a8a5a", bg: "rgba(80,140,80,.16)" },
];

const isMissing = (s: RowStatus) => s === "missing_am" || s === "missing_pm";

const matchesFilter = (s: RowStatus, f: Filter): boolean => {
  if (f === "all") return true;
  if (f === "missing") return isMissing(s);
  if (f === "severe_missing") return s === "severe" || isMissing(s);
  return s === f;
};

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

function useDebouncedSave(onError: (msg: string | null) => void, ms = 600) {
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
            const res = await fetch("/api/comments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, type, comment }),
            });
            // A silent failure here used to lose comments without a trace.
            onError(res.ok ? null : `Comment not saved (HTTP ${res.status})`);
          } catch {
            onError("Comment not saved — server unreachable");
          }
        }, ms),
      );
    },
    [ms, onError],
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
  const [filter, setFilter] = useState<Filter>("all");
  const [suspectOnly, setSuspectOnly] = useState(false);
  const [amFilter, setAmFilter] = useState("ALL");
  const [hideGLA, setHideGLA] = useState(false);
  const [hideWALT, setHideWALT] = useState(false);

  const [comments, setComments] = useState<Comments>({});
  const [commentsErr, setCommentsErr] = useState<string | null>(null);
  const save = useDebouncedSave(setCommentsErr);
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
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCommentsErr(body?.error ? `Comments unavailable — ${body.error}` : `Comments unavailable (HTTP ${res.status})`);
        return;
      }
      setCommentsErr(null);
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
    } catch {
      setCommentsErr("Comments unavailable — server unreachable");
    }
  }, []);

  useEffect(() => {
    fetchComments();
    const id = setInterval(fetchComments, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchComments]);

  /* ── Enriched + filtered rows ── */
  const qn = normalizeForKey(q);

  const enriched = useMemo<DisplayRow[]>(() =>
    rows
      .map((r): DisplayRow => {
        const dGla = r.gla_am - r.gla_pm;
        const dRent = r.rent_am - r.rent_pm;
        const dWalt = r.walt_am - r.walt_pm;
        return { ...r, id: mkKey(r), dGla, dRent, dWalt, status: getStatus({ present: r.present, dGla, dRent, dWalt }) };
      })
      .sort((a, b) =>
        a.asset === b.asset ? a.tenant.localeCompare(b.tenant) : a.asset.localeCompare(b.asset),
      ),
  [rows]);

  /* Assets that miss a tenant on BOTH sides: almost always the same lease sitting
     under two names, i.e. a hole in the Mapping sheet rather than a real gap.
     Computed on the whole set — it is a property of the data, not of the search. */
  const suspectAssets = useMemo(() => {
    const pm = new Set<string>(), am = new Set<string>();
    for (const r of enriched) {
      if (r.status === "missing_pm") pm.add(r.asset);
      else if (r.status === "missing_am") am.add(r.asset);
    }
    return new Set([...pm].filter((a) => am.has(a)));
  }, [enriched]);

  const searched = useMemo(() =>
    enriched.filter((r) => {
      if (qn && !normalizeForKey(`${r.asset} ${r.tenant}`).includes(qn)) return false;
      if (amFilter !== "ALL" && r.am !== amFilter) return false;
      return true;
    }),
  [enriched, qn, amFilter]);

  /* The suspect rows themselves — not the whole asset, which would bury them under
     every matched tenant of a big centre. */
  const isSuspect = useCallback(
    (r: DisplayRow) =>
      suspectAssets.has(r.asset) && (r.status === "missing_am" || r.status === "missing_pm"),
    [suspectAssets],
  );

  /* Everything except the status filter — so the pill counts show what a click gives. */
  const scope = useMemo(
    () => (suspectOnly ? searched.filter(isSuspect) : searched),
    [searched, suspectOnly, isSuspect],
  );

  const suspectCount = useMemo(() => searched.filter(isSuspect).length, [searched, isSuspect]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f.id, 0])) as Record<Filter, number>;
    for (const r of scope) for (const f of FILTERS) if (matchesFilter(r.status, f.id)) c[f.id]++;
    return c;
  }, [scope]);

  const display = useMemo(
    () => scope.filter((r) => matchesFilter(r.status, filter)),
    [scope, filter],
  );

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
          background:linear-gradient(#20242a,#1a1d21);color:#d4d0c8;
          padding:9px 24px;min-height:52px;
          display:flex;align-items:center;gap:14px;
          position:sticky;top:0;z-index:30;
          border-bottom:1px solid #c9a84c;
          box-shadow:0 1px 0 rgba(201,168,76,.25), 0 4px 14px rgba(0,0,0,.18);
          flex-wrap:wrap;
        }
        .brand{
          display:flex;align-items:baseline;gap:7px;white-space:nowrap;
          font-weight:700;font-size:14.5px;letter-spacing:.08em;color:#c9a84c;
        }
        .brand em{
          font-style:normal;color:#84817a;font-weight:500;font-size:10px;
          letter-spacing:.1em;text-transform:uppercase;
        }

        .search{position:relative;flex:1;max-width:300px;min-width:170px}
        .search input{
          width:100%;padding:7px 30px 7px 11px;
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
          border-radius:6px;color:#e6e3db;font-family:inherit;font-size:12px;outline:none;
          transition:border-color .15s, background .15s, box-shadow .15s;
        }
        .search input::placeholder{color:#63605a}
        .search input:focus{
          border-color:#c9a84c;background:rgba(255,255,255,.09);
          box-shadow:0 0 0 3px rgba(201,168,76,.12);
        }
        .search .x{
          position:absolute;right:6px;top:50%;transform:translateY(-50%);
          width:18px;height:18px;border:none;background:rgba(255,255,255,.1);
          border-radius:4px;color:#9a968e;cursor:pointer;font-size:13px;line-height:1;
          display:flex;align-items:center;justify-content:center;transition:background .1s;
        }
        .search .x:hover{background:rgba(255,255,255,.18);color:#e6e3db}

        .am-pills{display:flex;gap:1px}
        .am-pill{
          padding:6px 11px;
          background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);
          color:#8b8880;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:500;
          cursor:pointer;transition:all .12s;letter-spacing:.06em;
        }
        .am-pill:hover{background:rgba(255,255,255,.09);color:#c8c4bb}
        .am-pill:first-child{border-radius:6px 0 0 6px}
        .am-pill:last-child{border-radius:0 6px 6px 0}
        .am-pill.on{
          background:var(--am);border-color:var(--am);color:#fff;font-weight:600;
        }

        .chk{display:flex;align-items:center;gap:4px;font-size:10.5px;color:#777;cursor:pointer;white-space:nowrap;user-select:none}
        .chk input{accent-color:#c9a84c}

        /* ── Filter bar — single source of truth, doubles as the colour legend ── */
        .bar{
          display:flex;align-items:center;justify-content:space-between;
          padding:8px 24px;background:#eceae4;border-bottom:1px solid #d9d6ce;
          font-size:11.5px;color:#666;flex-wrap:wrap;gap:8px;
        }
        .bar .nums{display:flex;gap:16px;align-items:center}
        .bar b{color:#1c1917;font-variant-numeric:tabular-nums}
        .live{display:flex;align-items:center;gap:4px;font-size:10px;color:#888}
        .offline{
          display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;
          color:#b83230;background:rgba(220,53,69,.08);border:1px solid rgba(220,53,69,.22);
          border-radius:5px;padding:3px 8px;cursor:help;
        }
        .offline::before{content:"";width:6px;height:6px;border-radius:50%;background:#c82828}

        .fbar{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
        .fpill{
          display:flex;align-items:center;gap:6px;
          padding:5px 10px;border-radius:5px;
          background:#f5f4f0;border:1px solid #d7d4cc;
          color:#5c5952;font-family:inherit;font-size:11px;font-weight:500;
          cursor:pointer;transition:all .1s;white-space:nowrap;
        }
        .fpill:hover{background:#fff;border-color:#bcb8ae}
        .fpill.on{
          background:var(--f-bg);border-color:var(--f-color);
          color:var(--f-color);font-weight:600;
        }
        .fpill .fdot{width:8px;height:8px;border-radius:2px;background:var(--f-color);flex-shrink:0}
        /* multi-tone dot for the combined filters — the legend stays honest about
           which row colours a click brings in (orange = miss PM, blue = miss AM) */
        .fpill .fdot.wide{width:16px}
        .fpill .n{font-family:'IBM Plex Mono',monospace;font-size:10px;opacity:.7;font-weight:500}
        .fpill.tgl{border-style:dashed}
        .sep{width:1px;height:18px;background:#d0cdc5;margin:0 3px}
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
          background:linear-gradient(#e7e5de,#dedcd4);
          border-bottom:1px solid #1a1d21;
          box-shadow:0 2px 6px rgba(0,0,0,.07);
        }
        .hdr .c{
          font-weight:600;font-size:9.5px;text-transform:uppercase;
          letter-spacing:.08em;color:#6a6760;padding:11px 4px;white-space:nowrap;
        }

        .rw{
          border-bottom:1px solid #e2e0d9;
          transition:background .08s;
          min-height:42px;
        }
        /* alternating subtle stripe */
        .rw:nth-child(even){background:rgba(0,0,0,.012)}
        .rw:hover{background:rgba(201,168,76,.08) !important}

        .c{padding:8px 4px;font-size:12.5px;min-width:0;line-height:1.4}
        .c.r{text-align:right;font-family:'IBM Plex Mono',monospace;font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
        .c.nowrap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .c.tenant{font-weight:500;color:#26221e}
        .c.asset{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#57534e;letter-spacing:.02em}
        .badge{
          display:inline-block;padding:2px 6px;border-radius:4px;
          font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:600;letter-spacing:.05em;
          color:#fff;background:var(--am);opacity:.92;
        }
        .badge.none{background:transparent;color:#b5b1a8;padding-left:0}

        .sp{padding:0!important;position:relative;align-self:stretch}
        .sp::after{content:"";position:absolute;top:6px;bottom:6px;left:0;width:1px;background:#c5c3bb}

        /* ── Row status colours — saturated rail, calmer fill ── */

        /* Severe difference — bold red */
        .rw.st-severe{
          background:rgba(200,40,40,.14);
          box-shadow:inset 3px 0 0 #c82828;
        }
        .rw.st-severe:hover{background:rgba(200,40,40,.22) !important}

        /* Minor difference — warm amber */
        .rw.st-minor{
          background:rgba(217,170,50,.16);
          box-shadow:inset 3px 0 0 #d4a830;
        }
        .rw.st-minor:hover{background:rgba(217,170,50,.24) !important}

        /* Missing in PM (present=am) — orange */
        .rw.st-missing_pm{
          background:rgba(230,130,50,.14);
          box-shadow:inset 3px 0 0 #e07830;
        }
        .rw.st-missing_pm:hover{background:rgba(230,130,50,.22) !important}

        /* Missing in AM (present=pm) — blue */
        .rw.st-missing_am{
          background:rgba(60,120,200,.13);
          box-shadow:inset 3px 0 0 #3878c8;
        }
        .rw.st-missing_am:hover{background:rgba(60,120,200,.21) !important}

        .rw{padding-left:17px;padding-right:14px}
        .hdr{padding-left:17px;padding-right:14px}

        .delta-minor{font-weight:600;color:#96791c}
        .delta-severe{font-weight:700;color:#c82828}

        /* ── Comments ── */
        .cm{
          width:100%;padding:5px 8px;border:1px solid transparent;border-radius:5px;
          background:transparent;font-family:inherit;font-size:11.5px;color:#3a3532;
          resize:vertical;min-height:30px;
          white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;
          transition:border-color .12s,background .12s,box-shadow .12s;
          field-sizing:content;
          line-height:1.45;
        }
        .cm::placeholder{color:#bdb9b0}
        .cm:hover{background:rgba(255,255,255,.6);border-color:#dbd8d1}
        .cm:focus{outline:none;background:#fff;border-color:#c9a84c;box-shadow:0 0 0 3px rgba(201,168,76,.14)}

        /* ── States ── */
        .state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:90px 20px;gap:12px;color:#a5a19a;font-size:12px}
        .spin{width:26px;height:26px;border:2.5px solid #e2e0da;border-top-color:#c9a84c;border-radius:50%;animation:sp .7s linear infinite}
        @keyframes sp{to{transform:rotate(360deg)}}
        .err{padding:9px 16px;background:rgba(220,53,69,.06);border:1px solid rgba(220,53,69,.2);border-radius:7px;color:#b83230;font-size:12px}

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

          {amCodes.length > 0 && (
            <div className="am-pills">
              <button
                className={`am-pill ${amFilter === "ALL" ? "on" : ""}`}
                onClick={() => setAmFilter("ALL")}
                style={{ "--am": "#7c7a72" } as React.CSSProperties}
              >
                ALL
              </button>
              {amCodes.map((code) => (
                <button
                  key={code}
                  className={`am-pill ${amFilter === code ? "on" : ""}`}
                  onClick={() => setAmFilter(amFilter === code ? "ALL" : code)}
                  style={{ "--am": amColor(code) } as React.CSSProperties}
                >
                  {code}
                </button>
              ))}
            </div>
          )}

          <label className="chk"><input type="checkbox" checked={hideGLA} onChange={(e) => setHideGLA(e.target.checked)} />Hide GLA</label>
          <label className="chk"><input type="checkbox" checked={hideWALT} onChange={(e) => setHideWALT(e.target.checked)} />Hide WALT</label>
        </div>

        {/* ── Filter bar (doubles as the colour legend) ── */}
        {loadState === "ready" && (
          <div className="bar">
            <div className="fbar">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`fpill ${filter === f.id ? "on" : ""}`}
                  onClick={() => setFilter(f.id)}
                  title={f.title}
                  style={{ "--f-color": f.color ?? "#666", "--f-bg": f.bg ?? "#e2e0d9" } as React.CSSProperties}
                >
                  {f.color && (
                    <span
                      className={`fdot ${f.dot ? "wide" : ""}`}
                      style={f.dot ? { background: f.dot } : undefined}
                    />
                  )}
                  {f.label}
                  <span className="n">{counts[f.id]}</span>
                </button>
              ))}

              <span className="sep" />

              <button
                className={`fpill tgl ${suspectOnly ? "on" : ""}`}
                onClick={() => setSuspectOnly((v) => !v)}
                title={`Only the missing rows of the ${suspectAssets.size} assets that miss a tenant on both sides at once — usually a hole in the Mapping sheet`}
                style={{ "--f-color": "#7c5aa6", "--f-bg": "rgba(124,90,166,.16)" } as React.CSSProperties}
              >
                Mapping ?
                <span className="n">{suspectCount}</span>
              </button>
            </div>

            <div className="nums">
              <span>Rows: <b>{display.length}</b></span>
              {commentsErr
                ? <div className="offline" title={commentsErr}>Comments offline</div>
                : <div className="live">Live</div>}
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
              <span style={{ fontSize: 11 }}>Check <code>public/data/SourceRR.xlsx</code></span>
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
                <div className="c nowrap asset" title={r.city ? `${r.asset} — ${r.city}` : r.asset}>{r.asset}</div>
                <div className="c">
                  <span
                    className={`badge ${r.am ? "" : "none"}`}
                    style={{ "--am": amColor(r.am) } as React.CSSProperties}
                  >
                    {r.am || "–"}
                  </span>
                </div>
                <div className="c nowrap tenant" title={r.tenant}>{r.tenant}</div>
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