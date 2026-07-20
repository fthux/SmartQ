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

export function createAuthoringStore({
  state,
  refresh,
  notify,
  formLocked,
  workflowSteps,
  authoringQuestions,
  computedSpecTotalScore,
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
    state.spec.categoryId = String(spec.categoryId || state.dashboard?.paper?.categoryId || state.spec.categoryId || "");
    state.spec.paperName = spec.paperName || state.spec.paperName || "";
    state.spec.direction = spec.direction || state.spec.direction || "";
    state.spec.difficulty = spec.difficulty || state.spec.difficulty || "中";
    state.spec.knowledge = spec.knowledgeInputEmpty ? "" : Array.isArray(spec.knowledge) ? spec.knowledge.join("，") : state.spec.knowledge || "";
    state.spec.requirements = spec.requirements || state.spec.requirements || "";
    const sourcePlan = spec.sourcePlan || {};
    const legacyQuestionBankItems = authoringQuestions.value
      .filter((item) => item.origin?.type === "question-bank" && item.origin?.bankQuestionId)
      .map((item) => ({
        id: item.origin.bankQuestionId,
        type: item.type,
        stem: item.stem,
        version: item.origin.bankVersion || 1,
      }));
    const sourceQuestionBankItems = Array.isArray(sourcePlan.questionBankItems) && sourcePlan.questionBankItems.length
      ? sourcePlan.questionBankItems
      : legacyQuestionBankItems;
    state.spec.sourceMode = ["ai-only", "mixed", "materials-only"].includes(sourcePlan.mode) ? sourcePlan.mode : "ai-only";
    state.spec.questionBankIds = Array.isArray(sourcePlan.questionBankIds) && sourcePlan.questionBankIds.length
      ? [...sourcePlan.questionBankIds]
      : sourceQuestionBankItems.map((item) => item.id).filter(Boolean);
    state.spec.questionBankItems = sourceQuestionBankItems.length
      ? sourceQuestionBankItems.map((item) => ({ ...item }))
      : state.spec.questionBankIds.map((id) => ({ id }));
    state.spec.materialIds = Array.isArray(sourcePlan.materialIds)
      ? [...sourcePlan.materialIds]
      : Array.isArray(sourcePlan.materials) ? sourcePlan.materials.map((item) => item.id).filter(Boolean) : [];
    state.spec.materialQuestionCount = clampNumber(sourcePlan.materialQuestionCount, 0, Number(spec.count || 100), 0);
    state.spec.coverageStrategy = sourcePlan.coverageStrategy === "best-match" ? "best-match" : "balanced";
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
      state.publishQualityFailures = [];
      notify("试卷已生成预览，确认后将保存并进入试卷编辑");
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
        body: JSON.stringify({
          questions: generated.questions,
          spec: generated.spec,
          paperId: state.authoringPaperId || "",
        }),
      });
      const builtPaper = await request("/api/papers/build", {
        method: "POST",
        body: JSON.stringify({
          name: generated.spec?.paperName || state.spec.paperName,
          categoryId: generated.spec?.categoryId || state.spec.categoryId,
        }),
      });
      state.generatedDraft = null;
      state.regeneratingDraft = false;
      state.authoringPaperId = builtPaper.id;
      state.editingPaperId = builtPaper.id;
      await refresh();
      state.authoringNewDraftActive = false;
      state.authoringCreateMode = false;
      syncSpecFromActiveDraft();
      state.publishQualityFailures = [];
      state.activeWorkflowStep = "edit";
      go("authoring", { paperid: builtPaper.id });
      if (!options.silent) notify("试卷已保存，可以继续编辑或发布");
      return { ...result, paper: builtPaper };
    } finally {
      state.saving = false;
    }
  }

  function startGenerationProgress() {
    stopGenerationProgress();
    state.generationStartedAt = Date.now();
    state.generationProgress = 0;
    setGenerationProgress(6);
    state.generationTimer = setInterval(() => {
      const elapsed = Date.now() - state.generationStartedAt;
      const current = state.generationProgress;
      let next = current;
      if (elapsed < 1200) next = Math.min(18, current + 3);
      else if (elapsed < 5000) next = Math.min(45, current + 2);
      else if (elapsed < 11000) next = Math.min(72, current + 1);
      else next = Math.min(92, current + 0.5);
      setGenerationProgress(Math.round(next));
    }, 420);
  }

  function stopGenerationProgress() {
    if (!state.generationTimer) return;
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }

  function setGenerationProgress(value, stage) {
    const progress = Math.max(state.generationProgress, Math.max(0, Math.min(100, value)));
    state.generationProgress = progress;
    state.generationStage = generationStageForProgress(progress, stage);
  }

  async function saveDraft() {
    if (!state.generatedDraft?.questions?.length) {
      notify("暂无可保存的试卷");
      return;
    }
    try {
      await saveGeneratedContent(state.generatedDraft);
    } catch (error) {
      notify(`保存失败：${error.message}`);
    }
  }

  function discardDraft() {
    state.generatedDraft = null;
    state.regeneratingDraft = false;
    state.publishQualityFailures = [];
    state.activeWorkflowStep = "config";
    notify("已丢弃本次生成结果");
  }

  function regenerate() {
    state.regeneratingDraft = true;
    state.activeWorkflowStep = "config";
    state.generationError = "";
    state.generationStage = "";
    state.generationProgress = 0;
    state.publishQualityFailures = [];
    notify("已进入重新生成模式");
  }

  async function saveCurrentPaper(options = {}) {
    if (!authoringQuestions.value.length) {
      if (!options.silent) notify("当前试卷没有可保存的题目");
      return null;
    }
    state.saving = true;
    try {
      const builtPaper = await request("/api/papers/build", {
        method: "POST",
        body: JSON.stringify({
          name: state.dashboard?.generationTask?.paperName || state.spec.paperName,
          categoryId: state.dashboard?.generationTask?.categoryId || state.spec.categoryId,
        }),
      });
      state.authoringPaperId = builtPaper.id;
      state.editingPaperId = builtPaper.id;
      state.authoringNewDraftActive = false;
      state.authoringCreateMode = false;
      await refresh();
      go("authoring", { paperid: builtPaper.id });
      state.activeWorkflowStep = options.nextStep || "edit";
      if (!options.silent) notify("试卷已保存");
      return builtPaper;
    } catch (error) {
      if (!options.silent) notify(`保存试卷失败：${error.message}`);
      return null;
    } finally {
      state.saving = false;
    }
  }

  async function publishPaper() {
    state.publishing = true;
    state.publishQualityFailures = [];
    try {
      await request("/api/papers/publish", { method: "POST", body: JSON.stringify({}) });
      await refresh();
      state.activeWorkflowStep = "config";
      state.authoringPaperId = "";
      state.editingPaperId = null;
      notify("试卷已发布");
      go("papers");
    } catch (error) {
      const failures = Array.isArray(error.payload?.failures) ? error.payload.failures : [];
      if (failures.length) {
        state.publishQualityFailures = failures;
        state.activeWorkflowStep = "publish";
        notify(`发布已终止：发现 ${failures.length} 个问题，请修改后重新发布`);
      } else {
        notify(`发布失败：${error.message}`);
      }
    } finally {
      state.publishing = false;
    }
  }

  function openQuestionEditor(question) {
    state.editingQuestion = question;
    state.questionEditErrors = {};
    state.questionEditForm = editorFormFromQuestion(question);
    resetQuestionAiState();
    mountIcons();
  }

  function closeQuestionEditor() {
    state.editingQuestion = null;
    state.questionEditForm = null;
    state.questionEditErrors = {};
    resetQuestionAiState();
  }

  async function runQuestionAiTransform(operation) {
    const form = state.questionEditForm;
    if (!form?.id || state.questionAi.loading) return;
    if (operation === "custom" && !String(state.questionAi.customPrompt || "").trim()) {
      state.questionAi.error = "请输入希望 AI 如何修改这道题";
      return;
    }
    state.questionAi.loading = true;
    state.questionAi.operation = operation;
    state.questionAi.candidate = null;
    state.questionAi.changedFields = [];
    state.questionAi.warnings = [];
    state.questionAi.error = "";
    try {
      const result = await request(`/api/questions/${form.id}/ai-transform`, {
        method: "POST",
        body: JSON.stringify({
          operation,
          prompt: operation === "custom" ? String(state.questionAi.customPrompt || "").trim() : "",
          draft: questionFromEditorForm(form, state.editingQuestion),
        }),
      });
      state.questionAi.candidate = result.candidate;
      state.questionAi.changedFields = result.changedFields || [];
      state.questionAi.warnings = result.warnings || [];
    } catch (error) {
      state.questionAi.error = error.message || "AI 题目修改失败";
    } finally {
      state.questionAi.loading = false;
    }
  }

  function applyQuestionAiCandidate() {
    const candidate = state.questionAi.candidate;
    if (!candidate || !state.questionEditForm) return;
    state.questionAi.previousForm = cloneValue(state.questionEditForm);
    state.questionEditForm = editorFormFromQuestion({
      ...candidate,
      id: state.questionEditForm.id,
    });
    state.questionAi.appliedOperation = state.questionAi.operation;
    state.questionAi.candidate = null;
    state.questionAi.changedFields = [];
    state.questionAi.error = "";
    state.questionEditErrors = {};
    notify("AI 修改已应用到编辑区，保存题目后生效");
  }

  function discardQuestionAiCandidate() {
    state.questionAi.candidate = null;
    state.questionAi.changedFields = [];
    state.questionAi.warnings = [];
    state.questionAi.error = "";
  }

  function undoQuestionAiChange() {
    if (!state.questionAi.previousForm) return;
    state.questionEditForm = cloneValue(state.questionAi.previousForm);
    state.questionAi.previousForm = null;
    state.questionAi.appliedOperation = "";
    state.questionEditErrors = {};
    notify("已撤销本次 AI 修改");
  }

  function moveQuestionOption(index, offset) {
    const form = state.questionEditForm;
    const target = index + offset;
    if (!form || !["单选", "多选"].includes(form.type) || target < 0 || target > 3) return;
    swapQuestionOptions(form, index, target);
  }

  function moveSingleCorrectAnswer(targetLetter) {
    const form = state.questionEditForm;
    if (!form || form.type !== "单选") return;
    const currentIndex = optionIndex(form.answerSingle);
    const targetIndex = optionIndex(targetLetter);
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return;
    swapQuestionOptions(form, currentIndex, targetIndex);
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
        rubric: ["简答", "论述"].includes(form.type) ? splitList(form.rubricText) : undefined,
        quality: clampNumber(form.quality, 70, 100, state.editingQuestion?.quality || 88),
        origin: form.origin ? cloneValue(form.origin) : undefined,
        aiTransformMeta: state.questionAi.appliedOperation ? { operation: state.questionAi.appliedOperation } : undefined,
      };
      await request(`/api/questions/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      state.publishQualityFailures = state.publishQualityFailures.filter((item) => item.questionId !== form.id);
      closeQuestionEditor();
      await refresh();
      state.activeWorkflowStep = "edit";
      notify("题目已保存");
    } catch (error) {
      notify(`题目保存失败：${error.message}`);
    }
  }

  function resetQuestionAiState() {
    Object.assign(state.questionAi, {
      loading: false,
      operation: "",
      customPrompt: "",
      candidate: null,
      changedFields: [],
      warnings: [],
      error: "",
      previousForm: null,
      appliedOperation: "",
    });
  }

  function swapQuestionOptions(form, leftIndex, rightIndex) {
    const leftKey = `option${optionLetter(leftIndex)}`;
    const rightKey = `option${optionLetter(rightIndex)}`;
    [form[leftKey], form[rightKey]] = [form[rightKey], form[leftKey]];
    const remap = (letter) => {
      if (letter === optionLetter(leftIndex)) return optionLetter(rightIndex);
      if (letter === optionLetter(rightIndex)) return optionLetter(leftIndex);
      return letter;
    };
    if (form.type === "单选") form.answerSingle = remap(form.answerSingle);
    if (form.type === "多选") form.answerMultiple = [...new Set((form.answerMultiple || []).map(remap))].sort();
  }

  function validateSpecForm() {
    const errors = {};
    if (!String(state.spec.paperName || "").trim()) errors.paperName = "请输入考卷名称";
    if (!String(state.spec.direction || "").trim()) errors.direction = "请输入出题方向";
    const category = state.questionBankManagement.categories.find((item) => item.id === state.spec.categoryId);
    if (!category || category.status !== "active" || !category.isLeaf) errors.categoryId = "请选择有效的叶子分类";
    const count = paperTypeConfig.reduce((sum, item) => sum + clampNumber(state.spec[item.countKey], 0, 50, 0), 0);
    if (count <= 0) errors.questionCount = "请至少设置一种题型数量";
    const questionBankIds = Array.isArray(state.spec.questionBankIds) ? state.spec.questionBankIds : [];
    const questionBankItems = Array.isArray(state.spec.questionBankItems) ? state.spec.questionBankItems : [];
    const questionBankCount = questionBankIds.length;
    const remainingCount = Math.max(0, count - questionBankCount);
    const materialCount = clampNumber(state.spec.materialQuestionCount, 0, remainingCount, 0);
    if (questionBankCount > count) errors.questionBankIds = `题库题已选择 ${questionBankCount} 道，超过试卷总题数 ${count} 道`;
    paperTypeConfig.forEach((item) => {
      const selectedCount = questionBankItems.filter((question) => question.type === item.type).length;
      const targetCount = clampNumber(state.spec[item.countKey], 0, 50, 0);
      if (selectedCount > targetCount) {
        errors.questionBankIds = `${item.type}目标为 ${targetCount} 道，当前已选择 ${selectedCount} 道题库题，请移除至少 ${selectedCount - targetCount} 道`;
      }
    });
    if (materialCount > 0 && !(state.spec.materialIds || []).length) errors.materialIds = "资料题数量大于 0 时，请选择至少一份出题资料";
    if (Number(state.spec.materialQuestionCount || 0) > remainingCount) errors.materialQuestionCount = `资料题最多可设置 ${remainingCount} 道`;
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
    if (["简答", "论述"].includes(form.type) && !String(form.rubricText || "").trim()) errors.rubricText = "请输入评分规则";
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
      categoryId: String(state.spec.categoryId || ""),
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
      sourcePlan: {
        questionBankIds: [...(state.spec.questionBankIds || [])],
        materialIds: [...(state.spec.materialIds || [])],
        materialQuestionCount: clampNumber(
          state.spec.materialQuestionCount,
          0,
          Math.max(0, Object.values(typeCounts).reduce((sum, value) => sum + value, 0) - (state.spec.questionBankIds || []).length),
          0,
        ),
        aiQuestionCount: Math.max(
          0,
          Object.values(typeCounts).reduce((sum, value) => sum + value, 0)
            - (state.spec.questionBankIds || []).length
            - clampNumber(state.spec.materialQuestionCount, 0, Object.values(typeCounts).reduce((sum, value) => sum + value, 0), 0),
        ),
        coverageStrategy: state.spec.coverageStrategy,
      },
    };
  }

  return {
    applyQuestionAiCandidate,
    closeQuestionEditor,
    discardQuestionAiCandidate,
    discardDraft,
    generateDraft,
    moveQuestionOption,
    moveSingleCorrectAnswer,
    openQuestionEditor,
    publishPaper,
    regenerate,
    runQuestionAiTransform,
    saveCurrentPaper,
    saveDraft,
    saveQuestionEdit,
    setWorkflowStep,
    undoQuestionAiChange,
  };
}

function editorFormFromQuestion(question = {}) {
  const options = normalizeEditorOptions(question.options, question.type);
  return {
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
    rubricText: Array.isArray(question.rubric) ? question.rubric.join("\n") : "",
    quality: Number(question.quality || 88),
    origin: question.origin ? cloneValue(question.origin) : { type: "ai", materialRefs: [] },
  };
}

function questionFromEditorForm(form, original = {}) {
  return {
    id: form.id,
    type: form.type,
    stem: String(form.stem || "").trim(),
    options: buildEditedOptions(form),
    answer: normalizeEditedAnswer(form),
    score: clampNumber(form.score, 1, 200, 1),
    difficulty: form.difficulty,
    knowledge: Array.isArray(original.knowledge) ? [...original.knowledge] : splitList(original.knowledge),
    explanation: String(form.explanation || "").trim(),
    rubric: ["简答", "论述"].includes(form.type) ? splitList(form.rubricText) : [],
    quality: clampNumber(form.quality, 70, 100, original.quality || 88),
    origin: form.origin ? cloneValue(form.origin) : cloneValue(original.origin || { type: "ai", materialRefs: [] }),
  };
}

function optionLetter(index) {
  return String.fromCharCode(65 + index);
}

function optionIndex(letter) {
  const index = String(letter || "").toUpperCase().charCodeAt(0) - 65;
  return index >= 0 && index < 4 ? index : -1;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generationStageForProgress(progress, stage = "") {
  if (stage === "生成失败") return "生成失败";
  if (/连接出题服务|AI正在生成试卷/.test(stage)) {
    if (progress >= 82) return "正在整理并校验题目";
    if (progress >= 55) return "正在生成后半部分题目";
    if (progress >= 28) return "AI 正在生成题目内容";
    return "正在连接出题服务";
  }
  if (stage) return stage;
  if (progress >= 100) return "试卷已生成，等待确认";
  if (progress >= 82) return "正在整理并校验题目";
  if (progress >= 28) return "AI 正在生成题目";
  if (progress >= 12) return "正在提交生成任务";
  return "正在准备命题参数";
}

function formatGenerationError(message) {
  const text = String(message || "");
  if (text.includes("UND_ERR_CONNECT_TIMEOUT") || text.includes("Connect Timeout")) {
    return "AI 服务连接超时，请检查服务器网络是否能访问配置的 AI 服务地址，或确认 OPENAI_BASE_URL 服务当前可用。";
  }
  return text;
}
