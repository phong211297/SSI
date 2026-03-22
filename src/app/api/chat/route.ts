import { createGroq } from '@ai-sdk/groq';
import { streamText, convertToModelMessages } from 'ai';
import { z } from 'zod';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

export const maxDuration = 30;

const SYSTEM_PROMPT = `Bạn là một chuyên gia phân tích chứng khoán Việt Nam với 15 năm kinh nghiệm. 
Bạn hiểu sâu về thị trường HOSE, HNX, UPCOM và các yếu tố kinh tế vĩ mô của Việt Nam.

Khi người dùng hỏi về một mã cổ phiếu cụ thể, hãy:
1. Dùng tool getStockData để lấy thông tin thực tế
2. Phân tích dựa trên risk score, lịch sử giá, và các chỉ số kỹ thuật
3. Đưa ra khuyến nghị rõ ràng: MUA / KHÔNG MUA / THEO DÕI
4. Giải thích lý do bằng tiếng Việt, ngắn gọn, súc tích

Luôn nhắc người dùng rằng đây là phân tích tham khảo, không phải lời khuyên đầu tư chính thức.`;

export async function POST(req: Request) {
  const body = await req.json();
  const messages = body.messages ?? [];

  const result = streamText({
    model: groq('llama-3.3-70b-versatile'),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: {
      getStockData: {
        description: 'Lấy thông tin chi tiết, lịch sử giá và risk score của một mã chứng khoán Việt Nam',
        inputSchema: z.object({
          ticker: z.string().describe('Mã chứng khoán, ví dụ: VNM, VCB, HPG'),
        }),
        execute: async ({ ticker }: { ticker: string }) => {
          try {
            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
            const res = await fetch(`${baseUrl}/api/stock/${ticker.toUpperCase()}`);
            const data = await res.json();
            return {
              ticker: data.symbol,
              info: data.info,
              risk: data.risk,
              historyLength: data.history?.length ?? 0,
              recentPrices: (data.history ?? []).slice(-5).map((h: Record<string, unknown>) => ({
                date: h.date,
                close: h.close ?? h.adClose,
                volume: h.nmVolume,
              })),
            };
          } catch {
            return { error: `Không thể lấy dữ liệu cho ${ticker}` };
          }
        },
      },
    },
  });

  return result.toUIMessageStreamResponse();
}
