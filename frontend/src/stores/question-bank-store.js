import { request } from "../core/api-client.js";
import {
  buildEditedOptions,
  clampNumber,
  normalizeEditedAnswer,
  normalizeEditorOptions,
  splitList,
} from "../core/domain-utils.js";

export function createQuestionBankStore({ state, notify, authoringQuestions }) {
  async function loadQuestionBank(target = "page") {
    const management = state.questionBankManagement;
    const picker = management.picker;
    const model = target === "picker" ? picker : management;
    model.loading = true;
    model.error = "";
    try {
      const params = new URLSearchParams({ page: String(model.page), pageSize: String(model.pageSize) });
      if (model.search.trim()) params.set("search", model.search.trim());
      if (model.status) params.set("status", model.status);
      if (model.type) params.set("type", model.type);
      if (model.difficulty) params.set("difficulty", model.difficulty);
      const result = await request(`/api/question-bank?${params}`);
      model.items = result.items || [];
      model.total = Number(result.total || 0);
    } catch (error) {
      model.error = error.message || "题库加载失败";
    } finally {
      model.loading = false;
    }
  }

  function applyQuestionBankFilters() {
    state.questionBankManagement.page = 1;
    loadQuestionBank();
  }

  function changeQuestionBankPage(page) {
    state.questionBankManagement.page = page;
    loadQuestionBank();
  }

  function changeQuestionBankPageSize(size) {
    state.questionBankManagement.pageSize = size;
    state.questionBankManagement.page = 1;
    loadQuestionBank();
  }

  function resetQuestionBankForm() {
    state.questionBankManagement.editorMode = "create";
    state.questionBankManagement.editingId = null;
    state.questionBankManagement.form = emptyQuestionBankForm();
    state.questionBankManagement.formError = "";
  }

  function openCreateQuestionBankItem() {
    resetQuestionBankForm();
    state.questionBankManagement.editorOpen = true;
  }

  async function openEditQuestionBankItem(row) {
    const management = state.questionBankManagement;
    management.detailLoading = true;
    try {
      const item = await request(`/api/question-bank/${encodeURIComponent(row.id)}`);
      const options = normalizeEditorOptions(item.options, item.type);
      management.editorMode = "edit";
      management.editingId = item.id;
      management.form = {
        type: item.type,
        stem: item.stem || "",
        optionA: options[0] || "",
        optionB: options[1] || "",
        optionC: options[2] || "",
        optionD: options[3] || "",
        answerSingle: Array.isArray(item.answer) ? item.answer[0] || "A" : String(item.answer || "A"),
        answerMultiple: Array.isArray(item.answer) ? [...item.answer] : [],
        answerText: Array.isArray(item.answer) ? item.answer.join("、") : String(item.answer ?? ""),
        explanation: item.explanation || "",
        rubricText: (item.rubric || []).join("\n"),
        defaultScore: Number(item.defaultScore || 1),
        difficulty: item.difficulty || "中",
        knowledgeText: (item.knowledge || []).join("，"),
        tagsText: (item.tags || []).join("，"),
        status: item.status === "已校验" ? "已校验" : "待确认",
      };
      management.formError = "";
      management.editorOpen = true;
    } catch (error) {
      notify(`题目读取失败：${error.message}`);
    } finally {
      management.detailLoading = false;
    }
  }

  async function saveQuestionBankItem() {
    const management = state.questionBankManagement;
    const form = management.form;
    const error = validateQuestionBankForm(form);
    management.formError = error;
    if (error) return;
    management.saving = true;
    try {
      const path = management.editorMode === "edit"
        ? `/api/question-bank/${encodeURIComponent(management.editingId)}`
        : "/api/question-bank";
      await request(path, {
        method: management.editorMode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(questionBankFormPayload(form)),
      });
      management.editorOpen = false;
      await loadQuestionBank();
      notify(management.editorMode === "edit" ? "题库题目已更新" : "题库题目已创建");
    } catch (saveError) {
      management.formError = saveError.message;
    } finally {
      management.saving = false;
    }
  }

  async function openQuestionBankDetail(row) {
    const management = state.questionBankManagement;
    management.detailOpen = true;
    management.detailLoading = true;
    management.detail = null;
    try {
      management.detail = await request(`/api/question-bank/${encodeURIComponent(row.id)}`);
    } catch (error) {
      notify(`题库题目加载失败：${error.message}`);
      management.detailOpen = false;
    } finally {
      management.detailLoading = false;
    }
  }

  async function runQuestionBankAction(row, action) {
    const management = state.questionBankManagement;
    management.actionId = row.id;
    try {
      await request(`/api/question-bank/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadQuestionBank();
      notify(action === "archive" ? "题目已归档，历史试卷不受影响" : "题目已恢复");
    } catch (error) {
      notify(`${action === "archive" ? "归档" : "恢复"}失败：${error.message}`);
    } finally {
      management.actionId = null;
    }
  }

  async function addCurrentQuestionsToBank() {
    const reviewed = authoringQuestions.value.filter((item) => item.status === "已校验");
    if (!reviewed.length) {
      notify("当前试卷暂无已审核通过的题目");
      return;
    }
    const management = state.questionBankManagement;
    management.importingCurrent = true;
    try {
      const result = await request("/api/question-bank/import", {
        method: "POST",
        body: JSON.stringify({ questionIds: reviewed.map((item) => item.id) }),
      });
      notify(importResultMessage(result));
      if (state.route === "question-bank") await loadQuestionBank();
    } catch (error) {
      notify(`题目入库失败：${error.message}`);
    } finally {
      management.importingCurrent = false;
    }
  }

  async function addPaperQuestionsToBank(paper, questionIds = []) {
    if (!paper?.id) return;
    const management = state.questionBankManagement;
    management.importingPaperId = paper.id;
    try {
      const result = await request("/api/question-bank/import", {
        method: "POST",
        body: JSON.stringify({ paperId: paper.id, questionIds }),
      });
      notify(importResultMessage(result));
      if (state.route === "question-bank") await loadQuestionBank();
    } catch (error) {
      notify(`试卷题目入库失败：${error.message}`);
    } finally {
      management.importingPaperId = null;
    }
  }

  function openQuestionBankPicker() {
    const picker = state.questionBankManagement.picker;
    picker.open = true;
    picker.page = 1;
    const selectedItems = Array.isArray(state.spec.questionBankItems) ? state.spec.questionBankItems : [];
    const selectedById = new Map(selectedItems.map((item) => [item.id, { ...item }]));
    (state.spec.questionBankIds || []).forEach((id) => {
      if (!selectedById.has(id)) selectedById.set(id, { id });
    });
    picker.selection = [...selectedById.values()];
    picker.status = "已校验";
    loadQuestionBank("picker");
  }

  function applyQuestionBankPickerFilters() {
    state.questionBankManagement.picker.page = 1;
    loadQuestionBank("picker");
  }

  function changeQuestionBankPickerPage(page) {
    state.questionBankManagement.picker.page = page;
    loadQuestionBank("picker");
  }

  function setQuestionBankPickerSelection(rows) {
    const picker = state.questionBankManagement.picker;
    const pageIds = new Set((picker.items || []).map((item) => item.id));
    const retained = (picker.selection || []).filter((item) => !pageIds.has(item.id));
    const merged = new Map([...retained, ...(rows || [])].map((item) => [item.id, item]));
    picker.selection = [...merged.values()];
  }

  function addSelectedQuestionBankToAuthoring() {
    const picker = state.questionBankManagement.picker;
    const selected = (picker.selection || []).filter((item) => item?.id).map((item) => ({ ...item }));
    state.spec.questionBankIds = selected.map((item) => item.id);
    state.spec.questionBankItems = selected;
    picker.open = false;
    state.specFormErrors.questionBankIds = "";
    notify(selected.length ? `已选择 ${selected.length} 道题库题` : "已清空题库题选择");
  }

  function removeSelectedQuestionBankItem(id) {
    state.spec.questionBankIds = (state.spec.questionBankIds || []).filter((itemId) => itemId !== id);
    state.spec.questionBankItems = (state.spec.questionBankItems || []).filter((item) => item.id !== id);
    state.specFormErrors.questionBankIds = "";
  }

  return {
    addCurrentQuestionsToBank,
    addPaperQuestionsToBank,
    addSelectedQuestionBankToAuthoring,
    applyQuestionBankFilters,
    applyQuestionBankPickerFilters,
    changeQuestionBankPage,
    changeQuestionBankPageSize,
    changeQuestionBankPickerPage,
    loadQuestionBank,
    openCreateQuestionBankItem,
    openEditQuestionBankItem,
    openQuestionBankDetail,
    openQuestionBankPicker,
    removeSelectedQuestionBankItem,
    runQuestionBankAction,
    saveQuestionBankItem,
    setQuestionBankPickerSelection,
  };
}

function emptyQuestionBankForm() {
  return {
    type: "单选",
    stem: "",
    optionA: "",
    optionB: "",
    optionC: "",
    optionD: "",
    answerSingle: "A",
    answerMultiple: [],
    answerText: "",
    explanation: "",
    rubricText: "",
    defaultScore: 2,
    difficulty: "中",
    knowledgeText: "",
    tagsText: "",
    status: "待确认",
  };
}

function questionBankFormPayload(form) {
  return {
    type: form.type,
    stem: String(form.stem || "").trim(),
    options: buildEditedOptions(form),
    answer: normalizeEditedAnswer(form),
    explanation: String(form.explanation || "").trim(),
    rubric: ["简答", "论述"].includes(form.type) ? splitList(form.rubricText) : [],
    defaultScore: clampNumber(form.defaultScore, 1, 200, 1),
    difficulty: form.difficulty,
    knowledge: splitList(form.knowledgeText),
    tags: splitList(form.tagsText),
    status: form.status,
  };
}

function validateQuestionBankForm(form) {
  if (!String(form.stem || "").trim()) return "请输入题干";
  if (["单选", "多选"].includes(form.type)) {
    const options = [form.optionA, form.optionB, form.optionC, form.optionD];
    if (options.some((item) => !String(item || "").trim())) return "请完整填写 A-D 四个选项";
  }
  if (form.type === "多选" && !form.answerMultiple?.length) return "请至少选择一个正确答案";
  if (!["单选", "多选", "判断"].includes(form.type) && !String(form.answerText || "").trim()) return "请输入参考答案";
  if (["简答", "论述"].includes(form.type) && !String(form.rubricText || "").trim()) return "请输入评分规则";
  return "";
}

function importResultMessage(result = {}) {
  const parts = [`新增 ${Number(result.created || 0)} 道`, `复用 ${Number(result.reused || 0)} 道`];
  if (result.skipped) parts.push(`跳过 ${result.skipped} 道`);
  if (result.conflicts?.length) parts.push(`冲突 ${result.conflicts.length} 道`);
  return `题目入库完成：${parts.join("，")}`;
}
