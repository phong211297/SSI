"""
worker/crawlers/history.py — Historical Price Backfill
Fetch lịch sử OHLCV nhiều năm từ VCI (qua vnstock) và lưu vào stock_prices_history.
Chạy 1 lần khi khởi động nếu bảng chưa có dữ liệu, hoặc gọi thủ công qua API.

Flow: vnstock VCI history → upsert stock_prices_history
"""

import logging
from datetime import datetime, timedelta, timezone, date

from db import Database, execute_many

logger = logging.getLogger(__name__)

# Mặc định lấy 5 năm lịch sử
DEFAULT_YEARS = 5
# Số mã xử lý mỗi batch (tránh timeout)
BATCH_SIZE = 5


def get_active_tickers() -> list[str]:
    """Lấy danh sách mã đang active từ DB."""
    with Database() as db:
        rows = db.fetchall("SELECT ticker FROM stocks WHERE is_active = true ORDER BY ticker")
    return [r["ticker"] for r in rows]


def has_history(ticker: str, min_days: int = 200) -> bool:
    """Kiểm tra xem mã đã có đủ dữ liệu lịch sử chưa (mặc định 200 ngày = ~1 năm)."""
    with Database() as db:
        row = db.fetchone(
            "SELECT COUNT(*) as cnt FROM stock_prices_history WHERE ticker = %s",
            (ticker,)
        )
    return (row["cnt"] if row else 0) >= min_days


def get_latest_history_date(ticker: str) -> date | None:
    """
    Trả về ngày mới nhất đã có trong stock_prices_history.
    Dùng để xác định phần còn thiếu cần fetch.
    """
    with Database() as db:
        row = db.fetchone(
            "SELECT MAX(time)::date AS last_date FROM stock_prices_history WHERE ticker = %s",
            (ticker,)
        )
    if row and row.get("last_date"):
        d = row["last_date"]
        return d if isinstance(d, date) else date.fromisoformat(str(d))
    return None


def fetch_history_from_vci(ticker: str, start: date, end: date) -> list[dict]:
    """
    Dùng vnstock (VCI source) để lấy OHLCV lịch sử theo ngày.
    Trả về list dict với keys: date, open, high, low, close, volume
    """
    try:
        from vnstock import Vnstock
    except ImportError:
        logger.error("vnstock chưa được cài — chạy: pip install vnstock")
        return []

    try:
        stock = Vnstock().stock(symbol=ticker, source="VCI")
        df = stock.quote.history(
            symbol=ticker,
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            interval="1D",
        )

        if df is None or df.empty:
            logger.warning(f"[History] No data for {ticker} ({start} → {end})")
            return []

        records = []
        for _, row in df.iterrows():
            try:
                records.append({
                    "date":   row["time"] if hasattr(row["time"], "date") else row["time"],
                    "open":   _to_price(row.get("open")),
                    "high":   _to_price(row.get("high")),
                    "low":    _to_price(row.get("low")),
                    "close":  _to_price(row.get("close")),
                    "volume": int(row.get("volume") or 0),
                })
            except Exception as e:
                logger.debug(f"[History] Skip row for {ticker}: {e}")

        logger.info(f"[History] {ticker}: fetched {len(records)} days ({start} → {end})")
        return records

    except Exception as e:
        logger.warning(f"[History] VCI error for {ticker}: {e}")
        return []


def upsert_history(ticker: str, records: list[dict]) -> int:
    """Bulk upsert vào stock_prices_history."""
    if not records:
        return 0

    rows = []
    for r in records:
        try:
            # Chuyển date → datetime UTC (9:00 giờ VN = 02:00 UTC)
            d = r["date"]
            if isinstance(d, datetime):
                ts = d.replace(tzinfo=timezone.utc)
            elif hasattr(d, "to_pydatetime"):
                ts = d.to_pydatetime().replace(tzinfo=timezone.utc)
            else:
                ts = datetime(d.year, d.month, d.day, 2, 0, 0, tzinfo=timezone.utc)

            rows.append((
                ts,
                ticker.upper(),
                r.get("open"),
                r.get("high"),
                r.get("low"),
                r.get("close"),
                int(r.get("volume") or 0),
            ))
        except Exception as e:
            logger.debug(f"[History] Skip malformed record for {ticker}: {e}")

    if not rows:
        return 0

    sql = """
        INSERT INTO stock_prices_history (time, ticker, open, high, low, close, volume)
        VALUES %s
        ON CONFLICT (time, ticker) DO UPDATE SET
            open   = EXCLUDED.open,
            high   = EXCLUDED.high,
            low    = EXCLUDED.low,
            close  = EXCLUDED.close,
            volume = EXCLUDED.volume
    """
    execute_many(sql, rows)
    return len(rows)


def backfill_ticker(ticker: str, years: int = DEFAULT_YEARS, force: bool = False) -> int:
    """
    Backfill lịch sử cho 1 mã — smart incremental:
    - force=False: chỉ fetch phần còn thiếu kể từ ngày cuối trong DB
    - force=True : fetch lại toàn bộ (dùng khi cần normalize/migrate data)
    Trả về số records đã upsert.
    """
    end_date   = date.today()

    if force:
        # Force full re-fetch: từ (hôm nay - years năm) đến hôm nay
        start_date = end_date - timedelta(days=365 * years)
        logger.info(f"[History] {ticker}: force full re-fetch ({start_date} → {end_date})")
    else:
        last_date = get_latest_history_date(ticker)

        if last_date is None:
            # Chưa có data → fetch toàn bộ years năm
            start_date = end_date - timedelta(days=365 * years)
            logger.info(f"[History] {ticker}: no data found, fetching full {years} years")
        elif (end_date - last_date).days <= 1:
            # Đã up-to-date → skip, 0 requests
            logger.info(f"[History] {ticker}: already up-to-date (last={last_date}), skipping")
            return 0
        else:
            # Incremental: chỉ fetch phần thiếu
            start_date = last_date + timedelta(days=1)
            gap_days = (end_date - start_date).days
            logger.info(f"[History] {ticker}: incremental fetch {gap_days} days ({start_date} → {end_date})")

    records = fetch_history_from_vci(ticker, start_date, end_date)
    if not records:
        return 0

    count = upsert_history(ticker, records)
    logger.info(f"[History] {ticker}: upserted {count} records")
    return count


def backfill_all(years: int = DEFAULT_YEARS, force: bool = False) -> dict:
    """
    Backfill lịch sử cho tất cả mã active.
    Được gọi khi worker khởi động (nếu DB chưa có data).
    """
    tickers = get_active_tickers()
    if not tickers:
        logger.warning("[History] No active tickers found")
        return {"success": 0, "skipped": 0, "failed": 0, "total_records": 0}

    logger.info(f"[History] Starting backfill for {len(tickers)} tickers ({years} years)...")

    success = 0
    skipped = 0
    failed  = 0
    total   = 0

    for i, ticker in enumerate(tickers):
        try:
            count = backfill_ticker(ticker, years=years, force=force)
            if count == 0:
                skipped += 1
            else:
                success += 1
                total   += count
        except Exception as e:
            logger.error(f"[History] Failed for {ticker}: {e}")
            failed += 1

        # Log tiến độ mỗi 5 mã
        if (i + 1) % 5 == 0:
            logger.info(f"[History] Progress: {i+1}/{len(tickers)} tickers processed")

    logger.info(
        f"[History] Backfill done: {success} updated, {skipped} skipped, "
        f"{failed} failed | Total records: {total}"
    )
    return {"success": success, "skipped": skipped, "failed": failed, "total_records": total}


def _to_price(value) -> float | None:
    try:
        v = float(value)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None
