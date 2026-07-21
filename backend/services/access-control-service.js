export const USER_ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  USER: "user",
});

export const USER_ROLE_LABELS = Object.freeze({
  [USER_ROLES.SUPER_ADMIN]: "超级管理员",
  [USER_ROLES.USER]: "普通用户",
});

export function isSuperAdmin(user = {}) {
  return user?.role === USER_ROLES.SUPER_ADMIN;
}

export function actorFromAuth(auth = {}) {
  return {
    userId: String(auth?.user?.id || auth?.session?.userId || ""),
    username: String(auth?.user?.username || auth?.session?.username || ""),
    role: auth?.user?.role === USER_ROLES.SUPER_ADMIN ? USER_ROLES.SUPER_ADMIN : USER_ROLES.USER,
  };
}

export function activeAuthoringOwnerId(auth = {}) {
  const actor = actorFromAuth(auth);
  if (!actor.userId) return "";
  if (!isSuperAdmin(actor)) return actor.userId;
  return String(auth?.session?.editingOwnerUserId || actor.userId);
}

export function setActiveAuthoringOwner(auth = {}, ownerUserId = "") {
  const actor = actorFromAuth(auth);
  if (!auth?.session || !actor.userId) return actor.userId;
  auth.session.editingOwnerUserId = isSuperAdmin(actor) ? String(ownerUserId || actor.userId) : actor.userId;
  return auth.session.editingOwnerUserId;
}

export function canAccessResource(actor = {}, resource = {}) {
  const userId = String(actor?.userId || actor?.id || "");
  if (!userId) return false;
  return isSuperAdmin(actor) || resourceOwnerUserId(resource) === userId;
}

export function resourceOwnerUserId(resource = {}) {
  return String(resource?.ownerUserId || resource?.createdByUserId || "");
}

export function accessibleResources(items, actor = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => canAccessResource(actor, item));
}

export function publicUserSummary(state, userId = "") {
  const user = (state.adminUsers || []).find((item) => item.id === String(userId || ""));
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatar: user.avatar || "",
    role: user.role === USER_ROLES.SUPER_ADMIN ? USER_ROLES.SUPER_ADMIN : USER_ROLES.USER,
  };
}

export function decorateOwnedResource(state, resource = {}) {
  return {
    ...resource,
    creator: publicUserSummary(state, resource.createdByUserId || resource.ownerUserId),
    updater: publicUserSummary(state, resource.updatedByUserId || resource.createdByUserId || resource.ownerUserId),
  };
}

export function initializeContentOwnership(state) {
  const before = JSON.stringify({
    papers: state.papers || [],
    questionBank: state.questionBank || [],
    questionBankCategories: state.questionBankCategories || [],
    sourceMaterials: state.sourceMaterials || [],
  });
  const users = state.adminUsers || [];
  const superAdmin = users.find((item) => item.role === USER_ROLES.SUPER_ADMIN) || users[0];
  if (!superAdmin?.id) return false;
  const userIds = new Set(users.map((item) => item.id));
  const byUsername = new Map(users.map((item) => [String(item.username || "").toLowerCase(), item.id]));
  const workspacePaperOwners = new Map();
  for (const [userId, workspace] of Object.entries(state.authoringWorkspaces || {})) {
    if (workspace?.paper?.id && userIds.has(userId)) workspacePaperOwners.set(workspace.paper.id, userId);
  }
  const resolveUserId = (...values) => {
    for (const value of values) {
      const normalized = String(value || "").trim();
      if (!normalized) continue;
      if (userIds.has(normalized)) return normalized;
      const matched = byUsername.get(normalized.toLowerCase());
      if (matched) return matched;
    }
    return superAdmin.id;
  };
  const normalizeOwned = (item, preferredOwner = "") => {
    if (!item || typeof item !== "object") return item;
    const ownerUserId = resolveUserId(item.ownerUserId, item.createdByUserId, preferredOwner, item.createdBy);
    item.ownerUserId = ownerUserId;
    item.createdByUserId = resolveUserId(item.createdByUserId, item.createdBy, ownerUserId);
    item.updatedByUserId = resolveUserId(item.updatedByUserId, item.updatedBy, item.createdByUserId, ownerUserId);
    return item;
  };
  for (const paper of state.papers || []) {
    normalizeOwned(paper, workspacePaperOwners.get(paper.id));
    for (const version of paper.publishedVersions || []) normalizeOwned(version, paper.ownerUserId);
  }
  for (const item of state.questionBank || []) normalizeOwned(item);
  for (const category of state.questionBankCategories || []) normalizeOwned(category);
  for (const material of state.sourceMaterials || []) normalizeOwned(material);
  const after = JSON.stringify({
    papers: state.papers || [],
    questionBank: state.questionBank || [],
    questionBankCategories: state.questionBankCategories || [],
    sourceMaterials: state.sourceMaterials || [],
  });
  return before !== after;
}

export function forbiddenResult(message = "当前账号无权执行此操作") {
  return { error: message, statusCode: 403 };
}
