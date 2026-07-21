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
    const preferredDark = state.ui.theme === "dark" || (state.ui.theme === "system" && systemDark);
    const nextDark = Boolean(state.admin.token) && preferredDark;
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
    const hasExplicitOrigin = Number.isFinite(originX) && Number.isFinite(originY);
    const x = hasExplicitOrigin ? Math.min(Math.max(originX, 0), viewportWidth) : 0;
    const y = hasExplicitOrigin ? Math.min(Math.max(originY, 0), viewportHeight) : 0;
    const transitionOrigin = hasExplicitOrigin
      ? `${x}px ${y}px`
      : nextDark ? "100% 0%" : "0% 100%";
    const endRadius = hasExplicitOrigin
      ? Math.hypot(
        Math.max(x, viewportWidth - x),
        Math.max(y, viewportHeight - y),
      )
      : Math.hypot(viewportWidth, viewportHeight);
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${transitionOrigin})`, `circle(${endRadius}px at ${transitionOrigin})`] },
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
    applyTheme,
    setTheme,
    toggleTheme,
    toggleFullscreen,
    initializeLayout,
  };
}
