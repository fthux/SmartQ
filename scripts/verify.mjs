import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.VERIFY_PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "smartq-verify-"));
const runtimeFile = join(runtimeDir, "runtime.json");
const backupDir = join(runtimeDir, "backups");
let adminHeaders = {};
let output = "";

const server = spawn(process.execPath, ["backend/server.js"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    SMARTQ_DATA_FILE: runtimeFile,
    SMARTQ_BACKUP_DIR: backupDir,
    SMARTQ_BACKUP_RETENTION: "5",
    SMARTQ_BACKUP_MIN_INTERVAL_SECONDS: "0",
    SMARTQ_MAX_REQUEST_BYTES: String(128 * 1024),
    SMARTQ_ADMIN_ACCOUNTS: JSON.stringify([
      { username: "verify-admin", password: "123456", role: "admin" },
      { username: "verify-author", password: "Author@2026", role: "author" },
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
    "frontend/src/components/QuestionEditorDialog.vue",
    "frontend/src/core/public-path.js",
    "frontend/src/core/router.js",
    "frontend/src/pages/AuthoringPage.vue",
    "frontend/src/pages/LoginPage.vue",
    "frontend/src/pages/PapersPage.vue",
    "frontend/src/pages/ProfilePage.vue",
    "frontend/src/pages/UsersPage.vue",
    "frontend/src/stores/app-store.js",
    "frontend/src/stores/authoring-store.js",
    "frontend/src/stores/auth-store.js",
    "frontend/src/stores/layout-store.js",
    "frontend/src/stores/users-store.js",
    "frontend/src/styles/index.css",
  ];
  const frontendSources = await Promise.all(frontendFiles.map((path) => readFile(path, "utf8")));
  const frontend = frontendSources.join("\n");
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
  assert(frontend.includes("用户管理") && frontend.includes("/api/admin/users") && frontend.includes("重置密码"), "admin user management UI is available");
  assert(frontend.includes("mustChangePassword") && frontend.includes("/api/admin/password"), "initial password changes are enforced in the frontend");
  assert(frontend.includes("await uploadAdminAvatar(file)") && frontend.includes("用户头像已更新"), "valid avatar selection uploads immediately");
  assert(frontend.includes("100 * 1024") && frontend.includes("width !== dimensions.height"), "avatar selection enforces 100KB square images");
  assert(frontend.includes('window.scrollTo({ top: 0, left: 0, behavior: "auto" });'), "frontend resets scroll on module switches");
  assert(frontend.includes("出题制卷") && frontend.includes("已出卷子"), "frontend keeps authoring and paper UI");
  assert(frontend.indexOf('{ key: "papers"') < frontend.indexOf('{ key: "authoring"'), "paper management is the first navigation item");
  assert(frontend.includes('return ["authoring", "papers", "users", "profile"].includes(route) ? route : "papers";'), "papers is the default route and protected user/profile routes are routable");
  assert(frontend.includes('if (route === "papers") return "";'), "papers uses the root URL");
  assert(!/控制台首页|数据维护|运营会话|审计日志|自动备份历史/.test(frontend), "frontend removes the console homepage and maintenance UI");
  assert(!/参与者管理|试卷分配|监考工作台|阅卷分析|考生系统/.test(frontend), "frontend removes retired navigation and pages");
  assert(!/#\/candidate|\/api\/candidate\/|\/api\/participants|\/api\/assignments|\/api\/proctor|\/api\/grading|\/api\/analysis/.test(frontend), "frontend removes retired routes and API calls");
  assert(frontend.includes("cleanupLegacyServiceWorkers") && frontend.includes("registration.unregister()"), "frontend still clears legacy service workers");
  assert(frontend.includes("paperTypeConfig") && frontend.includes("computedSpecTotalScore"), "frontend keeps paper score calculation");
  assert(frontend.includes('paperPageSize: 20') && frontend.includes('aria-label="试卷状态筛选"'), "paper management uses the Element Plus list controls");
  assert(frontend.includes('aria-label="试卷详情抽屉"') && frontend.includes("paperDetailMode"), "paper details open in the responsive drawer");

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
  assert(adminLogin.admin.permissions.join(",") === "authoring,papers,users", "admin permissions include user management");
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

  const initialUsers = await getJson("/api/admin/users", { headers: adminHeaders });
  assert(initialUsers.total === 2 && initialUsers.roles.some((role) => role.value === "admin"), "admin can list bootstrapped users and role metadata");
  assert(initialUsers.users.every((user) => !("passwordHash" in user)), "user management responses never expose password hashes");
  const selfUpdate = await patchJson(`/api/admin/users/${adminMe.admin.id}`, { role: "author" }, { headers: adminHeaders, expectedStatus: 409 });
  assert(selfUpdate.error.includes("不能修改自己"), "an admin cannot remove their own authority");

  const createdUser = await postJson("/api/admin/users", {
    username: "managed-user",
    displayName: "受管用户",
    role: "author",
    password: "Managed@2026",
  }, { headers: adminHeaders, expectedStatus: 201 });
  assert(createdUser.user.mustChangePassword === true && createdUser.user.status === "active", "new users start active and must change their password");
  await postJson("/api/admin/users", {
    username: "managed-user",
    displayName: "重复用户",
    role: "author",
    password: "Managed@2026",
  }, { headers: adminHeaders, expectedStatus: 409 });
  const filteredUsers = await getJson("/api/admin/users?search=managed&page=1&pageSize=10", { headers: adminHeaders });
  assert(filteredUsers.total === 1 && filteredUsers.users[0].id === createdUser.user.id, "user list supports server-side search and pagination");

  const managedLogin = await postJson("/api/admin/login", { username: "managed-user", password: "Managed@2026" });
  let managedHeaders = authHeaders(managedLogin.token);
  assert(managedLogin.admin.mustChangePassword === true, "new user login reports the required password change");
  const forcedChange = await getJson("/api/dashboard", { headers: managedHeaders, expectedStatus: 403 });
  assert(forcedChange.mustChangePassword === true, "business APIs are blocked until the initial password is changed");
  const changedPassword = await putJson("/api/admin/password", {
    currentPassword: "Managed@2026",
    newPassword: "Managed@2027",
  }, { headers: managedHeaders });
  assert(changedPassword.admin.mustChangePassword === false, "user can replace the initial password");
  await getJson("/api/dashboard", { headers: managedHeaders });

  const promotedUser = await patchJson(`/api/admin/users/${createdUser.user.id}`, {
    displayName: "受管管理员",
    role: "admin",
  }, { headers: adminHeaders });
  assert(promotedUser.user.role === "admin" && promotedUser.user.displayName === "受管管理员", "admin can update another user's name and role");
  await getJson("/api/dashboard", { headers: managedHeaders, expectedStatus: 401 });
  const promotedLogin = await postJson("/api/admin/login", { username: "managed-user", password: "Managed@2027" });
  managedHeaders = authHeaders(promotedLogin.token);
  await getJson("/api/admin/users", { headers: managedHeaders });

  const resetUser = await postJson(`/api/admin/users/${createdUser.user.id}/reset-password`, { password: "Reset@2028" }, { headers: adminHeaders });
  assert(resetUser.user.mustChangePassword === true && resetUser.revokedSessions >= 1, "password reset marks the password temporary and revokes sessions");
  await getJson("/api/dashboard", { headers: managedHeaders, expectedStatus: 401 });
  const resetLogin = await postJson("/api/admin/login", { username: "managed-user", password: "Reset@2028" });
  const resetHeaders = authHeaders(resetLogin.token);
  const disabledUser = await patchJson(`/api/admin/users/${createdUser.user.id}`, { status: "disabled" }, { headers: adminHeaders });
  assert(disabledUser.user.status === "disabled", "admin can disable another user");
  await getJson("/api/admin/me", { headers: resetHeaders, expectedStatus: 401 });
  await postJson("/api/admin/login", { username: "managed-user", password: "Reset@2028" }, { expectedStatus: 403 });

  const authorLogin = await postJson("/api/admin/login", { username: "verify-author", password: "Author@2026" });
  let authorHeaders = authHeaders(authorLogin.token);
  assert(authorLogin.admin.permissions.join(",") === "authoring,papers", "author role contains only content permissions");
  const blockedAuthorUsers = await getJson("/api/admin/users", { headers: authorHeaders, expectedStatus: 403 });
  assert(blockedAuthorUsers.permission === "users", "author role cannot access user management APIs");
  const revokedAuthor = await postJson(`/api/admin/users/${authorLogin.admin.id}/revoke-sessions`, {}, { headers: adminHeaders });
  assert(revokedAuthor.revokedSessions >= 1, "admin can force another user offline");
  await getJson("/api/dashboard", { headers: authorHeaders, expectedStatus: 401 });
  const authorRelogin = await postJson("/api/admin/login", { username: "verify-author", password: "Author@2026" });
  authorHeaders = authHeaders(authorRelogin.token);

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

  const generationSpec = {
    paperName: "核心能力测评",
    direction: "JavaScript 工程实践",
    difficulty: "中",
    typeCounts: { single: 2, multiple: 1, judge: 1, blank: 0, short: 0, essay: 0 },
    typeScores: { single: 2, multiple: 4, judge: 2, blank: 2, short: 5, essay: 10 },
    knowledge: ["语言基础", "工程质量"],
    requirements: "题干清晰，答案明确。",
  };
  const generated = await generateQuestionsAsync(generationSpec, authorHeaders);
  assert(generated.questions.length === 4 && generated.spec.totalScore === 10, "AI mock generation respects retained paper specification");
  const previewDashboard = await getJson("/api/dashboard", { headers: authorHeaders });
  assert(previewDashboard.questions.length === 0, "unsaved generation does not mutate runtime content");

  const savedDraft = await postJson("/api/ai/save-question-draft", { questions: generated.questions, spec: generated.spec }, { headers: authorHeaders });
  assert(savedDraft.saved === true, "generated preview can be saved");
  const draftDashboard = await getJson("/api/dashboard", { headers: authorHeaders });
  assert(draftDashboard.questions.length === 4 && draftDashboard.stats.pendingReview === 4, "dashboard reflects saved draft and review count");

  const quality = await postJson("/api/quality/check", {}, { headers: authorHeaders });
  assert(Array.isArray(quality.failures) && Number.isFinite(quality.schemaPassRate), "quality check remains available");
  const blockedBuild = await postJson("/api/papers/build", {}, { headers: authorHeaders, expectedStatus: 409 });
  assert(blockedBuild.eligibleCount === 0, "paper build requires manual review");

  await Promise.all(draftDashboard.questions.map((question) => patchJson(`/api/questions/${question.id}`, { status: "已校验" }, { headers: authorHeaders })));
  const paper = await postJson("/api/papers/build", {}, { headers: authorHeaders });
  assert(paper.status === "草稿" && paper.questionCount === 4 && paper.score === 10, "reviewed questions build a draft paper");
  const published = await postJson("/api/papers/publish", {}, { headers: authorHeaders });
  assert(published.status === "已发布" && published.id === paper.id, "paper publishing remains available");
  const paperDetail = await getJson(`/api/papers/${paper.id}`, { headers: authorHeaders });
  assert(paperDetail.questions.length === 4 && paperDetail.status === "已发布", "paper detail returns the published snapshot");
  const activated = await postJson(`/api/papers/${paper.id}/activate`, {}, { headers: authorHeaders });
  assert(activated.id === paper.id, "paper can be activated as current");

  const dashboard = await getJson("/api/dashboard", { headers: adminHeaders });
  assert(dashboard.stats.questions === 4 && dashboard.stats.papers === 1 && dashboard.stats.published === 1, "dashboard exposes reduced content statistics");
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
