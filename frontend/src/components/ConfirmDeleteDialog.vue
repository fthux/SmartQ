<script setup>
import { useSmartQ } from "../stores/context.js";

const { state, deletePaper } = useSmartQ();
</script>

<template>
  <el-dialog
    :model-value="Boolean(state.confirmDeletePaper)"
    title="确认删除试卷"
    width="min(440px, calc(100vw - 24px))"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!state.deletingPaperId"
    :show-close="!state.deletingPaperId"
    @update:model-value="(value) => !value && !state.deletingPaperId && (state.confirmDeletePaper = null)"
  >
    <el-alert title="删除后无法恢复，已发布版本和试卷快照也会一并移除。" type="error" show-icon :closable="false" />
    <div class="mt-4 text-sm font-semibold leading-6">确认删除试卷「{{ state.confirmDeletePaper?.name }}」吗？</div>
    <template #footer>
      <el-button :disabled="Boolean(state.deletingPaperId)" @click="state.confirmDeletePaper = null">取消</el-button>
      <el-button type="danger" :loading="Boolean(state.deletingPaperId)" @click="deletePaper">确认删除</el-button>
    </template>
  </el-dialog>
</template>
