/**
 * Redis client — dùng cho cache giá real-time và Pub/Sub SSE.
 *
 * Hoàn toàn optional:
 *   - Có REDIS_URL → connect và dùng cache
 *   - Không có REDIS_URL → tất cả hàm trả về no-op / giá trị rỗng
 *     (API routes tự fallback về DB, app vẫn chạy bình thường khi dev không có Docker)
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { Redis as RedisType } from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var _redisClient: RedisType | null | undefined;
}

function getClient(): RedisType | null {
  if (!process.env.REDIS_URL) return null;
  if (global._redisClient !== undefined) return global._redisClient;

  try {
    const IORedis = require('ioredis');
    const RedisClass = IORedis.default ?? IORedis;

    const client: RedisType = new RedisClass(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
      enableOfflineQueue: false,
    });

    client.on('error', () => {}); // Suppress — callers catch errors individually

    global._redisClient = client;
    return client;
  } catch {
    global._redisClient = null;
    return null;
  }
}

export const redis: RedisType | null = getClient();

// ─── Constants ─────────────────────────────────────────────────────────────────

export const PRICE_TTL_SECONDS = 10;
export const PRICE_CHANNEL     = 'price-updates';
export const ALERT_CHANNEL     = 'price-alerts';

// ─── Cache helpers — graceful degrade khi Redis null/offline ───────────────────

export async function cachePrice(ticker: string, data: unknown): Promise<void> {
  if (!redis) return;
  try { await redis.setex(`price:${ticker}`, PRICE_TTL_SECONDS, JSON.stringify(data)); }
  catch { /* offline */ }
}

export async function getCachedPrice(ticker: string): Promise<unknown | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(`price:${ticker}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function getCachedPrices(
  tickers: string[],
): Promise<Record<string, unknown>> {
  if (!redis || !tickers.length) return {};
  try {
    const pipeline = redis.pipeline();
    tickers.forEach((t) => pipeline.get(`price:${t}`));
    const results = await pipeline.exec();

    const map: Record<string, unknown> = {};
    tickers.forEach((ticker, i) => {
      const raw = results?.[i]?.[1];
      if (raw && typeof raw === 'string') map[ticker] = JSON.parse(raw);
    });
    return map;
  } catch { return {}; }
}

// ─── Pub/Sub ───────────────────────────────────────────────────────────────────

export function createSubscriber(): RedisType | null {
  if (!process.env.REDIS_URL) return null;
  try {
    const IORedis = require('ioredis');
    const RedisClass = IORedis.default ?? IORedis;

    const sub: RedisType = new RedisClass(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 3000,
    });
    sub.on('error', () => {});
    return sub;
  } catch { return null; }
}
