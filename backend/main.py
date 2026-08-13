"""
main.py — FastAPI backend del dashboard de trading (solo lectura).

Expone la data que el monitor ya mantiene en la DB. NO pricea (usa lo que el
monitor guardo en el ultimo sync, max 5min de antiguedad). NO escribe nada.

Correr:
    uvicorn main:app --reload
Docs interactivas:
    http://localhost:8000/docs
"""
import os
import secrets
import hmac
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from db import query

app = FastAPI(title="Trading Dashboard API", version="0.1.0")

# CORS: el front (React) corre en otro puerto (5173) y necesita permiso para
# consultar este backend (8000). En dev abrimos todo; en prod se restringe.
# CORS: en dev abrimos todo; en prod se restringe a la URL del frontend via
# env var FRONTEND_ORIGIN (separar varias con coma si hiciera falta).
_origins_env = os.getenv("FRONTEND_ORIGIN", "*")
_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── AUTENTICACION (un solo usuario) ──────────────────────────────────────────
# El password vive SOLO en el backend (env var DASHBOARD_PASSWORD). El frontend
# nunca lo tiene: manda el password una vez a /api/login, el backend valida y
# devuelve un token. Ese token se exige (header Authorization) en cada endpoint
# de datos. Sin token valido -> 401, no salen datos.
#
# Para un solo usuario alcanza un token aleatorio en memoria: se genera al
# arrancar y se compara. Si el servicio reinicia, el token cambia y hay que
# re-loguear (una molestia menor, mas seguro). No necesita JWT ni DB de sesiones.

DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
# Token de sesion: aleatorio por arranque del proceso.
_SESSION_TOKEN = secrets.token_urlsafe(32)


class LoginBody(BaseModel):
    password: str


@app.post("/api/login")
def login(body: LoginBody):
    """Valida el password contra la env var. Devuelve el token de sesion."""
    if not DASHBOARD_PASSWORD:
        raise HTTPException(500, "DASHBOARD_PASSWORD no configurada en el backend.")
    # Comparacion en tiempo constante (evita timing attacks).
    if not hmac.compare_digest(body.password, DASHBOARD_PASSWORD):
        raise HTTPException(401, "Password incorrecta.")
    return {"token": _SESSION_TOKEN}


def require_auth(authorization: str = Header(None)):
    """
    Dependencia que exige el token en el header Authorization: Bearer <token>.
    Cada endpoint de datos la usa. Sin token valido -> 401.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Falta el token. Inicia sesion.")
    token = authorization.split(" ", 1)[1]
    if not hmac.compare_digest(token, _SESSION_TOKEN):
        raise HTTPException(401, "Token invalido o expirado. Inicia sesion de nuevo.")
    return True


def _capital_actual():
    """Ultimo NLV registrado (account_snapshots)."""
    rows = query("""
        SELECT net_liquidating_value AS nlv, snapshot_at
        FROM account_snapshots
        ORDER BY snapshot_at DESC LIMIT 1
    """)
    if not rows:
        return None, None
    return float(rows[0]["nlv"]), rows[0]["snapshot_at"]


def _posiciones_abiertas(table):
    """Posiciones OPEN de una tabla (positions|paper_positions), como dicts."""
    return query(f"""
        SELECT id, ticker, strategy, sector, strike_low, strike_high,
               contracts, expiration, premium_paid, total_cost,
               gross_pnl, pnl_pct, profit_pct_of_max,
               current_spread_value, current_value,
               last_alert_level, last_synced_at, opened_at
        FROM {table}
        WHERE UPPER(status) = 'OPEN'
        ORDER BY opened_at
    """)


def _serializar_libro(table, capital):
    """Arma {positions:[...], exposure:{...}} para un libro."""
    rows = _posiciones_abiertas(table)
    positions = []
    total_pnl = 0.0
    total_max_loss = 0.0

    for r in rows:
        prem = float(r["premium_paid"] or 0)
        sl   = float(r["strike_low"] or 0)
        sh   = float(r["strike_high"] or 0)
        ctr  = int(r["contracts"] or 1)
        # El signo del premium decide el tipo: <0 credito (BPS), >0 debito (BCS)
        is_bps = prem < 0
        tipo = "BPS" if is_bps else "BCS"
        # Max loss: para BCS = costo (debito pagado); para BPS = (ancho - credito)
        ancho = (sh - sl) * 100 * ctr
        if is_bps:
            max_loss = ancho - abs(float(r["total_cost"] or 0))
        else:
            max_loss = float(r["total_cost"] or 0)
        total_max_loss += max_loss
        pnl = float(r["gross_pnl"]) if r["gross_pnl"] is not None else None
        if pnl is not None:
            total_pnl += pnl

        positions.append({
            "id": r["id"],
            "ticker": r["ticker"],
            "type": tipo,
            "sector": r["sector"],
            "strike_low": sl,
            "strike_high": sh,
            "contracts": ctr,
            "expiration": r["expiration"].isoformat() if r["expiration"] else None,
            "max_loss": round(max_loss, 2),
            "pnl": round(pnl, 2) if pnl is not None else None,
            "pnl_pct": float(r["pnl_pct"]) if r["pnl_pct"] is not None else None,
            "profit_pct_of_max": float(r["profit_pct_of_max"]) if r["profit_pct_of_max"] is not None else None,
            "alert_level": r["last_alert_level"],
            "last_synced_at": r["last_synced_at"].isoformat() if r["last_synced_at"] else None,
        })

    # Exposicion agregada (mismo criterio que check_open: max_loss vs tope 40%)
    TOPE_PCT = 40.0
    max_risk = capital * TOPE_PCT / 100.0 if capital else 0
    exposure = {
        "open_count": len(positions),
        "total_pnl": round(total_pnl, 2),
        "total_max_loss": round(total_max_loss, 2),
        "pct_of_capital": round(total_max_loss / capital * 100, 1) if capital else None,
        "risk_cap": round(max_risk, 2),
        "pct_of_cap_used": round(total_max_loss / max_risk * 100, 1) if max_risk else None,
        "margin_to_open": round(max_risk - total_max_loss, 2) if max_risk else None,
    }
    return {"positions": positions, "exposure": exposure}


@app.get("/api/positions")
def get_positions(_auth: bool = Depends(require_auth)):
    """Posiciones abiertas de ambos libros + exposicion + capital."""
    capital, snap_at = _capital_actual()
    return {
        "capital": capital,
        "capital_at": snap_at.isoformat() if snap_at else None,
        "live":  _serializar_libro("positions", capital),
        "paper": _serializar_libro("paper_positions", capital),
    }


@app.get("/api/equity")
def get_equity(days: int = 90, _auth: bool = Depends(require_auth)):
    """
    Serie de patrimonio (NLV) para la curva + resumen del periodo.
    days: ventana hacia atras (default 90). La curva usa todos los snapshots
    del rango; el resumen compara el primero contra el ultimo.
    """
    rows = query("""
        SELECT snapshot_at, net_liquidating_value AS nlv, cash_balance
        FROM account_snapshots
        WHERE snapshot_at >= NOW() - (%s || \' days\')::interval
        ORDER BY snapshot_at ASC
    """, (days,))

    if not rows:
        return {"series": [], "summary": None}

    series = [
        {"t": r["snapshot_at"].isoformat(), "nlv": float(r["nlv"])}
        for r in rows
    ]
    first_nlv = float(rows[0]["nlv"])
    last_nlv  = float(rows[-1]["nlv"])
    change    = last_nlv - first_nlv
    change_pct = (change / first_nlv * 100) if first_nlv else 0
    nlvs = [float(r["nlv"]) for r in rows]

    summary = {
        "start_at": rows[0]["snapshot_at"].isoformat(),
        "end_at":   rows[-1]["snapshot_at"].isoformat(),
        "start_nlv": round(first_nlv, 2),
        "end_nlv":   round(last_nlv, 2),
        "change":    round(change, 2),
        "change_pct": round(change_pct, 2),
        "min_nlv":   round(min(nlvs), 2),
        "max_nlv":   round(max(nlvs), 2),
        "points":    len(series),
    }
    return {"series": series, "summary": summary}


# close_reasons que NO cuentan: trades del sistema viejo o correcciones manuales
# que contaminan la expectativa. Mismo criterio que check_closed.py.
CLOSED_EXCLUDE = ("PRE_RULES", "INVALID_STRIKES", "MANUAL_PRICE_FIX")


def _closed_libro(table, since):
    rows = query(f"""
        SELECT ticker, strategy, close_reason, gross_pnl, pnl_pct, closed_at
        FROM {table}
        WHERE UPPER(status) = 'CLOSED'
          AND (close_reason IS NULL OR close_reason NOT IN %s)
          AND closed_at >= %s
        ORDER BY closed_at DESC
    """, (CLOSED_EXCLUDE, since))

    trades = []
    wins = losses = 0
    total_pnl = 0.0
    sum_win = sum_loss = 0.0
    for r in rows:
        pnl = float(r["gross_pnl"]) if r["gross_pnl"] is not None else 0.0
        total_pnl += pnl
        if pnl >= 0:
            wins += 1; sum_win += pnl
        else:
            losses += 1; sum_loss += pnl
        trades.append({
            "ticker": r["ticker"],
            "strategy": r["strategy"],
            "close_reason": r["close_reason"],
            "pnl": round(pnl, 2),
            "pnl_pct": float(r["pnl_pct"]) if r["pnl_pct"] is not None else None,
            "closed_at": r["closed_at"].isoformat() if r["closed_at"] else None,
        })

    n = len(trades)
    avg_win  = sum_win / wins if wins else 0
    avg_loss = sum_loss / losses if losses else 0
    # Expectativa por trade = (win% * gan_prom) + (loss% * perd_prom)
    expectancy = ((wins/n)*avg_win + (losses/n)*avg_loss) if n else 0

    summary = {
        "count": n,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wins / n * 100, 0) if n else 0,
        "total_pnl": round(total_pnl, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "expectancy": round(expectancy, 2),
    }
    return {"trades": trades, "summary": summary}


@app.get("/api/closed")
def get_closed(since: str = "2026-06-20", _auth: bool = Depends(require_auth)):
    """
    Trades cerrados de ambos libros desde 'since' (default 2026-06-20, post-reglas).
    Excluye trades del sistema viejo. Devuelve trades + metricas (win rate,
    expectativa) por libro.
    """
    return {
        "since": since,
        "live":  _closed_libro("positions", since),
        "paper": _closed_libro("paper_positions", since),
    }


@app.get("/api/runs")
def get_runs(limit: int = 30, _auth: bool = Depends(require_auth)):
    """
    Ultimos runs del auto_run (que decidio el LLM y por que). Lee auto_run_logs.
    En def los runs son mode='def' (un run cubre ambos libros).
    """
    rows = query("""
        SELECT run_at, slot, verdict, vix, opened, closed, errors,
               summary, no_trade_reason, run_time_sec, mode
        FROM auto_run_logs
        ORDER BY run_at DESC
        LIMIT %s
    """, (limit,))

    runs = []
    for r in rows:
        runs.append({
            "run_at": r["run_at"].isoformat() if r["run_at"] else None,
            "slot": r["slot"],
            "verdict": r["verdict"],
            "vix": float(r["vix"]) if r["vix"] is not None else None,
            "opened": r["opened"],
            "closed": r["closed"],
            "errors": r["errors"],
            "summary": r["summary"],
            "no_trade_reason": r["no_trade_reason"],
            "run_time_sec": r["run_time_sec"],
            "mode": r["mode"],
        })
    return {"runs": runs}


@app.get("/api/health")
def health():
    """Ping simple para saber que el backend vive."""
    return {"status": "ok"}