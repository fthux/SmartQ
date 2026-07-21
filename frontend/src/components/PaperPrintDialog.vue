<script setup>
import { View } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const { state, closePaperPrint, confirmPaperPrint, formatDateTimeWithYear } = useSmartQ();
</script>

<template>
  <el-dialog
    :model-value="state.paperPrint.dialogOpen"
    append-to-body
    width="min(520px, calc(100vw - 24px))"
    title="打印发布试卷"
    @update:model-value="(value) => !value && closePaperPrint()"
  >
    <div v-loading="state.paperPrint.loading" class="min-h-28 space-y-4">
      <div>
        <div class="text-base font-black">{{ state.paperPrint.paperName }}</div>
      </div>

      <el-form label-position="top">
        <el-form-item label="发布版本">
          <el-select v-model="state.paperPrint.publishedAt" class="w-full" :disabled="state.paperPrint.loading">
            <el-option
              v-for="version in state.paperPrint.versions"
              :key="version.publishedAt"
              :value="version.publishedAt"
              :label="`${formatDateTimeWithYear(version.publishedAt)} · ${version.questionCount} 题 / ${version.score} 分`"
            />
          </el-select>
        </el-form-item>

      </el-form>
    </div>

    <template #footer>
      <el-button @click="closePaperPrint">取消</el-button>
      <el-button type="primary" :icon="View" :disabled="state.paperPrint.loading || !state.paperPrint.publishedAt" @click="confirmPaperPrint">打开打印预览</el-button>
    </template>
  </el-dialog>
</template>
