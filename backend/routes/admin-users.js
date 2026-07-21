import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import {
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  revokeManagedAdminUserSessions,
  updateAdminUser,
} from "../services/admin-user-service.js";
import { authenticateAdmin } from "../services/auth-service.js";
import { forbiddenResult, isSuperAdmin } from "../services/access-control-service.js";

export async function handleAdminUserRoutes(req, res, url, state, auth, token) {
  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    if (!isSuperAdmin(auth?.user)) sendJson(res, 403, forbiddenResult());
    else sendJson(res, 200, listAdminUsers(state, Object.fromEntries(url.searchParams.entries())));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users") {
    const body = await readJson(req);
    const result = await updateState(async (current) => {
      const currentAuth = authorizeUsers(current, token);
      return currentAuth.error ? currentAuth : createAdminUser(current, currentAuth.session, body);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 201), result);
    return true;
  }

  const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if (req.method === "POST" && resetMatch) {
    const body = await readJson(req);
    const userId = decodeURIComponent(resetMatch[1]);
    const result = await updateState(async (current) => {
      const currentAuth = authorizeUsers(current, token);
      return currentAuth.error ? currentAuth : resetAdminUserPassword(current, currentAuth.session, userId, body);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 200), result);
    return true;
  }

  const sessionsMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/revoke-sessions$/);
  if (req.method === "POST" && sessionsMatch) {
    const userId = decodeURIComponent(sessionsMatch[1]);
    const result = await updateState((current) => {
      const currentAuth = authorizeUsers(current, token);
      return currentAuth.error ? currentAuth : revokeManagedAdminUserSessions(current, currentAuth.session, userId);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 200), result);
    return true;
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === "PATCH" && userMatch) {
    const body = await readJson(req);
    const userId = decodeURIComponent(userMatch[1]);
    const result = await updateState((current) => {
      const currentAuth = authorizeUsers(current, token);
      return currentAuth.error ? currentAuth : updateAdminUser(current, currentAuth.session, userId, body);
    });
    sendJson(res, result.statusCode || (result.error ? 400 : 200), result);
    return true;
  }

  void auth;
  return false;
}

function authorizeUsers(state, token) {
  const auth = authenticateAdmin(state, token);
  if (auth.error) return auth;
  return isSuperAdmin(auth.user) ? auth : forbiddenResult();
}
