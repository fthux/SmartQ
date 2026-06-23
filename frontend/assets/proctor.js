const riskClass = {
  高: "border-rose-200 bg-rose-50 text-coral",
  中: "border-amber-200 bg-amber-50 text-amber-700",
  低: "border-emerald-200 bg-emerald-50 text-emerald-700",
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
  await refreshProctor();
  wireActions();
  setInterval(() => refreshProctor().catch(() => {}), 15000);
  window.lucide?.createIcons();
}

async function refreshProctor() {
  const dashboard = await request("/api/dashboard");
  renderHeader(dashboard.sessions);
  renderSummary(dashboard.sessions, dashboard.exam);
  renderSessions(dashboard.sessions);
  renderEvents(dashboard.proctorEvents || dashboard.auditLog || []);
  renderMetrics(dashboard.sessions);
  window.lucide?.createIcons();
}

function renderHeader(sessions) {
  const riskCount = sessions.filter((item) => item.risk !== "低").length;
  const risk = document.querySelector("[data-risk-count]");
  if (risk) risk.textContent = `${riskCount} 个风险`;
  const subtitle = document.querySelector("[data-session-subtitle]");
  if (subtitle) subtitle.textContent = `${sessions.length} 人展示 · 按考生会话展示试卷、时段、剩余时间`;
}

function renderSummary(sessions, exam) {
  const root = document.querySelector("[data-proctor-summary]");
  if (!root) return;
  const paperCounts = sessions.reduce((acc, item) => {
    acc[item.paper] = (acc[item.paper] || 0) + 1;
    return acc;
  }, {});
  root.innerHTML = [
    ["当前场次", `${exam.subject}测评`],
    ["试卷分布", Object.entries(paperCounts).map(([name, count]) => `${name} ${count}`).join(" · ")],
    ["考试时段", `${exam.windowStart} - ${exam.windowEnd}`],
    ["会话筛选", "全部考生 · 风险优先"],
  ]
    .map(
      ([label, value]) => `
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="text-xs font-bold text-slate-500">${label}</div>
          <div class="mt-1 truncate text-sm font-black">${escapeHtml(value)}</div>
        </div>
      `,
    )
    .join("");
}

function renderSessions(sessions) {
  const list = document.querySelector("[data-session-list]");
  if (!list) return;
  list.innerHTML = sessions
    .map((session) => {
      const cls = riskClass[session.risk] || "border-slate-200 bg-slate-50 text-slate-600";
      const cameraBg = session.risk === "高" ? "bg-slate-900" : session.risk === "中" ? "bg-slate-800" : "bg-slate-800";
      const detail = session.status === "已提交" ? "已提交 · 等待阅卷" : `余 ${session.remainingMinutes} 分 · ${session.events?.[0] || `进度 ${session.progress}%`}`;
      const candidateUrl = `/candidate.html?session=${encodeURIComponent(session.id)}`;
      return `
        <div class="rounded-lg border p-3 ${cls}">
          <div class="flex h-24 items-center justify-center rounded ${cameraBg} text-xs font-bold text-white">${escapeHtml(session.camera)}</div>
          <div class="mt-3 flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-sm font-black text-ink">${escapeHtml(session.candidate)}</div>
              <div class="truncate text-xs font-semibold text-slate-500">${escapeHtml(session.paper)} · ${escapeHtml(session.time)}</div>
              <div class="truncate text-xs font-semibold">${escapeHtml(detail)}</div>
            </div>
            <span class="rounded bg-white px-2 py-1 text-xs font-black">${session.status === "已提交" ? "完" : session.risk}</span>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-1.5">
            <a href="${candidateUrl}" target="_blank" class="rounded bg-white/80 px-2 py-1.5 text-center text-xs font-black text-slate-700 ring-1 ring-white">进入</a>
            <button data-copy-session-link="${session.id}" class="rounded bg-white/80 px-2 py-1.5 text-xs font-black text-slate-700 ring-1 ring-white">复制</button>
            <button data-proctor-event="${session.id}" class="rounded bg-white/80 px-2 py-1.5 text-xs font-black text-slate-700 ring-1 ring-white">风险</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderEvents(events) {
  const list = document.querySelector("[data-event-list]");
  if (!list) return;
  const visibleEvents = events.length ? events : [{ message: "暂无实时风险事件", createdAt: new Date().toISOString(), type: "empty" }];
  list.innerHTML = visibleEvents
    .slice(0, 8)
    .map((event) => {
      const tone =
        event.type === "proctor-event"
          ? "bg-rose-50 text-coral"
          : event.type === "exam-submit"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-slate-50 text-slate-600";
      return `
        <div class="flex items-center justify-between rounded px-3 py-2 text-sm font-semibold ${tone}">
          <span>${escapeHtml(event.message)}</span>
          <span>${formatTime(event.createdAt)}</span>
        </div>
      `;
    })
    .join("");
}

function renderMetrics(sessions) {
  const root = document.querySelector("[data-proctor-metrics]");
  if (!root) return;
  const online = sessions.filter((item) => item.status !== "离线").length;
  const submitted = sessions.filter((item) => item.status === "已提交").length;
  const active = sessions.filter((item) => item.status === "答题中").length;
  const risk = sessions.filter((item) => item.risk !== "低").length;
  root.innerHTML = [
    ["在线", online, "text-leaf"],
    ["答题中", active, "text-ocean"],
    ["已提交", submitted, "text-iris"],
    ["风险", risk, "text-coral"],
  ]
    .map(
      ([label, value, cls]) => `
        <div class="rounded-lg bg-slate-50 p-4">
          <div class="text-2xl font-black ${cls}">${value}</div>
          <div class="text-xs font-bold text-slate-500">${label}</div>
        </div>
      `,
    )
    .join("");
}

function wireActions() {
  document.getElementById("sessionAssignmentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const old = button.innerHTML;
    button.innerHTML = `<i data-lucide="loader-circle" class="h-4 w-4"></i> 分配中`;
    button.disabled = true;
    window.lucide?.createIcons();
    try {
      const session = await request("/api/proctor/sessions", {
        method: "POST",
        body: JSON.stringify(readSessionAssignment(form)),
      });
      await refreshProctor();
      await copyCandidateUrl(session.id);
      toast(`${session.candidate} 已分配考试，会话入口已生成`);
    } catch (error) {
      toast(`分配失败：${error.message}`);
    } finally {
      button.innerHTML = old;
      button.disabled = false;
      window.lucide?.createIcons();
    }
  });

  document.addEventListener("click", async (event) => {
    const refreshButton = event.target.closest("[data-refresh-proctor]");
    if (refreshButton) {
      await refreshProctor();
      toast("监控数据已刷新");
      return;
    }

    const proctorButton = event.target.closest("[data-proctor-event]");
    if (proctorButton) {
      await request(`/api/proctor/sessions/${proctorButton.dataset.proctorEvent}/events`, {
        method: "POST",
        body: JSON.stringify({ risk: "高", event: "监考员手动记录风险" }),
      });
      await refreshProctor();
      toast("风险事件已记录");
      return;
    }

    const copyButton = event.target.closest("[data-copy-session-link]");
    if (copyButton) {
      await copyCandidateUrl(copyButton.dataset.copySessionLink);
      toast("考生入口链接已复制");
    }
  });
}

function readSessionAssignment(form) {
  const data = new FormData(form);
  return {
    candidate: String(data.get("candidate") || "").trim(),
    ticket: String(data.get("ticket") || "").trim(),
    paper: String(data.get("paper") || "A 卷"),
    startTime: String(data.get("startTime") || "10:00").trim(),
    endTime: String(data.get("endTime") || "11:30").trim(),
  };
}

async function copyCandidateUrl(sessionId) {
  const url = `${window.location.origin}/candidate.html?session=${encodeURIComponent(sessionId)}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    window.prompt("复制考生入口链接", url);
  }
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "fixed right-8 top-8 z-50 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white shadow-soft";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init().catch((error) => {
  console.error(error);
  toast("监考数据加载失败");
});
