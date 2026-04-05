'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
  IChartApi,
  Time,
} from 'lightweight-charts';

interface OHLCPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingChartProps {
  data: OHLCPoint[];
  chartType: 'candlestick' | 'area' | 'line' | 'bar';
  height?: number;
}

export default function TradingChart({ data, chartType, height = 280 }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'Inter, Segoe UI, sans-serif',
      },
      grid: {
        vertLines: { color: '#1e2a3a' },
        horzLines: { color: '#1e2a3a' },
      },
      crosshair: {
        vertLine: { color: '#475569', labelBackgroundColor: '#1e2d45' },
        horzLine: { color: '#475569', labelBackgroundColor: '#1e2d45' },
      },
      rightPriceScale: {
        borderColor: '#1e2d45',
        scaleMargins: { top: 0.04, bottom: 0.16 },
      },
      timeScale: {
        borderColor: '#1e2d45',
        timeVisible: true,
        secondsVisible: false,
        minBarSpacing: 0.5,   // cho phép nén nến tối đa
        rightOffset: 3,
      },
      handleScroll: true,
      handleScale: true,
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Dedup + sort ASC — lightweight-charts yêu cầu time tăng dần tuyệt đối
    const dedupedMap = new Map<string, OHLCPoint>();
    for (const d of data) {
      if (d.date) dedupedMap.set(d.date, d);
    }
    const sorted = Array.from(dedupedMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    if (sorted.length === 0) return;

    const ohlcData = sorted.map(d => ({
      time:  d.date as Time,
      open:  d.open,
      high:  d.high,
      low:   d.low,
      close: d.close,
    }));

    const lineData = sorted.map(d => ({
      time:  d.date as Time,
      value: d.close,
    }));

    const volumeData = sorted.map(d => ({
      time:  d.date as Time,
      value: d.volume / 1_000_000,
      color: d.close >= d.open ? '#22c55e55' : '#ef444455',
    }));

    // ---- Main series ----
    if (chartType === 'candlestick') {
      const series = chart.addSeries(CandlestickSeries, {
        priceScaleId:  'right',
        upColor:       '#22c55e',
        downColor:     '#ef4444',
        borderVisible: false,
        wickUpColor:   '#22c55e',
        wickDownColor: '#ef4444',
      });
      series.setData(ohlcData);

    } else if (chartType === 'area') {
      const series = chart.addSeries(AreaSeries, {
        priceScaleId: 'right',
        lineColor:    '#818cf8',
        topColor:     'rgba(129, 140, 248, 0.35)',
        bottomColor:  'rgba(129, 140, 248, 0.02)',
        lineWidth: 2,
      });
      series.setData(lineData);

    } else if (chartType === 'line') {
      const series = chart.addSeries(LineSeries, {
        priceScaleId: 'right',
        color:        '#22d3ee',
        lineWidth: 2,
      });
      series.setData(lineData);

    } else {
      const series = chart.addSeries(HistogramSeries, {
        priceScaleId: 'right',
        priceFormat:  { type: 'price', precision: 1, minMove: 0.1 },
      });
      series.setData(sorted.map(d => ({
        time:  d.date as Time,
        value: d.close,
        color: d.close >= d.open ? '#22c55e' : '#ef4444',
      })));
    }

    // ---- Volume series — tách biệt scale, ẩn label ----
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat:      { type: 'volume' },
      priceScaleId:     'vol',
      lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
      visible: false,
    });
    volumeSeries.setData(volumeData);

    // fitContent: tự điều chỉnh barSpacing để vừa hiển thị hết tất cả nến
    chart.timeScale().fitContent();

    // Responsive resize
    const observer = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        chartRef.current.timeScale().fitContent();
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, chartType, height]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
