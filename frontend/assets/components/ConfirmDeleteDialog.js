import { useSmartQ } from "../stores/context.js";

export const ConfirmDeleteDialog = {
  name: "ConfirmDeleteDialog",
  setup: useSmartQ,
  template: `
    <div v-if="state.confirmDeletePaper" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
        <div class="text-lg font-black">确认删除试卷</div>
        <div class="mt-2 text-sm font-semibold leading-6 text-slate-600">删除后该试卷会从已完成试卷列表中移除。确认删除「{{ state.confirmDeletePaper.name }}」吗？</div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="state.confirmDeletePaper = null">取消</button>
          <button class="rounded-lg bg-coral px-4 py-2 text-sm font-bold text-white" @click="deletePaper">确认删除</button>
        </div>
      </div>
    </div>
  `,
};
