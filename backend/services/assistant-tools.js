import { getMaterialDetail, listMaterials } from "./material-service.js";
import { getQuestionBankDetail, listQuestionBank } from "./question-bank-service.js";
import { listQuestionBankCategories } from "./question-bank-category-service.js";
import { normalizeAuthoringWorkspace } from "./authoring-workspace-service.js";
import {
  USER_ROLES,
  accessibleResources,
  actorFromAuth,
  decorateOwnedResource,
  isSuperAdmin,
  publicUserSummary,
  resourceOwnerUserId,
} from "./access-control-service.js";
import { paperSnapshotDetail } from "./paper-service.js";

const defaultLimit = 20;
const maxLimit = 50;
const configuredAssistantToolResultBytes = Number(process.env.SMARTQ_ASSISTANT_TOOL_RESULT_MAX_BYTES || 32 * 1024);
const maxAssistantToolResultBytes = Number.isFinite(configuredAssistantToolResultBytes)
  ? Math.max(8 * 1024, Math.min(128 * 1024, configuredAssistantToolResultBytes))
  : 32 * 1024;
const maxAssistantStringLength = 8_000;
const maxAssistantArrayLength = 100;
const omittedBinaryValue = "[已省略二进制数据]";
const truncatedToolResultNotice = "工具结果过大，已保留最相关的部分。可缩小查询范围或指定更精确的条件。";
const sensitiveAssistantFields = new Set([
  "avatar",
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "apikey",
  "secret",
  "adminsessions",
  "connectionstring",
  "databaseurl",
  "postgresurl",
]);

export function createAssistantToolContext(state, auth, conversation = {}) {
  const actor = actorFromAuth(auth);
  const scope = conversation.scope === "all" && isSuperAdmin(actor) ? "all" : "mine";
  const dataActor = scope === "all" ? actor : { ...actor, role: USER_ROLES.USER };
  return { state, auth, actor, dataActor, scope, sources: [], toolNames: [], webUsed: false };
}

export function assistantFunctionTools(options = {}) {
  const tools = [
    tool("get_system_overview", "统计当前权限范围内的试卷、题库、资料和命题工作区数据。", {}),
    tool("search_papers", "按名称、状态、ID 或创建人查询试卷。", {
      query: stringProperty("搜索关键词"), status: stringProperty("试卷状态"), ownerUserId: stringProperty("创建人用户 ID，仅全系统范围可用"), limit: numberProperty("最多返回条数"),
    }),
    tool("get_paper", "读取指定试卷的题目、状态、分值和发布版本信息。", { id: stringProperty("试卷 ID") }, ["id"]),
    tool("search_question_bank", "按题干、题型、难度、知识点或分类查询题库。", {
      query: stringProperty("搜索关键词"), type: stringProperty("题型"), difficulty: stringProperty("难度"), categoryId: stringProperty("分类 ID"), ownerUserId: stringProperty("创建人用户 ID，仅全系统范围可用"), limit: numberProperty("最多返回条数"),
    }),
    tool("get_question", "读取指定题库题目的完整内容、分类和使用情况。", { id: stringProperty("题库题目 ID") }, ["id"]),
    tool("list_question_categories", "列出当前权限范围内的题库分类及题目数量。", {}),
    tool("search_materials", "按名称、标签、文件名、状态或创建人查询出题资料。", {
      query: stringProperty("搜索关键词"), status: stringProperty("资料状态"), ownerUserId: stringProperty("创建人用户 ID，仅全系统范围可用"), limit: numberProperty("最多返回条数"),
    }),
    tool("get_material", "读取指定资料的元数据和与关键词最相关的正文片段。", {
      id: stringProperty("资料 ID"), query: stringProperty("用于筛选正文片段的关键词"),
    }, ["id"]),
    tool("get_authoring_workspace", "读取当前用户或指定创建人的命题草稿和生成任务。", { ownerUserId: stringProperty("用户 ID，仅超级管理员全系统范围可用") }),
    tool("list_public_users", "列出系统用户的公开信息，仅超级管理员可用。", { query: stringProperty("账号或显示名称关键词"), limit: numberProperty("最多返回条数") }),
    tool("search_audit_log", "查询脱敏后的系统审计记录，仅超级管理员全系统范围可用。", { query: stringProperty("类型、消息或操作者关键词"), limit: numberProperty("最多返回条数") }),
  ];
  if (options.externalWebSearch) {
    tools.push(tool("search_web", "联网搜索公开网页。仅用于需要最新外部信息的问题。", {
      query: stringProperty("联网搜索关键词"), limit: numberProperty("最多返回条数"),
    }, ["query"]));
  }
  return tools;
}

export async function executeAssistantTool(name, args = {}, context = {}) {
  context.toolNames.push(name);
  let result;
  switch (name) {
    case "get_system_overview": result = getSystemOverview(context); break;
    case "search_papers": result = searchPapers(args, context); break;
    case "get_paper": result = getPaper(args, context); break;
    case "search_question_bank": result = searchQuestionBank(args, context); break;
    case "get_question": result = getQuestion(args, context); break;
    case "list_question_categories": result = listCategories(context); break;
    case "search_materials": result = searchMaterialRecords(args, context); break;
    case "get_material": result = await getMaterial(args, context); break;
    case "get_authoring_workspace": result = getAuthoringWorkspace(args, context); break;
    case "list_public_users": result = listPublicUsers(args, context); break;
    case "search_audit_log": result = searchAuditLog(args, context); break;
    default: throw badRequest(`不支持的助手工具：${name}`);
  }
  addSources(context, result.sources);
  return prepareAssistantToolResult({ data: result.data, sources: result.sources || [] });
}

export async function executeExternalWebSearch(args = {}, context = {}, signal) {
  const endpoint = String(process.env.SMARTQ_WEB_SEARCH_ENDPOINT || "").trim();
  if (!endpoint) throw badRequest("联网搜索服务尚未配置");
  const query = String(args.query || "").trim().slice(0, 500);
  if (!query) throw badRequest("请输入联网搜索关键词");
  const limit = clampLimit(args.limit, 5);
  context.toolNames.push("search_web");
  context.webUsed = true;
  const headers = { "content-type": "application/json" };
  const apiKey = String(process.env.SMARTQ_WEB_SEARCH_API_KEY || "").trim();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, maxResults: limit }),
    signal,
  });
  if (!response.ok) throw serviceError(`联网搜索失败：${response.status}`);
  const payload = await response.json();
  const rows = normalizeWebResults(payload).slice(0, limit);
  const sources = rows.map((item, index) => ({
    key: `web:${item.url}`,
    type: "web",
    entityType: "web",
    id: item.url,
    title: item.title || `网页来源 ${index + 1}`,
    subtitle: item.url,
    url: item.url,
  }));
  addSources(context, sources);
  return { data: { query, results: rows }, sources };
}

function getSystemOverview(context) {
  const { state, dataActor } = context;
  const papers = accessibleResources(state.papers, dataActor);
  const questions = accessibleResources(state.questionBank, dataActor);
  const materials = accessibleResources(state.sourceMaterials, dataActor);
  const categories = accessibleResources(state.questionBankCategories, dataActor);
  return {
    data: {
      scope: context.scope,
      exam: { title: state.exam?.title || "", subject: state.exam?.subject || "" },
      papers: { total: papers.length, published: papers.filter((item) => item.status === "已发布").length, drafts: papers.filter((item) => item.status !== "已发布").length },
      questionBank: { total: questions.length, archived: questions.filter((item) => item.status === "已归档").length },
      categories: categories.length,
      materials: { total: materials.length, ready: materials.filter((item) => item.status === "ready").length, archived: materials.filter((item) => item.status === "archived").length },
    },
    sources: [internalSource("system", "overview", "SmartQ 系统数据概览")],
  };
}

function searchPapers(args, context) {
  const keyword = String(args.query || "").trim().toLowerCase();
  const status = String(args.status || "").trim();
  const ownerUserId = allowedOwnerFilter(args.ownerUserId, context);
  const rows = accessibleResources(context.state.papers, context.dataActor)
    .filter((item) => !ownerUserId || resourceOwnerUserId(item) === ownerUserId)
    .filter((item) => !status || item.status === status)
    .filter((item) => !keyword || [item.id, item.name, item.status, item.createdBy].join(" ").toLowerCase().includes(keyword))
    .sort((a, b) => new Date(b.updatedAt || b.publishedAt || 0) - new Date(a.updatedAt || a.publishedAt || 0))
    .slice(0, clampLimit(args.limit))
    .map((item) => decorateOwnedResource(context.state, {
      id: item.id, name: item.name, status: item.status, questionCount: Number(item.questionCount || item.questions?.length || 0), score: Number(item.score || 0), createdAt: item.createdAt, updatedAt: item.updatedAt, publishedAt: item.publishedAt, ownerUserId: item.ownerUserId, createdByUserId: item.createdByUserId, updatedByUserId: item.updatedByUserId,
    }));
  return { data: { items: rows, total: rows.length }, sources: rows.map((item) => internalSource("paper", item.id, item.name, item.status)) };
}

function getPaper(args, context) {
  const item = accessibleResources(context.state.papers, context.dataActor).find((paper) => paper.id === String(args.id || ""));
  if (!item) return { data: null, sources: [] };
  const workspace = normalizeAuthoringWorkspace(context.state.authoringWorkspaces?.[resourceOwnerUserId(item)] || {});
  const detail = decorateOwnedResource(context.state, paperSnapshotDetail(item, workspace.questions));
  return {
    data: {
      ...detail,
      questions: (detail.questions || []).slice(0, 60),
      publishedVersions: (detail.publishedVersions || []).map((version) => ({ name: version.name, status: version.status, questionCount: version.questionCount, score: version.score, publishedAt: version.publishedAt })),
    },
    sources: [internalSource("paper", item.id, item.name, item.status)],
  };
}

function searchQuestionBank(args, context) {
  const ownerUserId = allowedOwnerFilter(args.ownerUserId, context);
  const result = listQuestionBank(context.state, {
    search: args.query, type: args.type, difficulty: args.difficulty, categoryId: args.categoryId || "all", ownerUserId, page: 1, pageSize: clampLimit(args.limit),
  }, context.dataActor);
  return { data: result, sources: result.items.map((item) => internalSource("question", item.id, truncate(item.stem, 80), `${item.type} · ${item.difficulty}`)) };
}

function getQuestion(args, context) {
  const item = getQuestionBankDetail(context.state, String(args.id || ""), context.dataActor);
  return { data: item, sources: item ? [internalSource("question", item.id, truncate(item.stem, 80), item.type)] : [] };
}

function listCategories(context) {
  const result = listQuestionBankCategories(context.state, context.dataActor);
  const items = result.items.map((item) => ({ id: item.id, name: item.name, path: item.path, status: item.status, depth: item.depth, isLeaf: item.isLeaf, directCount: item.directCount, count: item.count, typeCounts: item.typeCounts, ownerUserId: item.ownerUserId, creator: item.creator }));
  return { data: { ...result, items, tree: undefined }, sources: items.slice(0, 40).map((item) => internalSource("category", item.id, item.path.map((part) => part.name).join(" / ") || item.name, `${item.count} 道题`)) };
}

function searchMaterialRecords(args, context) {
  const ownerUserId = allowedOwnerFilter(args.ownerUserId, context);
  const result = listMaterials(context.state, { search: args.query, status: args.status, ownerUserId, page: 1, pageSize: clampLimit(args.limit) }, context.dataActor);
  return { data: result, sources: result.items.map((item) => internalSource("material", item.id, item.name, `${item.textLength} 字`)) };
}

async function getMaterial(args, context) {
  const item = await getMaterialDetail(context.state, String(args.id || ""), context.dataActor);
  if (!item) return { data: null, sources: [] };
  const excerpts = materialExcerpts(item.content, args.query);
  const data = { ...item, content: undefined, excerpts };
  return { data, sources: [internalSource("material", item.id, item.name, `v${item.version}`)] };
}

function getAuthoringWorkspace(args, context) {
  let ownerUserId = String(args.ownerUserId || context.actor.userId || "");
  if (context.scope !== "all" || !isSuperAdmin(context.actor)) ownerUserId = context.actor.userId;
  const user = publicUserSummary(context.state, ownerUserId);
  if (!user) return { data: null, sources: [] };
  const workspace = normalizeAuthoringWorkspace(context.state.authoringWorkspaces?.[ownerUserId] || {});
  return {
    data: { owner: user, paper: workspace.paper, questions: workspace.questions.slice(0, 60), generationTask: workspace.generationTask },
    sources: [internalSource("workspace", ownerUserId, `${user.displayName} 的命题工作区`, `${workspace.questions.length} 道题`)],
  };
}

function listPublicUsers(args, context) {
  requireSuperAdmin(context, false);
  const keyword = String(args.query || "").trim().toLowerCase();
  const items = (context.state.adminUsers || [])
    .map((item) => publicUserSummary(context.state, item.id))
    .filter(Boolean)
    .filter((item) => !keyword || [item.username, item.displayName, item.role].join(" ").toLowerCase().includes(keyword))
    .slice(0, clampLimit(args.limit));
  return { data: { items, total: items.length }, sources: items.map((item) => internalSource("user", item.id, item.displayName, item.username)) };
}

function searchAuditLog(args, context) {
  requireSuperAdmin(context, true);
  const keyword = String(args.query || "").trim().toLowerCase();
  const items = (context.state.auditLog || [])
    .filter((item) => !keyword || [item.type, item.message, item.actor, item.ownerUserId].join(" ").toLowerCase().includes(keyword))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, clampLimit(args.limit))
    .map((item) => ({ id: item.id, type: item.type, message: item.message, actor: item.actor || "", ownerUserId: item.ownerUserId || "", paperId: item.paperId || "", materialId: item.materialId || "", questionId: item.questionId || "", categoryId: item.categoryId || "", createdAt: item.createdAt }));
  return { data: { items, total: items.length }, sources: [internalSource("audit", "recent", "SmartQ 审计记录", `${items.length} 条`)] };
}

function tool(name, description, properties, required = []) {
  return { type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false } };
}

function stringProperty(description) { return { type: "string", description }; }
function numberProperty(description) { return { type: "number", description }; }

function allowedOwnerFilter(value, context) {
  return context.scope === "all" && isSuperAdmin(context.actor) ? String(value || "") : "";
}

function requireSuperAdmin(context, requireAllScope) {
  if (!isSuperAdmin(context.actor) || (requireAllScope && context.scope !== "all")) throw forbidden();
}

function materialExcerpts(content, query) {
  const text = String(content || "").trim();
  if (!text) return [];
  const chunks = text.match(/[\s\S]{1,1200}/g) || [];
  const terms = String(query || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((item) => item.length > 1).slice(0, 12);
  return chunks.map((chunk, index) => ({
    index,
    text: chunk,
    score: terms.reduce((score, term) => score + (chunk.toLowerCase().includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5).map(({ index, text }) => ({ chunkId: `chunk-${index + 1}`, text }));
}

function normalizeWebResults(payload) {
  const rows = Array.isArray(payload) ? payload : payload.results || payload.data || payload.items || [];
  return (Array.isArray(rows) ? rows : []).map((item) => ({
    title: String(item?.title || item?.name || "").slice(0, 300),
    url: String(item?.url || item?.link || "").slice(0, 2000),
    snippet: String(item?.snippet || item?.content || item?.description || "").slice(0, 2000),
    publishedAt: item?.publishedAt || item?.published_at || item?.date || null,
  })).filter((item) => /^https?:\/\//i.test(item.url));
}

function internalSource(entityType, id, title, subtitle = "") {
  return { key: `internal:${entityType}:${id}`, type: "internal", entityType, id: String(id || ""), title: String(title || id || "系统数据"), subtitle: String(subtitle || "") };
}

function addSources(context, sources = []) {
  const existing = new Set(context.sources.map((item) => item.key));
  for (const source of sources || []) {
    if (!source?.key || existing.has(source.key)) continue;
    context.sources.push(source);
    existing.add(source.key);
  }
}

function prepareAssistantToolResult(result) {
  const sanitized = sanitizeAssistantValue(result);
  if (serializedBytes(sanitized) <= maxAssistantToolResultBytes) return sanitized;

  for (const profile of [
    { maxStringLength: 2_000, maxArrayLength: 20 },
    { maxStringLength: 1_000, maxArrayLength: 10 },
    { maxStringLength: 500, maxArrayLength: 5 },
  ]) {
    const compacted = {
      ...compactAssistantValue(sanitized, profile),
      truncated: true,
      notice: truncatedToolResultNotice,
    };
    if (serializedBytes(compacted) <= maxAssistantToolResultBytes) return compacted;
  }

  return {
    data: compactAssistantValue(sanitized?.data, { maxStringLength: 240, maxArrayLength: 3 }),
    sources: compactAssistantValue(sanitized?.sources, { maxStringLength: 240, maxArrayLength: 3 }),
    truncated: true,
    notice: truncatedToolResultNotice,
  };
}

function sanitizeAssistantValue(value, key = "", depth = 0) {
  if (isSensitiveAssistantField(key)) return undefined;
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (isBinaryString(value)) return omittedBinaryValue;
    return truncate(value, maxAssistantStringLength);
  }
  if (depth >= 12) return "[内容层级过深，已省略]";
  if (Array.isArray(value)) {
    return value.slice(0, maxAssistantArrayLength).map((item) => sanitizeAssistantValue(item, "", depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value).flatMap(([childKey, childValue]) => {
    const sanitized = sanitizeAssistantValue(childValue, childKey, depth + 1);
    return sanitized === undefined ? [] : [[childKey, sanitized]];
  }));
}

function compactAssistantValue(value, options, depth = 0) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncate(value, options.maxStringLength);
  if (depth >= 10) return "[内容层级过深，已省略]";
  if (Array.isArray(value)) return value.slice(0, options.maxArrayLength).map((item) => compactAssistantValue(item, options, depth + 1));
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, compactAssistantValue(childValue, options, depth + 1)]));
}

function isSensitiveAssistantField(key) {
  const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return false;
  return sensitiveAssistantFields.has(normalized)
    || normalized.endsWith("password")
    || normalized.endsWith("token")
    || normalized.endsWith("secret")
    || normalized.endsWith("apikey");
}

function isBinaryString(value) {
  if (/^data:[^;,\s]+;base64,/i.test(value)) return true;
  return value.length > 4_096 && /^[a-z0-9+/=\r\n]+$/i.test(value);
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function clampLimit(value, fallback = defaultLimit) {
  const number = Number(value || fallback);
  return Math.max(1, Math.min(maxLimit, Number.isFinite(number) ? Math.round(number) : fallback));
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function badRequest(message) { const error = new Error(message); error.statusCode = 400; return error; }
function forbidden() { const error = new Error("当前账号无权查询该数据"); error.statusCode = 403; return error; }
function serviceError(message) { const error = new Error(message); error.statusCode = 502; return error; }
