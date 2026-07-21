export function upsertPaperSnapshot(state, paper) {
  state.papers = Array.isArray(state.papers) ? state.papers : [];
  const index = state.papers.findIndex((item) => item.id === paper.id);
  const existing = index >= 0 ? state.papers[index] : null;
  const now = new Date().toISOString();
  const snapshot = {
    id: paper.id,
    name: paper.name,
    status: paper.status,
    score: paper.score,
    questionCount: paper.questionCount,
    typeGroups: paper.typeGroups,
    questionIds: paper.questionIds,
    questions: paper.questions,
    buildSpec: paper.buildSpec,
    sourcePlanSnapshot: paper.sourcePlanSnapshot || paper.buildSpec?.sourcePlanSnapshot || null,
    generationSpecSnapshot: paper.generationSpecSnapshot || null,
    publishedAt: paper.publishedAt,
    createdAt: existing?.createdAt || paper.buildSpec?.savedAt || paper.buildSpec?.builtAt || now,
    updatedAt: now,
  };
  const publishedVersions = Array.isArray(existing?.publishedVersions)
    ? existing.publishedVersions.map((item) => structuredClone(item))
    : [];
  appendPublishedVersion(publishedVersions, existing);
  appendPublishedVersion(publishedVersions, snapshot);
  snapshot.publishedVersions = publishedVersions;
  if (index >= 0) state.papers[index] = { ...existing, ...snapshot };
  else state.papers.unshift(snapshot);
}

export function paperSnapshotDetail(paper, sourceQuestions = []) {
  const byId = new Map(sourceQuestions.map((item) => [item.id, item]));
  const questions = Array.isArray(paper.questions) && paper.questions.length
    ? paper.questions
    : (paper.questionIds || []).map((id) => byId.get(id)).filter(Boolean);
  return { ...paper, questions };
}

export function questionContentChanged(beforeJson, after) {
  try {
    const before = JSON.parse(beforeJson);
    const fields = ["type", "stem", "options", "answer", "score", "difficulty", "knowledge", "explanation", "rubric"];
    return fields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  } catch {
    return true;
  }
}

function appendPublishedVersion(versions, paper) {
  if (paper?.status !== "已发布" || !paper.publishedAt) return;
  if (versions.some((item) => item.publishedAt === paper.publishedAt)) return;
  const { publishedVersions: _publishedVersions, ...version } = structuredClone(paper);
  versions.push(version);
}
