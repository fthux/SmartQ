export function createLayoutStore({ state, mountIcons }) {
  const themeOptions = [
    { value: "system", label: "跟随系统", icon: "monitor" },
    { value: "light", label: "浅色", icon: "sun" },
    { value: "dark", label: "深色", icon: "moon" },
  ];
  let colorSchemeMedia = null;

  function toggleSidebar() {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    localStorage.setItem("smartqSidebarCollapsed", state.ui.sidebarCollapsed ? "1" : "0");
    mountIcons();
  }

  function toggleThemeMenu() {
    state.ui.themeMenuOpen = !state.ui.themeMenuOpen;
    state.admin.menuOpen = false;
    mountIcons();
  }

  function closeThemeMenu() {
    state.ui.themeMenuOpen = false;
  }

  function setTheme(theme, options = {}) {
    if (!themeOptions.some((item) => item.value === theme)) return;
    state.ui.theme = theme;
    localStorage.setItem("smartqTheme", theme);
    applyTheme(options);
    closeThemeMenu();
    mountIcons();
  }

  function toggleTheme(isDark) {
    setTheme(isDark ? "dark" : "light", { animate: true });
  }

  function applyTheme(options = {}) {
    const systemDark = colorSchemeMedia?.matches || window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextDark = state.ui.theme === "dark" || (state.ui.theme === "system" && systemDark);
    const root = document.documentElement;
    const apply = () => {
      state.ui.isDark = nextDark;
      root.classList.toggle("dark", nextDark);
      root.style.colorScheme = nextDark ? "dark" : "light";
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!options.animate || reducedMotion || typeof document.startViewTransition !== "function" || root.classList.contains("dark") === nextDark) {
      apply();
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const originX = Number(options.origin?.x);
    const originY = Number(options.origin?.y);
    const defaultX = nextDark ? viewportWidth : 0;
    const defaultY = nextDark ? 0 : viewportHeight;
    const x = Math.min(Math.max(Number.isFinite(originX) ? originX : defaultX, 0), viewportWidth);
    const y = Math.min(Math.max(Number.isFinite(originY) ? originY : defaultY, 0), viewportHeight);
    const endRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y),
    );
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
          {
            duration: 500,
            easing: "ease-in-out",
            fill: "both",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {});
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      return;
    }
    syncFullscreen();
  }

  function syncFullscreen() {
    state.ui.isFullscreen = Boolean(document.fullscreenElement);
    mountIcons();
  }

  function initializeLayout() {
    colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    colorSchemeMedia.addEventListener?.("change", applyTheme);
    document.addEventListener("fullscreenchange", syncFullscreen);
    applyTheme();
    syncFullscreen();
  }

  return {
    themeOptions,
    toggleSidebar,
    toggleThemeMenu,
    closeThemeMenu,
    setTheme,
    toggleTheme,
    toggleFullscreen,
    initializeLayout,
  };
}
