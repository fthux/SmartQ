export const ADMIN_LOGIN_HASH = "#/login";

export function currentRoute(hash) {
  const { route } = parseHashRoute(hash);
  return ["authoring", "papers", "question-bank", "materials", "users", "profile", "paper-print"].includes(route) ? route : "papers";
}

export function currentAuthoringPaperId(hash) {
  const { route, params } = parseHashRoute(hash);
  return route === "authoring" ? params.get("paperid") || params.get("paperId") || params.get("papeid") || "" : "";
}

export function isAdminLoginRoute(hash) {
  return parseHashRoute(hash).route === "login";
}

export function parseHashRoute(hash = typeof location === "undefined" ? "" : location.hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [route = "", query = ""] = raw.split("?");
  return { route, params: new URLSearchParams(query) };
}

export function formatRouteHash(route, params = {}) {
  if (route === "papers") return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const query = search.toString();
  return query ? `#/${route}?${query}` : `#/${route}`;
}
