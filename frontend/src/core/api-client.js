import { publicUrl } from "./public-path.js";

export async function request(path, options = {}) {
  const adminToken = localStorage.getItem("smartqAdminToken") || "";
  const useAdminToken = adminToken && path.startsWith("/api/") && !path.startsWith("/api/admin/login") && !["/api/health", "/api/config"].includes(path);
  const headers = {
    "content-type": "application/json",
    ...(useAdminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    ...(options.headers || {}),
  };
  if (options.skipAuth) delete headers.authorization;
  const fetchOptions = { ...options };
  delete fetchOptions.skipAuth;

  let response;
  try {
    response = await fetch(publicUrl(path), { ...fetchOptions, headers });
  } catch (error) {
    throw new Error(`网络请求失败：${error.message || "请检查服务是否可用"}`);
  }
  if (!response.ok) {
    let message = `${path} ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}
