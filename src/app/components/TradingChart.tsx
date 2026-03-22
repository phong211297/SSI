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
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Cleanup previous chart
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
        barSpacing: 10,
        minBarSpacing: 1,
        rightOffset: 5,
      },
      handleScroll: true,
      handleScale: true,
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // ---- Data formats for each series type ----
    // CandlestickSeries requires: { time, open, high, low, close }
    const ohlcData = data.map(d => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    // AreaSeries / LineSeries require: { time, value }
    const lineData = data.map(d => ({
      time: d.date as Time,
      value: d.close,
    }));

    // Volume histogram: { time, value, color }
    const volumeData = data.map(d => ({
      time: d.date as Time,
      value: d.volume / 1_000_000,
      color: d.close >= d.open ? '#22c55e55' : '#ef444455',
    }));

    // ---- Add main series ----
    if (chartType === 'candlestick') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,          // No border → solid body matching wick color
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      series.setData(ohlcData);

    } else if (chartType === 'area') {
      const series = chart.addSeries(AreaSeries, {
        lineColor: '#818cf8',
        topColor: 'rgba(129, 140, 248, 0.35)',
        bottomColor: 'rgba(129, 140, 248, 0.02)',
        lineWidth: 2,
      });
      series.setData(lineData);

    } else if (chartType === 'line') {
      const series = chart.addSeries(LineSeries, {
        color: '#22d3ee',
        lineWidth: 2,
      });
      series.setData(lineData);

    } else {
      // 'bar' — histogram of closing prices colored by direction
      const series = chart.addSeries(HistogramSeries, {
        priceScaleId: 'right',
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      });
      series.setData(data.map(d => ({
        time: d.date as Time,
        value: d.close,
        color: d.close >= d.open ? '#22c55e' : '#ef4444',
      })));
    }

    // ---- Volume series (always shown at bottom) ----
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });
    volumeSeries.setData(volumeData);

    // Show most recent candles at proper barSpacing (fitContent() would override barSpacing)
    chart.timeScale().scrollToRealTime();

    // Responsive resize
    const observer = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
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
