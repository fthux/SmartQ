const { computed, createApp, nextTick, onMounted, reactive, ref, watch } = Vue;

const typeClass = {
  单选: "bg-cyan-50 text-ocean",
  多选: "bg-indigo-50 text-iris",
  判断: "bg-amber-50 text-amber-700",
  简答: "bg-rose-50 text-coral",
  论述: "bg-rose-50 text-coral",
  填空: "bg-indigo-50 text-iris",
};

const paperTypeConfig = [
  { type: "单选", countKey: "singleCount", scoreKey: "singleScore", apiKey: "single", defaultScore: 2 },
  { type: "多选", countKey: "multipleCount", scoreKey: "multipleScore", apiKey: "multiple", defaultScore: 4 },
  { type: "判断", countKey: "judgeCount", scoreKey: "judgeScore", apiKey: "judge", defaultScore: 2 },
  { type: "填空", countKey: "blankCount", scoreKey: "blankScore", apiKey: "blank", defaultScore: 2 },
  { type: "简答", countKey: "shortCount", scoreKey: "shortScore", apiKey: "short", defaultScore: 5 },
  { type: "论述", countKey: "essayCount", scoreKey: "essayScore", apiKey: "essay", defaultScore: 10 },
];

const defaultSpec = {
  paperName: "",
  direction: "",
  difficulty: "中",
  singleCount: 0,
  singleScore: 2,
  multipleCount: 0,
  multipleScore: 4,
  judgeCount: 0,
  judgeScore: 2,
  blankCount: 0,
  blankScore: 2,
  shortCount: 0,
  shortScore: 5,
  essayCount: 0,
  essayScore: 10,
  knowledge: "",
  requirements: "",
};

const publicBasePath = detectPublicBasePath();
cleanupLegacyServiceWorkers();

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function detectPublicBasePath() {
  if (typeof window.__SMARTQ_PUBLIC_BASE_PATH__ === "string") {
    return normalizeBasePath(window.__SMARTQ_PUBLIC_BASE_PATH__);
  }
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/" || pathname.includes(".")) return "";
  return normalizeBasePath(pathname);
}

function publicUrl(path = "/") {
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!publicBasePath) return normalized;
  return `${publicBasePath}${normalized}`;
}

function apiUrl(path) {
  return publicUrl(path);
}

function cleanupLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations?.()
    .then((registrations) => {
      const expectedPrefix = `${location.origin}${publicUrl("/")}`;
      registrations
        .filter((registration) => registration.scope.startsWith(expectedPrefix))
        .forEach((registration) => registration.unregister().catch(() => {}));
    })
    .catch(() => {});
}

async function request(path, options = {}) {
  const adminToken = localStorage.getItem("smartqAdminToken") || "";
  const useAdminToken = adminToken && path.startsWith("/api/") && !path.startsWith("/api/admin/login") && !["/api/health", "/api/config"].includes(path);
  const headers = {
    "content-type": "application/json",
    ...(useAdminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    ...(options.headers || {}),
  };
  if (options.skipAuth) delete headers.authorization;
  const fetchOptions = { ...options };
  delete fetchOptions.skipAuth;
  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...fetchOptions,
      headers,
    });
  } catch (error) {
    throw new Error(`网络请求失败：${error.message || "请检查服务是否可用"}`);
  }
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
      dashboardError: "",
      loading: true,
      toast: null,
      admin: {
        token: localStorage.getItem("smartqAdminToken") || "",
        user: null,
        username: localStorage.getItem("smartqAdminUsername") || "admin",
        password: "",
        rememberUsername: Boolean(localStorage.getItem("smartqAdminUsername")),
        loading: false,
        error: "",
        menuOpen: false,
      },
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
      paperSearch: "",
      paperStatusFilter: "all",
      paperPage: 1,
      paperPageSize: 6,
      confirmDeletePaper: null,
      editingQuestion: null,
      questionEditForm: null,
      questionEditErrors: {},
      editingPaperId: null,
      authoringPaperId: currentAuthoringPaperId(),
      authoringNewDraftActive: false,
      spec: { ...defaultSpec },
      specFormErrors: {},
    });

    const navItems = [
      { key: "papers", label: "已出卷子", icon: "files", permission: "papers" },
      { key: "authoring", label: "出题制卷", icon: "sparkles", permission: "authoring" },
    ];

    const adminPermissions = computed(() => state.admin.user?.permissions || []);
    const adminDisplayName = computed(() => state.admin.user?.username || state.admin.username || "admin");
    const adminAccountMenuItems = computed(() => [
      { key: "logout", label: "退出登录", icon: "log-out", tone: "danger", action: logoutAdmin },
    ]);
    const visibleNavItems = computed(() => navItems.filter((item) => !item.permission || hasAdminPermission(item.permission)));
    const currentNavItem = computed(() => navItems.find((item) => item.key === state.route) || navItems[0]);
    const questions = computed(() => state.dashboard?.questions || []);
    const paper = computed(() => state.dashboard?.paper || {});
    const quality = computed(() => state.dashboard?.quality || {});
    const papers = computed(() => state.dashboard?.papers || []);
    const publishedPapers = computed(() => papers.value.filter((item) => item.status === "已发布"));
    const isEditingPaper = computed(() => state.route === "authoring" && Boolean(state.authoringPaperId));
    const authoringPaperReady = computed(() => !isEditingPaper.value || paper.value.id === state.authoringPaperId);
    const authoringQuestions = computed(() => {
      if (state.route !== "authoring") return questions.value;
      if (isEditingPaper.value) return authoringPaperReady.value ? questions.value : [];
      return state.authoringNewDraftActive ? questions.value : [];
    });
    const reviewedCount = computed(() => questions.value.filter((item) => item.status === "已校验").length);
    const pendingReviewCount = computed(() => Math.max(0, questions.value.length - reviewedCount.value));
    const authoringReviewedCount = computed(() => authoringQuestions.value.filter((item) => item.status === "已校验").length);
    const authoringPendingReviewCount = computed(() => Math.max(0, authoringQuestions.value.length - authoringReviewedCount.value));
    const authoringQuality = computed(() => (authoringQuestions.value.length ? quality.value : {}));
    const hasCurrentPaper = computed(() => ["草稿", "未发布", "已保存", "已组卷", "已发布"].includes(paper.value.status));
    const draftReady = computed(() => Boolean(state.generatedDraft?.questions?.length || authoringQuestions.value.length));
    const formLocked = computed(() => state.generating || (draftReady.value && !state.regeneratingDraft));
    const totalQuestionCount = computed(() => paperTypeConfig.reduce((sum, item) => sum + numberValue(state.spec[item.countKey]), 0));
    const computedSpecTotalScore = computed(() =>
      paperTypeConfig.reduce((sum, item) => {
        const count = clampNumber(state.spec[item.countKey], 0, 50, 0);
        const score = clampNumber(state.spec[item.scoreKey], 1, 200, item.defaultScore);
        return sum + count * score;
      }, 0),
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
          meta: published ? "已发布" : saved ? "可发布" : "等待保存",
          status: published ? "done" : saved ? "active" : "pending",
          action: published ? "已发布" : "发布试卷",
          clickable: published || saved,
        },
      ];
    });

    const visibleWorkflowStep = computed(() => state.activeWorkflowStep);
    const documentTitle = computed(() => {
      const routeTitle = navItems.find((item) => item.key === state.route)?.label || "已出卷子";
      if (state.route === "papers" && state.selectedPaperDetail?.paper?.name) {
        return `${state.selectedPaperDetail.paper.name} - 已出卷子 - SmartQ`;
      }
      if (state.route === "authoring") {
        const title = state.authoringPaperId ? paper.value.name || state.dashboard?.generationTask?.paperName || "编辑试卷" : "出题制卷";
        return `${title} - ${routeTitle} - SmartQ`;
      }
      return `${routeTitle} - SmartQ`;
    });
    const paperRows = computed(() => {
      return papers.value
        .slice()
        .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
    });
    const filteredPaperRows = computed(() => {
      const keyword = String(state.paperSearch || "").trim().toLowerCase();
      const status = state.paperStatusFilter;
      return paperRows.value.filter((item) => {
        const text = [item.name, item.status, item.id].join(" ").toLowerCase();
        if (keyword && !text.includes(keyword)) return false;
        if (status === "published") return item.status === "已发布";
        if (status === "unpublished") return ["草稿", "未发布", "已保存", "已组卷"].includes(item.status);
        return true;
      });
    });
    const paperTotalPages = computed(() => Math.max(1, Math.ceil(filteredPaperRows.value.length / state.paperPageSize)));
    const currentPaperPage = computed(() => Math.min(state.paperPage, paperTotalPages.value));
    const pagedPaperRows = computed(() => {
      const start = (currentPaperPage.value - 1) * state.paperPageSize;
      return filteredPaperRows.value.slice(start, start + state.paperPageSize);
    });
    async function refresh() {
      if (!state.admin.token) {
        state.loading = false;
        return;
      }
      state.loading = true;
      try {
        const dashboard = await request("/api/dashboard");
        state.dashboard = dashboard;
        state.dashboardError = "";
        if (!canAccessRoute(state.route)) go("papers");
        state.paperPage = Math.min(state.paperPage, Math.max(1, Math.ceil((dashboard.papers || []).length / state.paperPageSize) || 1));
      } catch (error) {
        console.warn("Dashboard data load failed:", error);
        handleAdminAuthError(error);
        state.dashboardError = error.message || "控制台数据加载失败";
        if (!state.dashboard) notify("控制台数据加载失败：" + state.dashboardError);
      } finally {
        state.loading = false;
        mountIcons();
      }
    }

    function go(route, params = {}) {
      if (!canAccessRoute(route)) {
        notify("当前账号无权访问该模块");
        route = "papers";
        params = {};
      }
      state.route = route;
      if (route === "authoring") {
        state.authoringPaperId = params.paperid || params.paperId || params.papeid || "";
        state.editingPaperId = state.authoringPaperId || null;
        state.authoringNewDraftActive = false;
        if (!state.authoringPaperId) {
          state.generatedDraft = null;
          state.regeneratingDraft = false;
          state.spec = { ...defaultSpec };
          state.activeWorkflowStep = "config";
        }
      }
      if (route === "papers") clearSelectedPaper();
      const routeHash = formatRouteHash(route, params);
      if (routeHash) location.hash = routeHash;
      else history.replaceState(null, "", `${location.pathname}${location.search}`);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      mountIcons();
    }

    function hasAdminPermission(permission) {
      if (!permission) return true;
      const permissions = adminPermissions.value;
      return permissions.includes(permission);
    }

    function canAccessRoute(route) {
      const item = navItems.find((entry) => entry.key === route);
      return item ? hasAdminPermission(item.permission) : false;
    }

    function toggleAdminMenu() {
      state.admin.menuOpen = !state.admin.menuOpen;
      mountIcons();
    }

    function closeAdminMenu() {
      state.admin.menuOpen = false;
    }

    function runAdminAccountMenuItem(item) {
      if (!item || item.disabled) return;
      closeAdminMenu();
      if (typeof item.action === "function") item.action();
    }

    function adminAuthHeaders() {
      return state.admin.token ? { authorization: `Bearer ${state.admin.token}` } : {};
    }

    function handleAdminAuthError(error) {
      const message = String(error?.message || "");
      if (message.includes("运营登录") || message.includes("请先登录运营控制台")) {
        state.admin.token = "";
        state.admin.user = null;
        state.admin.menuOpen = false;
        localStorage.removeItem("smartqAdminToken");
        state.dashboard = null;
      }
    }

    async function loadAdminSession() {
      if (!state.admin.token) return;
      try {
        const result = await request("/api/admin/me", { headers: adminAuthHeaders() });
        state.admin.user = result.admin;
      } catch (error) {
        handleAdminAuthError(error);
      }
    }

    async function loginAdmin() {
      state.admin.error = "";
      const username = String(state.admin.username || "").trim();
      const password = String(state.admin.password || "");
      if (!username || !password) {
        state.admin.error = "请输入管理员账号和密码";
        notify(state.admin.error);
        return;
      }
      state.admin.loading = true;
      try {
        const result = await request("/api/admin/login", {
          method: "POST",
          skipAuth: true,
          body: JSON.stringify({ username, password }),
        });
        state.admin.token = result.token;
        state.admin.user = result.admin;
        state.admin.password = "";
        localStorage.setItem("smartqAdminToken", result.token);
        if (state.admin.rememberUsername) localStorage.setItem("smartqAdminUsername", username);
        else localStorage.removeItem("smartqAdminUsername");
        notify("运营控制台登录成功");
        if (!canAccessRoute(state.route)) go("papers");
        await refresh();
      } catch (error) {
        state.admin.error = error.message || "登录失败";
        notify(`登录失败：${state.admin.error}`);
      } finally {
        state.admin.loading = false;
        mountIcons();
      }
    }

    async function logoutAdmin() {
      const token = state.admin.token;
      if (token) {
        request("/api/admin/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => { });
      }
      state.admin.token = "";
      state.admin.user = null;
      state.admin.menuOpen = false;
      state.dashboard = null;
      state.dashboardError = "";
      localStorage.removeItem("smartqAdminToken");
      notify("已退出运营控制台");
      mountIcons();
    }

    function setWorkflowStep(step) {
      const target = workflowSteps.value.find((item) => item.key === step);
      if (target && !target.clickable) return;
      if (step === "config") syncSpecFromActiveDraft();
      state.activeWorkflowStep = step;
      if (step === "save") state.activeWorkflowStep = "save";
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
        const failures = (generated.checks?.failures?.length || 0) + (generated.checks?.specFailures?.length || 0);
        setGenerationProgress(100, failures ? "试卷已生成，等待确认" : "试卷已生成，等待确认");
        state.generating = false;
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
          body: JSON.stringify({
            questions: generated.questions,
            spec: generated.spec,
          }),
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

    function changePaperPage(delta) {
      state.paperPage = Math.max(1, Math.min(paperTotalPages.value, currentPaperPage.value + delta));
    }

    function resetPaperPage() {
      state.paperPage = 1;
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
      notify("已进入草稿试卷编辑模式");
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
      if (first) {
        notify(first);
        return false;
      }
      return true;
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

    function notify(message, variant = "") {
      const toast = {
        id: Date.now(),
        message,
        variant: variant || toastVariant(message),
      };
      state.toast = toast;
      setTimeout(() => {
        if (state.toast?.id === toast.id) state.toast = null;
      }, 2600);
    }

    function toastVariant(message = "") {
      const text = String(message || "");
      if (/失败|错误|异常|失效|过期|无权|不能|未找到/.test(text)) return "error";
      if (/提醒|请先|暂无|待|冲突|重复|尚未|已结束|风险|问题/.test(text)) return "warning";
      return "success";
    }

    function toastClass(toast = {}) {
      if (toast.variant === "error") return "border-coral/30 bg-rose-50 text-coral shadow-soft";
      if (toast.variant === "warning") return "border-amber-300 bg-amber-50 text-amber-800 shadow-soft";
      return "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-soft";
    }

    function toastIcon(toast = {}) {
      if (toast.variant === "error") return "circle-alert";
      if (toast.variant === "warning") return "triangle-alert";
      return "circle-check";
    }

    function fieldErrorClass(message) {
      return [
        "mt-1 min-h-4 text-xs font-bold leading-4 transition-opacity",
        message ? "text-coral opacity-100" : "text-coral opacity-0",
      ];
    }

    watch(documentTitle, (title) => {
      document.title = title;
    }, { immediate: true });

    onMounted(async () => {
      window.addEventListener("hashchange", () => {
        state.route = currentRoute();
        if (state.admin.token && !canAccessRoute(state.route)) {
          state.route = "papers";
          history.replaceState(null, "", `${location.pathname}${location.search}`);
          notify("当前账号无权访问该模块");
        }
        state.authoringPaperId = currentAuthoringPaperId();
        state.editingPaperId = state.route === "authoring" && state.authoringPaperId ? state.authoringPaperId : null;
        if (state.route === "papers") clearSelectedPaper();
        if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
          activatePaper(state.authoringPaperId, { silent: true }).catch(() => {});
        }
        mountIcons();
      });
      document.addEventListener("click", (event) => {
        if (!event.target?.closest?.("[data-admin-account-menu]")) closeAdminMenu();
      });
      await loadAdminSession();
      await refresh();
      if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
        await activatePaper(state.authoringPaperId, { silent: true });
      }
    });

    return {
      state,
      navItems,
      visibleNavItems,
      currentNavItem,
      adminPermissions,
      adminDisplayName,
      adminAccountMenuItems,
      questions,
      authoringQuestions,
      authoringQuality,
      authoringReviewedCount,
      authoringPendingReviewCount,
      paper,
      quality,
      papers,
      publishedPapers,
      paperRows,
      filteredPaperRows,
      pagedPaperRows,
      paperTotalPages,
      currentPaperPage,
      reviewedCount,
      pendingReviewCount,
      draftReady,
      formLocked,
      totalQuestionCount,
      workflowSteps,
      visibleWorkflowStep,
      paperTypeConfig,
      computedSpecTotalScore,
      refresh,
      go,
      hasAdminPermission,
      canAccessRoute,
      loginAdmin,
      logoutAdmin,
      toggleAdminMenu,
      closeAdminMenu,
      runAdminAccountMenuItem,
      setWorkflowStep,
      generateDraft,
      saveDraft,
      discardDraft,
      regenerate,
      reviewQuestion,
      qualityCheck,
      repairQuality,
      savePaper,
      publishPaper,
      activatePaper,
      selectPaper,
      changePaperPage,
      resetPaperPage,
      askDeletePaper,
      deletePaper,
      editPaper,
      openQuestionEditor,
      closeQuestionEditor,
      saveQuestionEdit,
      toastClass,
      toastIcon,
      fieldErrorClass,
      typeClass,
      displayQuestionOptions,
      displayPaperStatus,
      workflowStatusText,
      formatDateTime,
      formatDateTimeWithYear,
      formatDateOnly,
      escapeHtml,
      publicUrl,
    };
  },
  template: `
    <main :class="state.admin.token ? 'min-h-screen w-full bg-[#f3f6f8]' : 'min-h-screen w-full overflow-hidden bg-[#f2f5fa]'">
      <section v-if="!state.admin.token" class="relative flex h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-8">
        <div class="absolute inset-y-0 right-0 hidden w-1/2 bg-[#dff7ed] lg:block"></div>
        <div class="absolute left-[17%] top-[9%] hidden h-14 w-14 rotate-45 rounded-md border-[10px] border-emerald-400/70 lg:block"></div>
        <div class="absolute bottom-[9%] left-[30%] hidden h-20 w-20 rotate-45 rounded-md border-[10px] border-leaf/70 lg:block"></div>
        <div class="absolute right-[7%] top-[9%] hidden h-14 w-14 rounded-lg border-[10px] border-teal-300/75 lg:block"></div>

        <div class="relative z-10 grid w-full max-w-6xl overflow-hidden bg-white/80 shadow-[0_34px_85px_rgba(18,32,31,0.22)] lg:h-[calc(100vh-96px)] lg:min-h-[600px] lg:max-h-[720px] lg:grid-cols-[1fr_1fr]">
          <div class="flex min-h-[600px] flex-col items-center justify-center bg-[#f7f9fd]/95 px-6 py-10 sm:px-10 lg:min-h-0">
            <div class="mb-9 flex flex-col items-center text-center">
              <div class="relative flex h-20 w-48 flex-col items-center justify-center">
                <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg bg-white p-2 shadow-lg ring-1 ring-emerald-100">
                  <img :src="publicUrl('/assets/favicon.svg')" alt="SmartQ" class="h-full w-full object-contain" />
                </div>
                <div class="mt-2 text-[11px] font-black uppercase text-slate-400">SmartQ Console</div>
              </div>
            </div>

            <form novalidate class="w-full max-w-[340px] rounded border border-slate-200 bg-white px-6 py-6 shadow-[0_10px_28px_rgba(15,23,42,0.08)]" @submit.prevent="loginAdmin">
              <label class="block text-xs font-bold text-slate-500">
                管理员账号
                <input v-model="state.admin.username" autocomplete="username" class="mt-2 h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-leaf focus:ring-2 focus:ring-emerald-100" placeholder="admin" />
              </label>
              <label class="mt-4 block text-xs font-bold text-slate-500">
                登录密码
                <input v-model="state.admin.password" type="password" autocomplete="current-password" class="mt-2 h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-leaf focus:ring-2 focus:ring-emerald-100" placeholder="请输入密码" />
              </label>
              <div class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                <div class="flex items-center gap-2 text-leaf">
                  <i data-lucide="info" class="h-4 w-4"></i>
                  测试账号
                </div>
                <div class="mt-2 grid grid-cols-2 gap-2 text-slate-600">
                  <span>账号：admin</span>
                  <span>密码：123456</span>
                </div>
              </div>
              <div v-if="state.admin.error" class="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-coral">{{ state.admin.error }}</div>
              <button class="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded bg-leaf text-sm font-black text-white shadow-[0_8px_18px_rgba(22,167,115,0.24)] transition hover:bg-[#128a61] disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.admin.loading">
                <i data-lucide="log-in" class="h-4 w-4"></i>
                {{ state.admin.loading ? '登录中' : '登录控制台' }}
              </button>
              <div class="mt-4 flex items-center justify-between text-xs font-bold text-slate-400">
                <label class="flex cursor-pointer items-center gap-2 select-none">
                  <input v-model="state.admin.rememberUsername" type="checkbox" class="h-3.5 w-3.5 rounded border-slate-300 text-leaf focus:ring-leaf" />
                  记住账号
                </label>
                <span class="text-leaf">安全登录</span>
              </div>
              <div class="mt-5 border-t border-slate-100 pt-4 text-center text-xs font-black text-leaf">SmartQ 运营控制台</div>
            </form>

            <div class="mt-auto pt-8 text-center text-[11px] font-bold text-slate-500">
              © 2026 SmartQ. All rights reserved.
            </div>
          </div>

          <div class="relative hidden min-h-[600px] overflow-hidden bg-[#e7faf1] lg:block">
            <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(236,253,245,0.82),rgba(209,250,229,0.92)),radial-gradient(circle_at_70%_28%,rgba(22,167,115,0.18),transparent_34%),linear-gradient(135deg,rgba(22,167,115,0.10)_0_1px,transparent_1px_42px)]"></div>
            <div class="absolute inset-x-0 bottom-0 h-[46%] opacity-55">
              <div class="absolute bottom-0 left-0 h-28 w-full bg-[#b7ead7]"></div>
              <div class="absolute bottom-20 left-10 h-20 w-28 bg-[#8ddfbe]"></div>
              <div class="absolute bottom-24 left-36 h-14 w-20 bg-[#a7e8d0]"></div>
              <div class="absolute bottom-20 left-60 h-24 w-32 bg-[#74d5ad]"></div>
              <div class="absolute bottom-24 right-24 h-32 w-14 bg-[#9be4c9]"></div>
              <div class="absolute bottom-24 right-44 h-24 w-12 bg-[#7cd9b4]"></div>
              <div class="absolute bottom-24 right-64 h-16 w-20 bg-[#b6edda]"></div>
              <div class="absolute bottom-12 left-20 h-6 w-64 -rotate-6 rounded-full bg-[#16a773]/35"></div>
              <div class="absolute bottom-28 left-16 h-6 w-28 bg-[#16a773]/50"></div>
              <div class="absolute bottom-28 left-48 h-6 w-28 bg-[#0f9ea8]/35"></div>
              <div class="absolute bottom-28 left-80 h-6 w-28 bg-[#16a773]/50"></div>
            </div>
            <div class="relative z-10 flex h-full min-h-[600px] items-center px-12">
              <div class="max-w-md text-ink">
                <div class="text-2xl font-medium">欢迎来到 <span class="font-black">SmartQ</span></div>
                <div class="mt-4 h-px w-80 max-w-full bg-leaf/35"></div>
                <p class="mt-6 text-base font-semibold leading-7 text-slate-600">
                  面向 AI 命题、题目审核与试卷管理的一体化控制台，让内容生产流程清晰、稳定、可追踪。
                </p>
                <div class="mt-7 inline-flex items-center gap-2 rounded border border-leaf/30 bg-white/70 px-4 py-2 text-sm font-black text-leaf shadow-sm">
                  <i data-lucide="shield-check" class="h-4 w-4 stroke-[2.6]"></i>
                  Secure console
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div v-else class="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside class="border-b border-slate-800 bg-ink text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
          <div class="flex h-16 items-center justify-between gap-3 px-4 lg:h-auto lg:px-5 lg:py-6">
            <button class="flex min-w-0 items-center gap-3 text-left" @click="go('papers')">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 shadow-sm">
                <img :src="publicUrl('/assets/favicon.svg')" alt="SmartQ" class="h-full w-full object-contain" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-lg font-black">SmartQ</span>
                <span class="block truncate text-[11px] font-semibold text-slate-400">考试与测评管理平台</span>
              </span>
            </button>
            <span class="rounded bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-300 lg:hidden">控制台</span>
          </div>

          <nav class="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:px-4 lg:pb-4" aria-label="管理功能导航">
            <button
              v-for="item in visibleNavItems"
              :key="item.key"
              type="button"
              class="group flex h-11 shrink-0 items-center gap-3 rounded px-3 text-left text-sm font-bold transition lg:w-full"
              :class="state.route === item.key ? 'bg-white text-ink shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'"
              @click="go(item.key)"
            >
              <i :data-lucide="item.icon" class="h-4 w-4 shrink-0" :class="state.route === item.key ? 'text-leaf' : 'text-slate-500 group-hover:text-slate-300'"></i>
              <span class="whitespace-nowrap">{{ item.label }}</span>
            </button>
          </nav>

          <div data-admin-account-menu class="relative hidden border-t border-white/10 p-4 lg:block">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded px-2 py-2 text-left transition hover:bg-white/10"
              :aria-expanded="state.admin.menuOpen ? 'true' : 'false'"
              aria-haspopup="menu"
              @click.stop="toggleAdminMenu"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-400/15 text-sm font-black text-emerald-300">{{ adminDisplayName.slice(0, 1).toUpperCase() }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-black text-white">{{ adminDisplayName }}</span>
                <span class="mt-0.5 block text-[11px] font-semibold text-slate-400">管理员账号</span>
              </span>
              <i data-lucide="chevrons-up-down" class="h-4 w-4 text-slate-500"></i>
            </button>
            <div
              v-if="state.admin.menuOpen"
              class="absolute bottom-4 left-full z-40 ml-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 text-ink shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              role="menu"
            >
              <div class="border-b border-slate-100 px-3 pb-2 pt-1">
                <div class="text-[11px] font-bold text-slate-400">当前账号</div>
                <div class="mt-1 truncate text-sm font-black">{{ adminDisplayName }}</div>
              </div>
              <button
                v-for="item in adminAccountMenuItems"
                :key="item.key"
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold transition"
                :class="item.tone === 'danger' ? 'text-coral hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'"
                role="menuitem"
                @click="runAdminAccountMenuItem(item)"
              >
                <i :data-lucide="item.icon" class="h-4 w-4"></i>
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>
        </aside>

        <div class="min-w-0 px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6">
          <header class="flex min-h-14 items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-leaf shadow-sm ring-1 ring-slate-200">
                <i :data-lucide="currentNavItem.icon" class="h-4 w-4"></i>
              </span>
              <div class="min-w-0">
                <div class="truncate text-base font-black text-ink">{{ currentNavItem.label }}</div>
                <div class="mt-0.5 text-xs font-semibold text-slate-500">SmartQ 运营控制台</div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2 lg:hidden">
              <span class="max-w-28 truncate text-xs font-bold text-slate-500">{{ adminDisplayName }}</span>
              <button type="button" title="退出登录" class="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-white text-slate-600" @click="logoutAdmin">
                <i data-lucide="log-out" class="h-4 w-4"></i>
              </button>
            </div>
          </header>

          <div v-if="state.loading && !state.dashboard" class="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500 shadow-soft">
            控制台数据加载中...
          </div>
          <div v-else-if="state.dashboardError && !state.dashboard" class="mt-6 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-coral shadow-soft">
            <span>{{ state.dashboardError }}</span>
            <button class="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-black text-coral" @click="refresh">重试</button>
          </div>

          <div v-else data-admin-route-content>
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

          <form v-if="visibleWorkflowStep === 'config'" novalidate class="rounded-lg border border-ocean/30 bg-cyan-50/70 p-5 shadow-soft" @submit.prevent="generateDraft">
            <div class="flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 text-sm font-black text-ocean"><i data-lucide="sparkles" class="h-4 w-4"></i>AI 命题任务</div>
                <div class="mt-1 text-xs font-semibold text-slate-500">{{ formLocked ? '试卷已生成，命题参数已锁定；如需修改，请点击重新生成' : state.regeneratingDraft ? '正在重新生成模式，可调整参数并生成新的试卷' : '出题者填写命题参数后生成试卷' }}</div>
              </div>
              <div class="flex items-center gap-2">
                <button v-if="state.generating" type="button" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white opacity-70" disabled>生成中</button>
                <button v-else-if="formLocked" type="button" class="rounded-lg border border-ocean/30 bg-white px-4 py-2 text-sm font-bold text-ocean" @click="regenerate">重新生成</button>
                <button v-else type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white">生成试卷</button>
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
              <div class="rounded-lg border border-slate-200 bg-white p-4">
                <div class="text-sm font-black text-ink">出题条件</div>
                <div class="mt-3 grid grid-cols-[1fr_1.1fr_120px] gap-3">
                  <label class="text-xs font-bold text-slate-600">考卷名称<input v-model="state.spec.paperName" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" :class="state.specFormErrors.paperName ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入考卷名称" /><div :class="fieldErrorClass(state.specFormErrors.paperName)">{{ state.specFormErrors.paperName || '' }}</div></label>
                  <label class="text-xs font-bold text-slate-600">出题方向<input v-model="state.spec.direction" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" :class="state.specFormErrors.direction ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入出题方向" /><div :class="fieldErrorClass(state.specFormErrors.direction)">{{ state.specFormErrors.direction || '' }}</div></label>
                  <label class="text-xs font-bold text-slate-600">难度<select v-model="state.spec.difficulty" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100"><option>中</option><option>易</option><option>难</option><option>混合</option></select></label>
                </div>
                <div class="mt-3 grid grid-cols-[1fr_1fr] gap-3">
                  <label class="text-xs font-bold text-slate-600">知识点范围<textarea v-model="state.spec.knowledge" class="mt-2 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 disabled:bg-slate-100" placeholder="请输入知识点范围，用逗号分隔"></textarea></label>
                  <label class="text-xs font-bold text-slate-600">补充要求<textarea v-model="state.spec.requirements" class="mt-2 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 disabled:bg-slate-100" placeholder="请输入补充要求"></textarea></label>
                </div>
              </div>
              <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="text-sm font-black text-ink">题量与分值</div>
                    <div :class="fieldErrorClass(state.specFormErrors.questionCount)">{{ state.specFormErrors.questionCount || '' }}</div>
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-right">
                    <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="text-[11px] font-bold text-slate-500">题目数量</div><div class="mt-1 text-lg font-black text-ink">{{ totalQuestionCount }} 题</div></div>
                    <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="text-[11px] font-bold text-slate-500">试卷总分</div><div class="mt-1 text-lg font-black text-ink">{{ computedSpecTotalScore }} 分</div></div>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-6 gap-2">
                  <div v-for="item in paperTypeConfig" :key="item.type" class="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div class="text-xs font-black text-slate-600">{{ item.type }}题</div>
                    <label class="mt-2 block text-[11px] font-bold text-slate-500">数量<input v-model.number="state.spec[item.countKey]" type="number" min="0" max="50" class="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold disabled:bg-slate-100" /></label>
                    <label class="mt-2 block text-[11px] font-bold text-slate-500">每题分<input v-model.number="state.spec[item.scoreKey]" type="number" min="1" max="200" class="mt-1 w-full rounded border bg-white px-2 py-1.5 text-sm font-semibold disabled:bg-slate-100" :class="state.specFormErrors[item.scoreKey] ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /></label>
                    <div :class="fieldErrorClass(state.specFormErrors[item.scoreKey])">{{ state.specFormErrors[item.scoreKey] || '' }}</div>
                  </div>
                </div>
              </div>
            </fieldset>
            <div v-if="state.generatedDraft?.questions?.length" class="mt-4 rounded-lg border border-ocean/20 bg-white p-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-black text-ink">生成试卷预览</div>
                  <div class="mt-1 text-xs font-semibold text-slate-500">{{ state.generatedDraft.spec?.paperName }} · {{ state.generatedDraft.questions.length }} 题 · {{ state.generatedDraft.spec?.totalScore }} 分</div>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" :disabled="state.saving" @click="discardDraft">丢弃</button>
                  <button type="button" class="rounded-lg bg-ocean px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60" :disabled="state.saving" @click="saveDraft">{{ state.saving ? '处理中' : '进入质量复检' }}</button>
                </div>
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
            <div v-if="authoringQuestions.length && !(authoringQuality.failures || []).length" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">质量复检通过，系统将进入人工审核。</div>
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
            <div class="mt-1 text-sm font-semibold text-slate-500">集中管理草稿、已发布和历史试卷</div>
            <div class="mt-5 grid grid-cols-2 gap-3">
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black">{{ paperRows.length }}</div><div class="text-xs font-bold text-slate-500">历史试卷</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-leaf">{{ papers.filter((item) => item.status === '已发布').length }}</div><div class="text-xs font-bold text-slate-500">已发布</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-iris">{{ papers.filter((item) => ['草稿','未发布','已保存','已组卷'].includes(item.status)).length }}</div><div class="text-xs font-bold text-slate-500">草稿</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-ocean">{{ paperRows.reduce((sum, item) => sum + Number(item.questionCount || 0), 0) }}</div><div class="text-xs font-bold text-slate-500">列表题数</div></div>
            </div>
            <div class="mt-5 flex items-center justify-between"><h2 class="text-lg font-black">试卷列表</h2><span class="text-xs font-bold text-slate-500">最新优先</span></div>
            <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_128px]">
              <label class="relative block">
                <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"></i>
                <input v-model="state.paperSearch" class="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold outline-none focus:border-ocean" placeholder="搜索试卷名称" @input="resetPaperPage" />
              </label>
              <select v-model="state.paperStatusFilter" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-ocean" @change="resetPaperPage">
                <option value="all">全部状态</option>
                <option value="published">已发布</option>
                <option value="unpublished">草稿</option>
              </select>
            </div>
            <div class="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
              <div
                v-for="item in pagedPaperRows"
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
              <div v-if="!paperRows.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
                <div class="text-sm font-black text-slate-600">暂无已出卷子</div>
                <div class="mt-1 text-xs font-semibold text-slate-500">完成出题制卷并保存后，试卷会显示在这里。</div>
              </div>
              <div v-else-if="!filteredPaperRows.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
                <div class="text-sm font-black text-slate-600">暂无匹配试卷</div>
                <div class="mt-1 text-xs font-semibold text-slate-500">请调整关键词或状态筛选。</div>
              </div>
            </div>
            <div v-if="paperRows.length" class="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
              <div>共 {{ filteredPaperRows.length }} / {{ paperRows.length }} 份试卷</div>
              <div class="flex items-center gap-2">
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="currentPaperPage <= 1" @click="changePaperPage(-1)">上一页</button>
                <span class="min-w-20 text-center text-sm font-black text-ink">{{ currentPaperPage }} / {{ paperTotalPages }}</span>
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="currentPaperPage >= paperTotalPages" @click="changePaperPage(1)">下一页</button>
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

          </div>

      <div v-if="state.toast" class="fixed right-4 top-4 z-[100] flex max-w-[min(420px,calc(100vw-32px))] items-start gap-3 rounded-lg border px-4 py-3 text-sm font-bold md:right-8 md:top-8" :class="toastClass(state.toast)">
        <i :data-lucide="toastIcon(state.toast)" class="mt-0.5 h-4 w-4 shrink-0"></i>
        <span class="leading-5">{{ state.toast.message }}</span>
      </div>
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
        <form novalidate class="w-full max-w-3xl rounded-lg bg-white p-5 shadow-soft" @submit.prevent="saveQuestionEdit">
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
          <label class="mt-4 block text-xs font-bold text-slate-600">题干<textarea v-model="state.questionEditForm.stem" class="mt-2 min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold leading-6" :class="state.questionEditErrors.stem ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'"></textarea><div :class="fieldErrorClass(state.questionEditErrors.stem)">{{ state.questionEditErrors.stem || '' }}</div></label>
          <div v-if="['单选','多选'].includes(state.questionEditForm.type)" class="mt-4 grid grid-cols-2 gap-3">
            <label class="text-xs font-bold text-slate-600">A<input v-model="state.questionEditForm.optionA" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors.optionA ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors.optionA)">{{ state.questionEditErrors.optionA || '' }}</div></label>
            <label class="text-xs font-bold text-slate-600">B<input v-model="state.questionEditForm.optionB" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors.optionB ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors.optionB)">{{ state.questionEditErrors.optionB || '' }}</div></label>
            <label class="text-xs font-bold text-slate-600">C<input v-model="state.questionEditForm.optionC" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors.optionC ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors.optionC)">{{ state.questionEditErrors.optionC || '' }}</div></label>
            <label class="text-xs font-bold text-slate-600">D<input v-model="state.questionEditForm.optionD" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors.optionD ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors.optionD)">{{ state.questionEditErrors.optionD || '' }}</div></label>
          </div>
          <div v-else-if="state.questionEditForm.type === '判断'" class="mt-4 grid grid-cols-2 gap-3">
            <label class="text-xs font-bold text-slate-600">A<input value="正确" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
            <label class="text-xs font-bold text-slate-600">B<input value="错误" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3">
            <label v-if="state.questionEditForm.type === '单选'" class="text-xs font-bold text-slate-600">答案<select v-model="state.questionEditForm.answerSingle" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
            <label v-else-if="state.questionEditForm.type === '判断'" class="text-xs font-bold text-slate-600">答案<select v-model="state.questionEditForm.answerSingle" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><option>正确</option><option>错误</option></select></label>
            <div v-else-if="state.questionEditForm.type === '多选'" class="text-xs font-bold text-slate-600">
              <div>答案</div>
              <div class="mt-2 flex h-[38px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-3">
                <label v-for="letter in ['A','B','C','D']" :key="letter" class="flex items-center gap-1 text-sm font-black text-slate-700"><input v-model="state.questionEditForm.answerMultiple" type="checkbox" :value="letter" />{{ letter }}</label>
              </div>
              <div :class="fieldErrorClass(state.questionEditErrors.answerMultiple)">{{ state.questionEditErrors.answerMultiple || '' }}</div>
            </div>
            <label v-else class="text-xs font-bold text-slate-600">答案<input v-model="state.questionEditForm.answerText" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors.answerText ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors.answerText)">{{ state.questionEditErrors.answerText || '' }}</div></label>
            <label class="text-xs font-bold text-slate-600">解析<input v-model="state.questionEditForm.explanation" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeQuestionEditor">取消</button>
            <button type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white">保存修改</button>
          </div>
        </form>
          </div>
        </div>
      </div>
    </main>
  `,
});

app.mount("#app");

function currentRoute() {
  const { route } = parseHashRoute();
  return ["authoring", "papers"].includes(route) ? route : "papers";
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
  if (route === "papers") return "";
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
  return ["已组卷", "已保存", "未发布"].includes(status) ? "草稿" : status || "未保存";
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

function formatDateTimeWithYear(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
