"""
main.py — FastAPI backend del dashboard de trading (solo lectura).

Expone la data que el monitor ya mantiene en la DB. NO pricea (usa lo que el
monitor guardo en el ultimo sync, max 5min de antiguedad). NO escribe nada.

Correr:
    uvicorn main:app --reload
Docs interactivas:
    http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db import query

app = FastAPI(title="Trading Dashboard API", version="0.1.0")

# CORS: el front (React) corre en otro puerto (5173) y necesita permiso para
# consultar este backend (8000). En dev abrimos todo; en prod se restringe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
def get_positions():
    """Posiciones abiertas de ambos libros + exposicion + capital."""
    capital, snap_at = _capital_actual()
    return {
        "capital": capital,
        "capital_at": snap_at.isoformat() if snap_at else None,
        "live":  _serializar_libro("positions", capital),
        "paper": _serializar_libro("paper_positions", capital),
    }


@app.get("/api/health")
def health():
    """Ping simple para saber que el backend vive."""
    return {"status": "ok"}