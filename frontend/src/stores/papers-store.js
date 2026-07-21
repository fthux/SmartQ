export function createPapersStore({ state, request, refresh, notify, mountIcons, paperTotalPages, currentPaperPage, go }) {
  let detailRequestSequence = 0;

  async function activatePaper(id, options = {}) {
    try {
      await request(`/api/papers/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
      if (!options.silent) notify("已切换当前试卷");
      return true;
    } catch (error) {
      if (!options.silent) notify(`切换失败：${error.message}`);
      throw error;
    }
  }

  async function selectPaper(id) {
    const requestSequence = ++detailRequestSequence;
    state.selectedPaperId = id;
    state.selectedPaperDetail = null;
    state.paperDetailLoading = true;
    state.paperActionMenuId = null;
    try {
      const detail = await request(`/api/papers/${id}`);
      if (requestSequence !== detailRequestSequence || state.selectedPaperId !== id) return;
      state.selectedPaperDetail = detail;
    } catch (error) {
      if (requestSequence !== detailRequestSequence || state.selectedPaperId !== id) return;
      state.selectedPaperDetail = null;
      notify(`加载试卷失败：${error.message}`);
    } finally {
      if (requestSequence === detailRequestSequence && state.selectedPaperId === id) state.paperDetailLoading = false;
      mountIcons();
    }
  }

  function clearSelectedPaper() {
    detailRequestSequence += 1;
    state.selectedPaperId = null;
    state.selectedPaperDetail = null;
    state.paperDetailLoading = false;
    state.paperDetailMode = "compact";
    state.paperActionMenuId = null;
  }

  function changePaperPage(delta) {
    state.paperPage = Math.max(1, Math.min(paperTotalPages.value, currentPaperPage.value + delta));
  }

  function resetPaperPage() {
    state.paperPage = 1;
    state.paperActionMenuId = null;
  }

  function togglePaperActionMenu(id) {
    state.paperActionMenuId = state.paperActionMenuId === id ? null : id;
  }

  function askDeletePaper(item) {
    state.paperActionMenuId = null;
    state.confirmDeletePaper = item;
  }

  function openPaperRename(item) {
    if (!item?.id) return;
    state.paperRename = {
      open: true,
      target: item,
      name: String(item.name || ""),
      saving: false,
      error: "",
    };
    mountIcons();
  }

  function closePaperRename() {
    if (state.paperRename.saving) return;
    state.paperRename = freshPaperRenameState();
  }

  async function renamePaper() {
    const rename = state.paperRename;
    const target = rename.target;
    const name = String(rename.name || "").trim();
    if (!target?.id || rename.saving) return;
    if (!name) {
      rename.error = "请输入试卷名称";
      return;
    }
    if (name.length > 80) {
      rename.error = "试卷名称不能超过 80 个字符";
      return;
    }
    if (name === String(target.name || "").trim()) return;
    rename.saving = true;
    rename.error = "";
    try {
      const updated = await request(`/api/papers/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      if (state.selectedPaperId === updated.id && state.selectedPaperDetail) {
        state.selectedPaperDetail = { ...state.selectedPaperDetail, ...updated };
      }
      state.paperRename = freshPaperRenameState();
      await refresh();
      notify("试卷名称已修改");
    } catch (error) {
      rename.error = error.message;
    } finally {
      if (state.paperRename.open) state.paperRename.saving = false;
    }
  }

  function canPrintPaper(item = {}) {
    return item.status === "已发布" || Boolean(item.publishedAt) || Boolean(item.publishedVersions?.length);
  }

  async function openPaperPrint(item = {}) {
    if (!item.id || state.paperPrint.loading) return;
    state.paperPrint = {
      ...freshPaperPrintState(),
      dialogOpen: true,
      loading: true,
      paperId: item.id,
      paperName: item.name || "未命名试卷",
    };
    try {
      const payload = await request(`/api/papers/${encodeURIComponent(item.id)}/print`);
      state.paperPrint.versions = payload.versions || [];
      state.paperPrint.publishedAt = payload.selectedVersion?.publishedAt || payload.versions?.[0]?.publishedAt || "";
      state.paperPrint.paperName = payload.selectedVersion?.name || state.paperPrint.paperName;
    } catch (error) {
      state.paperPrint.dialogOpen = false;
      notify(`无法打印试卷：${error.message}`, "error");
    } finally {
      state.paperPrint.loading = false;
      mountIcons();
    }
  }

  function closePaperPrint() {
    if (state.paperPrint.loading) return;
    state.paperPrint = freshPaperPrintState();
  }

  function confirmPaperPrint() {
    const settings = state.paperPrint;
    if (!settings.paperId || !settings.publishedAt) {
      notify("请选择可打印的发布版本", "warning");
      return;
    }
    const params = new URLSearchParams({
      paperId: settings.paperId,
      publishedAt: settings.publishedAt,
    });
    const target = new URL(location.href);
    target.hash = `/paper-print?${params.toString()}`;
    const previewWindow = window.open(target.toString(), "_blank");
    if (!previewWindow) {
      notify("浏览器阻止了预览窗口，请允许本站打开新窗口", "warning");
      return;
    }
    previewWindow.opener = null;
    state.paperPrint = freshPaperPrintState();
  }

  async function deletePaper() {
    const target = state.confirmDeletePaper;
    if (!target || state.deletingPaperId) return;
    state.deletingPaperId = target.id;
    try {
      await request(`/api/papers/${target.id}`, { method: "DELETE" });
      state.confirmDeletePaper = null;
      if (state.selectedPaperId === target.id) {
        state.selectedPaperId = null;
        state.selectedPaperDetail = null;
      }
      await refresh();
      notify("试卷已删除");
    } catch (error) {
      notify(`删除失败：${error.message}`);
    } finally {
      state.deletingPaperId = null;
    }
  }

  async function editPaper(item) {
    if (state.dashboard?.paper?.id !== item.id) {
      try {
        await activatePaper(item.id);
      } catch {
        return;
      }
    }
    state.editingPaperId = item.id;
    state.activeWorkflowStep = "edit";
    go("authoring", { paperid: item.id });
    notify("已进入试卷编辑模式");
  }

  return {
    activatePaper,
    askDeletePaper,
    canPrintPaper,
    changePaperPage,
    closePaperRename,
    closePaperPrint,
    clearSelectedPaper,
    confirmPaperPrint,
    deletePaper,
    editPaper,
    openPaperRename,
    openPaperPrint,
    renamePaper,
    resetPaperPage,
    selectPaper,
    togglePaperActionMenu,
  };
}

function freshPaperRenameState() {
  return {
    open: false,
    target: null,
    name: "",
    saving: false,
    error: "",
  };
}

function freshPaperPrintState() {
  return {
    dialogOpen: false,
    loading: false,
    paperId: "",
    paperName: "",
    versions: [],
    publishedAt: "",
  };
}
