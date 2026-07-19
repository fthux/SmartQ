const publicBasePath = detectPublicBasePath();

export function publicUrl(path = "/") {
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return publicBasePath ? `${publicBasePath}${normalized}` : normalized;
}

export function cleanupLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations?.()
    .then((registrations) => {
      const expectedPrefix = `${location.origin}${publicUrl("/")}`;
      registrations
        .filter((registration) => registration.scope.startsWith(expectedPrefix))
        .forEach((registration) => registration.unregister().catch(() => {}));
    })
    .catch(() => {});
}

function detectPublicBasePath() {
  if (typeof window.__SMARTQ_PUBLIC_BASE_PATH__ === "string") {
    return normalizeBasePath(window.__SMARTQ_PUBLIC_BASE_PATH__);
  }
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/" || pathname.includes(".")) return "";
  return normalizeBasePath(pathname);
}

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}
