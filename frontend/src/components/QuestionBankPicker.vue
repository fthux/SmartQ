<script setup>
import { Collection, Search } from "@element-plus/icons-vue";
import { computed, watch } from "vue";
import { useSmartQ } from "../stores/context.js";

const { state, totalQuestionCount, addSelectedQuestionBankToAuthoring } = useSmartQ();

const picker = computed(() => state.questionBankManagement.picker);
const leafCategories = computed(() => {
  const keyword = picker.value.search.trim().toLowerCase();
  return state.questionBankManagement.categories.filter((item) => {
    if (item.status !== "active" || !item.isLeaf) return false;
    const path = (item.path || []).map((part) => part.name).join(" / ");
    return !keyword || path.toLowerCase().includes(keyword);
  });
});
const selectedTotal = computed(() => picker.value.allocations.reduce((sum, item) => sum + Number(item.count || 0), 0));

watch([
  () => picker.value.categoryIds,
  () => picker.value.requestedCount,
  () => picker.value.allocationMode,
], syncAllocations, { deep: true });

function categoryPath(category) {
  return (category.path || []).map((item) => item.name).join(" / ") || category.name;
}

function typeCoverage(category) {
  return Object.entries(category.typeCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([type, count]) => `${type} ${count} 题`)
    .join(" · ") || "暂无可用题目";
}

function isSelected(id) {
  return picker.value.categoryIds.includes(id);
}

function toggleCategory(category, selected) {
  const ids = new Set(picker.value.categoryIds);
  if (selected) ids.add(category.id);
  else ids.delete(category.id);
  picker.value.categoryIds = [...ids];
  picker.value.error = "";
}

function allocationFor(categoryId) {
  return picker.value.allocations.find((item) => item.categoryId === categoryId);
}

function syncAllocations() {
  const ids = picker.value.categoryIds;
  const requested = Math.max(0, Number(picker.value.requestedCount || 0));
  const previous = new Map(picker.value.allocations.map((item) => [item.categoryId, Number(item.count || 0)]));
  if (!ids.length) {
    picker.value.allocations = [];
    return;
  }
  if (picker.value.allocationMode === "manual") {
    picker.value.allocations = ids.map((categoryId) => ({ categoryId, count: previous.get(categoryId) || 0 }));
    return;
  }
  const base = Math.floor(requested / ids.length);
  let remainder = requested % ids.length;
  picker.value.allocations = ids.map((categoryId) => ({ categoryId, count: base + (remainder-- > 0 ? 1 : 0) }));
}
</script>

<template>
  <el-dialog v-model="picker.open" title="设置题库题" width="min(920px, calc(100vw - 24px))" top="4vh" append-to-body destroy-on-close :close-on-click-modal="false">
    <div class="grid gap-3 border-b border-slate-200 pb-4 sm:grid-cols-[minmax(0,1fr)_180px] dark:border-night-border">
      <el-input v-model="picker.search" clearable :prefix-icon="Search" placeholder="搜索题库分类" />
      <el-input-number v-model="picker.requestedCount" :min="0" :max="totalQuestionCount" controls-position="right" class="w-full" aria-label="题库题数量" />
    </div>

    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div class="text-sm font-black">选择题库分类</div>
        <div class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">系统按题型目标自动抽题；分类题量不足时由 AI 补齐，不会阻断出题。</div>
      </div>
      <el-segmented v-model="picker.allocationMode" :options="[{ label: '自动均衡', value: 'balanced' }, { label: '手动分配', value: 'manual' }]" aria-label="分类题量分配方式" />
    </div>

    <el-alert v-if="picker.error" class="mt-3" :title="picker.error" type="error" show-icon :closable="false" />

    <div class="mt-3 overflow-hidden rounded border border-slate-200 dark:border-night-border">
      <div class="grid grid-cols-[44px_minmax(0,1fr)_92px] items-center gap-3 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 sm:grid-cols-[44px_minmax(0,1fr)_minmax(180px,0.7fr)_92px] dark:bg-night-elevated dark:text-slate-300">
        <span></span><span>分类与可用题量</span><span class="hidden sm:block">题型覆盖</span><span class="text-right">抽题数</span>
      </div>
      <div class="max-h-[430px] divide-y divide-slate-100 overflow-y-auto dark:divide-night-border">
        <div v-for="category in leafCategories" :key="category.id" class="grid grid-cols-[44px_minmax(0,1fr)_92px] items-center gap-3 px-3 py-3 hover:bg-slate-50 sm:grid-cols-[44px_minmax(0,1fr)_minmax(180px,0.7fr)_92px] dark:hover:bg-night-elevated">
          <el-checkbox :model-value="isSelected(category.id)" :aria-label="`选择${categoryPath(category)}`" @change="(value) => toggleCategory(category, value)" />
          <span class="min-w-0"><strong class="block truncate text-sm">{{ categoryPath(category) }}</strong><span class="mt-1 block text-xs font-semibold text-slate-400">可用 {{ category.count || 0 }} 题</span></span>
          <span class="hidden min-w-0 truncate text-xs font-semibold text-slate-500 sm:block dark:text-slate-400">{{ typeCoverage(category) }}</span>
          <el-input-number v-if="isSelected(category.id)" :model-value="allocationFor(category.id)?.count || 0" :disabled="picker.allocationMode === 'balanced'" :min="0" :max="picker.requestedCount" controls-position="right" size="small" class="w-[92px]" @click.prevent @update:model-value="(value) => allocationFor(category.id).count = value" />
          <span v-else class="text-right text-xs font-semibold text-slate-300">-</span>
        </div>
        <el-empty v-if="!leafCategories.length" :image-size="72" :description="picker.search ? '没有符合当前条件的分类' : '还没有可用的末级分类'" />
      </div>
    </div>

    <template #footer>
      <div class="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <span class="flex items-center gap-2 text-xs font-semibold text-slate-500"><el-icon><Collection /></el-icon>已选 {{ picker.categoryIds.length }} 个分类，计划 {{ selectedTotal }} 题，目标 {{ picker.requestedCount }} 题</span>
        <div class="flex justify-end"><el-button @click="picker.open = false">取消</el-button><el-button type="primary" @click="addSelectedQuestionBankToAuthoring">应用设置</el-button></div>
      </div>
    </template>
  </el-dialog>
</template>
