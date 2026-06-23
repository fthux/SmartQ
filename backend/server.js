import "./lib/env.js";
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
    const created = await updateState((current) => {
      const candidate = String(body.candidate || "").trim();
      const ticket = String(body.ticket || "").trim();
      if (!candidate || !ticket) {
        return { error: "考生姓名和准考证号不能为空" };
      }
      if (current.sessions.some((item) => item.ticket === ticket)) {
        return { error: "准考证号已存在", ticket };
      }
      const startTime = String(body.startTime || current.exam.windowStart || "10:00").trim();
      const endTime = String(body.endTime || current.exam.windowEnd || "11:30").trim();
      const session = {
        id: nextSessionId(current.sessions),
        candidate,
        ticket,
        paper: normalizePaperName(body.paper),
        time: `${startTime}-${endTime}`,
        remainingMinutes: minutesBetween(startTime, endTime),
        progress: 0,
        status: "待开考",
        risk: "低",
        events: [],
        camera: "待接入",
        createdAt: new Date().toISOString(),
      };
      current.sessions.push(session);
      current.answers[session.id] = {};
      current.auditLog.push(logItem("session-create", `${session.candidate} 已分配 ${session.paper}，准考证 ${session.ticket}`));
      return session;
    });
    if (created.error) {
      sendJson(res, 409, created);
      return;
    }
    sendJson(res, 201, created);
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
    const paperQuestions = paperQuestionsForSession(session, state.questions, state.paper);
    const access = buildAccessState(state.paper, session);
    sendJson(res, 200, {
      exam: state.exam,
      session,
      paper: state.paper,
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
    if (body.submit && state.paper.status !== "已发布") {
      sendJson(res, 409, { error: "试卷尚未发布，不能提交", paperStatus: state.paper.status });
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
        const paperQuestions = paperQuestionsForSession(session, current.questions, current.paper);
        session.progress = Math.round((Object.keys(current.answers[id]).length / paperQuestions.length) * 100);
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
    if (state.paper.status !== "已发布") {
      sendJson(res, 409, { error: "试卷尚未发布，不能阅卷", paperStatus: state.paper.status });
      return;
    }
    const session = state.sessions.find((item) => item.id === body.sessionId);
    const gradingQuestions = session ? paperQuestionsForSession(session, state.questions, state.paper) : buildPaper(state.questions, state.paper).questions;
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
    .slice(-12)
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
  const max = sessions.reduce((value, item) => {
    const match = String(item.id || "").match(/s-(\d+)/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `s-${String(max + 1).padStart(3, "0")}`;
}

function normalizePaperName(value) {
  return ["A 卷", "B 卷", "专项卷", "补考卷"].includes(value) ? value : "A 卷";
}

function minutesBetween(start, end) {
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  if (endMinutes <= startMinutes) return 0;
  return endMinutes - startMinutes;
}

function parseClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
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
