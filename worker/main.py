"""
worker/main.py — Scheduler entry point
Chạy tất cả jobs theo lịch: giá real-time, chỉ số kỹ thuật, tin tức
"""

import logging
import os
import threading
import time
from datetime import datetime, timezone, timedelta

import uvicorn
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv

load_dotenv()

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("worker.main")

# ─── Import jobs ──────────────────────────────────────────────────────────────
from crawlers.price import crawl_prices
from crawlers.history import backfill_all
from processors.indicators import calc_indicators_for_all

ICT = timezone(timedelta(hours=7))  # Asia/Ho_Chi_Minh — UTC+7


def is_trading_hours() -> bool:
    """
    Kiểm tra giờ giao dịch HOSE/HNX.
    Thứ 2-6, 9:00-15:00 ICT (UTC+7)
    Dùng timezone-aware datetime để tránh sai lệch khi chạy trong Docker (UTC).
    """
    now = datetime.now(ICT)                 # Luôn lấy giờ ICT, bất kể TZ của container
    is_weekday = now.weekday() < 5          # Mon=0 ... Fri=4
    hour = now.hour
    minute = now.minute
    is_market_open = (hour == 9 and minute >= 0) or (10 <= hour <= 14) or (hour == 15 and minute == 0)
    return is_weekday and is_market_open


def safe_crawl_prices():
    """Chỉ crawl giá trong giờ giao dịch. Set BYPASS_TRADING_HOURS=true để force chạy khi test."""
    bypass = os.environ.get("BYPASS_TRADING_HOURS", "false").lower() == "true"
    if bypass:
        logger.info("[DEV] BYPASS_TRADING_HOURS=true — force crawling outside trading hours")
        crawl_prices()
    elif is_trading_hours():
        crawl_prices()
    else:
        logger.info("Outside trading hours (ICT 9:00-15:00 Mon-Fri) — skipping price crawl")


def safe_calc_indicators():
    """Tính chỉ số kỹ thuật. Chạy cả ngoài giờ giao dịch."""
    calc_indicators_for_all()


# ─── Main Scheduler ───────────────────────────────────────────────────────────

def main():
    logger.info("━━━ SSI Data Worker starting ━━━")
    logger.info(f"Environment: {os.environ.get('ENVIRONMENT', 'development')}")

    # Chờ DB + Redis ready (khi chạy trong Docker)
    startup_delay = int(os.environ.get("STARTUP_DELAY_SECONDS", "5"))
    if startup_delay > 0:
        logger.info(f"Waiting {startup_delay}s for dependencies to be ready...")
        time.sleep(startup_delay)

    # ─── Start FastAPI sidecar trong background thread ────────────────────────
    from api import app as fastapi_app

    api_port = int(os.environ.get("API_PORT", "8000"))

    def run_api():
        uvicorn.run(fastapi_app, host="0.0.0.0", port=api_port, log_level="warning")

    api_thread = threading.Thread(target=run_api, daemon=True)
    api_thread.start()
    logger.info(f"✓ FastAPI sidecar started on port {api_port}")

    scheduler = BlockingScheduler(timezone="Asia/Ho_Chi_Minh")

    # ─── Giá real-time: mỗi 1 phút (trong giờ giao dịch) ───────────────────────
    scheduler.add_job(
        safe_crawl_prices,
        trigger=IntervalTrigger(minutes=1),
        id="price_crawler",
        name="Real-time Price Crawler",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=30,
    )

    # ─── Chỉ số kỹ thuật: mỗi 5 phút ────────────────────────────────────────
    scheduler.add_job(
        safe_calc_indicators,
        trigger=IntervalTrigger(minutes=5),
        id="indicator_calculator",
        name="Technical Indicator Calculator",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=120,
    )

    # ─── Khởi động: backfill lịch sử trước, rồi chạy các job ban đầu ─────────
    logger.info("Running initial jobs on startup...")

    # 1. Backfill lịch sử  năm (bỏ qua nếu đã có đủ data)
    try:
        logger.info("[History] Starting historical data backfill (5 years)...")
        result = backfill_all(years=30, force=True)
        logger.info(f"✓ History backfill done: {result}")
    except Exception as e:
        logger.warning(f"History backfill failed (non-critical): {e}")

    # 2. Crawl giá real-time
    try:
        safe_crawl_prices()
        logger.info("✓ Initial price crawl done")
    except Exception as e:
        logger.warning(f"Initial price crawl failed (will retry on schedule): {e}")

    # 3. Tính chỉ số kỹ thuật (sau khi đã có lịch sử)
    try:
        safe_calc_indicators()
        logger.info("✓ Initial indicator calculation done")
    except Exception as e:
        logger.warning(f"Initial indicator calc failed (will retry on schedule): {e}")

    # ─── Start ────────────────────────────────────────────────────────────────
    logger.info("━━━ Scheduler started ━━━")
    logger.info("  • Price crawler:       every 1min (trading hours only)")
    logger.info("  • Indicator calc:      every 5min")
    logger.info(f"  • FastAPI sidecar:    http://0.0.0.0:{api_port}/docs")
    logger.info("Press Ctrl+C to stop")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Worker stopped gracefully.")


if __name__ == "__main__":
    main()
