"""
worker/api.py — FastAPI HTTP sidecar
Expose manual trigger endpoints cho Swagger UI
"""

import logging
import threading
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("worker.api")

app = FastAPI(
    title="SSI Worker API",
    description="Internal API để trigger manual crawl và kiểm tra trạng thái worker",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Track trạng thái job ─────────────────────────────────────────────────────

_job_status: dict = {
    "prices":     {"last_run": None, "last_result": None, "running": False},
    "indicators": {"last_run": None, "last_result": None, "running": False},
    "history":    {"last_run": None, "last_result": None, "running": False},
}


def _run_in_thread(job_key: str, fn):
    """Chạy job trong background thread để không block HTTP response."""
    def _worker():
        _job_status[job_key]["running"] = True
        _job_status[job_key]["last_run"] = datetime.now(timezone.utc).isoformat()
        try:
            fn()
            _job_status[job_key]["last_result"] = "success"
            logger.info(f"Manual {job_key} job completed successfully")
        except Exception as e:
            _job_status[job_key]["last_result"] = f"error: {e}"
            logger.error(f"Manual {job_key} job failed: {e}")
        finally:
            _job_status[job_key]["running"] = False

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
def health():
    """Kiểm tra trạng thái worker."""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "jobs": _job_status,
    }


@app.post("/crawl/prices", tags=["Crawl"], summary="Trigger crawl giá thủ công")
def trigger_crawl_prices():
    """
    Trigger crawl giá từ VNDirect API ngay lập tức (không cần chờ scheduler).
    Job chạy trong background — response trả về ngay.
    """
    from crawlers.price import crawl_prices

    if _job_status["prices"]["running"]:
        raise HTTPException(status_code=409, detail="Price crawl job đang chạy, vui lòng thử lại sau.")

    _run_in_thread("prices", crawl_prices)

    return {
        "message": "Price crawl job đã được trigger",
        "job": "prices",
        "started_at": _job_status["prices"]["last_run"],
    }


@app.post("/crawl/indicators", tags=["Crawl"], summary="Trigger tính chỉ số kỹ thuật thủ công")
def trigger_calc_indicators():
    """
    Trigger tính toán technical indicators (RSI, MACD, Bollinger, MA...) cho tất cả mã ngay lập tức.
    Job chạy trong background — response trả về ngay.
    """
    from processors.indicators import calc_indicators_for_all

    if _job_status["indicators"]["running"]:
        raise HTTPException(status_code=409, detail="Indicator job đang chạy, vui lòng thử lại sau.")

    _run_in_thread("indicators", calc_indicators_for_all)

    return {
        "message": "Indicator calculation job đã được trigger",
        "job": "indicators",
        "started_at": _job_status["indicators"]["last_run"],
    }


@app.get("/crawl/status", tags=["Crawl"], summary="Trạng thái các crawl jobs")
def crawl_status():
    """Xem trạng thái lần chạy gần nhất của từng job."""
    return {"jobs": _job_status}


@app.post("/crawl/history", tags=["Crawl"], summary="Backfill lịch sử giá (incremental)")
def trigger_history_backfill(years: int = 5, force: bool = False):
    """
    Fetch lịch sử OHLCV cho tất cả mã active.
    - **force=False** (mặc định): **Incremental** — chỉ fetch phần còn thiếu kể từ ngày cuối trong DB.
    - **force=True**: **Full re-fetch** — xóa và tải lại toàn bộ `years` năm (dùng khi migrate/normalize data).
    - **years**: Số năm lịch sử cần lấy khi force=True hoặc khi mã chưa có data.

    Job chạy trong background — check tiến độ tại `/crawl/history/status`.
    """
    from crawlers.history import backfill_all

    if _job_status["history"]["running"]:
        raise HTTPException(status_code=409, detail="History backfill đang chạy, vui lòng thử lại sau.")

    def _run():
        result = backfill_all(years=years, force=force)
        _job_status["history"]["last_result"] = result

    _run_in_thread("history", _run)

    mode = "Force full re-fetch" if force else "Incremental (chỉ fetch phần thiếu)"
    return {
        "message": f"History backfill triggered — {mode} ({years} năm)",
        "job": "history",
        "mode": "force" if force else "incremental",
        "started_at": _job_status["history"]["last_run"],
        "check_status": "/crawl/history/status",
    }


@app.post("/crawl/history/normalize", tags=["Crawl"], summary="Force normalize lại toàn bộ data lịch sử")
def trigger_history_normalize(years: int = 5):
    """
    **Force re-fetch toàn bộ** lịch sử cho tất cả mã — dùng khi:
    - Có thay đổi thủ công trong DB
    - Migrate schema hoặc đổi đơn vị giá
    - Cần đồng bộ lại sau khi sửa bug crawler

    Tương đương gọi `/crawl/history?force=true`.
    """
    from crawlers.history import backfill_all

    if _job_status["history"]["running"]:
        raise HTTPException(status_code=409, detail="History job đang chạy.")

    def _run():
        result = backfill_all(years=years, force=True)
        _job_status["history"]["last_result"] = result

    _run_in_thread("history", _run)

    return {
        "message": f"Full normalize triggered cho tất cả mã ({years} năm) — force=True",
        "warning": "Sẽ re-fetch lại toàn bộ, mất nhiều thời gian nếu có nhiều mã.",
        "started_at": _job_status["history"]["last_run"],
        "check_status": "/crawl/history/status",
    }


@app.post("/crawl/history/ticker/{ticker}", tags=["Crawl"], summary="Sync lịch sử 1 mã cụ thể")
def trigger_history_single_ticker(ticker: str, years: int = 5, force: bool = False):
    """
    Sync lịch sử cho **1 mã cổ phiếu** cụ thể.
    - **force=False**: Incremental — chỉ fetch phần còn thiếu.
    - **force=True**: Full re-fetch từ đầu cho mã này.

    Hữu ích khi muốn normalize 1 mã mà không cần chạy lại toàn bộ.
    """
    from crawlers.history import backfill_ticker

    ticker = ticker.upper()

    if _job_status["history"]["running"]:
        raise HTTPException(status_code=409, detail="History job đang chạy.")

    def _run():
        count = backfill_ticker(ticker, years=years, force=force)
        _job_status["history"]["last_result"] = {"ticker": ticker, "records_upserted": count}

    _run_in_thread("history", _run)

    return {
        "message": f"History sync triggered cho {ticker} (force={force})",
        "ticker": ticker,
        "started_at": _job_status["history"]["last_run"],
    }


@app.get("/crawl/history/gaps", tags=["Crawl"], summary="Xem mã nào đang thiếu dữ liệu lịch sử")
def get_history_gaps():
    """
    Kiểm tra từng mã active trong DB:
    - Ngày mới nhất đã có
    - Số ngày còn thiếu (gap đến hôm nay)
    - Có cần incremental fetch không?
    """
    from crawlers.history import get_active_tickers, get_latest_history_date
    from datetime import date

    tickers = get_active_tickers()
    today = date.today()
    result = []

    for ticker in tickers:
        last_date = get_latest_history_date(ticker)
        if last_date is None:
            gap_days = None
            needs_fetch = True
            status = "no_data"
        else:
            gap_days = (today - last_date).days
            needs_fetch = gap_days > 1
            status = "up_to_date" if not needs_fetch else f"gap_{gap_days}_days"

        result.append({
            "ticker": ticker,
            "last_date": str(last_date) if last_date else None,
            "gap_days": gap_days,
            "needs_fetch": needs_fetch,
            "status": status,
        })

    return {
        "today": str(today),
        "total": len(result),
        "needs_fetch": sum(1 for r in result if r["needs_fetch"]),
        "tickers": result,
    }


@app.get("/crawl/history/status", tags=["Crawl"], summary="Trạng thái history backfill")
def history_status():
    """Kiểm tra tiến độ backfill lịch sử."""
    return {"history": _job_status["history"]}
