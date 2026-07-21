import { request } from "../core/api-client.js";
import { ElMessageBox } from "element-plus";

export function createMaterialsStore({ state, notify, go }) {
  async function loadMaterials() {
    const management = state.materialManagement;
    management.loading = true;
    management.error = "";
    try {
      const params = new URLSearchParams({ page: String(management.page), pageSize: String(management.pageSize) });
      if (management.search.trim()) params.set("search", management.search.trim());
      if (management.status) params.set("status", management.status);
      const result = await request(`/api/materials?${params}`);
      management.items = result.items || [];
      management.total = Number(result.total || 0);
    } catch (error) {
      management.error = error.message || "出题资料加载失败";
    } finally {
      management.loading = false;
    }
  }

  async function loadMaterialOptions() {
    state.materialManagement.optionsLoading = true;
    try {
      const result = await request("/api/materials?status=ready&page=1&pageSize=1000");
      state.materialManagement.options = result.items || [];
    } catch (error) {
      notify(`资料选项加载失败：${error.message}`);
    } finally {
      state.materialManagement.optionsLoading = false;
    }
  }

  function applyMaterialFilters() {
    state.materialManagement.page = 1;
    loadMaterials();
  }

  function changeMaterialPage(page) {
    state.materialManagement.page = page;
    loadMaterials();
  }

  function changeMaterialPageSize(size) {
    state.materialManagement.pageSize = size;
    state.materialManagement.page = 1;
    loadMaterials();
  }

  function resetMaterialForm(mode = "text") {
    state.materialManagement.editorMode = "create";
    state.materialManagement.editingId = null;
    state.materialManagement.form = { name: "", description: "", tags: "", content: "", mode, file: null };
    state.materialManagement.formInitial = materialFormFingerprint(state.materialManagement.form);
    state.materialManagement.formError = "";
  }

  function openCreateMaterial(mode = "text") {
    resetMaterialForm(mode);
    state.materialManagement.editorOpen = true;
  }

  async function openEditMaterial(row) {
    state.materialManagement.detailLoading = true;
    try {
      const detail = await request(`/api/materials/${encodeURIComponent(row.id)}`);
      state.materialManagement.editorMode = "edit";
      state.materialManagement.editingId = row.id;
      state.materialManagement.form = {
        name: detail.name || "",
        description: detail.description || "",
        tags: (detail.tags || []).join("，"),
        content: detail.content || "",
        mode: "text",
        file: null,
      };
      state.materialManagement.formInitial = materialFormFingerprint(state.materialManagement.form);
      state.materialManagement.formError = "";
      state.materialManagement.editorOpen = true;
    } catch (error) {
      notify(`资料读取失败：${error.message}`);
    } finally {
      state.materialManagement.detailLoading = false;
    }
  }

  async function openMaterialDetail(row) {
    state.materialManagement.detailOpen = true;
    state.materialManagement.detailLoading = true;
    state.materialManagement.detail = null;
    state.materialManagement.usages = [];
    try {
      const [detail, usages] = await Promise.all([
        request(`/api/materials/${encodeURIComponent(row.id)}`),
        request(`/api/materials/${encodeURIComponent(row.id)}/usages`),
      ]);
      state.materialManagement.detail = detail;
      state.materialManagement.usages = usages.items || [];
    } catch (error) {
      notify(`资料详情加载失败：${error.message}`);
    } finally {
      state.materialManagement.detailLoading = false;
    }
  }

  function selectMaterialFile(uploadFile) {
    const file = uploadFile?.raw || uploadFile;
    if (!file) return;
    const extension = String(file.name || "").split(".").pop()?.toLowerCase();
    if (!["txt", "md", "pdf", "docx"].includes(extension)) {
      notify("仅支持 TXT、MD、PDF 和 DOCX 文件");
      return;
    }
    const maxBytes = Number(state.systemLimits?.materialFileMaxBytes || 8 * 1024 * 1024);
    if (file.size > maxBytes) {
      notify(`资料文件不能超过 ${formatFileSize(maxBytes)}`);
      return;
    }
    state.materialManagement.form.file = file;
    if (!state.materialManagement.form.name) state.materialManagement.form.name = file.name.replace(/\.[^.]+$/, "");
  }

  async function saveMaterial() {
    const management = state.materialManagement;
    const form = management.form;
    management.formError = "";
    if (!String(form.name || "").trim()) {
      management.formError = "请输入资料名称";
      return;
    }
    if (management.editorMode === "create" && form.mode === "file" && !form.file) {
      management.formError = "请选择资料文件";
      return;
    }
    if ((management.editorMode === "edit" || form.mode === "text") && !String(form.content || "").trim()) {
      management.formError = "请输入资料正文";
      return;
    }
    management.saving = true;
    try {
      if (management.editorMode === "create" && form.mode === "file") {
        const data = new FormData();
        data.append("name", form.name.trim());
        data.append("description", String(form.description || "").trim());
        data.append("tags", String(form.tags || "").trim());
        data.append("file", form.file, form.file.name);
        await request("/api/materials/upload", { method: "POST", body: data });
      } else {
        const path = management.editorMode === "edit" ? `/api/materials/${encodeURIComponent(management.editingId)}` : "/api/materials";
        await request(path, {
          method: management.editorMode === "edit" ? "PATCH" : "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            description: String(form.description || "").trim(),
            tags: String(form.tags || "").trim(),
            content: String(form.content || "").trim(),
          }),
        });
      }
      management.editorOpen = false;
      notify(management.editorMode === "edit" ? "出题资料已更新" : "出题资料已创建");
      await Promise.all([loadMaterials(), loadMaterialOptions()]);
    } catch (error) {
      management.formError = error.message || "资料保存失败";
    } finally {
      management.saving = false;
    }
  }

  async function requestCloseMaterialEditor(done) {
    const management = state.materialManagement;
    if (management.saving) return;
    if (materialFormFingerprint(management.form) !== management.formInitial) {
      try {
        await ElMessageBox.confirm("当前资料内容尚未保存，关闭后修改会丢失。", "放弃未保存修改", {
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

  async function runMaterialAction(row, action) {
    const archiving = action === "archive";
    const restoring = action === "restore";
    const actionLabel = archiving ? "归档" : restoring ? "恢复" : "重新解析";
    try {
      if (archiving || restoring || action === "reparse") {
        await ElMessageBox.confirm(
          archiving
            ? `确认归档资料“${row.name}”？归档后不会影响历史试卷，但不能再用于新的出题任务。`
            : restoring
              ? `确认恢复资料“${row.name}”？恢复后该资料将重新进入可选的出题资料列表。`
              : `确认重新解析资料“${row.name}”？当前解析结果将被新的解析结果替换。`,
          `确认${actionLabel}`,
          {
            confirmButtonText: `确认${actionLabel}`,
            cancelButtonText: "取消",
            type: archiving || action === "reparse" ? "warning" : "info",
          },
        );
      }
      state.materialManagement.actionId = row.id;
      await request(`/api/materials/${encodeURIComponent(row.id)}/${action}`, { method: "POST", body: JSON.stringify({}) });
      notify({ archive: "资料已归档", restore: "资料已恢复", reparse: "资料已重新解析" }[action] || "资料状态已更新");
      await Promise.all([loadMaterials(), loadMaterialOptions()]);
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      notify(`${actionLabel}失败：${error.message || error}`);
    } finally {
      state.materialManagement.actionId = null;
    }
  }

  async function openMaterialSelector() {
    state.materialManagement.selectorOpen = true;
    await loadMaterialOptions();
  }

  function toggleMaterialSelection(id) {
    const selected = new Set(state.spec.materialIds || []);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    state.spec.materialIds = [...selected];
  }

  function removeSelectedMaterial(id) {
    state.spec.materialIds = (state.spec.materialIds || []).filter((item) => item !== id);
  }

  function manageMaterialsFromAuthoring() {
    sessionStorage.setItem("smartqAuthoringSpec", JSON.stringify(state.spec));
    state.materialManagement.selectorOpen = false;
    go("materials", { returnTo: "authoring" });
  }

  function resumeAuthoringFromMaterials() {
    go("authoring", { resume: "1" });
  }

  return {
    applyMaterialFilters,
    changeMaterialPage,
    changeMaterialPageSize,
    loadMaterials,
    loadMaterialOptions,
    manageMaterialsFromAuthoring,
    openCreateMaterial,
    openEditMaterial,
    openMaterialDetail,
    openMaterialSelector,
    removeSelectedMaterial,
    requestCloseMaterialEditor,
    resumeAuthoringFromMaterials,
    runMaterialAction,
    saveMaterial,
    selectMaterialFile,
    toggleMaterialSelection,
  };
}

function formatFileSize(bytes) {
  const megabytes = Number(bytes || 0) / 1024 / 1024;
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

function materialFormFingerprint(form = {}) {
  const file = form.file ? { name: form.file.name, size: form.file.size, lastModified: form.file.lastModified } : null;
  return JSON.stringify({ ...form, file });
}
