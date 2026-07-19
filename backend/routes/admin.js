import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import {
  authenticateAdmin,
  authToken,
  loginAdmin,
  logoutAdmin,
  publicAdminSession,
} from "../services/auth-service.js";

export async function handleAdminRoutes(req, res, url, state) {
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

  if (req.method === "GET" && url.pathname === "/api/admin/me") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return true;
    }
    sendJson(res, 200, { admin: publicAdminSession(auth.session) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = authToken(req, url);
    const result = await updateState((current) => logoutAdmin(current, token));
    sendJson(res, 200, result);
    return true;
  }
  return false;
}
