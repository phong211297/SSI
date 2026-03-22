"""
worker/crawlers/price.py — Real-time price crawler
Fetch giá từ VNDirect API, lưu DB, cache Redis, publish Pub/Sub
"""

import json
import logging
from datetime import datetime, timezone

import httpx

from db import Database, execute_many, get_redis, PRICE_CHANNEL

logger = logging.getLogger(__name__)

VNDIRECT_API = "https://finfo-api.vndirect.com.vn/v4"
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; SSI-Worker/1.0)",
}

# Timeout request (giây)
REQUEST_TIMEOUT = 5


def get_active_tickers() -> list[str]:
    """Lấy danh sách mã đang active từ DB."""
    with Database() as db:
        rows = db.fetchall("SELECT ticker FROM stocks WHERE is_active = true ORDER BY ticker")
    return [r["ticker"] for r in rows]


def fetch_prices_from_vndirect(tickers: list[str]) -> list[dict]:
    """
    Gọi VNDirect API lấy giá mới nhất của nhiều mã cùng lúc.
    API trả về price mới nhất theo ngày (không phải tick-by-tick).
    """
    if not tickers:
        return []

    # Build query: code:VNM~code:VCB~...
    # VNDirect hỗ trợ tối đa 50 mã/request
    chunk_size = 50
    all_prices = []

    for i in range(0, len(tickers), chunk_size):
        chunk = tickers[i : i + chunk_size]
        query = "~".join(f"code:{t}" for t in chunk)

        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
                resp = client.get(
                    f"{VNDIRECT_API}/stockPrices",
                    params={
                        "sort": "-date",
                        "q": query,
                        "size": len(chunk),
                        "fields": "code,date,close,open,high,low,nmVolume,pricePreviousClose,percentPriceChange",
                    },
                    headers=HEADERS,
                )
                resp.raise_for_status()
                data = resp.json().get("data", [])
                all_prices.extend(data)

        except (httpx.RequestError, httpx.HTTPStatusError) as e:
            logger.warning(f"VNDirect API error for chunk {chunk[:3]}...: {e}")

    return all_prices


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
                now,                        # time (dùng now vì là real-time tick)
                p["code"].upper(),          # ticker
                _parse_price(p.get("open")),
                _parse_price(p.get("high")),
                _parse_price(p.get("low")),
                _parse_price(p.get("close")),
                int(p.get("nmVolume") or 0),
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
    Cache từng mã vào Redis + publish event batch lên channel.
    Next.js SSE endpoint subscribe channel này.
    """
    r = get_redis()
    pipe = r.pipeline()

    publish_data = []

    for p in prices:
        ticker = p.get("code", "").upper()
        if not ticker:
            continue

        price_data = {
            "code": ticker,
            "close": _parse_price(p.get("close")),
            "open": _parse_price(p.get("open")),
            "high": _parse_price(p.get("high")),
            "low": _parse_price(p.get("low")),
            "volume": int(p.get("nmVolume") or 0),
            "pricePreviousClose": _parse_price(p.get("pricePreviousClose")),
            "percentPriceChange": float(p.get("percentPriceChange") or 0),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Cache 10 giây
        pipe.setex(f"price:{ticker}", 10, json.dumps(price_data))
        publish_data.append(price_data)

    pipe.execute()

    # Publish một message chứa tất cả giá (giảm số lần publish)
    if publish_data:
        r.publish(PRICE_CHANNEL, json.dumps({
            "prices": publish_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))


def crawl_prices() -> None:
    """
    Main function — được gọi bởi scheduler.
    Flow: fetch → upsert DB → cache + publish Redis
    """
    try:
        tickers = get_active_tickers()
        if not tickers:
            logger.warning("No active tickers found in DB")
            return

        prices = fetch_prices_from_vndirect(tickers)
        if not prices:
            logger.warning("No price data returned from VNDirect")
            return

        count = upsert_prices_to_db(prices)
        cache_and_publish(prices)

        logger.info(f"crawl_prices: {count} records updated, {len(prices)} published")

    except Exception as e:
        logger.error(f"crawl_prices failed: {e}", exc_info=True)


def _parse_price(value) -> float | None:
    """Parse giá trị giá — trả về None nếu không hợp lệ."""
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
