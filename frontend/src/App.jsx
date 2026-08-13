import React, { useState, useEffect } from "react";

// El backend FastAPI sirve los datos reales. En dev corre en :8000.
const API = "http://localhost:8000";


// ─────────────────────────────────────────────────────────────────────────────
// Datos reales de la cartera de Hernán (snapshot 2026-08-13). En producción esto
// viene de fetch("http://localhost:8000/api/positions"). Acá van embebidos para
// iterar el diseño con la forma y los valores reales.
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) =>
  n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n, d = 0) => (n == null ? "—" : (n < 0 ? "-$" : "$") + fmt(Math.abs(n), d));
const signed = (n, d = 0) => (n == null ? "—" : (n >= 0 ? "+" : "-") + "$" + fmt(Math.abs(n), d));

// Semáforo funcional: refleja el estado que el monitor ya calculó.
const LEVEL = {
  ACTION: { dot: "#3fb950", label: "acción", glow: "rgba(63,185,80,0.15)" },
  WATCH:  { dot: "#d29922", label: "vigilar", glow: "rgba(210,153,34,0.12)" },
  NORMAL: { dot: "#3d444d", label: "normal", glow: "transparent" },
};
const levelOf = (p) => LEVEL[p.alert_level] || LEVEL.NORMAL;

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
        <div className="pulse-label">Tope de riesgo (40%)</div>
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

function PositionRow({ p }) {
  const lv = levelOf(p);
  const pnlPos = (p.pnl ?? 0) >= 0;
  const pctMax = p.profit_pct_of_max != null ? p.profit_pct_of_max * 100 : null;
  return (
    <tr style={{ background: lv.glow }}>
      <td>
        <span className="dot" style={{ background: lv.dot }} />
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

function Book({ book }) {
  return (
    <>
      <Pulse book={book} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>ticker</th>
              <th>tipo</th>
              <th>strikes</th>
              <th>exp</th>
              <th className="num">riesgo</th>
              <th className="num">P&L</th>
              <th className="num">%</th>
              <th>% del máx</th>
            </tr>
          </thead>
          <tbody>
            {book.positions.map((p) => <PositionRow key={p.id} p={p} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EquityCurve() {
  const [eq, setEq] = useState(null);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(90);

  useEffect(() => {
    fetch(`${API}/api/equity?days=${days}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { setEq(d); setError(null); })
      .catch((e) => setError(e.message));
  }, [days]);

  if (error) return <div className="state">No se pudo cargar el patrimonio ({error}).</div>;
  if (!eq) return <div className="state">Cargando patrimonio…</div>;
  if (!eq.series.length) return <div className="state">Sin datos de patrimonio en el periodo.</div>;

  const s = eq.summary;
  const pos = s.change >= 0;

  // Escalar la curva a un viewBox. Padding para que no toque bordes.
  const W = 1000, H = 320, PAD = 24;
  const xs = eq.series.map((_, i) => i);
  const ys = eq.series.map((p) => p.nlv);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;
  const px = (i) => PAD + (i / (eq.series.length - 1 || 1)) * (W - 2 * PAD);
  const py = (v) => PAD + (1 - (v - minY) / rangeY) * (H - 2 * PAD);

  const line = eq.series.map((p, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(p.nlv).toFixed(1)}`).join(" ");
  const area = `${line} L ${px(eq.series.length - 1).toFixed(1)} ${H - PAD} L ${px(0).toFixed(1)} ${H - PAD} Z`;
  const stroke = pos ? "#3fb950" : "#f85149";

  const fmtDate = (iso) => iso.slice(5, 10);

  return (
    <>
      <div className="pulse">
        <div className="pulse-card">
          <div className="pulse-label">Cambio del periodo</div>
          <div className="pulse-value" style={{ color: pos ? "#3fb950" : "#f85149" }}>
            {signed(s.change)}
          </div>
          <div className="pulse-sub">{s.change_pct >= 0 ? "+" : ""}{fmt(s.change_pct, 1)}% en {s.points} puntos</div>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">NLV actual</div>
          <div className="pulse-value">{money(s.end_nlv, 0)}</div>
          <div className="pulse-sub">desde {money(s.start_nlv, 0)}</div>
        </div>
        <div className="pulse-card pulse-card--wide">
          <div className="pulse-label">Rango del periodo</div>
          <div className="pulse-value" style={{ fontSize: "1.4rem" }}>
            {money(s.min_nlv, 0)} <span className="pulse-of">—</span> {money(s.max_nlv, 0)}
          </div>
          <div className="range-picker">
            {[30, 60, 90].map((d) => (
              <button key={d} className={days === d ? "chip active" : "chip"} onClick={() => setDays(d)}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart">
          <defs>
            <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#area-grad)" />
          <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="chart-axis">
          <span>{fmtDate(s.start_at)}</span>
          <span>{fmtDate(s.end_at)}</span>
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
    fetch(`${API}/api/closed`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
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

      <div className="table-wrap">
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
      </>
      )}
    </>
  );
}

function Runs() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () => fetch(`${API}/api/runs`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
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

export default function Dashboard() {
  const [view, setView] = useState("positions");
  const [tab, setTab] = useState("live");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    fetch(`${API}/api/positions`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const book = data ? data[tab] : null;

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">bull<span className="brand-accent">desk</span></span>
        </div>
        <nav className="nav">
          <button className={view === "positions" ? "navbtn active" : "navbtn"} onClick={() => setView("positions")}>posiciones</button>
          <button className={view === "equity" ? "navbtn active" : "navbtn"} onClick={() => setView("equity")}>patrimonio</button>
          <button className={view === "closed" ? "navbtn active" : "navbtn"} onClick={() => setView("closed")}>cerrados</button>
          <button className={view === "runs" ? "navbtn active" : "navbtn"} onClick={() => setView("runs")}>runs</button>
        </nav>
        <div className="capital">
          <span className="capital-label">capital</span>
          <span className="capital-value mono">{data ? money(data.capital, 2) : "—"}</span>
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
            {!error && data && <Book book={book} />}
          </main>
        </>
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
          <span><span className="dot" style={{ background: "#3fb950" }} /> acción</span>
          <span><span className="dot" style={{ background: "#d29922" }} /> vigilar</span>
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
tbody td { padding: 0.62rem 0.8rem; border-bottom: 1px solid var(--line); }
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background 0.15s; }
tbody tr:hover { background: var(--panel-2) !important; }
.ticker { font-weight: 700; letter-spacing: 0.01em; }

.maxbar-track { width: 90px; height: 5px; background: var(--panel-2); border-radius: 3px; overflow: hidden; }
.maxbar-fill { height: 100%; border-radius: 3px; }

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
.nav { display: flex; gap: 0.3rem; }
.navbtn { background: transparent; border: none; color: var(--dim); font-size: 0.9rem; padding: 0.4rem 0.9rem; border-radius: 7px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
.navbtn:hover { color: var(--text); }
.navbtn.active { color: var(--text); background: var(--panel-2); }
.chart-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.2rem; }
.chart { width: 100%; height: 320px; display: block; }
.chart-axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 0.72rem; color: var(--dim); margin-top: 0.5rem; padding: 0 0.2rem; }
.range-picker { display: flex; gap: 0.35rem; margin-top: 0.7rem; }
.chip { background: var(--panel-2); border: 1px solid var(--line); color: var(--dim); font-family: var(--mono); font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
.chip:hover { color: var(--text); }
.chip.active { background: #1f6feb22; border-color: #1f6feb; color: #58a6ff; }
.state { padding: 4rem 2rem; text-align: center; color: var(--dim); font-size: 0.95rem; line-height: 1.7; }

@media (max-width: 720px) {
  .pulse { grid-template-columns: 1fr; }
  thead th:nth-child(4), tbody td:nth-child(4),
  thead th:nth-child(5), tbody td:nth-child(5) { display: none; }
  .foot { flex-direction: column; gap: 0.7rem; align-items: flex-start; }
}
`;