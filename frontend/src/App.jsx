import React, { useState, useEffect } from "react";

// El backend FastAPI sirve los datos reales. En dev corre en :8000.
// En produccion (Railway) esto apunta al backend desplegado — se toma de la
// variable de entorno de Vite, con fallback a localhost para desarrollo.
const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Token de sesion (persiste en localStorage) ──────────────────────────────
const getToken = () => localStorage.getItem("bulldesk_token");
const setToken = (t) => localStorage.setItem("bulldesk_token", t);
const clearToken = () => localStorage.removeItem("bulldesk_token");

// fetch que agrega el token y detecta sesion caida (401 -> limpia y recarga).
async function authFetch(path) {
  const token = getToken();
  // Sin token no llamamos al backend: el gate de login se encarga. Evita el
  // loop de 401 -> reload durante el login.
  if (!token) throw new Error("Sin sesion");
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Habia token pero el backend lo rechazo (sesion caida / backend reiniciado).
    clearToken();
    throw new Error("Sesion expirada");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}


// ─────────────────────────────────────────────────────────────────────────────
// Datos reales de la cartera de Hernán (snapshot 2026-08-13). En producción esto
// viene de fetch("http://localhost:8000/api/positions"). Acá van embebidos para
// iterar el diseño con la forma y los valores reales.
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) =>
  n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n, d = 0) => (n == null ? "—" : (n < 0 ? "-$" : "$") + fmt(Math.abs(n), d));
const signed = (n, d = 0) => (n == null ? "—" : (n >= 0 ? "+" : "-") + "$" + fmt(Math.abs(n), d));

// Semáforo funcional. El color cruza DOS ejes: DIRECCIÓN (signo del P&L) y
// URGENCIA (alert_level que ya calculó el monitor). El backend puede mandar
// NORMAL/WATCH/ACTION/URGENT; el mismo nivel se dispara ganando (take profit) o
// perdiendo (stop), así que el nivel solo no alcanza — hay que cruzarlo con el
// signo para no pintar igual una ganadora al 70% (tomar ganancia) que un stop.
//   ganando (WATCH/ACTION) -> verde ; ganando URGENT -> verde + glow (tomar ya)
//   perdiendo (WATCH/ACTION) -> amarillo ; perdiendo URGENT -> rojo + glow (stop)
//   NORMAL, o sin pnl_pct (sin precio) -> gris, nunca un color que mienta.
const SEM = { gris: "#3d444d", verde: "#3fb950", amarillo: "#d29922", rojo: "#f85149" };
const GLOW = { "#3fb950": "rgba(63,185,80,0.15)", "#f85149": "rgba(248,81,73,0.15)" };

const levelOf = (p) => {
  const lvl = p.alert_level;
  if (!lvl || lvl === "NORMAL" || p.pnl_pct == null) {
    return { dot: SEM.gris, glow: "transparent", urgent: false, label: "normal" };
  }
  const ganando = p.pnl_pct >= 0;
  const urgent  = lvl === "URGENT";
  const dot = ganando ? SEM.verde : (urgent ? SEM.rojo : SEM.amarillo);
  const label = ganando ? (urgent ? "tomar ganancia" : "ganando")
                        : (urgent ? "stop" : "vigilar");
  return { dot, glow: urgent ? GLOW[dot] : "transparent", urgent, label };
};

function Pulse({ book }) {
  const e = book.exposure;
  const pnlPos = e.total_pnl >= 0;
  return (
    <div className="pulse">
      <div className="pulse-card">
        <div className="pulse-label">P&L abierto</div>
        <div className="pulse-value" style={{ color: pnlPos ? "#3fb950" : "#f85149" }}>
          {signed(e.total_pnl)}
        </div>
        <div className="pulse-sub">{e.open_count} posiciones</div>
      </div>
      <div className="pulse-card">
        <div className="pulse-label">Riesgo desplegado</div>
        <div className="pulse-value">{money(e.total_max_loss)}</div>
        <div className="pulse-sub">{fmt(e.pct_of_capital, 1)}% del capital</div>
      </div>
      <div className="pulse-card pulse-card--wide">
        <div className="pulse-label">Tope de riesgo ({e.risk_pct != null ? fmt(e.risk_pct, 0) : "—"}%)</div>
        <div className="pulse-value" style={{ fontSize: "1.4rem" }}>
          {money(e.total_max_loss)} <span className="pulse-of">/ {money(e.risk_cap)}</span>
        </div>
        <div className="gauge">
          <div
            className="gauge-fill"
            style={{
              width: `${Math.min(e.pct_of_cap_used, 100)}%`,
              background: e.pct_of_cap_used > 90 ? "#f85149" : e.pct_of_cap_used > 70 ? "#d29922" : "#3fb950",
            }}
          />
        </div>
        <div className="pulse-sub">
          {fmt(e.pct_of_cap_used, 0)}% consumido · {money(e.margin_to_open)} para abrir
        </div>
      </div>
    </div>
  );
}

function PositionCard({ p, onClick }) {
  const lv = levelOf(p);
  const pnlPos = (p.pnl ?? 0) >= 0;
  const pctMax = p.profit_pct_of_max != null ? p.profit_pct_of_max * 100 : null;
  return (
    <div className="pcard" style={{ borderLeftColor: lv.dot }} onClick={onClick}>
      <div className="pcard-head">
        <div className="pcard-tk">
          <span className="dot" style={{ background: lv.dot, boxShadow: lv.urgent ? `0 0 6px ${lv.dot}` : "none" }} />
          <span className="mono ticker">{p.ticker}</span>
          <span className="mono dim pcard-type">{p.type} {p.strike_low}/{p.strike_high}</span>
        </div>
        <div className="mono pcard-pnl" style={{ color: pnlPos ? "#3fb950" : "#f85149" }}>
          {signed(p.pnl)}
          {p.pnl_pct != null && <span className="dim pcard-roi"> {fmt(p.pnl_pct, 1)}%</span>}
        </div>
      </div>
      <div className="pcard-grid mono">
        <div><span className="dim">riesgo</span> {money(p.max_loss)}</div>
        <div><span className="dim">exp</span> {p.expiration?.slice(5)}</div>
        <div><span className="dim">% máx</span> {pctMax != null ? fmt(pctMax, 0) + "%" : "—"}</div>
      </div>
      <div className="maxbar-track pcard-bar">
        <div className="maxbar-fill" style={{
          width: `${Math.max(0, Math.min(pctMax ?? 0, 100))}%`, background: lv.dot }} />
      </div>
    </div>
  );
}

function PositionRow({ p, onClick }) {
  const lv = levelOf(p);
  const pnlPos = (p.pnl ?? 0) >= 0;
  const pctMax = p.profit_pct_of_max != null ? p.profit_pct_of_max * 100 : null;
  return (
    <tr style={{ background: lv.glow, cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      <td>
        <span className="dot" style={{ background: lv.dot, boxShadow: lv.urgent ? `0 0 6px ${lv.dot}` : "none" }} />
      </td>
      <td className="mono ticker">{p.ticker}</td>
      <td className="mono dim">{p.type}</td>
      <td className="mono">{p.strike_low}/{p.strike_high}</td>
      <td className="mono dim">{p.expiration?.slice(5)}</td>
      <td className="mono num">{money(p.max_loss)}</td>
      <td className="mono num" style={{ color: pnlPos ? "#3fb950" : "#f85149", fontWeight: 600 }}>
        {signed(p.pnl)}
      </td>
      <td className="mono num dim">{p.pnl_pct != null ? fmt(p.pnl_pct, 1) + "%" : "—"}</td>
      <td>
        <div className="maxbar-track">
          <div
            className="maxbar-fill"
            style={{
              width: `${Math.max(0, Math.min(pctMax ?? 0, 100))}%`,
              background: lv.dot,
            }}
          />
        </div>
      </td>
    </tr>
  );
}

// Columnas ordenables: clave (campo del dato), etiqueta, y tipo de orden.
// 'num' ordena numérico; 'str' alfabético. El semáforo (dot) no se ordena.
const COLS = [
  { key: "ticker",            label: "ticker",   kind: "str", cls: "" },
  { key: "type",              label: "tipo",     kind: "str", cls: "" },
  { key: "strike_low",        label: "strikes",  kind: "num", cls: "" },
  { key: "expiration",        label: "exp",      kind: "str", cls: "" },
  { key: "max_loss",          label: "riesgo",   kind: "num", cls: "num" },
  { key: "pnl",               label: "P&L",      kind: "num", cls: "num" },
  { key: "pnl_pct",           label: "ROI",      kind: "num", cls: "num" },
  { key: "profit_pct_of_max", label: "% del máx", kind: "num", cls: "" },
];

function Book({ book, onRowClick }) {
  // Orden por defecto: P&L descendente (las que más ganan/pierden arriba).
  const [sortKey, setSortKey] = useState("pnl");
  const [sortDir, setSortDir] = useState("desc");

  const onSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...book.positions].sort((a, b) => {
    const col = COLS.find((c) => c.key === sortKey) || COLS[5];
    let va = a[sortKey], vb = b[sortKey];
    // nulls al fondo siempre
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    let cmp;
    if (col.kind === "num") {
      cmp = Number(va) - Number(vb);
    } else {
      cmp = String(va).localeCompare(String(vb));
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <>
      <Pulse book={book} />

      {/* Selector de orden — visible solo en móvil (los cards no tienen thead) */}
      <div className="sort-mobile">
        <span className="dim">ordenar:</span>
        {COLS.filter((c) => ["max_loss", "pnl", "pnl_pct", "profit_pct_of_max"].includes(c.key)).map((c) => (
          <button key={c.key}
            className={sortKey === c.key ? "sortchip active" : "sortchip"}
            onClick={() => onSort(c.key)}>
            {c.label}{sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
          </button>
        ))}
      </div>

      {/* Vista DESKTOP: tabla */}
      <div className="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th></th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`sortable ${c.cls}`}
                  onClick={() => onSort(c.key)}
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="sort-arrow"> {sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => <PositionRow key={p.id} p={p} onClick={() => onRowClick && onRowClick(p.id)} />)}
          </tbody>
        </table>
      </div>

      {/* Vista MÓVIL: cards apilados */}
      <div className="pcard-list mobile-only">
        {sorted.map((p) => <PositionCard key={p.id} p={p} onClick={() => onRowClick && onRowClick(p.id)} />)}
      </div>
    </>
  );
}

function EquityCurve() {
  const [eq, setEq] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("days");   // "days" | "range"
  const [days, setDays] = useState(90);
  const [fromD, setFromD] = useState("");
  const [toD, setToD] = useState("");
  const [hover, setHover] = useState(null);    // índice del punto bajo el cursor
  const [showSpy, setShowSpy] = useState(false);
  const [spy, setSpy] = useState(null);
  const [twr, setTwr] = useState(null);        // rendimiento ajustado por flujos
  const [chartView, setChartView] = useState("pnl");  // "pnl" | "nlv" | "twr"

  const rangeQS = () => {
    if (mode === "range" && (fromD || toD)) {
      const qs = new URLSearchParams();
      if (fromD) qs.set("from_date", fromD);
      if (toD) qs.set("to_date", toD);
      return qs.toString();
    }
    return `days=${days}`;
  };

  useEffect(() => {
    authFetch(`/api/equity?${rangeQS()}`)
      .then((d) => { setEq(d); setError(null); })
      .catch((e) => setError(e.message));
    // TWR / P&L real (worker-api, via backend). Degrada suave si no está.
    setTwr(null);
    authFetch(`/api/twr?${rangeQS()}`)
      .then((d) => setTwr(d))
      .catch(() => setTwr({ available: false }));
  }, [mode, days, fromD, toD]);

  // SPY se trae aparte y solo cuando se activa el toggle (evita llamar yfinance
  // si no se usa). CLAVE: SPY usa el rango de fechas REAL del NLV (start_at/end_at
  // del summary), no 'days' — sino "siempre" (days=99999) traeria 27 años de SPY
  // contra 3 meses de NLV. Asi SPY siempre matchea el periodo real de la cartera.
  useEffect(() => {
    if (!showSpy) return;
    if (!eq || !eq.summary) return;
    setSpy(null);
    const from = eq.summary.start_at.slice(0, 10);
    const to   = eq.summary.end_at.slice(0, 10);
    authFetch(`/api/spy?from_date=${from}&to_date=${to}`)
      .then((d) => setSpy(d))
      .catch(() => setSpy({ series: [], error: "no se pudo cargar SPY" }));
  }, [showSpy, eq]);

  if (error) return <div className="state">No se pudo cargar el patrimonio ({error}).</div>;
  if (!eq) return <div className="state">Cargando patrimonio…</div>;

  const rangeControls = (
    <div className="eq-controls">
      <div className="range-picker">
        {[30, 60, 90].map((d) => (
          <button key={d}
            className={mode === "days" && days === d ? "chip active" : "chip"}
            onClick={() => { setMode("days"); setDays(d); }}>{d}d</button>
        ))}
        <button
          className={mode === "days" && days >= 99999 ? "chip active" : "chip"}
          onClick={() => { setMode("days"); setDays(99999); }}>siempre</button>
      </div>
      <div className="date-range">
        <input type="date" value={fromD} max={toD || undefined}
          onChange={(e) => { setFromD(e.target.value); setMode("range"); }} className="date-in" />
        <span className="dim">→</span>
        <input type="date" value={toD} min={fromD || undefined}
          onChange={(e) => { setToD(e.target.value); setMode("range"); }} className="date-in" />
        {(fromD || toD) && (
          <button className="chip" onClick={() => { setFromD(""); setToD(""); setMode("days"); setDays(90); }}>✕</button>
        )}
      </div>
    </div>
  );

  if (!eq.series.length) return (
    <>
      {rangeControls}
      <div className="state">Sin datos de patrimonio en el periodo.</div>
    </>
  );

  const s = eq.series;
  const sm = eq.summary;

  const twrOk = twr && twr.available && twr.pnl_series && twr.pnl_series.length > 1;
  // Si se pidió una vista ajustada pero la worker-api no está, caemos a NLV.
  const effView = (!twrOk && (chartView === "pnl" || chartView === "twr")) ? "nlv" : chartView;

  // SVG SIN estiramiento (aspect ratio real) para que el tooltip mapee bien.
  const W = 1000, H = 340, PADL = 8, PADR = 8, PADT = 20, PADB = 8;

  const spyReady = showSpy && spy && spy.series && spy.series.length > 1 && effView === "twr";

  const px = (i, n) => PADL + (i / ((n ?? s.length) - 1 || 1)) * (W - PADL - PADR);
  const fmtDate = (iso) => iso.slice(5, 10);
  const fmtDateFull = (iso) => iso.slice(0, 10);

  // ── Elegir la serie a graficar según la vista ────────────────────────────────
  // pnl: ganancia real acumulada ($, sin saltos por flujos) — la vista principal
  // nlv: NLV crudo ($, salta con depósitos) — "cuánta plata hay"
  // twr: rendimiento acumulado (%, inmune al capital) — puede comparar vs SPY
  let plotVals, valFmt, isPct;
  if (effView === "pnl") {
    plotVals = twr.pnl_series.map((p) => p.pnl);
    valFmt = (v) => signed(v); isPct = false;
  } else if (effView === "twr") {
    plotVals = twr.series.map((p) => p.cum_pct);
    valFmt = (v) => `${v >= 0 ? "+" : ""}${fmt(v, 1)}%`; isPct = true;
  } else {
    plotVals = s.map((p) => p.nlv);
    valFmt = (v) => money(v, 0); isPct = false;
  }

  const lastVal = plotVals[plotVals.length - 1];
  const pos = lastVal >= 0;
  const stroke = pos ? "#3fb950" : "#f85149";

  const minY = Math.min(...plotVals), maxY = Math.max(...plotVals);
  const rangeY = maxY - minY || 1;
  const py = (v) => PADT + (1 - (v - minY) / rangeY) * (H - PADT - PADB);
  const line = plotVals.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i, plotVals.length).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  // Área solo en vistas de $ (pnl/nlv), no en % (twr con posible SPY)
  const area = isPct ? null
    : `${line} L ${px(plotVals.length - 1, plotVals.length).toFixed(1)} ${H - PADB} L ${px(0, plotVals.length).toFixed(1)} ${H - PADB} Z`;

  // SPY (solo en vista twr): normalizado a % desde el inicio, comparte eje con twr
  let spyLine = null, spyPct = null, twrPct = null;
  if (spyReady) {
    twrPct = twr.series.map((p) => p.cum_pct);
    const spy0 = spy.series.find((p) => p.close > 0)?.close || 1;
    spyPct = spy.series.map((p) => (p.close / spy0 - 1) * 100);
    const allPct = [...twrPct, ...spyPct];
    const minP = Math.min(...allPct), maxP = Math.max(...allPct);
    const rangeP = maxP - minP || 1;
    const pyP = (v) => PADT + (1 - (v - minP) / rangeP) * (H - PADT - PADB);
    // Redibujar la línea principal con la escala compartida
    spyLine = spyPct.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i, spyPct.length).toFixed(1)} ${pyP(v).toFixed(1)}`).join(" ");
  }

  // Tooltip: del evento al índice más cercano (sobre la serie graficada).
  const onMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const relX = (clientX - rect.left) / rect.width;
    const xInView = relX * W;
    const i = Math.round(((xInView - PADL) / (W - PADL - PADR)) * (plotVals.length - 1));
    setHover(Math.max(0, Math.min(i, plotVals.length - 1)));
  };

  const hoverPt = hover != null ? s[Math.min(hover, s.length - 1)] : null;
  const hoverVal = hover != null ? plotVals[Math.min(hover, plotVals.length - 1)] : null;

  // Métricas de arriba: si hay TWR, mostramos rendimiento ajustado y P&L real.
  const mChange = twrOk ? twr.pnl_real : sm.change;
  const mPct    = twrOk ? twr.twr_pct : sm.change_pct;
  const mPos    = mChange >= 0;

  return (
    <>
      <div className="pulse">
        <div className="pulse-card">
          <div className="pulse-label">{twrOk ? "Ganancia del sistema" : "Cambio del periodo"}</div>
          <div className="pulse-value" style={{ color: mPos ? "#3fb950" : "#f85149" }}>{signed(mChange)}</div>
          <div className="pulse-sub">
            {twrOk ? "P&L real, sin depósitos/retiros" : `${sm.change_pct >= 0 ? "+" : ""}${fmt(sm.change_pct, 1)}% en ${sm.points} puntos`}
          </div>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">{twrOk ? "Rendimiento (TWR)" : "NLV actual"}</div>
          <div className="pulse-value" style={{ color: twrOk ? (mPct >= 0 ? "#3fb950" : "#f85149") : "var(--text)" }}>
            {twrOk ? `${mPct >= 0 ? "+" : ""}${fmt(mPct, 1)}%` : money(sm.end_nlv, 0)}
          </div>
          <div className="pulse-sub">{twrOk ? "ajustado por flujos de capital" : `desde ${money(sm.start_nlv, 0)}`}</div>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">Drawdown máx</div>
          <div className="pulse-value" style={{ color: sm.max_drawdown < 0 ? "#f85149" : "var(--text)" }}>
            {sm.max_drawdown < 0 ? money(sm.max_drawdown, 0) : "$0"}
          </div>
          <div className="pulse-sub">{sm.max_drawdown_pct < 0 ? fmt(sm.max_drawdown_pct, 1) + "%" : "sin caídas"}</div>
        </div>
      </div>

      {rangeControls}

      {/* Selector de vista de la curva */}
      <div className="view-selector">
        <button className={effView === "pnl" ? "vchip active" : "vchip"}
          onClick={() => { setChartView("pnl"); setShowSpy(false); }}
          disabled={!twrOk} title={twrOk ? "" : "worker-api no disponible"}>ganancia $</button>
        <button className={effView === "nlv" ? "vchip active" : "vchip"}
          onClick={() => { setChartView("nlv"); setShowSpy(false); }}>capital (NLV)</button>
        <button className={effView === "twr" ? "vchip active" : "vchip"}
          onClick={() => setChartView("twr")}
          disabled={!twrOk} title={twrOk ? "" : "worker-api no disponible"}>rendimiento %</button>
        {twr && !twr.available && (
          <span className="dim" style={{fontSize:"0.72rem"}}>· ajuste por flujos no disponible</span>
        )}
      </div>

      <div className="chart-wrap">
        <div className="chart-legend">
          <span className="view-hint dim">
            {effView === "pnl" && "ganancia real acumulada — descuenta depósitos y retiros"}
            {effView === "nlv" && "capital total en la cuenta — sube con depósitos"}
            {effView === "twr" && "rendimiento acumulado (%) — inmune al capital aportado"}
          </span>
          {effView === "twr" && (
            <button className={showSpy ? "spy-toggle active" : "spy-toggle"}
              onClick={() => setShowSpy((v) => !v)}>
              <span className="legend-swatch" style={{ background: stroke }} /> tú
              {showSpy && <><span className="legend-swatch spy" /> SPY</>}
              <span className="spy-hint">{showSpy ? "comparando %" : "vs SPY"}</span>
            </button>
          )}
          {spyReady && (
            <span className="spy-verdict mono">
              tú {twrPct[twrPct.length-1] >= 0 ? "+" : ""}{fmt(twrPct[twrPct.length-1],1)}% · SPY {spyPct[spyPct.length-1] >= 0 ? "+" : ""}{fmt(spyPct[spyPct.length-1],1)}%
            </span>
          )}
          {showSpy && spy && spy.error && <span className="dim" style={{fontSize:"0.75rem"}}>{spy.error}</span>}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart"
             onMouseMove={onMove} onMouseLeave={() => setHover(null)}
             onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}>
          <defs>
            <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <path d={area} fill="url(#area-grad)" />}
          {spyReady && <path d={spyLine} fill="none" stroke="#8b949e" strokeWidth="1.6"
                             strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
          <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {hover != null && hoverVal != null && (
            <g>
              <line x1={px(hover, plotVals.length)} y1={PADT} x2={px(hover, plotVals.length)} y2={H - PADB}
                    stroke="var(--dim)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              <circle cx={px(hover, plotVals.length)} cy={py(hoverVal)} r="4" fill={stroke} />
            </g>
          )}
        </svg>
        {hover != null && hoverVal != null && (
          <div className="chart-tip" style={{
            left: `${(px(hover, plotVals.length) / W) * 100}%`,
            transform: px(hover, plotVals.length) > W / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}>
            <div className="chart-tip-val mono" style={{color: isPct ? stroke : "var(--text)"}}>{valFmt(hoverVal)}</div>
            {hoverPt && <div className="chart-tip-date dim">{fmtDateFull(hoverPt.t)}</div>}
          </div>
        )}
        <div className="chart-axis">
          <span>{fmtDate(sm.start_at)}</span>
          <span>{fmtDate(sm.end_at)}</span>
        </div>
      </div>
    </>
  );
}

function ClosedTrades() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("live");

  useEffect(() => {
    authFetch(`/api/closed`)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="state">No se pudo cargar el historial ({error}).</div>;
  if (!data) return <div className="state">Cargando historial…</div>;

  const book = data[tab];
  const s = book.summary;
  const pnlPos = s.total_pnl >= 0;
  const expPos = s.expectancy >= 0;

  return (
    <>
      <div className="tabs">
        <button className={tab === "live" ? "tab active" : "tab"} onClick={() => setTab("live")}>
          <span className="dot" style={{ background: tab === "live" ? "#f85149" : "#3d444d" }} />
          live · real
        </button>
        <button className={tab === "paper" ? "tab active" : "tab"} onClick={() => setTab("paper")}>
          <span className="dot" style={{ background: tab === "paper" ? "#58a6ff" : "#3d444d" }} />
          paper · sim
        </button>
      </div>

      {s.count === 0 ? (
        <div className="state">Sin trades cerrados en este libro desde {data.since}.</div>
      ) : (
      <>
      <div className="pulse">
        <div className="pulse-card">
          <div className="pulse-label">Expectativa / trade</div>
          <div className="pulse-value" style={{ color: expPos ? "#3fb950" : "#f85149" }}>
            {signed(s.expectancy)}
          </div>
          <div className="pulse-sub">la métrica que importa</div>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">P&L total realizado</div>
          <div className="pulse-value" style={{ color: pnlPos ? "#3fb950" : "#f85149" }}>
            {signed(s.total_pnl)}
          </div>
          <div className="pulse-sub">{s.count} trades cerrados</div>
        </div>
        <div className="pulse-card pulse-card--wide">
          <div className="pulse-label">Win rate</div>
          <div className="pulse-value" style={{ fontSize: "1.5rem" }}>
            {fmt(s.win_rate, 0)}% <span className="pulse-of">· {s.wins}G / {s.losses}P</span>
          </div>
          <div className="wl-bar">
            <div className="wl-win" style={{ width: `${s.count ? (s.wins/s.count*100) : 0}%` }} />
            <div className="wl-loss" style={{ width: `${s.count ? (s.losses/s.count*100) : 0}%` }} />
          </div>
          <div className="pulse-sub">gana {money(s.avg_win)} · pierde {money(s.avg_loss)}</div>
        </div>
      </div>

      <div className="table-wrap desktop-only">
        <table>
          <thead>
            <tr>
              <th>ticker</th>
              <th>tipo</th>
              <th>motivo</th>
              <th className="num">P&L</th>
              <th className="num">%</th>
              <th>fecha</th>
            </tr>
          </thead>
          <tbody>
            {book.trades.map((t, i) => {
              const pos = t.pnl >= 0;
              return (
                <tr key={i}>
                  <td className="mono ticker">{t.ticker}</td>
                  <td className="mono dim">{t.strategy}</td>
                  <td className="mono dim reason">{t.close_reason || "—"}</td>
                  <td className="mono num" style={{ color: pos ? "#3fb950" : "#f85149", fontWeight: 600 }}>
                    {signed(t.pnl)}
                  </td>
                  <td className="mono num dim">{t.pnl_pct != null ? fmt(t.pnl_pct, 1) + "%" : "—"}</td>
                  <td className="mono dim">{t.closed_at ? t.closed_at.slice(0, 10) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Vista MÓVIL: cards apilados */}
      <div className="pcard-list mobile-only">
        {book.trades.map((t, i) => {
          const pos = t.pnl >= 0;
          return (
            <div className="pcard" key={i} style={{ borderLeftColor: pos ? "#3fb950" : "#f85149" }}>
              <div className="pcard-head">
                <div className="pcard-tk">
                  <span className="mono ticker">{t.ticker}</span>
                  <span className="mono dim pcard-type">{t.strategy}</span>
                </div>
                <div className="mono pcard-pnl" style={{ color: pos ? "#3fb950" : "#f85149" }}>
                  {signed(t.pnl)}
                  {t.pnl_pct != null && <span className="dim pcard-roi"> {fmt(t.pnl_pct, 1)}%</span>}
                </div>
              </div>
              <div className="pcard-grid mono" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div><span className="dim">motivo</span> {t.close_reason || "—"}</div>
                <div><span className="dim">fecha</span> {t.closed_at ? t.closed_at.slice(0, 10) : "—"}</div>
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}
    </>
  );
}

function Runs() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () => authFetch(`/api/runs`)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="state">No se pudieron cargar los runs ({error}).</div>;
  if (!data) return <div className="state">Cargando runs…</div>;
  if (!data.runs.length) return <div className="state">Sin runs registrados todavía.</div>;

  const verdictColor = (v) => {
    if (!v) return "#7d8590";
    const u = v.toUpperCase();
    if (u.includes("FAVORABLE") || u.includes("ALCISTA")) return "#3fb950";
    if (u.includes("CAUTO") || u.includes("MIXTO") || u.includes("NEUTRAL")) return "#d29922";
    if (u.includes("ADVERSO") || u.includes("BAJISTA") || u.includes("RIESGO")) return "#f85149";
    return "#58a6ff";
  };

  const fmtWhen = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("es", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="runs">
      {data.runs.map((r, i) => {
        const vc = verdictColor(r.verdict);
        return (
          <div className="run-card" key={i} style={{ borderLeftColor: vc }}>
            <div className="run-head">
              <div className="run-when">
                <span className="run-slot">{r.slot || "run"}</span>
                <span className="run-time">{fmtWhen(r.run_at)}</span>
              </div>
              <div className="run-verdict" style={{ color: vc }}>{r.verdict || "—"}</div>
            </div>
            <div className="run-metrics">
              {r.vix != null && <span className="run-chip">VIX {r.vix.toFixed(1)}</span>}
              <span className="run-chip" style={{ color: r.opened ? "#3fb950" : "#7d8590" }}>
                {r.opened || 0} abiertos
              </span>
              {r.closed > 0 && <span className="run-chip" style={{ color: "#58a6ff" }}>{r.closed} cerrados</span>}
              {r.errors > 0 && <span className="run-chip" style={{ color: "#f85149" }}>{r.errors} errores</span>}
              {r.run_time_sec != null && <span className="run-chip dim">{r.run_time_sec}s</span>}
            </div>
            {(r.summary || r.no_trade_reason) && (
              <div className="run-reason">{r.summary || r.no_trade_reason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Login({ onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!pw) return;
    setBusy(true); setErr(null);
    fetch(`${API}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    })
      .then((r) => { if (!r.ok) throw new Error("Password incorrecta"); return r.json(); })
      .then((d) => { setToken(d.token); onOk(); })
      .catch((e) => { setErr(e.message); setBusy(false); });
  };

  return (
    <div className="login">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark" />
          <span className="brand-name">bull<span className="brand-accent">desk</span></span>
        </div>
        <p className="login-hint">Panel de trading privado</p>
        <input
          type="password"
          className="login-input"
          placeholder="Contraseña"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        {err && <div className="login-err">{err}</div>}
        <button className="login-btn" onClick={submit} disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

// ── Modal de detalle de una posicion ─────────────────────────────────────────
// Carga /api/positions/{book}/{id}/detail: datos, contexto (rationale del LLM) y
// la serie de precio del subyacente (yfinance). Dibuja el precio con SVG y las
// lineas de referencia (strikes + precio de apertura).
function SubyacenteChart({ serie, strikeLow, strikeHigh, priceOpen }) {
  if (!serie || serie.length < 2) return null;
  const W = 560, H = 240, PADL = 52, PADR = 60, PADT = 20, PADB = 30;
  const closes = serie.map((p) => p.close);
  // El rango incluye los strikes para que las lineas de referencia entren.
  const vals = [...closes, strikeLow, strikeHigh, priceOpen].filter((v) => v != null);
  const minY = Math.min(...vals), maxY = Math.max(...vals);
  const rangeY = maxY - minY || 1;
  const px = (i) => PADL + (i / (serie.length - 1 || 1)) * (W - PADL - PADR);
  const py = (v) => PADT + (1 - (v - minY) / rangeY) * (H - PADT - PADB);
  const line = serie.map((p, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(p.close).toFixed(1)}`).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const up = last >= first;
  const lineColor = up ? "#3fb950" : "#f85149";

  // Escala Y: ~5 ticks de precio uniformemente espaciados en el rango.
  const N_TICKS = 5;
  const ticks = [];
  for (let i = 0; i < N_TICKS; i++) {
    const v = minY + (rangeY * i) / (N_TICKS - 1);
    ticks.push(v);
  }

  const refLine = (v, color, label, anchorRight) => v == null ? null : (
    <g>
      <line x1={PADL} y1={py(v)} x2={W - PADR} y2={py(v)} stroke={color}
            strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
      <text x={W - PADR + 4} y={py(v) + 3} fill={color} fontSize="9" opacity="0.9">{label}</text>
    </g>
  );

  const fmtD = (iso) => iso.slice(5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* escala Y: gridlines suaves + valores de precio a la izquierda */}
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={py(v)} x2={W - PADR} y2={py(v)}
                stroke="#30363d" strokeWidth="0.5" opacity="0.5" />
          <text x={PADL - 8} y={py(v) + 3} fill="#6e7681" fontSize="9" textAnchor="end">
            ${v.toFixed(0)}
          </text>
        </g>
      ))}
      {/* lineas de referencia: strikes y precio de apertura */}
      {refLine(strikeHigh, "#8b949e", `$${strikeHigh} short`)}
      {refLine(strikeLow, "#8b949e", `$${strikeLow} long`)}
      {refLine(priceOpen, "#58a6ff", `open`)}
      {/* linea de precio */}
      <path d={line} fill="none" stroke={lineColor} strokeWidth="1.8" />
      {/* punto final */}
      <circle cx={px(serie.length - 1)} cy={py(last)} r="3" fill={lineColor} />
      {/* etiquetas de fecha (primera y ultima) */}
      <text x={PADL} y={H - 8} fill="#6e7681" fontSize="9">{fmtD(serie[0].date)}</text>
      <text x={W - PADR} y={H - 8} fill="#6e7681" fontSize="9" textAnchor="end">{fmtD(serie[serie.length - 1].date)}</text>
    </svg>
  );
}

function PositionModal({ book, posId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDetail(null); setError(null);
    authFetch(`/api/positions/${book}/${posId}/detail`)
      .then((d) => setDetail(d))
      .catch((e) => setError(e.message));
  }, [book, posId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        {error && <div className="state">No se pudo cargar el detalle ({error}).</div>}
        {!error && !detail && <div className="state">Cargando detalle…</div>}
        {detail && (() => {
          const p = detail.posicion;
          const c = detail.contexto;
          const pnlPos = (p.pnl ?? 0) >= 0;
          return (
            <>
              <div className="modal-head">
                <div>
                  <span className="modal-ticker mono">{p.ticker}</span>
                  <span className="modal-type mono dim"> {p.type} {p.strike_low}/{p.strike_high}</span>
                </div>
                <div className="modal-pnl mono" style={{ color: pnlPos ? "#3fb950" : "#f85149" }}>
                  {signed(p.pnl)} {p.pnl_pct != null && <span className="dim">({fmt(p.pnl_pct, 1)}%)</span>}
                </div>
              </div>

              {/* Grafico del subyacente */}
              <div className="modal-section">
                <div className="modal-section-title">precio del subyacente</div>
                {detail.serie
                  ? <SubyacenteChart serie={detail.serie} strikeLow={p.strike_low}
                      strikeHigh={p.strike_high} priceOpen={p.price_at_open} />
                  : <div className="dim" style={{ fontSize: "0.8rem", padding: "1rem 0" }}>
                      {detail.serie_error || "sin datos de precio"}
                    </div>}
              </div>

              {/* Datos de la posicion */}
              <div className="modal-section">
                <div className="modal-grid">
                  <div><span className="dim">costo</span><br/>{money(p.total_cost)}</div>
                  <div><span className="dim">riesgo máx</span><br/>{money(p.max_loss)}</div>
                  <div><span className="dim">apertura</span><br/>{p.opened_at?.slice(0, 10)}</div>
                  <div><span className="dim">expira</span><br/>{p.expiration}</div>
                  <div><span className="dim">precio apertura</span><br/>{p.price_at_open != null ? "$" + fmt(p.price_at_open, 2) : "—"}</div>
                  <div><span className="dim">% del máx</span><br/>{p.profit_pct_of_max != null ? fmt(p.profit_pct_of_max * 100, 1) + "%" : "—"}</div>
                </div>
              </div>

              {/* Rationale del LLM */}
              <div className="modal-section">
                <div className="modal-section-title">por qué se abrió (rationale)</div>
                {c && c.rationale
                  ? <>
                      <p className="modal-rationale">{c.rationale}</p>
                      <div className="modal-ctx mono dim">
                        {c.rsi != null && <span>RSI {fmt(c.rsi, 1)}</span>}
                        {c.iv != null && <span> · IV {fmt(c.iv, 1)}</span>}
                        {c.vix != null && <span> · VIX {fmt(c.vix, 1)}</span>}
                        {c.beta != null && <span> · β {fmt(c.beta, 2)}</span>}
                        {c.macro_verdict && <span> · macro: {c.macro_verdict}</span>}
                      </div>
                    </>
                  : <div className="dim" style={{ fontSize: "0.8rem" }}>
                      Sin rationale guardado (posición abierta antes del registro de contexto).
                    </div>}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [authed, setAuthed] = useState(!!getToken());
  const [view, setView] = useState("positions");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState("live");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modalPos, setModalPos] = useState(null);   // {book, id} de la posicion abierta en el modal

  const load = () => {
    authFetch(`/api/positions`)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!authed) return;          // no cargar datos si no hay sesion
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [authed]);

  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  const book = data ? data[tab] : null;

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="topbar">
        <div className="brand">
          <button className="hamburger" onClick={() => setMenuOpen((v) => !v)} aria-label="menú">
            {menuOpen ? "✕" : "☰"}
          </button>
          <span className="brand-mark" />
          <span className="brand-name">bull<span className="brand-accent">desk</span></span>
        </div>
        <nav className={menuOpen ? "nav open" : "nav"}>
          {["positions", "equity", "closed", "runs"].map((v) => {
            const labels = { positions: "posiciones", equity: "patrimonio", closed: "cerrados", runs: "runs" };
            return (
              <button key={v}
                className={view === v ? "navbtn active" : "navbtn"}
                onClick={() => { setView(v); setMenuOpen(false); }}>
                {labels[v]}
              </button>
            );
          })}
        </nav>
        <div className="capital">
          <span className="capital-label">capital</span>
          <span className="capital-value mono">{data ? money(data.capital, 2) : "—"}</span>
          <button className="logout" onClick={() => { clearToken(); setAuthed(false); }} title="Salir">⏻</button>
        </div>
      </header>

      {view === "positions" && (
        <>
          <div className="tabs">
            <button className={tab === "live" ? "tab active" : "tab"} onClick={() => setTab("live")}>
              <span className="dot" style={{ background: tab === "live" ? "#f85149" : "#3d444d" }} />
              live · real
            </button>
            <button className={tab === "paper" ? "tab active" : "tab"} onClick={() => setTab("paper")}>
              <span className="dot" style={{ background: tab === "paper" ? "#58a6ff" : "#3d444d" }} />
              paper · sim
            </button>
          </div>
          <main className="content">
            {error && <div className="state">No se pudo conectar al backend ({error}).<br/>¿Está corriendo uvicorn en :8000?</div>}
            {!error && !data && <div className="state">Cargando cartera…</div>}
            {!error && data && <Book book={book} onRowClick={(id) => setModalPos({ book: tab, id })} />}
          </main>
        </>
      )}

      {modalPos && (
        <PositionModal book={modalPos.book} posId={modalPos.id} onClose={() => setModalPos(null)} />
      )}

      {view === "equity" && (
        <main className="content">
          <EquityCurve />
        </main>
      )}

      {view === "closed" && (
        <main className="content">
          <ClosedTrades />
        </main>
      )}

      {view === "runs" && (
        <main className="content">
          <Runs />
        </main>
      )}

      <footer className="foot">
        <span>datos del último sync del monitor · máx 5 min de antigüedad</span>
        <div className="legend">
          <span><span className="dot" style={{ background: "#3fb950" }} /> ganando</span>
          <span><span className="dot" style={{ background: "#3fb950", boxShadow: "0 0 6px #3fb950" }} /> tomar ganancia</span>
          <span><span className="dot" style={{ background: "#d29922" }} /> vigilar</span>
          <span><span className="dot" style={{ background: "#f85149", boxShadow: "0 0 6px #f85149" }} /> stop</span>
          <span><span className="dot" style={{ background: "#3d444d" }} /> normal</span>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
.app {
  --bg: #0a0e14;
  --panel: #11161f;
  --panel-2: #161c26;
  --line: #1f2630;
  --text: #e6edf3;
  --dim: #7d8590;
  --mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  padding: 0 0 3rem;
}
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.dim { color: var(--dim); }
.num { text-align: right; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }

.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1.1rem 1.6rem; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: rgba(10,14,20,0.9);
  backdrop-filter: blur(8px); z-index: 10;
}
.brand { display: flex; align-items: center; gap: 0.6rem; }
.hamburger {
  display: none; background: transparent; border: none; color: var(--text);
  font-size: 1.3rem; cursor: pointer; padding: 0 0.2rem; line-height: 1;
}
.brand-mark {
  width: 22px; height: 22px; border-radius: 5px;
  background: linear-gradient(135deg, #3fb950, #2ea043);
  box-shadow: 0 0 16px rgba(63,185,80,0.4);
}
.brand-name { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em; }
.brand-accent { color: #3fb950; }
.capital { display: flex; align-items: baseline; gap: 0.5rem; }
.capital-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); }
.capital-value { font-size: 1.05rem; font-weight: 600; }
.capital-time { font-size: 0.72rem; color: var(--dim); }

.tabs { display: flex; gap: 0.4rem; padding: 1rem 1.6rem 0; }
.tab {
  display: flex; align-items: center; gap: 0.5rem;
  background: transparent; border: 1px solid var(--line); color: var(--dim);
  padding: 0.5rem 1rem; border-radius: 7px 7px 0 0; font-size: 0.85rem;
  cursor: pointer; font-family: var(--mono); transition: all 0.15s;
}
.tab:hover { color: var(--text); border-color: #2d3542; }
.tab.active { background: var(--panel); color: var(--text); border-bottom-color: var(--panel); }

.content { padding: 1.4rem 1.6rem; }

.pulse { display: grid; grid-template-columns: 1fr 1fr 1.8fr; gap: 0.9rem; margin-bottom: 1.4rem; }
.pulse-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.1rem 1.2rem; }
.pulse-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--dim); margin-bottom: 0.5rem; }
.pulse-value { font-size: 1.8rem; font-weight: 700; font-family: var(--mono); letter-spacing: -0.02em; }
.pulse-of { color: var(--dim); font-weight: 400; font-size: 1rem; }
.pulse-sub { font-size: 0.78rem; color: var(--dim); margin-top: 0.4rem; }
.gauge { height: 6px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin: 0.7rem 0 0.5rem; }
.gauge-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }

.table-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
thead th {
  text-align: left; padding: 0.7rem 0.8rem; font-size: 0.7rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim);
  border-bottom: 1px solid var(--line); background: var(--panel-2);
}
thead th.num { text-align: right; }
thead th.sortable { cursor: pointer; transition: color 0.15s; }
thead th.sortable:hover { color: var(--text); }
.sort-arrow { font-size: 0.65rem; opacity: 0.8; }
tbody td { padding: 0.62rem 0.8rem; border-bottom: 1px solid var(--line); }
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background 0.15s; }
tbody tr:hover { background: var(--panel-2) !important; }
.ticker { font-weight: 700; letter-spacing: 0.01em; }

/* ── Vista de posiciones: tabla (desktop) vs cards (móvil) ── */
.mobile-only { display: none !important; }
.desktop-only { display: block !important; }
.sort-mobile { display: none; }
.pcard-list { display: flex; flex-direction: column; gap: 0.6rem; }
.pcard {
  background: var(--panel); border: 1px solid var(--line);
  border-left: 3px solid var(--line); border-radius: 10px;
  padding: 0.8rem 0.9rem; cursor: pointer;
}
.pcard-head { display: flex; justify-content: space-between; align-items: baseline; }
.pcard-tk { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
.pcard-tk .ticker { font-size: 1.05rem; font-weight: 700; }
.pcard-type { font-size: 0.8rem; }
.pcard-pnl { font-size: 1.05rem; font-weight: 600; }
.pcard-roi { font-size: 0.8rem; font-weight: 400; }
.pcard-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem;
  margin-top: 0.6rem; font-size: 0.85rem;
}
.pcard-grid .dim { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.03em; margin-right: 0.2rem; }
.pcard-bar { margin-top: 0.7rem; width: 100%; }
.sortchip {
  background: var(--panel-2); border: 1px solid var(--line); color: var(--dim);
  font-size: 0.78rem; padding: 0.3rem 0.6rem; border-radius: 20px;
  cursor: pointer; font-family: inherit;
}
.sortchip.active { color: var(--text); border-color: #3fb950; }

.maxbar-track { width: 90px; height: 5px; background: var(--panel-2); border-radius: 3px; overflow: hidden; }.maxbar-fill { height: 100%; border-radius: 3px; }

.foot {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1.2rem 1.6rem 0; font-size: 0.74rem; color: var(--dim);
}
.legend { display: flex; gap: 1rem; }
.legend span { display: inline-flex; align-items: center; gap: 0.4rem; }


.wl-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin: 0.7rem 0 0.5rem; background: var(--panel-2); }
.wl-win { background: #3fb950; }
.wl-loss { background: #f85149; }
.reason { font-size: 0.76rem; }

.runs { display: flex; flex-direction: column; gap: 0.7rem; }
.run-card { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--dim); border-radius: 8px; padding: 0.9rem 1.1rem; }
.run-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
.run-when { display: flex; align-items: baseline; gap: 0.6rem; }
.run-slot { font-family: var(--mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); background: var(--panel-2); padding: 0.15rem 0.5rem; border-radius: 4px; }
.run-time { font-size: 0.8rem; color: var(--dim); }
.run-verdict { font-weight: 700; font-size: 0.9rem; letter-spacing: -0.01em; }
.run-metrics { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
.run-chip { font-family: var(--mono); font-size: 0.75rem; background: var(--panel-2); padding: 0.2rem 0.55rem; border-radius: 5px; }
.run-reason { font-size: 0.84rem; color: #b3bcc7; line-height: 1.5; border-top: 1px solid var(--line); padding-top: 0.55rem; margin-top: 0.3rem; }

.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); }
.login-card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 2.4rem 2.2rem; width: 340px; text-align: center; }
.login-brand { display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin-bottom: 0.4rem; }
.login-hint { color: var(--dim); font-size: 0.82rem; margin-bottom: 1.6rem; }
.login-input { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 0.75rem 0.9rem; color: var(--text); font-size: 0.95rem; font-family: var(--mono); outline: none; transition: border 0.15s; }
.login-input:focus { border-color: #3fb950; }
.login-err { color: #f85149; font-size: 0.8rem; margin-top: 0.7rem; }
.login-btn { width: 100%; margin-top: 1rem; background: #2ea043; border: none; color: white; padding: 0.75rem; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
.login-btn:hover:not(:disabled) { background: #3fb950; }
.login-btn:disabled { opacity: 0.6; cursor: default; }
.logout { background: transparent; border: 1px solid var(--line); color: var(--dim); width: 30px; height: 30px; border-radius: 7px; cursor: pointer; margin-left: 0.8rem; font-size: 0.9rem; transition: all 0.15s; }
.logout:hover { color: #f85149; border-color: #f85149; }
.nav { display: flex; gap: 0.3rem; }
.navbtn { background: transparent; border: none; color: var(--dim); font-size: 0.9rem; padding: 0.4rem 0.9rem; border-radius: 7px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
.navbtn:hover { color: var(--text); }
.navbtn.active { color: var(--text); background: var(--panel-2); }
.chart-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.2rem; position: relative; }
.chart { width: 100%; height: 320px; display: block; cursor: crosshair; touch-action: none; }
.chart-axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 0.72rem; color: var(--dim); margin-top: 0.5rem; padding: 0 0.2rem; }
.range-picker { display: flex; gap: 0.35rem; }
.eq-controls { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.7rem; margin: 0.9rem 0; }
.date-range { display: flex; align-items: center; gap: 0.4rem; }
.date-in {
  background: var(--panel-2); border: 1px solid var(--line); color: var(--text);
  font-family: var(--mono); font-size: 0.78rem; padding: 0.28rem 0.5rem;
  border-radius: 6px; color-scheme: dark;
}
.chart-tip {
  position: absolute; top: 1.4rem; pointer-events: none;
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
  padding: 0.45rem 0.7rem; z-index: 5; white-space: nowrap;
}
.chart-tip-val { font-size: 0.95rem; font-weight: 600; }
.chart-tip-date { font-size: 0.72rem; margin-top: 0.1rem; }
.chart-legend { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
.view-selector { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin: 0.2rem 0 0.9rem; }
.vchip {
  background: var(--panel-2); border: 1px solid var(--line); color: var(--dim);
  font-size: 0.8rem; padding: 0.35rem 0.75rem; border-radius: 8px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.vchip:hover:not(:disabled) { color: var(--text); }
.vchip.active { background: #1f6feb22; border-color: #1f6feb; color: #58a6ff; }
.vchip:disabled { opacity: 0.4; cursor: not-allowed; }
.view-hint { font-size: 0.78rem; }
.spy-toggle {
  display: flex; align-items: center; gap: 0.4rem; background: var(--panel-2);
  border: 1px solid var(--line); color: var(--text); font-size: 0.8rem;
  padding: 0.3rem 0.65rem; border-radius: 20px; cursor: pointer; font-family: inherit;
}
.spy-toggle.active { border-color: #8b949e; }
.spy-hint { color: var(--dim); font-size: 0.72rem; margin-left: 0.2rem; }
.legend-swatch { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
.legend-swatch.spy { background: #8b949e; }
.spy-verdict { font-size: 0.82rem; color: var(--dim); }
.chip { background: var(--panel-2); border: 1px solid var(--line); color: var(--dim); font-family: var(--mono); font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
.chip:hover { color: var(--text); }
.chip.active { background: #1f6feb22; border-color: #1f6feb; color: #58a6ff; }
.state { padding: 4rem 2rem; text-align: center; color: var(--dim); font-size: 0.95rem; line-height: 1.7; }

@media (max-width: 720px) {
  .pulse { grid-template-columns: 1fr; }
  .foot { flex-direction: column; gap: 0.7rem; align-items: flex-start; }

  /* Posiciones: cards en vez de tabla */
  .desktop-only { display: none !important; }
  .mobile-only { display: block !important; }
  .sort-mobile {
    display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;
    margin-bottom: 0.7rem; font-size: 0.78rem;
  }

  /* Menú desplegable */
  .hamburger { display: block; }
  .topbar { padding: 0.9rem 1.1rem; }
  .nav {
    display: none;
    position: absolute; top: 100%; left: 0; right: 0;
    flex-direction: column; gap: 0;
    background: var(--panel); border-bottom: 1px solid var(--line);
    padding: 0.4rem 0.6rem;
  }
  .nav.open { display: flex; }
  .navbtn {
    text-align: left; padding: 0.75rem 0.8rem; font-size: 1rem;
    border-radius: 8px;
  }
  .capital-label { display: none; }
  .brand-name { font-size: 1rem; }
}

/* ── Modal de detalle ── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 50;
  padding: 1.5rem;
}
.modal-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  width: 100%; max-width: 640px; max-height: 88vh; overflow-y: auto;
  padding: 1.6rem 1.8rem; position: relative;
}
.modal-close {
  position: absolute; top: 1rem; right: 1rem; background: none; border: none;
  color: var(--dim); font-size: 1.1rem; cursor: pointer; line-height: 1;
}
.modal-close:hover { color: var(--text); }
.modal-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 1rem; border-bottom: 1px solid var(--line); margin-bottom: 1.1rem;
}
.modal-ticker { font-size: 1.4rem; font-weight: 700; }
.modal-type { font-size: 0.95rem; }
.modal-pnl { font-size: 1.15rem; font-weight: 600; }
.modal-section { margin-bottom: 1.3rem; }
.modal-section-title {
  font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--dim); margin-bottom: 0.6rem;
}
.modal-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.9rem;
  font-size: 0.9rem; font-family: var(--mono, monospace);
}
.modal-grid .dim { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; }
.modal-rationale {
  font-size: 0.9rem; line-height: 1.55; color: var(--text); margin: 0 0 0.7rem;
}
.modal-ctx { font-size: 0.78rem; }
`;