import { readJson, securityHeaders, sendJson } from "../lib/http.js";
import { actorFromAuth } from "../services/access-control-service.js";
import {
  appendAssistantReply,
  appendAssistantUserMessage,
  createAssistantConversation,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  recordAssistantFailure,
} from "../services/assistant-conversation-service.js";
import { assistantFailureCode, assistantPublicError, runAssistantTurn } from "../services/assistant-service.js";

const activeAssistantRuns = new Map();

export async function handleAssistantRoutes(req, res, url, state, auth) {
  if (!url.pathname.startsWith("/api/assistant")) return false;
  const actor = actorFromAuth(auth);

  if (req.method === "GET" && url.pathname === "/api/assistant/conversations") {
    sendJson(res, 200, { items: listAssistantConversations(state, actor) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/assistant/conversations") {
    const conversation = await createAssistantConversation(await readJson(req), actor);
    sendJson(res, 201, conversation);
    return true;
  }

  const match = url.pathname.match(/^\/api\/assistant\/conversations\/([^/]+)(?:\/(messages|cancel))?$/);
  if (!match) {
    sendJson(res, 404, { error: "请求的助手接口不存在" });
    return true;
  }
  const id = decodeURIComponent(match[1]);
  const action = match[2] || "";
  const runKey = `${actor.userId}:${id}`;

  if (req.method === "GET" && !action) {
    const conversation = getAssistantConversation(state, id, actor);
    if (!conversation) sendJson(res, 404, { error: "对话不存在或已被删除" });
    else sendJson(res, 200, conversation);
    return true;
  }

  if (req.method === "DELETE" && !action) {
    if (activeAssistantRuns.has(runKey)) {
      sendJson(res, 409, { error: "当前对话正在生成回答，请先停止后再删除" });
      return true;
    }
    const deleted = await deleteAssistantConversation(id, actor);
    if (!deleted) sendJson(res, 404, { error: "对话不存在或已被删除" });
    else sendJson(res, 200, { deleted: true });
    return true;
  }

  if (req.method === "POST" && action === "cancel") {
    const controller = activeAssistantRuns.get(runKey);
    if (controller) controller.abort();
    sendJson(res, 200, { cancelled: Boolean(controller) });
    return true;
  }

  if (req.method === "POST" && action === "messages") {
    if (activeAssistantRuns.has(runKey)) {
      sendJson(res, 409, { error: "当前对话正在生成回答，请先停止后再发送" });
      return true;
    }
    const controller = new AbortController();
    activeAssistantRuns.set(runKey, controller);
    let created;
    try {
      const body = await readJson(req);
      created = await appendAssistantUserMessage(id, body, actor);
    } catch (error) {
      activeAssistantRuns.delete(runKey);
      throw error;
    }
    if (!created) {
      activeAssistantRuns.delete(runKey);
      sendJson(res, 404, { error: "对话不存在或已被删除" });
      return true;
    }
    await streamAssistantReply(req, res, state, auth, actor, created, runKey, controller);
    return true;
  }

  sendJson(res, 405, { error: "不支持的助手操作" });
  return true;
}

async function streamAssistantReply(req, res, state, auth, actor, created, runKey, controller) {
  const startedAt = Date.now();
  res.writeHead(200, {
    ...securityHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  sendEvent(res, "meta", { conversation: conversationSummary(created.conversation), userMessage: created.message });
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const result = await runAssistantTurn({
      state,
      auth,
      conversation: created.conversation,
      signal: controller.signal,
      onEvent: (event) => sendEvent(res, event.type || "tool", event),
    });
    for (const chunk of chunkText(result.content)) {
      if (controller.signal.aborted || res.destroyed) break;
      sendEvent(res, "delta", { text: chunk });
      await yieldToEventLoop();
    }
    if (controller.signal.aborted) throw abortError();
    const saved = await appendAssistantReply(created.conversation.id, result, actor, result);
    sendEvent(res, "sources", { items: result.sources });
    sendEvent(res, "done", { conversation: conversationSummary(saved.conversation), message: saved.message });
  } catch (error) {
    const interrupted = error?.name === "AbortError" || controller.signal.aborted;
    await recordAssistantFailure(created.conversation.id, actor, {
      ...(error.assistantMeta || {}),
      durationMs: error.assistantMeta?.durationMs || Date.now() - startedAt,
      status: interrupted ? "interrupted" : "error",
      errorCode: assistantFailureCode(error),
    }).catch(() => {});
    if (!res.destroyed) sendEvent(res, "error", { error: assistantPublicError(error), interrupted });
  } finally {
    if (activeAssistantRuns.get(runKey) === controller) activeAssistantRuns.delete(runKey);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

function sendEvent(res, event, data) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chunkText(value) {
  return String(value || "").match(/[\s\S]{1,120}/g) || [];
}

function conversationSummary(conversation = {}) {
  const { messages: _messages, ...summary } = conversation;
  return summary;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function abortError() {
  const error = new Error("Assistant response aborted");
  error.name = "AbortError";
  return error;
}
