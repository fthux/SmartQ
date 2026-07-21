import "./lib/env.js";
import http from "node:http";
import { sendJson } from "./lib/http.js";
import { serveStatic } from "./lib/static-server.js";
import { handleApi } from "./routes/index.js";

const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error("SmartQ request failed", error);
    sendJson(res, statusCode, {
      error: statusCode < 500 && error.message ? error.message : "服务暂时不可用，请稍后重试",
    });
  }
});

server.listen(port, () => {
  console.log(`SmartQ running at http://localhost:${port}`);
});
