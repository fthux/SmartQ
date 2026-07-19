import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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
  assert(shell.includes('<div id="app"') && shell.includes("assets/app.js"), "root serves the Vue app shell");
  const nestedShell = await getText("/smartq/");
  assert(nestedShell.includes('<div id="app"') && nestedShell.includes("assets/app.js"), "subdirectory path serves the Vue app shell");
  const appJs = await getText("/assets/app.js");
  assert(appJs.includes('aria-label="管理功能导航"') && appJs.includes('data-admin-route-content'), "frontend keeps the management sidebar layout");
  assert(appJs.includes('window.scrollTo({ top: 0, left: 0, behavior: "auto" });'), "frontend resets scroll on module switches");
  assert(appJs.includes("出题制卷") && appJs.includes("已出卷子"), "frontend keeps authoring and paper UI");
  assert(appJs.indexOf('{ key: "papers"') < appJs.indexOf('{ key: "authoring"'), "paper management is the first navigation item");
  assert(appJs.includes('return ["authoring", "papers"].includes(route) ? route : "papers";'), "papers is the default route");
  assert(appJs.includes('if (route === "papers") return "";'), "papers uses the root URL");
  assert(!/控制台首页|数据维护|运营会话|审计日志|自动备份历史/.test(appJs), "frontend removes the console homepage and maintenance UI");
  assert(!/参与者管理|试卷分配|监考工作台|阅卷分析|考生系统/.test(appJs), "frontend removes retired navigation and pages");
  assert(!/#\/candidate|\/api\/candidate\/|\/api\/participants|\/api\/assignments|\/api\/proctor|\/api\/grading|\/api\/analysis/.test(appJs), "frontend removes retired routes and API calls");
  assert(appJs.includes("cleanupLegacyServiceWorkers") && appJs.includes("registration.unregister()"), "frontend still clears legacy service workers");
  assert(appJs.includes("paperTypeConfig") && appJs.includes("computedSpecTotalScore"), "frontend keeps paper score calculation");
  assert(appJs.includes('paperPageSize: 20') && appJs.includes('aria-label="试卷状态筛选"'), "paper management uses the dense list controls");
  assert(appJs.includes('aria-label="试卷详情抽屉"') && appJs.includes("paperDetailMode"), "paper details open in the responsive drawer");

  const blockedDashboard = await getJson("/api/dashboard", { expectedStatus: 401 });
  assert(blockedDashboard.error.includes("运营控制台"), "dashboard requires admin login");
  const oversizedLogin = await postJson("/api/admin/login", { username: "x".repeat(140 * 1024), password: "x" }, { expectedStatus: 413 });
  assert(oversizedLogin.error.includes("请求体过大"), "oversized JSON is rejected");

  await postJson("/api/admin/login", { username: "missing", password: "wrong" }, { expectedStatus: 401 });
  await postJson("/api/admin/login", { username: "missing", password: "wrong" }, { expectedStatus: 401 });
  const blockedLogin = await postJson("/api/admin/login", { username: "missing", password: "wrong" }, { expectedStatus: 429 });
  assert(blockedLogin.retryAfterSeconds > 0, "admin login rate limit remains active");

  const adminLogin = await postJson("/api/admin/login", { username: "verify-admin", password: "123456" });
  adminHeaders = authHeaders(adminLogin.token);
  assert(adminLogin.admin.permissions.join(",") === "authoring,papers", "admin permissions contain only retained modules");
  const adminMe = await getJson("/api/admin/me", { headers: adminHeaders });
  assert(adminMe.admin.username === "verify-admin", "admin token loads current user");

  const authorLogin = await postJson("/api/admin/login", { username: "verify-author", password: "Author@2026" });
  const authorHeaders = authHeaders(authorLogin.token);
  assert(authorLogin.admin.permissions.join(",") === "authoring,papers", "author role contains only content permissions");

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

function patchJson(path, body = {}, options = {}) {
  return requestJson(path, { ...options, method: "PATCH", body });
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
