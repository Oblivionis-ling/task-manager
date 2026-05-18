const state = {
  providers: [],
  mode: "organize",
  data: null,
  activeDraft: null,
};

const $ = (id) => document.getElementById(id);

const labels = {
  active: "进行中",
  next: "下一步",
  waiting: "等待",
  blocked: "阻塞",
  later: "暂缓",
  done: "完成",
  today: "今日",
  week: "本周",
  project: "项目",
  inbox: "收集箱",
  high: "高",
  medium: "中",
  low: "低",
  small: "小",
  large: "大",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(text, good = false) {
  const pill = $("statusPill");
  pill.textContent = text;
  pill.classList.toggle("good", good);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error || `HTTP ${response.status}`);
    error.payload = json;
    throw error;
  }
  return json;
}

function saveProviderDraft() {
  localStorage.setItem(
    "task-manager-agent-provider",
    JSON.stringify({
      providerId: $("providerSelect").value,
      baseUrl: $("baseUrlInput").value,
      model: $("modelInput").value,
      apiKey: $("apiKeyInput").value,
    }),
  );
}

function loadProviderDraft() {
  try {
    return JSON.parse(localStorage.getItem("task-manager-agent-provider") || "{}");
  } catch {
    return {};
  }
}

function applyProvider(provider, draft = {}) {
  $("baseUrlInput").value = draft.baseUrl ?? provider.baseUrl ?? "";
  $("modelInput").value = draft.model ?? provider.model ?? "";
  $("apiKeyInput").value = draft.apiKey ?? "";
}

async function loadProviders() {
  const { providers } = await request("/api/providers");
  state.providers = providers;
  const draft = loadProviderDraft();
  $("providerSelect").innerHTML = providers
    .map((provider) => `<option value="${provider.id}">${escapeHtml(provider.name)}</option>`)
    .join("");
  $("providerSelect").value = draft.providerId || providers[0]?.id || "custom";
  const provider = providers.find((item) => item.id === $("providerSelect").value) || providers[0];
  applyProvider(provider, draft);
}

async function loadState() {
  state.data = await request("/api/state");
  renderState();
  setStatus("已连接本地数据", true);
}

function providerPayload() {
  const selected = state.providers.find((provider) => provider.id === $("providerSelect").value) || {};
  return {
    id: selected.id || "custom",
    baseUrl: $("baseUrlInput").value.trim(),
    model: $("modelInput").value.trim(),
    apiKey: $("apiKeyInput").value.trim(),
    apiKeyEnv: selected.apiKeyEnv || "",
    jsonMode: true,
    temperature: 0.2,
    thinking: selected.thinking || undefined,
    title: "task-manager-agent",
  };
}

function taskMeta(task) {
  return [
    task.due_date ? `截止 ${escapeHtml(task.due_date)}` : "",
    labels[task.impact] ? `影响 ${labels[task.impact]}` : "",
    labels[task.cost] ? `成本 ${labels[task.cost]}` : "",
    task.project ? escapeHtml(task.project) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderState() {
  const data = state.data;
  $("dataPathText").textContent = `数据文件：${data.store_path}`;
  $("updatedAtBadge").textContent = data.updated_at ? new Date(data.updated_at).toLocaleString() : "未保存";
  $("jsonOutput").textContent = JSON.stringify(data, null, 2);
  renderStats(data);
  renderToday(data.today_focus || []);
  renderTasks(data.tasks || []);
  renderHistory(data.history || []);
}

function renderStats(data) {
  const tasks = data.tasks || [];
  const open = tasks.filter((task) => task.status !== "done").length;
  const done = tasks.filter((task) => task.status === "done").length;
  const waiting = tasks.filter((task) => ["waiting", "blocked"].includes(task.bucket)).length;
  $("statsStrip").innerHTML = [
    ["未完成", open],
    ["今日", data.today_focus?.length || 0],
    ["等待/阻塞", waiting],
    ["已完成", done],
  ]
    .map(([label, count]) => `<span><strong>${count}</strong>${label}</span>`)
    .join("");
}

function renderToday(tasks) {
  if (!tasks.length) {
    $("todayList").innerHTML = `<div class="empty-state compact">今天没有锁定行动，可以先新增任务或生成草稿。</div>`;
    return;
  }
  $("todayList").innerHTML = tasks
    .map(
      (task) => `
        <article class="today-item">
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <p>${escapeHtml(task.next_action || task.notes || "补一个可执行的下一步")}</p>
            <span>${taskMeta(task)}</span>
          </div>
          <button class="secondary" data-action="complete-task" data-id="${task.id}">完成</button>
        </article>
      `,
    )
    .join("");
}

function bucketGroups(tasks) {
  return [
    ["today", "今日"],
    ["week", "本周"],
    ["project", "项目"],
    ["waiting", "等待"],
    ["blocked", "阻塞"],
    ["inbox", "收集箱"],
    ["later", "以后"],
    ["done", "完成"],
  ].map(([bucket, title]) => {
    const rows =
      bucket === "done"
        ? tasks.filter((task) => task.status === "done")
        : tasks.filter((task) => task.status !== "done" && task.bucket === bucket);
    return { bucket, title, rows };
  });
}

function option(value, label, selected) {
  return `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`;
}

function selectOptions(kind, selected) {
  if (kind === "bucket") {
    return [
      option("today", "今日", selected),
      option("week", "本周", selected),
      option("project", "项目", selected),
      option("waiting", "等待", selected),
      option("blocked", "阻塞", selected),
      option("inbox", "收集箱", selected),
      option("later", "以后", selected),
    ].join("");
  }
  if (kind === "status") {
    return [
      option("active", "进行中", selected),
      option("next", "下一步", selected),
      option("waiting", "等待", selected),
      option("blocked", "阻塞", selected),
      option("later", "暂缓", selected),
      option("done", "完成", selected),
    ].join("");
  }
  if (kind === "impact") {
    return [option("high", "高", selected), option("medium", "中", selected), option("low", "低", selected)].join("");
  }
  return [option("small", "小", selected), option("medium", "中", selected), option("large", "大", selected)].join("");
}

function renderEditableTask(task, mode) {
  const prefix = mode === "draft" ? "draft" : "task";
  const idAttr = mode === "draft" ? `data-index="${task.index}"` : `data-id="${task.id}"`;
  return `
    <article class="task-card ${mode}-card" ${idAttr}>
      <input class="task-title-input" data-${prefix}-field="title" value="${escapeHtml(task.title)}" placeholder="任务标题" />
      <textarea data-${prefix}-field="next_action" rows="2" placeholder="下一步动作">${escapeHtml(task.next_action)}</textarea>
      <div class="task-grid">
        <label>分类<select data-${prefix}-field="bucket">${selectOptions("bucket", task.bucket)}</select></label>
        <label>状态<select data-${prefix}-field="status">${selectOptions("status", task.status)}</select></label>
        <label>截止<input data-${prefix}-field="due_date" value="${escapeHtml(task.due_date)}" placeholder="YYYY-MM-DD" /></label>
        <label>影响<select data-${prefix}-field="impact">${selectOptions("impact", task.impact)}</select></label>
        <label>成本<select data-${prefix}-field="cost">${selectOptions("cost", task.cost)}</select></label>
        <label>项目<input data-${prefix}-field="project" value="${escapeHtml(task.project)}" placeholder="所属项目" /></label>
      </div>
      <textarea data-${prefix}-field="notes" rows="2" placeholder="备注">${escapeHtml(task.notes)}</textarea>
      ${
        mode === "task"
          ? `<div class="task-actions">
              <button class="secondary" data-action="save-task" data-id="${task.id}">保存修改</button>
              <button class="secondary" data-action="complete-task" data-id="${task.id}">完成</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderTasks(tasks) {
  const groups = bucketGroups(tasks);
  $("taskSections").innerHTML = groups
    .filter((group) => group.rows.length)
    .map(
      (group) => `
        <section class="task-group">
          <h3>${group.title}<span>${group.rows.length}</span></h3>
          <div class="task-list">
            ${group.rows.map((task) => renderEditableTask(task, "task")).join("")}
          </div>
        </section>
      `,
    )
    .join("");
  if (!$("taskSections").innerHTML) {
    $("taskSections").innerHTML = `<div class="empty-state compact">任务库为空，先快速新增或生成草稿。</div>`;
  }
}

function renderHistory(history) {
  if (!history.length) {
    $("historyList").innerHTML = `<div class="empty-state compact">暂无历史记录。</div>`;
    return;
  }
  $("historyList").innerHTML = history
    .slice(0, 12)
    .map(
      (item) => `
        <article class="history-item">
          <strong>${escapeHtml(item.title || item.type)}</strong>
          <span>${item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
        </article>
      `,
    )
    .join("");
}

function renderDraft(draft, model) {
  state.activeDraft = draft;
  $("modelBadge").textContent = draft ? model || draft.provider?.model || "已生成" : "未生成";
  $("draftEmpty").style.display = draft?.tasks?.length ? "none" : "block";
  $("commitDraftButton").disabled = !draft?.tasks?.length;
  $("clearDraftButton").disabled = !draft;
  $("draftList").innerHTML = (draft?.tasks || [])
    .map((task, index) => renderEditableTask({ ...task, index }, "draft"))
    .join("");
}

function readTaskCard(id) {
  const card = document.querySelector(`.task-card[data-id="${CSS.escape(id)}"]`);
  const values = {};
  card?.querySelectorAll("[data-task-field]").forEach((input) => {
    values[input.dataset.taskField] = input.value.trim();
  });
  return values;
}

function syncDraftFromDom() {
  if (!state.activeDraft) return;
  document.querySelectorAll(".draft-card").forEach((card) => {
    const index = Number(card.dataset.index);
    const task = state.activeDraft.tasks[index];
    if (!task) return;
    card.querySelectorAll("[data-draft-field]").forEach((input) => {
      task[input.dataset.draftField] = input.value.trim();
    });
  });
}

async function createDraft() {
  saveProviderDraft();
  $("draftButton").disabled = true;
  $("draftButton").textContent = "生成中";
  try {
    const result = await request("/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        mode: state.mode,
        input: $("inputText").value,
        provider: providerPayload(),
      }),
    });
    state.data = result.state;
    renderState();
    renderDraft(result.draft, result.model);
    setStatus(`草稿已生成：${result.draft.tasks.length} 个任务`, true);
  } catch (error) {
    $("jsonOutput").textContent = JSON.stringify(error.payload || { error: error.message }, null, 2);
    setStatus("草稿生成失败");
  } finally {
    $("draftButton").disabled = false;
    $("draftButton").textContent = "生成草稿";
  }
}

async function commitDraft() {
  if (!state.activeDraft) return;
  syncDraftFromDom();
  $("commitDraftButton").disabled = true;
  try {
    const result = await request(`/api/drafts/${encodeURIComponent(state.activeDraft.id)}/commit`, {
      method: "POST",
      body: JSON.stringify({ tasks: state.activeDraft.tasks }),
    });
    state.data = result.state;
    renderState();
    renderDraft(null);
    setStatus(`已入库：${result.tasks.length} 个任务`, true);
  } catch (error) {
    $("jsonOutput").textContent = JSON.stringify(error.payload || { error: error.message }, null, 2);
    setStatus("入库失败");
    $("commitDraftButton").disabled = false;
  }
}

async function quickAdd(event) {
  event.preventDefault();
  const title = $("quickTitleInput").value.trim();
  if (!title) return;
  const result = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title, bucket: "today", status: "active", impact: "medium", cost: "small" }),
  });
  $("quickTitleInput").value = "";
  state.data = result.state;
  renderState();
  setStatus("任务已添加", true);
}

async function saveTask(id) {
  const result = await request(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(readTaskCard(id)),
  });
  state.data = result.state;
  renderState();
  setStatus("任务已保存", true);
}

async function completeTask(id) {
  const result = await request(`/api/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" });
  state.data = result.state;
  renderState();
  setStatus("任务已完成", true);
}

function clearDraft() {
  renderDraft(null);
  setStatus("草稿已清空", true);
}

function wireEvents() {
  $("providerSelect").addEventListener("change", () => {
    const provider = state.providers.find((item) => item.id === $("providerSelect").value) || {};
    applyProvider(provider, { apiKey: $("apiKeyInput").value });
    saveProviderDraft();
  });
  ["baseUrlInput", "modelInput", "apiKeyInput"].forEach((id) => $(id).addEventListener("change", saveProviderDraft));
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      state.mode = button.dataset.mode;
    });
  });
  $("draftButton").addEventListener("click", createDraft);
  $("commitDraftButton").addEventListener("click", commitDraft);
  $("clearDraftButton").addEventListener("click", clearDraft);
  $("refreshButton").addEventListener("click", loadState);
  $("quickAddForm").addEventListener("submit", quickAdd);
  $("sampleButton").addEventListener("click", () => {
    $("inputText").value = [
      "数据链系统与技术第一次课堂讨论报告，5月11日前要交，先列大纲。",
      "矩阵分析九章作业和课程自学，5月31日前要推进，6月7日考试。",
      "人工智能安全论文 part3/4 和 PPT，5月19日前先确认范围。",
      "B站总结和 tyj 周报系统先放等待，别混到今天必做。",
    ].join("\n");
  });
  document.body.addEventListener("click", (event) => {
    const action = event.target?.dataset?.action;
    const id = event.target?.dataset?.id;
    if (action === "save-task" && id) saveTask(id);
    if (action === "complete-task" && id) completeTask(id);
  });
}

async function boot() {
  wireEvents();
  try {
    await loadProviders();
    await loadState();
  } catch (error) {
    $("jsonOutput").textContent = JSON.stringify(error.payload || { error: error.message }, null, 2);
    setStatus("启动失败");
  }
}

boot();
