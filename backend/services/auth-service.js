import { randomBytes } from "node:crypto";
import { logItem } from "../lib/audit.js";

const rolePermissions = {
  admin: ["authoring", "papers"],
  author: ["authoring", "papers"],
};
const adminUsername = process.env.SMARTQ_ADMIN_USER || "admin";
const adminPassword = process.env.SMARTQ_ADMIN_PASSWORD || "123456";
const adminAccounts = loadAdminAccounts();
const loginSecurity = {
  maxFailures: Number(process.env.SMARTQ_LOGIN_MAX_FAILURES || 5),
  windowMs: Number(process.env.SMARTQ_LOGIN_WINDOW_SECONDS || 15 * 60) * 1000,
  lockMs: Number(process.env.SMARTQ_LOGIN_LOCK_SECONDS || 10 * 60) * 1000,
};

export function requiresAdminAuth(req, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  if (req.method === "GET" && ["/api/health", "/api/config"].includes(url.pathname)) return false;
  if (url.pathname.startsWith("/api/admin/")) return false;
  return true;
}

export function requiredAdminPermission(req, url) {
  const path = url.pathname;
  if (path === "/api/dashboard") return null;
  if (path.startsWith("/api/ai/") || path.startsWith("/api/quality/") || path.startsWith("/api/questions/")) return "authoring";
  if (path.startsWith("/api/papers/") || path === "/api/papers/build" || path === "/api/papers/publish") return "papers";
  return null;
}

export function requireAdminPermission(session = {}, permission) {
  if (!permission) return {};
  const permissions = Array.isArray(session.permissions) ? session.permissions : rolePermissions[session.role] || [];
  if (permissions.includes(permission)) return {};
  return { error: `无权访问该功能：需要 ${permission} 权限`, statusCode: 403, permission };
}

export function loginAdmin(state, body = {}, req = {}) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return { error: "请输入管理员账号和密码", statusCode: 400 };
  const attemptKey = loginAttemptKey("admin", username || "unknown", req);
  const limit = checkLoginLimit(state, attemptKey);
  if (limit.blocked) {
    state.auditLog.push(logItem("admin-login-blocked", `${username || "unknown"} 管理员登录被限流`, {
      identifier: username || "unknown",
      retryAfterSeconds: limit.retryAfterSeconds,
    }));
    return loginLockedResponse(limit);
  }
  const account = adminAccounts.find((item) => item.username === username);
  if (!account || password !== account.password) {
    const failure = recordLoginFailure(state, attemptKey);
    state.auditLog.push(logItem("admin-login-failed", `${username || "unknown"} 管理员登录失败`, {
      identifier: username || "unknown",
      failures: failure.failures,
      lockedUntil: failure.lockedUntil || null,
    }));
    return { error: "管理员账号或密码错误", statusCode: 401 };
  }
  clearLoginFailures(state, attemptKey);
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const token = randomToken(32);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const session = {
    id: `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    role: account.role,
    permissions: account.permissions,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  };
  state.adminSessions[token] = session;
  state.auditLog.push(logItem("admin-login", `${username} 登录运营控制台`));
  return { token, expiresAt, admin: publicAdminSession(session) };
}

export function logoutAdmin(state, token = "") {
  const value = String(token || "").trim();
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  if (value && state.adminSessions[value]) {
    const username = state.adminSessions[value].username || "admin";
    delete state.adminSessions[value];
    state.auditLog.push(logItem("admin-logout", `${username} 退出运营控制台`));
  }
  return { loggedOut: true };
}

export function authenticateAdmin(state, token = "") {
  const value = String(token || "").trim();
  if (!value) return { error: "请先登录运营控制台", statusCode: 401 };
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const session = state.adminSessions[value];
  if (!session) return { error: "运营登录已失效，请重新登录", statusCode: 401 };
  const expiresAt = new Date(session.expiresAt || 0).getTime();
  if (!expiresAt || expiresAt < Date.now()) {
    delete state.adminSessions[value];
    return { error: "运营登录已过期，请重新登录", statusCode: 401 };
  }
  session.lastSeenAt = new Date().toISOString();
  return { session };
}

export function publicAdminSession(session = {}) {
  return {
    id: session.id || "",
    username: session.username || "",
    role: session.role || "admin",
    permissions: Array.isArray(session.permissions) ? session.permissions : rolePermissions[session.role] || rolePermissions.admin,
    expiresAt: session.expiresAt || null,
    lastSeenAt: session.lastSeenAt || null,
  };
}

export function authToken(req, url) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return String(url.searchParams.get("token") || "").trim();
}

function loadAdminAccounts() {
  const configured = parseAdminAccounts(process.env.SMARTQ_ADMIN_ACCOUNTS);
  if (configured.length) return configured;
  return [{ username: adminUsername, password: adminPassword, role: process.env.SMARTQ_ADMIN_ROLE || "admin" }]
    .map(normalizeAdminAccount)
    .filter(Boolean);
}

function parseAdminAccounts(raw = "") {
  if (!String(raw || "").trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : parsed.accounts;
    return (Array.isArray(rows) ? rows : []).map(normalizeAdminAccount).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeAdminAccount(account = {}) {
  const username = String(account.username || "").trim();
  const password = String(account.password || "");
  if (!username || !password) return null;
  const role = rolePermissions[account.role] ? account.role : "author";
  const explicitPermissions = Array.isArray(account.permissions)
    ? account.permissions.filter((item) => Object.values(rolePermissions).flat().includes(item))
    : null;
  return {
    username,
    password,
    role,
    permissions: [...new Set(explicitPermissions?.length ? explicitPermissions : rolePermissions[role])],
  };
}

function checkLoginLimit(state, key) {
  const bucket = loginAttemptBucket(state, key);
  const lockedUntil = new Date(bucket.lockedUntil || 0).getTime();
  if (lockedUntil && lockedUntil > Date.now()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)),
      lockedUntil: bucket.lockedUntil,
    };
  }
  if (lockedUntil) {
    delete bucket.lockedUntil;
    bucket.failures = 0;
  }
  return { blocked: false };
}

function recordLoginFailure(state, key) {
  const bucket = loginAttemptBucket(state, key);
  const now = Date.now();
  const firstFailureAt = new Date(bucket.firstFailureAt || 0).getTime();
  if (!firstFailureAt || now - firstFailureAt > loginSecurity.windowMs) {
    bucket.failures = 0;
    bucket.firstFailureAt = new Date(now).toISOString();
  }
  bucket.failures = Number(bucket.failures || 0) + 1;
  bucket.lastFailureAt = new Date(now).toISOString();
  if (bucket.failures >= loginSecurity.maxFailures) bucket.lockedUntil = new Date(now + loginSecurity.lockMs).toISOString();
  return bucket;
}

function clearLoginFailures(state, key) {
  if (state.loginSecurity?.attempts) delete state.loginSecurity.attempts[key];
}

function loginAttemptBucket(state, key) {
  state.loginSecurity = state.loginSecurity && typeof state.loginSecurity === "object" ? state.loginSecurity : {};
  state.loginSecurity.attempts = state.loginSecurity.attempts && typeof state.loginSecurity.attempts === "object" ? state.loginSecurity.attempts : {};
  state.loginSecurity.attempts = pruneLoginAttempts(state.loginSecurity.attempts);
  if (!state.loginSecurity.attempts[key]) state.loginSecurity.attempts[key] = { failures: 0 };
  return state.loginSecurity.attempts[key];
}

function pruneLoginAttempts(attempts = {}) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(attempts || {}).filter(([, item]) => {
    const lockedUntil = new Date(item?.lockedUntil || 0).getTime();
    const lastFailureAt = new Date(item?.lastFailureAt || item?.firstFailureAt || 0).getTime();
    return (lockedUntil && lockedUntil > now) || (lastFailureAt && now - lastFailureAt <= loginSecurity.windowMs);
  }));
}

function loginLockedResponse(limit = {}) {
  return {
    error: `登录失败次数过多，请 ${limit.retryAfterSeconds || Math.ceil(loginSecurity.lockMs / 1000)} 秒后再试`,
    statusCode: 429,
    retryAfterSeconds: limit.retryAfterSeconds || Math.ceil(loginSecurity.lockMs / 1000),
    lockedUntil: limit.lockedUntil || null,
  };
}

function loginAttemptKey(scope, identifier, req = {}) {
  return `${scope}:${String(identifier || "unknown").trim().toLowerCase()}:${clientIp(req)}`;
}

function clientIp(req = {}) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "local";
}

function pruneAdminSessions(sessions = {}) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(sessions || {}).filter(([, session]) => {
    const expiresAt = new Date(session?.expiresAt || 0).getTime();
    return expiresAt && expiresAt > now;
  }));
}

function randomToken(size = 16) {
  return randomBytes(size).toString("base64url");
}
