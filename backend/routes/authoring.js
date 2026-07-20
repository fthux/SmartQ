import { repairQuestions, transformQuestionWithAi, validateQuestions } from "../lib/ai.js";
import { logItem } from "../lib/audit.js";
import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import { getGenerationJob, startGenerationJob } from "../services/generation-service.js";
import { importQuestionBankIntoAuthoring } from "../services/question-bank-service.js";
import { questionContentChanged, upsertPaperSnapshot } from "../services/paper-service.js";
import { buildPaper } from "../lib/ai.js";
import { activeLeafCategory, categorySnapshotForId } from "../lib/question-bank-categories.js";

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
    const paperId = String(body.paperId || "");
    if (!questions.length) {
      sendJson(res, 400, { error: "没有可保存的试卷内容" });
      return true;
    }
    if (!activeLeafCategory(state, spec.categoryId)) {
      sendJson(res, 400, { error: "请选择有效的叶子分类后再保存试卷内容" });
      return true;
    }
    const checks = validateQuestions(questions);
    await updateState((current) => {
      const activePaper = paperId && current.paper?.id === paperId
        ? current.paper
        : paperId ? (current.papers || []).find((item) => item.id === paperId) : null;
      current.questions = questions.map((item, index) => ({
        ...item,
        id: item.id || `q-${String(index + 1).padStart(3, "0")}`,
        quality: item.quality || 90,
        status: item.status || "待确认",
      }));
      current.generationTask = spec;
      current.paper = {
        id: activePaper?.id || null,
        name: activePaper?.name || spec.paperName || "",
        status: activePaper?.id ? "草稿" : null,
        publishedAt: null,
        questionIds: activePaper?.id ? current.questions.map((item) => item.id) : [],
        buildSpec: activePaper?.buildSpec || null,
        sourcePlanSnapshot: spec.sourcePlan || null,
        categoryId: String(spec.categoryId || ""),
        categorySnapshot: categorySnapshotForId(current, spec.categoryId),
      };
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

  if (req.method === "POST" && url.pathname.startsWith("/api/questions/") && url.pathname.endsWith("/ai-transform")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-2) || "");
    const question = state.questions.find((item) => item.id === id);
    if (!question) {
      sendJson(res, 404, { error: "Question Not Found" });
      return true;
    }
    const body = await readJson(req);
    try {
      const result = await transformQuestionWithAi(question, {
        categoryId: state.generationTask?.categoryId || state.paper?.categoryId || "",
        categoryName: state.paper?.categorySnapshot?.path || state.paper?.categorySnapshot?.name || "",
        direction: state.generationTask?.direction || "",
        requirements: state.generationTask?.requirements || "",
      }, body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message || "AI 题目修改失败",
        failures: error.failures || undefined,
      });
    }
    return true;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/questions/")) {
    const id = url.pathname.split("/").pop();
    const body = await readJson(req);
    const question = await updateState((current) => {
      const target = current.questions.find((item) => item.id === id);
      if (!target) return null;
      const before = JSON.stringify(target);
      const { aiTransformMeta, ...updates } = body;
      Object.assign(target, updates);
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
      current.auditLog.push(logItem(aiTransformMeta ? "question-ai-update" : "question-update", `题目 ${id} 已更新`, {
        operation: aiTransformMeta?.operation || "manual",
      }));
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
