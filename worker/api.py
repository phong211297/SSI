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
    "prices": {"last_run": None, "last_result": None, "running": False},
    "indicators": {"last_run": None, "last_result": None, "running": False},
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
