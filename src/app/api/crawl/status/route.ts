/**
 * GET /api/crawl/status — Trạng thái các crawl jobs
 * Proxy → worker:8000/crawl/status
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const workerUrl = process.env.WORKER_URL || 'http://localhost:8000';
  try {
    const res = await fetch(`${workerUrl}/crawl/status`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return Response.json({ error: 'Worker unavailable', detail: String(err) }, { status: 503 });
  }
}
