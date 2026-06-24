import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answers, exam, questions, sessions } from "../data/store.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = process.env.SMARTQ_DATA_FILE || join(root, "data", "runtime.json");

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
  return {
    exam,
    questions,
    sessions,
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
  return {
    exam: input.exam || exam,
    questions: Array.isArray(input.questions) ? input.questions : questions,
    sessions: (Array.isArray(input.sessions) ? input.sessions : sessions).map(normalizeSession),
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
    auditLog: Array.isArray(input.auditLog) ? input.auditLog : [],
  };
}

function normalizeSession(item) {
  const time = item.time || `${item.startTime || "10:00"}-${item.endTime || "11:30"}`;
  const [startTime = "10:00", endTime = "11:30"] = String(time).split("-");
  return {
    ...item,
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
