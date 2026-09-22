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

# Worker-API: servicio interno (red privada Railway) que calcula el rendimiento
# ajustado por flujos (TWR) y el P&L real. El dashboard NO duplica esa logica —
# la consume. Hostname interno + token compartido por env var.
WORKER_API_URL   = os.getenv("WORKER_API_URL", "http://tradingworker.railway.internal:8080")
WORKER_API_TOKEN = os.getenv("WORKER_API_TOKEN", "")

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


def _market_status_now():
    """Estado del mercado calculado por hora ET (v2 no lo guarda en el snapshot).
    'open' en horario de sesion los dias habiles, si no 'closed'."""
    try:
        import datetime as dt
        from zoneinfo import ZoneInfo
        et = dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo("America/New_York"))
        if et.weekday() >= 5:
            return "closed"
        mins = et.hour * 60 + et.minute
        return "Open" if (9 * 60 + 30) <= mins < (16 * 60) else "Closed"
    except Exception:
        return None


def _current_capital():
    """Ultimo NLV registrado (account_snapshots) + estado del mercado (calculado por
    hora ET, porque v2 no graba market_status en el snapshot)."""
    rows = query("""
        SELECT net_liquidating_value AS nlv, snapshot_at
        FROM account_snapshots
        ORDER BY snapshot_at DESC LIMIT 1
    """)
    if not rows:
        return None, None, None
    return float(rows[0]["nlv"]), rows[0]["snapshot_at"], _market_status_now()


def _open_positions(table):
    """Posiciones OPEN de una tabla (positions|paper_positions), como dicts."""
    return query(f"""
        SELECT id, ticker, strategy, strike_low, strike_high,
               contracts, expiration, premium_paid, total_cost,
               gross_pnl, pnl_pct, profit_pct_of_max,
               current_spread_value, current_value,
               last_alert_level, last_synced_at, opened_at
        FROM {table}
        WHERE UPPER(status) = 'OPEN'
        ORDER BY opened_at
    """)


def _serialize_book(table, capital):
    """Arma {positions:[...], exposure:{...}} para un libro."""
    rows = _open_positions(table)
    positions = []
    total_pnl = 0.0
    total_max_loss = 0.0

    # v2 es BIDIRECCIONAL: el tipo y el riesgo salen de la ESTRUCTURA (columna
    # `strategy`), NO del signo del premium (que solo distinguia debito/credito y
    # confundia Bear con Bull). Estructuras: Bull/Bear Call/Put Spread, Long Call/Put.
    _CREDIT = ("Bull Put Spread", "Bear Call Spread")   # se abre cobrando
    _LONG   = ("Long Call", "Long Put")                 # 1 pata, sin strike_high
    for r in rows:
        strategy = r["strategy"] or ""
        sl   = float(r["strike_low"] or 0)
        sh   = float(r["strike_high"]) if r["strike_high"] is not None else None
        ctr  = int(r["contracts"] or 1)
        cost = abs(float(r["total_cost"] or 0))
        is_long   = strategy in _LONG
        is_credit = strategy in _CREDIT

        # Max loss por estructura:
        #   Long (1 pata): la prima pagada (total_cost).
        #   Debito (Bull Call / Bear Put): el debito pagado (total_cost).
        #   Credito (Bull Put / Bear Call): width del spread - credito recibido.
        if is_long or not is_credit:
            max_loss = cost
        else:
            width = abs(sh - sl) * 100 * ctr if sh is not None else 0
            max_loss = width - cost
        total_max_loss += max_loss
        pnl = float(r["gross_pnl"]) if r["gross_pnl"] is not None else None
        if pnl is not None:
            total_pnl += pnl

        positions.append({
            "id": r["id"],
            "ticker": r["ticker"],
            "type": strategy,
            "sector": None,
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

    # Exposicion agregada (mismo criterio que el sistema de trading: max_loss vs
    # tope de cartera). El tope se lee de MAX_PORTFOLIO_RISK_PCT — la MISMA env var
    # que usa el worker para frenar aperturas por riesgo. Asi el dashboard refleja
    # el tope REAL configurado (no un valor hardcodeado que se desincroniza).
    TOPE_PCT = float(os.getenv("MAX_PORTFOLIO_RISK_PCT", "40"))
    max_risk = capital * TOPE_PCT / 100.0 if capital else 0
    exposure = {
        "open_count": len(positions),
        "total_pnl": round(total_pnl, 2),
        "total_max_loss": round(total_max_loss, 2),
        "pct_of_capital": round(total_max_loss / capital * 100, 1) if capital else None,
        "risk_cap": round(max_risk, 2),
        "risk_pct": TOPE_PCT,
        "pct_of_cap_used": round(total_max_loss / max_risk * 100, 1) if max_risk else None,
        "margin_to_open": round(max_risk - total_max_loss, 2) if max_risk else None,
    }
    return {"positions": positions, "exposure": exposure}


@app.get("/api/positions")
def get_positions(_auth: bool = Depends(require_auth)):
    """Posiciones abiertas de ambos libros + exposicion + capital."""
    capital, snap_at, market_status = _current_capital()
    return {
        "capital": capital,
        "capital_at": snap_at.isoformat() if snap_at else None,
        "market_status": market_status,
        "live":  _serialize_book("positions", capital),
        "paper": _serialize_book("paper_positions", capital),
    }


@app.get("/api/spy")
def get_spy(days: int = 90, from_date: str = None, to_date: str = None,
            _auth: bool = Depends(require_auth)):
    """
    Serie de SPY (cierre diario) para comparar contra la curva de patrimonio.
    Mismo rango que /api/equity. El backend trae los datos crudos; la
    normalizacion (a % desde el inicio) la hace el frontend, para alinearla con
    el primer punto real del NLV.

    v2: lee de candle_daily (fuente unica, Tastytrade) en vez de yfinance. Si no
    hay velas de SPY en el rango, devuelve series vacia (degradacion suave: la
    curva de patrimonio se dibuja igual, sin el benchmark).
    """
    from datetime import timedelta, date as _date
    # Resolver el rango de fechas
    if from_date or to_date:
        start = from_date or (_date.today() - timedelta(days=3650)).isoformat()
        end   = to_date or _date.today().isoformat()
    else:
        start = (_date.today() - timedelta(days=int(days))).isoformat()
        end   = _date.today().isoformat()

    try:
        rows = query("""
            SELECT candle_date, close
            FROM candle_daily
            WHERE ticker = 'SPY'
              AND candle_date >= %s AND candle_date <= %s
              AND close IS NOT NULL
            ORDER BY candle_date
        """, (start, end))
        if not rows:
            return {"series": [], "error": "sin datos de SPY en el rango"}
        series = [
            {"t": r["candle_date"].isoformat(), "close": round(float(r["close"]), 2)}
            for r in rows
        ]
        return {"series": series, "error": None}
    except Exception as e:
        return {"series": [], "error": f"no se pudo cargar SPY ({type(e).__name__})"}


@app.get("/api/equity")
def get_equity(days: int = 90, from_date: str = None, to_date: str = None,
               _auth: bool = Depends(require_auth)):
    """
    Serie de patrimonio (NLV) para la curva + resumen del periodo.

    Rango, en orden de prioridad:
      - from_date / to_date (YYYY-MM-DD): rango explicito (filtro dinamico).
        Cualquiera de los dos puede omitirse (open-ended).
      - days: ventana hacia atras (default 90). Para "siempre", el front manda
        un numero grande (ej. 99999) y trae todo el historico.
    """
    if from_date or to_date:
        # Rango explicito. Construimos el WHERE con los bordes que haya.
        clauses, params = [], []
        if from_date:
            clauses.append("snapshot_at >= %s")
            params.append(from_date)
        if to_date:
            # incluir todo el dia 'to_date' -> < dia siguiente
            clauses.append("snapshot_at < (%s::date + INTERVAL '1 day')")
            params.append(to_date)
        where = " AND ".join(clauses)
        rows = query(f"""
            SELECT snapshot_at, net_liquidating_value AS nlv, cash_balance
            FROM account_snapshots
            WHERE {where}
            ORDER BY snapshot_at ASC
        """, tuple(params))
    else:
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

    # Drawdown maximo: peor caida desde un pico previo (en $ y en %).
    peak = nlvs[0]
    max_dd = 0.0
    max_dd_pct = 0.0
    for v in nlvs:
        if v > peak:
            peak = v
        dd = v - peak
        if dd < max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak * 100) if peak else 0

    summary = {
        "start_at": rows[0]["snapshot_at"].isoformat(),
        "end_at":   rows[-1]["snapshot_at"].isoformat(),
        "start_nlv": round(first_nlv, 2),
        "end_nlv":   round(last_nlv, 2),
        "change":    round(change, 2),
        "change_pct": round(change_pct, 2),
        "min_nlv":   round(min(nlvs), 2),
        "max_nlv":   round(max(nlvs), 2),
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "points":    len(series),
    }
    return {"series": series, "summary": summary}


@app.get("/api/twr")
def get_twr(days: int = 90, from_date: str = None, to_date: str = None,
            _auth: bool = Depends(require_auth)):
    """
    Rendimiento ajustado por flujos (TWR %) + P&L real acumulado ($), calculado
    por la worker-api (servicio interno con la logica en trade.py). El dashboard
    NO duplica la formula — la consume. Degradacion suave: si la worker-api no
    responde, devuelve disponible=False y el front cae a la curva de NLV cruda.
    """
    import urllib.request, urllib.parse, json as _json

    qs = {"days": days}
    if from_date: qs["from_date"] = from_date
    if to_date:   qs["to_date"]   = to_date
    url = f"{WORKER_API_URL}/twr?" + urllib.parse.urlencode(qs)

    req = urllib.request.Request(url)
    if WORKER_API_TOKEN:
        req.add_header("X-Internal-Token", WORKER_API_TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = _json.loads(resp.read())
        data["available"] = True
        return data
    except Exception as e:
        # La worker-api no respondio: el dashboard sigue, el front usa NLV crudo.
        return {"available": False, "error": f"worker-api no disponible ({type(e).__name__})",
                "twr_pct": None, "series": [], "pnl_series": [], "pnl_real": None,
                "net_flows": None, "raw_change": None}


# close_reasons que NO cuentan: trades del sistema viejo o correcciones manuales
# que contaminan la expectativa. Mismo criterio que check_closed.py.
CLOSED_EXCLUDE = ("PRE_RULES", "INVALID_STRIKES", "MANUAL_PRICE_FIX")


def _closed_book(table, since):
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
        "live":  _closed_book("positions", since),
        "paper": _closed_book("paper_positions", since),
    }


@app.get("/api/runs")
def get_runs(limit: int = 30, _auth: bool = Depends(require_auth)):
    """
    Ultimos runs del auto_run. Lee auto_run_logs (esquema v2: sin los campos del
    LLM viejo de def; con regime/candidates/net_delta).
    """
    rows = query("""
        SELECT run_at, slot, regime, candidates, opened, net_delta,
               summary, run_time_sec, mode
        FROM auto_run_logs
        ORDER BY run_at DESC
        LIMIT %s
    """, (limit,))

    runs = []
    for r in rows:
        runs.append({
            "run_at": r["run_at"].isoformat() if r["run_at"] else None,
            "slot": r["slot"],
            # v2 no tiene 'verdict' (LLM); el regimen del scan es lo equivalente.
            "verdict": r["regime"],
            "vix": None,                      # v2 no lo guarda como columna del log
            "opened": r["opened"],
            "closed": None,                   # v2 no cuenta cierres en el log
            "errors": None,
            "summary": r["summary"],
            "no_trade_reason": None,
            "run_time_sec": r["run_time_sec"],
            "mode": r["mode"],
            # extras de v2 (el front los usa si quiere; si no, los ignora)
            "regime": r["regime"],
            "candidates": r["candidates"],
            "net_delta": float(r["net_delta"]) if r["net_delta"] is not None else None,
        })
    return {"runs": runs}


@app.get("/api/positions/{book}/{pos_id}/detail")
def get_position_detail(book: str, pos_id: int, _auth: bool = Depends(require_auth)):
    """
    Detalle de UNA position para el modal: datos de la position, el rationale +
    context del LLM (trade_context), y la serie de price del subyacente
    (candle_daily, desde opened_at - 5 dias hasta hoy) con los strikes de referencia.

    book: 'live' (positions) o 'paper' (paper_positions).
    """
    table = "positions" if book == "live" else "paper_positions"
    ctx_fk = "position_id" if book == "live" else "paper_position_id"

    # 1. La position. OJO con los nombres reales de columna (ver _serialize_book):
    #    pnl real = gross_pnl; alert_level real = last_alert_level; max_loss se
    #    CALCULA (no es columna); current_value no se usa aca.
    rows = query(f"""
        SELECT id, ticker, strategy, strike_low, strike_high, expiration,
               premium_paid, total_cost, contracts, opened_at, price_at_open,
               status, last_alert_level, gross_pnl, pnl_pct,
               profit_pct_of_max
        FROM {table}
        WHERE id = %s
    """, (pos_id,))
    if not rows:
        raise HTTPException(404, "Posicion no encontrada.")
    p = rows[0]

    # max_loss por ESTRUCTURA (columna strategy), mismo criterio que _serialize_book.
    _CREDIT = ("Bull Put Spread", "Bear Call Spread")
    _LONG   = ("Long Call", "Long Put")
    strategy = p["strategy"] or ""
    sl   = float(p["strike_low"] or 0)
    sh   = float(p["strike_high"]) if p["strike_high"] is not None else None
    ctr  = int(p["contracts"] or 1)
    cost = abs(float(p["total_cost"] or 0))
    if strategy in _LONG or strategy not in _CREDIT:
        max_loss = cost
    else:
        width = abs(sh - sl) * 100 * ctr if sh is not None else 0
        max_loss = width - cost

    position = {
        "id": p["id"], "ticker": p["ticker"],
        "type": strategy,
        "strike_low": sl, "strike_high": sh,
        "expiration": p["expiration"].isoformat() if p["expiration"] else None,
        "opened_at": p["opened_at"].isoformat() if p["opened_at"] else None,
        "price_at_open": float(p["price_at_open"]) if p["price_at_open"] is not None else None,
        "total_cost": float(p["total_cost"]) if p["total_cost"] is not None else None,
        "max_loss": round(max_loss, 2),
        "pnl": float(p["gross_pnl"]) if p["gross_pnl"] is not None else None,
        "pnl_pct": float(p["pnl_pct"]) if p["pnl_pct"] is not None else None,
        "profit_pct_of_max": float(p["profit_pct_of_max"]) if p["profit_pct_of_max"] is not None else None,
        "alert_level": p["last_alert_level"], "sector": None,
        "status": p["status"], "contracts": ctr,
    }

    # 2. El context del LLM (rationale + campos ricos), si existe
    ctx_rows = query(f"""
        SELECT claude_rationale, price_at_signal, rsi, iv, iv_percentile,
               vix, spy_trend_25d, macro_verdict, trend_25d_pct, beta,
               strategy_selected, strategy_reason
        FROM trade_context
        WHERE {ctx_fk} = %s
        ORDER BY id DESC LIMIT 1
    """, (pos_id,))
    context = None
    if ctx_rows:
        c = ctx_rows[0]
        context = {
            "rationale": c["claude_rationale"],
            "rsi": c["rsi"], "iv": c["iv"], "iv_percentile": c["iv_percentile"],
            "vix": c["vix"], "spy_trend_25d": c["spy_trend_25d"],
            "macro_verdict": c["macro_verdict"], "trend_25d_pct": c["trend_25d_pct"],
            "beta": c["beta"], "strategy_reason": c["strategy_reason"],
        }

    # 3. Serie de price del subyacente desde candle_daily (fuente unica), desde
    #    opened_at - 5 dias. Si no hay velas del ticker, el modal igual muestra 1 y 2
    #    — el grafico es opcional (degradacion suave).
    series = None
    series_error = None
    try:
        from datetime import timedelta, date
        start = (p["opened_at"].date() - timedelta(days=5)) if p["opened_at"] else (date.today() - timedelta(days=45))
        hist = query("""
            SELECT candle_date, close FROM candle_daily
            WHERE ticker = %s AND candle_date >= %s AND close IS NOT NULL
            ORDER BY candle_date
        """, (p["ticker"], start.isoformat()))
        if hist:
            series = [
                {"date": r["candle_date"].isoformat(), "close": round(float(r["close"]), 2)}
                for r in hist
            ]
    except Exception as e:
        series_error = f"no se pudo cargar el historico ({type(e).__name__})"

    return {
        "position": position,
        "context": context,
        "series": series,
        "series_error": series_error,
    }


@app.get("/api/health")
def health():
    """Ping simple para saber que el backend vive."""
    return {"status": "ok"}