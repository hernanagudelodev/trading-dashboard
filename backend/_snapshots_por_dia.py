"""Cuenta snapshots por dia — para ver si hay huecos en la serie de patrimonio."""
from dotenv import load_dotenv
load_dotenv()
import os, psycopg2
c = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = c.cursor()
cur.execute("""SELECT DATE(snapshot_at) AS dia, COUNT(*) AS n
    FROM account_snapshots GROUP BY DATE(snapshot_at) ORDER BY dia""")
rows = cur.fetchall()
print(f"Dias con snapshots: {len(rows)}\n")
prev = None
for dia, n in rows:
    gap = ""
    if prev:
        d = (dia - prev).days
        if d > 1:
            gap = f"  <-- HUECO de {d} dias"
    print(f"  {dia}  ({n} snapshots){gap}")
    prev = dia
cur.close(); c.close()