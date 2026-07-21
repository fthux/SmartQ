<script setup>
import { computed, nextTick, ref } from "vue";
import { useSmartQ } from "../stores/context.js";

const { state, closePaperRename, renamePaper } = useSmartQ();
const nameInput = ref(null);
const normalizedName = computed(() => String(state.paperRename.name || "").trim());
const originalName = computed(() => String(state.paperRename.target?.name || "").trim());
const submitDisabled = computed(() => !normalizedName.value || normalizedName.value === originalName.value || normalizedName.value.length > 80);

function focusNameInput() {
  nextTick(() => {
    nameInput.value?.focus();
    nameInput.value?.select();
  });
}

function updateName(value) {
  state.paperRename.name = value;
  state.paperRename.error = "";
}
</script>

<template>
  <el-dialog
    :model-value="state.paperRename.open"
    title="修改试卷名称"
    width="min(480px, calc(100vw - 24px))"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="!state.paperRename.saving"
    :show-close="!state.paperRename.saving"
    aria-label="修改试卷名称"
    @opened="focusNameInput"
    @update:model-value="(value) => !value && closePaperRename()"
  >
    <form @submit.prevent="renamePaper">
      <el-form-item label="试卷名称" :error="state.paperRename.error">
        <el-input
          ref="nameInput"
          :model-value="state.paperRename.name"
          maxlength="80"
          show-word-limit
          placeholder="请输入试卷名称"
          :disabled="state.paperRename.saving"
          @update:model-value="updateName"
        />
      </el-form-item>
      <el-alert
        v-if="state.paperRename.target?.status === '已发布'"
        class="mt-3"
        title="历史发布版本的名称不会随本次修改变化"
        type="info"
        show-icon
        :closable="false"
      />
    </form>
    <template #footer>
      <el-button :disabled="state.paperRename.saving" @click="closePaperRename">取消</el-button>
      <el-button type="primary" :loading="state.paperRename.saving" :disabled="submitDisabled" @click="renamePaper">保存</el-button>
    </template>
  </el-dialog>
</template>
