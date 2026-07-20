import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./http.js";

const frontendRoot = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));

export async function serveStatic(res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(frontendRoot, safePath);
  let data;
  let responsePath = filePath;
  try {
    data = await readFile(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const prefixedAssetPath = extname(filePath) ? stripFirstPathSegment(safePath) : "";
    if (prefixedAssetPath) {
      responsePath = join(frontendRoot, prefixedAssetPath);
      data = await readFile(responsePath);
    } else {
      responsePath = join(frontendRoot, "index.html");
      data = await readFile(responsePath);
    }
  }
  res.writeHead(200, { ...securityHeaders(), "content-type": contentType(responsePath) });
  res.end(data);
}

function stripFirstPathSegment(pathname) {
  const parts = String(pathname || "").split(/[/\\]+/).filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(1).join("/");
}

function contentType(filePath) {
  const ext = extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  }[ext] || "application/octet-stream";
}
