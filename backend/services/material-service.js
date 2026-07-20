import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { logItem } from "../lib/audit.js";
import { loadState, updateState } from "../lib/runtime-store.js";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultDataFile = join(backendRoot, "data", "runtime.json");
const materialRoot = process.env.SMARTQ_MATERIAL_DIR
  || join(dirname(process.env.SMARTQ_DATA_FILE || defaultDataFile), "materials");
export const materialFileMaxBytes = Math.max(
  64 * 1024,
  Math.min(25 * 1024 * 1024, Number(process.env.SMARTQ_MATERIAL_FILE_MAX_BYTES || 8 * 1024 * 1024)),
);
const materialTextMaxChars = Math.max(
  10_000,
  Math.min(2_000_000, Number(process.env.SMARTQ_MATERIAL_TEXT_MAX_CHARS || 400_000)),
);
const allowedExtensions = new Set([".txt", ".md", ".pdf", ".docx"]);

export function listMaterials(state, query = {}) {
  const keyword = String(query.search || query.keyword || "").trim().toLowerCase();
  const status = String(query.status || "").trim();
  const page = clampNumber(query.page, 1, 10_000, 1);
  const pageSize = clampNumber(query.pageSize, 1, 1000, 20);
  const usages = materialUsageMap(state);
  const rows = (state.sourceMaterials || [])
    .filter((item) => !status || item.status === status)
    .filter((item) => {
      if (!keyword) return true;
      return [item.name, item.description, item.filename, ...(item.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    })
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map((item) => materialSummary(item, usages.get(item.id)));
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize };
}

export async function getMaterialDetail(state, id) {
  const material = findMaterial(state, id);
  if (!material) return null;
  const usage = materialUsageMap(state).get(material.id);
  let content = "";
  if (!material.parseError && material.textLength > 0) {
    content = await readRevisionText(material).catch(() => "");
  }
  return { ...materialSummary(material, usage), revisions: material.revisions || [], content };
}

export async function createTextMaterial(body = {}, actor = "") {
  const name = cleanRequired(body.name, "请输入资料名称", 80);
  const content = normalizeMaterialText(body.content);
  if (!content) throw badRequest("请输入资料正文");
  const id = createMaterialId();
  const now = new Date().toISOString();
  const revision = await writeMaterialRevision({ id, version: 1, content, actor, now });
  return updateState((state) => {
    const material = {
      id,
      name,
      description: cleanText(body.description, 300),
      tags: normalizeTags(body.tags),
      status: "ready",
      sourceType: "text",
      filename: "",
      mimeType: "text/plain",
      version: 1,
      contentHash: revision.contentHash,
      textLength: revision.textLength,
      parseError: "",
      revisions: [revision],
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    state.sourceMaterials.unshift(material);
    state.auditLog.push(logItem("material-create", `新建出题资料：${material.name}`));
    return materialSummary(material);
  });
}

export async function createFileMaterial(fields = {}, file = {}, actor = "") {
  const extension = extname(file.filename || "").toLowerCase();
  if (!allowedExtensions.has(extension)) throw badRequest("仅支持 TXT、MD、PDF 和 DOCX 文件");
  const name = cleanRequired(fields.name || basename(file.filename, extension), "请输入资料名称", 80);
  const id = createMaterialId();
  const now = new Date().toISOString();
  const version = 1;
  let content = "";
  let parseError = "";
  try {
    content = await extractMaterialText(file.buffer, extension);
  } catch (error) {
    parseError = error.message || "资料解析失败";
  }
  const revision = await writeMaterialRevision({
    id,
    version,
    content,
    actor,
    now,
    filename: file.filename,
    mimeType: file.mimeType,
    sourceBuffer: file.buffer,
  });
  return updateState((state) => {
    const material = {
      id,
      name,
      description: cleanText(fields.description, 300),
      tags: normalizeTags(fields.tags),
      status: parseError ? "failed" : "ready",
      sourceType: "file",
      filename: sanitizeFilename(file.filename),
      mimeType: file.mimeType || mimeTypeForExtension(extension),
      version,
      contentHash: revision.contentHash,
      textLength: revision.textLength,
      parseError,
      revisions: [revision],
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    state.sourceMaterials.unshift(material);
    state.auditLog.push(logItem(parseError ? "material-parse-failed" : "material-upload", `${parseError ? "资料解析失败" : "上传出题资料"}：${material.name}`));
    return materialSummary(material);
  });
}

export async function updateMaterial(id, body = {}, actor = "") {
  const currentState = await loadState();
  const current = findMaterial(currentState, id);
  if (!current) return null;

  let revision = null;
  const hasContent = Object.prototype.hasOwnProperty.call(body, "content");
  if (hasContent) {
    const content = normalizeMaterialText(body.content);
    if (!content) throw badRequest("请输入资料正文");
    const existing = await readRevisionText(current).catch(() => "");
    if (content !== existing) {
      const now = new Date().toISOString();
      revision = await writeMaterialRevision({ id, version: Number(current.version || 0) + 1, content, actor, now });
    }
  }

  return updateState((state) => {
    const material = findMaterial(state, id);
    if (!material) return null;
    if (body.name !== undefined) material.name = cleanRequired(body.name, "请输入资料名称", 80);
    if (body.description !== undefined) material.description = cleanText(body.description, 300);
    if (body.tags !== undefined) material.tags = normalizeTags(body.tags);
    if (revision) {
      material.sourceType = "text";
      material.filename = "";
      material.mimeType = "text/plain";
      material.version = revision.version;
      material.contentHash = revision.contentHash;
      material.textLength = revision.textLength;
      material.status = "ready";
      material.parseError = "";
      material.revisions = [...(material.revisions || []), revision];
    }
    material.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem("material-update", `更新出题资料：${material.name}`, { actor }));
    return materialSummary(material);
  });
}

export async function setMaterialArchived(id, archived, actor = "") {
  return updateState((state) => {
    const material = findMaterial(state, id);
    if (!material) return null;
    material.status = archived ? "archived" : (material.parseError ? "failed" : "ready");
    material.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem(archived ? "material-archive" : "material-restore", `${archived ? "归档" : "恢复"}出题资料：${material.name}`, { actor }));
    return materialSummary(material);
  });
}

export async function reparseMaterial(id, actor = "") {
  const currentState = await loadState();
  const current = findMaterial(currentState, id);
  if (!current) return null;
  if (current.sourceType !== "file") throw badRequest("纯文本资料无需重新解析");
  const revision = latestRevision(current);
  const extension = extname(revision?.filename || current.filename || "").toLowerCase();
  const source = await readFile(revisionSourcePath(current.id, revision.version, extension));
  let content = "";
  let parseError = "";
  try {
    content = await extractMaterialText(source, extension);
    await writeFile(revisionTextPath(current.id, revision.version), content, "utf8");
  } catch (error) {
    parseError = error.message || "资料解析失败";
  }
  return updateState((state) => {
    const material = findMaterial(state, id);
    if (!material) return null;
    const targetRevision = latestRevision(material);
    targetRevision.textLength = content.length;
    targetRevision.contentHash = hashContent(content || source);
    material.textLength = content.length;
    material.contentHash = targetRevision.contentHash;
    material.parseError = parseError;
    material.status = parseError ? "failed" : "ready";
    material.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem(parseError ? "material-parse-failed" : "material-reparse", `${parseError ? "资料解析失败" : "重新解析资料"}：${material.name}`, { actor }));
    return materialSummary(material);
  });
}

export function materialUsages(state, id) {
  const rows = [];
  for (const paper of state.papers || []) {
    const count = (paper.questions || []).filter((question) => questionReferencesMaterial(question, id)).length;
    if (count) rows.push({ paperId: paper.id, paperName: paper.name, status: paper.status, questionCount: count, createdAt: paper.createdAt, publishedAt: paper.publishedAt });
  }
  return rows;
}

export async function resolveGenerationMaterials(state, sourcePlan = {}, spec = {}) {
  const ids = Array.isArray(sourcePlan.materialIds) ? [...new Set(sourcePlan.materialIds.map(String))] : [];
  const materials = ids.map((id) => findMaterial(state, id)).filter(Boolean);
  if (materials.length !== ids.length) throw badRequest("部分出题资料不存在，请重新选择");
  const unavailable = materials.find((item) => item.status !== "ready");
  if (unavailable) throw badRequest(`出题资料「${unavailable.name}」当前不可用`);
  const keywords = normalizeSearchKeywords([spec.direction, ...(spec.knowledge || []), spec.requirements].join(" "));
  const maxCharsPerMaterial = Math.max(2400, Math.floor(30_000 / Math.max(1, materials.length)));
  const resolved = [];
  for (const material of materials) {
    const content = await readRevisionText(material);
    const chunks = rankMaterialChunks(chunkMaterialText(content), keywords)
      .slice(0, 5)
      .reduce((acc, item) => {
        const currentLength = acc.reduce((sum, entry) => sum + entry.text.length, 0);
        if (currentLength >= maxCharsPerMaterial) return acc;
        acc.push(item);
        return acc;
      }, []);
    resolved.push({
      id: material.id,
      name: material.name,
      version: material.version,
      textLength: material.textLength,
      chunks,
    });
  }
  return resolved;
}

function materialSummary(material, usage = {}) {
  return {
    id: material.id,
    name: material.name,
    description: material.description || "",
    tags: material.tags || [],
    status: material.status,
    sourceType: material.sourceType,
    filename: material.filename || "",
    mimeType: material.mimeType || "",
    version: Number(material.version || 1),
    textLength: Number(material.textLength || 0),
    parseError: material.parseError || "",
    revisionCount: (material.revisions || []).length,
    paperUsageCount: usage.paperUsageCount || 0,
    questionUsageCount: usage.questionUsageCount || 0,
    createdBy: material.createdBy || "",
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

function materialUsageMap(state) {
  const map = new Map();
  for (const paper of state.papers || []) {
    const ids = new Set();
    for (const question of paper.questions || []) {
      const questionMaterialIds = new Set((question.origin?.materialRefs || []).map((ref) => ref.materialId).filter(Boolean));
      for (const materialId of questionMaterialIds) {
        const usage = map.get(materialId) || { paperUsageCount: 0, questionUsageCount: 0 };
        usage.questionUsageCount += 1;
        map.set(materialId, usage);
        ids.add(materialId);
      }
    }
    for (const id of ids) {
      const usage = map.get(id) || { paperUsageCount: 0, questionUsageCount: 0 };
      usage.paperUsageCount += 1;
      map.set(id, usage);
    }
  }
  return map;
}

function questionReferencesMaterial(question, id) {
  return (question.origin?.materialRefs || []).some((ref) => ref.materialId === id);
}

function findMaterial(state, id) {
  return (state.sourceMaterials || []).find((item) => item.id === id) || null;
}

async function writeMaterialRevision({ id, version, content = "", actor = "", now, filename = "", mimeType = "", sourceBuffer = null }) {
  const directory = revisionDirectory(id, version);
  await mkdir(directory, { recursive: true });
  await writeFile(revisionTextPath(id, version), content, "utf8");
  const extension = extname(filename || "").toLowerCase();
  if (sourceBuffer) await writeFile(revisionSourcePath(id, version, extension), sourceBuffer);
  return {
    version,
    filename: sanitizeFilename(filename),
    mimeType: mimeType || (extension ? mimeTypeForExtension(extension) : "text/plain"),
    textLength: content.length,
    contentHash: hashContent(content || sourceBuffer || ""),
    createdBy: actor,
    createdAt: now,
  };
}

async function extractMaterialText(buffer, extension) {
  let text = "";
  if ([".txt", ".md"].includes(extension)) text = buffer.toString("utf8");
  else if (extension === ".docx") text = (await mammoth.extractRawText({ buffer })).value;
  else if (extension === ".pdf") text = (await pdfParse(buffer)).text;
  const normalized = normalizeMaterialText(text);
  if (!normalized) throw badRequest("资料中没有提取到可用于出题的文本");
  return normalized;
}

function normalizeMaterialText(value) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (text.length > materialTextMaxChars) throw badRequest(`资料正文最多允许 ${materialTextMaxChars} 个字符`);
  return text;
}

function chunkMaterialText(content) {
  const paragraphs = String(content || "").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > 1800) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length > 1800) {
      const segments = paragraph.match(/[\s\S]{1,1800}/g) || [];
      chunks.push(...segments.slice(0, -1));
      current = segments.at(-1) || "";
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((text, index) => ({ id: `chunk-${String(index + 1).padStart(3, "0")}`, text }));
}

function rankMaterialChunks(chunks, keywords) {
  return chunks
    .map((chunk, index) => ({
      ...chunk,
      score: keywords.reduce((sum, keyword) => sum + (chunk.text.toLowerCase().includes(keyword) ? 3 : 0), 0) + Math.max(0, 1 - index / 1000),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function normalizeSearchKeywords(value) {
  return [...new Set(String(value || "").toLowerCase().split(/[,，、\s]+/).map((item) => item.trim()).filter((item) => item.length >= 2))].slice(0, 30);
}

function latestRevision(material) {
  return (material.revisions || []).find((item) => Number(item.version) === Number(material.version)) || (material.revisions || []).at(-1);
}

function readRevisionText(material) {
  return readFile(revisionTextPath(material.id, material.version), "utf8");
}

function revisionDirectory(id, version) {
  return join(materialRoot, id, `v${Number(version)}`);
}

function revisionTextPath(id, version) {
  return join(revisionDirectory(id, version), "content.txt");
}

function revisionSourcePath(id, version, extension) {
  return join(revisionDirectory(id, version), `source${allowedExtensions.has(extension) ? extension : ".bin"}`);
}

function createMaterialId() {
  return `material-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function sanitizeFilename(value) {
  return basename(String(value || "")).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_").slice(0, 160);
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,，、\n]/);
  return [...new Set(list.map((item) => String(item).trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
}

function cleanRequired(value, message, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw badRequest(message);
  return text;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function hashContent(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mimeTypeForExtension(extension) {
  return { ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }[extension] || "application/octet-stream";
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
