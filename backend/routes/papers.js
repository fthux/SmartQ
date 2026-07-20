import { buildPaper, saveFormalPaper, validateQuestions } from "../lib/ai.js";
import { logItem } from "../lib/audit.js";
import { readJson, sendJson } from "../lib/http.js";
import { updateState } from "../lib/runtime-store.js";
import { paperSnapshotDetail, upsertPaperSnapshot } from "../services/paper-service.js";
import { activeLeafCategory, categorySnapshotForId } from "../lib/question-bank-categories.js";

export async function handlePaperRoutes(req, res, url, state) {
  if (req.method === "POST" && url.pathname === "/api/papers/build") {
    const body = await readJson(req);
    const paper = await updateState((current) => {
      const categoryId = String(body.categoryId || current.generationTask?.categoryId || current.paper.categoryId || "");
      if (!activeLeafCategory(current, categoryId)) return { error: "请选择有效的叶子分类后再保存试卷" };
      const categorySnapshot = categorySnapshotForId(current, categoryId);
      const saved = saveFormalPaper(current.questions, {
        ...current.paper,
        id: current.paper.id || `paper-${Date.now()}`,
        name: body.name || current.generationTask?.paperName || current.paper.name || "未命名试卷",
        sourcePlanSnapshot: current.generationTask?.sourcePlan || current.paper.sourcePlanSnapshot || null,
        categoryId,
        categorySnapshot,
      });
      if (saved.error) return saved;
      current.paper = {
        ...current.paper,
        id: saved.id,
        name: saved.name,
        status: "草稿",
        questionIds: saved.questionIds,
        buildSpec: saved.buildSpec,
        sourcePlanSnapshot: saved.sourcePlanSnapshot || current.generationTask?.sourcePlan || null,
        publishedAt: null,
        categoryId,
        categorySnapshot,
      };
      upsertPaperSnapshot(current, buildPaper(current.questions, current.paper));
      current.auditLog.push(logItem("paper-save", `保存试卷：${saved.name}，${saved.questionCount} 题 / ${saved.score} 分`));
      return buildPaper(current.questions, current.paper);
    });
    if (paper.error) sendJson(res, 409, paper);
    else sendJson(res, 200, paper);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/papers/publish") {
    const paper = await updateState((current) => {
      const hasSavedPaper = Boolean(current.paper.id && ["草稿", "未发布", "已保存", "已组卷", "已发布"].includes(current.paper.status));
      const ids = new Set(current.paper.questionIds || []);
      const paperQuestions = hasSavedPaper ? current.questions.filter((item) => ids.has(item.id)) : current.questions;
      if (!paperQuestions.length) return { error: "当前试卷没有题目，请先完成出题" };
      const categoryId = String(current.paper.categoryId || current.generationTask?.categoryId || "");
      if (!activeLeafCategory(current, categoryId)) return { error: "当前试卷分类不存在、已归档或不是叶子分类，请重新选择" };
      const categorySnapshot = categorySnapshotForId(current, categoryId);
      const checks = validateQuestions(paperQuestions);
      if (checks.failures.length) {
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
        const paperName = current.paper.name || current.generationTask?.paperName || "未命名试卷";
        current.auditLog.push(logItem("paper-publish-blocked", `${paperName} 发布检查未通过：${failures.length} 个问题`));
        return {
          error: `发布检查未通过，请修正以下 ${failures.length} 个问题后重新发布`,
          failures,
          checks: { ...checks, failures },
        };
      }
      if (!hasSavedPaper) {
        const saved = saveFormalPaper(paperQuestions, {
          ...current.paper,
          id: `paper-${Date.now()}`,
          name: current.generationTask?.paperName || current.paper.name || "未命名试卷",
          sourcePlanSnapshot: current.generationTask?.sourcePlan || current.paper.sourcePlanSnapshot || null,
          categoryId,
          categorySnapshot,
        });
        if (saved.error) return saved;
        current.paper = {
          ...current.paper,
          id: saved.id,
          name: saved.name,
          status: "草稿",
          questionIds: saved.questionIds,
          buildSpec: saved.buildSpec,
          sourcePlanSnapshot: saved.sourcePlanSnapshot || current.generationTask?.sourcePlan || null,
          publishedAt: null,
          categoryId,
          categorySnapshot,
        };
        current.auditLog.push(logItem("paper-auto-save", `发布前自动保存试卷：${saved.name}，${saved.questionCount} 题 / ${saved.score} 分`));
      }
      current.paper.status = "已发布";
      current.paper.publishedAt = new Date().toISOString();
      current.paper.categoryId = categoryId;
      current.paper.categorySnapshot = categorySnapshot;
      upsertPaperSnapshot(current, buildPaper(current.questions, current.paper));
      current.auditLog.push(logItem("paper-publish", `${current.paper.name} 已发布`));
      return buildPaper(current.questions, current.paper);
    });
    if (paper.error) sendJson(res, 409, paper);
    else sendJson(res, 200, paper);
    return true;
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
        sourcePlanSnapshot: target.sourcePlanSnapshot || target.buildSpec?.sourcePlanSnapshot || null,
        categoryId: String(target.categoryId || ""),
        categorySnapshot: target.categorySnapshot || null,
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
    if (!paper) sendJson(res, 404, { error: "Paper Not Found" });
    else sendJson(res, 200, paper);
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/papers/")) {
    const id = url.pathname.split("/").pop();
    const target = (state.papers || []).find((item) => item.id === id);
    if (!target) sendJson(res, 404, { error: "Paper Not Found" });
    else sendJson(res, 200, paperSnapshotDetail(target, state.questions));
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/papers/")) {
    const id = url.pathname.split("/").pop();
    const result = await updateState((current) => {
      const index = (current.papers || []).findIndex((item) => item.id === id);
      if (index < 0) return null;
      const [deleted] = current.papers.splice(index, 1);
      if (current.paper.id === id) {
        current.paper = { id: null, name: "", status: null, publishedAt: null, questionIds: [], buildSpec: null, sourcePlanSnapshot: null, categoryId: "", categorySnapshot: null };
        current.questions = [];
        current.generationTask = null;
      }
      current.auditLog.push(logItem("paper-delete", `删除试卷：${deleted.name}`));
      return { deleted: true, paper: deleted };
    });
    if (!result) sendJson(res, 404, { error: "Paper Not Found" });
    else sendJson(res, 200, result);
    return true;
  }
  return false;
}
