import { repairQuestions, validateQuestions } from "../lib/ai.js";
import { logItem } from "../lib/audit.js";
import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import { getGenerationJob, startGenerationJob } from "../services/generation-service.js";
import { importQuestionBankIntoAuthoring } from "../services/question-bank-service.js";
import { questionContentChanged, upsertPaperSnapshot } from "../services/paper-service.js";
import { buildPaper } from "../lib/ai.js";

export async function handleAuthoringRoutes(req, res, url, state, auth) {
  if (req.method === "POST" && url.pathname === "/api/ai/generate-questions") {
    const body = await readJson(req);
    sendJson(res, 202, startGenerationJob(body));
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/ai/generation-jobs/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const job = getGenerationJob(id);
    if (!job) {
      sendJson(res, 404, { error: "出题任务不存在或已过期" });
      return true;
    }
    sendJson(res, 200, job);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/save-question-draft") {
    const body = await readJson(req);
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const spec = body.spec && typeof body.spec === "object" ? body.spec : {};
    if (!questions.length) {
      sendJson(res, 400, { error: "没有可保存的试卷内容" });
      return true;
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
      current.paper = { id: null, name: "", status: null, publishedAt: null, questionIds: [], buildSpec: null, sourcePlanSnapshot: spec.sourcePlan || null };
      current.auditLog.push(logItem("ai-draft-save", `保存「${spec.paperName || "未命名试卷"}」试卷内容 ${current.questions.length} 道，稳定性 ${checks.stabilityScore}`));
    });
    sendJson(res, 200, { saved: true, questions, spec, checks });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/authoring/questions/import") {
    const result = await importQuestionBankIntoAuthoring(await readJson(req), auth?.user?.username || "");
    sendJson(res, 200, result);
    return true;
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
        if (checks.failures.length) return { error: "题目结构未通过校验，不能审核通过", failures: checks.failures };
      }
      Object.assign(target, body);
      if (questionContentChanged(before, target)) {
        target.origin = { ...(target.origin || { type: "ai", materialRefs: [] }), edited: true };
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
    if (!question) sendJson(res, 404, { error: "Question Not Found" });
    else if (question.error) sendJson(res, 409, question);
    else sendJson(res, 200, question);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/quality/check") {
    const checks = validateQuestions(state.questions);
    await updateState((current) => {
      current.auditLog.push(logItem("quality-check", `质量复检完成：${checks.failures.length} 个问题，${checks.pendingReview} 道待确认`));
    });
    sendJson(res, 200, checks);
    return true;
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
    return true;
  }
  return false;
}
