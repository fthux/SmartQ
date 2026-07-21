<script setup>
import { Delete, Edit, Plus, Printer, Search, View } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  isSuperAdmin,
  contentCreators,
  paperRows,
  papers,
  filteredPaperRows,
  pagedPaperRows,
  currentPaperPage,
  go,
  selectPaper,
  editPaper,
  canPrintPaper,
  openPaperPrint,
  askDeletePaper,
  resetPaperPage,
  displayPaperStatus,
  formatDateTime,
} = useSmartQ();

const statusOptions = [
  { value: "all", label: "全部" },
  { value: "unpublished", label: "草稿" },
  { value: "published", label: "已发布" },
];

function statusTagType(status) {
  return displayPaperStatus(status) === "已发布" ? "success" : "info";
}

function onRowDoubleClick(row) {
  selectPaper(row.id);
}

function onPageSizeChange(size) {
  state.paperPageSize = size;
  resetPaperPage();
}

function clearPaperFilters() {
  state.paperSearch = "";
  state.paperStatusFilter = "all";
  state.paperOwnerFilter = "";
  resetPaperPage();
}
</script>

<template>
  <section class="mt-4 space-y-4">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-black">试卷管理</h1>
        <div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">集中管理草稿和已发布试卷</div>
      </div>
      <el-button type="primary" :icon="Plus" size="large" @click="go('authoring')">新建试卷</el-button>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <el-card shadow="never"><div class="metric-value text-xl font-black">{{ paperRows.length }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">全部试卷</div></el-card>
      <el-card shadow="never"><div class="metric-value text-xl font-black text-leaf">{{ papers.filter((item) => item.status === '已发布').length }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">已发布</div></el-card>
      <el-card shadow="never"><div class="metric-value text-xl font-black text-iris">{{ papers.filter((item) => ['草稿','未发布','已保存','已组卷'].includes(item.status)).length }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">草稿</div></el-card>
      <el-card shadow="never"><div class="metric-value text-xl font-black text-ocean">{{ paperRows.reduce((sum, item) => sum + Number(item.questionCount || 0), 0) }}</div><div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">累计题数</div></el-card>
    </div>

    <el-card shadow="never" class="paper-list-card">
      <div class="flex flex-col gap-3 border-b border-slate-200 pb-4 xl:flex-row xl:items-center xl:justify-between dark:border-night-border">
        <el-input v-model="state.paperSearch" class="w-full xl:max-w-md" placeholder="搜索试卷名称、编号或创建者" clearable :prefix-icon="Search" @input="resetPaperPage" />
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <el-select v-if="isSuperAdmin" v-model="state.paperOwnerFilter" clearable filterable class="sm:w-52" placeholder="全部创建者" @change="resetPaperPage">
            <el-option v-for="creator in contentCreators" :key="creator.id" :label="`${creator.displayName} (${creator.username})`" :value="creator.id" />
          </el-select>
          <el-segmented v-model="state.paperStatusFilter" :options="statusOptions" aria-label="试卷状态筛选" @change="resetPaperPage" />
          <el-select v-model="state.paperSort" class="sm:w-36" aria-label="试卷排序" @change="resetPaperPage">
            <el-option label="最近更新" value="latest" />
            <el-option label="最早创建" value="oldest" />
            <el-option label="按名称" value="name" />
          </el-select>
        </div>
      </div>

      <el-table :data="pagedPaperRows" class="mt-4 w-full" @row-dblclick="onRowDoubleClick">
        <template #empty>
          <el-empty :description="state.paperSearch || state.paperStatusFilter !== 'all' ? '没有符合当前条件的试卷' : '还没有试卷'">
            <el-button v-if="state.paperSearch || state.paperStatusFilter !== 'all'" @click="clearPaperFilters">清空筛选</el-button>
            <el-button v-else type="primary" :icon="Plus" @click="go('authoring')">新建试卷</el-button>
          </el-empty>
        </template>
        <el-table-column label="试卷名称" min-width="250">
          <template #default="{ row }">
            <div class="font-black text-ink dark:text-slate-100">{{ row.name }}</div>
            <div class="mt-1 text-xs font-semibold text-slate-400">{{ row.id }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag :type="statusTagType(row.status)" effect="light">{{ displayPaperStatus(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="创建者" min-width="150"><template #default="{ row }"><span class="font-semibold">{{ row.creator?.displayName || '-' }}</span><div v-if="row.creator?.username" class="mt-1 text-xs text-slate-400">{{ row.creator.username }}</div></template></el-table-column>
        <el-table-column label="题数" prop="questionCount" width="90"><template #default="{ row }">{{ row.questionCount || 0 }} 题</template></el-table-column>
        <el-table-column label="总分" prop="score" width="90"><template #default="{ row }">{{ row.score || 0 }} 分</template></el-table-column>
        <el-table-column label="更新时间" min-width="150"><template #default="{ row }">{{ formatDateTime(row.updatedAt || row.publishedAt || row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" fixed="right" width="300" align="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="editPaper(row)">编辑</el-button>
            <el-button link :icon="View" @click="selectPaper(row.id)">预览</el-button>
            <el-button v-if="canPrintPaper(row)" link :icon="Printer" @click="openPaperPrint(row)">打印</el-button>
            <el-button link type="danger" :icon="Delete" @click="askDeletePaper(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="paperRows.length" class="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-night-border">
        <el-pagination
          v-model:current-page="state.paperPage"
          :page-size="state.paperPageSize"
          :page-sizes="[10, 20, 50]"
          :total="filteredPaperRows.length"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="onPageSizeChange"
        />
      </div>
    </el-card>
  </section>
</template>

<style scoped>
.paper-list-card :deep(.el-card__body) {
  padding: 16px;
}

@media (max-width: 640px) {
  .paper-list-card :deep(.el-pagination) {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
