const { computed, createApp, nextTick, onMounted, reactive, ref } = Vue;

const typeClass = {
  单选: "bg-cyan-50 text-ocean",
  多选: "bg-indigo-50 text-iris",
  判断: "bg-amber-50 text-amber-700",
  简答: "bg-rose-50 text-coral",
  论述: "bg-rose-50 text-coral",
  填空: "bg-indigo-50 text-iris",
};

const defaultSpec = {
  paperName: "C++ 工程能力测评 A 卷",
  direction: "C++ 语言基础与工程实践",
  difficulty: "中",
  totalScore: 50,
  singleCount: 4,
  multipleCount: 2,
  judgeCount: 2,
  blankCount: 2,
  shortCount: 2,
  essayCount: 0,
  knowledge: "语法基础，STL，内存管理，面向对象，异常处理",
  requirements: "题干清晰，答案唯一或评分规则明确，适合初中级开发者测评。",
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    let message = `${path} ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch { }
    throw new Error(message);
  }
  return response.json();
}

const app = createApp({
  setup() {
    const state = reactive({
      route: currentRoute(),
      dashboard: null,
      config: null,
      loading: true,
      toast: "",
      generatedDraft: null,
      regeneratingDraft: false,
      activeWorkflowStep: "config",
      saving: false,
      generating: false,
      generationProgress: 0,
      generationStage: "",
      generationError: "",
      generationStartedAt: 0,
      generationTimer: null,
      selectedPaperId: null,
      selectedPaperDetail: null,
      paperDetailLoading: false,
      confirmDeletePaper: null,
      editingQuestion: null,
      questionEditForm: null,
      editingPaperId: null,
      authoringPaperId: currentAuthoringPaperId(),
      spec: { ...defaultSpec },
    });

    const navItems = [
      { key: "home", label: "控制台首页", icon: "layout-dashboard" },
      { key: "authoring", label: "出题制卷", icon: "sparkles" },
      { key: "papers", label: "已出卷子", icon: "files" },
      { key: "proctor", label: "监考工作台", icon: "screen-share" },
      { key: "analysis", label: "阅卷分析", icon: "chart-no-axes-combined" },
    ];

    const questions = computed(() => state.dashboard?.questions || []);
    const paper = computed(() => state.dashboard?.paper || {});
    const quality = computed(() => state.dashboard?.quality || {});
    const analysis = computed(() => state.dashboard?.analysis || {});
    const sessions = computed(() => state.dashboard?.sessions || []);
    const papers = computed(() => state.dashboard?.papers || []);
    const gradingQueue = computed(() => state.dashboard?.gradingQueue || {});
    const isEditingPaper = computed(() => state.route === "authoring" && Boolean(state.authoringPaperId));
    const authoringPaperReady = computed(() => !isEditingPaper.value || paper.value.id === state.authoringPaperId);
    const authoringQuestions = computed(() => {
      if (state.route !== "authoring") return questions.value;
      if (isEditingPaper.value) return authoringPaperReady.value ? questions.value : [];
      return paper.value.id ? [] : questions.value;
    });
    const reviewedCount = computed(() => questions.value.filter((item) => item.status === "已校验").length);
    const pendingReviewCount = computed(() => Math.max(0, questions.value.length - reviewedCount.value));
    const authoringReviewedCount = computed(() => authoringQuestions.value.filter((item) => item.status === "已校验").length);
    const authoringPendingReviewCount = computed(() => Math.max(0, authoringQuestions.value.length - authoringReviewedCount.value));
    const authoringQuality = computed(() => (authoringQuestions.value.length ? quality.value : {}));
    const hasCurrentPaper = computed(() => ["未发布", "已保存", "已组卷", "已发布"].includes(paper.value.status));
    const draftReady = computed(() => Boolean(state.generatedDraft?.questions?.length || authoringQuestions.value.length));
    const formLocked = computed(() => draftReady.value && !state.regeneratingDraft);
    const totalQuestionCount = computed(
      () =>
        numberValue(state.spec.singleCount) +
        numberValue(state.spec.multipleCount) +
        numberValue(state.spec.judgeCount) +
        numberValue(state.spec.blankCount) +
        numberValue(state.spec.shortCount) +
        numberValue(state.spec.essayCount),
    );
    const workflowSteps = computed(() => {
      const hasUnsavedDraft = Boolean(state.generatedDraft?.questions?.length);
      const hasPersistedQuestions = authoringQuestions.value.length > 0 && !hasUnsavedDraft;
      const hasActiveAuthoring = hasPersistedQuestions && authoringPaperReady.value;
      const configDone = (hasUnsavedDraft || hasActiveAuthoring) && !state.regeneratingDraft;
      const q = authoringQuality.value;
      const qualityPassed =
        hasActiveAuthoring && Number(q.schemaPassRate || 0) >= 100 && Number(q.answerConsistency || 0) >= 90 && !(q.failures || []).length;
      const saved = hasActiveAuthoring && hasCurrentPaper.value && (!isEditingPaper.value || paper.value.id === state.authoringPaperId);
      const published = saved && paper.value.status === "已发布";
      return [
        {
          key: "config",
          title: "命题配置",
          meta: configDone ? "试卷内容已生成" : "填写考卷、方向、题型",
          status: configDone ? "done" : "active",
          action: configDone ? "查看配置" : "填写参数",
          clickable: true,
        },
        {
          key: "quality",
          title: "质量复检",
          meta: hasActiveAuthoring ? `${(q.failures || []).length} 个结构问题` : "生成并保存内容后复检",
          status: qualityPassed ? "done" : hasActiveAuthoring ? "active" : "pending",
          action: "执行复检",
          clickable: qualityPassed || hasActiveAuthoring,
        },
        {
          key: "review",
          title: "人工审核",
          meta: hasActiveAuthoring ? `${authoringReviewedCount.value}/${authoringQuestions.value.length} 已通过` : "等待生成试卷",
          status: hasActiveAuthoring && authoringPendingReviewCount.value === 0 ? "done" : hasActiveAuthoring ? "active" : "pending",
          action: "审核题目",
          clickable: hasActiveAuthoring,
        },
        {
          key: "save",
          title: "保存试卷",
          meta: saved ? `${paper.value.score || 0} 分 · ${paper.value.questionCount || 0} 题` : "审核完成后保存",
          status: saved ? "done" : hasActiveAuthoring && authoringPendingReviewCount.value === 0 ? "active" : "pending",
          action: "保存试卷",
          clickable: saved || (hasActiveAuthoring && authoringPendingReviewCount.value === 0),
        },
        {
          key: "publish",
          title: "发布试卷",
          meta: published ? "已发布给考生" : saved ? "可发布" : "等待保存",
          status: published ? "done" : saved ? "active" : "pending",
          action: published ? "已发布" : "发布试卷",
          clickable: published || saved,
        },
      ];
    });

    const visibleWorkflowStep = computed(() => state.activeWorkflowStep);
    const dashboardCards = computed(() => [
      { label: "考试场次", value: 1, tone: "text-ink", icon: "calendar-check" },
      { label: "已发布试卷", value: papers.value.filter((item) => item.status === "已发布").length, tone: "text-leaf", icon: "send" },
      { label: "在线考生", value: state.dashboard?.stats?.online || 0, tone: "text-ocean", icon: "users" },
      { label: "待审核题目", value: pendingReviewCount.value, tone: "text-honey", icon: "badge-alert" },
      { label: "监考风险", value: state.dashboard?.stats?.risk || 0, tone: "text-coral", icon: "shield-alert" },
      { label: "待复核答卷", value: gradingQueue.value.subjectivePending || 0, tone: "text-iris", icon: "check-check" },
    ]);
    const todos = computed(() =>
      [
        {
          title: `${pendingReviewCount.value} 道题目待人工审核`,
          desc: "审核通过后才能保存试卷",
          action: "去审核",
          route: "authoring",
          show: pendingReviewCount.value > 0,
        },
        {
          title: hasCurrentPaper.value ? "有未发布试卷待处理" : "有试卷内容待保存",
          desc: hasCurrentPaper.value ? "发布后可进入考生分配流程" : "完成题目审核后保存为未发布试卷",
          action: hasCurrentPaper.value ? "去处理" : "保存试卷",
          route: hasCurrentPaper.value ? "papers" : "authoring",
          show: paper.value.status !== "已发布" && (hasCurrentPaper.value || questions.value.length > 0),
        },
        {
          title: `${state.dashboard?.stats?.risk || 0} 个监考风险需处理`,
          desc: "查看离开页面、摄像头异常和断线重连",
          action: "查看监考",
          route: "proctor",
          show: (state.dashboard?.stats?.risk || 0) > 0,
        },
        {
          title: `${gradingQueue.value.subjectivePending || 0} 份主观题待复核`,
          desc: "确认 AI 初评分后进入分析统计",
          action: "去复核",
          route: "analysis",
          show: (gradingQueue.value.subjectivePending || 0) > 0,
        },
      ].filter((item) => item.show),
    );
    const recentPapers = computed(() => {
      const rows = papers.value.length ? papers.value : paper.value.questionCount ? [paper.value] : [];
      return rows.slice(0, 5);
    });
    const paperRows = computed(() => {
      return papers.value
        .slice()
        .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
    });
    const proctorSummary = computed(() => {
      const riskRows = sessions.value.filter((item) => item.risk !== "低");
      return {
        online: sessions.value.filter((item) => item.status !== "离线").length,
        highRisk: riskRows.filter((item) => item.risk === "高").length,
        mediumRisk: riskRows.filter((item) => item.risk === "中").length,
        latest: riskRows.slice(0, 4),
      };
    });

    async function refresh() {
      state.loading = true;
      try {
        const [dashboard, config] = await Promise.all([request("/api/dashboard"), request("/api/config")]);
        state.dashboard = dashboard;
        state.config = config;
      } catch (error) {
        notify(`数据加载失败：${error.message}`);
      } finally {
        state.loading = false;
        mountIcons();
      }
    }

    function go(route, params = {}) {
      state.route = route;
      if (route === "authoring") {
        state.authoringPaperId = params.paperid || params.paperId || params.papeid || "";
        state.editingPaperId = state.authoringPaperId || null;
        if (!state.authoringPaperId) state.activeWorkflowStep = "config";
      }
      if (route === "papers") {
        clearSelectedPaper();
      }
      location.hash = formatRouteHash(route, params);
      mountIcons();
    }

    function setWorkflowStep(step) {
      const target = workflowSteps.value.find((item) => item.key === step);
      if (target && !target.clickable) return;
      state.activeWorkflowStep = step;
      if (step === "save") state.activeWorkflowStep = "save";
      mountIcons();
    }

    async function generateDraft() {
      if (formLocked.value) {
        notify("命题配置已锁定，如需修改请先点击重新生成");
        return;
      }
      const wasRegenerating = state.regeneratingDraft;
      const previousGeneratedDraft = state.generatedDraft;
      const previousActiveStep = state.activeWorkflowStep;
      state.generating = true;
      state.generationError = "";
      startGenerationProgress();
      try {
        const generated = await request("/api/ai/generate-questions", {
          method: "POST",
          body: JSON.stringify(readSpec()),
        });
        stopGenerationProgress();
        setGenerationProgress(Math.max(state.generationProgress, 92), "校验试卷结构");
        state.generatedDraft = generated;
        state.regeneratingDraft = false;
        state.activeWorkflowStep = "quality";
        if (wasRegenerating) {
          setGenerationProgress(86, "重置旧试卷流程");
          await refresh();
        }
        const failures = (generated.checks?.failures?.length || 0) + (generated.checks?.specFailures?.length || 0);
        setGenerationProgress(100, failures ? "试卷已生成，进入质量复检" : "试卷已生成，进入质量复检");
        state.generating = false;
        await saveGeneratedContent(generated, { silent: true });
        const qualityResult = await qualityCheck({ auto: true });
        const qualityFailures = qualityResult?.failures?.length || 0;
        if (qualityFailures > 0) {
          notify(`试卷已生成，质量复检发现 ${qualityFailures} 个问题，请先自动修复`);
        } else {
          notify("试卷已生成并通过质量复检，进入人工审核");
        }
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
          }),
        });
        state.generatedDraft = null;
        state.regeneratingDraft = false;
        await refresh();
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

        const stage =
          next < 20
            ? "准备命题参数"
            : next < 48
              ? "连接 AI 出题服务"
              : next < 76
                ? "AI 正在生成试卷"
                : "等待 AI 返回并校验结构";
        setGenerationProgress(Math.round(next), stage);
      }, 420);
    }

    function stopGenerationProgress() {
      if (state.generationTimer) {
        clearInterval(state.generationTimer);
        state.generationTimer = null;
      }
    }

    function setGenerationProgress(value, stage) {
      state.generationProgress = Math.max(0, Math.min(100, value));
      state.generationStage = stage;
    }

    function formatGenerationError(message) {
      const text = String(message || "");
      if (text.includes("UND_ERR_CONNECT_TIMEOUT") || text.includes("Connect Timeout")) {
        return "AI 服务连接超时，请检查服务器网络是否能访问 edge.ai.minigameland.com:443，或确认 baseUrl 服务当前可用。";
      }
      return text;
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
          body: JSON.stringify({ status: reviewed ? "已校验" : "待确认", quality: reviewed ? Math.max(92, Number(question.quality || 90)) : 88 }),
        });
        await refresh();
        state.activeWorkflowStep = "review";
        notify(reviewed ? "题目已审核通过" : "已取消审核通过");
      } catch (error) {
        notify(`审核操作失败：${error.message}`);
      }
    }

    async function qualityCheck(options = {}) {
      try {
        const result = await request("/api/quality/check", { method: "POST", body: JSON.stringify({}) });
        await refresh();
        const failureCount = result.failures?.length || 0;
        state.activeWorkflowStep = failureCount > 0 ? "quality" : "review";
        if (!options.auto) notify(failureCount > 0 ? `质量复检发现 ${failureCount} 个问题，请先自动修复` : "质量复检通过，进入人工审核");
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
        state.activeWorkflowStep = "publish";
        notify("试卷已发布");
      } catch (error) {
        notify(`发布失败：${error.message}`);
      }
    }

    async function activatePaper(id, options = {}) {
      try {
        await request(`/api/papers/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
        await refresh();
        if (!options.silent) notify("已切换当前试卷");
      } catch (error) {
        notify(`切换失败：${error.message}`);
      }
    }

    async function selectPaper(id) {
      state.selectedPaperId = id;
      state.paperDetailLoading = true;
      try {
        state.selectedPaperDetail = await request(`/api/papers/${id}`);
      } catch (error) {
        state.selectedPaperDetail = null;
        notify(`加载试卷失败：${error.message}`);
      } finally {
        state.paperDetailLoading = false;
        mountIcons();
      }
    }

    function clearSelectedPaper() {
      state.selectedPaperId = null;
      state.selectedPaperDetail = null;
      state.paperDetailLoading = false;
    }

    function askDeletePaper(item) {
      state.confirmDeletePaper = item;
    }

    async function deletePaper() {
      const target = state.confirmDeletePaper;
      if (!target) return;
      try {
        await request(`/api/papers/${target.id}`, { method: "DELETE" });
        state.confirmDeletePaper = null;
        if (state.selectedPaperId === target.id) {
          state.selectedPaperId = null;
          state.selectedPaperDetail = null;
        }
        await refresh();
        notify("试卷已删除");
      } catch (error) {
        notify(`删除失败：${error.message}`);
      }
    }

    async function editPaper(item) {
      state.editingPaperId = item.id;
      if (state.dashboard?.paper?.id !== item.id) {
        await activatePaper(item.id);
      }
      state.activeWorkflowStep = "review";
      go("authoring", { paperid: item.id });
      notify("已进入未发布试卷编辑模式");
    }

    function openQuestionEditor(question) {
      const options = normalizeEditorOptions(question.options, question.type);
      state.editingQuestion = question;
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
    }

    async function saveQuestionEdit() {
      const form = state.questionEditForm;
      if (!form?.id) return;
      try {
        const options = buildEditedOptions(form);
        const payload = {
          stem: String(form.stem || "").trim(),
          options,
          answer: normalizeEditedAnswer(form),
          score: clampNumber(form.score, 1, 200, 1),
          difficulty: form.difficulty,
          explanation: String(form.explanation || "").trim(),
          status: "待确认",
          quality: 88,
        };
        await request(`/api/questions/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        closeQuestionEditor();
        await refresh();
        state.activeWorkflowStep = "review";
        notify("题目已更新，请重新审核");
      } catch (error) {
        notify(`题目保存失败：${error.message}`);
      }
    }

    async function reviewNextGrading() {
      const entry = Object.entries(state.dashboard?.gradingResults || {}).find(([, result]) => Number(result.subjectivePending || 0) > 0);
      if (!entry) {
        notify("暂无待复核主观题");
        return;
      }
      const [sessionId, result] = entry;
      const reviews = (result.details || [])
        .filter((item) => item.reviewRequired && item.status !== "人工复核完成")
        .map((item) => ({
          questionId: item.questionId,
          awarded: item.awarded,
          comment: "人工复核确认 AI 初评分",
        }));
      await request("/api/grading/review", {
        method: "POST",
        body: JSON.stringify({ sessionId, reviews }),
      });
      await refresh();
      notify(`${sessionId} 主观题复核完成`);
    }

    function readSpec() {
      const typeCounts = {
        single: clampNumber(state.spec.singleCount, 0, 50, 0),
        multiple: clampNumber(state.spec.multipleCount, 0, 50, 0),
        judge: clampNumber(state.spec.judgeCount, 0, 50, 0),
        blank: clampNumber(state.spec.blankCount, 0, 50, 0),
        short: clampNumber(state.spec.shortCount, 0, 50, 0),
        essay: clampNumber(state.spec.essayCount, 0, 50, 0),
      };
      return {
        title: state.dashboard?.exam?.title || "综合能力测评",
        paperName: String(state.spec.paperName || "A 卷").trim(),
        direction: String(state.spec.direction || "").trim(),
        difficulty: state.spec.difficulty,
        totalScore: clampNumber(state.spec.totalScore, 1, 200, 50),
        count: Object.values(typeCounts).reduce((sum, value) => sum + value, 0),
        typeCounts,
        knowledge: splitList(state.spec.knowledge),
        requirements: String(state.spec.requirements || "").trim(),
      };
    }

    function notify(message) {
      state.toast = message;
      setTimeout(() => {
        if (state.toast === message) state.toast = "";
      }, 2600);
    }

    function exportAnalysis() {
      const payload = {
        exam: state.dashboard.exam,
        paper: state.dashboard.paper,
        analysis: state.dashboard.analysis,
        quality: state.dashboard.quality,
        gradingQueue: state.dashboard.gradingQueue,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "smartq-analysis-report.json";
      link.click();
      URL.revokeObjectURL(link.href);
      notify("分析报告已导出");
    }

    onMounted(async () => {
      window.addEventListener("hashchange", () => {
        state.route = currentRoute();
        state.authoringPaperId = currentAuthoringPaperId();
        state.editingPaperId = state.route === "authoring" && state.authoringPaperId ? state.authoringPaperId : null;
        if (state.route === "papers") clearSelectedPaper();
        if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
          activatePaper(state.authoringPaperId, { silent: true }).catch(() => { });
        }
        mountIcons();
      });
      await refresh();
      if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
        await activatePaper(state.authoringPaperId, { silent: true });
      }
      setInterval(() => refresh().catch(() => { }), 15000);
    });

    return {
      state,
      navItems,
      questions,
      authoringQuestions,
      authoringQuality,
      authoringReviewedCount,
      authoringPendingReviewCount,
      paper,
      quality,
      analysis,
      sessions,
      papers,
      paperRows,
      gradingQueue,
      reviewedCount,
      pendingReviewCount,
      draftReady,
      formLocked,
      totalQuestionCount,
      workflowSteps,
      visibleWorkflowStep,
      dashboardCards,
      todos,
      recentPapers,
      proctorSummary,
      go,
      setWorkflowStep,
      generateDraft,
      regenerate,
      reviewQuestion,
      qualityCheck,
      repairQuality,
      savePaper,
      publishPaper,
      activatePaper,
      selectPaper,
      askDeletePaper,
      deletePaper,
      editPaper,
      openQuestionEditor,
      closeQuestionEditor,
      saveQuestionEdit,
      reviewNextGrading,
      exportAnalysis,
      typeClass,
      displayQuestionOptions,
      displayPaperStatus,
      workflowStatusText,
      formatDateTime,
      escapeHtml,
    };
  },
  template: `
    <main class="min-h-screen w-full px-8 py-6">
      <header class="flex h-16 items-center justify-between rounded-lg border border-slate-200/80 bg-white/90 px-5 shadow-soft backdrop-blur">
        <button class="flex items-center gap-4 text-left" @click="go('home')">
          <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-lg font-black text-white">Q</span>
          <span>
            <span class="block text-lg font-black">SmartQ</span>
            <span class="block text-xs font-medium text-slate-500">通用考试 / 测评平台</span>
          </span>
        </button>
        <div class="flex w-[520px] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
          <i data-lucide="search" class="h-4 w-4 text-slate-400"></i>
          <span class="text-sm text-slate-500">搜索考试、题库、考生、报告</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="rounded-lg px-3 py-2 text-sm font-bold"
            :class="state.route === item.key ? 'bg-ink text-white' : 'border border-slate-200 bg-white text-slate-700'"
            @click="go(item.key)"
          >
            {{ item.label }}
          </button>
          <div class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" :class="state.config?.aiReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'">
            <span class="h-2 w-2 rounded-full" :class="state.config?.aiReady ? 'bg-emerald-500' : 'bg-amber-500'"></span>
            {{ state.config?.aiReady ? 'AI 已配置' : 'AI 未配置' }}
          </div>
        </div>
      </header>

      <div v-if="state.loading && !state.dashboard" class="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500 shadow-soft">
        控制台数据加载中...
      </div>

      <template v-else>
        <section v-if="state.route === 'home'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-sm font-bold text-ocean">{{ state.dashboard.exam.title }}</div>
                <h1 class="mt-2 text-3xl font-black tracking-normal">控制台首页</h1>
                <div class="mt-2 text-sm font-semibold text-slate-500">总览考试运营、待办、监考风险与阅卷分析</div>
              </div>
              <div class="flex gap-2">
                <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="go('authoring')">新建出题任务</button>
                <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="go('proctor')">查看监考</button>
              </div>
            </div>
            <div class="mt-5 grid grid-cols-6 gap-3">
              <div v-for="card in dashboardCards" :key="card.label" class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-center justify-between">
                  <div :class="['text-2xl font-black', card.tone]">{{ card.value }}</div>
                  <i :data-lucide="card.icon" class="h-4 w-4 text-slate-400"></i>
                </div>
                <div class="mt-2 text-xs font-bold text-slate-500">{{ card.label }}</div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-[1.15fr_0.85fr] gap-5">
            <div class="space-y-5">
              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <div class="flex items-center justify-between">
                  <h2 class="text-lg font-black">待办事项</h2>
                  <span class="rounded bg-cyan-50 px-2 py-1 text-xs font-black text-ocean">{{ todos.length }} 项</span>
                </div>
                <div class="mt-4 space-y-3">
                  <div v-if="!todos.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">暂无紧急待办</div>
                  <div v-for="todo in todos" :key="todo.title" class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <div class="text-sm font-black">{{ todo.title }}</div>
                      <div class="mt-1 text-xs font-semibold text-slate-500">{{ todo.desc }}</div>
                    </div>
                    <button class="rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white" @click="go(todo.route)">{{ todo.action }}</button>
                  </div>
                </div>
              </section>

            </div>

            <div class="space-y-5">
              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <h2 class="text-lg font-black">快捷操作</h2>
                <div class="mt-4 grid grid-cols-2 gap-3">
                  <button class="rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white" @click="go('authoring')">出题制卷</button>
                  <button class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700" @click="go('papers')">已出卷子管理</button>
                  <button class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700" @click="go('proctor')">监考工作台</button>
                  <button class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700" @click="go('analysis')">阅卷分析</button>
                </div>
              </section>
              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <div class="flex items-center justify-between">
                  <h2 class="text-lg font-black">监考摘要</h2>
                  <button class="text-sm font-black text-ocean" @click="go('proctor')">进入</button>
                </div>
                <div class="mt-4 grid grid-cols-3 gap-3">
                  <div class="rounded-lg bg-cyan-50 p-3"><div class="text-xl font-black text-ocean">{{ proctorSummary.online }}</div><div class="text-xs font-bold text-slate-500">在线</div></div>
                  <div class="rounded-lg bg-rose-50 p-3"><div class="text-xl font-black text-coral">{{ proctorSummary.highRisk }}</div><div class="text-xs font-bold text-slate-500">高风险</div></div>
                  <div class="rounded-lg bg-amber-50 p-3"><div class="text-xl font-black text-honey">{{ proctorSummary.mediumRisk }}</div><div class="text-xs font-bold text-slate-500">中风险</div></div>
                </div>
                <div class="mt-4 space-y-2">
                  <div v-for="item in proctorSummary.latest" :key="item.id" class="flex items-center justify-between rounded bg-slate-50 px-3 py-2 text-sm">
                    <span class="font-bold">{{ item.candidate }}</span>
                    <span class="text-xs font-black text-coral">{{ item.risk }}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div class="grid grid-cols-[1fr_0.8fr] gap-5">
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-black">近期试卷</h2>
                <button class="text-sm font-black text-ocean" @click="go('papers')">管理</button>
              </div>
              <div class="mt-4 space-y-2">
                <div v-for="item in recentPapers" :key="item.id" class="grid grid-cols-[1fr_90px_90px_96px] items-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div class="truncate font-black">{{ item.name }}</div>
                  <div class="font-bold text-slate-600">{{ item.questionCount || 0 }} 题</div>
                  <div class="font-bold text-slate-600">{{ item.score || 0 }} 分</div>
                  <div class="text-right text-xs font-black text-ocean">{{ displayPaperStatus(item.status) }}</div>
                </div>
              </div>
            </section>
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-black">阅卷与分析</h2>
                <button class="text-sm font-black text-ocean" @click="go('analysis')">查看</button>
              </div>
              <div class="mt-4 grid grid-cols-3 gap-3">
                <div class="rounded-lg bg-indigo-50 p-3"><div class="text-xl font-black text-iris">{{ gradingQueue.objectiveDone || 0 }}</div><div class="text-xs font-bold text-slate-500">已阅</div></div>
                <div class="rounded-lg bg-amber-50 p-3"><div class="text-xl font-black text-honey">{{ gradingQueue.subjectivePending || 0 }}</div><div class="text-xs font-bold text-slate-500">待复核</div></div>
                <div class="rounded-lg bg-cyan-50 p-3"><div class="text-xl font-black text-ocean">{{ analysis.averageScore || 0 }}</div><div class="text-xs font-bold text-slate-500">平均分</div></div>
              </div>
              <div class="mt-4 space-y-3">
                <div v-for="item in (analysis.knowledge || []).slice(0, 3)" :key="item.name" class="grid grid-cols-[90px_1fr_42px] items-center gap-3 text-sm">
                  <span class="font-bold">{{ item.name }}</span>
                  <span class="h-2 rounded-full bg-slate-100"><span class="block h-2 rounded-full bg-ocean" :style="{ width: item.score + '%' }"></span></span>
                  <span class="text-right font-black">{{ item.score }}</span>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section v-if="state.route === 'authoring'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-sm font-bold text-ocean">{{ state.dashboard.exam.title }}</div>
                <h1 class="mt-2 text-3xl font-black tracking-normal">出题页面</h1>
                <div class="mt-2 text-sm font-semibold text-slate-500">完成命题配置、质量复检、人工审核、保存试卷和发布</div>
                <div v-if="state.authoringPaperId" class="mt-2 inline-flex rounded bg-cyan-50 px-2 py-1 text-xs font-black text-ocean">正在编辑试卷：{{ paper.name || state.authoringPaperId }}</div>
                <div v-else class="mt-2 inline-flex rounded bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">新建试卷</div>
              </div>
              <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm font-black text-ocean">当前：{{ workflowSteps.find((item) => item.key === state.activeWorkflowStep)?.title || '命题配置' }}</div>
            </div>
            <div class="mt-5 grid grid-cols-5 gap-3">
              <button
                v-for="step in workflowSteps"
                :key="step.key"
                class="min-h-[132px] rounded-lg border p-3 text-left"
                :class="[
                  step.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : step.status === 'active' ? 'border-ocean bg-white text-ocean' : 'border-slate-200 bg-white text-slate-500',
                  state.activeWorkflowStep === step.key ? 'ring-2 ring-ocean ring-offset-2' : '',
                  step.clickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                ]"
                :disabled="!step.clickable"
                @click="setWorkflowStep(step.key)"
              >
                <div class="flex items-center justify-between">
                  <span class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black" :class="step.status === 'done' ? 'bg-leaf text-white' : step.status === 'active' ? 'bg-ocean text-white' : 'bg-slate-100 text-slate-500'">{{ step.status === 'done' ? '✓' : workflowSteps.indexOf(step) + 1 }}</span>
                  <span class="rounded bg-white/80 px-2 py-1 text-[11px] font-black">{{ workflowStatusText(step.status) }}</span>
                </div>
                <div class="mt-3 text-sm font-black text-ink">{{ step.title }}</div>
                <div class="mt-1 min-h-8 text-xs font-semibold leading-4 text-slate-500">{{ step.meta }}</div>
                <div class="mt-3 text-xs font-black">{{ step.action }}</div>
              </button>
            </div>
          </div>

          <form v-if="visibleWorkflowStep === 'config'" class="rounded-lg border border-ocean/30 bg-cyan-50/70 p-5 shadow-soft" @submit.prevent="generateDraft">
            <div class="flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 text-sm font-black text-ocean"><i data-lucide="sparkles" class="h-4 w-4"></i>AI 命题任务</div>
                <div class="mt-1 text-xs font-semibold text-slate-500">{{ formLocked ? '试卷已生成，命题参数已锁定；如需修改，请点击重新生成' : state.regeneratingDraft ? '正在重新生成模式，可调整参数并生成新的试卷' : '出题者填写命题参数后生成试卷' }}</div>
              </div>
              <div class="flex items-center gap-2">
                <button v-if="formLocked" type="button" class="rounded-lg border border-ocean/30 bg-white px-4 py-2 text-sm font-bold text-ocean" @click="regenerate">重新生成</button>
                <button v-else type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" :disabled="state.generating">{{ state.generating ? '生成中' : '生成试卷' }}</button>
              </div>
            </div>
            <div v-if="state.generating || state.generationStage" class="mt-4 rounded-lg border border-ocean/20 bg-white p-4">
              <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2 font-black text-ink">
                  <span class="flex h-7 w-7 items-center justify-center rounded-full" :class="state.generationError ? 'bg-rose-50 text-coral' : state.generationProgress === 100 ? 'bg-emerald-50 text-leaf' : 'bg-cyan-50 text-ocean'">
                    <i :data-lucide="state.generating ? 'loader-circle' : state.generationError ? 'circle-alert' : state.generationProgress === 100 ? 'check' : 'loader-circle'" class="h-4 w-4" :class="state.generating ? 'animate-spin' : ''"></i>
                  </span>
                  {{ state.generationStage || '等待生成' }}
                </div>
                <div class="font-black tabular-nums" :class="state.generationError ? 'text-coral' : 'text-ocean'">{{ state.generationProgress }}%</div>
              </div>
              <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  class="h-2.5 rounded-full transition-all duration-500 ease-out"
                  :class="state.generationError ? 'bg-coral' : 'bg-gradient-to-r from-ocean via-leaf to-iris'"
                  :style="{ width: state.generationProgress + '%' }"
                ></div>
              </div>
              <div class="mt-3 grid grid-cols-4 gap-2 text-[11px] font-black text-slate-400">
                <div :class="state.generationProgress >= 8 ? 'text-ocean' : ''">参数</div>
                <div :class="state.generationProgress >= 24 ? 'text-ocean' : ''">连接</div>
                <div :class="state.generationProgress >= 50 ? 'text-ocean' : ''">生成</div>
                <div :class="state.generationProgress >= 76 ? 'text-ocean' : ''">校验</div>
              </div>
              <div v-if="state.generationError" class="mt-3 rounded bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-coral">
                {{ state.generationError }}
              </div>
            </div>
            <fieldset :disabled="formLocked" class="mt-4">
              <div class="grid grid-cols-[1fr_1.1fr_120px_120px] gap-3">
                <label class="text-xs font-bold text-slate-600">考卷名称<input v-model="state.spec.paperName" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" /></label>
                <label class="text-xs font-bold text-slate-600">出题方向<input v-model="state.spec.direction" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" /></label>
                <label class="text-xs font-bold text-slate-600">难度<select v-model="state.spec.difficulty" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100"><option>中</option><option>易</option><option>难</option><option>混合</option></select></label>
                <label class="text-xs font-bold text-slate-600">总分<input v-model.number="state.spec.totalScore" type="number" min="1" max="200" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100" /></label>
              </div>
              <div class="mt-3 grid grid-cols-6 gap-2">
                <label class="text-xs font-bold text-slate-600">单选题<input v-model.number="state.spec.singleCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">多选题<input v-model.number="state.spec.multipleCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">判断题<input v-model.number="state.spec.judgeCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">填空题<input v-model.number="state.spec.blankCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">简答题<input v-model.number="state.spec.shortCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">论述题<input v-model.number="state.spec.essayCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
              </div>
              <div class="mt-3 grid grid-cols-[150px_1fr] gap-3">
                <div class="rounded-lg border border-slate-200 bg-white px-3 py-2"><div class="text-xs font-bold text-slate-500">自动计算题量</div><div class="mt-1 text-lg font-black text-ink">{{ totalQuestionCount }} 题</div></div>
                <label class="text-xs font-bold text-slate-600">知识点范围<input v-model="state.spec.knowledge" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
              </div>
              <label class="mt-3 block text-xs font-bold text-slate-600">补充要求<textarea v-model="state.spec.requirements" class="mt-2 min-h-16 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 disabled:bg-slate-100"></textarea></label>
            </fieldset>
            <div v-if="state.generatedDraft?.questions?.length" class="mt-4 rounded-lg border border-ocean/20 bg-white p-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-black text-ink">生成试卷预览</div>
                  <div class="mt-1 text-xs font-semibold text-slate-500">{{ state.generatedDraft.spec?.paperName }} · {{ state.generatedDraft.questions.length }} 题 · {{ state.generatedDraft.spec?.totalScore }} 分</div>
                </div>
                <div class="rounded bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">已进入质量复检</div>
              </div>
              <div class="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                <div v-for="(item, index) in state.generatedDraft.questions.slice(0, 12)" :key="item.id" class="grid grid-cols-[42px_64px_1fr_54px] items-center gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div class="font-black text-slate-500">{{ String(index + 1).padStart(2, '0') }}</div>
                  <div><span class="rounded px-2 py-1 font-bold" :class="typeClass[item.type] || 'bg-white text-slate-600'">{{ item.type }}</span></div>
                  <div class="truncate font-semibold text-ink">{{ item.stem }}</div>
                  <div class="text-right font-black text-slate-600">{{ item.score }} 分</div>
                </div>
              </div>
            </div>
          </form>

          <section v-if="visibleWorkflowStep === 'quality'" class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between">
              <div><h2 class="text-lg font-black">AI 质量控制</h2><div class="mt-1 text-xs font-semibold text-slate-500">结构校验、答案一致性、重复题和人工确认</div></div>
              <div class="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">稳定性 {{ authoringQuality.stabilityScore || 0 }}</div>
            </div>
            <div class="mt-5 grid grid-cols-4 gap-3">
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">Schema 通过率</div><div class="mt-2 text-2xl font-black text-ocean">{{ authoringQuality.schemaPassRate || 0 }}%</div></div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">答案一致性</div><div class="mt-2 text-2xl font-black text-leaf">{{ authoringQuality.answerConsistency || 0 }}%</div></div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">重复题过滤</div><div class="mt-2 text-2xl font-black text-iris">{{ authoringQuality.duplicateFiltered || 0 }}</div></div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">人工待确认</div><div class="mt-2 text-2xl font-black text-honey">{{ authoringQuality.pendingReview || 0 }}</div></div>
            </div>
            <div class="mt-5 flex gap-2">
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="qualityCheck">质量复检</button>
              <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="repairQuality">自动修复</button>
            </div>
          </section>

          <section v-if="visibleWorkflowStep === 'review'" class="rounded-lg border border-slate-200 bg-white shadow-soft">
            <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h2 class="text-lg font-black">题目列表</h2><div class="mt-1 text-xs font-semibold text-slate-500">一页展示 · {{ authoringQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0) }} 分 · {{ authoringQuestions.length }} 题</div></div>
            </div>
            <div class="grid grid-cols-[56px_96px_1fr_82px_84px_108px_148px] border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-black text-slate-500">
              <div>序号</div><div>题型</div><div>题干</div><div>难度</div><div>分值</div><div>质量</div><div>操作</div>
            </div>
            <div class="divide-y divide-slate-100 px-5">
              <div v-for="(item, index) in authoringQuestions" :key="item.id" class="grid grid-cols-[56px_96px_1fr_82px_84px_108px_148px] items-center py-3 text-sm">
                <div class="font-black">{{ String(index + 1).padStart(2, '0') }}</div>
                <div><span class="rounded px-2 py-1 text-xs font-bold" :class="typeClass[item.type] || 'bg-slate-50 text-slate-600'">{{ item.type }}</span></div>
                <div class="truncate pr-6 font-semibold">{{ item.stem }}</div>
                <div class="font-bold text-slate-600">{{ item.difficulty }}</div>
                <div class="font-bold">{{ item.score }}</div>
                <div class="font-black" :class="item.quality >= 90 ? 'text-emerald-600' : 'text-amber-600'">{{ item.quality }}</div>
                <div class="flex items-center gap-2">
                  <button class="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700" @click="openQuestionEditor(item)">编辑</button>
                  <button class="rounded px-2 py-1 text-xs font-bold" :class="item.status === '已校验' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'" @click="reviewQuestion(item, item.status !== '已校验')">{{ item.status === '已校验' ? '取消审核' : '审核' }}</button>
                </div>
              </div>
            </div>
          </section>

          <section v-if="visibleWorkflowStep === 'save' || visibleWorkflowStep === 'publish'" class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-black">试卷结构 · {{ displayPaperStatus(paper.status) }}</h2>
              <i data-lucide="file-check-2" class="h-5 w-5 text-iris"></i>
            </div>
            <div class="mt-5 grid grid-cols-3 gap-3">
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-ocean">{{ paper.score || authoringQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0) }}</div><div class="text-xs font-bold text-slate-500">试卷总分</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-iris">{{ paper.questionCount || authoringQuestions.length }}</div><div class="text-xs font-bold text-slate-500">已选题目</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-leaf">{{ authoringPendingReviewCount }}</div><div class="text-xs font-bold text-slate-500">待审核</div></div>
            </div>
            <div class="mt-5 flex gap-2">
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="savePaper">保存试卷</button>
              <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="publishPaper">发布试卷</button>
            </div>
          </section>
        </section>

        <section v-if="state.route === 'papers'" class="mt-6 grid grid-cols-[0.72fr_1.28fr] gap-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <h1 class="text-3xl font-black">已出卷子管理</h1>
            <div class="mt-1 text-sm font-semibold text-slate-500">集中管理未发布、已发布和历史试卷</div>
            <div class="mt-5 grid grid-cols-2 gap-3">
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black">{{ paperRows.length }}</div><div class="text-xs font-bold text-slate-500">历史试卷</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-leaf">{{ papers.filter((item) => item.status === '已发布').length }}</div><div class="text-xs font-bold text-slate-500">已发布</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-iris">{{ papers.filter((item) => ['未发布','已保存','已组卷'].includes(item.status)).length }}</div><div class="text-xs font-bold text-slate-500">未发布</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-ocean">{{ paperRows.reduce((sum, item) => sum + Number(item.questionCount || 0), 0) }}</div><div class="text-xs font-bold text-slate-500">列表题数</div></div>
            </div>
            <div class="mt-5 flex items-center justify-between"><h2 class="text-lg font-black">试卷列表</h2><span class="text-xs font-bold text-slate-500">最新优先</span></div>
            <div class="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
              <div
                v-for="item in paperRows"
                :key="item.id"
                class="cursor-pointer rounded-lg border p-4"
	                :class="state.selectedPaperId === item.id ? 'border-ocean bg-cyan-50' : 'border-slate-200 bg-white'"
                @click="selectPaper(item.id)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-base font-black">{{ item.name }}</div>
                    <div class="mt-1 text-sm font-semibold text-slate-500">{{ item.score || 0 }} 分 · {{ item.questionCount || 0 }} 题</div>
                    <div class="mt-2 text-xs font-semibold text-slate-400">{{ formatDateTime(item.publishedAt || item.createdAt) }}</div>
                  </div>
	                  <div class="flex shrink-0 items-center gap-1">
	                    <span class="rounded bg-white px-2 py-1 text-xs font-black text-slate-600">{{ displayPaperStatus(item.status) }}</span>
		                    <button class="rounded border border-rose-200 bg-white px-2 py-1.5 text-xs font-black text-coral" @click.stop="askDeletePaper(item)">删除</button>
	                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between">
              <div>
                <h2 class="text-lg font-black">试卷详情</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">点击左侧试卷查看完整题目</div>
              </div>
              <button
                v-if="state.selectedPaperDetail && state.selectedPaperDetail.status !== '已发布'"
                class="rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white"
                @click="editPaper(state.selectedPaperDetail)"
              >
                编辑
              </button>
            </div>
            <div v-if="state.paperDetailLoading" class="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-500">试卷加载中...</div>
            <div v-else-if="!state.selectedPaperDetail" class="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-500">请选择一份试卷</div>
            <div v-else class="mt-5">
              <div class="grid grid-cols-[1fr_100px_100px_110px] items-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div class="truncate font-black">{{ state.selectedPaperDetail.name }}</div>
                <div class="font-bold text-slate-600">{{ state.selectedPaperDetail.questionCount || 0 }} 题</div>
                <div class="font-bold text-slate-600">{{ state.selectedPaperDetail.score || 0 }} 分</div>
                <div class="text-right text-xs font-black text-ocean">{{ displayPaperStatus(state.selectedPaperDetail.status) }}</div>
              </div>
              <div class="mt-4 max-h-[620px] divide-y divide-slate-100 overflow-y-auto pr-1">
                <div v-for="(question, index) in state.selectedPaperDetail.questions || []" :key="question.id" class="grid grid-cols-[48px_72px_1fr_64px_72px] items-start gap-3 py-3 text-sm">
                  <div class="font-black text-slate-500">{{ String(index + 1).padStart(2, '0') }}</div>
                  <div><span class="rounded px-2 py-1 text-xs font-bold" :class="typeClass[question.type] || 'bg-slate-50 text-slate-600'">{{ question.type }}</span></div>
	                  <div>
	                    <div class="font-semibold leading-5">{{ question.stem }}</div>
	                    <div v-if="['单选','多选','判断'].includes(question.type)" class="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600">
	                      <div v-for="(option, optionIndex) in displayQuestionOptions(question)" :key="optionIndex" class="rounded border border-slate-100 bg-slate-50 px-2 py-1">
	                        {{ String.fromCharCode(65 + optionIndex) }}. {{ option }}
	                      </div>
	                    </div>
	                    <div class="mt-2 whitespace-pre-line text-xs font-semibold leading-5 text-slate-500">答案：{{ Array.isArray(question.answer) ? question.answer.join('、') : question.answer }}</div>
	                  </div>
                  <div class="font-bold text-slate-600">{{ question.score }} 分</div>
                  <div class="text-right text-xs font-black" :class="state.selectedPaperDetail.status === '已发布' ? 'text-slate-400' : 'text-ocean'">{{ state.selectedPaperDetail.status === '已发布' ? '只读' : '可编辑' }}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-if="state.route === 'proctor'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <h1 class="text-3xl font-black">监考工作台</h1>
            <div class="mt-1 text-sm font-semibold text-slate-500">同时监控多个在线考生考试状态</div>
            <div class="mt-5 grid grid-cols-4 gap-3">
              <div class="rounded-lg bg-cyan-50 p-4"><div class="text-2xl font-black text-ocean">{{ proctorSummary.online }}</div><div class="text-xs font-bold text-slate-500">在线考生</div></div>
              <div class="rounded-lg bg-rose-50 p-4"><div class="text-2xl font-black text-coral">{{ proctorSummary.highRisk }}</div><div class="text-xs font-bold text-slate-500">高风险</div></div>
              <div class="rounded-lg bg-amber-50 p-4"><div class="text-2xl font-black text-honey">{{ proctorSummary.mediumRisk }}</div><div class="text-xs font-bold text-slate-500">中风险</div></div>
              <div class="rounded-lg bg-indigo-50 p-4"><div class="text-2xl font-black text-iris">{{ sessions.length }}</div><div class="text-xs font-bold text-slate-500">考生会话</div></div>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-3">
            <div v-for="item in sessions" :key="item.id" class="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
              <div class="flex items-start justify-between">
                <div><div class="text-base font-black">{{ item.candidate }}</div><div class="mt-1 text-xs font-bold text-slate-500">{{ item.ticket }}</div></div>
                <span class="rounded px-2 py-1 text-xs font-black" :class="item.risk === '高' ? 'bg-rose-50 text-coral' : item.risk === '中' ? 'bg-amber-50 text-honey' : 'bg-emerald-50 text-emerald-700'">{{ item.risk }}</span>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div class="rounded bg-slate-50 p-2"><div class="font-black">{{ item.progress }}%</div><div class="text-xs font-bold text-slate-500">进度</div></div>
                <div class="rounded bg-slate-50 p-2"><div class="font-black">{{ item.remainingMinutes }}</div><div class="text-xs font-bold text-slate-500">分钟</div></div>
              </div>
              <div class="mt-3 text-xs font-semibold text-slate-500">{{ item.status }} · {{ item.camera }}</div>
            </div>
          </div>
        </section>

        <section v-if="state.route === 'analysis'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between">
              <div><h1 class="text-3xl font-black">阅卷分析</h1><div class="mt-1 text-sm font-semibold text-slate-500">阅卷队列、复核状态、成绩与知识点分析</div></div>
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="exportAnalysis">导出</button>
            </div>
            <div class="mt-5 grid grid-cols-6 gap-3">
              <div class="rounded-lg bg-indigo-50 p-4"><div class="text-2xl font-black text-iris">{{ gradingQueue.objectiveDone || 0 }}</div><div class="text-xs font-bold text-slate-500">自动阅卷</div></div>
              <div class="rounded-lg bg-amber-50 p-4"><div class="text-2xl font-black text-honey">{{ gradingQueue.subjectivePending || 0 }}</div><div class="text-xs font-bold text-slate-500">待复核</div></div>
              <div class="rounded-lg bg-emerald-50 p-4"><div class="text-2xl font-black text-leaf">{{ gradingQueue.reviewDone || 0 }}</div><div class="text-xs font-bold text-slate-500">复核完成</div></div>
              <div class="rounded-lg bg-cyan-50 p-4"><div class="text-2xl font-black text-ocean">{{ analysis.averageScore || 0 }}</div><div class="text-xs font-bold text-slate-500">平均分</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black">{{ analysis.passRate || 0 }}%</div><div class="text-xs font-bold text-slate-500">通过率</div></div>
              <div class="rounded-lg bg-rose-50 p-4"><div class="text-2xl font-black text-coral">{{ analysis.weakPoints || 0 }}</div><div class="text-xs font-bold text-slate-500">薄弱点</div></div>
            </div>
            <button class="mt-5 rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="reviewNextGrading">复核下一份</button>
          </div>
          <div class="grid grid-cols-[1fr_0.85fr] gap-5">
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <h2 class="text-lg font-black">知识点掌握度</h2>
              <div class="mt-5 space-y-3">
                <div v-for="item in analysis.knowledge || []" :key="item.name" class="grid grid-cols-[120px_1fr_48px] items-center gap-3 text-sm">
                  <span class="font-bold">{{ item.name }}</span>
                  <span class="h-2 rounded-full bg-slate-100"><span class="block h-2 rounded-full bg-ocean" :style="{ width: item.score + '%' }"></span></span>
                  <span class="text-right font-black">{{ item.score }}</span>
                </div>
              </div>
            </section>
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <h2 class="text-lg font-black">成绩分布</h2>
              <div class="mt-5 grid grid-cols-2 gap-3">
                <div v-for="item in analysis.distribution || []" :key="item.label" class="rounded-lg bg-slate-50 p-4 text-center">
                  <div class="text-2xl font-black text-ink">{{ item.count }}</div>
                  <div class="text-xs font-bold text-slate-500">{{ item.label }}</div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </template>

      <div v-if="state.toast" class="fixed right-8 top-8 z-50 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white shadow-soft">{{ state.toast }}</div>
      <div v-if="state.confirmDeletePaper" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认删除试卷</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">删除后该试卷会从已完成试卷列表中移除。确认删除「{{ state.confirmDeletePaper.name }}」吗？</div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeletePaper = null">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white" @click="deletePaper">确认删除</button>
          </div>
        </div>
      </div>
      <div v-if="state.editingQuestion && state.questionEditForm" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <form class="w-full max-w-3xl rounded-lg bg-white p-5 shadow-soft" @submit.prevent="saveQuestionEdit">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-lg font-black">编辑题目</div>
              <div class="mt-1 text-xs font-semibold text-slate-500">保存后题目会回到待确认状态</div>
            </div>
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="closeQuestionEditor">关闭</button>
          </div>
          <div class="mt-5 grid grid-cols-[120px_120px_1fr] gap-3">
            <label class="text-xs font-bold text-slate-600">题型<input v-model="state.questionEditForm.type" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
            <label class="text-xs font-bold text-slate-600">分值<input v-model.number="state.questionEditForm.score" type="number" min="1" max="200" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
            <label class="text-xs font-bold text-slate-600">难度<input v-model="state.questionEditForm.difficulty" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
          </div>
          <label class="mt-4 block text-xs font-bold text-slate-600">题干<textarea v-model="state.questionEditForm.stem" required class="mt-2 min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6"></textarea></label>
          <div v-if="['单选','多选'].includes(state.questionEditForm.type)" class="mt-4 grid grid-cols-2 gap-3">
            <label class="text-xs font-bold text-slate-600">A<input v-model="state.questionEditForm.optionA" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
            <label class="text-xs font-bold text-slate-600">B<input v-model="state.questionEditForm.optionB" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
            <label class="text-xs font-bold text-slate-600">C<input v-model="state.questionEditForm.optionC" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
            <label class="text-xs font-bold text-slate-600">D<input v-model="state.questionEditForm.optionD" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
          </div>
          <div v-else-if="state.questionEditForm.type === '判断'" class="mt-4 grid grid-cols-2 gap-3">
            <label class="text-xs font-bold text-slate-600">A<input value="正确" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
            <label class="text-xs font-bold text-slate-600">B<input value="错误" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3">
            <label v-if="state.questionEditForm.type === '单选'" class="text-xs font-bold text-slate-600">答案<select v-model="state.questionEditForm.answerSingle" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
            <label v-else-if="state.questionEditForm.type === '判断'" class="text-xs font-bold text-slate-600">答案<select v-model="state.questionEditForm.answerSingle" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><option>正确</option><option>错误</option></select></label>
            <div v-else-if="state.questionEditForm.type === '多选'" class="text-xs font-bold text-slate-600">
              <div>答案</div>
              <div class="mt-2 flex h-[38px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-3">
                <label v-for="letter in ['A','B','C','D']" :key="letter" class="flex items-center gap-1 text-sm font-black text-slate-700"><input v-model="state.questionEditForm.answerMultiple" type="checkbox" :value="letter" />{{ letter }}</label>
              </div>
            </div>
            <label v-else class="text-xs font-bold text-slate-600">答案<input v-model="state.questionEditForm.answerText" required class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
            <label class="text-xs font-bold text-slate-600">解析<input v-model="state.questionEditForm.explanation" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeQuestionEditor">取消</button>
            <button type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white">保存修改</button>
          </div>
        </form>
      </div>
    </main>
  `,
});

app.mount("#app");

function currentRoute() {
  const { route } = parseHashRoute();
  return ["authoring", "papers", "proctor", "analysis"].includes(route) ? route : "home";
}

function currentAuthoringPaperId() {
  const { route, params } = parseHashRoute();
  return route === "authoring" ? params.get("paperid") || params.get("paperId") || params.get("papeid") || "" : "";
}

function parseHashRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [route = "", query = ""] = raw.split("?");
  return {
    route,
    params: new URLSearchParams(query),
  };
}

function formatRouteHash(route, params = {}) {
  if (route === "home") return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const query = search.toString();
  return query ? `#/${route}?${query}` : `#/${route}`;
}

function mountIcons() {
  nextTick(() => window.lucide?.createIcons());
}

function workflowStatusText(status) {
  if (status === "done") return "完成";
  if (status === "active") return "当前";
  return "待办";
}

function displayPaperStatus(status) {
  return ["已组卷", "已保存"].includes(status) ? "未发布" : status || "未保存";
}

function displayQuestionOptions(question = {}) {
  if (question.type === "判断") return ["正确", "错误"];
  return Array.isArray(question.options) ? question.options : [];
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "未发布";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitList(value) {
  return String(value || "")
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeEditorOptions(options, type) {
  if (type === "判断") return ["正确", "错误", "", ""];
  const normalized = Array.isArray(options) ? options.map((item) => String(item || "")) : [];
  return [0, 1, 2, 3].map((index) => normalized[index] || "");
}

function buildEditedOptions(form) {
  if (form.type === "判断") return ["正确", "错误"];
  if (["单选", "多选"].includes(form.type)) {
    return [form.optionA, form.optionB, form.optionC, form.optionD].map((item) => String(item || "").trim());
  }
  return [];
}

function normalizeEditedAnswer(form) {
  if (form.type === "多选") return Array.isArray(form.answerMultiple) ? [...form.answerMultiple].sort() : [];
  if (form.type === "单选") return String(form.answerSingle || "A").trim().toUpperCase();
  if (form.type === "判断") return ["正确", "错误"].includes(form.answerSingle) ? form.answerSingle : "正确";
  return String(form.answerText ?? "").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
