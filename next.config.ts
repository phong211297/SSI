import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack là mặc định trong Next.js 16+
  // Khai báo turbopack rỗng để tắt cảnh báo và dùng Turbopack rõ ràng
  turbopack: {},
  // NOTE: Turbopack tự xử lý file watching, không cần cấu hình poll như webpack.
  // Nếu hot reload không hoạt động trong Docker, cân nhắc dùng `next dev --webpack`
  // để quay lại webpack với polling.
};

export default nextConfig;
