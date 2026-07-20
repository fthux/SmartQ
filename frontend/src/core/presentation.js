export function mountIcons() {
  // Element Plus icons are Vue components and update with the render cycle.
}

export function workflowStatusText(status) {
  if (status === "done") return "完成";
  if (status === "active") return "当前";
  return "待办";
}

export function displayPaperStatus(status) {
  return ["已组卷", "已保存", "未发布"].includes(status) ? "草稿" : status || "未保存";
}

export function paperStatusClass(status) {
  if (displayPaperStatus(status) === "已发布") return "bg-emerald-50 text-leaf";
  if (displayPaperStatus(status) === "草稿") return "bg-indigo-50 text-iris";
  return "bg-slate-100 text-slate-600";
}

export function displayQuestionOptions(question = {}) {
  if (question.type === "判断") return ["正确", "错误"];
  return Array.isArray(question.options) ? question.options : [];
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "未发布";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDateTimeWithYear(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDateOnly(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fieldErrorClass(message) {
  return [
    "mt-1 min-h-4 text-xs font-bold leading-4 transition-opacity",
    message ? "text-coral opacity-100" : "text-coral opacity-0",
  ];
}
