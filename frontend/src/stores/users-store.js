import { ElMessageBox } from "element-plus";

export function createUsersStore({ state, request, notify }) {
  async function loadAdminUsers() {
    state.userManagement.loading = true;
    state.userManagement.error = "";
    try {
      const search = new URLSearchParams({
        page: String(state.userManagement.page),
        pageSize: String(state.userManagement.pageSize),
      });
      if (state.userManagement.search.trim()) search.set("search", state.userManagement.search.trim());
      if (state.userManagement.status) search.set("status", state.userManagement.status);
      const result = await request(`/api/admin/users?${search}`);
      state.userManagement.items = result.users || [];
      state.userManagement.total = Number(result.total || 0);
      const maxPage = Math.max(1, Math.ceil(state.userManagement.total / state.userManagement.pageSize));
      if (state.userManagement.page > maxPage) {
        state.userManagement.page = maxPage;
        await loadAdminUsers();
      }
    } catch (error) {
      state.userManagement.error = error.message || "用户列表加载失败";
    } finally {
      state.userManagement.loading = false;
    }
  }

  function applyAdminUserFilters() {
    state.userManagement.page = 1;
    loadAdminUsers();
  }

  function changeAdminUserPage(page) {
    state.userManagement.page = page;
    loadAdminUsers();
  }

  function changeAdminUserPageSize(pageSize) {
    state.userManagement.pageSize = pageSize;
    state.userManagement.page = 1;
    loadAdminUsers();
  }

  function openCreateAdminUser() {
    state.userManagement.editorMode = "create";
    state.userManagement.editingId = null;
    state.userManagement.form = {
      username: "",
      displayName: "",
      password: "",
      confirmPassword: "",
    };
    state.userManagement.formError = "";
    state.userManagement.editorOpen = true;
  }

  function openEditAdminUser(user) {
    state.userManagement.editorMode = "edit";
    state.userManagement.editingId = user.id;
    state.userManagement.form = {
      username: user.username,
      displayName: user.displayName,
      password: "",
      confirmPassword: "",
    };
    state.userManagement.formError = "";
    state.userManagement.editorOpen = true;
  }

  async function saveManagedAdminUser() {
    const form = state.userManagement.form;
    state.userManagement.formError = "";
    if (!String(form.displayName || "").trim()) {
      state.userManagement.formError = "请输入用户名";
      return;
    }
    if (state.userManagement.editorMode === "create") {
      if (!String(form.username || "").trim()) {
        state.userManagement.formError = "请输入登录账号";
        return;
      }
      if (form.password !== form.confirmPassword) {
        state.userManagement.formError = "两次输入的密码不一致";
        return;
      }
    }

    state.userManagement.saving = true;
    try {
      if (state.userManagement.editorMode === "create") {
        await request("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            username: form.username,
            displayName: form.displayName,
            password: form.password,
          }),
        });
        notify("用户已创建");
      } else {
        const result = await request(`/api/admin/users/${encodeURIComponent(state.userManagement.editingId)}`, {
          method: "PATCH",
          body: JSON.stringify({ displayName: form.displayName }),
        });
        if (result.user?.id === state.admin.user?.id) state.admin.user = { ...state.admin.user, ...result.user };
        notify("用户资料已更新");
      }
      state.userManagement.editorOpen = false;
      await loadAdminUsers();
    } catch (error) {
      state.userManagement.formError = error.message || "用户保存失败";
    } finally {
      state.userManagement.saving = false;
    }
  }

  async function setManagedAdminUserStatus(user, status) {
    const active = status === "active";
    const action = active ? "启用" : "停用";
    try {
      await ElMessageBox.confirm(`${action}账号“${user.displayName || user.username}”？`, `${action}用户`, {
        confirmButtonText: action,
        cancelButtonText: "取消",
        type: active ? "info" : "warning",
      });
      state.userManagement.statusUpdatingId = user.id;
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      notify(`用户已${action}`);
      await loadAdminUsers();
    } catch (error) {
      if (error === "cancel" || error === "close") {
        await loadAdminUsers();
        return;
      }
      notify(`${action}失败：${error.message || error}`);
      await loadAdminUsers();
    } finally {
      state.userManagement.statusUpdatingId = null;
    }
  }

  function openResetAdminPassword(user) {
    state.userManagement.resetUser = user;
    state.userManagement.resetPassword = "";
    state.userManagement.resetPasswordConfirm = "";
    state.userManagement.resetError = "";
    state.userManagement.resetOpen = true;
  }

  async function resetManagedAdminPassword() {
    const user = state.userManagement.resetUser;
    if (!user) return;
    state.userManagement.resetError = "";
    if (state.userManagement.resetPassword !== state.userManagement.resetPasswordConfirm) {
      state.userManagement.resetError = "两次输入的密码不一致";
      return;
    }
    state.userManagement.resetting = true;
    try {
      await request(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: state.userManagement.resetPassword }),
      });
      state.userManagement.resetOpen = false;
      notify("密码已重置");
      await loadAdminUsers();
    } catch (error) {
      state.userManagement.resetError = error.message || "密码重置失败";
    } finally {
      state.userManagement.resetting = false;
    }
  }

  async function revokeManagedAdminSessions(user) {
    try {
      await ElMessageBox.confirm(`强制下线“${user.displayName || user.username}”的所有登录会话？`, "强制下线", {
        confirmButtonText: "强制下线",
        cancelButtonText: "取消",
        type: "warning",
      });
      const result = await request(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, { method: "POST" });
      notify(result.revokedSessions ? `已注销 ${result.revokedSessions} 个会话` : "当前没有可注销的会话");
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      notify(`强制下线失败：${error.message || error}`);
    }
  }

  return {
    applyAdminUserFilters,
    changeAdminUserPage,
    changeAdminUserPageSize,
    loadAdminUsers,
    openCreateAdminUser,
    openEditAdminUser,
    openResetAdminPassword,
    resetManagedAdminPassword,
    revokeManagedAdminSessions,
    saveManagedAdminUser,
    setManagedAdminUserStatus,
  };
}
