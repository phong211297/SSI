// Chi tiết mã chứng khoán + lịch sử giá từ ngày niêm yết (simulate GBM)

const STOCK_DB: Record<string, {
  companyName: string;
  industryName: string;
  floor: string;
  ipoDate: string; // YYYY-MM-DD
  ipoPrice: number;
  volatility: number;
}> = {
  VNM: { companyName: 'Vinamilk', industryName: 'Thực phẩm', floor: 'HOSE', ipoDate: '2006-01-19', ipoPrice: 32000, volatility: 0.014 },
  VCB: { companyName: 'Vietcombank', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2009-06-30', ipoPrice: 35000, volatility: 0.013 },
  HPG: { companyName: 'Hòa Phát Group', industryName: 'Thép', floor: 'HOSE', ipoDate: '2007-11-15', ipoPrice: 22000, volatility: 0.022 },
  VIC: { companyName: 'Vingroup', industryName: 'Bất động sản', floor: 'HOSE', ipoDate: '2007-09-20', ipoPrice: 18000, volatility: 0.018 },
  VHM: { companyName: 'Vinhomes', industryName: 'Bất động sản', floor: 'HOSE', ipoDate: '2018-05-17', ipoPrice: 51000, volatility: 0.019 },
  TCB: { companyName: 'Techcombank', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2018-06-04', ipoPrice: 90000, volatility: 0.017 },
  MBB: { companyName: 'MB Bank', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2011-01-01', ipoPrice: 16000, volatility: 0.016 },
  FPT: { companyName: 'FPT Corporation', industryName: 'Công nghệ', floor: 'HOSE', ipoDate: '2006-12-13', ipoPrice: 35000, volatility: 0.015 },
  MSN: { companyName: 'Masan Group', industryName: 'Hàng tiêu dùng', floor: 'HOSE', ipoDate: '2009-11-05', ipoPrice: 39000, volatility: 0.014 },
  GAS: { companyName: 'PV Gas', industryName: 'Dầu khí', floor: 'HOSE', ipoDate: '2012-05-23', ipoPrice: 50000, volatility: 0.013 },
  BID: { companyName: 'BIDV', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2014-01-24', ipoPrice: 18500, volatility: 0.014 },
  CTG: { companyName: 'Vietinbank', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2009-07-16', ipoPrice: 25000, volatility: 0.014 },
  ACB: { companyName: 'ACB', industryName: 'Ngân hàng', floor: 'HNX', ipoDate: '2006-11-21', ipoPrice: 18000, volatility: 0.016 },
  VPB: { companyName: 'VPBank', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2017-08-17', ipoPrice: 39000, volatility: 0.020 },
  STB: { companyName: 'Sacombank', industryName: 'Ngân hàng', floor: 'HOSE', ipoDate: '2006-03-09', ipoPrice: 12000, volatility: 0.017 },
  SSI: { companyName: 'SSI Securities', industryName: 'Chứng khoán', floor: 'HOSE', ipoDate: '2008-05-30', ipoPrice: 22000, volatility: 0.021 },
  VJC: { companyName: 'Vietjet Air', industryName: 'Hàng không', floor: 'HOSE', ipoDate: '2017-02-28', ipoPrice: 90000, volatility: 0.023 },
  PLX: { companyName: 'Petrolimex', industryName: 'Dầu khí', floor: 'HOSE', ipoDate: '2017-04-20', ipoPrice: 43000, volatility: 0.015 },
  POW: { companyName: 'PV Power', industryName: 'Điện', floor: 'HOSE', ipoDate: '2019-01-31', ipoPrice: 14400, volatility: 0.018 },
  REE: { companyName: 'REE Corporation', industryName: 'Công nghiệp', floor: 'HOSE', ipoDate: '2000-07-28', ipoPrice: 16000, volatility: 0.016 },
};

// Cap max history at 10Y to avoid huge payloads
const MAX_HISTORY_DAYS = 10 * 252;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  const history = generatePriceHistory(symbol);
  const info = buildStockInfo(symbol, history);
  const risk = calculateRisk(history);

  return Response.json({
    symbol,
    info,
    history,
    risk,
    ipoDate: (STOCK_DB[symbol]?.ipoDate) ?? null,
  });
}

function generatePriceHistory(symbol: string) {
  const db = STOCK_DB[symbol];
  const ipoDate = db ? new Date(db.ipoDate) : new Date('2015-01-01');
  const ipoPrice = db?.ipoPrice ?? 50000;
  const dailyVol = db?.volatility ?? 0.016;
  const drift = 0.0003;

  const today = new Date('2026-03-21');

  // Tính số ngày từ IPO đến nay
  const msPerDay = 24 * 60 * 60 * 1000;
  const totalCalDays = Math.ceil((today.getTime() - ipoDate.getTime()) / msPerDay);

  // Seeded RNG deterministic theo symbol
  const seed = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rng = seededRandom(seed);

  const history = [];
  let price = ipoPrice;
  let dayCount = 0;

  for (let i = totalCalDays; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);

    dayCount++;
    if (dayCount > MAX_HISTORY_DAYS) continue;

    const z = boxMullerTransform(rng);
    price = price * Math.exp((drift - 0.5 * dailyVol * dailyVol) + dailyVol * z);
    price = Math.max(Math.round(price / 100) * 100, 1000); // min 1K

    const bodyMid = price;
    const open = Math.round(bodyMid * (1 + (rng() - 0.5) * 0.02) / 100) * 100;  // ±1% body
    const close = price;
    // Wicks extend beyond the body (not from the center)
    const high = Math.round(Math.max(close, open) * (1 + rng() * 0.015) / 100) * 100;  // 0–1.5% above body top
    const low  = Math.round(Math.min(close, open) * (1 - rng() * 0.015) / 100) * 100;  // 0–1.5% below body bottom

    history.push({
      date: date.toISOString().split('T')[0],
      open,
      high,
      low,
      close,
      adClose: close,
      nmVolume: Math.round(500000 + rng() * 4500000),
    });
  }

  return history;
}

function buildStockInfo(symbol: string, history: ReturnType<typeof generatePriceHistory>) {
  const db = STOCK_DB[symbol];
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const close = latest?.close ?? 0;
  const prevClose = prev?.close ?? close;
  const pctChange = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;

  return {
    code: symbol,
    floor: db?.floor ?? 'HOSE',
    companyName: db?.companyName ?? symbol,
    industryName: db?.industryName ?? 'Chứng khoán',
    close,
    pricePreviousClose: prevClose,
    percentPriceChange: Math.round(pctChange * 100) / 100,
    nmVolume: latest?.nmVolume ?? 0,
    ipoDate: db?.ipoDate ?? null,
    ipoPrice: db?.ipoPrice ?? 0,
  };
}

function calculateRisk(history: ReturnType<typeof generatePriceHistory>) {
  // Use last 1Y for risk calculation
  const recentHistory = history.slice(-252);
  if (recentHistory.length < 10) {
    return { score: 50, level: 'medium' as const, description: 'Không đủ dữ liệu' };
  }
  const closes = recentHistory.map(d => d.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);

  const high52w = Math.max(...closes);
  const low52w = Math.min(...closes);
  const currentPrice = closes[closes.length - 1];
  const positionInRange = high52w > low52w ? (currentPrice - low52w) / (high52w - low52w) : 0.5;

  const riskScore = Math.round(Math.min(volatility * 100, 100) * 0.6 + positionInRange * 100 * 0.4);
  const cappedScore = Math.min(Math.max(riskScore, 5), 95);

  let level: 'low' | 'medium' | 'high';
  let description: string;
  if (cappedScore < 35) { level = 'low'; description = 'Rủi ro thấp. Biến động nhỏ, giá đang ở vùng hợp lý.'; }
  else if (cappedScore < 65) { level = 'medium'; description = 'Rủi ro trung bình. Cần theo dõi thêm, phân bổ vốn thận trọng.'; }
  else { level = 'high'; description = 'Rủi ro cao. Giá biến động mạnh hoặc đang ở vùng đỉnh.'; }

  return {
    score: cappedScore, level, description,
    volatility: Math.round(volatility * 100),
    high52w, low52w, currentPrice,
    positionInRange: Math.round(positionInRange * 100),
  };
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function boxMullerTransform(rng: () => number) {
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
