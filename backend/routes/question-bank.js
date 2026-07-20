import { readJson, sendJson } from "../lib/http.js";
import {
  createQuestionBankItem,
  getQuestionBankDetail,
  importQuestionsToBank,
  listQuestionBank,
  setQuestionBankArchived,
  updateQuestionBankItem,
} from "../services/question-bank-service.js";
import {
  bulkUpdateQuestionCategories,
  createQuestionBankCategory,
  listQuestionBankCategories,
  setQuestionBankCategoryArchived,
  updateQuestionBankCategory,
} from "../services/question-bank-category-service.js";

export async function handleQuestionBankRoutes(req, res, url, state, auth) {
  const actor = auth?.user?.username || "";
  if (req.method === "GET" && url.pathname === "/api/question-bank/categories") {
    sendJson(res, 200, listQuestionBankCategories(state));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/question-bank/categories") {
    sendJson(res, 201, await createQuestionBankCategory(await readJson(req), actor));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/question-bank/categories/bulk") {
    sendJson(res, 200, await bulkUpdateQuestionCategories(await readJson(req), actor));
    return true;
  }
  const categoryActionMatch = url.pathname.match(/^\/api\/question-bank\/categories\/([^/]+)\/(archive|restore)$/);
  if (req.method === "POST" && categoryActionMatch) {
    const result = await setQuestionBankCategoryArchived(decodeURIComponent(categoryActionMatch[1]), categoryActionMatch[2] === "archive", actor);
    if (!result) sendJson(res, 404, { error: "题库分类不存在" });
    else sendJson(res, 200, result);
    return true;
  }
  const categoryMatch = url.pathname.match(/^\/api\/question-bank\/categories\/([^/]+)$/);
  if (req.method === "PATCH" && categoryMatch) {
    const result = await updateQuestionBankCategory(decodeURIComponent(categoryMatch[1]), await readJson(req), actor);
    if (!result) sendJson(res, 404, { error: "题库分类不存在" });
    else sendJson(res, 200, result);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/question-bank") {
    sendJson(res, 200, listQuestionBank(state, Object.fromEntries(url.searchParams.entries())));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/question-bank") {
    sendJson(res, 201, await createQuestionBankItem(await readJson(req), actor));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/question-bank/import") {
    const result = await importQuestionsToBank(await readJson(req), actor);
    if (!result) sendJson(res, 404, { error: "试卷不存在" });
    else sendJson(res, 200, result);
    return true;
  }
  const actionMatch = url.pathname.match(/^\/api\/question-bank\/([^/]+)\/(archive|restore)$/);
  if (req.method === "POST" && actionMatch) {
    const result = await setQuestionBankArchived(decodeURIComponent(actionMatch[1]), actionMatch[2] === "archive", actor);
    if (!result) sendJson(res, 404, { error: "题库题目不存在" });
    else sendJson(res, 200, result);
    return true;
  }
  const usagesMatch = url.pathname.match(/^\/api\/question-bank\/([^/]+)\/usages$/);
  if (req.method === "GET" && usagesMatch) {
    const result = getQuestionBankDetail(state, decodeURIComponent(usagesMatch[1]));
    if (!result) sendJson(res, 404, { error: "题库题目不存在" });
    else sendJson(res, 200, { items: result.usages || [] });
    return true;
  }
  const itemMatch = url.pathname.match(/^\/api\/question-bank\/([^/]+)$/);
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1]);
    if (req.method === "GET") {
      const result = getQuestionBankDetail(state, id);
      if (!result) sendJson(res, 404, { error: "题库题目不存在" });
      else sendJson(res, 200, result);
      return true;
    }
    if (req.method === "PATCH") {
      const result = await updateQuestionBankItem(id, await readJson(req), actor);
      if (!result) sendJson(res, 404, { error: "题库题目不存在" });
      else sendJson(res, 200, result);
      return true;
    }
  }
  return false;
}
