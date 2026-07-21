import { randomBytes } from "node:crypto";
import { logItem } from "../lib/audit.js";
import { updateState } from "../lib/runtime-store.js";
import { isSuperAdmin } from "./access-control-service.js";

const maxConversationsPerUser = 30;
const maxMessagesPerConversation = 100;
const maxUserMessageChars = 8_000;

export function listAssistantConversations(state, actor = {}) {
  return (state.assistantConversations || [])
    .filter((item) => item.ownerUserId === String(actor.userId || ""))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map(publicConversationSummary);
}

export function getAssistantConversation(state, id, actor = {}) {
  const conversation = findOwnedConversation(state, id, actor);
  return conversation ? publicConversation(conversation) : null;
}

export async function createAssistantConversation(body = {}, actor = {}) {
  const now = new Date().toISOString();
  return updateState((state) => {
    state.assistantConversations = Array.isArray(state.assistantConversations) ? state.assistantConversations : [];
    const conversation = {
      id: `assistant-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      ownerUserId: String(actor.userId || ""),
      title: cleanTitle(body.title),
      scope: normalizeAssistantScope(body.scope, actor),
      mode: normalizeAssistantMode(body.mode),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    state.assistantConversations.unshift(conversation);
    trimUserConversations(state, actor.userId);
    return publicConversation(conversation);
  });
}

export async function appendAssistantUserMessage(id, body = {}, actor = {}) {
  const content = String(body.content || "").trim();
  if (!content) throw badRequest("请输入需要咨询的内容");
  if (content.length > maxUserMessageChars) throw badRequest(`单条消息不能超过 ${maxUserMessageChars} 个字符`);
  return updateState((state) => {
    const conversation = findOwnedConversation(state, id, actor);
    if (!conversation) return null;
    const now = new Date().toISOString();
    conversation.scope = normalizeAssistantScope(body.scope ?? conversation.scope, actor);
    conversation.mode = normalizeAssistantMode(body.mode ?? conversation.mode);
    if (!conversation.messages.length || conversation.title === "新对话") conversation.title = cleanTitle(content);
    const message = {
      id: `assistant-message-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      role: "user",
      content,
      sources: [],
      status: "done",
      createdAt: now,
    };
    conversation.messages.push(message);
    conversation.messages = conversation.messages.slice(-maxMessagesPerConversation);
    conversation.updatedAt = now;
    return { conversation: publicConversation(conversation), message };
  });
}

export async function appendAssistantReply(id, reply = {}, actor = {}, meta = {}) {
  return updateState((state) => {
    const conversation = findOwnedConversation(state, id, actor);
    if (!conversation) return null;
    const now = new Date().toISOString();
    const message = {
      id: `assistant-message-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      role: "assistant",
      content: String(reply.content || "").slice(0, 30_000),
      sources: Array.isArray(reply.sources) ? reply.sources.slice(0, 40) : [],
      status: reply.status === "interrupted" ? "interrupted" : "done",
      createdAt: now,
    };
    conversation.messages.push(message);
    conversation.messages = conversation.messages.slice(-maxMessagesPerConversation);
    conversation.updatedAt = now;
    state.auditLog.push(logItem("assistant-query", `${actor.username || "用户"} 使用 SmartQ 小助手`, {
      actor: actor.username,
      ownerUserId: actor.userId,
      conversationId: conversation.id,
      scope: conversation.scope,
      mode: conversation.mode,
      tools: Array.isArray(meta.toolNames) ? [...new Set(meta.toolNames)].slice(0, 20) : [],
      webUsed: Boolean(meta.webUsed),
      durationMs: Math.max(0, Number(meta.durationMs || 0)),
      status: message.status,
    }));
    return { conversation: publicConversation(conversation), message };
  });
}

export async function recordAssistantFailure(id, actor = {}, meta = {}) {
  return updateState((state) => {
    const conversation = findOwnedConversation(state, id, actor);
    if (!conversation) return null;
    conversation.updatedAt = new Date().toISOString();
    state.auditLog.push(logItem("assistant-query-failed", `${actor.username || "用户"} 使用 SmartQ 小助手失败`, {
      actor: actor.username,
      ownerUserId: actor.userId,
      conversationId: conversation.id,
      scope: conversation.scope,
      mode: conversation.mode,
      tools: Array.isArray(meta.toolNames) ? [...new Set(meta.toolNames)].slice(0, 20) : [],
      durationMs: Math.max(0, Number(meta.durationMs || 0)),
      status: meta.status === "interrupted" ? "interrupted" : "error",
      errorCode: normalizeAssistantErrorCode(meta.errorCode),
    }));
    return publicConversationSummary(conversation);
  });
}

export async function deleteAssistantConversation(id, actor = {}) {
  return updateState((state) => {
    const index = (state.assistantConversations || []).findIndex((item) => item.id === id && item.ownerUserId === String(actor.userId || ""));
    if (index < 0) return false;
    state.assistantConversations.splice(index, 1);
    return true;
  });
}

export function normalizeAssistantScope(value, actor = {}) {
  return value === "all" && isSuperAdmin(actor) ? "all" : "mine";
}

export function normalizeAssistantMode(value) {
  return ["auto", "system", "web"].includes(value) ? value : "auto";
}

function normalizeAssistantErrorCode(value) {
  const code = String(value || "unknown").toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(code) ? code : "unknown";
}

function findOwnedConversation(state, id, actor = {}) {
  return (state.assistantConversations || []).find((item) => item.id === String(id || "") && item.ownerUserId === String(actor.userId || "")) || null;
}

function trimUserConversations(state, userId) {
  const ownerUserId = String(userId || "");
  const owned = state.assistantConversations
    .filter((item) => item.ownerUserId === ownerUserId)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const keep = new Set(owned.slice(0, maxConversationsPerUser).map((item) => item.id));
  state.assistantConversations = state.assistantConversations.filter((item) => item.ownerUserId !== ownerUserId || keep.has(item.id));
}

function publicConversation(conversation = {}) {
  return { ...publicConversationSummary(conversation), messages: Array.isArray(conversation.messages) ? conversation.messages : [] };
}

function publicConversationSummary(conversation = {}) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  return {
    id: conversation.id,
    title: conversation.title || "新对话",
    scope: conversation.scope === "all" ? "all" : "mine",
    mode: normalizeAssistantMode(conversation.mode),
    messageCount: messages.length,
    lastMessage: String(messages.at(-1)?.content || "").slice(0, 120),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return (title || "新对话").slice(0, 36);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
