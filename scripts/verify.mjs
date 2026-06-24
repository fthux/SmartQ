import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.VERIFY_PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;
const runtimeDir = await mkdtemp(join(tmpdir(), "smartq-verify-"));
const runtimeFile = join(runtimeDir, "runtime.json");

const server = spawn(process.execPath, ["backend/server.js"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    SMARTQ_DATA_FILE: runtimeFile,
    AI_MOCK_MODE: "true",
  },
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth();

  const health = await getJson("/api/health");
  assert(health.ok === true, "health ok");
  const appShell = await getText("/");
  assert(appShell.includes('<div id="app"'), "root serves Vue SPA shell");
  assert(appShell.includes("/assets/app.js"), "root SPA loads app.js");
  const config = await getJson("/api/config");
  assert(config.aiReady === true, "config reports AI layer ready");
  assert(config.mode === "mock", "verification explicitly enables mock mode");
  assert(config.aiOnline === false, "config does not report provider online in mock mode");

  const dashboard = await getJson("/api/dashboard");
  assert(dashboard.exam.totalScore === 50, "exam total score is 50");
  assert(dashboard.paper.score === 50, "paper score is 50");
  assert(dashboard.questions.length === 12, "dashboard has 12 questions");

  const firstSession = await getJson("/api/candidate/session/s-001");
  const secondSession = await getJson("/api/candidate/session/s-002");
  assert(secondSession.session.id === "s-002", "candidate endpoint loads requested session");
  assert(secondSession.session.candidate === "周同学", "candidate endpoint returns requested candidate");
  assert(secondSession.session.paper === "B 卷", "candidate endpoint preserves legacy session label");
  assert(firstSession.questions[0].id === secondSession.questions[0].id, "candidate sessions use the assigned paper order without variant strategy");
  assert(secondSession.questions.reduce((sum, item) => sum + item.score, 0) === 50, "session paper score stays 50");
  const missingSession = await getJson("/api/candidate/session/s-999", { expectedStatus: 404 });
  assert(missingSession.error === "Session Not Found", "candidate endpoint rejects unknown session");

  const generationSpec = {
    title: "开发能力测评",
    paperName: "C++ 工程能力测评 A 卷",
    direction: "C++ 语言基础与工程实践",
    difficulty: "混合",
    totalScore: 50,
    typeCounts: { single: 4, multiple: 2, judge: 2, blank: 2, short: 2, essay: 0 },
    knowledge: ["语法基础", "STL", "内存管理", "面向对象", "异常处理"],
    requirements: "题干清晰，答案唯一或评分规则明确。",
  };
  const generated = await postJson("/api/ai/generate-questions", generationSpec);
  assert(generated.questions.length === 12, "AI generation returns 12 questions");
  assert(generated.saved === false, "AI generation returns an unsaved preview");
  assert(generated.spec.direction === generationSpec.direction, "AI generation preserves direction");
  assert(generated.spec.paperName === generationSpec.paperName, "AI generation preserves paper name");
  assert(generated.checks.specPass === true, "AI generation passes spec checks after normalization");
  assert(generated.checks.specFailures.length === 0, "AI generation reports no spec failures after normalization");
  assert(generated.questions.reduce((sum, item) => sum + Number(item.score || 0), 0) === 50, "AI generation respects total score");
  assert(generated.questions.every((item) => !item.stem.startsWith("【")), "AI generation does not prefix stems with direction text");
  assert(generated.questions.some((item) => item.knowledge.includes(generationSpec.direction)), "AI generation keeps requested direction in metadata");
  assert(generated.questions.filter((item) => item.type === "单选").length === 4, "AI generation respects single-choice count");
  assert(generated.questions.filter((item) => item.type === "多选").length === 2, "AI generation respects multiple-choice count");
  assert(generated.questions.filter((item) => item.type === "论述").length === 0, "AI generation respects zero essay count");
  assert(!generated.questions.some((item) => Array.isArray(item.options) && item.options.includes("与题干无关的描述")), "AI generation avoids generic repeated choice option");
  assert(generated.questions.filter((item) => item.type === "填空").every((item) => item.stem.includes("______") && !item.stem.includes("第 ")), "blank questions use real fill-in stems");
  assert(generated.questions.filter((item) => ["简答", "论述"].includes(item.type)).every((item) => !String(item.answer).startsWith("应结合C++ 语言基础与工程实践场景说明")), "subjective answers are concrete reference answers");
  assert(generated.questions.every((item) => item.id && item.type && item.stem && item.answer !== undefined && item.status === "待确认"), "AI generation normalizes required question fields");

  const previewDashboard = await getJson("/api/dashboard");
  assert(!previewDashboard.generationTask || previewDashboard.generationTask.paperName !== generationSpec.paperName, "unsaved generation does not enter question bank");
  const savedDraft = await postJson("/api/ai/save-question-draft", {
    questions: generated.questions,
    spec: generated.spec,
  });
  assert(savedDraft.saved === true, "generated preview can be saved as draft");
  const savedDashboard = await getJson("/api/dashboard");
  assert(savedDashboard.generationTask.paperName === generationSpec.paperName, "saved draft updates generation task");
  assert(savedDashboard.questions.length === 12, "saved draft replaces question bank");

  const quality = await postJson("/api/quality/check", {});
  assert(Number.isFinite(quality.schemaPassRate), "quality check returns schema pass rate");
  assert(Array.isArray(quality.failures), "quality check returns failures");

  const blockedPaperBuild = await postJson("/api/papers/build", {}, { expectedStatus: 409 });
  assert(blockedPaperBuild.eligibleCount === 0, "paper save requires reviewed questions");

  const repair = await postJson("/api/quality/repair", {});
  assert(repair.questions.length === 12, "quality repair returns questions");
  assert(Number.isFinite(repair.checks.stabilityScore), "quality repair returns stability score");
  assert(repair.questions.every((item) => item.status === "待确认"), "quality repair still requires manual review");

  const invalidDraftQuestion = await patchJson("/api/questions/q-001", { score: 0, status: "待确认" });
  assert(invalidDraftQuestion.score === 0, "invalid question draft can be saved for correction");
  const blockedInvalidReview = await patchJson("/api/questions/q-001", { status: "已校验" }, { expectedStatus: 409 });
  assert(blockedInvalidReview.error.includes("不能审核通过"), "invalid question cannot be reviewed");
  await patchJson("/api/questions/q-001", { score: generated.questions.find((item) => item.id === "q-001").score, status: "待确认" });

  const reviewed = await patchJson("/api/questions/q-003", { status: "已校验", quality: 92 });
  assert(reviewed.status === "已校验", "question review works");
  const unreviewed = await patchJson("/api/questions/q-003", { status: "待确认", quality: 88 });
  assert(unreviewed.status === "待确认", "question review can be cancelled");
  await patchJson("/api/questions/q-003", { status: "已校验", quality: 92 });
  const reviewedSubjective = await patchJson("/api/questions/q-008", { status: "已校验", quality: 92 });
  assert(reviewedSubjective.status === "已校验", "subjective question review works");
  const editedQuestion = await patchJson("/api/questions/q-011", {
    stem: "C++ 项目中题目生成失败后，以下哪种处理方式更适合正式 MVP？",
    status: "待确认",
    quality: 88,
  });
  assert(editedQuestion.stem.includes("正式 MVP"), "question edit works");
  const editedDashboard = await getJson("/api/dashboard");
  assert(editedDashboard.questions.find((item) => item.id === "q-011").status === "待确认", "edited question appears in dashboard");
  await patchJson("/api/questions/q-011", { status: "已校验", quality: 92 });
  await Promise.all(
    editedDashboard.questions
      .filter((item) => item.id !== "q-011")
      .map((item) => patchJson(`/api/questions/${item.id}`, { status: "已校验", quality: Math.max(92, Number(item.quality || 90)) })),
  );

  const paper = await postJson("/api/papers/build", {});
  assert(paper.status === "未发布", "paper save changes status");
  assert(paper.name === generationSpec.paperName, "paper save uses configured paper name");
  assert(paper.score === 50, "saved paper keeps all reviewed question scores");
  assert(paper.questionIds.length === paper.questionCount, "saved paper stores selected question ids");
  assert(paper.questionCount === generated.questions.length, "saved paper includes the reviewed draft questions");
  assert(paper.buildSpec.source === "saved-reviewed-questions", "saved paper records save source");
  const blockedSubmit = await postJson("/api/candidate/session/s-001", { submit: true, answers: {} }, { expectedStatus: 409 });
  assert(blockedSubmit.paperStatus === "未发布", "unpublished paper blocks submit");

  const savedPaperDashboard = await getJson("/api/dashboard");
  const savedSnapshot = savedPaperDashboard.papers.find((item) => item.id === paper.id);
  assert(savedSnapshot && savedSnapshot.status === "未发布", "saved paper appears in completed paper list as unpublished");
  const savedPaperDetail = await getJson(`/api/papers/${paper.id}`);
  assert(savedPaperDetail.questions.length === paper.questionCount, "paper detail returns saved paper questions");

  const publishedPaper = await postJson("/api/papers/publish", {});
  assert(publishedPaper.status === "已发布", "paper publish works");
  const paperDashboard = await getJson("/api/dashboard");
  assert(Array.isArray(paperDashboard.papers) && paperDashboard.papers.length >= 1, "dashboard exposes generated paper management list");
  assert(paperDashboard.papers.some((item) => item.name === generationSpec.paperName && item.status === "已发布"), "paper management list tracks published paper");
  const publishedPaperDetail = await getJson(`/api/papers/${paper.id}`);
  assert(publishedPaperDetail.status === "已发布", "paper detail reflects published status");
  const publishedSession = await getJson("/api/candidate/session/s-001");
  assert(publishedSession.access.canSubmit === false, "published waiting session cannot submit before heartbeat");
  assert(publishedSession.questions.length === paper.questionCount, "candidate session uses formal paper questions");
  const startedSession = await postJson("/api/candidate/session/s-001/heartbeat", {
    progress: 0,
    visibility: "visible",
  });
  assert(startedSession.status === "答题中", "heartbeat starts existing session after repaper");

  const assignedSession = await postJson("/api/proctor/sessions", {
    candidate: "测试考生",
    ticket: "202606239999",
    paperId: paper.id,
    startTime: "10:30",
    endTime: "12:00",
  }, { expectedStatus: 201 });
  assert(/^sess-[a-z0-9]+-[a-z0-9]{8}$/.test(assignedSession.id), "session assignment creates long random session id");
  assert(assignedSession.id.length >= 20, "session id is long enough for candidate links and exports");
  assert(assignedSession.paperId === paper.id, "session assignment binds published paper id");
  assert(assignedSession.paperName === generationSpec.paperName, "session assignment stores paper name");
  assert(assignedSession.remainingMinutes === 90, "session assignment computes remaining minutes");
  const duplicateTicket = await postJson("/api/proctor/sessions", {
    candidate: "重复考生",
    ticket: "202606239999",
  }, { expectedStatus: 409 });
  assert(duplicateTicket.error.includes("准考证号"), "session assignment rejects duplicate ticket");
  const assignedCandidate = await getJson(`/api/candidate/session/${assignedSession.id}`);
  assert(assignedCandidate.session.candidate === "测试考生", "candidate endpoint loads assigned session");
  assert(assignedCandidate.session.paper === generationSpec.paperName, "assigned session uses selected paper without variant strategy");
  assert(assignedCandidate.paper.id === paper.id, "assigned candidate receives bound paper snapshot");
  assert(assignedCandidate.access.canSubmit === false, "assigned session cannot submit before start");
  assert(assignedCandidate.access.sessionStatus === "待开考", "assigned session exposes waiting status");
  const blockedAssignedSubmit = await postJson(`/api/candidate/session/${assignedSession.id}`, { submit: true, answers: {} }, { expectedStatus: 409 });
  assert(blockedAssignedSubmit.sessionStatus === "待开考", "waiting session submit is blocked");
  const assignedHeartbeat = await postJson(`/api/candidate/session/${assignedSession.id}/heartbeat`, {
    progress: 0,
    visibility: "visible",
  });
  assert(assignedHeartbeat.status === "答题中", "heartbeat starts assigned session");
  const activeAssignedCandidate = await getJson(`/api/candidate/session/${assignedSession.id}`);
  assert(activeAssignedCandidate.access.canSubmit === true, "active assigned session can submit after paper publish");

  const batchAssignment = await postJson("/api/assignments/batch", {
    paperId: paper.id,
    startTime: "10:45",
    endTime: "12:15",
    candidates: [
      { candidate: "批量甲", ticket: "202606240001", className: "一班" },
      { candidate: "批量乙", ticket: "202606240002", className: "一班" },
    ],
  }, { expectedStatus: 201 });
  assert(batchAssignment.sessions.length === 2, "batch assignment creates candidate sessions");
  assert(batchAssignment.sessions.every((item) => item.paper === generationSpec.paperName), "batch assignment uses selected paper without variants");
  const assignmentPreview = await postJson("/api/assignments/import-preview", {
    text: "预览甲,202606240003,二班\n预览乙,202606240001,二班",
  });
  assert(assignmentPreview.validCount === 1, "assignment import preview counts valid rows");
  assert(assignmentPreview.invalidCount === 1, "assignment import preview catches duplicate tickets");
  const excelStylePreview = await postJson("/api/assignments/import-preview", {
    candidates: [
      { candidate: "模板甲", ticket: "202606240011", className: "三班" },
      { candidate: "模板乙", ticket: "202606240012", className: "三班" },
    ],
  });
  assert(excelStylePreview.validCount === 2, "assignment import preview accepts rows parsed from Excel templates");
  const dateTimeAssigned = await postJson("/api/assignments", {
    candidate: "日期考生",
    ticket: "202606240013",
    paperId: paper.id,
    startTime: "2026-06-24T09:00",
    endTime: "2026-06-24T10:30",
  }, { expectedStatus: 201 });
  assert(dateTimeAssigned.remainingMinutes === 90, "assignment supports datetime-local start and end values");

  const emptyAnalysis = await getJson("/api/analysis");
  assert(emptyAnalysis.averageScore === 0, "analysis has no default demo average before grading");
  assert(emptyAnalysis.passRate === 0, "analysis has no default demo pass rate before grading");
  assert(emptyAnalysis.gradedCount === 0, "analysis only counts reviewed grading results");

  const event = await postJson("/api/proctor/sessions/s-003/events", {
    risk: "高",
    event: "自动验证风险事件",
  });
  assert(event.risk === "高", "proctor event changes risk");

  const heartbeat = await postJson("/api/candidate/session/s-001/heartbeat", {
    progress: 50,
    visibility: "visible",
  });
  assert(heartbeat.lastSeenAt, "heartbeat updates lastSeenAt");

  const hiddenHeartbeat = await postJson("/api/candidate/session/s-001/heartbeat", {
    progress: 50,
    visibility: "hidden",
  });
  assert(hiddenHeartbeat.risk !== "低", "hidden heartbeat raises risk");

  const proctor = await getJson("/api/proctor/sessions");
  assert(proctor.events.some((item) => item.message.includes("离开考试页面")), "proctor event stream includes visibility risk");

  const answers = {
    "q-001": "B",
    "q-002": ["A", "B", "D"],
    "q-003": "错误",
    "q-005": "A",
    "q-009": "B",
    "q-010": "WebSocket",
  };
  const draft = await postJson("/api/candidate/session/s-001", {
    submit: false,
    answers: { "q-001": "B", "q-002": ["A", "B", "D"] },
  });
  assert(draft.submitted === false, "candidate draft save works");

  const draftSession = await getJson("/api/candidate/session/s-001");
  assert(draftSession.answers["q-001"] === "B", "draft answer is persisted");
  assert(draftSession.session.progress > 0, "draft save updates progress");

  const saved = await postJson("/api/candidate/session/s-001", { submit: true, answers });
  assert(saved.submitted === true, "candidate submit works");
  assert(saved.grading?.maxScore === paper.score, "candidate submit returns automatic grading result");
  assert(saved.grading.reviewStatus === "待复核", "candidate submit creates subjective review queue");
  const duplicateSubmit = await postJson("/api/candidate/session/s-001", { submit: true, answers }, { expectedStatus: 409 });
  assert(duplicateSubmit.error.includes("已提交"), "candidate submit rejects duplicate submit");
  const missingSubmit = await postJson("/api/candidate/session/s-999", { submit: false, answers: {} }, { expectedStatus: 404 });
  assert(missingSubmit.error === "Session Not Found", "candidate save rejects unknown session");

  const grading = saved.grading;
  assert(grading.maxScore === paper.score, "grading max score follows formal paper");
  assert(Number.isFinite(grading.totalScore), "grading returns a numeric score");
  assert(grading.reviewStatus === "待复核", "grading creates subjective review queue");
  assert(grading.subjectivePending > 0, "grading tracks pending subjective reviews");
  const gradingDashboard = await getJson("/api/dashboard");
  assert(gradingDashboard.gradingQueue.subjectivePending > 0, "dashboard reflects submit-time grading queue");

  const reviewPayload = grading.details
    .filter((item) => item.reviewRequired)
    .map((item) => ({
      questionId: item.questionId,
      awarded: item.awarded,
      comment: "验证流程确认 AI 初评分",
    }));
  const reviewedGrading = await postJson("/api/grading/review", {
    sessionId: "s-001",
    reviews: reviewPayload,
  });
  assert(reviewedGrading.reviewStatus === "已完成", "manual grading review completes result");
  assert(reviewedGrading.subjectivePending === 0, "manual grading review clears subjective pending count");

  const analysis = await getJson("/api/analysis");
  assert(analysis.gradedCount === 1, "analysis reflects graded count");
  assert(analysis.averageScore === reviewedGrading.totalScore, "analysis average score reflects reviewed grading result");
  assert(analysis.submittedCount >= 1, "analysis reflects submitted sessions");
  assert(analysis.riskCount >= 1, "analysis reflects risk sessions");
  assert(analysis.knowledge.some((item) => generationSpec.knowledge.includes(item.name)), "analysis knowledge uses paper knowledge points");
  assert(analysis.distribution.some((item) => item.count === 1), "analysis includes score distribution");

  const finalDashboard = await getJson("/api/dashboard");
  assert(finalDashboard.gradingQueue.objectiveDone >= 1, "dashboard reflects grading result");
  assert(finalDashboard.gradingQueue.subjectivePending === 0, "dashboard reflects completed grading review");
  assert(finalDashboard.gradingQueue.reviewDone >= 1, "dashboard reflects reviewed results");
  assert(finalDashboard.stats.risk >= 1, "dashboard reflects risk sessions");

  const firstAssignedBeforeSwitch = await getJson(`/api/candidate/session/${assignedSession.id}`);
  const firstAssignedStem = firstAssignedBeforeSwitch.questions[0].stem;
  const secondSpec = {
    ...generationSpec,
    paperName: "C++ 工程能力测评 B 卷",
    direction: "C++ 并发与性能优化",
    knowledge: ["并发控制", "性能分析", "内存模型", "线程安全", "调试诊断"],
  };
  const secondGenerated = await postJson("/api/ai/generate-questions", secondSpec);
  await postJson("/api/ai/save-question-draft", {
    questions: secondGenerated.questions,
    spec: secondGenerated.spec,
  });
  const secondDraftDashboard = await getJson("/api/dashboard");
  await Promise.all(
    secondDraftDashboard.questions.map((item) => patchJson(`/api/questions/${item.id}`, { status: "已校验", quality: Math.max(92, Number(item.quality || 90)) })),
  );
  const secondPaper = await postJson("/api/papers/build", {});
  await postJson("/api/papers/publish", {});
  const secondAssigned = await postJson("/api/assignments", {
    candidate: "第二卷考生",
    ticket: "202606240099",
    paperId: secondPaper.id,
    startTime: "13:00",
    endTime: "14:30",
  }, { expectedStatus: 201 });
  const firstAssignedAfterSwitch = await getJson(`/api/candidate/session/${assignedSession.id}`);
  const secondAssignedCandidate = await getJson(`/api/candidate/session/${secondAssigned.id}`);
  assert(firstAssignedAfterSwitch.paper.id === paper.id, "existing assignment keeps first paper after another paper is published");
  assert(firstAssignedAfterSwitch.questions[0].stem === firstAssignedStem, "existing assignment keeps first paper snapshot questions");
  assert(secondAssignedCandidate.paper.id === secondPaper.id, "new assignment receives second paper");
  assert(secondAssignedCandidate.questions.some((item) => item.knowledge.includes(secondSpec.direction)), "second assignment sees second paper questions");

  const resetPreview = await postJson("/api/ai/generate-questions", { ...generationSpec, direction: "C++ 语言进阶能力复测" });
  const beforeSaveResetDashboard = await getJson("/api/dashboard");
  assert(beforeSaveResetDashboard.paper.status === "已发布", "unsaved regenerated preview does not reset published paper");
  await postJson("/api/ai/save-question-draft", {
    questions: resetPreview.questions,
    spec: resetPreview.spec,
  });
  const resetDashboard = await getJson("/api/dashboard");
  assert(resetDashboard.paper.status === null, "question regeneration clears current paper status");
  assert(resetDashboard.paper.id === null, "question regeneration clears current paper id");
  assert(resetDashboard.gradingQueue.objectiveDone === 0, "question regeneration clears grading results");
  assert(resetDashboard.analysis.gradedCount === 0, "question regeneration clears analysis grading scope");
  const resetSession = await getJson("/api/candidate/session/s-001");
  assert(resetSession.session.status === "待开考", "question regeneration resets candidate session status");
  assert(Object.keys(resetSession.answers).length === 0, "question regeneration clears candidate answers");

  const deleteResult = await deleteJson(`/api/papers/${paper.id}`);
  assert(deleteResult.deleted === true, "paper delete works");
  const afterDeleteDashboard = await getJson("/api/dashboard");
  assert(!afterDeleteDashboard.papers.some((item) => item.id === paper.id), "deleted paper is removed from paper list");
  assert(afterDeleteDashboard.questions.length === resetPreview.questions.length, "deleting historical paper keeps current authoring question draft");
  assert(afterDeleteDashboard.generationTask.direction === resetPreview.spec.direction, "deleting historical paper keeps current generation task");

  console.log("SmartQ verification passed");
} catch (error) {
  console.error("SmartQ verification failed");
  console.error(error.message);
  if (output.trim()) {
    console.error("\nServer output:");
    console.error(output.trim());
  }
  process.exitCode = 1;
} finally {
  server.kill("SIGINT");
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const health = await getJson("/api/health");
      if (health.ok) return;
    } catch {
      await delay(150);
    }
  }
  throw new Error("Server did not become healthy");
}

async function getJson(path, options = {}) {
  return readJson(await fetch(`${baseUrl}${path}`), options);
}

async function getText(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`);
  const expectedStatus = options.expectedStatus || 200;
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text;
}

async function postJson(path, body, options = {}) {
  return readJson(
    await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    options,
  );
}

async function patchJson(path, body, options = {}) {
  return readJson(
    await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    options,
  );
}

async function deleteJson(path, options = {}) {
  return readJson(
    await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
    }),
    options,
  );
}

async function readJson(response, options = {}) {
  const text = await response.text();
  const expectedStatus = options.expectedStatus || 200;
  if (response.status !== expectedStatus) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return JSON.parse(text);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
