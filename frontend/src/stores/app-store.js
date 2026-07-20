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
import { createLayoutStore } from "./layout-store.js";
import { createMaterialsStore } from "./materials-store.js";
import { createQuestionBankStore } from "./question-bank-store.js";
import { createUsersStore } from "./users-store.js";
import { computed, onMounted, reactive, watch } from "vue";

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
      profile: {
        displayName: "",
        avatarPreview: "",
        avatarFile: null,
        error: "",
        saving: false,
        uploadingAvatar: false,
      },
      password: {
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        error: "",
        saving: false,
      },
      userManagement: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        search: "",
        status: "",
        loading: false,
        error: "",
        statusUpdatingId: null,
        editorOpen: false,
        editorMode: "create",
        editingId: null,
        form: { username: "", displayName: "", password: "", confirmPassword: "" },
        formError: "",
        saving: false,
        resetOpen: false,
        resetUser: null,
        resetPassword: "",
        resetPasswordConfirm: "",
        resetError: "",
        resetting: false,
      },
      materialManagement: {
        items: [],
        options: [],
        total: 0,
        page: 1,
        pageSize: 20,
        search: "",
        status: "",
        loading: false,
        optionsLoading: false,
        error: "",
        actionId: null,
        selectorOpen: false,
        editorOpen: false,
        editorMode: "create",
        editingId: null,
        form: { name: "", description: "", tags: "", content: "", mode: "text", file: null },
        formError: "",
        saving: false,
        detailOpen: false,
        detailLoading: false,
        detail: null,
        usages: [],
        returnToAuthoring: false,
      },
      questionBankManagement: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        search: "",
        status: "",
        type: "",
        difficulty: "",
        loading: false,
        error: "",
        actionId: null,
        editorOpen: false,
        editorMode: "create",
        editingId: null,
        form: {},
        formError: "",
        saving: false,
        detailOpen: false,
        detailLoading: false,
        detail: null,
        importingCurrent: false,
        importingPaperId: null,
        picker: {
          open: false,
          items: [],
          total: 0,
          page: 1,
          pageSize: 10,
          search: "",
          status: "已校验",
          type: "",
          difficulty: "",
          loading: false,
          error: "",
          selection: [],
          importing: false,
        },
      },
      ui: {
        sidebarCollapsed: localStorage.getItem("smartqSidebarCollapsed") === "1",
        theme: ["system", "light", "dark"].includes(localStorage.getItem("smartqTheme")) ? localStorage.getItem("smartqTheme") : "system",
        themeMenuOpen: false,
        isDark: false,
        isFullscreen: false,
      },
      generatedDraft: null,
      regeneratingDraft: false,
      activeWorkflowStep: "config",
      saving: false,
      publishing: false,
      publishQualityFailures: [],
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
      spec: freshSpec(),
      specFormErrors: {},
    });

    const navItems = [
      { key: "papers", label: "已出卷子", icon: "files" },
      { key: "authoring", label: "出题制卷", icon: "sparkles" },
      { key: "question-bank", label: "题库管理", icon: "collection" },
      { key: "materials", label: "出题资料", icon: "folder" },
      { key: "users", label: "用户管理", icon: "users" },
      { key: "profile", label: "个人资料", icon: "user-round", showInNav: false },
    ];

    const adminDisplayName = computed(() => state.admin.user?.displayName || state.admin.user?.username || state.admin.username || "admin");
    const adminAccountMenuItems = computed(() => [
      { key: "profile", label: "个人资料", icon: "user-round", action: openAdminProfile },
      { key: "logout", label: "退出登录", icon: "log-out", tone: "danger", action: logoutAdmin },
    ]);
    const visibleNavItems = computed(() => navItems.filter((item) => item.showInNav !== false));
    const currentNavItem = computed(() => navItems.find((item) => item.key === state.route) || navItems[0]);
    const questions = computed(() => state.dashboard?.questions || []);
    const paper = computed(() => state.dashboard?.paper || {});
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
    const selectedSourceMaterials = computed(() => {
      const selected = new Set(state.spec.materialIds || []);
      return state.materialManagement.options.filter((item) => selected.has(item.id));
    });
    const materialQuestionCount = computed(() => state.spec.sourceMode === "ai-only"
      ? 0
      : clampNumber(state.spec.materialQuestionCount, 0, totalQuestionCount.value, 0));
    const aiQuestionCount = computed(() => Math.max(0, totalQuestionCount.value - materialQuestionCount.value));
    const workflowSteps = computed(() => {
      const hasUnsavedDraft = Boolean(state.generatedDraft?.questions?.length);
      const hasPersistedQuestions = authoringQuestions.value.length > 0 && !hasUnsavedDraft;
      const hasActiveAuthoring = hasPersistedQuestions && authoringPaperReady.value;
      const configDone = (hasUnsavedDraft || hasActiveAuthoring) && !state.regeneratingDraft;
      const published = hasActiveAuthoring && paper.value.status === "已发布" && (!isEditingPaper.value || paper.value.id === state.authoringPaperId);
      const publishReady = hasActiveAuthoring && authoringPendingReviewCount.value === 0;
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
          key: "review",
          title: "人工审核",
          meta: hasActiveAuthoring ? `${authoringReviewedCount.value}/${authoringQuestions.value.length} 已通过` : "等待生成试卷",
          status: hasActiveAuthoring && authoringPendingReviewCount.value === 0 ? "done" : hasActiveAuthoring ? "active" : "pending",
          action: "审核题目",
          clickable: hasActiveAuthoring,
        },
        {
          key: "publish",
          title: "发布试卷",
          meta: published ? "已发布" : publishReady ? "审核完成，可发布" : "等待审核完成",
          status: published ? "done" : publishReady ? "active" : "pending",
          action: published ? "已发布" : "发布试卷",
          clickable: published || publishReady,
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
      themeOptions,
      toggleSidebar,
      toggleThemeMenu,
      closeThemeMenu,
      setTheme,
      toggleTheme,
      toggleFullscreen,
      initializeLayout,
    } = createLayoutStore({ state, mountIcons });
    const {
      closeAdminMenu,
      changeAdminPassword,
      handleAdminAuthError,
      loadAdminSession,
      loginAdmin,
      logoutAdmin,
      openAdminProfile,
      runAdminAccountMenuItem,
      saveAdminProfile,
      selectAdminAvatar,
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
      applyAdminUserFilters,
      changeAdminUserPage,
      changeAdminUserPageSize,
      loadAdminUsers,
      openCreateAdminUser,
      openEditAdminUser,
      openResetAdminPassword,
      resetManagedAdminPassword,
      revokeManagedAdminSessions,
      saveManagedAdminUser,
      setManagedAdminUserStatus,
    } = createUsersStore({ state, request, notify });
    const {
      applyMaterialFilters,
      changeMaterialPage,
      changeMaterialPageSize,
      loadMaterials,
      loadMaterialOptions,
      manageMaterialsFromAuthoring,
      openCreateMaterial,
      openEditMaterial,
      openMaterialDetail,
      openMaterialSelector,
      removeSelectedMaterial,
      resumeAuthoringFromMaterials,
      runMaterialAction,
      saveMaterial,
      selectMaterialFile,
      toggleMaterialSelection,
    } = createMaterialsStore({ state, notify, go: (...args) => go(...args) });
    const {
      addCurrentQuestionsToBank,
      addPaperQuestionsToBank,
      addSelectedQuestionBankToAuthoring,
      applyQuestionBankFilters,
      applyQuestionBankPickerFilters,
      changeQuestionBankPage,
      changeQuestionBankPageSize,
      changeQuestionBankPickerPage,
      loadQuestionBank,
      openCreateQuestionBankItem,
      openEditQuestionBankItem,
      openQuestionBankDetail,
      openQuestionBankPicker,
      runQuestionBankAction,
      saveQuestionBankItem,
      setQuestionBankPickerSelection,
    } = createQuestionBankStore({
      state,
      notify,
      refresh: (...args) => refresh(...args),
      authoringQuestions,
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
      regenerate,
      reviewQuestion,
      saveDraft,
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
      computedSpecTotalScore,
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
        const resume = params?.resume === "1";
        state.authoringPaperId = params.paperid || params.paperId || params.papeid || "";
        state.editingPaperId = state.authoringPaperId || null;
        state.authoringNewDraftActive = false;
        state.publishQualityFailures = [];
        if (!state.authoringPaperId) {
          state.generatedDraft = null;
          state.regeneratingDraft = false;
          if (resume) {
            try {
              state.spec = freshSpec(JSON.parse(sessionStorage.getItem("smartqAuthoringSpec") || "{}"));
            } catch {
              state.spec = freshSpec();
            }
            sessionStorage.removeItem("smartqAuthoringSpec");
          } else {
            state.spec = freshSpec();
          }
          state.activeWorkflowStep = "config";
        }
      }
      if (state.selectedPaperId) clearSelectedPaper();
      if (route === "question-bank") loadQuestionBank();
      if (route === "users") loadAdminUsers();
      if (route === "materials") {
        state.materialManagement.returnToAuthoring = params?.returnTo === "authoring";
        loadMaterials();
      }
      const routeHash = formatRouteHash(route, params);
      if (routeHash) location.hash = routeHash;
      else history.replaceState(null, "", `${location.pathname}${location.search}`);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      mountIcons();
    }

    function canAccessRoute(route) {
      return navItems.some((entry) => entry.key === route);
    }

    watch(documentTitle, (title) => {
      document.title = title;
    }, { immediate: true });

    watch([totalQuestionCount, () => state.spec.sourceMode], ([count, mode]) => {
      if (mode === "ai-only") state.spec.materialQuestionCount = 0;
      else if (mode === "materials-only") state.spec.materialQuestionCount = count;
      else state.spec.materialQuestionCount = clampNumber(state.spec.materialQuestionCount, 0, count, 0);
    });

    onMounted(async () => {
      window.addEventListener("hashchange", () => {
        state.route = currentRoute();
        if (state.admin.token && !canAccessRoute(state.route)) {
          state.route = "papers";
          const routeHash = formatRouteHash(state.route);
          if (routeHash) location.hash = routeHash;
          else history.replaceState(null, "", `${location.pathname}${location.search}`);
          notify("当前账号无权访问该模块");
        }
        state.authoringPaperId = currentAuthoringPaperId();
        state.editingPaperId = state.route === "authoring" && state.authoringPaperId ? state.authoringPaperId : null;
        if (state.selectedPaperId) clearSelectedPaper();
        if (state.route === "question-bank") loadQuestionBank();
        if (state.route === "users") loadAdminUsers();
        if (state.route === "materials") loadMaterials();
        if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
          activatePaper(state.authoringPaperId, { silent: true }).catch(() => {});
        }
        mountIcons();
      });
      document.addEventListener("click", (event) => {
        if (!event.target?.closest?.("[data-admin-account-menu]")) closeAdminMenu();
        if (!event.target?.closest?.("[data-theme-menu]")) closeThemeMenu();
        if (!event.target?.closest?.("[data-paper-action-menu]")) state.paperActionMenuId = null;
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.selectedPaperId) clearSelectedPaper();
      });
      initializeLayout();
      await loadAdminSession();
      await refresh();
      if (state.route === "users") await loadAdminUsers();
      if (state.route === "question-bank") await loadQuestionBank();
      if (state.route === "materials") await loadMaterials();
      if (state.route === "authoring") await loadMaterialOptions();
      if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
        await activatePaper(state.authoringPaperId, { silent: true });
      }
    });

    return {
      state,
      navItems,
      visibleNavItems,
      currentNavItem,
      adminDisplayName,
      adminAccountMenuItems,
      themeOptions,
      questions,
      authoringQuestions,
      authoringReviewedCount,
      authoringPendingReviewCount,
      paper,
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
      selectedSourceMaterials,
      materialQuestionCount,
      aiQuestionCount,
      refresh,
      go,
      canAccessRoute,
      applyAdminUserFilters,
      changeAdminUserPage,
      changeAdminUserPageSize,
      loadAdminUsers,
      openCreateAdminUser,
      openEditAdminUser,
      openResetAdminPassword,
      resetManagedAdminPassword,
      revokeManagedAdminSessions,
      saveManagedAdminUser,
      setManagedAdminUserStatus,
      addCurrentQuestionsToBank,
      addPaperQuestionsToBank,
      addSelectedQuestionBankToAuthoring,
      applyQuestionBankFilters,
      applyQuestionBankPickerFilters,
      changeQuestionBankPage,
      changeQuestionBankPageSize,
      changeQuestionBankPickerPage,
      loadQuestionBank,
      openCreateQuestionBankItem,
      openEditQuestionBankItem,
      openQuestionBankDetail,
      openQuestionBankPicker,
      runQuestionBankAction,
      saveQuestionBankItem,
      setQuestionBankPickerSelection,
      applyMaterialFilters,
      changeMaterialPage,
      changeMaterialPageSize,
      loadMaterials,
      loadMaterialOptions,
      manageMaterialsFromAuthoring,
      openCreateMaterial,
      openEditMaterial,
      openMaterialDetail,
      openMaterialSelector,
      removeSelectedMaterial,
      resumeAuthoringFromMaterials,
      runMaterialAction,
      saveMaterial,
      selectMaterialFile,
      toggleMaterialSelection,
      loginAdmin,
      logoutAdmin,
      openAdminProfile,
      toggleAdminMenu,
      closeAdminMenu,
      runAdminAccountMenuItem,
      saveAdminProfile,
      changeAdminPassword,
      selectAdminAvatar,
      toggleSidebar,
      toggleThemeMenu,
      setTheme,
      toggleTheme,
      toggleFullscreen,
      setWorkflowStep,
      generateDraft,
      saveDraft,
      discardDraft,
      regenerate,
      reviewQuestion,
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

function freshSpec(overrides = {}) {
  return {
    ...defaultSpec,
    ...overrides,
    materialIds: Array.isArray(overrides.materialIds) ? [...overrides.materialIds] : [],
  };
}
