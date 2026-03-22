// SSE endpoint: stream real-time price updates
// Poll VNDirect mỗi 5 giây, push event xuống client

const VNDIRECT_API = 'https://finfo-api.vndirect.com.vn/v4';

const DEFAULT_TICKERS = [
  'VNM','VCB','HPG','VIC','VHM','TCB','MBB','FPT','MSN','GAS',
  'BID','CTG','ACB','VPB','STB','SSI','VJC','PLX','POW','REE',
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickers = (searchParams.get('tickers') || DEFAULT_TICKERS.join(',')).split(',');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let active = true;

      // Gửi heartbeat ngay khi connect
      controller.enqueue(encoder.encode(': connected\n\n'));

      const fetchAndSend = async () => {
        if (!active) return;
        try {
          const prices = await fetchPrices(tickers.slice(0, 20));
          const data = `data: ${JSON.stringify({ prices, timestamp: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // silent fail — keep streaming
        }
      };

      // Gửi ngay lần đầu
      await fetchAndSend();

      // Poll mỗi 5 giây
      const interval = setInterval(fetchAndSend, 5000);

      // Cleanup khi client disconnect
      req.signal.addEventListener('abort', () => {
        active = false;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function fetchPrices(tickers: string[]) {
  const query = tickers.map(t => `code:${t}`).join('~');
  try {
    const res = await fetch(
      `${VNDIRECT_API}/stockPrices?sort=-date&q=${encodeURIComponent(query)}&size=${tickers.length}`,
      {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return generateSimulatedPrices(tickers);
    const json = await res.json();
    return json.data ?? generateSimulatedPrices(tickers);
  } catch {
    return generateSimulatedPrices(tickers);
  }
}

// Simulate giá khi API không khả dụng (demo purposes)
const basePrice: Record<string, number> = {
  VNM: 68000, VCB: 82000, HPG: 26000, VIC: 42000, VHM: 35000,
  TCB: 22000, MBB: 18500, FPT: 145000, MSN: 78000, GAS: 62000,
  BID: 41000, CTG: 34000, ACB: 23000, VPB: 19000, STB: 26000,
  SSI: 28000, VJC: 105000, PLX: 46000, POW: 12000, REE: 58000,
};

function generateSimulatedPrices(tickers: string[]) {
  return tickers.map(code => {
    const base = basePrice[code] ?? 50000;
    const change = (Math.random() - 0.5) * 0.04; // ±2%
    const close = Math.round(base * (1 + change) / 100) * 100;
    const prevClose = base;
    const pctChange = ((close - prevClose) / prevClose) * 100;
    return {
      code,
      close,
      pricePreviousClose: prevClose,
      percentPriceChange: Math.round(pctChange * 100) / 100,
      nmVolume: Math.round(Math.random() * 5000000),
      date: new Date().toISOString().split('T')[0],
    };
  });
}
