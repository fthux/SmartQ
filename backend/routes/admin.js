import { readBuffer, readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import {
  authenticateAdmin,
  loginAdmin,
  logoutAdmin,
  maxAdminAvatarBytes,
  publicAdminSession,
  updateAdminAvatar,
  updateAdminProfile,
} from "../services/auth-service.js";
import { changeAdminPassword } from "../services/admin-user-service.js";

export async function handleAdminLoginRoute(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readJson(req);
    const result = await updateState((current) => loginAdmin(current, body, req));
    if (result.error) {
      sendJson(res, result.statusCode || 401, result);
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }
  return false;
}

export async function handleAdminRoutes(req, res, url, state, auth, token) {
  if (req.method === "GET" && url.pathname === "/api/admin/me") {
    sendJson(res, 200, { admin: publicAdminSession(auth.session, auth.user) });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/profile") {
    const body = await readJson(req);
    const result = await updateState((current) => {
      const currentAuth = authenticateAdmin(current, token);
      return currentAuth.error ? currentAuth : updateAdminProfile(current, currentAuth.session, body);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 200), result);
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/profile/avatar") {
    const buffer = await readBuffer(req, maxAdminAvatarBytes);
    const mimeType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const result = await updateState((current) => {
      const currentAuth = authenticateAdmin(current, token);
      return currentAuth.error ? currentAuth : updateAdminAvatar(current, currentAuth.session, buffer, mimeType);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 200), result);
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/password") {
    const body = await readJson(req);
    const result = await updateState(async (current) => {
      const currentAuth = authenticateAdmin(current, token);
      return currentAuth.error ? currentAuth : changeAdminPassword(current, currentAuth.session, token, body);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 200), result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const result = await updateState((current) => logoutAdmin(current, token));
    sendJson(res, 200, result);
    return true;
  }
  return false;
}
