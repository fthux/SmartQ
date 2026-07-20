import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { logItem } from "../lib/audit.js";

const scrypt = promisify(scryptCallback);
const passwordKeyLength = 64;

export async function initializeAdminUsers(state) {
  const before = JSON.stringify({
    users: state.adminUsers || [],
    profiles: state.adminProfiles || null,
    sessions: state.adminSessions || {},
  });
  const profiles = state.adminProfiles && typeof state.adminProfiles === "object" ? state.adminProfiles : {};
  let users = normalizeStoredUsers(state.adminUsers);

  if (!users.length) {
    const accounts = loadBootstrapAccounts();
    users = await Promise.all(accounts.map(async (account) => {
      const profile = profiles[account.username] || {};
      const now = new Date().toISOString();
      return {
        id: createUserId(),
        username: account.username,
        passwordHash: await hashAdminPassword(account.password),
        displayName: normalizeDisplayName(profile.displayName, account.username),
        avatar: String(profile.avatar || ""),
        status: "active",
        authVersion: 1,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        passwordChangedAt: now,
        createdBy: "bootstrap",
      };
    }));
    state.adminSessions = {};
  } else {
    users = users.map((user) => {
      const profile = profiles[user.username] || {};
      return {
        ...user,
        displayName: user.displayName || normalizeDisplayName(profile.displayName, user.username),
        avatar: user.avatar || String(profile.avatar || ""),
      };
    });
  }

  if (users.length && !users.some((user) => user.status === "active")) {
    users[0] = { ...users[0], status: "active", authVersion: users[0].authVersion + 1 };
  }

  state.adminUsers = users;
  state.adminSessions = normalizeStoredSessions(state.adminSessions);
  delete state.adminProfiles;
  const after = JSON.stringify({ users: state.adminUsers, profiles: null, sessions: state.adminSessions });
  return before !== after;
}

export function findAdminUser(state, identity = "") {
  const value = String(identity || "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  return (state.adminUsers || []).find((user) => user.id === value || user.username.toLowerCase() === lower) || null;
}

export function publicAdminUser(user = {}, session = {}) {
  return {
    id: user.id || "",
    username: user.username || "",
    displayName: user.displayName || user.username || "",
    avatar: user.avatar || "",
    status: user.status || "disabled",
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    expiresAt: session.expiresAt || null,
    lastSeenAt: session.lastSeenAt || null,
  };
}

export function listAdminUsers(state, query = {}) {
  const search = String(query.search || "").trim().toLowerCase();
  const status = String(query.status || "").trim();
  const page = clampInteger(query.page, 1, 100000, 1);
  const pageSize = clampInteger(query.pageSize, 1, 100, 20);
  const filtered = (state.adminUsers || [])
    .filter((user) => {
      if (search && ![user.username, user.displayName].join(" ").toLowerCase().includes(search)) return false;
      if (status && user.status !== status) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const start = (page - 1) * pageSize;
  return {
    users: filtered.slice(start, start + pageSize).map((user) => publicAdminUser(user)),
    total: filtered.length,
    page,
    pageSize,
  };
}

export async function createAdminUser(state, actorSession = {}, body = {}) {
  const username = String(body.username || "").trim();
  const displayName = normalizeDisplayName(body.displayName, username);
  const password = String(body.password || "");
  const usernameError = validateUsername(username);
  if (usernameError) return errorResult(usernameError);
  if ((state.adminUsers || []).some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return errorResult("登录账号已存在", 409);
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) return errorResult(displayNameError);
  const passwordError = validatePassword(password);
  if (passwordError) return errorResult(passwordError);

  const now = new Date().toISOString();
  const user = {
    id: createUserId(),
    username,
    passwordHash: await hashAdminPassword(password),
    displayName,
    avatar: "",
    status: "active",
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    passwordChangedAt: now,
    createdBy: actorSession.userId || actorSession.username || "admin",
  };
  state.adminUsers.push(user);
  pushAudit(state, "admin-user-create", `${actorSession.username} 创建用户 ${username}`, actorSession, user);
  return { user: publicAdminUser(user) };
}

export function updateAdminUser(state, actorSession = {}, userId = "", body = {}) {
  const target = findAdminUser(state, userId);
  if (!target) return errorResult("用户不存在", 404);
  const nextDisplayName = body.displayName === undefined ? target.displayName : normalizeDisplayName(body.displayName, "");
  const nextStatus = body.status === undefined ? target.status : String(body.status || "");
  const displayNameError = validateDisplayName(nextDisplayName);
  if (displayNameError) return errorResult(displayNameError);
  if (!["active", "disabled"].includes(nextStatus)) return errorResult("请选择有效用户状态");

  const changesStatus = nextStatus !== target.status;
  if (target.id === actorSession.userId && changesStatus) {
    return errorResult("不能停用自己的账号", 409);
  }

  target.displayName = nextDisplayName;
  target.status = nextStatus;
  target.updatedAt = new Date().toISOString();
  if (changesStatus) {
    target.authVersion += 1;
    revokeAdminUserSessions(state, target.id);
  }
  pushAudit(state, "admin-user-update", `${actorSession.username} 更新用户 ${target.username}`, actorSession, target, {
    status: target.status,
  });
  return { user: publicAdminUser(target) };
}

export async function resetAdminUserPassword(state, actorSession = {}, userId = "", body = {}) {
  const target = findAdminUser(state, userId);
  if (!target) return errorResult("用户不存在", 404);
  if (target.id === actorSession.userId) return errorResult("请在个人资料中修改自己的密码", 409);
  const password = String(body.password || "");
  const passwordError = validatePassword(password);
  if (passwordError) return errorResult(passwordError);
  target.passwordHash = await hashAdminPassword(password);
  target.passwordChangedAt = new Date().toISOString();
  target.updatedAt = target.passwordChangedAt;
  target.authVersion += 1;
  const revokedSessions = revokeAdminUserSessions(state, target.id);
  pushAudit(state, "admin-user-password-reset", `${actorSession.username} 重置用户 ${target.username} 的密码`, actorSession, target, {
    revokedSessions,
  });
  return { user: publicAdminUser(target), revokedSessions };
}

export async function changeAdminPassword(state, session = {}, token = "", body = {}) {
  const user = findAdminUser(state, session.userId || session.username);
  if (!user) return errorResult("用户不存在", 404);
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!await verifyAdminPassword(currentPassword, user.passwordHash)) return errorResult("当前密码不正确", 401);
  const passwordError = validatePassword(newPassword);
  if (passwordError) return errorResult(passwordError);
  if (currentPassword === newPassword) return errorResult("新密码不能与当前密码相同");

  user.passwordHash = await hashAdminPassword(newPassword);
  user.passwordChangedAt = new Date().toISOString();
  user.updatedAt = user.passwordChangedAt;
  user.authVersion += 1;
  const revokedSessions = revokeAdminUserSessions(state, user.id, token);
  const currentSession = state.adminSessions?.[token];
  if (currentSession) currentSession.authVersion = user.authVersion;
  pushAudit(state, "admin-password-change", `${user.username} 修改登录密码`, session, user, { revokedSessions });
  return { admin: publicAdminUser(user, currentSession), revokedSessions };
}

export function revokeManagedAdminUserSessions(state, actorSession = {}, userId = "") {
  const target = findAdminUser(state, userId);
  if (!target) return errorResult("用户不存在", 404);
  if (target.id === actorSession.userId) return errorResult("不能在用户管理中强制下线自己", 409);
  const revokedSessions = revokeAdminUserSessions(state, target.id);
  pushAudit(state, "admin-user-sessions-revoke", `${actorSession.username} 强制下线用户 ${target.username}`, actorSession, target, {
    revokedSessions,
  });
  return { user: publicAdminUser(target), revokedSessions };
}

export function revokeAdminUserSessions(state, userId, exceptToken = "") {
  let revoked = 0;
  state.adminSessions = state.adminSessions && typeof state.adminSessions === "object" ? state.adminSessions : {};
  for (const [token, session] of Object.entries(state.adminSessions)) {
    if (token !== exceptToken && session?.userId === userId) {
      delete state.adminSessions[token];
      revoked += 1;
    }
  }
  return revoked;
}

export async function hashAdminPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(String(password || ""), salt, passwordKeyLength);
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}

export async function verifyAdminPassword(password, encoded = "") {
  const [scheme, salt, hex] = String(encoded || "").split("$");
  if (scheme !== "scrypt" || !salt || !/^[a-f0-9]+$/i.test(hex || "")) return false;
  const expected = Buffer.from(hex, "hex");
  if (!expected.length) return false;
  const actual = Buffer.from(await scrypt(String(password || ""), salt, expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeStoredUsers(input) {
  if (!Array.isArray(input)) return [];
  const usernames = new Set();
  return input.map((item) => normalizeStoredUser(item)).filter((user) => {
    if (!user || usernames.has(user.username.toLowerCase())) return false;
    usernames.add(user.username.toLowerCase());
    return true;
  });
}

function normalizeStoredSessions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).map(([token, session]) => {
    const source = session && typeof session === "object" ? session : {};
    const normalized = {};
    for (const key of ["id", "userId", "username", "authVersion", "createdAt", "expiresAt", "lastSeenAt"]) {
      if (source[key] !== undefined) normalized[key] = source[key];
    }
    return [token, normalized];
  }));
}

function normalizeStoredUser(item = {}) {
  const username = String(item.username || "").trim();
  const passwordHash = String(item.passwordHash || "");
  if (!username || !passwordHash) return null;
  const now = new Date().toISOString();
  return {
    id: String(item.id || createUserId()),
    username,
    passwordHash,
    displayName: normalizeDisplayName(item.displayName, username),
    avatar: String(item.avatar || ""),
    status: item.status === "disabled" ? "disabled" : "active",
    authVersion: Math.max(1, Number(item.authVersion || 1)),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now,
    lastLoginAt: item.lastLoginAt || null,
    passwordChangedAt: item.passwordChangedAt || item.updatedAt || item.createdAt || now,
    createdBy: String(item.createdBy || "bootstrap"),
  };
}

function loadBootstrapAccounts() {
  const configured = parseBootstrapAccounts(process.env.SMARTQ_ADMIN_ACCOUNTS);
  if (configured.length) return configured;
  const username = String(process.env.SMARTQ_ADMIN_USER || "admin").trim() || "admin";
  const password = String(process.env.SMARTQ_ADMIN_PASSWORD || "123456");
  return [{ username, password }];
}

function parseBootstrapAccounts(raw = "") {
  if (!String(raw || "").trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : parsed.accounts;
    return (Array.isArray(rows) ? rows : []).map((item) => ({
      username: String(item?.username || "").trim(),
      password: String(item?.password || ""),
    })).filter((item) => item.username && item.password);
  } catch {
    return [];
  }
}

function normalizeDisplayName(value, fallback) {
  return String(value || fallback || "").trim().slice(0, 32);
}

function validateUsername(username) {
  if (!username) return "请输入登录账号";
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return "登录账号需为 3-32 位字母、数字、点、下划线或连字符";
  return "";
}

function validateDisplayName(displayName) {
  if (!displayName) return "请输入用户名";
  if (displayName.length > 32) return "用户名不能超过 32 个字符";
  return "";
}

function validatePassword(password) {
  if (password.length < 8) return "密码至少需要 8 个字符";
  if (password.length > 128) return "密码不能超过 128 个字符";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码必须同时包含字母和数字";
  return "";
}

function createUserId() {
  return `user-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function errorResult(error, statusCode = 400) {
  return { error, statusCode };
}

function pushAudit(state, type, message, actorSession, target, details = {}) {
  state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
  state.auditLog.push(logItem(type, message, {
    actorUserId: actorSession.userId || null,
    targetUserId: target.id || null,
    ...details,
  }));
}
