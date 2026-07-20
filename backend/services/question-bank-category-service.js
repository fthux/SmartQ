import { randomBytes } from "node:crypto";
import { logItem } from "../lib/audit.js";
import {
  activeLeafCategory,
  categoryDepth,
  categoryDescendantIds,
  categoryMap,
  categoryPath,
  isLeafCategory,
  normalizeCategoryIds,
  normalizeQuestionBankCategory,
} from "../lib/question-bank-categories.js";
import { updateState } from "../lib/runtime-store.js";

export function listQuestionBankCategories(state) {
  const categories = [...(state.questionBankCategories || [])].sort(categorySort);
  const byParent = new Map();
  categories.forEach((item) => {
    const list = byParent.get(item.parentId || "") || [];
    list.push(item);
    byParent.set(item.parentId || "", list);
  });
  const activeQuestions = (state.questionBank || []).filter((item) => item.status !== "已归档");
  const rows = categories.map((item) => {
    const descendants = categoryDescendantIds(state, item.id);
    const directCount = activeQuestions.filter((question) => question.categoryIds?.includes(item.id)).length;
    const count = activeQuestions.filter((question) => question.categoryIds?.some((id) => descendants.has(id))).length;
    return {
      ...item,
      depth: categoryDepth(state, item.id),
      isLeaf: isLeafCategory(state, item.id, { activeOnly: true }),
      path: categoryPath(state, item.id),
      directCount,
      count,
    };
  });
  const rowMap = new Map(rows.map((item) => [item.id, item]));
  const buildTree = (parentId = "") => (byParent.get(parentId) || []).map((item) => ({
    ...rowMap.get(item.id),
    children: buildTree(item.id),
  }));
  return {
    items: rows,
    tree: buildTree(),
    counts: {
      all: activeQuestions.length,
      unclassified: activeQuestions.filter((item) => !(item.categoryIds || []).length).length,
      multi: activeQuestions.filter((item) => (item.categoryIds || []).length > 1).length,
      archived: (state.questionBank || []).filter((item) => item.status === "已归档").length,
    },
  };
}

export async function createQuestionBankCategory(body = {}, actor = "") {
  return updateState((state) => {
    const name = cleanName(body.name);
    const parentId = String(body.parentId || "");
    validateParent(state, parentId);
    ensureUniqueSiblingName(state, name, parentId);
    if (parentId && (state.questionBank || []).some((item) => item.categoryIds?.includes(parentId))) {
      throw conflict("该分类已有题目，请先将题目移动到其他分类后再创建子分类");
    }
    const now = new Date().toISOString();
    const category = normalizeQuestionBankCategory({
      id: createCategoryId(),
      name,
      parentId,
      status: "active",
      sortOrder: body.sortOrder,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    });
    state.questionBankCategories.push(category);
    state.auditLog.push(logItem("question-bank-category-create", `新建题库分类：${categoryPath(state, category.id).map((item) => item.name).join(" / ")}`, { actor, categoryId: category.id }));
    return listQuestionBankCategories(state);
  });
}

export async function updateQuestionBankCategory(id, body = {}, actor = "") {
  return updateState((state) => {
    const category = categoryMap(state).get(String(id || ""));
    if (!category) return null;
    const name = body.name === undefined ? category.name : cleanName(body.name);
    const parentId = body.parentId === undefined ? category.parentId : String(body.parentId || "");
    if (parentId === category.id || categoryDescendantIds(state, category.id).has(parentId)) throw badRequest("分类不能移动到自身或子分类下");
    validateParent(state, parentId, category.id);
    ensureUniqueSiblingName(state, name, parentId, category.id);
    if (parentId !== category.parentId && parentId && (state.questionBank || []).some((item) => item.categoryIds?.includes(parentId))) {
      throw conflict("目标上级分类已有题目，请先将题目移动到其他分类");
    }
    const subtreeDepth = maxSubtreeDepth(state, category.id);
    const targetDepth = parentId ? categoryDepth(state, parentId) + 1 : 1;
    if (targetDepth + subtreeDepth - 1 > 3) throw badRequest("题库分类最多支持 3 级");
    Object.assign(category, {
      name,
      parentId,
      sortOrder: body.sortOrder === undefined ? category.sortOrder : Number(body.sortOrder || 0),
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    });
    state.auditLog.push(logItem("question-bank-category-update", `更新题库分类：${categoryPath(state, category.id).map((item) => item.name).join(" / ")}`, { actor, categoryId: category.id }));
    return listQuestionBankCategories(state);
  });
}

export async function setQuestionBankCategoryArchived(id, archived, actor = "") {
  return updateState((state) => {
    const category = categoryMap(state).get(String(id || ""));
    if (!category) return null;
    const ids = categoryDescendantIds(state, category.id);
    for (const item of state.questionBankCategories || []) {
      if (!ids.has(item.id)) continue;
      const sources = new Set(item.archivedByCategoryIds || []);
      if (archived) {
        if (item.status === "active" || item.id === category.id) sources.add(category.id);
        item.status = "archived";
      } else if (sources.has(category.id) || item.id === category.id) {
        sources.delete(category.id);
        item.status = sources.size ? "archived" : "active";
      }
      item.archivedByCategoryIds = [...sources];
      item.updatedBy = actor;
      item.updatedAt = new Date().toISOString();
    }
    state.auditLog.push(logItem(archived ? "question-bank-category-archive" : "question-bank-category-restore", `${archived ? "归档" : "恢复"}题库分类：${category.name}`, { actor, categoryId: category.id }));
    return listQuestionBankCategories(state);
  });
}

export async function bulkUpdateQuestionCategories(body = {}, actor = "") {
  const questionIds = normalizeCategoryIds(body.questionIds, 500);
  const categoryIds = normalizeCategoryIds(body.categoryIds);
  const mode = ["add", "remove", "replace"].includes(body.mode) ? body.mode : "add";
  if (!questionIds.length) throw badRequest("请选择需要归类的题目");
  return updateState((state) => {
    const selected = (state.questionBank || []).filter((item) => questionIds.includes(item.id));
    if (selected.length !== questionIds.length) throw badRequest("部分题库题目不存在，请刷新后重试");
    if (mode !== "remove") validateActiveLeafCategories(state, categoryIds, true);
    const knownIds = categoryMap(state);
    if (mode === "remove" && categoryIds.some((id) => !knownIds.has(id))) throw badRequest("部分分类不存在");
    const now = new Date().toISOString();
    selected.forEach((item) => {
      const current = new Set(item.categoryIds || []);
      if (mode === "replace") item.categoryIds = [...categoryIds];
      else if (mode === "add") item.categoryIds = [...new Set([...current, ...categoryIds])];
      else item.categoryIds = [...current].filter((id) => !categoryIds.includes(id));
      item.updatedBy = actor;
      item.updatedAt = now;
    });
    state.auditLog.push(logItem("question-bank-category-bulk", `批量${mode === "add" ? "添加" : mode === "remove" ? "移除" : "替换"}题库分类：${selected.length} 道题`, { actor, questionIds, categoryIds, mode }));
    return { updated: selected.length, questionIds, categoryIds, mode };
  });
}

export function validateActiveLeafCategories(state, categoryIds, required = false) {
  const ids = normalizeCategoryIds(categoryIds);
  if (required && !ids.length) throw badRequest("请选择至少一个题库分类");
  const invalid = ids.find((id) => !activeLeafCategory(state, id));
  if (invalid) throw badRequest(`分类 ${invalid} 不存在、已归档或不是叶子分类`);
  return ids;
}

function validateParent(state, parentId, movingId = "") {
  if (!parentId) return;
  const parent = categoryMap(state).get(parentId);
  if (!parent || parent.status !== "active") throw badRequest("上级分类不存在或已归档");
  const depth = categoryDepth(state, parentId);
  if (depth >= 3 && parentId !== movingId) throw badRequest("题库分类最多支持 3 级");
}

function ensureUniqueSiblingName(state, name, parentId, excludeId = "") {
  const duplicate = (state.questionBankCategories || []).find((item) => item.id !== excludeId && item.parentId === parentId && item.name === name);
  if (duplicate) throw conflict("同级分类名称已存在");
}

function maxSubtreeDepth(state, id) {
  const rootDepth = categoryDepth(state, id);
  let maxDepth = rootDepth;
  for (const descendantId of categoryDescendantIds(state, id)) maxDepth = Math.max(maxDepth, categoryDepth(state, descendantId));
  return maxDepth - rootDepth + 1;
}

function cleanName(value) {
  const name = String(value || "").trim().slice(0, 80);
  if (!name) throw badRequest("请输入分类名称");
  return name;
}

function categorySort(a, b) {
  return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
}

function createCategoryId() {
  return `bank-category-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}
