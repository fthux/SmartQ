import { useSmartQ } from "../stores/context.js";

export const ToastMessage = {
  name: "ToastMessage",
  setup: useSmartQ,
  template: `
    <div v-if="state.toast" class="fixed right-4 top-4 z-[100] flex max-w-[min(420px,calc(100vw-32px))] items-start gap-3 rounded-lg border px-4 py-3 text-sm font-bold md:right-8 md:top-8" :class="toastClass(state.toast)">
      <i :data-lucide="toastIcon(state.toast)" class="mt-0.5 h-4 w-4 shrink-0"></i>
      <span class="leading-5">{{ state.toast.message }}</span>
    </div>
  `,
};
