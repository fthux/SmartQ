<script setup>
import { View } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const { state, closePaperPrint, confirmPaperPrint, formatDateTimeWithYear } = useSmartQ();

const printModes = [
  { label: "试题卷", value: "paper" },
  { label: "答案解析", value: "answers" },
  { label: "试题及答案", value: "combined" },
];
</script>

<template>
  <el-dialog
    :model-value="state.paperPrint.dialogOpen"
    append-to-body
    width="min(520px, calc(100vw - 24px))"
    title="打印发布试卷"
    @update:model-value="(value) => !value && closePaperPrint()"
  >
    <div v-loading="state.paperPrint.loading" class="min-h-52 space-y-5">
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

        <el-form-item label="打印内容">
          <el-segmented v-model="state.paperPrint.mode" :options="printModes" class="w-full" aria-label="打印内容" />
        </el-form-item>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex h-12 items-center justify-between rounded border border-slate-200 px-3 dark:border-night-border">
            <span class="text-sm font-bold">显示题目分值</span>
            <el-switch v-model="state.paperPrint.showScores" aria-label="显示题目分值" />
          </div>
          <div class="flex h-12 items-center justify-between rounded border border-slate-200 px-3 dark:border-night-border">
            <span class="text-sm font-bold">预留答题空间</span>
            <el-switch v-model="state.paperPrint.reserveSpace" :disabled="state.paperPrint.mode === 'answers'" aria-label="预留答题空间" />
          </div>
        </div>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="closePaperPrint">取消</el-button>
      <el-button type="primary" :icon="View" :disabled="state.paperPrint.loading || !state.paperPrint.publishedAt" @click="confirmPaperPrint">打开打印预览</el-button>
    </template>
  </el-dialog>
</template>
