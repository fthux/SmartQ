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

  const shell = await getText("/");
  assert(shell.includes('<div id="app"') && shell.includes('type="module"') && shell.includes("./assets/"), "root serves the Vite-built Vue app shell");
  const nestedShell = await getText("/smartq/");
  assert(nestedShell.includes('<div id="app"') && nestedShell.includes("./assets/"), "subdirectory path serves the Vite-built Vue app shell");
  const frontendFiles = [
    "vite.config.js",
    "frontend/src/main.js",
    "frontend/src/App.vue",
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
    "frontend/src/stores/question-bank-store.js",
    "frontend/src/stores/users-store.js",
    "frontend/src/styles/index.css",
  ];
  const frontendSources = await Promise.all(frontendFiles.map((path) => readFile(path, "utf8")));
  const frontend = frontendSources.join("\n");
  const backendFiles = [
    "backend/routes/index.js",
    "backend/routes/materials.js",
    "backend/routes/question-bank.js",
    "backend/services/material-service.js",
    "backend/services/question-bank-service.js",
    "backend/services/admin-user-service.js",
    "backend/services/auth-service.js",
  ];
  const backend = (await Promise.all(backendFiles.map((path) => readFile(path, "utf8")))).join("\n");
  assert(frontend.includes('createApp(App)') && frontend.includes('app.mount("#app")') && frontend.includes("ElementPlusResolver"), "frontend mounts Vue 3 with on-demand Element Plus components");
  assert(frontend.includes("<script setup>") && frontend.includes("<el-form") && frontend.includes("<el-button"), "frontend pages use Vue SFC and Element Plus controls");
  assert(frontend.includes("<el-table") && frontend.includes("<el-drawer") && frontend.includes("<el-dialog"), "tables, drawers, and dialogs use Element Plus components");
  assert(frontend.includes('aria-label="管理功能导航"') && frontend.includes('data-admin-route-content'), "frontend keeps the management sidebar layout");
  assert(frontend.includes("toggleSidebar") && frontend.includes("smartqSidebarCollapsed"), "desktop sidebar can collapse and persist its state");
  assert(frontend.includes("requestFullscreen") && frontend.includes("fullscreenchange"), "header exposes synchronized fullscreen controls");
  assert(frontend.includes('value: "system"') && frontend.includes("prefers-color-scheme: dark"), "theme defaults to the system preference");
  assert(frontend.includes("<el-switch") && frontend.includes("active-action-icon") && frontend.includes("inactive-action-icon"), "header uses the Element Plus style sun and moon theme switch");
  assert(frontend.includes("document.startViewTransition") && frontend.includes("Math.hypot") && frontend.includes("clipPath"), "theme switch reveals the new theme with a viewport-filling circle");
  assert(frontend.includes("::view-transition-new(root)") && frontend.includes("prefers-reduced-motion: reduce"), "theme reveal targets the new root view and respects reduced motion");
  assert(frontend.includes('@command="handleThemePreference"') && frontend.includes("setTheme(theme, { animate: true, origin })"), "theme preference menu reuses the circular reveal after its dropdown closes");
  assert(frontend.includes("--el-bg-color: #171a21") && frontend.includes("--el-border-color-lighter: #2a303b"), "Element Plus dark theme uses the neutral charcoal palette");
  assert(frontend.includes("html.dark") && frontend.includes("dark:bg-night-surface"), "theme switching updates Element Plus and application surfaces");
  assert(!frontend.includes(":global(html.dark)"), "dark descendant rules stay out of scoped styles");
  const frontendAssets = await readdir("frontend/dist/assets");
  const builtCssFiles = frontendAssets.filter((name) => name.endsWith(".css"));
  const builtCss = (await Promise.all(builtCssFiles.map((name) => readFile(join("frontend/dist/assets", name), "utf8")))).join("\n");
  assert(builtCss.includes("html.dark .login-art-skyline") && builtCss.includes("html.dark .smartq-menu"), "built dark rules keep their descendant selectors");
  assert(!/html\.dark\{[^}]*opacity:\s*\.2/.test(builtCss), "built CSS never dims the entire dark document");
  assert(frontend.includes("个人资料") && frontend.includes("/api/admin/profile/avatar"), "profile page supports persistent avatar updates");
  assert(frontend.includes("state.admin.user?.avatar || publicUrl('/assets/favicon.svg')") && frontend.includes("state.profile.avatarPreview || publicUrl('/assets/favicon.svg')") && frontend.includes("row.avatar || publicUrl('/assets/favicon.svg')"), "users without uploaded avatars display favicon.svg by default");
  assert(frontend.includes("用户管理") && frontend.includes("/api/admin/users") && frontend.includes("重置密码"), "admin user management UI is available");
  assert(!frontend.includes("全部角色") && !frontend.includes('label="角色"') && !frontend.includes("adminRoleLabel"), "role controls and labels are removed from the frontend");
  assert((frontend.match(/append-to-body/g) || []).length >= 2, "user management dialogs attach overlays to the document body");
  assert(frontend.includes('active-value="active"') && frontend.includes('inactive-value="disabled"') && frontend.includes("statusUpdatingId"), "user status switches use Element Plus active, inactive, disabled, and loading states");
  assert(frontend.includes("/api/admin/password"), "profile page keeps voluntary password changes");
  assert(!frontend.includes(retiredInitialPasswordFlag) && !/首次登录.*修改.*密码|初始密码/.test(frontend), "frontend removes the initial-password change policy and UI");
  assert(!backend.includes(retiredInitialPasswordFlag) && !backend.includes("请先修改初始密码"), "backend removes the initial-password field and API gate");
  assert(frontend.includes("await uploadAdminAvatar(file)") && frontend.includes("用户头像已更新"), "valid avatar selection uploads immediately");
  assert(frontend.includes("100 * 1024") && frontend.includes("width !== dimensions.height"), "avatar selection enforces 100KB square images");
  assert(frontend.includes('window.scrollTo({ top: 0, left: 0, behavior: "auto" });'), "frontend resets scroll on module switches");
  assert(frontend.includes("出题制卷") && frontend.includes("已出卷子"), "frontend keeps authoring and paper UI");
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
  assert(frontend.includes("publishQualityFailures") && frontend.includes("发布已终止") && frontend.includes("editPublishIssue"), "publish failures stay visible and link to question editing");
  assert(frontend.includes("data-authoring-workbench") && frontend.includes("data-authoring-summary") && frontend.includes("data-authoring-action-bar"), "authoring uses the dense workbench, summary, and action bar layout");
  assert(frontend.includes("data-question-type-matrix") && frontend.includes("typeMatrixRows") && frontend.includes("通过并继续"), "authoring keeps the compact type matrix and next-question review flow");
  assert(frontend.includes('paperPageSize: 20') && frontend.includes('aria-label="试卷状态筛选"'), "paper management uses the Element Plus list controls");
  assert(frontend.includes('aria-label="试卷详情抽屉"') && frontend.includes("paperDetailMode"), "paper details open in the responsive drawer");
  assert((frontend.match(/if \(state\.selectedPaperId\) clearSelectedPaper\(\);/g) || []).length >= 2, "route changes close an open paper detail drawer");
  assert(frontend.includes("出题资料管理") && frontend.includes("/api/materials/upload") && frontend.includes("data-question-source-plan"), "frontend exposes material management and source allocation");
  assert(frontend.includes("materialQuestionCount") && frontend.includes("AI 独立题数量") && frontend.includes("资料依据"), "authoring config and review expose mixed-source traceability");
  assert(frontend.includes("题库管理") && frontend.includes("data-question-bank-page") && frontend.includes("从题库选择题目"), "frontend exposes question bank management and paper selection");
  assert(frontend.includes("已校验题目入库") && frontend.includes("整卷入库") && frontend.includes("加入题库"), "review and paper detail surfaces can explicitly add questions to the bank");
  assert(backend.includes("questionContentHash") && backend.includes("questionBankUsageMap") && backend.includes("importQuestionBankIntoAuthoring"), "backend implements question deduplication, usage relations, and paper imports");

  const blockedDashboard = await getJson("/api/dashboard", { expectedStatus: 401 });
  assert(blockedDashboard.error.includes("运营控制台"), "dashboard requires admin login");
  const blockedProfile = await putJson("/api/admin/profile", { displayName: "unauthorized" }, { expectedStatus: 401 });
  assert(blockedProfile.error.includes("运营控制台"), "profile updates require admin login");
  const blockedUsers = await getJson("/api/admin/users", { expectedStatus: 401 });
  assert(blockedUsers.error.includes("运营控制台"), "user management requires login");
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
    assert(result.error === "Not Found", `${method} ${path} is retired`);
  }

  const freshDashboard = await getJson("/api/dashboard", { headers: adminHeaders });
  assert(freshDashboard.questions.length === 0 && freshDashboard.papers.length === 0, "fresh dashboard starts without content");
  assert(!("participants" in freshDashboard) && !("sessions" in freshDashboard) && !("analysis" in freshDashboard), "dashboard omits retired domain payloads");

  const manualBankQuestion = await postJson("/api/question-bank", {
    type: "判断",
    stem: "题库中的题目加入试卷后，修改题库会自动覆盖已经发布的试卷。",
    answer: "错误",
    defaultScore: 2,
    difficulty: "中",
    knowledge: ["题库管理"],
    tags: ["快照"],
    explanation: "试卷保存独立题目快照。",
    status: "已校验",
  }, { headers: contentUserHeaders, expectedStatus: 201 });
  assert(manualBankQuestion.status === "已校验" && manualBankQuestion.version === 1, "manual reviewed question can be created in the bank");
  await postJson("/api/question-bank", {
    type: "判断",
    stem: "题库中的题目加入试卷后，修改题库会自动覆盖已经发布的试卷。",
    answer: "错误",
    defaultScore: 20,
    difficulty: "难",
    status: "已校验",
  }, { headers: contentUserHeaders, expectedStatus: 409 });
  await postJson("/api/question-bank", {
    type: "判断",
    stem: "题库中的题目加入试卷后，修改题库会自动覆盖已经发布的试卷。",
    answer: "正确",
    defaultScore: 2,
    difficulty: "中",
    status: "已校验",
  }, { headers: contentUserHeaders, expectedStatus: 409 });
  const bankList = await getJson("/api/question-bank?status=已校验&page=1&pageSize=20", { headers: contentUserHeaders });
  assert(bankList.total === 1 && bankList.items[0].id === manualBankQuestion.id, "question bank list supports reviewed status filtering");
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
  assert(restoredBankQuestion.status === "已校验", "restoring a reviewed question preserves its review status");

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
  const previewDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(previewDashboard.questions.length === 0, "unsaved generation does not mutate runtime content");

  const savedDraft = await postJson("/api/ai/save-question-draft", { questions: generated.questions, spec: generated.spec }, { headers: contentUserHeaders });
  assert(savedDraft.saved === true, "generated preview can be saved");
  const draftDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(draftDashboard.questions.length === 4 && draftDashboard.stats.pendingReview === 4, "dashboard reflects saved draft and review count");

  const quality = await postJson("/api/quality/check", {}, { headers: contentUserHeaders });
  assert(Array.isArray(quality.failures) && Number.isFinite(quality.schemaPassRate), "quality check remains available");
  const blockedBuild = await postJson("/api/papers/build", {}, { headers: contentUserHeaders, expectedStatus: 409 });
  assert(blockedBuild.eligibleCount === 0, "paper build requires manual review");

  await Promise.all(draftDashboard.questions.map((question) => patchJson(`/api/questions/${question.id}`, { status: "已校验" }, { headers: contentUserHeaders })));
  const invalidQuestion = draftDashboard.questions[0];
  await patchJson(`/api/questions/${invalidQuestion.id}`, { score: 0, status: "待确认" }, { headers: contentUserHeaders });
  const blockedPublish = await postJson("/api/papers/publish", {}, { headers: contentUserHeaders, expectedStatus: 409 });
  assert(blockedPublish.failures.some((failure) => failure.questionId === invalidQuestion.id && failure.field === "score"), "publish runs validation and returns actionable question failures");
  const blockedPublishDashboard = await getJson("/api/dashboard", { headers: contentUserHeaders });
  assert(blockedPublishDashboard.paper.status !== "已发布", "failed publish keeps the paper unpublished");
  await patchJson(`/api/questions/${invalidQuestion.id}`, { score: generated.questions[0].score, status: "已校验" }, { headers: contentUserHeaders });
  const published = await postJson("/api/papers/publish", {}, { headers: contentUserHeaders });
  assert(published.status === "已发布" && published.questionCount === 4 && published.score === 10, "publish automatically saves and publishes reviewed questions");
  const paper = published;
  const paperDetail = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  assert(paperDetail.questions.length === 4 && paperDetail.status === "已发布", "paper detail returns the published snapshot");
  assert(paperDetail.sourcePlanSnapshot.materialQuestionCount === 2 && paperDetail.sourcePlanSnapshot.materials.length === 2, "paper snapshot preserves source allocation and material versions");
  const usages = await getJson(`/api/materials/${materialOne.id}/usages`, { headers: contentUserHeaders });
  assert(usages.items.some((item) => item.paperId === paper.id && item.questionCount >= 1), "material usage links back to published papers");
  const archivedMaterial = await postJson(`/api/materials/${materialOne.id}/archive`, {}, { headers: contentUserHeaders });
  assert(archivedMaterial.status === "archived", "material can be archived without deleting historical evidence");
  const archivedPaperDetail = await getJson(`/api/papers/${paper.id}`, { headers: contentUserHeaders });
  assert(archivedPaperDetail.questions.some((question) => question.origin?.materialRefs?.some((ref) => ref.materialId === materialOne.id && ref.version === 2)), "archiving material keeps historical paper evidence intact");
  const activated = await postJson(`/api/papers/${paper.id}/activate`, {}, { headers: contentUserHeaders });
  assert(activated.id === paper.id, "paper can be activated as current");

  const importedPaperA = await postJson("/api/question-bank/import", { paperId: paper.id }, { headers: contentUserHeaders });
  assert(importedPaperA.created === 4 && importedPaperA.reused === 0, "first paper import creates unique bank questions");
  const bankAfterPaperA = await getJson("/api/question-bank?page=1&pageSize=20", { headers: contentUserHeaders });
  assert(bankAfterPaperA.total === 5, "manual and paper questions coexist in the bank");

  const secondSpec = { ...generated.spec, paperName: "核心能力测评 B 卷" };
  await postJson("/api/ai/save-question-draft", { questions: generated.questions, spec: secondSpec }, { headers: contentUserHeaders });
  const secondDraft = await getJson("/api/dashboard", { headers: contentUserHeaders });
  await Promise.all(secondDraft.questions.map((question) => patchJson(`/api/questions/${question.id}`, { status: "已校验" }, { headers: contentUserHeaders })));
  const paperB = await postJson("/api/papers/publish", {}, { headers: contentUserHeaders });
  assert(paperB.id !== paper.id && paperB.status === "已发布", "a second paper with the same questions is saved independently");
  const importedPaperB = await postJson("/api/question-bank/import", { paperId: paperB.id }, { headers: contentUserHeaders });
  assert(importedPaperB.created === 0 && importedPaperB.reused === 4, "same questions from paper B reuse paper A bank records");
  const bankAfterPaperB = await getJson("/api/question-bank?page=1&pageSize=20", { headers: contentUserHeaders });
  assert(bankAfterPaperB.total === 5, "paper B duplicate import does not create extra bank records");
  const sharedBankQuestion = bankAfterPaperB.items.find((item) => item.id !== manualBankQuestion.id);
  const sharedDetail = await getJson(`/api/question-bank/${sharedBankQuestion.id}`, { headers: contentUserHeaders });
  assert(sharedDetail.usages.some((item) => item.paperId === paper.id) && sharedDetail.usages.some((item) => item.paperId === paperB.id), "one bank question records both A and B paper sources");

  const importedIntoPaper = await postJson("/api/authoring/questions/import", { questionBankIds: [manualBankQuestion.id] }, { headers: contentUserHeaders });
  assert(importedIntoPaper.added === 1 && importedIntoPaper.questions[0].origin.bankQuestionId === manualBankQuestion.id, "reviewed bank question can be copied into the current paper with version reference");
  const paperBAfterImport = await getJson(`/api/papers/${paperB.id}`, { headers: contentUserHeaders });
  assert(paperBAfterImport.status === "草稿" && paperBAfterImport.questions.some((question) => question.origin?.bankQuestionId === manualBankQuestion.id), "adding a bank question creates a draft paper snapshot without changing the bank item");
  const repeatedPaperImport = await postJson("/api/authoring/questions/import", { questionBankIds: [manualBankQuestion.id] }, { headers: contentUserHeaders });
  assert(repeatedPaperImport.added === 0 && repeatedPaperImport.skipped === 1, "adding the same bank question twice to a paper is skipped");

  const dashboard = await getJson("/api/dashboard", { headers: adminHeaders });
  assert(dashboard.stats.questions === 5 && dashboard.stats.papers === 2 && dashboard.stats.published === 1, "dashboard reflects question-bank additions without duplicating papers");
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
