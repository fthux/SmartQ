export function splitList(value) {
  return String(value || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeEditorOptions(options, type) {
  if (type === "判断") return ["正确", "错误", "", ""];
  const normalized = Array.isArray(options) ? options.map((item) => String(item || "")) : [];
  return [0, 1, 2, 3].map((index) => normalized[index] || "");
}

export function buildEditedOptions(form) {
  if (form.type === "判断") return ["正确", "错误"];
  if (["单选", "多选"].includes(form.type)) {
    return [form.optionA, form.optionB, form.optionC, form.optionD].map((item) => String(item || "").trim());
  }
  return [];
}

export function normalizeEditedAnswer(form) {
  if (form.type === "多选") return Array.isArray(form.answerMultiple) ? [...form.answerMultiple].sort() : [];
  if (form.type === "单选") return String(form.answerSingle || "A").trim().toUpperCase();
  if (form.type === "判断") return ["正确", "错误"].includes(form.answerSingle) ? form.answerSingle : "正确";
  return String(form.answerText ?? "").trim();
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
