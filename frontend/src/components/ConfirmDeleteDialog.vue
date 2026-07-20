<script setup>
import { useSmartQ } from "../stores/context.js";

const { state, deletePaper } = useSmartQ();
</script>

<template>
  <el-dialog
    :model-value="Boolean(state.confirmDeletePaper)"
    title="确认删除试卷"
    width="440px"
    @update:model-value="(value) => !value && (state.confirmDeletePaper = null)"
  >
    <div class="text-sm font-semibold leading-6">删除后该试卷会从已完成试卷列表中移除。确认删除「{{ state.confirmDeletePaper?.name }}」吗？</div>
    <template #footer>
      <el-button @click="state.confirmDeletePaper = null">取消</el-button>
      <el-button type="danger" @click="deletePaper">确认删除</el-button>
    </template>
  </el-dialog>
</template>
