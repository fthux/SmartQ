import { sendJson } from "../lib/http.js";
import { loadState } from "../lib/runtime-store.js";
import {
  authenticateAdmin,
  authToken,
  requireAdminPermission,
  requiredAdminPermission,
  requiresAdminAuth,
} from "../services/auth-service.js";
import { handleAdminLoginRoute, handleAdminRoutes } from "./admin.js";
import { handleAdminUserRoutes } from "./admin-users.js";
import { handleAuthoringRoutes } from "./authoring.js";
import { handlePaperRoutes } from "./papers.js";
import { handleDashboardRoute, handlePublicSystemRoutes } from "./system.js";

export async function handleApi(req, res, url) {
  const state = await loadState();

  if (await handlePublicSystemRoutes(req, res, url)) return;
  if (await handleAdminLoginRoute(req, res, url)) return;

  let auth = null;
  const token = authToken(req, url);
  if (requiresAdminAuth(req, url)) {
    auth = authenticateAdmin(state, token);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, requiredAdminPermission(req, url));
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    const passwordChangeAllowed = [
      "/api/admin/me",
      "/api/admin/password",
      "/api/admin/profile",
      "/api/admin/profile/avatar",
      "/api/admin/logout",
    ].includes(url.pathname);
    if (auth.user.mustChangePassword && !passwordChangeAllowed) {
      sendJson(res, 403, { error: "请先修改初始密码", mustChangePassword: true });
      return;
    }
  }

  if (await handleAdminRoutes(req, res, url, state, auth, token)) return;
  if (await handleAdminUserRoutes(req, res, url, state, auth, token)) return;
  if (handleDashboardRoute(req, res, url, state)) return;
  if (await handleAuthoringRoutes(req, res, url, state)) return;
  if (await handlePaperRoutes(req, res, url, state)) return;
  sendJson(res, 404, { error: "Not Found" });
}
