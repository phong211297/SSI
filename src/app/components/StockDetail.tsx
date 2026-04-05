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

// ─── Candle resolution config ─────────────────────────────────────────────────
type Resolution = '1D' | '1W' | '1M' | '3M' | '1Y';

const RESOLUTIONS: { label: Resolution; get: (date: string) => string }[] = [
  // group key = date itself
  { label: '1D', get: (d) => d },
  // group key = ISO week (YYYY-Www)
  { label: '1W', get: (d) => {
    const dt = new Date(d);
    const jan4 = new Date(dt.getFullYear(), 0, 4);
    const week = Math.ceil(((dt.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
    return `${dt.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }},
  // group key = YYYY-MM
  { label: '1M', get: (d) => d.slice(0, 7) },
  // group key = YYYY-Q#
  { label: '3M', get: (d) => `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}` },
  // group key = YYYY
  { label: '1Y', get: (d) => d.slice(0, 4) },
];

interface OHLCPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Gộp daily data thành nến theo resolution */
function aggregateByResolution(daily: OHLCPoint[], resolution: Resolution): OHLCPoint[] {
  if (resolution === '1D') return daily;

  const res = RESOLUTIONS.find(r => r.label === resolution)!;
  const groups = new Map<string, OHLCPoint[]>();

  for (const d of daily) {
    const key = res.get(d.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const result: OHLCPoint[] = [];
  for (const [, bars] of groups) {
    if (!bars.length) continue;
    // Lấy ngày đầu tiên của group làm date key cho nến gộp
    result.push({
      date:   bars[0].date,
      open:   bars[0].open,
      high:   Math.max(...bars.map(b => b.high)),
      low:    Math.min(...bars.map(b => b.low)),
      close:  bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

const CHART_TYPES = [
  { label: 'Nến', value: 'candlestick' },
  { label: 'Vùng', value: 'area' },
  { label: 'Đường', value: 'line' },
  { label: 'Cột', value: 'bar' },
] as const;

type ChartType = typeof CHART_TYPES[number]['value'];

export default function StockDetail({ ticker, onAskAI }: StockDetailProps) {
  const [data, setData] = useState<any>(null);
  const [resolution, setResolution] = useState<Resolution>('1D');
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

  const { info, history: rawHistory, risk }: { info: any; history: any[]; risk: RiskData } = data;
  const history: any[] = Array.isArray(rawHistory) ? rawHistory : [];

  // Map daily data sang OHLCPoint (normalize number, API đã normalize đơn vị)
  const dailyData: OHLCPoint[] = history.map((h: any) => ({
    date:   h.date?.slice(0, 10) ?? '',
    open:   Number(h.open    || h.close   || 0),
    high:   Number(h.high    || h.close   || 0),
    low:    Number(h.low     || h.close   || 0),
    close:  Number(h.close   || h.adClose || 0),
    volume: Number(h.nmVolume ?? 0),
  })).filter(d => d.date && d.close > 0);

  // Aggregate theo resolution được chọn
  const chartData = aggregateByResolution(dailyData, resolution);

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
              {RESOLUTIONS.map(r => (
                <button
                  key={r.label}
                  className={`${styles.rangeBtn} ${resolution === r.label ? styles.rangeBtnActive : ''}`}
                  onClick={() => setResolution(r.label)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.chartMeta}>
            {chartData.length} nến · {resolution} resolution
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
