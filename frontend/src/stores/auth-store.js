import { ElNotification } from "element-plus";
import "element-plus/theme-chalk/el-notification.css";

export function createAuthStore({ state, request, notify, refresh, canAccessRoute, go, mountIcons, resetSessionState }) {
  function toggleAdminMenu() {
    state.admin.menuOpen = !state.admin.menuOpen;
    state.ui.themeMenuOpen = false;
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
    if (error?.status === 401 || message.includes("运营登录") || message.includes("请先登录运营控制台")) {
      state.admin.token = "";
      state.admin.user = null;
      state.admin.menuOpen = false;
      localStorage.removeItem("smartqAdminToken");
      resetSessionState();
    }
  }

  async function loadAdminSession() {
    if (!state.admin.token) return;
    try {
      const result = await request("/api/admin/me", { headers: adminAuthHeaders() });
      state.admin.user = result.admin;
      syncProfileForm();
    } catch (error) {
      handleAdminAuthError(error);
    }
  }

  async function loginAdmin() {
    state.admin.error = "";
    const username = String(state.admin.username || "").trim();
    const password = String(state.admin.password || "");
    if (!username || !password) {
      state.admin.error = "请输入登录账号和密码";
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
      state.admin.error = "";
      state.dashboardError = "";
      state.admin.token = result.token;
      state.admin.user = result.admin;
      syncProfileForm();
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
    resetSessionState();
    localStorage.removeItem("smartqAdminToken");
    notify("已退出运营控制台");
    mountIcons();
  }

  function openAdminProfile() {
    closeAdminMenu();
    syncProfileForm();
    go("profile");
  }

  async function selectAdminAvatar(event) {
    const file = event?.raw || event?.target?.files?.[0];
    if (!file) return;
    state.profile.error = "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      state.profile.error = "头像仅支持 PNG、JPG 或 WebP 图片";
      resetPendingAvatar();
      if (event?.target) event.target.value = "";
      return;
    }
    if (file.size > 100 * 1024) {
      state.profile.error = "头像图片不能超过 100KB";
      resetPendingAvatar();
      if (event?.target) event.target.value = "";
      return;
    }
    const dimensions = await loadImageDimensions(file);
    if (!dimensions || dimensions.width !== dimensions.height) {
      state.profile.error = "头像必须是方形图片";
      resetPendingAvatar();
      if (event?.target) event.target.value = "";
      return;
    }
    releaseProfilePreview();
    state.profile.avatarFile = file;
    state.profile.avatarPreview = URL.createObjectURL(file);
    mountIcons();
    await uploadAdminAvatar(file);
  }

  async function saveAdminProfile() {
    const displayName = String(state.profile.displayName || "").trim();
    state.profile.error = "";
    if (!displayName) {
      state.profile.error = "请输入用户名";
      notifyProfileSaveError(state.profile.error);
      return;
    }
    if (displayName.length > 32) {
      state.profile.error = "用户名不能超过 32 个字符";
      notifyProfileSaveError(state.profile.error);
      return;
    }
    state.profile.saving = true;
    try {
      const result = await request("/api/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ displayName }),
      });
      state.admin.user = result.admin;
      releaseProfilePreview();
      syncProfileForm();
      ElNotification.success({
        title: "保存成功",
        message: "个人资料已保存",
      });
    } catch (error) {
      state.profile.error = error.message || "个人资料保存失败";
      notifyProfileSaveError(state.profile.error);
    } finally {
      state.profile.saving = false;
      mountIcons();
    }
  }

  async function changeAdminPassword() {
    state.password.error = "";
    if (!state.password.currentPassword) {
      state.password.error = "请输入当前密码";
      return;
    }
    if (state.password.newPassword !== state.password.confirmPassword) {
      state.password.error = "两次输入的新密码不一致";
      return;
    }
    state.password.saving = true;
    try {
      const result = await request("/api/admin/password", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: state.password.currentPassword,
          newPassword: state.password.newPassword,
        }),
      });
      state.admin.user = result.admin;
      state.password.currentPassword = "";
      state.password.newPassword = "";
      state.password.confirmPassword = "";
      notify("登录密码已更新");
    } catch (error) {
      state.password.error = error.message || "密码修改失败";
    } finally {
      state.password.saving = false;
    }
  }

  function syncProfileForm() {
    state.profile.displayName = state.admin.user?.displayName || state.admin.user?.username || state.admin.username || "admin";
    state.profile.avatarPreview = state.admin.user?.avatar || "";
    state.profile.avatarFile = null;
    state.profile.error = "";
  }

  function releaseProfilePreview() {
    if (String(state.profile.avatarPreview || "").startsWith("blob:")) URL.revokeObjectURL(state.profile.avatarPreview);
  }

  function resetPendingAvatar() {
    releaseProfilePreview();
    state.profile.avatarFile = null;
    state.profile.avatarPreview = state.admin.user?.avatar || "";
  }

  async function uploadAdminAvatar(file) {
    state.profile.uploadingAvatar = true;
    try {
      const result = await request("/api/admin/profile/avatar", {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      state.admin.user = result.admin;
      releaseProfilePreview();
      state.profile.avatarFile = null;
      state.profile.avatarPreview = result.admin.avatar || "";
      notify("用户头像已更新");
    } catch (error) {
      state.profile.error = error.message || "头像上传失败";
      resetPendingAvatar();
      notify(`上传失败：${state.profile.error}`);
    } finally {
      state.profile.uploadingAvatar = false;
      mountIcons();
    }
  }

  async function restoreDefaultAdminAvatar() {
    if (!state.admin.user?.avatar || state.profile.uploadingAvatar || state.profile.resettingAvatar) return;
    state.profile.error = "";
    state.profile.resettingAvatar = true;
    try {
      const result = await request("/api/admin/profile/avatar", { method: "DELETE" });
      state.admin.user = result.admin;
      releaseProfilePreview();
      state.profile.avatarFile = null;
      state.profile.avatarPreview = result.admin.avatar || "";
      ElNotification.success({
        title: "恢复成功",
        message: "已恢复默认头像",
      });
    } catch (error) {
      state.profile.error = error.message || "默认头像恢复失败";
      ElNotification.error({
        title: "恢复失败",
        message: state.profile.error,
      });
    } finally {
      state.profile.resettingAvatar = false;
      mountIcons();
    }
  }

  function adminAuthHeaders() {
    return state.admin.token ? { authorization: `Bearer ${state.admin.token}` } : {};
  }

  return {
    closeAdminMenu,
    changeAdminPassword,
    handleAdminAuthError,
    loadAdminSession,
    loginAdmin,
    logoutAdmin,
    openAdminProfile,
    restoreDefaultAdminAvatar,
    runAdminAccountMenuItem,
    saveAdminProfile,
    selectAdminAvatar,
    toggleAdminMenu,
  };
}

function notifyProfileSaveError(message) {
  ElNotification.error({
    title: "保存失败",
    message,
  });
}

function loadImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}
