<script setup>
import { Search } from "@element-plus/icons-vue";
import { nextTick, ref, watch } from "vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  addSelectedQuestionBankToAuthoring,
  applyQuestionBankPickerFilters,
  changeQuestionBankPickerPage,
  setQuestionBankPickerSelection,
} = useSmartQ();

const questionTypes = ["单选", "多选", "判断", "填空", "简答", "论述"];
const tableRef = ref(null);
let restoringSelection = false;

watch([
  () => state.questionBankManagement.picker.open,
  () => state.questionBankManagement.picker.items,
], async ([open]) => {
  if (!open) return;
  restoringSelection = true;
  await nextTick();
  const selectedIds = new Set((state.questionBankManagement.picker.selection || []).map((item) => item.id));
  tableRef.value?.clearSelection();
  (state.questionBankManagement.picker.items || []).forEach((item) => {
    if (selectedIds.has(item.id)) tableRef.value?.toggleRowSelection(item, true);
  });
  await nextTick();
  restoringSelection = false;
}, { deep: true });

function handleSelectionChange(rows) {
  if (!restoringSelection) setQuestionBankPickerSelection(rows);
}
</script>

<template>
  <el-dialog v-model="state.questionBankManagement.picker.open" title="从题库选择题目" width="min(900px, calc(100vw - 24px))" top="4vh" append-to-body destroy-on-close>
    <div class="grid gap-3 border-b border-slate-200 pb-4 md:grid-cols-[minmax(240px,1fr)_140px_130px_auto] dark:border-night-border">
      <el-input v-model="state.questionBankManagement.picker.search" clearable :prefix-icon="Search" placeholder="搜索题干、知识点或编号" @keyup.enter="applyQuestionBankPickerFilters" @clear="applyQuestionBankPickerFilters" />
      <el-select v-model="state.questionBankManagement.picker.type" clearable placeholder="全部题型" @change="applyQuestionBankPickerFilters"><el-option v-for="type in questionTypes" :key="type" :label="type" :value="type" /></el-select>
      <el-select v-model="state.questionBankManagement.picker.difficulty" clearable placeholder="全部难度" @change="applyQuestionBankPickerFilters"><el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" /></el-select>
      <el-button type="primary" :icon="Search" @click="applyQuestionBankPickerFilters">查询</el-button>
    </div>
    <el-alert v-if="state.questionBankManagement.picker.error" class="mt-4" :title="state.questionBankManagement.picker.error" type="error" show-icon :closable="false" />
    <el-table ref="tableRef" v-loading="state.questionBankManagement.picker.loading" :data="state.questionBankManagement.picker.items" row-key="id" class="mt-4" max-height="480" empty-text="暂无可用题目" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="48" />
      <el-table-column prop="type" label="题型" width="78" />
      <el-table-column prop="stem" label="题干" min-width="320" show-overflow-tooltip />
      <el-table-column prop="difficulty" label="难度" width="68" />
      <el-table-column label="知识点" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ (row.knowledge || []).join('、') || '未设置' }}</template></el-table-column>
      <el-table-column label="分值" width="68" align="right"><template #default="{ row }">{{ row.defaultScore }}</template></el-table-column>
      <el-table-column label="使用" width="76" align="right"><template #default="{ row }">{{ row.paperUsageCount }} 卷</template></el-table-column>
    </el-table>
    <div class="mt-4 flex justify-end"><el-pagination :current-page="state.questionBankManagement.picker.page" :page-size="state.questionBankManagement.picker.pageSize" :total="state.questionBankManagement.picker.total" layout="total, prev, pager, next" background @current-change="changeQuestionBankPickerPage" /></div>
    <template #footer><div class="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center"><span class="text-xs font-semibold text-slate-500">已选择 {{ state.questionBankManagement.picker.selection.length }} 道，翻页后选择仍会保留</span><div class="flex justify-end"><el-button @click="state.questionBankManagement.picker.open = false">取消</el-button><el-button type="primary" @click="addSelectedQuestionBankToAuthoring">确认选择</el-button></div></div></template>
  </el-dialog>
</template>
