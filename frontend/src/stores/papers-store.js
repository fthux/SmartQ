export function createPapersStore({ state, request, refresh, notify, mountIcons, paperTotalPages, currentPaperPage, go }) {
  async function activatePaper(id, options = {}) {
    try {
      await request(`/api/papers/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
      if (!options.silent) notify("已切换当前试卷");
    } catch (error) {
      notify(`切换失败：${error.message}`);
    }
  }

  async function selectPaper(id) {
    state.selectedPaperId = id;
    state.selectedPaperDetail = null;
    state.paperDetailLoading = true;
    state.paperActionMenuId = null;
    try {
      state.selectedPaperDetail = await request(`/api/papers/${id}`);
    } catch (error) {
      state.selectedPaperDetail = null;
      notify(`加载试卷失败：${error.message}`);
    } finally {
      state.paperDetailLoading = false;
      mountIcons();
    }
  }

  function clearSelectedPaper() {
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

  async function deletePaper() {
    const target = state.confirmDeletePaper;
    if (!target) return;
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
    }
  }

  async function editPaper(item) {
    state.editingPaperId = item.id;
    if (state.dashboard?.paper?.id !== item.id) await activatePaper(item.id);
    state.activeWorkflowStep = "edit";
    go("authoring", { paperid: item.id });
    notify("已进入试卷编辑模式");
  }

  return {
    activatePaper,
    askDeletePaper,
    changePaperPage,
    clearSelectedPaper,
    deletePaper,
    editPaper,
    resetPaperPage,
    selectPaper,
    togglePaperActionMenu,
  };
}
