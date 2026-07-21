import { ElMessageBox } from "element-plus";
import "element-plus/theme-chalk/el-message-box.css";
import { request, streamRequest } from "../core/api-client.js";

export function freshAssistantState() {
  return {
    open: false,
    loaded: false,
    loading: false,
    conversations: [],
    activeConversationId: "",
    messages: [],
    input: "",
    mode: "auto",
    scope: "mine",
    sending: false,
    toolStatus: "",
    error: "",
  };
}

export function createAssistantStore({ state, notify, go, selectPaper, openQuestionBankDetail, openMaterialDetail, selectQuestionBankCategory }) {
  let activeController = null;

  async function openAssistant() {
    state.assistant.open = true;
    if (!state.assistant.loaded) await loadAssistantConversations();
  }

  function closeAssistant() {
    state.assistant.open = false;
  }

  async function loadAssistantConversations() {
    if (!state.admin.token || state.assistant.loading) return;
    state.assistant.loading = true;
    state.assistant.error = "";
    try {
      const result = await request("/api/assistant/conversations");
      state.assistant.conversations = result.items || [];
      state.assistant.loaded = true;
      if (!state.assistant.activeConversationId && state.assistant.conversations.length) {
        await selectAssistantConversation(state.assistant.conversations[0].id);
      }
    } catch (error) {
      if (error?.status !== 401) state.assistant.error = error.message;
    } finally {
      state.assistant.loading = false;
    }
  }

  async function newAssistantConversation() {
    if (state.assistant.sending) return;
    state.assistant.error = "";
    try {
      const conversation = await request("/api/assistant/conversations", {
        method: "POST",
        body: JSON.stringify({ mode: state.assistant.mode, scope: effectiveScope() }),
      });
      state.assistant.conversations = [conversation, ...state.assistant.conversations.filter((item) => item.id !== conversation.id)];
      applyConversation(conversation);
    } catch (error) {
      state.assistant.error = error.message;
    }
  }

  async function selectAssistantConversation(id) {
    if (!id || state.assistant.sending) return;
    state.assistant.loading = true;
    state.assistant.error = "";
    try {
      const conversation = await request(`/api/assistant/conversations/${encodeURIComponent(id)}`);
      applyConversation(conversation);
    } catch (error) {
      state.assistant.error = error.message;
    } finally {
      state.assistant.loading = false;
    }
  }

  async function deleteActiveAssistantConversation() {
    const id = state.assistant.activeConversationId;
    if (!id || state.assistant.sending) return;
    try {
      await ElMessageBox.confirm("确认删除当前对话？删除后无法恢复。", "删除对话", {
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        type: "warning",
      });
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      throw error;
    }
    try {
      await request(`/api/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.assistant.conversations = state.assistant.conversations.filter((item) => item.id !== id);
      state.assistant.activeConversationId = "";
      state.assistant.messages = [];
      if (state.assistant.conversations.length) await selectAssistantConversation(state.assistant.conversations[0].id);
      notify("对话已删除");
    } catch (error) {
      notify(`删除失败：${error.message}`, "error");
    }
  }

  async function sendAssistantMessage(value) {
    const content = String(value ?? state.assistant.input).trim();
    if (!content || state.assistant.sending) return;
    if (!state.assistant.activeConversationId) await newAssistantConversation();
    const conversationId = state.assistant.activeConversationId;
    if (!conversationId) return;
    const optimisticUserId = `local-user-${Date.now()}`;
    const pendingAssistantId = `local-assistant-${Date.now()}`;
    state.assistant.messages.push({ id: optimisticUserId, role: "user", content, sources: [], status: "done", createdAt: new Date().toISOString() });
    state.assistant.messages.push({ id: pendingAssistantId, role: "assistant", content: "", sources: [], status: "done", createdAt: new Date().toISOString() });
    state.assistant.input = "";
    state.assistant.sending = true;
    state.assistant.toolStatus = "正在理解问题";
    state.assistant.error = "";
    activeController = new AbortController();
    let streamError = null;
    try {
      await streamRequest(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, mode: state.assistant.mode, scope: effectiveScope() }),
        signal: activeController.signal,
        onEvent(event, payload) {
          const pending = state.assistant.messages.find((item) => item.id === pendingAssistantId);
          if (event === "meta") {
            const index = state.assistant.messages.findIndex((item) => item.id === optimisticUserId);
            if (index >= 0 && payload.userMessage) state.assistant.messages[index] = payload.userMessage;
            mergeConversation(payload.conversation);
          } else if (event === "tool") {
            state.assistant.toolStatus = payload.status === "running" ? payload.label : payload.status === "error" ? `${payload.label}失败` : `${payload.label}完成`;
          } else if (event === "delta" && pending) {
            pending.content += payload.text || "";
          } else if (event === "sources" && pending) {
            pending.sources = payload.items || [];
          } else if (event === "done") {
            const index = state.assistant.messages.findIndex((item) => item.id === pendingAssistantId);
            if (index >= 0 && payload.message) state.assistant.messages[index] = payload.message;
            mergeConversation(payload.conversation);
            state.assistant.toolStatus = "";
          } else if (event === "error") {
            streamError = payload;
            if (pending) {
              pending.status = payload.interrupted ? "interrupted" : "error";
              if (!pending.content) pending.content = payload.error || "回答失败，请稍后重试";
            }
            state.assistant.toolStatus = "";
          }
        },
      });
      if (streamError && !streamError.interrupted) state.assistant.error = streamError.error || "回答失败，请稍后重试";
    } catch (error) {
      const pending = state.assistant.messages.find((item) => item.id === pendingAssistantId);
      if (error?.name === "AbortError") {
        if (pending) {
          pending.status = "interrupted";
          if (!pending.content) pending.content = "回答已停止";
        }
      } else {
        if (pending) {
          pending.status = "error";
          if (!pending.content) pending.content = error.message || "回答失败，请稍后重试";
        }
        state.assistant.error = error.message;
      }
    } finally {
      activeController = null;
      state.assistant.sending = false;
      state.assistant.toolStatus = "";
      loadAssistantConversations().catch(() => {});
    }
  }

  function stopAssistantResponse() {
    if (!state.assistant.sending) return;
    activeController?.abort();
    const id = state.assistant.activeConversationId;
    if (id) request(`/api/assistant/conversations/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({}) }).catch(() => {});
  }

  async function openAssistantSource(source) {
    if (!source) return;
    if (source.type === "web" && source.url) {
      window.open(source.url, "_blank", "noopener,noreferrer");
      return;
    }
    closeAssistant();
    if (source.entityType === "paper") {
      go("papers");
      await selectPaper(source.id);
    } else if (source.entityType === "question") {
      go("question-bank");
      await openQuestionBankDetail({ id: source.id });
    } else if (source.entityType === "material") {
      go("materials");
      await openMaterialDetail({ id: source.id });
    } else if (source.entityType === "category") {
      go("question-bank");
      selectQuestionBankCategory(source.id);
    } else if (source.entityType === "workspace") go("authoring");
    else if (source.entityType === "user") go("users");
  }

  async function copyAssistantMessage(message) {
    try {
      await navigator.clipboard.writeText(String(message?.content || ""));
      notify(message?.role === "user" ? "问题已复制" : "回答已复制");
    } catch {
      notify("复制失败，请手动选择文本", "error");
    }
  }

  function resetAssistantSession() {
    activeController?.abort();
    activeController = null;
    Object.assign(state.assistant, freshAssistantState());
  }

  function applyConversation(conversation) {
    state.assistant.activeConversationId = conversation.id;
    state.assistant.messages = conversation.messages || [];
    state.assistant.mode = conversation.mode || "auto";
    state.assistant.scope = state.admin.user?.role === "super_admin" ? conversation.scope || "mine" : "mine";
    mergeConversation(conversation);
  }

  function mergeConversation(conversation) {
    if (!conversation?.id) return;
    const summary = { ...conversation };
    delete summary.messages;
    state.assistant.conversations = [summary, ...state.assistant.conversations.filter((item) => item.id !== summary.id)]
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }

  function effectiveScope() {
    return state.admin.user?.role === "super_admin" && state.assistant.scope === "all" ? "all" : "mine";
  }

  function isAssistantSourceNavigable(source) {
    return source?.type === "web" || ["paper", "question", "material", "category", "workspace", "user"].includes(source?.entityType);
  }

  return {
    openAssistant,
    closeAssistant,
    loadAssistantConversations,
    newAssistantConversation,
    selectAssistantConversation,
    deleteActiveAssistantConversation,
    sendAssistantMessage,
    stopAssistantResponse,
    openAssistantSource,
    copyAssistantMessage,
    isAssistantSourceNavigable,
    resetAssistantSession,
  };
}
