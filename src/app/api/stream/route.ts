/**
 * GET /api/stream — Server-Sent Events (SSE) real-time price updates
 *
 * Upgrade từ:  Next.js polling VNDirect mỗi 5s cho MỖI client
 * Lên:         Redis Pub/Sub — Worker publish 1 lần, N clients đều nhận
 *
 * Flow:
 *   Worker (crawl_prices) → Redis PUBLISH "price-updates" → SSE push → Client
 */

import { createSubscriber, getCachedPrices, PRICE_CHANNEL } from '@/lib/redis';
import type { Redis as RedisType } from 'ioredis';

export const dynamic = 'force-dynamic';

const DEFAULT_TICKERS = [
  'VNM','VCB','HPG','VIC','VHM','TCB','MBB','FPT','MSN','GAS',
  'BID','CTG','ACB','VPB','STB','SSI','VJC','PLX','POW','REE',
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickerParam = searchParams.get('tickers');
  const tickers = tickerParam
    ? tickerParam.split(',').map((t) => t.trim().toUpperCase()).slice(0, 50)
    : DEFAULT_TICKERS;

  const encoder = new TextEncoder();
  let subscriber: RedisType | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client đã disconnect
        }
      };

      // ─── 1. Gửi giá hiện tại ngay khi connect (từ Redis cache) ────────────
      try {
        const initialPrices = await getCachedPrices(tickers);
        const priceList = Object.values(initialPrices);
        if (priceList.length > 0) {
          send({ prices: priceList, timestamp: Date.now(), source: 'cache' });
        }
      } catch {
        // Cache chưa có — worker chưa chạy lần đầu, bỏ qua
      }

      // ─── 2. Subscribe Redis channel để nhận updates real-time ────────────
      subscriber = createSubscriber();

      if (subscriber) {
        subscriber.subscribe(PRICE_CHANNEL).catch((err: Error) => {
          console.error('[SSE] Redis subscribe error:', err.message);
        });

        subscriber.on('message', (_channel: string, message: string) => {
          try {
            const data = JSON.parse(message);

            // Filter chỉ các mã client đang theo dõi
            const filtered = (data.prices as Array<{ code: string }>)?.filter(
              (p) => tickers.includes(p.code),
            );

            if (filtered?.length) {
              send({ prices: filtered, timestamp: data.timestamp, source: 'realtime' });
            }
          } catch {
            // Malformed message — bỏ qua
          }
        });
      }

      // ─── 3. Heartbeat mỗi 30s để giữ connection sống ────────────────────
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // ─── 4. Cleanup khi client disconnect ────────────────────────────────
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        subscriber?.disconnect();
        subscriber = null;
        try { controller.close(); } catch { /* already closed */ }
      });
    },

    cancel() {
      subscriber?.disconnect();
      subscriber = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',    // Tắt buffering ở nginx/proxy
    },
  });
}
