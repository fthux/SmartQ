import { publicUrl } from "./public-path.js";

export async function request(path, options = {}) {
  const adminToken = localStorage.getItem("smartqAdminToken") || "";
  const useAdminToken = adminToken && path.startsWith("/api/") && !path.startsWith("/api/admin/login") && !["/api/health", "/api/config"].includes(path);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "content-type": "application/json" }),
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
