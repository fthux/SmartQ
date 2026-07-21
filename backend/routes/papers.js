import { buildPaper, saveFormalPaper, validateGenerationSpec, validateQuestions } from "../lib/ai.js";
import { logItem } from "../lib/audit.js";
import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import { paperSnapshotDetail, upsertPaperSnapshot } from "../services/paper-service.js";
import {
  clearPaperFromAllAuthoringWorkspaces,
  scopedAuthoringState,
} from "../services/authoring-workspace-service.js";
import {
  activeAuthoringOwnerId,
  actorFromAuth,
  canAccessResource,
  decorateOwnedResource,
  resourceOwnerUserId,
  setActiveAuthoringOwner,
} from "../services/access-control-service.js";

export async function handlePaperRoutes(req, res, url, state, auth) {
  const actor = actorFromAuth(auth);
  const ownerUserId = activeAuthoringOwnerId(auth);
  const scopedState = scopedAuthoringState(state, ownerUserId);
  if (req.method === "POST" && url.pathname === "/api/papers/build") {
    const body = await readJson(req);
    const paper = await updateState((current) => {
      const currentState = scopedAuthoringState(current, ownerUserId);
      const specChecks = currentState.generationTask ? validateGenerationSpec(currentState.questions, currentState.generationTask) : { failures: [] };
      if (specChecks.failures.length) return { error: "当前试卷与命题配置不一致，请修正后再保存", failures: specChecks.failures };
      const saved = saveFormalPaper(currentState.questions, {
        ...currentState.paper,
        id: currentState.paper.id || `paper-${Date.now()}`,
        name: body.name || currentState.generationTask?.paperName || currentState.paper.name || "未命名试卷",
        sourcePlanSnapshot: currentState.generationTask?.sourcePlan || currentState.paper.sourcePlanSnapshot || null,
      });
      if (saved.error) return saved;
      currentState.paper = {
        ...currentState.paper,
        id: saved.id,
        name: saved.name,
        status: "草稿",
        questionIds: saved.questionIds,
        buildSpec: saved.buildSpec,
        sourcePlanSnapshot: saved.sourcePlanSnapshot || currentState.generationTask?.sourcePlan || null,
        generationSpecSnapshot: currentState.generationTask || currentState.paper.generationSpecSnapshot || null,
        publishedAt: null,
      };
      upsertPaperSnapshot(currentState, buildPaper(currentState.questions, currentState.paper), actor, ownerUserId);
      currentState.auditLog.push(logItem("paper-save", `保存试卷：${saved.name}，${saved.questionCount} 题 / ${saved.score} 分`));
      return decorateOwnedResource(current, (current.papers || []).find((item) => item.id === currentState.paper.id));
    });
    if (paper.error) sendJson(res, 409, paper);
    else sendJson(res, 200, paper);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/papers/publish") {
    const paper = await updateState((current) => {
      const currentState = scopedAuthoringState(current, ownerUserId);
      const hasSavedPaper = Boolean(currentState.paper.id && ["草稿", "未发布", "已保存", "已组卷", "已发布"].includes(currentState.paper.status));
      const ids = new Set(currentState.paper.questionIds || []);
      const paperQuestions = hasSavedPaper ? currentState.questions.filter((item) => ids.has(item.id)) : currentState.questions;
      if (!paperQuestions.length) return { error: "当前试卷没有题目，请先完成出题" };
      const checks = validateQuestions(paperQuestions);
      const specChecks = currentState.generationTask ? validateGenerationSpec(paperQuestions, currentState.generationTask) : { failures: [] };
      if (checks.failures.length || specChecks.failures.length) {
        const failures = checks.failures.map((failure) => {
          const question = paperQuestions[failure.index] || {};
          return {
            ...failure,
            questionId: question.id || "",
            questionNumber: failure.index + 1,
            type: question.type || "",
            stem: question.stem || "",
          };
        });
        const specFailures = specChecks.failures.map((failure) => ({ ...failure, scope: "generation-spec" }));
        const allFailures = [...failures, ...specFailures];
        const paperName = currentState.paper.name || currentState.generationTask?.paperName || "未命名试卷";
        currentState.auditLog.push(logItem("paper-publish-blocked", `${paperName} 发布检查未通过：${allFailures.length} 个问题`));
        return {
          error: `发布检查未通过，请修正以下 ${allFailures.length} 个问题后重新发布`,
          failures: allFailures,
          checks: { ...checks, failures, specPass: !specFailures.length, specFailures },
        };
      }
      if (!hasSavedPaper) {
        const saved = saveFormalPaper(paperQuestions, {
          ...currentState.paper,
          id: `paper-${Date.now()}`,
          name: currentState.generationTask?.paperName || currentState.paper.name || "未命名试卷",
          sourcePlanSnapshot: currentState.generationTask?.sourcePlan || currentState.paper.sourcePlanSnapshot || null,
        });
        if (saved.error) return saved;
        currentState.paper = {
          ...currentState.paper,
          id: saved.id,
          name: saved.name,
          status: "草稿",
          questionIds: saved.questionIds,
          buildSpec: saved.buildSpec,
          sourcePlanSnapshot: saved.sourcePlanSnapshot || currentState.generationTask?.sourcePlan || null,
          generationSpecSnapshot: currentState.generationTask || currentState.paper.generationSpecSnapshot || null,
          publishedAt: null,
        };
        currentState.auditLog.push(logItem("paper-auto-save", `发布前自动保存试卷：${saved.name}，${saved.questionCount} 题 / ${saved.score} 分`));
      }
      currentState.paper.status = "已发布";
      currentState.paper.publishedAt = new Date().toISOString();
      upsertPaperSnapshot(currentState, buildPaper(currentState.questions, currentState.paper), actor, ownerUserId);
      currentState.auditLog.push(logItem("paper-publish", `${currentState.paper.name} 已发布`));
      return decorateOwnedResource(current, (current.papers || []).find((item) => item.id === currentState.paper.id));
    });
    if (paper.error) sendJson(res, 409, paper);
    else sendJson(res, 200, paper);
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/papers/") && url.pathname.endsWith("/activate")) {
    const id = url.pathname.split("/").at(-2);
    const paper = await updateState((current) => {
      const target = (current.papers || []).find((item) => item.id === id && canAccessResource(actor, item));
      if (!target) return null;
      const targetOwnerUserId = resourceOwnerUserId(target);
      const currentState = scopedAuthoringState(current, targetOwnerUserId);
      setActiveAuthoringOwner(auth, targetOwnerUserId);
      currentState.paper = {
        id: target.id,
        name: target.name,
        status: target.status,
        publishedAt: target.publishedAt || null,
        questionIds: target.questionIds || [],
        buildSpec: target.buildSpec || null,
        sourcePlanSnapshot: target.sourcePlanSnapshot || target.buildSpec?.sourcePlanSnapshot || null,
        generationSpecSnapshot: target.generationSpecSnapshot || null,
      };
      const targetQuestions = paperSnapshotDetail(target, currentState.questions).questions;
      currentState.questions = targetQuestions.map((question, index) => ({
        ...question,
        id: question.id || `q-${String(index + 1).padStart(3, "0")}`,
      }));
      currentState.paper.questionIds = currentState.questions.map((question) => question.id);
      currentState.generationTask = target.generationSpecSnapshot || null;
      currentState.auditLog.push(logItem("paper-activate", `${target.name} 已设为当前试卷`));
      return decorateOwnedResource(current, { ...buildPaper(currentState.questions, currentState.paper), ...ownershipFields(target) });
    });
    if (!paper) sendJson(res, 404, { error: "试卷不存在或已被删除，请刷新后重试" });
    else sendJson(res, 200, paper);
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/papers/")) {
    const id = url.pathname.split("/").pop();
    const target = (state.papers || []).find((item) => item.id === id && canAccessResource(actor, item));
    if (!target) sendJson(res, 404, { error: "试卷不存在或已被删除，请刷新后重试" });
    else {
      const targetState = scopedAuthoringState(state, resourceOwnerUserId(target));
      sendJson(res, 200, decorateOwnedResource(state, paperSnapshotDetail(target, targetState.questions)));
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/papers/")) {
    const id = url.pathname.split("/").pop();
    const result = await updateState((current) => {
      const index = (current.papers || []).findIndex((item) => item.id === id && canAccessResource(actor, item));
      if (index < 0) return null;
      const [deleted] = current.papers.splice(index, 1);
      clearPaperFromAllAuthoringWorkspaces(current, id);
      current.auditLog.push(logItem("paper-delete", `删除试卷：${deleted.name}`));
      return { deleted: true, paper: deleted };
    });
    if (!result) sendJson(res, 404, { error: "试卷不存在或已被删除，请刷新后重试" });
    else sendJson(res, 200, result);
    return true;
  }
  return false;
}

function ownershipFields(resource = {}) {
  return {
    ownerUserId: resource.ownerUserId || "",
    createdByUserId: resource.createdByUserId || resource.ownerUserId || "",
    updatedByUserId: resource.updatedByUserId || resource.createdByUserId || resource.ownerUserId || "",
  };
}
