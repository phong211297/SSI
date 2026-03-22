'use client';

import { useEffect, useState } from 'react';
import styles from '../dashboard.module.css';

interface Stock {
  code: string;
  floor: string;
  companyName: string;
  industryName: string;
}

interface StockPrice {
  code: string;
  close: number;
  percentPriceChange: number;
  nmVolume: number;
}

interface StockListProps {
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  livePrices: Record<string, StockPrice>;
}

const EXCHANGES = ['Tất cả', 'HOSE', 'HNX', 'UPCOM'];

export default function StockList({ selectedTicker, onSelectTicker, livePrices }: StockListProps) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [search, setSearch] = useState('');
  const [exchange, setExchange] = useState('Tất cả');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/stocks?size=100');
        const json = await res.json();
        setStocks(json.data ?? []);
      } catch {
        setStocks([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = stocks.filter(s => {
    const matchSearch = s.code.includes(search.toUpperCase()) ||
      s.companyName.toLowerCase().includes(search.toLowerCase());
    const matchExchange = exchange === 'Tất cả' || s.floor === exchange;
    return matchSearch && matchExchange;
  });

  return (
    <div className={styles.stockList}>
      <div className={styles.stockListHeader}>
        <h2 className={styles.sectionTitle}>Danh sách cổ phiếu</h2>
        <input
          className={styles.searchInput}
          placeholder="Tìm mã..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className={styles.exchangeFilter}>
          {EXCHANGES.map(ex => (
            <button
              key={ex}
              className={`${styles.filterBtn} ${exchange === ex ? styles.active : ''}`}
              onClick={() => setExchange(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.stockTable}>
        <div className={styles.tableHeader}>
          <span>Mã</span>
          <span>Sàn</span>
          <span className={styles.right}>Giá (nghìn)</span>
          <span className={styles.right}>% Thay đổi</span>
          <span className={styles.right}>KL (triệu)</span>
        </div>

        {loading ? (
          <div className={styles.loadingRows}>
            {[...Array(8)].map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : (
          <div className={styles.tableBody}>
            {filtered.map(stock => {
              const price = livePrices[stock.code];
              const pct = price?.percentPriceChange ?? 0;
              const isUp = pct > 0;
              const isDown = pct < 0;
              const colorClass = isUp ? styles.up : isDown ? styles.down : styles.ref;

              return (
                <button
                  key={stock.code}
                  className={`${styles.tableRow} ${selectedTicker === stock.code ? styles.selected : ''}`}
                  onClick={() => onSelectTicker(stock.code)}
                >
                  <span className={styles.stockCode}>{stock.code}</span>
                  <span className={styles.exchange}>{stock.floor}</span>
                  <span className={`${styles.right} ${colorClass}`}>
                    {price ? (price.close / 1000).toFixed(1) : '—'}
                  </span>
                  <span className={`${styles.right} ${colorClass}`}>
                    {price ? `${isUp ? '+' : ''}${pct.toFixed(2)}%` : '—'}
                  </span>
                  <span className={`${styles.right} ${styles.volume}`}>
                    {price ? (price.nmVolume / 1_000_000).toFixed(1) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
