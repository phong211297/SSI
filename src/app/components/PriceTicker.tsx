'use client';

import { useEffect, useState } from 'react';
import styles from '../dashboard.module.css';

interface StockPrice {
  code: string;
  close: number;
  pricePreviousClose: number;
  percentPriceChange: number;
  nmVolume: number;
  date: string;
}

interface PriceTickerProps {
  onSelectTicker: (ticker: string) => void;
}

export default function PriceTicker({ onSelectTicker }: PriceTickerProps) {
  const [prices, setPrices] = useState<StockPrice[]>([]);

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.prices) setPrices(data.prices);
      } catch {}
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, []);

  if (prices.length === 0) {
    return (
      <div className={styles.ticker}>
        <span className={styles.tickerLoading}>Đang tải dữ liệu thị trường...</span>
      </div>
    );
  }

  return (
    <div className={styles.ticker}>
      <div className={styles.tickerLabel}>LIVE</div>
      <div className={styles.tickerTrack}>
        <div className={styles.tickerScroll}>
          {[...prices, ...prices].map((p, i) => {
            const isUp = p.percentPriceChange > 0;
            const isDown = p.percentPriceChange < 0;
            return (
              <button
                key={i}
                className={styles.tickerItem}
                onClick={() => onSelectTicker(p.code)}
              >
                <span className={styles.tickerCode}>{p.code}</span>
                <span className={`${styles.tickerPrice} ${isUp ? styles.up : isDown ? styles.down : styles.ref}`}>
                  {(p.close / 1000).toFixed(1)}
                </span>
                <span className={`${styles.tickerChange} ${isUp ? styles.up : isDown ? styles.down : styles.ref}`}>
                  {isUp ? '▲' : isDown ? '▼' : '–'}
                  {Math.abs(p.percentPriceChange).toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
