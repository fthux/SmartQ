import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exam } from "../data/store.js";
import { normalizeQuestionBankRecord } from "./question-utils.js";
import { normalizeCategoryIds, normalizeQuestionBankCategory } from "./question-bank-categories.js";
import { initializeAdminUsers } from "../services/admin-user-service.js";
import {
  emptyAuthoringPaper,
  initializeAuthoringWorkspaces,
  normalizeAuthoringWorkspaces,
} from "../services/authoring-workspace-service.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = process.env.SMARTQ_DATA_FILE || join(root, "data", "runtime.json");
const backupDir = process.env.SMARTQ_BACKUP_DIR || join(dirname(dataFile), "backups");
const backupRetention = Math.max(1, Math.min(200, Number(process.env.SMARTQ_BACKUP_RETENTION || 20)));
const backupMinIntervalMs = Math.max(0, Math.min(3600, Number(process.env.SMARTQ_BACKUP_MIN_INTERVAL_SECONDS || 60))) * 1000;
const storageStatus = resolveStorageStatus();
const postgresStore = storageStatus.requestedAdapter === "postgres" ? createPostgresStore() : null;
const legacySeedAuditPattern = /MVP|初始数据|题库初始化内容/;
const legacySeedQuestionIdPattern = /^q-\d{3}$/;
const retiredRuntimeKeys = ["sessions", "candidates", "participants", "groups", "answers", "gradingResults", "proctorRules"];
const retiredAuditTypePattern = /^(?:assignment|candidate|participant|group|proctor|exam|grading)(?:-|$)|^answer-save$/;

let state = null;
let writeQueue = Promise.resolve();
let lastBackupAt = 0;
let normalizedStateNeedsSave = false;

export async function loadState() {
  if (state) return state;

  if (postgresStore) {
    const loaded = await postgresStore.load().catch(() => null);
    if (loaded) {
      state = normalizeState(loaded);
      if (await initializeAdminUsers(state)) normalizedStateNeedsSave = true;
      if (initializeAuthoringWorkspaces(state)) normalizedStateNeedsSave = true;
      if (consumeNormalizedStateNeedsSave()) {
        await saveState({ forceBackup: true, reason: "normalize-runtime" });
      }
      return state;
    }
  }

  try {
    const raw = await readFile(dataFile, "utf8");
    state = normalizeState(JSON.parse(raw));
    if (await initializeAdminUsers(state)) normalizedStateNeedsSave = true;
    if (initializeAuthoringWorkspaces(state)) normalizedStateNeedsSave = true;
    if (consumeNormalizedStateNeedsSave()) {
      await saveState({ forceBackup: true, reason: "normalize-runtime" });
    }
  } catch {
    state = normalizeState(defaultState());
    await initializeAdminUsers(state);
    initializeAuthoringWorkspaces(state);
    consumeNormalizedStateNeedsSave();
    await saveState();
  }

  return state;
}

export async function saveState(options = {}) {
  if (!state) return;
  await mkdir(dirname(dataFile), { recursive: true });
  await createLocalBackup(options.reason || "auto-save", options);
  if (postgresStore) {
    const saved = await postgresStore.save(state).catch(() => false);
    if (saved) {
      await writeLocalStateMirror();
      return;
    }
  }
  await writeLocalStateMirror();
}

export async function updateState(mutator) {
  const operation = writeQueue.then(async () => {
    const current = await loadState();
    const result = await mutator(current);
    const saveOptions = result && typeof result === "object" && result.__saveOptions ? result.__saveOptions : {};
    if (saveOptions && result && typeof result === "object") delete result.__saveOptions;
    await saveState(saveOptions);
    return result ?? current;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export async function storageInfo() {
  let stats = null;
  try {
    stats = await stat(dataFile);
  } catch { }
  const backups = await listLocalBackups();
  const postgres = postgresStore ? await postgresStore.info().catch((error) => ({
    reachable: false,
    error: error.message || "PostgreSQL unavailable",
  })) : null;
  const effectiveAdapter = postgresStore ? (postgres?.reachable ? "postgres" : "json-file") : storageStatus.effectiveAdapter;
  const degraded = storageStatus.requestedAdapter === "postgres" ? effectiveAdapter !== "postgres" : storageStatus.degraded;
  const reason = degraded
    ? (postgres?.error || storageStatus.reason || "PostgreSQL storage is unavailable; using JSON file runtime store.")
    : "";
  return {
    adapter: effectiveAdapter,
    requestedAdapter: storageStatus.requestedAdapter,
    effectiveAdapter,
    degraded,
    status: {
      ...storageStatus,
      effectiveAdapter,
      degraded,
      reason,
      postgresReachable: Boolean(postgres?.reachable),
      postgresUpdatedAt: postgres?.updatedAt || null,
      postgresSizeBytes: postgres?.sizeBytes || 0,
      postgresError: postgres?.error || "",
    },
    dataFile,
    backupDir,
    exists: Boolean(stats),
    sizeBytes: stats?.size || 0,
    updatedAt: stats?.mtime?.toISOString?.() || null,
    backupCount: backups.length,
    latestBackupAt: backups[0]?.createdAt || null,
    backupRetention,
    backupMinIntervalSeconds: Math.round(backupMinIntervalMs / 1000),
  };
}

export function getStateSync() {
  if (!state) {
    state = normalizeState(defaultState());
  }
  return state;
}

function resolveStorageStatus() {
  const databaseUrl = String(process.env.SMARTQ_DATABASE_URL || "").trim();
  const configuredAdapter = String(process.env.SMARTQ_STORAGE_ADAPTER || "").trim().toLowerCase();
  const requestedAdapter = configuredAdapter || (databaseUrl ? "postgres" : "json-file");
  if (requestedAdapter === "postgres" || requestedAdapter === "postgresql" || databaseUrl) {
    const configured = Boolean(parsePostgresUrl(databaseUrl));
    return {
      requestedAdapter: "postgres",
      effectiveAdapter: configured ? "postgres" : "json-file",
      degraded: !configured,
      reason: configured ? "" : "PostgreSQL storage adapter requested but SMARTQ_DATABASE_URL is invalid; using JSON file runtime store.",
      databaseConfigured: Boolean(databaseUrl),
    };
  }
  if (requestedAdapter !== "json-file") {
    return {
      requestedAdapter,
      effectiveAdapter: "json-file",
      degraded: true,
      reason: `Unsupported storage adapter "${requestedAdapter}"; using JSON file runtime store.`,
      databaseConfigured: Boolean(databaseUrl),
    };
  }
  return {
    requestedAdapter: "json-file",
    effectiveAdapter: "json-file",
    degraded: false,
    reason: "",
    databaseConfigured: false,
  };
}

async function createLocalBackup(reason = "auto", options = {}) {
  if (!options.forceBackup && backupMinIntervalMs > 0 && Date.now() - lastBackupAt < backupMinIntervalMs) return null;
  let raw = "";
  try {
    raw = await readFile(dataFile, "utf8");
  } catch {
    return null;
  }
  await mkdir(backupDir, { recursive: true });
  const createdAt = new Date();
  const name = `runtime-${createdAt.toISOString().replaceAll(":", "").replaceAll(".", "")}-${reason}.json`;
  await writeFile(join(backupDir, name), raw);
  lastBackupAt = Date.now();
  await pruneLocalBackups();
  return name;
}

async function writeLocalStateMirror() {
  const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpFile, JSON.stringify(state, null, 2));
  await rename(tmpFile, dataFile);
}

async function listLocalBackups() {
  let names = [];
  try {
    names = await readdir(backupDir);
  } catch {
    return [];
  }
  const rows = await Promise.all(
    names
      .filter((name) => /^runtime-.+\.json$/.test(name))
      .map(async (name) => {
        try {
          const stats = await stat(join(backupDir, name));
          return {
            name,
            sizeBytes: stats.size || 0,
            createdAt: stats.mtime?.toISOString?.() || null,
          };
        } catch {
          return null;
        }
      }),
  );
  return rows.filter(Boolean).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function pruneLocalBackups() {
  const backups = await listLocalBackups();
  await Promise.all(
    backups.slice(backupRetention).map((item) => unlink(join(backupDir, item.name)).catch(() => {})),
  );
}

function createPostgresStore() {
  const config = parsePostgresUrl(process.env.SMARTQ_DATABASE_URL);
  if (!config) return null;
  const table = safeSqlIdentifier(process.env.SMARTQ_POSTGRES_TABLE || "smartq_runtime");
  const key = String(process.env.SMARTQ_POSTGRES_KEY || "default").replace(/'/g, "''");
  return {
    async load() {
      await ensurePostgresTable(config, table);
      const rows = await postgresQuery(config, `SELECT state FROM ${table} WHERE id='${key}' LIMIT 1`);
      const raw = rows[0]?.state;
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    },
    async save(nextState) {
      await ensurePostgresTable(config, table);
      const json = JSON.stringify(nextState).replace(/'/g, "''");
      await postgresQuery(config, `INSERT INTO ${table} (id, state, updated_at) VALUES ('${key}', '${json}'::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, updated_at=NOW()`);
      return true;
    },
    async info() {
      await ensurePostgresTable(config, table);
      const rows = await postgresQuery(config, `SELECT updated_at, octet_length(state::text) AS size_bytes FROM ${table} WHERE id='${key}' LIMIT 1`);
      return {
        reachable: true,
        updatedAt: rows[0]?.updated_at || null,
        sizeBytes: Number(rows[0]?.size_bytes || 0),
      };
    },
  };
}

async function ensurePostgresTable(config, table) {
  await postgresQuery(config, `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

function parsePostgresUrl(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return null;
    return {
      host: url.hostname || "127.0.0.1",
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres"),
      user: decodeURIComponent(url.username || "postgres"),
      password: decodeURIComponent(url.password || ""),
      ssl: ["1", "true", "require"].includes(String(url.searchParams.get("sslmode") || process.env.SMARTQ_POSTGRES_SSL || "").toLowerCase()),
      timeoutMs: Math.max(500, Math.min(10000, Number(process.env.SMARTQ_POSTGRES_TIMEOUT_MS || 3000))),
    };
  } catch {
    return null;
  }
}

function safeSqlIdentifier(value = "") {
  const name = String(value || "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "") || "smartq_runtime";
  return name.slice(0, 63);
}

function postgresQuery(config, sql) {
  return new Promise((resolve, reject) => {
    const socket = (config.ssl ? tls.connect : net.connect)({ host: config.host, port: config.port });
    const state = { buffer: Buffer.alloc(0), rows: [], columns: [], ready: false, authenticated: false };
    const timer = setTimeout(() => {
      socket.destroy(new Error("PostgreSQL query timed out"));
    }, config.timeoutMs);
    socket.on("connect", () => {
      socket.write(encodePostgresStartup(config));
    });
    socket.on("data", (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      try {
        processPostgresMessages(socket, state, config, sql, resolve, reject);
      } catch (error) {
        reject(error);
        socket.destroy();
      }
    });
    socket.on("error", reject);
    socket.on("close", () => clearTimeout(timer));
  });
}

function processPostgresMessages(socket, state, config, sql, resolve, reject) {
  while (state.buffer.length >= 5) {
    const type = String.fromCharCode(state.buffer[0]);
    const length = state.buffer.readInt32BE(1);
    if (state.buffer.length < 1 + length) return;
    const payload = state.buffer.slice(5, 1 + length);
    state.buffer = state.buffer.slice(1 + length);
    if (type === "R") handlePostgresAuth(socket, payload, config);
    else if (type === "S" || type === "K" || type === "n") continue;
    else if (type === "Z") {
      if (!state.authenticated) {
        state.authenticated = true;
        socket.write(encodePostgresQuery(sql));
      } else {
        socket.end();
        resolve(state.rows);
      }
    } else if (type === "T") state.columns = parsePostgresColumns(payload);
    else if (type === "D") state.rows.push(parsePostgresRow(payload, state.columns));
    else if (type === "C") continue;
    else if (type === "E") {
      reject(new Error(parsePostgresError(payload)));
      socket.destroy();
    }
  }
}

function handlePostgresAuth(socket, payload, config) {
  const code = payload.readInt32BE(0);
  if (code === 0) return;
  if (code === 3) {
    socket.write(encodePostgresPassword(config.password));
    return;
  }
  if (code === 5) {
    socket.write(encodePostgresPassword(md5PostgresPassword(config.password, config.user, payload.slice(4, 8))));
    return;
  }
  throw new Error(`Unsupported PostgreSQL auth method ${code}`);
}

function encodePostgresStartup(config) {
  const params = [
    "user", config.user,
    "database", config.database,
    "client_encoding", "UTF8",
  ];
  const body = Buffer.concat([
    int32(196608),
    ...params.map((item) => cstring(item)),
    Buffer.from([0]),
  ]);
  return Buffer.concat([int32(body.length + 4), body]);
}

function encodePostgresPassword(password = "") {
  const body = cstring(password);
  return Buffer.concat([Buffer.from("p"), int32(body.length + 4), body]);
}

function md5PostgresPassword(password = "", user = "", salt = Buffer.alloc(0)) {
  return `md5${md5Hex(Buffer.concat([Buffer.from(md5Hex(`${password}${user}`)), salt]))}`;
}

function md5Hex(value) {
  return createHash("md5").update(value).digest("hex");
}

function encodePostgresQuery(sql) {
  const body = cstring(sql);
  return Buffer.concat([Buffer.from("Q"), int32(body.length + 4), body]);
}

function parsePostgresColumns(payload) {
  const count = payload.readInt16BE(0);
  let offset = 2;
  const columns = [];
  for (let index = 0; index < count; index += 1) {
    const end = payload.indexOf(0, offset);
    columns.push(payload.slice(offset, end).toString());
    offset = end + 19;
  }
  return columns;
}

function parsePostgresRow(payload, columns = []) {
  const count = payload.readInt16BE(0);
  let offset = 2;
  const row = {};
  for (let index = 0; index < count; index += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    const value = length < 0 ? null : payload.slice(offset, offset + length).toString();
    if (length > 0) offset += length;
    row[columns[index] || `col${index}`] = value;
  }
  return row;
}

function parsePostgresError(payload) {
  const parts = [];
  let offset = 0;
  while (offset < payload.length && payload[offset] !== 0) {
    const type = String.fromCharCode(payload[offset]);
    const end = payload.indexOf(0, offset + 1);
    const value = payload.slice(offset + 1, end).toString();
    if (type === "M" || type === "C") parts.push(value);
    offset = end + 1;
  }
  return parts.join(" ") || "PostgreSQL error";
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function cstring(value = "") {
  return Buffer.from(`${String(value)}\0`);
}

function defaultState() {
  return {
    exam,
    questions: [],
    paper: emptyAuthoringPaper(),
    authoringWorkspaces: {},
    papers: [],
    questionBank: [],
    questionBankCategories: [],
    sourceMaterials: [],
    generationTask: null,
    adminSessions: {},
    adminUsers: [],
    loginSecurity: defaultLoginSecurity(),
    auditLog: [
      {
        id: "log-init",
        type: "system",
        message: "系统运行时数据已初始化",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

function normalizeState(input) {
  const normalizedPaper = {
    id: input.paper?.id || null,
    name: input.paper?.name || "",
    status: ["已组卷", "已保存"].includes(input.paper?.status) ? "未发布" : input.paper?.status || null,
    publishedAt: input.paper?.publishedAt || null,
    questionIds: Array.isArray(input.paper?.questionIds) ? input.paper.questionIds : [],
    buildSpec: input.paper?.buildSpec || null,
    sourcePlanSnapshot: input.paper?.sourcePlanSnapshot || input.paper?.buildSpec?.sourcePlanSnapshot || null,
    generationSpecSnapshot: stripPaperCategory(input.paper?.generationSpecSnapshot),
  };
  const hasRetiredRuntimeData = retiredRuntimeKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
  const hasPendingQuestionBankItems = Array.isArray(input.questionBank) && input.questionBank.some((item) => item?.status === "待确认");
  const sourceAuditLog = Array.isArray(input.auditLog) ? input.auditLog : [];
  const auditLog = sourceAuditLog.filter((item) => !retiredAuditTypePattern.test(String(item?.type || "")));
  const normalized = {
    exam: input.exam || exam,
    questions: Array.isArray(input.questions) ? input.questions : [],
    paper: normalizedPaper,
    authoringWorkspaces: normalizeAuthoringWorkspaces(input.authoringWorkspaces),
    papers: Array.isArray(input.papers) ? input.papers.map(normalizePaperSnapshot).filter(Boolean) : [],
    questionBank: Array.isArray(input.questionBank) ? input.questionBank.map(normalizeQuestionBankRecord).filter(Boolean) : [],
    questionBankCategories: Array.isArray(input.questionBankCategories) ? input.questionBankCategories.map(normalizeQuestionBankCategory).filter(Boolean) : [],
    sourceMaterials: Array.isArray(input.sourceMaterials) ? input.sourceMaterials.map(normalizeSourceMaterial).filter(Boolean) : [],
    generationTask: input.generationTask || null,
    adminSessions: input.adminSessions && typeof input.adminSessions === "object" ? input.adminSessions : {},
    adminUsers: Array.isArray(input.adminUsers) ? input.adminUsers : [],
    ...(input.adminProfiles && typeof input.adminProfiles === "object" ? { adminProfiles: normalizeAdminProfiles(input.adminProfiles) } : {}),
    loginSecurity: normalizeLoginSecurity(input.loginSecurity),
    auditLog,
  };
  const knownCategoryIds = new Set(normalized.questionBankCategories.map((item) => item.id));
  normalized.questionBank.forEach((item) => {
    item.categoryIds = normalizeCategoryIds(item.categoryIds).filter((id) => knownCategoryIds.has(id));
  });
  const hasPaperCategories = Boolean(
    input.paper?.categoryId || input.paper?.categorySnapshot || input.generationTask?.categoryId
      || (input.papers || []).some((item) => item?.categoryId || item?.categorySnapshot || item?.generationSpecSnapshot?.categoryId)
      || Object.values(input.authoringWorkspaces || {}).some((workspace) => workspace?.paper?.categoryId || workspace?.paper?.categorySnapshot || workspace?.generationTask?.categoryId),
  );
  if (hasRetiredRuntimeData || hasPendingQuestionBankItems || hasPaperCategories || auditLog.length !== sourceAuditLog.length) normalizedStateNeedsSave = true;
  normalized.generationTask = stripPaperCategory(normalized.generationTask);
  Object.values(normalized.authoringWorkspaces || {}).forEach((workspace) => {
    workspace.generationTask = stripPaperCategory(workspace.generationTask);
  });
  return stripLegacyQuestionSeed(normalized);
}

function normalizeSourceMaterial(item) {
  if (!item || typeof item !== "object" || !item.id) return null;
  return {
    id: String(item.id),
    name: String(item.name || "未命名资料"),
    description: String(item.description || ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
    status: ["ready", "failed", "archived"].includes(item.status) ? item.status : "failed",
    sourceType: item.sourceType === "file" ? "file" : "text",
    filename: String(item.filename || ""),
    mimeType: String(item.mimeType || ""),
    version: Math.max(1, Number(item.version || 1)),
    contentHash: String(item.contentHash || ""),
    textLength: Math.max(0, Number(item.textLength || 0)),
    parseError: String(item.parseError || ""),
    revisions: Array.isArray(item.revisions) ? item.revisions : [],
    createdBy: String(item.createdBy || ""),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
  };
}

function defaultLoginSecurity() {
  return {
    attempts: {},
  };
}

function normalizeLoginSecurity(input = {}) {
  return {
    attempts: input?.attempts && typeof input.attempts === "object" ? input.attempts : {},
  };
}

function normalizeAdminProfiles(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).map(([username, profile]) => [username, {
    displayName: String(profile?.displayName || username).trim().slice(0, 32),
    avatar: String(profile?.avatar || ""),
    updatedAt: profile?.updatedAt || null,
  }]));
}

function stripLegacyQuestionSeed(normalized) {
  const stripQuestions = isOnlyLegacySeedQuestionBank(normalized) && !hasConfiguredPaper(normalized);
  if (!stripQuestions) return normalized;
  const next = { ...normalized };
  next.questions = [];
  next.generationTask = null;
  next.auditLog = [
    ...normalized.auditLog,
    {
      id: `log-strip-demo-${Date.now()}`,
      type: "system",
      message: "已移除题库历史初始化数据",
      createdAt: new Date().toISOString(),
    },
  ];
  normalizedStateNeedsSave = true;
  return next;
}

function consumeNormalizedStateNeedsSave() {
  const needsSave = normalizedStateNeedsSave;
  normalizedStateNeedsSave = false;
  return needsSave;
}

function isOnlyLegacySeedQuestionBank(state = {}) {
  return hasLegacySeedAudit(state) && (state.questions || []).length > 0 && state.questions.every((question) => legacySeedQuestionIdPattern.test(String(question.id || "")));
}

function hasLegacySeedAudit(state = {}) {
  return (state.auditLog || []).some((item) => legacySeedAuditPattern.test(String(item?.message || "")));
}

function hasConfiguredPaper(state = {}) {
  return Boolean(
    state.paper?.id ||
    state.paper?.status ||
    (Array.isArray(state.paper?.questionIds) && state.paper.questionIds.length) ||
    (Array.isArray(state.papers) && state.papers.length),
  );
}

function normalizePaperSnapshot(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || `paper-${Date.now()}`,
    name: item.name || "未命名试卷",
    status: ["已组卷", "已保存"].includes(item.status) ? "未发布" : item.status || "未发布",
    score: Number(item.score || 0),
    questionCount: Number(item.questionCount || 0),
    typeGroups: item.typeGroups && typeof item.typeGroups === "object" ? item.typeGroups : {},
    questionIds: Array.isArray(item.questionIds) ? item.questionIds : [],
    questions: Array.isArray(item.questions) ? item.questions : [],
    buildSpec: item.buildSpec || null,
    sourcePlanSnapshot: item.sourcePlanSnapshot || item.buildSpec?.sourcePlanSnapshot || null,
    generationSpecSnapshot: stripPaperCategory(item.generationSpecSnapshot),
    publishedAt: item.publishedAt || null,
    createdAt: item.createdAt || item.buildSpec?.builtAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.publishedAt || item.createdAt || item.buildSpec?.builtAt || new Date().toISOString(),
    publishedVersions: Array.isArray(item.publishedVersions)
      ? item.publishedVersions.map(normalizePublishedPaperVersion).filter(Boolean)
      : [],
  };
}

function normalizePublishedPaperVersion(item) {
  if (!item || typeof item !== "object" || !item.id || !item.publishedAt) return null;
  return {
    id: String(item.id),
    name: String(item.name || "未命名试卷"),
    status: "已发布",
    score: Number(item.score || 0),
    questionCount: Number(item.questionCount || 0),
    typeGroups: item.typeGroups && typeof item.typeGroups === "object" ? item.typeGroups : {},
    questionIds: Array.isArray(item.questionIds) ? item.questionIds : [],
    questions: Array.isArray(item.questions) ? item.questions : [],
    buildSpec: item.buildSpec || null,
    sourcePlanSnapshot: item.sourcePlanSnapshot || item.buildSpec?.sourcePlanSnapshot || null,
    generationSpecSnapshot: stripPaperCategory(item.generationSpecSnapshot),
    publishedAt: item.publishedAt,
    createdAt: item.createdAt || item.publishedAt,
    updatedAt: item.updatedAt || item.publishedAt,
  };
}

function stripPaperCategory(value) {
  if (!value || typeof value !== "object") return value || null;
  const { categoryId: _categoryId, categorySnapshot: _categorySnapshot, ...rest } = value;
  return rest;
}
