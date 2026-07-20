import { readJson, readMultipartFile, sendJson } from "../lib/http.js";
import {
  createFileMaterial,
  createTextMaterial,
  getMaterialDetail,
  listMaterials,
  materialFileMaxBytes,
  materialUsages,
  reparseMaterial,
  setMaterialArchived,
  updateMaterial,
} from "../services/material-service.js";

export async function handleMaterialRoutes(req, res, url, state, auth) {
  const actor = auth?.user?.username || "";
  if (req.method === "GET" && url.pathname === "/api/materials") {
    sendJson(res, 200, listMaterials(state, Object.fromEntries(url.searchParams.entries())));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/materials") {
    const body = await readJson(req);
    sendJson(res, 201, await createTextMaterial(body, actor));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/materials/upload") {
    const { fields, file } = await readMultipartFile(req, { maxFileBytes: materialFileMaxBytes });
    sendJson(res, 201, await createFileMaterial(fields, file, actor));
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/materials\/([^/]+)\/(archive|restore|reparse)$/);
  if (req.method === "POST" && actionMatch) {
    const id = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    const result = action === "reparse"
      ? await reparseMaterial(id, actor)
      : await setMaterialArchived(id, action === "archive", actor);
    if (!result) sendJson(res, 404, { error: "出题资料不存在" });
    else sendJson(res, 200, result);
    return true;
  }

  const usagesMatch = url.pathname.match(/^\/api\/materials\/([^/]+)\/usages$/);
  if (req.method === "GET" && usagesMatch) {
    const id = decodeURIComponent(usagesMatch[1]);
    sendJson(res, 200, { items: materialUsages(state, id) });
    return true;
  }

  const materialMatch = url.pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (materialMatch) {
    const id = decodeURIComponent(materialMatch[1]);
    if (req.method === "GET") {
      const result = await getMaterialDetail(state, id);
      if (!result) sendJson(res, 404, { error: "出题资料不存在" });
      else sendJson(res, 200, result);
      return true;
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      const result = await updateMaterial(id, body, actor);
      if (!result) sendJson(res, 404, { error: "出题资料不存在" });
      else sendJson(res, 200, result);
      return true;
    }
  }
  return false;
}
