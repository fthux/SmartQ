export const questionBankCategoryStatuses = ["active", "archived"];

export function normalizeQuestionBankCategory(item = {}) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const now = new Date().toISOString();
  return {
    id: String(item.id),
    name: String(item.name || "未命名分类").trim().slice(0, 80) || "未命名分类",
    parentId: String(item.parentId || ""),
    status: questionBankCategoryStatuses.includes(item.status) ? item.status : "active",
    sortOrder: clampNumber(item.sortOrder, -100_000, 100_000, 0),
    createdBy: String(item.createdBy || ""),
    updatedBy: String(item.updatedBy || item.createdBy || ""),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now,
  };
}

export function normalizeCategoryIds(value, maxItems = 20) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,，、\n]/);
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, maxItems);
}

export function categoryMap(state = {}) {
  return new Map((state.questionBankCategories || []).map((item) => [item.id, item]));
}

export function categoryDepth(state, id) {
  const byId = categoryMap(state);
  let current = byId.get(String(id || ""));
  let depth = 0;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return depth;
}

export function categoryPath(state, id) {
  const byId = categoryMap(state);
  const path = [];
  let current = byId.get(String(id || ""));
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return path;
}

export function categoryDescendantIds(state, id, options = {}) {
  const rootId = String(id || "");
  const ids = new Set(rootId ? [rootId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of state.questionBankCategories || []) {
      if (ids.has(category.parentId) && !ids.has(category.id)) {
        if (!options.activeOnly || category.status === "active") ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function isLeafCategory(state, id, options = {}) {
  const category = categoryMap(state).get(String(id || ""));
  if (!category) return false;
  if (options.activeOnly && category.status !== "active") return false;
  return !(state.questionBankCategories || []).some((item) => item.parentId === category.id && (!options.activeOnly || item.status === "active"));
}

export function activeLeafCategory(state, id) {
  const category = categoryMap(state).get(String(id || ""));
  const pathIds = new Set(categoryPath(state, category?.id).map((item) => item.id));
  const pathIsActive = [...pathIds].every((pathId) => categoryMap(state).get(pathId)?.status === "active");
  return category?.status === "active" && pathIsActive && isLeafCategory(state, category.id, { activeOnly: true }) ? category : null;
}

export function categorySnapshotForId(state, id) {
  const category = categoryMap(state).get(String(id || ""));
  if (!category) return null;
  const path = categoryPath(state, category.id);
  return {
    id: category.id,
    name: category.name,
    path: path.map((item) => ({ ...item })),
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
