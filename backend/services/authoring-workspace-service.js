const workspaceFields = new Set(["questions", "paper", "generationTask"]);

export function emptyAuthoringPaper() {
  return {
    id: null,
    name: "",
    status: null,
    publishedAt: null,
    questionIds: [],
    buildSpec: null,
    sourcePlanSnapshot: null,
    generationSpecSnapshot: null,
  };
}

export function normalizeAuthoringWorkspace(input = {}) {
  const paper = input?.paper && typeof input.paper === "object" ? input.paper : {};
  return {
    questions: Array.isArray(input?.questions) ? input.questions : [],
    paper: {
      ...emptyAuthoringPaper(),
      id: paper.id || null,
      name: String(paper.name || ""),
      status: ["已组卷", "已保存"].includes(paper.status) ? "未发布" : paper.status || null,
      publishedAt: paper.publishedAt || null,
      questionIds: Array.isArray(paper.questionIds) ? paper.questionIds : [],
      buildSpec: paper.buildSpec || null,
      sourcePlanSnapshot: paper.sourcePlanSnapshot || paper.buildSpec?.sourcePlanSnapshot || null,
      generationSpecSnapshot: stripPaperCategory(paper.generationSpecSnapshot),
    },
    generationTask: input?.generationTask && typeof input.generationTask === "object" ? input.generationTask : null,
  };
}

export function normalizeAuthoringWorkspaces(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([userId]) => String(userId || "").trim())
      .map(([userId, workspace]) => [String(userId), normalizeAuthoringWorkspace(workspace)]),
  );
}

export function initializeAuthoringWorkspaces(state) {
  const previous = state.authoringWorkspaces;
  state.authoringWorkspaces = normalizeAuthoringWorkspaces(previous);
  let changed = !previous || JSON.stringify(previous) !== JSON.stringify(state.authoringWorkspaces);
  if (Object.keys(state.authoringWorkspaces).length || !hasLegacyAuthoringData(state)) return changed;

  const owner = (state.adminUsers || []).find((item) => item?.id);
  if (!owner) return changed;
  state.authoringWorkspaces[String(owner.id)] = normalizeAuthoringWorkspace(state);
  return true;
}

export function authoringWorkspaceFor(state, userId) {
  const key = String(userId || "").trim();
  if (!key) throw new Error("Authenticated user id is required for authoring workspace access");
  state.authoringWorkspaces = state.authoringWorkspaces && typeof state.authoringWorkspaces === "object"
    ? state.authoringWorkspaces
    : {};
  state.authoringWorkspaces[key] = normalizeAuthoringWorkspace(state.authoringWorkspaces[key]);
  return state.authoringWorkspaces[key];
}

export function scopedAuthoringState(state, userId) {
  const workspace = authoringWorkspaceFor(state, userId);
  return new Proxy(state, {
    get(target, property, receiver) {
      return workspaceFields.has(property) ? workspace[property] : Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (workspaceFields.has(property)) {
        workspace[property] = value;
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    },
  });
}

export function clearPaperFromAllAuthoringWorkspaces(state, paperId) {
  for (const workspace of Object.values(state.authoringWorkspaces || {})) {
    if (workspace?.paper?.id !== paperId) continue;
    workspace.questions = [];
    workspace.paper = emptyAuthoringPaper();
    workspace.generationTask = null;
  }
}

function hasLegacyAuthoringData(state = {}) {
  return Boolean(
    (Array.isArray(state.questions) && state.questions.length)
      || state.paper?.id
      || state.paper?.status
      || (Array.isArray(state.paper?.questionIds) && state.paper.questionIds.length)
      || state.generationTask,
  );
}

function stripPaperCategory(value) {
  if (!value || typeof value !== "object") return value || null;
  const { categoryId: _categoryId, categorySnapshot: _categorySnapshot, ...rest } = value;
  return rest;
}
