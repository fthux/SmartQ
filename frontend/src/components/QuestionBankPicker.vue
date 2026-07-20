<script setup>
import { Search } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  addSelectedQuestionBankToAuthoring,
  applyQuestionBankPickerFilters,
  changeQuestionBankPickerPage,
  setQuestionBankPickerSelection,
} = useSmartQ();

const questionTypes = ["单选", "多选", "判断", "填空", "简答", "论述"];
</script>

<template>
  <el-dialog v-model="state.questionBankManagement.picker.open" title="从题库选择题目" width="900px" top="4vh" append-to-body destroy-on-close>
    <div class="grid gap-3 border-b border-slate-200 pb-4 md:grid-cols-[minmax(240px,1fr)_140px_130px_auto] dark:border-night-border">
      <el-input v-model="state.questionBankManagement.picker.search" clearable :prefix-icon="Search" placeholder="搜索题干、知识点或编号" @keyup.enter="applyQuestionBankPickerFilters" @clear="applyQuestionBankPickerFilters" />
      <el-select v-model="state.questionBankManagement.picker.type" clearable placeholder="全部题型" @change="applyQuestionBankPickerFilters"><el-option v-for="type in questionTypes" :key="type" :label="type" :value="type" /></el-select>
      <el-select v-model="state.questionBankManagement.picker.difficulty" clearable placeholder="全部难度" @change="applyQuestionBankPickerFilters"><el-option v-for="difficulty in ['易','中','难','混合']" :key="difficulty" :label="difficulty" :value="difficulty" /></el-select>
      <el-button type="primary" :icon="Search" @click="applyQuestionBankPickerFilters">查询</el-button>
    </div>
    <el-alert v-if="state.questionBankManagement.picker.error" class="mt-4" :title="state.questionBankManagement.picker.error" type="error" show-icon :closable="false" />
    <el-table v-loading="state.questionBankManagement.picker.loading" :data="state.questionBankManagement.picker.items" row-key="id" class="mt-4" max-height="480" empty-text="暂无可用题目" @selection-change="setQuestionBankPickerSelection">
      <el-table-column type="selection" width="48" />
      <el-table-column prop="type" label="题型" width="78" />
      <el-table-column prop="stem" label="题干" min-width="320" show-overflow-tooltip />
      <el-table-column prop="difficulty" label="难度" width="68" />
      <el-table-column label="知识点" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ (row.knowledge || []).join('、') || '未设置' }}</template></el-table-column>
      <el-table-column label="分值" width="68" align="right"><template #default="{ row }">{{ row.defaultScore }}</template></el-table-column>
      <el-table-column label="使用" width="76" align="right"><template #default="{ row }">{{ row.paperUsageCount }} 卷</template></el-table-column>
    </el-table>
    <div class="mt-4 flex justify-end"><el-pagination :current-page="state.questionBankManagement.picker.page" :page-size="state.questionBankManagement.picker.pageSize" :total="state.questionBankManagement.picker.total" layout="total, prev, pager, next" background @current-change="changeQuestionBankPickerPage" /></div>
    <template #footer><div class="flex items-center justify-between gap-3"><span class="text-xs font-semibold text-slate-500">已选择 {{ state.questionBankManagement.picker.selection.length }} 道；加入时会自动跳过当前试卷中的重复题</span><div><el-button @click="state.questionBankManagement.picker.open = false">取消</el-button><el-button type="primary" :loading="state.questionBankManagement.picker.importing" @click="addSelectedQuestionBankToAuthoring">加入当前试卷</el-button></div></div></template>
  </el-dialog>
</template>
