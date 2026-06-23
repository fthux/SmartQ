const state = {
  session: null,
  exam: null,
  paper: null,
  access: null,
  questions: [],
  answers: {},
  autosaveTimer: null,
};

const typeClass = {
  单选: "border-ocean bg-cyan-50 text-ocean",
  多选: "border-iris bg-indigo-50 text-iris",
  判断: "border-leaf bg-emerald-50 text-leaf",
  填空: "border-slate-200 bg-slate-50 text-slate-500",
  简答: "border-ocean bg-cyan-50 text-slate-700",
  论述: "border-slate-200 bg-slate-50 text-slate-500",
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    let message = `${path} ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function init() {
  const sessionId = new URLSearchParams(window.location.search).get("session") || "s-001";
  const data = await request(`/api/candidate/session/${encodeURIComponent(sessionId)}`);
  state.session = data.session;
  state.exam = data.exam;
  state.paper = data.paper;
  state.access = data.access;
  state.questions = data.questions;
  state.answers = data.answers;
  renderHeader();
  renderQuestionList();
  renderAnswerSheet();
  wireActions();
  window.lucide?.createIcons();
}

function renderHeader() {
  const title = document.querySelector("h1");
  if (title) title.textContent = state.exam.title;

  const sessionLabel = [...document.querySelectorAll(".text-sm.font-bold.text-ocean")].find((el) =>
    el.textContent.includes("考生会话"),
  );
  if (sessionLabel) sessionLabel.textContent = `考生会话 ${state.session.id}`;

  const chips = [...document.querySelectorAll("h1 + div span")];
  const [start, end] = state.session.time.split("-");
  const values = [
    `考生：${state.session.candidate}`,
    `准考证：${state.session.ticket}`,
    `试卷：${state.session.paper}`,
    `时段：${start} - ${end}`,
    `总分：${state.exam.totalScore}`,
  ];
  chips.forEach((chip, index) => {
    chip.textContent = values[index];
  });

  const topExam = [...document.querySelectorAll("header .rounded-lg")].find((el) => el.textContent.includes("综合能力测评"));
  if (topExam) topExam.textContent = `${state.exam.subject}测评 · ${state.session.paper}`;
  renderAccessState();

  replaceStatus("题目", state.questions.length);
  replaceStatus("已答", Object.keys(state.answers).length);
  replaceStatus("进度", `${state.session.progress}%`);
}

function renderAccessState() {
  const statusBadge = [...document.querySelectorAll("header .flex.items-center.gap-2.rounded-lg")].find((el) =>
    el.textContent.includes("已连接") || el.textContent.includes("可提交") || el.textContent.includes("未发布") || el.textContent.includes("待开考") || el.textContent.includes("已提交"),
  );
  if (statusBadge && state.access) {
    const label = state.access.canSubmit ? "可提交" : state.access.sessionStatus || "未发布";
    statusBadge.className = state.access.canSubmit
      ? "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"
      : "flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700";
    statusBadge.innerHTML = `<span class="h-2 w-2 rounded-full ${state.access.canSubmit ? "bg-emerald-500" : "bg-amber-500"}"></span>${label}`;
  }

  const submitButton = document.getElementById("submitExamBtn");
  if (submitButton && state.access) {
    submitButton.disabled = !state.access.canSubmit;
    submitButton.className = state.access.canSubmit
      ? "mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-black text-white"
      : "mt-5 flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-slate-300 text-sm font-black text-white";
  }

  const warning = [...document.querySelectorAll("aside .rounded-lg")].find((el) => el.textContent.includes("离开考试页面"));
  if (warning && state.access) {
    warning.textContent = state.access.message + "。离开考试页面、关闭监考权限或切换屏幕会被记录为风险事件。";
  }
}

function renderQuestionList() {
  const paperCard = [...document.querySelectorAll(".rounded-lg.border")].find((el) => el.textContent.includes("试卷内容"));
  const list = paperCard?.querySelector(".divide-y");
  if (!list) return;

  list.innerHTML = state.questions
    .slice(0, 10)
    .map((question, index) => renderQuestion(question, index))
    .join("");
}

function renderQuestion(question, index) {
  const answered = state.answers[question.id] !== undefined;
  const status = answered ? "已答" : index === 7 ? "已标记" : "未答";
  const statusClass =
    status === "已答" ? "bg-emerald-50 text-emerald-700" : status === "已标记" ? "bg-amber-50 text-amber-700" : "bg-white text-slate-500 ring-1 ring-slate-200";

  let body = "";
  if (["单选", "多选"].includes(question.type)) {
    body = `<div class="mt-4 grid grid-cols-2 gap-3">${question.options
      .map((option, optionIndex) => {
        const letter = String.fromCharCode(65 + optionIndex);
        const selected = isSelected(question.id, letter);
        const selectedClass = selected ? typeClass[question.type] : "border-slate-200 bg-white text-slate-700";
        const markClass = selected ? (question.type === "多选" ? "rounded bg-iris text-white" : "rounded-full bg-ocean text-white") : question.type === "多选" ? "rounded border border-slate-300" : "rounded-full border border-slate-300";
        return `<label class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-semibold ${selectedClass}">
          <input class="sr-only" type="${question.type === "多选" ? "checkbox" : "radio"}" name="${question.id}" value="${letter}" data-answer-input data-question-id="${question.id}" data-question-type="${question.type}" ${selected ? "checked" : ""} />
          <span class="flex h-6 w-6 items-center justify-center ${markClass}">${letter}</span>${escapeHtml(option)}
        </label>`;
      })
      .join("")}</div>`;
  } else if (question.type === "判断") {
    body = `<div class="mt-4 flex gap-3">${["正确", "错误"]
      .map((value) => {
        const selected = state.answers[question.id] === value;
        return `<label class="flex w-36 cursor-pointer items-center justify-center rounded-lg border ${selected ? "border-leaf bg-emerald-50 text-leaf" : "border-slate-200 bg-white text-slate-500"} p-3 text-sm font-black">
          <input class="sr-only" type="radio" name="${question.id}" value="${value}" data-answer-input data-question-id="${question.id}" data-question-type="${question.type}" ${selected ? "checked" : ""} />${value}
        </label>`;
      })
      .join("")}</div>`;
  } else if (question.type === "填空") {
    body = `<input class="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-ocean focus:bg-white" value="${escapeAttr(state.answers[question.id] || "")}" placeholder="请输入答案" data-answer-input data-question-id="${question.id}" data-question-type="${question.type}" />`;
  } else {
    body = `<textarea class="mt-4 min-h-28 w-full resize-y rounded-lg border ${answered ? "border-ocean bg-cyan-50" : "border-slate-200 bg-slate-50"} p-4 text-sm font-semibold leading-6 text-slate-700 outline-none focus:border-ocean focus:bg-white" placeholder="请输入作答内容" data-answer-input data-question-id="${question.id}" data-question-type="${question.type}">${escapeHtml(state.answers[question.id] || "")}</textarea>`;
  }

  return `
    <article class="py-5">
      <div class="flex items-start justify-between">
        <div>
          <div class="text-sm font-black">${index + 1}. ${question.type}题 <span class="ml-2 text-slate-400">${question.score} 分</span></div>
          <p class="mt-3 text-base font-semibold">${escapeHtml(question.stem)}</p>
        </div>
        <span class="rounded px-2 py-1 text-xs font-bold ${statusClass}">${status}</span>
      </div>
      ${body}
    </article>
  `;
}

function renderAnswerSheet() {
  const answerCard = [...document.querySelectorAll("aside .rounded-lg")].find((el) => el.textContent.includes("答题卡"));
  const grid = answerCard?.querySelector(".grid.grid-cols-6");
  if (!grid) return;
  grid.innerHTML = state.questions
    .map((question, index) => {
      const answered = state.answers[question.id] !== undefined;
      const marked = index === 7;
      const cls = answered
        ? "bg-ink text-white"
        : marked
          ? "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
          : "bg-white text-slate-500 ring-1 ring-slate-200";
      return `<button class="h-10 rounded-lg text-sm font-black ${cls}">${index + 1}</button>`;
    })
    .join("");

  const summary = answerCard.querySelector(".grid.grid-cols-3");
  if (summary) {
    const answered = Object.keys(state.answers).length;
    summary.innerHTML = `
      <div class="rounded bg-ink px-2 py-2 text-white">已答 ${answered}</div>
      <div class="rounded bg-white px-2 py-2 text-slate-500 ring-1 ring-slate-200">未答 ${state.questions.length - answered}</div>
      <div class="rounded bg-amber-100 px-2 py-2 text-amber-700">标记 1</div>
    `;
  }

  updateSubmitCheck();
  renderHeader();
}

function updateSubmitCheck() {
  const answered = Object.keys(state.answers).length;
  const panels = [...document.querySelectorAll("aside .rounded-lg")];
  const panel = panels.find((el) => el.textContent.includes("提交检查"));
  const rows = panel?.querySelectorAll(".flex.items-center.justify-between");
  if (!rows?.length) return;
  rows[0].lastElementChild.textContent = `${answered} / ${state.questions.length}`;
  rows[1].lastElementChild.textContent = String(state.questions.length - answered);
  rows[2].lastElementChild.textContent = "1";
  rows[3].lastElementChild.textContent = "已同步";
}

function wireActions() {
  if (wireActions.bound) return;
  wireActions.bound = true;

  document.getElementById("submitExamBtn")?.addEventListener("click", async (event) => {
    if (!state.access?.canSubmit) {
      toast(state.access?.message || "当前不能提交");
      return;
    }
    const button = event.currentTarget;
    const old = button.innerHTML;
    button.innerHTML = `<i data-lucide="loader-circle" class="h-4 w-4"></i> 提交中`;
    window.lucide?.createIcons();
    try {
      const result = await request(`/api/candidate/session/${state.session.id}`, {
        method: "POST",
        body: JSON.stringify({ answers: state.answers, submit: true }),
      });
      const grading = result.grading;
      toast(grading ? `提交成功，当前自动评分 ${grading.totalScore}/${grading.maxScore}` : "提交成功，已进入阅卷队列");
    } catch (error) {
      toast(`提交失败：${error.message}`);
    } finally {
      button.innerHTML = old;
      window.lucide?.createIcons();
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-answer-input]");
    if (!input) return;
    updateAnswerFromInput(input);
  });

  document.addEventListener("input", (event) => {
    const input = event.target.closest("input[data-answer-input], textarea[data-answer-input]");
    if (!input || ["radio", "checkbox"].includes(input.type)) return;
    updateAnswerFromInput(input);
  });

  const submitButton = document.getElementById("submitExamBtn");
  if (submitButton && !document.getElementById("saveDraftBtn")) {
    const saveButton = document.createElement("button");
    saveButton.id = "saveDraftBtn";
    saveButton.className = "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700";
    saveButton.innerHTML = `<i data-lucide="save" class="h-4 w-4"></i>保存草稿`;
    submitButton.insertAdjacentElement("beforebegin", saveButton);
    saveButton.addEventListener("click", saveDraft);
  }

  startHeartbeat();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendHeartbeat("hidden").catch(() => {});
    }
  });
}

function updateAnswerFromInput(input) {
  const questionId = input.dataset.questionId;
  const type = input.dataset.questionType;
  if (!questionId) return;

  if (type === "多选") {
    const checked = [...document.querySelectorAll(`input[name="${questionId}"]:checked`)].map((item) => item.value);
    if (checked.length) {
      state.answers[questionId] = checked;
    } else {
      delete state.answers[questionId];
    }
  } else {
    const value = input.value.trim();
    if (value) {
      state.answers[questionId] = value;
    } else {
      delete state.answers[questionId];
    }
  }

  renderAnswerSheet();
  markAutosavePending();
}

async function saveDraft(event) {
  const button = event.currentTarget;
  const old = button.innerHTML;
  button.innerHTML = `<i data-lucide="loader-circle" class="h-4 w-4"></i>保存中`;
  window.lucide?.createIcons();
  try {
    const result = await persistDraft();
    setSaveState(`已同步 · ${formatTime(result.savedAt)}`);
    toast("草稿已保存");
  } catch (error) {
    toast(`保存失败：${error.message}`);
  } finally {
    button.innerHTML = old;
    window.lucide?.createIcons();
  }
}

function markAutosavePending() {
  setSaveState("待保存");
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    persistDraft()
      .then((result) => setSaveState(`已同步 · ${formatTime(result.savedAt)}`))
      .catch(() => setSaveState("保存失败"));
  }, 1200);
}

async function persistDraft() {
  return request(`/api/candidate/session/${state.session.id}`, {
    method: "POST",
    body: JSON.stringify({ answers: state.answers, submit: false }),
  });
}

function setSaveState(text) {
  const panels = [...document.querySelectorAll("aside .rounded-lg")];
  const submitPanel = panels.find((el) => el.textContent.includes("提交检查"));
  const rows = submitPanel?.querySelectorAll(".flex.items-center.justify-between");
  if (rows?.[3]) rows[3].lastElementChild.textContent = text;
  const autosaveCard = [...document.querySelectorAll(".text-sm.font-black")].find((el) => el.textContent.trim() === "自动保存")?.closest(".rounded-lg");
  const autosaveText = autosaveCard?.querySelector(".mt-2");
  if (autosaveText) autosaveText.textContent = text;
}

function startHeartbeat() {
  sendHeartbeat(document.visibilityState).catch(() => {});
  setInterval(() => {
    sendHeartbeat(document.visibilityState).catch(() => {});
  }, 15000);
}

async function sendHeartbeat(visibility) {
  if (!state.session) return;
  const answered = Object.keys(state.answers).length;
  const progress = Math.round((answered / state.questions.length) * 100);
  const session = await request(`/api/candidate/session/${state.session.id}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ progress, visibility }),
  });
  state.session = session;
}

function replaceStatus(label, value) {
  const cards = [...document.querySelectorAll(".grid.min-w-\\[360px\\] > div")];
  const card = cards.find((item) => item.textContent.includes(label));
  const number = card?.querySelector(".text-xl");
  if (number) number.textContent = value;
}

function isSelected(questionId, letter) {
  const value = state.answers[questionId];
  return Array.isArray(value) ? value.includes(letter) : value === letter;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "fixed right-8 top-8 z-50 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white shadow-soft";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

init().catch((error) => {
  console.error(error);
  toast("考生会话加载失败");
});
