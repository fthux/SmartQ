<script setup>
import { ArrowLeft, Printer } from "@element-plus/icons-vue";
import { computed, nextTick, onMounted, reactive } from "vue";
import { request } from "../core/api-client.js";
import { displayQuestionOptions, formatDateTimeWithYear } from "../core/presentation.js";
import { parseHashRoute } from "../core/router.js";

const params = parseHashRoute().params;
const settings = {
  paperId: params.get("paperId") || "",
  publishedAt: params.get("publishedAt") || "",
  mode: ["paper", "answers", "combined"].includes(params.get("mode")) ? params.get("mode") : "paper",
  showScores: params.get("showScores") !== "0",
  reserveSpace: params.get("reserveSpace") !== "0",
};
const state = reactive({ loading: true, error: "", paper: null });
const showQuestionPaper = computed(() => ["paper", "combined"].includes(settings.mode));
const showAnswerPaper = computed(() => ["answers", "combined"].includes(settings.mode));
const modeLabel = computed(() => ({ paper: "试题卷", answers: "答案解析", combined: "试题及答案" }[settings.mode]));

function formatAnswer(question = {}) {
  if (Array.isArray(question.answer)) return question.answer.join("、") || "未填写";
  return String(question.answer || "未填写");
}

function optionLabel(index) {
  return String.fromCharCode(65 + index);
}

function answerSpaceClass(question = {}) {
  if (question.type === "论述") return "answer-space--essay";
  if (question.type === "简答") return "answer-space--short";
  return "answer-space--fill";
}

function isObjective(question = {}) {
  return ["单选", "多选", "判断"].includes(question.type);
}

async function printNow() {
  await nextTick();
  if (document.fonts?.ready) await document.fonts.ready;
  window.print();
}

function leavePrintPage() {
  window.close();
  setTimeout(() => {
    const target = new URL(location.href);
    target.hash = "";
    location.href = target.toString();
  }, 120);
}

onMounted(async () => {
  if (!settings.paperId) {
    state.error = "缺少试卷编号，无法打开打印页面";
    state.loading = false;
    return;
  }
  try {
    const query = settings.publishedAt ? `?publishedAt=${encodeURIComponent(settings.publishedAt)}` : "";
    const payload = await request(`/api/papers/${encodeURIComponent(settings.paperId)}/print${query}`);
    state.paper = payload.selectedVersion;
    document.title = `${state.paper.name} - ${modeLabel.value} - SmartQ`;
  } catch (error) {
    state.error = error.message || "打印数据加载失败";
  } finally {
    state.loading = false;
  }
});
</script>

<template>
  <div class="print-root">
    <header class="print-toolbar">
      <el-button :icon="ArrowLeft" @click="leavePrintPage">返回试卷管理</el-button>
      <div class="toolbar-title">
        <div>{{ state.paper?.name || '打印试卷' }}</div>
        <span>{{ modeLabel }}</span>
      </div>
      <el-button type="primary" :icon="Printer" :disabled="state.loading || !state.paper" @click="printNow">打印</el-button>
    </header>

    <section v-if="state.loading" class="print-state">正在加载发布版本...</section>
    <section v-else-if="state.error" class="print-state print-state--error">
      <div>{{ state.error }}</div>
      <el-button class="mt-4" :icon="ArrowLeft" @click="leavePrintPage">返回试卷管理</el-button>
    </section>

    <article v-else-if="state.paper" class="paper-sheet">
      <section v-if="showQuestionPaper" class="question-sheet">
        <header class="paper-header">
          <h1>{{ state.paper.name }}</h1>
          <div class="paper-meta">
            <span>满分：{{ state.paper.score }} 分</span>
            <span>题数：{{ state.paper.questionCount }} 题</span>
            <span>发布时间：{{ formatDateTimeWithYear(state.paper.publishedAt) }}</span>
          </div>
        </header>

        <div class="question-list">
          <article
            v-for="(question, index) in state.paper.questions"
            :key="question.id || index"
            class="question"
            :class="{ 'question--objective': isObjective(question) }"
          >
            <div class="question-heading">
              <span class="question-number">{{ index + 1 }}.</span>
              <div class="question-stem">
                <span>{{ question.stem }}</span>
                <span v-if="settings.showScores" class="question-score">（{{ question.score }} 分）</span>
              </div>
            </div>

            <div v-if="isObjective(question)" class="option-list">
              <div v-for="(option, optionIndex) in displayQuestionOptions(question)" :key="optionIndex" class="option-row">
                <span>{{ optionLabel(optionIndex) }}.</span>
                <span>{{ option }}</span>
              </div>
            </div>

            <div
              v-if="settings.reserveSpace && !isObjective(question)"
              class="answer-space"
              :class="answerSpaceClass(question)"
              aria-hidden="true"
            />
          </article>
        </div>
      </section>

      <section v-if="showAnswerPaper" class="answer-sheet" :class="{ 'answer-sheet--separate': showQuestionPaper }">
        <header class="paper-header paper-header--answers">
          <h1>{{ state.paper.name }} · 答案解析</h1>
          <div class="paper-meta">
            <span>满分：{{ state.paper.score }} 分</span>
            <span>发布时间：{{ formatDateTimeWithYear(state.paper.publishedAt) }}</span>
          </div>
        </header>

        <div class="answer-list">
          <article v-for="(question, index) in state.paper.questions" :key="`answer-${question.id || index}`" class="answer-item">
            <div class="question-heading">
              <span class="question-number">{{ index + 1 }}.</span>
              <div class="question-stem">
                <span>{{ question.stem }}</span>
                <span v-if="settings.showScores" class="question-score">（{{ question.score }} 分）</span>
              </div>
            </div>
            <div class="answer-content"><strong>答案：</strong>{{ formatAnswer(question) }}</div>
            <div v-if="question.explanation" class="answer-content"><strong>解析：</strong>{{ question.explanation }}</div>
            <div v-if="question.rubric?.length" class="answer-content">
              <strong>评分规则：</strong>
              <ol>
                <li v-for="(rule, ruleIndex) in question.rubric" :key="ruleIndex">{{ rule }}</li>
              </ol>
            </div>
          </article>
        </div>
      </section>
    </article>
  </div>
</template>

<style scoped>
@page {
  size: A4 portrait;
  margin: 14mm 16mm;
}

.print-root,
.print-root * {
  box-sizing: border-box;
}

.print-root {
  min-height: 100vh;
  padding: 72px 16px 32px;
  overflow-x: hidden;
  background: #eef2f1;
  color: #111827;
}

.print-toolbar {
  position: fixed;
  z-index: 10;
  top: 0;
  right: 0;
  left: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-width: 0;
  min-height: 56px;
  padding: 8px 16px;
  border-bottom: 1px solid #dbe3e0;
  background: rgba(255, 255, 255, 0.96);
}

.toolbar-title {
  min-width: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 800;
}

.toolbar-title div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-title span {
  color: #64748b;
  font-size: 11px;
}

.print-state,
.paper-sheet {
  width: 100%;
  max-width: 210mm;
  min-width: 0;
  margin: 0 auto;
  background: #fff;
}

.print-state {
  min-height: 240px;
  padding: 48px 24px;
  text-align: center;
  font-weight: 700;
}

.print-state--error {
  color: #b42318;
}

.paper-sheet {
  padding: 14mm 16mm;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
}

.paper-header {
  padding-bottom: 8mm;
  border-bottom: 1px solid #111827;
  text-align: center;
}

.paper-header h1 {
  max-width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
  font-family: "Songti SC", SimSun, serif;
  font-size: 22px;
  line-height: 1.4;
}

.paper-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4mm 10mm;
  margin-top: 4mm;
  font-size: 12px;
}

.question-list,
.answer-list {
  margin-top: 6mm;
}

.question,
.answer-item {
  max-width: 100%;
  padding: 4mm 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.question--objective,
.answer-item {
  break-inside: avoid-page;
}

.question-heading {
  display: grid;
  grid-template-columns: 7mm minmax(0, 1fr);
  align-items: start;
  break-inside: avoid;
  font-family: "Songti SC", SimSun, serif;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.8;
}

.question-number {
  font-variant-numeric: tabular-nums;
}

.question-stem {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.question-score {
  white-space: nowrap;
}

.option-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2mm;
  margin: 3mm 0 0 7mm;
  font-family: "Songti SC", SimSun, serif;
  font-size: 13px;
  line-height: 1.65;
}

.option-row {
  display: grid;
  grid-template-columns: 6mm minmax(0, 1fr);
  min-width: 0;
  break-inside: avoid;
  overflow-wrap: anywhere;
}

.answer-space {
  max-width: calc(100% - 7mm);
  margin: 3mm 0 0 7mm;
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 8mm, #cbd5e1 8mm, #cbd5e1 calc(8mm + 1px));
}

.answer-space--fill {
  min-height: 18mm;
}

.answer-space--short {
  min-height: 42mm;
}

.answer-space--essay {
  min-height: 72mm;
}

.answer-sheet--separate {
  page-break-before: always;
  break-before: page;
}

.paper-header--answers {
  padding-bottom: 5mm;
}

.answer-item + .answer-item {
  border-top: 1px solid #d1d5db;
}

.answer-content {
  max-width: calc(100% - 7mm);
  margin: 2mm 0 0 7mm;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: "Songti SC", SimSun, serif;
  font-size: 12px;
  line-height: 1.7;
}

.answer-content ol {
  margin: 1mm 0 0;
  padding-left: 6mm;
}

@media (max-width: 640px) {
  .print-root {
    padding-right: 0;
    padding-left: 0;
  }

  .print-toolbar {
    gap: 8px;
    padding: 8px;
  }

  .toolbar-title {
    text-align: left;
  }

  .paper-sheet {
    padding: 10mm 7mm;
    box-shadow: none;
  }

}

@media print {
  :global(html),
  :global(body),
  :global(#app),
  :global(#app > main) {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    background: #fff !important;
    color: #000 !important;
  }

  .print-root {
    width: auto;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: visible;
    background: #fff;
  }

  .print-toolbar {
    display: none !important;
  }

  .paper-sheet {
    width: 100%;
    max-width: none;
    min-width: 0;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }

  .answer-sheet--separate {
    page-break-before: always;
    break-before: page;
  }

  .question,
  .question-stem,
  .option-row,
  .answer-content {
    max-width: 100%;
    overflow: visible;
  }
}
</style>
