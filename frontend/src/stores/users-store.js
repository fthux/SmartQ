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
    state.userManagement.formInitial = formFingerprint(state.userManagement.form);
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
    state.userManagement.formInitial = formFingerprint(state.userManagement.form);
    state.userManagement.formError = "";
    state.userManagement.editorOpen = true;
  }

  async function saveManagedAdminUser() {
    const form = state.userManagement.form;
    state.userManagement.formError = "";
    if (!String(form.displayName || "").trim()) {
      state.userManagement.formError = "请输入显示名称";
      return;
    }
    if (String(form.displayName || "").trim().length > 32) {
      state.userManagement.formError = "显示名称不能超过 32 个字符";
      return;
    }
    if (state.userManagement.editorMode === "create") {
      const usernameError = validateUsername(form.username);
      if (usernameError) {
        state.userManagement.formError = usernameError;
        return;
      }
      const passwordError = validatePassword(form.password);
      if (passwordError) {
        state.userManagement.formError = passwordError;
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

  async function requestCloseAdminUserEditor(done) {
    if (state.userManagement.saving) return;
    if (formFingerprint(state.userManagement.form) !== state.userManagement.formInitial) {
      try {
        await ElMessageBox.confirm("当前用户信息尚未保存，关闭后修改会丢失。", "放弃未保存修改", {
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
    else state.userManagement.editorOpen = false;
  }

  async function setManagedAdminUserStatus(user, status) {
    const active = status === "active";
    const action = active ? "启用" : "停用";
    try {
      const message = active
        ? `启用账号“${user.displayName || user.username}”？启用后该用户可以重新登录控制台。`
        : `停用账号“${user.displayName || user.username}”？停用后该用户将无法登录，现有登录会话会立即失效。`;
      await ElMessageBox.confirm(message, `${action}账号`, {
        confirmButtonText: `确认${action}`,
        cancelButtonText: "取消",
        type: active ? "info" : "warning",
      });
      state.userManagement.statusUpdatingId = user.id;
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      notify(`账号已${action}`);
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
    const passwordError = validatePassword(state.userManagement.resetPassword);
    if (passwordError) {
      state.userManagement.resetError = passwordError;
      return;
    }
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
      state.userManagement.sessionRevokingId = user.id;
      const result = await request(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, { method: "POST" });
      notify(result.revokedSessions ? `已强制下线，共注销 ${result.revokedSessions} 个登录会话` : "该用户当前没有有效登录会话");
    } catch (error) {
      if (error === "cancel" || error === "close") return;
      notify(`强制下线失败：${error.message || error}`);
    } finally {
      state.userManagement.sessionRevokingId = null;
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
    requestCloseAdminUserEditor,
    revokeManagedAdminSessions,
    saveManagedAdminUser,
    setManagedAdminUserStatus,
  };
}

function formFingerprint(form = {}) {
  return JSON.stringify(form);
}

function validateUsername(value) {
  const username = String(value || "").trim();
  if (!username) return "请输入登录账号";
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return "登录账号需为 3-32 位字母、数字、点、下划线或连字符";
  return "";
}

function validatePassword(value) {
  const password = String(value || "");
  if (!password) return "请输入密码";
  if (password.length < 8) return "密码至少需要 8 个字符";
  if (password.length > 128) return "密码不能超过 128 个字符";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码必须同时包含字母和数字";
  return "";
}
