import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.VERIFY_PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "smartq-verify-"));
const runtimeFile = join(runtimeDir, "runtime.json");
const backupDir = join(runtimeDir, "backups");
const materialDir = join(runtimeDir, "materials");
let adminHeaders = {};
let output = "";
const retiredInitialPasswordFlag = ["must", "ChangePassword"].join("");

await verifyLegacyAdminNormalization();

const server = spawn(process.execPath, ["backend/server.js"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    SMARTQ_DATA_FILE: runtimeFile,
    SMARTQ_BACKUP_DIR: backupDir,
    SMARTQ_MATERIAL_DIR: materialDir,
    SMARTQ_BACKUP_RETENTION: "5",
    SMARTQ_BACKUP_MIN_INTERVAL_SECONDS: "0",
    SMARTQ_MAX_REQUEST_BYTES: String(128 * 1024),
    SMARTQ_ADMIN_ACCOUNTS: JSON.stringify([
      { username: "verify-admin", password: "123456" },
      { username: "verify-user", password: "User@2026", role: "author" },
    ]),
    SMARTQ_LOGIN_MAX_FAILURES: "2",
    SMARTQ_LOGIN_WINDOW_SECONDS: "60",
    SMARTQ_LOGIN_LOCK_SECONDS: "30",
    AI_MOCK_MODE: "true",
  },
});

server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForHealth();

  const health = await getJson("/api/health");
  assert(health.ok === true && health.aiReady === true && health.mode === "mock", "health exposes the reduced service and AI status");
  assert(health.storage.adapter === "json-file" && health.storage.degraded === false, "health exposes JSON runtime storage");
  assert(!("proctor" in health) && !("evidence" in health), "health no longer exposes retired monitoring services");
  assert(health.limits.maxRequestBytes === 128 * 1024, "health exposes request body limit");
  assert(health.limits.materialFileMaxBytes === 8 * 1024 * 1024, "health exposes the configured material upload limit");

  const shell = await getText("/");
  assert(shell.includes('<div id="app"') && shell.includes('type="module"') && shell.includes("./assets/"), "root serves the Vite-built Vue app shell");
  const nestedShell = await getText("/smartq/");
  assert(nestedShell.includes('<div id="app"') && nestedShell.includes("./assets/"), "subdirectory path serves the Vite-built Vue app shell");
  const frontendFiles = [
    "vite.config.js",
    "frontend/src/main.js",
    "frontend/src/App.vue",
    "frontend/src/components/ConfirmDeleteDialog.vue",
    "frontend/src/components/ConsoleShell.vue",
    "frontend/src/components/PaperDetailDrawer.vue",
    "frontend/src/components/QuestionBankPicker.vue",
    "frontend/src/components/QuestionEditorDialog.vue",
    "frontend/src/core/public-path.js",
    "frontend/src/core/router.js",
    "frontend/src/pages/AuthoringPage.vue",
    "frontend/src/pages/LoginPage.vue",
    "frontend/src/pages/MaterialsPage.vue",
    "frontend/src/pages/PapersPage.vue",
    "frontend/src/pages/ProfilePage.vue",
    "frontend/src/pages/QuestionBankPage.vue",
    "frontend/src/pages/UsersPage.vue",
    "frontend/src/stores/app-store.js",
    "frontend/src/stores/authoring-store.js",
    "frontend/src/stores/auth-store.js",
    "frontend/src/stores/layout-store.js",
    "frontend/src/stores/materials-store.js",
    "frontend/src/stores/papers-store.js",
    "frontend/src/stores/question-bank-store.js",
    "frontend/src/stores/users-store.js",
    "frontend/src/styles/index.css",
  ];
  const frontendSources = await Promise.all(frontendFiles.map((path) => readFile(path, "utf8")));
  const frontend = frontendSources.join("\n");
  const backendFiles = [
    "backend/server.js",
    "backend/lib/ai.js",
    "backend/routes/index.js",
    "backend/routes/authoring.js",
    "backend/routes/materials.js",
    "backend/routes/papers.js",
    "backend/routes/question-bank.js",
    "backend/services/generation-service.js",
    "backend/services/material-service.js",
    "backend/services/question-bank-service.js",
    "backend/services/question-bank-category-service.js",
    "backend/lib/question-bank-categories.js",
    "backend/services/admin-user-service.js",
    "backend/services/auth-service.js",
    "backend/services/authoring-workspace-service.js",
  ];
  const backend = (await Promise.all(backendFiles.map((path) => readFile(path, "utf8")))).join("\n");
  assert(frontend.includes('createApp(App)') && frontend.includes('app.mount("#app")') && frontend.includes("ElementPlusResolver"), "frontend mounts Vue 3 with on-demand Element Plus components");
  assert(frontend.includes("<script setup>") && frontend.includes("<el-form") && frontend.includes("<el-button"), "frontend pages use Vue SFC and Element Plus controls");
  assert(frontend.includes("<el-table") && frontend.includes("<el-drawer") && frontend.includes("<el-dialog"), "tables, drawers, and dialogs use Element Plus components");
  assert(frontend.includes('aria-label="管理功能导航"') && frontend.includes('data-admin-route-content'), "frontend keeps the management sidebar layout");
  assert(frontend.includes("智能命题与试卷管理") && frontend.includes("智能命题工作台") && !frontend.includes("考试与测评管理平台"), "product positioning matches the authoring and paper-management scope");
  assert(frontend.includes("SmartQ 内容管理控制台") && frontend.includes("内容管理入口") && !/SmartQ 运营控制台|运营管理入口|管理运营控制台/.test(frontend), "control-panel wording does not imply retired operations capabilities");
  assert(frontend.includes("toggleSidebar") && frontend.includes("smartqSidebarCollapsed"), "desktop sidebar can collapse and persist its state");
  assert(frontend.includes("requestFullscreen") && frontend.includes("fullscreenchange"), "header exposes synchronized fullscreen controls");
  assert(frontend.includes('value: "system"') && frontend.includes("prefers-color-scheme: dark"), "theme defaults to the system preference");
  assert(frontend.includes("<el-switch") && frontend.includes("active-action-icon") && frontend.includes("inactive-action-icon"), "header uses the Element Plus style sun and moon theme switch");
  assert(frontend.includes("document.startViewTransition") && frontend.includes("Math.hypot") && frontend.includes("clipPath"), "theme switch reveals the new theme with a viewport-filling circle");
  assert(frontend.includes("::view-transition-new(root)") && frontend.includes("prefers-reduced-motion: reduce"), "theme reveal targets the new root view and respects reduced motion");
  assert(frontend.includes('nextDark ? "100% 0%" : "0% 100%"') && frontend.includes("circle(0px at ${transitionOrigin})"), "theme reveal anchors its first frame to the transition layer's top-right or bottom-left corner");
  assert(frontend.includes('@command="handleThemePreference"') && frontend.includes("setTheme(theme, { animate: true })"), "theme preference menu reuses the circular reveal with the fixed corner origin");
  assert(frontend.includes("--el-bg-color: #171a21") && frontend.includes("--el-border-color-lighter: #2a303b"), "Element Plus dark theme uses the neutral charcoal palette");
  assert(frontend.includes("html.dark") && frontend.includes("dark:bg-night-surface"), "theme switching updates Element Plus and application surfaces");
  assert(!frontend.includes(":global(html.dark)"), "dark descendant rules stay out of scoped styles");
  const frontendAssets = await readdir("frontend/dist/assets");
  const builtCssFiles = frontendAssets.filter((name) => name.endsWith(".css"));
  const builtCss = (await Promise.all(builtCssFiles.map((name) => readFile(join("frontend/dist/assets", name), "utf8")))).join("\n");
  assert(builtCss.includes("html.dark .login-art-skyline") && builtCss.includes("html.dark .smartq-menu"), "built dark rules keep their descendant selectors");
  assert(!/html\.dark\{[^}]*opacity:\s*\.2/.test(builtCss), "built CSS never dims the entire dark document");
  assert(/\.el-notification\{[^}]*position:fixed/.test(builtCss), "Element Plus notification positioning styles are included in the production build");
  assert(frontend.includes("个人资料") && frontend.includes("/api/admin/profile/avatar"), "profile page supports persistent avatar updates");
  assert(frontend.includes('@update:model-value="updateAdminDisplayName"') && frontend.includes('.slice(0, maxAdminDisplayNameLength)'), "profile display names are clamped in application state instead of relying only on native maxlength");
  assert(frontend.includes("ElNotification.success") && frontend.includes("ElNotification.error") && frontend.includes("notifyProfileSaveError(state.profile.error)"), "profile saves show typed Element Plus notifications for success and validation or request failures");
  assert(frontend.includes("state.admin.user?.avatar || publicUrl('/assets/default_avatar.jpg')") && frontend.includes("state.profile.avatarPreview || publicUrl('/assets/default_avatar.jpg')") && frontend.includes("row.avatar || publicUrl('/assets/default_avatar.jpg')"), "users without uploaded avatars display default_avatar.jpg by default");
  assert(frontend.includes("用户管理") && frontend.includes("/api/admin/users") && frontend.includes("重置密码"), "admin user management UI is available");
  assert(!frontend.includes("测试账号") && !frontend.includes("密码：123456"), "login page does not expose plaintext test credentials");
  assert(frontend.includes("登录账号需为 3-32 位字母、数字、点、下划线或连字符") && frontend.includes("密码必须同时包含字母和数字") && frontend.includes("两次输入的密码不一致"), "user forms validate account format, password strength, and repeated passwords");
  assert(!frontend.includes("全部角色") && !frontend.includes('label="角色"') && !frontend.includes("adminRoleLabel"), "role controls and labels are removed from the frontend");
  assert((frontend.match(/append-to-body/g) || []).length >= 2, "user management dialogs attach overlays to the document body");
  assert(frontend.includes('active-value="active"') && frontend.includes('inactive-value="disabled"') && frontend.includes("statusUpdatingId"), "user status switches use Element Plus active, inactive, disabled, and loading states");
  assert(frontend.includes("/api/admin/password"), "profile page keeps voluntary password changes");
  assert(!frontend.includes(retiredInitialPasswordFlag) && !/首次登录.*修改.*密码|初始密码/.test(frontend), "frontend removes the initial-password change policy and UI");
  assert(!backend.includes(retiredInitialPasswordFlag) && !backend.includes("请先修改初始密码"), "backend removes the initial-password field and API gate");
  assert(frontend.includes("await uploadAdminAvatar(file)") && frontend.includes("用户头像已更新"), "valid avatar selection uploads immediately");
  assert((frontend.match(/restoreDefaultAdminAvatar/g) || []).length >= 6 && frontend.includes('method: "DELETE"') && frontend.includes("恢复默认头像"), "profile page wires the default-avatar reset action through the app context");
  assert(frontend.includes("确认退出当前账号") && frontend.includes("确认恢复默认头像") && frontend.includes("确认丢弃") && frontend.includes("确认清空题库题配置"), "logout, avatar reset, generated-draft discard, and question-bank plan clearing require confirmation");
  assert(frontend.includes("100 * 1024") && frontend.includes("width !== dimensions.height"), "avatar selection enforces 100KB square images");
  assert(frontend.includes('window.scrollTo({ top: 0, left: 0, behavior: "auto" });'), "frontend resets scroll on module switches");
  assert(frontend.includes("出题制卷") && frontend.includes("试卷管理") && !frontend.includes("已出卷子"), "frontend uses consistent authoring and paper-management wording");
  assert(frontend.indexOf('{ key: "papers"') < frontend.indexOf('{ key: "authoring"'), "paper management is the first navigation item");
  assert(frontend.includes('return ["authoring", "papers", "question-bank", "materials", "users", "profile"].includes(route) ? route : "papers";'), "papers is the default route and content-management routes are routable");
  assert(frontend.includes('if (route === "papers") return "";'), "papers uses the root URL");
  assert(frontend.includes('@select="(index) => go(index)"'), "desktop navigation passes only the selected route key");
  assert(!/控制台首页|数据维护|运营会话|审计日志|自动备份历史/.test(frontend), "frontend removes the console homepage and maintenance UI");
  assert(!/参与者管理|试卷分配|监考工作台|阅卷分析|考生系统/.test(frontend), "frontend removes retired navigation and pages");
  assert(!/#\/candidate|\/api\/candidate\/|\/api\/participants|\/api\/assignments|\/api\/proctor|\/api\/grading|\/api\/analysis/.test(frontend), "frontend removes retired routes and API calls");
  assert(frontend.includes("cleanupLegacyServiceWorkers") && frontend.includes("registration.unregister()"), "frontend still clears legacy service workers");
  assert(frontend.includes("paperTypeConfig") && frontend.includes("computedSpecTotalScore"), "frontend keeps paper score calculation");
  assert(!frontend.includes("质量复检") && !frontend.includes('key: "quality"'), "authoring UI hides quality review as a workflow step");
  assert(!frontend.includes('key: "save"') && !frontend.includes("savePaper"), "authoring removes the visible save-paper step and action");
  assert(frontend.includes("generationStageForProgress") && !frontend.includes("连接 AI 出题服务"), "generation progress uses stable progress-based stage text");
  assert(frontend.includes("dashboardRequestSequence") && frontend.includes("detailRequestSequence"), "dashboard and paper detail responses ignore stale requests");
  assert(frontend.includes("smartq:unauthorized") && frontend.includes("resetSessionState"), "global unauthorized responses clear session-scoped application state");
  assert(frontend.includes('paperId: state.authoringPaperId || ""') && !frontend.includes('paperId: state.authoringPaperId || state.dashboard?.paper?.id'), "new-paper saves never fall back to the active paper id");
  assert(frontend.includes("pageSize=1000") && !frontend.includes("filter((id) => validIds.has(id))"), "material selector loads beyond the first 100 items without dropping retained selections");
  assert(frontend.includes("publishQualityFailures") && frontend.includes("暂未发布") && frontend.includes("editPublishIssue"), "publish failures stay visible with actionable wording and link to question editing");
  assert(frontend.includes("data-authoring-workbench") && frontend.includes("data-authoring-summary") && frontend.includes("data-authoring-action-bar"), "authoring uses the dense workbench, summary, and action bar layout");
  assert(frontend.includes("data-question-type-matrix") && frontend.includes("typeMatrixRows") && frontend.includes("试卷编辑"), "authoring keeps the compact type matrix and direct question editing flow");
  assert(frontend.includes('key: "edit"') && !/人工审核|待审核|通过并继续|取消审核|确认并审核/.test(frontend), "authoring removes per-question review controls and wording");
  assert(frontend.includes("按原来源重新生成") && frontend.includes("重新生成干扰项") && frontend.includes("自定义 AI 修改") && frontend.includes("应用修改"), "question editor exposes clear AI regeneration, distractor, custom prompt, and candidate application controls");
  assert(frontend.includes("moveQuestionOption") && frontend.includes("moveSingleCorrectAnswer") && frontend.includes("undoQuestionAiChange"), "question editor supports answer-safe option movement and AI undo");
  assert(frontend.includes("questionSaving") && frontend.includes("requestCloseQuestionEditor"), "question editing prevents duplicate saves and protects unsaved changes");
  assert(frontend.includes('paperPageSize: 20') && frontend.includes('aria-label="试卷状态筛选"'), "paper management uses the Element Plus list controls");
  assert(frontend.includes('aria-label="试卷详情抽屉"') && frontend.includes("paperDetailMode"), "paper details open in the responsive drawer");
  assert(
    frontend.includes('size="min(1080px, 100vw)"')
      && frontend.includes('<el-button link type="primary" :icon="Edit" @click="editPaper(row)">编辑</el-button>')
      && frontend.includes('<el-button link :icon="View" @click="selectPaper(row.id)">预览</el-button>')
      && !frontend.includes("state.selectedPaperDetail.status !== '已发布'"),
    "draft and published papers share edit, preview, and delete actions in the wider drawer flow",
  );
  assert((frontend.match(/if \(state\.selectedPaperId\) clearSelectedPaper\(\);/g) || []).length >= 2, "route changes close an open paper detail drawer");
  assert(frontend.includes("出题资料管理") && frontend.includes("/api/materials/upload") && frontend.includes("data-question-source-plan"), "frontend exposes material management and source allocation");
  assert(frontend.includes("questionBankQuestionCount") && frontend.includes("不引用题库或资料，按命题要求自动补齐") && frontend.includes("资料依据"), "authoring config and editing expose unified source allocation and traceability");
  assert(frontend.includes("题库管理") && frontend.includes("data-question-bank-page") && frontend.includes("设置题库题"), "frontend exposes question bank management and category-based paper selection");
  assert(frontend.includes("自动均衡") && frontend.includes("手动分配") && frontend.includes("分类题量不足时由 AI 补齐"), "question-bank picker exposes simple category allocation and shortage behavior");
  assert(frontend.includes("['易', '中', '难', '混合']") && !frontend.includes("试卷分类"), "paper difficulty is ordered low to high and paper classification is removed");
  assert(frontend.includes("确认归档") && frontend.includes("确认恢复") && frontend.includes("ElMessageBox.confirm"), "question bank archive and restore require explicit confirmation");
  assert(frontend.includes("当前解析结果将被新的解析结果替换") && frontend.includes("此操作会立即修改题目的分类归属"), "material reparsing and destructive bulk category changes describe their impact before confirmation");
  assert(frontend.includes("deletingPaperId") && frontend.includes("删除后无法恢复"), "paper deletion exposes irreversible impact and blocks duplicate submission");
  assert(frontend.includes("mobile-category-actions"), "question-bank category actions remain available on mobile");
  assert(
    [
      "requestCloseAdminUserEditor",
      "requestCloseMaterialEditor",
      "requestCloseQuestionBankEditor",
      "requestCloseQuestionBankCategoryEditor",
    ].every((name) => frontend.includes(name)),
    "user, material, question-bank item, and category editors protect unsaved changes",
  );
  assert(frontend.includes("未分类") && frontend.includes("多分类题目") && frontend.includes("批量设置分类"), "question bank frontend exposes category tree and bulk classification");
  assert(frontend.includes("当前试卷全部题目入库") && frontend.includes("全部题目入库") && frontend.includes("加入题库"), "editing and paper detail surfaces accurately describe adding questions to the bank");
  assert(frontend.includes("显示名称") && frontend.includes("末级分类") && frontend.includes("AI 生成题") && !/用户名|叶子分类|AI 独立题|迷惑项/.test(frontend), "frontend uses the approved display-name, category, and AI-question glossary");
  assert(frontend.includes("没有符合当前条件的试卷") && frontend.includes("没有符合当前条件的题目") && frontend.includes("没有符合当前条件的资料") && frontend.includes("没有符合当前条件的用户"), "list pages distinguish empty data from filtered no-results states");
  assert(backend.includes("publicAiErrorMessage") && backend.includes("服务暂时不可用，请稍后重试") && !backend.includes('error: "Question Not Found"') && !backend.includes('error: "Paper Not Found"'), "backend returns safe Chinese messages for AI, server, paper, and question errors");
  assert(backend.includes("questionContentHash") && backend.includes("questionBankUsageMap") && backend.includes("resolveGenerationQuestionBank"), "backend implements question deduplication, usage relations, and unified bank-question generation");
  assert(backend.includes("questionBankCategories") && backend.includes("validateActiveLeafCategories") && backend.includes("questionBankRequestedCount"), "backend implements hierarchical bank categories and category-based sampling");

  const blockedDashboard = await getJson("/api/dashboard", { expectedStatus: 401 });
  assert(blockedDashboard.error.includes("内容管理控制台"), "dashboard requires admin login");
  const blockedProfile = await putJson("/api/admin/profile", { displayName: "unauthorized" }, { expectedStatus: 401 });
  assert(blockedProfile.error.includes("内容管理控制台"), "profile updates require admin login");
  const blockedAvatarReset = await requestJson("/api/admin/profile/avatar", { method: "DELETE", expectedStatus: 401 });
  assert(blockedAvatarReset.error.includes("内容管理控制台"), "avatar reset requires admin login");
  const blockedUsers = await getJson("/api/admin/users", { expectedStatus: 401 });
  assert(blockedUsers.error.includes("内容管理控制台"), "user management requires login");
  const oversizedLogin = await postJson("/api/admin/login", { username: "x".repeat(140 * 1024), password: "x" }, { expectedStatus: 413 });
  assert(oversizedLogin.error.includes("请求体过大"), "oversized JSON is rejected");

  await postJson("/api/admin/login", { username: "missing", password: "wrong" }, { expectedStatus: 401 });
  await postJson("/api/admin/login", { username: "missing", password: "wrong" }, { expectedStatus: 401 });
  const blockedLogin = await postJson("/api/admin/login", { username: "missing", password: "wrong" }, { expectedStatus: 429 });
  assert(blockedLogin.retryAfterSeconds > 0, "admin login rate limit remains active");

  const adminLogin = await postJson("/api/admin/login", { username: "verify-admin", password: "123456" });
  adminHeaders = authHeaders(adminLogin.token);
  assert(!("role" in adminLogin.admin) && !("roleLabel" in adminLogin.admin) && !("permissions" in adminLogin.admin), "login responses omit retired role metadata");
  const adminMe = await getJson("/api/admin/me", { headers: adminHeaders });
  assert(adminMe.admin.username === "verify-admin", "admin token loads current user");
  assert(adminMe.admin.displayName === "verify-admin" && adminMe.admin.avatar === "", "admin profile has stable defaults");
  const rejectedLongProfile = await putJson("/api/admin/profile", { displayName: "用".repeat(33) }, { headers: adminHeaders, expectedStatus: 400 });
  assert(rejectedLongProfile.error.includes("32"), "admin profile rejects display names longer than 32 characters");
  const updatedProfile = await putJson("/api/admin/profile", { displayName: "验证管理员" }, { headers: adminHeaders });
  assert(updatedProfile.admin.displayName === "验证管理员", "admin display name can be updated");
  const squareAvatar = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const updatedAvatar = await putRaw("/api/admin/profile/avatar", squareAvatar, { headers: { ...adminHeaders, "content-type": "image/png" } });
  assert(updatedAvatar.admin.avatar.startsWith("data:image/png;base64,"), "square avatar is persisted as an admin profile image");
  const nonSquareAvatar = Buffer.from(squareAvatar);
  nonSquareAvatar.writeUInt32BE(2, 16);
  const rejectedAvatar = await putRaw("/api/admin/profile/avatar", nonSquareAvatar, { headers: { ...adminHeaders, "content-type": "image/png" }, expectedStatus: 400 });
  assert(rejectedAvatar.error.includes("方形"), "non-square avatar is rejected");
  const oversizedAvatar = await putRaw("/api/admin/profile/avatar", Buffer.alloc(100 * 1024 + 1), { headers: { ...adminHeaders, "content-type": "image/png" }, expectedStatus: 413 });
  assert(oversizedAvatar.error.includes("100 KB"), "avatar upload rejects files over 100KB");
  const persistedProfile = await getJson("/api/admin/me", { headers: adminHeaders });
  assert(persistedProfile.admin.displayName === "验证管理员" && persistedProfile.admin.avatar === updatedAvatar.admin.avatar, "profile changes persist across session reads");
  let persistedRuntime = JSON.parse(await readFile(runtimeFile, "utf8"));
  const persistedAdmin = persistedRuntime.adminUsers?.find((user) => user.username === "verify-admin");
  assert(persistedAdmin?.avatar === updatedAvatar.admin.avatar, "avatar is persisted on the unified admin user record");
  const resetAvatar = await requestJson("/api/admin/profile/avatar", { method: "DELETE", headers: adminHeaders });
  assert(resetAvatar.admin.avatar === "", "custom avatar can be reset to the default avatar");
  const resetProfile = await getJson("/api/admin/me", { headers: adminHeaders });
  assert(resetProfile.admin.avatar === "", "default avatar state persists across session reads");
  persistedRuntime = JSON.parse(await readFile(runtimeFile, "utf8"));
  assert(persistedRuntime.adminUsers?.find((user) => user.username === "verify-admin")?.avatar === "", "avatar reset is persisted on the unified admin user record");
  assert(persistedRuntime.adminUsers.every((user) => user.passwordHash.startsWith("scrypt$") && !("password" in user)), "runtime users contain password hashes without plaintext passwords");
  assert(persistedRuntime.adminUsers.every((user) => !("role" in user)), "runtime users no longer persist role fields");
  assert(persistedRuntime.adminUsers.every((user) => !(retiredInitialPasswordFlag in user)), "runtime users no longer persist the retired password-policy field");

  const initialUsers = await getJson("/api/admin/users", { headers: adminHeaders });
  assert(initialUsers.total === 2 && !("roles" in initialUsers), "authenticated users can list bootstrapped accounts without role metadata");
  assert(initialUsers.users.every((user) => !("passwordHash" in user) && !("role" in user)), "user management responses expose neither password hashes nor roles");
  const selfUpdate = await patchJson(`/api/admin/users/${adminMe.admin.id}`, { status: "disabled" }, { headers: adminHeaders, expectedStatus: 409 });
  assert(selfUpdate.error.includes("不能停用自己"), "a user cannot disable their own account");

  const createdUser = await postJson("/api/admin/users", {
    username: "managed-user",
    displayName: "受管用户",
    password: "Managed@2026",
  }, { headers: adminHeaders, expectedStatus: 201 });
  assert(createdUser.user.status === "active" && !(retiredInitialPasswordFlag in createdUser.user), "new users start active without password-change metadata");
  await postJson("/api/admin/users", {
    username: "managed-user",
    displayName: "重复用户",
    password: "Managed@2026",
  }, { headers: adminHeaders, expectedStatus: 409 });
  const filteredUsers = await getJson("/api/admin/users?search=managed&page=1&pageSize=10", { headers: adminHeaders });
  assert(filteredUsers.total === 1 && filteredUsers.users[0].id === createdUser.user.id, "user list supports server-side search and pagination");

  const managedLogin = await postJson("/api/admin/login", { username: "managed-user", password: "Managed@2026" });
  const managedHeaders = authHeaders(managedLogin.token);
  assert(!(retiredInitialPasswordFlag in managedLogin.admin), "new user login omits retired password-change metadata");
  await getJson("/api/dashboard", { headers: managedHeaders });
  await getJson("/api/admin/users", { headers: managedHeaders });
  const changedPassword = await putJson("/api/admin/password", {
    currentPassword: "Managed@2026",
    newPassword: "Managed@2027",
  }, { headers: managedHeaders });
  assert(!(retiredInitialPasswordFlag in changedPassword.admin), "users can voluntarily update their password without policy metadata");
  await getJson("/api/dashboard", { headers: managedHeaders });

  const renamedUser = await patchJson(`/api/admin/users/${createdUser.user.id}`, {
    displayName: "受管账号",
    role: "admin",
  }, { headers: adminHeaders });
  assert(renamedUser.user.displayName === "受管账号" && !("role" in renamedUser.user), "user profile updates ignore legacy role payloads");
  const managedMe = await getJson("/api/admin/me", { headers: managedHeaders });
  assert(managedMe.admin.displayName === "受管账号", "profile-only user updates keep existing sessions valid");

  const resetUser = await postJson(`/api/admin/users/${createdUser.user.id}/reset-password`, { password: "Reset@2028" }, { headers: adminHeaders });
  assert(!(retiredInitialPasswordFlag in resetUser.user) && resetUser.revokedSessions >= 1, "password reset revokes sessions without adding password-change metadata");
  await getJson("/api/dashboard", { headers: managedHeaders, expectedStatus: 401 });
  const resetLogin = await postJson("/api/admin/login", { username: "managed-user", password: "Reset@2028" });
  const resetHeaders = authHeaders(resetLogin.token);
  await getJson("/api/dashboard", { headers: resetHeaders });
  const disabledUser = await patchJson(`/api/admin/users/${createdUser.user.id}`, { status: "disabled" }, { headers: adminHeaders });
  assert(disabledUser.user.status === "disabled", "admin can disable another user");
  await getJson("/api/admin/me", { headers: resetHeaders, expectedStatus: 401 });
  await postJson("/api/admin/login", { username: "managed-user", password: "Reset@2028" }, { expectedStatus: 403 });

  const secondUserLogin = await postJson("/api/admin/login", { username: "verify-user", password: "User@2026" });
  const secondUserHeaders = authHeaders(secondUserLogin.token);
  await getJson("/api/admin/users", { headers: secondUserHeaders });
  const revokedSecondUser = await postJson(`/api/admin/users/${secondUserLogin.admin.id}/revoke-sessions`, {}, { headers: adminHeaders });
  assert(revokedSecondUser.revokedSessions >= 1, "one user can force another user offline");
  await getJson("/api/dashboard", { headers: secondUserHeaders, expectedStatus: 401 });
  const secondUserRelogin = await postJson("/api/admin/login", { username: "verify-user", password: "User@2026" });
  const contentUserHeaders = authHeaders(secondUserRelogin.token);

  persistedRuntime = JSON.parse(await readFile(runtimeFile, "utf8"));
  assert(persistedRuntime.auditLog.some((item) => item.type === "admin-user-password-reset"), "user management changes are audited");

  const retiredEndpoints = [
    ["GET", "/api/participants"],
    ["GET", "/api/assignments"],
    ["GET", "/api/proctor/sessions"],
    ["GET", "/api/candidate/exams"],
    ["GET", "/api/grading/export"],
    ["GET", "/api/analysis"],
    ["POST", "/api/candidate/login"],
    ["GET", "/api/admin/sessions"],
    ["DELETE", "/api/admin/sessions/legacy-session"],
    ["GET", "/api/admin/audit"],
    ["GET", "/api/admin/storage"],
    ["GET", "/api/admin/ops"],
    ["GET", "/api/admin/backup"],
    ["GET", "/api/admin/backups"],
    ["GET", "/api/admin/backups/runtime-old.json"],
    ["POST", "/api/admin/restore"],
  ];
  for (const [method, path] of retiredEndpoints) {
    const result = await requestJson(path, { method, headers: adminHeaders, body: method === "POST" ? {} : undefined, expectedStatus: 404 });
    assert(result.error === "请求的接口不存在", `${method} ${path} is retired`);
  }

  const missingPaper = await getJson("/api/papers/missing-paper", { headers: adminHeaders, expectedStatus: 404 });
  assert(missingPaper.error.includes("试卷不存在"), "missing papers return actionable Chinese errors");
  const missingQuestion = await postJson("/api/questions/missing-question/ai-transform", { operation: "regenerate" }, { headers: adminHeaders, expectedStatus: 404 });
  assert(missingQuestion.error.includes("题目不存在"), "missing questions return actionable Chinese errors");

  const freshDashboard = await getJson("/api/dashboard", { headers: adminHeaders });
  assert(freshDashboard.questions.length === 0 && freshDashboard.papers.length === 0, "fresh dashboard starts without content");
  assert(!("participants" in freshDashboard) && !("sessions" in freshDashboard) && !("analysis" in freshDashboard), "dashboard omits retired domain payloads");

  const rootCategories = await postJson("/api/question-bank/categories", { name: "专业能力", sortOrder: 10 }, { headers: contentUserHeaders, expectedStatus: 201 });
  const rootCategory = rootCategories.items.find((item) => item.name === "专业能力");
  const frontendCategories = await postJson("/api/question-bank/categories", { name: "前端基础", parentId: rootCategory.id, sortOrder: 10 }, { headers: contentUserHeaders, expectedStatus: 201 });
  const frontendCategory = frontendCategories.items.find((item) => item.name === "前端基础");
  const backendCategories = await postJson("/api/question-bank/categories", { name: "后端基础", parentId: rootCategory.id, sortOrder: 20 }, { headers: contentUserHeaders, expectedStatus: 201 });
  const backendCategory = backendCategories.items.find((item) => item.name === "后端基础");
  const categoryTree = await getJson("/api/question-bank/categories", { headers: contentUserHeaders });
  assert(categoryTree.tree[0].children.length === 2 && categoryTree.items.every((item) => item.depth <= 3), "question bank categories expose a sorted tree with bounded depth");
  const unclassifiedPaperGeneration = await postJson("/api/ai/generate-questions", {
    paperName: "无分类试卷",
    direction: "分类校验",
    typeCounts: { judge: 1 },
    typeScores: { judge: 2 },
    sourcePlan: {},
  }, { headers: contentUserHeaders, expectedStatus: 202 });
  const unclassifiedPaperJob = await waitForGenerationJob(unclassifiedPaperGeneration.id, contentUserHeaders);
  assert(unclassifiedPaperJob.status === "done" && !("categoryId" in unclassifiedPaperJob.result.spec), "generation succeeds without paper classification");

  const manualBankQuestion = await postJson("/api/question-bank", {
    type: "判断",
    stem: "题库中的题目加入试卷后，修改题库会自动覆盖已经发布的试卷。",
    answer: "错误",
    defaultScore: 2,
    difficulty: "中",
    knowledge: ["题库管理"],
    tags: ["快照"],
    explanation: "试卷保存独立题目快照。",
    status: "待确认",
    categoryIds: [frontendCategory.id],
  }, { headers: contentUserHeaders, expectedStatus: 201 });
  assert(manualBankQuestion.status === "已校验" && manualBankQuestion.version === 1, "manual bank questions are validated immediately even when a legacy client submits pending status");
  await postJson("/api/question-bank", {
    type: "判断",
    stem: "题库中的题目加入试卷后，修改题库会自动覆盖已经发布的试卷。",
    answer: "错误",
    defaultScore: 20,
    difficulty: "难",
    categoryIds: [frontendCategory.id],
  }, { headers: contentUserHeaders, expectedStatus: 409 });
  await postJson("/api/question-bank", {
    type: "判断",
    stem: "题库中的题目加入试卷后，修改题库会自动覆盖已经发布的试卷。",
    answer: "正确",
    defaultScore: 2,
    difficulty: "中",
    categoryIds: [frontendCategory.id],
  }, { headers: contentUserHeaders, expectedStatus: 409 });
  const bankList = await getJson("/api/question-bank?page=1&pageSize=20", { headers: contentUserHeaders });
  assert(bankList.total === 1 && bankList.items[0].id === manualBankQuestion.id, "newly created bank questions are immediately available in the default list");
  const updatedBankQuestion = await patchJson(`/api/question-bank/${manualBankQuestion.id}`, {
    stem: "题库中的题目加入试卷后，修改题库不会自动覆盖已经发布的试卷。",
    answer: "正确",
  }, { headers: contentUserHeaders });
  assert(updatedBankQuestion.version === 2, "question content changes increment the bank version");
  const updatedBankDetail = await getJson(`/api/question-bank/${manualBankQuestion.id}`, { headers: contentUserHeaders });
  assert(updatedBankDetail.revisions.length === 2, "question bank keeps version history");
  const archivedBankQuestion = await postJson(`/api/question-bank/${manualBankQuestion.id}/archive`, {}, { headers: contentUserHeaders });
  assert(archivedBankQuestion.status === "已归档", "question bank item can be archived");
  const restoredBankQuestion = await postJson(`/api/question-bank/${manualBankQuestion.id}/restore`, {}, { headers: contentUserHeaders });
  assert(restoredBankQuestion.status === "已校验", "restoring a bank question makes it immediately available again");

  const backendBankQuestion = await postJson("/api/question-bank", {
    type: "单选",
    stem: "JavaScript 中用于声明不可重新赋值绑定的关键字是？",
    options: ["const", "var", "with", "delete"],
    answer: "A",
    defaultScore: 2,
    difficulty: "易",
    knowledge: ["JavaScript"],
    categoryIds: [backendCategory.id],
  }, { headers: contentUserHeaders, expectedStatus: 201 });
  const categoryCoverage = await getJson("/api/question-bank/categories", { headers: contentUserHeaders });
  assert(categoryCoverage.items.find((item) => item.id === frontendCategory.id)?.typeCounts?.["判断"] === 1, "category summaries expose type coverage for simple configuration");
  const balancedPreview = await postJson("/api/question-bank/selection-preview", {
    sourcePlan: { questionBankRequestedCount: 2, questionBankCategoryIds: [frontendCategory.id, backendCategory.id], questionBankAllocationMode: "balanced" },
    spec: { typeCounts: { single: 1, judge: 1 } },
  }, { headers: contentUserHeaders });
  assert(balancedPreview.selectedCount === 2 && balancedPreview.allocations.every((item) => item.count === 1), "balanced category allocation selects the requested bank count");
  const manualPreview = await postJson("/api/question-bank/selection-preview", {
    sourcePlan: {
      questionBankRequestedCount: 1,
      questionBankCategoryIds: [frontendCategory.id, backendCategory.id],
      questionBankAllocationMode: "manual",
      questionBankAllocations: [{ categoryId: frontendCategory.id, count: 0 }, { categoryId: backendCategory.id, count: 1 }],
    },
    spec: { typeCounts: { single: 1, judge: 1 } },
  }, { headers: contentUserHeaders });
  assert(manualPreview.selectedCount === 1 && manualPreview.selectedTypeCounts["单选"] === 1, "manual category allocation honors per-category counts");
  const shortageGeneration = await generateQuestionsAsync({
    paperName: "题库不足自动补题",
    direction: "JavaScript",
    difficulty: "中",
    typeCounts: { single: 1, judge: 1, blank: 1 },
    typeScores: { single: 2, judge: 2, blank: 2 },
    sourcePlan: { questionBankRequestedCount: 3, questionBankCategoryIds: [frontendCategory.id, backendCategory.id], questionBankAllocationMode: "balanced" },
  }, contentUserHeaders);
  assert(shortageGeneration.spec.sourcePlan.questionBankCount === 2 && shortageGeneration.spec.sourcePlan.questionBankShortfall === 1 && shortageGeneration.spec.sourcePlan.aiQuestionCount === 1, "AI fills category or type shortages without blocking generation");

  const materialOne = await postJson("/api/materials", {
    name: "JavaScript 基础规范",
    description: "用于验证资料题生成",
    tags: "JavaScript，基础",
    content: "JavaScript 中 const 声明创建不可重新赋值的绑定。数组的 map 方法会返回一个新数组，不会直接修改原数组。",
  }, { headers: contentUserHeaders, expectedStatus: 201 });
  assert(materialOne.status === "ready" && materialOne.version === 1, "text material can be created");
  const materialOneUpdated = await patchJson(`/api/materials/${materialOne.id}`, {
    name: "JavaScript 基础规范",
    description: "用于验证资料题生成和版本冻结",
    tags: "JavaScript，基础",
    content: "JavaScript 中 const 声明创建不可重新赋值的绑定，但对象内部属性仍可修改。数组的 map 方法会返回一个新数组，不会直接修改原数组。",
  }, { headers: contentUserHeaders });
  assert(materialOneUpdated.version === 2, "editing material content creates a new version");
  const materialTwo = await postMaterialFile("工程质量要求.txt", "代码评审应检查正确性、可维护性和测试覆盖。提交前应执行自动化测试并处理失败。", {
    name: "工程质量要求",
    description: "工程质量资料",
    tags: "工程质量，评审",
  }, contentUserHeaders);
  assert(materialTwo.status === "ready" && materialTwo.sourceType === "file", "TXT material upload is parsed");
  const materialList = await getJson("/api/materials?status=ready&page=1&pageSize=20", { headers: contentUserHeaders });
  assert(materialList.total === 2, "material list returns created sources");

  const combinedSpec = {
    paperName: "三类题源组合测评",
    direction: "JavaScript 工程实践",
    difficulty: "中",
    typeCounts: { single: 2, multiple: 1, judge: 1, blank: 0, short: 0, essay: 0 },
    typeScores: { single: 2, multiple: 4, judge: 3, blank: 2, short: 5, essay: 10 },
    knowledge: ["语言基础", "工程质量"],
    requirements: "题干清晰，答案明确。",
    sourcePlan: {
      questionBankIds: [manualBankQuestion.id],
      materialIds: [materialOne.id],
      materialQuestionCount: 1,
      coverageStrategy: "balanced",
    },
  };
  const combined = await generateQuestionsAsync(combinedSpec, contentUserHeaders);
  const combinedBank = combined.questions.filter((question) => question.origin?.type === "question-bank");
  const combinedMaterial = combined.questions.filter((question) => question.origin?.type === "material");
  const combinedAi = combined.questions.filter((question) => question.origin?.type === "ai");
  assert(combined.questions.length === 4 && combined.spec.totalScore === 11 && combined.checks.specPass === true, "three-source generation keeps the requested count, type matrix, and score");
  assert(combinedBank.length === 1 && combinedMaterial.length === 1 && combinedAi.length === 2, "question-bank, material, and independent AI quotas compose in one generation task");
  assert(combinedBank[0].score === 3 && combinedBank[0].status === "已校验" && combinedBank[0].origin.bankVersion === 2, "bank questions use the paper score and preserve reviewed version provenance");
  assert(combined.spec.sourcePlan.questionBankItems[0].version === 2 && combined.spec.sourcePlan.materials[0].version === 2, "combined generation freezes question-bank and material versions");
  assert(new Set(combined.questions.map((question) => question.stem.replace(/\s+/g, ""))).size === 4, "combined generation removes duplicates and fills every missing slot");
  const combinedPreviewDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(combinedPreviewDashboard.questions.length === 0, "three-source preview does not mutate the active authoring draft");

  const generationSpec = {
    paperName: "核心能力测评",
    direction: "JavaScript 工程实践",
    difficulty: "中",
    typeCounts: { single: 2, multiple: 1, judge: 1, blank: 0, short: 0, essay: 0 },
    typeScores: { single: 2, multiple: 4, judge: 2, blank: 2, short: 5, essay: 10 },
    knowledge: ["语言基础", "工程质量"],
    requirements: "题干清晰，答案明确。",
    sourcePlan: {
      mode: "mixed",
      materialIds: [materialOne.id, materialTwo.id],
      materialQuestionCount: 2,
      coverageStrategy: "balanced",
    },
  };
  const generated = await generateQuestionsAsync(generationSpec, contentUserHeaders);
  assert(generated.questions.length === 4 && generated.spec.totalScore === 10, "AI mock generation respects retained paper specification");
  const materialQuestions = generated.questions.filter((question) => question.origin?.type === "material");
  const independentQuestions = generated.questions.filter((question) => question.origin?.type === "ai");
  assert(materialQuestions.length === 2 && independentQuestions.length === 2, "mixed generation respects material and independent AI quotas");
  assert(new Set(materialQuestions.flatMap((question) => question.origin.materialRefs.map((ref) => ref.materialId))).size === 2, "balanced material generation covers multiple selected materials");
  assert(materialQuestions.every((question) => question.origin.materialRefs.every((ref) => ref.excerpt && Number.isFinite(ref.version))), "material questions preserve versioned evidence excerpts");
  assert(generated.spec.sourcePlan.materials.find((item) => item.id === materialOne.id)?.version === 2, "generation freezes the current material version");
  const ownedGenerationJob = await postJson("/api/ai/generate-questions", generationSpec, { headers: contentUserHeaders, expectedStatus: 202 });
  await getJson(`/api/ai/generation-jobs/${encodeURIComponent(ownedGenerationJob.id)}`, { headers: adminHeaders, expectedStatus: 404 });
  const ownedGenerationResult = await waitForGenerationJob(ownedGenerationJob.id, contentUserHeaders);
  assert(ownedGenerationResult.status === "done", "generation jobs are visible only to their authenticated owner");
  const previewDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(previewDashboard.questions.length === 0, "unsaved generation does not mutate runtime content");

  const rejectedSpecDraft = await postJson("/api/ai/save-question-draft", {
    questions: generated.questions.slice(0, -1),
    spec: generated.spec,
  }, { headers: contentUserHeaders, expectedStatus: 409 });
  assert(rejectedSpecDraft.checks.specPass === false && rejectedSpecDraft.failures.some((item) => item.field === "count"), "saving blocks generated drafts that do not match the requested specification");

  const savedDraft = await postJson("/api/ai/save-question-draft", { questions: generated.questions, spec: generated.spec }, { headers: contentUserHeaders });
  assert(savedDraft.saved === true, "generated preview can be saved");
  const draftDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(draftDashboard.questions.length === 4 && draftDashboard.stats.pendingReview === 4, "dashboard reflects saved draft and review count");

  const quality = await postJson("/api/quality/check", {}, { headers: contentUserHeaders });
  assert(Array.isArray(quality.failures) && Number.isFinite(quality.schemaPassRate), "quality check remains available");
  const builtDraft = await postJson("/api/papers/build", {}, { headers: contentUserHeaders });
  assert(builtDraft.status === "草稿" && builtDraft.questionCount === 4, "paper build saves all valid questions without manual review");
  const builtDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(builtDashboard.questions.every((question) => question.status === "待确认"), "building a paper does not require or fabricate review status");

  const transformBefore = builtDashboard.questions.find((question) => question.origin?.type === "material") || builtDashboard.questions[0];
  const transformStateBefore = JSON.stringify(transformBefore);
  const regenerated = await postJson(`/api/questions/${transformBefore.id}/ai-transform`, {
    operation: "regenerate",
    draft: transformBefore,
  }, { headers: contentUserHeaders });
  assert(regenerated.operation === "regenerate" && regenerated.candidate.type === transformBefore.type && regenerated.candidate.origin.aiTransformed === true, "same-source AI regeneration returns a validated candidate");
  if (transformBefore.origin?.type === "material") {
    assert(JSON.stringify(regenerated.candidate.origin.materialRefs) === JSON.stringify(transformBefore.origin.materialRefs), "material regeneration preserves the original evidence references");
  }

  const choiceQuestion = builtDashboard.questions.find((question) => ["单选", "多选"].includes(question.type));
  const correctLetters = Array.isArray(choiceQuestion.answer) ? choiceQuestion.answer : [choiceQuestion.answer];
  const correctOptions = Object.fromEntries(correctLetters.map((letter) => [letter, choiceQuestion.options[letter.charCodeAt(0) - 65]]));
  const distractors = await postJson(`/api/questions/${choiceQuestion.id}/ai-transform`, {
    operation: "distractors",
    draft: choiceQuestion,
  }, { headers: contentUserHeaders });
  assert(JSON.stringify(distractors.candidate.answer) === JSON.stringify(choiceQuestion.answer), "distractor regeneration preserves the correct answer letters");
  assert(correctLetters.every((letter) => distractors.candidate.options[letter.charCodeAt(0) - 65] === correctOptions[letter]), "distractor regeneration preserves correct option contents and positions");

  const customTransform = await postJson(`/api/questions/${transformBefore.id}/ai-transform`, {
    operation: "custom",
    prompt: "缩短题干并补充更清晰的解析",
    draft: transformBefore,
  }, { headers: contentUserHeaders });
  assert(customTransform.candidate.stem.includes("已按要求优化") && customTransform.changedFields.length > 0, "custom AI prompt returns an explicit change candidate");
  const transformDashboardAfter = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(JSON.stringify(transformDashboardAfter.questions.find((question) => question.id === transformBefore.id)) === transformStateBefore, "AI candidate requests do not mutate the persisted question");

  const invalidQuestion = draftDashboard.questions[0];
  await patchJson(`/api/questions/${invalidQuestion.id}`, { score: 0 }, { headers: contentUserHeaders });
  const blockedPublish = await postJson("/api/papers/publish", {}, { headers: contentUserHeaders, expectedStatus: 409 });
  assert(blockedPublish.failures.some((failure) => failure.questionId === invalidQuestion.id && failure.field === "score"), "publish runs validation and returns actionable question failures");
  const blockedPublishDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(blockedPublishDashboard.paper.status !== "已发布", "failed publish keeps the paper unpublished");
  await patchJson(`/api/questions/${invalidQuestion.id}`, { score: generated.questions[0].score }, { headers: contentUserHeaders });
  const published = await postJson("/api/papers/publish", {}, { headers: contentUserHeaders });
  assert(published.status === "已发布" && published.questionCount === 4 && published.score === 10, "publish automatically validates and publishes valid unreviewed questions");
  const paper = published;
  const paperDetail = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  const publishedPaperAQuestions = JSON.stringify(paperDetail.questions);
  assert(paperDetail.questions.length === 4 && paperDetail.status === "已发布", "paper detail returns the published snapshot");
  assert(!("categoryId" in paperDetail) && !("categorySnapshot" in paperDetail), "paper snapshots no longer expose paper classification");
  assert(paperDetail.sourcePlanSnapshot.materialQuestionCount === 2 && paperDetail.sourcePlanSnapshot.materials.length === 2, "paper snapshot preserves source allocation and material versions");
  const usages = await getJson(`/api/materials/${materialOne.id}/usages`, { headers: contentUserHeaders });
  assert(usages.items.some((item) => item.paperId === paper.id && item.questionCount >= 1), "material usage links back to published papers");
  const archivedMaterial = await postJson(`/api/materials/${materialOne.id}/archive`, {}, { headers: contentUserHeaders });
  assert(archivedMaterial.status === "archived", "material can be archived without deleting historical evidence");
  const archivedPaperDetail = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  assert(archivedPaperDetail.questions.some((question) => question.origin?.materialRefs?.some((ref) => ref.materialId === materialOne.id && ref.version === 2)), "archiving material keeps historical paper evidence intact");
  const activated = await postJson(`/api/papers/${paper.id}/activate`, {}, { headers: contentUserHeaders });
  assert(activated.id === paper.id, "paper can be activated as current");

  await postJson("/api/question-bank/import", { paperId: paper.id }, { headers: contentUserHeaders, expectedStatus: 400 });
  const importedPaperA = await postJson("/api/question-bank/import", { paperId: paper.id, categoryId: frontendCategory.id }, { headers: contentUserHeaders });
  assert(importedPaperA.created === 4 && importedPaperA.reused === 0, "first paper import creates unique bank questions");
  const bankAfterPaperA = await getJson("/api/question-bank?page=1&pageSize=20", { headers: contentUserHeaders });
  assert(bankAfterPaperA.total === 6, "manual, sampled, and paper questions coexist in the bank");
  const frontendBank = await getJson(`/api/question-bank?categoryId=${encodeURIComponent(frontendCategory.id)}&page=1&pageSize=20`, { headers: contentUserHeaders });
  assert(frontendBank.total === 5 && frontendBank.items.every((item) => item.categoryIds.includes(frontendCategory.id)), "question bank list filters by the selected category subtree");

  await patchJson(`/api/question-bank/categories/${frontendCategory.id}`, { name: "前端工程" }, { headers: contentUserHeaders });
  const renamedPaperDetail = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  assert(!("categoryId" in renamedPaperDetail), "renaming a question-bank category does not add classification back to papers");

  const secondSpec = { ...generated.spec, paperName: "核心能力测评 B 卷" };
  await postJson("/api/ai/save-question-draft", { questions: generated.questions, spec: secondSpec }, { headers: contentUserHeaders });
  const paperB = await postJson("/api/papers/publish", {}, { headers: contentUserHeaders });
  assert(paperB.id !== paper.id && paperB.status === "已发布", "a second paper with the same questions is saved independently");
  const paperAAfterCreatingB = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  assert(JSON.stringify(paperAAfterCreatingB.questions) === publishedPaperAQuestions && paperAAfterCreatingB.status === "已发布", "creating paper B does not overwrite the active paper A snapshot");
  const importedPaperB = await postJson("/api/question-bank/import", { paperId: paperB.id, categoryId: backendCategory.id }, { headers: contentUserHeaders });
  assert(importedPaperB.created === 0 && importedPaperB.reused === 4, "same questions from paper B reuse paper A bank records");
  const bankAfterPaperB = await getJson("/api/question-bank?page=1&pageSize=20", { headers: contentUserHeaders });
  assert(bankAfterPaperB.total === 6, "paper B duplicate import does not create extra bank records");
  const sharedBankQuestion = bankAfterPaperB.items.find((item) => item.sourceCount > 0 && item.id !== manualBankQuestion.id && item.id !== backendBankQuestion.id);
  const sharedDetail = await getJson(`/api/question-bank/${sharedBankQuestion.id}`, { headers: contentUserHeaders });
  assert(sharedDetail.usages.some((item) => item.paperId === paper.id) && sharedDetail.usages.some((item) => item.paperId === paperB.id), "one bank question records both A and B paper sources");
  assert(sharedDetail.categoryIds.includes(frontendCategory.id) && sharedDetail.categoryIds.includes(backendCategory.id), "duplicate imports reuse one bank record and merge category memberships");

  const manualVersionBeforeCategoryChange = (await getJson(`/api/question-bank/${manualBankQuestion.id}`, { headers: contentUserHeaders })).version;
  const bulkCategories = await postJson("/api/question-bank/categories/bulk", {
    questionIds: [manualBankQuestion.id],
    categoryIds: [backendCategory.id],
    mode: "add",
  }, { headers: contentUserHeaders });
  assert(bulkCategories.updated === 1, "question categories can be updated in bulk");
  const manualAfterCategoryChange = await getJson(`/api/question-bank/${manualBankQuestion.id}`, { headers: contentUserHeaders });
  assert(manualAfterCategoryChange.version === manualVersionBeforeCategoryChange && manualAfterCategoryChange.categoryIds.length === 2, "category metadata changes do not increment question content versions");

  const importedIntoPaper = await postJson("/api/authoring/questions/import", { questionBankIds: [manualBankQuestion.id] }, { headers: contentUserHeaders });
  assert(importedIntoPaper.added === 1 && importedIntoPaper.questions[0].origin.bankQuestionId === manualBankQuestion.id, "reviewed bank question can be copied into the current paper with version reference");
  const bankOriginalBeforeTransform = await getJson(`/api/question-bank/${manualBankQuestion.id}`, { headers: contentUserHeaders });
  const bankDerivedCandidate = await postJson(`/api/questions/${importedIntoPaper.questions[0].id}/ai-transform`, {
    operation: "regenerate",
    draft: importedIntoPaper.questions[0],
  }, { headers: contentUserHeaders });
  assert(bankDerivedCandidate.candidate.origin.type === "question-bank" && bankDerivedCandidate.warnings.some((warning) => warning.includes("不会修改题库原题")), "question-bank regeneration returns a derived candidate with provenance warning");
  const bankOriginalAfterTransform = await getJson(`/api/question-bank/${manualBankQuestion.id}`, { headers: contentUserHeaders });
  assert(bankOriginalAfterTransform.version === bankOriginalBeforeTransform.version && bankOriginalAfterTransform.stem === bankOriginalBeforeTransform.stem, "AI transformation never mutates the question-bank original");
  const paperBAfterImport = await getJson(`/api/papers/${paperB.id}`, { headers: contentUserHeaders });
  assert(paperBAfterImport.status === "草稿" && paperBAfterImport.questions.some((question) => question.origin?.bankQuestionId === manualBankQuestion.id), "adding a bank question creates a draft paper snapshot without changing the bank item");
  const repeatedPaperImport = await postJson("/api/authoring/questions/import", { questionBankIds: [manualBankQuestion.id] }, { headers: contentUserHeaders });
  assert(repeatedPaperImport.added === 0 && repeatedPaperImport.skipped === 1, "adding the same bank question twice to a paper is skipped");

  const sourcePlanAfterImport = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(
    sourcePlanAfterImport.generationTask.sourcePlan.questionBankIds.includes(manualBankQuestion.id)
      && sourcePlanAfterImport.generationTask.sourcePlan.materialIds.length === 2
      && sourcePlanAfterImport.generationTask.sourcePlan.aiQuestionCount === 2
      && sourcePlanAfterImport.generationTask.count === sourcePlanAfterImport.questions.length,
    "adding bank questions rebuilds the complete generation and source plan",
  );

  const repairTarget = importedIntoPaper.questions[0];
  await patchJson(`/api/questions/${repairTarget.id}`, { score: 0 }, { headers: contentUserHeaders });
  const repaired = await postJson("/api/quality/repair", {}, { headers: contentUserHeaders });
  assert(repaired.questions.find((item) => item.id === repairTarget.id)?.score === 3, "automatic repair updates the active question set");
  await postJson(`/api/papers/${paper.id}/activate`, {}, { headers: contentUserHeaders });
  await postJson(`/api/papers/${paperB.id}/activate`, {}, { headers: contentUserHeaders });
  const repairedPaperB = await getJson(`/api/papers/${paperB.id}`, { headers: contentUserHeaders });
  assert(repairedPaperB.questions.find((item) => item.id === repairTarget.id)?.score === 3, "automatic repair persists in the paper snapshot across paper switches");

  const dashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(dashboard.stats.questions === 5 && dashboard.stats.papers === 2 && dashboard.stats.published === 1, "dashboard reflects question-bank additions without duplicating papers");

  await postJson(`/api/papers/${paper.id}/activate`, {}, { headers: contentUserHeaders });
  const paperABeforeEdit = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  const paperAEditTarget = paperABeforeEdit.questions[0];
  await patchJson(`/api/questions/${paperAEditTarget.id}`, { stem: `${paperAEditTarget.stem}（编辑稿）` }, { headers: contentUserHeaders });
  const paperAAfterEdit = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  assert(paperAAfterEdit.createdAt === paperABeforeEdit.createdAt && paperAAfterEdit.updatedAt !== paperABeforeEdit.updatedAt, "paper edits preserve createdAt and advance updatedAt");
  assert(
    paperAAfterEdit.publishedVersions.some((version) => version.publishedAt === paperABeforeEdit.publishedAt && version.questions[0].stem === paperAEditTarget.stem),
    "editing a published paper preserves its immutable published version",
  );
  await postJson(`/api/papers/${paperB.id}/activate`, {}, { headers: contentUserHeaders });

  const adminSpec = { ...generated.spec, paperName: "管理员独立试卷" };
  await postJson("/api/ai/save-question-draft", { questions: generated.questions, spec: adminSpec }, { headers: adminHeaders });
  const adminPaper = await postJson("/api/papers/build", {}, { headers: adminHeaders });
  const adminDashboard = await getJson("/api/dashboard", { headers: adminHeaders });
  const contentDashboardAfterAdminEdit = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(adminDashboard.paper.id === adminPaper.id && adminDashboard.questions.length === 4, "the first user owns an independent authoring workspace");
  assert(contentDashboardAfterAdminEdit.paper.id === paperB.id && contentDashboardAfterAdminEdit.questions.length === 5, "a second user keeps their own active paper and questions");

  const emptyMoveCategories = await postJson("/api/question-bank/categories", { name: "待移动分类" }, { headers: contentUserHeaders, expectedStatus: 201 });
  const emptyMoveCategory = emptyMoveCategories.items.find((item) => item.name === "待移动分类");
  const rejectedCategoryMove = await patchJson(`/api/question-bank/categories/${emptyMoveCategory.id}`, { parentId: frontendCategory.id }, { headers: contentUserHeaders, expectedStatus: 409 });
  assert(rejectedCategoryMove.error.includes("已有题目"), "moving a category cannot turn a question-owning leaf into a parent");

  const archiveRootResult = await postJson("/api/question-bank/categories", { name: "归档测试" }, { headers: contentUserHeaders, expectedStatus: 201 });
  const archiveRoot = archiveRootResult.items.find((item) => item.name === "归档测试");
  const archiveChildResult = await postJson("/api/question-bank/categories", { name: "独立归档子类", parentId: archiveRoot.id }, { headers: contentUserHeaders, expectedStatus: 201 });
  const archiveChild = archiveChildResult.items.find((item) => item.name === "独立归档子类");
  await postJson(`/api/question-bank/categories/${archiveChild.id}/archive`, {}, { headers: contentUserHeaders });
  await postJson(`/api/question-bank/categories/${archiveRoot.id}/archive`, {}, { headers: contentUserHeaders });
  const restoredArchiveTree = await postJson(`/api/question-bank/categories/${archiveRoot.id}/restore`, {}, { headers: contentUserHeaders });
  assert(restoredArchiveTree.items.find((item) => item.id === archiveChild.id)?.status === "archived", "restoring a parent does not restore an independently archived child");

  const fingerprintBefore = await getJson(`/api/question-bank/${manualBankQuestion.id}`, { headers: contentUserHeaders });
  const fingerprintAfter = await patchJson(`/api/question-bank/${manualBankQuestion.id}`, {
    explanation: `${fingerprintBefore.explanation} 补充说明。`,
    defaultScore: Number(fingerprintBefore.defaultScore || 1) + 1,
    difficulty: fingerprintBefore.difficulty === "难" ? "中" : "难",
    knowledge: [...(fingerprintBefore.knowledge || []), "版本指纹"],
  }, { headers: contentUserHeaders });
  assert(fingerprintAfter.version === fingerprintBefore.version + 1, "question-bank versions include explanation, score, difficulty, and knowledge changes");

  for (let index = 0; index < 99; index += 1) {
    await postJson("/api/materials", {
      name: `批量资料 ${String(index + 1).padStart(3, "0")}`,
      content: `用于验证资料选择器超过一百条记录时仍可完整加载。编号 ${index + 1}`,
    }, { headers: contentUserHeaders, expectedStatus: 201 });
  }
  const allMaterials = await getJson("/api/materials?page=1&pageSize=1000", { headers: contentUserHeaders });
  assert(allMaterials.total === 101 && allMaterials.items.length === 101, "material options can load more than 100 records in one selector request");
  console.log("SmartQ verification passed");
} catch (error) {
  console.error(error.stack || error.message || error);
  if (output.trim()) console.error(output.trim());
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}

async function generateQuestionsAsync(spec, headers) {
  const job = await postJson("/api/ai/generate-questions", spec, { headers, expectedStatus: 202 });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await getJson(`/api/ai/generation-jobs/${encodeURIComponent(job.id)}`, { headers });
    if (current.status === "done") return current.result;
    if (current.status === "error") throw new Error(current.error || "AI generation failed");
    await delay(20);
  }
  throw new Error("AI generation timed out");
}

async function waitForGenerationJob(id, headers) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await getJson(`/api/ai/generation-jobs/${encodeURIComponent(id)}`, { headers });
    if (["done", "error"].includes(current.status)) return current;
    await delay(20);
  }
  throw new Error("AI generation job timed out");
}

async function postMaterialFile(filename, content, fields, headers) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  form.append("file", new Blob([content], { type: "text/plain" }), filename);
  const response = await fetch(`${baseUrl}/api/materials/upload`, {
    method: "POST",
    headers,
    body: form,
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (response.status !== 201) throw new Error(`POST /api/materials/upload expected 201, received ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function verifyLegacyAdminNormalization() {
  const previous = {
    accounts: process.env.SMARTQ_ADMIN_ACCOUNTS,
    username: process.env.SMARTQ_ADMIN_USER,
    password: process.env.SMARTQ_ADMIN_PASSWORD,
  };
  delete process.env.SMARTQ_ADMIN_ACCOUNTS;
  delete process.env.SMARTQ_ADMIN_USER;
  delete process.env.SMARTQ_ADMIN_PASSWORD;
  try {
    const { hashAdminPassword, initializeAdminUsers } = await import("../backend/services/admin-user-service.js");
    const freshState = { adminUsers: [], adminSessions: {}, auditLog: [] };
    await initializeAdminUsers(freshState);
    assert(freshState.adminUsers[0].username === "admin" && !(retiredInitialPasswordFlag in freshState.adminUsers[0]), "default admin omits retired password-policy metadata");

    const legacyState = {
      adminUsers: [{
        id: "legacy-default-admin",
        username: "admin",
        passwordHash: await hashAdminPassword("123456"),
        displayName: "admin",
        avatar: "",
        role: "admin",
        status: "active",
        [retiredInitialPasswordFlag]: true,
        authVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: null,
        passwordChangedAt: new Date().toISOString(),
        createdBy: "bootstrap",
      }],
      adminSessions: {
        legacy: {
          userId: "legacy-default-admin",
          role: "admin",
          permissions: ["authoring", "papers", "users"],
          [retiredInitialPasswordFlag]: true,
        },
      },
      auditLog: [],
    };
    await initializeAdminUsers(legacyState);
    assert(!(retiredInitialPasswordFlag in legacyState.adminUsers[0]), "legacy user password-policy metadata is removed during normalization");
    assert(!("role" in legacyState.adminUsers[0]), "legacy role fields are removed during user normalization");
    assert(!("role" in legacyState.adminSessions.legacy) && !("permissions" in legacyState.adminSessions.legacy) && !(retiredInitialPasswordFlag in legacyState.adminSessions.legacy), "legacy session metadata is removed during normalization");
  } finally {
    restoreEnv("SMARTQ_ADMIN_ACCOUNTS", previous.accounts);
    restoreEnv("SMARTQ_ADMIN_USER", previous.username);
    restoreEnv("SMARTQ_ADMIN_PASSWORD", previous.password);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(30);
  }
  throw new Error("SmartQ verification server did not start");
}

function getJson(path, options = {}) {
  return requestJson(path, { ...options, method: "GET" });
}

function postJson(path, body = {}, options = {}) {
  return requestJson(path, { ...options, method: "POST", body });
}

function putJson(path, body = {}, options = {}) {
  return requestJson(path, { ...options, method: "PUT", body });
}

function putRaw(path, rawBody, options = {}) {
  return requestJson(path, { ...options, method: "PUT", rawBody });
}

function patchJson(path, body = {}, options = {}) {
  return requestJson(path, { ...options, method: "PATCH", body });
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.rawBody === undefined ? (options.body === undefined ? undefined : JSON.stringify(options.body)) : options.rawBody,
  });
  const expectedStatus = options.expectedStatus || 200;
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || "GET"} ${path} expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`);
  return response.text();
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
