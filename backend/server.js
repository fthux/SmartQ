import "./lib/env.js";
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { aiConfig, analyzeExam, buildPaper, generateQuestions, gradeAnswers, paperQuestionsForSession, repairQuestions, reviewGradingResult, saveFormalPaper, validateQuestions } from "./lib/ai.js";
import { exportStateSnapshot, listBackupSnapshots, loadState, readBackupSnapshot, replaceStateSnapshot, storageInfo, updateState } from "./lib/runtime-store.js";

const frontendRoot = fileURLToPath(new URL("../frontend/", import.meta.url));
const backendRoot = fileURLToPath(new URL("./", import.meta.url));
const port = Number(process.env.PORT || 3000);
const adminUsername = process.env.SMARTQ_ADMIN_USER || "admin";
const adminPassword = process.env.SMARTQ_ADMIN_PASSWORD || "123456";
const rolePermissions = {
  admin: ["authoring", "papers", "participants", "assignments", "proctor", "grading", "analysis", "system"],
  author: ["authoring", "papers", "analysis"],
  operator: ["participants", "assignments", "proctor", "analysis"],
  proctor: ["proctor"],
  grader: ["grading", "analysis"],
  analyst: ["analysis"],
};
const adminAccounts = loadAdminAccounts();
const loginSecurity = {
  maxFailures: Number(process.env.SMARTQ_LOGIN_MAX_FAILURES || 5),
  windowMs: Number(process.env.SMARTQ_LOGIN_WINDOW_SECONDS || 15 * 60) * 1000,
  lockMs: Number(process.env.SMARTQ_LOGIN_LOCK_SECONDS || 10 * 60) * 1000,
};
const onlineTtlMs = Math.max(5, Math.min(600, Number(process.env.SMARTQ_ONLINE_TTL_SECONDS || 45))) * 1000;
const maxRequestBytes = Math.max(64 * 1024, Math.min(50 * 1024 * 1024, Number(process.env.SMARTQ_MAX_REQUEST_BYTES || 2 * 1024 * 1024)));
const evidenceDir = process.env.SMARTQ_EVIDENCE_DIR || join(backendRoot, "data", "evidence");
const maxEvidenceBytes = Math.max(16 * 1024, Math.min(5 * 1024 * 1024, Number(process.env.SMARTQ_MAX_EVIDENCE_BYTES || 512 * 1024)));
const evidenceStatus = resolveEvidenceStatus();
const evidenceAdapter = evidenceStatus.effectiveAdapter;
const objectEvidence = evidenceStatus.requestedAdapter !== "local-file" ? createObjectEvidenceAdapter() : null;
const presenceStatus = resolvePresenceStatus();
const redisPresence = presenceStatus.requestedAdapter === "redis" ? createRedisPresenceAdapter(process.env.SMARTQ_REDIS_URL, onlineTtlMs) : null;
const proctorStreams = new Set();
const presenceStore = new Map();

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
  if (shouldAutoSubmitBeforeHandling(req, url, state)) {
    await updateState((current) => autoSubmitExpiredSessions(current));
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const config = aiConfig();
    const storage = await storageInfo();
    const presenceRuntime = await presenceRuntimeStatus();
    const evidenceRuntime = await evidenceRuntimeStatus();
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
      proctor: {
        onlineTtlSeconds: Math.round(onlineTtlMs / 1000),
        presenceAdapter: presenceRuntime.effectiveAdapter,
        requestedPresenceAdapter: presenceRuntime.requestedAdapter,
        effectivePresenceAdapter: presenceRuntime.effectiveAdapter,
        presenceDegraded: presenceRuntime.degraded,
        presenceStatus: presenceRuntime,
        presenceCount: presenceStore.size,
      },
      evidence: {
        adapter: evidenceRuntime.effectiveAdapter,
        requestedAdapter: evidenceRuntime.requestedAdapter,
        effectiveAdapter: evidenceRuntime.effectiveAdapter,
        degraded: evidenceRuntime.degraded,
        status: evidenceRuntime,
        evidenceDir,
        maxEvidenceBytes,
      },
      limits: {
        maxRequestBytes,
      },
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

  if (req.method === "GET" && url.pathname === "/api/admin/sessions") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    sendJson(res, 200, { sessions: adminSessionRows(state, authToken(req, url)) });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/sessions/")) {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const result = await updateState((current) => revokeAdminSession(current, id, auth.session.username || "admin"));
    if (!result) {
      sendJson(res, 404, { error: "Admin Session Not Found" });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/audit") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    sendJson(res, 200, auditLogQuery(state, url));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/storage") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    sendJson(res, 200, { storage: await storageInfo() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/ops") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    sendJson(res, 200, await buildOpsSnapshot(state));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/backup") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    sendJson(res, 200, await exportStateSnapshot());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/backups") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    sendJson(res, 200, { backups: await listBackupSnapshots(), storage: await storageInfo() });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/admin/backups/")) {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    const name = decodeURIComponent(url.pathname.split("/").pop());
    const result = await readBackupSnapshot(name);
    if (!result) {
      sendJson(res, 404, { error: "Backup Not Found" });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/restore") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "system");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    const body = await readJson(req);
    const restored = await replaceStateSnapshot(body);
    sendJson(res, 200, { restored: true, storage: await storageInfo(), stats: stateStats(restored) });
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
    await refreshPresenceForSessions(state.sessions);
    const paper = buildPaper(state.questions, state.paper);
    const sessions = state.sessions || [];
    const dashboardSessions = decorateProctorSessions(state, sessions);
    const candidates = state.candidates || [];
    const activeSessions = sessions.filter((item) => item.status === "答题中");
    const waitingSessions = sessions.filter((item) => item.status === "待开考");
    const submittedSessions = sessions.filter((item) => item.status === "已提交");
    const averageProgress = sessions.length
      ? Math.round(sessions.reduce((sum, item) => sum + Number(item.progress || 0), 0) / sessions.length)
      : 0;
    sendJson(res, 200, {
      exam: state.exam,
      stats: {
        registered: candidates.length,
        sessions: sessions.length,
        active: activeSessions.length,
        waiting: waitingSessions.length,
        submitted: submittedSessions.length,
        online: sessions.filter(isSessionOnline).length,
        risk: sessions.filter((item) => item.risk !== "低").length,
        progress: averageProgress,
      },
      questions: state.questions,
      paper,
      papers: state.papers || [],
      groups: state.groups || [],
      participants: publicCandidates(state.candidates || []),
      candidates: publicCandidates(state.candidates || []),
      assignments: buildAssignmentSummary(state.sessions, state.papers || []),
      sessions: dashboardSessions,
      analysis: analyzeExam(state.questions, state.sessions, state.gradingResults, state.paper),
      quality: validateQuestions(state.questions),
      generationTask: state.generationTask,
      gradingQueue: buildGradingQueue(state.gradingResults),
      gradingReviewQueue: buildGradingReviewQueue(state),
      gradingResults: state.gradingResults,
      proctorEvents: proctorEvents(state.auditLog),
      proctorEventSummary: buildProctorEventSummary(state.auditLog),
      proctorRules: normalizeProctorRules(state.proctorRules),
      auditLog: state.auditLog.slice(-8).reverse(),
    });
    return;
  }

  if (req.method === "GET" && ["/api/participants", "/api/candidates"].includes(url.pathname)) {
    sendJson(res, 200, { participants: publicCandidates(state.candidates || []), candidates: publicCandidates(state.candidates || []) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/groups") {
    sendJson(res, 200, { groups: state.groups || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/groups") {
    const body = await readJson(req);
    const result = await updateState((current) => createGroup(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 201, result);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/groups/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(req);
    const result = await updateState((current) => updateGroup(current, id, body));
    if (!result) {
      sendJson(res, 404, { error: "Group Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/groups/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const result = await updateState((current) => deleteGroup(current, id));
    if (!result) {
      sendJson(res, 404, { error: "Group Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && ["/api/participants/import-preview", "/api/candidates/import-preview"].includes(url.pathname)) {
    const body = await readJson(req);
    sendJson(res, 200, previewCandidateImport(body, state));
    return;
  }

  if (req.method === "POST" && ["/api/participants/batch", "/api/candidates/batch"].includes(url.pathname)) {
    const body = await readJson(req);
    const result = await updateState((current) => createCandidateBatch(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 201, result);
    return;
  }

  if (req.method === "POST" && ["/api/participants", "/api/candidates"].includes(url.pathname)) {
    const body = await readJson(req);
    const result = await updateState((current) => createCandidateBatch(current, { candidates: [body] }));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 201, publicCandidate(result.candidates[0]));
    return;
  }

  if (req.method === "PATCH" && (url.pathname.startsWith("/api/participants/") || url.pathname.startsWith("/api/candidates/"))) {
    const ticket = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(req);
    const result = await updateState((current) => updateCandidate(current, ticket, body));
    if (!result) {
      sendJson(res, 404, { error: "Participant Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, publicCandidate(result));
    return;
  }

  if (req.method === "POST" && (url.pathname.startsWith("/api/participants/") || url.pathname.startsWith("/api/candidates/")) && url.pathname.endsWith("/password")) {
    const parts = url.pathname.split("/");
    const ticket = decodeURIComponent(parts.at(-2));
    const body = await readJson(req);
    const result = await updateState((current) => resetCandidatePassword(current, ticket, body));
    if (!result) {
      sendJson(res, 404, { error: "Participant Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && (url.pathname.startsWith("/api/participants/") || url.pathname.startsWith("/api/candidates/")) && url.pathname.endsWith("/status")) {
    const parts = url.pathname.split("/");
    const ticket = decodeURIComponent(parts.at(-2));
    const body = await readJson(req);
    const result = await updateState((current) => updateCandidateStatus(current, ticket, body));
    if (!result) {
      sendJson(res, 404, { error: "Participant Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, publicCandidate(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/candidate/login") {
    const body = await readJson(req);
    const result = await updateState((current) => loginCandidate(current, body, req));
    if (result.error) {
      sendJson(res, result.statusCode || 401, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/candidate/logout") {
    const auth = authenticateCandidate(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    await updateState((current) => {
      const candidate = (current.candidates || []).find((item) => item.id === auth.candidate.id);
      if (candidate) {
        candidate.loginToken = null;
        candidate.loginTokenExpiresAt = null;
        current.auditLog.push(logItem("candidate-logout", `${candidate.candidate} 退出考生系统`));
      }
      return { loggedOut: true };
    });
    sendJson(res, 200, { loggedOut: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/candidate/password") {
    const auth = authenticateCandidate(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const body = await readJson(req);
    const result = await updateState((current) => changeCandidatePassword(current, auth.candidate.id, body));
    if (result.error) {
      sendJson(res, result.statusCode || 400, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/candidate/exams") {
    const auth = authenticateCandidate(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    sendJson(res, 200, candidateExamList(state, auth.candidate));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/participants/delete-batch") {
    const body = await readJson(req);
    const result = await updateState((current) => deleteCandidateBatch(current, body.tickets || body.ids || []));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/participants/batch-update") {
    const body = await readJson(req);
    const result = await updateState((current) => updateCandidateBatch(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && (url.pathname.startsWith("/api/participants/") || url.pathname.startsWith("/api/candidates/"))) {
    const ticket = decodeURIComponent(url.pathname.split("/").pop());
    const result = await updateState((current) => deleteCandidate(current, ticket));
    if (!result) {
      sendJson(res, 404, { error: "Participant Not Found" });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/assignments") {
    sendJson(res, 200, {
      sessions: state.sessions,
      papers: publishedPaperOptions(state),
      summary: buildAssignmentSummary(state.sessions, state.papers || []),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignments/import-preview") {
    const body = await readJson(req);
    sendJson(res, 200, previewAssignmentImport(body, state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignments/batch") {
    const body = await readJson(req);
    const result = await updateState((current) => createAssignmentBatch(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 201, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignments") {
    const body = await readJson(req);
    const result = await updateState((current) => createAssignmentBatch(current, { ...body, candidates: [body] }));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 201, result.sessions[0]);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/assignments/")) {
    const id = url.pathname.split("/").pop();
    const body = await readJson(req);
    const result = await updateState((current) => updateAssignment(current, id, body));
    if (!result) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/assignments/delete-batch") {
    const body = await readJson(req);
    const result = await updateState((current) => deleteAssignmentBatch(current, body.ids || body.sessionIds || []));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/assignments/")) {
    const id = url.pathname.split("/").pop();
    const result = await updateState((current) => deleteAssignment(current, id));
    if (!result) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/generate-questions") {
    const body = await readJson(req);
    try {
      const result = await generateQuestions(body);
      sendJson(res, 200, {
        ...result,
        saved: false,
        message: "试卷已生成，保存后才会进入未发布试卷列表。",
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "AI 出题失败" });
    }
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
      invalidateExamProgress(current, "题库重新生成");
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
        status: "未发布",
        questionIds: saved.questionIds,
        buildSpec: saved.buildSpec,
        publishedAt: null,
      };
      upsertPaperSnapshot(current, buildPaper(current.questions, current.paper));
      invalidateExamProgress(current, "试卷重新保存");
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
      if (!current.paper.id || !["未发布", "已保存", "已组卷", "已发布"].includes(current.paper.status)) {
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
          current.paper.status = "未发布";
          current.paper.publishedAt = null;
          invalidateExamProgress(current, `试卷内题目 ${id} 内容变更`);
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
      invalidateExamProgress(current, `切换当前试卷为 ${target.name}`);
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
        invalidateExamProgress(current, `删除当前试卷 ${deleted.name}`);
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
        current.paper.status = "未发布";
        current.paper.publishedAt = null;
      }
      invalidateExamProgress(current, "题目质量修复");
      current.auditLog.push(logItem("quality-repair", `自动修复完成：剩余 ${repaired.checks.failures.length} 个问题`));
      return repaired;
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/proctor/stream") {
    const auth = authenticateAdmin(state, authToken(req, url));
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const permission = requireAdminPermission(auth.session, "proctor");
    if (permission.error) {
      sendJson(res, permission.statusCode || 403, permission);
      return;
    }
    openProctorStream(req, res, auth.session);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/proctor/sessions") {
    await refreshPresenceForSessions(state.sessions);
    sendJson(res, 200, {
      sessions: decorateProctorSessions(state, state.sessions),
      events: proctorEvents(state.auditLog),
      eventSummary: buildProctorEventSummary(state.auditLog),
      rules: normalizeProctorRules(state.proctorRules),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proctor/events/batch") {
    const body = await readJson(req);
    const result = await updateState((current) => updateProctorEventsBatch(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 400, result);
      return;
    }
    sendJson(res, 200, result);
    emitProctorUpdate("events-batch", { updated: result.updated });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/proctor/rules") {
    sendJson(res, 200, { rules: normalizeProctorRules(state.proctorRules) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proctor/rules") {
    const body = await readJson(req);
    const result = await updateState((current) => updateProctorRules(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 400, result);
      return;
    }
    sendJson(res, 200, result);
    emitProctorUpdate("rules", {});
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/proctor/sessions/") && url.pathname.endsWith("/report")) {
    const id = url.pathname.split("/").at(-2);
    await refreshPresenceForSessions(state.sessions, [id]);
    const report = buildProctorEvidenceReport(state, id);
    if (!report) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    sendJson(res, 200, report);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/proctor/sessions/") && url.pathname.includes("/attachments/")) {
    const parts = url.pathname.split("/");
    const id = decodeURIComponent(parts.at(-3));
    const attachmentId = decodeURIComponent(parts.at(-1));
    const result = await readEvidenceAttachment(state, id, attachmentId);
    if (result.error) {
      sendJson(res, result.statusCode || 404, result);
      return;
    }
    res.writeHead(200, {
      ...securityHeaders(),
      "content-type": result.attachment.contentType || "application/octet-stream",
      "content-length": result.data.length,
      "content-disposition": `attachment; filename="${result.attachment.id}${evidenceExtension(result.attachment.contentType)}"`,
      ...(result.attachment.sha256 ? { "x-smartq-evidence-sha256": result.attachment.sha256 } : {}),
      ...(result.integrityStatus ? { "x-smartq-evidence-integrity": result.integrityStatus } : {}),
    });
    res.end(result.data);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/proctor/sessions/")) {
    const id = url.pathname.split("/").pop();
    await refreshPresenceForSessions(state.sessions, [id]);
    const detail = buildProctorSessionDetail(state, id);
    if (!detail) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    sendJson(res, 200, detail);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proctor/sessions") {
    const body = await readJson(req);
    const result = await updateState((current) => createAssignmentBatch(current, { ...body, candidates: [body] }));
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 201, result.sessions[0]);
    emitProctorUpdate("assignment", { sessionId: result.sessions[0]?.id });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/proctor/sessions/") && url.pathname.endsWith("/events")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const session = await updateState((current) => {
      const target = current.sessions.find((item) => item.id === id);
      if (!target) return null;
      const eventText = String(body.event || "手动记录风险").trim();
      const risk = normalizeRiskLevel(body.risk || target.risk || "高");
      target.events = [...(target.events || []), eventText];
      target.risk = risk;
      current.auditLog.push(proctorLogItem(target, eventText, { risk, source: "manual" }));
      return target;
    });
    if (!session) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    sendJson(res, 200, session);
    emitProctorUpdate("event", { sessionId: id, risk: session.risk });
    return;
  }

  if ((req.method === "POST" || req.method === "PATCH") && url.pathname.startsWith("/api/proctor/events/")) {
    const eventId = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(req);
    const result = await updateState((current) => updateProctorEventStatus(current, eventId, body));
    if (!result) {
      sendJson(res, 404, { error: "Proctor Event Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    emitProctorUpdate("event-review", { eventId });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/proctor/sessions/") && url.pathname.endsWith("/control")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const result = await updateState((current) => applyProctorControl(current, id, body));
    if (!result) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    if (result.error) {
      sendJson(res, result.statusCode || 409, result);
      return;
    }
    sendJson(res, 200, result);
    emitProctorUpdate("control", { sessionId: id, action: body.action });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/candidate/session/") && url.pathname.endsWith("/heartbeat")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const targetSession = state.sessions.find((item) => item.id === id);
    const auth = authenticateCandidate(state, authToken(req, url), id);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const access = buildAccessState(resolveSessionPaper(state, targetSession), targetSession, state.proctorRules);
    if (!access.canSave) {
      sendJson(res, 409, { error: access.message, access });
      return;
    }
    const heartbeatAt = new Date().toISOString();
    await updatePresence(id, {
      lastSeenAt: heartbeatAt,
      progress: Number.isFinite(Number(body.progress)) ? Math.max(0, Math.min(100, Math.round(Number(body.progress)))) : undefined,
      device: {
        fullscreen: body.fullscreen,
        clipboard: body.clipboard,
      },
    });
    const progress = Number.isFinite(Number(body.progress)) ? Math.max(0, Math.min(100, Math.round(Number(body.progress)))) : targetSession.progress;
    const shouldPersistHeartbeat = shouldPersistHeartbeatState(targetSession, body, progress);
    if (!shouldPersistHeartbeat) {
      const decorated = decorateProctorSessions(state, [{ ...targetSession, remainingMinutes: access.remainingMinutes }])[0];
      sendJson(res, 200, decorated);
      emitProctorUpdate("heartbeat", { sessionId: id, risk: decorated.risk, progress: decorated.progress });
      return;
    }
    const session = await updateState((current) => {
      const target = current.sessions.find((item) => item.id === id);
      if (!target) return null;
      const currentAccess = buildAccessState(resolveSessionPaper(current, target), target, current.proctorRules);
      if (!currentAccess.canSave) return { error: currentAccess.message, access: currentAccess, statusCode: 409 };
      target.status = "答题中";
      target.autoSubmitDisabledAt = null;
      if (Number.isFinite(Number(body.progress))) target.progress = progress;
      updateProctorDeviceState(current, target, body);
      target.remainingMinutes = currentAccess.remainingMinutes;
      return target;
    });
    if (!session) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    if (session.error) {
      sendJson(res, session.statusCode || 409, session);
      return;
    }
    sendJson(res, 200, decorateProctorSessions({ ...state, sessions: [session] }, [session])[0]);
    emitProctorUpdate("heartbeat", { sessionId: id, risk: session.risk, progress: session.progress });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/candidate/session/")) {
    const id = url.pathname.split("/").pop();
    const session = state.sessions.find((item) => item.id === id);
    if (!session) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    const auth = authenticateCandidate(state, authToken(req, url), id);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const assignedPaper = resolveSessionPaper(state, session);
    const paperQuestions = questionsForAssignedSession(state, session);
    const access = buildAccessState(assignedPaper, session, state.proctorRules);
    const gradingResult = state.gradingResults?.[session.id] || null;
    const gradingPublished = gradingResult?.publishStatus === "已发布";
    sendJson(res, 200, {
      exam: state.exam,
      session: decorateCandidateSession(session, access),
      paper: assignedPaper,
      access,
      questions: paperQuestions,
      answers: state.answers[session.id] || {},
      grading: gradingPublished ? gradingResult : null,
      gradingStatus: gradingResult ? candidateGradingStatus(gradingResult) : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/candidate/session/") && url.pathname.endsWith("/appeal")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const existingSession = state.sessions.find((item) => item.id === id);
    if (!existingSession) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    const auth = authenticateCandidate(state, authToken(req, url), id);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const appeal = await updateState((current) => submitCandidateAppeal(current, id, auth.candidate, body));
    if (appeal.error) {
      sendJson(res, appeal.statusCode || 400, appeal);
      return;
    }
    sendJson(res, 200, appeal);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/candidate/session/") && url.pathname.endsWith("/evidence")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const existingSession = state.sessions.find((item) => item.id === id);
    if (!existingSession) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    const auth = authenticateCandidate(state, authToken(req, url), id);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const evidence = await updateState((current) => addProctorEvidenceSnapshot(current, id, body));
    if (evidence.error) {
      sendJson(res, evidence.statusCode || 400, evidence);
      return;
    }
    sendJson(res, 200, evidence);
    emitProctorUpdate("evidence", { sessionId: id, evidenceId: evidence.snapshot.id });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/candidate/session/") && url.pathname.endsWith("/evidence-attachment")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const existingSession = state.sessions.find((item) => item.id === id);
    if (!existingSession) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    const auth = authenticateCandidate(state, authToken(req, url), id);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const stored = await storeEvidenceAttachment(id, body);
    if (stored.error) {
      sendJson(res, stored.statusCode || 400, stored);
      return;
    }
    const result = await updateState((current) => addEvidenceAttachmentRecord(current, id, stored.attachment));
    if (result.error) {
      sendJson(res, result.statusCode || 400, result);
      return;
    }
    sendJson(res, 200, result);
    emitProctorUpdate("evidence-attachment", { sessionId: id, attachmentId: stored.attachment.id });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/candidate/session/")) {
    const id = url.pathname.split("/").pop();
    const body = await readJson(req);
    const existingSession = state.sessions.find((item) => item.id === id);
    if (!existingSession) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    const auth = authenticateCandidate(state, authToken(req, url), id);
    if (auth.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const existingPaper = resolveSessionPaper(state, existingSession);
    const access = buildAccessState(existingPaper, existingSession, state.proctorRules);
    const paperQuestions = questionsForAssignedSession(state, existingSession);
    const normalized = normalizeAnswerMap(body.answers || {}, paperQuestions);
    if (normalized.errors.length) {
      sendJson(res, 400, { error: normalized.errors[0], errors: normalized.errors });
      return;
    }
    if (existingSession.status === "已提交") {
      sendJson(res, 409, { error: "试卷已提交，不能重复保存或提交", sessionStatus: existingSession.status });
      return;
    }
    if (body.submit && !access.canSubmit) {
      sendJson(res, 409, { error: access.message, access });
      return;
    }
    if (!body.submit && !access.canSave) {
      sendJson(res, 409, { error: access.message, access });
      return;
    }
    const savedAt = new Date().toISOString();
    const saved = await updateState((current) => {
      current.answers[id] = normalized.answers;
      const session = current.sessions.find((item) => item.id === id);
      let grading = null;
      if (session) {
        const paperQuestions = questionsForAssignedSession(current, session);
        session.progress = paperQuestions.length ? Math.round((Object.keys(current.answers[id]).length / paperQuestions.length) * 100) : 0;
        if (!body.submit && session.status === "待开考") session.status = "答题中";
        if (body.submit) {
          grading = submitSessionAnswers(current, session, { submittedAt: savedAt, source: "candidate" });
        }
      }
      current.auditLog.push(logItem(body.submit ? "exam-submit" : "answer-save", `${id} ${body.submit ? "提交试卷" : "保存答题"}`));
      if (grading) {
        current.auditLog.push(logItem("grading", `${id} 提交后自动阅卷：${grading.totalScore}/${grading.maxScore}，${grading.reviewStatus}`));
      }
      return { saved: true, submitted: Boolean(body.submit), sessionId: id, savedAt, grading: null, gradingStatus: grading ? candidateGradingStatus(grading) : null };
    });
    sendJson(res, 200, saved);
    emitProctorUpdate(body.submit ? "submit" : "answer-save", { sessionId: id, submitted: Boolean(body.submit) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/grading/grade") {
    const body = await readJson(req);
    const session = state.sessions.find((item) => item.id === body.sessionId);
    const gradingPaper = session ? resolveSessionPaper(state, session) : state.paper;
    if (gradingPaper.status !== "已发布") {
      sendJson(res, 409, { error: "试卷尚未发布，不能阅卷", paperStatus: gradingPaper.status });
      return;
    }
    const gradingQuestions = session ? questionsForAssignedSession(state, session) : buildPaper(state.questions, state.paper).questions;
    const result = gradeAnswers(body.answers || {}, gradingQuestions);
    if (body.sessionId) {
      await updateState((current) => {
        current.gradingResults[body.sessionId] = {
          ...result,
          gradedAt: new Date().toISOString(),
        };
        current.auditLog.push(logItem("grading", `${body.sessionId} 完成自动阅卷：${result.totalScore}/${result.maxScore}，${result.reviewStatus}`));
      });
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/grading/review") {
    const body = await readJson(req);
    const reviewed = await updateState((current) => {
      const result = current.gradingResults[body.sessionId];
      if (!result) return { error: "阅卷结果不存在" };
      const next = reviewGradingResult(result, Array.isArray(body.reviews) ? body.reviews : []);
      next.reviewedBy = body.reviewer || "admin";
      next.publishStatus = result.publishStatus === "已发布" && next.reviewStatus === "已完成" ? "待重新发布" : result.publishStatus || "未发布";
      current.gradingResults[body.sessionId] = next;
      current.auditLog.push(logItem("grading-review", `${body.sessionId} 人工复核完成：${next.totalScore}/${next.maxScore}`));
      return next;
    });
    if (reviewed.error) {
      sendJson(res, 404, reviewed);
      return;
    }
    sendJson(res, 200, reviewed);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/grading/publish") {
    const body = await readJson(req);
    const published = await updateState((current) => publishGradingResult(current, body.sessionId, body.publisher || "admin"));
    if (published.error) {
      sendJson(res, published.statusCode || 400, published);
      return;
    }
    sendJson(res, 200, published);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/grading/appeal") {
    const body = await readJson(req);
    const resolved = await updateState((current) => resolveGradingAppeal(current, body, body.resolver || "admin"));
    if (resolved.error) {
      sendJson(res, resolved.statusCode || 400, resolved);
      return;
    }
    sendJson(res, 200, resolved);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/grading/export") {
    sendJson(res, 200, buildGradingExport(state));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/analysis") {
    sendJson(res, 200, analyzeExam(state.questions, state.sessions, state.gradingResults, state.paper));
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
}

function proctorEvents(auditLog = []) {
  return (auditLog || [])
    .filter((item) => item.type === "proctor-event" || item.type === "exam-submit" || item.type === "answer-save")
    .reverse();
}

function buildProctorEventSummary(auditLog = []) {
  const risks = (auditLog || []).filter((item) => item.type === "proctor-event");
  const byStatus = { 待处理: 0, 已处理: 0, 误报: 0 };
  const byRisk = { 高: 0, 中: 0, 低: 0 };
  const bySource = {};
  risks.forEach((event) => {
    const status = event.status || "待处理";
    byStatus[status] = (byStatus[status] || 0) + 1;
    const risk = normalizeRiskLevel(event.risk || "中");
    byRisk[risk] = (byRisk[risk] || 0) + 1;
    const source = event.source || "manual";
    bySource[source] = (bySource[source] || 0) + 1;
  });
  return {
    total: risks.length,
    pending: byStatus["待处理"] || 0,
    handled: byStatus["已处理"] || 0,
    falsePositive: byStatus["误报"] || 0,
    high: byRisk["高"] || 0,
    medium: byRisk["中"] || 0,
    low: byRisk["低"] || 0,
    byStatus,
    byRisk,
    bySource,
  };
}

async function buildOpsSnapshot(state = {}) {
  const config = aiConfig();
  const storage = await storageInfo();
  const presence = await presenceRuntimeStatus();
  const evidence = await evidenceRuntimeStatus();
  const sessions = state.sessions || [];
  const grading = buildGradingQueue(state.gradingResults || {});
  const risks = buildProctorEventSummary(state.auditLog || []);
  const proctorAnalyses = sessions.map((session) => buildProctorEvidenceReport(state, session.id)?.analysis).filter(Boolean);
  const highAnalysisCount = proctorAnalyses.filter((item) => item.level === "高").length;
  const active = sessions.filter((item) => item.status === "答题中").length;
  const waiting = sessions.filter((item) => item.status === "待开考").length;
  const submitted = sessions.filter((item) => item.status === "已提交").length;
  const alerts = [
    storage.degraded ? opsAlert("storage-degraded", "warning", "运行时存储降级", storage.status?.reason || storage.status?.requestedAdapter || "当前使用降级存储") : null,
    presence.degraded ? opsAlert("presence-degraded", "warning", "在线状态存储降级", presence.reason || "Redis presence 不可用") : null,
    evidence.degraded ? opsAlert("evidence-degraded", "warning", "证据存储降级", evidence.reason || "对象存储不可用") : null,
    !config.mockMode && !config.apiKey ? opsAlert("ai-not-ready", "critical", "AI 服务未就绪", "未配置 AI API Key，无法执行真实命题、分析或阅卷") : null,
    risks.pending ? opsAlert("proctor-pending", risks.high ? "critical" : "warning", "监考风险待处理", `${risks.pending} 条待处理，其中高风险 ${risks.high || 0} 条`) : null,
    highAnalysisCount ? opsAlert("proctor-analysis-high", "warning", "自动监考分析需复核", `${highAnalysisCount} 场考试被自动分析标记为高风险`) : null,
    grading.subjectivePending ? opsAlert("grading-pending", "warning", "主观题待复核", `${grading.subjectivePending} 份答卷需要人工复核`) : null,
    !storage.backupCount ? opsAlert("backup-missing", "warning", "尚无自动备份", "建议在正式考试前下载或生成一份运行时备份") : null,
  ].filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    status: alerts.some((item) => item.level === "critical") ? "critical" : alerts.length ? "warning" : "ok",
    metrics: {
      sessions: sessions.length,
      active,
      waiting,
      submitted,
      candidates: (state.candidates || []).length,
      papers: (state.papers || []).length,
      riskEvents: risks.total,
      pendingRiskEvents: risks.pending,
      highRiskEvents: risks.high || 0,
      highAnalysisSessions: highAnalysisCount,
      subjectivePending: grading.subjectivePending || 0,
      backupCount: storage.backupCount || 0,
      storageBytes: storage.sizeBytes || 0,
    },
    checks: [
      opsCheck("AI 服务", config.mockMode || Boolean(config.apiKey), config.mockMode ? "mock 模式" : "provider 模式"),
      opsCheck("运行时存储", !storage.degraded, storage.degraded ? storage.status?.reason : storage.effectiveAdapter),
      opsCheck("在线状态存储", !presence.degraded, presence.degraded ? presence.reason : presence.effectiveAdapter),
      opsCheck("证据存储", !evidence.degraded, evidence.degraded ? evidence.reason : evidence.effectiveAdapter),
      opsCheck("自动备份", Boolean(storage.backupCount), `${storage.backupCount || 0} 份`),
      opsCheck("监考风险", !risks.pending, risks.pending ? `${risks.pending} 条待处理` : "无待处理"),
      opsCheck("自动监考分析", !highAnalysisCount, highAnalysisCount ? `${highAnalysisCount} 场高风险` : "无高风险分析"),
      opsCheck("阅卷复核", !(grading.subjectivePending || 0), grading.subjectivePending ? `${grading.subjectivePending} 份待复核` : "无待复核"),
    ],
    alerts,
    storage,
    presence,
    evidence,
  };
}

function opsAlert(id, level, title, detail) {
  return { id, level, title, detail, createdAt: new Date().toISOString() };
}

function opsCheck(name, ok, detail = "") {
  return { name, ok: Boolean(ok), status: ok ? "正常" : "需处理", detail: detail || "" };
}

function openProctorStream(req, res, session = {}) {
  res.writeHead(200, {
    ...securityHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const client = {
    id: `${session.id || "admin"}-${Date.now()}`,
    username: session.username || "admin",
    write: (event, data = {}) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
  };
  proctorStreams.add(client);
  client.write("ready", { time: new Date().toISOString(), username: client.username });
  const keepAlive = setInterval(() => client.write("ping", { time: new Date().toISOString() }), 25000);
  req.on("close", () => {
    clearInterval(keepAlive);
    proctorStreams.delete(client);
  });
}

function emitProctorUpdate(event = "update", payload = {}) {
  if (!proctorStreams.size) return;
  const data = {
    event,
    time: new Date().toISOString(),
    ...payload,
  };
  for (const client of proctorStreams) {
    try {
      client.write("proctor-update", data);
    } catch {
      proctorStreams.delete(client);
    }
  }
}

function decorateProctorSessions(state, sessions = []) {
  return (sessions || []).map((session) => {
    const presence = sessionPresence(session.id);
    const access = buildAccessState(resolveSessionPaper(state, session), session, state.proctorRules);
    const online = isSessionOnline(session);
    return {
      ...session,
      lastSeenAt: presence.lastSeenAt || session.lastSeenAt || null,
      progress: presence.progress ?? session.progress,
      online,
      onlineStatus: online ? "在线" : "离线",
      timingStatus: access.timingStatus,
      displayStatus: access.displayStatus,
      remainingMinutes: access.remainingMinutes,
      controlStatus: session.controlStatus || "正常",
      messageCount: (session.messages || []).length,
      latestMessage: (session.messages || []).at(-1) || null,
      device: { ...(session.device || {}), ...(presence.device || {}) },
    };
  });
}

function buildProctorSessionDetail(state, id) {
  const session = (state.sessions || []).find((item) => item.id === id);
  if (!session) return null;
  const paper = resolveSessionPaper(state, session);
  const questions = questionsForAssignedSession(state, session);
  const answers = state.answers?.[id] || {};
  const grading = state.gradingResults?.[id] || null;
  const events = proctorEvents(state.auditLog).filter((event) => event.sessionId === id || String(event.message || "").includes(id) || String(event.message || "").includes(session.candidate));
  return {
    session: decorateProctorSessions(state, [session])[0],
    paper,
    questions: questions.map((question) => ({
      id: question.id,
      type: question.type,
      stem: question.stem,
      score: question.score,
      answered: answers[question.id] !== undefined,
      answer: answers[question.id],
    })),
    answers,
    grading,
    events,
    evidence: session.evidence || [],
    evidenceAttachments: session.evidenceAttachments || [],
    messages: session.messages || [],
    controls: session.controls || [],
  };
}

function buildProctorEvidenceReport(state, id) {
  const detail = buildProctorSessionDetail(state, id);
  if (!detail) return null;
  const riskEvents = (detail.events || []).filter((event) => event.type === "proctor-event");
  const answerEvents = (detail.events || []).filter((event) => event.type === "answer-save" || event.type === "exam-submit");
  const evidenceSnapshots = detail.evidence || [];
  const evidenceAttachments = (detail.evidenceAttachments || []).map((item) => ({
    ...item,
    downloadUrl: `/api/proctor/sessions/${encodeURIComponent(id)}/attachments/${encodeURIComponent(item.id)}`,
  }));
  const byStatus = { 待处理: 0, 已处理: 0, 误报: 0 };
  const byRisk = { 高: 0, 中: 0, 低: 0 };
  riskEvents.forEach((event) => {
    const status = event.status || "待处理";
    byStatus[status] = (byStatus[status] || 0) + 1;
    const risk = normalizeRiskLevel(event.risk || "中");
    byRisk[risk] = (byRisk[risk] || 0) + 1;
  });
  const answeredCount = (detail.questions || []).filter((item) => item.answered).length;
  const summary = {
    riskEvents: riskEvents.length,
    pendingEvents: byStatus["待处理"] || 0,
    handledEvents: byStatus["已处理"] || 0,
    falsePositiveEvents: byStatus["误报"] || 0,
    highRiskEvents: byRisk["高"] || 0,
    answerEvents: answerEvents.length,
    evidenceSnapshots: evidenceSnapshots.length,
    evidenceAttachments: evidenceAttachments.length,
    answeredCount,
    questionCount: detail.questions.length,
    progress: detail.session.progress || 0,
    submissionSource: detail.session.submissionSource || detail.grading?.submissionSource || "",
    gradingStatus: detail.grading?.reviewStatus || "未阅卷",
    publishStatus: detail.grading?.publishStatus || "未发布",
  };
  const device = {
    fullscreen: detail.session.device?.fullscreen || "",
    clipboard: detail.session.device?.clipboard || "",
    lastSeenAt: detail.session.lastSeenAt || null,
    onlineStatus: detail.session.onlineStatus || "",
  };
  const timeline = [
    ...(detail.events || []).map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      event: event.event || "",
      risk: event.risk || "",
      status: event.status || (event.type === "proctor-event" ? "待处理" : "已记录"),
      source: event.source || "",
      resolution: event.resolution || "",
      createdAt: event.createdAt || null,
      resolvedAt: event.resolvedAt || null,
    })),
    ...evidenceSnapshots.map((item) => ({
      id: item.id,
      type: "proctor-evidence",
      message: "监考取证快照",
      event: item.type,
      risk: "",
      status: "已记录",
      source: item.source || "candidate",
      resolution: "",
      createdAt: item.capturedAt || null,
      resolvedAt: null,
      evidence: item,
    })),
    ...evidenceAttachments.map((item) => ({
      id: item.id,
      type: "proctor-evidence-attachment",
      message: "监考证据附件",
      event: item.type,
      risk: "",
      status: "已保存",
      source: item.storageAdapter || "local-file",
      resolution: "",
      createdAt: item.createdAt || null,
      resolvedAt: null,
      attachment: item,
    })),
  ].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const answers = (detail.questions || []).map((question) => ({
    questionId: question.id,
    type: question.type,
    score: question.score,
    answered: question.answered,
    answer: question.answer ?? "",
    awarded: detail.grading?.details?.find((item) => item.questionId === question.id)?.awarded ?? null,
  }));
  const analysis = analyzeProctorEvidence({ summary, device, timeline, evidenceSnapshots, evidenceAttachments, answers });
  return {
    generatedAt: new Date().toISOString(),
    session: detail.session,
    paper: {
      id: detail.paper?.id || detail.session.paperId || null,
      name: detail.paper?.name || detail.session.paperName || detail.session.paper || "",
      score: detail.paper?.score || detail.grading?.maxScore || 0,
      questionCount: detail.questions.length,
    },
    summary,
    device,
    analysis,
    timeline,
    evidence: evidenceSnapshots,
    evidenceAttachments,
    controls: detail.controls || [],
    messages: detail.messages || [],
    grading: detail.grading ? {
      totalScore: detail.grading.totalScore,
      maxScore: detail.grading.maxScore,
      reviewStatus: detail.grading.reviewStatus,
      publishStatus: detail.grading.publishStatus || "未发布",
      publishedAt: detail.grading.publishedAt || null,
      appeals: detail.grading.appeals || [],
    } : null,
    answers,
  };
}

function analyzeProctorEvidence({ summary = {}, device = {}, timeline = [], evidenceSnapshots = [], evidenceAttachments = [], answers = [] } = {}) {
  const findings = [];
  const recommendations = [];
  let score = 0;
  const addFinding = (id, severity, title, detail, points) => {
    findings.push({ id, severity, title, detail, points });
    score += points;
  };
  if (summary.highRiskEvents) addFinding("high-risk-events", "高", "存在高风险监考事件", `${summary.highRiskEvents} 条高风险事件`, Math.min(35, summary.highRiskEvents * 12));
  if (summary.pendingEvents) addFinding("pending-events", "中", "存在未处理风险", `${summary.pendingEvents} 条风险仍待处理`, Math.min(20, summary.pendingEvents * 6));
  if (device.fullscreen === "exited") addFinding("fullscreen-exited", "中", "考试中退出全屏", "检测到全屏状态异常", 8);
  if (!summary.evidenceSnapshots) addFinding("missing-snapshots", "中", "缺少结构化取证快照", "未记录设备/环境快照", 8);
  const brokenAttachment = evidenceAttachments.find((item) => !item.sha256 || item.integrityStatus === "mismatch");
  if (brokenAttachment) addFinding("attachment-integrity", "高", "证据附件完整性不足", "存在缺少摘要或校验异常的附件", 14);
  if (summary.submissionSource === "force") addFinding("force-submit", "高", "监考强制收卷", "本次提交来源为监考强制收卷", 12);
  if (summary.submissionSource === "auto-timeout") addFinding("timeout-submit", "中", "到时自动收卷", "本次提交由系统到时自动完成", 5);
  const unanswered = answers.filter((item) => !item.answered).length;
  if (unanswered) addFinding("unanswered", "低", "存在未作答题目", `${unanswered} 题未作答`, Math.min(10, unanswered));
  const recentSignals = timeline.filter((item) => item.type === "proctor-event").slice(-5).map((item) => item.event || item.message).filter(Boolean);
  if (findings.some((item) => item.severity === "高")) recommendations.push("优先人工复核该场考试的监考记录和答题时间线。");
  if (summary.pendingEvents) recommendations.push("先处理待处理风险事件，必要时标注误报或补充处置说明。");
  if (!recommendations.length) recommendations.push("未发现显著异常，可按常规流程完成阅卷与归档。");
  const cappedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: cappedScore,
    level: cappedScore >= 70 ? "高" : cappedScore >= 35 ? "中" : "低",
    conclusion: cappedScore >= 70 ? "建议重点复核" : cappedScore >= 35 ? "建议人工确认" : "风险较低",
    findings,
    recommendations,
    recentSignals,
  };
}

function shouldAutoSubmitBeforeHandling(req, url, state = {}) {
  if (!url.pathname.startsWith("/api/")) return false;
  if (req.method !== "GET" && req.method !== "POST") return false;
  if (url.pathname === "/api/health" || url.pathname === "/api/config") return false;
  if (requiresAdminAuth(req, url) && authenticateAdmin(state, authToken(req, url)).error) return false;
  if (url.pathname.startsWith("/api/candidate/session/")) {
    const parts = url.pathname.split("/");
    const sessionId = url.pathname.endsWith("/heartbeat") ? parts.at(-2) : parts.at(-1);
    if (authenticateCandidate(state, authToken(req, url), sessionId).error) return false;
  } else if (url.pathname.startsWith("/api/candidate/")) {
    return false;
  }
  return (state.sessions || []).some((session) => shouldAutoSubmitSession(state, session));
}

function autoSubmitExpiredSessions(state) {
  const now = new Date().toISOString();
  const submitted = [];
  (state.sessions || []).forEach((session) => {
    if (!shouldAutoSubmitSession(state, session)) return;
    submitSessionAnswers(state, session, {
      submittedAt: now,
      source: "auto-timeout",
      controlStatus: session.controlStatus === "正常" ? "到时收卷" : session.controlStatus,
    });
    submitted.push(session);
  });
  if (submitted.length) {
    state.auditLog.push(logItem("exam-auto-submit", `到时自动收卷 ${submitted.length} 场考试`, {
      sessionIds: submitted.map((item) => item.id),
    }));
    emitProctorUpdate("auto-submit", { sessionIds: submitted.map((item) => item.id), count: submitted.length });
  }
  return { submitted: submitted.length, sessions: submitted };
}

function shouldAutoSubmitSession(state, session = {}) {
  if (!session.paperId || session.status === "已提交" || session.autoSubmitDisabledAt) return false;
  const paper = resolveSessionPaper(state, session);
  return paper.status === "已发布" && sessionTiming(session).state === "ended";
}

function addProctorEvidenceSnapshot(state = {}, sessionId, body = {}) {
  const session = (state.sessions || []).find((item) => item.id === sessionId);
  if (!session) return { error: "Session Not Found", statusCode: 404 };
  const capturedAt = new Date().toISOString();
  const device = body.device && typeof body.device === "object" ? body.device : {};
  const environment = body.environment && typeof body.environment === "object" ? body.environment : {};
  const signals = Array.isArray(body.signals) ? body.signals.slice(0, 12) : [];
  const snapshot = {
    id: `evidence-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: String(body.type || "device-snapshot").trim() || "device-snapshot",
    source: String(body.source || "candidate").trim() || "candidate",
    capturedAt,
    progress: Math.max(0, Math.min(100, Math.round(Number(body.progress || session.progress || 0)))),
    visibility: String(body.visibility || "").trim(),
    device: {
      fullscreen: String(device.fullscreen || session.device?.fullscreen || "").trim(),
      clipboard: String(device.clipboard || session.device?.clipboard || "").trim(),
    },
    environment: {
      userAgent: String(environment.userAgent || "").slice(0, 240),
      language: String(environment.language || "").slice(0, 40),
      platform: String(environment.platform || "").slice(0, 80),
      viewport: String(environment.viewport || "").slice(0, 40),
      screen: String(environment.screen || "").slice(0, 40),
      timezone: String(environment.timezone || "").slice(0, 80),
    },
    signals: signals.map((item) => ({
      event: String(item?.event || "").slice(0, 80),
      risk: normalizeRiskLevel(item?.risk || "中"),
      source: String(item?.source || "signal").slice(0, 40),
    })).filter((item) => item.event),
  };
  session.evidence = [...(session.evidence || []), snapshot].slice(-80);
  session.device = { ...(session.device || {}), ...snapshot.device };
  session.lastEvidenceAt = capturedAt;
  state.auditLog.push(logItem("proctor-evidence", `${session.candidate || session.id} 提交监考取证快照`, {
    sessionId: session.id,
    candidate: session.candidate || "",
    ticket: session.ticket || "",
    evidenceId: snapshot.id,
    source: snapshot.source,
  }));
  return { saved: true, snapshot, evidenceCount: session.evidence.length };
}

async function storeEvidenceAttachment(sessionId, body = {}) {
  const parsed = parseEvidenceAttachment(body);
  if (parsed.error) return parsed;
  const id = `attachment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ext = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "text/plain": ".txt",
  }[parsed.contentType] || ".bin";
  const fileName = `${id}${ext}`;
  const path = join(safePathPart(sessionId), fileName);
  const sha256 = createHash("sha256").update(parsed.buffer).digest("hex");
  let storageAdapter = "local-file";
  let objectKey = "";
  if (objectEvidence) {
    const uploaded = await objectEvidence.put(path, parsed.buffer, parsed.contentType, sha256).catch((error) => ({ error }));
    if (!uploaded?.error) {
      storageAdapter = uploaded.storageAdapter || evidenceStatus.requestedAdapter;
      objectKey = uploaded.key || path;
    }
  }
  if (storageAdapter === "local-file") {
    const sessionDir = join(evidenceDir, safePathPart(sessionId));
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, fileName), parsed.buffer);
  }
  return {
    attachment: {
      id,
      type: String(body.type || "snapshot-attachment").trim() || "snapshot-attachment",
      label: String(body.label || "").trim(),
      contentType: parsed.contentType,
      sizeBytes: parsed.buffer.length,
      sha256,
      storageAdapter,
      path,
      objectKey,
      createdAt: new Date().toISOString(),
    },
  };
}

function parseEvidenceAttachment(body = {}) {
  const raw = String(body.data || body.dataUrl || "").trim();
  if (!raw) return { error: "证据附件内容不能为空", statusCode: 400 };
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/);
  const contentType = String(body.contentType || match?.[1] || "application/octet-stream").toLowerCase();
  const allowed = ["image/png", "image/jpeg", "image/webp", "text/plain"];
  if (!allowed.includes(contentType)) return { error: "证据附件类型不支持", statusCode: 400, contentType };
  const base64 = match ? match[2] : raw;
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { error: "证据附件 Base64 无效", statusCode: 400 };
  }
  if (!buffer.length) return { error: "证据附件内容为空", statusCode: 400 };
  if (buffer.length > maxEvidenceBytes) return { error: `证据附件过大，最大允许 ${formatBytes(maxEvidenceBytes)}`, statusCode: 413 };
  return { contentType, buffer };
}

function addEvidenceAttachmentRecord(state = {}, sessionId, attachment = {}) {
  const session = (state.sessions || []).find((item) => item.id === sessionId);
  if (!session) return { error: "Session Not Found", statusCode: 404 };
  session.evidenceAttachments = [...(session.evidenceAttachments || []), attachment].slice(-80);
  session.lastEvidenceAt = attachment.createdAt;
  state.auditLog.push(logItem("proctor-evidence-attachment", `${session.candidate || session.id} 上传监考证据附件`, {
    sessionId: session.id,
    candidate: session.candidate || "",
    ticket: session.ticket || "",
    attachmentId: attachment.id,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  }));
  return { saved: true, attachment, attachmentCount: session.evidenceAttachments.length };
}

async function readEvidenceAttachment(state = {}, sessionId, attachmentId) {
  const session = (state.sessions || []).find((item) => item.id === sessionId);
  if (!session) return { error: "Session Not Found", statusCode: 404 };
  const attachment = (session.evidenceAttachments || []).find((item) => item.id === attachmentId);
  if (!attachment) return { error: "Evidence Attachment Not Found", statusCode: 404 };
  const relativePath = String(attachment.objectKey || attachment.path || "");
  if (!relativePath || relativePath.includes("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    return { error: "Evidence Attachment Path Invalid", statusCode: 400 };
  }
  const data = attachment.storageAdapter && attachment.storageAdapter !== "local-file" && objectEvidence
    ? await objectEvidence.get(relativePath)
    : await readFile(join(evidenceDir, relativePath));
  const actualSha256 = createHash("sha256").update(data).digest("hex");
  const integrityStatus = attachment.sha256 ? (attachment.sha256 === actualSha256 ? "verified" : "mismatch") : "untracked";
  return { attachment, data, actualSha256, integrityStatus };
}

function evidenceExtension(contentType = "") {
  return {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "text/plain": ".txt",
  }[contentType] || ".bin";
}

function safePathPart(value = "") {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "session";
}

function shouldPersistHeartbeatState(session = {}, body = {}, progress = session.progress) {
  if (session.status !== "答题中") return true;
  if (Number.isFinite(Number(progress)) && Number(progress) !== Number(session.progress || 0)) return true;
  const device = session.device || {};
  if (body.fullscreen && body.fullscreen !== device.fullscreen) return true;
  if (body.clipboard && body.clipboard !== device.clipboard) return true;
  if (body.visibility === "hidden") return true;
  if (Array.isArray(body.signals) && body.signals.length) return true;
  return false;
}

function isSessionOnline(session = {}) {
  if (session.status === "已提交" || session.status === "离线") return false;
  if (session.status !== "答题中") return false;
  const presence = sessionPresence(session.id);
  const seen = new Date(presence.lastSeenAt || session.lastSeenAt || 0).getTime();
  return Boolean(seen) && Date.now() - seen <= onlineTtlMs;
}

async function updatePresence(sessionId, patch = {}) {
  if (!sessionId) return {};
  const previous = presenceStore.get(sessionId) || {};
  const next = {
    ...previous,
    ...patch,
    device: {
      ...(previous.device || {}),
      ...(patch.device || {}),
    },
    updatedAt: new Date().toISOString(),
  };
  presenceStore.set(sessionId, next);
  prunePresenceStore();
  if (redisPresence) await redisPresence.set(sessionId, next).catch(() => {});
  return next;
}

async function refreshPresenceForSessions(sessions = [], ids = null) {
  prunePresenceStore();
  if (!redisPresence) return;
  const targetIds = (Array.isArray(ids) && ids.length ? ids : (sessions || []).map((item) => item.id)).filter(Boolean);
  if (!targetIds.length) return;
  const rows = await redisPresence.getMany(targetIds).catch(() => ({}));
  Object.entries(rows || {}).forEach(([id, entry]) => {
    if (entry && typeof entry === "object") presenceStore.set(id, entry);
  });
  prunePresenceStore();
}

function sessionPresence(sessionId) {
  if (!sessionId) return {};
  const entry = presenceStore.get(sessionId);
  if (!entry) return {};
  const seen = new Date(entry.lastSeenAt || 0).getTime();
  if (seen && Date.now() - seen > onlineTtlMs * 4) {
    presenceStore.delete(sessionId);
    return {};
  }
  return entry;
}

function prunePresenceStore() {
  const maxAge = onlineTtlMs * 4;
  const now = Date.now();
  for (const [id, entry] of presenceStore.entries()) {
    const seen = new Date(entry.lastSeenAt || entry.updatedAt || 0).getTime();
    if (!seen || now - seen > maxAge) presenceStore.delete(id);
  }
}

function normalizeRiskLevel(value = "低") {
  return ["低", "中", "高"].includes(value) ? value : "高";
}

function proctorLogItem(session = {}, event = "手动记录风险", details = {}) {
  return logItem("proctor-event", `${session.candidate || session.id || "参与者"}：${event}`, {
    sessionId: session.id || "",
    candidate: session.candidate || "",
    ticket: session.ticket || "",
    className: session.className || "",
    paperId: session.paperId || null,
    paperName: session.paperName || session.paper || "",
    risk: normalizeRiskLevel(details.risk || session.risk || "中"),
    event,
    source: details.source || "manual",
    status: "待处理",
  });
}

function updateProctorEventStatus(state, eventId, body = {}) {
  const event = (state.auditLog || []).find((item) => item.id === eventId && item.type === "proctor-event");
  if (!event) return null;
  const status = String(body.status || "已处理").trim();
  if (!["待处理", "已处理", "误报"].includes(status)) {
    return { error: "风险处理状态无效", statusCode: 400 };
  }
  event.status = status;
  event.resolution = String(body.resolution || body.comment || "").trim();
  event.resolvedAt = status === "待处理" ? null : new Date().toISOString();
  if (event.sessionId) {
    const session = (state.sessions || []).find((item) => item.id === event.sessionId);
    if (session) {
      const pendingRiskEvents = (state.auditLog || []).filter((item) => item.type === "proctor-event" && item.sessionId === session.id && (item.status || "待处理") === "待处理" && item.id !== event.id);
      if (!pendingRiskEvents.length && status !== "待处理") {
        session.risk = "低";
      }
    }
  }
  state.auditLog.push(logItem("proctor-review", `${event.message || event.id} 标记为${status}`));
  return event;
}

function updateProctorEventsBatch(state, body = {}) {
  const ids = Array.isArray(body.ids || body.eventIds) ? body.ids || body.eventIds : [];
  const targets = [...new Set(ids.map((item) => String(item || "").trim()).filter(Boolean))];
  if (!targets.length) return { error: "请选择要处理的风险事件", statusCode: 400 };
  const updated = [];
  const missing = [];
  targets.forEach((id) => {
    const result = updateProctorEventStatus(state, id, {
      status: body.status || "已处理",
      resolution: body.resolution || body.comment || "批量处理",
    });
    if (!result) missing.push(id);
    else if (!result.error) updated.push(result);
  });
  state.auditLog.push(logItem("proctor-review-batch", `批量处理 ${updated.length} 条风险事件`));
  return {
    updated: updated.length,
    missing,
    events: updated,
    summary: buildProctorEventSummary(state.auditLog),
  };
}

function normalizeProctorRules(input = {}) {
  const defaults = defaultProctorRules();
  const risk = (value, fallback) => ["低", "中", "高"].includes(value) ? value : fallback;
  const duplicateWindowSeconds = Number(input?.duplicateWindowSeconds);
  return {
    visibilityHidden: risk(input?.visibilityHidden, defaults.visibilityHidden),
    fullscreenExited: risk(input?.fullscreenExited, defaults.fullscreenExited),
    clipboard: risk(input?.clipboard, defaults.clipboard),
    requireCamera: false,
    requireScreen: false,
    requireFullscreen: Boolean(input?.requireFullscreen),
    duplicateWindowSeconds: Number.isFinite(duplicateWindowSeconds)
      ? Math.max(1, Math.min(300, Math.round(duplicateWindowSeconds)))
      : defaults.duplicateWindowSeconds,
  };
}

function defaultProctorRules() {
  return {
    visibilityHidden: "中",
    fullscreenExited: "中",
    clipboard: "中",
    requireCamera: false,
    requireScreen: false,
    requireFullscreen: false,
    duplicateWindowSeconds: 10,
  };
}

function updateProctorRules(state, body = {}) {
  const rules = normalizeProctorRules(body.rules || body);
  state.proctorRules = rules;
  state.auditLog.push(logItem("proctor-rules", "监考风险规则已更新"));
  return { rules };
}

function updateProctorDeviceState(state, session, body = {}) {
  const rules = normalizeProctorRules(state.proctorRules);
  const device = {
    ...(session.device || {}),
    fullscreen: body.fullscreen || session.device?.fullscreen || "未知",
    visibility: body.visibility || session.device?.visibility || "visible",
    clipboard: body.clipboard || session.device?.clipboard || "正常",
    userAgent: body.userAgent || session.device?.userAgent || "",
    updatedAt: new Date().toISOString(),
  };
  session.device = device;

  const signals = Array.isArray(body.signals) ? body.signals : [];
  const directSignals = [
    body.visibility === "hidden" ? { event: "离开考试页面", risk: rules.visibilityHidden, source: "heartbeat" } : null,
    body.fullscreen === "exited" ? { event: "退出全屏", risk: rules.fullscreenExited, source: "device" } : null,
    body.clipboard === "copy" || body.clipboard === "paste" ? { event: body.clipboard === "copy" ? "复制操作" : "粘贴操作", risk: rules.clipboard, source: "clipboard" } : null,
    ...signals.map((signal) => ({
      event: signal.event || signal.type || "异常信号",
      risk: normalizeRiskLevel(signal.risk || "中"),
      source: signal.source || "signal",
    })),
  ].filter(Boolean);

  directSignals.forEach((signal) => recordProctorSignal(state, session, signal.event, signal.risk, signal.source));
}

function recordProctorSignal(state, session, eventText, risk = "中", source = "signal") {
  const rules = normalizeProctorRules(state.proctorRules);
  session.events = [...(session.events || []), eventText];
  session.risk = risk === "高" || session.risk === "高" ? "高" : normalizeRiskLevel(risk);
  const recentDuplicate = (state.auditLog || []).findLast?.((item) => item.type === "proctor-event" && item.sessionId === session.id && item.event === eventText);
  const duplicateWindowMs = recentDuplicate ? Date.now() - new Date(recentDuplicate.createdAt || 0).getTime() : Infinity;
  if (duplicateWindowMs > rules.duplicateWindowSeconds * 1000) {
    state.auditLog.push(proctorLogItem(session, eventText, { risk: session.risk, source }));
  }
}

function applyProctorControl(state, id, body = {}) {
  const session = (state.sessions || []).find((item) => item.id === id);
  if (!session) return null;
  const action = String(body.action || "").trim();
  const now = new Date().toISOString();
  const note = String(body.note || body.message || "").trim();
  session.controls = Array.isArray(session.controls) ? session.controls : [];
  const control = { id: `ctrl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, action, note, createdAt: now };

  if (action === "forceSubmit") {
    submitSessionAnswers(state, session, { submittedAt: now, source: "force", controlStatus: "强制交卷" });
  } else if (action === "pause") {
    session.controlStatus = "已暂停";
    session.pausedAt = now;
  } else if (action === "resume") {
    session.controlStatus = "正常";
    session.pausedAt = null;
  } else if (action === "lock") {
    session.controlStatus = "已锁定";
    session.lockedAt = now;
  } else if (action === "unlock") {
    session.controlStatus = "正常";
    session.lockedAt = null;
  } else if (action === "extend") {
    const minutes = Math.max(1, Math.min(240, Math.round(Number(body.minutes || 0))));
    if (!Number.isFinite(minutes)) return { error: "延时时长无效", statusCode: 400 };
    const end = parseExamDate(session.endTime);
    if (!end) return { error: "考试结束时间无效", statusCode: 400 };
    end.setMinutes(end.getMinutes() + minutes);
    session.endTime = toDateTimeLocal(end);
    session.time = `${session.startTime}-${session.endTime}`;
    session.remainingMinutes = Math.max(0, Number(session.remainingMinutes || 0) + minutes);
    session.controlStatus = "已延时";
    control.minutes = minutes;
  } else if (action === "message") {
    if (!note) return { error: "消息内容不能为空", statusCode: 400 };
    session.messages = [...(session.messages || []), { id: control.id, message: note, createdAt: now, readAt: null }];
    session.controlStatus = session.controlStatus || "正常";
  } else {
    return { error: "监考控制动作无效", statusCode: 400 };
  }

  session.controls.push(control);
  state.auditLog.push(logItem("proctor-control", `${session.candidate} ${controlActionText(action)}${note ? `：${note}` : ""}`, {
    sessionId: session.id,
    candidate: session.candidate,
    ticket: session.ticket,
    action,
  }));
  return buildProctorSessionDetail(state, id);
}

function controlActionText(action) {
  return {
    forceSubmit: "被强制交卷",
    pause: "考试已暂停",
    resume: "考试已恢复",
    lock: "答题已锁定",
    unlock: "答题已解锁",
    extend: "考试已延时",
    message: "收到监考消息",
  }[action] || "执行监考控制";
}

function buildGradingQueue(gradingResults = {}) {
  const results = Object.values(gradingResults || {});
  return {
    objectiveDone: results.length,
    subjectivePending: results.reduce((sum, result) => sum + Number(result.subjectivePending || 0), 0),
    reviewDone: results.filter((result) => result.reviewStatus === "已完成").length,
    published: results.filter((result) => result.publishStatus === "已发布").length,
  };
}

function buildGradingReviewQueue(state = {}) {
  return Object.entries(state.gradingResults || {})
    .map(([sessionId, result]) => {
      const session = (state.sessions || []).find((item) => item.id === sessionId) || {};
      const paper = (state.papers || []).find((item) => item.id === session.paperId) || {};
      const questionMap = new Map((paper.questions || []).map((question) => [question.id, question]));
      const details = (result.details || []).map((detail) => {
        const question = questionMap.get(detail.questionId) || {};
        return {
          ...detail,
          stem: question.stem || detail.stem || "",
          options: Array.isArray(question.options) ? question.options : Array.isArray(detail.options) ? detail.options : [],
          standardAnswer: question.answer ?? detail.standardAnswer ?? "",
          explanation: question.explanation || detail.explanation || "",
        };
      });
      const pendingDetails = details.filter((item) => item.reviewRequired && item.status !== "人工复核完成");
      return {
        sessionId,
        candidate: session.candidate || "",
        ticket: session.ticket || "",
        className: session.className || "",
        paperId: session.paperId || null,
        paperName: session.paperName || session.paper || "",
        risk: session.risk || "低",
        totalScore: result.totalScore || 0,
        maxScore: result.maxScore || 0,
        objectiveScore: result.objectiveScore || 0,
        subjectiveScore: result.subjectiveScore || 0,
        subjectivePending: result.subjectivePending || 0,
        reviewStatus: result.reviewStatus || "待复核",
        publishStatus: result.publishStatus || "未发布",
        gradedAt: result.gradedAt || null,
        reviewedAt: result.reviewedAt || null,
        publishedAt: result.publishedAt || null,
        publishedBy: result.publishedBy || "",
        appealStatus: latestAppeal(result)?.status || "无申诉",
        appealCount: Array.isArray(result.appeals) ? result.appeals.length : 0,
        latestAppeal: latestAppeal(result),
        pendingQuestionIds: pendingDetails.map((item) => item.questionId),
        details,
      };
    })
    .sort((a, b) => {
      const pendingDelta = Number(b.subjectivePending > 0) - Number(a.subjectivePending > 0);
      if (pendingDelta) return pendingDelta;
      return new Date(b.gradedAt || 0) - new Date(a.gradedAt || 0);
    });
}

function buildGradingExport(state = {}) {
  const queue = buildGradingReviewQueue(state);
  return {
    exportedAt: new Date().toISOString(),
    summary: {
      total: queue.length,
      pending: queue.filter((item) => item.reviewStatus !== "已完成").length,
      completed: queue.filter((item) => item.reviewStatus === "已完成").length,
    },
    rows: queue.map((item) => ({
      sessionId: item.sessionId,
      candidate: item.candidate,
      ticket: item.ticket,
      className: item.className,
      paperName: item.paperName,
      totalScore: item.totalScore,
      maxScore: item.maxScore,
      objectiveScore: item.objectiveScore,
      subjectiveScore: item.subjectiveScore,
      subjectivePending: item.subjectivePending,
      reviewStatus: item.reviewStatus,
      publishStatus: item.publishStatus,
      appealStatus: item.appealStatus,
      appealCount: item.appealCount,
      risk: item.risk,
      gradedAt: item.gradedAt,
      reviewedAt: item.reviewedAt,
      publishedAt: item.publishedAt,
      publishedBy: item.publishedBy,
    })),
    details: queue.flatMap((item) =>
      (item.details || []).map((detail) => ({
        sessionId: item.sessionId,
        candidate: item.candidate,
        ticket: item.ticket,
        questionId: detail.questionId,
        type: detail.type,
        score: detail.score,
        awarded: detail.awarded,
        status: detail.status,
        answer: detail.answer,
        aiComment: detail.aiComment || "",
        reviewerComment: detail.reviewerComment || "",
      })),
    ),
  };
}

function publishGradingResult(state = {}, sessionId, publisher = "admin") {
  const id = String(sessionId || "").trim();
  const result = state.gradingResults?.[id];
  if (!id || !result) return { error: "阅卷结果不存在", statusCode: 404 };
  if (result.reviewStatus !== "已完成" || Number(result.subjectivePending || 0) > 0) {
    return { error: "成绩尚未完成复核，不能发布", statusCode: 409, reviewStatus: result.reviewStatus || "待复核" };
  }
  const publishedAt = new Date().toISOString();
  const next = {
    ...result,
    publishStatus: "已发布",
    publishedAt,
    publishedBy: String(publisher || "admin").trim() || "admin",
  };
  state.gradingResults[id] = next;
  state.auditLog.push(logItem("grading-publish", `${id} 成绩已发布：${next.totalScore}/${next.maxScore}`, {
    sessionId: id,
    publishedBy: next.publishedBy,
    totalScore: next.totalScore,
    maxScore: next.maxScore,
  }));
  return next;
}

function submitCandidateAppeal(state = {}, sessionId, candidate = {}, body = {}) {
  const id = String(sessionId || "").trim();
  const result = state.gradingResults?.[id];
  const session = (state.sessions || []).find((item) => item.id === id);
  if (!session) return { error: "Session Not Found", statusCode: 404 };
  if (!result) return { error: "成绩不存在，暂不能申诉", statusCode: 404 };
  if (result.publishStatus !== "已发布") return { error: "成绩尚未发布，暂不能申诉", statusCode: 409 };
  const reason = String(body.reason || "").trim();
  if (reason.length < 5) return { error: "请填写至少 5 个字的申诉理由", statusCode: 400 };
  const openAppeal = (result.appeals || []).find((item) => item.status === "待处理");
  if (openAppeal) return { error: "已有待处理申诉，请等待处理结果", statusCode: 409, appeal: openAppeal };
  const appeal = {
    id: `appeal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    status: "待处理",
    reason,
    questionId: String(body.questionId || "").trim(),
    candidate: candidate.candidate || session.candidate || "",
    ticket: candidate.ticket || session.ticket || "",
    submittedAt: new Date().toISOString(),
  };
  result.appeals = [...(result.appeals || []), appeal];
  state.auditLog.push(logItem("grading-appeal", `${appeal.candidate || id} 提交成绩申诉`, {
    sessionId: id,
    appealId: appeal.id,
    ticket: appeal.ticket,
  }));
  return { submitted: true, appeal, gradingStatus: candidateGradingStatus(result) };
}

function resolveGradingAppeal(state = {}, body = {}, resolver = "admin") {
  const sessionId = String(body.sessionId || "").trim();
  const appealId = String(body.appealId || "").trim();
  const result = state.gradingResults?.[sessionId];
  if (!result) return { error: "阅卷结果不存在", statusCode: 404 };
  const appeal = (result.appeals || []).find((item) => item.id === appealId);
  if (!appeal) return { error: "申诉不存在", statusCode: 404 };
  if (appeal.status !== "待处理") return { error: "申诉已处理，不能重复处置", statusCode: 409, appeal };
  const action = String(body.action || "").trim();
  const resolution = String(body.resolution || "").trim();
  if (!["accept", "reject"].includes(action)) return { error: "申诉处理动作无效", statusCode: 400 };
  if (resolution.length < 3) return { error: "请填写处理说明", statusCode: 400 };
  appeal.status = action === "accept" ? "已受理" : "已驳回";
  appeal.resolution = resolution;
  appeal.resolvedAt = new Date().toISOString();
  appeal.resolvedBy = String(resolver || "admin").trim() || "admin";
  if (action === "accept") {
    result.publishStatus = "待重新发布";
  }
  state.auditLog.push(logItem("grading-appeal-resolve", `${sessionId} 成绩申诉${appeal.status}`, {
    sessionId,
    appealId,
    action,
    resolvedBy: appeal.resolvedBy,
  }));
  return { resolved: true, appeal, result };
}

function latestAppeal(result = {}) {
  const appeals = Array.isArray(result.appeals) ? result.appeals : [];
  return appeals.slice().sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0] || null;
}

function requiresAdminAuth(req, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  if (req.method === "GET" && ["/api/health", "/api/config"].includes(url.pathname)) return false;
  if (url.pathname.startsWith("/api/admin/")) return false;
  if (url.pathname.startsWith("/api/candidate/")) return false;
  return true;
}

function requiredAdminPermission(req, url) {
  const path = url.pathname;
  if (path === "/api/dashboard") return null;
  if (path.startsWith("/api/ai/") || path.startsWith("/api/quality/") || path.startsWith("/api/questions/")) return "authoring";
  if (path.startsWith("/api/papers/") || path === "/api/papers/build" || path === "/api/papers/publish") return "papers";
  if (path.startsWith("/api/participants") || path.startsWith("/api/candidates") || path.startsWith("/api/groups")) return "participants";
  if (path.startsWith("/api/assignments")) return "assignments";
  if (path.startsWith("/api/proctor")) return "proctor";
  if (path.startsWith("/api/grading")) return path === "/api/grading/export" ? "analysis" : "grading";
  if (path === "/api/analysis") return "analysis";
  return "system";
}

function requireAdminPermission(session = {}, permission) {
  if (!permission) return {};
  const permissions = Array.isArray(session.permissions) ? session.permissions : rolePermissions[session.role] || [];
  if (permissions.includes(permission) || permissions.includes("system")) return {};
  return {
    error: `无权访问该功能：需要 ${permission} 权限`,
    statusCode: 403,
    permission,
  };
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
  const role = rolePermissions[account.role] ? account.role : "admin";
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

function adminSessionRows(state, currentToken = "") {
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  return Object.entries(state.adminSessions || {})
    .map(([token, session]) => ({
      ...publicAdminSession(session),
      tokenHint: token.slice(0, 6),
      current: token === currentToken,
    }))
    .sort((a, b) => new Date(b.lastSeenAt || b.createdAt || 0) - new Date(a.lastSeenAt || a.createdAt || 0));
}

function revokeAdminSession(state, sessionId = "", actor = "admin") {
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const entry = Object.entries(state.adminSessions || {}).find(([, session]) => session.id === sessionId);
  if (!entry) return null;
  const [token, session] = entry;
  delete state.adminSessions[token];
  state.auditLog.push(logItem("admin-session-revoke", `${actor} 撤销 ${session.username || "admin"} 的运营会话`, {
    sessionId,
    targetUsername: session.username || "",
  }));
  return { revoked: true, session: publicAdminSession(session) };
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

function stateStats(state = {}) {
  return {
    questions: (state.questions || []).length,
    papers: (state.papers || []).length,
    participants: (state.candidates || []).length,
    groups: (state.groups || []).length,
    sessions: (state.sessions || []).length,
    gradingResults: Object.keys(state.gradingResults || {}).length,
    auditLog: (state.auditLog || []).length,
  };
}

function auditLogQuery(state = {}, url = new URL("http://local")) {
  const type = String(url.searchParams.get("type") || "").trim();
  const keyword = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
  const rows = (state.auditLog || [])
    .filter((item) => !type || item.type === type)
    .filter((item) => {
      if (!keyword) return true;
      return [item.type, item.message, item.sessionId, item.candidate, item.ticket, item.risk]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(keyword));
    })
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const types = [...new Set((state.auditLog || []).map((item) => item.type).filter(Boolean))].sort();
  return {
    total: rows.length,
    limit,
    types,
    rows: rows.slice(0, limit).map(publicAuditItem),
  };
}

function publicAuditItem(item = {}) {
  return {
    id: item.id || "",
    type: item.type || "",
    message: item.message || "",
    createdAt: item.createdAt || null,
    status: item.status || "",
    risk: item.risk || "",
    source: item.source || "",
    sessionId: item.sessionId || "",
    candidate: item.candidate || "",
    ticket: item.ticket || "",
    resolution: item.resolution || "",
    resolvedAt: item.resolvedAt || "",
    resolvedBy: item.resolvedBy || "",
    permission: item.permission || "",
  };
}

function buildAssignmentSummary(sessions = [], papers = []) {
  const publishedIds = new Set((papers || []).filter((item) => item.status === "已发布").map((item) => item.id));
  const byPaper = sessions.reduce((acc, session) => {
    const key = session.paperId || session.paperName || session.paper || "未绑定试卷";
    const label = session.paperName || session.paper || key;
    const current = acc.get(key) || { paperId: session.paperId || null, paperName: label, assigned: 0, active: 0, submitted: 0 };
    current.assigned += 1;
    if (session.status === "答题中") current.active += 1;
    if (session.status === "已提交") current.submitted += 1;
    acc.set(key, current);
    return acc;
  }, new Map());
  return {
    assigned: sessions.length,
    publishedPapers: publishedIds.size,
    waiting: sessions.filter((item) => item.status === "待开考").length,
    active: sessions.filter((item) => item.status === "答题中").length,
    submitted: sessions.filter((item) => item.status === "已提交").length,
    byPaper: [...byPaper.values()],
  };
}

function publishedPaperOptions(state) {
  const snapshots = (state.papers || []).filter((item) => item.status === "已发布");
  if (!snapshots.length && state.paper.status === "已发布") {
    return [buildPaper(state.questions, state.paper)];
  }
  return snapshots;
}

function publicCandidates(candidates = []) {
  return candidates.map(publicCandidate).filter(Boolean);
}

function publicCandidate(candidate) {
  if (!candidate) return null;
  const { passwordHash, loginToken, loginTokenExpiresAt, passwordMustChange, ...safe } = candidate;
  return {
    ...safe,
    hasPassword: Boolean(passwordHash),
    passwordMustChange: Boolean(passwordMustChange),
  };
}

function groupNameSet(state = {}) {
  return new Set((state.groups || []).map((item) => item.name));
}

function createGroup(state, body = {}) {
  state.groups = Array.isArray(state.groups) ? state.groups : [];
  const name = String(body.name || "").trim();
  if (!name) return { error: "分组名称不能为空", statusCode: 400 };
  if (state.groups.some((item) => item.name === name)) return { error: "分组名称已存在", statusCode: 409 };
  const now = new Date().toISOString();
  const group = {
    id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: String(body.description || "").trim(),
    createdAt: now,
    updatedAt: null,
  };
  state.groups.push(group);
  state.auditLog.push(logItem("group-create", `新建分组：${group.name}`));
  return group;
}

function updateGroup(state, id, body = {}) {
  state.groups = Array.isArray(state.groups) ? state.groups : [];
  const group = state.groups.find((item) => item.id === id || item.name === id);
  if (!group) return null;
  const nextName = String(body.name ?? group.name).trim();
  if (!nextName) return { error: "分组名称不能为空", statusCode: 400 };
  if (state.groups.some((item) => item.id !== group.id && item.name === nextName)) {
    return { error: "分组名称已存在", statusCode: 409 };
  }
  const previousName = group.name;
  group.name = nextName;
  group.description = String(body.description ?? group.description ?? "").trim();
  group.updatedAt = new Date().toISOString();
  if (previousName !== nextName) {
    (state.candidates || []).forEach((item) => {
      if (item.className === previousName) item.className = nextName;
    });
    (state.sessions || []).forEach((item) => {
      if (item.className === previousName) item.className = nextName;
    });
  }
  state.auditLog.push(logItem("group-update", `更新分组：${group.name}`));
  return group;
}

function deleteGroup(state, id) {
  state.groups = Array.isArray(state.groups) ? state.groups : [];
  const index = state.groups.findIndex((item) => item.id === id || item.name === id);
  if (index < 0) return null;
  const group = state.groups[index];
  if ((state.candidates || []).some((item) => item.className === group.name) || (state.sessions || []).some((item) => item.className === group.name)) {
    return { error: "分组已被使用，不能删除", statusCode: 409 };
  }
  state.groups.splice(index, 1);
  state.auditLog.push(logItem("group-delete", `删除分组：${group.name}`));
  return { deleted: true, group };
}

function previewAssignmentImport(body = {}, state = {}) {
  const candidates = normalizeCandidateRows(body.candidates || body.text || "");
  const candidateByPhone = new Map((state.candidates || []).map((item) => [normalizePhone(item.phone), item]).filter(([phone]) => Boolean(phone)));
  const groupNames = groupNameSet(state);
  const seen = new Set();
  const seenPhones = new Set();
  const paperId = String(body.paperId || "").trim();
  const startTime = String(body.startTime || state.exam?.windowStart || "10:00").trim();
  const endTime = String(body.endTime || state.exam?.windowEnd || "11:30").trim();
  const seenAssignments = new Set();
  const seenWindows = [];
  const rows = candidates.map((candidate, index) => {
    const errors = [];
    const existingCandidate = findCandidateByTicket(state, candidate.ticket);
    const phone = normalizePhone(candidate.phone || existingCandidate?.phone);
    const phoneOwner = candidateByPhone.get(phone);
    const duplicateKeys = assignmentDuplicateKeys({ ticket: candidate.ticket, phone, paperId, startTime, endTime });
    const assignmentWindow = { ticket: candidate.ticket, phone, paperId, startTime, endTime };
    if (!candidate.candidate) errors.push("缺少姓名");
    if (!candidate.ticket) errors.push("缺少编号");
    if (!phone) errors.push("缺少手机号");
    if (!candidate.className) errors.push("请选择分组");
    if (candidate.className && !groupNames.has(candidate.className)) errors.push("分组不存在");
    if (phoneOwner && phoneOwner.ticket !== candidate.ticket) errors.push("手机号已属于其他参与者");
    if (paperId && hasDuplicateAssignment(state, { ticket: candidate.ticket, phone, paperId, startTime, endTime })) errors.push("该参与者已分配同一试卷时段");
    if (hasTimeConflictAssignment(state, assignmentWindow)) errors.push("该参与者已有时间冲突的考试分配");
    if (candidate.ticket && seen.has(candidate.ticket)) errors.push("名单内编号重复");
    if (duplicateKeys.some((key) => seenAssignments.has(key))) errors.push("名单内重复分配同一试卷时段");
    if (seenWindows.some((window) => sameAssignmentParticipant(window, assignmentWindow) && timeRangesOverlap(window, assignmentWindow))) errors.push("名单内考试时间冲突");
    if (phone && seenPhones.has(phone)) errors.push("名单内手机号重复");
    if (candidate.ticket) seen.add(candidate.ticket);
    if (phone) seenPhones.add(phone);
    duplicateKeys.forEach((key) => seenAssignments.add(key));
    seenWindows.push(assignmentWindow);
    return { ...candidate, phone, row: index + 1, valid: errors.length === 0, errors };
  });
  return {
    rows,
    validCount: rows.filter((item) => item.valid).length,
    invalidCount: rows.filter((item) => !item.valid).length,
    papers: publishedPaperOptions(state),
  };
}

function previewCandidateImport(body = {}, state = {}) {
  const rows = normalizeCandidateRows(body.candidates || body.text || "");
  const reservedTickets = new Set();
  const reservedPhones = new Set();
  const previewRows = rows.map((candidate, index) => {
    const prepared = prepareCandidateForCreate(state, candidate, reservedTickets);
    const { errors, phone } = validateCandidatePayload(state, prepared, {
      batchTickets: reservedTickets,
      batchPhones: reservedPhones,
    });
    if (!errors.length) {
      reservedTickets.add(prepared.ticket);
      reservedPhones.add(phone);
    }
    return {
      ...prepared,
      phone,
      row: index + 1,
      generatedTicket: !candidate.ticket,
      valid: errors.length === 0,
      errors,
    };
  });
  return {
    rows: previewRows,
    validCount: previewRows.filter((item) => item.valid).length,
    invalidCount: previewRows.filter((item) => !item.valid).length,
  };
}

function createCandidateBatch(state, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  state.groups = Array.isArray(state.groups) ? state.groups : [];
  const rows = normalizeCandidateRows(body.candidates || body.text || [body]);
  if (!rows.length) return { error: "没有可添加的参与者", statusCode: 400 };

  const now = new Date().toISOString();
  const batchTickets = new Set();
  const batchPhones = new Set();
  const created = [];
  const skipped = [];

  rows.forEach((candidate, index) => {
    const prepared = prepareCandidateForCreate(state, candidate, batchTickets);
    const { errors, phone } = validateCandidatePayload(state, prepared, {
      batchTickets,
      batchPhones,
    });
    if (errors.length) {
      skipped.push({ ...prepared, index, errors });
      return;
    }

    batchTickets.add(prepared.ticket);
    batchPhones.add(phone);
    const record = {
      id: `cand-${prepared.ticket}`,
      candidate: prepared.candidate,
      ticket: prepared.ticket,
      className: prepared.className || "",
      phone,
      email: prepared.email || "",
      description: prepared.description || "",
      avatar: prepared.avatar || "",
      passwordHash: hashPassword(prepared.password || defaultCandidatePassword(phone)),
      passwordUpdatedAt: now,
      passwordMustChange: !prepared.password,
      tags: Array.isArray(prepared.tags) ? prepared.tags : [],
      disabledAt: null,
      createdAt: now,
      updatedAt: null,
    };
    state.candidates.push(record);
    created.push(record);
  });

  if (!created.length) {
    const firstErrors = skipped[0]?.errors || [];
    return { error: firstErrors[0] || "没有可添加的参与者", skipped, statusCode: skipped.length ? candidateErrorStatus(firstErrors) : 400 };
  }
  state.auditLog.push(logItem("candidate-create", `添加 ${created.length} 名参与者${skipped.length ? `，跳过 ${skipped.length} 名` : ""}`));
  return { candidates: created, skipped };
}

function updateCandidate(state, ticket, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const target = String(ticket || "").trim();
  const participant = state.candidates.find((item) => item.ticket === target || item.id === target);
  if (!participant) return null;
  const prepared = {
    ...participant,
    candidate: String(body.candidate ?? participant.candidate ?? "").trim(),
    className: String(body.className ?? participant.className ?? "").trim(),
    phone: String(body.phone ?? participant.phone ?? "").trim(),
    email: String(body.email ?? participant.email ?? "").trim(),
    description: String(body.description ?? participant.description ?? "").trim(),
    avatar: String(body.avatar ?? participant.avatar ?? "").trim(),
    password: body.password === undefined ? "" : String(body.password || "").trim(),
  };
  const { errors, phone } = validateCandidatePayload(state, prepared, { currentId: participant.id });
  if (errors.length) return { error: errors[0], errors, statusCode: candidateErrorStatus(errors) };
  Object.assign(participant, {
    candidate: prepared.candidate,
    className: prepared.className,
    phone,
    email: prepared.email,
    description: prepared.description,
    avatar: prepared.avatar,
    updatedAt: new Date().toISOString(),
  });
  if (prepared.password) {
    participant.passwordHash = hashPassword(prepared.password);
    participant.passwordUpdatedAt = participant.updatedAt;
    participant.passwordMustChange = Boolean(body.passwordMustChange);
    participant.loginToken = null;
    participant.loginTokenExpiresAt = null;
  }
  state.auditLog.push(logItem("participant-update", `更新参与者：${participant.candidate}`));
  return participant;
}

function deleteCandidate(state, ticket) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const target = String(ticket || "").trim();
  const candidate = state.candidates.find((item) => item.ticket === target || item.id === target);
  if (!candidate) return null;
  const related = participantRelatedSessions(state, candidate);
  if (related.length) {
    disableCandidateRecord(candidate);
    state.auditLog.push(logItem("candidate-disable", `停用参与者：${candidate.candidate}`));
    return { deleted: false, disabled: true, candidate, relatedSessions: related.length };
  }
  state.candidates = state.candidates.filter((item) => item.id !== candidate.id);
  state.auditLog.push(logItem("candidate-delete", `删除参与者：${candidate.candidate}`));
  return { deleted: true, candidate, relatedSessions: 0 };
}

function deleteCandidateBatch(state, tickets = []) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const targets = new Set((Array.isArray(tickets) ? tickets : []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!targets.size) return { error: "请选择要删除的参与者", statusCode: 400 };
  const deleted = [];
  const disabled = [];
  state.candidates = state.candidates.filter((item) => {
    const match = targets.has(item.ticket) || targets.has(item.id);
    if (!match) return true;
    if (participantRelatedSessions(state, item).length) {
      disableCandidateRecord(item);
      disabled.push(item);
      return true;
    }
    deleted.push(item);
    return false;
  });
  if (!deleted.length && !disabled.length) return { error: "未找到可删除的参与者", statusCode: 404 };
  state.auditLog.push(logItem("participant-delete-batch", `批量删除 ${deleted.length} 名参与者，停用 ${disabled.length} 名`));
  return { deleted: deleted.length > 0, disabled: disabled.length > 0, participants: deleted, disabledParticipants: disabled };
}

function prepareCandidateForCreate(state, candidate, reservedTickets = new Set()) {
  const prepared = {
    ...candidate,
    candidate: String(candidate.candidate || "").trim(),
    ticket: String(candidate.ticket || "").trim(),
    className: String(candidate.className || "").trim(),
    phone: String(candidate.phone || "").trim(),
    email: String(candidate.email || "").trim(),
    description: String(candidate.description || "").trim(),
    avatar: String(candidate.avatar || "").trim(),
    password: String(candidate.password || "").trim(),
  };
  if (!prepared.ticket) prepared.ticket = nextParticipantTicket(state, reservedTickets);
  return prepared;
}

function validateCandidatePayload(state, candidate, options = {}) {
  const errors = [];
  const phone = normalizePhone(candidate.phone);
  const email = String(candidate.email || "").trim();
  const password = String(candidate.password || "").trim();
  const currentId = options.currentId || "";
  if (!candidate.candidate) errors.push("参与者姓名不能为空");
  if (candidate.candidate && candidate.candidate.length > 40) errors.push("参与者姓名不能超过 40 个字符");
  if (!phone) errors.push("手机号不能为空");
  if (phone && !isValidPhone(phone)) errors.push("手机号格式不正确");
  if (!candidate.className) errors.push("请选择分组");
  if (candidate.className && !groupNameSet(state).has(candidate.className)) errors.push("分组不存在");
  if (!candidate.ticket) errors.push("编号不能为空");
  if (candidate.ticket && !/^[A-Za-z0-9_-]{3,32}$/.test(candidate.ticket)) errors.push("编号仅支持 3-32 位字母、数字、下划线或短横线");
  if (email && !isValidEmail(email)) errors.push("邮箱格式不正确");
  if (String(candidate.description || "").length > 300) errors.push("描述不能超过 300 个字符");
  if (String(candidate.avatar || "").length > 1_500_000) errors.push("图片过大，请压缩到 1MB 左右后上传");
  if (password && password.length < 6) errors.push("登录密码至少 6 位");
  if (candidate.ticket && (state.candidates || []).some((item) => item.id !== currentId && item.ticket === candidate.ticket)) errors.push("编号已存在");
  if (candidate.ticket && options.batchTickets?.has(candidate.ticket)) errors.push("名单内编号重复");
  if (phone && (state.candidates || []).some((item) => item.id !== currentId && normalizePhone(item.phone) === phone)) errors.push("手机号已存在");
  if (phone && options.batchPhones?.has(phone)) errors.push("名单内手机号重复");
  return { errors, phone };
}

function candidateErrorStatus(errors = []) {
  return errors.some((item) => item.includes("已存在") || item.includes("重复") || item.includes("分组不存在")) ? 409 : 400;
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || ""));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function participantRelatedSessions(state, candidate) {
  const phone = normalizePhone(candidate.phone);
  return (state.sessions || []).filter((session) => session.ticket === candidate.ticket || (phone && normalizePhone(session.phone) === phone));
}

function disableCandidateRecord(candidate) {
  candidate.disabledAt = new Date().toISOString();
  candidate.loginToken = null;
  candidate.loginTokenExpiresAt = null;
  candidate.updatedAt = candidate.disabledAt;
}

function resetCandidatePassword(state, ticket, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const target = String(ticket || "").trim();
  const candidate = state.candidates.find((item) => item.ticket === target || item.id === target);
  if (!candidate) return null;
  const password = String(body.password || defaultCandidatePassword(candidate.phone)).trim();
  if (password.length < 6) return { error: "登录密码至少 6 位", statusCode: 400 };
  candidate.passwordHash = hashPassword(password);
  candidate.passwordUpdatedAt = new Date().toISOString();
  candidate.passwordMustChange = body.passwordMustChange !== false;
  candidate.loginToken = null;
  candidate.loginTokenExpiresAt = null;
  candidate.updatedAt = candidate.passwordUpdatedAt;
  state.auditLog.push(logItem("candidate-password-reset", `重置参与者密码：${candidate.candidate}`));
  return {
    updated: true,
    password,
    candidate: publicCandidate(candidate),
  };
}

function updateCandidateStatus(state, ticket, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const target = String(ticket || "").trim();
  const candidate = state.candidates.find((item) => item.ticket === target || item.id === target);
  if (!candidate) return null;
  const disabled = body.disabled ?? body.status === "disabled";
  if (disabled) {
    disableCandidateRecord(candidate);
    state.auditLog.push(logItem("candidate-disable", `停用参与者：${candidate.candidate}`));
  } else {
    candidate.disabledAt = null;
    candidate.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem("candidate-enable", `启用参与者：${candidate.candidate}`));
  }
  return candidate;
}

function updateCandidateBatch(state, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const targets = new Set((Array.isArray(body.tickets || body.ids) ? body.tickets || body.ids : []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!targets.size) return { error: "请选择要更新的参与者", statusCode: 400 };
  const groupName = body.className !== undefined ? String(body.className || "").trim() : undefined;
  if (groupName !== undefined && !groupName) return { error: "请选择分组", statusCode: 400 };
  if (groupName && !groupNameSet(state).has(groupName)) return { error: "分组不存在", statusCode: 409 };
  const now = new Date().toISOString();
  const updated = [];
  state.candidates.forEach((candidate) => {
    if (!targets.has(candidate.ticket) && !targets.has(candidate.id)) return;
    if (groupName !== undefined) candidate.className = groupName;
    if (body.disabled !== undefined) {
      if (body.disabled) disableCandidateRecord(candidate);
      else {
        candidate.disabledAt = null;
        candidate.updatedAt = now;
      }
    }
    if (body.resetPassword) {
      candidate.passwordHash = hashPassword(defaultCandidatePassword(candidate.phone));
      candidate.passwordUpdatedAt = now;
      candidate.passwordMustChange = true;
      candidate.loginToken = null;
      candidate.loginTokenExpiresAt = null;
      candidate.updatedAt = now;
    }
    if (groupName !== undefined && body.disabled === undefined && !body.resetPassword) candidate.updatedAt = now;
    updated.push(candidate);
  });
  if (!updated.length) return { error: "未找到可更新的参与者", statusCode: 404 };
  state.auditLog.push(logItem("participant-batch-update", `批量更新 ${updated.length} 名参与者`));
  return { updated: true, participants: publicCandidates(updated) };
}

function nextParticipantTicket(state, reserved = new Set()) {
  const used = new Set([...(state.candidates || []).map((item) => item.ticket), ...(state.sessions || []).map((item) => item.ticket), ...reserved]);
  let index = used.size + 1;
  let ticket = "";
  do {
    ticket = `P${String(index).padStart(6, "0")}`;
    index += 1;
  } while (used.has(ticket));
  return ticket;
}

function createAssignmentBatch(state, body = {}) {
  const paper = resolveAssignablePaper(state, body.paperId);
  if (!paper) return { error: "请选择已发布试卷", statusCode: 409 };
  const candidates = normalizeCandidateRows(body.candidates || [body]);
  if (!candidates.length) return { error: "没有可分配的参与者", statusCode: 400 };

  const startTime = String(body.startTime || state.exam.windowStart || "10:00").trim();
  const endTime = String(body.endTime || state.exam.windowEnd || "11:30").trim();
  const candidateByPhone = new Map((state.candidates || []).map((item) => [normalizePhone(item.phone), item]).filter(([phone]) => Boolean(phone)));
  const groupNames = groupNameSet(state);
  const batchTickets = new Set();
  const batchPhones = new Set();
  const batchAssignments = new Set();
  const batchWindows = [];
  const created = [];
  const skipped = [];

  candidates.forEach((candidate, index) => {
    const errors = [];
    const existingCandidate = findCandidateByTicket(state, candidate.ticket);
    const phone = normalizePhone(candidate.phone || existingCandidate?.phone);
    const phoneOwner = candidateByPhone.get(phone);
    const duplicateKeys = assignmentDuplicateKeys({ ticket: candidate.ticket, phone, paperId: paper.id, startTime, endTime });
    const assignmentWindow = { ticket: candidate.ticket, phone, paperId: paper.id, startTime, endTime };
    if (!candidate.candidate) errors.push("参与者姓名不能为空");
    if (!candidate.ticket) errors.push("编号不能为空");
    if (!candidate.className) errors.push("请选择分组");
    if (!phone) errors.push("手机号不能为空");
    if (candidate.className && !groupNames.has(candidate.className)) errors.push("分组不存在");
    if (phoneOwner && phoneOwner.ticket !== candidate.ticket) errors.push("手机号已属于其他参与者");
    if (hasDuplicateAssignment(state, { ticket: candidate.ticket, phone, paperId: paper.id, startTime, endTime })) errors.push("该参与者已分配同一试卷时段");
    if (hasTimeConflictAssignment(state, assignmentWindow)) errors.push("该参与者已有时间冲突的考试分配");
    if (candidate.ticket && batchTickets.has(candidate.ticket)) errors.push("名单内编号重复");
    if (duplicateKeys.some((key) => batchAssignments.has(key))) errors.push("名单内重复分配同一试卷时段");
    if (batchWindows.some((window) => sameAssignmentParticipant(window, assignmentWindow) && timeRangesOverlap(window, assignmentWindow))) errors.push("名单内考试时间冲突");
    if (phone && batchPhones.has(phone)) errors.push("名单内手机号重复");
    if (errors.length) {
      skipped.push({ ...candidate, index, errors });
      return;
    }
    batchTickets.add(candidate.ticket);
    batchPhones.add(phone);
    duplicateKeys.forEach((key) => batchAssignments.add(key));
    batchWindows.push(assignmentWindow);
    const session = buildAssignedSession(state, {
      candidate: candidate.candidate,
      ticket: candidate.ticket,
      className: candidate.className,
      phone,
      email: candidate.email || existingCandidate?.email,
      paper,
      startTime,
      endTime,
      remark: body.remark,
    });
    state.sessions.push(session);
    state.answers[session.id] = {};
    created.push(session);
  });

  if (!created.length) {
    return { error: skipped[0]?.errors?.[0] || "没有可分配的参与者", skipped, statusCode: skipped.length ? 409 : 400 };
  }
  ensureCandidateRecords(state, candidates.filter((candidate) => created.some((session) => session.ticket === candidate.ticket)));
  state.auditLog.push(logItem("assignment-create", `分配 ${paper.name} 给 ${created.length} 名参与者${skipped.length ? `，跳过 ${skipped.length} 名` : ""}`));
  return { sessions: created, skipped, summary: buildAssignmentSummary(state.sessions, state.papers || []) };
}

function ensureCandidateRecords(state, candidates = []) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const existingTickets = new Set(state.candidates.map((item) => item.ticket));
  const existingPhones = new Set(state.candidates.map((item) => normalizePhone(item.phone)).filter(Boolean));
  const now = new Date().toISOString();
  candidates.forEach((candidate) => {
    const phone = normalizePhone(candidate.phone);
    if (!candidate.ticket || existingTickets.has(candidate.ticket) || !phone) return;
    if (existingPhones.has(phone)) return;
    state.candidates.push({
      id: `cand-${candidate.ticket}`,
      candidate: candidate.candidate,
      ticket: candidate.ticket,
      className: candidate.className || "",
      phone,
      email: candidate.email || "",
      description: candidate.description || "",
      avatar: candidate.avatar || "",
      passwordHash: hashPassword(candidate.password || defaultCandidatePassword(candidate.phone)),
      passwordUpdatedAt: now,
      passwordMustChange: !candidate.password,
      tags: [],
      disabledAt: null,
      createdAt: now,
      updatedAt: null,
    });
    existingTickets.add(candidate.ticket);
    existingPhones.add(phone);
  });
}

function hasDuplicateAssignment(state, assignment = {}, ignoreSessionId = "") {
  const targetKeys = new Set(assignmentDuplicateKeys(assignment));
  if (!targetKeys.size) return false;
  return (state.sessions || []).some((session) => {
    if (ignoreSessionId && session.id === ignoreSessionId) return false;
    return assignmentDuplicateKeys(session).some((key) => targetKeys.has(key));
  });
}

function hasTimeConflictAssignment(state, assignment = {}, ignoreSessionId = "") {
  return (state.sessions || []).some((session) => {
    if (ignoreSessionId && session.id === ignoreSessionId) return false;
    return sameAssignmentParticipant(session, assignment) && timeRangesOverlap(session, assignment);
  });
}

function sameAssignmentParticipant(left = {}, right = {}) {
  const leftTickets = new Set([String(left.ticket || "").trim()].filter(Boolean));
  const rightTickets = new Set([String(right.ticket || "").trim()].filter(Boolean));
  const leftPhones = new Set([normalizePhone(left.phone)].filter(Boolean));
  const rightPhones = new Set([normalizePhone(right.phone)].filter(Boolean));
  return [...leftTickets].some((ticket) => rightTickets.has(ticket)) || [...leftPhones].some((phone) => rightPhones.has(phone));
}

function timeRangesOverlap(left = {}, right = {}) {
  const leftRange = assignmentTimeRange(left);
  const rightRange = assignmentTimeRange(right);
  if (!leftRange || !rightRange) return false;
  return leftRange.start < rightRange.end && rightRange.start < leftRange.end;
}

function assignmentTimeRange(assignment = {}) {
  const [timeStart = "", timeEnd = ""] = String(assignment.time || "").split("-");
  const start = parseExamDate(assignment.startTime || timeStart);
  const end = parseExamDate(assignment.endTime || timeEnd);
  if (!start || !end) return null;
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;
  return { start: startTime, end: endTime };
}

function assignmentDuplicateKeys(assignment = {}) {
  const participantKeys = [
    String(assignment.ticket || "").trim(),
    normalizePhone(assignment.phone),
  ].filter(Boolean);
  const paperId = String(assignment.paperId || "").trim();
  const startTime = String(assignment.startTime || "").trim();
  const endTime = String(assignment.endTime || "").trim();
  if (!participantKeys.length || !paperId || !startTime || !endTime) return [];
  return [...new Set(participantKeys)].map((participantKey) => `${participantKey}|${paperId}|${startTime}|${endTime}`);
}

function updateAssignment(state, id, body = {}) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return null;
  if (session.status === "已提交") return { error: "已提交会话不能修改分配", statusCode: 409 };
  const nextTicket = String(body.ticket || session.ticket).trim();
  if (!nextTicket) return { error: "编号不能为空", statusCode: 400 };
  const paper = body.paperId ? resolveAssignablePaper(state, body.paperId) : resolveSessionPaper(state, session);
  if (!paper) return { error: "请选择已发布试卷", statusCode: 409 };
  const startTime = String(body.startTime || session.startTime || session.time?.split("-")[0] || state.exam.windowStart || "10:00").trim();
  const endTime = String(body.endTime || session.endTime || session.time?.split("-")[1] || state.exam.windowEnd || "11:30").trim();
  const nextPhone = normalizePhone(body.phone || session.phone);
  if (hasDuplicateAssignment(state, { ticket: nextTicket, phone: nextPhone, paperId: paper.id, startTime, endTime }, id)) {
    return { error: "该参与者已分配同一试卷时段", ticket: nextTicket, statusCode: 409 };
  }
  if (hasTimeConflictAssignment(state, { ticket: nextTicket, phone: nextPhone, paperId: paper.id, startTime, endTime }, id)) {
    return { error: "该参与者已有时间冲突的考试分配", ticket: nextTicket, statusCode: 409 };
  }
  Object.assign(session, {
    candidate: String(body.candidate || session.candidate).trim(),
    ticket: nextTicket,
    className: body.className ?? session.className,
    phone: nextPhone || session.phone || "",
    email: String(body.email ?? session.email ?? "").trim(),
    remark: String(body.remark ?? session.remark ?? "").trim(),
    paperId: paper.id,
    paperName: paper.name,
    paper: paper.name,
    paperSnapshotVersion: paper.publishedAt || paper.createdAt || null,
    startTime,
    endTime,
    time: `${startTime}-${endTime}`,
    remainingMinutes: minutesBetween(startTime, endTime),
  });
  state.auditLog.push(logItem("assignment-update", `${session.candidate} 分配信息已更新`));
  return session;
}

function deleteAssignment(state, id) {
  const index = state.sessions.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const session = state.sessions[index];
  if (session.status === "已提交") return { error: "已提交会话不能撤销", statusCode: 409 };
  state.sessions.splice(index, 1);
  delete state.answers[id];
  delete state.gradingResults[id];
  state.auditLog.push(logItem("assignment-delete", `撤销 ${session.candidate} 的考试分配`));
  return { deleted: true, session };
}

function deleteAssignmentBatch(state, ids = []) {
  const targets = new Set((Array.isArray(ids) ? ids : []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!targets.size) return { error: "请选择要删除的试卷分配", statusCode: 400 };
  const blocked = state.sessions.filter((item) => targets.has(item.id) && item.status === "已提交");
  if (blocked.length) return { error: "已提交会话不能撤销", blocked, statusCode: 409 };
  const deleted = [];
  state.sessions = state.sessions.filter((item) => {
    const match = targets.has(item.id);
    if (match) deleted.push(item);
    return !match;
  });
  if (!deleted.length) return { error: "未找到可删除的试卷分配", statusCode: 404 };
  deleted.forEach((session) => {
    delete state.answers[session.id];
    delete state.gradingResults[session.id];
  });
  state.auditLog.push(logItem("assignment-delete-batch", `批量撤销 ${deleted.length} 条试卷分配`));
  return { deleted: true, sessions: deleted };
}

function loginCandidate(state, body = {}, req = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const phone = normalizePhone(body.phone);
  const password = String(body.password || "");
  if (!phone || !password) return { error: "请输入手机号和密码", statusCode: 400 };
  const attemptKey = loginAttemptKey("candidate", phone || "unknown", req);
  const limit = checkLoginLimit(state, attemptKey);
  if (limit.blocked) {
    state.auditLog.push(logItem("candidate-login-blocked", `${phone || "unknown"} 考生登录被限流`, {
      phone,
      retryAfterSeconds: limit.retryAfterSeconds,
    }));
    return loginLockedResponse(limit);
  }
  const matches = state.candidates.filter((item) => normalizePhone(item.phone) === phone);
  if (matches.length > 1) return { error: "手机号存在重复，请联系管理员处理", statusCode: 409 };
  const candidate = matches[0];
  if (!candidate) {
    const failure = recordLoginFailure(state, attemptKey);
    state.auditLog.push(logItem("candidate-login-failed", `${phone || "unknown"} 考生登录失败`, {
      phone,
      failures: failure.failures,
      lockedUntil: failure.lockedUntil || null,
    }));
    return { error: "手机号或密码错误", statusCode: 401 };
  }
  if (candidate.disabledAt) return { error: "账号已停用，请联系管理员", statusCode: 403 };
  if (!candidate.passwordHash) {
    candidate.passwordHash = hashPassword(defaultCandidatePassword(candidate.phone));
    candidate.passwordUpdatedAt = new Date().toISOString();
    candidate.passwordMustChange = true;
  }
  if (!verifyPassword(password, candidate.passwordHash)) {
    const failure = recordLoginFailure(state, attemptKey);
    state.auditLog.push(logItem("candidate-login-failed", `${candidate.candidate} 考生登录失败`, {
      phone,
      ticket: candidate.ticket,
      failures: failure.failures,
      lockedUntil: failure.lockedUntil || null,
    }));
    return { error: "手机号或密码错误", statusCode: 401 };
  }
  clearLoginFailures(state, attemptKey);
  const token = randomToken(32);
  candidate.loginToken = token;
  candidate.loginTokenExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  candidate.lastLoginAt = new Date().toISOString();
  state.auditLog.push(logItem("candidate-login", `${candidate.candidate} 登录考生系统`));
  return {
    token,
    expiresAt: candidate.loginTokenExpiresAt,
    candidate: publicCandidate(candidate),
    exams: candidateExamList(state, candidate).exams,
  };
}

function changeCandidatePassword(state, candidateId, body = {}) {
  const candidate = (state.candidates || []).find((item) => item.id === candidateId);
  if (!candidate) return { error: "考生不存在", statusCode: 404 };
  const currentPassword = String(body.currentPassword || "");
  const nextPassword = String(body.newPassword || "");
  if (!currentPassword || !nextPassword) return { error: "请输入当前密码和新密码", statusCode: 400 };
  if (nextPassword.length < 6) return { error: "新密码至少 6 位", statusCode: 400 };
  if (!candidate.passwordHash || !verifyPassword(currentPassword, candidate.passwordHash)) {
    return { error: "当前密码错误", statusCode: 401 };
  }
  candidate.passwordHash = hashPassword(nextPassword);
  candidate.passwordUpdatedAt = new Date().toISOString();
  candidate.passwordMustChange = false;
  candidate.loginToken = null;
  candidate.loginTokenExpiresAt = null;
  state.auditLog.push(logItem("candidate-password", `${candidate.candidate} 修改登录密码`));
  return { updated: true };
}

function authenticateCandidate(state, token, sessionId = "") {
  const value = String(token || "").trim();
  if (!value) return { error: "请先登录考生系统", statusCode: 401 };
  const candidate = (state.candidates || []).find((item) => item.loginToken === value);
  if (!candidate) return { error: "登录已失效，请重新登录", statusCode: 401 };
  if (candidate.disabledAt) return { error: "账号已停用，请联系管理员", statusCode: 403 };
  const expiresAt = new Date(candidate.loginTokenExpiresAt || 0).getTime();
  if (!expiresAt || expiresAt < Date.now()) return { error: "登录已过期，请重新登录", statusCode: 401 };
  if (sessionId) {
    const session = (state.sessions || []).find((item) => item.id === sessionId);
    if (!session) return { error: "Session Not Found", statusCode: 404 };
    if (session.ticket !== candidate.ticket && normalizePhone(session.phone) !== normalizePhone(candidate.phone)) {
      return { error: "无权访问该考试", statusCode: 403 };
    }
  }
  return { candidate };
}

function authToken(req, url) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return url.searchParams.get("token") || "";
}

function candidateExamList(state, candidate) {
  const exams = (state.sessions || [])
    .filter(() => !candidate.disabledAt)
    .filter((session) => session.ticket === candidate.ticket || normalizePhone(session.phone) === normalizePhone(candidate.phone))
    .map((session) => {
      const paper = resolveSessionPaper(state, session);
      const access = buildAccessState(paper, session, state.proctorRules);
      const decorated = decorateCandidateSession(session, access);
      return {
        id: decorated.id,
        candidate: decorated.candidate,
        ticket: decorated.ticket,
        className: decorated.className || "",
        paperId: decorated.paperId || null,
        paperName: decorated.paperName || decorated.paper || paper.name || "",
        startTime: decorated.startTime || "",
        endTime: decorated.endTime || "",
        time: decorated.time || "",
        status: decorated.status || "待开考",
        displayStatus: access.displayStatus,
        progress: Number(decorated.progress || 0),
        remark: decorated.remark || "",
        canEnter: access.canEnter,
        canSave: access.canSave,
        canSubmit: access.canSubmit,
        canReview: access.canReview,
        paperStatus: paper.status,
        message: access.message,
        remainingMinutes: access.remainingMinutes,
        resultAvailable: Boolean((state.gradingResults || {})[session.id]),
        resultPublished: (state.gradingResults || {})[session.id]?.publishStatus === "已发布",
        publishStatus: (state.gradingResults || {})[session.id]?.publishStatus || "未发布",
      };
    });
  return { candidate: publicCandidate(candidate), exams };
}

function candidateGradingStatus(result = {}) {
  const appeal = latestAppeal(result);
  return {
    reviewStatus: result.reviewStatus || "待复核",
    publishStatus: result.publishStatus || "未发布",
    appealStatus: appeal?.status || "无申诉",
    latestAppeal: appeal,
    gradedAt: result.gradedAt || null,
    reviewedAt: result.reviewedAt || null,
    publishedAt: result.publishedAt || null,
    message: result.publishStatus === "已发布" ? "成绩已发布" : result.reviewStatus === "已完成" ? "成绩已复核，等待发布" : "成绩复核中，暂不可查看分数",
  };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(password, stored = "") {
  const [scheme, iterations, salt, hash] = String(stored || "").split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const computed = pbkdf2Sync(String(password || ""), salt, Number(iterations), 32, "sha256");
  const expected = Buffer.from(hash, "hex");
  return expected.length === computed.length && timingSafeEqual(expected, computed);
}

function defaultCandidatePassword(phone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-6) || "123456";
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

function resolveAssignablePaper(state, paperId) {
  const papers = publishedPaperOptions(state);
  if (!papers.length) return null;
  const target = paperId ? papers.find((item) => item.id === paperId) : papers[0];
  return target && target.status === "已发布" ? paperSnapshotDetail(target, state.questions) : null;
}

function resolveSessionPaper(state, session = {}) {
  if (session.paperId) {
    const target = (state.papers || []).find((item) => item.id === session.paperId);
    if (target) return paperSnapshotDetail(target, state.questions);
    return {
      id: session.paperId,
      name: session.paperName || session.paper || "已删除试卷",
      status: null,
      score: 0,
      questionCount: 0,
      questionIds: [],
      questions: [],
    };
  }
  if (Array.isArray(state.questions) && state.questions.length) return buildPaper(state.questions, state.paper);
  return {
    id: session.paperId || null,
    name: session.paperName || session.paper || "",
    status: null,
    score: 0,
    questionCount: 0,
    questionIds: [],
    questions: [],
  };
}

function questionsForAssignedSession(state, session = {}) {
  const paper = resolveSessionPaper(state, session);
  const sourceQuestions = Array.isArray(paper.questions) && paper.questions.length ? paper.questions : state.questions;
  return paperQuestionsForSession({ ...session, paper: "A 卷" }, sourceQuestions, paper);
}

function normalizeAnswerMap(input = {}, questions = []) {
  const source = input && typeof input === "object" ? input : {};
  const answers = {};
  const errors = [];
  const questionIds = new Set(questions.map((item) => item.id));
  Object.keys(source).forEach((id) => {
    if (!questionIds.has(id)) errors.push(`答案包含无效题目：${id}`);
  });

  questions.forEach((question) => {
    const value = source[question.id];
    if (value === undefined || value === null) return;
    if (question.type === "多选") {
      if (!Array.isArray(value)) {
        errors.push(`${question.id} 应提交多选答案数组`);
        return;
      }
      const optionSet = new Set((question.options || []).map((_, index) => String.fromCharCode(65 + index)));
      const selected = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].sort();
      const invalid = selected.filter((item) => !optionSet.has(item));
      if (invalid.length) {
        errors.push(`${question.id} 包含无效选项：${invalid.join("、")}`);
        return;
      }
      if (selected.length) answers[question.id] = selected;
      return;
    }

    const text = String(value || "").trim();
    if (!text) return;
    if (["单选", "判断"].includes(question.type)) {
      const allowed = question.type === "判断"
        ? ["正确", "错误"]
        : (question.options || []).map((_, index) => String.fromCharCode(65 + index));
      if (!allowed.includes(text)) {
        errors.push(`${question.id} 包含无效选项：${text}`);
        return;
      }
    }
    answers[question.id] = text;
  });

  return { answers, errors };
}

function submitSessionAnswers(state, session, options = {}) {
  const submittedAt = options.submittedAt || new Date().toISOString();
  const id = session.id;
  state.answers[id] = state.answers[id] || {};
  const questions = questionsForAssignedSession(state, session);
  const grading = {
    ...gradeAnswers(state.answers[id], questions),
    gradedAt: submittedAt,
    submissionSource: options.source || "candidate",
  };
  session.status = "已提交";
  session.progress = 100;
  session.remainingMinutes = 0;
  session.submittedAt = submittedAt;
  session.submissionSource = options.source || "candidate";
  if (options.controlStatus) session.controlStatus = options.controlStatus;
  state.gradingResults[id] = grading;
  return grading;
}

function buildAssignedSession(state, assignment) {
  const id = nextSessionId(state.sessions);
  return {
    id,
    candidate: assignment.candidate,
    ticket: assignment.ticket,
    className: assignment.className || "",
    phone: assignment.phone || "",
    email: assignment.email || "",
    remark: String(assignment.remark || "").trim(),
    paperId: assignment.paper.id,
    paperName: assignment.paper.name,
    paper: assignment.paper.name,
    paperSnapshotVersion: assignment.paper.publishedAt || assignment.paper.createdAt || null,
    time: `${assignment.startTime}-${assignment.endTime}`,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    remainingMinutes: minutesBetween(assignment.startTime, assignment.endTime),
    progress: 0,
    status: "待开考",
    risk: "低",
    events: [],
    device: { fullscreen: "未知", clipboard: "正常" },
    messages: [],
    controls: [],
    controlStatus: "正常",
    accessToken: randomToken(),
    assignedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function normalizeCandidateRows(input) {
  if (typeof input === "string") {
    return input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [candidate, ticket, className, phone, email, description, password] = line.split(/[,，\t]/).map((item) => String(item || "").trim());
        return { candidate, ticket, className: className || "", phone: phone || "", email: email || "", description: description || "", password: password || "" };
      });
  }
  const rows = Array.isArray(input) ? input : [input];
  return rows
    .map((item) => ({
      candidate: String(item.candidate || item.name || "").trim(),
      ticket: String(item.ticket || "").trim(),
      className: String(item.className || item.class || "").trim(),
      phone: String(item.phone || item.mobile || "").trim(),
      email: String(item.email || "").trim(),
      description: String(item.description || item.remark || "").trim(),
      avatar: String(item.avatar || "").trim(),
      password: String(item.password || "").trim(),
    }))
    .filter((item) => item.candidate || item.ticket || item.className || item.phone || item.email || item.description);
}

function findCandidateByTicket(state, ticket = "") {
  const target = String(ticket || "").trim();
  if (!target) return null;
  return (state.candidates || []).find((item) => item.ticket === target || item.id === target) || null;
}

function normalizePhone(value = "") {
  return String(value || "").trim();
}

function randomToken(size = 16) {
  return randomBytes(size).toString("base64url");
}

function invalidateExamProgress(state, reason) {
  state.answers = Object.fromEntries(state.sessions.map((session) => [session.id, {}]));
  state.gradingResults = {};
  state.sessions.forEach((session) => {
    if (session.status !== "离线") {
      session.status = "待开考";
      session.progress = 0;
      session.remainingMinutes = minutesBetween(session.time?.split("-")[0], session.time?.split("-")[1]);
      session.autoSubmitDisabledAt = new Date().toISOString();
    }
  });
  state.auditLog.push(logItem("exam-invalidate", `${reason}，已清空答卷、阅卷结果并重置考试状态`));
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

function buildAccessState(paper, session, proctorRules = {}) {
  const published = paper.status === "已发布";
  const submitted = session.status === "已提交";
  const timing = sessionTiming(session);
  const active = timing.state === "active";
  const blockedByControl = ["已暂停", "已锁定"].includes(session.controlStatus);
  const compliance = buildProctorCompliance(session, proctorRules);
  const canReview = submitted;
  const canEnter = published && (active || canReview);
  const canSave = published && active && !submitted && !blockedByControl;
  const canSubmit = published && active && !submitted && !blockedByControl && compliance.ok;
  return {
    canEnter,
    canSave,
    canSubmit,
    canReview,
    paperStatus: paper.status,
    sessionStatus: session.status,
    timingStatus: timing.state,
    controlStatus: session.controlStatus || "正常",
    compliance,
    displayStatus: displayCandidateStatus(session, timing),
    remainingMinutes: timing.remainingMinutes,
    startsAt: timing.startsAt,
    endsAt: timing.endsAt,
    message: compliance.ok ? buildAccessMessage(published, timing.state, submitted, session.controlStatus) : compliance.message,
  };
}

function buildProctorCompliance(session = {}, proctorRules = {}) {
  const rules = normalizeProctorRules(proctorRules);
  const device = session.device || {};
  const failures = [];
  if (rules.requireFullscreen && device.fullscreen !== "active") failures.push("未保持全屏");
  return {
    ok: failures.length === 0,
    failures,
    requirements: {
      fullscreen: rules.requireFullscreen,
    },
    message: failures.length ? `设备合规未通过：${failures.join("、")}，请按要求完成后提交` : "",
  };
}

function buildAccessMessage(published, timingStatus, submitted, controlStatus = "正常") {
  if (submitted) return "试卷已提交，不能重复保存或提交";
  if (controlStatus === "已暂停") return "考试已被监考员暂停，请等待恢复";
  if (controlStatus === "已锁定") return "答题已被监考员锁定，请联系监考员";
  if (!published) return "试卷尚未发布，可预览并保存草稿，暂不能提交";
  if (timingStatus === "notStarted") return "考试尚未开始，请在开始时间后进入";
  if (timingStatus === "ended") return "考试已结束，不能继续保存或提交";
  return "考试已发布，可以提交试卷";
}

function displayCandidateStatus(session, timing) {
  if (session.status === "已提交") return "已提交";
  if (session.controlStatus === "已暂停") return "已暂停";
  if (session.controlStatus === "已锁定") return "已锁定";
  if (timing.state === "notStarted") return "待开考";
  if (timing.state === "ended") return "已结束";
  return "答题中";
}

function decorateCandidateSession(session, access) {
  return {
    ...session,
    status: access.displayStatus,
    remainingMinutes: access.remainingMinutes,
    messages: session.messages || [],
    controlStatus: access.controlStatus,
  };
}

function sessionTiming(session = {}, now = new Date()) {
  const { start, end } = parseSessionTimeRange(session);
  const current = now.getTime();
  if (start && current < start.getTime()) {
    return {
      state: "notStarted",
      startsAt: start.toISOString(),
      endsAt: end ? end.toISOString() : null,
      remainingMinutes: end ? Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 60000)) : 0,
    };
  }
  if (end && current > end.getTime()) {
    return {
      state: "ended",
      startsAt: start ? start.toISOString() : null,
      endsAt: end.toISOString(),
      remainingMinutes: 0,
    };
  }
  return {
    state: "active",
    startsAt: start ? start.toISOString() : null,
    endsAt: end ? end.toISOString() : null,
    remainingMinutes: end ? Math.max(0, Math.ceil((end.getTime() - current) / 60000)) : Number(session.remainingMinutes || 0),
  };
}

function parseSessionTimeRange(session = {}) {
  const [timeStart = "", timeEnd = ""] = String(session.time || "").split("-");
  const startText = session.startTime || timeStart;
  const endText = session.endTime || timeEnd;
  return {
    start: parseExamDate(startText),
    end: parseExamDate(endText),
  };
}

function parseExamDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(text)) return parsed;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextSessionId(sessions = []) {
  let id = "";
  do {
    id = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (sessions.some((item) => item.id === id));
  return id;
}

function minutesBetween(start, end) {
  const startMinutes = parseTimePoint(start);
  const endMinutes = parseTimePoint(end);
  if (endMinutes <= startMinutes) return 0;
  return endMinutes - startMinutes;
}

function parseTimePoint(value) {
  const text = String(value || "").trim();
  const date = new Date(text);
  if (!Number.isNaN(date.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(text)) {
    return Math.round(date.getTime() / 60000);
  }
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
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
  const data = await readFile(filePath);
  res.writeHead(200, { ...securityHeaders(), "content-type": contentType(filePath) });
  res.end(data);
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

function resolvePresenceStatus() {
  const redisUrl = String(process.env.SMARTQ_REDIS_URL || "").trim();
  const configuredAdapter = String(process.env.SMARTQ_PRESENCE_ADAPTER || "").trim().toLowerCase();
  const requestedAdapter = configuredAdapter || (redisUrl ? "redis" : "memory");
  if (requestedAdapter === "redis" || redisUrl) {
    return {
      requestedAdapter: "redis",
      effectiveAdapter: redisUrl ? "redis" : "memory",
      degraded: !redisUrl,
      reason: redisUrl ? "" : "Redis presence adapter requested but SMARTQ_REDIS_URL is empty; using memory presence store.",
      redisConfigured: Boolean(redisUrl),
    };
  }
  if (requestedAdapter !== "memory") {
    return {
      requestedAdapter,
      effectiveAdapter: "memory",
      degraded: true,
      reason: `Unsupported presence adapter "${requestedAdapter}"; using memory presence store.`,
      redisConfigured: Boolean(redisUrl),
    };
  }
  return {
    requestedAdapter: "memory",
    effectiveAdapter: "memory",
    degraded: false,
    reason: "",
    redisConfigured: false,
  };
}

async function presenceRuntimeStatus() {
  if (!redisPresence) return presenceStatus;
  const reachable = await redisPresence.ping().catch(() => false);
  return {
    ...presenceStatus,
    effectiveAdapter: reachable ? "redis" : "memory",
    degraded: !reachable,
    reason: reachable ? "" : "Redis presence adapter is configured but unreachable; using memory presence mirror.",
    redisConfigured: presenceStatus.redisConfigured,
    redisReachable: reachable,
  };
}

function createRedisPresenceAdapter(redisUrl, ttlMs) {
  const config = parseRedisUrl(redisUrl);
  if (!config) return null;
  const namespace = String(process.env.SMARTQ_REDIS_NAMESPACE || "smartq").replace(/[^a-zA-Z0-9:_-]/g, "") || "smartq";
  const ttlSeconds = Math.max(1, Math.ceil((ttlMs * 4) / 1000));
  const keyFor = (sessionId) => `${namespace}:presence:${sessionId}`;
  return {
    async ping() {
      const result = await redisCommand(config, ["PING"]);
      return result === "PONG";
    },
    async set(sessionId, value = {}) {
      await redisCommand(config, ["SETEX", keyFor(sessionId), String(ttlSeconds), JSON.stringify(value)]);
    },
    async getMany(ids = []) {
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      if (!uniqueIds.length) return {};
      const values = await redisCommand(config, ["MGET", ...uniqueIds.map(keyFor)]);
      const result = {};
      uniqueIds.forEach((id, index) => {
        const raw = Array.isArray(values) ? values[index] : null;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") result[id] = parsed;
        } catch { }
      });
      return result;
    },
  };
}

function parseRedisUrl(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["redis:", "rediss:"].includes(url.protocol)) return null;
    const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;
    return {
      host: url.hostname || "127.0.0.1",
      port: Number(url.port || 6379),
      tls: url.protocol === "rediss:",
      username: decodeURIComponent(url.username || ""),
      password: decodeURIComponent(url.password || ""),
      db: Number.isInteger(db) && db > 0 ? db : 0,
      timeoutMs: Math.max(100, Math.min(5000, Number(process.env.SMARTQ_REDIS_TIMEOUT_MS || 500))),
    };
  } catch {
    return null;
  }
}

async function redisCommand(config, command = []) {
  return new Promise((resolve, reject) => {
    const socket = (config.tls ? tls.connect : net.connect)({ host: config.host, port: config.port });
    let buffer = Buffer.alloc(0);
    const commands = [];
    if (config.password) commands.push(config.username ? ["AUTH", config.username, config.password] : ["AUTH", config.password]);
    if (config.db) commands.push(["SELECT", String(config.db)]);
    commands.push(command);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Redis command timed out"));
    }, config.timeoutMs);
    socket.on("connect", () => {
      socket.write(commands.map(encodeRedisCommand).join(""));
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseRedisResponses(buffer, commands.length);
      if (!parsed.complete) return;
      clearTimeout(timer);
      socket.end();
      const error = parsed.responses.find((item) => item instanceof Error);
      if (error) reject(error);
      else resolve(parsed.responses.at(-1));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function encodeRedisCommand(parts = []) {
  return `*${parts.length}\r\n${parts.map((part) => {
    const value = Buffer.from(String(part));
    return `$${value.length}\r\n${value.toString()}\r\n`;
  }).join("")}`;
}

function parseRedisResponses(buffer, expectedCount) {
  const responses = [];
  let offset = 0;
  while (responses.length < expectedCount) {
    const parsed = parseRedisValue(buffer, offset);
    if (!parsed) return { complete: false, responses };
    responses.push(parsed.value);
    offset = parsed.offset;
  }
  return { complete: true, responses };
}

function parseRedisValue(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd < 0) return null;
  const line = buffer.slice(offset + 1, lineEnd).toString();
  const nextOffset = lineEnd + 2;
  if (prefix === "+") return { value: line, offset: nextOffset };
  if (prefix === "-") return { value: new Error(line), offset: nextOffset };
  if (prefix === ":") return { value: Number(line), offset: nextOffset };
  if (prefix === "$") {
    const length = Number(line);
    if (length === -1) return { value: null, offset: nextOffset };
    const end = nextOffset + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.slice(nextOffset, end).toString(), offset: end + 2 };
  }
  if (prefix === "*") {
    const count = Number(line);
    if (count === -1) return { value: null, offset: nextOffset };
    const values = [];
    let cursor = nextOffset;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseRedisValue(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  return { value: new Error("Unsupported Redis response"), offset: nextOffset };
}

function resolveEvidenceStatus() {
  const configuredAdapter = String(process.env.SMARTQ_EVIDENCE_ADAPTER || "").trim().toLowerCase();
  const bucket = String(process.env.SMARTQ_EVIDENCE_BUCKET || "").trim();
  const endpoint = String(process.env.SMARTQ_EVIDENCE_ENDPOINT || "").trim();
  const accessKey = String(process.env.SMARTQ_EVIDENCE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretKey = String(process.env.SMARTQ_EVIDENCE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const requestedAdapter = configuredAdapter || (bucket || endpoint ? "object-storage" : "local-file");
  if (["s3", "oss", "cos", "object-storage"].includes(requestedAdapter) || bucket || endpoint) {
    const configured = Boolean(bucket && endpoint && accessKey && secretKey);
    return {
      requestedAdapter: ["s3", "oss", "cos"].includes(requestedAdapter) ? requestedAdapter : "object-storage",
      effectiveAdapter: configured ? "object-storage" : "local-file",
      degraded: !configured,
      reason: configured ? "" : "Object storage evidence adapter requested but endpoint, bucket or credentials are missing; using local file evidence store.",
      bucketConfigured: Boolean(bucket),
      endpointConfigured: Boolean(endpoint),
      credentialsConfigured: Boolean(accessKey && secretKey),
    };
  }
  if (requestedAdapter !== "local-file") {
    return {
      requestedAdapter,
      effectiveAdapter: "local-file",
      degraded: true,
      reason: `Unsupported evidence adapter "${requestedAdapter}"; using local file evidence store.`,
      bucketConfigured: Boolean(bucket),
      endpointConfigured: Boolean(endpoint),
      credentialsConfigured: Boolean(accessKey && secretKey),
    };
  }
  return {
    requestedAdapter: "local-file",
    effectiveAdapter: "local-file",
    degraded: false,
    reason: "",
    bucketConfigured: false,
    endpointConfigured: false,
    credentialsConfigured: false,
  };
}

async function evidenceRuntimeStatus() {
  if (!objectEvidence) return evidenceStatus;
  const reachable = await objectEvidence.ping().catch(() => false);
  return {
    ...evidenceStatus,
    effectiveAdapter: reachable ? "object-storage" : "local-file",
    degraded: !reachable,
    reason: reachable ? "" : "Object storage evidence adapter is configured but unreachable; using local file evidence store.",
    objectStorageReachable: reachable,
  };
}

function createObjectEvidenceAdapter() {
  const config = parseObjectEvidenceConfig();
  if (!config) return null;
  return {
    async ping() {
      const result = await objectEvidenceRequest(config, "HEAD", "");
      return result.statusCode >= 200 && result.statusCode < 500;
    },
    async put(key, buffer, contentType, sha256) {
      const result = await objectEvidenceRequest(config, "PUT", key, {
        body: buffer,
        headers: {
          "content-type": contentType,
          "x-amz-meta-sha256": sha256,
        },
      });
      if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`Object evidence upload failed: ${result.statusCode}`);
      return { storageAdapter: "object-storage", key };
    },
    async get(key) {
      const result = await objectEvidenceRequest(config, "GET", key);
      if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`Object evidence download failed: ${result.statusCode}`);
      return result.body;
    },
  };
}

function parseObjectEvidenceConfig() {
  const endpoint = String(process.env.SMARTQ_EVIDENCE_ENDPOINT || "").trim();
  const bucket = String(process.env.SMARTQ_EVIDENCE_BUCKET || "").trim();
  const accessKeyId = String(process.env.SMARTQ_EVIDENCE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.SMARTQ_EVIDENCE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  return {
    endpoint: url,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: String(process.env.SMARTQ_EVIDENCE_REGION || process.env.AWS_REGION || "us-east-1").trim() || "us-east-1",
    prefix: safeObjectPrefix(process.env.SMARTQ_EVIDENCE_PREFIX || "smartq-evidence"),
    timeoutMs: Math.max(500, Math.min(15000, Number(process.env.SMARTQ_EVIDENCE_TIMEOUT_MS || 5000))),
  };
}

async function objectEvidenceRequest(config, method, key = "", options = {}) {
  const objectKey = key ? `${config.prefix}/${String(key).replace(/^\/+/, "")}` : "";
  const encodedParts = [config.bucket, ...objectKey.split("/").filter(Boolean)].map(encodeURIComponent);
  const pathname = `/${encodedParts.join("/")}`;
  const url = new URL(config.endpoint.toString());
  url.pathname = joinUrlPath(url.pathname, pathname);
  const body = Buffer.isBuffer(options.body) ? options.body : options.body ? Buffer.from(options.body) : Buffer.alloc(0);
  const headers = signObjectEvidenceRequest(config, method, url, body, options.headers || {});
  return requestBuffer(url, { method, headers, body, timeoutMs: config.timeoutMs });
}

function signObjectEvidenceRequest(config, method, url, body, extraHeaders = {}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...lowercaseHeaderKeys(extraHeaders),
  };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((key) => `${key}:${String(headers[key]).trim()}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const canonicalRequest = [
    method,
    url.pathname || "/",
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = s3SigningKey(config.secretAccessKey, dateStamp, config.region);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "content-length": body.length,
  };
}

function s3SigningKey(secret, dateStamp, region) {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function lowercaseHeaderKeys(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function requestBuffer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method: options.method, headers: options.headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => {
      req.destroy(new Error("Object evidence request timed out"));
    }, options.timeoutMs || 5000);
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    if (options.body?.length) req.write(options.body);
    req.end();
  });
}

function joinUrlPath(base = "", path = "") {
  return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`.replace(/\/+/g, "/");
}

function safeObjectPrefix(value = "") {
  return String(value || "").split("/").map(safePathPart).filter(Boolean).join("/") || "smartq-evidence";
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
