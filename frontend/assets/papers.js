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
  await refreshPapers();
  wireActions();
  window.lucide?.createIcons();
}

async function refreshPapers() {
  const dashboard = await request("/api/dashboard");
  renderPaperMetrics(dashboard.papers || []);
  renderPaperList(dashboard.papers || []);
  window.lucide?.createIcons();
}

function renderPaperMetrics(papers) {
  const root = document.querySelector("[data-paper-metrics]");
  if (!root) return;
  const published = papers.filter((item) => item.status === "已发布").length;
  const saved = papers.filter((item) => ["未发布", "已保存", "已组卷"].includes(item.status)).length;
  const questionCount = papers.reduce((sum, item) => sum + Number(item.questionCount || 0), 0);
  root.innerHTML = [
    ["历史试卷", papers.length, "text-ink"],
    ["已发布", published, "text-leaf"],
    ["未发布", saved, "text-iris"],
    ["列表题数", questionCount, "text-ocean"],
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

function renderPaperList(papers) {
  const list = document.querySelector("[data-paper-list]");
  const summary = document.querySelector("[data-paper-list-summary]");
  if (!list) return;
  const sortedRows = papers
    .slice()
    .sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
  if (summary) summary.textContent = `共 ${sortedRows.length} 份试卷 · 最新优先 · 长列表可滚动`;
  if (!sortedRows.length) {
    list.innerHTML = `<div class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">暂无已出卷子，请先在命题台完成审核并保存试卷</div>`;
    return;
  }
  list.innerHTML = sortedRows
    .map((item) => {
      const typeText = Object.entries(item.typeGroups || {})
        .map(([type, count]) => `${type}${count}`)
        .join(" · ") || "结构待生成";
      return `
        <div class="rounded-lg border border-slate-200 bg-white p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-base font-black text-ink">${escapeHtml(item.name || "未命名试卷")}</div>
              <div class="mt-1 text-sm font-semibold text-slate-500">${item.score || 0} 分 · ${item.questionCount || 0} 题 · ${escapeHtml(typeText)}</div>
              <div class="mt-2 text-xs font-semibold text-slate-400">${formatDateTime(item.publishedAt || item.createdAt)}</div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="rounded bg-white px-2 py-1 text-xs font-black text-slate-600">${escapeHtml(displayPaperStatus(item.status))}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function displayPaperStatus(status) {
  return ["已组卷", "已保存"].includes(status) ? "未发布" : status || "未保存";
}

function wireActions() {
  document.addEventListener("click", async (event) => {
    const refreshButton = event.target.closest("[data-refresh-papers]");
    if (refreshButton) {
      await refreshPapers();
      toast("试卷列表已刷新");
      return;
    }

  });
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "fixed right-8 top-8 z-50 rounded-lg bg-ink px-4 py-3 text-sm font-bold text-white shadow-soft";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "未发布";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  toast("试卷数据加载失败");
});
