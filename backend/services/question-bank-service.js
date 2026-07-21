import { randomBytes } from "node:crypto";
import { buildPaper, validateQuestions } from "../lib/ai.js";
import { logItem } from "../lib/audit.js";
import {
  normalizeQuestionBankRecord,
  questionBankRevision,
  questionBankStatuses,
  questionContentHash,
  questionDifficulties,
  questionFingerprint,
  questionForValidation,
  questionTypes,
} from "../lib/question-utils.js";
import { updateState } from "../lib/runtime-store.js";
import {
  activeLeafCategory,
  categoryDescendantIds,
  categoryMap,
  categoryPath,
  normalizeCategoryIds,
} from "../lib/question-bank-categories.js";
import { paperSnapshotDetail, upsertPaperSnapshot } from "./paper-service.js";
import { validateActiveLeafCategories } from "./question-bank-category-service.js";
import { scopedAuthoringState } from "./authoring-workspace-service.js";
import {
  accessibleResources,
  canAccessResource,
  decorateOwnedResource,
  resourceOwnerUserId,
} from "./access-control-service.js";

export function listQuestionBank(state, query = {}, actor = {}) {
  const search = String(query.search || "").trim().toLowerCase();
  const status = questionBankStatuses.includes(query.status) ? query.status : "";
  const type = questionTypes.includes(query.type) ? query.type : "";
  const difficulty = questionDifficulties.includes(query.difficulty) ? query.difficulty : "";
  const categoryId = String(query.categoryId || "all");
  const page = clampNumber(query.page, 1, 100_000, 1);
  const pageSize = clampNumber(query.pageSize, 1, 100, 20);
  const ownerUserId = String(query.ownerUserId || "");
  const usageMap = questionBankUsageMap(state, actor);
  const items = accessibleResources(state.questionBank, actor)
    .filter((item) => {
      if (ownerUserId && resourceOwnerUserId(item) !== ownerUserId) return false;
      if (categoryId === "archived") {
        if (item.status !== "已归档") return false;
      } else if (categoryId === "unclassified") {
        if (item.status === "已归档" || (item.categoryIds || []).length) return false;
      } else if (categoryId === "multi") {
        if (item.status === "已归档" || (item.categoryIds || []).length < 2) return false;
      } else if (categoryId !== "all") {
        const categoryIds = categoryDescendantIds(state, categoryId);
        if (item.status === "已归档" || !(item.categoryIds || []).some((id) => categoryIds.has(id))) return false;
      } else if (!status && item.status === "已归档") return false;
      if (status && item.status !== status) return false;
      if (type && item.type !== type) return false;
      if (difficulty && item.difficulty !== difficulty) return false;
      if (!search) return true;
      return [item.id, item.stem, item.type, item.difficulty, ...(item.knowledge || []), ...(item.tags || [])]
        .join(" ").toLowerCase().includes(search);
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize).map((item) => questionBankSummary(item, usageMap.get(item.id), state)),
    total: items.length,
    page,
    pageSize,
  };
}

export function getQuestionBankDetail(state, id, actor = {}) {
  const item = findQuestionBankItem(state, id, actor);
  if (!item) return null;
  return {
    ...item,
    categories: categorySummaries(state, item.categoryIds),
    usages: questionBankUsages(state, id, actor),
    ...decorateOwnedResource(state, item),
  };
}

export async function createQuestionBankItem(body = {}, actor = {}) {
  return updateState((state) => {
    const ownerUserId = actor.userId;
    const categoryIds = validateActiveLeafCategories(state, body.categoryIds, true, actor, ownerUserId);
    const candidate = buildQuestionBankCandidate({ ...body, categoryIds, status: "已校验" }, null, actor, ownerUserId);
    ensureValidQuestion(candidate);
    const duplicate = (state.questionBank || []).find((item) => resourceOwnerUserId(item) === ownerUserId && item.contentHash === candidate.contentHash);
    if (duplicate) throw conflict(`题库中已存在相同题目：${duplicate.id}`);
    const stemConflict = findStemConflict(state, candidate, "", ownerUserId);
    if (stemConflict) throw conflict(`题干相同但答案、选项或评分规则不同，请与题库题目 ${stemConflict.id} 对比处理`);
    state.questionBank.unshift(candidate);
    state.auditLog.push(logItem("question-bank-create", `新建题库题目：${candidate.id}`, { actor: actor.username, ownerUserId }));
    return questionBankSummary(candidate, null, state);
  });
}

export async function updateQuestionBankItem(id, body = {}, actor = {}) {
  return updateState((state) => {
    const item = findQuestionBankItem(state, id, actor);
    if (!item) return null;
    const ownerUserId = resourceOwnerUserId(item);
    const categoryIds = body.categoryIds === undefined ? item.categoryIds : validateActiveLeafCategories(state, body.categoryIds, true, actor, ownerUserId);
    const candidate = buildQuestionBankCandidate({
      ...body,
      categoryIds,
      status: item.status === "已归档" ? "已归档" : "已校验",
    }, item, actor, ownerUserId);
    ensureValidQuestion(candidate);
    const duplicate = (state.questionBank || []).find((entry) => entry.id !== id && resourceOwnerUserId(entry) === ownerUserId && entry.contentHash === candidate.contentHash);
    if (duplicate) throw conflict(`修改后的题目与题库题目 ${duplicate.id} 重复`);
    const stemConflict = findStemConflict(state, candidate, id, ownerUserId);
    if (stemConflict) throw conflict(`修改后的题干与题库题目 ${stemConflict.id} 相同，但答案、选项或评分规则不同`);
    const contentChanged = candidate.contentHash !== item.contentHash;
    const now = new Date().toISOString();
    Object.assign(item, candidate, {
      id: item.id,
      version: contentChanged ? Number(item.version || 1) + 1 : Number(item.version || 1),
      sources: item.sources || [],
      revisions: item.revisions || [],
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      updatedBy: actor.username,
      updatedByUserId: actor.userId,
      updatedAt: now,
    });
    if (contentChanged) item.revisions.push(questionBankRevision(item, actor.username, now));
    state.auditLog.push(logItem("question-bank-update", `更新题库题目：${item.id}${contentChanged ? `，版本 v${item.version}` : ""}`, { actor: actor.username, ownerUserId }));
    return questionBankSummary(item, questionBankUsageMap(state, actor).get(item.id), state);
  });
}

export async function setQuestionBankArchived(id, archived, actor = {}) {
  return updateState((state) => {
    const item = findQuestionBankItem(state, id, actor);
    if (!item) return null;
    if (archived) {
      item.archivedFromStatus = "已校验";
      item.status = "已归档";
    } else {
      item.status = "已校验";
    }
    item.updatedBy = actor.username;
    item.updatedByUserId = actor.userId;
    item.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem(archived ? "question-bank-archive" : "question-bank-restore", `${archived ? "归档" : "恢复"}题库题目：${item.id}`, { actor: actor.username, ownerUserId: item.ownerUserId }));
    return questionBankSummary(item, questionBankUsageMap(state, actor).get(item.id), state);
  });
}

export async function importQuestionsToBank(body = {}, actor = {}, activeOwnerUserId = "") {
  return updateState((state) => {
    const paperId = String(body.paperId || "");
    const paper = paperId ? (state.papers || []).find((item) => item.id === paperId && canAccessResource(actor, item)) : null;
    if (paperId && !paper) return null;
    const ownerUserId = paper ? resourceOwnerUserId(paper) : String(activeOwnerUserId || actor.userId);
    const scopedState = scopedAuthoringState(state, ownerUserId);
    const categoryId = resolveImportCategoryId(scopedState, body, actor, ownerUserId);
    const sourceQuestions = paper ? paperSnapshotDetail(paper, scopedState.questions).questions : scopedState.questions;
    const selectedIds = new Set(Array.isArray(body.questionIds) ? body.questionIds.map(String) : []);
    const questions = selectedIds.size ? sourceQuestions.filter((item) => selectedIds.has(String(item.id))) : sourceQuestions;
    const result = { created: 0, reused: 0, skipped: 0, conflicts: [], items: [] };
    for (const question of questions) {
      const hash = questionContentHash(question);
      const linked = question.origin?.bankQuestionId
        ? (scopedState.questionBank || []).find((item) => item.id === question.origin.bankQuestionId && resourceOwnerUserId(item) === ownerUserId)
        : null;
      if (linked && linked.contentHash !== hash) {
        result.conflicts.push({ questionId: question.id, bankQuestionId: linked.id, message: "试卷题目已修改，与原题库版本内容不一致" });
        continue;
      }
      const existing = linked || (scopedState.questionBank || []).find((item) => resourceOwnerUserId(item) === ownerUserId && item.contentHash === hash);
      const source = buildImportSource(question, paper, scopedState.paper, actor.username);
      if (existing) {
        addQuestionSource(existing, source);
        existing.categoryIds = [...new Set([...(existing.categoryIds || []), categoryId])];
        existing.updatedAt = new Date().toISOString();
        result.reused += 1;
        result.items.push(questionBankSummary(existing, null, scopedState));
        continue;
      }
      const stemConflict = findStemConflict(scopedState, question, "", ownerUserId);
      if (stemConflict) {
        result.conflicts.push({ questionId: question.id, bankQuestionId: stemConflict.id, message: "题干相同但答案、选项或评分规则不同" });
        continue;
      }
      const created = buildQuestionBankCandidate({
        ...question,
        defaultScore: question.score,
        status: "已校验",
        origin: normalizeImportedOrigin(question.origin),
        sources: [source],
        categoryIds: [categoryId],
      }, null, actor, ownerUserId);
      ensureValidQuestion(created);
      scopedState.questionBank.unshift(created);
      result.created += 1;
      result.items.push(questionBankSummary(created, null, scopedState));
    }
    state.auditLog.push(logItem("question-bank-import", `题目入库完成：新增 ${result.created}，复用 ${result.reused}，跳过 ${result.skipped}，冲突 ${result.conflicts.length}`, { actor: actor.username, paperId, ownerUserId }));
    return result;
  });
}

export async function importQuestionBankIntoAuthoring(body = {}, actor = {}, ownerUserId = "") {
  const ids = [...new Set((Array.isArray(body.questionBankIds) ? body.questionBankIds : []).map(String))].slice(0, 100);
  if (!ids.length) throw badRequest("请选择需要加入试卷的题目");
  return updateState((state) => {
    const scopedState = scopedAuthoringState(state, ownerUserId);
    const selected = ids.map((id) => findQuestionBankItem(scopedState, id, actor)).filter(Boolean);
    if (selected.length !== ids.length) throw badRequest("部分题库题目不存在，请刷新后重试");
    const unavailable = selected.find((item) => item.status !== "已校验");
    if (unavailable) throw badRequest(`题库题目 ${unavailable.id} 尚未审核通过或已归档`);
    const currentBankIds = new Set((scopedState.questions || []).map((item) => item.origin?.bankQuestionId).filter(Boolean));
    const currentHashes = new Set((scopedState.questions || []).map((item) => questionContentHash(item)));
    const added = [];
    const skipped = [];
    for (const item of selected) {
      if (currentBankIds.has(item.id) || currentHashes.has(item.contentHash)) {
        skipped.push(item.id);
        continue;
      }
      const question = bankItemToAuthoringQuestion(item);
      scopedState.questions.push(question);
      added.push(question);
      currentBankIds.add(item.id);
      currentHashes.add(item.contentHash);
    }
    if (added.length) {
      const now = new Date().toISOString();
      scopedState.generationTask = buildBankGenerationTask(
        scopedState.questions,
        scopedState.paper?.name || body.paperName || "题库组卷",
        scopedState.generationTask,
      );
      if (scopedState.paper?.id) {
        scopedState.paper.questionIds = scopedState.questions.map((item) => item.id);
        scopedState.paper.status = "草稿";
        scopedState.paper.publishedAt = null;
        upsertPaperSnapshot(scopedState, buildPaper(scopedState.questions, scopedState.paper), actor, ownerUserId);
      }
      state.auditLog.push(logItem("question-bank-add-to-paper", `从题库加入当前试卷 ${added.length} 道题`, { actor: actor.username, ownerUserId, questionBankIds: added.map((item) => item.origin.bankQuestionId), createdAt: now }));
    }
    return {
      added: added.length,
      skipped: skipped.length,
      skippedIds: skipped,
      questions: added,
      paper: buildPaper(scopedState.questions, scopedState.paper),
    };
  });
}

export function resolveGenerationQuestionBank(state, sourcePlan = {}, spec = {}, actor = {}) {
  const ids = [...new Set((Array.isArray(sourcePlan.questionBankIds) ? sourcePlan.questionBankIds : []).map(String))].slice(0, 100);
  const typeTargets = generationTypeTargets(spec);
  if (ids.length) {
    const selected = ids.map((id) => findQuestionBankItem(state, id, actor)).filter(Boolean);
    if (selected.length !== ids.length) throw badRequest("部分题库题目不存在，请重新选择");
    const unavailable = selected.find((item) => item.status !== "已校验");
    if (unavailable) throw badRequest(`题库题目 ${unavailable.id} 已归档，不能用于新的试卷`);
    validateSelectedTypeCounts(selected, typeTargets);
    return resolvedQuestionBankSelection(state, selected, spec, {
      requestedCount: selected.length,
      allocationMode: "legacy-exact",
      categoryIds: [...new Set(selected.flatMap((item) => item.categoryIds || []))],
      allocations: [],
      availableCount: selected.length,
    });
  }

  const requestedCount = clampNumber(sourcePlan.questionBankRequestedCount, 0, 100, 0);
  if (!requestedCount) return resolvedQuestionBankSelection(state, [], spec, {
    requestedCount: 0,
    allocationMode: "balanced",
    categoryIds: [],
    allocations: [],
    availableCount: 0,
  });
  const categoryIds = validateActiveLeafCategories(state, sourcePlan.questionBankCategoryIds, true, actor);
  const allocationMode = sourcePlan.questionBankAllocationMode === "manual" ? "manual" : "balanced";
  const allocations = normalizeGenerationAllocations(sourcePlan.questionBankAllocations, categoryIds, requestedCount, allocationMode);
  const categorySet = new Set(categoryIds);
  const candidates = accessibleResources(state.questionBank, actor).filter((item) => item.status === "已校验" && (item.categoryIds || []).some((id) => categorySet.has(id)));
  const selected = selectQuestionBankCandidates(state, candidates, allocations, typeTargets, requestedCount, allocationMode, spec);
  return resolvedQuestionBankSelection(state, selected, spec, {
    requestedCount,
    allocationMode,
    categoryIds,
    allocations,
    availableCount: candidates.length,
  });
}

export function previewGenerationQuestionBank(state, sourcePlan = {}, spec = {}, actor = {}) {
  return resolveGenerationQuestionBank(state, sourcePlan, spec, actor).selection;
}

function validateSelectedTypeCounts(selected, typeTargets) {
  const selectedTypeCounts = new Map();
  for (const item of selected) {
    selectedTypeCounts.set(item.type, (selectedTypeCounts.get(item.type) || 0) + 1);
  }
  for (const [type, selectedCount] of selectedTypeCounts) {
    const targetCount = typeTargets.get(type) || 0;
    if (selectedCount > targetCount) {
      throw badRequest(`${type}目标为 ${targetCount} 道，当前已选择 ${selectedCount} 道题库题，请移除至少 ${selectedCount - targetCount} 道`);
    }
  }
}

function resolvedQuestionBankSelection(state, selected, spec, plan) {
  const selectedTypeCounts = Object.fromEntries(questionTypes.map((type) => [type, selected.filter((item) => item.type === type).length]));
  return {
    questions: selected.map((item) => bankItemToAuthoringQuestion(item, generationScoreForType(spec, item.type))),
    items: selected.map((item) => ({
      id: item.id,
      type: item.type,
      stem: item.stem,
      version: Number(item.version || 1),
      categoryIds: [...(item.categoryIds || [])],
    })),
    selection: {
      requestedCount: plan.requestedCount,
      selectedCount: selected.length,
      shortfall: Math.max(0, plan.requestedCount - selected.length),
      availableCount: plan.availableCount,
      allocationMode: plan.allocationMode,
      categoryIds: [...plan.categoryIds],
      categories: plan.categoryIds.map((id) => categorySelectionSnapshot(state, id)),
      allocations: plan.allocations.map((item) => ({ ...item })),
      selectedTypeCounts,
    },
  };
}

function normalizeGenerationAllocations(input, categoryIds, requestedCount, mode) {
  if (mode !== "manual") {
    const base = Math.floor(requestedCount / categoryIds.length);
    let remainder = requestedCount % categoryIds.length;
    return categoryIds.map((categoryId) => ({
      categoryId,
      count: base + (remainder-- > 0 ? 1 : 0),
    }));
  }
  const inputMap = new Map((Array.isArray(input) ? input : []).map((item) => [String(item?.categoryId || ""), Number(item?.count || 0)]));
  const allocations = categoryIds.map((categoryId) => ({ categoryId, count: clampNumber(inputMap.get(categoryId), 0, requestedCount, 0) }));
  const total = allocations.reduce((sum, item) => sum + item.count, 0);
  if (total !== requestedCount) throw badRequest(`手动分配题量合计应为 ${requestedCount} 道，当前为 ${total} 道`);
  return allocations;
}

function selectQuestionBankCandidates(state, candidates, allocations, typeTargets, requestedCount, mode, spec) {
  const usageMap = questionBankUsageMap(state);
  const remainingTypes = new Map(typeTargets);
  const selected = [];
  const selectedIds = new Set();
  const comparator = questionBankCandidateComparator(spec, usageMap);
  const allocationOrder = [...allocations].sort((left, right) => {
    const leftAvailable = candidates.filter((item) => (item.categoryIds || []).includes(left.categoryId)).length;
    const rightAvailable = candidates.filter((item) => (item.categoryIds || []).includes(right.categoryId)).length;
    return leftAvailable - rightAvailable;
  });

  for (const allocation of allocationOrder) {
    const available = candidates
      .filter((item) => !selectedIds.has(item.id) && (item.categoryIds || []).includes(allocation.categoryId) && (remainingTypes.get(item.type) || 0) > 0)
      .sort(comparator);
    for (const item of available.slice(0, allocation.count)) {
      selected.push(item);
      selectedIds.add(item.id);
      remainingTypes.set(item.type, Math.max(0, (remainingTypes.get(item.type) || 0) - 1));
    }
  }

  if (mode === "balanced" && selected.length < requestedCount) {
    const fallback = candidates
      .filter((item) => !selectedIds.has(item.id) && (remainingTypes.get(item.type) || 0) > 0)
      .sort(comparator);
    for (const item of fallback) {
      if (selected.length >= requestedCount) break;
      selected.push(item);
      selectedIds.add(item.id);
      remainingTypes.set(item.type, Math.max(0, (remainingTypes.get(item.type) || 0) - 1));
    }
  }
  return selected;
}

function questionBankCandidateComparator(spec, usageMap) {
  const terms = [...new Set([
    spec.direction,
    ...(Array.isArray(spec.knowledge) ? spec.knowledge : String(spec.knowledge || "").split(/[,，、\n]/)),
  ].map((item) => String(item || "").trim().toLowerCase()).filter((item) => item.length > 1))];
  const matchScore = (item) => {
    const text = [item.stem, ...(item.knowledge || []), ...(item.tags || [])].join(" ").toLowerCase();
    return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  };
  return (left, right) => {
    const scoreDifference = matchScore(right) - matchScore(left);
    if (scoreDifference) return scoreDifference;
    const usageDifference = (usageMap.get(left.id)?.size || 0) - (usageMap.get(right.id)?.size || 0);
    if (usageDifference) return usageDifference;
    return String(left.id).localeCompare(String(right.id));
  };
}

function categorySelectionSnapshot(state, id) {
  const category = categoryMap(state).get(id);
  return {
    id,
    name: category?.name || id,
    path: categoryPath(state, id),
  };
}

export function questionBankUsages(state, id, actor = {}) {
  return [...(questionBankUsageMap(state, actor).get(id)?.values() || [])]
    .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
}

function buildQuestionBankCandidate(body, existing, actor, ownerUserId) {
  const now = new Date().toISOString();
  const base = existing || {};
  const raw = {
    ...base,
    ...body,
    id: base.id || createQuestionBankId(),
    defaultScore: body.defaultScore ?? body.score ?? base.defaultScore ?? 1,
    status: body.status === "已归档" || base.status === "已归档" ? "已归档" : "已校验",
    origin: body.origin || base.origin || { type: "manual", materialRefs: [] },
    sources: body.sources || base.sources || [],
    version: base.version || 1,
    createdBy: base.createdBy || actor.username,
    updatedBy: actor.username,
    ownerUserId: base.ownerUserId || ownerUserId,
    createdByUserId: base.createdByUserId || ownerUserId,
    updatedByUserId: actor.userId,
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
  const normalized = normalizeQuestionBankRecord(raw);
  normalized.contentHash = questionContentHash(normalized);
  normalized.revisions = base.revisions || normalized.revisions;
  if (!existing) normalized.revisions = [questionBankRevision(normalized, actor.username, now)];
  return normalized;
}

function ensureValidQuestion(item) {
  const checks = validateQuestions([questionForValidation(item)]);
  if (checks.failures.length) throw badRequest(checks.failures[0].message || "题目结构不完整");
}

function buildImportSource(question, paper, activePaper, actor) {
  const sourcePaper = paper || (activePaper?.id ? activePaper : null);
  return {
    type: sourcePaper ? "paper" : "authoring",
    paperId: sourcePaper?.id || "",
    paperName: sourcePaper?.name || "当前出题草稿",
    questionId: String(question.id || ""),
    addedBy: actor,
    addedAt: new Date().toISOString(),
  };
}

function addQuestionSource(item, source) {
  item.sources = Array.isArray(item.sources) ? item.sources : [];
  const key = `${source.type}:${source.paperId}:${source.questionId}`;
  const exists = item.sources.some((entry) => `${entry.type}:${entry.paperId}:${entry.questionId}` === key);
  if (!exists) item.sources.push(source);
}

function bankItemToAuthoringQuestion(item, score = item.defaultScore) {
  return {
    id: `q-bank-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    type: item.type,
    stem: item.stem,
    options: [...(item.options || [])],
    answer: Array.isArray(item.answer) ? [...item.answer] : item.answer,
    explanation: item.explanation || "",
    rubric: [...(item.rubric || [])],
    score: Number(score || 1),
    difficulty: item.difficulty,
    knowledge: [...(item.knowledge || [])],
    quality: 100,
    status: "已校验",
    origin: {
      type: "question-bank",
      bankQuestionId: item.id,
      bankVersion: item.version,
      bankCategoryIds: [...(item.categoryIds || [])],
      sourceType: item.origin?.type || "manual",
      materialRefs: Array.isArray(item.origin?.materialRefs) ? item.origin.materialRefs.map((ref) => ({ ...ref })) : [],
      edited: false,
    },
  };
}

function generationTypeTargets(spec = {}) {
  const apiKeys = { 单选: "single", 多选: "multiple", 判断: "judge", 填空: "blank", 简答: "short", 论述: "essay" };
  const counts = spec.typeCounts && typeof spec.typeCounts === "object" ? spec.typeCounts : {};
  const mix = Array.isArray(spec.typeMix) ? spec.typeMix : [];
  return new Map(questionTypes.map((type) => {
    const mixItem = mix.find((item) => item?.type === type);
    return [type, clampNumber(counts[apiKeys[type]] ?? counts[type] ?? mixItem?.count, 0, 50, 0)];
  }));
}

function generationScoreForType(spec = {}, type) {
  const apiKeys = { 单选: "single", 多选: "multiple", 判断: "judge", 填空: "blank", 简答: "short", 论述: "essay" };
  const defaults = { 单选: 2, 多选: 4, 判断: 2, 填空: 2, 简答: 5, 论述: 10 };
  const scores = spec.typeScores && typeof spec.typeScores === "object" ? spec.typeScores : {};
  return clampNumber(scores[apiKeys[type]] ?? scores[type], 1, 200, defaults[type] || 1);
}

function buildBankGenerationTask(questions, paperName, previous = {}) {
  const apiKeys = { 单选: "single", 多选: "multiple", 判断: "judge", 填空: "blank", 简答: "short", 论述: "essay" };
  const typeMix = questionTypes.map((type) => ({ type, count: questions.filter((item) => item.type === type).length })).filter((item) => item.count);
  const typeCounts = Object.fromEntries(typeMix.map((item) => [apiKeys[item.type], item.count]));
  const typeScores = Object.fromEntries(typeMix.map((item) => [item.type, Number(questions.find((question) => question.type === item.type)?.score || 1)]));
  const questionBankItems = questions
    .filter((item) => item.origin?.bankQuestionId)
    .map((item) => ({
      id: item.origin.bankQuestionId,
      type: item.type,
      stem: item.stem,
      version: Number(item.origin.bankVersion || 1),
    }));
  const materialQuestions = questions.filter((item) => item.origin?.type === "material");
  const materialIds = [...new Set(materialQuestions.flatMap((item) => (item.origin?.materialRefs || []).map((ref) => ref.materialId || ref.id).filter(Boolean)))];
  const sourcePlan = {
    ...(previous?.sourcePlan || {}),
    mode: materialQuestions.length ? (materialQuestions.length === questions.length ? "materials-only" : "mixed") : (questionBankItems.length ? "mixed" : "ai-only"),
    questionBankIds: questionBankItems.map((item) => item.id),
    questionBankItems,
    questionBankCount: questionBankItems.length,
    questionBankRequestedCount: questionBankItems.length,
    questionBankCategoryIds: [...new Set(questions.flatMap((item) => item.origin?.bankCategoryIds || []))],
    questionBankAllocationMode: "legacy-exact",
    materialIds,
    materialQuestionCount: materialQuestions.length,
    aiQuestionCount: Math.max(0, questions.length - questionBankItems.length - materialQuestions.length),
  };
  return {
    ...previous,
    paperName,
    direction: previous?.direction || "题库选题",
    difficulty: previous?.difficulty || "混合",
    knowledge: [...new Set(questions.flatMap((item) => item.knowledge || []))],
    requirements: previous?.requirements || "",
    count: questions.length,
    totalScore: questions.reduce((sum, item) => sum + Number(item.score || 0), 0),
    typeCounts,
    typeScores,
    allowMixedTypeScores: true,
    typeMix,
    sourcePlan,
  };
}

function normalizeImportedOrigin(origin = {}) {
  if (origin?.type === "material") return { type: "material", materialRefs: origin.materialRefs || [] };
  return { type: origin?.type === "ai" ? "ai" : "paper", materialRefs: origin?.materialRefs || [] };
}

function questionBankSummary(item, usages, state) {
  const usageCount = usages instanceof Map ? usages.size : 0;
  return decorateOwnedResource(state, {
    id: item.id,
    type: item.type,
    stem: item.stem,
    options: item.options || [],
    answer: item.answer,
    explanation: item.explanation || "",
    rubric: item.rubric || [],
    defaultScore: Number(item.defaultScore || 1),
    difficulty: item.difficulty,
    knowledge: item.knowledge || [],
    tags: item.tags || [],
    categoryIds: item.categoryIds || [],
    categories: state ? categorySummaries(state, item.categoryIds) : [],
    status: item.status,
    version: Number(item.version || 1),
    origin: item.origin || { type: "manual", materialRefs: [] },
    sourceCount: (item.sources || []).length,
    paperUsageCount: usageCount,
    createdBy: item.createdBy || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ownerUserId: item.ownerUserId,
    createdByUserId: item.createdByUserId,
    updatedByUserId: item.updatedByUserId,
  });
}

function resolveImportCategoryId(state, body, actor, ownerUserId) {
  const categoryId = String(body.categoryId || "");
  const category = activeLeafCategory(state, categoryId);
  if (!category || !canAccessResource(actor, category) || resourceOwnerUserId(category) !== ownerUserId) {
    throw badRequest("请选择有效的题库末级分类后再将题目加入题库");
  }
  return categoryId;
}

function categorySummaries(state, categoryIds = []) {
  const byId = categoryMap(state);
  return normalizeCategoryIds(categoryIds).map((id) => byId.get(id)).filter(Boolean).map((category) => ({
    id: category.id,
    name: category.name,
    status: category.status,
    path: categoryPath(state, category.id),
  }));
}

function questionBankUsageMap(state, actor = {}) {
  const map = new Map();
  const visiblePapers = accessibleResources(state.papers, actor);
  const visiblePaperIds = new Set(visiblePapers.map((item) => item.id));
  for (const item of accessibleResources(state.questionBank, actor)) {
    const usages = new Map();
    for (const source of item.sources || []) {
      if (source.type !== "paper" || !source.paperId) continue;
      if (!visiblePaperIds.has(source.paperId)) continue;
      const sourcePaper = visiblePapers.find((paper) => paper.id === source.paperId);
      usages.set(source.paperId, {
        paperId: source.paperId,
        paperName: sourcePaper?.name || source.paperName || source.paperId,
        status: sourcePaper?.status || "来源试卷已删除",
        questionCount: 1,
        createdAt: source.addedAt,
        publishedAt: sourcePaper?.publishedAt || null,
        relation: "入库来源",
      });
    }
    map.set(item.id, usages);
  }
  for (const paper of visiblePapers) {
    const counts = new Map();
    for (const question of paper.questions || []) {
      const bankId = question.origin?.bankQuestionId;
      if (bankId) counts.set(bankId, (counts.get(bankId) || 0) + 1);
    }
    for (const [bankId, questionCount] of counts) {
      const usages = map.get(bankId) || new Map();
      usages.set(paper.id, {
        paperId: paper.id,
        paperName: paper.name,
        status: paper.status,
        questionCount,
        createdAt: paper.createdAt,
        publishedAt: paper.publishedAt,
        relation: usages.has(paper.id) ? "入库来源、试卷使用" : "试卷使用",
      });
      map.set(bankId, usages);
    }
  }
  return map;
}

function findQuestionBankItem(state, id, actor = {}) {
  return (state.questionBank || []).find((item) => item.id === id && canAccessResource(actor, item)) || null;
}

function findStemConflict(state, question, excludeId = "", ownerUserId = resourceOwnerUserId(question)) {
  const fingerprint = questionFingerprint(question);
  if (!fingerprint.stem) return null;
  return (state.questionBank || []).find((item) => {
    if (resourceOwnerUserId(item) !== ownerUserId || item.id === excludeId || item.contentHash === questionContentHash(question)) return false;
    const existing = questionFingerprint(item);
    return existing.type === fingerprint.type && existing.stem === fingerprint.stem;
  }) || null;
}

function createQuestionBankId() {
  return `bank-question-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
