"""
worker/processors/indicators.py — Technical Indicator Calculator
Tính RSI, MA, MACD, Bollinger Bands, ATR từ lịch sử giá và lưu vào DB.
"""

import logging
from datetime import datetime, timezone

import pandas as pd
import pandas_ta as ta

from db import Database, execute_many

logger = logging.getLogger(__name__)

# Số nến tối thiểu cần có để tính chỉ số
MIN_CANDLES = 60


def load_price_history(ticker: str, limit: int = 300) -> pd.DataFrame:
    """Lấy lịch sử giá gần nhất từ DB (kết hợp history + realtime)."""
    sql = """
        (
          SELECT time, open, high, low, close, volume
          FROM stock_prices_history
          WHERE ticker = %s
          ORDER BY time DESC
          LIMIT %s
        )
        UNION ALL
        (
          SELECT time, open, high, low, close, volume
          FROM stock_prices
          WHERE ticker = %s
          ORDER BY time DESC
          LIMIT 100
        )
        ORDER BY time ASC
    """
    with Database() as db:
        rows = db.fetchall(sql, (ticker, limit, ticker))

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.drop_duplicates(subset="time").sort_values("time").reset_index(drop=True)

    for col in ["open", "high", "low", "close"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0).astype(int)

    return df


def calculate_indicators(df: pd.DataFrame) -> pd.Series | None:
    """Tính tất cả chỉ số kỹ thuật cho DataFrame giá. Trả về row cuối."""
    if len(df) < MIN_CANDLES:
        return None

    try:
        # Moving Averages
        df["ma_5"]   = ta.sma(df["close"], length=5)
        df["ma_20"]  = ta.sma(df["close"], length=20)
        df["ma_50"]  = ta.sma(df["close"], length=50)
        df["ma_200"] = ta.sma(df["close"], length=200)
        df["ema_12"] = ta.ema(df["close"], length=12)
        df["ema_26"] = ta.ema(df["close"], length=26)

        # RSI
        df["rsi_14"] = ta.rsi(df["close"], length=14)

        # MACD (12, 26, 9)
        macd = ta.macd(df["close"], fast=12, slow=26, signal=9)
        if macd is not None:
            df["macd"]        = macd["MACD_12_26_9"]
            df["macd_signal"] = macd["MACDs_12_26_9"]
            df["macd_hist"]   = macd["MACDh_12_26_9"]

        # Bollinger Bands (20, 2)
        bb = ta.bbands(df["close"], length=20, std=2)
        if bb is not None:
            df["bb_upper"]  = bb["BBU_20_2.0"]
            df["bb_middle"] = bb["BBM_20_2.0"]
            df["bb_lower"]  = bb["BBL_20_2.0"]

        # ATR (Average True Range)
        df["atr_14"] = ta.atr(df["high"], df["low"], df["close"], length=14)

        # Volume MA
        df["volume_ma20"] = ta.sma(df["volume"].astype(float), length=20)

        return df.iloc[-1]

    except Exception as e:
        logger.error(f"Error calculating indicators: {e}", exc_info=True)
        return None


def _safe_float(value) -> float | None:
    try:
        v = float(value)
        return None if pd.isna(v) else round(v, 4)
    except (TypeError, ValueError):
        return None


def _safe_int(value) -> int | None:
    try:
        v = float(value)
        return None if pd.isna(v) else int(v)
    except (TypeError, ValueError):
        return None


def upsert_indicators(ticker: str, row: pd.Series, time: datetime) -> None:
    sql = """
        INSERT INTO stock_indicators (
            time, ticker,
            ma_5, ma_20, ma_50, ma_200, ema_12, ema_26,
            rsi_14, macd, macd_signal, macd_hist,
            bb_upper, bb_middle, bb_lower, atr_14, volume_ma20
        ) VALUES %s
        ON CONFLICT (time, ticker) DO UPDATE SET
            ma_5        = EXCLUDED.ma_5,
            ma_20       = EXCLUDED.ma_20,
            ma_50       = EXCLUDED.ma_50,
            ma_200      = EXCLUDED.ma_200,
            ema_12      = EXCLUDED.ema_12,
            ema_26      = EXCLUDED.ema_26,
            rsi_14      = EXCLUDED.rsi_14,
            macd        = EXCLUDED.macd,
            macd_signal = EXCLUDED.macd_signal,
            macd_hist   = EXCLUDED.macd_hist,
            bb_upper    = EXCLUDED.bb_upper,
            bb_middle   = EXCLUDED.bb_middle,
            bb_lower    = EXCLUDED.bb_lower,
            atr_14      = EXCLUDED.atr_14,
            volume_ma20 = EXCLUDED.volume_ma20
    """
    data = [(
        time, ticker,
        _safe_float(row.get("ma_5")),
        _safe_float(row.get("ma_20")),
        _safe_float(row.get("ma_50")),
        _safe_float(row.get("ma_200")),
        _safe_float(row.get("ema_12")),
        _safe_float(row.get("ema_26")),
        _safe_float(row.get("rsi_14")),
        _safe_float(row.get("macd")),
        _safe_float(row.get("macd_signal")),
        _safe_float(row.get("macd_hist")),
        _safe_float(row.get("bb_upper")),
        _safe_float(row.get("bb_middle")),
        _safe_float(row.get("bb_lower")),
        _safe_float(row.get("atr_14")),
        _safe_int(row.get("volume_ma20")),
    )]
    execute_many(sql, data)


def calc_indicators_for_all() -> None:
    """
    Main function — được gọi bởi scheduler mỗi 5 phút.
    Tính và lưu indicators cho tất cả mã active.
    """
    with Database() as db:
        tickers = [r["ticker"] for r in db.fetchall(
            "SELECT ticker FROM stocks WHERE is_active = true"
        )]

    now = datetime.now(timezone.utc)
    success = 0
    skipped = 0

    for ticker in tickers:
        try:
            df = load_price_history(ticker)
            if df.empty:
                skipped += 1
                continue

            row = calculate_indicators(df)
            if row is None:
                skipped += 1
                continue

            upsert_indicators(ticker, row, now)
            success += 1

        except Exception as e:
            logger.error(f"calc_indicators failed for {ticker}: {e}")

    logger.info(f"calc_indicators: {success} updated, {skipped} skipped (not enough data)")
