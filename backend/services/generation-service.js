import { randomBytes } from "node:crypto";
import { generateQuestions } from "../lib/ai.js";

const generationJobs = new Map();
const generationJobTtlMs = 30 * 60 * 1000;

export function startGenerationJob(spec = {}) {
  cleanupGenerationJobs();
  const now = new Date().toISOString();
  const job = {
    id: `gen-${Date.now()}-${randomBytes(4).toString("hex")}`,
    status: "running",
    progress: 8,
    stage: "AI 出题任务已创建",
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
  };
  generationJobs.set(job.id, job);
  runGenerationJob(job, spec);
  return publicGenerationJob(job);
}

export function getGenerationJob(id) {
  cleanupGenerationJobs();
  const job = generationJobs.get(id);
  return job ? publicGenerationJob(job) : null;
}

async function runGenerationJob(job, spec) {
  updateGenerationJob(job, { progress: 36, stage: "连接 AI 出题服务" });
  try {
    const result = await generateQuestions(spec);
    updateGenerationJob(job, {
      status: "done",
      progress: 100,
      stage: "试卷已生成，等待确认",
      result: { ...result, saved: false, message: "试卷已生成，保存后才会进入草稿试卷列表。" },
    });
  } catch (error) {
    updateGenerationJob(job, {
      status: "error",
      progress: 100,
      stage: "生成失败",
      error: error.message || "AI 出题失败",
    });
  }
}

function updateGenerationJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function publicGenerationJob(job = {}) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.status === "done" ? job.result : undefined,
    error: job.status === "error" ? job.error : undefined,
  };
}

function cleanupGenerationJobs() {
  const cutoff = Date.now() - generationJobTtlMs;
  for (const [id, job] of generationJobs.entries()) {
    const updatedAt = Date.parse(job.updatedAt || job.createdAt || "");
    if (Number.isFinite(updatedAt) && updatedAt < cutoff) generationJobs.delete(id);
  }
}
