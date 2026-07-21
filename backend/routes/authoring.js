import { publicAiErrorMessage, repairQuestions, transformQuestionWithAi, validateGenerationSpec, validateQuestions } from "../lib/ai.js";
import { logItem } from "../lib/audit.js";
import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import { getGenerationJob, startGenerationJob } from "../services/generation-service.js";
import { importQuestionBankIntoAuthoring } from "../services/question-bank-service.js";
import { questionContentChanged, upsertPaperSnapshot } from "../services/paper-service.js";
import { buildPaper } from "../lib/ai.js";
import { scopedAuthoringState } from "../services/authoring-workspace-service.js";
import {
  activeAuthoringOwnerId,
  actorFromAuth,
  canAccessResource,
  resourceOwnerUserId,
  setActiveAuthoringOwner,
} from "../services/access-control-service.js";

export async function handleAuthoringRoutes(req, res, url, state, auth) {
  const actor = actorFromAuth(auth);
  const ownerUserId = activeAuthoringOwnerId(auth);
  const scopedState = scopedAuthoringState(state, ownerUserId);
  if (req.method === "POST" && url.pathname === "/api/ai/generate-questions") {
    const body = await readJson(req);
    sendJson(res, 202, startGenerationJob(body, actor));
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/ai/generation-jobs/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const job = getGenerationJob(id, actor.userId);
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
    const checks = validateQuestions(questions);
    const specChecks = validateGenerationSpec(questions, spec);
    if (specChecks.failures.length) {
      sendJson(res, 409, {
        error: "生成结果与命题配置不一致，请重新生成",
        failures: specChecks.failures,
        checks: { ...checks, specPass: false, specFailures: specChecks.failures },
      });
      return true;
    }
    const saveResult = await updateState((current) => {
      const savedPaper = paperId ? (current.papers || []).find((item) => item.id === paperId && canAccessResource(actor, item)) : null;
      if (paperId && !savedPaper) return { error: "试卷不存在或已被删除，请刷新后重试", statusCode: 404 };
      const draftOwnerUserId = savedPaper ? resourceOwnerUserId(savedPaper) : actor.userId;
      setActiveAuthoringOwner(auth, draftOwnerUserId);
      const currentState = scopedAuthoringState(current, draftOwnerUserId);
      const activePaper = paperId && currentState.paper?.id === paperId ? currentState.paper : savedPaper;
      currentState.questions = questions.map((item, index) => ({
        ...item,
        id: item.id || `q-${String(index + 1).padStart(3, "0")}`,
        quality: item.quality || 90,
        status: item.status || "待确认",
      }));
      currentState.generationTask = spec;
      currentState.paper = {
        id: activePaper?.id || null,
        name: activePaper?.name || spec.paperName || "",
        status: activePaper?.id ? "草稿" : null,
        publishedAt: null,
        questionIds: activePaper?.id ? currentState.questions.map((item) => item.id) : [],
        buildSpec: activePaper?.buildSpec || null,
        sourcePlanSnapshot: spec.sourcePlan || null,
        generationSpecSnapshot: spec,
      };
      currentState.auditLog.push(logItem("ai-draft-save", `保存「${spec.paperName || "未命名试卷"}」试卷内容 ${currentState.questions.length} 道，稳定性 ${checks.stabilityScore}`));
      return { saved: true };
    });
    if (saveResult?.error) {
      sendJson(res, saveResult.statusCode || 404, saveResult);
      return true;
    }
    sendJson(res, 200, { saved: true, questions, spec, checks });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/authoring/questions/import") {
    const result = await importQuestionBankIntoAuthoring(await readJson(req), actor, ownerUserId);
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/questions/") && url.pathname.endsWith("/ai-transform")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-2) || "");
    const question = scopedState.questions.find((item) => item.id === id);
    if (!question) {
      sendJson(res, 404, { error: "题目不存在或已被删除，请刷新后重试" });
      return true;
    }
    const body = await readJson(req);
    try {
      const result = await transformQuestionWithAi(question, {
        direction: scopedState.generationTask?.direction || "",
        requirements: scopedState.generationTask?.requirements || "",
      }, body);
      sendJson(res, 200, result);
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) console.error("SmartQ question AI transform failed", error);
      sendJson(res, error.statusCode || 500, {
        error: publicAiErrorMessage(error, "AI 题目修改服务暂时不可用，请稍后重试"),
        failures: error.failures || undefined,
      });
    }
    return true;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/questions/")) {
    const id = url.pathname.split("/").pop();
    const body = await readJson(req);
    const question = await updateState((current) => {
      const currentState = scopedAuthoringState(current, ownerUserId);
      const target = currentState.questions.find((item) => item.id === id);
      if (!target) return null;
      const before = JSON.stringify(target);
      const { aiTransformMeta, ...updates } = body;
      Object.assign(target, updates);
      if (questionContentChanged(before, target)) {
        target.origin = { ...(target.origin || { type: "ai", materialRefs: [] }), edited: true };
        const inPaper = (currentState.paper.questionIds || []).includes(id);
        if (inPaper) {
          currentState.paper.status = "草稿";
          currentState.paper.publishedAt = null;
          upsertPaperSnapshot(currentState, buildPaper(currentState.questions, currentState.paper), actor, ownerUserId);
        } else {
          currentState.auditLog.push(logItem("question-bank-update", `未入卷题目 ${id} 内容已更新`));
        }
      }
      currentState.auditLog.push(logItem(aiTransformMeta ? "question-ai-update" : "question-update", `题目 ${id} 已更新`, {
        operation: aiTransformMeta?.operation || "manual",
      }));
      return target;
    });
    if (!question) sendJson(res, 404, { error: "题目不存在或已被删除，请刷新后重试" });
    else if (question.error) sendJson(res, 409, question);
    else sendJson(res, 200, question);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/quality/check") {
    const checks = validateQuestions(scopedState.questions);
    await updateState((current) => {
      current.auditLog.push(logItem("quality-check", `质量复检完成：${checks.failures.length} 个问题，${checks.pendingReview} 道待确认`));
    });
    sendJson(res, 200, checks);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/quality/repair") {
    const result = await updateState((current) => {
      const currentState = scopedAuthoringState(current, ownerUserId);
      const repaired = repairQuestions(currentState.questions);
      currentState.questions = repaired.questions;
      if (currentState.paper.id) {
        currentState.paper.status = "草稿";
        currentState.paper.publishedAt = null;
        currentState.paper.questionIds = currentState.questions.map((item) => item.id);
        upsertPaperSnapshot(currentState, buildPaper(currentState.questions, currentState.paper), actor, ownerUserId);
      }
      currentState.auditLog.push(logItem("quality-repair", `自动修复完成：剩余 ${repaired.checks.failures.length} 个问题`));
      return repaired;
    });
    sendJson(res, 200, result);
    return true;
  }
  return false;
}
