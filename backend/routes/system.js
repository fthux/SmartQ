import { aiConfig, buildPaper, validateQuestions } from "../lib/ai.js";
import { maxRequestBytes, sendJson } from "../lib/http.js";
import { storageInfo } from "../lib/runtime-store.js";

export async function handlePublicSystemRoutes(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const config = aiConfig();
    const storage = await storageInfo();
    sendJson(res, 200, {
      ok: true,
      service: "SmartQ",
      time: new Date().toISOString(),
      mode: config.mockMode ? "mock" : "provider",
      aiReady: config.mockMode || Boolean(config.apiKey),
      storage: {
        adapter: storage.adapter,
        requestedAdapter: storage.requestedAdapter,
        effectiveAdapter: storage.effectiveAdapter,
        degraded: storage.degraded,
        status: storage.status,
        exists: storage.exists,
        sizeBytes: storage.sizeBytes,
        updatedAt: storage.updatedAt,
        backupCount: storage.backupCount,
        latestBackupAt: storage.latestBackupAt,
      },
      limits: { maxRequestBytes },
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    const config = aiConfig();
    const mockMode = config.mockMode;
    const providerReady = Boolean(config.apiKey);
    sendJson(res, 200, {
      aiOnline: !mockMode && providerReady,
      aiReady: mockMode || providerReady,
      automationStatus: mockMode ? "AI mock 模式正常" : providerReady ? "AI 服务配置正常" : "AI 服务未配置密钥",
      mode: mockMode ? "mock" : "provider",
      mockMode,
    });
    return true;
  }
  return false;
}

export function handleDashboardRoute(req, res, url, state) {
  if (req.method !== "GET" || url.pathname !== "/api/dashboard") return false;
  const paper = buildPaper(state.questions, state.paper);
  const papers = state.papers || [];
  sendJson(res, 200, {
    exam: state.exam,
    stats: {
      questions: state.questions.length,
      papers: papers.length,
      published: papers.filter((item) => item.status === "已发布").length,
      drafts: papers.filter((item) => item.status !== "已发布").length,
      pendingReview: state.questions.filter((item) => item.status !== "已校验").length,
    },
    questions: state.questions,
    paper,
    papers,
    quality: validateQuestions(state.questions),
    generationTask: state.generationTask,
    auditLog: state.auditLog.slice(-8).reverse(),
  });
  return true;
}
