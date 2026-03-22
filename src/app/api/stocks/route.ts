// Proxy đến VNDirect finfo API để lấy danh sách mã chứng khoán
// Tránh CORS khi gọi từ browser

const VNDIRECT_API = 'https://finfo-api.vndirect.com.vn/v4';

export const revalidate = 300; // cache 5 phút

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const exchange = searchParams.get('exchange') || '';
  const page = searchParams.get('page') || '1';
  const size = searchParams.get('size') || '50';
  const search = searchParams.get('q') || '';

  let query = 'type:STOCK';
  if (exchange) query += `~floor:${exchange}`;
  if (search) query += `~code:${search}*`;

  try {
    const url = `${VNDIRECT_API}/stocks?sort=code&q=${encodeURIComponent(query)}&size=${size}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      throw new Error(`VNDirect API error: ${res.status}`);
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    // Fallback: trả về một số mã phổ biến nếu API không hoạt động
    return Response.json({
      data: POPULAR_STOCKS,
      totalRecord: POPULAR_STOCKS.length,
      isFallback: true,
    });
  }
}

// Fallback data khi API không khả dụng
const POPULAR_STOCKS = [
  { code: 'VNM', floor: 'HOSE', companyName: 'Vinamilk', industryName: 'Thực phẩm' },
  { code: 'VCB', floor: 'HOSE', companyName: 'Vietcombank', industryName: 'Ngân hàng' },
  { code: 'HPG', floor: 'HOSE', companyName: 'Hòa Phát', industryName: 'Thép' },
  { code: 'VIC', floor: 'HOSE', companyName: 'Vingroup', industryName: 'Bất động sản' },
  { code: 'VHM', floor: 'HOSE', companyName: 'Vinhomes', industryName: 'Bất động sản' },
  { code: 'TCB', floor: 'HOSE', companyName: 'Techcombank', industryName: 'Ngân hàng' },
  { code: 'MBB', floor: 'HOSE', companyName: 'MB Bank', industryName: 'Ngân hàng' },
  { code: 'FPT', floor: 'HOSE', companyName: 'FPT Corporation', industryName: 'Công nghệ' },
  { code: 'MSN', floor: 'HOSE', companyName: 'Masan Group', industryName: 'Hàng tiêu dùng' },
  { code: 'GAS', floor: 'HOSE', companyName: 'PV Gas', industryName: 'Dầu khí' },
  { code: 'BID', floor: 'HOSE', companyName: 'BIDV', industryName: 'Ngân hàng' },
  { code: 'CTG', floor: 'HOSE', companyName: 'Vietinbank', industryName: 'Ngân hàng' },
  { code: 'ACB', floor: 'HOSE', companyName: 'ACB', industryName: 'Ngân hàng' },
  { code: 'VPB', floor: 'HOSE', companyName: 'VPBank', industryName: 'Ngân hàng' },
  { code: 'STB', floor: 'HOSE', companyName: 'Sacombank', industryName: 'Ngân hàng' },
  { code: 'SSI', floor: 'HOSE', companyName: 'SSI Securities', industryName: 'Chứng khoán' },
  { code: 'VJC', floor: 'HOSE', companyName: 'Vietjet Air', industryName: 'Hàng không' },
  { code: 'PLX', floor: 'HOSE', companyName: 'Petrolimex', industryName: 'Dầu khí' },
  { code: 'POW', floor: 'HOSE', companyName: 'PV Power', industryName: 'Điện' },
  { code: 'REE', floor: 'HOSE', companyName: 'REE Corporation', industryName: 'Công nghiệp' },
];
