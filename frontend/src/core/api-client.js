import { publicUrl } from "./public-path.js";

export async function request(path, options = {}) {
  const headers = requestHeaders(path, options);
  if (options.skipAuth) delete headers.authorization;
  const fetchOptions = { ...options };
  delete fetchOptions.skipAuth;

  let response;
  try {
    response = await fetch(publicUrl(path), { ...fetchOptions, headers });
  } catch {
    throw new Error("网络连接失败，请检查网络或稍后重试");
  }
  if (!response.ok) {
    let message = response.status >= 500 ? "服务暂时不可用，请稍后重试" : "请求失败，请稍后重试";
    let payload = null;
    try {
      payload = await response.json();
      message = payload.error || message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    if (response.status === 401 && !options.skipAuth && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("smartq:unauthorized", { detail: { path, error } }));
    }
    throw error;
  }
  return response.json();
}

export async function streamRequest(path, options = {}) {
  const headers = requestHeaders(path, options);
  const fetchOptions = { ...options, headers };
  const onEvent = fetchOptions.onEvent;
  delete fetchOptions.onEvent;
  delete fetchOptions.skipAuth;
  let response;
  try {
    response = await fetch(publicUrl(path), fetchOptions);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("网络连接失败，请检查网络或稍后重试");
  }
  if (!response.ok) throw await responseError(response, path, options);
  if (!response.body) throw new Error("当前浏览器不支持流式回答");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach((block) => dispatchStreamBlock(block, onEvent));
    if (done) break;
  }
  if (buffer.trim()) dispatchStreamBlock(buffer, onEvent);
}

function requestHeaders(path, options = {}) {
  const adminToken = localStorage.getItem("smartqAdminToken") || "";
  const useAdminToken = adminToken && path.startsWith("/api/") && !path.startsWith("/api/admin/login") && !["/api/health", "/api/config"].includes(path);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "content-type": "application/json" }),
    ...(useAdminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    ...(options.headers || {}),
  };
  if (options.skipAuth) delete headers.authorization;
  return headers;
}

function dispatchStreamBlock(block, onEvent) {
  if (!block.trim() || typeof onEvent !== "function") return;
  let event = "message";
  const data = [];
  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  });
  const raw = data.join("\n");
  let payload = raw;
  try { payload = JSON.parse(raw); } catch {}
  onEvent(event, payload);
}

async function responseError(response, path, options = {}) {
  let message = response.status >= 500 ? "服务暂时不可用，请稍后重试" : "请求失败，请稍后重试";
  let payload = null;
  try {
    payload = await response.json();
    message = payload.error || message;
  } catch {}
  const error = new Error(message);
  error.status = response.status;
  error.payload = payload;
  if (response.status === 401 && !options.skipAuth && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("smartq:unauthorized", { detail: { path, error } }));
  }
  return error;
}
