/**
 * GET /api/stocks — Danh sách mã chứng khoán từ DB
 * Hỗ trợ filter theo sàn, tìm kiếm theo mã/tên, phân trang
 */

import { query } from '@/lib/db';
import { getCachedPrices } from '@/lib/redis';

export const dynamic = 'force-dynamic';

interface StockRow {
  ticker: string;
  company_name: string;
  industry: string;
  floor: string;
  ipo_date: string | null;
  ipo_price: number | null;
}

interface PriceRow {
  close: number;
  price_previous_close: number;
  pct_change: number;
  volume: number;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const exchange = searchParams.get('exchange') || '';
  const search   = searchParams.get('q') || '';
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const size     = Math.min(100, parseInt(searchParams.get('size') || '50', 10));
  const offset   = (page - 1) * size;

  try {
    // ─── Build dynamic WHERE clause ─────────────────────────────────────────
    const conditions: string[] = ['s.is_active = true'];
    const params: unknown[]    = [];
    let paramIdx = 1;

    if (exchange) {
      conditions.push(`s.floor = $${paramIdx++}`);
      params.push(exchange.toUpperCase());
    }

    if (search) {
      conditions.push(`(s.ticker ILIKE $${paramIdx} OR s.company_name ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // ─── Count total (for pagination) ───────────────────────────────────────
    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*) as total FROM stocks s WHERE ${whereClause}`,
      params,
    );
    const total = parseInt(countResult[0]?.total || '0', 10);

    // ─── Fetch stocks ────────────────────────────────────────────────────────
    const stocks = await query<StockRow>(
      `SELECT ticker, company_name, industry, floor, ipo_date, ipo_price
       FROM stocks s
       WHERE ${whereClause}
       ORDER BY s.ticker ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, size, offset],
    );

    if (!stocks.length) {
      return Response.json({ data: [], totalRecord: 0, page, size });
    }

    // ─── Enrich với giá từ Redis cache (fast path) ───────────────────────────
    const tickers       = stocks.map((s) => s.ticker);
    const cachedPrices: Record<string, unknown> = await getCachedPrices(tickers).catch(() => ({} as Record<string, unknown>));

    // ─── Fallback: query DB nếu Redis không có ──────────────────────────────
    const uncachedTickers = tickers.filter((t) => !(cachedPrices as Record<string, unknown>)[t]);
    let dbPrices: Record<string, PriceRow> = {};

    if (uncachedTickers.length > 0) {
      const priceRows = await query<PriceRow & { ticker: string }>(
        `SELECT DISTINCT ON (ticker)
            ticker,
            close,
            (SELECT close FROM stock_prices p2
             WHERE p2.ticker = p.ticker
             ORDER BY time DESC
             LIMIT 1 OFFSET 1) AS price_previous_close,
            0 AS pct_change,
            volume
         FROM stock_prices p
         WHERE ticker = ANY($1::text[])
         ORDER BY ticker, time DESC`,
        [uncachedTickers],
      ).catch(() => []);

      dbPrices = Object.fromEntries(priceRows.map((r) => [r.ticker, r]));
    }

    // ─── Merge và format response ────────────────────────────────────────────
    const data = stocks.map((s) => {
      const cached  = cachedPrices[s.ticker] as Record<string, number> | undefined;
      const dbPrice = dbPrices[s.ticker];

      const close           = cached?.close        ?? dbPrice?.close        ?? null;
      const prevClose       = cached?.pricePreviousClose ?? dbPrice?.price_previous_close ?? null;
      const percentChange   = cached?.percentPriceChange ?? (
        close && prevClose && prevClose > 0
          ? parseFloat((((close - prevClose) / prevClose) * 100).toFixed(2))
          : null
      );

      return {
        code:           s.ticker,
        floor:          s.floor,
        companyName:    s.company_name,
        industryName:   s.industry,
        close,
        pricePreviousClose: prevClose,
        percentPriceChange: percentChange,
      };
    });

    return Response.json({ data, totalRecord: total, page, size });

  } catch (error) {
    console.error('[/api/stocks] DB error:', error);
    return Response.json(
      { error: 'Failed to fetch stocks' },
      { status: 500 },
    );
  }
}
