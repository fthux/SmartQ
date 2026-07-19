export function createAuthStore({ state, request, notify, refresh, canAccessRoute, go, mountIcons }) {
  function toggleAdminMenu() {
    state.admin.menuOpen = !state.admin.menuOpen;
    mountIcons();
  }

  function closeAdminMenu() {
    state.admin.menuOpen = false;
  }

  function runAdminAccountMenuItem(item) {
    if (!item || item.disabled) return;
    closeAdminMenu();
    if (typeof item.action === "function") item.action();
  }

  function handleAdminAuthError(error) {
    const message = String(error?.message || "");
    if (message.includes("运营登录") || message.includes("请先登录运营控制台")) {
      state.admin.token = "";
      state.admin.user = null;
      state.admin.menuOpen = false;
      localStorage.removeItem("smartqAdminToken");
      state.dashboard = null;
    }
  }

  async function loadAdminSession() {
    if (!state.admin.token) return;
    try {
      const result = await request("/api/admin/me", { headers: adminAuthHeaders() });
      state.admin.user = result.admin;
    } catch (error) {
      handleAdminAuthError(error);
    }
  }

  async function loginAdmin() {
    state.admin.error = "";
    const username = String(state.admin.username || "").trim();
    const password = String(state.admin.password || "");
    if (!username || !password) {
      state.admin.error = "请输入管理员账号和密码";
      notify(state.admin.error);
      return;
    }
    state.admin.loading = true;
    try {
      const result = await request("/api/admin/login", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ username, password }),
      });
      state.admin.token = result.token;
      state.admin.user = result.admin;
      state.admin.password = "";
      localStorage.setItem("smartqAdminToken", result.token);
      if (state.admin.rememberUsername) localStorage.setItem("smartqAdminUsername", username);
      else localStorage.removeItem("smartqAdminUsername");
      notify("运营控制台登录成功");
      if (!canAccessRoute(state.route)) go("papers");
      await refresh();
    } catch (error) {
      state.admin.error = error.message || "登录失败";
      notify(`登录失败：${state.admin.error}`);
    } finally {
      state.admin.loading = false;
      mountIcons();
    }
  }

  async function logoutAdmin() {
    const token = state.admin.token;
    if (token) {
      request("/api/admin/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => {});
    }
    state.admin.token = "";
    state.admin.user = null;
    state.admin.menuOpen = false;
    state.dashboard = null;
    state.dashboardError = "";
    localStorage.removeItem("smartqAdminToken");
    notify("已退出运营控制台");
    mountIcons();
  }

  function adminAuthHeaders() {
    return state.admin.token ? { authorization: `Bearer ${state.admin.token}` } : {};
  }

  return {
    closeAdminMenu,
    handleAdminAuthError,
    loadAdminSession,
    loginAdmin,
    logoutAdmin,
    runAdminAccountMenuItem,
    toggleAdminMenu,
  };
}
