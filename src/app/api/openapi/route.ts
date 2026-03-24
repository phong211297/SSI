/**
 * GET /api/openapi — OpenAPI 3.0 spec cho toàn bộ API
 */
export const dynamic = 'force-dynamic';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'SSI Stock API',
    description: 'API cho hệ thống phân tích chứng khoán Việt Nam — SSI Dashboard',
    version: '1.0.0',
  },
  servers: [{ url: '', description: 'Current server' }],
  tags: [
    { name: 'Stocks', description: 'Danh sách và thông tin cổ phiếu' },
    { name: 'Stream', description: 'Real-time price stream (SSE)' },
    { name: 'Chat', description: 'AI analyst chatbot' },
    { name: 'Crawl', description: 'Manual trigger crawl jobs' },
  ],
  paths: {
    '/api/stocks': {
      get: {
        tags: ['Stocks'],
        summary: 'Danh sách mã chứng khoán',
        description: 'Lấy danh sách mã CK với giá realtime từ Redis/DB. Hỗ trợ filter, tìm kiếm, phân trang.',
        parameters: [
          { name: 'exchange', in: 'query', schema: { type: 'string', enum: ['HOSE', 'HNX', 'UPCOM'] }, description: 'Filter theo sàn giao dịch' },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Tìm kiếm theo mã hoặc tên công ty' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Số trang' },
          { name: 'size', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 }, description: 'Số phần tử mỗi trang' },
        ],
        responses: {
          '200': {
            description: 'Thành công',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          code: { type: 'string', example: 'FPT' },
                          floor: { type: 'string', example: 'HOSE' },
                          companyName: { type: 'string', example: 'FPT Corporation' },
                          industryName: { type: 'string', example: 'Technology' },
                          close: { type: 'number', example: 120000 },
                          pricePreviousClose: { type: 'number', example: 118000 },
                          percentPriceChange: { type: 'number', example: 1.69 },
                        },
                      },
                    },
                    totalRecord: { type: 'integer', example: 500 },
                    page: { type: 'integer', example: 1 },
                    size: { type: 'integer', example: 50 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/stock/{ticker}': {
      get: {
        tags: ['Stocks'],
        summary: 'Chi tiết mã chứng khoán',
        description: 'Lấy thông tin chi tiết, lịch sử giá 180 ngày, chỉ số kỹ thuật (RSI, MACD, MA, Bollinger) và risk score.',
        parameters: [
          { name: 'ticker', in: 'path', required: true, schema: { type: 'string' }, description: 'Mã chứng khoán', example: 'FPT' },
        ],
        responses: {
          '200': {
            description: 'Thành công',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    symbol: { type: 'string', example: 'FPT' },
                    info: {
                      type: 'object',
                      properties: {
                        code: { type: 'string' },
                        floor: { type: 'string' },
                        companyName: { type: 'string' },
                        industryName: { type: 'string' },
                        close: { type: 'number' },
                        pricePreviousClose: { type: 'number' },
                        percentPriceChange: { type: 'number' },
                        nmVolume: { type: 'integer' },
                      },
                    },
                    history: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', example: '2024-01-01' },
                          open: { type: 'number' },
                          high: { type: 'number' },
                          low: { type: 'number' },
                          close: { type: 'number' },
                          nmVolume: { type: 'integer' },
                        },
                      },
                    },
                    indicators: {
                      type: 'object',
                      properties: {
                        ma_5: { type: 'number' }, ma_20: { type: 'number' },
                        ma_50: { type: 'number' }, ma_200: { type: 'number' },
                        rsi_14: { type: 'number' },
                        macd: { type: 'number' }, macd_signal: { type: 'number' }, macd_hist: { type: 'number' },
                        bb_upper: { type: 'number' }, bb_middle: { type: 'number' }, bb_lower: { type: 'number' },
                        atr_14: { type: 'number' },
                      },
                    },
                    risk: {
                      type: 'object',
                      properties: {
                        score: { type: 'integer', example: 45 },
                        level: { type: 'string', enum: ['low', 'medium', 'high'] },
                        description: { type: 'string' },
                        volatility: { type: 'integer' },
                        high52w: { type: 'number' },
                        low52w: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { description: 'Mã không tìm thấy' },
        },
      },
    },
    '/api/stream': {
      get: {
        tags: ['Stream'],
        summary: 'Real-time price stream (SSE)',
        description: 'Server-Sent Events stream nhận giá realtime từ Redis Pub/Sub. Worker publish mỗi 5s, SSE push đến tất cả clients.',
        parameters: [
          { name: 'tickers', in: 'query', schema: { type: 'string' }, description: 'Danh sách mã (phân cách bởi dấu phẩy). Mặc định: 20 mã top', example: 'VNM,VCB,FPT,HPG' },
        ],
        responses: {
          '200': {
            description: 'SSE stream — text/event-stream',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  example: 'data: {"prices":[{"code":"FPT","close":120000,...}],"timestamp":"...","source":"realtime"}\n\n',
                },
              },
            },
          },
        },
      },
    },
    '/api/chat': {
      post: {
        tags: ['Chat'],
        summary: 'AI Analyst chat (streaming)',
        description: 'Chat với AI chuyên gia phân tích chứng khoán Việt Nam (Llama 3.3 70B via Groq). Hỗ trợ tool call để lấy dữ liệu thực tế.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        role: { type: 'string', enum: ['user', 'assistant'] },
                        content: { type: 'string' },
                      },
                    },
                  },
                },
              },
              example: { messages: [{ role: 'user', content: 'Phân tích mã FPT cho tôi' }] },
            },
          },
        },
        responses: {
          '200': { description: 'UI Message stream response (text/event-stream)' },
        },
      },
    },
    '/api/crawl/prices': {
      post: {
        tags: ['Crawl'],
        summary: '🔄 Trigger crawl giá thủ công',
        description: 'Trigger crawl giá từ VNDirect API ngay lập tức — không cần đợi scheduler (mỗi 5s). Job chạy background, response ngay lập tức.',
        responses: {
          '200': {
            description: 'Job đã được trigger',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Price crawl job đã được trigger' },
                    job: { type: 'string', example: 'prices' },
                    started_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '409': { description: 'Job đang chạy' },
          '503': { description: 'Worker không khả dụng' },
        },
      },
    },
    '/api/crawl/indicators': {
      post: {
        tags: ['Crawl'],
        summary: '📊 Trigger tính chỉ số kỹ thuật thủ công',
        description: 'Trigger tính RSI, MACD, Bollinger Bands, MA cho tất cả mã ngay lập tức. Job chạy background.',
        responses: {
          '200': {
            description: 'Job đã được trigger',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Indicator calculation job đã được trigger' },
                    job: { type: 'string', example: 'indicators' },
                    started_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '409': { description: 'Job đang chạy' },
          '503': { description: 'Worker không khả dụng' },
        },
      },
    },
    '/api/crawl/status': {
      get: {
        tags: ['Crawl'],
        summary: '📋 Trạng thái crawl jobs',
        description: 'Xem trạng thái lần chạy gần nhất và job nào đang chạy.',
        responses: {
          '200': {
            description: 'Trạng thái jobs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobs: {
                      type: 'object',
                      properties: {
                        prices: {
                          type: 'object',
                          properties: {
                            last_run: { type: 'string', format: 'date-time', nullable: true },
                            last_result: { type: 'string', example: 'success' },
                            running: { type: 'boolean' },
                          },
                        },
                        indicators: {
                          type: 'object',
                          properties: {
                            last_run: { type: 'string', format: 'date-time', nullable: true },
                            last_result: { type: 'string', example: 'success' },
                            running: { type: 'boolean' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export function GET() {
  return Response.json(spec, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
