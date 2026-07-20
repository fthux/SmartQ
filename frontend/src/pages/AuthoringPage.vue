<script setup>
import { DocumentChecked, MagicStick } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  paper,
  workflowSteps,
  visibleWorkflowStep,
  formLocked,
  totalQuestionCount,
  computedSpecTotalScore,
  paperTypeConfig,
  authoringQuality,
  authoringQuestions,
  authoringPendingReviewCount,
  setWorkflowStep,
  generateDraft,
  regenerate,
  discardDraft,
  saveDraft,
  qualityCheck,
  repairQuality,
  openQuestionEditor,
  reviewQuestion,
  savePaper,
  publishPaper,
  displayPaperStatus,
  workflowStatusText,
} = useSmartQ();

function workflowButtonType(step) {
  if (step.status === "done") return "success";
  if (step.status === "active") return "primary";
  return "";
}

function workflowTagType(step) {
  if (step.status === "done") return "success";
  if (step.status === "active") return "primary";
  return "info";
}

function questionTagType(type) {
  return { 单选: "primary", 多选: "success", 判断: "warning", 填空: "info", 简答: "danger", 论述: "danger" }[type] || "info";
}
</script>

<template>
  <section class="mt-4 space-y-4">
    <el-card shadow="never">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div class="text-sm font-bold text-ocean">{{ state.dashboard.exam.title }}</div>
          <h1 class="mt-2 text-2xl font-black">出题页面</h1>
          <div class="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">完成命题配置、质量复检、人工审核、保存试卷和发布</div>
          <el-tag v-if="state.authoringPaperId" class="mt-2" type="primary">正在编辑试卷：{{ paper.name || state.authoringPaperId }}</el-tag>
          <el-tag v-else class="mt-2" type="success">新建试卷</el-tag>
        </div>
        <el-tag type="primary" effect="plain" size="large">当前：{{ workflowSteps.find((item) => item.key === state.activeWorkflowStep)?.title || '命题配置' }}</el-tag>
      </div>

      <div class="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <el-button
          v-for="(step, index) in workflowSteps"
          :key="step.key"
          class="workflow-button"
          :class="{ 'is-current': state.activeWorkflowStep === step.key }"
          :type="workflowButtonType(step)"
          :plain="step.status !== 'active'"
          :disabled="!step.clickable"
          @click="setWorkflowStep(step.key)"
        >
          <span class="workflow-content">
            <span class="flex items-center justify-between">
              <span class="workflow-index">{{ step.status === 'done' ? '✓' : index + 1 }}</span>
              <el-tag size="small" :type="workflowTagType(step)" effect="plain">{{ workflowStatusText(step.status) }}</el-tag>
            </span>
            <strong class="mt-3 block text-sm">{{ step.title }}</strong>
            <span class="mt-1 block min-h-8 whitespace-normal text-xs leading-4 opacity-75">{{ step.meta }}</span>
            <span class="mt-2 block text-xs font-black">{{ step.action }}</span>
          </span>
        </el-button>
      </div>
    </el-card>

    <el-card v-if="visibleWorkflowStep === 'config'" shadow="never" class="authoring-card">
      <el-form label-position="top" @submit.prevent="generateDraft">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="flex items-center gap-2 text-sm font-black text-ocean"><el-icon><MagicStick /></el-icon>AI 命题任务</div>
            <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{{ formLocked ? '试卷已生成，命题参数已锁定；如需修改，请点击重新生成' : state.regeneratingDraft ? '正在重新生成模式，可调整参数并生成新的试卷' : '出题者填写命题参数后生成试卷' }}</div>
          </div>
          <div class="flex gap-2">
            <el-button v-if="formLocked && !state.generating" @click="regenerate">重新生成</el-button>
            <el-button v-else type="primary" native-type="submit" :loading="state.generating">生成试卷</el-button>
          </div>
        </div>

        <div v-if="state.generating || state.generationStage" class="mt-4 rounded-md border border-slate-200 p-4 dark:border-night-border">
          <div class="mb-3 flex items-center justify-between text-sm font-bold">
            <span>{{ state.generationStage || '等待生成' }}</span>
            <span :class="state.generationError ? 'text-coral' : 'text-ocean'">{{ state.generationProgress }}%</span>
          </div>
          <el-progress :percentage="state.generationProgress" :status="state.generationError ? 'exception' : state.generationProgress === 100 ? 'success' : undefined" :stroke-width="10" />
          <el-alert v-if="state.generationError" class="mt-3" :title="state.generationError" type="error" :closable="false" show-icon />
        </div>

        <div class="mt-5 rounded-md border border-slate-200 p-4 dark:border-night-border">
          <div class="mb-4 text-sm font-black">出题条件</div>
          <div class="grid gap-x-4 md:grid-cols-2 xl:grid-cols-[1fr_1.1fr_160px]">
            <el-form-item label="考卷名称" :error="state.specFormErrors.paperName">
              <el-input v-model="state.spec.paperName" :disabled="formLocked" placeholder="请输入考卷名称" />
            </el-form-item>
            <el-form-item label="出题方向" :error="state.specFormErrors.direction">
              <el-input v-model="state.spec.direction" :disabled="formLocked" placeholder="请输入出题方向" />
            </el-form-item>
            <el-form-item label="难度">
              <el-select v-model="state.spec.difficulty" :disabled="formLocked" class="w-full">
                <el-option v-for="value in ['中', '易', '难', '混合']" :key="value" :label="value" :value="value" />
              </el-select>
            </el-form-item>
          </div>
          <div class="grid gap-x-4 md:grid-cols-2">
            <el-form-item label="知识点范围">
              <el-input v-model="state.spec.knowledge" :disabled="formLocked" type="textarea" :rows="2" placeholder="请输入知识点范围，用逗号分隔" />
            </el-form-item>
            <el-form-item label="补充要求">
              <el-input v-model="state.spec.requirements" :disabled="formLocked" type="textarea" :rows="2" placeholder="请输入补充要求" />
            </el-form-item>
          </div>
        </div>

        <div class="mt-4 rounded-md border border-slate-200 p-4 dark:border-night-border">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="text-sm font-black">题量与分值</div>
              <div v-if="state.specFormErrors.questionCount" class="mt-1 text-xs font-bold text-coral">{{ state.specFormErrors.questionCount }}</div>
            </div>
            <div class="flex gap-2 text-right">
              <el-statistic title="题目数量" :value="totalQuestionCount" suffix="题" />
              <el-divider direction="vertical" class="h-12" />
              <el-statistic title="试卷总分" :value="computedSpecTotalScore" suffix="分" />
            </div>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <div v-for="item in paperTypeConfig" :key="item.type" class="rounded-md bg-slate-50 p-3 dark:bg-night-elevated">
              <div class="mb-3 text-xs font-black">{{ item.type }}题</div>
              <el-form-item label="数量">
                <el-input-number v-model="state.spec[item.countKey]" :disabled="formLocked" :min="0" :max="50" controls-position="right" class="w-full" />
              </el-form-item>
              <el-form-item label="每题分" :error="state.specFormErrors[item.scoreKey]">
                <el-input-number v-model="state.spec[item.scoreKey]" :disabled="formLocked" :min="1" :max="200" controls-position="right" class="w-full" />
              </el-form-item>
            </div>
          </div>
        </div>

        <div v-if="state.generatedDraft?.questions?.length" class="mt-4 rounded-md border border-slate-200 p-4 dark:border-night-border">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div class="text-sm font-black">生成试卷预览</div>
              <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{{ state.generatedDraft.spec?.paperName }} · {{ state.generatedDraft.questions.length }} 题 · {{ state.generatedDraft.spec?.totalScore }} 分</div>
            </div>
            <div class="flex gap-2">
              <el-button :disabled="state.saving" @click="discardDraft">丢弃</el-button>
              <el-button type="primary" :loading="state.saving" @click="saveDraft">进入质量复检</el-button>
            </div>
          </div>
          <el-table :data="state.generatedDraft.questions.slice(0, 12)" class="mt-3" max-height="280" size="small">
            <el-table-column type="index" label="#" width="55" />
            <el-table-column label="题型" width="90"><template #default="{ row }"><el-tag :type="questionTagType(row.type)" size="small">{{ row.type }}</el-tag></template></el-table-column>
            <el-table-column prop="stem" label="题干" min-width="280" show-overflow-tooltip />
            <el-table-column label="分值" width="80" align="right"><template #default="{ row }">{{ row.score }} 分</template></el-table-column>
          </el-table>
        </div>
      </el-form>
    </el-card>

    <el-card v-if="visibleWorkflowStep === 'quality'" shadow="never">
      <div class="flex items-center justify-between gap-3">
        <div><h2 class="text-lg font-black">AI 质量控制</h2><div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">结构校验、答案一致性、重复题和人工确认</div></div>
        <el-tag type="success" size="large">稳定性 {{ authoringQuality.stabilityScore || 0 }}</el-tag>
      </div>
      <el-alert v-if="authoringQuestions.length && !(authoringQuality.failures || []).length" class="mt-4" title="质量复检通过，系统将进入人工审核。" type="success" :closable="false" show-icon />
      <div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <el-card shadow="never"><el-statistic title="Schema 通过率" :value="authoringQuality.schemaPassRate || 0" suffix="%" /></el-card>
        <el-card shadow="never"><el-statistic title="答案一致性" :value="authoringQuality.answerConsistency || 0" suffix="%" /></el-card>
        <el-card shadow="never"><el-statistic title="重复题过滤" :value="authoringQuality.duplicateFiltered || 0" /></el-card>
        <el-card shadow="never"><el-statistic title="人工待确认" :value="authoringQuality.pendingReview || 0" /></el-card>
      </div>
      <div class="mt-5 flex gap-2"><el-button @click="qualityCheck">质量复检</el-button><el-button type="primary" @click="repairQuality">自动修复</el-button></div>
    </el-card>

    <el-card v-if="visibleWorkflowStep === 'review'" shadow="never">
      <div class="mb-4"><h2 class="text-lg font-black">题目列表</h2><div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{{ authoringQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0) }} 分 · {{ authoringQuestions.length }} 题</div></div>
      <el-table :data="authoringQuestions" class="w-full" empty-text="暂无题目">
        <el-table-column type="index" label="序号" width="70" />
        <el-table-column label="题型" width="100"><template #default="{ row }"><el-tag :type="questionTagType(row.type)" size="small">{{ row.type }}</el-tag></template></el-table-column>
        <el-table-column prop="stem" label="题干" min-width="300" show-overflow-tooltip />
        <el-table-column prop="difficulty" label="难度" width="80" />
        <el-table-column prop="score" label="分值" width="80" />
        <el-table-column prop="quality" label="质量" width="90" />
        <el-table-column label="操作" fixed="right" width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="openQuestionEditor(row)">编辑</el-button>
            <el-button link :type="row.status === '已校验' ? 'warning' : 'success'" @click="reviewQuestion(row, row.status !== '已校验')">{{ row.status === '已校验' ? '取消审核' : '审核' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="visibleWorkflowStep === 'save' || visibleWorkflowStep === 'publish'" shadow="never">
      <div class="flex items-center justify-between"><h2 class="text-lg font-black">试卷结构 · {{ displayPaperStatus(paper.status) }}</h2><el-icon class="text-xl text-iris"><DocumentChecked /></el-icon></div>
      <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <el-card shadow="never"><el-statistic title="试卷总分" :value="paper.score || authoringQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0)" /></el-card>
        <el-card shadow="never"><el-statistic title="已选题目" :value="paper.questionCount || authoringQuestions.length" /></el-card>
        <el-card shadow="never"><el-statistic title="待审核" :value="authoringPendingReviewCount" /></el-card>
      </div>
      <div class="mt-5 flex gap-2"><el-button @click="savePaper">保存试卷</el-button><el-button type="primary" @click="publishPaper">发布试卷</el-button></div>
    </el-card>
  </section>
</template>

<style scoped>
.workflow-button {
  width: 100%;
  min-height: 132px;
  height: auto;
  padding: 12px;
  align-items: stretch;
  justify-content: flex-start;
}

.workflow-button.is-current {
  box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
}

.workflow-content {
  display: block;
  width: 100%;
  text-align: left;
}

.workflow-index {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--el-fill-color-light);
  font-size: 12px;
  font-weight: 900;
}

.authoring-card :deep(.el-statistic__head) {
  font-size: 12px;
  font-weight: 700;
}

.authoring-card :deep(.el-statistic__number) {
  font-size: 20px;
  font-weight: 900;
}
</style>
