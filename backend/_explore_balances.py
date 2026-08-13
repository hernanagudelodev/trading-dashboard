"""
_explore_balances.py — EXPLORACION. Busca si Tastytrade expone NLV historico.
Prueba metodos del SDK que podrian dar balances/snapshots por fecha.
Temporal, no va a ningun lado.
"""
import os, asyncio
from datetime import date, timedelta
from dotenv import load_dotenv
load_dotenv()

async def main():
    from tastytrade import Session
    from tastytrade.account import Account
    session = Session(os.getenv("TASTYTRADE_CLIENT_SECRET"),
                      os.getenv("TASTYTRADE_REFRESH_TOKEN"))
    account = (await Account.get(session))[0]
    print(f"Cuenta: {account.account_number}\n")

    # 1. Ver TODOS los metodos/atributos del objeto Account que suenen a balance/history
    print("=== metodos de Account relacionados a balance/history/snapshot ===")
    for attr in dir(account):
        if any(k in attr.lower() for k in ("balance", "history", "snapshot", "net_liq", "value")):
            print(f"  {attr}")

    # 2. Probar get_balance_snapshots si existe (nombre comun en la API REST de TT)
    print("\n=== intento: balance snapshots historicos ===")
    desde = date.today() - timedelta(days=90)
    for metodo in ("get_balance_snapshots", "get_net_liquidating_value_history",
                   "get_balance_history"):
        fn = getattr(account, metodo, None)
        if fn is None:
            print(f"  {metodo}: NO existe en el SDK")
            continue
        try:
            try:
                res = await fn(session, start_date=desde)
            except TypeError:
                res = fn(session, start_date=desde)
            print(f"  {metodo}: EXISTE — devolvio {len(res)} registros")
            if res:
                r = res[0]
                print(f"    ejemplo: {({k:v for k,v in vars(r).items() if not k.startswith('_')} if hasattr(r,'__dict__') else r)}")
        except Exception as e:
            print(f"  {metodo}: existe pero fallo -> {e}")

asyncio.run(main())