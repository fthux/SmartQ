import Busboy from "busboy";

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

export function readMultipartFile(req, options = {}) {
  const maxFileBytes = Math.max(1024, Number(options.maxFileBytes || 8 * 1024 * 1024));
  const maxFields = Math.max(1, Number(options.maxFields || 20));
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxFileBytes, fields: maxFields, fieldSize: 64 * 1024 },
      });
    } catch (error) {
      error.statusCode = 400;
      reject(error);
      return;
    }

    const fields = {};
    const chunks = [];
    let file = null;
    let rejected = false;

    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("file", (_name, stream, info) => {
      file = { filename: info.filename || "", mimeType: info.mimeType || "application/octet-stream" };
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => {
        rejected = true;
      });
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      if (rejected) {
        const error = new Error(`资料文件过大，最大允许 ${formatBytes(maxFileBytes)}`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!file || !chunks.length) {
        const error = new Error("请选择需要上传的资料文件");
        error.statusCode = 400;
        reject(error);
        return;
      }
      resolve({ fields, file: { ...file, buffer: Buffer.concat(chunks) } });
    });
    req.pipe(parser);
  });
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
