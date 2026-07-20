<script setup>
import {
  Box,
  Collection,
  Edit,
  Plus,
  Refresh,
  Search,
  View,
} from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  applyQuestionBankFilters,
  changeQuestionBankPage,
  changeQuestionBankPageSize,
  loadQuestionBank,
  openCreateQuestionBankItem,
  openEditQuestionBankItem,
  openQuestionBankDetail,
  runQuestionBankAction,
  saveQuestionBankItem,
  formatDateTime,
} = useSmartQ();

const questionTypes = ["单选", "多选", "判断", "填空", "简答", "论述"];
const letters = ["A", "B", "C", "D"];

function statusType(status) {
  return { 已校验: "success", 待确认: "warning", 已归档: "info" }[status] || "info";
}

function originLabel(origin) {
  return { manual: "人工创建", ai: "AI 生成", material: "资料生成", paper: "试卷导入", "question-bank": "题库" }[origin?.type] || "人工创建";
}

function formatAnswer(question) {
  return Array.isArray(question?.answer) ? question.answer.join("、") : String(question?.answer ?? "");
}
</script>

<template>
  <section class="mt-4 space-y-4" data-question-bank-page>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-black">题库管理</h1>
        <div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">维护可跨试卷复用的独立题目，重复入库会自动合并来源</div>
      </div>
      <el-button type="primary" :icon="Plus" size="large" @click="openCreateQuestionBankItem">新建题目</el-button>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <el-card shadow="never"><div class="text-xl font-black">{{ state.questionBankManagement.total }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">当前筛选</div></el-card>
      <el-card shadow="never"><div class="text-xl font-black text-leaf">{{ state.questionBankManagement.items.filter((item) => item.status === '已校验').length }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">当前页可用</div></el-card>
      <el-card shadow="never"><div class="text-xl font-black text-iris">{{ state.questionBankManagement.items.reduce((sum, item) => sum + Number(item.paperUsageCount || 0), 0) }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">当前页关联试卷</div></el-card>
      <el-card shadow="never"><div class="text-xl font-black text-ocean">{{ state.questionBankManagement.items.reduce((sum, item) => sum + Number(item.sourceCount || 0), 0) }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">当前页入库来源</div></el-card>
    </div>

    <el-card shadow="never" class="question-bank-list-card">
      <div class="grid gap-3 border-b border-slate-200 pb-4 xl:grid-cols-[minmax(260px,1fr)_140px_130px_130px_auto] dark:border-night-border">
        <el-input v-model="state.questionBankManagement.search" clearable :prefix-icon="Search" placeholder="搜索题干、知识点、标签或编号" @keyup.enter="applyQuestionBankFilters" @clear="applyQuestionBankFilters" />
        <el-select v-model="state.questionBankManagement.type" clearable placeholder="全部题型" @change="applyQuestionBankFilters"><el-option v-for="type in questionTypes" :key="type" :label="type" :value="type" /></el-select>
        <el-select v-model="state.questionBankManagement.difficulty" clearable placeholder="全部难度" @change="applyQuestionBankFilters"><el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" /></el-select>
        <el-select v-model="state.questionBankManagement.status" clearable placeholder="全部状态" @change="applyQuestionBankFilters"><el-option v-for="status in ['待确认','已校验','已归档']" :key="status" :label="status" :value="status" /></el-select>
        <div class="flex gap-2"><el-button type="primary" :icon="Search" @click="applyQuestionBankFilters">查询</el-button><el-tooltip content="刷新列表"><el-button :icon="Refresh" circle aria-label="刷新题库" @click="loadQuestionBank" /></el-tooltip></div>
      </div>

      <el-alert v-if="state.questionBankManagement.error" class="mt-4" :title="state.questionBankManagement.error" type="error" show-icon :closable="false" />

      <el-table v-loading="state.questionBankManagement.loading" :data="state.questionBankManagement.items" class="mt-4 w-full" empty-text="暂无匹配题目">
        <el-table-column label="题目" min-width="320">
          <template #default="{ row }">
            <div class="flex min-w-0 items-start gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-50 text-leaf dark:bg-night-elevated"><el-icon><Collection /></el-icon></span>
              <div class="min-w-0">
                <div class="line-clamp-2 font-black leading-6">{{ row.stem }}</div>
                <div class="mt-1 text-xs font-semibold text-slate-400">{{ row.id }} · v{{ row.version }}</div>
                <div v-if="row.knowledge?.length" class="mt-2 flex flex-wrap gap-1"><el-tag v-for="item in row.knowledge" :key="item" size="small" effect="plain">{{ item }}</el-tag></div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="题型" width="82" />
        <el-table-column prop="difficulty" label="难度" width="72" />
        <el-table-column label="状态" width="96"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template></el-table-column>
        <el-table-column label="默认分值" width="90" align="right"><template #default="{ row }">{{ row.defaultScore }} 分</template></el-table-column>
        <el-table-column label="来源/使用" width="130"><template #default="{ row }">{{ row.sourceCount }} 来源 / {{ row.paperUsageCount }} 卷</template></el-table-column>
        <el-table-column label="更新时间" min-width="165"><template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" fixed="right" width="215" align="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openQuestionBankDetail(row)">查看</el-button>
            <el-button v-if="row.status !== '已归档'" link type="primary" :icon="Edit" @click="openEditQuestionBankItem(row)">编辑</el-button>
            <el-button v-if="row.status === '已归档'" link type="success" :loading="state.questionBankManagement.actionId === row.id" @click="runQuestionBankAction(row, 'restore')">恢复</el-button>
            <el-button v-else link type="danger" :icon="Box" :loading="state.questionBankManagement.actionId === row.id" @click="runQuestionBankAction(row, 'archive')">归档</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-night-border">
        <el-pagination :current-page="state.questionBankManagement.page" :page-size="state.questionBankManagement.pageSize" :page-sizes="[10,20,50]" :total="state.questionBankManagement.total" layout="total, sizes, prev, pager, next" background @current-change="changeQuestionBankPage" @size-change="changeQuestionBankPageSize" />
      </div>
    </el-card>

    <el-dialog v-model="state.questionBankManagement.editorOpen" :title="state.questionBankManagement.editorMode === 'edit' ? '编辑题库题目' : '新建题库题目'" width="760px" top="4vh" append-to-body destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveQuestionBankItem">
        <el-alert v-if="state.questionBankManagement.formError" class="mb-4" :title="state.questionBankManagement.formError" type="error" show-icon :closable="false" />
        <div class="grid gap-x-3 sm:grid-cols-[130px_130px_140px_1fr]">
          <el-form-item label="题型"><el-select v-model="state.questionBankManagement.form.type"><el-option v-for="type in questionTypes" :key="type" :label="type" :value="type" /></el-select></el-form-item>
          <el-form-item label="默认分值"><el-input-number v-model="state.questionBankManagement.form.defaultScore" :min="1" :max="200" controls-position="right" class="w-full" /></el-form-item>
          <el-form-item label="难度"><el-select v-model="state.questionBankManagement.form.difficulty"><el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" /></el-select></el-form-item>
          <el-form-item label="审核状态"><el-segmented v-model="state.questionBankManagement.form.status" :options="[{label:'待确认',value:'待确认'},{label:'已校验',value:'已校验'}]" /></el-form-item>
        </div>
        <el-form-item label="题干"><el-input v-model="state.questionBankManagement.form.stem" type="textarea" :rows="4" /></el-form-item>
        <div v-if="['单选','多选'].includes(state.questionBankManagement.form.type)" class="grid gap-x-3 sm:grid-cols-2">
          <el-form-item v-for="letter in letters" :key="letter" :label="`选项 ${letter}`"><el-input v-model="state.questionBankManagement.form['option' + letter]" /></el-form-item>
        </div>
        <div class="grid gap-x-3 sm:grid-cols-2">
          <el-form-item v-if="state.questionBankManagement.form.type === '单选'" label="正确答案"><el-select v-model="state.questionBankManagement.form.answerSingle"><el-option v-for="letter in letters" :key="letter" :label="letter" :value="letter" /></el-select></el-form-item>
          <el-form-item v-else-if="state.questionBankManagement.form.type === '判断'" label="正确答案"><el-radio-group v-model="state.questionBankManagement.form.answerSingle"><el-radio-button label="正确" value="正确" /><el-radio-button label="错误" value="错误" /></el-radio-group></el-form-item>
          <el-form-item v-else-if="state.questionBankManagement.form.type === '多选'" label="正确答案"><el-checkbox-group v-model="state.questionBankManagement.form.answerMultiple"><el-checkbox-button v-for="letter in letters" :key="letter" :label="letter" :value="letter" /></el-checkbox-group></el-form-item>
          <el-form-item v-else label="参考答案"><el-input v-model="state.questionBankManagement.form.answerText" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="答案解析"><el-input v-model="state.questionBankManagement.form.explanation" type="textarea" :rows="3" /></el-form-item>
        </div>
        <el-form-item v-if="['简答','论述'].includes(state.questionBankManagement.form.type)" label="评分规则"><el-input v-model="state.questionBankManagement.form.rubricText" type="textarea" :rows="4" placeholder="每行一条评分规则" /></el-form-item>
        <div class="grid gap-x-3 sm:grid-cols-2"><el-form-item label="知识点"><el-input v-model="state.questionBankManagement.form.knowledgeText" placeholder="多个知识点使用逗号分隔" /></el-form-item><el-form-item label="标签"><el-input v-model="state.questionBankManagement.form.tagsText" placeholder="多个标签使用逗号分隔" /></el-form-item></div>
      </el-form>
      <template #footer><el-button @click="state.questionBankManagement.editorOpen = false">取消</el-button><el-button type="primary" :loading="state.questionBankManagement.saving" @click="saveQuestionBankItem">保存题目</el-button></template>
    </el-dialog>

    <el-drawer v-model="state.questionBankManagement.detailOpen" append-to-body size="min(800px, 100vw)" title="题库题目详情">
      <div v-loading="state.questionBankManagement.detailLoading" class="min-h-64">
        <template v-if="state.questionBankManagement.detail">
          <div class="flex flex-wrap items-center gap-2"><el-tag>{{ state.questionBankManagement.detail.type }}</el-tag><el-tag :type="statusType(state.questionBankManagement.detail.status)">{{ state.questionBankManagement.detail.status }}</el-tag><el-tag effect="plain">{{ state.questionBankManagement.detail.difficulty }} · {{ state.questionBankManagement.detail.defaultScore }} 分</el-tag><el-tag effect="plain">v{{ state.questionBankManagement.detail.version }}</el-tag></div>
          <h2 class="mt-4 whitespace-pre-line text-lg font-black leading-8">{{ state.questionBankManagement.detail.stem }}</h2>
          <div v-if="state.questionBankManagement.detail.options?.length" class="mt-4 grid gap-2 sm:grid-cols-2"><div v-for="(option,index) in state.questionBankManagement.detail.options" :key="index" class="rounded border border-slate-200 px-3 py-2 text-sm dark:border-night-border">{{ String.fromCharCode(65 + index) }}. {{ option }}</div></div>
          <el-descriptions class="mt-4" :column="1" border><el-descriptions-item label="答案">{{ formatAnswer(state.questionBankManagement.detail) }}</el-descriptions-item><el-descriptions-item label="解析">{{ state.questionBankManagement.detail.explanation || '未填写' }}</el-descriptions-item><el-descriptions-item label="知识点">{{ (state.questionBankManagement.detail.knowledge || []).join('、') || '未设置' }}</el-descriptions-item><el-descriptions-item label="原始来源">{{ originLabel(state.questionBankManagement.detail.origin) }}</el-descriptions-item></el-descriptions>
          <el-tabs class="mt-4">
            <el-tab-pane :label="`使用记录 ${state.questionBankManagement.detail.usages?.length || 0}`"><el-table :data="state.questionBankManagement.detail.usages || []" size="small" empty-text="尚未关联试卷"><el-table-column prop="paperName" label="试卷" min-width="200" /><el-table-column prop="relation" label="关系" min-width="140" /><el-table-column prop="status" label="状态" width="100" /><el-table-column prop="questionCount" label="题数" width="80" /><el-table-column label="时间" min-width="160"><template #default="{ row }">{{ formatDateTime(row.publishedAt || row.createdAt) }}</template></el-table-column></el-table></el-tab-pane>
            <el-tab-pane :label="`版本记录 ${state.questionBankManagement.detail.revisions?.length || 0}`"><el-table :data="state.questionBankManagement.detail.revisions || []" size="small"><el-table-column label="版本" width="80"><template #default="{ row }">v{{ row.version }}</template></el-table-column><el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip /><el-table-column prop="createdBy" label="修改人" width="110" /><el-table-column label="时间" min-width="160"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column></el-table></el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>
  </section>
</template>

<style scoped>
.question-bank-list-card :deep(.el-card__body) { padding: 16px; }
@media (max-width: 640px) { .question-bank-list-card :deep(.el-pagination) { justify-content: flex-start; overflow-x: auto; } }
</style>
