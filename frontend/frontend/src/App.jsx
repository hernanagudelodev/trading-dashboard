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

export default function Dashboard() {
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
    const t = setInterval(load, 60000); // refresca cada 60s
    return () => clearInterval(t);
  }, []);

  if (error) return (
    <div className="app"><style>{CSS}</style>
      <div className="state">No se pudo conectar al backend ({error}).<br/>
      ¿Está corriendo uvicorn en :8000?</div>
    </div>
  );
  if (!data) return (
    <div className="app"><style>{CSS}</style>
      <div className="state">Cargando cartera…</div>
    </div>
  );

  const book = data[tab];

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">bull<span className="brand-accent">desk</span></span>
        </div>
        <div className="capital">
          <span className="capital-label">capital</span>
          <span className="capital-value mono">{money(data.capital, 2)}</span>
          <span className="capital-time">· {data.capital_at ? data.capital_at.slice(11) : "—"} sync</span>
        </div>
      </header>

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
        <Book book={book} />
      </main>

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
.state { padding: 4rem 2rem; text-align: center; color: var(--dim); font-size: 0.95rem; line-height: 1.7; }

@media (max-width: 720px) {
  .pulse { grid-template-columns: 1fr; }
  thead th:nth-child(4), tbody td:nth-child(4),
  thead th:nth-child(5), tbody td:nth-child(5) { display: none; }
  .foot { flex-direction: column; gap: 0.7rem; align-items: flex-start; }
}
`;