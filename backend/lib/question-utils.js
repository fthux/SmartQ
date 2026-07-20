import { createHash } from "node:crypto";

export const questionTypes = ["单选", "多选", "判断", "填空", "简答", "论述"];
export const questionDifficulties = ["易", "中", "难", "混合"];
export const questionBankStatuses = ["待确认", "已校验", "已归档"];

export function questionContentHash(question = {}) {
  return createHash("sha256").update(JSON.stringify(questionFingerprint(question))).digest("hex");
}

export function questionFingerprint(question = {}) {
  const type = cleanQuestionType(question.type);
  return {
    type,
    stem: normalizeFingerprintText(question.stem),
    options: normalizeOptions(question.options, type).map(normalizeFingerprintText),
    answer: normalizeFingerprintAnswer(question.answer, type),
    rubric: normalizeStringList(question.rubric).map(normalizeFingerprintText),
  };
}

export function normalizeQuestionBankRecord(item = {}) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const now = new Date().toISOString();
  const type = cleanQuestionType(item.type);
  const status = questionBankStatuses.includes(item.status) ? item.status : "待确认";
  const normalized = {
    id: String(item.id),
    type,
    stem: cleanText(item.stem, 10_000),
    options: normalizeOptions(item.options, type),
    answer: normalizeAnswer(item.answer, type),
    explanation: cleanText(item.explanation, 10_000),
    rubric: normalizeStringList(item.rubric, 30, 500),
    defaultScore: clampNumber(item.defaultScore ?? item.score, 1, 200, 1),
    difficulty: questionDifficulties.includes(item.difficulty) ? item.difficulty : "中",
    knowledge: normalizeStringList(item.knowledge, 20, 80),
    tags: normalizeStringList(item.tags, 20, 40),
    status,
    archivedFromStatus: ["待确认", "已校验"].includes(item.archivedFromStatus) ? item.archivedFromStatus : "待确认",
    version: Math.max(1, Number(item.version || 1)),
    contentHash: String(item.contentHash || ""),
    origin: normalizeOrigin(item.origin),
    sources: normalizeSources(item.sources),
    revisions: normalizeRevisions(item.revisions),
    createdBy: String(item.createdBy || ""),
    updatedBy: String(item.updatedBy || item.createdBy || ""),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now,
  };
  normalized.contentHash = normalized.contentHash || questionContentHash(normalized);
  if (!normalized.revisions.length) normalized.revisions = [questionBankRevision(normalized, normalized.createdBy, normalized.createdAt)];
  return normalized;
}

export function questionBankRevision(item = {}, actor = "", createdAt = new Date().toISOString()) {
  return {
    version: Math.max(1, Number(item.version || 1)),
    type: cleanQuestionType(item.type),
    stem: cleanText(item.stem, 10_000),
    options: normalizeOptions(item.options, item.type),
    answer: normalizeAnswer(item.answer, item.type),
    explanation: cleanText(item.explanation, 10_000),
    rubric: normalizeStringList(item.rubric, 30, 500),
    defaultScore: clampNumber(item.defaultScore ?? item.score, 1, 200, 1),
    difficulty: questionDifficulties.includes(item.difficulty) ? item.difficulty : "中",
    knowledge: normalizeStringList(item.knowledge, 20, 80),
    tags: normalizeStringList(item.tags, 20, 40),
    contentHash: String(item.contentHash || questionContentHash(item)),
    createdBy: String(actor || ""),
    createdAt,
  };
}

export function questionForValidation(item = {}) {
  return {
    type: cleanQuestionType(item.type),
    stem: cleanText(item.stem, 10_000),
    options: normalizeOptions(item.options, item.type),
    answer: normalizeAnswer(item.answer, item.type),
    explanation: cleanText(item.explanation, 10_000),
    rubric: normalizeStringList(item.rubric, 30, 500),
    score: clampNumber(item.defaultScore ?? item.score, 1, 200, 1),
    difficulty: questionDifficulties.includes(item.difficulty) ? item.difficulty : "中",
    knowledge: normalizeStringList(item.knowledge, 20, 80),
    status: item.status === "已校验" ? "已校验" : "待确认",
  };
}

export function normalizeStringList(value, maxItems = 20, maxLength = 80) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,，、\n]/);
  return [...new Set(list.map((entry) => cleanText(entry, maxLength)).filter(Boolean))].slice(0, maxItems);
}

export function normalizeOptions(value, type = "") {
  if (type === "判断") return ["正确", "错误"];
  if (!["单选", "多选"].includes(type)) return [];
  const list = Array.isArray(value) ? value : String(value || "").split(/\n/);
  return list.map((entry) => cleanText(entry, 500)).filter(Boolean).slice(0, 8);
}

export function normalizeAnswer(value, type = "") {
  if (type === "多选") {
    const list = Array.isArray(value) ? value : String(value || "").split(/[,，、\s]+/);
    return [...new Set(list.map((entry) => String(entry || "").trim().toUpperCase()).filter(Boolean))].sort();
  }
  if (type === "单选") return String(Array.isArray(value) ? value[0] || "" : value || "").trim().toUpperCase();
  if (type === "判断") {
    const text = String(Array.isArray(value) ? value[0] || "" : value ?? "").trim().toLowerCase();
    return ["错误", "错", "否", "false", "0"].includes(text) ? "错误" : "正确";
  }
  return cleanText(Array.isArray(value) ? value.join("、") : value, 10_000);
}

export function cleanQuestionType(value) {
  const type = String(value || "").trim();
  return questionTypes.includes(type) ? type : "单选";
}

function normalizeFingerprintAnswer(value, type) {
  const answer = normalizeAnswer(value, type);
  return Array.isArray(answer) ? answer.map(normalizeFingerprintText).sort() : normalizeFingerprintText(answer);
}

function normalizeFingerprintText(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeOrigin(origin = {}) {
  return {
    type: ["manual", "ai", "material", "paper", "question-bank"].includes(origin?.type) ? origin.type : "manual",
    materialRefs: Array.isArray(origin?.materialRefs) ? origin.materialRefs.map((ref) => ({ ...ref })).filter(Boolean) : [],
  };
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((source) => {
    if (!source || typeof source !== "object") return null;
    const normalized = {
      type: source.type === "paper" ? "paper" : source.type === "authoring" ? "authoring" : "manual",
      paperId: String(source.paperId || ""),
      paperName: String(source.paperName || ""),
      questionId: String(source.questionId || ""),
      addedBy: String(source.addedBy || ""),
      addedAt: source.addedAt || new Date().toISOString(),
    };
    const key = `${normalized.type}:${normalized.paperId}:${normalized.questionId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return normalized;
  }).filter(Boolean);
}

function normalizeRevisions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((revision) => {
    if (!revision || typeof revision !== "object") return null;
    return {
      version: Math.max(1, Number(revision.version || 1)),
      type: cleanQuestionType(revision.type),
      stem: cleanText(revision.stem, 10_000),
      options: normalizeOptions(revision.options, revision.type),
      answer: normalizeAnswer(revision.answer, revision.type),
      explanation: cleanText(revision.explanation, 10_000),
      rubric: normalizeStringList(revision.rubric, 30, 500),
      defaultScore: clampNumber(revision.defaultScore ?? revision.score, 1, 200, 1),
      difficulty: questionDifficulties.includes(revision.difficulty) ? revision.difficulty : "中",
      knowledge: normalizeStringList(revision.knowledge, 20, 80),
      tags: normalizeStringList(revision.tags, 20, 40),
      contentHash: String(revision.contentHash || questionContentHash(revision)),
      createdBy: String(revision.createdBy || ""),
      createdAt: revision.createdAt || new Date().toISOString(),
    };
  }).filter(Boolean).sort((a, b) => a.version - b.version);
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
