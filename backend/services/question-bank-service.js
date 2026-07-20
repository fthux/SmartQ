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
import { paperSnapshotDetail, upsertPaperSnapshot } from "./paper-service.js";

export function listQuestionBank(state, query = {}) {
  const search = String(query.search || "").trim().toLowerCase();
  const status = questionBankStatuses.includes(query.status) ? query.status : "";
  const type = questionTypes.includes(query.type) ? query.type : "";
  const difficulty = questionDifficulties.includes(query.difficulty) ? query.difficulty : "";
  const page = clampNumber(query.page, 1, 100_000, 1);
  const pageSize = clampNumber(query.pageSize, 1, 100, 20);
  const usageMap = questionBankUsageMap(state);
  const items = (state.questionBank || [])
    .filter((item) => {
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
    items: items.slice(start, start + pageSize).map((item) => questionBankSummary(item, usageMap.get(item.id))),
    total: items.length,
    page,
    pageSize,
  };
}

export function getQuestionBankDetail(state, id) {
  const item = findQuestionBankItem(state, id);
  if (!item) return null;
  return {
    ...item,
    usages: questionBankUsages(state, id),
  };
}

export async function createQuestionBankItem(body = {}, actor = "") {
  const candidate = buildQuestionBankCandidate(body, null, actor);
  ensureValidQuestion(candidate);
  return updateState((state) => {
    const duplicate = (state.questionBank || []).find((item) => item.contentHash === candidate.contentHash);
    if (duplicate) throw conflict(`题库中已存在相同题目：${duplicate.id}`);
    const stemConflict = findStemConflict(state, candidate);
    if (stemConflict) throw conflict(`题干相同但答案、选项或评分规则不同，请与题库题目 ${stemConflict.id} 对比处理`);
    state.questionBank.unshift(candidate);
    state.auditLog.push(logItem("question-bank-create", `新建题库题目：${candidate.id}`, { actor }));
    return questionBankSummary(candidate);
  });
}

export async function updateQuestionBankItem(id, body = {}, actor = "") {
  return updateState((state) => {
    const item = findQuestionBankItem(state, id);
    if (!item) return null;
    const candidate = buildQuestionBankCandidate(body, item, actor);
    ensureValidQuestion(candidate);
    const duplicate = (state.questionBank || []).find((entry) => entry.id !== id && entry.contentHash === candidate.contentHash);
    if (duplicate) throw conflict(`修改后的题目与题库题目 ${duplicate.id} 重复`);
    const stemConflict = findStemConflict(state, candidate, id);
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
      updatedBy: actor,
      updatedAt: now,
    });
    if (contentChanged) item.revisions.push(questionBankRevision(item, actor, now));
    state.auditLog.push(logItem("question-bank-update", `更新题库题目：${item.id}${contentChanged ? `，版本 v${item.version}` : ""}`, { actor }));
    return questionBankSummary(item, questionBankUsageMap(state).get(item.id));
  });
}

export async function setQuestionBankArchived(id, archived, actor = "") {
  return updateState((state) => {
    const item = findQuestionBankItem(state, id);
    if (!item) return null;
    if (archived) {
      if (item.status !== "已归档") item.archivedFromStatus = item.status === "已校验" ? "已校验" : "待确认";
      item.status = "已归档";
    } else {
      item.status = item.archivedFromStatus === "已校验" ? "已校验" : "待确认";
    }
    item.updatedBy = actor;
    item.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem(archived ? "question-bank-archive" : "question-bank-restore", `${archived ? "归档" : "恢复"}题库题目：${item.id}`, { actor }));
    return questionBankSummary(item, questionBankUsageMap(state).get(item.id));
  });
}

export async function importQuestionsToBank(body = {}, actor = "") {
  return updateState((state) => {
    const paperId = String(body.paperId || "");
    const paper = paperId ? (state.papers || []).find((item) => item.id === paperId) : null;
    if (paperId && !paper) return null;
    const sourceQuestions = paper ? paperSnapshotDetail(paper, state.questions).questions : state.questions;
    const selectedIds = new Set(Array.isArray(body.questionIds) ? body.questionIds.map(String) : []);
    const questions = selectedIds.size ? sourceQuestions.filter((item) => selectedIds.has(String(item.id))) : sourceQuestions;
    const result = { created: 0, reused: 0, skipped: 0, conflicts: [], items: [] };
    for (const question of questions) {
      if (question.status !== "已校验" && paper?.status !== "已发布") {
        result.skipped += 1;
        continue;
      }
      const hash = questionContentHash(question);
      const linked = question.origin?.bankQuestionId
        ? findQuestionBankItem(state, question.origin.bankQuestionId)
        : null;
      if (linked && linked.contentHash !== hash) {
        result.conflicts.push({ questionId: question.id, bankQuestionId: linked.id, message: "试卷题目已修改，与原题库版本内容不一致" });
        continue;
      }
      const existing = linked || (state.questionBank || []).find((item) => item.contentHash === hash);
      const source = buildImportSource(question, paper, state.paper, actor);
      if (existing) {
        addQuestionSource(existing, source);
        existing.updatedAt = new Date().toISOString();
        result.reused += 1;
        result.items.push(questionBankSummary(existing));
        continue;
      }
      const stemConflict = findStemConflict(state, question);
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
      }, null, actor);
      ensureValidQuestion(created);
      state.questionBank.unshift(created);
      result.created += 1;
      result.items.push(questionBankSummary(created));
    }
    state.auditLog.push(logItem("question-bank-import", `题目入库完成：新增 ${result.created}，复用 ${result.reused}，跳过 ${result.skipped}，冲突 ${result.conflicts.length}`, { actor, paperId }));
    return result;
  });
}

export async function importQuestionBankIntoAuthoring(body = {}, actor = "") {
  const ids = [...new Set((Array.isArray(body.questionBankIds) ? body.questionBankIds : []).map(String))].slice(0, 100);
  if (!ids.length) throw badRequest("请选择需要加入试卷的题目");
  return updateState((state) => {
    const selected = ids.map((id) => findQuestionBankItem(state, id)).filter(Boolean);
    if (selected.length !== ids.length) throw badRequest("部分题库题目不存在，请刷新后重试");
    const unavailable = selected.find((item) => item.status !== "已校验");
    if (unavailable) throw badRequest(`题库题目 ${unavailable.id} 尚未审核通过或已归档`);
    const currentBankIds = new Set((state.questions || []).map((item) => item.origin?.bankQuestionId).filter(Boolean));
    const currentHashes = new Set((state.questions || []).map((item) => questionContentHash(item)));
    const added = [];
    const skipped = [];
    for (const item of selected) {
      if (currentBankIds.has(item.id) || currentHashes.has(item.contentHash)) {
        skipped.push(item.id);
        continue;
      }
      const question = bankItemToAuthoringQuestion(item);
      state.questions.push(question);
      added.push(question);
      currentBankIds.add(item.id);
      currentHashes.add(item.contentHash);
    }
    if (added.length) {
      const now = new Date().toISOString();
      if (!state.generationTask) {
        state.generationTask = buildBankGenerationTask(state.questions, state.paper?.name || body.paperName || "题库组卷");
      } else {
        state.generationTask = {
          ...state.generationTask,
          count: state.questions.length,
          totalScore: state.questions.reduce((sum, item) => sum + Number(item.score || 0), 0),
        };
      }
      if (state.paper?.id) {
        state.paper.questionIds = state.questions.map((item) => item.id);
        state.paper.status = "草稿";
        state.paper.publishedAt = null;
        upsertPaperSnapshot(state, buildPaper(state.questions, state.paper));
      }
      state.auditLog.push(logItem("question-bank-add-to-paper", `从题库加入当前试卷 ${added.length} 道题`, { actor, questionBankIds: added.map((item) => item.origin.bankQuestionId), createdAt: now }));
    }
    return {
      added: added.length,
      skipped: skipped.length,
      skippedIds: skipped,
      questions: added,
      paper: buildPaper(state.questions, state.paper),
    };
  });
}

export function resolveGenerationQuestionBank(state, sourcePlan = {}, spec = {}) {
  const ids = [...new Set((Array.isArray(sourcePlan.questionBankIds) ? sourcePlan.questionBankIds : []).map(String))].slice(0, 100);
  if (!ids.length) return { questions: [], items: [] };
  const selected = ids.map((id) => findQuestionBankItem(state, id)).filter(Boolean);
  if (selected.length !== ids.length) throw badRequest("部分题库题目不存在，请重新选择");
  const unavailable = selected.find((item) => item.status !== "已校验");
  if (unavailable) throw badRequest(`题库题目 ${unavailable.id} 尚未审核通过或已归档`);

  const typeTargets = generationTypeTargets(spec);
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

  return {
    questions: selected.map((item) => bankItemToAuthoringQuestion(item, generationScoreForType(spec, item.type))),
    items: selected.map((item) => ({
      id: item.id,
      type: item.type,
      stem: item.stem,
      version: Number(item.version || 1),
    })),
  };
}

export function questionBankUsages(state, id) {
  return [...(questionBankUsageMap(state).get(id)?.values() || [])]
    .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
}

function buildQuestionBankCandidate(body, existing, actor) {
  const now = new Date().toISOString();
  const base = existing || {};
  const raw = {
    ...base,
    ...body,
    id: base.id || createQuestionBankId(),
    defaultScore: body.defaultScore ?? body.score ?? base.defaultScore ?? 1,
    status: body.status === "已归档" ? (base.status || "待确认") : (body.status || base.status || "待确认"),
    origin: body.origin || base.origin || { type: "manual", materialRefs: [] },
    sources: body.sources || base.sources || [],
    version: base.version || 1,
    createdBy: base.createdBy || actor,
    updatedBy: actor,
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
  const normalized = normalizeQuestionBankRecord(raw);
  normalized.contentHash = questionContentHash(normalized);
  normalized.revisions = base.revisions || normalized.revisions;
  if (!existing) normalized.revisions = [questionBankRevision(normalized, actor, now)];
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

function buildBankGenerationTask(questions, paperName) {
  const apiKeys = { 单选: "single", 多选: "multiple", 判断: "judge", 填空: "blank", 简答: "short", 论述: "essay" };
  const typeMix = questionTypes.map((type) => ({ type, count: questions.filter((item) => item.type === type).length })).filter((item) => item.count);
  const typeCounts = Object.fromEntries(typeMix.map((item) => [apiKeys[item.type], item.count]));
  const typeScores = Object.fromEntries(typeMix.map((item) => [apiKeys[item.type], Number(questions.find((question) => question.type === item.type)?.score || 1)]));
  return {
    paperName,
    direction: "题库选题",
    difficulty: "混合",
    knowledge: [...new Set(questions.flatMap((item) => item.knowledge || []))],
    requirements: "",
    count: questions.length,
    totalScore: questions.reduce((sum, item) => sum + Number(item.score || 0), 0),
    typeCounts,
    typeScores,
    typeMix,
    sourcePlan: { mode: "question-bank", questionBankCount: questions.length },
  };
}

function normalizeImportedOrigin(origin = {}) {
  if (origin?.type === "material") return { type: "material", materialRefs: origin.materialRefs || [] };
  return { type: origin?.type === "ai" ? "ai" : "paper", materialRefs: origin?.materialRefs || [] };
}

function questionBankSummary(item, usages) {
  const usageCount = usages instanceof Map ? usages.size : 0;
  return {
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
    status: item.status,
    version: Number(item.version || 1),
    origin: item.origin || { type: "manual", materialRefs: [] },
    sourceCount: (item.sources || []).length,
    paperUsageCount: usageCount,
    createdBy: item.createdBy || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function questionBankUsageMap(state) {
  const map = new Map();
  for (const item of state.questionBank || []) {
    const usages = new Map();
    for (const source of item.sources || []) {
      if (source.type !== "paper" || !source.paperId) continue;
      usages.set(source.paperId, {
        paperId: source.paperId,
        paperName: source.paperName || source.paperId,
        status: (state.papers || []).find((paper) => paper.id === source.paperId)?.status || "历史试卷",
        questionCount: 1,
        createdAt: source.addedAt,
        publishedAt: (state.papers || []).find((paper) => paper.id === source.paperId)?.publishedAt || null,
        relation: "入库来源",
      });
    }
    map.set(item.id, usages);
  }
  for (const paper of state.papers || []) {
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

function findQuestionBankItem(state, id) {
  return (state.questionBank || []).find((item) => item.id === id) || null;
}

function findStemConflict(state, question, excludeId = "") {
  const fingerprint = questionFingerprint(question);
  if (!fingerprint.stem) return null;
  return (state.questionBank || []).find((item) => {
    if (item.id === excludeId || item.contentHash === questionContentHash(question)) return false;
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
