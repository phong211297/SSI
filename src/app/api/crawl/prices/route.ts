/**
 * POST /api/crawl/prices — Trigger manual price crawl
 * Proxy → worker:8000/crawl/prices
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  const workerUrl = process.env.WORKER_URL || 'http://localhost:8000';
  try {
    const res = await fetch(`${workerUrl}/crawl/prices`, { method: 'POST' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (err) {
    return Response.json({ error: 'Worker unavailable', detail: String(err) }, { status: 503 });
  }
}
