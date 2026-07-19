import "./lib/env.js";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { aiConfig, buildPaper, generateQuestions, repairQuestions, saveFormalPaper, validateQuestions } from "./lib/ai.js";
import { loadState, storageInfo, updateState } from "./lib/runtime-store.js";

const frontendRoot = fileURLToPath(new URL("../frontend/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const adminUsername = process.env.SMARTQ_ADMIN_USER || "admin";
const adminPassword = process.env.SMARTQ_ADMIN_PASSWORD || "123456";
const rolePermissions = {
  admin: ["authoring", "papers"],
  author: ["authoring", "papers"],
};
const adminAccounts = loadAdminAccounts();
const loginSecurity = {
  maxFailures: Number(process.env.SMARTQ_LOGIN_MAX_FAILURES || 5),
  windowMs: Number(process.env.SMARTQ_LOGIN_WINDOW_SECONDS || 15 * 60) * 1000,
  lockMs: Number(process.env.SMARTQ_LOGIN_LOCK_SECONDS || 10 * 60) * 1000,
};
const maxRequestBytes = Math.max(64 * 1024, Math.min(50 * 1024 * 1024, Number(process.env.SMARTQ_MAX_REQUEST_BYTES || 2 * 1024 * 1024)));
const generationJobs = new Map();
const generationJobTtlMs = 30 * 60 * 1000;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Internal Server Error" });
  }
});

server.listen(port, () => {
  console.log(`SmartQ running at http://localhost:${port}`);
});

async function handleApi(req, res, url) {
  const state = await loadState();

  if (req.method === "GET" && url.pathname === "/api/health") {
    const config = aiConfig();
    const storage = await storageInfo();
    sendJson(res, 200, {
      ok: true,
      service: "SmartQ",
      time: new Date().toISOString(),
      mode: config.mockMode ? "mock" : "provider",
      aiReady: config.mockMode || Boolean(config.apiKey),
      storage: {
        adapter: storage.adapter,
        requestedAdapter: storage.requestedAdapter,
        effectiveAdapter: storage.effectiveAdapter,
        degraded: storage.degraded,
        status: storage.status,
        exists: storage.exists,
        sizeBytes: storage.sizeBytes,
        updatedAt: storage.updatedAt,
        backupCount: storage.backupCount,
        latestBackupAt: storage.latestBackupAt,
      },
      limits: { maxRequestBytes },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    const config = aiConfig();
    const mockMode = config.mockMode;
    const providerReady = Boolean(config.apiKey);
    sendJson(res, 200, {
      aiOnline: !mockMode && providerReady,
      aiReady: mockMode || providerReady,
      automationStatus: mockMode ? "AI mock 模式正常" : providerReady ? "AI 服务配置正常" : "AI 服务未配置密钥",
      mode: mockMode ? "mock" : "provider",
      mockMode,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readJson(req);
    const result = await updateState((current) => loginAdmin(current, body, req));
    if (result.error) {
      sendJson(res, result.statusCode || 401, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/me") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    sendJson(res, 200, { admin: publicAdminSession(auth.session) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = authToken(req, url);
    const result = await updateState((current) => logoutAdmin(current, token));
    sendJson(res, 200, result);
    return;
  }

  if (requiresAdminAuth(req, url)) {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, requiredAdminPermission(req, url));
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const paper = buildPaper(state.questions, state.paper);
    const papers = state.papers || [];
    sendJson(res, 200, {
      exam: state.exam,
      stats: {
        questions: state.questions.length,
        papers: papers.length,
        published: papers.filter((item) => item.status === "已发布").length,
        drafts: papers.filter((item) => item.status !== "已发布").length,
        pendingReview: state.questions.filter((item) => item.status !== "已校验").length,
      },
      questions: state.questions,
      paper,
      papers,
      quality: validateQuestions(state.questions),
      generationTask: state.generationTask,
      auditLog: state.auditLog.slice(-8).reverse(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/generate-questions") {
    const body = await readJson(req);
    const job = startGenerationJob(body);
    sendJson(res, 202, publicGenerationJob(job));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/ai/generation-jobs/")) {
    cleanupGenerationJobs();
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const job = generationJobs.get(id);
    if (!job) {
      sendJson(res, 404, { error: "出题任务不存在或已过期" });
      return;
    }
    sendJson(res, 200, publicGenerationJob(job));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/save-question-draft") {
    const body = await readJson(req);
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const spec = body.spec && typeof body.spec === "object" ? body.spec : {};
    if (!questions.length) {
      sendJson(res, 400, { error: "没有可保存的试卷内容" });
      return;
    }
    const checks = validateQuestions(questions);
    await updateState((current) => {
      current.questions = questions.map((item, index) => ({
        ...item,
        id: item.id || `q-${String(index + 1).padStart(3, "0")}`,
        quality: item.quality || 90,
        status: item.status || "待确认",
      }));
      current.generationTask = spec;
      current.paper = {
        id: null,
        name: "",
        status: null,
        publishedAt: null,
        questionIds: [],
        buildSpec: null,
      };
      current.auditLog.push(
        logItem(
          "ai-draft-save",
          `保存「${spec.paperName || "未命名试卷"}」试卷内容 ${current.questions.length} 道，稳定性 ${checks.stabilityScore}`,
        ),
      );
    });
    sendJson(res, 200, { saved: true, questions, spec, checks });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/papers/build") {
    const body = await readJson(req);
    const paper = await updateState((current) => {
      const saved = saveFormalPaper(current.questions, {
        ...current.paper,
        id: `paper-${Date.now()}`,
        name: body.name || current.generationTask?.paperName || current.paper.name || "未命名试卷",
      });
      if (saved.error) return saved;
      current.paper = {
        ...current.paper,
        id: saved.id,
        name: saved.name,
        status: "草稿",
        questionIds: saved.questionIds,
        buildSpec: saved.buildSpec,
        publishedAt: null,
      };
      upsertPaperSnapshot(current, buildPaper(current.questions, current.paper));
      current.auditLog.push(logItem("paper-save", `保存试卷：${saved.name}，${saved.questionCount} 题 / ${saved.score} 分`));
      return buildPaper(current.questions, current.paper);
    });
    if (paper.error) {
      sendJson(res, 409, paper);
      return;
    }
    sendJson(res, 200, paper);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/papers/publish") {
    const paper = await updateState((current) => {
      if (!current.paper.id || !["草稿", "未发布", "已保存", "已组卷", "已发布"].includes(current.paper.status)) {
        return { error: "请先保存试卷", paperStatus: current.paper.status };
      }
      const ids = new Set(current.paper.questionIds || []);
      const paperQuestions = current.questions.filter((item) => ids.has(item.id));
      const pending = paperQuestions.filter((item) => item.status !== "已校验").length;
      if (pending) {
        return { error: `试卷内还有 ${pending} 道题待审核`, pending };
      }
      if (!paperQuestions.length) {
        return { error: "当前试卷没有题目，请先保存试卷" };
      }
      current.paper.status = "已发布";
      current.paper.publishedAt = new Date().toISOString();
      upsertPaperSnapshot(current, buildPaper(current.questions, current.paper));
      current.auditLog.push(logItem("paper-publish", `${current.paper.name} 已发布`));
      return buildPaper(current.questions, current.paper);
    });
    if (paper.error) {
      sendJson(res, 409, paper);
      return;
    }
    sendJson(res, 200, paper);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/questions/")) {
    const id = url.pathname.split("/").pop();
    const body = await readJson(req);
    const question = await updateState((current) => {
      const target = current.questions.find((item) => item.id === id);
      if (!target) return null;
      const before = JSON.stringify(target);
      const nextQuestion = { ...target, ...body };
      if (nextQuestion.status === "已校验") {
        const checks = validateQuestions([nextQuestion]);
        if (checks.failures.length) {
          return { error: "题目结构未通过校验，不能审核通过", failures: checks.failures };
        }
      }
      Object.assign(target, body);
      if (questionContentChanged(before, target)) {
        const inPaper = (current.paper.questionIds || []).includes(id);
        if (inPaper) {
          current.paper.status = "草稿";
          current.paper.publishedAt = null;
          upsertPaperSnapshot(current, buildPaper(current.questions, current.paper));
        } else {
          current.auditLog.push(logItem("question-bank-update", `未入卷题目 ${id} 内容已更新`));
        }
      }
      current.auditLog.push(logItem("question-update", `题目 ${id} 更新为 ${target.status || "已更新"}`));
      return target;
    });
    if (!question) {
      sendJson(res, 404, { error: "Question Not Found" });
      return;
    }
    if (question.error) {
      sendJson(res, 409, question);
      return;
    }
    sendJson(res, 200, question);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/papers/") && url.pathname.endsWith("/activate")) {
    const id = url.pathname.split("/").at(-2);
    const paper = await updateState((current) => {
      const target = (current.papers || []).find((item) => item.id === id);
      if (!target) return null;
      current.paper = {
        id: target.id,
        name: target.name,
        status: target.status,
        publishedAt: target.publishedAt || null,
        questionIds: target.questionIds || [],
        buildSpec: target.buildSpec || null,
      };
      const targetQuestions = paperSnapshotDetail(target, current.questions).questions;
      if (targetQuestions.length) {
        current.questions = targetQuestions.map((question, index) => ({
          ...question,
          id: question.id || `q-${String(index + 1).padStart(3, "0")}`,
        }));
        current.paper.questionIds = current.questions.map((question) => question.id);
      }
      current.auditLog.push(logItem("paper-activate", `${target.name} 已设为当前试卷`));
      return buildPaper(current.questions, current.paper);
    });
    if (!paper) {
      sendJson(res, 404, { error: "Paper Not Found" });
      return;
    }
    sendJson(res, 200, paper);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/papers/")) {
    const id = url.pathname.split("/").pop();
    const target = (state.papers || []).find((item) => item.id === id);
    if (!target) {
      sendJson(res, 404, { error: "Paper Not Found" });
      return;
    }
    sendJson(res, 200, paperSnapshotDetail(target, state.questions));
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/papers/")) {
    const id = url.pathname.split("/").pop();
    const result = await updateState((current) => {
      const index = (current.papers || []).findIndex((item) => item.id === id);
      if (index < 0) return null;
      const [deleted] = current.papers.splice(index, 1);
      if (current.paper.id === id) {
        current.paper = {
          id: null,
          name: "",
          status: null,
          publishedAt: null,
          questionIds: [],
          buildSpec: null,
        };
        current.questions = [];
        current.generationTask = null;
      }
      current.auditLog.push(logItem("paper-delete", `删除试卷：${deleted.name}`));
      return { deleted: true, paper: deleted };
    });
    if (!result) {
      sendJson(res, 404, { error: "Paper Not Found" });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/quality/check") {
    const checks = validateQuestions(state.questions);
    await updateState((current) => {
      current.auditLog.push(logItem("quality-check", `质量复检完成：${checks.failures.length} 个问题，${checks.pendingReview} 道待确认`));
    });
    sendJson(res, 200, checks);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/quality/repair") {
    const result = await updateState((current) => {
      const repaired = repairQuestions(current.questions);
      current.questions = repaired.questions;
      if (current.paper.id) {
        current.paper.status = "草稿";
        current.paper.publishedAt = null;
      }
      current.auditLog.push(logItem("quality-repair", `自动修复完成：剩余 ${repaired.checks.failures.length} 个问题`));
      return repaired;
    });
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
}

function requiresAdminAuth(req, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  if (req.method === "GET" && ["/api/health", "/api/config"].includes(url.pathname)) return false;
  if (url.pathname.startsWith("/api/admin/")) return false;
  return true;
}

function requiredAdminPermission(req, url) {
  const path = url.pathname;
  if (path === "/api/dashboard") return null;
  if (path.startsWith("/api/ai/") || path.startsWith("/api/quality/") || path.startsWith("/api/questions/")) return "authoring";
  if (path.startsWith("/api/papers/") || path === "/api/papers/build" || path === "/api/papers/publish") return "papers";
  return null;
}

function requireAdminPermission(session = {}, permission) {
  if (!permission) return {};
  const permissions = Array.isArray(session.permissions) ? session.permissions : rolePermissions[session.role] || [];
  if (permissions.includes(permission)) return {};
  return {
    error: `无权访问该功能：需要 ${permission} 权限`,
    statusCode: 403,
    permission,
  };
}

function startGenerationJob(spec = {}) {
  cleanupGenerationJobs();
  const now = new Date().toISOString();
  const job = {
    id: `gen-${Date.now()}-${randomBytes(4).toString("hex")}`,
    status: "running",
    progress: 8,
    stage: "AI 出题任务已创建",
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
  };
  generationJobs.set(job.id, job);
  runGenerationJob(job, spec);
  return job;
}

async function runGenerationJob(job, spec) {
  updateGenerationJob(job, { progress: 36, stage: "连接 AI 出题服务" });
  try {
    const result = await generateQuestions(spec);
    updateGenerationJob(job, {
      status: "done",
      progress: 100,
      stage: "试卷已生成，等待确认",
      result: {
        ...result,
        saved: false,
        message: "试卷已生成，保存后才会进入草稿试卷列表。",
      },
    });
  } catch (error) {
    updateGenerationJob(job, {
      status: "error",
      progress: 100,
      stage: "生成失败",
      error: error.message || "AI 出题失败",
    });
  }
}

function updateGenerationJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function publicGenerationJob(job = {}) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.status === "done" ? job.result : undefined,
    error: job.status === "error" ? job.error : undefined,
  };
}

function cleanupGenerationJobs() {
  const cutoff = Date.now() - generationJobTtlMs;
  for (const [id, job] of generationJobs.entries()) {
    const updatedAt = Date.parse(job.updatedAt || job.createdAt || "");
    if (Number.isFinite(updatedAt) && updatedAt < cutoff) generationJobs.delete(id);
  }
}

function loadAdminAccounts() {
  const configured = parseAdminAccounts(process.env.SMARTQ_ADMIN_ACCOUNTS);
  if (configured.length) return configured;
  return [
    {
      username: adminUsername,
      password: adminPassword,
      role: process.env.SMARTQ_ADMIN_ROLE || "admin",
    },
  ].map(normalizeAdminAccount).filter(Boolean);
}

function parseAdminAccounts(raw = "") {
  if (!String(raw || "").trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : parsed.accounts;
    return (Array.isArray(rows) ? rows : []).map(normalizeAdminAccount).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeAdminAccount(account = {}) {
  const username = String(account.username || "").trim();
  const password = String(account.password || "");
  if (!username || !password) return null;
  const role = rolePermissions[account.role] ? account.role : "author";
  const explicitPermissions = Array.isArray(account.permissions)
    ? account.permissions.filter((item) => Object.values(rolePermissions).flat().includes(item))
    : null;
  return {
    username,
    password,
    role,
    permissions: [...new Set(explicitPermissions?.length ? explicitPermissions : rolePermissions[role])],
  };
}

function loginAdmin(state, body = {}, req = {}) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return { error: "请输入管理员账号和密码", statusCode: 400 };
  const attemptKey = loginAttemptKey("admin", username || "unknown", req);
  const limit = checkLoginLimit(state, attemptKey);
  if (limit.blocked) {
    state.auditLog.push(logItem("admin-login-blocked", `${username || "unknown"} 管理员登录被限流`, {
      identifier: username || "unknown",
      retryAfterSeconds: limit.retryAfterSeconds,
    }));
    return loginLockedResponse(limit);
  }
  const account = adminAccounts.find((item) => item.username === username);
  if (!account || password !== account.password) {
    const failure = recordLoginFailure(state, attemptKey);
    state.auditLog.push(logItem("admin-login-failed", `${username || "unknown"} 管理员登录失败`, {
      identifier: username || "unknown",
      failures: failure.failures,
      lockedUntil: failure.lockedUntil || null,
    }));
    return { error: "管理员账号或密码错误", statusCode: 401 };
  }
  clearLoginFailures(state, attemptKey);
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const token = randomToken(32);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const session = {
    id: `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    role: account.role,
    permissions: account.permissions,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  };
  state.adminSessions[token] = session;
  state.auditLog.push(logItem("admin-login", `${username} 登录运营控制台`));
  return {
    token,
    expiresAt,
    admin: publicAdminSession(session),
  };
}

function checkLoginLimit(state, key) {
  const bucket = loginAttemptBucket(state, key);
  const lockedUntil = new Date(bucket.lockedUntil || 0).getTime();
  if (lockedUntil && lockedUntil > Date.now()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)),
      lockedUntil: bucket.lockedUntil,
    };
  }
  if (lockedUntil) {
    delete bucket.lockedUntil;
    bucket.failures = 0;
  }
  return { blocked: false };
}

function recordLoginFailure(state, key) {
  const bucket = loginAttemptBucket(state, key);
  const now = Date.now();
  const firstFailureAt = new Date(bucket.firstFailureAt || 0).getTime();
  if (!firstFailureAt || now - firstFailureAt > loginSecurity.windowMs) {
    bucket.failures = 0;
    bucket.firstFailureAt = new Date(now).toISOString();
  }
  bucket.failures = Number(bucket.failures || 0) + 1;
  bucket.lastFailureAt = new Date(now).toISOString();
  if (bucket.failures >= loginSecurity.maxFailures) {
    bucket.lockedUntil = new Date(now + loginSecurity.lockMs).toISOString();
  }
  return bucket;
}

function clearLoginFailures(state, key) {
  if (state.loginSecurity?.attempts) delete state.loginSecurity.attempts[key];
}

function loginAttemptBucket(state, key) {
  state.loginSecurity = state.loginSecurity && typeof state.loginSecurity === "object" ? state.loginSecurity : {};
  state.loginSecurity.attempts = state.loginSecurity.attempts && typeof state.loginSecurity.attempts === "object" ? state.loginSecurity.attempts : {};
  state.loginSecurity.attempts = pruneLoginAttempts(state.loginSecurity.attempts);
  if (!state.loginSecurity.attempts[key]) state.loginSecurity.attempts[key] = { failures: 0 };
  return state.loginSecurity.attempts[key];
}

function pruneLoginAttempts(attempts = {}) {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(attempts || {}).filter(([, item]) => {
      const lockedUntil = new Date(item?.lockedUntil || 0).getTime();
      const lastFailureAt = new Date(item?.lastFailureAt || item?.firstFailureAt || 0).getTime();
      return (lockedUntil && lockedUntil > now) || (lastFailureAt && now - lastFailureAt <= loginSecurity.windowMs);
    }),
  );
}

function loginLockedResponse(limit = {}) {
  return {
    error: `登录失败次数过多，请 ${limit.retryAfterSeconds || Math.ceil(loginSecurity.lockMs / 1000)} 秒后再试`,
    statusCode: 429,
    retryAfterSeconds: limit.retryAfterSeconds || Math.ceil(loginSecurity.lockMs / 1000),
    lockedUntil: limit.lockedUntil || null,
  };
}

function loginAttemptKey(scope, identifier, req = {}) {
  return `${scope}:${String(identifier || "unknown").trim().toLowerCase()}:${clientIp(req)}`;
}

function clientIp(req = {}) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "local";
}

function logoutAdmin(state, token = "") {
  const value = String(token || "").trim();
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  if (value && state.adminSessions[value]) {
    const username = state.adminSessions[value].username || "admin";
    delete state.adminSessions[value];
    state.auditLog.push(logItem("admin-logout", `${username} 退出运营控制台`));
  }
  return { loggedOut: true };
}

function authenticateAdmin(state, token = "") {
  const value = String(token || "").trim();
  if (!value) return { error: "请先登录运营控制台", statusCode: 401 };
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const session = state.adminSessions[value];
  if (!session) return { error: "运营登录已失效，请重新登录", statusCode: 401 };
  const expiresAt = new Date(session.expiresAt || 0).getTime();
  if (!expiresAt || expiresAt < Date.now()) {
    delete state.adminSessions[value];
    return { error: "运营登录已过期，请重新登录", statusCode: 401 };
  }
  session.lastSeenAt = new Date().toISOString();
  return { session };
}

function pruneAdminSessions(sessions = {}) {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(sessions || {}).filter(([, session]) => {
      const expiresAt = new Date(session?.expiresAt || 0).getTime();
      return expiresAt && expiresAt > now;
    }),
  );
}

function publicAdminSession(session = {}) {
  return {
    id: session.id || "",
    username: session.username || "",
    role: session.role || "admin",
    permissions: Array.isArray(session.permissions) ? session.permissions : rolePermissions[session.role] || rolePermissions.admin,
    expiresAt: session.expiresAt || null,
    lastSeenAt: session.lastSeenAt || null,
  };
}

function upsertPaperSnapshot(state, paper) {
  state.papers = Array.isArray(state.papers) ? state.papers : [];
  const snapshot = {
    id: paper.id,
    name: paper.name,
    status: paper.status,
    score: paper.score,
    questionCount: paper.questionCount,
    typeGroups: paper.typeGroups,
    questionIds: paper.questionIds,
    questions: paper.questions,
    buildSpec: paper.buildSpec,
    publishedAt: paper.publishedAt,
    createdAt: paper.buildSpec?.savedAt || paper.buildSpec?.builtAt || new Date().toISOString(),
  };
  const index = state.papers.findIndex((item) => item.id === snapshot.id);
  if (index >= 0) state.papers[index] = { ...state.papers[index], ...snapshot };
  else state.papers.unshift(snapshot);
}

function paperSnapshotDetail(paper, sourceQuestions = []) {
  const byId = new Map(sourceQuestions.map((item) => [item.id, item]));
  const questions = Array.isArray(paper.questions) && paper.questions.length
    ? paper.questions
    : (paper.questionIds || []).map((id) => byId.get(id)).filter(Boolean);
  return {
    ...paper,
    questions,
  };
}

function randomToken(size = 16) {
  return randomBytes(size).toString("base64url");
}

function authToken(req, url) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return String(url.searchParams.get("token") || "").trim();
}

function questionContentChanged(beforeJson, after) {
  try {
    const before = JSON.parse(beforeJson);
    const fields = ["type", "stem", "options", "answer", "score", "difficulty", "knowledge", "explanation", "rubric"];
    return fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  } catch {
    return true;
  }
}

function logItem(type, message, details = {}) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    message,
    ...details,
    createdAt: new Date().toISOString(),
  };
}

async function serveStatic(res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(frontendRoot, safePath);
  let data;
  let responsePath = filePath;
  try {
    data = await readFile(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const prefixedAssetPath = extname(filePath) ? stripFirstPathSegment(safePath) : "";
    if (prefixedAssetPath) {
      responsePath = join(frontendRoot, prefixedAssetPath);
      data = await readFile(responsePath);
    } else {
      responsePath = join(frontendRoot, "index.html");
      data = await readFile(responsePath);
    }
  }
  res.writeHead(200, { ...securityHeaders(), "content-type": contentType(responsePath) });
  res.end(data);
}

function stripFirstPathSegment(pathname) {
  const parts = String(pathname || "").split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(1).join("/");
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      const error = new Error(`请求体过大，最大允许 ${formatBytes(maxRequestBytes)}`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { ...securityHeaders(), "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function contentType(filePath) {
  const ext = extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  }[ext] || "application/octet-stream";
}
