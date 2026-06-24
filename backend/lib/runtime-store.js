import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answers, exam, questions, sessions } from "../data/store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = process.env.SMARTQ_DATA_FILE || join(root, "data", "runtime.json");
const legacyPersonPattern = /(?:\u540c\u5b66|\u5b66\u751f|\u8003\u751f)/;
const legacyPersonNamePattern = /[\u4e00-\u9fff]+(?:\u540c\u5b66|\u5b66\u751f|\u8003\u751f)/g;
const legacyClassToken = "\u73ed";
const legacyClassNameToken = "\u73ed\u7ea7";

let state = null;
let writeQueue = Promise.resolve();

export async function loadState() {
  if (state) return state;

  try {
    const raw = await readFile(dataFile, "utf8");
    state = normalizeState(JSON.parse(raw));
  } catch {
    state = normalizeState(defaultState());
    await saveState();
  }

  return state;
}

export async function saveState() {
  if (!state) return;
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(state, null, 2));
}

export async function updateState(mutator) {
  const operation = writeQueue.then(async () => {
    const current = await loadState();
    const result = await mutator(current);
    await saveState();
    return result ?? current;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export function getStateSync() {
  if (!state) {
    state = normalizeState(defaultState());
  }
  return state;
}

function defaultState() {
  const defaultGroups = groupsFromRows(sessions);
  return {
    exam,
    questions,
    sessions,
    candidates: sessions.map((session) => ({
      id: `cand-${session.ticket}`,
      candidate: session.candidate,
      ticket: session.ticket,
      className: session.className || "",
      createdAt: new Date().toISOString(),
    })),
    groups: defaultGroups.length ? defaultGroups : [defaultGroup()],
    answers: Object.fromEntries(answers.entries()),
    paper: {
      id: null,
      name: "",
      status: null,
      publishedAt: null,
      questionIds: [],
      buildSpec: null,
    },
    papers: [],
    generationTask: null,
    gradingResults: {},
    auditLog: [
      {
        id: "log-init",
        type: "system",
        message: "MVP 初始数据已加载",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

function normalizeState(input) {
  const normalizedSessions = (Array.isArray(input.sessions) ? input.sessions : sessions).map(normalizeSession);
  const normalizedCandidates = Array.isArray(input.candidates)
    ? input.candidates.map(normalizeCandidate).filter(Boolean)
    : normalizedSessions.map(candidateFromSession).filter(Boolean);
  const normalizedGroups = Array.isArray(input.groups) ? input.groups.map(normalizeGroup).filter(Boolean) : groupsFromRows([...normalizedSessions, ...normalizedCandidates]);
  const groups = normalizedGroups.length ? normalizedGroups : [defaultGroup()];
  return {
    exam: input.exam || exam,
    questions: Array.isArray(input.questions) ? input.questions : questions,
    sessions: normalizedSessions,
    candidates: normalizedCandidates,
    groups,
    answers: input.answers && typeof input.answers === "object" ? input.answers : Object.fromEntries(answers.entries()),
    paper: {
      id: input.paper?.id || null,
      name: input.paper?.name || "",
      status: ["已组卷", "已保存"].includes(input.paper?.status) ? "未发布" : input.paper?.status || null,
      publishedAt: input.paper?.publishedAt || null,
      questionIds: Array.isArray(input.paper?.questionIds) ? input.paper.questionIds : [],
      buildSpec: input.paper?.buildSpec || null,
    },
    papers: Array.isArray(input.papers) ? input.papers.map(normalizePaperSnapshot).filter(Boolean) : [],
    generationTask: input.generationTask || null,
    gradingResults: input.gradingResults && typeof input.gradingResults === "object" ? input.gradingResults : {},
    auditLog: Array.isArray(input.auditLog) ? input.auditLog.map(normalizeAuditItem) : [],
  };
}

function defaultGroup() {
  return {
    id: "group-default",
    name: "默认分组",
    description: "默认参与者分组",
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
}

function groupsFromRows(rows = []) {
  const names = [...new Set(rows.map((item) => neutralizeGroupName(item.className || item.class || "")).filter(Boolean))];
  return names.map((name, index) => ({
    id: `group-${index + 1}-${stableIdPart(name)}`,
    name,
    description: "",
    createdAt: new Date().toISOString(),
    updatedAt: null,
  }));
}

function normalizeGroup(item) {
  if (!item || typeof item !== "object") return null;
  const name = neutralizeGroupName(item.name || item.className || "");
  if (!name) return null;
  return {
    id: item.id || `group-${stableIdPart(name)}`,
    name,
    description: String(item.description || item.remark || "").trim(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || null,
  };
}

function stableIdPart(value) {
  return Buffer.from(String(value || "group")).toString("hex").slice(0, 16) || "group";
}

function candidateFromSession(session) {
  if (!session?.candidate || !session?.ticket) return null;
  return normalizeCandidate({
    id: `cand-${session.ticket}`,
    candidate: session.candidate,
    ticket: session.ticket,
    className: session.className || "",
    createdAt: session.assignedAt || session.createdAt,
  });
}

function normalizeCandidate(item) {
  if (!item || typeof item !== "object") return null;
  const candidate = neutralizePersonName(item.candidate || item.name || "", item.ticket);
  const ticket = String(item.ticket || "").trim();
  if (!candidate || !ticket) return null;
  return {
    id: item.id || `cand-${ticket}`,
    candidate,
    ticket,
    className: neutralizeGroupName(item.className || item.class || ""),
    phone: String(item.phone || "").trim(),
    email: String(item.email || "").trim(),
    description: String(item.description || item.remark || "").trim(),
    avatar: String(item.avatar || "").trim(),
    passwordHash: item.passwordHash || null,
    passwordUpdatedAt: item.passwordUpdatedAt || null,
    loginToken: item.loginToken || null,
    loginTokenExpiresAt: item.loginTokenExpiresAt || null,
    lastLoginAt: item.lastLoginAt || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || null,
  };
}

function normalizeAuditItem(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    message: neutralizeText(item.message),
  };
}

function neutralizeText(value) {
  return String(value || "").replace(legacyPersonNamePattern, "参与者");
}

function normalizeSession(item) {
  const time = item.time || `${item.startTime || "10:00"}-${item.endTime || "11:30"}`;
  const [startTime = "10:00", endTime = "11:30"] = String(time).split("-");
  return {
    ...item,
    candidate: neutralizePersonName(item.candidate || item.name || "", item.ticket),
    className: neutralizeGroupName(item.className || item.class || ""),
    remark: String(item.remark || item.description || "").trim(),
    paper: item.paperName || item.paper || "未绑定试卷",
    paperId: item.paperId || null,
    paperName: item.paperName || item.paper || "未绑定试卷",
    paperVariant: item.paperVariant || null,
    paperSnapshotVersion: item.paperSnapshotVersion || null,
    startTime: item.startTime || startTime,
    endTime: item.endTime || endTime,
    time,
    accessToken: item.accessToken || null,
    assignedAt: item.assignedAt || item.createdAt || null,
  };
}

function neutralizePersonName(value, ticket = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (legacyPersonPattern.test(text)) return `参与者 ${String(ticket || "").slice(-2) || ""}`.trim();
  return text;
}

function neutralizeGroupName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replaceAll(legacyClassNameToken, "分组").replaceAll(legacyClassToken, "组");
}

function normalizePaperSnapshot(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || `paper-${Date.now()}`,
    name: item.name || "未命名试卷",
    status: ["已组卷", "已保存"].includes(item.status) ? "未发布" : item.status || "未发布",
    score: Number(item.score || 0),
    questionCount: Number(item.questionCount || 0),
    typeGroups: item.typeGroups && typeof item.typeGroups === "object" ? item.typeGroups : {},
    questionIds: Array.isArray(item.questionIds) ? item.questionIds : [],
    questions: Array.isArray(item.questions) ? item.questions : [],
    buildSpec: item.buildSpec || null,
    publishedAt: item.publishedAt || null,
    createdAt: item.createdAt || item.buildSpec?.builtAt || new Date().toISOString(),
  };
}
