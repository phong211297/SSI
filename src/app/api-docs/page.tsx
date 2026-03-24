/**
 * /api-docs — Swagger UI
 * Dùng CDN để không cần cài thêm npm package
 */
export const metadata = {
  title: 'SSI API Docs',
  description: 'Swagger UI cho SSI Stock API',
};

export default function ApiDocsPage() {
  return (
    <html lang="vi">
      <head>
        <title>SSI API Docs</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

          /* Top banner */
          .api-banner {
            background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f2744 100%);
            padding: 20px 32px;
            display: flex;
            align-items: center;
            gap: 16px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .api-banner h1 {
            color: #fff;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: -0.3px;
          }
          .api-banner h1 span { color: #38bdf8; }
          .api-badge {
            background: #38bdf8;
            color: #0f172a;
            font-size: 11px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 999px;
            letter-spacing: 0.5px;
          }
          .api-banner-links {
            margin-left: auto;
            display: flex;
            gap: 12px;
          }
          .api-banner-links a {
            color: rgba(255,255,255,0.7);
            text-decoration: none;
            font-size: 13px;
            transition: color 0.2s;
          }
          .api-banner-links a:hover { color: #38bdf8; }

          /* Override Swagger UI styles */
          .swagger-ui .topbar { display: none !important; }
          .swagger-ui .information-container { background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
          .swagger-ui .info .title { color: #0f172a !important; }

          /* Tag colors */
          .swagger-ui .opblock-tag { border-bottom: 1px solid #e2e8f0 !important; }
          .swagger-ui .opblock.opblock-get { border-color: #3b82f6; background: rgba(59,130,246,0.04); }
          .swagger-ui .opblock.opblock-post { border-color: #10b981; background: rgba(16,185,129,0.04); }

          #swagger-ui { max-width: 1400px; margin: 0 auto; }
        `}</style>
      </head>
      <body>
        <div className="api-banner">
          <h1>VN<span>Stock</span> API</h1>
          <span className="api-badge">v1.0</span>
          <div className="api-banner-links">
            <a href="/">← Dashboard</a>
            <a href="/api/openapi" target="_blank">OpenAPI JSON</a>
            <a href="http://localhost:8000/docs" target="_blank">Worker Docs</a>
          </div>
        </div>

        <div id="swagger-ui"></div>

        <script
          src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
          // @ts-ignore
          crossOrigin="anonymous"
        />
        <script
          src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"
          // @ts-ignore
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.onload = function() {
                SwaggerUIBundle({
                  url: "/api/openapi",
                  dom_id: "#swagger-ui",
                  presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset,
                  ],
                  layout: "StandaloneLayout",
                  deepLinking: true,
                  defaultModelsExpandDepth: 1,
                  defaultModelExpandDepth: 2,
                  docExpansion: "list",
                  filter: true,
                  tryItOutEnabled: true,
                  requestInterceptor: (req) => {
                    // Đảm bảo POST requests có Content-Type
                    if (req.method === 'POST' && !req.body) {
                      req.body = '{}';
                    }
                    return req;
                  },
                });
              };
            `,
          }}
        />
      </body>
    </html>
  );
}
