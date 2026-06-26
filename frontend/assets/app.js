const { computed, createApp, nextTick, onMounted, reactive, ref, watch } = Vue;

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
  const adminToken = localStorage.getItem("smartqAdminToken") || "";
  const useAdminToken = adminToken && path.startsWith("/api/") && !path.startsWith("/api/candidate/") && !path.startsWith("/api/admin/login") && !["/api/health", "/api/config"].includes(path);
  const headers = {
    "content-type": "application/json",
    ...(useAdminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    ...(options.headers || {}),
  };
  if (options.skipAuth) delete headers.authorization;
  const fetchOptions = { ...options };
  delete fetchOptions.skipAuth;
  const response = await fetch(path, {
    ...fetchOptions,
    headers,
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
      dashboardError: "",
      loading: true,
      toast: null,
      systemHealth: null,
      opsSnapshot: null,
      storageInfo: null,
      storageLoading: false,
      backupDownloading: false,
      backupHistory: [],
      backupHistoryLoading: false,
      backupRestoreText: "",
      backupRestoreConfirm: "",
      backupRestoring: false,
      adminSessions: [],
      adminSessionsLoading: false,
      auditRows: [],
      auditTypes: [],
      auditLoading: false,
      auditFilterType: "",
      auditSearch: "",
      admin: {
        token: localStorage.getItem("smartqAdminToken") || "",
        user: null,
        username: localStorage.getItem("smartqAdminUsername") || "admin",
        password: "",
        rememberUsername: Boolean(localStorage.getItem("smartqAdminUsername")),
        loading: false,
        error: "",
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
      confirmDeletePaper: null,
      editingQuestion: null,
      questionEditForm: null,
      questionEditErrors: {},
      editingPaperId: null,
      authoringPaperId: currentAuthoringPaperId(),
      assignmentForm: {
        id: "",
        paperId: "",
        startTime: defaultDateTimeLocal(10, 0),
        endTime: defaultDateTimeLocal(11, 30),
        participantTicket: "",
        candidate: "",
        ticket: "",
        className: "",
        remark: "",
      },
      assignmentModalOpen: false,
      assignmentSubmitting: false,
      assignmentFormErrors: {},
      assignmentPage: 1,
      assignmentPageSize: 8,
      selectedAssignmentIds: [],
      confirmDeleteAssignment: null,
      confirmDeleteSelectedAssignments: false,
      candidateForm: {
        id: "",
        candidate: "",
        ticket: "",
        className: "",
        phone: "",
        email: "",
        description: "",
        avatar: "",
        password: "",
      },
      candidateFormErrors: {},
      candidateSubmitting: false,
      participantModalOpen: false,
      participantPage: 1,
      participantPageSize: 8,
      participantSearch: "",
      participantGroupFilter: "",
      participantStatusFilter: "active",
      participantSort: "createdDesc",
      participantImportOpen: false,
      participantImportText: "",
      participantImportPreview: null,
      participantImportLoading: false,
      participantImportSubmitting: false,
      participantBulkGroup: "",
      selectedParticipantTickets: [],
      confirmDeleteParticipant: null,
      confirmDeleteSelectedParticipants: false,
      viewingParticipant: null,
      resettingParticipant: null,
      groupForm: {
        id: "",
        name: "",
        description: "",
      },
      groupModalOpen: false,
      groupSubmitting: false,
      groupFormErrors: {},
      groupPage: 1,
      groupPageSize: 6,
      selectedGroupIds: [],
      confirmDeleteGroup: null,
      confirmDeleteSelectedGroups: false,
      proctorSearch: "",
      proctorRiskFilter: "all",
      proctorStatusFilter: "all",
      proctorEventFilter: "pending",
      proctorRefreshTimer: null,
      proctorStream: null,
      proctorStreamStatus: "未连接",
      proctorStreamRefreshTimer: null,
      proctorLastRefreshedAt: "",
      proctorDetail: null,
      proctorDetailLoading: false,
      proctorReportLoading: false,
      proctorControlNote: "",
      proctorExtendMinutes: 10,
      proctorMessageText: "",
      proctorResolutionText: "",
      selectedProctorEventIds: [],
      proctorRulesForm: {
        visibilityHidden: "中",
        fullscreenExited: "中",
        clipboard: "中",
        requireFullscreen: false,
        duplicateWindowSeconds: 10,
      },
      proctorRulesSaving: false,
      gradingReviewFilter: "pending",
      selectedReviewSessionId: "",
      reviewForms: {},
      reviewSubmitting: false,
      publishingResultSessionId: "",
      resolvingAppealId: "",
      appealResolutionText: "",
      candidate: {
        sessionId: currentCandidateSessionId(),
        session: null,
        exam: null,
        paper: null,
        access: null,
        questions: [],
        answers: {},
        markedQuestionIds: [],
        grading: null,
        gradingStatus: null,
        appealReason: "",
        appealSubmitting: false,
        confirmSubmit: false,
        submitModalOpen: false,
        localDraftRestored: false,
        remainingSeconds: 0,
        countdownTimer: null,
        timeoutRefreshQueued: false,
        saveState: "未同步",
        autosaveTimer: null,
        heartbeatTimer: null,
        lastEvidenceAt: 0,
        lastEvidenceAttachmentAt: 0,
        evidenceAttachmentState: "未采集",
        device: {
          fullscreen: "未知",
          clipboard: "正常",
        },
        pendingSignals: [],
        loading: false,
        submitting: false,
        loginPhone: "",
        loginPassword: "",
        currentPassword: "",
        newPassword: "",
        passwordLoading: false,
        authToken: localStorage.getItem("smartqCandidateToken") || "",
        authUser: null,
        exams: [],
        loginLoading: false,
        examsLoading: false,
        loginErrors: {},
        passwordErrors: {},
      },
      spec: { ...defaultSpec },
      specFormErrors: {},
    });

    const navItems = [
      { key: "home", label: "控制台首页", icon: "layout-dashboard" },
      { key: "authoring", label: "出题制卷", icon: "sparkles", permission: "authoring" },
      { key: "papers", label: "已出卷子", icon: "files", permission: "papers" },
      { key: "participants", label: "参与者管理", icon: "users", permission: "participants" },
      { key: "assignments", label: "试卷分配", icon: "list-checks", permission: "assignments" },
      { key: "proctor", label: "监考工作台", icon: "shield-check", permission: "proctor" },
      { key: "analysis", label: "阅卷分析", icon: "chart-no-axes-combined", permission: "analysis" },
    ];

    const adminPermissions = computed(() => state.admin.user?.permissions || []);
    const visibleNavItems = computed(() => navItems.filter((item) => !item.permission || hasAdminPermission(item.permission)));
    const questions = computed(() => state.dashboard?.questions || []);
    const paper = computed(() => state.dashboard?.paper || {});
    const quality = computed(() => state.dashboard?.quality || {});
    const analysis = computed(() => state.dashboard?.analysis || {});
    const sessions = computed(() => state.dashboard?.sessions || []);
    const candidates = computed(() => state.dashboard?.participants || state.dashboard?.candidates || []);
    const groups = computed(() => state.dashboard?.groups || []);
    const groupTotalPages = computed(() => Math.max(1, Math.ceil(groups.value.length / state.groupPageSize)));
    const pagedGroups = computed(() => {
      const page = Math.min(state.groupPage, groupTotalPages.value);
      const start = (page - 1) * state.groupPageSize;
      return groups.value.slice(start, start + state.groupPageSize);
    });
    const allPagedGroupsSelected = computed(() => pagedGroups.value.length > 0 && pagedGroups.value.every((item) => state.selectedGroupIds.includes(item.id)));
    const selectedUsedGroups = computed(() => groups.value.filter((item) => state.selectedGroupIds.includes(item.id) && groupInUse(item)));
    const filteredParticipants = computed(() => {
      const keyword = String(state.participantSearch || "").trim().toLowerCase();
      const group = state.participantGroupFilter;
      const status = state.participantStatusFilter;
      const rows = candidates.value.filter((item) => {
        const text = [item.candidate, item.ticket, item.phone, item.email, item.description].join(" ").toLowerCase();
        if (keyword && !text.includes(keyword)) return false;
        if (group && item.className !== group) return false;
        if (status === "active" && item.disabledAt) return false;
        if (status === "disabled" && !item.disabledAt) return false;
        return true;
      });
      return rows.slice().sort(compareParticipants);
    });
    const participantTotalPages = computed(() => Math.max(1, Math.ceil(filteredParticipants.value.length / state.participantPageSize)));
    const pagedParticipants = computed(() => {
      const page = Math.min(state.participantPage, participantTotalPages.value);
      const start = (page - 1) * state.participantPageSize;
      return filteredParticipants.value.slice(start, start + state.participantPageSize);
    });
    const allPagedParticipantsSelected = computed(() => pagedParticipants.value.length > 0 && pagedParticipants.value.every((item) => state.selectedParticipantTickets.includes(item.ticket)));
    const viewingParticipantSessions = computed(() => {
      const participant = state.viewingParticipant;
      if (!participant) return [];
      return sessions.value.filter((session) => session.ticket === participant.ticket || (participant.phone && session.phone === participant.phone));
    });
    const papers = computed(() => state.dashboard?.papers || []);
    const publishedPapers = computed(() => papers.value.filter((item) => item.status === "已发布"));
    const gradingQueue = computed(() => state.dashboard?.gradingQueue || {});
    const gradingReviewQueue = computed(() => state.dashboard?.gradingReviewQueue || []);
    const filteredGradingReviewQueue = computed(() => {
      const mode = state.gradingReviewFilter;
      return gradingReviewQueue.value.filter((item) => {
        if (mode === "pending") return item.reviewStatus !== "已完成";
        if (mode === "done") return item.reviewStatus === "已完成";
        if (mode === "risk") return item.risk && item.risk !== "低";
        return true;
      });
    });
    const selectedReviewEntry = computed(() => {
      const id = state.selectedReviewSessionId || filteredGradingReviewQueue.value[0]?.sessionId || "";
      return filteredGradingReviewQueue.value.find((item) => item.sessionId === id) || null;
    });
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
          meta: published ? "已发布给参与者" : saved ? "可发布" : "等待保存",
          status: published ? "done" : saved ? "active" : "pending",
          action: published ? "已发布" : "发布试卷",
          clickable: published || saved,
        },
      ];
    });

    const visibleWorkflowStep = computed(() => state.activeWorkflowStep);
    const documentTitle = computed(() => {
      const routeTitle = navItems.find((item) => item.key === state.route)?.label || "控制台首页";
      if (state.route === "candidate") {
        if (state.candidate.session) {
          return `${state.candidate.paper?.name || state.candidate.session?.paper || "考试"} - 考生系统 - SmartQ`;
        }
        return state.candidate.authUser?.candidate ? `我的考试 - ${state.candidate.authUser.candidate} - SmartQ` : "考生系统 - SmartQ";
      }
      if (state.route === "papers" && state.selectedPaperDetail?.paper?.name) {
        return `${state.selectedPaperDetail.paper.name} - 已出卷子 - SmartQ`;
      }
      if (state.route === "authoring") {
        const title = state.authoringPaperId ? paper.value.name || state.dashboard?.generationTask?.paperName || "编辑试卷" : "出题制卷";
        return `${title} - ${routeTitle} - SmartQ`;
      }
      return `${routeTitle} - SmartQ`;
    });
    const dashboardCards = computed(() => [
      { label: "考试场次", value: state.dashboard?.stats?.sessions || sessions.value.length, meta: `${state.dashboard?.stats?.active || 0} 场答题中`, tone: "text-ink", icon: "calendar-check" },
      { label: "参与者", value: state.dashboard?.stats?.registered || candidates.value.length, meta: `${groups.value.length} 个分组`, tone: "text-ocean", icon: "users" },
      { label: "已发布试卷", value: papers.value.filter((item) => item.status === "已发布").length, meta: `${papers.value.length} 份试卷`, tone: "text-leaf", icon: "send" },
      { label: "平均进度", value: `${state.dashboard?.stats?.progress || 0}%`, meta: `${state.dashboard?.stats?.submitted || 0} 已提交`, tone: "text-iris", icon: "activity" },
      { label: "待审核题目", value: pendingReviewCount.value, meta: `${reviewedCount.value}/${questions.value.length} 已通过`, tone: "text-honey", icon: "badge-alert" },
      { label: "监考风险", value: state.dashboard?.stats?.risk || 0, meta: `${proctorSummary.value.highRisk} 高风险`, tone: "text-coral", icon: "shield-alert" },
      { label: "待复核答卷", value: gradingQueue.value.subjectivePending || 0, meta: `${gradingQueue.value.reviewDone || 0} 已完成`, tone: "text-iris", icon: "check-check" },
      { label: "通过率", value: `${analysis.value.passRate || 0}%`, meta: `${analysis.value.averageScore || 0} 平均分`, tone: "text-ink", icon: "chart-no-axes-combined" },
    ]);
    const homePrimaryAction = computed(() => {
      const unpublished = papers.value.find((item) => item.status !== "已发布") || (paper.value.status && paper.value.status !== "已发布" ? paper.value : null);
      if (pendingReviewCount.value > 0) return { label: "继续审核题目", route: "authoring", icon: "badge-check" };
      if (unpublished?.id) return { label: "发布试卷", route: "authoring", params: { paperid: unpublished.id }, icon: "send" };
      if (publishedPapers.value.length && candidates.value.length) return { label: "添加试卷分配", action: "assignment", icon: "user-plus" };
      return { label: "新建出题任务", route: "authoring", icon: "sparkles" };
    });
    const quickActions = computed(() => [
      { label: "继续出题", desc: pendingReviewCount.value ? `${pendingReviewCount.value} 道题待审核` : "配置并生成新试卷", route: "authoring", icon: "sparkles", primary: true },
      { label: "分配试卷", desc: publishedPapers.value.length ? `${publishedPapers.value.length} 份可分配` : "需先发布试卷", route: "assignments", icon: "list-checks", disabled: !publishedPapers.value.length || !candidates.value.length },
      { label: "处理风险", desc: proctorSummary.value.highRisk ? `${proctorSummary.value.highRisk} 个高风险` : `${proctorSummary.value.mediumRisk} 个中风险`, route: "proctor", icon: "shield-alert", disabled: !state.dashboard?.stats?.risk },
      { label: "复核答卷", desc: gradingQueue.value.subjectivePending ? `${gradingQueue.value.subjectivePending} 份待处理` : "暂无待复核", route: "analysis", icon: "check-check", disabled: !gradingQueue.value.subjectivePending },
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
          desc: hasCurrentPaper.value ? "发布后可进入参与者分配流程" : "完成题目审核后保存为未发布试卷",
          action: hasCurrentPaper.value ? "去发布" : "去处理",
          route: "authoring",
          params: paper.value.id ? { paperid: paper.value.id } : {},
          show: paper.value.status !== "已发布" && (hasCurrentPaper.value || questions.value.length > 0),
        },
        {
          title: `${assignmentSummary.value.waiting || 0} 场考试待开考`,
          desc: "检查考试时间、参与者和试卷分配",
          action: "查看分配",
          route: "assignments",
          show: (assignmentSummary.value.waiting || 0) > 0,
        },
        {
          title: `${state.dashboard?.stats?.risk || 0} 个监考风险需处理`,
          desc: "查看离开页面、全屏异常和断线重连",
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
      return rows
        .slice()
        .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0))
        .slice(0, 5);
    });
    const paperRows = computed(() => {
      return papers.value
        .slice()
        .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
    });
    const proctorSummary = computed(() => {
      const riskRows = sessions.value.filter((item) => item.risk !== "低");
      return {
        online: sessions.value.filter((item) => item.online || item.onlineStatus === "在线").length,
        highRisk: riskRows.filter((item) => item.risk === "高").length,
        mediumRisk: riskRows.filter((item) => item.risk === "中").length,
        latest: riskRows.slice(0, 4),
      };
    });
    const assignmentSummary = computed(() => state.dashboard?.assignments || {});
    const assignmentPaperCounts = computed(() => assignmentSummary.value.byPaper || []);
    const hasAnalysisData = computed(() => (gradingQueue.value.objectiveDone || 0) > 0 || (gradingQueue.value.reviewDone || 0) > 0 || (analysis.value.distribution || []).some((item) => Number(item.count || 0) > 0));
    const homeStatusRows = computed(() => [
      { label: "待开考", value: assignmentSummary.value.waiting || state.dashboard?.stats?.waiting || 0, tone: "text-iris" },
      { label: "答题中", value: assignmentSummary.value.active || state.dashboard?.stats?.active || 0, tone: "text-ocean" },
      { label: "已提交", value: assignmentSummary.value.submitted || state.dashboard?.stats?.submitted || 0, tone: "text-leaf" },
      { label: "平均进度", value: `${state.dashboard?.stats?.progress || 0}%`, tone: "text-ink" },
    ]);
    const launchReadinessItems = computed(() => {
      const activeSessions = sessions.value.filter((item) => ["待开考", "答题中", "已提交"].includes(item.status));
      const pendingRisks = Number(proctorEventSummary.value.pending || state.dashboard?.stats?.risk || 0);
      const storageDegraded = Boolean(state.storageInfo?.degraded || state.systemHealth?.storage?.degraded);
      const presenceDegraded = Boolean(state.systemHealth?.proctor?.presenceDegraded);
      const evidenceDegraded = Boolean(state.systemHealth?.evidence?.degraded);
      return [
        {
          label: "出题制卷",
          status: publishedPapers.value.length ? "ready" : "action",
          detail: publishedPapers.value.length ? `${publishedPapers.value.length} 份试卷已发布` : "还没有已发布试卷",
          route: "authoring",
        },
        {
          label: "参与者与分配",
          status: candidates.value.length && activeSessions.length ? "ready" : "action",
          detail: candidates.value.length && activeSessions.length ? `${candidates.value.length} 名参与者 · ${activeSessions.length} 场考试` : "需要导入参与者并分配试卷",
          route: candidates.value.length ? "assignments" : "participants",
        },
        {
          label: "监考处置",
          status: pendingRisks ? "action" : "ready",
          detail: pendingRisks ? `${pendingRisks} 个风险事件待处理` : "暂无待处理风险",
          route: "proctor",
        },
        {
          label: "阅卷发布",
          status: (gradingQueue.value.subjectivePending || 0) ? "action" : "ready",
          detail: (gradingQueue.value.subjectivePending || 0) ? `${gradingQueue.value.subjectivePending} 份答卷待复核` : "暂无待复核答卷",
          route: "analysis",
        },
        {
          label: "运行时备份",
          status: state.storageInfo?.backupCount || state.backupHistory.length ? "ready" : "action",
          detail: state.storageInfo?.backupCount || state.backupHistory.length ? `${state.storageInfo?.backupCount || state.backupHistory.length} 份自动备份` : "建议先生成或下载一份备份",
          route: "home",
        },
        {
          label: "AI 服务",
          status: state.systemHealth?.aiReady ? "ready" : "action",
          detail: state.systemHealth ? (state.systemHealth.aiReady ? `模式 ${state.systemHealth.mode || "-"}` : "AI 服务未就绪") : "等待健康检查",
          route: "home",
        },
        {
          label: "生产存储",
          status: storageDegraded || presenceDegraded || evidenceDegraded ? "optimize" : "ready",
          detail: storageDegraded || presenceDegraded || evidenceDegraded ? "存在 JSON/内存/本地证据存储降级" : "适配器状态正常",
          route: "home",
        },
      ];
    });
    const backupRestorePreview = computed(() => {
      const raw = String(state.backupRestoreText || "").trim();
      if (!raw) return null;
      try {
        const payload = JSON.parse(raw);
        const snapshot = payload.state && typeof payload.state === "object" ? payload.state : payload;
        return {
          valid: true,
          questions: Array.isArray(snapshot.questions) ? snapshot.questions.length : 0,
          papers: Array.isArray(snapshot.papers) ? snapshot.papers.length : 0,
          participants: Array.isArray(snapshot.participants) ? snapshot.participants.length : Array.isArray(snapshot.candidates) ? snapshot.candidates.length : 0,
          sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions.length : 0,
          gradingResults: snapshot.gradingResults && typeof snapshot.gradingResults === "object" ? Object.keys(snapshot.gradingResults).length : 0,
          exportedAt: payload.exportedAt || "",
        };
      } catch (error) {
        return { valid: false, error: error.message || "JSON 格式错误" };
      }
    });
    const assignmentTotalPages = computed(() => Math.max(1, Math.ceil(sessions.value.length / state.assignmentPageSize)));
    const pagedAssignments = computed(() => {
      const page = Math.min(state.assignmentPage, assignmentTotalPages.value);
      const start = (page - 1) * state.assignmentPageSize;
      return sessions.value.slice(start, start + state.assignmentPageSize);
    });
    const allPagedAssignmentsSelected = computed(() => pagedAssignments.value.length > 0 && pagedAssignments.value.every((item) => state.selectedAssignmentIds.includes(item.id)));
    const proctorEvents = computed(() => state.dashboard?.proctorEvents || state.dashboard?.auditLog || []);
    const proctorEventSummary = computed(() => state.dashboard?.proctorEventSummary || {});
    const filteredProctorEvents = computed(() => {
      const mode = state.proctorEventFilter;
      return proctorEvents.value.filter((event) => {
        const status = event.status || (event.type === "proctor-event" ? "待处理" : "已记录");
        if (mode === "pending") return event.type === "proctor-event" && status === "待处理";
        if (mode === "handled") return event.type === "proctor-event" && status !== "待处理";
        if (mode === "risk") return event.type === "proctor-event";
        return true;
      });
    });
    const selectedPendingProctorEvents = computed(() =>
      proctorEvents.value.filter((event) => state.selectedProctorEventIds.includes(event.id) && event.type === "proctor-event" && proctorEventStatus(event) === "待处理"),
    );
    const allFilteredPendingProctorEventsSelected = computed(() => {
      const pending = filteredProctorEvents.value.filter((event) => event.type === "proctor-event" && proctorEventStatus(event) === "待处理");
      return pending.length > 0 && pending.every((event) => state.selectedProctorEventIds.includes(event.id));
    });
    const filteredProctorSessions = computed(() => {
      const keyword = String(state.proctorSearch || "").trim().toLowerCase();
      return sessions.value.filter((item) => {
        const text = [item.candidate, item.ticket, item.className, item.paperName, item.paper, item.status, item.risk].join(" ").toLowerCase();
        if (keyword && !text.includes(keyword)) return false;
        if (state.proctorRiskFilter !== "all" && (item.risk || "低") !== state.proctorRiskFilter) return false;
        if (state.proctorStatusFilter === "online" && !(item.online || item.onlineStatus === "在线")) return false;
        if (state.proctorStatusFilter !== "all" && state.proctorStatusFilter !== "online" && item.status !== state.proctorStatusFilter) return false;
        return true;
      });
    });
    const candidateAnsweredCount = computed(() => Object.keys(state.candidate.answers || {}).length);
    const candidateQuestionCount = computed(() => state.candidate.questions.length);
    const candidateProgress = computed(() => {
      if (!candidateQuestionCount.value) return 0;
      return Math.round((candidateAnsweredCount.value / candidateQuestionCount.value) * 100);
    });
    const candidateMissingCount = computed(() => Math.max(0, candidateQuestionCount.value - candidateAnsweredCount.value));
    const candidateMarkedCount = computed(() => state.candidate.markedQuestionIds.length);
    const candidateReadOnly = computed(() => !state.candidate.access?.canSave);
    const candidateRemainingText = computed(() => formatDuration(state.candidate.remainingSeconds));

    async function refresh() {
      if (state.route === "candidate") {
        state.loading = false;
        if (state.candidate.authToken && !state.candidate.session) await loadCandidateExams();
        return;
      }
      if (!state.admin.token) {
        state.loading = false;
        return;
      }
      state.loading = true;
      try {
        const dashboard = await request("/api/dashboard");
        state.dashboard = dashboard;
        state.dashboardError = "";
        if (!canAccessRoute(state.route)) go("home");
        if (hasAdminPermission("system")) loadStorageInfo().catch(() => { });
        const firstGroup = (dashboard.groups || [])[0]?.name || "";
        if (!state.candidateForm.className) state.candidateForm.className = firstGroup;
        const groupIds = new Set((dashboard.groups || []).map((item) => item.id));
        state.selectedGroupIds = state.selectedGroupIds.filter((id) => groupIds.has(id));
        state.groupPage = Math.min(state.groupPage, Math.max(1, Math.ceil(groupIds.size / state.groupPageSize) || 1));
        const tickets = new Set((dashboard.participants || dashboard.candidates || []).map((item) => item.ticket));
        state.selectedParticipantTickets = state.selectedParticipantTickets.filter((ticket) => tickets.has(ticket));
        state.participantPage = Math.min(state.participantPage, Math.max(1, Math.ceil(tickets.size / state.participantPageSize) || 1));
        const sessionIds = new Set((dashboard.sessions || []).map((item) => item.id));
        state.selectedAssignmentIds = state.selectedAssignmentIds.filter((id) => sessionIds.has(id));
        state.assignmentPage = Math.min(state.assignmentPage, Math.max(1, Math.ceil(sessionIds.size / state.assignmentPageSize) || 1));
        const eventIds = new Set((dashboard.proctorEvents || []).map((item) => item.id));
        state.selectedProctorEventIds = state.selectedProctorEventIds.filter((id) => eventIds.has(id));
        if (dashboard.proctorRules) state.proctorRulesForm = { ...state.proctorRulesForm, ...dashboard.proctorRules };
        if (state.route === "proctor") state.proctorLastRefreshedAt = new Date().toISOString();
      } catch (error) {
        console.warn("Dashboard data load failed:", error);
        handleAdminAuthError(error);
        state.dashboardError = error.message || "控制台数据加载失败";
        if (!state.dashboard) notify(`控制台数据加载失败：${state.dashboardError}`);
      } finally {
        state.loading = false;
        mountIcons();
      }
    }

    function go(route, params = {}) {
      if (route !== "candidate" && !canAccessRoute(route)) {
        notify("当前账号无权访问该模块");
        route = "home";
        params = {};
      }
      state.route = route;
      if (route !== "candidate") {
        stopCandidateHeartbeat();
        stopCandidateCountdown();
      }
      if (route === "proctor") startProctorRefresh();
      else stopProctorRefresh();
      if (route === "candidate") {
        state.candidate.sessionId = params.session || state.candidate.sessionId || "";
        if (params.session) {
          loadCandidateSession(state.candidate.sessionId).catch((error) => notify(`测试会话加载失败：${error.message}`));
        } else {
          loadCandidateExams().catch((error) => notify(`考试列表加载失败：${error.message}`));
        }
      }
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

    function hasAdminPermission(permission) {
      if (!permission) return true;
      const permissions = adminPermissions.value;
      return permissions.includes(permission) || permissions.includes("system");
    }

    function canAccessRoute(route) {
      if (route === "home" || route === "candidate") return true;
      const item = navItems.find((entry) => entry.key === route);
      return item ? hasAdminPermission(item.permission) : false;
    }

    function startProctorRefresh() {
      stopProctorRefresh();
      startProctorStream();
      state.proctorRefreshTimer = setInterval(() => {
        if (state.route === "proctor") refresh().catch(() => { });
      }, 8000);
    }

    function stopProctorRefresh() {
      if (state.proctorRefreshTimer) {
        clearInterval(state.proctorRefreshTimer);
        state.proctorRefreshTimer = null;
      }
      stopProctorStream();
      if (state.proctorStreamRefreshTimer) {
        clearTimeout(state.proctorStreamRefreshTimer);
        state.proctorStreamRefreshTimer = null;
      }
    }

    function startProctorStream() {
      if (state.proctorStream || !state.admin.token || typeof EventSource === "undefined") return;
      const source = new EventSource(`/api/proctor/stream?token=${encodeURIComponent(state.admin.token)}`);
      state.proctorStream = source;
      state.proctorStreamStatus = "连接中";
      source.addEventListener("ready", () => {
        state.proctorStreamStatus = "实时";
      });
      source.addEventListener("proctor-update", () => {
        state.proctorStreamStatus = "实时";
        scheduleProctorStreamRefresh();
      });
      source.onerror = () => {
        state.proctorStreamStatus = "轮询";
      };
    }

    function stopProctorStream() {
      if (state.proctorStream) {
        state.proctorStream.close();
        state.proctorStream = null;
      }
      state.proctorStreamStatus = "未连接";
    }

    function scheduleProctorStreamRefresh() {
      if (state.proctorStreamRefreshTimer || state.route !== "proctor") return;
      state.proctorStreamRefreshTimer = setTimeout(() => {
        state.proctorStreamRefreshTimer = null;
        if (state.route === "proctor") refresh().catch(() => { });
      }, 600);
    }

    function runHomeAction(action) {
      if (!action) return;
      if (action.action === "assignment") {
        openAssignmentModal();
        return;
      }
      go(action.route || "home", action.params || {});
    }

    function runQuickAction(action) {
      if (!action) return;
      if (action.disabled) {
        notify(action.desc || "当前条件不足");
        return;
      }
      runHomeAction(action);
    }

    function candidateAuthHeaders() {
      return state.candidate.authToken ? { authorization: `Bearer ${state.candidate.authToken}` } : {};
    }

    function adminAuthHeaders() {
      return state.admin.token ? { authorization: `Bearer ${state.admin.token}` } : {};
    }

    function handleAdminAuthError(error) {
      const message = String(error?.message || "");
      if (message.includes("运营登录") || message.includes("请先登录运营控制台")) {
        state.admin.token = "";
        state.admin.user = null;
        localStorage.removeItem("smartqAdminToken");
        state.dashboard = null;
      }
    }

    function adapterStatusText(status) {
      if (!status?.degraded) return "当前适配器可用";
      if (status.requestedAdapter === "postgres") return "已配置数据库，当前仍使用 JSON 文件";
      if (status.requestedAdapter === "redis") return status.redisReachable === false ? "Redis 不可达，当前仍使用内存状态" : "已配置 Redis，当前仍使用内存状态";
      if (["s3", "oss", "cos", "object-storage"].includes(status.requestedAdapter)) return "已配置对象存储，当前仍使用本地文件";
      return "未支持的适配器，当前使用默认实现";
    }

    function opsLevelClass(level = "") {
      if (level === "critical") return "bg-rose-50 text-coral";
      if (level === "warning") return "bg-amber-50 text-honey";
      return "bg-cyan-50 text-ocean";
    }

    function opsStatusText(status = "") {
      if (status === "critical") return "严重";
      if (status === "warning") return "需关注";
      return "正常";
    }

    async function loadAdminSession() {
      if (!state.admin.token || state.route === "candidate") return;
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
        if (!canAccessRoute(state.route)) go("home");
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
      state.dashboard = null;
      state.dashboardError = "";
      localStorage.removeItem("smartqAdminToken");
      notify("已退出运营控制台");
      mountIcons();
    }

    async function loadStorageInfo() {
      if (!state.admin.token || !hasAdminPermission("system")) return;
      state.storageLoading = true;
      try {
        const [result, health, ops] = await Promise.all([
          request("/api/admin/storage"),
          request("/api/health", { skipAuth: true }),
          request("/api/admin/ops"),
        ]);
        state.storageInfo = result.storage;
        state.systemHealth = health;
        state.opsSnapshot = ops;
        loadBackupHistory().catch(() => { });
        loadAdminSessions().catch(() => { });
        loadAuditLog().catch(() => { });
      } catch (error) {
        handleAdminAuthError(error);
        notify(`存储状态加载失败：${error.message}`);
      } finally {
        state.storageLoading = false;
      }
    }

    async function loadAdminSessions() {
      if (!state.admin.token || !hasAdminPermission("system")) return;
      state.adminSessionsLoading = true;
      try {
        const result = await request("/api/admin/sessions");
        state.adminSessions = result.sessions || [];
      } catch (error) {
        handleAdminAuthError(error);
        notify(`会话加载失败：${error.message}`);
      } finally {
        state.adminSessionsLoading = false;
      }
    }

    async function revokeAdminSession(session) {
      if (!session?.id) return;
      try {
        await request(`/api/admin/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
        notify(session.current ? "当前会话已撤销，请重新登录" : "运营会话已撤销");
        if (session.current) {
          state.admin.token = "";
          state.admin.user = null;
          state.dashboard = null;
          localStorage.removeItem("smartqAdminToken");
          return;
        }
        await loadAdminSessions();
        await loadAuditLog();
      } catch (error) {
        handleAdminAuthError(error);
        notify(`撤销会话失败：${error.message}`);
      }
    }

    async function loadAuditLog() {
      if (!state.admin.token || !hasAdminPermission("system")) return;
      state.auditLoading = true;
      try {
        const params = new URLSearchParams();
        if (state.auditFilterType) params.set("type", state.auditFilterType);
        if (String(state.auditSearch || "").trim()) params.set("q", String(state.auditSearch).trim());
        params.set("limit", "80");
        const result = await request(`/api/admin/audit?${params.toString()}`);
        state.auditRows = result.rows || [];
        state.auditTypes = result.types || [];
      } catch (error) {
        handleAdminAuthError(error);
        notify(`审计日志加载失败：${error.message}`);
      } finally {
        state.auditLoading = false;
      }
    }

    function exportAuditLog() {
      const rows = (state.auditRows || []).map((item, index) => ({
        序号: index + 1,
        时间: formatDateTimeFull(item.createdAt),
        类型: item.type,
        内容: item.message,
        状态: item.status,
        风险: item.risk,
        来源: item.source,
        会话ID: item.sessionId,
        参与者: item.candidate,
        编号: item.ticket,
        处理人: item.resolvedBy,
      }));
      if (!rows.length) {
        notify("暂无可导出的审计日志");
        return;
      }
      downloadExcelTable("SmartQ 审计日志", rows, `smartq-audit-log-${dateStamp()}.xls`);
      notify(`已导出 ${rows.length} 条审计日志`);
    }

    async function downloadBackup() {
      state.backupDownloading = true;
      try {
        const snapshot = await request("/api/admin/backup");
        downloadJson(snapshot, `smartq-backup-${dateStamp()}.json`);
        state.storageInfo = snapshot.storage || state.storageInfo;
        notify("运行时备份已下载");
      } catch (error) {
        handleAdminAuthError(error);
        notify(`备份下载失败：${error.message}`);
      } finally {
        state.backupDownloading = false;
      }
    }

    async function loadBackupHistory() {
      if (!state.admin.token || !hasAdminPermission("system")) return;
      state.backupHistoryLoading = true;
      try {
        const result = await request("/api/admin/backups");
        state.backupHistory = result.backups || [];
        state.storageInfo = result.storage || state.storageInfo;
      } catch (error) {
        handleAdminAuthError(error);
        notify(`备份历史加载失败：${error.message}`);
      } finally {
        state.backupHistoryLoading = false;
      }
    }

    async function downloadHistoricalBackup(item) {
      if (!item?.name) return;
      try {
        const result = await request(`/api/admin/backups/${encodeURIComponent(item.name)}`);
        downloadJson(result.snapshot, item.name);
        notify("历史备份已下载");
      } catch (error) {
        handleAdminAuthError(error);
        notify(`历史备份下载失败：${error.message}`);
      }
    }

    async function restoreBackup() {
      const raw = String(state.backupRestoreText || "").trim();
      if (!raw) {
        notify("请粘贴备份 JSON");
        return;
      }
      if (!backupRestorePreview.value?.valid) {
        notify("备份 JSON 格式不正确");
        return;
      }
      if (String(state.backupRestoreConfirm || "").trim() !== "RESTORE") {
        notify("请输入 RESTORE 确认恢复");
        return;
      }
      state.backupRestoring = true;
      try {
        await request("/api/admin/restore", {
          method: "POST",
          body: raw,
        });
        state.admin.token = "";
        state.admin.user = null;
        state.dashboard = null;
        state.storageInfo = null;
        state.backupRestoreText = "";
        state.backupRestoreConfirm = "";
        localStorage.removeItem("smartqAdminToken");
        notify("数据已恢复，请重新登录运营控制台");
      } catch (error) {
        handleAdminAuthError(error);
        notify(`备份恢复失败：${error.message}`);
      } finally {
        state.backupRestoring = false;
        mountIcons();
      }
    }

    function candidateDraftKey(sessionId = state.candidate.session?.id || state.candidate.sessionId) {
      return sessionId ? `smartqCandidateDraft:${sessionId}` : "";
    }

    function handleCandidateAuthError(error) {
      const message = String(error?.message || "");
      if (message.includes("登录已失效") || message.includes("登录已过期") || message.includes("请先登录")) {
        state.candidate.authToken = "";
        state.candidate.authUser = null;
        state.candidate.exams = [];
        state.candidate.session = null;
        state.candidate.questions = [];
        state.candidate.answers = {};
        localStorage.removeItem("smartqCandidateToken");
        stopCandidateHeartbeat();
        stopCandidateCountdown();
      }
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

    function selectReviewEntry(entry) {
      if (!entry?.sessionId) return;
      state.selectedReviewSessionId = entry.sessionId;
      initReviewForm(entry);
      mountIcons();
    }

    function initReviewForm(entry = selectedReviewEntry.value) {
      if (!entry?.sessionId) return;
      if (state.reviewForms[entry.sessionId]) return;
      const rows = {};
      (entry.details || [])
        .filter((detail) => detail.reviewRequired)
        .forEach((detail) => {
          rows[detail.questionId] = {
            awarded: Number(detail.awarded || 0),
            comment: detail.reviewerComment || detail.aiComment || "",
          };
        });
      state.reviewForms[entry.sessionId] = rows;
    }

    function reviewFormRow(entry, detail) {
      if (!entry?.sessionId || !detail?.questionId) return { awarded: 0, comment: "" };
      initReviewForm(entry);
      return state.reviewForms[entry.sessionId][detail.questionId];
    }

    async function submitReviewEntry(entry = selectedReviewEntry.value) {
      if (!entry?.sessionId) {
        notify("请选择要复核的答卷");
        return;
      }
      initReviewForm(entry);
      const form = state.reviewForms[entry.sessionId] || {};
      const reviews = (entry.details || [])
        .filter((detail) => detail.reviewRequired)
        .map((detail) => ({
          questionId: detail.questionId,
          awarded: clampNumber(form[detail.questionId]?.awarded, 0, Number(detail.score || 0), Number(detail.awarded || 0)),
          comment: String(form[detail.questionId]?.comment || "").trim(),
        }));
      if (!reviews.length) {
        notify("该答卷没有需要人工复核的主观题");
        return;
      }
      state.reviewSubmitting = true;
      const previousQueue = filteredGradingReviewQueue.value.slice();
      const previousIndex = Math.max(0, previousQueue.findIndex((item) => item.sessionId === entry.sessionId));
      try {
        await request("/api/grading/review", {
          method: "POST",
          body: JSON.stringify({ sessionId: entry.sessionId, reviews, reviewer: state.admin.user?.username || state.admin.username || "admin" }),
        });
        await refresh();
        const nextQueue = filteredGradingReviewQueue.value;
        const stillVisible = nextQueue.find((item) => item.sessionId === entry.sessionId);
        if (stillVisible) {
          state.selectedReviewSessionId = stillVisible.sessionId;
        } else {
          const nextEntry = nextQueue[Math.min(previousIndex, Math.max(0, nextQueue.length - 1))] || null;
          state.selectedReviewSessionId = nextEntry?.sessionId || "";
          if (nextEntry) initReviewForm(nextEntry);
        }
        notify("答卷复核已保存");
      } catch (error) {
        notify(`复核保存失败：${error.message}`);
      } finally {
        state.reviewSubmitting = false;
      }
    }

    async function publishReviewEntry(entry = selectedReviewEntry.value) {
      if (!entry?.sessionId) {
        notify("请选择要发布的成绩");
        return;
      }
      if (entry.reviewStatus !== "已完成") {
        notify("成绩尚未完成复核，不能发布");
        return;
      }
      state.publishingResultSessionId = entry.sessionId;
      try {
        await request("/api/grading/publish", {
          method: "POST",
          body: JSON.stringify({ sessionId: entry.sessionId, publisher: state.admin.user?.username || state.admin.username || "admin" }),
        });
        await refresh();
        notify("成绩已发布给考生");
      } catch (error) {
        notify(`成绩发布失败：${error.message}`);
      } finally {
        state.publishingResultSessionId = "";
      }
    }

    async function resolveReviewAppeal(entry = selectedReviewEntry.value, action = "reject") {
      const appeal = entry?.latestAppeal;
      if (!entry?.sessionId || !appeal?.id) {
        notify("请选择要处理的申诉");
        return;
      }
      const resolution = String(state.appealResolutionText || "").trim();
      if (resolution.length < 3) {
        notify("请填写处理说明");
        return;
      }
      state.resolvingAppealId = appeal.id;
      try {
        await request("/api/grading/appeal", {
          method: "POST",
          body: JSON.stringify({
            sessionId: entry.sessionId,
            appealId: appeal.id,
            action,
            resolution,
            resolver: state.admin.user?.username || state.admin.username || "admin",
          }),
        });
        state.appealResolutionText = "";
        await refresh();
        notify(action === "accept" ? "申诉已受理，成绩需重新发布" : "申诉已驳回");
      } catch (error) {
        notify(`申诉处理失败：${error.message}`);
      } finally {
        state.resolvingAppealId = "";
      }
    }

    async function exportGradingResults() {
      try {
        const payload = await request("/api/grading/export");
        const rows = (payload.rows || []).map((item, index) => ({
          序号: index + 1,
          参与者: item.candidate,
          编号: item.ticket,
          分组: item.className,
          试卷: item.paperName,
          总分: item.totalScore,
          满分: item.maxScore,
          客观题: item.objectiveScore,
          主观题: item.subjectiveScore,
          待复核: item.subjectivePending,
          复核状态: item.reviewStatus,
          发布状态: item.publishStatus,
          风险: item.risk,
          自动阅卷时间: formatDateTimeFull(item.gradedAt),
          复核时间: formatDateTimeFull(item.reviewedAt),
          发布时间: formatDateTimeFull(item.publishedAt),
          发布人: item.publishedBy,
          会话ID: item.sessionId,
        }));
        if (!rows.length) {
          notify("暂无可导出的成绩");
          return;
        }
        downloadExcelTable("SmartQ 成绩明细", rows, `smartq-grading-results-${dateStamp()}.xls`);
        notify(`已导出 ${rows.length} 条成绩`);
      } catch (error) {
        notify(`成绩导出失败：${error.message}`);
      }
    }

    async function submitAssignment() {
      const errors = validateAssignmentForm();
      state.assignmentFormErrors = errors;
      if (!showFirstFormError(errors)) return;
      const payload = readAssignmentForm();
      state.assignmentSubmitting = true;
      try {
        const editing = Boolean(state.assignmentForm.id);
        const endpoint = editing ? `/api/assignments/${encodeURIComponent(state.assignmentForm.id)}` : "/api/assignments";
        const result = await request(endpoint, {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        await refresh();
        closeAssignmentModal();
        const firstSession = Array.isArray(result.sessions) ? result.sessions[0] : result;
        if (firstSession?.id) copyCandidateUrl(firstSession.id);
        notify(editing ? "试卷分配已更新" : `${firstSession.candidate} 已分配测试`);
      } catch (error) {
        notify(`保存分配失败：${error.message}`);
      } finally {
        state.assignmentSubmitting = false;
      }
    }

    async function submitCandidate() {
      const form = state.candidateForm;
      const errors = validateCandidateForm(form);
      state.candidateFormErrors = errors;
      if (Object.keys(errors).length) {
        notify(Object.values(errors)[0]);
        return;
      }
      const payload = {
        candidate: String(form.candidate || "").trim(),
        className: String(form.className || "").trim(),
        phone: String(form.phone || "").trim(),
        email: String(form.email || "").trim(),
        description: String(form.description || "").trim(),
        avatar: String(form.avatar || "").trim(),
      };
      if (String(form.password || "").trim()) payload.password = String(form.password || "").trim();
      const editing = Boolean(form.ticket);
      state.candidateSubmitting = true;
      try {
        const created = await request(editing ? `/api/participants/${encodeURIComponent(form.ticket)}` : "/api/participants", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        await refresh();
        closeParticipantModal();
        notify(`${created.candidate} 已${editing ? "更新" : "添加"}到参与者信息`);
      } catch (error) {
        notify(`保存失败：${error.message}`);
      } finally {
        state.candidateSubmitting = false;
      }
    }

    function openParticipantModal(participant = null) {
      const firstGroup = groups.value[0]?.name || "";
      Object.assign(state.candidateForm, {
        id: participant?.id || "",
        candidate: participant?.candidate || "",
        ticket: participant?.ticket || "",
        className: participant?.className || firstGroup,
        phone: participant?.phone || "",
        email: participant?.email || "",
        description: participant?.description || "",
        avatar: participant?.avatar || "",
        password: "",
      });
      state.participantModalOpen = true;
      mountIcons();
    }

    function closeParticipantModal() {
      state.participantModalOpen = false;
      state.candidateFormErrors = {};
      Object.assign(state.candidateForm, { id: "", candidate: "", ticket: "", className: groups.value[0]?.name || "", phone: "", email: "", description: "", avatar: "", password: "" });
    }

    async function handleParticipantAvatar(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        notify("请选择图片文件");
        return;
      }
      if (file.size > 1024 * 1024) {
        notify("图片不能超过 1MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.candidateForm.avatar = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    }

    function validateCandidateForm(form) {
      const errors = {};
      const phone = normalizePhoneInput(form.phone);
      const email = String(form.email || "").trim();
      const password = String(form.password || "").trim();
      if (!String(form.candidate || "").trim()) errors.candidate = "请输入参与者姓名";
      else if (String(form.candidate).trim().length > 40) errors.candidate = "参与者姓名不能超过 40 个字符";
      if (!phone) errors.phone = "请输入手机号";
      else if (!/^1[3-9]\d{9}$/.test(phone)) errors.phone = "手机号格式不正确";
      if (!String(form.className || "").trim()) errors.className = "请选择分组";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "邮箱格式不正确";
      if (String(form.description || "").length > 300) errors.description = "描述不能超过 300 个字符";
      if (String(form.avatar || "").length > 1_500_000) errors.avatar = "图片过大，请压缩后上传";
      if (password && password.length < 6) errors.password = "登录密码至少 6 位";
      return errors;
    }

    function validateSpecForm() {
      const errors = {};
      if (!String(state.spec.paperName || "").trim()) errors.paperName = "请输入考卷名称";
      if (!String(state.spec.direction || "").trim()) errors.direction = "请输入出题方向";
      const totalScore = Number(state.spec.totalScore);
      if (!Number.isFinite(totalScore) || totalScore < 1 || totalScore > 200) errors.totalScore = "总分需为 1 到 200";
      const count = ["singleCount", "multipleCount", "judgeCount", "blankCount", "shortCount", "essayCount"].reduce((sum, key) => sum + clampNumber(state.spec[key], 0, 50, 0), 0);
      if (count <= 0) errors.questionCount = "请至少设置一种题型数量";
      return errors;
    }

    function validateAssignmentForm() {
      const errors = {};
      if (!state.assignmentForm.paperId) errors.paperId = "请选择已发布试卷";
      if (!state.assignmentForm.participantTicket) errors.participantTicket = "请选择参与者";
      if (!state.assignmentForm.startTime) errors.startTime = "请选择开始时间";
      if (!state.assignmentForm.endTime) errors.endTime = "请选择结束时间";
      const start = Date.parse(state.assignmentForm.startTime || "");
      const end = Date.parse(state.assignmentForm.endTime || "");
      if (!errors.startTime && Number.isNaN(start)) errors.startTime = "开始时间格式不正确";
      if (!errors.endTime && Number.isNaN(end)) errors.endTime = "结束时间格式不正确";
      if (!errors.startTime && !errors.endTime && end <= start) errors.endTime = "结束时间需晚于开始时间";
      return errors;
    }

    function validateGroupForm(form) {
      const errors = {};
      const name = String(form.name || "").trim();
      if (!name) errors.name = "请输入分组名称";
      else if (name.length > 30) errors.name = "分组名称不能超过 30 个字符";
      if (String(form.description || "").length > 200) errors.description = "备注不能超过 200 个字符";
      return errors;
    }

    function validateCandidateLoginForm() {
      const errors = {};
      const phone = normalizePhoneInput(state.candidate.loginPhone);
      if (!phone) errors.loginPhone = "请输入手机号";
      else if (!/^1[3-9]\d{9}$/.test(phone)) errors.loginPhone = "手机号格式不正确";
      if (!String(state.candidate.loginPassword || "")) errors.loginPassword = "请输入密码";
      return errors;
    }

    function validateCandidatePasswordForm() {
      const errors = {};
      if (!String(state.candidate.currentPassword || "")) errors.currentPassword = "请输入当前密码";
      const next = String(state.candidate.newPassword || "");
      if (!next) errors.newPassword = "请输入新密码";
      else if (next.length < 6) errors.newPassword = "新密码至少 6 位";
      return errors;
    }

    function validateQuestionEditForm(form) {
      const errors = {};
      if (!String(form.stem || "").trim()) errors.stem = "请输入题干";
      if (["单选", "多选"].includes(form.type)) {
        ["optionA", "optionB", "optionC", "optionD"].forEach((key, index) => {
          if (!String(form[key] || "").trim()) errors[key] = `请输入选项 ${["A", "B", "C", "D"][index]}`;
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

    function normalizePhoneInput(value) {
      return String(value || "").replace(/\D/g, "");
    }

    function compareParticipants(a, b) {
      const sort = state.participantSort;
      if (sort === "nameAsc") return String(a.candidate || "").localeCompare(String(b.candidate || ""), "zh-CN");
      if (sort === "ticketAsc") return String(a.ticket || "").localeCompare(String(b.ticket || ""), "zh-CN");
      if (sort === "updatedDesc") return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }

    function resetParticipantFilters() {
      state.participantSearch = "";
      state.participantGroupFilter = "";
      state.participantStatusFilter = "active";
      state.participantSort = "createdDesc";
      state.participantPage = 1;
    }

    function openParticipantImport() {
      state.participantImportOpen = true;
      state.participantImportPreview = null;
      state.participantImportText = "";
      mountIcons();
    }

    function closeParticipantImport() {
      state.participantImportOpen = false;
      state.participantImportPreview = null;
      state.participantImportText = "";
    }

    async function previewParticipantImport() {
      if (!String(state.participantImportText || "").trim()) {
        notify("请先粘贴参与者名单");
        return;
      }
      state.participantImportLoading = true;
      try {
        state.participantImportPreview = await request("/api/participants/import-preview", {
          method: "POST",
          body: JSON.stringify({ text: state.participantImportText }),
        });
      } catch (error) {
        notify(`预览失败：${error.message}`);
      } finally {
        state.participantImportLoading = false;
      }
    }

    async function submitParticipantImport() {
      const validRows = (state.participantImportPreview?.rows || []).filter((item) => item.valid);
      if (!validRows.length) {
        notify("没有可导入的有效参与者");
        return;
      }
      state.participantImportSubmitting = true;
      try {
        const result = await request("/api/participants/batch", {
          method: "POST",
          body: JSON.stringify({ candidates: validRows }),
        });
        await refresh();
        closeParticipantImport();
        notify(`已导入 ${result.candidates?.length || validRows.length} 名参与者`);
      } catch (error) {
        notify(`导入失败：${error.message}`);
      } finally {
        state.participantImportSubmitting = false;
      }
    }

    async function resetParticipantPassword(participant) {
      if (!participant?.ticket) return;
      state.resettingParticipant = participant.ticket;
      try {
        const result = await request(`/api/participants/${encodeURIComponent(participant.ticket)}/password`, { method: "POST" });
        await refresh();
        notify(`${participant.candidate} 密码已重置为 ${result.password}`);
      } catch (error) {
        notify(`重置密码失败：${error.message}`);
      } finally {
        state.resettingParticipant = null;
      }
    }

    async function toggleParticipantStatus(participant) {
      if (!participant?.ticket) return;
      try {
        const disabled = !participant.disabledAt;
        await request(`/api/participants/${encodeURIComponent(participant.ticket)}/status`, {
          method: "POST",
          body: JSON.stringify({ disabled }),
        });
        await refresh();
        notify(`${participant.candidate} 已${disabled ? "停用" : "启用"}`);
      } catch (error) {
        notify(`状态更新失败：${error.message}`);
      }
    }

    async function updateSelectedParticipants(action) {
      if (!state.selectedParticipantTickets.length) {
        notify("请先选择参与者");
        return;
      }
      const payload = { tickets: state.selectedParticipantTickets };
      if (action === "group") {
        if (!state.participantBulkGroup) {
          notify("请选择目标分组");
          return;
        }
        payload.className = state.participantBulkGroup;
      }
      if (action === "disable") payload.disabled = true;
      if (action === "enable") payload.disabled = false;
      if (action === "resetPassword") payload.resetPassword = true;
      try {
        const result = await request("/api/participants/batch-update", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await refresh();
        const messages = {
          group: `已调整 ${result.participants?.length || 0} 名参与者分组`,
          disable: `已停用 ${result.participants?.length || 0} 名参与者`,
          enable: `已启用 ${result.participants?.length || 0} 名参与者`,
          resetPassword: `已重置 ${result.participants?.length || 0} 名参与者密码`,
        };
        notify(messages[action] || "批量更新完成");
      } catch (error) {
        notify(`批量更新失败：${error.message}`);
      }
    }

    function participantSessionStats(participant) {
      const rows = sessions.value.filter((session) => session.ticket === participant.ticket || (participant.phone && session.phone === participant.phone));
      return {
        total: rows.length,
        submitted: rows.filter((item) => item.status === "已提交").length,
        active: rows.filter((item) => item.status === "答题中").length,
      };
    }

    function previewParticipantAvatar(participant) {
      if (!participant?.avatar) return;
      if (!window.Viewer) {
        window.open(participant.avatar, "_blank", "noopener");
        return;
      }
      const container = document.createElement("div");
      const image = document.createElement("img");
      image.src = participant.avatar;
      image.alt = `${participant.candidate || "参与者"}图片`;
      container.appendChild(image);
      const viewer = new Viewer(container, {
        hidden() {
          viewer.destroy();
          container.remove();
        },
        navbar: false,
        title: [1, () => [participant.candidate, participant.ticket].filter(Boolean).join(" · ") || "参与者图片"],
        toolbar: {
          zoomIn: 1,
          zoomOut: 1,
          oneToOne: 1,
          reset: 1,
          prev: 0,
          play: 0,
          next: 0,
          rotateLeft: 1,
          rotateRight: 1,
          flipHorizontal: 1,
          flipVertical: 1,
        },
        transition: true,
        viewed() {
          viewer.zoomTo(1);
        },
      });
      viewer.show();
    }

    async function submitGroup() {
      const form = state.groupForm;
      const errors = validateGroupForm(form);
      state.groupFormErrors = errors;
      if (!showFirstFormError(errors)) return;
      const payload = {
        name: String(form.name || "").trim(),
        description: String(form.description || "").trim(),
      };
      const editing = Boolean(form.id);
      state.groupSubmitting = true;
      try {
        await request(editing ? `/api/groups/${encodeURIComponent(form.id)}` : "/api/groups", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        await refresh();
        closeGroupModal();
        notify(editing ? "分组已更新" : "分组已新建");
      } catch (error) {
        notify(`分组保存失败：${error.message}`);
      } finally {
        state.groupSubmitting = false;
      }
    }

    function openGroupModal(group = null) {
      state.groupFormErrors = {};
      Object.assign(state.groupForm, {
        id: group?.id || "",
        name: group?.name || "",
        description: group?.description || "",
      });
      state.groupModalOpen = true;
      mountIcons();
    }

    function closeGroupModal() {
      state.groupModalOpen = false;
      state.groupFormErrors = {};
      resetGroupForm();
    }

    function editGroup(group) {
      openGroupModal(group);
    }

    function resetGroupForm() {
      Object.assign(state.groupForm, { id: "", name: "", description: "" });
    }

    function groupParticipantCount(group) {
      return candidates.value.filter((item) => item.className === group.name).length;
    }

    function groupInUse(group) {
      return groupParticipantCount(group) > 0 || sessions.value.some((item) => item.className === group.name);
    }

    function toggleGroupSelection(id) {
      const selected = new Set(state.selectedGroupIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      state.selectedGroupIds = [...selected];
    }

    function togglePagedGroupSelection() {
      if (!pagedGroups.value.length) return;
      const selected = new Set(state.selectedGroupIds);
      if (allPagedGroupsSelected.value) {
        pagedGroups.value.forEach((item) => selected.delete(item.id));
      } else {
        pagedGroups.value.forEach((item) => selected.add(item.id));
      }
      state.selectedGroupIds = [...selected];
    }

    function changeGroupPage(delta) {
      state.groupPage = Math.max(1, Math.min(groupTotalPages.value, state.groupPage + delta));
    }

    function askDeleteGroup(group) {
      state.confirmDeleteGroup = group;
    }

    async function confirmDeleteGroup() {
      const target = state.confirmDeleteGroup;
      if (!target) return;
      if (groupInUse(target)) return;
      try {
        await request(`/api/groups/${encodeURIComponent(target.id)}`, { method: "DELETE" });
        state.confirmDeleteGroup = null;
        state.selectedGroupIds = state.selectedGroupIds.filter((id) => id !== target.id);
        await refresh();
        if (state.groupForm.id === target.id) closeGroupModal();
        notify("分组已删除");
      } catch (error) {
        notify(`删除分组失败：${error.message}`);
      }
    }

    async function confirmDeleteSelectedGroups() {
      const selected = groups.value.filter((item) => state.selectedGroupIds.includes(item.id));
      if (!selected.length) return;
      const used = selected.filter(groupInUse);
      if (used.length) {
        notify(`所选分组中包含已被参与者引用的分组，不能删除：${used.map((item) => item.name).join("、")}`);
        state.confirmDeleteSelectedGroups = false;
        return;
      }
      const failed = [];
      for (const group of selected) {
        try {
          await request(`/api/groups/${encodeURIComponent(group.id)}`, { method: "DELETE" });
        } catch (error) {
          failed.push(`${group.name}：${error.message}`);
        }
      }
      state.confirmDeleteSelectedGroups = false;
      state.selectedGroupIds = [];
      await refresh();
      notify(failed.length ? `部分分组删除失败：${failed.join("；")}` : `已删除 ${selected.length} 个分组`);
    }

    function exportGroups(scope = "all") {
      const selected = new Set(state.selectedGroupIds);
      const rows = (scope === "selected" ? groups.value.filter((item) => selected.has(item.id)) : groups.value).map(groupExportRow);
      if (!rows.length) {
        notify(scope === "selected" ? "请先选择要导出的分组" : "暂无可导出的分组");
        return;
      }
      downloadExcelTable("SmartQ 分组信息", rows, `smartq-groups-${scope}-${dateStamp()}.xls`);
      notify(`已导出 ${rows.length} 条分组信息`);
    }

    function groupExportRow(group) {
      return {
        分组名称: group.name || "",
        备注信息: group.description || "",
        参与者数: groupParticipantCount(group),
        创建时间: group.createdAt ? formatDateTimeWithYear(group.createdAt) : "",
        更新时间: group.updatedAt ? formatDateTimeWithYear(group.updatedAt) : "",
      };
    }

    function toggleParticipantSelection(ticket) {
      const selected = new Set(state.selectedParticipantTickets);
      if (selected.has(ticket)) selected.delete(ticket);
      else selected.add(ticket);
      state.selectedParticipantTickets = [...selected];
    }

    function togglePagedParticipantSelection() {
      if (!pagedParticipants.value.length) return;
      const selected = new Set(state.selectedParticipantTickets);
      if (allPagedParticipantsSelected.value) {
        pagedParticipants.value.forEach((item) => selected.delete(item.ticket));
      } else {
        pagedParticipants.value.forEach((item) => selected.add(item.ticket));
      }
      state.selectedParticipantTickets = [...selected];
    }

    function changeParticipantPage(delta) {
      state.participantPage = Math.max(1, Math.min(participantTotalPages.value, state.participantPage + delta));
    }

    async function confirmDeleteParticipant() {
      const target = state.confirmDeleteParticipant;
      if (!target) return;
      try {
        const result = await request(`/api/participants/${encodeURIComponent(target.ticket)}`, { method: "DELETE" });
        state.confirmDeleteParticipant = null;
        await refresh();
        notify(result.disabled ? "参与者已有考试记录，已停用账号" : "参与者信息已删除");
      } catch (error) {
        notify(`删除失败：${error.message}`);
      }
    }

    async function confirmDeleteSelectedParticipants() {
      if (!state.selectedParticipantTickets.length) return;
      try {
        const result = await request("/api/participants/delete-batch", {
          method: "POST",
          body: JSON.stringify({ tickets: state.selectedParticipantTickets }),
        });
        state.confirmDeleteSelectedParticipants = false;
        state.selectedParticipantTickets = [];
        await refresh();
        notify(result.disabled ? "所选参与者已删除，含考试记录的账号已停用" : "已删除所选参与者");
      } catch (error) {
        notify(`批量删除失败：${error.message}`);
      }
    }

    function exportParticipants(scope = "all") {
      const selected = new Set(state.selectedParticipantTickets);
      const source = scope === "selected" ? filteredParticipants.value.filter((item) => selected.has(item.ticket)) : filteredParticipants.value;
      const rows = source.map(participantExportRow);
      if (!rows.length) {
        notify(scope === "selected" ? "请先选择要导出的参与者" : "暂无可导出的参与者");
        return;
      }
      downloadExcelTable("SmartQ 参与者信息", rows, `smartq-participants-${scope}-${dateStamp()}.xls`);
      notify(`已导出 ${rows.length} 条参与者信息`);
    }

    function participantExportRow(item) {
      return {
        姓名: item.candidate || "",
        编号: item.ticket || "",
        分组: item.className || "",
        手机号: item.phone || "",
        邮箱: item.email || "",
        描述: item.description || "",
      };
    }

    function openAssignmentModal(assignment = null) {
      state.assignmentFormErrors = {};
      Object.assign(state.assignmentForm, {
        id: assignment?.id || "",
        paperId: assignment?.paperId || "",
        startTime: assignment?.startTime || defaultDateTimeLocal(10, 0),
        endTime: assignment?.endTime || defaultDateTimeLocal(11, 30),
        participantTicket: assignment?.ticket || "",
        candidate: assignment?.candidate || "",
        ticket: assignment?.ticket || "",
        className: assignment?.className || "",
        remark: assignment?.remark || "",
      });
      state.assignmentModalOpen = true;
      mountIcons();
    }

    function closeAssignmentModal() {
      state.assignmentModalOpen = false;
      state.assignmentFormErrors = {};
      resetAssignmentForm();
    }

    function resetAssignmentForm() {
      Object.assign(state.assignmentForm, {
        id: "",
        paperId: "",
        startTime: defaultDateTimeLocal(10, 0),
        endTime: defaultDateTimeLocal(11, 30),
        participantTicket: "",
        candidate: "",
        ticket: "",
        className: "",
        remark: "",
      });
    }

    function setAssignmentParticipant(ticket) {
      state.assignmentFormErrors.participantTicket = "";
      const participant = candidates.value.find((item) => item.ticket === ticket || item.id === ticket);
      Object.assign(state.assignmentForm, {
        participantTicket: ticket || "",
        candidate: participant?.candidate || "",
        ticket: participant?.ticket || "",
        className: participant?.className || "",
      });
    }

    function viewAssignmentParticipant(assignment) {
      const participant = candidates.value.find((item) => item.ticket === assignment.ticket || item.id === assignment.ticket);
      state.viewingParticipant = participant || {
        candidate: assignment.candidate || "",
        ticket: assignment.ticket || "",
        className: assignment.className || "",
        phone: assignment.phone || "",
        email: assignment.email || "",
        description: "",
        avatar: "",
      };
      mountIcons();
    }

    function toggleAssignmentSelection(id) {
      const selected = new Set(state.selectedAssignmentIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      state.selectedAssignmentIds = [...selected];
    }

    function togglePagedAssignmentSelection() {
      const selected = new Set(state.selectedAssignmentIds);
      if (allPagedAssignmentsSelected.value) {
        pagedAssignments.value.forEach((item) => selected.delete(item.id));
      } else {
        pagedAssignments.value.forEach((item) => selected.add(item.id));
      }
      state.selectedAssignmentIds = [...selected];
    }

    function changeAssignmentPage(delta) {
      state.assignmentPage = Math.max(1, Math.min(assignmentTotalPages.value, state.assignmentPage + delta));
    }

    function askDeleteAssignment(assignment) {
      state.confirmDeleteAssignment = assignment;
    }

    async function deleteCandidate(ticket) {
      const participant = candidates.value.find((item) => item.ticket === ticket || item.id === ticket);
      if (participant) state.confirmDeleteParticipant = participant;
    }

    async function confirmDeleteAssignment() {
      const target = state.confirmDeleteAssignment;
      if (!target) return;
      try {
        await request(`/api/assignments/${target.id}`, { method: "DELETE" });
        state.confirmDeleteAssignment = null;
        state.selectedAssignmentIds = state.selectedAssignmentIds.filter((id) => id !== target.id);
        await refresh();
        notify("考试分配已撤销");
      } catch (error) {
        notify(`撤销失败：${error.message}`);
      }
    }

    async function confirmDeleteSelectedAssignments() {
      if (!state.selectedAssignmentIds.length) return;
      try {
        await request("/api/assignments/delete-batch", {
          method: "POST",
          body: JSON.stringify({ ids: state.selectedAssignmentIds }),
        });
        state.confirmDeleteSelectedAssignments = false;
        state.selectedAssignmentIds = [];
        await refresh();
        notify("已删除所选试卷分配");
      } catch (error) {
        notify(`批量删除失败：${error.message}`);
      }
    }

    function exportAssignments(scope = "all") {
      const selected = new Set(state.selectedAssignmentIds);
      const rows = (scope === "selected" ? sessions.value.filter((item) => selected.has(item.id)) : sessions.value).map(assignmentExportRow);
      if (!rows.length) {
        notify(scope === "selected" ? "请先选择要导出的试卷分配" : "暂无可导出的试卷分配");
        return;
      }
      downloadExcelTable("SmartQ 试卷分配信息", rows, `smartq-assignments-${scope}-${dateStamp()}.xls`);
      notify(`已导出 ${rows.length} 条试卷分配信息`);
    }

    function assignmentExportRow(item) {
      return {
        参与者: item.candidate || "",
        编号: item.ticket || "",
        分组: item.className || "",
        试卷: item.paperName || item.paper || "",
        开始时间: item.startTime || "",
        结束时间: item.endTime || "",
        状态: item.status || "",
        进度: `${item.progress || 0}%`,
        风险: item.risk || "",
        备注: item.remark || "",
        会话ID: item.id || "",
      };
    }

    function assignmentProgressText(item) {
      const progress = Number(item.progress || 0);
      if (item.status === "待开考") return "";
      if (item.status === "已提交") return "已完成";
      return `答题进度 ${Math.max(0, Math.min(100, Math.round(progress)))}%`;
    }

    function assignmentRiskText(item) {
      const risk = item.risk || "低";
      if (risk === "低") return "";
      return `风险${risk}`;
    }

    async function recordProctorRisk(sessionId) {
      try {
        await request(`/api/proctor/sessions/${sessionId}/events`, {
          method: "POST",
          body: JSON.stringify({ risk: "高", event: "监考员手动记录风险", source: "manual" }),
        });
        await refresh();
        notify("风险事件已记录");
      } catch (error) {
        notify(`记录失败：${error.message}`);
      }
    }

    async function resolveProctorEvent(event, status = "已处理") {
      if (!event?.id || event.type !== "proctor-event") return;
      try {
        await request(`/api/proctor/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status, resolution: state.proctorResolutionText }),
        });
        state.proctorResolutionText = "";
        await refresh();
        if (state.proctorDetail?.session?.id) await openProctorDetail(state.proctorDetail.session.id, { silent: true });
        notify(status === "误报" ? "风险已标记为误报" : "风险已处理");
      } catch (error) {
        notify(`处理失败：${error.message}`);
      }
    }

    function toggleProctorEventSelection(id) {
      const selected = new Set(state.selectedProctorEventIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      state.selectedProctorEventIds = [...selected];
    }

    function toggleFilteredProctorEventSelection() {
      const pending = filteredProctorEvents.value.filter((event) => event.type === "proctor-event" && proctorEventStatus(event) === "待处理");
      const selected = new Set(state.selectedProctorEventIds);
      if (allFilteredPendingProctorEventsSelected.value) {
        pending.forEach((event) => selected.delete(event.id));
      } else {
        pending.forEach((event) => selected.add(event.id));
      }
      state.selectedProctorEventIds = [...selected];
    }

    async function resolveSelectedProctorEvents(status = "已处理") {
      const ids = selectedPendingProctorEvents.value.map((event) => event.id);
      if (!ids.length) {
        notify("请选择待处理风险事件");
        return;
      }
      try {
        const result = await request("/api/proctor/events/batch", {
          method: "POST",
          body: JSON.stringify({
            ids,
            status,
            resolution: status === "误报" ? "批量标记误报" : "批量处理确认",
          }),
        });
        state.selectedProctorEventIds = state.selectedProctorEventIds.filter((id) => !ids.includes(id));
        await refresh();
        notify(`已${status === "误报" ? "标记误报" : "处理"} ${result.updated || ids.length} 条风险`);
      } catch (error) {
        notify(`批量处理失败：${error.message}`);
      }
    }

    async function saveProctorRules() {
      state.proctorRulesSaving = true;
      try {
        const result = await request("/api/proctor/rules", {
          method: "POST",
          body: JSON.stringify(state.proctorRulesForm),
        });
        state.proctorRulesForm = { ...state.proctorRulesForm, ...result.rules };
        await refresh();
        notify("监考规则已保存");
      } catch (error) {
        notify(`规则保存失败：${error.message}`);
      } finally {
        state.proctorRulesSaving = false;
      }
    }

    async function openProctorDetail(sessionId, options = {}) {
      state.proctorDetailLoading = true;
      try {
        state.proctorDetail = await request(`/api/proctor/sessions/${encodeURIComponent(sessionId)}`);
        loadProctorReport(sessionId, { silent: true }).catch(() => { });
        state.proctorControlNote = "";
        state.proctorMessageText = "";
        mountIcons();
      } catch (error) {
        if (!options.silent) notify(`加载监考详情失败：${error.message}`);
      } finally {
        state.proctorDetailLoading = false;
      }
    }

    async function loadProctorReport(sessionId = state.proctorDetail?.session?.id, options = {}) {
      if (!sessionId) return null;
      state.proctorReportLoading = true;
      try {
        const report = await request(`/api/proctor/sessions/${encodeURIComponent(sessionId)}/report`);
        if (state.proctorDetail?.session?.id === sessionId) {
          state.proctorDetail = { ...state.proctorDetail, report };
        }
        return report;
      } catch (error) {
        if (!options.silent) notify(`加载取证报告失败：${error.message}`);
        return null;
      } finally {
        state.proctorReportLoading = false;
        mountIcons();
      }
    }

    async function exportProctorReport() {
      const sessionId = state.proctorDetail?.session?.id;
      if (!sessionId) return;
      const report = state.proctorDetail?.report || await loadProctorReport(sessionId);
      if (!report) return;
      const rows = [
        { 分类: "概览", 项目: "参与者", 内容: report.session?.candidate || "" },
        { 分类: "概览", 项目: "编号", 内容: report.session?.ticket || "" },
        { 分类: "概览", 项目: "试卷", 内容: report.paper?.name || "" },
        { 分类: "概览", 项目: "风险事件", 内容: report.summary?.riskEvents || 0 },
        { 分类: "概览", 项目: "待处理事件", 内容: report.summary?.pendingEvents || 0 },
        { 分类: "概览", 项目: "高风险事件", 内容: report.summary?.highRiskEvents || 0 },
        { 分类: "概览", 项目: "取证快照", 内容: report.summary?.evidenceSnapshots || 0 },
        { 分类: "概览", 项目: "证据附件", 内容: report.summary?.evidenceAttachments || 0 },
        { 分类: "概览", 项目: "提交来源", 内容: submissionSourceText(report.summary?.submissionSource || "") },
        { 分类: "概览", 项目: "阅卷状态", 内容: report.summary?.gradingStatus || "" },
        { 分类: "自动分析", 项目: "风险分", 内容: report.analysis?.score ?? "" },
        { 分类: "自动分析", 项目: "风险等级", 内容: report.analysis?.level || "" },
        { 分类: "自动分析", 项目: "结论", 内容: report.analysis?.conclusion || "" },
        ...(report.analysis?.findings || []).map((item) => ({
          分类: "自动分析",
          项目: item.title,
          内容: `${item.severity} · ${item.detail}`,
        })),
        ...(report.analysis?.recommendations || []).map((item, index) => ({
          分类: "处置建议",
          项目: `建议 ${index + 1}`,
          内容: item,
        })),
        { 分类: "设备", 项目: "全屏", 内容: report.device?.fullscreen || "" },
        { 分类: "设备", 项目: "剪贴板", 内容: report.device?.clipboard || "" },
        { 分类: "设备", 项目: "最后心跳", 内容: formatDateTimeFull(report.device?.lastSeenAt) },
        ...(report.evidence || []).map((item) => ({
          分类: "取证快照",
          项目: formatDateTimeFull(item.capturedAt),
          内容: `${item.type} · 全屏 ${item.device?.fullscreen || "-"} · 剪贴板 ${item.device?.clipboard || "-"} · ${item.environment?.viewport || ""}`,
        })),
        ...(report.evidenceAttachments || []).map((item) => ({
          分类: "证据附件",
          项目: formatDateTimeFull(item.createdAt),
          内容: `${item.label || item.type} · ${item.contentType} · ${formatBytes(item.sizeBytes || 0)} · SHA-256 ${item.sha256 || "-"} · ${item.downloadUrl || item.path || ""}`,
        })),
        ...(report.timeline || []).map((event) => ({
          分类: "时间线",
          项目: formatDateTimeFull(event.createdAt),
          内容: `${event.message || event.event || event.type} ${event.risk ? `风险${event.risk}` : ""} ${event.status || ""} ${event.resolution || ""}`.trim(),
        })),
      ];
      downloadExcelTable("SmartQ 监考取证报告", rows, `smartq-proctor-report-${sessionId}-${dateStamp()}.xls`);
      notify("监考取证报告已导出");
    }

    async function downloadEvidenceAttachment(attachment) {
      if (!attachment?.downloadUrl) {
        notify("证据附件缺少下载地址");
        return;
      }
      try {
        const response = await fetch(attachment.downloadUrl, { headers: adminAuthHeaders() });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const blob = await response.blob();
        const ext = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "text/plain": "txt",
        }[attachment.contentType] || "bin";
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${attachment.label || attachment.id || "evidence"}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        notify("证据附件已下载");
      } catch (error) {
        notify(`证据附件下载失败：${error.message}`);
      }
    }

    function closeProctorDetail() {
      state.proctorDetail = null;
      state.proctorControlNote = "";
      state.proctorMessageText = "";
      state.proctorResolutionText = "";
    }

    async function runProctorControl(action) {
      const sessionId = state.proctorDetail?.session?.id;
      if (!sessionId) return;
      const payload = {
        action,
        note: state.proctorControlNote,
        minutes: state.proctorExtendMinutes,
        message: state.proctorMessageText || state.proctorControlNote,
      };
      try {
        state.proctorDetail = await request(`/api/proctor/sessions/${encodeURIComponent(sessionId)}/control`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        state.proctorControlNote = "";
        state.proctorMessageText = "";
        await refresh();
        notify("监考控制已执行");
      } catch (error) {
        notify(`控制失败：${error.message}`);
      }
    }

    function proctorEventStatus(event = {}) {
      if (event.type !== "proctor-event") return "已记录";
      return event.status || "待处理";
    }

    function proctorEventStatusClass(event = {}) {
      const status = proctorEventStatus(event);
      if (status === "待处理") return "bg-amber-50 text-honey";
      if (status === "误报") return "bg-slate-100 text-slate-600";
      return "bg-emerald-50 text-emerald-700";
    }

    function proctorSessionRiskClass(item = {}) {
      if (item.risk === "高") return "bg-rose-50 text-coral";
      if (item.risk === "中") return "bg-amber-50 text-honey";
      return "bg-emerald-50 text-emerald-700";
    }

    function proctorOnlineClass(item = {}) {
      return item.online || item.onlineStatus === "在线" ? "bg-cyan-50 text-ocean" : "bg-slate-100 text-slate-500";
    }

    function readAssignmentForm() {
      const form = state.assignmentForm;
      const participant = candidates.value.find((item) => item.ticket === form.participantTicket || item.id === form.participantTicket);
      return {
        paperId: form.paperId || publishedPapers.value[0]?.id || "",
        startTime: form.startTime,
        endTime: form.endTime,
        candidate: participant?.candidate || String(form.candidate || "").trim(),
        ticket: participant?.ticket || String(form.ticket || "").trim(),
        className: participant?.className || String(form.className || "").trim(),
        phone: participant?.phone || "",
        email: participant?.email || "",
        remark: String(form.remark || "").trim(),
      };
    }

    function copyCandidateUrl(sessionId) {
      const url = candidateSessionUrl(sessionId);
      navigator.clipboard?.writeText(url).catch(() => { });
      notify("考生入口已复制");
    }

    function candidateSessionUrl(sessionId) {
      const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
      return `${window.location.origin}/#/candidate${query}`;
    }

    async function loginCandidate() {
      const errors = validateCandidateLoginForm();
      state.candidate.loginErrors = errors;
      if (!showFirstFormError(errors)) return;
      state.candidate.loginLoading = true;
      try {
        const password = state.candidate.loginPassword;
        const result = await request("/api/candidate/login", {
          method: "POST",
          body: JSON.stringify({
            phone: state.candidate.loginPhone,
            password,
          }),
        });
        state.candidate.authToken = result.token;
        state.candidate.authUser = result.candidate;
        state.candidate.exams = result.exams || [];
        state.candidate.currentPassword = result.candidate?.passwordMustChange ? password : "";
        state.candidate.loginPassword = "";
        localStorage.setItem("smartqCandidateToken", result.token);
        notify("登录成功");
      } catch (error) {
        state.candidate.loginErrors = {
          form: error.message || "手机号或密码错误，请核对后重试",
        };
        notify(`登录失败：${error.message}`);
      } finally {
        state.candidate.loginLoading = false;
        mountIcons();
      }
    }

    async function logoutCandidate() {
      const token = state.candidate.authToken;
      if (token) {
        request("/api/candidate/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => { });
      }
      state.candidate.authToken = "";
      state.candidate.authUser = null;
      state.candidate.exams = [];
      state.candidate.session = null;
      state.candidate.questions = [];
      state.candidate.answers = {};
      state.candidate.markedQuestionIds = [];
      state.candidate.grading = null;
      state.candidate.confirmSubmit = false;
      state.candidate.submitModalOpen = false;
      state.candidate.localDraftRestored = false;
      state.candidate.currentPassword = "";
      state.candidate.newPassword = "";
      stopCandidateHeartbeat();
      stopCandidateCountdown();
      localStorage.removeItem("smartqCandidateToken");
      notify("已退出考生系统");
    }

    async function changeCandidatePassword() {
      if (!state.candidate.authToken) return;
      const errors = validateCandidatePasswordForm();
      state.candidate.passwordErrors = errors;
      if (!showFirstFormError(errors)) return;
      state.candidate.passwordLoading = true;
      try {
        await request("/api/candidate/password", {
          method: "POST",
          headers: candidateAuthHeaders(),
          body: JSON.stringify({
            currentPassword: state.candidate.currentPassword,
            newPassword: state.candidate.newPassword,
          }),
        });
        const phone = state.candidate.authUser?.phone || state.candidate.loginPhone;
        const password = state.candidate.newPassword;
        state.candidate.currentPassword = "";
        state.candidate.newPassword = "";
        state.candidate.authToken = "";
        localStorage.removeItem("smartqCandidateToken");
        state.candidate.loginPhone = phone;
        state.candidate.loginPassword = password;
        await loginCandidate();
        notify("密码已更新");
      } catch (error) {
        notify(`密码更新失败：${error.message}`);
      } finally {
        state.candidate.passwordLoading = false;
      }
    }

    async function loadCandidateExams() {
      if (!state.candidate.authToken) return;
      state.candidate.examsLoading = true;
      try {
        const data = await request("/api/candidate/exams", { headers: candidateAuthHeaders() });
        state.candidate.authUser = data.candidate;
        state.candidate.exams = data.exams || [];
      } catch (error) {
        handleCandidateAuthError(error);
        notify(`考试列表加载失败：${error.message}`);
      } finally {
        state.candidate.examsLoading = false;
      }
    }

    async function enterCandidateExam(sessionId) {
      state.candidate.sessionId = sessionId;
      await loadCandidateSession(sessionId);
    }

    function backToCandidateExams() {
      state.candidate.session = null;
      state.candidate.questions = [];
      state.candidate.answers = {};
      state.candidate.grading = null;
      state.candidate.gradingStatus = null;
      state.candidate.markedQuestionIds = [];
      state.candidate.submitModalOpen = false;
      stopCandidateHeartbeat();
      stopCandidateCountdown();
      loadCandidateExams().catch((error) => notify(`考试列表加载失败：${error.message}`));
    }

    async function loadCandidateSession(sessionId = state.candidate.sessionId || "s-001") {
      state.candidate.loading = true;
      try {
        const data = await request(`/api/candidate/session/${encodeURIComponent(sessionId)}`, { headers: candidateAuthHeaders() });
        state.candidate.sessionId = sessionId;
        state.candidate.session = data.session;
        state.candidate.exam = data.exam;
        state.candidate.paper = data.paper;
        state.candidate.access = data.access;
        state.candidate.questions = data.questions || [];
        state.candidate.answers = data.answers || {};
        state.candidate.markedQuestionIds = state.candidate.markedQuestionIds.filter((id) => state.candidate.questions.some((question) => question.id === id));
        state.candidate.grading = data.grading || null;
        state.candidate.gradingStatus = data.gradingStatus || null;
        state.candidate.confirmSubmit = false;
        state.candidate.submitModalOpen = false;
        state.candidate.timeoutRefreshQueued = false;
        state.candidate.saveState = "已同步";
        restoreCandidateDraft(sessionId);
        updateCandidateCountdown();
        startCandidateCountdown();
        if (data.access?.canSave) startCandidateHeartbeat();
        else stopCandidateHeartbeat();
      } catch (error) {
        handleCandidateAuthError(error);
        throw error;
      } finally {
        state.candidate.loading = false;
        mountIcons();
      }
    }

    function updateCandidateAnswer(question, value, checked = true) {
      if (!question?.id) return;
      if (!state.candidate.access?.canSave) {
        notify(state.candidate.access?.message || "当前不能作答");
        return;
      }
      if (question.type === "多选") {
        const current = Array.isArray(state.candidate.answers[question.id]) ? [...state.candidate.answers[question.id]] : [];
        const next = checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
        if (next.length) state.candidate.answers[question.id] = next.sort();
        else delete state.candidate.answers[question.id];
      } else if (value !== undefined && value !== null && String(value).trim()) {
        state.candidate.answers[question.id] = String(value).trim();
      } else {
        delete state.candidate.answers[question.id];
      }
      state.candidate.confirmSubmit = false;
      markCandidateAutosavePending();
    }

    function candidateAnswerSelected(questionId, value) {
      const answer = state.candidate.answers[questionId];
      return Array.isArray(answer) ? answer.includes(value) : answer === value;
    }

    function candidateStatus(question) {
      if (state.candidate.answers[question.id] !== undefined) return "已答";
      if (state.candidate.markedQuestionIds.includes(question.id)) return "已标记";
      return "未答";
    }

    function candidateStatusClass(question) {
      const status = candidateStatus(question);
      if (status === "已答") return "bg-emerald-50 text-emerald-700";
      if (status === "已标记") return "bg-amber-50 text-amber-700";
      return "bg-white text-slate-500 ring-1 ring-slate-200";
    }

    function candidateOptionClass(question, value) {
      const selected = candidateAnswerSelected(question.id, value);
      if (!selected) return "border-slate-200 bg-white text-slate-700";
      if (question.type === "多选") return "border-iris bg-indigo-50 text-iris";
      return "border-ocean bg-cyan-50 text-ocean";
    }

    function candidateOptionMarkClass(question, value) {
      const selected = candidateAnswerSelected(question.id, value);
      if (selected && question.type === "多选") return "rounded bg-iris text-white";
      if (selected) return "rounded-full bg-ocean text-white";
      return question.type === "多选" ? "rounded border border-slate-300" : "rounded-full border border-slate-300";
    }

    function markCandidateAutosavePending() {
      if (!state.candidate.access?.canSave) return;
      state.candidate.saveState = "待保存";
      persistCandidateDraft();
      clearTimeout(state.candidate.autosaveTimer);
      state.candidate.autosaveTimer = setTimeout(() => {
        saveCandidateDraft({ silent: true }).catch(() => {
          state.candidate.saveState = "保存失败";
        });
      }, 1200);
    }

    async function saveCandidateDraft(options = {}) {
      if (!state.candidate.session?.id) return null;
      if (!state.candidate.access?.canSave) {
        if (!options.silent) notify(state.candidate.access?.message || "当前不能保存");
        return null;
      }
      const result = await request(`/api/candidate/session/${state.candidate.session.id}`, {
        method: "POST",
        headers: candidateAuthHeaders(),
        body: JSON.stringify({ answers: state.candidate.answers, submit: false }),
      });
      state.candidate.saveState = `已同步 · ${formatClock(result.savedAt)}`;
      localStorage.removeItem(candidateDraftKey(state.candidate.session.id));
      state.candidate.localDraftRestored = false;
      if (!options.silent) notify("草稿已保存");
      return result;
    }

    async function submitCandidateExam() {
      if (!state.candidate.access?.canSubmit) {
        notify(state.candidate.access?.message || "当前不能提交");
        return;
      }
      state.candidate.submitModalOpen = true;
      state.candidate.confirmSubmit = true;
    }

    function closeCandidateSubmitModal() {
      state.candidate.submitModalOpen = false;
      state.candidate.confirmSubmit = false;
    }

    async function confirmCandidateSubmit() {
      if (!state.candidate.access?.canSubmit) {
        notify(state.candidate.access?.message || "当前不能提交");
        closeCandidateSubmitModal();
        return;
      }
      state.candidate.submitting = true;
      try {
        await flushCandidateAutosave();
        const result = await request(`/api/candidate/session/${state.candidate.session.id}`, {
          method: "POST",
          headers: candidateAuthHeaders(),
          body: JSON.stringify({ answers: state.candidate.answers, submit: true }),
        });
        localStorage.removeItem(candidateDraftKey(state.candidate.session.id));
        closeCandidateSubmitModal();
        notify(result.gradingStatus?.message || "提交成功，已进入阅卷队列");
        await loadCandidateSession(state.candidate.session.id);
      } catch (error) {
        handleCandidateAuthError(error);
        notify(`提交失败：${error.message}`);
      } finally {
        state.candidate.submitting = false;
      }
    }

    async function submitCandidateAppeal() {
      if (!state.candidate.session?.id || !state.candidate.grading) {
        notify("成绩发布后才能提交申诉");
        return;
      }
      const reason = String(state.candidate.appealReason || "").trim();
      if (reason.length < 5) {
        notify("请填写至少 5 个字的申诉理由");
        return;
      }
      state.candidate.appealSubmitting = true;
      try {
        await request(`/api/candidate/session/${state.candidate.session.id}/appeal`, {
          method: "POST",
          headers: candidateAuthHeaders(),
          body: JSON.stringify({ reason }),
        });
        state.candidate.appealReason = "";
        await loadCandidateSession(state.candidate.session.id);
        notify("成绩申诉已提交");
      } catch (error) {
        notify(`申诉提交失败：${error.message}`);
      } finally {
        state.candidate.appealSubmitting = false;
      }
    }

    function startCandidateHeartbeat() {
      if (state.candidate.heartbeatTimer) clearInterval(state.candidate.heartbeatTimer);
      sendCandidateHeartbeat(document.visibilityState).catch(() => { });
      state.candidate.heartbeatTimer = setInterval(() => {
        sendCandidateHeartbeat(document.visibilityState).catch(() => { });
      }, 15000);
    }

    async function sendCandidateHeartbeat(visibility) {
      if (!state.candidate.session?.id || !state.candidate.access?.canSave) return;
      const signals = state.candidate.pendingSignals.splice(0, state.candidate.pendingSignals.length);
      const session = await request(`/api/candidate/session/${state.candidate.session.id}/heartbeat`, {
        method: "POST",
        headers: candidateAuthHeaders(),
        body: JSON.stringify({
          progress: candidateProgress.value,
          visibility,
          fullscreen: state.candidate.device.fullscreen,
          clipboard: state.candidate.device.clipboard,
          userAgent: navigator.userAgent,
          signals,
        }),
      });
      state.candidate.session = session;
      state.candidate.remainingSeconds = Math.max(0, Number(session.remainingMinutes || 0) * 60);
      if (session.device) state.candidate.device = { ...state.candidate.device, ...session.device };
      sendCandidateEvidenceSnapshot({ signals }).catch(() => { });
    }

    async function sendCandidateEvidenceSnapshot(options = {}) {
      if (!state.candidate.session?.id || !state.candidate.access?.canSave) return null;
      const now = Date.now();
      if (!options.force && now - Number(state.candidate.lastEvidenceAt || 0) < 60000) return null;
      const payload = {
        type: options.type || "device-snapshot",
        source: "candidate",
        progress: candidateProgress.value,
        visibility: document.visibilityState,
        device: { ...state.candidate.device },
        environment: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          screen: window.screen ? `${window.screen.width}x${window.screen.height}` : "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        },
        signals: options.signals || [],
      };
      const result = await request(`/api/candidate/session/${state.candidate.session.id}/evidence`, {
        method: "POST",
        headers: candidateAuthHeaders(),
        body: JSON.stringify(payload),
      });
      state.candidate.lastEvidenceAt = now;
      return result;
    }

    async function captureCandidateEvidenceAttachment(options = {}) {
      if (options.force) notify("摄像头和屏幕取证已暂时停用");
      state.candidate.evidenceAttachmentState = "已停用";
      return null;
    }

    function stopCandidateHeartbeat() {
      if (state.candidate.heartbeatTimer) {
        clearInterval(state.candidate.heartbeatTimer);
        state.candidate.heartbeatTimer = null;
      }
      stopCandidateMedia();
    }

    async function requestCandidateFullscreen() {
      try {
        await document.documentElement.requestFullscreen?.();
        state.candidate.device.fullscreen = document.fullscreenElement ? "active" : "exited";
      } catch {
        state.candidate.device.fullscreen = "exited";
        markCandidateSignal("全屏未开启", "中", "device");
      }
      await sendCandidateHeartbeat(document.visibilityState).catch(() => { });
      await sendCandidateEvidenceSnapshot({ force: true, type: "fullscreen" }).catch(() => { });
    }

    function markCandidateSignal(event, risk = "中", source = "signal") {
      state.candidate.pendingSignals.push({ event, risk, source });
    }

    function stopCandidateMedia() {
      state.candidate.evidenceAttachmentState = "已停用";
    }

    async function flushCandidateAutosave() {
      if (state.candidate.autosaveTimer) {
        clearTimeout(state.candidate.autosaveTimer);
        state.candidate.autosaveTimer = null;
      }
      if (state.candidate.saveState === "待保存") await saveCandidateDraft({ silent: true });
    }

    function persistCandidateDraft() {
      const key = candidateDraftKey();
      if (!key) return;
      localStorage.setItem(key, JSON.stringify({
        answers: state.candidate.answers,
        savedAt: new Date().toISOString(),
      }));
    }

    function restoreCandidateDraft(sessionId) {
      state.candidate.localDraftRestored = false;
      if (!state.candidate.access?.canSave) return;
      const key = candidateDraftKey(sessionId);
      if (!key) return;
      try {
        const draft = JSON.parse(localStorage.getItem(key) || "null");
        if (!draft?.answers || typeof draft.answers !== "object") return;
        const localCount = Object.keys(draft.answers).length;
        const remoteCount = Object.keys(state.candidate.answers || {}).length;
        if (localCount > remoteCount) {
          state.candidate.answers = draft.answers;
          state.candidate.saveState = "本地草稿待同步";
          state.candidate.localDraftRestored = true;
        }
      } catch { }
    }

    function retryCandidateDraftSave() {
      saveCandidateDraft().catch((error) => {
        handleCandidateAuthError(error);
        state.candidate.saveState = "保存失败";
        notify(`保存失败：${error.message}`);
      });
    }

    function updateCandidateCountdown() {
      const endsAt = state.candidate.access?.endsAt;
      const remaining = endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000)) : Number(state.candidate.session?.remainingMinutes || 0) * 60;
      state.candidate.remainingSeconds = Number.isFinite(remaining) ? remaining : 0;
      if (state.candidate.remainingSeconds <= 0 && state.candidate.access?.canSave) {
        state.candidate.access.canSave = false;
        state.candidate.access.canSubmit = false;
        state.candidate.access.message = "考试已结束，不能继续保存或提交";
        stopCandidateHeartbeat();
        if (!state.candidate.timeoutRefreshQueued && state.candidate.session?.id) {
          state.candidate.timeoutRefreshQueued = true;
          loadCandidateSession(state.candidate.session.id).catch(() => { });
        }
      }
    }

    function startCandidateCountdown() {
      stopCandidateCountdown();
      if (!state.candidate.session) return;
      state.candidate.countdownTimer = setInterval(() => {
        updateCandidateCountdown();
      }, 1000);
    }

    function stopCandidateCountdown() {
      if (state.candidate.countdownTimer) {
        clearInterval(state.candidate.countdownTimer);
        state.candidate.countdownTimer = null;
      }
    }

    function toggleCandidateMark(questionId) {
      const ids = new Set(state.candidate.markedQuestionIds);
      if (ids.has(questionId)) ids.delete(questionId);
      else ids.add(questionId);
      state.candidate.markedQuestionIds = [...ids];
    }

    function jumpToCandidateQuestion(questionId) {
      document.getElementById(`candidate-question-${questionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function candidateCardClass(question) {
      if (state.candidate.answers[question.id] !== undefined) return "bg-ink text-white";
      if (state.candidate.markedQuestionIds.includes(question.id)) return "bg-amber-100 text-amber-700 ring-1 ring-amber-200";
      return "bg-white text-slate-500 ring-1 ring-slate-200";
    }

    function submissionSourceText(source = "") {
      return {
        candidate: "考生提交",
        force: "监考收卷",
        "auto-timeout": "到时收卷",
      }[source] || "已提交";
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

    function exportProctorEvents() {
      const rows = proctorEvents.value.map((event, index) => {
        const session = findSessionForEvent(event);
        return {
          序号: index + 1,
          事件时间: formatDateTimeFull(event.createdAt),
          事件类型: proctorEventTypeText(event.type),
          处理状态: proctorEventStatus(event),
          参与者: event.candidate || session?.candidate || parseCandidateFromMessage(event.message) || "",
          编号: event.ticket || session?.ticket || "",
          会话ID: event.sessionId || session?.id || "",
          试卷: event.paperName || session?.paperName || session?.paper || "",
          当前风险: event.risk || session?.risk || "",
          事件内容: event.message || "",
        };
      });
      if (!rows.length) {
        notify("暂无可导出的风险记录");
        return;
      }
      downloadExcelTable("SmartQ 风险记录", rows, `smartq-risk-events-${dateStamp()}.xls`);
      notify(`已导出 ${rows.length} 条风险记录`);
    }

    function findSessionForEvent(event = {}) {
      if (event.sessionId) {
        const byId = sessions.value.find((session) => session.id === event.sessionId);
        if (byId) return byId;
      }
      const message = String(event.message || "");
      return sessions.value.find((session) => message.includes(session.id) || message.includes(session.candidate) || message.includes(session.ticket));
    }

    watch(documentTitle, (title) => {
      document.title = title;
    }, { immediate: true });

    onMounted(async () => {
      window.addEventListener("hashchange", () => {
        state.route = currentRoute();
        if (state.route !== "candidate" && state.admin.token && !canAccessRoute(state.route)) {
          state.route = "home";
          location.hash = "";
          notify("当前账号无权访问该模块");
        }
        state.authoringPaperId = currentAuthoringPaperId();
        state.candidate.sessionId = currentCandidateSessionId();
        state.editingPaperId = state.route === "authoring" && state.authoringPaperId ? state.authoringPaperId : null;
        if (state.route === "proctor") startProctorRefresh();
        else stopProctorRefresh();
        if (state.route === "papers") clearSelectedPaper();
        if (state.route === "candidate") {
          if (state.candidate.sessionId && state.candidate.authToken) loadCandidateSession(state.candidate.sessionId).catch((error) => notify(`考试会话加载失败：${error.message}`));
        }
        if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
          activatePaper(state.authoringPaperId, { silent: true }).catch(() => { });
        }
        mountIcons();
      });
      document.addEventListener("visibilitychange", () => {
        if (state.route === "candidate" && document.visibilityState === "hidden") {
          markCandidateSignal("离开考试页面", "中", "heartbeat");
          sendCandidateHeartbeat("hidden").catch(() => { });
        }
      });
      document.addEventListener("fullscreenchange", () => {
        if (state.route === "candidate" && state.candidate.session) {
          state.candidate.device.fullscreen = document.fullscreenElement ? "active" : "exited";
          if (!document.fullscreenElement) markCandidateSignal("退出全屏", "中", "device");
          sendCandidateHeartbeat(document.visibilityState).catch(() => { });
        }
      });
      document.addEventListener("copy", () => {
        if (state.route === "candidate" && state.candidate.session) {
          state.candidate.device.clipboard = "copy";
          markCandidateSignal("复制操作", "中", "clipboard");
          sendCandidateHeartbeat(document.visibilityState).catch(() => { });
        }
      });
      document.addEventListener("paste", () => {
        if (state.route === "candidate" && state.candidate.session) {
          state.candidate.device.clipboard = "paste";
          markCandidateSignal("粘贴操作", "中", "clipboard");
          sendCandidateHeartbeat(document.visibilityState).catch(() => { });
        }
      });
      if (state.route !== "candidate") {
        await loadAdminSession();
        await refresh();
      }
      else state.loading = false;
      if (state.route === "proctor") startProctorRefresh();
      if (state.route === "authoring" && state.authoringPaperId && state.dashboard?.paper?.id !== state.authoringPaperId) {
        await activatePaper(state.authoringPaperId, { silent: true });
      }
      if (state.route === "candidate") {
        if (state.candidate.authToken) await loadCandidateExams();
        if (state.candidate.sessionId) {
          await loadCandidateSession(state.candidate.sessionId);
        }
      }
    });

    return {
      state,
      navItems,
      visibleNavItems,
      adminPermissions,
      questions,
      authoringQuestions,
      authoringQuality,
      authoringReviewedCount,
      authoringPendingReviewCount,
      paper,
      quality,
      analysis,
      sessions,
      candidates,
      groups,
      papers,
      publishedPapers,
      paperRows,
      gradingQueue,
      gradingReviewQueue,
      filteredGradingReviewQueue,
      selectedReviewEntry,
      reviewedCount,
      pendingReviewCount,
      draftReady,
      formLocked,
      totalQuestionCount,
      workflowSteps,
      visibleWorkflowStep,
      dashboardCards,
      homePrimaryAction,
      quickActions,
      todos,
      recentPapers,
      proctorSummary,
      proctorEventSummary,
      filteredProctorSessions,
      filteredProctorEvents,
      selectedPendingProctorEvents,
      allFilteredPendingProctorEventsSelected,
      assignmentSummary,
      assignmentPaperCounts,
      hasAnalysisData,
      homeStatusRows,
      launchReadinessItems,
      backupRestorePreview,
      pagedGroups,
      groupTotalPages,
      allPagedGroupsSelected,
      selectedUsedGroups,
      filteredParticipants,
      pagedAssignments,
      assignmentTotalPages,
      allPagedAssignmentsSelected,
      proctorEvents,
      pagedParticipants,
      participantTotalPages,
      allPagedParticipantsSelected,
      viewingParticipantSessions,
      candidateAnsweredCount,
      candidateQuestionCount,
      candidateProgress,
      candidateMissingCount,
      candidateMarkedCount,
      candidateReadOnly,
      candidateRemainingText,
      refresh,
      go,
      hasAdminPermission,
      canAccessRoute,
      loginAdmin,
      logoutAdmin,
      runHomeAction,
      runQuickAction,
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
      selectReviewEntry,
      initReviewForm,
      reviewFormRow,
      submitReviewEntry,
      publishReviewEntry,
      resolveReviewAppeal,
      exportGradingResults,
      submitCandidate,
      openParticipantModal,
      closeParticipantModal,
      handleParticipantAvatar,
      previewParticipantAvatar,
      resetParticipantFilters,
      openParticipantImport,
      closeParticipantImport,
      previewParticipantImport,
      submitParticipantImport,
      resetParticipantPassword,
      toggleParticipantStatus,
      updateSelectedParticipants,
      participantSessionStats,
      toggleParticipantSelection,
      togglePagedParticipantSelection,
      changeParticipantPage,
      confirmDeleteParticipant,
      confirmDeleteSelectedParticipants,
      exportParticipants,
      submitGroup,
      openGroupModal,
      closeGroupModal,
      editGroup,
      resetGroupForm,
      groupParticipantCount,
      groupInUse,
      toggleGroupSelection,
      togglePagedGroupSelection,
      changeGroupPage,
      askDeleteGroup,
      confirmDeleteGroup,
      confirmDeleteSelectedGroups,
      exportGroups,
      loadStorageInfo,
      adapterStatusText,
      opsLevelClass,
      opsStatusText,
      loadAdminSessions,
      revokeAdminSession,
      loadAuditLog,
      exportAuditLog,
      downloadBackup,
      loadBackupHistory,
      downloadHistoricalBackup,
      restoreBackup,
      deleteCandidate,
      submitAssignment,
      openAssignmentModal,
      closeAssignmentModal,
      setAssignmentParticipant,
      viewAssignmentParticipant,
      toggleAssignmentSelection,
      togglePagedAssignmentSelection,
      changeAssignmentPage,
      askDeleteAssignment,
      confirmDeleteAssignment,
      confirmDeleteSelectedAssignments,
      exportAssignments,
      assignmentProgressText,
      assignmentRiskText,
      recordProctorRisk,
      resolveProctorEvent,
      toggleProctorEventSelection,
      toggleFilteredProctorEventSelection,
      resolveSelectedProctorEvents,
      saveProctorRules,
      openProctorDetail,
      loadProctorReport,
      exportProctorReport,
      downloadEvidenceAttachment,
      closeProctorDetail,
      runProctorControl,
      proctorEventStatus,
      proctorEventStatusClass,
      proctorSessionRiskClass,
      proctorOnlineClass,
      candidateSessionUrl,
      copyCandidateUrl,
      toastClass,
      toastIcon,
      fieldErrorClass,
      loginCandidate,
      logoutCandidate,
      changeCandidatePassword,
      loadCandidateExams,
      enterCandidateExam,
      backToCandidateExams,
      loadCandidateSession,
      updateCandidateAnswer,
      candidateAnswerSelected,
      candidateStatus,
      candidateStatusClass,
      candidateOptionClass,
      candidateOptionMarkClass,
      candidateCardClass,
      submissionSourceText,
      toggleCandidateMark,
      jumpToCandidateQuestion,
      retryCandidateDraftSave,
      saveCandidateDraft,
      requestCandidateFullscreen,
      captureCandidateEvidenceAttachment,
      submitCandidateExam,
      closeCandidateSubmitModal,
      confirmCandidateSubmit,
      submitCandidateAppeal,
      exportAnalysis,
      exportProctorEvents,
      typeClass,
      displayQuestionOptions,
      displayPaperStatus,
      workflowStatusText,
      formatDateTime,
      formatDateTimeWithYear,
      formatDateTimeFull,
      formatDateOnly,
      formatBytes,
      escapeHtml,
    };
  },
  template: `
    <main v-if="state.route === 'candidate'" :class="state.candidate.authToken ? 'min-h-screen w-full bg-slate-50 px-4 py-4 md:px-6' : 'min-h-screen w-full overflow-hidden bg-[#edf8f3]'">
      <header v-if="state.candidate.authToken" class="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-slate-50/95 backdrop-blur">
        <div class="min-w-0">
          <div class="text-sm font-black text-ink">{{ state.candidate.session ? (state.candidate.paper?.name || state.candidate.session?.paper || '考试') : '考生系统' }}</div>
          <div class="truncate text-xs font-semibold text-slate-500">
            {{ state.candidate.authUser?.candidate || '未登录' }}
            <span v-if="state.candidate.authUser"> · {{ state.candidate.authUser?.ticket || '-' }} · {{ state.candidate.authUser?.className || '未分组' }}</span>
            <span v-if="state.candidate.session"> · {{ state.candidate.session?.status || '-' }} · 剩余 {{ candidateRemainingText }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="state.candidate.session" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="backToCandidateExams">我的考试</button>
          <button v-if="state.candidate.authToken" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="logoutCandidate">退出</button>
        </div>
      </header>

      <section v-if="!state.candidate.authToken" class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
        <div class="absolute left-0 top-0 h-72 w-72 rounded-full bg-leaf/15 blur-3xl"></div>
        <div class="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-ocean/15 blur-3xl"></div>
        <div class="absolute left-[8%] top-[14%] hidden h-16 w-16 rotate-45 rounded-md border-[10px] border-leaf/25 lg:block"></div>
        <div class="absolute bottom-[12%] right-[10%] hidden h-20 w-20 rounded-full border-[12px] border-ocean/20 lg:block"></div>

        <div class="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-[0_30px_90px_rgba(18,32,31,0.16)] lg:min-h-[620px] lg:grid-cols-[1.05fr_0.95fr]">
          <div class="relative hidden items-center justify-center bg-[#f6fbf8] px-10 py-12 lg:flex">
            <div class="absolute left-0 top-0 h-full w-24 bg-gradient-to-b from-leaf/15 to-transparent"></div>
            <div class="relative">
              <div class="absolute -left-8 -top-8 h-28 w-28 rounded-full bg-leaf/10"></div>
              <div class="absolute -right-8 bottom-6 h-24 w-24 rounded-full bg-ocean/10"></div>
              <img src="/assets/candidate-login-illustration.png" alt="" class="relative z-10 w-full max-w-[520px] object-contain drop-shadow-[0_24px_34px_rgba(18,32,31,0.12)]" />
            </div>
          </div>

          <div class="flex min-h-[620px] items-center justify-center px-6 py-10 sm:px-10">
            <form novalidate class="w-full max-w-sm" @submit.prevent="loginCandidate">
              <div class="flex items-center gap-3">
                <span class="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 shadow-[0_12px_24px_rgba(22,167,115,0.25)] ring-1 ring-emerald-100">
                  <img src="/assets/favicon.svg" alt="SmartQ" class="h-full w-full object-contain" />
                </span>
                <span>
                  <span class="block text-xl font-black text-ink">SmartQ</span>
                  <span class="block text-xs font-bold text-slate-400">考生测评入口</span>
                </span>
              </div>
              <div class="mt-10 text-sm font-black text-leaf">欢迎回来</div>
              <h1 class="mt-2 text-4xl font-black text-ink">考生登录</h1>
              <div class="mt-3 text-sm font-semibold leading-6 text-slate-500">登录后查看已分配的考试，并在规定时间内完成作答。</div>

              <label class="mt-8 block text-xs font-black text-slate-500">手机号
                <div class="mt-2 flex h-12 items-center gap-3 rounded-lg border bg-white px-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition" :class="state.candidate.loginErrors.loginPhone ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200 focus-within:border-leaf focus-within:ring-2 focus-within:ring-emerald-100'">
                  <i data-lucide="smartphone" class="h-4 w-4 text-leaf"></i>
                  <input v-model="state.candidate.loginPhone" autocomplete="username" class="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none" placeholder="请输入手机号" />
                </div>
                <div :class="fieldErrorClass(state.candidate.loginErrors.loginPhone)">{{ state.candidate.loginErrors.loginPhone || '' }}</div>
              </label>

              <label class="mt-4 block text-xs font-black text-slate-500">密码
                <div class="mt-2 flex h-12 items-center gap-3 rounded-lg border bg-white px-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition" :class="state.candidate.loginErrors.loginPassword ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200 focus-within:border-leaf focus-within:ring-2 focus-within:ring-emerald-100'">
                  <i data-lucide="lock-keyhole" class="h-4 w-4 text-leaf"></i>
                  <input v-model="state.candidate.loginPassword" type="password" autocomplete="current-password" class="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none" placeholder="请输入密码" />
                </div>
                <div :class="fieldErrorClass(state.candidate.loginErrors.loginPassword)">{{ state.candidate.loginErrors.loginPassword || '' }}</div>
              </label>

              <div v-if="state.candidate.loginErrors.form" class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-coral">
                {{ state.candidate.loginErrors.form }}
              </div>
              <button type="submit" class="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-leaf text-sm font-black text-white shadow-[0_16px_28px_rgba(22,167,115,0.24)] transition hover:bg-[#128a61] disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.candidate.loginLoading">
                <i data-lucide="log-in" class="h-4 w-4"></i>
                {{ state.candidate.loginLoading ? '登录中' : '登录' }}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section v-else-if="state.candidate.authUser?.passwordMustChange" class="flex min-h-[calc(100vh-88px)] items-center justify-center">
        <form novalidate class="w-full max-w-md rounded-lg border border-amber-200 bg-white p-6 shadow-soft" @submit.prevent="changeCandidatePassword">
          <div class="text-sm font-bold text-honey">首次登录</div>
          <h1 class="mt-2 text-3xl font-black">修改登录密码</h1>
          <div class="mt-1 text-sm font-semibold text-slate-500">默认密码更新后才能继续考试</div>
          <label class="mt-6 block text-xs font-bold text-slate-600">当前密码
            <input v-model="state.candidate.currentPassword" type="password" autocomplete="current-password" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidate.passwordErrors.currentPassword ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" />
            <div :class="fieldErrorClass(state.candidate.passwordErrors.currentPassword)">{{ state.candidate.passwordErrors.currentPassword || '' }}</div>
          </label>
          <label class="mt-4 block text-xs font-bold text-slate-600">新密码
            <input v-model="state.candidate.newPassword" type="password" autocomplete="new-password" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidate.passwordErrors.newPassword ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" />
            <div :class="fieldErrorClass(state.candidate.passwordErrors.newPassword)">{{ state.candidate.passwordErrors.newPassword || '' }}</div>
          </label>
          <button type="submit" class="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.candidate.passwordLoading">
            {{ state.candidate.passwordLoading ? '更新中' : '更新密码' }}
          </button>
        </form>
      </section>

      <section v-else-if="!state.candidate.session" class="mx-auto mt-6 max-w-6xl space-y-5">
        <div class="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 class="text-2xl font-black">我的考试</h1>
            <div class="mt-1 text-sm font-semibold text-slate-500">查看当前账号已分配的考试</div>
          </div>
          <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="loadCandidateExams">刷新</button>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="text-xs font-bold text-ocean">考生信息</div>
              <div class="mt-1 text-xl font-black text-ink">{{ state.candidate.authUser?.candidate || '-' }}</div>
            </div>
            <div class="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <div>
                <div class="text-xs font-bold text-slate-500">准考证号</div>
                <div class="mt-1 font-black text-ink">{{ state.candidate.authUser?.ticket || '-' }}</div>
              </div>
              <div>
                <div class="text-xs font-bold text-slate-500">分组</div>
                <div class="mt-1 font-black text-ink">{{ state.candidate.authUser?.className || '未分组' }}</div>
              </div>
              <div>
                <div class="text-xs font-bold text-slate-500">手机号</div>
                <div class="mt-1 font-black text-ink">{{ state.candidate.authUser?.phone || '-' }}</div>
              </div>
              <div>
                <div class="text-xs font-bold text-slate-500">邮箱</div>
                <div class="mt-1 truncate font-black text-ink">{{ state.candidate.authUser?.email || '-' }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div v-for="exam in state.candidate.exams" :key="exam.id" class="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-base font-black text-ink">{{ exam.paperName }}</div>
                <div class="mt-1 text-xs font-semibold text-slate-500">{{ formatDateTimeFull(exam.startTime) || exam.startTime }} - {{ formatDateTimeFull(exam.endTime) || exam.endTime }}</div>
              </div>
              <span class="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{{ exam.displayStatus || exam.status }}</span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div class="rounded bg-slate-50 p-2"><div class="font-black">{{ exam.progress || 0 }}%</div><div class="text-xs font-bold text-slate-500">进度</div></div>
              <div class="rounded bg-slate-50 p-2"><div class="font-black">{{ exam.canReview ? (exam.resultPublished ? '已发布' : '待发布') : (exam.remainingMinutes ?? '-') }}</div><div class="text-xs font-bold text-slate-500">{{ exam.canReview ? '成绩' : '剩余分钟' }}</div></div>
            </div>
            <div v-if="!exam.canEnter" class="mt-3 rounded bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{{ exam.message }}</div>
            <button class="mt-4 flex h-10 w-full items-center justify-center rounded-lg bg-ink text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300" :disabled="!exam.canEnter || state.candidate.loading" @click="enterCandidateExam(exam.id)">
              {{ exam.canReview ? '查看答卷' : '进入考试' }}
            </button>
          </div>
          <div v-if="!state.candidate.exams.length" class="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm font-bold text-slate-500 md:col-span-2 xl:col-span-3">暂无已分配考试</div>
        </div>
      </section>

      <section v-else class="mt-4 grid grid-cols-1 items-start gap-5 pb-8 xl:grid-cols-[1fr_360px]">
        <div class="space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 class="text-2xl font-black">{{ state.candidate.exam?.title || '考试加载中' }}</h1>
                <button class="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="backToCandidateExams">
                  <i data-lucide="arrow-left" class="h-4 w-4"></i>
                  返回我的考试
                </button>
                <div class="mt-3 flex flex-wrap gap-2 text-sm font-semibold text-slate-600">
                  <span class="rounded bg-slate-100 px-3 py-1.5">参与者：{{ state.candidate.session?.candidate || '-' }}</span>
                  <span class="rounded bg-slate-100 px-3 py-1.5">编号：{{ state.candidate.session?.ticket || '-' }}</span>
                  <span class="rounded bg-slate-100 px-3 py-1.5">分组：{{ state.candidate.session?.className || state.candidate.authUser?.className || '未分组' }}</span>
                  <span class="rounded bg-slate-100 px-3 py-1.5">手机号：{{ state.candidate.session?.phone || state.candidate.authUser?.phone || '-' }}</span>
                  <span class="rounded bg-slate-100 px-3 py-1.5">试卷：{{ state.candidate.paper?.name || state.candidate.session?.paper || '-' }}</span>
                  <span class="rounded bg-slate-100 px-3 py-1.5">总分：{{ state.candidate.paper?.score || state.candidate.exam?.totalScore || 0 }}</span>
                </div>
              </div>
              <div class="grid min-w-[320px] grid-cols-4 gap-2">
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div class="text-lg font-black">{{ candidateQuestionCount }}</div><div class="text-xs font-semibold text-slate-500">题目</div></div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div class="text-lg font-black text-leaf">{{ candidateAnsweredCount }}</div><div class="text-xs font-semibold text-slate-500">已答</div></div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div class="text-lg font-black text-honey">{{ candidateProgress }}%</div><div class="text-xs font-semibold text-slate-500">进度</div></div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div class="text-lg font-black text-coral">{{ candidateRemainingText }}</div><div class="text-xs font-semibold text-slate-500">剩余</div></div>
              </div>
            </div>
            <div class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              {{ state.candidate.access?.message || '离开考试页面会被记录为风险事件。' }}
            </div>
            <div v-if="state.candidate.access?.compliance && !state.candidate.access.compliance.ok" class="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-coral">
              提交前需完成：{{ state.candidate.access.compliance.failures.join('、') }}
            </div>
            <div class="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600 md:grid-cols-[1fr_auto]">
              <div class="grid grid-cols-2 gap-2 md:grid-cols-2">
                <span class="rounded bg-white px-3 py-2">全屏：{{ state.candidate.device.fullscreen }}</span>
                <span class="rounded bg-white px-3 py-2">剪贴板：{{ state.candidate.device.clipboard }}</span>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <button class="rounded bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200" @click="requestCandidateFullscreen">全屏</button>
              </div>
            </div>
            <div v-if="state.candidate.session?.messages?.length" class="mt-4 space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm font-semibold text-ocean">
              <div class="font-black">监考消息</div>
              <div v-for="message in state.candidate.session.messages" :key="message.id" class="rounded bg-white/80 px-3 py-2">{{ message.message }}</div>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white shadow-soft">
            <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 class="text-lg font-black">{{ state.candidate.grading ? '答卷详情' : '试卷内容' }}</h2>
              <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="loadCandidateSession(state.candidate.sessionId)">
                <i data-lucide="refresh-cw" class="h-4 w-4"></i>
                刷新
              </button>
            </div>
            <div v-if="state.candidate.localDraftRestored" class="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              已恢复本地未同步草稿，请确认后继续作答或手动保存。
            </div>
            <div v-if="state.candidate.gradingStatus && !state.candidate.grading" class="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              {{ state.candidate.gradingStatus.message || '成绩暂未发布' }}
            </div>
            <div class="divide-y divide-slate-100 px-5">
              <article v-for="(question, index) in state.candidate.questions" :key="question.id" :id="'candidate-question-' + question.id" class="scroll-mt-20 py-5">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-sm font-black">{{ index + 1 }}. {{ question.type }}题 <span class="ml-2 text-slate-400">{{ question.score }} 分</span></div>
                    <p class="mt-3 text-base font-semibold">{{ question.stem }}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <button type="button" class="rounded px-2 py-1 text-xs font-bold" :class="state.candidate.markedQuestionIds.includes(question.id) ? 'bg-amber-100 text-amber-700' : 'bg-white text-slate-500 ring-1 ring-slate-200'" @click="toggleCandidateMark(question.id)">
                      {{ state.candidate.markedQuestionIds.includes(question.id) ? '取消标记' : '标记' }}
                    </button>
                    <span class="rounded px-2 py-1 text-xs font-bold" :class="candidateStatusClass(question)">{{ candidateStatus(question) }}</span>
                  </div>
                </div>
                <div v-if="['单选','多选'].includes(question.type)" class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label v-for="(option, optionIndex) in question.options" :key="optionIndex" class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-semibold" :class="candidateOptionClass(question, String.fromCharCode(65 + optionIndex))">
                    <input class="sr-only" :type="question.type === '多选' ? 'checkbox' : 'radio'" :name="question.id" :value="String.fromCharCode(65 + optionIndex)" :checked="candidateAnswerSelected(question.id, String.fromCharCode(65 + optionIndex))" :disabled="candidateReadOnly" @change="updateCandidateAnswer(question, String.fromCharCode(65 + optionIndex), $event.target.checked)" />
                    <span class="flex h-6 w-6 items-center justify-center" :class="candidateOptionMarkClass(question, String.fromCharCode(65 + optionIndex))">{{ String.fromCharCode(65 + optionIndex) }}</span>
                    {{ option }}
                  </label>
                </div>
                <div v-else-if="question.type === '判断'" class="mt-4 flex gap-3">
                  <label v-for="value in ['正确','错误']" :key="value" class="flex w-36 cursor-pointer items-center justify-center rounded-lg border p-3 text-sm font-black" :class="candidateAnswerSelected(question.id, value) ? 'border-leaf bg-emerald-50 text-leaf' : 'border-slate-200 bg-white text-slate-500'">
                    <input class="sr-only" type="radio" :name="question.id" :value="value" :checked="candidateAnswerSelected(question.id, value)" :disabled="candidateReadOnly" @change="updateCandidateAnswer(question, value, true)" />
                    {{ value }}
                  </label>
                </div>
                <input v-else-if="question.type === '填空'" class="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-ocean focus:bg-white disabled:opacity-80" :value="state.candidate.answers[question.id] || ''" :disabled="candidateReadOnly" placeholder="请输入答案" @input="updateCandidateAnswer(question, $event.target.value, true)" />
                <textarea v-else class="mt-4 min-h-28 w-full resize-y rounded-lg border p-4 text-sm font-semibold leading-6 text-slate-700 outline-none focus:border-ocean focus:bg-white disabled:opacity-80" :class="state.candidate.answers[question.id] !== undefined ? 'border-ocean bg-cyan-50' : 'border-slate-200 bg-slate-50'" :value="state.candidate.answers[question.id] || ''" :disabled="candidateReadOnly" placeholder="请输入作答内容" @input="updateCandidateAnswer(question, $event.target.value, true)"></textarea>
                <div v-if="state.candidate.grading?.details?.find((item) => item.questionId === question.id)" class="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                  得分 {{ state.candidate.grading.details.find((item) => item.questionId === question.id).awarded }} / {{ question.score }} · {{ state.candidate.grading.details.find((item) => item.questionId === question.id).status }}
                </div>
              </article>
            </div>
          </div>
        </div>
        <aside class="sticky top-20 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-black">答题卡</h2>
              <span class="rounded bg-cyan-50 px-2.5 py-1 text-xs font-black text-ocean">一页试卷</span>
            </div>
            <div class="mt-4 grid grid-cols-6 gap-2">
              <button v-for="(question, index) in state.candidate.questions" :key="question.id" class="h-10 rounded-lg text-sm font-black" :class="candidateCardClass(question)" @click="jumpToCandidateQuestion(question.id)">{{ index + 1 }}</button>
            </div>
            <div class="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-bold">
              <div class="rounded bg-ink px-2 py-2 text-white">已答 {{ candidateAnsweredCount }}</div>
              <div class="rounded bg-white px-2 py-2 text-slate-500 ring-1 ring-slate-200">未答 {{ candidateMissingCount }}</div>
              <div class="rounded bg-amber-100 px-2 py-2 text-amber-700">标记 {{ candidateMarkedCount }}</div>
            </div>
            <div class="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div class="flex items-center justify-between text-sm font-black"><span>保存状态</span><span class="text-leaf">{{ state.candidate.saveState }}</span></div>
              <button v-if="state.candidate.saveState === '保存失败' || state.candidate.saveState === '本地草稿待同步'" class="mt-3 flex h-10 w-full items-center justify-center rounded-lg bg-ink text-sm font-black text-white" @click="retryCandidateDraftSave">重试保存</button>
            </div>
            <button class="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.candidate.access?.canSave" @click="saveCandidateDraft">
              <i data-lucide="save" class="h-4 w-4"></i>
              保存草稿
            </button>
            <button class="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300" :class="state.candidate.access?.canSubmit ? 'bg-ink' : 'bg-slate-300'" :disabled="!state.candidate.access?.canSubmit || state.candidate.submitting" @click="submitCandidateExam">
              <i data-lucide="send" class="h-4 w-4"></i>
              {{ state.candidate.submitting ? '提交中' : '提交试卷' }}
            </button>
            <div v-if="state.candidate.grading" class="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
              {{ submissionSourceText(state.candidate.session?.submissionSource || state.candidate.grading.submissionSource) }} · 正式成绩 {{ state.candidate.grading.totalScore }} / {{ state.candidate.grading.maxScore }} · {{ state.candidate.grading.reviewStatus }} · {{ state.candidate.grading.publishStatus }}
              <div class="mt-3 rounded bg-white/80 px-3 py-2 text-xs font-bold text-slate-600">申诉状态：{{ state.candidate.gradingStatus?.appealStatus || '无申诉' }}</div>
              <div v-if="state.candidate.gradingStatus?.latestAppeal?.resolution" class="mt-2 rounded bg-white/80 px-3 py-2 text-xs font-bold text-slate-600">处理说明：{{ state.candidate.gradingStatus.latestAppeal.resolution }}</div>
              <div v-if="state.candidate.gradingStatus?.appealStatus !== '待处理'" class="mt-3 space-y-2">
                <textarea v-model="state.candidate.appealReason" rows="3" class="w-full resize-y rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-ink" placeholder="如对成绩有疑问，请填写申诉理由"></textarea>
                <button class="flex h-9 w-full items-center justify-center rounded-lg bg-emerald-700 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.candidate.appealSubmitting" @click="submitCandidateAppeal">{{ state.candidate.appealSubmitting ? '提交中' : '提交成绩申诉' }}</button>
              </div>
            </div>
            <div v-else-if="state.candidate.gradingStatus" class="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              {{ state.candidate.gradingStatus.message || '成绩暂未发布' }}
            </div>
          </div>
        </aside>
      </section>

      <div v-if="state.candidate.submitModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <h2 class="text-lg font-black">确认提交试卷</h2>
          <div class="mt-3 space-y-2 text-sm font-semibold text-slate-600">
            <div class="flex justify-between"><span>已答题目</span><span>{{ candidateAnsweredCount }} / {{ candidateQuestionCount }}</span></div>
            <div class="flex justify-between"><span>未答题目</span><span class="text-coral">{{ candidateMissingCount }}</span></div>
            <div class="flex justify-between"><span>标记题目</span><span class="text-honey">{{ candidateMarkedCount }}</span></div>
            <div class="flex justify-between"><span>保存状态</span><span>{{ state.candidate.saveState }}</span></div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeCandidateSubmitModal">取消</button>
            <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50" :disabled="state.candidate.submitting" @click="confirmCandidateSubmit">{{ state.candidate.submitting ? '提交中' : '确认提交' }}</button>
          </div>
        </div>
      </div>
    </main>

    <main v-else :class="state.admin.token ? 'min-h-screen w-full px-8 py-6' : 'min-h-screen w-full overflow-hidden bg-[#f2f5fa]'">
      <header v-if="state.admin.token" class="flex h-16 items-center justify-between rounded-lg border border-slate-200/80 bg-white/90 px-5 shadow-soft backdrop-blur">
        <button class="flex items-center gap-4 text-left" @click="go('home')">
          <span class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 ring-1 ring-slate-200">
            <img src="/assets/favicon.svg" alt="SmartQ" class="h-full w-full object-contain" />
          </span>
          <span>
            <span class="block text-lg font-black">SmartQ</span>
            <span class="block text-xs font-medium text-slate-500">通用考试 / 测评平台</span>
          </span>
        </button>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <div v-if="state.admin.token" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
            {{ state.admin.user?.username || state.admin.username }}
          </div>
          <button
            v-if="state.admin.token"
            v-for="item in visibleNavItems"
            :key="item.key"
            class="rounded-lg px-3 py-2 text-sm font-bold"
            :class="state.route === item.key ? 'bg-ink text-white' : 'border border-slate-200 bg-white text-slate-700'"
            @click="go(item.key)"
          >
            {{ item.label }}
          </button>
          <button v-if="state.admin.token" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="logoutAdmin">退出</button>
        </div>
      </header>

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
                  <img src="/assets/favicon.svg" alt="SmartQ" class="h-full w-full object-contain" />
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
                  面向考试运营、AI 命题、监考风控与阅卷分析的一体化控制台，让每一次测评都清晰、稳定、可追踪。
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

      <div v-else-if="state.loading && !state.dashboard" class="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500 shadow-soft">
        控制台数据加载中...
      </div>
      <div v-else-if="state.dashboardError && !state.dashboard" class="mt-6 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-coral shadow-soft">
        <span>{{ state.dashboardError }}</span>
        <button class="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-black text-coral" @click="refresh">重试</button>
      </div>

      <template v-else>
        <section v-if="state.route === 'home'" class="mt-6 space-y-5">
          <div v-if="state.dashboardError" class="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-coral">
            <span>{{ state.dashboardError }}</span>
            <button class="rounded border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-coral" @click="refresh">重试</button>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div class="text-sm font-bold text-ocean">{{ state.dashboard.exam.title }}</div>
                <h1 class="mt-2 text-3xl font-black tracking-normal">控制台首页</h1>
                <div class="mt-2 text-sm font-semibold text-slate-500">总览考试运营、待办、监考风险与阅卷分析</div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="runHomeAction(homePrimaryAction)">
                  <i :data-lucide="homePrimaryAction.icon" class="h-4 w-4"></i>
                  {{ homePrimaryAction.label }}
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="refresh">
                  <i data-lucide="refresh-cw" class="h-4 w-4"></i>
                  刷新
                </button>
              </div>
            </div>
            <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div v-for="card in dashboardCards" :key="card.label" class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-center justify-between">
                  <div :class="['text-2xl font-black', card.tone]">{{ card.value }}</div>
                  <i :data-lucide="card.icon" class="h-4 w-4 text-slate-400"></i>
                </div>
                <div class="mt-2 text-xs font-bold text-slate-500">{{ card.label }}</div>
                <div class="mt-1 text-xs font-semibold text-slate-400">{{ card.meta }}</div>
              </div>
            </div>
            <div class="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <div v-for="item in homeStatusRows" :key="item.label" class="rounded-lg bg-white px-4 py-3 ring-1 ring-slate-100">
                <div :class="['text-xl font-black', item.tone]">{{ item.value }}</div>
                <div class="mt-1 text-xs font-bold text-slate-500">{{ item.label }}</div>
              </div>
            </div>
          </div>

          <div class="space-y-5">
              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <div class="flex items-center justify-between">
                  <h2 class="text-lg font-black">待办事项</h2>
                  <span class="rounded bg-cyan-50 px-2 py-1 text-xs font-black text-ocean">{{ todos.length }} 项</span>
                </div>
                <div class="mt-4 space-y-3">
                  <div v-if="!todos.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-bold text-slate-500">暂无紧急待办，当前运营状态稳定</div>
                  <div v-for="todo in todos" :key="todo.title" class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                      <div class="text-sm font-black">{{ todo.title }}</div>
                      <div class="mt-1 text-xs font-semibold text-slate-500">{{ todo.desc }}</div>
                    </div>
                    <button class="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white" @click="go(todo.route, todo.params || {})">{{ todo.action }}</button>
                  </div>
                </div>
              </section>

              <section v-if="hasAdminPermission('system')" class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <div class="flex items-center justify-between">
                  <h2 class="text-lg font-black">近期试卷</h2>
                  <button class="text-sm font-black text-ocean" @click="go('papers')">管理</button>
                </div>
                <div class="mt-4 space-y-2">
                  <div v-if="!recentPapers.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">暂无试卷，先新建出题任务</div>
                  <div v-for="item in recentPapers" :key="item.id || item.name" class="grid grid-cols-[minmax(0,1fr)_72px_72px_82px] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <div class="truncate font-black">{{ item.name || '未命名试卷' }}</div>
                    <div class="font-bold text-slate-600">{{ item.questionCount || 0 }} 题</div>
                    <div class="font-bold text-slate-600">{{ item.score || 0 }} 分</div>
                    <div class="text-right text-xs font-black text-ocean">{{ displayPaperStatus(item.status) }}</div>
                  </div>
                </div>
              </section>

              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <div class="flex items-center justify-between">
                  <h2 class="text-lg font-black">试卷分配概览</h2>
                  <button class="text-sm font-black text-ocean" @click="go('assignments')">分配</button>
                </div>
                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                  <div v-for="item in assignmentPaperCounts.slice(0, 4)" :key="item.paperId || item.paperName" class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="truncate text-sm font-black">{{ item.paperName }}</div>
                    <div class="mt-2 text-xs font-semibold text-slate-500">已分配 {{ item.assigned }} · 答题中 {{ item.active }} · 已提交 {{ item.submitted }}</div>
                  </div>
                  <div v-if="!assignmentPaperCounts.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500 sm:col-span-2">暂无试卷分配</div>
                </div>
              </section>
              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <h2 class="text-lg font-black">快捷操作</h2>
                <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <button v-for="action in quickActions" :key="action.label" class="flex items-center gap-3 rounded-lg border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60" :class="action.primary ? 'border-ink bg-ink text-white' : 'border-slate-200 bg-white text-slate-700'" :disabled="action.disabled" @click="runQuickAction(action)">
                    <i :data-lucide="action.icon" class="h-4 w-4 shrink-0"></i>
                    <span class="min-w-0">
                      <span class="block text-sm font-black">{{ action.label }}</span>
                      <span class="mt-1 block truncate text-xs font-semibold" :class="action.primary ? 'text-white/75' : 'text-slate-500'">{{ action.desc }}</span>
                    </span>
                  </button>
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
                  <div v-if="!proctorSummary.latest.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">暂无监考风险</div>
                  <div v-for="item in proctorSummary.latest" :key="item.id" class="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2 text-sm">
                    <span class="min-w-0">
                      <span class="block truncate font-bold">{{ item.candidate }}</span>
                      <span class="mt-1 block truncate text-xs font-semibold text-slate-500">{{ item.displayStatus || item.status }}</span>
                    </span>
                    <span class="shrink-0 text-xs font-black text-coral">{{ item.risk }}</span>
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
                  <div v-if="!hasAnalysisData" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">暂无提交数据</div>
                  <div v-for="item in (analysis.knowledge || []).slice(0, 3)" :key="item.name" class="grid grid-cols-[90px_1fr_42px] items-center gap-3 text-sm">
                    <span class="font-bold">{{ item.name }}</span>
                    <span class="h-2 rounded-full bg-slate-100"><span class="block h-2 rounded-full bg-ocean" :style="{ width: item.score + '%' }"></span></span>
                    <span class="text-right font-black">{{ item.score }}</span>
                  </div>
                </div>
              </section>

              <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 class="text-lg font-black">数据维护</h2>
                    <div class="mt-1 text-xs font-semibold text-slate-500">运行时数据备份、恢复与存储状态</div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.storageLoading" @click="loadStorageInfo">
                      <i data-lucide="refresh-cw" class="h-4 w-4"></i>
                      {{ state.storageLoading ? '刷新中' : '刷新状态' }}
                    </button>
                    <button class="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.backupDownloading" @click="downloadBackup">
                      <i data-lucide="download" class="h-4 w-4"></i>
                      {{ state.backupDownloading ? '导出中' : '下载备份' }}
                    </button>
                  </div>
                </div>
                <div class="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <button v-for="item in launchReadinessItems" :key="item.label" type="button" class="grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left" @click="go(item.route)">
                    <span class="h-2.5 w-2.5 rounded-full" :class="item.status === 'ready' ? 'bg-leaf' : item.status === 'optimize' ? 'bg-honey' : 'bg-coral'"></span>
                    <span class="min-w-0">
                      <span class="block truncate text-xs font-black text-ink">{{ item.label }}</span>
                      <span class="mt-1 block truncate text-[11px] font-semibold text-slate-500">{{ item.detail }}</span>
                    </span>
                  </button>
                </div>
                <div class="mt-4 grid gap-3 xl:grid-cols-[360px_1fr]">
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <h3 class="text-sm font-black text-ink">运维状态</h3>
                        <div class="mt-1 text-xs font-semibold text-slate-500">{{ state.opsSnapshot?.generatedAt ? formatDateTimeFull(state.opsSnapshot.generatedAt) : '等待刷新' }}</div>
                      </div>
                      <span class="rounded px-2 py-1 text-xs font-black" :class="opsLevelClass(state.opsSnapshot?.status === 'ok' ? 'info' : state.opsSnapshot?.status)">{{ opsStatusText(state.opsSnapshot?.status) }}</span>
                    </div>
                    <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div class="rounded bg-white px-2 py-2"><div class="font-black text-ink">{{ state.opsSnapshot?.metrics?.pendingRiskEvents || 0 }}</div><div class="mt-1 font-semibold text-slate-500">待处理风险</div></div>
                      <div class="rounded bg-white px-2 py-2"><div class="font-black text-ink">{{ state.opsSnapshot?.metrics?.subjectivePending || 0 }}</div><div class="mt-1 font-semibold text-slate-500">待复核</div></div>
                      <div class="rounded bg-white px-2 py-2"><div class="font-black text-ink">{{ state.opsSnapshot?.metrics?.backupCount || 0 }}</div><div class="mt-1 font-semibold text-slate-500">备份</div></div>
                    </div>
                  </div>
                  <div class="rounded-lg border border-slate-200 bg-white p-4">
                    <div class="flex items-center justify-between gap-3">
                      <h3 class="text-sm font-black text-ink">运维告警</h3>
                      <span class="text-xs font-bold text-slate-500">{{ state.opsSnapshot?.alerts?.length || 0 }} 条</span>
                    </div>
                    <div class="mt-3 grid gap-2 lg:grid-cols-2">
                      <div v-if="!state.opsSnapshot?.alerts?.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-bold text-slate-500">暂无告警</div>
                      <div v-for="alert in state.opsSnapshot?.alerts || []" :key="alert.id" class="rounded-lg px-3 py-3 text-sm" :class="opsLevelClass(alert.level)">
                        <div class="font-black">{{ alert.title }}</div>
                        <div class="mt-1 text-xs font-semibold opacity-80">{{ alert.detail }}</div>
                      </div>
                    </div>
                    <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      <div v-for="check in state.opsSnapshot?.checks || []" :key="check.name" class="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <div class="flex items-center justify-between gap-2">
                          <span class="font-black text-ink">{{ check.name }}</span>
                          <span class="font-black" :class="check.ok ? 'text-leaf' : 'text-honey'">{{ check.status }}</span>
                        </div>
                        <div class="mt-1 truncate font-semibold text-slate-500">{{ check.detail }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">存储适配器</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ state.storageInfo?.effectiveAdapter || state.storageInfo?.adapter || '未加载' }}</div>
                    <div class="mt-1 truncate text-[11px] font-semibold text-slate-500">请求 {{ state.storageInfo?.requestedAdapter || '-' }}</div>
                  </div>
                  <div class="rounded-lg px-4 py-3" :class="state.storageInfo?.degraded ? 'bg-amber-50' : 'bg-slate-50'">
                    <div class="text-xs font-bold" :class="state.storageInfo?.degraded ? 'text-amber-700' : 'text-slate-500'">存储状态</div>
                    <div class="mt-1 truncate text-sm font-black" :class="state.storageInfo?.degraded ? 'text-amber-800' : 'text-ink'">{{ state.storageInfo?.degraded ? '已降级' : '正常' }}</div>
                    <div class="mt-1 truncate text-[11px] font-semibold text-slate-500">{{ adapterStatusText(state.storageInfo?.status) }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">在线状态</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ state.systemHealth?.proctor?.effectivePresenceAdapter || state.systemHealth?.proctor?.presenceAdapter || '未加载' }}</div>
                    <div class="mt-1 truncate text-[11px] font-semibold text-slate-500">请求 {{ state.systemHealth?.proctor?.requestedPresenceAdapter || '-' }}</div>
                  </div>
                  <div class="rounded-lg px-4 py-3" :class="state.systemHealth?.proctor?.presenceDegraded ? 'bg-amber-50' : 'bg-slate-50'">
                    <div class="text-xs font-bold" :class="state.systemHealth?.proctor?.presenceDegraded ? 'text-amber-700' : 'text-slate-500'">在线状态存储</div>
                    <div class="mt-1 truncate text-sm font-black" :class="state.systemHealth?.proctor?.presenceDegraded ? 'text-amber-800' : 'text-ink'">{{ state.systemHealth?.proctor?.presenceDegraded ? '已降级' : '正常' }}</div>
                    <div class="mt-1 truncate text-[11px] font-semibold text-slate-500">{{ adapterStatusText(state.systemHealth?.proctor?.presenceStatus) }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">证据存储</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ state.systemHealth?.evidence?.effectiveAdapter || state.systemHealth?.evidence?.adapter || '未加载' }}</div>
                    <div class="mt-1 truncate text-[11px] font-semibold text-slate-500">请求 {{ state.systemHealth?.evidence?.requestedAdapter || '-' }}</div>
                  </div>
                  <div class="rounded-lg px-4 py-3" :class="state.systemHealth?.evidence?.degraded ? 'bg-amber-50' : 'bg-slate-50'">
                    <div class="text-xs font-bold" :class="state.systemHealth?.evidence?.degraded ? 'text-amber-700' : 'text-slate-500'">证据状态</div>
                    <div class="mt-1 truncate text-sm font-black" :class="state.systemHealth?.evidence?.degraded ? 'text-amber-800' : 'text-ink'">{{ state.systemHealth?.evidence?.degraded ? '已降级' : '正常' }}</div>
                    <div class="mt-1 truncate text-[11px] font-semibold text-slate-500">{{ adapterStatusText(state.systemHealth?.evidence?.status) }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">数据文件</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ state.storageInfo?.exists ? '已创建' : '未创建' }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">文件大小</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ formatBytes(state.storageInfo?.sizeBytes || 0) }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">更新时间</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ state.storageInfo?.updatedAt ? formatDateTimeFull(state.storageInfo.updatedAt) : '-' }}</div>
                  </div>
                  <div class="rounded-lg bg-slate-50 px-4 py-3">
                    <div class="text-xs font-bold text-slate-500">自动备份</div>
                    <div class="mt-1 truncate text-sm font-black text-ink">{{ state.storageInfo?.backupCount || 0 }} 份</div>
                  </div>
                </div>
                <div class="mt-4 grid gap-3 lg:grid-cols-[1fr_280px]">
                  <label class="block text-xs font-bold text-slate-600">
                    恢复备份 JSON
                    <textarea v-model="state.backupRestoreText" rows="6" class="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-ink" placeholder="{ &quot;version&quot;: 1, &quot;state&quot;: { ... } }"></textarea>
                  </label>
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div class="text-xs font-black text-slate-500">恢复预览</div>
                    <div v-if="!backupRestorePreview" class="mt-3 text-sm font-semibold text-slate-500">粘贴备份后显示统计</div>
                    <div v-else-if="!backupRestorePreview.valid" class="mt-3 rounded bg-rose-50 px-3 py-2 text-xs font-bold text-coral">{{ backupRestorePreview.error }}</div>
                    <div v-else class="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                      <div class="rounded bg-white px-2 py-2">题目 {{ backupRestorePreview.questions }}</div>
                      <div class="rounded bg-white px-2 py-2">试卷 {{ backupRestorePreview.papers }}</div>
                      <div class="rounded bg-white px-2 py-2">参与者 {{ backupRestorePreview.participants }}</div>
                      <div class="rounded bg-white px-2 py-2">考试 {{ backupRestorePreview.sessions }}</div>
                      <div class="rounded bg-white px-2 py-2">阅卷 {{ backupRestorePreview.gradingResults }}</div>
                      <div class="rounded bg-white px-2 py-2">{{ backupRestorePreview.exportedAt ? formatDateTimeFull(backupRestorePreview.exportedAt) : '无导出时间' }}</div>
                    </div>
                    <input v-model="state.backupRestoreConfirm" class="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" placeholder="输入 RESTORE 确认" />
                    <button class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-coral px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.backupRestoring || !backupRestorePreview?.valid || state.backupRestoreConfirm !== 'RESTORE'" @click="restoreBackup">
                      <i data-lucide="rotate-ccw" class="h-4 w-4"></i>
                      {{ state.backupRestoring ? '恢复中' : '恢复备份' }}
                    </button>
                  </div>
                </div>
                <div class="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-black text-ink">自动备份历史</h3>
                      <div class="mt-1 text-xs font-semibold text-slate-500">每次运行时数据写入前保留上一版 JSON 文件</div>
                    </div>
                    <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50" :disabled="state.backupHistoryLoading" @click="loadBackupHistory">{{ state.backupHistoryLoading ? '刷新中' : '刷新' }}</button>
                  </div>
                  <div class="mt-3 max-h-56 space-y-2 overflow-y-auto">
                    <div v-if="!state.backupHistory.length" class="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-bold text-slate-500">暂无自动备份</div>
                    <div v-for="item in state.backupHistory" :key="item.name" class="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg bg-white px-3 py-2 text-xs">
                      <div class="min-w-0">
                        <div class="truncate font-black text-ink">{{ item.name }}</div>
                        <div class="mt-1 truncate font-semibold text-slate-500">{{ formatDateTimeFull(item.createdAt) }} · {{ formatBytes(item.sizeBytes || 0) }}</div>
                      </div>
                      <span class="rounded bg-slate-100 px-2 py-1 font-black text-slate-600">JSON</span>
                      <button class="rounded bg-cyan-50 px-2 py-1.5 font-black text-ocean" @click="downloadHistoricalBackup(item)">下载</button>
                    </div>
                  </div>
                </div>
                <div class="mt-5 grid gap-4 xl:grid-cols-2">
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <h3 class="text-sm font-black text-ink">运营会话</h3>
                        <div class="mt-1 text-xs font-semibold text-slate-500">当前在线管理员与可撤销登录</div>
                      </div>
                      <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50" :disabled="state.adminSessionsLoading" @click="loadAdminSessions">{{ state.adminSessionsLoading ? '刷新中' : '刷新' }}</button>
                    </div>
                    <div class="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      <div v-if="!state.adminSessions.length" class="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-bold text-slate-500">暂无会话</div>
                      <div v-for="session in state.adminSessions" :key="session.id" class="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-white px-3 py-3 text-sm">
                        <div class="min-w-0">
                          <div class="truncate font-black text-ink">{{ session.username }} <span v-if="session.current" class="ml-2 rounded bg-cyan-50 px-2 py-0.5 text-[10px] text-ocean">当前</span></div>
                          <div class="mt-1 truncate text-xs font-semibold text-slate-500">{{ session.role }} · {{ session.tokenHint }} · {{ formatDateTimeFull(session.lastSeenAt || session.createdAt) }}</div>
                        </div>
                        <button class="rounded bg-rose-50 px-2 py-1.5 text-xs font-black text-coral" @click="revokeAdminSession(session)">撤销</button>
                      </div>
                    </div>
                  </div>
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 class="text-sm font-black text-ink">审计日志</h3>
                        <div class="mt-1 text-xs font-semibold text-slate-500">检索登录、出题、监考、阅卷和系统操作</div>
                      </div>
                      <button class="rounded-lg bg-ink px-3 py-2 text-xs font-black text-white disabled:opacity-50" :disabled="!state.auditRows.length" @click="exportAuditLog">导出</button>
                    </div>
                    <div class="mt-3 grid gap-2 md:grid-cols-[140px_1fr_auto]">
                      <select v-model="state.auditFilterType" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700" @change="loadAuditLog">
                        <option value="">全部类型</option>
                        <option v-for="type in state.auditTypes" :key="type" :value="type">{{ type }}</option>
                      </select>
                      <input v-model="state.auditSearch" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-ink" placeholder="搜索内容、会话、参与者" @keyup.enter="loadAuditLog" />
                      <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50" :disabled="state.auditLoading" @click="loadAuditLog">{{ state.auditLoading ? '查询中' : '查询' }}</button>
                    </div>
                    <div class="mt-3 max-h-72 space-y-2 overflow-y-auto">
                      <div v-if="!state.auditRows.length" class="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-bold text-slate-500">暂无审计记录</div>
                      <div v-for="item in state.auditRows" :key="item.id" class="rounded-lg bg-white px-3 py-2 text-xs">
                        <div class="flex items-center justify-between gap-3">
                          <span class="min-w-0 truncate font-black text-ink">{{ item.message }}</span>
                          <span class="shrink-0 rounded bg-slate-100 px-2 py-1 font-black text-slate-600">{{ item.type }}</span>
                        </div>
                        <div class="mt-1 truncate font-semibold text-slate-500">{{ formatDateTimeFull(item.createdAt) }} · {{ item.sessionId || item.ticket || item.source || '-' }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
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

          <form v-if="visibleWorkflowStep === 'config'" novalidate class="rounded-lg border border-ocean/30 bg-cyan-50/70 p-5 shadow-soft" @submit.prevent="generateDraft">
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
                <label class="text-xs font-bold text-slate-600">考卷名称<input v-model="state.spec.paperName" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" :class="state.specFormErrors.paperName ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.specFormErrors.paperName)">{{ state.specFormErrors.paperName || '' }}</div></label>
                <label class="text-xs font-bold text-slate-600">出题方向<input v-model="state.spec.direction" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" :class="state.specFormErrors.direction ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.specFormErrors.direction)">{{ state.specFormErrors.direction || '' }}</div></label>
                <label class="text-xs font-bold text-slate-600">难度<select v-model="state.spec.difficulty" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100"><option>中</option><option>易</option><option>难</option><option>混合</option></select></label>
                <label class="text-xs font-bold text-slate-600">总分<input v-model.number="state.spec.totalScore" type="number" min="1" max="200" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100" :class="state.specFormErrors.totalScore ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.specFormErrors.totalScore)">{{ state.specFormErrors.totalScore || '' }}</div></label>
              </div>
              <div class="mt-3 grid grid-cols-6 gap-2">
                <label class="text-xs font-bold text-slate-600">单选题<input v-model.number="state.spec.singleCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">多选题<input v-model.number="state.spec.multipleCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">判断题<input v-model.number="state.spec.judgeCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">填空题<input v-model.number="state.spec.blankCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">简答题<input v-model.number="state.spec.shortCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
                <label class="text-xs font-bold text-slate-600">论述题<input v-model.number="state.spec.essayCount" type="number" min="0" max="50" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100" /></label>
              </div>
              <div :class="fieldErrorClass(state.specFormErrors.questionCount)">{{ state.specFormErrors.questionCount || '' }}</div>
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

        <section v-if="state.route === 'participants'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h1 class="text-3xl font-black">参与者管理</h1>
                <div class="mt-1 text-sm font-semibold text-slate-500">维护分组与参与者基础信息，支撑试卷分配和测评会话管理</div>
              </div>
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="refresh">刷新</button>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-black">分组管理</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">先维护分组，再给参与者选择所属分组</div>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedGroupIds.length" @click="state.confirmDeleteSelectedGroups = true">
                  <i data-lucide="trash-2" class="h-4 w-4"></i>
                  删除所选
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedGroupIds.length" @click="exportGroups('selected')">
                  <i data-lucide="download" class="h-4 w-4"></i>
                  导出所选
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!groups.length" @click="exportGroups('all')">
                  <i data-lucide="file-down" class="h-4 w-4"></i>
                  导出全部
                </button>
                <button class="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white" @click="openGroupModal()">
                  <i data-lucide="folder-plus" class="h-4 w-4"></i>
                  添加分组
                </button>
              </div>
            </div>
            <div class="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <div class="overflow-x-auto">
                <table class="min-w-full table-auto text-left text-sm">
                  <thead class="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th class="w-12 px-3 py-3 text-center"><input type="checkbox" :checked="allPagedGroupsSelected" :disabled="!pagedGroups.length" @change="togglePagedGroupSelection" /></th>
                      <th class="whitespace-nowrap px-3 py-3">分组名称</th>
                      <th class="px-3 py-3">备注信息</th>
                      <th class="whitespace-nowrap px-3 py-3">参与者数</th>
                      <th class="whitespace-nowrap px-3 py-3">创建时间</th>
                      <th class="whitespace-nowrap px-3 py-3">更新时间</th>
                      <th class="whitespace-nowrap px-3 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr v-for="group in pagedGroups" :key="group.id">
                      <td class="px-3 py-3 text-center"><input type="checkbox" :checked="state.selectedGroupIds.includes(group.id)" @change="toggleGroupSelection(group.id)" /></td>
                      <td class="whitespace-nowrap px-3 py-3 font-black text-ink">{{ group.name }}</td>
                      <td class="px-3 py-3"><div class="max-w-md truncate font-semibold text-slate-500">{{ group.description || '无备注' }}</div></td>
                      <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-600">{{ groupParticipantCount(group) }}</td>
                      <td class="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">{{ group.createdAt ? formatDateTimeWithYear(group.createdAt) : '-' }}</td>
                      <td class="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">{{ group.updatedAt ? formatDateTimeWithYear(group.updatedAt) : '-' }}</td>
                      <td class="px-3 py-3">
                        <div class="flex justify-end gap-2">
                          <button class="rounded bg-slate-50 px-2.5 py-1.5 text-xs font-black text-slate-600" @click="editGroup(group)">编辑</button>
                          <button class="rounded bg-rose-50 px-2.5 py-1.5 text-xs font-black text-coral" :title="groupInUse(group) ? '该分组已被引用，不能删除' : '删除分组'" @click="askDeleteGroup(group)">删除</button>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="!groups.length">
                      <td colspan="7" class="px-3 py-10 text-center text-sm font-bold text-slate-500">暂无分组</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
              <div>共 {{ groups.length }} 条，已选择 {{ state.selectedGroupIds.length }} 条</div>
              <div class="flex items-center gap-2">
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.groupPage <= 1" @click="changeGroupPage(-1)">上一页</button>
                <span class="min-w-20 text-center text-sm font-black text-ink">{{ state.groupPage }} / {{ groupTotalPages }}</span>
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.groupPage >= groupTotalPages" @click="changeGroupPage(1)">下一页</button>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-black">参与者信息</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">编号由系统自动生成，基础资料可用于试卷分配和测评会话识别</div>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedParticipantTickets.length" @click="state.confirmDeleteSelectedParticipants = true">
                  <i data-lucide="trash-2" class="h-4 w-4"></i>
                  删除所选
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" @click="exportParticipants('selected')">
                  <i data-lucide="download" class="h-4 w-4"></i>
                  导出所选
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" @click="exportParticipants('all')">
                  <i data-lucide="file-down" class="h-4 w-4"></i>
                  导出全部
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!groups.length" @click="openParticipantImport">
                  <i data-lucide="upload" class="h-4 w-4"></i>
                  导入名单
                </button>
                <button class="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="!groups.length" @click="openParticipantModal()">
                  <i data-lucide="user-plus" class="h-4 w-4"></i>
                  添加参与者
                </button>
              </div>
            </div>
            <div class="mt-4 grid gap-3 md:grid-cols-[1fr_160px_140px_150px_auto]">
              <label class="text-xs font-bold text-slate-600">
                搜索
                <input v-model="state.participantSearch" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" placeholder="姓名 / 编号 / 手机号 / 邮箱" @input="state.participantPage = 1" />
              </label>
              <label class="text-xs font-bold text-slate-600">
                分组
                <select v-model="state.participantGroupFilter" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" @change="state.participantPage = 1">
                  <option value="">全部分组</option>
                  <option v-for="group in groups" :key="group.id" :value="group.name">{{ group.name }}</option>
                </select>
              </label>
              <label class="text-xs font-bold text-slate-600">
                状态
                <select v-model="state.participantStatusFilter" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" @change="state.participantPage = 1">
                  <option value="active">仅启用</option>
                  <option value="all">全部</option>
                  <option value="disabled">已停用</option>
                </select>
              </label>
              <label class="text-xs font-bold text-slate-600">
                排序
                <select v-model="state.participantSort" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" @change="state.participantPage = 1">
                  <option value="createdDesc">最近创建</option>
                  <option value="updatedDesc">最近更新</option>
                  <option value="nameAsc">姓名 A-Z</option>
                  <option value="ticketAsc">编号升序</option>
                </select>
              </label>
              <div class="flex items-end">
                <button class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" @click="resetParticipantFilters">重置</button>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-3">
              <span class="text-xs font-black text-slate-500">批量操作</span>
              <select v-model="state.participantBulkGroup" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                <option value="">选择目标分组</option>
                <option v-for="group in groups" :key="group.id" :value="group.name">{{ group.name }}</option>
              </select>
              <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedParticipantTickets.length || !state.participantBulkGroup" @click="updateSelectedParticipants('group')">调整分组</button>
              <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedParticipantTickets.length" @click="updateSelectedParticipants('resetPassword')">重置密码</button>
              <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedParticipantTickets.length" @click="updateSelectedParticipants('enable')">启用</button>
              <button class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-coral disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedParticipantTickets.length" @click="updateSelectedParticipants('disable')">停用</button>
            </div>
            <div class="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <div class="overflow-x-auto">
                <table class="min-w-full table-auto text-left text-sm">
                  <thead class="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th class="w-12 px-3 py-3 text-center"><input type="checkbox" :checked="allPagedParticipantsSelected" :disabled="!pagedParticipants.length" @change="togglePagedParticipantSelection" /></th>
                      <th class="whitespace-nowrap px-3 py-3">姓名</th>
                      <th class="whitespace-nowrap px-3 py-3">编号</th>
                      <th class="whitespace-nowrap px-3 py-3">手机号</th>
                      <th class="whitespace-nowrap px-3 py-3">分组</th>
                      <th class="whitespace-nowrap px-3 py-3">邮箱</th>
                      <th class="px-3 py-3">描述</th>
                      <th class="whitespace-nowrap px-3 py-3">账号</th>
                      <th class="whitespace-nowrap px-3 py-3">考试</th>
                      <th class="whitespace-nowrap px-3 py-3">创建时间</th>
                      <th class="whitespace-nowrap px-3 py-3">更新时间</th>
                      <th class="whitespace-nowrap px-3 py-3">图片</th>
                      <th class="whitespace-nowrap px-3 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr v-for="item in pagedParticipants" :key="item.id || item.ticket">
                      <td class="px-3 py-3 text-center"><input type="checkbox" :checked="state.selectedParticipantTickets.includes(item.ticket)" @change="toggleParticipantSelection(item.ticket)" /></td>
                      <td class="whitespace-nowrap px-3 py-3 font-black text-ink">{{ item.candidate }}</td>
                      <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-600">{{ item.ticket }}</td>
                      <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-600">{{ item.phone || '-' }}</td>
                      <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-500">{{ item.className || '-' }}</td>
                      <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-600">{{ item.email || '-' }}</td>
                      <td class="px-3 py-3"><div class="max-w-md truncate text-xs font-semibold text-slate-500">{{ item.description || '无描述' }}</div></td>
                      <td class="whitespace-nowrap px-3 py-3">
                        <span class="inline-flex rounded px-2 py-1 text-xs font-black" :class="item.disabledAt ? 'bg-rose-50 text-coral' : item.passwordMustChange ? 'bg-amber-50 text-honey' : 'bg-emerald-50 text-emerald-700'">{{ item.disabledAt ? '已停用' : item.passwordMustChange ? '需改密' : '启用' }}</span>
                        <div class="mt-1 text-xs font-semibold text-slate-500">{{ item.lastLoginAt ? formatDateTimeWithYear(item.lastLoginAt) : '未登录' }}</div>
                      </td>
                      <td class="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600">
                        <div>{{ participantSessionStats(item).total }} 场</div>
                        <div class="mt-1 text-slate-500">提交 {{ participantSessionStats(item).submitted }}</div>
                      </td>
                      <td class="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">{{ item.createdAt ? formatDateTimeWithYear(item.createdAt) : '-' }}</td>
                      <td class="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-500">{{ item.updatedAt ? formatDateTimeWithYear(item.updatedAt) : '-' }}</td>
                      <td class="px-3 py-3">
                        <button v-if="item.avatar" type="button" title="预览图片" class="block h-10 w-10 overflow-hidden rounded-lg ring-1 ring-slate-200 transition hover:ring-ocean" @click="previewParticipantAvatar(item)">
                          <img :src="item.avatar" alt="参与者图片" class="h-full w-full object-cover" />
                        </button>
                        <span v-else class="text-xs font-semibold text-slate-500">无</span>
                      </td>
                      <td class="px-3 py-3">
                        <div class="flex flex-wrap justify-end gap-2">
                          <button class="rounded bg-cyan-50 px-2.5 py-1.5 text-xs font-black text-ocean" @click="state.viewingParticipant = item">详情</button>
                          <button class="rounded bg-slate-50 px-2.5 py-1.5 text-xs font-black text-slate-600" @click="openParticipantModal(item)">编辑</button>
                          <button class="rounded bg-amber-50 px-2.5 py-1.5 text-xs font-black text-honey disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.resettingParticipant === item.ticket" @click="resetParticipantPassword(item)">重置密码</button>
                          <button class="rounded bg-slate-50 px-2.5 py-1.5 text-xs font-black text-slate-600" @click="toggleParticipantStatus(item)">{{ item.disabledAt ? '启用' : '停用' }}</button>
                          <button class="rounded bg-rose-50 px-2.5 py-1.5 text-xs font-black text-coral" @click="deleteCandidate(item.ticket)">删除</button>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="!filteredParticipants.length">
                      <td colspan="13" class="px-3 py-10 text-center text-sm font-bold text-slate-500">暂无匹配的参与者信息</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
              <div>共 {{ filteredParticipants.length }} / {{ candidates.length }} 条，已选择 {{ state.selectedParticipantTickets.length }} 条</div>
              <div class="flex items-center gap-2">
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.participantPage <= 1" @click="changeParticipantPage(-1)">上一页</button>
                <span class="min-w-20 text-center text-sm font-black text-ink">{{ state.participantPage }} / {{ participantTotalPages }}</span>
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.participantPage >= participantTotalPages" @click="changeParticipantPage(1)">下一页</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="state.route === 'assignments'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h1 class="text-3xl font-black">试卷分配</h1>
                <div class="mt-1 text-sm font-semibold text-slate-500">选择已发布试卷、参与者名单和测试时间，生成测试会话入口</div>
              </div>
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="refresh">刷新</button>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-black">试卷分配列表</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">按参与者查看分配信息、考试状态和备注</div>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedAssignmentIds.length" @click="exportAssignments('selected')">
                  <i data-lucide="download" class="h-4 w-4"></i>
                  导出所选
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!sessions.length" @click="exportAssignments('all')">
                  <i data-lucide="download" class="h-4 w-4"></i>
                  导出全部
                </button>
                <button class="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-coral disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.selectedAssignmentIds.length" @click="state.confirmDeleteSelectedAssignments = true">
                  <i data-lucide="trash-2" class="h-4 w-4"></i>
                  删除所选
                </button>
                <button class="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="!publishedPapers.length || !candidates.length" @click="openAssignmentModal()">
                  <i data-lucide="user-plus" class="h-4 w-4"></i>
                  添加分配
                </button>
              </div>
            </div>
            <div class="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <table class="w-full table-fixed text-left text-sm">
                <thead class="bg-slate-50 text-xs font-black text-slate-500">
                  <tr>
                    <th class="w-12 px-3 py-3"><input type="checkbox" :checked="allPagedAssignmentsSelected" @change="togglePagedAssignmentSelection" /></th>
                    <th class="w-[18%] px-3 py-3">参与者</th>
                    <th class="w-[22%] px-3 py-3">试卷</th>
                    <th class="w-[20%] px-3 py-3">时间</th>
                    <th class="w-[10%] px-3 py-3">状态</th>
                    <th class="w-[14%] px-3 py-3">备注</th>
                    <th class="w-36 px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 bg-white">
                  <tr v-for="item in pagedAssignments" :key="item.id">
                    <td class="px-3 py-3"><input type="checkbox" :checked="state.selectedAssignmentIds.includes(item.id)" @change="toggleAssignmentSelection(item.id)" /></td>
                    <td class="px-3 py-3">
                      <button class="block max-w-full text-left" @click="viewAssignmentParticipant(item)">
                        <div class="truncate font-black text-ocean hover:underline">{{ item.candidate }}</div>
                        <div class="mt-1 truncate text-xs font-semibold text-slate-500">{{ item.className || '未分组' }}</div>
                      </button>
                    </td>
                    <td class="px-3 py-3">
                      <div class="truncate font-bold text-slate-700">{{ item.paperName || item.paper }}</div>
                    </td>
                    <td class="px-3 py-3 text-xs font-semibold text-slate-600">
                      <div class="truncate">开始：{{ formatDateTimeFull(item.startTime) || '-' }}</div>
                      <div class="mt-1 truncate">结束：{{ formatDateTimeFull(item.endTime) || '-' }}</div>
                    </td>
                    <td class="px-3 py-3 text-left">
                      <span class="inline-flex rounded px-2 py-1 text-xs font-black" :class="item.status === '已提交' ? 'bg-emerald-50 text-emerald-700' : item.status === '答题中' ? 'bg-cyan-50 text-ocean' : 'bg-slate-100 text-slate-600'">{{ item.status }}</span>
                      <div v-if="assignmentProgressText(item)" class="mt-1 text-xs font-semibold text-slate-500">{{ assignmentProgressText(item) }}</div>
                      <div v-if="assignmentRiskText(item)" class="mt-1 text-xs font-semibold text-honey">{{ assignmentRiskText(item) }}</div>
                    </td>
                    <td class="px-3 py-3"><div class="truncate text-xs font-semibold text-slate-600">{{ item.remark || '-' }}</div></td>
                    <td class="px-3 py-3">
                      <div class="flex justify-end gap-2">
                        <button class="rounded bg-slate-50 px-2 py-1.5 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="item.status === '已提交'" @click="openAssignmentModal(item)">编辑</button>
                        <button class="rounded bg-rose-50 px-2 py-1.5 text-xs font-black text-coral disabled:cursor-not-allowed disabled:opacity-40" :disabled="item.status === '已提交'" @click="askDeleteAssignment(item)">删除</button>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="!pagedAssignments.length">
                    <td colspan="7" class="px-3 py-10 text-center text-sm font-bold text-slate-500">暂无试卷分配</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="mt-4 flex items-center justify-between gap-3">
              <div class="text-xs font-semibold text-slate-500">已选择 {{ state.selectedAssignmentIds.length }} 条 · 共 {{ sessions.length }} 条</div>
              <div class="flex items-center gap-2">
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.assignmentPage <= 1" @click="changeAssignmentPage(-1)">上一页</button>
                <span class="min-w-20 text-center text-sm font-black text-ink">{{ state.assignmentPage }} / {{ assignmentTotalPages }}</span>
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.assignmentPage >= assignmentTotalPages" @click="changeAssignmentPage(1)">下一页</button>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-black">试卷分配概览</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">查看各试卷分配人数、答题中和提交状态</div>
              </div>
            </div>
            <div class="mt-4 grid grid-cols-3 gap-3">
              <div v-for="item in assignmentPaperCounts" :key="item.paperId || item.paperName" class="rounded-lg bg-slate-50 px-4 py-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 truncate text-sm font-black">{{ item.paperName }}</div>
                  <div class="text-sm font-black text-ocean">{{ item.assigned }}</div>
                </div>
                <div class="mt-1 text-xs font-semibold text-slate-500">答题中 {{ item.active }} · 已提交 {{ item.submitted }}</div>
              </div>
              <div v-if="!assignmentPaperCounts.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">暂无试卷分配</div>
            </div>
          </div>
        </section>

        <section v-if="state.route === 'proctor'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h1 class="text-3xl font-black">监考工作台</h1>
                <div class="mt-1 text-sm font-semibold text-slate-500">在当前控制台分配已发布试卷、生成测试入口并监控测试状态</div>
                <div class="mt-1 text-xs font-semibold text-slate-400">实时通道：{{ state.proctorStreamStatus }} · {{ state.proctorLastRefreshedAt ? formatDateTime(state.proctorLastRefreshedAt) : '等待同步' }}</div>
              </div>
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="refresh">刷新</button>
            </div>
            <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <div class="rounded-lg bg-cyan-50 p-4"><div class="text-2xl font-black text-ocean">{{ proctorSummary.online }}</div><div class="text-xs font-bold text-slate-500">在线参与者</div></div>
              <div class="rounded-lg bg-rose-50 p-4"><div class="text-2xl font-black text-coral">{{ proctorSummary.highRisk }}</div><div class="text-xs font-bold text-slate-500">高风险</div></div>
              <div class="rounded-lg bg-amber-50 p-4"><div class="text-2xl font-black text-honey">{{ proctorSummary.mediumRisk }}</div><div class="text-xs font-bold text-slate-500">中风险</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-ink">{{ proctorEventSummary.pending || 0 }}</div><div class="text-xs font-bold text-slate-500">待处理事件</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-slate-500">{{ proctorEventSummary.falsePositive || 0 }}</div><div class="text-xs font-bold text-slate-500">误报</div></div>
              <div class="rounded-lg bg-indigo-50 p-4"><div class="text-2xl font-black text-iris">{{ assignmentSummary.waiting || 0 }}</div><div class="text-xs font-bold text-slate-500">待开考</div></div>
            </div>
            <div class="mt-5 grid gap-3 lg:grid-cols-[1fr_160px_160px_160px]">
              <input v-model="state.proctorSearch" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" placeholder="搜索姓名、编号、分组或试卷" />
              <select v-model="state.proctorRiskFilter" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                <option value="all">全部风险</option>
                <option value="高">高风险</option>
                <option value="中">中风险</option>
                <option value="低">低风险</option>
              </select>
              <select v-model="state.proctorStatusFilter" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                <option value="all">全部状态</option>
                <option value="online">在线</option>
                <option value="待开考">待开考</option>
                <option value="答题中">答题中</option>
                <option value="已提交">已提交</option>
              </select>
              <select v-model="state.proctorEventFilter" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                <option value="pending">待处理风险</option>
                <option value="risk">全部风险</option>
                <option value="handled">已处理风险</option>
                <option value="all">全部事件</option>
              </select>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-black">风险规则</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">配置心跳风险等级、去重窗口和提交前设备合规门槛</div>
              </div>
              <button class="rounded-lg bg-ink px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.proctorRulesSaving" @click="saveProctorRules">
                {{ state.proctorRulesSaving ? '保存中' : '保存规则' }}
              </button>
            </div>
            <div class="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              <label class="text-xs font-bold text-slate-600">离开页面
                <select v-model="state.proctorRulesForm.visibilityHidden" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"><option>低</option><option>中</option><option>高</option></select>
              </label>
              <label class="text-xs font-bold text-slate-600">退出全屏
                <select v-model="state.proctorRulesForm.fullscreenExited" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"><option>低</option><option>中</option><option>高</option></select>
              </label>
              <label class="text-xs font-bold text-slate-600">剪贴板
                <select v-model="state.proctorRulesForm.clipboard" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"><option>低</option><option>中</option><option>高</option></select>
              </label>
              <label class="text-xs font-bold text-slate-600">去重秒数
                <input v-model.number="state.proctorRulesForm.duplicateWindowSeconds" type="number" min="1" max="300" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" />
              </label>
              <label class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-600">
                <input v-model="state.proctorRulesForm.requireFullscreen" type="checkbox" />
                提交需全屏
              </label>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-black">风险记录</h2>
                <div class="mt-1 text-xs font-semibold text-slate-500">查看测试过程中的完整风险与保存、提交事件</div>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!filteredProctorEvents.length" @click="toggleFilteredProctorEventSelection">
                  {{ allFilteredPendingProctorEventsSelected ? '取消选择' : '选择待处理' }}
                </button>
                <button class="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!selectedPendingProctorEvents.length" @click="resolveSelectedProctorEvents('已处理')">批量处理</button>
                <button class="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!selectedPendingProctorEvents.length" @click="resolveSelectedProctorEvents('误报')">批量误报</button>
                <button class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!proctorEvents.length" @click="exportProctorEvents">
                  <i data-lucide="download" class="h-4 w-4"></i>
                  导出风险记录
                </button>
              </div>
            </div>
            <div class="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div v-for="event in filteredProctorEvents" :key="event.id" class="grid gap-3 rounded bg-white px-3 py-2 text-xs font-semibold text-slate-600 md:grid-cols-[24px_1fr_auto_auto] md:items-center">
                <input v-if="event.type === 'proctor-event' && proctorEventStatus(event) === '待处理'" type="checkbox" :checked="state.selectedProctorEventIds.includes(event.id)" @change="toggleProctorEventSelection(event.id)" />
                <span v-else></span>
                <div class="min-w-0">
                  <div class="truncate font-black text-ink">{{ event.message }}</div>
                  <div class="mt-1 flex flex-wrap gap-2 text-slate-500">
                    <span>{{ formatDateTime(event.createdAt) }}</span>
                    <span v-if="event.ticket">{{ event.ticket }}</span>
                    <span v-if="event.risk">风险{{ event.risk }}</span>
                  </div>
                </div>
                <span class="inline-flex justify-center rounded px-2 py-1 text-xs font-black" :class="proctorEventStatusClass(event)">{{ proctorEventStatus(event) }}</span>
                <div class="flex justify-end gap-2">
                  <button v-if="event.type === 'proctor-event' && proctorEventStatus(event) === '待处理'" class="rounded bg-emerald-50 px-2 py-1.5 text-xs font-black text-emerald-700" @click="resolveProctorEvent(event, '已处理')">处理</button>
                  <button v-if="event.type === 'proctor-event' && proctorEventStatus(event) === '待处理'" class="rounded bg-slate-100 px-2 py-1.5 text-xs font-black text-slate-600" @click="resolveProctorEvent(event, '误报')">误报</button>
                </div>
              </div>
              <div v-if="!filteredProctorEvents.length" class="rounded bg-slate-50 px-3 py-6 text-center text-xs font-bold text-slate-500">暂无匹配的监考事件</div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div v-for="item in filteredProctorSessions" :key="item.id" class="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-base font-black">{{ item.candidate }}</div>
                  <div class="mt-1 truncate text-xs font-bold text-slate-500">{{ item.ticket }}</div>
                  <div class="mt-1 truncate text-xs font-semibold text-slate-500">{{ item.paperName || item.paper }} · {{ item.time }}</div>
                </div>
                <span class="rounded px-2 py-1 text-xs font-black" :class="proctorSessionRiskClass(item)">{{ item.status === '已提交' ? '完' : item.risk }}</span>
              </div>
              <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div class="rounded bg-slate-50 p-2"><div class="font-black">{{ item.progress }}%</div><div class="text-xs font-bold text-slate-500">进度</div></div>
                <div class="rounded bg-slate-50 p-2"><div class="font-black">{{ item.remainingMinutes }}</div><div class="text-xs font-bold text-slate-500">分钟</div></div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <span class="rounded px-2 py-1" :class="proctorOnlineClass(item)">{{ item.onlineStatus || '离线' }}</span>
                <span class="rounded bg-slate-100 px-2 py-1 text-slate-600">{{ item.displayStatus || item.status }}</span>
              </div>
              <div class="mt-3 grid grid-cols-4 gap-2">
                <button class="rounded bg-cyan-50 px-2 py-1.5 text-xs font-black text-ocean" @click="openProctorDetail(item.id)">详情</button>
                <a :href="candidateSessionUrl(item.id)" target="_blank" class="rounded bg-slate-50 px-2 py-1.5 text-center text-xs font-black text-slate-700">入口</a>
                <button class="rounded bg-slate-50 px-2 py-1.5 text-xs font-black text-slate-700" @click="recordProctorRisk(item.id)">风险</button>
                <button class="rounded bg-slate-50 px-2 py-1.5 text-xs font-black text-slate-700" @click="copyCandidateUrl(item.id)">复制</button>
              </div>
            </div>
            <div v-if="!filteredProctorSessions.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500 md:col-span-2 xl:col-span-4">暂无匹配的监考会话</div>
          </div>

          <div v-if="state.proctorDetail" class="fixed inset-0 z-[90] flex justify-end bg-slate-900/45 backdrop-blur-[1px]" @click.self="closeProctorDetail">
            <button class="absolute right-4 top-4 z-[91] flex h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-white text-slate-700 shadow-soft hover:bg-slate-50" title="关闭详情" aria-label="关闭详情" @click="closeProctorDetail">
              <i data-lucide="x" class="h-5 w-5"></i>
            </button>
            <aside class="relative z-[90] h-full w-full max-w-3xl overflow-y-auto bg-white p-5 shadow-soft" @click.stop>
              <div class="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <div class="text-xs font-bold text-ocean">监考详情</div>
                  <h2 class="mt-1 text-2xl font-black">{{ state.proctorDetail.session.candidate }}</h2>
                  <div class="mt-1 text-sm font-semibold text-slate-500">{{ state.proctorDetail.session.ticket }} · {{ state.proctorDetail.session.paperName || state.proctorDetail.session.paper }}</div>
                </div>
                <div class="mr-12 flex gap-2">
                  <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50" :disabled="state.proctorReportLoading" @click="exportProctorReport">{{ state.proctorReportLoading ? '生成中' : '导出取证' }}</button>
                </div>
              </div>

              <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div class="rounded bg-slate-50 p-3"><div class="text-lg font-black">{{ state.proctorDetail.session.progress }}%</div><div class="text-xs font-bold text-slate-500">进度</div></div>
                <div class="rounded bg-slate-50 p-3"><div class="text-lg font-black">{{ state.proctorDetail.session.remainingMinutes }}</div><div class="text-xs font-bold text-slate-500">剩余分钟</div></div>
                <div class="rounded bg-slate-50 p-3"><div class="text-lg font-black">{{ state.proctorDetail.session.risk }}</div><div class="text-xs font-bold text-slate-500">风险</div></div>
                <div class="rounded bg-slate-50 p-3"><div class="text-lg font-black">{{ state.proctorDetail.session.controlStatus || '正常' }}</div><div class="text-xs font-bold text-slate-500">控制状态</div></div>
              </div>

              <section class="mt-5 rounded-lg border border-slate-200 p-4">
                <h3 class="text-base font-black">设备状态</h3>
                <div class="mt-3 grid grid-cols-2 gap-2 text-sm font-semibold text-slate-600 md:grid-cols-3">
                  <span class="rounded bg-slate-50 px-3 py-2">全屏：{{ state.proctorDetail.session.device?.fullscreen || '-' }}</span>
                  <span class="rounded bg-slate-50 px-3 py-2">剪贴板：{{ state.proctorDetail.session.device?.clipboard || '-' }}</span>
                  <span class="rounded bg-slate-50 px-3 py-2">在线：{{ state.proctorDetail.session.onlineStatus || '-' }}</span>
                </div>
              </section>

              <section class="mt-5 rounded-lg border border-slate-200 p-4">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-base font-black">取证报告</h3>
                  <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50" :disabled="state.proctorReportLoading" @click="loadProctorReport()">{{ state.proctorReportLoading ? '加载中' : '刷新报告' }}</button>
                </div>
                <div v-if="state.proctorDetail.report" class="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <div class="rounded bg-slate-50 px-3 py-3"><div class="text-lg font-black text-coral">{{ state.proctorDetail.report.summary.riskEvents }}</div><div class="text-xs font-bold text-slate-500">风险证据</div></div>
                  <div class="rounded bg-slate-50 px-3 py-3"><div class="text-lg font-black text-honey">{{ state.proctorDetail.report.summary.pendingEvents }}</div><div class="text-xs font-bold text-slate-500">待处理</div></div>
                  <div class="rounded bg-slate-50 px-3 py-3"><div class="text-lg font-black text-ink">{{ state.proctorDetail.report.summary.answerEvents }}</div><div class="text-xs font-bold text-slate-500">答题记录</div></div>
                  <div class="rounded bg-slate-50 px-3 py-3"><div class="text-lg font-black text-ocean">{{ state.proctorDetail.report.summary.evidenceSnapshots || 0 }}</div><div class="text-xs font-bold text-slate-500">取证快照</div></div>
                  <div class="rounded bg-slate-50 px-3 py-3"><div class="text-lg font-black text-iris">{{ state.proctorDetail.report.summary.evidenceAttachments || 0 }}</div><div class="text-xs font-bold text-slate-500">证据附件</div></div>
                </div>
                <div v-if="state.proctorDetail.report?.analysis" class="mt-3 rounded bg-slate-50 px-3 py-3 text-sm">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-black text-ink">自动分析</span>
                    <span class="rounded bg-white px-2 py-1 text-xs font-black text-coral">风险分 {{ state.proctorDetail.report.analysis.score }}</span>
                    <span class="rounded bg-white px-2 py-1 text-xs font-black text-slate-600">{{ state.proctorDetail.report.analysis.conclusion }}</span>
                  </div>
                  <div v-if="state.proctorDetail.report.analysis.findings?.length" class="mt-2 space-y-1 text-xs font-semibold text-slate-600">
                    <div v-for="item in state.proctorDetail.report.analysis.findings.slice(0, 3)" :key="item.id" class="truncate">{{ item.severity }} · {{ item.title }}：{{ item.detail }}</div>
                  </div>
                  <div v-if="state.proctorDetail.report.analysis.recommendations?.length" class="mt-2 rounded bg-white px-2 py-2 text-xs font-bold text-slate-600">{{ state.proctorDetail.report.analysis.recommendations[0] }}</div>
                </div>
                <div v-if="state.proctorDetail.report" class="mt-3 max-h-44 space-y-2 overflow-y-auto">
                  <div v-for="event in state.proctorDetail.report.timeline.slice(-8)" :key="event.id" class="rounded bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    <div class="font-black text-ink">{{ event.message || event.event || event.type }}</div>
                    <div class="mt-1 flex flex-wrap gap-2 text-slate-500">
                      <span>{{ formatDateTimeFull(event.createdAt) }}</span>
                      <span v-if="event.risk">风险{{ event.risk }}</span>
                      <span>{{ event.status }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="state.proctorDetail.report?.evidenceAttachments?.length" class="mt-3 space-y-2">
                  <div v-for="attachment in state.proctorDetail.report.evidenceAttachments" :key="attachment.id" class="grid grid-cols-[1fr_auto] items-center gap-3 rounded bg-slate-50 px-3 py-2 text-xs">
                    <div class="min-w-0">
                      <div class="truncate font-black text-ink">{{ attachment.label || attachment.type }}</div>
                      <div class="mt-1 truncate font-semibold text-slate-500">{{ attachment.contentType }} · {{ formatBytes(attachment.sizeBytes || 0) }}</div>
                      <div v-if="attachment.sha256" class="mt-1 truncate font-semibold text-slate-400">SHA-256 {{ attachment.sha256.slice(0, 16) }}...</div>
                    </div>
                    <button class="rounded bg-cyan-50 px-2 py-1.5 font-black text-ocean" @click="downloadEvidenceAttachment(attachment)">下载</button>
                  </div>
                </div>
                <div v-if="!state.proctorDetail.report" class="mt-3 rounded bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-500">取证报告加载中</div>
              </section>

              <section class="mt-5 rounded-lg border border-slate-200 p-4">
                <h3 class="text-base font-black">监考控制</h3>
                <div class="mt-3 grid gap-3 md:grid-cols-[1fr_120px]">
                  <input v-model="state.proctorControlNote" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="控制备注" />
                  <input v-model.number="state.proctorExtendMinutes" type="number" min="1" max="240" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold" />
                </div>
                <div class="mt-3 grid grid-cols-3 gap-2 md:grid-cols-6">
                  <button class="rounded bg-amber-50 px-3 py-2 text-xs font-black text-honey" @click="runProctorControl('pause')">暂停</button>
                  <button class="rounded bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700" @click="runProctorControl('resume')">恢复</button>
                  <button class="rounded bg-slate-100 px-3 py-2 text-xs font-black text-slate-700" @click="runProctorControl('lock')">锁定</button>
                  <button class="rounded bg-cyan-50 px-3 py-2 text-xs font-black text-ocean" @click="runProctorControl('unlock')">解锁</button>
                  <button class="rounded bg-indigo-50 px-3 py-2 text-xs font-black text-iris" @click="runProctorControl('extend')">延时</button>
                  <button class="rounded bg-rose-50 px-3 py-2 text-xs font-black text-coral" @click="runProctorControl('forceSubmit')">收卷</button>
                </div>
                <div class="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <input v-model="state.proctorMessageText" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="发送给考生的消息" />
                  <button class="rounded-lg bg-ink px-4 py-2 text-sm font-black text-white" @click="runProctorControl('message')">发送消息</button>
                </div>
              </section>

              <section class="mt-5 rounded-lg border border-slate-200 p-4">
                <h3 class="text-base font-black">风险事件</h3>
                <textarea v-model="state.proctorResolutionText" rows="2" class="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="处理备注"></textarea>
                <div class="mt-3 max-h-60 space-y-2 overflow-y-auto">
                  <div v-for="event in state.proctorDetail.events" :key="event.id" class="rounded bg-slate-50 p-3 text-sm">
                    <div class="flex items-start justify-between gap-3">
                      <div class="font-bold text-slate-700">{{ event.message }}</div>
                      <span class="rounded px-2 py-1 text-xs font-black" :class="proctorEventStatusClass(event)">{{ proctorEventStatus(event) }}</span>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                      <span>{{ formatDateTimeFull(event.createdAt) }}</span>
                      <span v-if="event.risk">风险{{ event.risk }}</span>
                      <span v-if="event.source">{{ event.source }}</span>
                    </div>
                    <div v-if="event.type === 'proctor-event' && proctorEventStatus(event) === '待处理'" class="mt-3 flex gap-2">
                      <button class="rounded bg-emerald-50 px-2 py-1.5 text-xs font-black text-emerald-700" @click="resolveProctorEvent(event, '已处理')">处理</button>
                      <button class="rounded bg-slate-100 px-2 py-1.5 text-xs font-black text-slate-600" @click="resolveProctorEvent(event, '误报')">误报</button>
                    </div>
                  </div>
                  <div v-if="!state.proctorDetail.events.length" class="rounded bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-500">暂无事件</div>
                </div>
              </section>

              <section class="mt-5 rounded-lg border border-slate-200 p-4">
                <h3 class="text-base font-black">答题状态</h3>
                <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div v-for="question in state.proctorDetail.questions" :key="question.id" class="rounded bg-slate-50 px-3 py-2 text-sm font-semibold">
                    <span class="font-black">{{ question.id }}</span>
                    <span class="ml-2">{{ question.type }}</span>
                    <span class="ml-2" :class="question.answered ? 'text-leaf' : 'text-slate-400'">{{ question.answered ? '已答' : '未答' }}</span>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </section>

        <section v-if="state.route === 'analysis'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between gap-3">
              <div><h1 class="text-3xl font-black">阅卷分析</h1><div class="mt-1 text-sm font-semibold text-slate-500">阅卷队列、复核状态、成绩与知识点分析</div></div>
              <div class="flex gap-2">
                <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="exportAnalysis">导出报告</button>
                <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="exportGradingResults">导出成绩</button>
              </div>
            </div>
            <div class="mt-5 grid grid-cols-6 gap-3">
              <div class="rounded-lg bg-indigo-50 p-4"><div class="text-2xl font-black text-iris">{{ gradingQueue.objectiveDone || 0 }}</div><div class="text-xs font-bold text-slate-500">自动阅卷</div></div>
              <div class="rounded-lg bg-amber-50 p-4"><div class="text-2xl font-black text-honey">{{ gradingQueue.subjectivePending || 0 }}</div><div class="text-xs font-bold text-slate-500">待复核</div></div>
              <div class="rounded-lg bg-emerald-50 p-4"><div class="text-2xl font-black text-leaf">{{ gradingQueue.reviewDone || 0 }}</div><div class="text-xs font-bold text-slate-500">复核完成</div></div>
              <div class="rounded-lg bg-cyan-50 p-4"><div class="text-2xl font-black text-ocean">{{ analysis.averageScore || 0 }}</div><div class="text-xs font-bold text-slate-500">平均分</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black">{{ analysis.passRate || 0 }}%</div><div class="text-xs font-bold text-slate-500">通过率</div></div>
              <div class="rounded-lg bg-rose-50 p-4"><div class="text-2xl font-black text-coral">{{ analysis.weakPoints || 0 }}</div><div class="text-xs font-bold text-slate-500">薄弱点</div></div>
            </div>
          </div>
          <div class="grid grid-cols-[0.9fr_1.1fr] gap-5">
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-black">复核队列</h2>
                  <div class="mt-1 text-xs font-semibold text-slate-500">按答卷查看主观题复核进度</div>
                </div>
                <select v-model="state.gradingReviewFilter" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <option value="pending">待复核</option>
                  <option value="done">已完成</option>
                  <option value="risk">有风险</option>
                  <option value="all">全部</option>
                </select>
              </div>
              <div class="mt-4 max-h-[420px] space-y-2 overflow-y-auto">
                <button v-for="entry in filteredGradingReviewQueue" :key="entry.sessionId" class="w-full rounded-lg border px-3 py-3 text-left text-sm" :class="selectedReviewEntry?.sessionId === entry.sessionId ? 'border-ocean bg-cyan-50' : 'border-slate-200 bg-white'" @click="selectReviewEntry(entry)">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate font-black text-ink">{{ entry.candidate || entry.sessionId }}</div>
                      <div class="mt-1 truncate text-xs font-semibold text-slate-500">{{ entry.ticket }} · {{ entry.paperName || '-' }}</div>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-1">
                      <span class="rounded px-2 py-1 text-xs font-black" :class="entry.reviewStatus === '已完成' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-honey'">{{ entry.reviewStatus }}</span>
                      <span class="rounded px-2 py-1 text-[10px] font-black" :class="entry.publishStatus === '已发布' ? 'bg-cyan-50 text-ocean' : 'bg-slate-100 text-slate-500'">{{ entry.publishStatus || '未发布' }}</span>
                    </div>
                  </div>
                  <div class="mt-3 grid grid-cols-5 gap-2 text-xs font-bold text-slate-600">
                    <span>总分 {{ entry.totalScore }}/{{ entry.maxScore }}</span>
                    <span>主观 {{ entry.subjectiveScore }}</span>
                    <span>待 {{ entry.subjectivePending }}</span>
                    <span :class="entry.risk !== '低' ? 'text-coral' : 'text-slate-500'">风险{{ entry.risk }}</span>
                    <span :class="entry.appealStatus === '待处理' ? 'text-coral' : 'text-slate-500'">申诉 {{ entry.appealStatus || '无' }}</span>
                  </div>
                </button>
                <div v-if="!filteredGradingReviewQueue.length" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-500">暂无匹配答卷</div>
              </div>
            </section>
            <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="text-lg font-black">逐题复核</h2>
                  <div class="mt-1 text-xs font-semibold text-slate-500">{{ selectedReviewEntry ? ((selectedReviewEntry.candidate || selectedReviewEntry.sessionId) + ' · ' + selectedReviewEntry.totalScore + '/' + selectedReviewEntry.maxScore) : '选择左侧答卷后复核' }}</div>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!selectedReviewEntry || selectedReviewEntry.reviewStatus !== '已完成' || selectedReviewEntry.publishStatus === '已发布' || state.publishingResultSessionId === selectedReviewEntry.sessionId" @click="publishReviewEntry(selectedReviewEntry)">
                    {{ state.publishingResultSessionId === selectedReviewEntry?.sessionId ? '发布中' : selectedReviewEntry?.publishStatus === '已发布' ? '已发布' : '发布成绩' }}
                  </button>
                  <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="!selectedReviewEntry || state.reviewSubmitting" @click="submitReviewEntry(selectedReviewEntry)">
                    {{ state.reviewSubmitting ? '保存中' : '保存复核' }}
                  </button>
                </div>
              </div>
              <div v-if="selectedReviewEntry?.latestAppeal" class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-black">成绩申诉 · {{ selectedReviewEntry.latestAppeal.status }}</div>
                    <div class="mt-1 text-xs leading-5">{{ selectedReviewEntry.latestAppeal.reason }}</div>
                    <div v-if="selectedReviewEntry.latestAppeal.resolution" class="mt-2 rounded bg-white/80 px-3 py-2 text-xs">处理说明：{{ selectedReviewEntry.latestAppeal.resolution }}</div>
                  </div>
                  <span class="shrink-0 rounded bg-white px-2 py-1 text-xs font-black">{{ formatDateTimeFull(selectedReviewEntry.latestAppeal.submittedAt) }}</span>
                </div>
                <div v-if="selectedReviewEntry.latestAppeal.status === '待处理'" class="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                  <input v-model="state.appealResolutionText" class="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-ink" placeholder="填写申诉处理说明" />
                  <button class="rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50" :disabled="state.resolvingAppealId === selectedReviewEntry.latestAppeal.id" @click="resolveReviewAppeal(selectedReviewEntry, 'reject')">驳回</button>
                  <button class="rounded-lg bg-ink px-3 py-2 text-xs font-black text-white disabled:opacity-50" :disabled="state.resolvingAppealId === selectedReviewEntry.latestAppeal.id" @click="resolveReviewAppeal(selectedReviewEntry, 'accept')">受理复核</button>
                </div>
              </div>
              <div v-if="selectedReviewEntry" class="mt-4 max-h-[420px] space-y-3 overflow-y-auto">
                <div v-for="detail in selectedReviewEntry.details.filter((item) => item.reviewRequired)" :key="detail.questionId" class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-black text-ink">{{ detail.questionId }} · {{ detail.type }}</div>
                    <span class="rounded bg-white px-2 py-1 text-xs font-black text-slate-600">{{ detail.status }}</span>
                  </div>
                  <div class="mt-2 text-xs font-semibold leading-5 text-slate-600">作答：{{ Array.isArray(detail.answer) ? detail.answer.join('、') : (detail.answer || '未作答') }}</div>
                  <div class="mt-1 text-xs font-semibold leading-5 text-slate-500">{{ detail.aiComment || '无 AI 初评意见' }}</div>
                  <div class="mt-3 grid gap-3 md:grid-cols-[120px_1fr]">
                    <label class="text-xs font-bold text-slate-600">得分 / {{ detail.score }}
                      <input :value="reviewFormRow(selectedReviewEntry, detail).awarded" type="number" min="0" :max="detail.score" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-ink" @input="reviewFormRow(selectedReviewEntry, detail).awarded = Number($event.target.value)" />
                    </label>
                    <label class="text-xs font-bold text-slate-600">复核意见
                      <input :value="reviewFormRow(selectedReviewEntry, detail).comment" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink" placeholder="填写复核意见" @input="reviewFormRow(selectedReviewEntry, detail).comment = $event.target.value" />
                    </label>
                  </div>
                </div>
                <div v-if="!selectedReviewEntry.details.some((item) => item.reviewRequired)" class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-500">该答卷无需人工复核</div>
              </div>
              <div v-else class="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center text-sm font-bold text-slate-500">请选择一份答卷</div>
            </section>
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
      <div v-if="state.assignmentModalOpen" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 px-6 py-8">
        <form novalidate class="w-full max-w-2xl rounded-lg bg-white p-5 shadow-soft" @submit.prevent="submitAssignment">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-lg font-black">{{ state.assignmentForm.id ? '编辑试卷分配' : '添加试卷分配' }}</div>
              <div class="mt-1 text-xs font-semibold text-slate-500">参与者从基础信息中选择，编号与分组自动带入</div>
            </div>
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="closeAssignmentModal">关闭</button>
          </div>
          <div class="mt-5 grid grid-cols-2 gap-3">
            <label class="col-span-2 text-xs font-bold text-slate-600">已发布试卷
              <select v-model="state.assignmentForm.paperId" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.assignmentFormErrors.paperId ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'">
                <option value="" disabled>请选择试卷</option>
                <option v-for="item in publishedPapers" :key="item.id" :value="item.id">{{ item.name }} · {{ item.score || 0 }} 分 · {{ item.questionCount || 0 }} 题</option>
              </select>
              <div :class="fieldErrorClass(state.assignmentFormErrors.paperId)">{{ state.assignmentFormErrors.paperId || '' }}</div>
            </label>
            <label class="col-span-2 text-xs font-bold text-slate-600">参与者
              <select v-model="state.assignmentForm.participantTicket" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.assignmentFormErrors.participantTicket ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" @change="setAssignmentParticipant(state.assignmentForm.participantTicket)">
                <option value="" disabled>请选择参与者</option>
                <option v-for="item in candidates" :key="item.ticket" :value="item.ticket">{{ item.candidate }} · {{ item.ticket }} · {{ item.className || '未分组' }}</option>
              </select>
              <div :class="fieldErrorClass(state.assignmentFormErrors.participantTicket)">{{ state.assignmentFormErrors.participantTicket || '' }}</div>
            </label>
            <label class="text-xs font-bold text-slate-600">开始时间
              <input v-model="state.assignmentForm.startTime" type="datetime-local" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.assignmentFormErrors.startTime ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" />
              <div :class="fieldErrorClass(state.assignmentFormErrors.startTime)">{{ state.assignmentFormErrors.startTime || '' }}</div>
            </label>
            <label class="text-xs font-bold text-slate-600">结束时间
              <input v-model="state.assignmentForm.endTime" type="datetime-local" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.assignmentFormErrors.endTime ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" />
              <div :class="fieldErrorClass(state.assignmentFormErrors.endTime)">{{ state.assignmentFormErrors.endTime || '' }}</div>
            </label>
            <label class="col-span-2 text-xs font-bold text-slate-600">备注
              <textarea v-model="state.assignmentForm.remark" rows="4" class="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-ink" placeholder="选填"></textarea>
            </label>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeAssignmentModal">取消</button>
            <button type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.assignmentSubmitting">
              {{ state.assignmentSubmitting ? '保存中' : '保存' }}
            </button>
          </div>
        </form>
      </div>
      <div v-if="state.confirmDeleteAssignment" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认删除试卷分配</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">删除后该参与者的考试会话会被撤销。确认删除「{{ state.confirmDeleteAssignment.candidate }}」的分配吗？</div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeleteAssignment = null">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white" @click="confirmDeleteAssignment">确认删除</button>
          </div>
        </div>
      </div>
      <div v-if="state.confirmDeleteSelectedAssignments" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认批量删除分配</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">将删除已选择的 {{ state.selectedAssignmentIds.length }} 条试卷分配。已提交的会话会被保留并提示失败。</div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeleteSelectedAssignments = false">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white" @click="confirmDeleteSelectedAssignments">确认删除</button>
          </div>
        </div>
      </div>
      <div v-if="state.viewingParticipant" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 px-6 py-8">
        <div class="w-full max-w-2xl rounded-lg bg-white p-5 shadow-soft">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-lg font-black">参与者详情</div>
              <div class="mt-1 text-xs font-semibold text-slate-500">来自参与者基础信息</div>
            </div>
            <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="state.viewingParticipant = null">关闭</button>
          </div>
          <div class="mt-5 grid grid-cols-[88px_1fr] gap-5">
            <div>
              <div class="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                <img v-if="state.viewingParticipant.avatar" :src="state.viewingParticipant.avatar" alt="" class="h-full w-full object-cover" />
                <span v-else class="text-xl font-black text-slate-500">{{ (state.viewingParticipant.candidate || '参').slice(0, 1) }}</span>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">姓名</div><div class="mt-1 font-black text-ink">{{ state.viewingParticipant.candidate || '-' }}</div></div>
              <div class="rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">分组</div><div class="mt-1 font-black text-ink">{{ state.viewingParticipant.className || '-' }}</div></div>
              <div class="rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">编号</div><div class="mt-1 font-semibold text-slate-700">{{ state.viewingParticipant.ticket || '-' }}</div></div>
              <div class="rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">手机号</div><div class="mt-1 font-semibold text-slate-700">{{ state.viewingParticipant.phone || '-' }}</div></div>
              <div class="rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">账号状态</div><div class="mt-1 font-semibold text-slate-700">{{ state.viewingParticipant.disabledAt ? '已停用' : state.viewingParticipant.passwordMustChange ? '需改密' : '启用' }}</div></div>
              <div class="rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">最近登录</div><div class="mt-1 font-semibold text-slate-700">{{ state.viewingParticipant.lastLoginAt ? formatDateTimeWithYear(state.viewingParticipant.lastLoginAt) : '-' }}</div></div>
              <div class="col-span-2 rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">邮箱</div><div class="mt-1 font-semibold text-slate-700">{{ state.viewingParticipant.email || '-' }}</div></div>
              <div class="col-span-2 rounded bg-slate-50 px-3 py-2"><div class="text-xs font-bold text-slate-500">描述</div><div class="mt-1 font-semibold leading-6 text-slate-700">{{ state.viewingParticipant.description || '无描述' }}</div></div>
            </div>
          </div>
          <div class="mt-5 rounded-lg border border-slate-200">
            <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div class="text-sm font-black text-ink">考试分配</div>
              <div class="text-xs font-bold text-slate-500">{{ viewingParticipantSessions.length }} 场</div>
            </div>
            <div v-if="viewingParticipantSessions.length" class="max-h-56 overflow-y-auto divide-y divide-slate-100">
              <div v-for="session in viewingParticipantSessions" :key="session.id" class="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 text-sm">
                <div class="min-w-0">
                  <div class="truncate font-black text-slate-700">{{ session.paperName || session.paper || '未绑定试卷' }}</div>
                  <div class="mt-1 text-xs font-semibold text-slate-500">{{ formatDateTimeFull(session.startTime) || '-' }} - {{ formatDateTimeFull(session.endTime) || '-' }}</div>
                </div>
                <div class="text-right">
                  <span class="inline-flex rounded px-2 py-1 text-xs font-black" :class="session.status === '已提交' ? 'bg-emerald-50 text-emerald-700' : session.status === '答题中' ? 'bg-cyan-50 text-ocean' : 'bg-slate-100 text-slate-600'">{{ session.status || '待开考' }}</span>
                  <div class="mt-1 text-xs font-semibold text-slate-500">{{ Number(session.progress || 0) }}%</div>
                </div>
              </div>
            </div>
            <div v-else class="px-4 py-8 text-center text-sm font-bold text-slate-500">暂无考试分配</div>
          </div>
        </div>
      </div>
      <div v-if="state.groupModalOpen" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 px-6 py-8">
        <form novalidate class="w-full max-w-lg rounded-lg bg-white p-5 shadow-soft" @submit.prevent="submitGroup">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-lg font-black">{{ state.groupForm.id ? '编辑分组' : '添加分组' }}</div>
              <div class="mt-1 text-xs font-semibold text-slate-500">分组名称用于参与者归属，备注可记录用途或范围</div>
            </div>
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="closeGroupModal">关闭</button>
          </div>
          <div class="mt-5 space-y-3">
            <label class="block text-xs font-bold text-slate-600">
              <span class="flex items-center gap-2">分组名称 <span class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-coral">必填</span></span>
              <input v-model="state.groupForm.name" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.groupFormErrors.name ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入分组名称" />
              <div :class="fieldErrorClass(state.groupFormErrors.name)">{{ state.groupFormErrors.name || '' }}</div>
            </label>
            <label class="block text-xs font-bold text-slate-600">
              <span class="flex items-center gap-2">备注信息 <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">选填</span></span>
              <textarea v-model="state.groupForm.description" rows="4" class="mt-2 w-full resize-y rounded-lg border bg-white px-3 py-2 text-sm font-semibold leading-6 text-ink" :class="state.groupFormErrors.description ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="用于记录分组用途、范围或备注"></textarea>
              <div :class="fieldErrorClass(state.groupFormErrors.description)">{{ state.groupFormErrors.description || '' }}</div>
            </label>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeGroupModal">取消</button>
            <button type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.groupSubmitting">
              {{ state.groupSubmitting ? '保存中' : '保存' }}
            </button>
          </div>
        </form>
      </div>
      <div v-if="state.confirmDeleteGroup" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认删除分组</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">删除后该分组会从分组列表中移除。确认删除「{{ state.confirmDeleteGroup.name }}」吗？</div>
          <div v-if="groupInUse(state.confirmDeleteGroup)" class="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <div class="text-xs font-black text-coral">以下分组已被引用，不能删除</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <span class="rounded bg-white px-2 py-1 text-xs font-black text-coral ring-1 ring-rose-100">{{ state.confirmDeleteGroup.name }}</span>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeleteGroup = null">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="groupInUse(state.confirmDeleteGroup)" @click="confirmDeleteGroup">确认删除</button>
          </div>
        </div>
      </div>
      <div v-if="state.confirmDeleteSelectedGroups" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认批量删除分组</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">将删除已选择的 {{ state.selectedGroupIds.length }} 个分组。</div>
          <div v-if="selectedUsedGroups.length" class="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <div class="text-xs font-black text-coral">以下分组已被引用，不能批量删除</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <span v-for="group in selectedUsedGroups" :key="group.id" class="rounded bg-white px-2 py-1 text-xs font-black text-coral ring-1 ring-rose-100">{{ group.name }}</span>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeleteSelectedGroups = false">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="selectedUsedGroups.length > 0" @click="confirmDeleteSelectedGroups">确认删除</button>
          </div>
        </div>
      </div>
      <div v-if="state.participantImportOpen" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 px-6 py-8">
        <div class="w-full max-w-4xl rounded-lg bg-white p-5 shadow-soft">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-lg font-black">导入参与者</div>
              <div class="mt-1 text-xs font-semibold text-slate-500">每行格式：姓名,编号,分组,手机号,邮箱,描述,密码；编号可留空自动生成</div>
            </div>
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="closeParticipantImport">关闭</button>
          </div>
          <textarea v-model="state.participantImportText" rows="8" class="mt-5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm leading-6 text-ink" placeholder="张三,,A组,13800000001,zhang@example.com,备注"></textarea>
          <div class="mt-4 flex flex-wrap justify-between gap-3">
            <div v-if="state.participantImportPreview" class="text-sm font-bold text-slate-600">
              可导入 {{ state.participantImportPreview.validCount }} 条，需修正 {{ state.participantImportPreview.invalidCount }} 条
            </div>
            <div v-else class="text-sm font-bold text-slate-500">先预览，确认错误后再导入</div>
            <div class="flex gap-2">
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.participantImportLoading" @click="previewParticipantImport">{{ state.participantImportLoading ? '预览中' : '预览名单' }}</button>
              <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="!state.participantImportPreview?.validCount || state.participantImportSubmitting" @click="submitParticipantImport">{{ state.participantImportSubmitting ? '导入中' : '导入有效行' }}</button>
            </div>
          </div>
          <div v-if="state.participantImportPreview" class="mt-4 max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th class="whitespace-nowrap px-3 py-3">行</th>
                  <th class="whitespace-nowrap px-3 py-3">姓名</th>
                  <th class="whitespace-nowrap px-3 py-3">编号</th>
                  <th class="whitespace-nowrap px-3 py-3">分组</th>
                  <th class="whitespace-nowrap px-3 py-3">手机号</th>
                  <th class="px-3 py-3">结果</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="row in state.participantImportPreview.rows" :key="row.row">
                  <td class="px-3 py-3 font-bold text-slate-500">{{ row.row }}</td>
                  <td class="px-3 py-3 font-semibold text-ink">{{ row.candidate || '-' }}</td>
                  <td class="px-3 py-3 font-semibold text-slate-600">{{ row.ticket || '-' }}<span v-if="row.generatedTicket" class="ml-1 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-black text-ocean">自动</span></td>
                  <td class="px-3 py-3 font-semibold text-slate-600">{{ row.className || '-' }}</td>
                  <td class="px-3 py-3 font-semibold text-slate-600">{{ row.phone || '-' }}</td>
                  <td class="px-3 py-3">
                    <span v-if="row.valid" class="rounded bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">可导入</span>
                    <span v-else class="text-xs font-bold text-coral">{{ row.errors.join('、') }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-if="state.participantModalOpen" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 px-6 py-8">
        <form novalidate class="w-full max-w-2xl rounded-lg bg-white p-5 shadow-soft" @submit.prevent="submitCandidate">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-lg font-black">{{ state.candidateForm.ticket ? '编辑参与者' : '添加参与者' }}</div>
              <div class="mt-1 text-xs font-semibold text-slate-500">姓名、手机号、分组为必填项，编号保存后由系统生成</div>
            </div>
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="closeParticipantModal">关闭</button>
          </div>
          <div class="mt-5 grid grid-cols-[120px_1fr] gap-5">
            <div>
              <div class="flex items-center gap-2 text-xs font-bold text-slate-600">图片 <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">选填</span></div>
              <div class="mt-2 flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                <img v-if="state.candidateForm.avatar" :src="state.candidateForm.avatar" alt="" class="h-full w-full object-cover" />
                <i v-else data-lucide="image-plus" class="h-7 w-7 text-slate-400"></i>
              </div>
              <label class="mt-3 flex w-24 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
                上传
                <input class="sr-only" type="file" accept="image/*" @change="handleParticipantAvatar" />
              </label>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">姓名 <span class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-coral">必填</span></span>
                <input v-model="state.candidateForm.candidate" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidateFormErrors.candidate ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入姓名" />
                <div :class="fieldErrorClass(state.candidateFormErrors.candidate)">{{ state.candidateFormErrors.candidate || '' }}</div>
              </label>
              <label class="text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">编号 <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">自动</span></span>
                <input :value="state.candidateForm.ticket || '保存后自动生成'" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" />
              </label>
              <label class="text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">手机号 <span class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-coral">必填</span></span>
                <input v-model="state.candidateForm.phone" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidateFormErrors.phone ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入手机号" />
                <div :class="fieldErrorClass(state.candidateFormErrors.phone)">{{ state.candidateFormErrors.phone || '' }}</div>
              </label>
              <label class="text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">分组 <span class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-coral">必填</span></span>
                <select v-model="state.candidateForm.className" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidateFormErrors.className ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'">
                  <option value="" disabled>请选择分组</option>
                  <option v-for="group in groups" :key="group.id" :value="group.name">{{ group.name }}</option>
                </select>
                <div :class="fieldErrorClass(state.candidateFormErrors.className)">{{ state.candidateFormErrors.className || '' }}</div>
              </label>
              <label class="col-span-2 text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">邮箱 <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">选填</span></span>
                <input v-model="state.candidateForm.email" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidateFormErrors.email ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="选填" />
                <div :class="fieldErrorClass(state.candidateFormErrors.email)">{{ state.candidateFormErrors.email || '' }}</div>
              </label>
              <label class="col-span-2 text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">登录密码 <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{{ state.candidateForm.ticket ? '留空不变' : '默认手机号后6位' }}</span></span>
                <input v-model="state.candidateForm.password" type="password" autocomplete="new-password" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink" :class="state.candidateFormErrors.password ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" :placeholder="state.candidateForm.ticket ? '填写后将重置密码' : '不填则使用手机号后6位'" />
                <div :class="fieldErrorClass(state.candidateFormErrors.password)">{{ state.candidateFormErrors.password || '' }}</div>
              </label>
              <label class="col-span-2 text-xs font-bold text-slate-600">
                <span class="flex items-center gap-2">描述 <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">选填</span></span>
                <textarea v-model="state.candidateForm.description" rows="4" class="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-ink" placeholder="选填"></textarea>
              </label>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeParticipantModal">取消</button>
            <button type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.candidateSubmitting">
              {{ state.candidateSubmitting ? '保存中' : '保存' }}
            </button>
          </div>
        </form>
      </div>
      <div v-if="state.confirmDeleteParticipant" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认删除参与者</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">删除后该参与者会从基础信息列表中移除。确认删除「{{ state.confirmDeleteParticipant.candidate }}」吗？</div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeleteParticipant = null">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white" @click="confirmDeleteParticipant">确认删除</button>
          </div>
        </div>
      </div>
      <div v-if="state.confirmDeleteSelectedParticipants" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
          <div class="text-lg font-black">确认批量删除</div>
          <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">将删除已选择的 {{ state.selectedParticipantTickets.length }} 条参与者信息。该操作需要重新添加才能恢复。</div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeleteSelectedParticipants = false">取消</button>
            <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white" @click="confirmDeleteSelectedParticipants">确认删除</button>
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
    </main>
  `,
});

app.mount("#app");

function currentRoute() {
  const { route } = parseHashRoute();
  return ["authoring", "papers", "participants", "assignments", "proctor", "candidate", "analysis"].includes(route) ? route : "home";
}

function currentAuthoringPaperId() {
  const { route, params } = parseHashRoute();
  return route === "authoring" ? params.get("paperid") || params.get("paperId") || params.get("papeid") || "" : "";
}

function currentCandidateSessionId() {
  const { route, params } = parseHashRoute();
  return route === "candidate" ? params.get("session") || "" : "";
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

function formatDateTimeFull(value) {
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

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function proctorEventTypeText(type) {
  return {
    "proctor-event": "监考风险",
    "exam-submit": "提交试卷",
    "answer-save": "保存答题",
  }[type] || type || "事件";
}

function parseCandidateFromMessage(message = "") {
  return String(message).split(/[：:]/)[0] || "";
}

function downloadExcelTable(sheetName, rows, filename) {
  const headers = Object.keys(rows[0] || {});
  const table = [
    "<table>",
    "<thead><tr>",
    ...headers.map((header) => `<th>${escapeHtml(header)}</th>`),
    "</tr></thead>",
    "<tbody>",
    ...rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? "")}</td>`).join("")}</tr>`),
    "</tbody>",
    "</table>",
  ].join("");
  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
          th { background: #12201f; color: #ffffff; font-weight: 700; }
          th, td { border: 1px solid #d9e2e1; padding: 6px 8px; mso-number-format:"\\@"; }
        </style>
      </head>
      <body>
        <h3>${escapeHtml(sheetName)}</h3>
        ${table}
      </body>
    </html>
  `;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function dateStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
}

function defaultDateTimeLocal(hour, minute) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
