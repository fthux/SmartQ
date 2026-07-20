import { request } from "../core/api-client.js";
import { paperTypeConfig } from "../core/constants.js";
import {
  buildEditedOptions,
  clampNumber,
  normalizeEditedAnswer,
  normalizeEditorOptions,
  splitList,
} from "../core/domain-utils.js";
import { mountIcons } from "../core/presentation.js";
import { formatRouteHash } from "../core/router.js";

export function createAuthoringStore({
  state,
  refresh,
  notify,
  formLocked,
  workflowSteps,
  authoringQuestions,
  authoringPendingReviewCount,
  questions,
  computedSpecTotalScore,
  selectPaper,
  go,
}) {
  function setWorkflowStep(step) {
    const target = workflowSteps.value.find((item) => item.key === step);
    if (target && !target.clickable) return;
    if (step === "config") syncSpecFromActiveDraft();
    state.activeWorkflowStep = step;
    mountIcons();
  }

  function syncSpecFromActiveDraft() {
    const spec = state.generatedDraft?.spec || state.dashboard?.generationTask;
    if (!spec || typeof spec !== "object") return;
    state.spec.paperName = spec.paperName || state.spec.paperName || "";
    state.spec.direction = spec.direction || state.spec.direction || "";
    state.spec.difficulty = spec.difficulty || state.spec.difficulty || "中";
    state.spec.knowledge = spec.knowledgeInputEmpty ? "" : Array.isArray(spec.knowledge) ? spec.knowledge.join("，") : state.spec.knowledge || "";
    state.spec.requirements = spec.requirements || state.spec.requirements || "";
    const counts = spec.typeCounts || {};
    const scores = spec.typeScores || {};
    paperTypeConfig.forEach((item) => {
      const planItem = Array.isArray(spec.typeMix) ? spec.typeMix.find((entry) => entry.type === item.type) : null;
      state.spec[item.countKey] = clampNumber(counts[item.apiKey] ?? planItem?.count, 0, 50, state.spec[item.countKey] || 0);
      state.spec[item.scoreKey] = clampNumber(scores[item.apiKey] ?? scores[item.type], 1, 200, state.spec[item.scoreKey] || item.defaultScore);
    });
  }

  async function generateDraft() {
    if (formLocked.value) {
      notify("命题配置已锁定，如需修改请先点击重新生成");
      return;
    }
    const errors = validateSpecForm();
    state.specFormErrors = errors;
    if (!showFirstFormError(errors)) return;
    const wasRegenerating = state.regeneratingDraft;
    const previousGeneratedDraft = state.generatedDraft;
    const previousActiveStep = state.activeWorkflowStep;
    state.generating = true;
    state.generationError = "";
    startGenerationProgress();
    try {
      const job = await request("/api/ai/generate-questions", {
        method: "POST",
        body: JSON.stringify(readSpec()),
      });
      setGenerationProgress(Math.max(state.generationProgress, job.progress || 12), job.stage || "AI 出题任务已创建");
      const generated = await waitForGenerationJob(job.id);
      stopGenerationProgress();
      setGenerationProgress(Math.max(state.generationProgress, 92), "校验试卷结构");
      state.generatedDraft = generated;
      state.regeneratingDraft = false;
      state.activeWorkflowStep = "config";
      if (wasRegenerating) {
        setGenerationProgress(86, "重置旧试卷流程");
        await refresh();
      }
      setGenerationProgress(100, "试卷已生成，等待确认");
      notify("试卷已生成预览，刷新页面不会保留；确认后再进入质量复检");
    } catch (error) {
      stopGenerationProgress();
      state.generatedDraft = previousGeneratedDraft;
      state.regeneratingDraft = false;
      state.activeWorkflowStep = previousActiveStep;
      state.generationError = formatGenerationError(error.message);
      setGenerationProgress(100, "生成失败");
      notify(`生成失败：${state.generationError}`);
    } finally {
      state.generating = false;
      mountIcons();
    }
  }

  async function waitForGenerationJob(jobId) {
    if (!jobId) throw new Error("AI 出题任务创建失败");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      await pause(2000);
      const job = await request(`/api/ai/generation-jobs/${encodeURIComponent(jobId)}`);
      if (job.progress) setGenerationProgress(Math.max(state.generationProgress, job.progress), job.stage || state.generationStage);
      else if (job.stage) setGenerationProgress(state.generationProgress, job.stage);
      if (job.status === "done") return job.result;
      if (job.status === "error") throw new Error(job.error || "AI 出题失败");
    }
    throw new Error("AI 出题任务等待超时，请稍后刷新后重试");
  }

  async function saveGeneratedContent(generated, options = {}) {
    if (!generated?.questions?.length) {
      if (!options.silent) notify("暂无可保存的试卷内容");
      return null;
    }
    state.saving = true;
    try {
      const result = await request("/api/ai/save-question-draft", {
        method: "POST",
        body: JSON.stringify({ questions: generated.questions, spec: generated.spec }),
      });
      state.generatedDraft = null;
      state.regeneratingDraft = false;
      await refresh();
      state.authoringNewDraftActive = !state.authoringPaperId;
      syncSpecFromActiveDraft();
      state.activeWorkflowStep = "quality";
      if (!options.silent) notify("试卷内容已进入质量复检");
      return result;
    } finally {
      state.saving = false;
    }
  }

  function startGenerationProgress() {
    stopGenerationProgress();
    state.generationStartedAt = Date.now();
    state.generationProgress = 6;
    state.generationStage = "准备命题参数";
    state.generationTimer = setInterval(() => {
      const elapsed = Date.now() - state.generationStartedAt;
      const current = state.generationProgress;
      let next = current;
      if (elapsed < 1200) next = Math.min(18, current + 3);
      else if (elapsed < 5000) next = Math.min(45, current + 2);
      else if (elapsed < 11000) next = Math.min(72, current + 1);
      else next = Math.min(92, current + 0.5);
      const stage = next < 20 ? "准备命题参数" : next < 48 ? "连接 AI 出题服务" : next < 76 ? "AI 正在生成试卷" : "等待 AI 返回并校验结构";
      setGenerationProgress(Math.round(next), stage);
    }, 420);
  }

  function stopGenerationProgress() {
    if (!state.generationTimer) return;
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }

  function setGenerationProgress(value, stage) {
    state.generationProgress = Math.max(0, Math.min(100, value));
    state.generationStage = stage;
  }

  async function saveDraft() {
    if (!state.generatedDraft?.questions?.length) {
      notify("暂无可保存的试卷");
      return;
    }
    try {
      await saveGeneratedContent(state.generatedDraft);
      const qualityResult = await qualityCheck({ auto: true });
      const qualityFailures = qualityResult?.failures?.length || 0;
      if (qualityFailures > 0) notify(`试卷内容已进入质量复检，发现 ${qualityFailures} 个问题，请先自动修复`);
    } catch (error) {
      notify(`保存失败：${error.message}`);
    }
  }

  function discardDraft() {
    state.generatedDraft = null;
    state.regeneratingDraft = false;
    state.activeWorkflowStep = "config";
    notify("已丢弃本次生成结果");
  }

  function regenerate() {
    state.regeneratingDraft = true;
    state.activeWorkflowStep = "config";
    state.generationError = "";
    state.generationStage = "";
    state.generationProgress = 0;
    notify("已进入重新生成模式");
  }

  async function reviewQuestion(question, reviewed) {
    try {
      await request(`/api/questions/${question.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: reviewed ? "已校验" : "待确认" }),
      });
      await refresh();
      if (reviewed && authoringQuestions.value.length > 0 && authoringPendingReviewCount.value === 0) {
        state.activeWorkflowStep = "save";
        notify("题目已全部审核通过，请保存试卷");
      } else {
        state.activeWorkflowStep = "review";
        notify(reviewed ? "题目已审核通过" : "已取消审核通过");
      }
    } catch (error) {
      notify(`审核操作失败：${error.message}`);
    }
  }

  async function qualityCheck(options = {}) {
    try {
      if (state.generatedDraft?.questions?.length) {
        const saved = await saveGeneratedContent(state.generatedDraft, { silent: true });
        if (!saved) return null;
      }
      if (!authoringQuestions.value.length) {
        notify("请先生成并保存试卷内容");
        state.activeWorkflowStep = "config";
        return null;
      }
      const result = await request("/api/quality/check", { method: "POST", body: JSON.stringify({}) });
      await refresh();
      state.authoringNewDraftActive = state.authoringNewDraftActive || (!state.authoringPaperId && questions.value.length > 0);
      const failureCount = result.failures?.length || 0;
      if (failureCount > 0) {
        state.activeWorkflowStep = "quality";
        if (!options.auto) notify(`质量复检发现 ${failureCount} 个问题，请先自动修复`);
        return result;
      }
      state.activeWorkflowStep = "quality";
      notify("质量复检通过，稍后进入人工审核");
      await pause(1200);
      state.activeWorkflowStep = "review";
      return result;
    } catch (error) {
      notify(`质量复检失败：${error.message}`);
      return null;
    }
  }

  async function repairQuality() {
    try {
      const result = await request("/api/quality/repair", { method: "POST", body: JSON.stringify({}) });
      await refresh();
      const remaining = result.checks?.failures?.length || 0;
      state.activeWorkflowStep = remaining > 0 ? "quality" : "review";
      notify(remaining > 0 ? `自动修复完成：剩余 ${remaining} 个问题` : "自动修复完成，进入人工审核");
    } catch (error) {
      notify(`自动修复失败：${error.message}`);
    }
  }

  async function savePaper() {
    try {
      await request("/api/papers/build", {
        method: "POST",
        body: JSON.stringify({ name: state.dashboard?.generationTask?.paperName }),
      });
      await refresh();
      state.activeWorkflowStep = "publish";
      const savedPaperId = state.dashboard?.paper?.id || state.selectedPaperId;
      if (savedPaperId) {
        state.authoringPaperId = savedPaperId;
        state.editingPaperId = savedPaperId;
        location.hash = formatRouteHash("authoring", { paperid: savedPaperId });
      }
      state.selectedPaperId = savedPaperId || state.selectedPaperId;
      if (state.selectedPaperId) await selectPaper(state.selectedPaperId);
      notify("试卷已保存");
    } catch (error) {
      notify(`保存试卷失败：${error.message}`);
    }
  }

  async function publishPaper() {
    try {
      await request("/api/papers/publish", { method: "POST", body: JSON.stringify({}) });
      await refresh();
      state.activeWorkflowStep = "config";
      state.authoringPaperId = "";
      state.editingPaperId = null;
      notify("试卷已发布");
      go("papers");
    } catch (error) {
      notify(`发布失败：${error.message}`);
    }
  }

  function openQuestionEditor(question) {
    const options = normalizeEditorOptions(question.options, question.type);
    state.editingQuestion = question;
    state.questionEditErrors = {};
    state.questionEditForm = {
      id: question.id,
      type: question.type,
      stem: question.stem || "",
      optionA: options[0] || "",
      optionB: options[1] || "",
      optionC: options[2] || "",
      optionD: options[3] || "",
      answerSingle: Array.isArray(question.answer) ? question.answer[0] || "A" : String(question.answer || "A"),
      answerMultiple: Array.isArray(question.answer) ? [...question.answer] : String(question.answer || "").split(/[,，、\s]+/).filter(Boolean),
      answerText: Array.isArray(question.answer) ? question.answer.join("、") : String(question.answer ?? ""),
      score: Number(question.score || 1),
      difficulty: question.difficulty || "中",
      explanation: question.explanation || "",
    };
    mountIcons();
  }

  function closeQuestionEditor() {
    state.editingQuestion = null;
    state.questionEditForm = null;
    state.questionEditErrors = {};
  }

  async function saveQuestionEdit() {
    const form = state.questionEditForm;
    if (!form?.id) return;
    const errors = validateQuestionEditForm(form);
    state.questionEditErrors = errors;
    if (!showFirstFormError(errors)) return;
    try {
      const payload = {
        stem: String(form.stem || "").trim(),
        options: buildEditedOptions(form),
        answer: normalizeEditedAnswer(form),
        score: clampNumber(form.score, 1, 200, 1),
        difficulty: form.difficulty,
        explanation: String(form.explanation || "").trim(),
        status: "待确认",
        quality: 88,
      };
      await request(`/api/questions/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      closeQuestionEditor();
      await refresh();
      state.activeWorkflowStep = "review";
      notify("题目已更新，请重新审核");
    } catch (error) {
      notify(`题目保存失败：${error.message}`);
    }
  }

  function validateSpecForm() {
    const errors = {};
    if (!String(state.spec.paperName || "").trim()) errors.paperName = "请输入考卷名称";
    if (!String(state.spec.direction || "").trim()) errors.direction = "请输入出题方向";
    const count = paperTypeConfig.reduce((sum, item) => sum + clampNumber(state.spec[item.countKey], 0, 50, 0), 0);
    if (count <= 0) errors.questionCount = "请至少设置一种题型数量";
    paperTypeConfig.forEach((item) => {
      const score = Number(state.spec[item.scoreKey]);
      if (!Number.isFinite(score) || score < 1 || score > 200) errors[item.scoreKey] = item.type + "每题分值需为 1 到 200";
    });
    return errors;
  }

  function validateQuestionEditForm(form) {
    const errors = {};
    if (!String(form.stem || "").trim()) errors.stem = "请输入题干";
    if (["单选", "多选"].includes(form.type)) {
      ["optionA", "optionB", "optionC", "optionD"].forEach((key, index) => {
        if (!String(form[key] || "").trim()) errors[key] = "请输入选项 " + ["A", "B", "C", "D"][index];
      });
    }
    if (form.type === "多选" && !form.answerMultiple?.length) errors.answerMultiple = "请至少选择一个答案";
    if (!["单选", "多选", "判断"].includes(form.type) && !String(form.answerText || "").trim()) errors.answerText = "请输入答案";
    return errors;
  }

  function showFirstFormError(errors) {
    const first = Object.values(errors || {})[0];
    if (!first) return true;
    notify(first);
    return false;
  }

  function readSpec() {
    const typeCounts = Object.fromEntries(paperTypeConfig.map((item) => [item.apiKey, clampNumber(state.spec[item.countKey], 0, 50, 0)]));
    const typeScores = Object.fromEntries(paperTypeConfig.map((item) => [item.apiKey, clampNumber(state.spec[item.scoreKey], 1, 200, item.defaultScore)]));
    return {
      title: state.dashboard?.exam?.title || "综合能力测评",
      paperName: String(state.spec.paperName || "A 卷").trim(),
      direction: String(state.spec.direction || "").trim(),
      difficulty: state.spec.difficulty,
      totalScore: computedSpecTotalScore.value,
      count: Object.values(typeCounts).reduce((sum, value) => sum + value, 0),
      typeCounts,
      typeScores,
      knowledge: splitList(state.spec.knowledge),
      knowledgeInputEmpty: !String(state.spec.knowledge || "").trim(),
      requirements: String(state.spec.requirements || "").trim(),
    };
  }

  return {
    closeQuestionEditor,
    discardDraft,
    generateDraft,
    openQuestionEditor,
    publishPaper,
    qualityCheck,
    regenerate,
    repairQuality,
    reviewQuestion,
    saveDraft,
    savePaper,
    saveQuestionEdit,
    setWorkflowStep,
  };
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatGenerationError(message) {
  const text = String(message || "");
  if (text.includes("UND_ERR_CONNECT_TIMEOUT") || text.includes("Connect Timeout")) {
    return "AI 服务连接超时，请检查服务器网络是否能访问配置的 AI 服务地址，或确认 OPENAI_BASE_URL 服务当前可用。";
  }
  return text;
}
