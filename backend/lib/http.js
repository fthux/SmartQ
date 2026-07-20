export const maxRequestBytes = Math.max(
  64 * 1024,
  Math.min(50 * 1024 * 1024, Number(process.env.SMARTQ_MAX_REQUEST_BYTES || 2 * 1024 * 1024)),
);

export async function readJson(req) {
  const raw = await readBuffer(req, maxRequestBytes);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
}

export async function readBuffer(req, limit = maxRequestBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error(`请求体过大，最大允许 ${formatBytes(limit)}`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function sendJson(res, status, data) {
  res.writeHead(status, { ...securityHeaders(), "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
