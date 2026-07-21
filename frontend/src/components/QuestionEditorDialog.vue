<script setup>
import { computed } from "vue";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Close,
  Loading,
  MagicStick,
  QuestionFilled,
  RefreshRight,
} from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  requestCloseQuestionEditor,
  saveQuestionEdit,
  runQuestionAiTransform,
  applyQuestionAiCandidate,
  discardQuestionAiCandidate,
  undoQuestionAiChange,
  moveQuestionOption,
  moveSingleCorrectAnswer,
} = useSmartQ();

const letters = ["A", "B", "C", "D"];
const isChoice = computed(() => ["单选", "多选"].includes(state.questionEditForm?.type));
const questionAiLoadingTitle = computed(() => ({
  regenerate: "正在按原来源重新生成题目",
  distractors: "正在重新生成干扰项",
  custom: "正在生成自定义修改方案",
}[state.questionAi.operation] || "AI 正在生成修改方案"));
const sourceLabel = computed(() => {
  const origin = state.editingQuestion?.origin || {};
  if (origin.type === "question-bank") return `题库题 · ${origin.bankQuestionId || "已入库"} · v${origin.bankVersion || 1}`;
  if (origin.type === "material") {
    const names = [...new Set((origin.materialRefs || []).map((item) => item.name).filter(Boolean))];
    return names.length ? `资料题 · ${names.join("、")}` : "资料题";
  }
  return "AI 生成题";
});
const sourceTagType = computed(() => {
  const type = state.editingQuestion?.origin?.type;
  return type === "material" ? "success" : type === "question-bank" ? "primary" : "info";
});

function answerText(question) {
  return Array.isArray(question?.answer) ? question.answer.join("、") : String(question?.answer ?? "");
}

function changedFieldLabel(field) {
  return {
    stem: "题干",
    options: "选项",
    answer: "答案",
    difficulty: "难度",
    explanation: "解析",
    rubric: "评分规则",
  }[field] || field;
}
</script>

<template>
  <el-dialog
    :model-value="Boolean(state.editingQuestion && state.questionEditForm)"
    title="编辑题目"
    width="min(1160px, calc(100vw - 24px))"
    top="3vh"
    append-to-body
    destroy-on-close
    body-class="question-editor-dialog__body"
    :close-on-click-modal="false"
    :close-on-press-escape="!state.questionSaving && !state.questionAi.loading"
    :show-close="!state.questionSaving && !state.questionAi.loading"
    class="question-editor-dialog"
    :aria-busy="state.questionAi.loading"
    @update:model-value="(value) => !value && requestCloseQuestionEditor()"
  >
    <div
      v-if="state.questionAi.loading"
      class="question-editor-busy-mask"
      role="status"
      aria-live="assertive"
    >
      <div class="question-editor-busy-content">
        <el-icon class="is-loading question-editor-busy-spinner"><Loading /></el-icon>
        <strong>{{ questionAiLoadingTitle }}</strong>
        <span>请稍候，完成后可预览并决定是否应用。</span>
      </div>
    </div>

    <div
      v-if="state.questionEditForm"
      class="question-editor-layout"
      :inert="state.questionAi.loading"
    >
      <section class="min-w-0">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <el-tag :type="sourceTagType" effect="plain">{{ sourceLabel }}</el-tag>
          <el-tag v-if="state.questionEditForm.origin?.aiTransformed" type="warning" effect="plain">AI 修改待保存</el-tag>
          <el-button v-if="state.questionAi.previousForm" link type="primary" @click="undoQuestionAiChange">撤销 AI 修改</el-button>
        </div>

        <el-form label-position="top" @submit.prevent="saveQuestionEdit">
          <div class="grid gap-x-3 sm:grid-cols-[120px_140px_1fr]">
            <el-form-item label="题型"><el-input v-model="state.questionEditForm.type" disabled /></el-form-item>
            <el-form-item label="分值"><el-input-number v-model="state.questionEditForm.score" :min="1" :max="200" controls-position="right" class="w-full" /></el-form-item>
            <el-form-item label="难度">
              <el-select v-model="state.questionEditForm.difficulty" class="w-full">
                <el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" />
              </el-select>
            </el-form-item>
          </div>

          <el-form-item label="题干" :error="state.questionEditErrors.stem">
            <el-input v-model="state.questionEditForm.stem" type="textarea" :rows="4" maxlength="10000" placeholder="请输入完整题干" />
          </el-form-item>

          <div v-if="isChoice" class="choice-editor">
            <div v-for="(letter, index) in letters" :key="letter" class="choice-row">
              <span class="choice-letter" :class="{ 'is-correct': state.questionEditForm.type === '单选' ? state.questionEditForm.answerSingle === letter : state.questionEditForm.answerMultiple.includes(letter) }">{{ letter }}</span>
              <el-form-item class="min-w-0 flex-1" :error="state.questionEditErrors['option' + letter]">
                <el-input v-model="state.questionEditForm['option' + letter]" maxlength="500" :placeholder="`请输入选项 ${letter}`" />
              </el-form-item>
              <div class="choice-order-actions">
                <el-tooltip content="上移选项"><el-button :icon="ArrowUp" circle size="small" :aria-label="`上移选项 ${letter}`" :disabled="index === 0" @click="moveQuestionOption(index, -1)" /></el-tooltip>
                <el-tooltip content="下移选项"><el-button :icon="ArrowDown" circle size="small" :aria-label="`下移选项 ${letter}`" :disabled="index === letters.length - 1" @click="moveQuestionOption(index, 1)" /></el-tooltip>
              </div>
            </div>
          </div>

          <div class="grid gap-x-3 sm:grid-cols-2">
            <el-form-item v-if="state.questionEditForm.type === '单选'" label="正确答案位置">
              <el-segmented
                :model-value="state.questionEditForm.answerSingle"
                :options="letters"
                class="w-full"
                @change="moveSingleCorrectAnswer"
              />
            </el-form-item>
            <el-form-item v-else-if="state.questionEditForm.type === '判断'" label="答案">
              <el-radio-group v-model="state.questionEditForm.answerSingle"><el-radio-button label="正确" value="正确" /><el-radio-button label="错误" value="错误" /></el-radio-group>
            </el-form-item>
            <el-form-item v-else-if="state.questionEditForm.type === '多选'" label="正确答案" :error="state.questionEditErrors.answerMultiple">
              <el-checkbox-group v-model="state.questionEditForm.answerMultiple"><el-checkbox-button v-for="letter in letters" :key="letter" :label="letter" :value="letter" /></el-checkbox-group>
            </el-form-item>
            <el-form-item v-else label="答案" :error="state.questionEditErrors.answerText"><el-input v-model="state.questionEditForm.answerText" placeholder="请输入参考答案" /></el-form-item>
            <el-form-item label="解析"><el-input v-model="state.questionEditForm.explanation" type="textarea" :rows="3" maxlength="10000" placeholder="请输入答案解析，可选" /></el-form-item>
          </div>

          <el-form-item v-if="['简答','论述'].includes(state.questionEditForm.type)" label="评分规则" :error="state.questionEditErrors.rubricText">
            <el-input v-model="state.questionEditForm.rubricText" type="textarea" :rows="5" placeholder="每行或使用逗号分隔一条评分规则" />
          </el-form-item>
        </el-form>
      </section>

      <aside class="question-ai-panel">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm font-black"><el-icon class="text-iris"><MagicStick /></el-icon>AI 编辑</div>
          <el-tag v-if="state.questionAi.loading" type="primary" effect="plain">生成中</el-tag>
        </div>

        <div class="mt-4 grid gap-2">
          <div class="question-ai-action">
            <el-button class="min-w-0 flex-1" :icon="RefreshRight" :loading="state.questionAi.loading && state.questionAi.operation === 'regenerate'" :disabled="state.questionAi.loading" @click="runQuestionAiTransform('regenerate')">按原来源重新生成</el-button>
            <el-tooltip
              content="保持题型和分值不变，按照当前题目的来源约束生成一道新题。资料题继续使用原资料引用；题库题只生成衍生题，不修改题库原题。"
              placement="top"
              popper-class="question-ai-help-popper"
            >
              <button type="button" class="question-ai-help" aria-label="查看按原来源重新生成说明"><el-icon><QuestionFilled /></el-icon></button>
            </el-tooltip>
          </div>
          <div v-if="isChoice" class="question-ai-action">
            <el-button class="min-w-0 flex-1" :icon="MagicStick" :loading="state.questionAi.loading && state.questionAi.operation === 'distractors'" :disabled="state.questionAi.loading" @click="runQuestionAiTransform('distractors')">重新生成干扰项</el-button>
            <el-tooltip
              content="仅重新生成错误选项，保留题干、正确答案内容及答案位置。仅适用于单选题和多选题。"
              placement="top"
              popper-class="question-ai-help-popper"
            >
              <button type="button" class="question-ai-help" aria-label="查看重新生成干扰项说明"><el-icon><QuestionFilled /></el-icon></button>
            </el-tooltip>
          </div>
        </div>

        <p class="mt-3 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">生成结果仅供预览，应用修改并保存题目后才会生效。</p>

        <div class="mt-4 border-t border-slate-200 pt-4 dark:border-night-border">
          <div class="mb-2 text-xs font-black">自定义 AI 修改</div>
          <el-input v-model="state.questionAi.customPrompt" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="例如：缩短题干，并让解析更容易理解" />
          <el-button class="mt-2 w-full" type="primary" plain :icon="MagicStick" :loading="state.questionAi.loading && state.questionAi.operation === 'custom'" :disabled="state.questionAi.loading" @click="runQuestionAiTransform('custom')">生成修改方案</el-button>
        </div>

        <el-alert v-if="state.questionAi.error" class="mt-4" :title="state.questionAi.error" type="error" show-icon :closable="false" />

        <div v-if="state.questionAi.candidate" class="ai-candidate mt-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong class="text-xs">AI 修改预览</strong>
            <div class="flex flex-wrap gap-1">
              <el-tag v-for="field in state.questionAi.changedFields" :key="field" size="small" effect="plain">{{ changedFieldLabel(field) }}</el-tag>
            </div>
          </div>
          <p class="mt-3 text-sm font-bold leading-6">{{ state.questionAi.candidate.stem }}</p>
          <ol v-if="state.questionAi.candidate.options?.length" class="mt-3 space-y-1 text-xs leading-5">
            <li v-for="(option, index) in state.questionAi.candidate.options" :key="index"><strong>{{ letters[index] }}.</strong> {{ option }}</li>
          </ol>
          <div class="candidate-answer mt-3"><span>答案</span><strong>{{ answerText(state.questionAi.candidate) }}</strong></div>
          <p v-if="state.questionAi.candidate.explanation" class="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300"><strong>解析：</strong>{{ state.questionAi.candidate.explanation }}</p>
          <el-alert v-for="warning in state.questionAi.warnings" :key="warning" class="mt-3" :title="warning" type="warning" :closable="false" show-icon />
          <div class="mt-4 flex justify-end gap-2">
            <el-button :icon="Close" @click="discardQuestionAiCandidate">丢弃方案</el-button>
            <el-button type="primary" :icon="Check" @click="applyQuestionAiCandidate">应用修改</el-button>
          </div>
        </div>
      </aside>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button :disabled="state.questionSaving || state.questionAi.loading" @click="requestCloseQuestionEditor">取消</el-button>
        <el-button type="primary" :icon="Check" :loading="state.questionSaving" :disabled="state.questionAi.loading" @click="saveQuestionEdit">保存题目</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.question-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.85fr);
  gap: 20px;
  max-height: calc(94vh - 170px);
  overflow: auto;
  padding-right: 2px;
}

:global(.question-editor-dialog) {
  position: relative;
  overflow: hidden;
}

:global(.question-editor-dialog__body) {
  padding-top: 20px;
}

.question-editor-busy-mask {
  position: absolute;
  z-index: 30;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
  backdrop-filter: blur(2px);
}

.question-editor-busy-content {
  display: flex;
  max-width: 360px;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}

.question-editor-busy-content strong {
  font-size: 15px;
  line-height: 1.5;
}

.question-editor-busy-content span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}

.question-editor-busy-spinner {
  color: var(--el-color-primary);
  font-size: 34px;
}

.question-ai-panel {
  min-width: 0;
  border-left: 1px solid var(--el-border-color-lighter);
  padding-left: 18px;
}

.question-ai-action {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.question-ai-help {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: help;
}

.question-ai-help:hover,
.question-ai-help:focus-visible {
  color: var(--el-color-primary);
}

.question-ai-help:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 1px;
}

:global(.question-ai-help-popper) {
  max-width: min(320px, calc(100vw - 32px));
  line-height: 1.6;
  white-space: normal;
}

.choice-editor {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.choice-row {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
}

.choice-row :deep(.el-form-item) {
  margin-bottom: 0;
}

.choice-letter {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--el-border-color);
  border-radius: 5px;
  font-size: 12px;
  font-weight: 900;
}

.choice-letter.is-correct {
  border-color: var(--el-color-success);
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}

.choice-order-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.ai-candidate {
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 6px;
  background: var(--el-color-primary-light-9);
  padding: 12px;
}

.candidate-answer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 8px;
  font-size: 12px;
}

@media (max-width: 900px) {
  .question-editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .question-ai-panel {
    border-top: 1px solid var(--el-border-color-lighter);
    border-left: 0;
    padding-top: 16px;
    padding-left: 0;
  }
}

@media (max-width: 560px) {
  :global(.question-editor-dialog__body) {
    padding-top: 16px;
  }

  .choice-row {
    flex-wrap: wrap;
  }

  .choice-row :deep(.el-form-item) {
    min-width: calc(100% - 40px);
  }

  .choice-order-actions {
    margin-left: 40px;
  }
}
</style>
