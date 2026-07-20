<script setup>
import {
  Box,
  Collection,
  Edit,
  Folder,
  FolderAdd,
  Menu,
  Plus,
  Refresh,
  Search,
  View,
} from "@element-plus/icons-vue";
import { computed } from "vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  applyQuestionBankFilters,
  applyBulkQuestionCategories,
  changeQuestionBankPage,
  changeQuestionBankPageSize,
  loadQuestionBank,
  openBulkQuestionCategories,
  openCreateQuestionBankCategory,
  openCreateQuestionBankItem,
  openEditQuestionBankCategory,
  openEditQuestionBankItem,
  openQuestionBankDetail,
  runQuestionBankAction,
  runQuestionBankCategoryAction,
  saveQuestionBankCategory,
  saveQuestionBankItem,
  selectQuestionBankCategory,
  setQuestionBankRows,
  formatDateTime,
} = useSmartQ();

const questionTypes = ["单选", "多选", "判断", "填空", "简答", "论述"];
const letters = ["A", "B", "C", "D"];
const specialCategoryNodes = computed(() => [
  { id: "all", name: "全部题目", count: state.questionBankManagement.categoryCounts.all, special: true },
  { id: "unclassified", name: "未分类", count: state.questionBankManagement.categoryCounts.unclassified, special: true },
  { id: "multi", name: "多分类题目", count: state.questionBankManagement.categoryCounts.multi, special: true },
  { id: "archived", name: "已归档", count: state.questionBankManagement.categoryCounts.archived, special: true },
]);
const categoryTreeData = computed(() => [...specialCategoryNodes.value, ...state.questionBankManagement.categoryTree]);
const leafCategoryOptions = computed(() => state.questionBankManagement.categories.filter((item) => item.status === "active" && item.isLeaf));
const bulkCategoryOptions = computed(() => state.questionBankManagement.bulkMode === "remove" ? state.questionBankManagement.categories : leafCategoryOptions.value);
const categoryParentOptions = computed(() => state.questionBankManagement.categories.filter((item) => {
  if (item.status !== "active" || item.depth >= 3 || item.id === state.questionBankManagement.categoryEditingId) return false;
  return !(item.path || []).some((part) => part.id === state.questionBankManagement.categoryEditingId);
}));
function categoryPathLabel(category) {
  return (category?.path || []).map((item) => item.name).join(" / ") || category?.name || "";
}

function handleCategoryNodeClick(node) {
  selectQuestionBankCategory(node.id);
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
      <div class="flex gap-2">
        <el-button class="xl:hidden" :icon="Menu" size="large" aria-label="打开题库分类" @click="state.questionBankManagement.categoryDrawerOpen = true">题库分类</el-button>
        <el-button type="primary" :icon="Plus" size="large" @click="openCreateQuestionBankItem">新建题目</el-button>
      </div>
    </div>

    <div class="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <el-card shadow="never" class="category-sidebar hidden xl:block">
        <div class="mb-3 flex items-center justify-between"><div class="font-black">题库分类</div><el-tooltip content="新建一级分类"><el-button :icon="FolderAdd" circle size="small" @click="openCreateQuestionBankCategory('')" /></el-tooltip></div>
        <el-tree :data="categoryTreeData" node-key="id" :current-node-key="state.questionBankManagement.selectedCategoryId" highlight-current default-expand-all :expand-on-click-node="false" @node-click="handleCategoryNodeClick">
          <template #default="{ data }">
            <div class="category-tree-row">
              <span class="category-tree-label"><el-icon><Folder /></el-icon><span>{{ data.name }}</span><small>{{ data.count || 0 }}</small></span>
              <span v-if="!data.special" class="category-tree-actions">
                <el-button v-if="data.status === 'active' && data.depth < 3" link :icon="FolderAdd" aria-label="新建子分类" @click.stop="openCreateQuestionBankCategory(data.id)" />
                <el-button link :icon="Edit" aria-label="编辑分类" @click.stop="openEditQuestionBankCategory(data)" />
                <el-button v-if="data.status === 'active'" link type="danger" :icon="Box" aria-label="归档分类" @click.stop="runQuestionBankCategoryAction(data, 'archive')" />
                <el-button v-else link type="success" aria-label="恢复分类" @click.stop="runQuestionBankCategoryAction(data, 'restore')">恢复</el-button>
              </span>
            </div>
          </template>
        </el-tree>
      </el-card>

      <div class="min-w-0 space-y-4">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight">{{ state.questionBankManagement.total }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">当前筛选</div></el-card>
          <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight text-leaf">{{ state.questionBankManagement.items.length }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">当前页题目</div></el-card>
          <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight text-iris">{{ state.questionBankManagement.categoryCounts.unclassified }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">待归类题目</div></el-card>
          <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight text-ocean">{{ state.questionBankManagement.categoryCounts.multi }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">多分类题目</div></el-card>
        </div>

        <el-card shadow="never" class="question-bank-list-card">
          <div class="grid gap-3 border-b border-slate-200 pb-4 xl:grid-cols-[minmax(260px,1fr)_140px_130px_auto] dark:border-night-border">
            <el-input v-model="state.questionBankManagement.search" clearable :prefix-icon="Search" placeholder="搜索题干、知识点、标签或编号" @keyup.enter="applyQuestionBankFilters" @clear="applyQuestionBankFilters" />
            <el-select v-model="state.questionBankManagement.type" clearable placeholder="全部题型" @change="applyQuestionBankFilters"><el-option v-for="type in questionTypes" :key="type" :label="type" :value="type" /></el-select>
            <el-select v-model="state.questionBankManagement.difficulty" clearable placeholder="全部难度" @change="applyQuestionBankFilters"><el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" /></el-select>
            <div class="flex gap-2"><el-button type="primary" :icon="Search" @click="applyQuestionBankFilters">查询</el-button><el-tooltip content="刷新列表"><el-button :icon="Refresh" circle aria-label="刷新题库" @click="loadQuestionBank" /></el-tooltip></div>
          </div>

          <div v-if="state.questionBankManagement.selectedRows.length" class="mt-3 flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/30">
            <strong class="mr-auto text-sm">已选 {{ state.questionBankManagement.selectedRows.length }} 道题</strong>
            <el-button size="small" @click="openBulkQuestionCategories('add')">添加分类</el-button>
            <el-button size="small" @click="openBulkQuestionCategories('remove')">移除分类</el-button>
            <el-button size="small" type="primary" @click="openBulkQuestionCategories('replace')">替换分类</el-button>
          </div>

          <el-alert v-if="state.questionBankManagement.error" class="mt-4" :title="state.questionBankManagement.error" type="error" show-icon :closable="false" />

          <el-table v-loading="state.questionBankManagement.loading" :data="state.questionBankManagement.items" class="mt-4 w-full" empty-text="暂无匹配题目" row-key="id" @selection-change="setQuestionBankRows">
        <el-table-column type="selection" width="48" />
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
        <el-table-column label="分类" min-width="180" show-overflow-tooltip><template #default="{ row }"><span v-if="row.categories?.length">{{ row.categories.map(categoryPathLabel).join('、') }}</span><el-tag v-else type="warning" size="small">未分类</el-tag></template></el-table-column>
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
      </div>
    </div>

    <el-dialog v-model="state.questionBankManagement.editorOpen" :title="state.questionBankManagement.editorMode === 'edit' ? '编辑题库题目' : '新建题库题目'" width="760px" top="4vh" append-to-body destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveQuestionBankItem">
        <el-alert v-if="state.questionBankManagement.formError" class="mb-4" :title="state.questionBankManagement.formError" type="error" show-icon :closable="false" />
        <el-form-item label="所属分类">
          <el-select v-model="state.questionBankManagement.form.categoryIds" multiple filterable collapse-tags collapse-tags-tooltip placeholder="可选择多个叶子分类" class="w-full">
            <el-option v-for="category in leafCategoryOptions" :key="category.id" :label="categoryPathLabel(category)" :value="category.id" />
          </el-select>
        </el-form-item>
        <div class="grid gap-x-3 sm:grid-cols-3">
          <el-form-item label="题型"><el-select v-model="state.questionBankManagement.form.type"><el-option v-for="type in questionTypes" :key="type" :label="type" :value="type" /></el-select></el-form-item>
          <el-form-item label="默认分值"><el-input-number v-model="state.questionBankManagement.form.defaultScore" :min="1" :max="200" controls-position="right" class="w-full" /></el-form-item>
          <el-form-item label="难度"><el-select v-model="state.questionBankManagement.form.difficulty"><el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" /></el-select></el-form-item>
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
          <div class="flex flex-wrap items-center gap-2"><el-tag>{{ state.questionBankManagement.detail.type }}</el-tag><el-tag effect="plain">{{ state.questionBankManagement.detail.difficulty }} · {{ state.questionBankManagement.detail.defaultScore }} 分</el-tag><el-tag effect="plain">v{{ state.questionBankManagement.detail.version }}</el-tag></div>
          <h2 class="mt-4 whitespace-pre-line text-lg font-black leading-8">{{ state.questionBankManagement.detail.stem }}</h2>
          <div v-if="state.questionBankManagement.detail.options?.length" class="mt-4 grid gap-2 sm:grid-cols-2"><div v-for="(option,index) in state.questionBankManagement.detail.options" :key="index" class="rounded border border-slate-200 px-3 py-2 text-sm dark:border-night-border">{{ String.fromCharCode(65 + index) }}. {{ option }}</div></div>
          <el-descriptions class="mt-4" :column="1" border><el-descriptions-item label="分类">{{ (state.questionBankManagement.detail.categories || []).map(categoryPathLabel).join('、') || '未分类' }}</el-descriptions-item><el-descriptions-item label="答案">{{ formatAnswer(state.questionBankManagement.detail) }}</el-descriptions-item><el-descriptions-item label="解析">{{ state.questionBankManagement.detail.explanation || '未填写' }}</el-descriptions-item><el-descriptions-item label="知识点">{{ (state.questionBankManagement.detail.knowledge || []).join('、') || '未设置' }}</el-descriptions-item><el-descriptions-item label="原始来源">{{ originLabel(state.questionBankManagement.detail.origin) }}</el-descriptions-item></el-descriptions>
          <el-tabs class="mt-4">
            <el-tab-pane :label="`使用记录 ${state.questionBankManagement.detail.usages?.length || 0}`"><el-table :data="state.questionBankManagement.detail.usages || []" size="small" empty-text="尚未关联试卷"><el-table-column prop="paperName" label="试卷" min-width="200" /><el-table-column prop="relation" label="关系" min-width="140" /><el-table-column prop="status" label="状态" width="100" /><el-table-column prop="questionCount" label="题数" width="80" /><el-table-column label="时间" min-width="160"><template #default="{ row }">{{ formatDateTime(row.publishedAt || row.createdAt) }}</template></el-table-column></el-table></el-tab-pane>
            <el-tab-pane :label="`版本记录 ${state.questionBankManagement.detail.revisions?.length || 0}`"><el-table :data="state.questionBankManagement.detail.revisions || []" size="small"><el-table-column label="版本" width="80"><template #default="{ row }">v{{ row.version }}</template></el-table-column><el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip /><el-table-column prop="createdBy" label="修改人" width="110" /><el-table-column label="时间" min-width="160"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column></el-table></el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>

    <el-drawer v-model="state.questionBankManagement.categoryDrawerOpen" append-to-body size="min(340px, 88vw)" title="题库分类">
      <el-button class="mb-3 w-full" :icon="FolderAdd" @click="openCreateQuestionBankCategory('')">新建一级分类</el-button>
      <el-tree :data="categoryTreeData" node-key="id" :current-node-key="state.questionBankManagement.selectedCategoryId" highlight-current default-expand-all :expand-on-click-node="false" @node-click="handleCategoryNodeClick">
        <template #default="{ data }"><div class="category-tree-row"><span class="category-tree-label"><el-icon><Folder /></el-icon><span>{{ data.name }}</span><small>{{ data.count || 0 }}</small></span></div></template>
      </el-tree>
    </el-drawer>

    <el-dialog v-model="state.questionBankManagement.categoryEditorOpen" :title="state.questionBankManagement.categoryEditorMode === 'edit' ? '编辑分类' : '新建分类'" width="min(520px, calc(100vw - 24px))" append-to-body>
      <el-alert v-if="state.questionBankManagement.categoryFormError" class="mb-4" :title="state.questionBankManagement.categoryFormError" type="error" show-icon :closable="false" />
      <el-form label-position="top">
        <el-form-item label="分类名称"><el-input v-model="state.questionBankManagement.categoryForm.name" maxlength="80" show-word-limit /></el-form-item>
        <el-form-item label="上级分类"><el-select v-model="state.questionBankManagement.categoryForm.parentId" clearable placeholder="无，上级为题库根目录" class="w-full"><el-option v-for="category in categoryParentOptions" :key="category.id" :label="categoryPathLabel(category)" :value="category.id" /></el-select></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="state.questionBankManagement.categoryForm.sortOrder" :min="-100000" :max="100000" controls-position="right" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="state.questionBankManagement.categoryEditorOpen = false">取消</el-button><el-button type="primary" :loading="state.questionBankManagement.categorySaving" @click="saveQuestionBankCategory">保存分类</el-button></template>
    </el-dialog>

    <el-dialog v-model="state.questionBankManagement.bulkOpen" title="批量设置分类" width="min(560px, calc(100vw - 24px))" append-to-body>
      <el-alert v-if="state.questionBankManagement.bulkError" class="mb-4" :title="state.questionBankManagement.bulkError" type="error" show-icon :closable="false" />
      <el-form label-position="top">
        <el-form-item label="处理方式"><el-segmented v-model="state.questionBankManagement.bulkMode" :options="[{label:'添加',value:'add'},{label:'移除',value:'remove'},{label:'替换',value:'replace'}]" /></el-form-item>
        <el-form-item label="目标分类"><el-select v-model="state.questionBankManagement.bulkCategoryIds" multiple filterable placeholder="选择分类" class="w-full"><el-option v-for="category in bulkCategoryOptions" :key="category.id" :label="categoryPathLabel(category)" :value="category.id" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="state.questionBankManagement.bulkOpen = false">取消</el-button><el-button type="primary" :loading="state.questionBankManagement.bulkSaving" @click="applyBulkQuestionCategories">应用到 {{ state.questionBankManagement.selectedRows.length }} 道题</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.compact-stat-card :deep(.el-card__body) { padding: 10px 12px; }
.question-bank-list-card :deep(.el-card__body) { padding: 16px; }
.category-sidebar { display: none; }
.category-sidebar :deep(.el-card__body) { padding: 14px 10px; }
.category-tree-row { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 6px; padding-right: 4px; }
.category-tree-label { display: flex; min-width: 0; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
.category-tree-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.category-tree-label small { color: #94a3b8; font-weight: 800; }
.category-tree-actions { display: none; flex-shrink: 0; align-items: center; }
.category-tree-row:hover .category-tree-actions { display: flex; }
.category-tree-actions :deep(.el-button + .el-button) { margin-left: 1px; }
@media (min-width: 1280px) { .category-sidebar { display: block; } }
@media (max-width: 640px) { .question-bank-list-card :deep(.el-pagination) { justify-content: flex-start; overflow-x: auto; } }
</style>
