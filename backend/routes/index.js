import { sendJson } from "../lib/http.js";
import { loadState } from "../lib/runtime-store.js";
import {
  authenticateAdmin,
  authToken,
  requireAdminPermission,
  requiredAdminPermission,
  requiresAdminAuth,
} from "../services/auth-service.js";
import { handleAdminRoutes } from "./admin.js";
import { handleAuthoringRoutes } from "./authoring.js";
import { handlePaperRoutes } from "./papers.js";
import { handleDashboardRoute, handlePublicSystemRoutes } from "./system.js";

export async function handleApi(req, res, url) {
  const state = await loadState();

  if (await handlePublicSystemRoutes(req, res, url)) return;
  if (await handleAdminRoutes(req, res, url, state)) return;

  if (requiresAdminAuth(req, url)) {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, requiredAdminPermission(req, url));
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
  }

  if (handleDashboardRoute(req, res, url, state)) return;
  if (await handleAuthoringRoutes(req, res, url, state)) return;
  if (await handlePaperRoutes(req, res, url, state)) return;
  sendJson(res, 404, { error: "Not Found" });
}
