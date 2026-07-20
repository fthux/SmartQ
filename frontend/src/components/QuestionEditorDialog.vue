<script setup>
import { useSmartQ } from "../stores/context.js";

const { state, closeQuestionEditor, saveQuestionEdit } = useSmartQ();
const letters = ["A", "B", "C", "D"];
</script>

<template>
  <el-dialog
    :model-value="Boolean(state.editingQuestion && state.questionEditForm)"
    title="编辑题目"
    width="760px"
    top="5vh"
    @update:model-value="(value) => !value && closeQuestionEditor()"
  >
    <div class="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
      <span>保存后题目会回到待确认状态</span>
      <el-tag v-if="state.editingQuestion?.origin?.type === 'material'" size="small" type="success" effect="plain">资料题，保存后标记为已人工修改</el-tag>
      <el-tag v-else size="small" type="info" effect="plain">AI 独立生成</el-tag>
    </div>
    <el-form v-if="state.questionEditForm" label-position="top" @submit.prevent="saveQuestionEdit">
      <div class="grid gap-x-3 sm:grid-cols-[120px_150px_1fr]">
        <el-form-item label="题型"><el-input v-model="state.questionEditForm.type" disabled /></el-form-item>
        <el-form-item label="分值"><el-input-number v-model="state.questionEditForm.score" :min="1" :max="200" controls-position="right" class="w-full" /></el-form-item>
        <el-form-item label="难度"><el-input v-model="state.questionEditForm.difficulty" disabled /></el-form-item>
      </div>
      <el-form-item label="题干" :error="state.questionEditErrors.stem"><el-input v-model="state.questionEditForm.stem" type="textarea" :rows="4" /></el-form-item>
      <div v-if="['单选','多选'].includes(state.questionEditForm.type)" class="grid gap-x-3 sm:grid-cols-2">
        <el-form-item v-for="letter in letters" :key="letter" :label="letter" :error="state.questionEditErrors['option' + letter]">
          <el-input v-model="state.questionEditForm['option' + letter]" />
        </el-form-item>
      </div>
      <div class="grid gap-x-3 sm:grid-cols-2">
        <el-form-item v-if="state.questionEditForm.type === '单选'" label="答案">
          <el-select v-model="state.questionEditForm.answerSingle" class="w-full"><el-option v-for="letter in letters" :key="letter" :label="letter" :value="letter" /></el-select>
        </el-form-item>
        <el-form-item v-else-if="state.questionEditForm.type === '判断'" label="答案">
          <el-radio-group v-model="state.questionEditForm.answerSingle"><el-radio-button label="正确" value="正确" /><el-radio-button label="错误" value="错误" /></el-radio-group>
        </el-form-item>
        <el-form-item v-else-if="state.questionEditForm.type === '多选'" label="答案" :error="state.questionEditErrors.answerMultiple">
          <el-checkbox-group v-model="state.questionEditForm.answerMultiple"><el-checkbox-button v-for="letter in letters" :key="letter" :label="letter" :value="letter" /></el-checkbox-group>
        </el-form-item>
        <el-form-item v-else label="答案" :error="state.questionEditErrors.answerText"><el-input v-model="state.questionEditForm.answerText" /></el-form-item>
        <el-form-item label="解析"><el-input v-model="state.questionEditForm.explanation" /></el-form-item>
        <el-form-item v-if="['简答','论述'].includes(state.questionEditForm.type)" label="评分规则" :error="state.questionEditErrors.rubricText">
          <el-input v-model="state.questionEditForm.rubricText" type="textarea" :rows="4" placeholder="每行或使用逗号分隔一条评分规则" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="closeQuestionEditor">取消</el-button>
      <el-button type="primary" @click="saveQuestionEdit">保存修改</el-button>
    </template>
  </el-dialog>
</template>
