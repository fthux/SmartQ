import { ElMessage } from "element-plus";
import "element-plus/theme-chalk/el-message.css";

export function createUiStore(state) {
  function notify(message, variant = "") {
    const toast = {
      id: Date.now(),
      message,
      variant: variant || toastVariant(message),
    };
    state.toast = toast;
    ElMessage({
      message,
      type: toast.variant === "error" ? "error" : toast.variant === "warning" ? "warning" : "success",
      duration: 2600,
      showClose: true,
    });
    setTimeout(() => {
      if (state.toast?.id === toast.id) state.toast = null;
    }, 2600);
  }

  function toastClass(toast = {}) {
    if (toast.variant === "error") return "border-coral/30 bg-rose-50 text-coral shadow-soft";
    if (toast.variant === "warning") return "border-amber-300 bg-amber-50 text-amber-800 shadow-soft";
    return "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-soft";
  }

  function toastIcon(toast = {}) {
    if (toast.variant === "error") return "circle-alert";
    if (toast.variant === "warning") return "triangle-alert";
    return "circle-check";
  }

  return { notify, toastClass, toastIcon };
}

function toastVariant(message = "") {
  const text = String(message || "");
  if (/失败|错误|异常|失效|过期|无权|不能|未找到/.test(text)) return "error";
  if (/提醒|请先|暂无|待|冲突|重复|尚未|已结束|风险|问题/.test(text)) return "warning";
  return "success";
}
