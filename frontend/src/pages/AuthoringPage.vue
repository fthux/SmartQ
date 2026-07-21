<script setup>
import { computed, ref, watch } from "vue";
import {
  Check,
  Collection,
  Delete,
  DocumentChecked,
  Edit,
  FolderOpened,
  MagicStick,
  Promotion,
  RefreshRight,
  Search,
} from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  paper,
  workflowSteps,
  visibleWorkflowStep,
  formLocked,
  totalQuestionCount,
  computedSpecTotalScore,
  selectedSourceMaterials,
  selectedQuestionBankCategories,
  questionBankQuestionCount,
  materialQuestionCount,
  aiQuestionCount,
  paperTypeConfig,
  authoringQuestions,
  setWorkflowStep,
  generateDraft,
  regenerate,
  discardDraft,
  saveDraft,
  openQuestionEditor,
  openQuestionBankPicker,
  clearQuestionBankPlan,
  addCurrentQuestionsToBank,
  saveCurrentPaper,
  publishPaper,
  openMaterialSelector,
  removeSelectedMaterial,
  manageMaterialsFromAuthoring,
  toggleMaterialSelection,
  displayPaperStatus,
  workflowStatusText,
} = useSmartQ();

const editSearch = ref("");
const editType = ref("all");
const selectedQuestionId = ref("");
const materialSearch = ref("");
const categoryLeafOptions = computed(() => state.questionBankManagement.categories.filter((item) => item.status === "active" && item.isLeaf));
const selectedQuestionBankCategoryPaths = computed(() => selectedQuestionBankCategories.value.map((category) => category.path?.map((item) => item.name).join(" / ") || category.name));

const currentStep = computed(() => workflowSteps.value.find((item) => item.key === state.activeWorkflowStep) || workflowSteps.value[0]);
const activeQuestions = computed(() => state.generatedDraft?.questions?.length ? state.generatedDraft.questions : authoringQuestions.value);
const activePaper = computed(() => state.authoringPaperId ? paper.value : {});
const activeSpec = computed(() => state.generatedDraft?.spec
  || ((state.authoringPaperId || state.authoringNewDraftActive) ? state.dashboard?.generationTask : null)
  || state.spec);
const activeSourcePlan = computed(() => activeSpec.value?.sourcePlan || {
  questionBankIds: state.spec.questionBankIds,
  questionBankCount: questionBankQuestionCount.value,
  questionBankRequestedCount: state.spec.questionBankRequestedCount,
  questionBankCategoryIds: state.spec.questionBankCategoryIds,
  materialIds: state.spec.materialIds,
  materialQuestionCount: materialQuestionCount.value,
  aiQuestionCount: aiQuestionCount.value,
  materials: selectedSourceMaterials.value,
});
const activeSourceMaterials = computed(() => activeSourcePlan.value?.materials?.length
  ? activeSourcePlan.value.materials
  : selectedSourceMaterials.value);
const filteredMaterialOptions = computed(() => {
  const keyword = materialSearch.value.trim().toLowerCase();
  return state.materialManagement.options.filter((item) => !keyword || [item.name, item.description, item.filename, ...(item.tags || [])].join(" ").toLowerCase().includes(keyword));
});
const overviewQuestionCount = computed(() => activeQuestions.value.length || totalQuestionCount.value);
const overviewTotalScore = computed(() => {
  if (activeQuestions.value.length) return activeQuestions.value.reduce((sum, item) => sum + Number(item.score || 0), 0);
  return computedSpecTotalScore.value;
});
const overviewQuestionSources = computed(() => ({
  bank: activeQuestions.value.filter((item) => item.origin?.type === "question-bank").length,
  material: activeQuestions.value.filter((item) => item.origin?.type === "material").length,
  ai: activeQuestions.value.filter((item) => !["question-bank", "material"].includes(item.origin?.type)).length,
}));
const sourceAllocationError = computed(() => questionBankQuestionCount.value > 0 && !state.spec.questionBankCategoryIds.length && !state.spec.questionBankIds.length
  ? "请为题库题选择至少一个分类"
  : "");
const overviewPaperName = computed(() => activePaper.value.name || activeSpec.value?.paperName || state.spec.paperName || "未命名试卷");
const overviewKnowledge = computed(() => {
  const value = activeSpec.value?.knowledge;
  if (Array.isArray(value)) return value.join("、");
  return String(value || state.spec.knowledge || "未设置");
});
const typeMatrixRows = computed(() => paperTypeConfig.map((item) => {
  const count = Number(state.spec[item.countKey] || 0);
  const score = Number(state.spec[item.scoreKey] || 0);
  return { ...item, count, score, subtotal: count * score };
}));
const typeDistribution = computed(() => paperTypeConfig.map((item) => {
  const actualCount = activeQuestions.value.filter((question) => question.type === item.type).length;
  const configuredCount = Number(state.spec[item.countKey] || 0);
  return { ...item, count: activeQuestions.value.length ? actualCount : configuredCount };
}).filter((item) => item.count > 0));
const filteredEditQuestions = computed(() => {
  const search = editSearch.value.trim().toLowerCase();
  return authoringQuestions.value.filter((question) => {
    const matchesType = editType.value === "all" || question.type === editType.value;
    const knowledge = Array.isArray(question.knowledge) ? question.knowledge.join(" ") : String(question.knowledge || "");
    const matchesSearch = !search || `${question.id || ""} ${question.stem || ""} ${knowledge}`.toLowerCase().includes(search);
    return matchesType && matchesSearch;
  });
});
const selectedQuestion = computed(() => activeQuestions.value.find((item) => item.id === selectedQuestionId.value) || activeQuestions.value[0] || null);

watch(activeQuestions, (questions) => {
  if (!questions.length) {
    selectedQuestionId.value = "";
    return;
  }
  if (!questions.some((item) => item.id === selectedQuestionId.value)) {
    selectedQuestionId.value = questions[0].id;
  }
}, { immediate: true });

function workflowButtonType(step) {
  if (step.status === "done") return "success";
  if (step.status === "active") return "primary";
  return "";
}

function clearEditFilters() {
  editSearch.value = "";
  editType.value = "all";
}

function workflowTagType(step) {
  if (step.status === "done") return "success";
  if (step.status === "active") return "primary";
  return "info";
}

function questionTagType(type) {
  return { 单选: "primary", 多选: "success", 判断: "warning", 填空: "info", 简答: "danger", 论述: "danger" }[type] || "info";
}

function publishIssueFieldLabel(field) {
  return { type: "题型", stem: "题干", answer: "答案", score: "分值", difficulty: "难度", options: "选项", rubric: "评分规则" }[field] || field;
}

function formatAnswer(question) {
  if (!question) return "";
  return Array.isArray(question.answer) ? question.answer.join("、") : String(question.answer ?? "");
}

function questionKnowledge(question) {
  return Array.isArray(question?.knowledge) ? question.knowledge.join("、") : String(question?.knowledge || "未设置");
}

function questionSourceLabel(question) {
  if (question?.origin?.type === "question-bank") return `题库 · ${question.origin.bankQuestionId || "已入库"} · v${question.origin.bankVersion || 1}`;
  if (question?.origin?.type !== "material") return "AI 生成";
  const names = [...new Set((question.origin.materialRefs || []).map((item) => item.name).filter(Boolean))];
  return names.join("、") || "资料题";
}

function sourcePlanLabel(plan = {}) {
  const sources = [];
  if (Number(plan.questionBankCount || plan.questionBankIds?.length || 0) > 0) sources.push("题库题");
  if (Number(plan.materialQuestionCount || 0) > 0) sources.push("资料题");
  if (Number(plan.aiQuestionCount ?? 0) > 0 || !sources.length) sources.push("AI 生成题");
  return sources.join(" + ");
}

function selectQuestion(question) {
  selectedQuestionId.value = question?.id || "";
}

function editRowClass({ row }) {
  return row.id === selectedQuestionId.value ? "is-selected-question" : "";
}

function editPublishIssue(issue) {
  const question = authoringQuestions.value.find((item) => item.id === issue.questionId) || authoringQuestions.value[issue.index];
  if (question) {
    selectedQuestionId.value = question.id;
    openQuestionEditor(question);
  }
}
</script>

<template>
  <section class="authoring-page" data-authoring-workbench>
    <header class="authoring-header">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-xs font-bold text-ocean">
            <span>智能命题工作台</span>
            <el-tag v-if="state.authoringPaperId" type="primary" size="small">编辑试卷</el-tag>
            <el-tag v-else type="success" size="small">新建试卷</el-tag>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-3">
            <h1 class="text-xl font-black">{{ overviewPaperName }}</h1>
            <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ overviewQuestionCount }} 题 · {{ overviewTotalScore }} 分</span>
          </div>
        </div>
        <el-tag type="primary" effect="plain">当前：{{ currentStep?.title || '命题配置' }}</el-tag>
      </div>

      <div class="workflow-grid mt-3">
        <el-button
          v-for="(step, index) in workflowSteps"
          :key="step.key"
          class="workflow-button"
          :class="{ 'is-current': state.activeWorkflowStep === step.key }"
          :aria-current="state.activeWorkflowStep === step.key ? 'step' : undefined"
          :type="workflowButtonType(step)"
          :plain="step.status !== 'active'"
          :disabled="!step.clickable"
          @click="setWorkflowStep(step.key)"
        >
          <span class="workflow-content">
            <span class="workflow-index">{{ step.status === 'done' ? '✓' : index + 1 }}</span>
            <span class="min-w-0 flex-1">
              <strong class="block truncate text-xs">{{ step.title }}</strong>
              <span class="mt-0.5 block truncate text-[11px] opacity-70">{{ step.meta }}</span>
            </span>
            <el-tag size="small" :type="workflowTagType(step)" effect="plain">{{ workflowStatusText(step.status) }}</el-tag>
          </span>
        </el-button>
      </div>
    </header>

    <div class="authoring-workbench-grid">
      <main class="min-w-0">
        <el-form v-if="visibleWorkflowStep === 'config'" label-position="top" @submit.prevent="generateDraft">
          <section class="workbench-section">
            <div class="section-heading">
              <div>
                <div class="flex items-center gap-2 text-sm font-black"><el-icon class="text-ocean"><MagicStick /></el-icon>命题配置</div>
                <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {{ formLocked ? '当前参数已锁定' : state.regeneratingDraft ? '重新生成模式' : '待生成' }}
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <el-tag :type="formLocked ? 'info' : 'success'" effect="plain">难度：{{ state.spec.difficulty || '中' }}</el-tag>
              </div>
            </div>

            <div v-if="state.generating || state.generationStage" class="generation-progress">
              <div class="mb-2 flex items-center justify-between text-xs font-bold">
                <span>{{ state.generationStage || '等待生成' }}</span>
                <span :class="state.generationError ? 'text-coral' : 'text-ocean'">{{ state.generationProgress }}%</span>
              </div>
              <el-progress :percentage="state.generationProgress" :status="state.generationError ? 'exception' : state.generationProgress === 100 ? 'success' : undefined" :stroke-width="8" />
              <el-alert v-if="state.generationError" class="mt-2" :title="state.generationError" type="error" :closable="false" show-icon />
            </div>

            <div class="mt-4 grid gap-x-4 md:grid-cols-2 xl:grid-cols-[1fr_1.2fr_140px]">
              <el-form-item label="试卷名称" :error="state.specFormErrors.paperName">
                <el-input v-model="state.spec.paperName" :disabled="formLocked" maxlength="80" show-word-limit placeholder="请输入试卷名称" />
              </el-form-item>
              <el-form-item label="出题方向" :error="state.specFormErrors.direction">
                <el-input v-model="state.spec.direction" :disabled="formLocked" maxlength="120" show-word-limit placeholder="例如：JavaScript 工程实践" />
              </el-form-item>
              <el-form-item label="难度">
                <el-select v-model="state.spec.difficulty" :disabled="formLocked" class="w-full">
                  <el-option v-for="value in ['易', '中', '难', '混合']" :key="value" :label="value" :value="value" />
                </el-select>
              </el-form-item>
            </div>
            <div class="grid gap-x-4 md:grid-cols-2">
              <el-form-item label="知识点范围">
                <el-input v-model="state.spec.knowledge" :disabled="formLocked" type="textarea" :rows="1" resize="none" maxlength="500" show-word-limit placeholder="多个知识点使用逗号分隔" />
              </el-form-item>
              <el-form-item label="补充要求">
                <el-input v-model="state.spec.requirements" :disabled="formLocked" type="textarea" :rows="1" resize="none" maxlength="1000" show-word-limit placeholder="输入命题约束或内容要求，可选" />
              </el-form-item>
            </div>
          </section>

          <section class="workbench-section mt-3" data-question-type-matrix>
            <div class="section-heading">
              <div>
                <div class="text-sm font-black">题量与分值矩阵</div>
                <div v-if="state.specFormErrors.questionCount" class="mt-1 text-xs font-bold text-coral">{{ state.specFormErrors.questionCount }}</div>
              </div>
              <div class="flex items-center gap-4 text-right">
                <div><div class="text-[11px] font-bold text-slate-400">题目数量</div><div class="text-lg font-black">{{ totalQuestionCount }}<span class="ml-1 text-xs">题</span></div></div>
                <div><div class="text-[11px] font-bold text-slate-400">试卷总分</div><div class="text-lg font-black text-ocean">{{ computedSpecTotalScore }}<span class="ml-1 text-xs">分</span></div></div>
              </div>
            </div>

            <el-table :data="typeMatrixRows" size="small" class="type-matrix-table mt-3" table-layout="fixed">
              <el-table-column label="题型" min-width="90">
                <template #default="{ row }"><el-tag :type="questionTagType(row.type)" size="small">{{ row.type }}</el-tag></template>
              </el-table-column>
              <el-table-column label="数量" min-width="140">
                <template #default="{ row }"><el-input-number v-model="state.spec[row.countKey]" :disabled="formLocked" :min="0" :max="50" size="small" controls-position="right" class="matrix-number" /></template>
              </el-table-column>
              <el-table-column label="每题分" min-width="140">
                <template #default="{ row }">
                  <el-input-number v-model="state.spec[row.scoreKey]" :disabled="formLocked" :min="1" :max="200" size="small" controls-position="right" class="matrix-number" />
                  <div v-if="state.specFormErrors[row.scoreKey]" class="mt-1 text-[11px] font-bold text-coral">{{ state.specFormErrors[row.scoreKey] }}</div>
                </template>
              </el-table-column>
              <el-table-column label="小计" width="100" align="right">
                <template #default="{ row }"><strong>{{ row.subtotal }} 分</strong></template>
              </el-table-column>
            </el-table>
          </section>

          <section class="workbench-section mt-3" data-question-source-plan>
            <div class="section-heading">
              <div>
                <div class="flex items-center gap-2 text-sm font-black"><el-icon class="text-leaf"><FolderOpened /></el-icon>题目来源</div>
                <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">选择题库题和资料题，其余题目由 AI 自动补足</div>
              </div>
              <el-tag :type="sourceAllocationError ? 'danger' : 'success'" effect="plain">
                {{ totalQuestionCount }} = {{ questionBankQuestionCount }} + {{ materialQuestionCount }} + {{ aiQuestionCount }}
              </el-tag>
            </div>

            <div class="source-allocation-list mt-4">
              <div class="source-allocation-row">
                <div class="source-allocation-name">
                  <el-icon class="text-ocean"><Collection /></el-icon>
                  <div><strong>题库题</strong><span>按分类和数量自动抽取，题型不足由 AI 补齐</span></div>
                </div>
                <div class="source-allocation-content">
                  <div v-if="selectedQuestionBankCategoryPaths.length" class="flex flex-wrap gap-2">
                    <el-tag v-for="path in selectedQuestionBankCategoryPaths" :key="path">{{ path }}</el-tag>
                  </div>
                  <span v-else class="source-empty">未配置，全部题目由资料或 AI 生成</span>
                  <div v-if="state.specFormErrors.questionBankIds || sourceAllocationError" class="mt-2 text-xs font-bold text-coral">{{ state.specFormErrors.questionBankIds || sourceAllocationError }}</div>
                </div>
                <div class="source-allocation-actions">
                  <strong>{{ questionBankQuestionCount }} 题</strong>
                  <el-button :icon="Collection" :disabled="formLocked" @click="openQuestionBankPicker">设置题库题</el-button>
                  <el-button v-if="questionBankQuestionCount" link type="danger" :disabled="formLocked" @click="clearQuestionBankPlan">清空</el-button>
                </div>
              </div>

              <div class="source-allocation-row">
                <div class="source-allocation-name">
                  <el-icon class="text-leaf"><FolderOpened /></el-icon>
                  <div><strong>资料题</strong><span>严格依据所选资料内容生成</span></div>
                </div>
                <div class="source-allocation-content">
                  <div v-if="selectedSourceMaterials.length" class="flex flex-wrap gap-2">
                    <el-tag v-for="material in selectedSourceMaterials" :key="material.id" :closable="!formLocked" :disable-transitions="true" @close="removeSelectedMaterial(material.id)">
                      {{ material.name }} · v{{ material.version }}
                    </el-tag>
                  </div>
                  <span v-else class="source-empty">未选择资料</span>
                  <div v-if="state.specFormErrors.materialIds" class="mt-2 text-xs font-bold text-coral">{{ state.specFormErrors.materialIds }}</div>
                </div>
                <div class="source-allocation-actions source-material-actions">
                  <el-input-number
                    v-model="state.spec.materialQuestionCount"
                    :disabled="formLocked"
                    :min="0"
                    :max="Math.max(0, totalQuestionCount - questionBankQuestionCount)"
                    controls-position="right"
                    aria-label="资料题数量"
                  />
                  <el-button :icon="FolderOpened" :disabled="formLocked" @click="openMaterialSelector">选择资料</el-button>
                </div>
              </div>

              <div class="source-allocation-row">
                <div class="source-allocation-name">
                  <el-icon class="text-iris"><MagicStick /></el-icon>
                  <div><strong>AI 生成题</strong><span>不引用题库或资料，按命题要求自动补齐</span></div>
                </div>
                <div class="source-allocation-content">
                  <span class="source-empty">无需设置，将根据前两类题目自动计算</span>
                </div>
                <div class="source-allocation-actions"><strong>{{ aiQuestionCount }} 题</strong></div>
              </div>
            </div>

            <div v-if="materialQuestionCount > 0" class="mt-4 grid gap-3 md:grid-cols-[minmax(220px,320px)_1fr] md:items-center">
              <el-select v-model="state.spec.coverageStrategy" :disabled="formLocked" aria-label="资料覆盖策略">
                <el-option label="均衡覆盖所选资料" value="balanced" />
                <el-option label="按内容相关性择优" value="best-match" />
              </el-select>
              <el-alert
                v-if="state.spec.coverageStrategy === 'balanced' && selectedSourceMaterials.length > materialQuestionCount"
                title="资料题数量少于所选资料数量，无法保证每份资料至少生成一道题"
                type="warning"
                show-icon
                :closable="false"
              />
            </div>
          </section>

          <section v-if="state.generatedDraft?.questions?.length" class="workbench-section mt-3">
            <div class="section-heading">
              <div>
                <div class="text-sm font-black">生成结果</div>
                <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {{ state.generatedDraft.questions.length }} 题 · 题库 {{ overviewQuestionSources.bank }} · 资料 {{ overviewQuestionSources.material }} · AI {{ overviewQuestionSources.ai }}
                </div>
              </div>
              <el-tag type="success" effect="plain">等待确认</el-tag>
            </div>
            <el-table :data="state.generatedDraft.questions" class="mt-3" max-height="430" size="small" highlight-current-row @row-click="selectQuestion">
              <el-table-column type="index" label="#" width="54" />
              <el-table-column label="题型" width="86"><template #default="{ row }"><el-tag :type="questionTagType(row.type)" size="small">{{ row.type }}</el-tag></template></el-table-column>
              <el-table-column label="来源" min-width="150" show-overflow-tooltip><template #default="{ row }"><el-tag :type="row.origin?.type === 'material' ? 'success' : row.origin?.type === 'question-bank' ? 'primary' : 'info'" size="small" effect="plain">{{ questionSourceLabel(row) }}</el-tag></template></el-table-column>
              <el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip />
              <el-table-column prop="difficulty" label="难度" width="68" />
              <el-table-column label="答案" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ formatAnswer(row) }}</template></el-table-column>
              <el-table-column label="分值" width="68" align="right"><template #default="{ row }">{{ row.score }} 分</template></el-table-column>
            </el-table>
          </section>
        </el-form>

        <section v-else-if="visibleWorkflowStep === 'edit'" class="workbench-section">
          <div class="section-heading">
            <div>
              <div class="text-sm font-black">试卷编辑</div>
              <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{{ authoringQuestions.length }} 道题 · 题库 {{ overviewQuestionSources.bank }} · 资料 {{ overviewQuestionSources.material }} · AI {{ overviewQuestionSources.ai }}</div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <el-select v-model="state.questionBankManagement.paperImportCategoryId" filterable placeholder="选择题目入库分类" class="w-56">
                <el-option v-for="category in categoryLeafOptions" :key="category.id" :label="category.path.map((item) => item.name).join(' / ')" :value="category.id" />
              </el-select>
              <el-button type="success" plain :loading="state.questionBankManagement.importingCurrent" :disabled="!authoringQuestions.length" @click="addCurrentQuestionsToBank">当前试卷全部题目入库</el-button>
            </div>
          </div>

          <div class="edit-toolbar mt-3">
            <el-input v-model="editSearch" clearable :prefix-icon="Search" placeholder="搜索题干、编号或知识点" />
            <el-select v-model="editType" aria-label="题型筛选">
              <el-option label="全部题型" value="all" />
              <el-option v-for="item in paperTypeConfig" :key="item.type" :label="item.type" :value="item.type" />
            </el-select>
          </div>

          <el-table
            :data="filteredEditQuestions"
            class="edit-table mt-3"
            max-height="560"
            size="small"
            highlight-current-row
            :row-class-name="editRowClass"
            @row-click="selectQuestion"
          >
            <template #empty>
              <el-empty :description="editSearch || editType !== 'all' ? '没有符合当前条件的题目' : '当前试卷还没有题目'">
                <el-button v-if="editSearch || editType !== 'all'" @click="clearEditFilters">清空筛选</el-button>
              </el-empty>
            </template>
            <el-table-column type="index" label="#" width="52" />
            <el-table-column label="题型" width="82"><template #default="{ row }"><el-tag :type="questionTagType(row.type)" size="small" effect="plain">{{ row.type }}</el-tag></template></el-table-column>
            <el-table-column label="来源" min-width="150" show-overflow-tooltip><template #default="{ row }"><el-tag :type="row.origin?.type === 'material' ? 'success' : row.origin?.type === 'question-bank' ? 'primary' : 'info'" size="small" effect="plain">{{ questionSourceLabel(row) }}</el-tag></template></el-table-column>
            <el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip />
            <el-table-column prop="difficulty" label="难度" width="64" />
            <el-table-column label="答案" min-width="100" show-overflow-tooltip><template #default="{ row }">{{ formatAnswer(row) }}</template></el-table-column>
            <el-table-column prop="score" label="分值" width="64" align="right" />
            <el-table-column prop="quality" label="质量分" width="72" align="right" />
            <el-table-column label="操作" fixed="right" width="88">
              <template #default="{ row }">
                <el-button link type="primary" :icon="Edit" @click.stop="openQuestionEditor(row)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section v-else-if="visibleWorkflowStep === 'publish'" class="workbench-section">
          <div class="section-heading">
            <div>
              <div class="flex items-center gap-2 text-sm font-black"><el-icon class="text-iris"><DocumentChecked /></el-icon>试卷结构</div>
              <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{{ displayPaperStatus(paper.status) }}</div>
            </div>
            <el-tag type="success" effect="plain">等待发布</el-tag>
          </div>

          <div class="paper-summary-grid mt-4">
            <div><span>试卷名称</span><strong>{{ overviewPaperName }}</strong></div>
            <div><span>试卷总分</span><strong>{{ paper.score || overviewTotalScore }} 分</strong></div>
            <div><span>题目数量</span><strong>{{ paper.questionCount || authoringQuestions.length }} 题</strong></div>
            <div><span>发布检查</span><strong class="text-ocean">发布时自动执行</strong></div>
            <div><span>题库题</span><strong>{{ overviewQuestionSources.bank }} 题</strong></div>
            <div><span>资料题</span><strong>{{ overviewQuestionSources.material }} 题</strong></div>
            <div><span>AI 生成题</span><strong>{{ overviewQuestionSources.ai }} 题</strong></div>
          </div>

          <div v-if="state.publishQualityFailures.length" class="mt-4">
            <el-alert
              :title="`暂未发布，共发现 ${state.publishQualityFailures.length} 个问题`"
              description="请逐项修改对应题目，然后再次发布。"
              type="error"
              :closable="false"
              show-icon
            />
            <el-table :data="state.publishQualityFailures" class="mt-3 w-full" size="small" max-height="360">
              <el-table-column label="题号" width="72"><template #default="{ row }">第 {{ row.questionNumber || row.index + 1 }} 题</template></el-table-column>
              <el-table-column label="题型" width="82"><template #default="{ row }"><el-tag :type="questionTagType(row.type)" size="small">{{ row.type || '未知' }}</el-tag></template></el-table-column>
              <el-table-column prop="stem" label="题干" min-width="220" show-overflow-tooltip />
              <el-table-column label="需修改项" width="96"><template #default="{ row }">{{ publishIssueFieldLabel(row.field) }}</template></el-table-column>
              <el-table-column prop="message" label="问题说明" min-width="220" />
              <el-table-column label="操作" fixed="right" width="82">
                <template #default="{ row }"><el-button link type="primary" :icon="Edit" @click="editPublishIssue(row)">修改</el-button></template>
              </el-table-column>
            </el-table>
          </div>
        </section>
      </main>

      <aside class="authoring-summary" data-authoring-summary>
        <div class="summary-sticky">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-black">试卷概览</h2>
            <el-tag type="success" size="small" effect="plain">可编辑</el-tag>
          </div>

          <div class="summary-metrics mt-3">
            <div><span>题目</span><strong>{{ overviewQuestionCount }}</strong></div>
            <div><span>总分</span><strong>{{ overviewTotalScore }}</strong></div>
            <div><span>难度</span><strong>{{ activeSpec?.difficulty || state.spec.difficulty }}</strong></div>
            <div><span>发布问题</span><strong :class="state.publishQualityFailures.length ? 'text-coral' : ''">{{ state.publishQualityFailures.length }}</strong></div>
          </div>

          <dl class="summary-details mt-4">
            <div><dt>出题方向</dt><dd>{{ activeSpec?.direction || state.spec.direction || '未设置' }}</dd></div>
            <div><dt>知识点</dt><dd>{{ overviewKnowledge }}</dd></div>
            <div><dt>题目来源</dt><dd>{{ sourcePlanLabel(activeSourcePlan) }}</dd></div>
            <div v-if="activeSourceMaterials.length"><dt>使用资料</dt><dd>{{ activeSourceMaterials.map((item) => `${item.name} v${item.version}`).join('、') }}</dd></div>
            <div><dt>编辑状态</dt><dd>{{ authoringQuestions.length || overviewQuestionCount }} 道题已保存</dd></div>
          </dl>

          <div v-if="typeDistribution.length" class="mt-4 border-t border-slate-200 pt-4 dark:border-night-border">
            <div class="mb-2 text-xs font-black">题型分布</div>
            <div class="space-y-2">
              <div v-for="item in typeDistribution" :key="item.type" class="type-distribution-row">
                <span>{{ item.type }}</span>
                <el-progress :percentage="overviewQuestionCount ? Math.round(item.count / overviewQuestionCount * 100) : 0" :show-text="false" :stroke-width="5" />
                <strong>{{ item.count }}</strong>
              </div>
            </div>
          </div>

          <div v-if="selectedQuestion" class="selected-question-detail mt-4">
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-black">当前题目</div>
              <div class="flex gap-1">
                <el-tag :type="questionTagType(selectedQuestion.type)" size="small">{{ selectedQuestion.type }}</el-tag>
                <el-tag size="small" effect="plain">{{ selectedQuestion.score }} 分</el-tag>
              </div>
            </div>
            <p class="mt-3 text-sm font-bold leading-6">{{ selectedQuestion.stem }}</p>
            <div class="mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ selectedQuestion.difficulty }} · {{ questionKnowledge(selectedQuestion) }}</div>
            <div class="mt-2 flex flex-wrap items-center gap-1">
              <el-tag :type="selectedQuestion.origin?.type === 'material' ? 'success' : selectedQuestion.origin?.type === 'question-bank' ? 'primary' : 'info'" size="small" effect="plain">{{ questionSourceLabel(selectedQuestion) }}</el-tag>
              <el-tag v-if="selectedQuestion.origin?.edited" size="small" type="warning" effect="plain">已人工修改</el-tag>
            </div>
            <ol v-if="selectedQuestion.options?.length" class="mt-3 space-y-1 text-xs leading-5">
              <li v-for="(option, index) in selectedQuestion.options" :key="index"><strong>{{ String.fromCharCode(65 + index) }}.</strong> {{ option }}</li>
            </ol>
            <div class="question-answer mt-3"><span>答案</span><strong>{{ formatAnswer(selectedQuestion) }}</strong></div>
            <div v-if="selectedQuestion.explanation" class="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300"><strong>解析：</strong>{{ selectedQuestion.explanation }}</div>
            <div v-if="selectedQuestion.rubric?.length" class="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300"><strong>评分规则：</strong>{{ selectedQuestion.rubric.join('；') }}</div>
            <div v-if="selectedQuestion.origin?.materialRefs?.length" class="source-evidence mt-3">
              <div class="text-xs font-black">资料依据</div>
              <div v-for="ref in selectedQuestion.origin.materialRefs" :key="`${ref.materialId}-${ref.chunkId}`" class="mt-2">
                <div class="text-[11px] font-bold text-leaf">{{ ref.name }} · v{{ ref.version }}</div>
                <p class="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{{ ref.excerpt }}</p>
              </div>
            </div>
            <el-button v-if="visibleWorkflowStep === 'edit'" class="mt-3 w-full" :icon="Edit" @click="openQuestionEditor(selectedQuestion)">编辑当前题目</el-button>
          </div>
        </div>
      </aside>
    </div>

    <el-dialog v-model="state.materialManagement.selectorOpen" title="选择出题资料" width="min(780px, calc(100vw - 24px))" top="6vh" append-to-body :close-on-click-modal="false">
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <el-input v-model="materialSearch" clearable :prefix-icon="Search" placeholder="搜索资料名称、标签或文件名" />
        <el-button text type="primary" :icon="FolderOpened" @click="manageMaterialsFromAuthoring">管理出题资料</el-button>
      </div>
      <el-table v-loading="state.materialManagement.optionsLoading" :data="filteredMaterialOptions" class="mt-4" max-height="440">
        <template #empty>
          <el-empty :description="materialSearch ? '没有符合当前条件的资料' : '还没有可用的出题资料'">
            <el-button v-if="materialSearch" @click="materialSearch = ''">清空搜索</el-button>
            <el-button v-else type="primary" :icon="FolderOpened" @click="manageMaterialsFromAuthoring">管理出题资料</el-button>
          </el-empty>
        </template>
        <el-table-column width="52">
          <template #default="{ row }"><el-checkbox :model-value="state.spec.materialIds.includes(row.id)" :aria-label="`选择${row.name}`" @change="toggleMaterialSelection(row.id)" /></template>
        </el-table-column>
        <el-table-column label="资料" min-width="260">
          <template #default="{ row }">
            <div class="font-black">{{ row.name }}</div>
            <div class="mt-1 text-xs font-semibold text-slate-400">{{ row.filename || '纯文本资料' }} · v{{ row.version }} · {{ row.textLength }} 字</div>
          </template>
        </el-table-column>
        <el-table-column label="标签" min-width="180"><template #default="{ row }"><div class="flex flex-wrap gap-1"><el-tag v-for="tag in row.tags || []" :key="tag" size="small" effect="plain">{{ tag }}</el-tag><span v-if="!row.tags?.length" class="text-xs text-slate-400">未设置</span></div></template></el-table-column>
        <el-table-column label="使用" width="100"><template #default="{ row }">{{ row.paperUsageCount }} 卷</template></el-table-column>
      </el-table>
      <template #footer>
        <span class="mr-auto text-xs font-bold text-slate-500 dark:text-slate-400">已选择 {{ state.spec.materialIds.length }} 份资料</span>
        <el-button @click="state.materialManagement.selectorOpen = false">完成选择</el-button>
      </template>
    </el-dialog>

    <footer class="authoring-action-bar" data-authoring-action-bar>
      <div class="min-w-0">
        <div class="text-xs font-black">{{ currentStep?.title }}</div>
        <div class="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <template v-if="visibleWorkflowStep === 'config' && state.generatedDraft?.questions?.length">生成结果等待确认</template>
          <template v-else-if="visibleWorkflowStep === 'config'">{{ totalQuestionCount }} 题 = 题库 {{ questionBankQuestionCount }} + 资料 {{ materialQuestionCount }} + AI {{ aiQuestionCount }}</template>
          <template v-else-if="visibleWorkflowStep === 'edit'">可继续编辑题目，或保存后进入发布</template>
          <template v-else>{{ state.publishQualityFailures.length ? `请先修正 ${state.publishQualityFailures.length} 个问题` : '发布时将自动保存并执行完整检查' }}</template>
        </div>
      </div>
      <div class="action-buttons">
        <template v-if="visibleWorkflowStep === 'config'">
          <el-button v-if="formLocked && !state.generating" :icon="RefreshRight" @click="regenerate">重新生成</el-button>
          <el-button v-if="state.generatedDraft?.questions?.length" :icon="Delete" :disabled="state.saving" @click="discardDraft">丢弃</el-button>
          <el-button v-if="state.generatedDraft?.questions?.length" type="primary" :icon="Check" :loading="state.saving" @click="saveDraft">确认并保存</el-button>
          <el-button v-else-if="!formLocked" type="primary" :icon="MagicStick" :loading="state.generating" @click="generateDraft">生成试卷预览</el-button>
        </template>
        <template v-else-if="visibleWorkflowStep === 'edit'">
          <el-button :loading="state.saving" @click="saveCurrentPaper">保存试卷</el-button>
          <el-button type="primary" :icon="Promotion" @click="setWorkflowStep('publish')">进入发布</el-button>
        </template>
        <el-button v-else-if="visibleWorkflowStep === 'publish'" type="primary" :icon="Promotion" :loading="state.publishing" @click="publishPaper">发布试卷</el-button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.authoring-page {
  padding: 12px 0 24px;
}

.authoring-header {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 14px;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.workflow-button {
  width: 100%;
  height: 54px;
  margin: 0;
  padding: 8px 10px;
  align-items: stretch;
  justify-content: flex-start;
}

.workflow-button.is-current {
  box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
}

.workflow-button.is-current .workflow-index {
  background: #fff;
  color: #166534;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 75%);
}

.workflow-content {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  text-align: left;
}

.workflow-index {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--el-fill-color-light);
  font-size: 11px;
  font-weight: 900;
}

.authoring-workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 292px;
  gap: 18px;
  margin-top: 14px;
  align-items: start;
}

.workbench-section {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  padding: 12px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.generation-progress {
  margin-top: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  padding: 10px 12px;
}

.source-allocation-list {
  border-top: 1px solid var(--el-border-color-lighter);
}

.source-allocation-row {
  display: grid;
  grid-template-columns: minmax(160px, 0.7fr) minmax(220px, 1.5fr) minmax(180px, auto);
  gap: 16px;
  min-height: 76px;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 12px 0;
}

.source-allocation-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.source-allocation-name .el-icon {
  flex: 0 0 auto;
  font-size: 20px;
}

.source-allocation-name strong,
.source-allocation-name span {
  display: block;
}

.source-allocation-name strong {
  font-size: 13px;
}

.source-allocation-name span,
.source-empty {
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.source-allocation-content {
  min-width: 0;
}

.source-allocation-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.source-allocation-actions > strong {
  white-space: nowrap;
  font-size: 13px;
}

.source-material-actions :deep(.el-input-number) {
  width: 112px;
}

.source-evidence {
  border-left: 3px solid var(--el-color-success-light-5);
  background: var(--el-fill-color-lighter);
  padding: 9px 10px;
}

.type-matrix-table :deep(.el-table__cell) {
  padding: 3px 0;
}

.workbench-section :deep(.el-form-item) {
  margin-bottom: 12px;
}

.matrix-number {
  width: 118px;
}

.authoring-summary {
  min-width: 0;
  border-left: 1px solid var(--el-border-color-lighter);
  padding-left: 18px;
}

.summary-sticky {
  position: sticky;
  top: 78px;
  max-height: calc(100vh - 104px);
  overflow-y: auto;
  padding-right: 4px;
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

.summary-metrics > div {
  display: flex;
  min-height: 62px;
  flex-direction: column;
  justify-content: center;
  padding: 9px 11px;
  background: var(--el-fill-color-lighter);
}

.summary-metrics > div:nth-child(odd) {
  border-right: 1px solid var(--el-border-color-lighter);
}

.summary-metrics > div:nth-child(-n + 2) {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.summary-metrics span,
.paper-summary-grid span {
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.summary-metrics strong {
  margin-top: 2px;
  font-size: 19px;
}

.summary-details {
  display: grid;
  gap: 8px;
}

.summary-details > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  line-height: 20px;
}

.summary-details dt {
  font-weight: 700;
  color: var(--el-text-color-secondary);
}

.summary-details dd {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 700;
}

.type-distribution-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 24px;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
}

.selected-question-detail {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 14px;
}

.question-answer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 5px;
  background: var(--el-fill-color-light);
  padding: 8px 10px;
  font-size: 12px;
}

.question-answer span {
  color: var(--el-text-color-secondary);
  font-weight: 700;
}

.edit-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 132px;
  gap: 10px;
  align-items: center;
}

.edit-table :deep(.is-selected-question td.el-table__cell) {
  background: var(--el-color-primary-light-9) !important;
}

.paper-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

.paper-summary-grid > div {
  display: flex;
  min-height: 76px;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.paper-summary-grid > div:last-child {
  border-right: 0;
}

.paper-summary-grid strong {
  overflow-wrap: anywhere;
  font-size: 14px;
}

.authoring-action-bar {
  position: sticky;
  z-index: 20;
  bottom: 10px;
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-bg-color) 94%, transparent);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  padding: 10px 12px;
  backdrop-filter: blur(12px);
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.action-buttons :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 1279px) {
  .authoring-workbench-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .authoring-summary {
    border-top: 1px solid var(--el-border-color-lighter);
    border-left: 0;
    padding-top: 16px;
    padding-left: 0;
  }

  .summary-sticky {
    position: static;
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 767px) {
  .workflow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .edit-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .paper-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .paper-summary-grid > div:nth-child(2) {
    border-right: 0;
  }

  .paper-summary-grid > div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .source-allocation-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .source-allocation-actions {
    justify-content: space-between;
  }
}

@media (max-width: 640px) {
  .authoring-page {
    padding-top: 8px;
  }

  .workflow-button {
    height: 56px;
    padding: 6px 8px;
  }

  .workflow-button :deep(.el-tag) {
    display: none;
  }

  .workbench-section {
    padding: 12px;
  }

  .matrix-number {
    width: 104px;
  }

  .authoring-action-bar {
    position: static;
    align-items: stretch;
    flex-direction: column;
  }

  .action-buttons,
  .action-buttons :deep(.el-button) {
    width: 100%;
  }

  .action-buttons {
    flex-direction: column;
  }
}
</style>
