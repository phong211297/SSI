"""
worker/db.py — Shared database connections (PostgreSQL + Redis)
"""

import os
import psycopg2
import psycopg2.extras
import redis as redis_lib
from dotenv import load_dotenv

load_dotenv()

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

def get_pg_connection():
    """Tạo một connection PostgreSQL mới."""
    return psycopg2.connect(
        dsn=os.environ["DATABASE_URL"],
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


class Database:
    """Simple connection wrapper với context manager."""

    def __init__(self):
        self.conn = get_pg_connection()
        self.conn.autocommit = False

    def execute(self, sql: str, params=None):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur

    def fetchall(self, sql: str, params=None) -> list[dict]:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def fetchone(self, sql: str, params=None) -> dict | None:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        self.close()


def execute_many(sql: str, data: list[tuple]):
    """Batch insert/update — hiệu suất cao hơn loop."""
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, data, page_size=500)
        conn.commit()


# ─── Redis ─────────────────────────────────────────────────────────────────────

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

_redis_client: redis_lib.Redis | None = None


def get_redis() -> redis_lib.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


# Redis Pub/Sub channels (phải khớp với Next.js redis.ts)
PRICE_CHANNEL = "price-updates"
ALERT_CHANNEL = "price-alerts"
