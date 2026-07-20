<script setup>
import { Collection, Edit } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  clearSelectedPaper,
  editPaper,
  addPaperQuestionsToBank,
  displayPaperStatus,
  displayQuestionOptions,
} = useSmartQ();

const detailModes = [
  { label: "紧凑", value: "compact" },
  { label: "完整", value: "full" },
];

function statusType(status) {
  return displayPaperStatus(status) === "已发布" ? "success" : "info";
}

function questionSourceLabel(question) {
  if (question?.origin?.type === "question-bank") return `题库 · ${question.origin.bankQuestionId || "已入库"}`;
  if (question?.origin?.type !== "material") return "AI 独立";
  return [...new Set((question.origin.materialRefs || []).map((item) => item.name).filter(Boolean))].join("、") || "资料题";
}
</script>

<template>
  <el-drawer
    :model-value="Boolean(state.selectedPaperId)"
    direction="rtl"
    size="min(860px, 100vw)"
    aria-label="试卷详情抽屉"
    @update:model-value="(value) => !value && clearSelectedPaper()"
  >
    <template #header>
      <div class="flex min-w-0 items-center justify-between gap-3 pr-3">
        <div class="min-w-0"><div class="text-base font-black">试卷详情</div><div class="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{{ state.selectedPaperDetail?.name || '正在加载试卷内容' }}</div></div>
        <div v-if="state.selectedPaperDetail" class="flex shrink-0 gap-2">
          <el-button :icon="Collection" :loading="state.questionBankManagement.importingPaperId === state.selectedPaperDetail.id" @click="addPaperQuestionsToBank(state.selectedPaperDetail)">整卷入库</el-button>
          <el-button v-if="state.selectedPaperDetail.status !== '已发布'" type="primary" :icon="Edit" @click="editPaper(state.selectedPaperDetail)">编辑</el-button>
        </div>
      </div>
    </template>

    <div v-loading="state.paperDetailLoading" class="min-h-[260px]">
      <template v-if="state.selectedPaperDetail">
        <div class="grid grid-cols-2 gap-3 border-b border-slate-200 pb-4 sm:grid-cols-[minmax(0,1fr)_100px_100px_100px] sm:items-center dark:border-night-border">
          <div class="col-span-2 min-w-0 sm:col-span-1"><div class="truncate text-lg font-black">{{ state.selectedPaperDetail.name }}</div><div class="mt-1 truncate text-xs font-semibold text-slate-400">{{ state.selectedPaperDetail.id }}</div></div>
          <el-statistic title="题目" :value="state.selectedPaperDetail.questionCount || 0" />
          <el-statistic title="总分" :value="state.selectedPaperDetail.score || 0" />
          <el-tag :type="statusType(state.selectedPaperDetail.status)">{{ displayPaperStatus(state.selectedPaperDetail.status) }}</el-tag>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <div class="text-sm font-black">题目内容</div>
          <el-segmented v-model="state.paperDetailMode" :options="detailModes" aria-label="题目详情模式" />
        </div>

        <div v-if="state.selectedPaperDetail.sourcePlanSnapshot" class="mt-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4 text-xs font-semibold dark:border-night-border">
          <span>题目来源：</span>
          <el-tag type="success" effect="plain">资料题 {{ state.selectedPaperDetail.sourcePlanSnapshot.materialQuestionCount || 0 }}</el-tag>
          <el-tag type="info" effect="plain">AI 独立题 {{ state.selectedPaperDetail.sourcePlanSnapshot.aiQuestionCount || 0 }}</el-tag>
          <el-tag v-for="material in state.selectedPaperDetail.sourcePlanSnapshot.materials || []" :key="`${material.id}-${material.version}`" effect="plain">{{ material.name }} · v{{ material.version }}</el-tag>
        </div>

        <div class="mt-3 divide-y divide-slate-100 dark:divide-night-border">
          <div v-for="(question, index) in state.selectedPaperDetail.questions || []" :key="question.id" class="py-4">
            <div class="grid grid-cols-[36px_minmax(0,1fr)_52px] items-start gap-3 sm:grid-cols-[40px_72px_minmax(0,1fr)_56px]">
              <div class="pt-1 text-sm font-black text-slate-400">{{ String(index + 1).padStart(2, '0') }}</div>
              <div class="hidden sm:block"><el-tag size="small" effect="plain">{{ question.type }}</el-tag></div>
              <div class="min-w-0">
                <div class="mb-2 sm:hidden"><el-tag size="small" effect="plain">{{ question.type }}</el-tag></div>
                <div class="mb-2 flex flex-wrap items-center gap-1"><el-tag :type="question.origin?.type === 'material' ? 'success' : question.origin?.type === 'question-bank' ? 'primary' : 'info'" size="small" effect="plain">{{ questionSourceLabel(question) }}</el-tag><el-tag v-if="question.origin?.edited" size="small" type="warning" effect="plain">已人工修改</el-tag><el-button link type="success" size="small" :icon="Collection" @click="addPaperQuestionsToBank(state.selectedPaperDetail, [question.id])">加入题库</el-button></div>
                <div class="text-sm font-semibold leading-6" :class="state.paperDetailMode === 'compact' ? 'line-clamp-2' : ''">{{ question.stem }}</div>
                <div v-if="state.paperDetailMode === 'full' && ['单选','多选','判断'].includes(question.type)" class="mt-3 grid gap-2 text-xs font-semibold sm:grid-cols-2">
                  <div v-for="(option, optionIndex) in displayQuestionOptions(question)" :key="optionIndex" class="rounded border border-slate-100 bg-slate-50 px-3 py-2 dark:border-night-border dark:bg-night-elevated">{{ String.fromCharCode(65 + optionIndex) }}. {{ option }}</div>
                </div>
                <div class="mt-2 whitespace-pre-line text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">答案：{{ Array.isArray(question.answer) ? question.answer.join('、') : question.answer }}</div>
                <div v-if="state.paperDetailMode === 'full' && question.origin?.materialRefs?.length" class="mt-3 border-l-2 border-emerald-300 bg-emerald-50/60 px-3 py-2 text-xs leading-5 dark:bg-night-elevated">
                  <div v-for="ref in question.origin.materialRefs" :key="`${ref.materialId}-${ref.chunkId}`"><strong>{{ ref.name }} · v{{ ref.version }}：</strong>{{ ref.excerpt }}</div>
                </div>
              </div>
              <div class="text-right text-sm font-black">{{ question.score }} 分</div>
            </div>
          </div>
          <el-empty v-if="!(state.selectedPaperDetail.questions || []).length" description="该试卷暂无题目内容" />
        </div>
      </template>
    </div>
  </el-drawer>
</template>
