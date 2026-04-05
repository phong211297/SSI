"""
worker/crawlers/price.py — Real-time price crawler
Fetch giá từ VCI (qua vnstock) thay cho VNDirect (bị block trong Docker).
VCI không yêu cầu API key, hoạt động ổn định trong môi trường server/container.

Flow: vnstock VCI → upsert PostgreSQL → cache Redis → publish Pub/Sub SSE
"""

import logging
from datetime import datetime, timezone

from db import Database, execute_many, get_redis, PRICE_CHANNEL
import json

logger = logging.getLogger(__name__)

# Số mã tối đa mỗi batch gọi price_board
CHUNK_SIZE = 50


def get_active_tickers() -> list[str]:
    """Lấy danh sách mã đang active từ DB."""
    with Database() as db:
        rows = db.fetchall("SELECT ticker FROM stocks WHERE is_active = true ORDER BY ticker")
    return [r["ticker"] for r in rows]


def fetch_prices_from_vci(tickers: list[str]) -> list[dict]:
    """
    Dùng vnstock (VCI source) để lấy price board nhiều mã cùng lúc.
    Trả về list dict chuẩn hóa với keys: code, open, high, low, close, volume, ref_price, date
    """
    if not tickers:
        return []

    try:
        from vnstock import Vnstock
    except ImportError:
        logger.error("vnstock chưa được cài — chạy: pip install vnstock")
        return []

    all_data: list[dict] = []

    # Chia nhỏ để tránh timeout nếu quá nhiều mã
    for i in range(0, len(tickers), CHUNK_SIZE):
        chunk = tickers[i: i + CHUNK_SIZE]
        try:
            stock = Vnstock().stock(symbol=chunk[0], source="VCI")
            df = stock.trading.price_board(chunk)

            if df is None or df.empty:
                logger.warning(f"VCI: No data for chunk {chunk[:3]}...")
                continue

            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

            for _, row in df.iterrows():
                try:
                    code      = str(row[("listing", "symbol")]).upper()
                    open_p    = _to_price(row.get(("match", "open_price")))
                    high_p    = _to_price(row.get(("match", "highest")))
                    low_p     = _to_price(row.get(("match", "lowest")))
                    close_p   = _to_price(row.get(("match", "match_price")))
                    volume    = int(row.get(("match", "accumulated_volume")) or 0)
                    ref_price = _to_price(row.get(("listing", "ref_price")))

                    # Tính % thay đổi so với giá tham chiếu
                    pct_change = 0.0
                    if close_p and ref_price and ref_price > 0:
                        pct_change = round((close_p - ref_price) / ref_price * 100, 2)

                    all_data.append({
                        "code":               code,
                        "date":               today,
                        "open":               open_p,
                        "high":               high_p,
                        "low":                low_p,
                        "close":              close_p,
                        "volume":             volume,
                        "pricePreviousClose": ref_price,
                        "percentPriceChange": pct_change,
                    })
                except Exception as e:
                    logger.debug(f"VCI: skip row error — {e}")

        except Exception as e:
            logger.warning(f"VCI API error for chunk {chunk[:3]}...: {e}")

    return all_data


def upsert_prices_to_db(prices: list[dict]) -> int:
    """
    Bulk upsert giá vào stock_prices table.
    Dùng ON CONFLICT DO UPDATE để idempotent.
    """
    if not prices:
        return 0

    now = datetime.now(timezone.utc)
    rows = []

    for p in prices:
        try:
            rows.append((
                now,
                p["code"].upper(),
                p.get("open"),
                p.get("high"),
                p.get("low"),
                p.get("close"),
                int(p.get("volume") or 0),
            ))
        except (KeyError, TypeError, ValueError) as e:
            logger.debug(f"Skip malformed price record: {e}")

    if not rows:
        return 0

    sql = """
        INSERT INTO stock_prices (time, ticker, open, high, low, close, volume)
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


def cache_and_publish(prices: list[dict]) -> None:
    """
    Cache từng mã vào Redis (TTL 70s = đủ sống qua 1 chu kỳ crawl 1 phút)
    + publish event batch lên channel cho Next.js SSE endpoint.
    """
    r = get_redis()
    pipe = r.pipeline()
    publish_data = []

    for p in prices:
        ticker = p.get("code", "").upper()
        if not ticker:
            continue

        price_data = {
            "code":               ticker,
            "close":              p.get("close"),
            "open":               p.get("open"),
            "high":               p.get("high"),
            "low":                p.get("low"),
            "volume":             p.get("volume", 0),
            "pricePreviousClose": p.get("pricePreviousClose"),
            "percentPriceChange": p.get("percentPriceChange", 0.0),
            "updatedAt":          datetime.now(timezone.utc).isoformat(),
        }

        pipe.setex(f"price:{ticker}", 70, json.dumps(price_data))
        publish_data.append(price_data)

    pipe.execute()

    if publish_data:
        r.publish(PRICE_CHANNEL, json.dumps({
            "prices":    publish_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))


def crawl_prices() -> None:
    """
    Main function — được gọi bởi scheduler mỗi 1 phút (giờ giao dịch).
    Flow: fetch VCI → log → upsert DB → cache + publish Redis
    """
    try:
        tickers = get_active_tickers()
        if not tickers:
            logger.warning("No active tickers found in DB")
            return

        logger.info(f"[VCI] Fetching {len(tickers)} tickers: {tickers[:10]}{'...' if len(tickers) > 10 else ''}")

        prices = fetch_prices_from_vci(tickers)
        if not prices:
            logger.warning("[VCI] No price data returned")
            return

        # ─── Log chi tiết từng mã fetch về ────────────────────────────────────
        logger.info(f"[VCI] Received {len(prices)} records:")
        for p in prices:
            code  = p.get("code", "?")
            date  = p.get("date", "?")
            o     = p.get("open", "N/A")
            h     = p.get("high", "N/A")
            l     = p.get("low",  "N/A")
            c     = p.get("close", "N/A")
            vol   = p.get("volume", 0)
            pct   = p.get("percentPriceChange", 0)
            ref   = p.get("pricePreviousClose", "N/A")
            logger.info(
                f"  {code:6s} | {date} | ref={ref} O={o} H={h} L={l} C={c}"
                f" | vol={vol:,} | chg={pct:+.2f}%"
            )

        count = upsert_prices_to_db(prices)
        cache_and_publish(prices)

        logger.info(f"[DB] Upserted {count} records | [Redis] Published {len(prices)} prices")

    except Exception as e:
        logger.error(f"crawl_prices failed: {e}", exc_info=True)


def _to_price(value) -> float | None:
    """Parse giá trị giá — trả về None nếu không hợp lệ."""
    try:
        v = float(value)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None
