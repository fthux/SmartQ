import "./lib/env.js";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { aiConfig, analyzeExam, buildPaper, generateQuestions, gradeAnswers, paperQuestionsForSession, repairQuestions, reviewGradingResult, saveFormalPaper, validateQuestions } from "./lib/ai.js";
import { loadState, updateState } from "./lib/runtime-store.js";

const frontendRoot = fileURLToPath(new URL("../frontend/", import.meta.url));
const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal Server Error" });
  }
});

server.listen(port, () => {
  console.log(`SmartQ running at http://localhost:${port}`);
});

async function handleApi(req, res, url) {
  const state = await loadState();

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "SmartQ", time: new Date().toISOString() });
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

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const paper = buildPaper(state.questions, state.paper);
    sendJson(res, 200, {
      exam: state.exam,
      stats: {
        registered: 128,
        online: state.sessions.filter((item) => item.status !== "离线").length,
        risk: state.sessions.filter((item) => item.risk !== "低").length,
        progress: Math.round(state.sessions.reduce((sum, item) => sum + Number(item.progress || 0), 0) / state.sessions.length),
      },
      questions: state.questions,
      paper,
      papers: state.papers || [],
      groups: state.groups || [],
      participants: publicCandidates(state.candidates || []),
      candidates: publicCandidates(state.candidates || []),
      assignments: buildAssignmentSummary(state.sessions, state.papers || []),
      sessions: state.sessions,
      analysis: analyzeExam(state.questions, state.sessions, state.gradingResults, state.paper),
      quality: validateQuestions(state.questions),
      generationTask: state.generationTask,
      gradingQueue: buildGradingQueue(state.gradingResults),
      gradingResults: state.gradingResults,
      proctorEvents: proctorEvents(state.auditLog),
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

  if (req.method === "POST" && url.pathname === "/api/candidate/login") {
    const body = await readJson(req);
    const result = await updateState((current) => loginCandidate(current, body));
    if (result.error) {
      sendJson(res, result.statusCode || 401, result);
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

  if (req.method === "GET" && url.pathname === "/api/proctor/sessions") {
    sendJson(res, 200, { sessions: state.sessions, events: proctorEvents(state.auditLog) });
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
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/proctor/sessions/") && url.pathname.endsWith("/events")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const session = await updateState((current) => {
      const target = current.sessions.find((item) => item.id === id);
      if (!target) return null;
      target.events = [...(target.events || []), body.event || "手动记录风险"];
      target.risk = body.risk || target.risk;
      target.camera = body.camera || target.camera;
      current.auditLog.push(logItem("proctor-event", `${target.candidate}：${body.event || "手动记录风险"}`));
      return target;
    });
    if (!session) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    sendJson(res, 200, session);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/candidate/session/") && url.pathname.endsWith("/heartbeat")) {
    const id = url.pathname.split("/").at(-2);
    const body = await readJson(req);
    const targetSession = state.sessions.find((item) => item.id === id);
    const auth = sessionRequiresCandidateAuth(state, targetSession) || authToken(req, url) ? authenticateCandidate(state, authToken(req, url), id) : null;
    if (auth?.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const session = await updateState((current) => {
      const target = current.sessions.find((item) => item.id === id);
      if (!target) return null;
      target.lastSeenAt = new Date().toISOString();
      target.status = target.status === "已提交" ? "已提交" : "答题中";
      if (Number.isFinite(Number(body.progress))) {
        target.progress = Math.max(0, Math.min(100, Math.round(Number(body.progress))));
      }
      if (body.visibility === "hidden") {
        target.events = [...(target.events || []), "离开考试页面"];
        target.risk = target.risk === "高" ? "高" : "中";
        current.auditLog.push(logItem("proctor-event", `${target.candidate}：离开考试页面`));
      }
      return target;
    });
    if (!session) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    sendJson(res, 200, session);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/candidate/session/")) {
    const id = url.pathname.split("/").pop();
    const session = state.sessions.find((item) => item.id === id);
    if (!session) {
      sendJson(res, 404, { error: "Session Not Found" });
      return;
    }
    const auth = sessionRequiresCandidateAuth(state, session) || authToken(req, url) ? authenticateCandidate(state, authToken(req, url), id) : null;
    if (auth?.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const assignedPaper = resolveSessionPaper(state, session);
    const paperQuestions = questionsForAssignedSession(state, session);
    const access = buildAccessState(assignedPaper, session);
    sendJson(res, 200, {
      exam: state.exam,
      session,
      paper: assignedPaper,
      access,
      questions: paperQuestions,
      answers: state.answers[session.id] || {},
    });
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
    const auth = sessionRequiresCandidateAuth(state, existingSession) || authToken(req, url) ? authenticateCandidate(state, authToken(req, url), id) : null;
    if (auth?.error) {
      sendJson(res, auth.statusCode || 401, auth);
      return;
    }
    const existingPaper = resolveSessionPaper(state, existingSession);
    if (body.submit && existingPaper.status !== "已发布") {
      sendJson(res, 409, { error: "试卷尚未发布，不能提交", paperStatus: existingPaper.status });
      return;
    }
    if (existingSession.status === "已提交") {
      sendJson(res, 409, { error: "试卷已提交，不能重复保存或提交", sessionStatus: existingSession.status });
      return;
    }
    if (body.submit && existingSession.status !== "答题中") {
      sendJson(res, 409, { error: "考试尚未进入答题中，不能提交", sessionStatus: existingSession.status });
      return;
    }
    const savedAt = new Date().toISOString();
    const saved = await updateState((current) => {
      current.answers[id] = body.answers || {};
      const session = current.sessions.find((item) => item.id === id);
      let grading = null;
      if (session) {
        const paperQuestions = questionsForAssignedSession(current, session);
        session.progress = paperQuestions.length ? Math.round((Object.keys(current.answers[id]).length / paperQuestions.length) * 100) : 0;
        if (!body.submit && session.status === "待开考") session.status = "答题中";
        if (body.submit) {
          session.status = "已提交";
          session.progress = 100;
          grading = {
            ...gradeAnswers(current.answers[id], paperQuestions),
            gradedAt: savedAt,
          };
          current.gradingResults[id] = grading;
        }
      }
      current.auditLog.push(logItem(body.submit ? "exam-submit" : "answer-save", `${id} ${body.submit ? "提交试卷" : "保存答题"}`));
      if (grading) {
        current.auditLog.push(logItem("grading", `${id} 提交后自动阅卷：${grading.totalScore}/${grading.maxScore}，${grading.reviewStatus}`));
      }
      return { saved: true, submitted: Boolean(body.submit), sessionId: id, savedAt, grading };
    });
    sendJson(res, 200, saved);
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

  if (req.method === "GET" && url.pathname === "/api/analysis") {
    sendJson(res, 200, analyzeExam(state.questions, state.sessions, state.gradingResults, state.paper));
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
}

function proctorEvents(auditLog = []) {
  return auditLog
    .filter((item) => item.type === "proctor-event" || item.type === "exam-submit" || item.type === "answer-save")
    .reverse();
}

function buildGradingQueue(gradingResults = {}) {
  const results = Object.values(gradingResults || {});
  return {
    objectiveDone: results.length,
    subjectivePending: results.reduce((sum, result) => sum + Number(result.subjectivePending || 0), 0),
    reviewDone: results.filter((result) => result.reviewStatus === "已完成").length,
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
  const { passwordHash, loginToken, loginTokenExpiresAt, ...safe } = candidate;
  return {
    ...safe,
    hasPassword: Boolean(passwordHash),
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
  const existingTickets = new Set((state.sessions || []).map((item) => item.ticket));
  const groupNames = groupNameSet(state);
  const seen = new Set();
  const rows = candidates.map((candidate, index) => {
    const errors = [];
    if (!candidate.candidate) errors.push("缺少姓名");
    if (!candidate.ticket) errors.push("缺少编号");
    if (!candidate.className) errors.push("请选择分组");
    if (candidate.className && !groupNames.has(candidate.className)) errors.push("分组不存在");
    if (candidate.ticket && existingTickets.has(candidate.ticket)) errors.push("编号已存在");
    if (candidate.ticket && seen.has(candidate.ticket)) errors.push("名单内编号重复");
    if (candidate.ticket) seen.add(candidate.ticket);
    return { ...candidate, row: index + 1, valid: errors.length === 0, errors };
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
  const existingTickets = new Set((state.candidates || []).map((item) => item.ticket));
  const groupNames = groupNameSet(state);
  const seen = new Set();
  const previewRows = rows.map((candidate, index) => {
    const errors = [];
    if (!candidate.candidate) errors.push("缺少姓名");
    if (!candidate.ticket) errors.push("缺少编号");
    if (!candidate.className) errors.push("请选择分组");
    if (candidate.className && !groupNames.has(candidate.className)) errors.push("分组不存在");
    if (candidate.ticket && existingTickets.has(candidate.ticket)) errors.push("编号已存在");
    if (candidate.ticket && seen.has(candidate.ticket)) errors.push("名单内编号重复");
    if (candidate.ticket) seen.add(candidate.ticket);
    return { ...candidate, row: index + 1, valid: errors.length === 0, errors };
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
  const existingTickets = new Set(state.candidates.map((item) => item.ticket));
  const groupNames = groupNameSet(state);
  const batchTickets = new Set();
  const created = [];
  const skipped = [];

  rows.forEach((candidate, index) => {
    const errors = [];
    if (!candidate.candidate) errors.push("参与者姓名不能为空");
    if (!candidate.phone) errors.push("手机号不能为空");
    if (!candidate.className) errors.push("请选择分组");
    if (candidate.className && !groupNames.has(candidate.className)) errors.push("分组不存在");
    if (!candidate.ticket) candidate.ticket = nextParticipantTicket(state, batchTickets);
    if (candidate.ticket && existingTickets.has(candidate.ticket)) errors.push("编号已存在");
    if (candidate.ticket && batchTickets.has(candidate.ticket)) errors.push("名单内编号重复");
    if (errors.length) {
      skipped.push({ ...candidate, index, errors });
      return;
    }

    batchTickets.add(candidate.ticket);
    const record = {
      id: `cand-${candidate.ticket}`,
      candidate: candidate.candidate,
      ticket: candidate.ticket,
      className: candidate.className || "",
      phone: candidate.phone || "",
      email: candidate.email || "",
      description: candidate.description || "",
      avatar: candidate.avatar || "",
      passwordHash: hashPassword(candidate.password || defaultCandidatePassword(candidate.phone)),
      passwordUpdatedAt: now,
      tags: [],
      createdAt: now,
      updatedAt: null,
    };
    state.candidates.push(record);
    created.push(record);
  });

  if (!created.length) {
    return { error: skipped[0]?.errors?.[0] || "没有可添加的参与者", skipped, statusCode: skipped.length ? 409 : 400 };
  }
  state.auditLog.push(logItem("candidate-create", `添加 ${created.length} 名参与者${skipped.length ? `，跳过 ${skipped.length} 名` : ""}`));
  return { candidates: created, skipped };
}

function updateCandidate(state, ticket, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const target = String(ticket || "").trim();
  const participant = state.candidates.find((item) => item.ticket === target || item.id === target);
  if (!participant) return null;
  const nextGroup = String(body.className ?? participant.className ?? "").trim();
  if (!String(body.candidate ?? participant.candidate ?? "").trim()) return { error: "参与者姓名不能为空", statusCode: 400 };
  if (!String(body.phone ?? participant.phone ?? "").trim()) return { error: "手机号不能为空", statusCode: 400 };
  if (!nextGroup) return { error: "请选择分组", statusCode: 400 };
  if (!groupNameSet(state).has(nextGroup)) return { error: "分组不存在", statusCode: 409 };
  Object.assign(participant, {
    candidate: String(body.candidate ?? participant.candidate).trim(),
    className: nextGroup,
    phone: String(body.phone ?? participant.phone ?? "").trim(),
    email: String(body.email ?? participant.email ?? "").trim(),
    description: String(body.description ?? participant.description ?? "").trim(),
    avatar: String(body.avatar ?? participant.avatar ?? "").trim(),
    updatedAt: new Date().toISOString(),
  });
  if (body.password !== undefined && String(body.password || "").trim()) {
    participant.passwordHash = hashPassword(body.password);
    participant.passwordUpdatedAt = participant.updatedAt;
    participant.loginToken = null;
    participant.loginTokenExpiresAt = null;
  }
  state.auditLog.push(logItem("participant-update", `更新参与者：${participant.candidate}`));
  return participant;
}

function deleteCandidate(state, ticket) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const target = String(ticket || "").trim();
  const index = state.candidates.findIndex((item) => item.ticket === target || item.id === target);
  if (index < 0) return null;
  const [candidate] = state.candidates.splice(index, 1);
  state.auditLog.push(logItem("candidate-delete", `删除参与者：${candidate.candidate}`));
  return { deleted: true, candidate };
}

function deleteCandidateBatch(state, tickets = []) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const targets = new Set((Array.isArray(tickets) ? tickets : []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!targets.size) return { error: "请选择要删除的参与者", statusCode: 400 };
  const deleted = [];
  state.candidates = state.candidates.filter((item) => {
    const match = targets.has(item.ticket) || targets.has(item.id);
    if (match) deleted.push(item);
    return !match;
  });
  if (!deleted.length) return { error: "未找到可删除的参与者", statusCode: 404 };
  state.auditLog.push(logItem("participant-delete-batch", `批量删除 ${deleted.length} 名参与者`));
  return { deleted: true, participants: deleted };
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
  const existingTickets = new Set(state.sessions.map((item) => item.ticket));
  const groupNames = groupNameSet(state);
  const batchTickets = new Set();
  const created = [];
  const skipped = [];

  candidates.forEach((candidate, index) => {
    const errors = [];
    if (!candidate.candidate) errors.push("参与者姓名不能为空");
    if (!candidate.ticket) errors.push("编号不能为空");
    if (!candidate.className) errors.push("请选择分组");
    if (candidate.className && !groupNames.has(candidate.className)) errors.push("分组不存在");
    if (candidate.ticket && existingTickets.has(candidate.ticket)) errors.push("编号已存在");
    if (candidate.ticket && batchTickets.has(candidate.ticket)) errors.push("名单内编号重复");
    if (errors.length) {
      skipped.push({ ...candidate, index, errors });
      return;
    }
    batchTickets.add(candidate.ticket);
    const session = buildAssignedSession(state, {
      candidate: candidate.candidate,
      ticket: candidate.ticket,
      className: candidate.className,
      phone: candidate.phone,
      email: candidate.email,
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
  const now = new Date().toISOString();
  candidates.forEach((candidate) => {
    if (!candidate.ticket || existingTickets.has(candidate.ticket)) return;
    state.candidates.push({
      id: `cand-${candidate.ticket}`,
      candidate: candidate.candidate,
      ticket: candidate.ticket,
      className: candidate.className || "",
      phone: candidate.phone || "",
      email: candidate.email || "",
      description: candidate.description || "",
      avatar: candidate.avatar || "",
      passwordHash: hashPassword(candidate.password || defaultCandidatePassword(candidate.phone)),
      passwordUpdatedAt: now,
      tags: [],
      createdAt: now,
      updatedAt: null,
    });
    existingTickets.add(candidate.ticket);
  });
}

function updateAssignment(state, id, body = {}) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return null;
  if (session.status === "已提交") return { error: "已提交会话不能修改分配", statusCode: 409 };
  const nextTicket = String(body.ticket || session.ticket).trim();
  if (!nextTicket) return { error: "编号不能为空", statusCode: 400 };
  if (state.sessions.some((item) => item.id !== id && item.ticket === nextTicket)) {
    return { error: "编号已存在", ticket: nextTicket, statusCode: 409 };
  }
  const paper = body.paperId ? resolveAssignablePaper(state, body.paperId) : resolveSessionPaper(state, session);
  if (!paper) return { error: "请选择已发布试卷", statusCode: 409 };
  const startTime = String(body.startTime || session.startTime || session.time?.split("-")[0] || state.exam.windowStart || "10:00").trim();
  const endTime = String(body.endTime || session.endTime || session.time?.split("-")[1] || state.exam.windowEnd || "11:30").trim();
  Object.assign(session, {
    candidate: String(body.candidate || session.candidate).trim(),
    ticket: nextTicket,
    className: body.className ?? session.className,
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

function loginCandidate(state, body = {}) {
  state.candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  if (!phone || !password) return { error: "请输入手机号和密码", statusCode: 400 };
  const candidate = state.candidates.find((item) => item.phone === phone);
  if (!candidate) return { error: "手机号或密码错误", statusCode: 401 };
  if (!candidate.passwordHash) {
    candidate.passwordHash = hashPassword(defaultCandidatePassword(candidate.phone));
    candidate.passwordUpdatedAt = new Date().toISOString();
  }
  if (!verifyPassword(password, candidate.passwordHash)) return { error: "手机号或密码错误", statusCode: 401 };
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

function authenticateCandidate(state, token, sessionId = "") {
  const value = String(token || "").trim();
  if (!value) return { error: "请先登录考生系统", statusCode: 401 };
  const candidate = (state.candidates || []).find((item) => item.loginToken === value);
  if (!candidate) return { error: "登录已失效，请重新登录", statusCode: 401 };
  const expiresAt = new Date(candidate.loginTokenExpiresAt || 0).getTime();
  if (!expiresAt || expiresAt < Date.now()) return { error: "登录已过期，请重新登录", statusCode: 401 };
  if (sessionId) {
    const session = (state.sessions || []).find((item) => item.id === sessionId);
    if (!session) return { error: "Session Not Found", statusCode: 404 };
    if (session.ticket !== candidate.ticket && session.phone !== candidate.phone) {
      return { error: "无权访问该考试", statusCode: 403 };
    }
  }
  return { candidate };
}

function sessionRequiresCandidateAuth(state, session = null) {
  if (!session) return false;
  return Boolean(session.phone) && (state.candidates || []).some((candidate) => candidate.phone && candidate.phone === session.phone);
}

function authToken(req, url) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return url.searchParams.get("token") || "";
}

function candidateExamList(state, candidate) {
  const exams = (state.sessions || [])
    .filter((session) => session.ticket === candidate.ticket || session.phone === candidate.phone)
    .map((session) => {
      const paper = resolveSessionPaper(state, session);
      return {
        id: session.id,
        candidate: session.candidate,
        ticket: session.ticket,
        className: session.className || "",
        paperId: session.paperId || null,
        paperName: session.paperName || session.paper || paper.name || "",
        startTime: session.startTime || "",
        endTime: session.endTime || "",
        time: session.time || "",
        status: session.status || "待开考",
        progress: Number(session.progress || 0),
        remark: session.remark || "",
        canEnter: paper.status === "已发布" && session.status !== "已提交",
        paperStatus: paper.status,
      };
    });
  return { candidate: publicCandidate(candidate), exams };
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
    camera: "待接入",
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
      session.camera = session.camera === "已提交" ? "待接入" : session.camera;
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

function buildAccessState(paper, session) {
  const published = paper.status === "已发布";
  const active = session.status === "答题中";
  const submitted = session.status === "已提交";
  return {
    canEnter: true,
    canSave: !submitted,
    canSubmit: published && active && !submitted,
    paperStatus: paper.status,
    sessionStatus: session.status,
    message: buildAccessMessage(published, active, submitted),
  };
}

function buildAccessMessage(published, active, submitted) {
  if (submitted) return "试卷已提交，不能重复保存或提交";
  if (!published) return "试卷尚未发布，可预览并保存草稿，暂不能提交";
  if (!active) return "考试尚未进入答题中，可进入页面，开始答题后才能提交";
  return "考试已发布，可以提交试卷";
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

function logItem(type, message) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    message,
    createdAt: new Date().toISOString(),
  };
}

async function serveStatic(res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(frontendRoot, safePath);
  const data = await readFile(filePath);
  res.writeHead(200, { "content-type": contentType(filePath) });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function contentType(filePath) {
  const ext = extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  }[ext] || "application/octet-stream";
}
