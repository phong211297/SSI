'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from '../dashboard.module.css';

// Lazy load — lightweight-charts is client-only (uses DOM APIs)
const TradingChart = dynamic(() => import('./TradingChart'), { ssr: false });

interface RiskData {
  score: number;
  level: 'low' | 'medium' | 'high';
  description: string;
  volatility?: number;
  high52w?: number;
  low52w?: number;
  currentPrice?: number;
  positionInRange?: number;
}

interface StockDetailProps {
  ticker: string;
  onAskAI: (message: string) => void;
}

const RISK_COLORS = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
const RISK_LABELS = { low: 'THẤP', medium: 'TRUNG BÌNH', high: 'CAO' };

const TIME_RANGES = [
  { label: '1T', days: 5 },
  { label: '1M', days: 22 },
  { label: '3M', days: 66 },
  { label: '6M', days: 132 },
  { label: '1Y', days: 252 },
  { label: 'Tất cả', days: 9999 },
];

const CHART_TYPES = [
  { label: 'Nến', value: 'candlestick' },
  { label: 'Vùng', value: 'area' },
  { label: 'Đường', value: 'line' },
  { label: 'Cột', value: 'bar' },
] as const;

type ChartType = typeof CHART_TYPES[number]['value'];

export default function StockDetail({ ticker, onAskAI }: StockDetailProps) {
  const [data, setData] = useState<any>(null);
  const [selectedRange, setSelectedRange] = useState('3M');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setData(null);
    fetch(`/api/stock/${ticker}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (!ticker) {
    return (
      <div className={styles.detailEmpty}>
        <div className={styles.emptyIcon}>📈</div>
        <p>Chọn một mã cổ phiếu để xem chi tiết</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.detailLoading}>
        <div className={styles.spinner} />
        <p>Đang tải dữ liệu {ticker}...</p>
      </div>
    );
  }

  if (!data) return null;

  const { info, history, risk }: { info: any; history: any[]; risk: RiskData } = data;

  const rangeDays = TIME_RANGES.find(r => r.label === selectedRange)?.days ?? 66;
  const slicedHistory = rangeDays >= 9999 ? history : history.slice(-rangeDays);

  const chartData = slicedHistory.map((h: any) => ({
    date: h.date?.slice(0, 10) ?? '',
    open: (h.open || h.close || 0) / 1000,
    high: (h.high || h.close || 0) / 1000,
    low: (h.low || h.close || 0) / 1000,
    close: (h.close || h.adClose || 0) / 1000,
    volume: h.nmVolume ?? 0,
  }));

  const currentPrice = info?.close ?? risk?.currentPrice ?? 0;
  const pctChange = info?.percentPriceChange ?? 0;
  const isUp = pctChange > 0;
  const isDown = pctChange < 0;
  const riskColor = RISK_COLORS[risk?.level ?? 'medium'];
  const riskLabel = RISK_LABELS[risk?.level ?? 'medium'];

  return (
    <div className={styles.stockDetail}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <div>
          <div className={styles.detailTitle}>
            <h2 className={styles.detailCode}>{ticker}</h2>
            <span className={styles.detailExchange}>{info?.floor ?? 'HOSE'}</span>
          </div>
          <p className={styles.detailCompany}>{info?.companyName ?? ticker}</p>
          <p className={styles.detailIndustry}>
            {info?.industryName ?? ''}
            {info?.ipoDate && (
              <span className={styles.ipoInfo}> · Niêm yết: {info.ipoDate} · IPO: {((info.ipoPrice ?? 0) / 1000).toFixed(0)}K</span>
            )}
          </p>
        </div>
        <div className={styles.detailPrice}>
          <div className={`${styles.bigPrice} ${isUp ? styles.up : isDown ? styles.down : styles.ref}`}>
            {currentPrice > 0 ? (currentPrice / 1000).toFixed(1) : '—'}
            <span className={styles.currency}>K</span>
          </div>
          <div className={`${styles.priceChange} ${isUp ? styles.up : isDown ? styles.down : styles.ref}`}>
            {isUp ? '▲' : isDown ? '▼' : '–'} {Math.abs(pctChange).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Risk Badge */}
      <div className={styles.riskSection}>
        <div className={styles.riskBadge} style={{ borderColor: riskColor }}>
          <div className={styles.riskLabel}>Rủi ro</div>
          <div className={styles.riskScore} style={{ color: riskColor }}>{risk?.score ?? 50}%</div>
          <div className={styles.riskLevel} style={{ color: riskColor }}>{riskLabel}</div>
        </div>
        <div className={styles.riskInfo}>
          <p className={styles.riskDesc}>{risk?.description}</p>
          {risk?.high52w && (
            <div className={styles.riskStats}>
              <span>52W Cao: <strong>{(risk.high52w / 1000).toFixed(1)}K</strong></span>
              <span>52W Thấp: <strong>{((risk.low52w ?? 0) / 1000).toFixed(1)}K</strong></span>
              {risk.volatility && <span>Biến động: <strong>{risk.volatility}%/năm</strong></span>}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 ? (
        <div className={styles.chartSection}>
          <div className={styles.chartHeader}>
            <div className={styles.chartTypeSelector}>
              {CHART_TYPES.map(ct => (
                <button
                  key={ct.value}
                  className={`${styles.typeBtn} ${chartType === ct.value ? styles.typeBtnActive : ''}`}
                  onClick={() => setChartType(ct.value)}
                >
                  {ct.label}
                </button>
              ))}
            </div>
            <div className={styles.timeRanges}>
              {TIME_RANGES.map(r => (
                <button
                  key={r.label}
                  className={`${styles.rangeBtn} ${selectedRange === r.label ? styles.rangeBtnActive : ''}`}
                  onClick={() => setSelectedRange(r.label)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.chartMeta}>
            {chartData.length} phiên
            {selectedRange === 'Tất cả' && data?.ipoDate && ` · Từ ${data.ipoDate}`}
          </div>

          <TradingChart data={chartData} chartType={chartType} height={260} />
        </div>
      ) : (
        <div className={styles.noChart}>Không có dữ liệu lịch sử giá</div>
      )}

      {/* AI Actions */}
      <div className={styles.aiActions}>
        <button
          className={styles.aiBtn}
          onClick={() => onAskAI(`Phân tích chi tiết mã ${ticker} và cho tôi biết nên mua không?`)}
        >
          🤖 Phân tích AI
        </button>
        <button
          className={`${styles.aiBtn} ${styles.aiBtnSecondary}`}
          onClick={() => onAskAI(`Đánh giá rủi ro đầu tư vào ${ticker} trong 6 tháng tới`)}
        >
          ⚠️ Đánh giá rủi ro
        </button>
      </div>
    </div>
  );
}
