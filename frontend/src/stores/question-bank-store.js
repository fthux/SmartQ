import { request } from "../core/api-client.js";
import { ElMessageBox } from "element-plus";
import "element-plus/theme-chalk/el-message-box.css";
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
      const categoryId = String(management.selectedCategoryId || "all");
      if (categoryId) params.set("categoryId", categoryId);
      const result = await request(`/api/question-bank?${params}`);
      model.items = result.items || [];
      model.total = Number(result.total || 0);
    } catch (error) {
      model.error = error.message || "题库加载失败";
    } finally {
      model.loading = false;
    }
  }

  async function loadQuestionBankCategories() {
    const management = state.questionBankManagement;
    management.categoriesLoading = true;
    try {
      const result = await request("/api/question-bank/categories");
      management.categories = result.items || [];
      management.categoryTree = result.tree || [];
      management.categoryCounts = result.counts || { all: 0, unclassified: 0, multi: 0, archived: 0 };
      if (management.selectedCategoryId && !["all", "unclassified", "multi", "archived"].includes(management.selectedCategoryId)
        && !management.categories.some((item) => item.id === management.selectedCategoryId)) {
        management.selectedCategoryId = "all";
      }
    } catch (error) {
      management.error = error.message || "题库分类加载失败";
    } finally {
      management.categoriesLoading = false;
    }
  }

  function selectQuestionBankCategory(id) {
    state.questionBankManagement.selectedCategoryId = id || "all";
    state.questionBankManagement.categoryDrawerOpen = false;
    state.questionBankManagement.page = 1;
    state.questionBankManagement.selectedRows = [];
    loadQuestionBank();
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
    state.questionBankManagement.formInitial = questionBankFormFingerprint(state.questionBankManagement.form);
    state.questionBankManagement.formError = "";
  }

  function openCreateQuestionBankItem() {
    resetQuestionBankForm();
    const selected = state.questionBankManagement.categories.find((item) => item.id === state.questionBankManagement.selectedCategoryId && item.status === "active" && item.isLeaf);
    if (selected) state.questionBankManagement.form.categoryIds = [selected.id];
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
        categoryIds: [...(item.categoryIds || [])],
      };
      management.formInitial = questionBankFormFingerprint(management.form);
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
      await loadQuestionBankCategories();
      notify(management.editorMode === "edit" ? "题库题目已更新" : "题库题目已创建");
    } catch (saveError) {
      management.formError = saveError.message;
    } finally {
      management.saving = false;
    }
  }

  async function requestCloseQuestionBankEditor(done) {
    const management = state.questionBankManagement;
    if (management.saving) return;
    if (questionBankFormFingerprint(management.form) !== management.formInitial) {
      try {
        await ElMessageBox.confirm("当前题库题目尚未保存，关闭后修改会丢失。", "放弃未保存修改", {
          confirmButtonText: "放弃修改",
          cancelButtonText: "继续编辑",
          type: "warning",
        });
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        throw error;
      }
    }
    if (typeof done === "function") done();
    else management.editorOpen = false;
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
    const archiving = action === "archive";
    const actionLabel = archiving ? "归档" : "恢复";
    const stem = String(row?.stem || row?.id || "该题目").trim();
    const displayStem = stem.length > 60 ? `${stem.slice(0, 60)}...` : stem;
    try {
      await ElMessageBox.confirm(
        archiving
          ? `确认归档题目“${displayStem}”？归档后不会影响历史试卷，但不能再用于新的组卷。`
          : `确认恢复题目“${displayStem}”？恢复后该题目将重新进入可用题库。`,
        `确认${actionLabel}`,
        {
          confirmButtonText: `确认${actionLabel}`,
          cancelButtonText: "取消",
          type: archiving ? "warning" : "info",
        },
      );
      management.actionId = row.id;
      await request(`/api/question-bank/${encodeURIComponent(row.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadQuestionBank();
      await loadQuestionBankCategories();
      notify(action === "archive" ? "题目已归档，历史试卷不受影响" : "题目已恢复");
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      notify(`${actionLabel}失败：${error.message || error}`);
    } finally {
      management.actionId = null;
    }
  }

  async function addCurrentQuestionsToBank() {
    const currentQuestions = authoringQuestions.value;
    if (!currentQuestions.length) {
      notify("当前试卷暂无可入库题目");
      return;
    }
    const management = state.questionBankManagement;
    const categoryId = String(management.paperImportCategoryId || "");
    if (!categoryId) {
      notify("请先选择题目入库分类");
      return;
    }
    management.importingCurrent = true;
    try {
      const result = await request("/api/question-bank/import", {
        method: "POST",
        body: JSON.stringify({ questionIds: currentQuestions.map((item) => item.id), categoryId }),
      });
      notify(importResultMessage(result));
      if (state.route === "question-bank") await loadQuestionBank();
      await loadQuestionBankCategories();
    } catch (error) {
      notify(`题目入库失败：${error.message}`);
    } finally {
      management.importingCurrent = false;
    }
  }

  async function addPaperQuestionsToBank(paper, questionIds = []) {
    if (!paper?.id) return;
    const management = state.questionBankManagement;
    const categoryId = String(management.paperImportCategoryId || "");
    if (!categoryId) {
      notify("请先选择题目入库分类");
      return;
    }
    management.importingPaperId = paper.id;
    try {
      const result = await request("/api/question-bank/import", {
        method: "POST",
        body: JSON.stringify({ paperId: paper.id, questionIds, categoryId }),
      });
      notify(importResultMessage(result));
      if (state.route === "question-bank") await loadQuestionBank();
      await loadQuestionBankCategories();
    } catch (error) {
      notify(`试卷题目入库失败：${error.message}`);
    } finally {
      management.importingPaperId = null;
    }
  }

  function openQuestionBankPicker() {
    const picker = state.questionBankManagement.picker;
    picker.open = true;
    picker.search = "";
    picker.error = "";
    picker.categoryIds = [...(state.spec.questionBankCategoryIds || [])];
    picker.requestedCount = Number(state.spec.questionBankRequestedCount || 0);
    picker.allocationMode = state.spec.questionBankAllocationMode === "manual" ? "manual" : "balanced";
    picker.allocations = (state.spec.questionBankAllocations || []).map((item) => ({ ...item }));
  }

  function addSelectedQuestionBankToAuthoring() {
    const picker = state.questionBankManagement.picker;
    const requestedCount = clampNumber(picker.requestedCount, 0, 100, 0);
    const categoryIds = [...new Set((picker.categoryIds || []).map(String).filter(Boolean))];
    if (requestedCount > 0 && !categoryIds.length) {
      picker.error = "请选择至少一个题库分类";
      return;
    }
    const allocationMode = picker.allocationMode === "manual" ? "manual" : "balanced";
    const allocations = categoryIds.map((categoryId) => ({
      categoryId,
      count: clampNumber((picker.allocations || []).find((item) => item.categoryId === categoryId)?.count, 0, requestedCount, 0),
    }));
    if (allocationMode === "manual" && allocations.reduce((sum, item) => sum + item.count, 0) !== requestedCount) {
      picker.error = `手动分配题量合计应为 ${requestedCount} 道`;
      return;
    }
    state.spec.questionBankIds = [];
    state.spec.questionBankItems = [];
    state.spec.questionBankRequestedCount = requestedCount;
    state.spec.questionBankCategoryIds = requestedCount > 0 ? categoryIds : [];
    state.spec.questionBankAllocationMode = allocationMode;
    state.spec.questionBankAllocations = requestedCount > 0 ? allocations : [];
    picker.open = false;
    state.specFormErrors.questionBankIds = "";
    notify(requestedCount ? `已设置从 ${categoryIds.length} 个分类抽取 ${requestedCount} 道题库题` : "已清空题库题配置");
  }

  function removeSelectedQuestionBankItem(id) {
    state.spec.questionBankIds = (state.spec.questionBankIds || []).filter((itemId) => itemId !== id);
    state.spec.questionBankItems = (state.spec.questionBankItems || []).filter((item) => item.id !== id);
    state.specFormErrors.questionBankIds = "";
  }

  async function clearQuestionBankPlan() {
    if (Number(state.spec.questionBankRequestedCount || 0) > 0) {
      try {
        await ElMessageBox.confirm("清空后已选择的题库分类、题量和分配设置都会移除。确认清空题库题配置？", "清空题库题配置", {
          confirmButtonText: "确认清空",
          cancelButtonText: "取消",
          type: "warning",
        });
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        throw error;
      }
    }
    state.spec.questionBankIds = [];
    state.spec.questionBankItems = [];
    state.spec.questionBankRequestedCount = 0;
    state.spec.questionBankCategoryIds = [];
    state.spec.questionBankAllocations = [];
    state.specFormErrors.questionBankIds = "";
  }

  function setQuestionBankRows(rows) {
    state.questionBankManagement.selectedRows = Array.isArray(rows) ? rows : [];
  }

  function openCreateQuestionBankCategory(parentId = "") {
    const management = state.questionBankManagement;
    management.categoryEditorMode = "create";
    management.categoryEditingId = "";
    management.categoryForm = { name: "", parentId: String(parentId || ""), sortOrder: 0 };
    management.categoryFormInitial = questionBankFormFingerprint(management.categoryForm);
    management.categoryFormError = "";
    management.categoryEditorOpen = true;
  }

  function openEditQuestionBankCategory(category) {
    const management = state.questionBankManagement;
    management.categoryEditorMode = "edit";
    management.categoryEditingId = category.id;
    management.categoryForm = { name: category.name, parentId: category.parentId || "", sortOrder: Number(category.sortOrder || 0) };
    management.categoryFormInitial = questionBankFormFingerprint(management.categoryForm);
    management.categoryFormError = "";
    management.categoryEditorOpen = true;
  }

  async function saveQuestionBankCategory() {
    const management = state.questionBankManagement;
    const name = String(management.categoryForm.name || "").trim();
    if (!name) {
      management.categoryFormError = "请输入分类名称";
      return;
    }
    management.categorySaving = true;
    management.categoryFormError = "";
    try {
      const editing = management.categoryEditorMode === "edit";
      await request(editing ? `/api/question-bank/categories/${encodeURIComponent(management.categoryEditingId)}` : "/api/question-bank/categories", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ ...management.categoryForm, name }),
      });
      management.categoryEditorOpen = false;
      await loadQuestionBankCategories();
      await loadQuestionBank();
      notify(editing ? "分类已更新" : "分类已创建");
    } catch (error) {
      management.categoryFormError = error.message;
    } finally {
      management.categorySaving = false;
    }
  }

  async function requestCloseQuestionBankCategoryEditor(done) {
    const management = state.questionBankManagement;
    if (management.categorySaving) return;
    if (questionBankFormFingerprint(management.categoryForm) !== management.categoryFormInitial) {
      try {
        await ElMessageBox.confirm("当前分类信息尚未保存，关闭后修改会丢失。", "放弃未保存修改", {
          confirmButtonText: "放弃修改",
          cancelButtonText: "继续编辑",
          type: "warning",
        });
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        throw error;
      }
    }
    if (typeof done === "function") done();
    else management.categoryEditorOpen = false;
  }

  async function runQuestionBankCategoryAction(category, action) {
    const management = state.questionBankManagement;
    const archiving = action === "archive";
    try {
      await ElMessageBox.confirm(
        archiving
          ? `确认归档分类“${category.name}”及其子分类？归档后这些分类不能用于新的题库抽题。`
          : `确认恢复分类“${category.name}”及其子分类？恢复后其中的末级分类将重新可选。`,
        archiving ? "归档题库分类" : "恢复题库分类",
        {
          confirmButtonText: archiving ? "确认归档" : "确认恢复",
          cancelButtonText: "取消",
          type: archiving ? "warning" : "info",
        },
      );
      management.categoryActionId = category.id;
      await request(`/api/question-bank/categories/${encodeURIComponent(category.id)}/${action}`, { method: "POST", body: JSON.stringify({}) });
      await loadQuestionBankCategories();
      await loadQuestionBank();
      notify(action === "archive" ? "分类及其子分类已归档" : "分类及其子分类已恢复");
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      notify(`${action === "archive" ? "归档" : "恢复"}分类失败：${error.message}`);
    } finally {
      management.categoryActionId = "";
    }
  }

  function openBulkQuestionCategories(mode = "add") {
    const management = state.questionBankManagement;
    if (!management.selectedRows.length) {
      notify("请先选择需要归类的题目");
      return;
    }
    management.bulkMode = mode;
    management.bulkCategoryIds = [];
    management.bulkError = "";
    management.bulkOpen = true;
  }

  async function applyBulkQuestionCategories() {
    const management = state.questionBankManagement;
    if (!management.bulkCategoryIds.length) {
      management.bulkError = "请选择分类";
      return;
    }
    management.bulkSaving = true;
    management.bulkError = "";
    try {
      if (["remove", "replace"].includes(management.bulkMode)) {
        const actionLabel = management.bulkMode === "replace" ? "替换" : "移除";
        await ElMessageBox.confirm(
          `确认对已选择的 ${management.selectedRows.length} 道题${actionLabel}分类？此操作会立即修改题目的分类归属。`,
          `批量${actionLabel}分类`,
          {
            confirmButtonText: `确认${actionLabel}`,
            cancelButtonText: "取消",
            type: "warning",
          },
        );
      }
      const result = await request("/api/question-bank/categories/bulk", {
        method: "POST",
        body: JSON.stringify({
          questionIds: management.selectedRows.map((item) => item.id),
          categoryIds: management.bulkCategoryIds,
          mode: management.bulkMode,
        }),
      });
      management.bulkOpen = false;
      management.selectedRows = [];
      await loadQuestionBankCategories();
      await loadQuestionBank();
      notify(`已更新 ${result.updated || 0} 道题的分类`);
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      management.bulkError = error.message;
    } finally {
      management.bulkSaving = false;
    }
  }

  return {
    addCurrentQuestionsToBank,
    addPaperQuestionsToBank,
    addSelectedQuestionBankToAuthoring,
    applyBulkQuestionCategories,
    applyQuestionBankFilters,
    clearQuestionBankPlan,
    changeQuestionBankPage,
    changeQuestionBankPageSize,
    loadQuestionBank,
    loadQuestionBankCategories,
    openBulkQuestionCategories,
    openCreateQuestionBankCategory,
    openCreateQuestionBankItem,
    openEditQuestionBankCategory,
    openEditQuestionBankItem,
    openQuestionBankDetail,
    openQuestionBankPicker,
    requestCloseQuestionBankCategoryEditor,
    requestCloseQuestionBankEditor,
    removeSelectedQuestionBankItem,
    runQuestionBankAction,
    runQuestionBankCategoryAction,
    saveQuestionBankCategory,
    saveQuestionBankItem,
    selectQuestionBankCategory,
    setQuestionBankRows,
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
    categoryIds: [],
  };
}

function questionBankFormFingerprint(form = {}) {
  return JSON.stringify(form);
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
    categoryIds: [...(form.categoryIds || [])],
  };
}

function validateQuestionBankForm(form) {
  if (!Array.isArray(form.categoryIds) || !form.categoryIds.length) return "请选择至少一个题库分类";
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
