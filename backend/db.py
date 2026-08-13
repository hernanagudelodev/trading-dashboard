"""
db.py — conexion a la DB del sistema de trading (solo lectura).
Reusa el mismo DATABASE_URL que el sistema. El dashboard NUNCA escribe:
todos los queries son SELECT.
"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()


def get_conn():
    """Conexion nueva por request. RealDictCursor -> filas como dicts (JSON-ready)."""
    return psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=RealDictCursor)


def query(sql, params=None):
    """Ejecuta un SELECT y devuelve lista de dicts. Cierra todo al terminar."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params or ())
        rows = cur.fetchall()
        cur.close()
        return rows
    finally:
        conn.close()