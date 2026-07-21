import { randomBytes } from "node:crypto";
import { logItem } from "../lib/audit.js";
import {
  findAdminUser,
  publicAdminUser,
  verifyAdminPassword,
} from "./admin-user-service.js";

export const maxAdminAvatarBytes = 100 * 1024;

export function requiresAdminAuth(req, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  if (req.method === "GET" && ["/api/health", "/api/config"].includes(url.pathname)) return false;
  if (req.method === "POST" && url.pathname === "/api/admin/login") return false;
  return true;
}

export async function loginAdmin(state, body = {}) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return { error: "请输入登录账号和密码", statusCode: 400 };
  const user = findAdminUser(state, username);
  const passwordMatches = user ? await verifyAdminPassword(password, user.passwordHash) : false;
  if (!user || !passwordMatches) {
    state.auditLog.push(logItem("admin-login-failed", `${username || "unknown"} 管理员登录失败`, {
      identifier: username || "unknown",
    }));
    return { error: "登录账号或密码错误", statusCode: 401 };
  }
  if (user.status !== "active") {
    state.auditLog.push(logItem("admin-login-disabled", `${username} 已停用账号尝试登录`, { identifier: username }));
    return { error: "账号已停用，请联系管理员", statusCode: 403 };
  }
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const token = randomToken(32);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const session = {
    id: `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    userId: user.id,
    username: user.username,
    authVersion: user.authVersion,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  };
  state.adminSessions[token] = session;
  user.lastLoginAt = now;
  state.auditLog.push(logItem("admin-login", `${username} 登录控制台`));
  return { token, expiresAt, admin: publicAdminSession(session, user) };
}

export function logoutAdmin(state, token = "") {
  const value = String(token || "").trim();
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  if (value && state.adminSessions[value]) {
    const username = state.adminSessions[value].username || "admin";
    delete state.adminSessions[value];
    state.auditLog.push(logItem("admin-logout", `${username} 退出控制台`));
  }
  return { loggedOut: true };
}

export function authenticateAdmin(state, token = "") {
  const value = String(token || "").trim();
  if (!value) return { error: "请先登录控制台", statusCode: 401 };
  state.adminSessions = pruneAdminSessions(state.adminSessions || {});
  const session = state.adminSessions[value];
  if (!session) return { error: "控制台登录已失效，请重新登录", statusCode: 401 };
  const expiresAt = new Date(session.expiresAt || 0).getTime();
  if (!expiresAt || expiresAt < Date.now()) {
    delete state.adminSessions[value];
    return { error: "控制台登录已过期，请重新登录", statusCode: 401 };
  }
  const user = findAdminUser(state, session.userId || session.username);
  if (!user || user.status !== "active" || session.authVersion !== user.authVersion) {
    delete state.adminSessions[value];
    return { error: "控制台登录已失效，请重新登录", statusCode: 401 };
  }
  session.lastSeenAt = new Date().toISOString();
  session.username = user.username;
  return { session, user };
}

export function publicAdminSession(session = {}, user = {}) {
  return publicAdminUser(user, session);
}

export function updateAdminProfile(state, session = {}, body = {}) {
  const displayName = String(body.displayName || "").trim();
  if (!displayName) return { error: "请输入显示名称", statusCode: 400 };
  if (displayName.length > 32) return { error: "显示名称不能超过 32 个字符", statusCode: 400 };
  const user = findAdminUser(state, session.userId || session.username);
  if (!user) return { error: "用户不存在", statusCode: 404 };
  user.displayName = displayName;
  user.updatedAt = new Date().toISOString();
  state.auditLog.push(logItem("admin-profile-update", `${session.username} 更新个人资料`));
  return { admin: publicAdminSession(session, user) };
}

export function updateAdminAvatar(state, session = {}, buffer, mimeType = "") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { error: "请选择头像图片", statusCode: 400 };
  if (buffer.length > maxAdminAvatarBytes) return { error: "头像图片不能超过 100KB", statusCode: 413 };
  const dimensions = imageDimensions(buffer, mimeType);
  if (!dimensions) return { error: "头像仅支持 PNG、JPG 或 WebP 图片", statusCode: 400 };
  if (dimensions.width !== dimensions.height) return { error: "头像必须是方形图片", statusCode: 400 };
  const user = findAdminUser(state, session.userId || session.username);
  if (!user) return { error: "用户不存在", statusCode: 404 };
  user.avatar = `data:${dimensions.mimeType};base64,${buffer.toString("base64")}`;
  user.updatedAt = new Date().toISOString();
  state.auditLog.push(logItem("admin-avatar-update", `${session.username} 更新用户头像`));
  return { admin: publicAdminSession(session, user) };
}

export function resetAdminAvatar(state, session = {}) {
  const user = findAdminUser(state, session.userId || session.username);
  if (!user) return { error: "用户不存在", statusCode: 404 };
  user.avatar = "";
  user.updatedAt = new Date().toISOString();
  state.auditLog.push(logItem("admin-avatar-reset", `${session.username} 恢复默认头像`));
  return { admin: publicAdminSession(session, user) };
}

export function authToken(req, url) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return String(url.searchParams.get("token") || "").trim();
}

function imageDimensions(buffer, declaredMime = "") {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") {
    const webp = webpDimensions(buffer);
    if (webp) return { mimeType: "image/webp", ...webp };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const jpeg = jpegDimensions(buffer);
    if (jpeg) return { mimeType: "image/jpeg", ...jpeg };
  }
  void declaredMime;
  return null;
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += length + 2;
  }
  return null;
}

function webpDimensions(buffer) {
  const chunk = buffer.subarray(12, 16).toString();
  if (chunk === "VP8X" && buffer.length >= 30) {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
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
