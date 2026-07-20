import { sendJson } from "../lib/http.js";
import { loadState } from "../lib/runtime-store.js";
import {
  authenticateAdmin,
  authToken,
  requiresAdminAuth,
} from "../services/auth-service.js";
import { handleAdminLoginRoute, handleAdminRoutes } from "./admin.js";
import { handleAdminUserRoutes } from "./admin-users.js";
import { handleAuthoringRoutes } from "./authoring.js";
import { handlePaperRoutes } from "./papers.js";
import { handleMaterialRoutes } from "./materials.js";
import { handleQuestionBankRoutes } from "./question-bank.js";
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
  }

  if (await handleAdminRoutes(req, res, url, state, auth, token)) return;
  if (await handleAdminUserRoutes(req, res, url, state, auth, token)) return;
  if (handleDashboardRoute(req, res, url, state, auth)) return;
  if (await handleQuestionBankRoutes(req, res, url, state, auth)) return;
  if (await handleMaterialRoutes(req, res, url, state, auth)) return;
  if (await handleAuthoringRoutes(req, res, url, state, auth)) return;
  if (await handlePaperRoutes(req, res, url, state, auth)) return;
  sendJson(res, 404, { error: "Not Found" });
}
