import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answers, exam, questions, sessions } from "../data/store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = process.env.SMARTQ_DATA_FILE || join(root, "data", "runtime.json");
const backupDir = process.env.SMARTQ_BACKUP_DIR || join(dirname(dataFile), "backups");
const backupRetention = Math.max(1, Math.min(200, Number(process.env.SMARTQ_BACKUP_RETENTION || 20)));
const backupMinIntervalMs = Math.max(0, Math.min(3600, Number(process.env.SMARTQ_BACKUP_MIN_INTERVAL_SECONDS || 60))) * 1000;
const storageStatus = resolveStorageStatus();
const postgresStore = storageStatus.requestedAdapter === "postgres" ? createPostgresStore() : null;
const legacyPersonPattern = /(?:\u540c\u5b66|\u5b66\u751f|\u8003\u751f)/;
const legacyPersonNamePattern = /[\u4e00-\u9fff]+(?:\u540c\u5b66|\u5b66\u751f|\u8003\u751f)/g;
const legacyClassToken = "\u73ed";
const legacyClassNameToken = "\u73ed\u7ea7";

let state = null;
let writeQueue = Promise.resolve();
let lastBackupAt = 0;

export async function loadState() {
  if (state) return state;

  if (postgresStore) {
    const loaded = await postgresStore.load().catch(() => null);
    if (loaded) {
      state = normalizeState(loaded);
      return state;
    }
  }

  try {
    const raw = await readFile(dataFile, "utf8");
    state = normalizeState(JSON.parse(raw));
  } catch {
    state = normalizeState(defaultState());
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

export async function exportStateSnapshot() {
  const current = await loadState();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    storage: await storageInfo(),
    state: sanitizeBackupState(current),
  };
}

export async function replaceStateSnapshot(snapshot = {}) {
  const nextState = snapshot.state && typeof snapshot.state === "object" ? snapshot.state : snapshot;
  state = normalizeState({
    ...nextState,
    adminSessions: {},
  });
  state.auditLog.push({
    id: `backup-restore-${Date.now()}`,
    type: "backup-restore",
    message: "运行时数据已从备份恢复",
    createdAt: new Date().toISOString(),
  });
  await saveState({ forceBackup: true, reason: "before-restore" });
  return state;
}

export async function listBackupSnapshots() {
  return listLocalBackups();
}

export async function readBackupSnapshot(name) {
  const fileName = safeBackupName(name);
  if (!fileName) return null;
  const backups = await listLocalBackups();
  const backup = backups.find((item) => item.name === fileName);
  if (!backup) return null;
  const raw = await readFile(join(backupDir, fileName), "utf8");
  return {
    backup,
    snapshot: JSON.parse(raw),
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

function sanitizeBackupState(input = {}) {
  const { adminSessions, loginSecurity, ...safe } = input;
  return {
    ...safe,
    adminSessions: {},
    loginSecurity: defaultLoginSecurity(),
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

function safeBackupName(name = "") {
  const fileName = basename(String(name || ""));
  return /^runtime-.+\.json$/.test(fileName) ? fileName : "";
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
  const defaultGroups = groupsFromRows(sessions);
  return {
    exam,
    questions,
    sessions,
    candidates: sessions.map((session) => ({
      id: `cand-${session.ticket}`,
      candidate: session.candidate,
      ticket: session.ticket,
      className: session.className || "",
      createdAt: new Date().toISOString(),
    })),
    groups: defaultGroups.length ? defaultGroups : [defaultGroup()],
    answers: Object.fromEntries(answers.entries()),
    paper: {
      id: null,
      name: "",
      status: null,
      publishedAt: null,
      questionIds: [],
      buildSpec: null,
    },
    papers: [],
    generationTask: null,
    gradingResults: {},
    adminSessions: {},
    loginSecurity: defaultLoginSecurity(),
    proctorRules: defaultProctorRules(),
    auditLog: [
      {
        id: "log-init",
        type: "system",
        message: "MVP 初始数据已加载",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

function normalizeState(input) {
  const normalizedSessions = (Array.isArray(input.sessions) ? input.sessions : sessions).map(normalizeSession);
  const normalizedCandidates = Array.isArray(input.candidates)
    ? input.candidates.map(normalizeCandidate).filter(Boolean)
    : normalizedSessions.map(candidateFromSession).filter(Boolean);
  const normalizedGroups = Array.isArray(input.groups) ? input.groups.map(normalizeGroup).filter(Boolean) : groupsFromRows([...normalizedSessions, ...normalizedCandidates]);
  const groups = normalizedGroups.length ? normalizedGroups : [defaultGroup()];
  return {
    exam: input.exam || exam,
    questions: Array.isArray(input.questions) ? input.questions : questions,
    sessions: normalizedSessions,
    candidates: normalizedCandidates,
    groups,
    answers: input.answers && typeof input.answers === "object" ? input.answers : Object.fromEntries(answers.entries()),
    paper: {
      id: input.paper?.id || null,
      name: input.paper?.name || "",
      status: ["已组卷", "已保存"].includes(input.paper?.status) ? "未发布" : input.paper?.status || null,
      publishedAt: input.paper?.publishedAt || null,
      questionIds: Array.isArray(input.paper?.questionIds) ? input.paper.questionIds : [],
      buildSpec: input.paper?.buildSpec || null,
    },
    papers: Array.isArray(input.papers) ? input.papers.map(normalizePaperSnapshot).filter(Boolean) : [],
    generationTask: input.generationTask || null,
    gradingResults: input.gradingResults && typeof input.gradingResults === "object" ? input.gradingResults : {},
    adminSessions: input.adminSessions && typeof input.adminSessions === "object" ? input.adminSessions : {},
    loginSecurity: normalizeLoginSecurity(input.loginSecurity),
    proctorRules: normalizeProctorRules(input.proctorRules),
    auditLog: Array.isArray(input.auditLog) ? input.auditLog.map(normalizeAuditItem) : [],
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

function defaultProctorRules() {
  return {
    visibilityHidden: "中",
    cameraMissing: "高",
    screenUnshared: "中",
    fullscreenExited: "中",
    clipboard: "中",
    requireCamera: false,
    requireScreen: false,
    requireFullscreen: false,
    duplicateWindowSeconds: 10,
  };
}

function normalizeProctorRules(input = {}) {
  const defaults = defaultProctorRules();
  const risk = (value, fallback) => ["低", "中", "高"].includes(value) ? value : fallback;
  const duplicateWindowSeconds = Number(input?.duplicateWindowSeconds);
  return {
    visibilityHidden: risk(input?.visibilityHidden, defaults.visibilityHidden),
    cameraMissing: risk(input?.cameraMissing, defaults.cameraMissing),
    screenUnshared: risk(input?.screenUnshared, defaults.screenUnshared),
    fullscreenExited: risk(input?.fullscreenExited, defaults.fullscreenExited),
    clipboard: risk(input?.clipboard, defaults.clipboard),
    requireCamera: Boolean(input?.requireCamera),
    requireScreen: Boolean(input?.requireScreen),
    requireFullscreen: Boolean(input?.requireFullscreen),
    duplicateWindowSeconds: Number.isFinite(duplicateWindowSeconds)
      ? Math.max(1, Math.min(300, Math.round(duplicateWindowSeconds)))
      : defaults.duplicateWindowSeconds,
  };
}

function defaultGroup() {
  return {
    id: "group-default",
    name: "默认分组",
    description: "默认参与者分组",
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
}

function groupsFromRows(rows = []) {
  const names = [...new Set(rows.map((item) => neutralizeGroupName(item.className || item.class || "")).filter(Boolean))];
  return names.map((name, index) => ({
    id: `group-${index + 1}-${stableIdPart(name)}`,
    name,
    description: "",
    createdAt: new Date().toISOString(),
    updatedAt: null,
  }));
}

function normalizeGroup(item) {
  if (!item || typeof item !== "object") return null;
  const name = neutralizeGroupName(item.name || item.className || "");
  if (!name) return null;
  return {
    id: item.id || `group-${stableIdPart(name)}`,
    name,
    description: String(item.description || item.remark || "").trim(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || null,
  };
}

function stableIdPart(value) {
  return Buffer.from(String(value || "group")).toString("hex").slice(0, 16) || "group";
}

function candidateFromSession(session) {
  if (!session?.candidate || !session?.ticket) return null;
  return normalizeCandidate({
    id: `cand-${session.ticket}`,
    candidate: session.candidate,
    ticket: session.ticket,
    className: session.className || "",
    createdAt: session.assignedAt || session.createdAt,
  });
}

function normalizeCandidate(item) {
  if (!item || typeof item !== "object") return null;
  const candidate = neutralizePersonName(item.candidate || item.name || "", item.ticket);
  const ticket = String(item.ticket || "").trim();
  if (!candidate || !ticket) return null;
  return {
    id: item.id || `cand-${ticket}`,
    candidate,
    ticket,
    className: neutralizeGroupName(item.className || item.class || ""),
    phone: String(item.phone || "").trim(),
    email: String(item.email || "").trim(),
    description: String(item.description || item.remark || "").trim(),
    avatar: String(item.avatar || "").trim(),
    passwordHash: item.passwordHash || null,
    passwordUpdatedAt: item.passwordUpdatedAt || null,
    passwordMustChange: Boolean(item.passwordMustChange),
    loginToken: item.loginToken || null,
    loginTokenExpiresAt: item.loginTokenExpiresAt || null,
    lastLoginAt: item.lastLoginAt || null,
    disabledAt: item.disabledAt || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || null,
  };
}

function normalizeAuditItem(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    message: neutralizeText(item.message),
  };
}

function neutralizeText(value) {
  return String(value || "").replace(legacyPersonNamePattern, "参与者");
}

function normalizeSession(item) {
  const time = item.time || `${item.startTime || "10:00"}-${item.endTime || "11:30"}`;
  const [startTime = "10:00", endTime = "11:30"] = String(time).split("-");
  return {
    ...item,
    candidate: neutralizePersonName(item.candidate || item.name || "", item.ticket),
    className: neutralizeGroupName(item.className || item.class || ""),
    remark: String(item.remark || item.description || "").trim(),
    paper: item.paperName || item.paper || "未绑定试卷",
    paperId: item.paperId || null,
    paperName: item.paperName || item.paper || "未绑定试卷",
    paperVariant: item.paperVariant || null,
    paperSnapshotVersion: item.paperSnapshotVersion || null,
    startTime: item.startTime || startTime,
    endTime: item.endTime || endTime,
    time,
    accessToken: item.accessToken || null,
    assignedAt: item.assignedAt || item.createdAt || null,
  };
}

function neutralizePersonName(value, ticket = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (legacyPersonPattern.test(text)) return `参与者 ${String(ticket || "").slice(-2) || ""}`.trim();
  return text;
}

function neutralizeGroupName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replaceAll(legacyClassNameToken, "分组").replaceAll(legacyClassToken, "组");
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
    publishedAt: item.publishedAt || null,
    createdAt: item.createdAt || item.buildSpec?.builtAt || new Date().toISOString(),
  };
}
