<script setup>
import {
  ArrowLeft,
  Box,
  Document,
  Edit,
  Plus,
  Refresh,
  Search,
  UploadFilled,
  View,
} from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";
import { computed } from "vue";

const {
  state,
  applyMaterialFilters,
  changeMaterialPage,
  changeMaterialPageSize,
  loadMaterials,
  openCreateMaterial,
  openEditMaterial,
  openMaterialDetail,
  requestCloseMaterialEditor,
  resumeAuthoringFromMaterials,
  runMaterialAction,
  saveMaterial,
  selectMaterialFile,
  formatDateTime,
} = useSmartQ();

const statusOptions = [
  { label: "可用", value: "ready" },
  { label: "解析失败", value: "failed" },
  { label: "已归档", value: "archived" },
];
const materialFileMaxLabel = computed(() => {
  const megabytes = Number(state.systemLimits.materialFileMaxBytes || 0) / 1024 / 1024;
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
});
const hasMaterialFilters = computed(() => Boolean(state.materialManagement.search || state.materialManagement.status));

function statusLabel(status) {
  return { ready: "可用", failed: "解析失败", archived: "已归档" }[status] || status;
}

function statusType(status) {
  return { ready: "success", failed: "danger", archived: "info" }[status] || "info";
}

function formatTextLength(value) {
  const length = Number(value || 0);
  return length >= 10_000 ? `${(length / 10_000).toFixed(1)} 万字` : `${length} 字`;
}

function clearMaterialFilters() {
  state.materialManagement.search = "";
  state.materialManagement.status = "";
  applyMaterialFilters();
}
</script>

<template>
  <section class="mt-4 space-y-4" data-materials-page>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <el-button v-if="state.materialManagement.returnToAuthoring" class="mb-3" text :icon="ArrowLeft" @click="resumeAuthoringFromMaterials">返回出题配置</el-button>
        <h1 class="text-2xl font-black">出题资料管理</h1>
        <div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">维护可供 AI 命题引用的文本和文档资料</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <el-button :icon="UploadFilled" size="large" @click="openCreateMaterial('file')">导入文件</el-button>
        <el-button type="primary" :icon="Plus" size="large" @click="openCreateMaterial('text')">新建文本资料</el-button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight">{{ state.materialManagement.total }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">匹配总数</div></el-card>
      <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight text-leaf">{{ state.materialManagement.items.filter((item) => item.status === 'ready').length }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">本页可用</div></el-card>
      <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight text-iris">{{ state.materialManagement.items.reduce((sum, item) => sum + Number(item.paperUsageCount || 0), 0) }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">本页试卷引用</div></el-card>
      <el-card shadow="never" class="compact-stat-card"><div class="text-lg font-black leading-tight text-ocean">{{ state.materialManagement.items.reduce((sum, item) => sum + Number(item.revisionCount || 0), 0) }}</div><div class="mt-0.5 text-[11px] font-bold leading-tight text-slate-500 dark:text-slate-400">本页版本</div></el-card>
    </div>

    <el-card shadow="never" class="material-list-card">
      <div class="grid gap-3 border-b border-slate-200 pb-4 lg:grid-cols-[minmax(260px,1fr)_180px_auto] dark:border-night-border">
        <el-input v-model="state.materialManagement.search" clearable :prefix-icon="Search" placeholder="搜索名称、标签或文件名" @keyup.enter="applyMaterialFilters" @clear="applyMaterialFilters" />
        <el-select v-model="state.materialManagement.status" clearable placeholder="全部状态" @change="applyMaterialFilters">
          <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <div class="flex gap-2">
          <el-button type="primary" :icon="Search" @click="applyMaterialFilters">查询</el-button>
          <el-tooltip content="刷新列表"><el-button :icon="Refresh" circle aria-label="刷新出题资料" @click="loadMaterials" /></el-tooltip>
        </div>
      </div>

      <el-alert v-if="state.materialManagement.error" class="mt-4" :title="state.materialManagement.error" type="error" show-icon :closable="false" />

      <el-table v-loading="state.materialManagement.loading" :data="state.materialManagement.items" class="mt-4 w-full">
        <template #empty>
          <el-empty :description="hasMaterialFilters ? '没有符合当前条件的资料' : '还没有出题资料'">
            <el-button v-if="hasMaterialFilters" @click="clearMaterialFilters">清空筛选</el-button>
            <el-button v-else type="primary" :icon="Plus" @click="openCreateMaterial('text')">新建文本资料</el-button>
          </el-empty>
        </template>
        <el-table-column label="资料" min-width="260">
          <template #default="{ row }">
            <div class="flex min-w-0 items-start gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-50 text-leaf dark:bg-night-elevated"><el-icon><Document /></el-icon></span>
              <div class="min-w-0">
                <div class="truncate font-black">{{ row.name }}</div>
                <div class="mt-1 truncate text-xs font-semibold text-slate-400">{{ row.filename || '纯文本资料' }} · v{{ row.version }}</div>
                <div v-if="row.tags?.length" class="mt-2 flex flex-wrap gap-1"><el-tag v-for="tag in row.tags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag></div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="正文" width="110"><template #default="{ row }">{{ formatTextLength(row.textLength) }}</template></el-table-column>
        <el-table-column label="使用情况" width="130"><template #default="{ row }">{{ row.paperUsageCount }} 卷 / {{ row.questionUsageCount }} 题</template></el-table-column>
        <el-table-column label="更新时间" min-width="165"><template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" fixed="right" width="245" align="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="View" @click="openMaterialDetail(row)">查看</el-button>
            <el-button v-if="row.status !== 'archived'" link type="primary" :icon="Edit" @click="openEditMaterial(row)">编辑</el-button>
            <el-button v-if="row.status === 'failed'" link type="warning" :icon="Refresh" :loading="state.materialManagement.actionId === row.id" :disabled="state.materialManagement.actionId !== null && state.materialManagement.actionId !== row.id" @click="runMaterialAction(row, 'reparse')">重解析</el-button>
            <el-button v-if="row.status === 'archived'" link type="success" :loading="state.materialManagement.actionId === row.id" :disabled="state.materialManagement.actionId !== null && state.materialManagement.actionId !== row.id" @click="runMaterialAction(row, 'restore')">恢复</el-button>
            <el-button v-else link type="danger" :icon="Box" :loading="state.materialManagement.actionId === row.id" :disabled="state.materialManagement.actionId !== null && state.materialManagement.actionId !== row.id" @click="runMaterialAction(row, 'archive')">归档</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-night-border">
        <el-pagination
          :current-page="state.materialManagement.page"
          :page-size="state.materialManagement.pageSize"
          :page-sizes="[10, 20, 50]"
          :total="state.materialManagement.total"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="changeMaterialPage"
          @size-change="changeMaterialPageSize"
        />
      </div>
    </el-card>

    <el-dialog v-model="state.materialManagement.editorOpen" :title="state.materialManagement.editorMode === 'edit' ? '编辑出题资料' : '新建出题资料'" width="min(680px, calc(100vw - 24px))" top="5vh" append-to-body destroy-on-close :close-on-click-modal="false" :before-close="requestCloseMaterialEditor">
      <el-form label-position="top" @submit.prevent="saveMaterial">
        <el-alert v-if="state.materialManagement.formError" class="mb-4" :title="state.materialManagement.formError" type="error" show-icon :closable="false" />
        <el-segmented
          v-if="state.materialManagement.editorMode === 'create'"
          v-model="state.materialManagement.form.mode"
          class="mb-4"
          :options="[{ label: '文本资料', value: 'text' }, { label: '导入文件', value: 'file' }]"
        />
        <div class="grid gap-x-3 sm:grid-cols-2">
          <el-form-item label="资料名称"><el-input v-model="state.materialManagement.form.name" maxlength="80" show-word-limit placeholder="请输入便于识别的资料名称" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="state.materialManagement.form.tags" placeholder="多个标签使用逗号分隔" /></el-form-item>
        </div>
        <el-form-item label="资料说明"><el-input v-model="state.materialManagement.form.description" type="textarea" :rows="2" maxlength="300" show-word-limit placeholder="说明资料用途或适用范围，可选" /></el-form-item>
        <el-form-item v-if="state.materialManagement.editorMode === 'create' && state.materialManagement.form.mode === 'file'" label="资料文件">
          <el-upload drag :auto-upload="false" :limit="1" accept=".txt,.md,.pdf,.docx" :on-change="selectMaterialFile" :on-remove="() => state.materialManagement.form.file = null">
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖入文件或点击选择</div>
            <template #tip><div class="el-upload__tip">支持 TXT、MD、PDF、DOCX，单个文件不超过 {{ materialFileMaxLabel }}</div></template>
          </el-upload>
        </el-form-item>
        <el-form-item v-else label="资料正文">
          <el-input v-model="state.materialManagement.form.content" type="textarea" :rows="12" resize="vertical" placeholder="输入可用于命题的资料正文" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestCloseMaterialEditor">取消</el-button>
        <el-button type="primary" :loading="state.materialManagement.saving" @click="saveMaterial">保存资料</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="state.materialManagement.detailOpen" append-to-body size="min(760px, 100vw)" title="出题资料详情">
      <div v-loading="state.materialManagement.detailLoading" class="min-h-64">
        <template v-if="state.materialManagement.detail">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="mr-auto text-lg font-black">{{ state.materialManagement.detail.name }}</h2>
            <el-tag :type="statusType(state.materialManagement.detail.status)">{{ statusLabel(state.materialManagement.detail.status) }}</el-tag>
            <el-tag effect="plain">v{{ state.materialManagement.detail.version }}</el-tag>
          </div>
          <p v-if="state.materialManagement.detail.description" class="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{{ state.materialManagement.detail.description }}</p>
          <el-alert v-if="state.materialManagement.detail.parseError" class="mt-4" :title="state.materialManagement.detail.parseError" type="error" show-icon :closable="false" />

          <el-tabs class="mt-4">
            <el-tab-pane label="正文预览">
              <pre class="material-content-preview">{{ state.materialManagement.detail.content || '暂无可预览正文' }}</pre>
            </el-tab-pane>
            <el-tab-pane label="版本记录">
              <el-table :data="state.materialManagement.detail.revisions || []" size="small">
                <el-table-column prop="version" label="版本" width="80"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
                <el-table-column prop="filename" label="文件" min-width="180"><template #default="{ row }">{{ row.filename || '纯文本' }}</template></el-table-column>
                <el-table-column prop="textLength" label="正文" width="100"><template #default="{ row }">{{ formatTextLength(row.textLength) }}</template></el-table-column>
                <el-table-column prop="createdAt" label="创建时间" min-width="160"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="`使用记录 ${state.materialManagement.usages.length}`">
              <el-table :data="state.materialManagement.usages" size="small" empty-text="尚未被试卷引用">
                <el-table-column prop="paperName" label="试卷" min-width="200" />
                <el-table-column prop="status" label="状态" width="100" />
                <el-table-column prop="questionCount" label="引用题数" width="100" />
                <el-table-column prop="publishedAt" label="时间" min-width="160"><template #default="{ row }">{{ formatDateTime(row.publishedAt || row.createdAt) }}</template></el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>
  </section>
</template>

<style scoped>
.compact-stat-card :deep(.el-card__body) {
  padding: 10px 12px;
}

.material-list-card :deep(.el-card__body) {
  padding: 16px;
}

.material-content-preview {
  max-height: 62vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  padding: 14px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.75;
}

@media (max-width: 640px) {
  .material-list-card :deep(.el-pagination) {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
