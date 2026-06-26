import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.VERIFY_PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "smartq-verify-"));
const runtimeFile = join(runtimeDir, "runtime.json");
const backupDir = join(runtimeDir, "backups");
const evidenceDir = join(runtimeDir, "evidence");
const fakePostgres = await startFakePostgres();
const fakeRedis = await startFakeRedis();
const fakeS3 = await startFakeS3();
let adminHeaders = {};

const server = spawn(process.execPath, ["backend/server.js"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    SMARTQ_DATA_FILE: runtimeFile,
    SMARTQ_DATABASE_URL: `postgres://smartq:smartq@127.0.0.1:${fakePostgres.port}/smartq`,
    SMARTQ_STORAGE_ADAPTER: "postgres",
    SMARTQ_BACKUP_DIR: backupDir,
    SMARTQ_EVIDENCE_DIR: evidenceDir,
    SMARTQ_EVIDENCE_ADAPTER: "s3",
    SMARTQ_EVIDENCE_BUCKET: "smartq-verify-evidence",
    SMARTQ_EVIDENCE_ENDPOINT: `http://127.0.0.1:${fakeS3.port}`,
    SMARTQ_EVIDENCE_ACCESS_KEY_ID: "verify-access-key",
    SMARTQ_EVIDENCE_SECRET_ACCESS_KEY: "verify-secret-key",
    SMARTQ_EVIDENCE_REGION: "us-east-1",
    SMARTQ_EVIDENCE_PREFIX: "verify-evidence",
    SMARTQ_BACKUP_RETENTION: "5",
    SMARTQ_BACKUP_MIN_INTERVAL_SECONDS: "60",
    SMARTQ_ONLINE_TTL_SECONDS: "30",
    SMARTQ_REDIS_URL: `redis://127.0.0.1:${fakeRedis.port}`,
    SMARTQ_REDIS_NAMESPACE: "smartq-verify",
    SMARTQ_MAX_REQUEST_BYTES: String(128 * 1024),
    SMARTQ_MAX_EVIDENCE_BYTES: String(16 * 1024),
    AI_MOCK_MODE: "true",
    SMARTQ_ADMIN_ACCOUNTS: JSON.stringify([
      { username: "verify-admin", password: "123456", role: "admin" },
      { username: "verify-proctor", password: "Proctor@2026", role: "proctor" },
    ]),
    SMARTQ_LOGIN_MAX_FAILURES: "2",
    SMARTQ_LOGIN_WINDOW_SECONDS: "60",
    SMARTQ_LOGIN_LOCK_SECONDS: "30",
  },
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth();

  const health = await getJson("/api/health");
  assert(health.ok === true, "health ok");
  assert(health.storage.adapter === "postgres" && health.storage.status?.postgresReachable === true, "health exposes postgres storage diagnostics");
  assert(health.storage.requestedAdapter === "postgres", "health exposes requested postgres storage adapter");
  assert(health.storage.effectiveAdapter === "postgres", "health exposes effective postgres storage adapter");
  assert(health.storage.degraded === false, "health reports healthy postgres storage adapter");
  assert(health.storage.status?.databaseConfigured === true, "health reports database configuration was detected");
  assert(health.evidence.requestedAdapter === "s3", "health exposes requested object evidence adapter");
  assert(health.evidence.effectiveAdapter === "object-storage", "health exposes effective object evidence adapter");
  assert(health.evidence.degraded === false && health.evidence.status?.objectStorageReachable === true, "health reports reachable object evidence adapter");
  assert(health.evidence.status?.bucketConfigured === true, "health reports evidence bucket configuration was detected");
  assert(health.proctor.onlineTtlSeconds === 30, "health exposes configured proctor online ttl");
  assert(health.proctor.presenceAdapter === "redis", "health exposes redis presence store adapter");
  assert(health.proctor.requestedPresenceAdapter === "redis", "health exposes requested redis presence adapter");
  assert(health.proctor.effectivePresenceAdapter === "redis", "health exposes effective redis presence adapter");
  assert(health.proctor.presenceDegraded === false && health.proctor.presenceStatus?.redisReachable === true, "health reports reachable redis presence adapter");
  assert(health.proctor.presenceStatus?.redisConfigured === true, "health reports redis configuration was detected");
  assert(health.aiReady === true && health.mode === "mock", "health exposes AI diagnostics");
  assert(health.limits.maxRequestBytes === 128 * 1024, "health exposes configured request body limit");
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert(healthResponse.headers.get("x-content-type-options") === "nosniff", "API responses include content-type safety header");
  assert(healthResponse.headers.get("x-frame-options") === "DENY", "API responses include frame safety header");
  const appShell = await getText("/");
  assert(appShell.includes('<div id="app"'), "root serves Vue SPA shell");
  assert(appShell.includes("/assets/app.js"), "root SPA loads app.js");
  const appJs = await getText("/assets/app.js");
  assert(appJs.includes("visibleNavItems") && appJs.includes("hasAdminPermission('system')"), "frontend filters navigation and system maintenance by admin permissions");
  assert(appJs.includes('v-if="state.admin.token"') && appJs.includes("v-for=\"item in visibleNavItems\""), "frontend hides top console navigation before admin login");
  assert(appJs.includes("运营会话") && appJs.includes("审计日志"), "frontend exposes system session and audit maintenance panels");
  assert(appJs.includes("自动备份历史"), "frontend exposes local backup history panel");
  assert(appJs.includes("运维告警") && appJs.includes("opsSnapshot") && appJs.includes("/api/admin/ops"), "frontend exposes operations alerts panel");
  assert(appJs.includes("已配置数据库，当前仍使用 JSON 文件") && appJs.includes("已配置 Redis，当前仍使用内存状态"), "frontend exposes degraded storage and presence status");
  assert(appJs.includes("已配置对象存储，当前仍使用本地文件") && appJs.includes("证据存储") && appJs.includes("证据状态"), "frontend exposes degraded evidence storage status");
  assert(appJs.includes("launchReadinessItems") && appJs.includes("生产存储") && appJs.includes("运行时备份"), "frontend exposes launch readiness checklist");
  assert(appJs.includes("发布成绩") && appJs.includes("正式成绩") && appJs.includes("成绩暂未发布"), "frontend exposes result publication workflow");
  assert(appJs.includes("提交成绩申诉") && appJs.includes("受理复核") && appJs.includes("申诉处理说明"), "frontend exposes score appeal workflow");
  assert(appJs.includes("return filteredGradingReviewQueue.value.find((item) => item.sessionId === id) || null"), "frontend review detail follows filtered review queue");
  assert(appJs.includes("const nextQueue = filteredGradingReviewQueue.value") && appJs.includes("state.selectedReviewSessionId = nextEntry?.sessionId || \"\""), "frontend review detail clears or advances after review submit");
  assert(appJs.includes("取证报告") && appJs.includes("导出取证") && appJs.includes("监考取证报告"), "frontend exposes proctor evidence report workflow");
  assert(appJs.includes("自动分析") && appJs.includes("风险分") && appJs.includes("recommendations"), "frontend exposes proctor automatic evidence analysis");
  assert(appJs.includes("sendCandidateEvidenceSnapshot") && appJs.includes("取证快照"), "frontend collects candidate proctor evidence snapshots");
  assert(appJs.includes("摄像头和屏幕取证已暂时停用") && !appJs.includes("截图取证") && !appJs.includes("captureVideoFrameDataUrl"), "frontend disables camera and screen evidence capture");
  assert(appJs.includes("state.candidate.loginErrors.form") && appJs.includes("手机号或密码错误"), "frontend shows candidate login failures inline");
  assert(appJs.includes("返回我的考试") && appJs.includes("backToCandidateExams"), "frontend exposes in-page return to candidate exam list");
  assert(!appJs.includes("摄像头 {{ item.camera }}") && appJs.includes("{{ item.displayStatus || item.status }}"), "frontend avoids duplicate submitted status on proctor cards");
  assert(appJs.includes("证据附件") && appJs.includes("evidenceAttachments") && appJs.includes("downloadEvidenceAttachment"), "frontend exposes proctor evidence attachments in reports");
  assert(appJs.includes("SHA-256"), "frontend exposes proctor evidence attachment digest");
  assert(appJs.includes("提交需全屏") && appJs.includes("提交前需完成"), "frontend exposes active proctor compliance requirements");
  assert(appJs.includes("/api/proctor/stream") && appJs.includes("实时通道"), "frontend connects proctor realtime stream");
  assert(/const defaultSpec = \{\s+paperName: "",\s+direction: "",\s+difficulty: "中",\s+totalScore: 0,\s+singleCount: 0,\s+multipleCount: 0,\s+judgeCount: 0,\s+blankCount: 0,\s+shortCount: 0,\s+essayCount: 0,\s+knowledge: "",\s+requirements: "",\s+\};/m.test(appJs), "frontend leaves authoring text fields empty, numeric fields zero, and difficulty selected by default");
  assert(appJs.includes('placeholder="请输入考卷名称"') && appJs.includes('placeholder="请输入出题方向"') && appJs.includes('placeholder="请输入知识点范围，用逗号分隔"') && appJs.includes('placeholder="请输入补充要求"'), "frontend shows authoring form placeholders");
  assert(!appJs.includes("await saveGeneratedContent(generated, { silent: true })") && appJs.includes("进入质量复检") && appJs.includes("saveDraft"), "frontend keeps generated authoring preview unsaved until explicit confirmation");
  const config = await getJson("/api/config");
  assert(config.aiReady === true, "config reports AI layer ready");
  assert(config.mode === "mock", "verification explicitly enables mock mode");
  assert(config.aiOnline === false, "config does not report provider online in mock mode");
  const oversizedLogin = await postJson("/api/admin/login", {
    username: "x".repeat(140 * 1024),
    password: "x",
  }, { expectedStatus: 413 });
  assert(oversizedLogin.error.includes("请求体过大"), "oversized JSON request is rejected");
  const blockedDashboard = await getJson("/api/dashboard", { expectedStatus: 401 });
  assert(blockedDashboard.error.includes("运营控制台"), "dashboard requires admin login");
  const badAdminLogin = await postJson("/api/admin/login", {
    username: "admin",
    password: "wrong-password",
  }, { expectedStatus: 401 });
  assert(badAdminLogin.error.includes("管理员"), "admin login rejects bad credentials");
  const lockedAdminLogin = await postJson("/api/admin/login", {
    username: "admin",
    password: "wrong-password",
  }, { expectedStatus: 401 });
  assert(lockedAdminLogin.error.includes("管理员"), "admin login records repeated bad credentials before lock");
  const blockedAdminLogin = await postJson("/api/admin/login", {
    username: "admin",
    password: "123456",
  }, { expectedStatus: 429 });
  assert(blockedAdminLogin.retryAfterSeconds > 0, "admin login rate limit blocks even correct password after repeated failures");
  const adminLogin = await postJson("/api/admin/login", {
    username: "verify-admin",
    password: "123456",
  });
  assert(adminLogin.token && adminLogin.admin.username === "verify-admin", "admin login returns auth token");
  assert(adminLogin.admin.permissions.includes("system"), "admin role receives system permission");
  adminHeaders = authHeaders(adminLogin.token);
  const adminMe = await getJson("/api/admin/me", { headers: adminHeaders });
  assert(adminMe.admin.username === "verify-admin", "admin token can load current admin");
  assert(adminMe.admin.permissions.includes("authoring") && adminMe.admin.permissions.includes("proctor"), "admin token exposes full permissions");

  const proctorLogin = await postJson("/api/admin/login", {
    username: "verify-proctor",
    password: "Proctor@2026",
  });
  assert(proctorLogin.admin.role === "proctor" && proctorLogin.admin.permissions.includes("proctor"), "proctor role can login with proctor permission");
  const proctorHeaders = authHeaders(proctorLogin.token);
  const proctorDashboard = await getJson("/api/dashboard", { headers: proctorHeaders });
  assert(proctorDashboard.sessions.length >= 1, "proctor role can view dashboard overview");
  const proctorAuthoringBlocked = await postJson("/api/ai/generate-questions", {
    direction: "权限验证",
    totalScore: 10,
    typeCounts: { single: 1 },
  }, { headers: proctorHeaders, expectedStatus: 403 });
  assert(proctorAuthoringBlocked.permission === "authoring", "proctor role cannot access authoring APIs");
  const proctorStorageBlocked = await getJson("/api/admin/storage", { headers: proctorHeaders, expectedStatus: 403 });
  assert(proctorStorageBlocked.permission === "system", "proctor role cannot access system maintenance APIs");
  const proctorOpsBlocked = await getJson("/api/admin/ops", { headers: proctorHeaders, expectedStatus: 403 });
  assert(proctorOpsBlocked.permission === "system", "proctor role cannot access system ops APIs");
  const proctorSessionsAllowed = await getJson("/api/proctor/sessions", { headers: proctorHeaders });
  assert(Array.isArray(proctorSessionsAllowed.sessions), "proctor role can access proctor APIs");
  const proctorStreamReady = await readSseEvent(`/api/proctor/stream?token=${encodeURIComponent(proctorLogin.token)}`);
  assert(proctorStreamReady.includes("event: ready"), "proctor role can connect realtime proctor stream");
  const adminSessions = await getJson("/api/admin/sessions", { headers: adminHeaders });
  assert(adminSessions.sessions.some((item) => item.username === "verify-admin" && item.current), "system admin can list current admin session");
  const proctorSessionRow = adminSessions.sessions.find((item) => item.username === "verify-proctor");
  assert(proctorSessionRow && !proctorSessionRow.current, "system admin can see other admin sessions");
  const revokedProctorSession = await deleteJson(`/api/admin/sessions/${encodeURIComponent(proctorSessionRow.id)}`, { headers: adminHeaders });
  assert(revokedProctorSession.revoked === true && revokedProctorSession.session.username === "verify-proctor", "system admin can revoke another admin session");
  const staleProctorAfterRevoke = await getJson("/api/proctor/sessions", { headers: proctorHeaders, expectedStatus: 401 });
  assert(staleProctorAfterRevoke.error.includes("失效"), "revoked admin session token becomes invalid");
  const auditLoginRows = await getJson("/api/admin/audit?type=admin-login&limit=20", { headers: adminHeaders });
  assert(auditLoginRows.rows.some((item) => item.message.includes("verify-admin")), "system admin can query audit logs by type");
  const auditRevokeRows = await getJson("/api/admin/audit?q=撤销&limit=20", { headers: adminHeaders });
  assert(auditRevokeRows.rows.some((item) => item.type === "admin-session-revoke"), "audit search finds revoked session records");

  const storage = await getJson("/api/admin/storage", { headers: adminHeaders });
  assert(storage.storage.adapter === "postgres", "admin storage endpoint reports postgres adapter");
  assert(storage.storage.requestedAdapter === "postgres", "admin storage endpoint reports requested postgres adapter");
  assert(storage.storage.degraded === false && storage.storage.status.postgresReachable === true, "admin storage endpoint reports postgres reachable");
  assert(storage.storage.backupDir === backupDir, "admin storage endpoint reports configured backup directory");
  assert(storage.storage.backupMinIntervalSeconds === 60, "admin storage endpoint reports backup throttle interval");
  const ops = await getJson("/api/admin/ops", { headers: adminHeaders });
  assert(["ok", "warning", "critical"].includes(ops.status), "admin ops endpoint returns status");
  assert(Number.isFinite(ops.metrics.sessions) && Array.isArray(ops.alerts) && Array.isArray(ops.checks), "admin ops endpoint returns metrics alerts and checks");
  assert(!ops.alerts.some((item) => item.id === "storage-degraded"), "admin ops endpoint does not report storage alert when postgres is reachable");
  const initialBackup = await getJson("/api/admin/backup", { headers: adminHeaders });
  assert(initialBackup.version === 1 && initialBackup.state, "admin backup endpoint returns versioned state snapshot");
  assert(initialBackup.state.adminSessions && Object.keys(initialBackup.state.adminSessions).length === 0, "backup snapshot strips admin sessions");
  assert(initialBackup.state.loginSecurity && Object.keys(initialBackup.state.loginSecurity.attempts || {}).length === 0, "backup snapshot strips login rate-limit state");
  assert(Array.isArray(initialBackup.state.questions) && initialBackup.state.questions.length === 12, "backup snapshot includes question bank");
  const backupTempGroup = await postJson("/api/groups", {
    name: "备份恢复临时组",
    description: "用于验证恢复后回滚",
  }, { expectedStatus: 201, headers: adminHeaders });
  assert(backupTempGroup.id, "temporary group is created before restore");
  const backupHistory = await getJson("/api/admin/backups", { headers: adminHeaders });
  assert(backupHistory.backups.length >= 1, "local backup history is created before runtime writes");
  assert(backupHistory.storage.backupCount === backupHistory.backups.length, "storage info counts local backup history");
  const firstHistoricalBackup = await getJson(`/api/admin/backups/${encodeURIComponent(backupHistory.backups[0].name)}`, { headers: adminHeaders });
  assert(firstHistoricalBackup.backup.name === backupHistory.backups[0].name && firstHistoricalBackup.snapshot, "local backup snapshot can be downloaded");
  await postJson("/api/groups", { name: "备份节流临时组 A" }, { expectedStatus: 201, headers: adminHeaders });
  await postJson("/api/groups", { name: "备份节流临时组 B" }, { expectedStatus: 201, headers: adminHeaders });
  const throttledBackupHistory = await getJson("/api/admin/backups", { headers: adminHeaders });
  assert(throttledBackupHistory.backups.length === backupHistory.backups.length, "local backup history is throttled during rapid writes");
  const restoreResult = await postJson("/api/admin/restore", initialBackup, { headers: adminHeaders });
  assert(restoreResult.restored === true, "admin restore endpoint restores backup snapshot");
  assert(restoreResult.stats.groups >= 1, "restore response includes restored state stats");
  const staleAdminAfterRestore = await getJson("/api/admin/me", { headers: adminHeaders, expectedStatus: 401 });
  assert(staleAdminAfterRestore.error.includes("运营登录") || staleAdminAfterRestore.error.includes("请先登录"), "restore invalidates existing admin token");
  const reloginAfterRestore = await postJson("/api/admin/login", {
    username: "verify-admin",
    password: "123456",
  });
  assert(reloginAfterRestore.token, "admin can login again after restore");
  adminHeaders = authHeaders(reloginAfterRestore.token);
  const restoredGroups = await getJson("/api/groups", { headers: adminHeaders });
  assert(!restoredGroups.groups.some((item) => item.name === "备份恢复临时组"), "restored state removes changes made after backup");
  assert(!restoredGroups.groups.some((item) => item.name === "备份节流临时组 A" || item.name === "备份节流临时组 B"), "restored state removes throttled-write test groups");
  const backupAfterRestore = await getJson("/api/admin/backup", { headers: adminHeaders });
  assert(backupAfterRestore.state.auditLog.some((item) => item.type === "backup-restore"), "restore writes audit log entry");

  const dashboard = await getJson("/api/dashboard", { headers: adminHeaders });
  assert(dashboard.exam.totalScore === 50, "exam total score is 50");
  assert(dashboard.paper.score === 50, "paper score is 50");
  assert(dashboard.questions.length === 12, "dashboard has 12 questions");
  assert(Array.isArray(dashboard.participants) && dashboard.participants.length >= 1, "dashboard exposes participant information list");
  assert(Array.isArray(dashboard.groups) && dashboard.groups.length >= 1, "dashboard exposes group list");
  assert(dashboard.stats.registered === dashboard.participants.length, "dashboard registered count is derived from participants");
  assert(dashboard.stats.sessions === dashboard.sessions.length, "dashboard session count is derived from sessions");
  assert(dashboard.stats.submitted === dashboard.sessions.filter((item) => item.status === "已提交").length, "dashboard submitted count is derived from sessions");
  assert(dashboard.stats.progress === Math.round(dashboard.sessions.reduce((sum, item) => sum + Number(item.progress || 0), 0) / dashboard.sessions.length), "dashboard progress is derived from sessions");
  assert(appJs.includes("待开考") && appJs.includes("平均进度") && appJs.includes("试卷分配概览"), "dashboard home exposes operational overview sections");

  const createdGroup = await postJson("/api/groups", {
    name: "验证组",
    description: "验证流程创建的分组",
  }, { expectedStatus: 201, headers: adminHeaders });
  assert(createdGroup.name === "验证组", "group creation works");
  assert(createdGroup.description.includes("验证流程"), "group creation preserves description");
  const duplicateGroup = await postJson("/api/groups", {
    name: "验证组",
  }, { expectedStatus: 409 });
  assert(duplicateGroup.error.includes("分组"), "group creation rejects duplicate name");
  const updatedGroup = await patchJson(`/api/groups/${createdGroup.id}`, {
    name: "验证组",
    description: "更新后的验证备注",
  });
  assert(updatedGroup.description.includes("更新后"), "group update works");
  const tempGroup = await postJson("/api/groups", {
    name: "临时组",
    description: "可删除分组",
  }, { expectedStatus: 201 });
  const deletedTempGroup = await deleteJson(`/api/groups/${tempGroup.id}`);
  assert(deletedTempGroup.deleted === true, "unused group can be deleted");
  await Promise.all(["A组", "B组", "C组"].map((name) => postJson("/api/groups", { name, description: `${name} 验证分组` }, { expectedStatus: 201 })));
  const invalidGroupParticipant = await postJson("/api/participants", {
    candidate: "无效分组参与者",
    ticket: "202606230000",
    className: "不存在分组",
    phone: "13800000000",
  }, { expectedStatus: 409 });
  assert(invalidGroupParticipant.error.includes("分组"), "participant creation requires existing group");

  const createdCandidate = await postJson("/api/participants", {
    candidate: "导入前参与者",
    className: "验证组",
    phone: "13800000001",
    email: "participant@example.com",
    description: "验证创建的参与者",
    password: "pass-000001",
  }, { expectedStatus: 201 });
  assert(/^P\d{6}$/.test(createdCandidate.ticket), "single participant creation generates ticket");
  assert(createdCandidate.phone === "13800000001", "single candidate creation preserves phone");
  assert(createdCandidate.email === "participant@example.com", "single participant creation preserves email");
  assert(createdCandidate.hasPassword === true && !createdCandidate.passwordHash, "participant response exposes password status without hash");
  const updatedCandidate = await patchJson(`/api/participants/${createdCandidate.ticket}`, {
    candidate: "更新后参与者",
    className: "验证组",
    phone: "13900000001",
    email: "updated@example.com",
    description: "已更新描述",
    avatar: "data:image/png;base64,AA==",
  });
  assert(updatedCandidate.candidate === "更新后参与者", "participant update works");
  assert(updatedCandidate.email === "updated@example.com", "participant update preserves optional fields");
  const deleteUsedGroup = await deleteJson(`/api/groups/${createdGroup.id}`, { expectedStatus: 409 });
  assert(deleteUsedGroup.error.includes("不能删除"), "used group cannot be deleted");
  const duplicatePhoneCandidate = await postJson("/api/participants", {
    candidate: "重复手机号参与者",
    ticket: "202606230010",
    className: "验证组",
    phone: updatedCandidate.phone,
  }, { expectedStatus: 409 });
  assert(duplicatePhoneCandidate.error.includes("手机号"), "candidate creation rejects duplicate phone");
  const invalidPhoneCandidate = await postJson("/api/participants", {
    candidate: "无效手机参与者",
    className: "验证组",
    phone: "12345",
  }, { expectedStatus: 400 });
  assert(invalidPhoneCandidate.error.includes("手机号格式"), "candidate creation rejects invalid phone format");
  const invalidEmailCandidate = await patchJson(`/api/participants/${createdCandidate.ticket}`, {
    email: "not-an-email",
  }, { expectedStatus: 400 });
  assert(invalidEmailCandidate.error.includes("邮箱"), "participant update rejects invalid email");
  const duplicateCandidate = await postJson("/api/participants", {
    candidate: "重复参与者",
    ticket: createdCandidate.ticket,
    className: "验证组",
    phone: "13800000009",
  }, { expectedStatus: 409 });
  assert(duplicateCandidate.error.includes("编号"), "candidate creation rejects duplicate ticket");
  const candidatePreview = await postJson("/api/participants/import-preview", {
    text: `预览参与者,202606230002,验证组,13800000002\n重复预览,${createdCandidate.ticket},验证组,13800000003`,
  });
  assert(candidatePreview.validCount === 1, "candidate import preview counts valid rows");
  assert(candidatePreview.invalidCount === 1, "candidate import preview catches duplicate tickets");
  const autoTicketPreview = await postJson("/api/participants/import-preview", {
    text: "自动编号参与者,,验证组,13800000012",
  });
  assert(autoTicketPreview.validCount === 1 && autoTicketPreview.rows[0].generatedTicket === true, "candidate import preview auto-generates missing tickets");
  const candidateBatch = await postJson("/api/participants/batch", {
    candidates: [
      { candidate: "批量参与者甲", ticket: "202606230003", className: "验证组", phone: "13800000003" },
      { candidate: "批量参与者乙", ticket: "202606230004", className: "验证组", phone: "13800000004" },
    ],
  }, { expectedStatus: 201 });
  assert(candidateBatch.candidates.length === 2, "candidate batch import creates candidates");
  const candidatesAfterBatch = await getJson("/api/participants");
  assert(candidatesAfterBatch.participants.some((item) => item.ticket === "202606230004"), "participant list returns imported participants");
  assert(candidatesAfterBatch.participants.every((item) => !item.passwordHash), "participant list never exposes password hashes");
  const deletedCandidate = await deleteJson("/api/participants/202606230004");
  assert(deletedCandidate.deleted === true, "candidate delete works");
  const batchDeletedCandidate = await postJson("/api/participants/delete-batch", {
    tickets: ["202606230003"],
  });
  assert(batchDeletedCandidate.deleted === true && batchDeletedCandidate.participants.length === 1, "participant batch delete works");

  const unauthenticatedLegacySession = await getJson("/api/candidate/session/s-001", { expectedStatus: 401 });
  assert(unauthenticatedLegacySession.error.includes("登录"), "candidate session requires login token");
  const missingSession = await getJson("/api/candidate/session/s-999", { expectedStatus: 404 });
  assert(missingSession.error === "Session Not Found", "candidate endpoint rejects unknown session");

  const generationSpec = {
    title: "开发能力测评",
    paperName: "C++ 工程能力测评 A 卷",
    direction: "C++ 语言基础与工程实践",
    difficulty: "混合",
    totalScore: 50,
    typeCounts: { single: 4, multiple: 2, judge: 2, blank: 2, short: 2, essay: 0 },
    knowledge: ["语法基础", "STL", "内存管理", "面向对象", "异常处理"],
    requirements: "题干清晰，答案唯一或评分规则明确。",
  };
  const generated = await postJson("/api/ai/generate-questions", generationSpec);
  assert(generated.questions.length === 12, "AI generation returns 12 questions");
  assert(generated.saved === false, "AI generation returns an unsaved preview");
  assert(generated.spec.direction === generationSpec.direction, "AI generation preserves direction");
  assert(generated.spec.paperName === generationSpec.paperName, "AI generation preserves paper name");
  assert(generated.checks.specPass === true, "AI generation passes spec checks after normalization");
  assert(generated.checks.specFailures.length === 0, "AI generation reports no spec failures after normalization");
  assert(generated.questions.reduce((sum, item) => sum + Number(item.score || 0), 0) === 50, "AI generation respects total score");
  assert(generated.questions.every((item) => !item.stem.startsWith("【")), "AI generation does not prefix stems with direction text");
  assert(generated.questions.some((item) => item.knowledge.includes(generationSpec.direction)), "AI generation keeps requested direction in metadata");
  assert(generated.questions.filter((item) => item.type === "单选").length === 4, "AI generation respects single-choice count");
  assert(generated.questions.filter((item) => item.type === "多选").length === 2, "AI generation respects multiple-choice count");
  assert(generated.questions.filter((item) => item.type === "论述").length === 0, "AI generation respects zero essay count");
  assert(!generated.questions.some((item) => Array.isArray(item.options) && item.options.includes("与题干无关的描述")), "AI generation avoids generic repeated choice option");
  assert(generated.questions.filter((item) => item.type === "填空").every((item) => item.stem.includes("______") && !item.stem.includes("第 ")), "blank questions use real fill-in stems");
  assert(generated.questions.filter((item) => ["简答", "论述"].includes(item.type)).every((item) => !String(item.answer).startsWith("应结合C++ 语言基础与工程实践场景说明")), "subjective answers are concrete reference answers");
  assert(generated.questions.every((item) => item.id && item.type && item.stem && item.answer !== undefined && item.status === "待确认"), "AI generation normalizes required question fields");

  const previewDashboard = await getJson("/api/dashboard");
  assert(!previewDashboard.generationTask || previewDashboard.generationTask.paperName !== generationSpec.paperName, "unsaved generation does not enter question bank");
  const savedDraft = await postJson("/api/ai/save-question-draft", {
    questions: generated.questions,
    spec: generated.spec,
  });
  assert(savedDraft.saved === true, "generated preview can be saved as draft");
  const savedDashboard = await getJson("/api/dashboard");
  assert(savedDashboard.generationTask.paperName === generationSpec.paperName, "saved draft updates generation task");
  assert(savedDashboard.questions.length === 12, "saved draft replaces question bank");

  const quality = await postJson("/api/quality/check", {});
  assert(Number.isFinite(quality.schemaPassRate), "quality check returns schema pass rate");
  assert(Array.isArray(quality.failures), "quality check returns failures");

  const judgementQuestion = savedDashboard.questions.find((item) => item.type === "判断");
  assert(Boolean(judgementQuestion), "generated draft includes a judgement question for answer consistency checks");
  const badStorageQuestion = await patchJson(`/api/questions/${judgementQuestion.id}`, {
    stem: "在浏览器中，localStorage 的数据会随每一次同源 HTTP 请求自动发送到服务器，因此适合存储需要每次请求自动携带的会话标识。",
    answer: "正确",
    explanation: "localStorage 会自动跟随请求发送。",
    status: "待确认",
    quality: 88,
  });
  assert(badStorageQuestion.answer === "正确", "invalid known-fact judgement can be saved as draft for quality correction");
  const knownFactQuality = await postJson("/api/quality/check", {});
  assert(knownFactQuality.failures.some((item) => item.field === "answer" && item.message.includes("localStorage")), "quality check catches localStorage auto-send answer mismatch");

  const blockedPaperBuild = await postJson("/api/papers/build", {}, { expectedStatus: 409 });
  assert(blockedPaperBuild.eligibleCount === 0, "paper save requires reviewed questions");

  const repair = await postJson("/api/quality/repair", {});
  assert(repair.questions.length === 12, "quality repair returns questions");
  assert(Number.isFinite(repair.checks.stabilityScore), "quality repair returns stability score");
  assert(repair.questions.every((item) => item.status === "待确认"), "quality repair still requires manual review");
  const repairedStorageQuestion = repair.questions.find((item) => item.id === judgementQuestion.id);
  assert(repairedStorageQuestion.answer === "错误" && repairedStorageQuestion.explanation.includes("不会把它们随每次 HTTP 请求自动发送"), "quality repair fixes known localStorage judgement answer");

  const invalidDraftQuestion = await patchJson("/api/questions/q-001", { score: 0, status: "待确认" });
  assert(invalidDraftQuestion.score === 0, "invalid question draft can be saved for correction");
  const blockedInvalidReview = await patchJson("/api/questions/q-001", { status: "已校验" }, { expectedStatus: 409 });
  assert(blockedInvalidReview.error.includes("不能审核通过"), "invalid question cannot be reviewed");
  await patchJson("/api/questions/q-001", { score: generated.questions.find((item) => item.id === "q-001").score, status: "待确认" });

  const reviewed = await patchJson("/api/questions/q-003", { status: "已校验", quality: 92 });
  assert(reviewed.status === "已校验", "question review works");
  const unreviewed = await patchJson("/api/questions/q-003", { status: "待确认", quality: 88 });
  assert(unreviewed.status === "待确认", "question review can be cancelled");
  await patchJson("/api/questions/q-003", { status: "已校验", quality: 92 });
  const reviewedSubjective = await patchJson("/api/questions/q-008", { status: "已校验", quality: 92 });
  assert(reviewedSubjective.status === "已校验", "subjective question review works");
  const editedQuestion = await patchJson("/api/questions/q-011", {
    stem: "C++ 项目中题目生成失败后，以下哪种处理方式更适合正式 MVP？",
    status: "待确认",
    quality: 88,
  });
  assert(editedQuestion.stem.includes("正式 MVP"), "question edit works");
  const editedDashboard = await getJson("/api/dashboard");
  assert(editedDashboard.questions.find((item) => item.id === "q-011").status === "待确认", "edited question appears in dashboard");
  await patchJson("/api/questions/q-011", { status: "已校验", quality: 92 });
  await Promise.all(
    editedDashboard.questions
      .filter((item) => item.id !== "q-011")
      .map((item) => patchJson(`/api/questions/${item.id}`, { status: "已校验", quality: Math.max(92, Number(item.quality || 90)) })),
  );

  const paper = await postJson("/api/papers/build", {});
  assert(paper.status === "未发布", "paper save changes status");
  assert(paper.name === generationSpec.paperName, "paper save uses configured paper name");
  assert(paper.score === 50, "saved paper keeps all reviewed question scores");
  assert(paper.questionIds.length === paper.questionCount, "saved paper stores selected question ids");
  assert(paper.questionCount === generated.questions.length, "saved paper includes the reviewed draft questions");
  assert(paper.buildSpec.source === "saved-reviewed-questions", "saved paper records save source");

  const savedPaperDashboard = await getJson("/api/dashboard");
  const savedSnapshot = savedPaperDashboard.papers.find((item) => item.id === paper.id);
  assert(savedSnapshot && savedSnapshot.status === "未发布", "saved paper appears in completed paper list as unpublished");
  const savedPaperDetail = await getJson(`/api/papers/${paper.id}`);
  assert(savedPaperDetail.questions.length === paper.questionCount, "paper detail returns saved paper questions");

  const publishedPaper = await postJson("/api/papers/publish", {});
  assert(publishedPaper.status === "已发布", "paper publish works");
  const paperDashboard = await getJson("/api/dashboard");
  assert(Array.isArray(paperDashboard.papers) && paperDashboard.papers.length >= 1, "dashboard exposes generated paper management list");
  assert(paperDashboard.papers.some((item) => item.name === generationSpec.paperName && item.status === "已发布"), "paper management list tracks published paper");
  const publishedPaperDetail = await getJson(`/api/papers/${paper.id}`);
  assert(publishedPaperDetail.status === "已发布", "paper detail reflects published status");

  const activeWindow = examWindow(-10, 90);
  const assignedSession = await postJson("/api/proctor/sessions", {
    candidate: "测试参与者",
    ticket: "202606239999",
    className: "验证组",
    paperId: paper.id,
    phone: "13800009999",
    startTime: activeWindow.startTime,
    endTime: activeWindow.endTime,
  }, { expectedStatus: 201 });
  assert(/^sess-[a-z0-9]+-[a-z0-9]{8}$/.test(assignedSession.id), "session assignment creates long random session id");
  assert(assignedSession.id.length >= 20, "session id is long enough for candidate links and exports");
  assert(assignedSession.paperId === paper.id, "session assignment binds published paper id");
  assert(assignedSession.paperName === generationSpec.paperName, "session assignment stores paper name");
  assert(assignedSession.remainingMinutes === 90, "session assignment computes remaining minutes");
  const duplicateAssignmentSlot = await postJson("/api/proctor/sessions", {
    candidate: "重复时段参与者",
    ticket: "202606239999",
    className: "验证组",
    paperId: paper.id,
    phone: "13800009999",
    startTime: activeWindow.startTime,
    endTime: activeWindow.endTime,
  }, { expectedStatus: 409 });
  assert(duplicateAssignmentSlot.error.includes("同一试卷时段"), "session assignment rejects same candidate for same paper window");
  const repeatTicketLaterAssignment = await postJson("/api/proctor/sessions", {
    candidate: "测试参与者",
    ticket: "202606239999",
    className: "验证组",
    paperId: paper.id,
    phone: "13800009999",
    startTime: examWindow(100, 90).startTime,
    endTime: examWindow(100, 90).endTime,
  }, { expectedStatus: 201 });
  assert(repeatTicketLaterAssignment.ticket === assignedSession.ticket && repeatTicketLaterAssignment.id !== assignedSession.id, "same candidate can receive another exam window");
  const overlappingAssignment = await postJson("/api/proctor/sessions", {
    candidate: "测试参与者",
    ticket: "202606239999",
    className: "验证组",
    paperId: paper.id,
    phone: "13800009999",
    startTime: examWindow(30, 90).startTime,
    endTime: examWindow(30, 90).endTime,
  }, { expectedStatus: 409 });
  assert(overlappingAssignment.error.includes("时间冲突"), "same candidate cannot receive overlapping exam windows");
  const assignedLogin = await postJson("/api/candidate/login", {
    phone: "13800009999",
    password: "009999",
  });
  assert(assignedLogin.candidate.passwordMustChange === true, "default candidate password requires change");
  const changedPassword = await postJson("/api/candidate/password", {
    currentPassword: "009999",
    newPassword: "changed-9999",
  }, { headers: authHeaders(assignedLogin.token) });
  assert(changedPassword.updated === true, "candidate can change default password");
  const expiredAfterPasswordChange = await getJson("/api/candidate/exams", { expectedStatus: 401, headers: authHeaders(assignedLogin.token) });
  assert(expiredAfterPasswordChange.error.includes("失效"), "password change invalidates old candidate token");
  const assignedRelogin = await postJson("/api/candidate/login", {
    phone: "13800009999",
    password: "changed-9999",
  });
  assert(assignedRelogin.candidate.passwordMustChange === false, "changed candidate password clears default-password flag");
  const assignedToken = assignedRelogin.token;
  const assignedCandidate = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(assignedCandidate.session.candidate === "测试参与者", "candidate endpoint loads assigned session");
  assert(assignedCandidate.session.paper === generationSpec.paperName, "assigned session uses selected paper without variant strategy");
  assert(assignedCandidate.paper.id === paper.id, "assigned candidate receives bound paper snapshot");
  assert(assignedCandidate.access.canSubmit === true, "active assigned session can submit after paper publish");
  const assignedHeartbeat = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 0,
    visibility: "visible",
  }, { headers: authHeaders(assignedToken) });
  assert(assignedHeartbeat.status === "答题中", "heartbeat starts assigned session");
  const activeAssignedCandidate = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(activeAssignedCandidate.access.canSubmit === true, "active assigned session can submit after paper publish");

  const futureWindow = examWindow(30, 90);
  const ownedAssignment = await postJson("/api/assignments", {
    candidate: updatedCandidate.candidate,
    ticket: updatedCandidate.ticket,
    className: updatedCandidate.className,
    phone: updatedCandidate.phone,
    paperId: paper.id,
    startTime: futureWindow.startTime,
    endTime: futureWindow.endTime,
    remark: "登录验证考试",
  }, { expectedStatus: 201 });
  const conflictingPhoneAssignment = await postJson("/api/assignments", {
    candidate: "串号参与者",
    ticket: "202606240020",
    className: "验证组",
    phone: updatedCandidate.phone,
    paperId: paper.id,
    startTime: activeWindow.startTime,
    endTime: activeWindow.endTime,
  }, { expectedStatus: 409 });
  assert(conflictingPhoneAssignment.error.includes("手机号"), "assignment rejects phone owned by another participant");
  const badLogin = await postJson("/api/candidate/login", {
    phone: updatedCandidate.phone,
    password: "wrong-password",
  }, { expectedStatus: 401 });
  assert(badLogin.error.includes("错误"), "candidate login rejects bad password");
  const missingPhoneLogin = await postJson("/api/candidate/login", {
    phone: "13999999999",
    password: "wrong-password",
  }, { expectedStatus: 401 });
  assert(missingPhoneLogin.error.includes("错误"), "candidate login hides missing phone during first bad attempt");
  const repeatedMissingPhoneLogin = await postJson("/api/candidate/login", {
    phone: "13999999999",
    password: "wrong-password",
  }, { expectedStatus: 401 });
  assert(repeatedMissingPhoneLogin.error.includes("错误"), "candidate login tracks repeated missing-phone failures before lock");
  const blockedMissingPhoneLogin = await postJson("/api/candidate/login", {
    phone: "13999999999",
    password: "wrong-password",
  }, { expectedStatus: 429 });
  assert(blockedMissingPhoneLogin.retryAfterSeconds > 0, "candidate login rate limit blocks repeated bad attempts");
  const candidateLogin = await postJson("/api/candidate/login", {
    phone: updatedCandidate.phone,
    password: "pass-000001",
  });
  assert(candidateLogin.token && candidateLogin.candidate.phone === updatedCandidate.phone, "candidate login returns auth token and candidate");
  assert(candidateLogin.exams.some((item) => item.id === ownedAssignment.id), "candidate login returns assigned exams");
  const candidateExams = await getJson("/api/candidate/exams", { headers: authHeaders(candidateLogin.token) });
  assert(candidateExams.exams.some((item) => item.id === ownedAssignment.id), "candidate exams endpoint lists owned assignment");
  const listedOwnedExam = candidateExams.exams.find((item) => item.id === ownedAssignment.id);
  assert(listedOwnedExam.canEnter === false && listedOwnedExam.displayStatus === "待开考", "future exam is listed but cannot be entered before start");
  const unauthenticatedOwnedSession = await getJson(`/api/candidate/session/${ownedAssignment.id}`, { expectedStatus: 401 });
  assert(unauthenticatedOwnedSession.error.includes("登录"), "owned candidate session requires login token");
  const authorizedSession = await getJson(`/api/candidate/session/${ownedAssignment.id}`, { headers: authHeaders(candidateLogin.token) });
  assert(authorizedSession.session.id === ownedAssignment.id, "candidate token can access owned session");
  assert(authorizedSession.access.canSubmit === false && authorizedSession.access.timingStatus === "notStarted", "future candidate session cannot submit before start");
  const blockedEarlyHeartbeat = await postJson(`/api/candidate/session/${ownedAssignment.id}/heartbeat`, {
    progress: 0,
    visibility: "visible",
  }, { expectedStatus: 409, headers: authHeaders(candidateLogin.token) });
  assert(blockedEarlyHeartbeat.error.includes("尚未开始"), "future candidate heartbeat is blocked");
  const forbiddenSession = await getJson(`/api/candidate/session/${assignedSession.id}`, { expectedStatus: 403, headers: authHeaders(candidateLogin.token) });
  assert(forbiddenSession.error.includes("无权"), "candidate token cannot access another participant session");
  const resetPassword = await postJson(`/api/participants/${updatedCandidate.ticket}/password`, {});
  assert(resetPassword.updated === true && resetPassword.password === updatedCandidate.phone.slice(-6), "admin can reset participant password to phone suffix");
  const staleTokenAfterReset = await getJson("/api/candidate/exams", { expectedStatus: 401, headers: authHeaders(candidateLogin.token) });
  assert(staleTokenAfterReset.error.includes("失效"), "password reset invalidates participant token");
  const resetLogin = await postJson("/api/candidate/login", {
    phone: updatedCandidate.phone,
    password: updatedCandidate.phone.slice(-6),
  });
  assert(resetLogin.candidate.passwordMustChange === true, "reset password requires participant password change");
  const disabledParticipant = await postJson(`/api/participants/${updatedCandidate.ticket}/status`, { disabled: true });
  assert(disabledParticipant.disabledAt, "admin can disable participant account");
  const disabledLogin = await postJson("/api/candidate/login", {
    phone: updatedCandidate.phone,
    password: updatedCandidate.phone.slice(-6),
  }, { expectedStatus: 403 });
  assert(disabledLogin.error.includes("停用"), "disabled participant cannot login");
  const enabledParticipant = await postJson(`/api/participants/${updatedCandidate.ticket}/status`, { disabled: false });
  assert(!enabledParticipant.disabledAt, "admin can re-enable participant account");
  const batchParticipantUpdate = await postJson("/api/participants/batch-update", {
    tickets: [updatedCandidate.ticket],
    className: "A组",
    resetPassword: true,
  });
  assert(batchParticipantUpdate.participants[0].className === "A组", "participant batch update changes group");
  const batchGroupBack = await postJson("/api/participants/batch-update", {
    tickets: [updatedCandidate.ticket],
    className: "验证组",
  });
  assert(batchGroupBack.participants[0].className === "验证组", "participant batch update can restore group");

  const batchAssignment = await postJson("/api/assignments/batch", {
    paperId: paper.id,
    startTime: activeWindow.startTime,
    endTime: activeWindow.endTime,
    candidates: [
      { candidate: "批量甲", ticket: "202606240001", className: "A组", phone: "13800004001" },
      { candidate: "批量乙", ticket: "202606240002", className: "A组", phone: "13800004002" },
    ],
  }, { expectedStatus: 201 });
  assert(batchAssignment.sessions.length === 2, "batch assignment creates candidate sessions");
  assert(batchAssignment.sessions.every((item) => item.paper === generationSpec.paperName), "batch assignment uses selected paper without variants");
  const assignmentPreview = await postJson("/api/assignments/import-preview", {
    paperId: paper.id,
    startTime: activeWindow.startTime,
    endTime: activeWindow.endTime,
    text: "预览甲,202606240003,B组,13800004003\n预览乙,202606240001,B组,13800004004",
  });
  assert(assignmentPreview.validCount === 1, "assignment import preview counts valid rows");
  assert(assignmentPreview.invalidCount === 1, "assignment import preview catches duplicate paper window assignments");
  const missingPhoneAssignmentPreview = await postJson("/api/assignments/import-preview", {
    text: "缺手机号,202606240005,B组",
  });
  assert(missingPhoneAssignmentPreview.invalidCount === 1 && missingPhoneAssignmentPreview.rows[0].errors.some((item) => item.includes("手机号")), "assignment import preview requires candidate phone");
  const excelStylePreview = await postJson("/api/assignments/import-preview", {
    candidates: [
      { candidate: "模板甲", ticket: "202606240011", className: "C组", phone: "13800004011" },
      { candidate: "模板乙", ticket: "202606240012", className: "C组", phone: "13800004012" },
    ],
  });
  assert(excelStylePreview.validCount === 2, "assignment import preview accepts rows parsed from Excel templates");
  const futureDateTimeWindow = examWindow(240, 90);
  const dateTimeAssigned = await postJson("/api/assignments", {
    candidate: "日期参与者",
    ticket: "202606240013",
    className: "B组",
    phone: "13800004013",
    paperId: paper.id,
    startTime: futureDateTimeWindow.startTime,
    endTime: futureDateTimeWindow.endTime,
  }, { expectedStatus: 201 });
  assert(dateTimeAssigned.remainingMinutes === 90, "assignment supports datetime-local start and end values");

  const emptyAnalysis = await getJson("/api/analysis");
  assert(emptyAnalysis.averageScore === 0, "analysis has no default demo average before grading");
  assert(emptyAnalysis.passRate === 0, "analysis has no default demo pass rate before grading");
  assert(emptyAnalysis.gradedCount === 0, "analysis only counts reviewed grading results");

  const event = await postJson("/api/proctor/sessions/s-003/events", {
    risk: "高",
    event: "自动验证风险事件",
  });
  assert(event.risk === "高", "proctor event changes risk");

  const heartbeat = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 50,
    visibility: "visible",
  }, { headers: authHeaders(assignedToken) });
  assert(heartbeat.lastSeenAt, "heartbeat updates lastSeenAt");
  const presenceHealth = await getJson("/api/health");
  assert(presenceHealth.proctor.presenceCount >= 1, "heartbeat updates presence store");
  const backupsBeforeKeepalive = await getJson("/api/admin/backups", { headers: adminHeaders });
  const keepaliveHeartbeat = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 50,
    visibility: "visible",
  }, { headers: authHeaders(assignedToken) });
  assert(keepaliveHeartbeat.online === true && keepaliveHeartbeat.lastSeenAt, "keepalive heartbeat returns presence-decorated session");
  const backupsAfterKeepalive = await getJson("/api/admin/backups", { headers: adminHeaders });
  assert(backupsAfterKeepalive.backups.length === backupsBeforeKeepalive.backups.length, "unchanged keepalive heartbeat does not create runtime backup");

  const hiddenHeartbeat = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 50,
    visibility: "hidden",
    fullscreen: "exited",
    clipboard: "paste",
  }, { headers: authHeaders(assignedToken) });
  assert(hiddenHeartbeat.risk !== "低", "hidden heartbeat raises risk");
  assert(hiddenHeartbeat.device.fullscreen === "exited" && hiddenHeartbeat.device.clipboard === "paste", "heartbeat tracks active proctor device state");
  const evidenceSnapshot = await postJson(`/api/candidate/session/${assignedSession.id}/evidence`, {
    type: "verify-device-snapshot",
    source: "candidate",
    progress: 60,
    visibility: "hidden",
    device: {
      fullscreen: "exited",
      clipboard: "paste",
    },
    environment: {
      userAgent: "SmartQ Verify Agent",
      language: "zh-CN",
      platform: "verify",
      viewport: "1280x720",
      screen: "1920x1080",
      timezone: "Asia/Shanghai",
    },
    signals: [{ event: "验证取证信号", risk: "高", source: "verify" }],
  }, { headers: authHeaders(assignedToken) });
  assert(evidenceSnapshot.saved === true && evidenceSnapshot.snapshot.type === "verify-device-snapshot", "candidate can submit proctor evidence snapshot");
  const evidenceAttachmentText = "SmartQ proctor evidence attachment";
  const expectedEvidenceDigest = createHash("sha256").update(evidenceAttachmentText).digest("hex");
  const evidenceAttachment = await postJson(`/api/candidate/session/${assignedSession.id}/evidence-attachment`, {
    type: "verify-text-attachment",
    label: "验证文本证据",
    contentType: "text/plain",
    data: Buffer.from(evidenceAttachmentText).toString("base64"),
  }, { headers: authHeaders(assignedToken) });
  assert(evidenceAttachment.saved === true && evidenceAttachment.attachment.storageAdapter === "object-storage", "candidate can upload object proctor evidence attachment");
  assert(evidenceAttachment.attachment.path.includes(assignedSession.id), "evidence attachment records session-scoped local path");
  assert(evidenceAttachment.attachment.objectKey.includes(assignedSession.id), "evidence attachment records object storage key");
  assert(evidenceAttachment.attachment.sha256 === expectedEvidenceDigest, "evidence attachment records SHA-256 digest");
  const attachmentDownload = await fetch(`${baseUrl}/api/proctor/sessions/${assignedSession.id}/attachments/${evidenceAttachment.attachment.id}`, { headers: adminHeaders });
  assert(attachmentDownload.ok, "operator can download proctor evidence attachment");
  assert((attachmentDownload.headers.get("content-type") || "").includes("text/plain"), "evidence attachment download preserves content type");
  assert(attachmentDownload.headers.get("x-smartq-evidence-sha256") === expectedEvidenceDigest, "evidence attachment download exposes SHA-256 digest header");
  assert(attachmentDownload.headers.get("x-smartq-evidence-integrity") === "verified", "evidence attachment download verifies stored digest");
  assert((await attachmentDownload.text()).includes(evidenceAttachmentText), "evidence attachment download returns stored bytes");

  const proctor = await getJson("/api/proctor/sessions");
  assert(proctor.events.some((item) => item.message.includes("离开考试页面")), "proctor event stream includes visibility risk");
  assert(proctor.events.some((item) => item.message.includes("退出全屏") || item.message.includes("粘贴操作")), "proctor event stream includes active device risk");
  assert(proctor.eventSummary.pending >= 1, "proctor summary counts pending risk events");
  assert(proctor.rules.requireCamera === false && proctor.rules.requireScreen === false, "proctor session payload disables camera and screen rules");
  const updatedRules = await postJson("/api/proctor/rules", {
    fullscreenExited: "高",
    duplicateWindowSeconds: 1,
  });
  assert(updatedRules.rules.fullscreenExited === "高", "proctor rules can be updated");
  const ruleSignal = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 60,
    visibility: "visible",
    fullscreen: "exited",
  }, { headers: authHeaders(assignedToken) });
  assert(ruleSignal.risk === "高", "updated proctor rule affects heartbeat risk level");
  const rulesDashboard = await getJson("/api/dashboard");
  assert(rulesDashboard.proctorEventSummary.high >= 1, "dashboard exposes proctor event risk summary");
  const pendingRiskIds = (rulesDashboard.proctorEvents || [])
    .filter((item) => item.type === "proctor-event" && (item.status || "待处理") === "待处理")
    .slice(0, 2)
    .map((item) => item.id);
  const batchReviewed = await postJson("/api/proctor/events/batch", {
    ids: pendingRiskIds,
    status: "误报",
    resolution: "验证批量误报",
  });
  assert(batchReviewed.updated === pendingRiskIds.length, "proctor batch event review updates selected risks");
  assert(batchReviewed.summary.falsePositive >= pendingRiskIds.length, "proctor batch review updates summary");
  const proctorDetail = await getJson(`/api/proctor/sessions/${assignedSession.id}`);
  assert(proctorDetail.session.id === assignedSession.id && proctorDetail.questions.length > 0, "proctor detail returns session answers and questions");
  const proctorReport = await getJson(`/api/proctor/sessions/${assignedSession.id}/report`);
  assert(proctorReport.session.id === assignedSession.id, "proctor evidence report returns session identity");
  assert(proctorReport.summary.riskEvents >= pendingRiskIds.length, "proctor evidence report summarizes risk evidence");
  assert(proctorReport.summary.falsePositiveEvents >= pendingRiskIds.length, "proctor evidence report summarizes false positives");
  assert(proctorReport.summary.evidenceSnapshots >= 1, "proctor evidence report summarizes device evidence snapshots");
  assert(proctorReport.summary.evidenceAttachments >= 1, "proctor evidence report summarizes evidence attachments");
  assert(Number.isFinite(proctorReport.analysis.score) && proctorReport.analysis.recommendations.length >= 1, "proctor evidence report includes automatic risk analysis");
  assert(proctorReport.evidenceAttachments.some((item) => item.downloadUrl?.includes(`/attachments/${evidenceAttachment.attachment.id}`)), "proctor evidence report exposes protected attachment download url");
  assert(proctorReport.evidenceAttachments.some((item) => item.sha256 === expectedEvidenceDigest), "proctor evidence report includes attachment SHA-256 digest");
  assert(proctorReport.timeline.some((item) => item.message.includes("离开考试页面") || item.message.includes("退出全屏")), "proctor evidence report includes risk timeline");
  assert(proctorReport.timeline.some((item) => item.type === "proctor-evidence" && item.evidence?.environment?.platform === "verify"), "proctor evidence report includes device snapshot timeline");
  assert(proctorReport.timeline.some((item) => item.type === "proctor-evidence-attachment" && item.attachment?.contentType === "text/plain"), "proctor evidence report includes attachment timeline");
  assert(proctorReport.answers.length === proctorDetail.questions.length, "proctor evidence report includes answer evidence rows");
  const opsAfterRisk = await getJson("/api/admin/ops", { headers: adminHeaders });
  assert(Number.isFinite(opsAfterRisk.metrics.highAnalysisSessions), "ops metrics include automatic proctor analysis count");
  const pauseControl = await postJson(`/api/proctor/sessions/${assignedSession.id}/control`, { action: "pause", note: "验证暂停" });
  assert(pauseControl.session.controlStatus === "已暂停", "proctor can pause a session");
  const pausedCandidate = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(pausedCandidate.access.canSave === false && pausedCandidate.access.message.includes("暂停"), "paused session blocks candidate save");
  const resumeControl = await postJson(`/api/proctor/sessions/${assignedSession.id}/control`, { action: "resume" });
  assert(resumeControl.session.controlStatus === "正常", "proctor can resume a session");
  const lockControl = await postJson(`/api/proctor/sessions/${assignedSession.id}/control`, { action: "lock", note: "验证锁定" });
  assert(lockControl.session.controlStatus === "已锁定", "proctor can lock a session");
  const unlockControl = await postJson(`/api/proctor/sessions/${assignedSession.id}/control`, { action: "unlock" });
  assert(unlockControl.session.controlStatus === "正常", "proctor can unlock a session");
  const extendedControl = await postJson(`/api/proctor/sessions/${assignedSession.id}/control`, { action: "extend", minutes: 5 });
  assert(extendedControl.session.endTime !== assignedSession.endTime, "proctor can extend session end time");
  const messageControl = await postJson(`/api/proctor/sessions/${assignedSession.id}/control`, { action: "message", message: "请保持全屏作答" });
  assert(messageControl.messages.some((item) => item.message.includes("全屏")), "proctor can send candidate message");
  const candidateMessageView = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(candidateMessageView.session.messages.some((item) => item.message.includes("全屏")), "candidate receives proctor message");
  const answers = answerAllQuestions(activeAssignedCandidate.questions);
  const partialAnswers = Object.fromEntries(Object.entries(answers).slice(0, 2));
  const draft = await postJson("/api/candidate/session/s-001", {
    submit: false,
    answers: partialAnswers,
  }, { expectedStatus: 401 });
  assert(draft.error.includes("登录"), "candidate draft save requires login token");
  const invalidAnswer = await postJson(`/api/candidate/session/${assignedSession.id}`, {
    submit: false,
    answers: { "q-001": "Z" },
  }, { expectedStatus: 400, headers: authHeaders(assignedToken) });
  assert(invalidAnswer.error.includes("无效选项"), "candidate draft rejects invalid option");
  const activeDraft = await postJson(`/api/candidate/session/${assignedSession.id}`, {
    submit: false,
    answers: partialAnswers,
  }, { headers: authHeaders(assignedToken) });
  assert(activeDraft.submitted === false, "candidate draft save works");

  const draftSession = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(Object.keys(partialAnswers).every((id) => JSON.stringify(draftSession.answers[id]) === JSON.stringify(partialAnswers[id])), "draft answer is persisted");
  assert(draftSession.session.progress > 0, "draft save updates progress");
  const complianceRules = await postJson("/api/proctor/rules", {
    ...updatedRules.rules,
    requireCamera: true,
    requireScreen: true,
    requireFullscreen: true,
  });
  assert(complianceRules.rules.requireCamera === false && complianceRules.rules.requireScreen === false && complianceRules.rules.requireFullscreen === true, "proctor rules only require active device compliance before submit");
  const blockedComplianceSubmit = await postJson(`/api/candidate/session/${assignedSession.id}`, { submit: true, answers }, { expectedStatus: 409, headers: authHeaders(assignedToken) });
  assert(blockedComplianceSubmit.error.includes("设备合规未通过"), "candidate submit is blocked by device compliance rules");
  assert(blockedComplianceSubmit.access.canSave === true && blockedComplianceSubmit.access.canSubmit === false, "compliance rules block submit without blocking draft save");
  const compliantHeartbeat = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 100,
    visibility: "visible",
    fullscreen: "active",
    clipboard: "正常",
  }, { headers: authHeaders(assignedToken) });
  assert(compliantHeartbeat.device.fullscreen === "active", "candidate heartbeat can satisfy active proctor compliance");

  const saved = await postJson(`/api/candidate/session/${assignedSession.id}`, { submit: true, answers }, { headers: authHeaders(assignedToken) });
  assert(saved.submitted === true, "candidate submit works");
  assert(saved.grading === null && saved.gradingStatus?.publishStatus === "未发布", "candidate submit hides scores until result publication");
  const submittedView = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(submittedView.access.canReview === true && submittedView.grading === null, "submitted candidate can view read-only answer without unpublished score");
  assert(submittedView.gradingStatus.message.includes("暂不可查看") || submittedView.gradingStatus.message.includes("等待发布"), "submitted candidate sees unpublished grading status");
  const duplicateSubmit = await postJson(`/api/candidate/session/${assignedSession.id}`, { submit: true, answers }, { expectedStatus: 409, headers: authHeaders(assignedToken) });
  assert(duplicateSubmit.error.includes("已提交"), "candidate submit rejects duplicate submit");
  const missingSubmit = await postJson("/api/candidate/session/s-999", { submit: false, answers: {} }, { expectedStatus: 404, headers: authHeaders(assignedToken) });
  assert(missingSubmit.error === "Session Not Found", "candidate save rejects unknown session");

  const gradingDashboard = await getJson("/api/dashboard");
  const grading = gradingDashboard.gradingReviewQueue.find((item) => item.sessionId === assignedSession.id);
  assert(grading.maxScore === paper.score, "grading max score follows formal paper");
  assert(Number.isFinite(grading.totalScore), "grading returns a numeric score");
  assert(grading.reviewStatus === "待复核", "grading creates subjective review queue");
  assert(grading.subjectivePending > 0, "grading tracks pending subjective reviews");
  assert(gradingDashboard.gradingQueue.subjectivePending > 0, "dashboard reflects submit-time grading queue");

  const subjectiveDetails = grading.details.filter((item) => item.reviewRequired);
  const adjustedQuestionId = subjectiveDetails[0]?.questionId;
  const reviewPayload = subjectiveDetails.map((item, index) => ({
    questionId: item.questionId,
    awarded: index === 0 ? 0 : item.awarded,
    comment: index === 0 ? "验证流程调整主观题得分" : "验证流程确认 AI 初评分",
  }));
  const reviewedGrading = await postJson("/api/grading/review", {
    sessionId: assignedSession.id,
    reviews: reviewPayload,
    reviewer: "verify-admin",
  });
  assert(reviewedGrading.reviewStatus === "已完成", "manual grading review completes result");
  assert(reviewedGrading.subjectivePending === 0, "manual grading review clears subjective pending count");
  assert(reviewedGrading.reviewedBy === "verify-admin", "manual grading review records reviewer");
  assert(reviewedGrading.publishStatus === "未发布", "manual grading review does not publish scores automatically");
  const dashboardAfterReview = await getJson("/api/dashboard");
  assert(!dashboardAfterReview.gradingReviewQueue.some((item) => item.sessionId === assignedSession.id && item.reviewStatus !== "已完成"), "reviewed session leaves pending review queue state");
  const adjustedDetail = reviewedGrading.details.find((item) => item.questionId === adjustedQuestionId);
  assert(adjustedDetail.awarded === 0 && adjustedDetail.reviewerComment.includes("调整"), "manual grading review can adjust subjective score and comment");
  const unpublishedAfterReview = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(unpublishedAfterReview.grading === null && unpublishedAfterReview.gradingStatus.publishStatus === "未发布", "candidate still cannot see score after review before publication");
  const publishedGrading = await postJson("/api/grading/publish", {
    sessionId: assignedSession.id,
    publisher: "verify-admin",
  });
  assert(publishedGrading.publishStatus === "已发布" && publishedGrading.publishedBy === "verify-admin", "manual grading publication marks result published");
  const publishedCandidateView = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(publishedCandidateView.grading?.publishStatus === "已发布" && publishedCandidateView.grading.totalScore === publishedGrading.totalScore, "candidate can see official score after publication");
  const appeal = await postJson(`/api/candidate/session/${assignedSession.id}/appeal`, {
    reason: "我认为主观题评分需要再次核对",
  }, { headers: authHeaders(assignedToken) });
  assert(appeal.submitted === true && appeal.appeal.status === "待处理", "candidate can submit score appeal after publication");
  const duplicateAppeal = await postJson(`/api/candidate/session/${assignedSession.id}/appeal`, {
    reason: "再次提交同一成绩申诉",
  }, { expectedStatus: 409, headers: authHeaders(assignedToken) });
  assert(duplicateAppeal.error.includes("待处理申诉"), "candidate cannot submit duplicate pending appeal");
  const appealDashboard = await getJson("/api/dashboard");
  const appealedEntry = appealDashboard.gradingReviewQueue.find((item) => item.sessionId === assignedSession.id);
  assert(appealedEntry.appealStatus === "待处理" && appealedEntry.latestAppeal.id === appeal.appeal.id, "operator queue exposes pending score appeal");
  const acceptedAppeal = await postJson("/api/grading/appeal", {
    sessionId: assignedSession.id,
    appealId: appeal.appeal.id,
    action: "accept",
    resolution: "验证受理，维持复核分数后重新发布",
    resolver: "verify-admin",
  });
  assert(acceptedAppeal.appeal.status === "已受理" && acceptedAppeal.result.publishStatus === "待重新发布", "accepted appeal marks result for republication");
  const republishedGrading = await postJson("/api/grading/publish", {
    sessionId: assignedSession.id,
    publisher: "verify-admin",
  });
  assert(republishedGrading.publishStatus === "已发布", "result can be republished after accepted appeal");
  const appealedCandidateView = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(appealedCandidateView.gradingStatus.latestAppeal.status === "已受理", "candidate can see appeal resolution status");
  const gradingExport = await getJson("/api/grading/export");
  assert(gradingExport.rows.some((item) => item.sessionId === assignedSession.id), "grading export includes reviewed session row");
  assert(gradingExport.rows.some((item) => item.sessionId === assignedSession.id && item.publishStatus === "已发布"), "grading export includes result publication status");
  assert(gradingExport.details.some((item) => item.sessionId === assignedSession.id && item.questionId === adjustedQuestionId && item.reviewerComment.includes("调整")), "grading export includes reviewed question comments");

  const analysis = await getJson("/api/analysis");
  assert(analysis.gradedCount === 1, "analysis reflects graded count");
  assert(analysis.averageScore === reviewedGrading.totalScore, "analysis average score reflects reviewed grading result");
  assert(analysis.submittedCount >= 1, "analysis reflects submitted sessions");
  assert(analysis.riskCount >= 1, "analysis reflects risk sessions");
  assert(analysis.knowledge.some((item) => generationSpec.knowledge.includes(item.name)), "analysis knowledge uses paper knowledge points");
  assert(analysis.distribution.some((item) => item.count === 1), "analysis includes score distribution");

  const finalDashboard = await getJson("/api/dashboard");
  assert(finalDashboard.gradingQueue.objectiveDone >= 1, "dashboard reflects grading result");
  assert(finalDashboard.gradingQueue.subjectivePending === 0, "dashboard reflects completed grading review");
  assert(finalDashboard.gradingQueue.reviewDone >= 1, "dashboard reflects reviewed results");
  assert(finalDashboard.stats.risk >= 1, "dashboard reflects risk sessions");
  const forceWindow = examWindow(-5, 60);
  const forceSession = await postJson("/api/proctor/sessions", {
    candidate: "强制收卷参与者",
    ticket: "202606249998",
    className: "验证组",
    phone: "13800009998",
    paperId: paper.id,
    startTime: forceWindow.startTime,
    endTime: forceWindow.endTime,
  }, { expectedStatus: 201 });
  const forceControl = await postJson(`/api/proctor/sessions/${forceSession.id}/control`, { action: "forceSubmit", note: "验证强制收卷" });
  assert(forceControl.session.status === "已提交" && forceControl.grading, "proctor can force submit a session");
  const timeoutWindow = examWindow(-120, 60);
  const timeoutSession = await postJson("/api/proctor/sessions", {
    candidate: "到时收卷参与者",
    ticket: "202606249997",
    className: "验证组",
    phone: "13800009997",
    paperId: paper.id,
    startTime: timeoutWindow.startTime,
    endTime: timeoutWindow.endTime,
  }, { expectedStatus: 201 });
  const timeoutLogin = await postJson("/api/candidate/login", {
    phone: "13800009997",
    password: "009997",
  });
  const timeoutView = await getJson(`/api/candidate/session/${timeoutSession.id}`, { headers: authHeaders(timeoutLogin.token) });
  assert(timeoutView.session.status === "已提交", "expired session is auto-submitted when viewed");
  assert(timeoutView.session.submissionSource === "auto-timeout", "expired session records timeout submission source");
  assert(timeoutView.grading === null && timeoutView.gradingStatus?.publishStatus === "未发布", "timeout candidate view hides unpublished grading result");
  assert(timeoutView.access.canReview === true, "auto-submitted candidate can review result");
  const timeoutDashboard = await getJson("/api/dashboard");
  assert(timeoutDashboard.sessions.find((item) => item.id === timeoutSession.id)?.status === "已提交", "dashboard reflects auto-submitted session");
  assert(timeoutDashboard.gradingReviewQueue.find((item) => item.sessionId === timeoutSession.id)?.details?.length > 0, "timeout grading is available to operators before publication");
  assert(timeoutDashboard.gradingQueue.objectiveDone >= finalDashboard.gradingQueue.objectiveDone + 2, "grading queue includes force and timeout submissions");

  const firstAssignedBeforeSwitch = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  const firstAssignedStem = firstAssignedBeforeSwitch.questions[0].stem;
  const secondSpec = {
    ...generationSpec,
    paperName: "C++ 工程能力测评 B 卷",
    direction: "C++ 并发与性能优化",
    knowledge: ["并发控制", "性能分析", "内存模型", "线程安全", "调试诊断"],
  };
  const secondGenerated = await postJson("/api/ai/generate-questions", secondSpec);
  await postJson("/api/ai/save-question-draft", {
    questions: secondGenerated.questions,
    spec: secondGenerated.spec,
  });
  const secondDraftDashboard = await getJson("/api/dashboard");
  await Promise.all(
    secondDraftDashboard.questions.map((item) => patchJson(`/api/questions/${item.id}`, { status: "已校验", quality: Math.max(92, Number(item.quality || 90)) })),
  );
  const secondPaper = await postJson("/api/papers/build", {});
  await postJson("/api/papers/publish", {});
  const secondAssigned = await postJson("/api/assignments", {
    candidate: "第二卷参与者",
    ticket: "202606240099",
    className: "C组",
    phone: "13800004099",
    paperId: secondPaper.id,
    startTime: activeWindow.startTime,
    endTime: activeWindow.endTime,
  }, { expectedStatus: 201 });
  const firstAssignedAfterSwitch = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  const secondLogin = await postJson("/api/candidate/login", {
    phone: "13800004099",
    password: "004099",
  });
  const secondAssignedCandidate = await getJson(`/api/candidate/session/${secondAssigned.id}`, { headers: authHeaders(secondLogin.token) });
  assert(firstAssignedAfterSwitch.paper.id === paper.id, "existing assignment keeps first paper after another paper is published");
  assert(firstAssignedAfterSwitch.questions[0].stem === firstAssignedStem, "existing assignment keeps first paper snapshot questions");
  assert(secondAssignedCandidate.paper.id === secondPaper.id, "new assignment receives second paper");
  assert(secondAssignedCandidate.questions.some((item) => item.knowledge.includes(secondSpec.direction)), "second assignment sees second paper questions");

  const resetPreview = await postJson("/api/ai/generate-questions", { ...generationSpec, direction: "C++ 语言进阶能力复测" });
  const beforeSaveResetDashboard = await getJson("/api/dashboard");
  assert(beforeSaveResetDashboard.paper.status === "已发布", "unsaved regenerated preview does not reset published paper");
  await postJson("/api/ai/save-question-draft", {
    questions: resetPreview.questions,
    spec: resetPreview.spec,
  });
  const resetDashboard = await getJson("/api/dashboard");
  assert(resetDashboard.paper.status === null, "question regeneration clears current paper status");
  assert(resetDashboard.paper.id === null, "question regeneration clears current paper id");
  assert(resetDashboard.gradingQueue.objectiveDone === 0, "question regeneration clears grading results");
  assert(resetDashboard.analysis.gradedCount === 0, "question regeneration clears analysis grading scope");
  const resetSession = await getJson(`/api/candidate/session/${assignedSession.id}`, { headers: authHeaders(assignedToken) });
  assert(resetSession.session.status === "答题中", "question regeneration keeps active time status for candidate session");
  assert(Object.keys(resetSession.answers).length === 0, "question regeneration clears candidate answers");

  const deleteResult = await deleteJson(`/api/papers/${paper.id}`);
  assert(deleteResult.deleted === true, "paper delete works");
  const afterDeleteDashboard = await getJson("/api/dashboard");
  assert(!afterDeleteDashboard.papers.some((item) => item.id === paper.id), "deleted paper is removed from paper list");
  assert(afterDeleteDashboard.questions.length === resetPreview.questions.length, "deleting historical paper keeps current authoring question draft");
  assert(afterDeleteDashboard.generationTask.direction === resetPreview.spec.direction, "deleting historical paper keeps current generation task");

  await fakePostgres.close();
  const degradedHealth = await getJson("/api/health");
  assert(degradedHealth.storage.adapter === "json-file" && degradedHealth.storage.degraded === true, "postgres outage falls back to json-file storage status");
  assert(degradedHealth.storage.status.postgresReachable === false && degradedHealth.storage.status.reason, "postgres outage reports storage degradation reason");

  console.log("SmartQ verification passed");
} catch (error) {
  console.error("SmartQ verification failed");
  console.error(error.message);
  if (output.trim()) {
    console.error("\nServer output:");
    console.error(output.trim());
  }
  process.exitCode = 1;
} finally {
  server.kill("SIGINT");
  await fakePostgres.close();
  await fakeRedis.close();
  await fakeS3.close();
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const health = await getJson("/api/health");
      if (health.ok) return;
    } catch {
      await delay(150);
    }
  }
  throw new Error("Server did not become healthy");
}

async function getJson(path, options = {}) {
  return readJson(await fetch(`${baseUrl}${path}`, { headers: requestHeaders(path, options) }), options);
}

async function getText(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`);
  const expectedStatus = options.expectedStatus || 200;
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text;
}

async function postJson(path, body, options = {}) {
  return readJson(
    await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...requestHeaders(path, options) },
      body: JSON.stringify(body),
    }),
    options,
  );
}

async function patchJson(path, body, options = {}) {
  return readJson(
    await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...requestHeaders(path, options) },
      body: JSON.stringify(body),
    }),
    options,
  );
}

async function deleteJson(path, options = {}) {
  return readJson(
    await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
      headers: requestHeaders(path, options),
    }),
    options,
  );
}

async function readSseEvent(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers: requestHeaders(path, options) });
  const expectedStatus = options.expectedStatus || 200;
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  if (expectedStatus !== 200) return "";
  const reader = response.body.getReader();
  const timeout = setTimeout(() => reader.cancel().catch(() => {}), 1500);
  try {
    const { value } = await reader.read();
    return new TextDecoder().decode(value || new Uint8Array());
  } finally {
    clearTimeout(timeout);
    reader.cancel().catch(() => {});
  }
}

function requestHeaders(path, options = {}) {
  if (options.headers) return options.headers;
  if (isAdminApi(path) && adminHeaders.authorization) return adminHeaders;
  return {};
}

function isAdminApi(path) {
  return path.startsWith("/api/")
    && !path.startsWith("/api/candidate/")
    && !path.startsWith("/api/admin/")
    && !["/api/health", "/api/config"].includes(path);
}

async function readJson(response, options = {}) {
  const text = await response.text();
  const expectedStatus = options.expectedStatus || 200;
  if (response.status !== expectedStatus) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return JSON.parse(text);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startFakeRedis() {
  const values = new Map();
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        const parsed = parseFakeRedisCommand(buffer);
        if (!parsed) return;
        buffer = buffer.slice(parsed.offset);
        socket.write(handleFakeRedisCommand(parsed.command, values));
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  let closed = false;
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => {
      if (closed) {
        resolve();
        return;
      }
      closed = true;
      server.close(() => resolve());
    }),
  };
}

async function startFakePostgres() {
  let stateJson = "";
  const md5Salt = Buffer.from([1, 2, 3, 4]);
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let started = false;
    let authenticated = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        if (!started && buffer.length >= 4) {
          const length = buffer.readInt32BE(0);
          if (buffer.length < length) return;
          buffer = buffer.slice(length);
          started = true;
          socket.write(pgAuthMd5(md5Salt));
        }
        while (buffer.length >= 5) {
          const type = String.fromCharCode(buffer[0]);
          const length = buffer.readInt32BE(1);
          if (buffer.length < 1 + length) return;
          const payload = buffer.slice(5, 1 + length);
          buffer = buffer.slice(1 + length);
          if (type === "p" && !authenticated) {
            const password = payload.slice(0, -1).toString();
            const expected = `md5${createHash("md5").update(Buffer.concat([
              Buffer.from(createHash("md5").update("smartqsmartq").digest("hex")),
              md5Salt,
            ])).digest("hex")}`;
            if (password !== expected) throw new Error("Fake postgres password mismatch");
            authenticated = true;
            socket.write(pgAuthOk());
            socket.write(pgReady());
          } else if (type === "Q" && authenticated) {
            const sql = payload.slice(0, -1).toString();
            const result = handleFakePostgresQuery(sql, { get stateJson() { return stateJson; }, set stateJson(value) { stateJson = value; } });
            result.forEach((message) => socket.write(message));
            socket.write(pgReady());
          } else if (type === "X") {
            socket.end();
          }
        }
      } catch (error) {
        socket.write(pgError(error.message));
        socket.write(pgReady());
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function handleFakePostgresQuery(sql, store) {
  if (/^CREATE TABLE/i.test(sql)) return [pgCommandComplete("CREATE TABLE")];
  if (/^INSERT INTO/i.test(sql)) {
    const match = sql.match(/VALUES \('(?:[^']|'')*', '((?:[^']|'')*)'::jsonb/i);
    if (!match) throw new Error("Unsupported fake postgres insert");
    store.stateJson = match[1].replace(/''/g, "'");
    return [pgCommandComplete("INSERT 0 1")];
  }
  if (/^SELECT state/i.test(sql)) {
    if (!store.stateJson) return [pgRowDescription(["state"]), pgCommandComplete("SELECT 0")];
    return [pgRowDescription(["state"]), pgDataRow([store.stateJson]), pgCommandComplete("SELECT 1")];
  }
  if (/^SELECT updated_at/i.test(sql)) {
    return [pgRowDescription(["updated_at", "size_bytes"]), pgDataRow([new Date().toISOString(), String(Buffer.byteLength(store.stateJson || ""))]), pgCommandComplete("SELECT 1")];
  }
  return [pgCommandComplete("OK")];
}

function pgAuthOk() {
  return pgMessage("R", pgInt32(0));
}

function pgAuthMd5(salt) {
  return pgMessage("R", Buffer.concat([pgInt32(5), salt]));
}

function pgReady() {
  return pgMessage("Z", Buffer.from("I"));
}

function pgCommandComplete(text) {
  return pgMessage("C", Buffer.from(`${text}\0`));
}

function pgRowDescription(columns = []) {
  const fields = columns.map((name) => Buffer.concat([
    Buffer.from(`${name}\0`),
    pgInt32(0), pgInt16(0), pgInt32(25), pgInt16(-1), pgInt32(-1), pgInt16(0),
  ]));
  return pgMessage("T", Buffer.concat([pgInt16(columns.length), ...fields]));
}

function pgDataRow(values = []) {
  const fields = values.map((value) => {
    const data = Buffer.from(String(value));
    return Buffer.concat([pgInt32(data.length), data]);
  });
  return pgMessage("D", Buffer.concat([pgInt16(values.length), ...fields]));
}

function pgError(message) {
  return pgMessage("E", Buffer.from(`SERROR\0M${message}\0\0`));
}

function pgMessage(type, payload) {
  return Buffer.concat([Buffer.from(type), pgInt32(payload.length + 4), payload]);
}

function pgInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function pgInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value, 0);
  return buffer;
}

function handleFakeRedisCommand(command = [], values) {
  const name = String(command[0] || "").toUpperCase();
  if (name === "PING") return "+PONG\r\n";
  if (name === "SETEX") {
    values.set(command[1], command[3] || "");
    return "+OK\r\n";
  }
  if (name === "MGET") {
    return `*${Math.max(0, command.length - 1)}\r\n${command.slice(1).map((key) => encodeFakeRedisBulk(values.get(key) ?? null)).join("")}`;
  }
  if (name === "AUTH" || name === "SELECT") return "+OK\r\n";
  return `-ERR unsupported command ${name}\r\n`;
}

function parseFakeRedisCommand(buffer) {
  if (buffer[0] !== 42) return null;
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd < 0) return null;
  const count = Number(buffer.slice(1, lineEnd).toString());
  let offset = lineEnd + 2;
  const command = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer[offset] !== 36) return null;
    const lengthEnd = buffer.indexOf("\r\n", offset);
    if (lengthEnd < 0) return null;
    const length = Number(buffer.slice(offset + 1, lengthEnd).toString());
    const start = lengthEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    command.push(buffer.slice(start, end).toString());
    offset = end + 2;
  }
  return { command, offset };
}

function encodeFakeRedisBulk(value) {
  if (value === null || value === undefined) return "$-1\r\n";
  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}

async function startFakeS3() {
  const objects = new Map();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks);
    const key = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname.replace(/^\/+/, ""));
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === "PUT") {
      objects.set(key, { data, contentType: req.headers["content-type"] || "application/octet-stream" });
      res.writeHead(200, { etag: `"${createHash("md5").update(data).digest("hex")}"` });
      res.end();
      return;
    }
    if (req.method === "GET" && objects.has(key)) {
      const stored = objects.get(key);
      res.writeHead(200, { "content-type": stored.contentType, "content-length": stored.data.length });
      res.end(stored.data);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function examWindow(startOffsetMinutes, durationMinutes) {
  const start = new Date(Date.now() + startOffsetMinutes * 60 * 1000);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    startTime: toDateTimeLocal(start),
    endTime: toDateTimeLocal(end),
  };
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function answerAllQuestions(questions = []) {
  return Object.fromEntries(
    questions.map((question) => {
      if (question.type === "多选") return [question.id, Array.isArray(question.answer) ? question.answer : ["A"]];
      if (question.type === "判断") return [question.id, question.answer || "正确"];
      if (question.type === "单选") return [question.id, question.answer || "A"];
      return [question.id, "验证作答"];
    }),
  );
}
