export function upsertPaperSnapshot(state, paper, actor = {}, ownerUserId = "") {
  state.papers = Array.isArray(state.papers) ? state.papers : [];
  const index = state.papers.findIndex((item) => item.id === paper.id);
  const existing = index >= 0 ? state.papers[index] : null;
  const now = new Date().toISOString();
  const ownerId = String(existing?.ownerUserId || ownerUserId || actor.userId || "");
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
    ownerUserId: ownerId,
    createdByUserId: existing?.createdByUserId || ownerId,
    updatedByUserId: String(actor.userId || existing?.updatedByUserId || ownerId),
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

export function paperPrintPayload(paper, requestedPublishedAt = "") {
  const versions = publishedPaperVersions(paper);
  if (!versions.length) {
    return { error: "该试卷还没有可打印的发布版本", statusCode: 409 };
  }
  const publishedAt = String(requestedPublishedAt || "").trim();
  const selected = publishedAt
    ? versions.find((item) => item.publishedAt === publishedAt)
    : versions[0];
  if (!selected) {
    return { error: "指定的试卷发布版本不存在，请刷新后重试", statusCode: 404 };
  }
  const questions = Array.isArray(selected.questions) ? selected.questions.map(printableQuestion) : [];
  return {
    paperId: paper.id,
    versions: versions.map((item) => ({
      publishedAt: item.publishedAt,
      name: item.name,
      questionCount: Number(item.questionCount || item.questions?.length || 0),
      score: Number(item.score || 0),
    })),
    selectedVersion: {
      id: selected.id,
      name: selected.name,
      status: "已发布",
      score: Number(selected.score || 0),
      questionCount: Number(selected.questionCount || questions.length),
      typeGroups: selected.typeGroups && typeof selected.typeGroups === "object" ? selected.typeGroups : {},
      publishedAt: selected.publishedAt,
      questions,
    },
  };
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

function publishedPaperVersions(paper = {}) {
  const versions = [];
  const seen = new Set();
  for (const item of Array.isArray(paper.publishedVersions) ? paper.publishedVersions : []) {
    if (!item?.publishedAt || seen.has(item.publishedAt)) continue;
    seen.add(item.publishedAt);
    versions.push(structuredClone(item));
  }
  if (paper.status === "已发布" && paper.publishedAt && !seen.has(paper.publishedAt)) {
    const { publishedVersions: _publishedVersions, ...current } = structuredClone(paper);
    versions.push(current);
  }
  return versions.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

function printableQuestion(question = {}) {
  return {
    id: String(question.id || ""),
    type: String(question.type || ""),
    stem: String(question.stem || ""),
    options: Array.isArray(question.options) ? question.options.map(String) : [],
    answer: Array.isArray(question.answer) ? question.answer.map(String) : String(question.answer ?? ""),
    score: Number(question.score || 0),
    explanation: String(question.explanation || ""),
    rubric: Array.isArray(question.rubric) ? question.rubric.map(String) : [],
  };
}
