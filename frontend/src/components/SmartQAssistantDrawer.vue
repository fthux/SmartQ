<script setup>
import {
  ChatDotRound,
  Clock,
  CopyDocument,
  Delete,
  Document,
  Link,
  Loading,
  Plus,
  Promotion,
  VideoPause,
} from "@element-plus/icons-vue";
import { nextTick, ref, watch } from "vue";
import { useSmartQ } from "../stores/context.js";
import AssistantMessageContent from "./AssistantMessageContent.vue";

const {
  state,
  isSuperAdmin,
  adminDisplayName,
  closeAssistant,
  newAssistantConversation,
  selectAssistantConversation,
  deleteActiveAssistantConversation,
  sendAssistantMessage,
  stopAssistantResponse,
  openAssistantSource,
  copyAssistantMessage,
  isAssistantSourceNavigable,
  formatDateTimeWithYear,
  publicUrl,
} = useSmartQ();

const messageList = ref(null);
const modeOptions = [
  { label: "自动", value: "auto" },
  { label: "仅系统", value: "system" },
  { label: "系统+联网", value: "web" },
];
const scopeOptions = [
  { label: "我的数据", value: "mine" },
  { label: "全系统", value: "all" },
];
const suggestions = [
  "汇总当前试卷和题库情况",
  "找出最近更新但尚未发布的试卷",
  "分析题库的题型与难度分布",
  "查询出题资料的使用情况",
];

watch(() => state.assistant.messages.map((item) => `${item.id}:${item.content.length}`).join("|"), async () => {
  await nextTick();
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
});

function submitMessage() {
  sendAssistantMessage();
}

function handleInputKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submitMessage();
}

function sourceIcon(source) {
  return source.type === "web" ? Link : Document;
}
</script>

<template>
  <el-drawer
    :model-value="state.assistant.open"
    append-to-body
    direction="rtl"
    size="min(620px, 100vw)"
    class="smartq-assistant-drawer"
    aria-label="SmartQ 小助手"
    :close-on-click-modal="!state.assistant.sending"
    @update:model-value="(value) => !value && closeAssistant()"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-100 text-green-700 dark:bg-emerald-950 dark:text-emerald-300"><el-icon><ChatDotRound /></el-icon></span>
          <div class="min-w-0">
            <div class="truncate text-base font-black">SmartQ 小助手</div>
            <div class="truncate text-xs font-semibold text-slate-400">{{ state.assistant.toolStatus || '在线问答' }}</div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <el-dropdown trigger="click" @command="selectAssistantConversation">
            <el-button circle :icon="Clock" aria-label="历史对话" title="历史对话" />
            <template #dropdown>
              <el-dropdown-menu class="max-h-80 w-72 overflow-y-auto">
                <el-dropdown-item v-if="!state.assistant.conversations.length" disabled>暂无历史对话</el-dropdown-item>
                <el-dropdown-item v-for="item in state.assistant.conversations" :key="item.id" :command="item.id" :disabled="state.assistant.sending">
                  <div class="min-w-0 py-1">
                    <div class="truncate text-sm font-bold">{{ item.title }}</div>
                    <div class="mt-0.5 truncate text-[11px] text-slate-400">{{ formatDateTimeWithYear(item.updatedAt) }} · {{ item.messageCount }} 条消息</div>
                  </div>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-tooltip content="新建对话"><el-button circle :icon="Plus" aria-label="新建对话" :disabled="state.assistant.sending" @click="newAssistantConversation" /></el-tooltip>
          <el-tooltip content="删除当前对话"><el-button circle :icon="Delete" aria-label="删除当前对话" :disabled="!state.assistant.activeConversationId || state.assistant.sending" @click="deleteActiveAssistantConversation" /></el-tooltip>
        </div>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 dark:border-night-border">
        <el-segmented v-model="state.assistant.mode" :options="modeOptions" size="small" aria-label="助手查询模式" />
        <el-segmented v-if="isSuperAdmin" v-model="state.assistant.scope" :options="scopeOptions" size="small" aria-label="助手数据范围" />
      </div>

      <div ref="messageList" class="assistant-message-list min-h-0 flex-1 overflow-y-auto py-4">
        <div v-if="state.assistant.loading && !state.assistant.messages.length" class="flex min-h-40 items-center justify-center text-sm font-semibold text-slate-400">
          <el-icon class="is-loading mr-2"><Loading /></el-icon>正在加载对话
        </div>

        <div v-else-if="!state.assistant.messages.length" class="flex min-h-full flex-col justify-center py-8">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded bg-emerald-100 text-xl text-green-700 dark:bg-emerald-950 dark:text-emerald-300"><el-icon><ChatDotRound /></el-icon></div>
          <div class="mt-4 text-center text-base font-black">SmartQ 小助手</div>
          <div class="mx-auto mt-6 grid w-full max-w-md gap-2 sm:grid-cols-2">
            <el-button v-for="item in suggestions" :key="item" class="suggestion-button" plain @click="sendAssistantMessage(item)">{{ item }}</el-button>
          </div>
        </div>

        <div v-else class="space-y-5">
          <div v-for="message in state.assistant.messages" :key="message.id" class="flex gap-3" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
            <span v-if="message.role === 'assistant'" class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-emerald-100 text-green-700 dark:bg-emerald-950 dark:text-emerald-300"><el-icon><ChatDotRound /></el-icon></span>
            <div class="min-w-0" :class="message.role === 'user' ? 'max-w-[82%]' : 'max-w-[85%] flex-1'">
              <div
                class="assistant-message whitespace-pre-wrap break-words text-sm font-medium leading-6"
                :class="message.role === 'user' ? 'rounded-md bg-primary px-3 py-2.5 text-emerald-950' : 'text-slate-700 dark:text-slate-200'"
              >
                <template v-if="message.content">
                  <AssistantMessageContent v-if="message.role === 'assistant'" :content="message.content" />
                  <template v-else>{{ message.content }}</template>
                </template>
                <span v-else class="inline-flex items-center text-slate-400"><el-icon class="is-loading mr-2"><Loading /></el-icon>正在生成回答</span>
              </div>
              <div v-if="message.role === 'assistant' && message.sources?.length" class="mt-3 flex min-w-0 flex-wrap gap-1.5">
                <el-button v-for="source in message.sources" :key="source.key || `${source.type}-${source.id}`" class="assistant-source-button" size="small" plain :icon="sourceIcon(source)" :disabled="!isAssistantSourceNavigable(source)" @click="openAssistantSource(source)">
                  {{ source.title }}
                </el-button>
              </div>
              <div
                v-if="message.content"
                class="mt-1 flex items-center gap-1"
                :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
              >
                <span v-if="message.createdAt" class="text-[11px] font-medium tabular-nums text-slate-400">
                  {{ formatDateTimeWithYear(message.createdAt) }}
                </span>
                <el-tooltip :content="message.role === 'user' ? '复制问题' : '复制回答'">
                  <el-button
                    link
                    circle
                    size="small"
                    :icon="CopyDocument"
                    :aria-label="message.role === 'user' ? '复制问题' : '复制回答'"
                    @click="copyAssistantMessage(message)"
                  />
                </el-tooltip>
                <span v-if="message.status === 'interrupted'" class="text-[11px] font-semibold text-amber-600">已停止</span>
                <span v-else-if="message.status === 'error'" class="text-[11px] font-semibold text-red-500">回答失败</span>
              </div>
            </div>
            <el-avatar
              v-if="message.role === 'user'"
              :size="32"
              shape="square"
              :src="state.admin.user?.avatar || publicUrl('/assets/default_avatar.jpg')"
              class="shrink-0 bg-primary text-xs font-black text-emerald-950"
            >
              {{ adminDisplayName.slice(0, 1).toUpperCase() }}
            </el-avatar>
          </div>
        </div>
      </div>

      <el-alert v-if="state.assistant.error" class="mb-3" :title="state.assistant.error" type="error" :closable="false" show-icon />
      <div class="border-t border-slate-200 pt-3 dark:border-night-border">
        <el-input
          v-model="state.assistant.input"
          type="textarea"
          :rows="3"
          resize="none"
          maxlength="8000"
          placeholder="输入你的问题或需求"
          :disabled="state.assistant.sending"
          @keydown="handleInputKeydown"
        />
        <div class="mt-2 flex items-center justify-end">
          <el-tooltip v-if="state.assistant.sending" content="停止回答"><el-button type="danger" circle :icon="VideoPause" aria-label="停止回答" @click="stopAssistantResponse" /></el-tooltip>
          <el-tooltip v-else content="发送"><el-button type="primary" circle :icon="Promotion" aria-label="发送消息" :disabled="!state.assistant.input.trim()" @click="submitMessage" /></el-tooltip>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.assistant-message-list {
  scrollbar-gutter: stable;
}

.assistant-message {
  overflow-wrap: anywhere;
}

.assistant-source-button {
  max-width: 100%;
  height: auto;
  min-height: 32px;
  white-space: normal;
}

.assistant-source-button :deep(span) {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  text-align: left;
  line-height: 1.4;
}

.suggestion-button {
  min-height: 44px;
  height: auto;
  margin-left: 0;
  white-space: normal;
  line-height: 1.45;
  text-align: left;
}
</style>
