export function currentRoute() {
  const { route } = parseHashRoute();
  return ["authoring", "papers"].includes(route) ? route : "papers";
}

export function currentAuthoringPaperId() {
  const { route, params } = parseHashRoute();
  return route === "authoring" ? params.get("paperid") || params.get("paperId") || params.get("papeid") || "" : "";
}

export function parseHashRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
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
