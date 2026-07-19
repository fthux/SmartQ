import { request } from "../core/api-client.js";
import { defaultSpec, paperTypeConfig, typeClass } from "../core/constants.js";
import {
  clampNumber,
  escapeHtml,
  numberValue,
} from "../core/domain-utils.js";
import {
  displayPaperStatus,
  displayQuestionOptions,
  fieldErrorClass,
  formatDateOnly,
  formatDateTime,
  formatDateTimeWithYear,
  mountIcons,
  paperStatusClass,
  workflowStatusText,
} from "../core/presentation.js";
import { cleanupLegacyServiceWorkers, publicUrl } from "../core/public-path.js";
import { currentAuthoringPaperId, currentRoute, formatRouteHash } from "../core/router.js";
import { createAuthStore } from "./auth-store.js";
import { createAuthoringStore } from "./authoring-store.js";
import { createPapersStore } from "./papers-store.js";
import { createUiStore } from "./ui-store.js";

const { computed, onMounted, reactive, watch } = Vue;

cleanupLegacyServiceWorkers();

export function createAppStore() {
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
      paperDetailMode: "compact",
      paperSearch: "",
      paperStatusFilter: "all",
      paperSort: "latest",
      paperPage: 1,
      paperPageSize: 20,
      paperActionMenuId: null,
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
      if (state.route === "papers" && state.selectedPaperDetail?.name) {
        return `${state.selectedPaperDetail.name} - 已出卷子 - SmartQ`;
      }
      if (state.route === "authoring") {
        const title = state.authoringPaperId ? paper.value.name || state.dashboard?.generationTask?.paperName || "编辑试卷" : "出题制卷";
        return `${title} - ${routeTitle} - SmartQ`;
      }
      return `${routeTitle} - SmartQ`;
    });
    const paperRows = computed(() => {
      const rows = papers.value.slice();
      if (state.paperSort === "oldest") {
        return rows.sort((a, b) => new Date(a.publishedAt || a.createdAt || 0) - new Date(b.publishedAt || b.createdAt || 0));
      }
      if (state.paperSort === "name") {
        return rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
      }
      return rows.sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
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
    const paperPageStart = computed(() => (filteredPaperRows.value.length ? (currentPaperPage.value - 1) * state.paperPageSize + 1 : 0));
    const paperPageEnd = computed(() => Math.min(currentPaperPage.value * state.paperPageSize, filteredPaperRows.value.length));
    const { notify, toastClass, toastIcon } = createUiStore(state);
    const {
      closeAdminMenu,
      handleAdminAuthError,
      loadAdminSession,
      loginAdmin,
      logoutAdmin,
      runAdminAccountMenuItem,
      toggleAdminMenu,
    } = createAuthStore({
      state,
      request,
      notify,
      refresh: (...args) => refresh(...args),
      canAccessRoute: (...args) => canAccessRoute(...args),
      go: (...args) => go(...args),
      mountIcons,
    });
    const {
      activatePaper,
      askDeletePaper,
      changePaperPage,
      clearSelectedPaper,
      deletePaper,
      editPaper,
      resetPaperPage,
      selectPaper,
      togglePaperActionMenu,
    } = createPapersStore({
      state,
      request,
      refresh: (...args) => refresh(...args),
      notify,
      mountIcons,
      paperTotalPages,
      currentPaperPage,
      go: (...args) => go(...args),
    });
    const {
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
    } = createAuthoringStore({
      state,
      refresh: (...args) => refresh(...args),
      notify,
      formLocked,
      workflowSteps,
      authoringQuestions,
      authoringPendingReviewCount,
      questions,
      computedSpecTotalScore,
      selectPaper,
      go: (...args) => go(...args),
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
        if (!event.target?.closest?.("[data-paper-action-menu]")) state.paperActionMenuId = null;
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.selectedPaperId) clearSelectedPaper();
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
      paperPageStart,
      paperPageEnd,
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
      clearSelectedPaper,
      changePaperPage,
      resetPaperPage,
      togglePaperActionMenu,
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
      paperStatusClass,
      workflowStatusText,
      formatDateTime,
      formatDateTimeWithYear,
      formatDateOnly,
      escapeHtml,
      publicUrl,
    };
}
