/**
 * GET /api/stock/[ticker] — Chi tiết mã CK + lịch sử giá + chỉ số kỹ thuật
 * Query từ DB thực (thay thế GBM simulation cũ)
 */

import { query, queryOne } from '@/lib/db';
import { getCachedPrice } from '@/lib/redis';

export const dynamic = 'force-dynamic';

interface StockInfo {
  ticker: string;
  company_name: string;
  industry: string;
  floor: string;
  ipo_date: string | null;
  ipo_price: number | null;
}

interface PriceRow {
  time: string | Date;  // pg driver trả về Date object cho timestamp columns
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndicatorRow {
  ma_5: number | null;
  ma_20: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_middle: number | null;
  bb_lower: number | null;
  atr_14: number | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  try {
    // ─── 1. Stock master info ────────────────────────────────────────────────
    const info = await queryOne<StockInfo>(
      `SELECT ticker, company_name, industry, floor, ipo_date, ipo_price
       FROM stocks WHERE ticker = $1`,
      [symbol],
    );

    if (!info) {
      return Response.json({ error: `Mã ${symbol} không tìm thấy` }, { status: 404 });
    }

    // ─── 2. Price history (toàn bộ lịch sử) ────────────────────────────────
    // UNION để merge history + realtime, DISTINCT ON loại bỏ duplicate cùng ngày
    const history = await query<PriceRow>(
      `SELECT DISTINCT ON (DATE_TRUNC('day', time)) time, open, high, low, close, volume
       FROM (
         (
           SELECT time, open, high, low, close, volume
           FROM stock_prices_history
           WHERE ticker = $1
           ORDER BY time DESC
           -- Không LIMIT: lấy toàn bộ lịch sử đã crawl
         )
         UNION
         (
           SELECT time, open, high, low, close, volume
           FROM stock_prices
           WHERE ticker = $1
           ORDER BY time DESC
           LIMIT 90   -- realtime: chỉ cần 90 ngày gần nhất
         )
       ) combined
       ORDER BY DATE_TRUNC('day', time) ASC, time ASC`,
      [symbol],
    );

    // ─── 3. Latest price (Redis cache → DB fallback) ─────────────────────────
    const cachedPrice = await getCachedPrice(symbol).catch(() => null) as Record<string, number> | null;

    const latestPrice = cachedPrice?.close
      ?? history[history.length - 1]?.close
      ?? null;
    const prevClose = cachedPrice?.pricePreviousClose
      ?? history[history.length - 2]?.close
      ?? null;
    const pctChange = cachedPrice?.percentPriceChange
      ?? (latestPrice && prevClose && prevClose > 0
          ? parseFloat((((latestPrice - prevClose) / prevClose) * 100).toFixed(2))
          : null);

    // ─── 4. Latest technical indicators ─────────────────────────────────────
    const indicators = await queryOne<IndicatorRow>(
      `SELECT ma_5, ma_20, ma_50, ma_200, rsi_14,
              macd, macd_signal, macd_hist,
              bb_upper, bb_middle, bb_lower, atr_14
       FROM stock_indicators
       WHERE ticker = $1
       ORDER BY time DESC
       LIMIT 1`,
      [symbol],
    );

    // ─── 5. Risk calculation từ lịch sử ─────────────────────────────────────
    const risk = calculateRiskFromHistory(history, indicators);

    return Response.json({
      symbol,
      info: {
        code:               info.ticker,
        floor:              info.floor,
        companyName:        info.company_name,
        industryName:       info.industry,
        close:              latestPrice,
        pricePreviousClose: prevClose,
        percentPriceChange: pctChange,
        nmVolume:           history[history.length - 1]?.volume ?? 0,
        ipoDate:            info.ipo_date,
        ipoPrice:           info.ipo_price,
      },
      // Dedup theo date string + sort ASC — bảo vệ thứ 2 cho lightweight-charts
      history: (() => {
        const seen = new Set<string>();
        return history
          .map((h) => {
            // pg DECIMAL → string, parse về number trước
            const rawClose  = parseFloat(String(h.close  ?? 0));
            const rawOpen   = parseFloat(String(h.open   ?? rawClose));
            const rawHigh   = parseFloat(String(h.high   ?? rawClose));
            const rawLow    = parseFloat(String(h.low    ?? rawClose));

            // Normalize về đơn vị nghìn đồng:
            // quote.history() trả full VND (VD: 23500), price_board() trả nghìn đồng (23.5)
            // Nếu close > 1000 → đang ở full VND → chia 1000
            const factor = rawClose > 1000 ? 1000 : 1;

            return {
              date:     new Date(h.time).toISOString().split('T')[0],
              open:     Math.round((rawOpen  / factor) * 100) / 100,
              high:     Math.round((rawHigh  / factor) * 100) / 100,
              low:      Math.round((rawLow   / factor) * 100) / 100,
              close:    Math.round((rawClose / factor) * 100) / 100,
              adClose:  Math.round((rawClose / factor) * 100) / 100,
              nmVolume: Number(h.volume ?? 0),
            };
          })
          .filter((d) => {
            if (seen.has(d.date)) return false;
            seen.add(d.date);
            return true;
          })
          .sort((a, b) => a.date.localeCompare(b.date));
      })(),
      indicators: indicators ?? null,
      risk,
    });

  } catch (error) {
    console.error(`[/api/stock/${symbol}] DB error:`, error);
    return Response.json({ error: 'Failed to fetch stock data' }, { status: 500 });
  }
}

// ─── Risk computation (dựa trên DB data thật) ─────────────────────────────────

function calculateRiskFromHistory(
  history: PriceRow[],
  indicators: IndicatorRow | null,
) {
  const closes = history.map((h) => Number(h.close)).filter(Boolean);

  if (closes.length < 20) {
    return { score: 50, level: 'medium', description: 'Không đủ dữ liệu để tính rủi ro.' };
  }

  const recent = closes.slice(-252);

  // Annualized volatility
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    returns.push((recent[i] - recent[i - 1]) / recent[i - 1]);
  }
  const mean     = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const annualVol = Math.sqrt(variance * 252);

  // 52-week position
  const high52w  = Math.max(...recent);
  const low52w   = Math.min(...recent);
  const current  = recent[recent.length - 1];
  const position = high52w > low52w ? (current - low52w) / (high52w - low52w) : 0.5;

  // RSI signal (nếu có)
  let rsiScore = 50;
  if (indicators?.rsi_14) {
    const rsi = indicators.rsi_14;
    if (rsi > 80)      rsiScore = 85;  // Overbought
    else if (rsi < 20) rsiScore = 15;  // Oversold
    else               rsiScore = rsi;
  }

  // Tổng hợp: vol 50%, position 30%, RSI 20%
  const raw = annualVol * 100 * 0.5 + position * 100 * 0.3 + rsiScore * 0.2;
  const score = Math.min(95, Math.max(5, Math.round(raw)));

  let level: 'low' | 'medium' | 'high';
  let description: string;

  if (score < 35) {
    level = 'low';
    description = `Rủi ro thấp. Biến động hàng năm ${(annualVol * 100).toFixed(1)}%, giá đang ở vùng hợp lý.`;
  } else if (score < 65) {
    level = 'medium';
    description = `Rủi ro trung bình. Biến động ${(annualVol * 100).toFixed(1)}%, nên phân bổ vốn thận trọng.`;
  } else {
    level = 'high';
    description = `Rủi ro cao. Biến động mạnh ${(annualVol * 100).toFixed(1)}% hoặc giá đang ở vùng đỉnh.`;
  }

  return {
    score,
    level,
    description,
    volatility:        Math.round(annualVol * 100),
    high52w,
    low52w,
    currentPrice:      current,
    positionInRange:   Math.round(position * 100),
    rsi:               indicators?.rsi_14 ?? null,
  };
}
