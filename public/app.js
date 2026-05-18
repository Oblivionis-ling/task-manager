const state = {
  providers: [],
  mode: "organize",
};

const $ = (id) => document.getElementById(id);

function setStatus(text, good = false) {
  const pill = $("statusPill");
  pill.textContent = text;
  pill.style.color = good ? "#7cf2c5" : "";
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
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
    .map((provider) => `<option value="${provider.id}">${provider.name}</option>`)
    .join("");
  $("providerSelect").value = draft.providerId || providers[0]?.id || "custom";
  const provider = providers.find((item) => item.id === $("providerSelect").value) || providers[0];
  applyProvider(provider, draft);
}

async function refreshContext() {
  const context = await request("/api/context");
  if (context.initialized) {
    setStatus(`已连接：${context.taskRoot}`, true);
  } else {
    setStatus("未初始化任务目录");
  }
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

function renderResult(result) {
  const payload = result.payload || {};
  const counts = [
    ["今日重点", payload.today_focus?.length || 0],
    ["本周推进", payload.week_focus?.length || 0],
    ["收集箱", payload.inbox?.length || 0],
    ["等待/阻塞", (payload.waiting?.length || 0) + (payload.blocked?.length || 0)],
  ];
  $("resultSummary").innerHTML = counts
    .map(([label, count]) => `<div class="summary-card"><span>${label}</span><strong>${count}</strong></div>`)
    .join("");
  $("jsonOutput").textContent = JSON.stringify(result, null, 2);
  $("modelBadge").textContent = result.model || "已运行";
}

async function runAgent() {
  saveProviderDraft();
  $("runButton").disabled = true;
  $("runButton").textContent = "运行中";
  try {
    const result = await request("/api/agent/run", {
      method: "POST",
      body: JSON.stringify({
        mode: state.mode,
        input: $("inputText").value,
        provider: providerPayload(),
        persist: $("persistToggle").checked,
      }),
    });
    renderResult(result);
    const changed = result.persistence?.changed_files?.length || 0;
    setStatus($("persistToggle").checked ? `已保存，修改 ${changed} 个文件` : "仅预览，未保存", true);
  } catch (error) {
    $("jsonOutput").textContent = error.message;
    setStatus("运行失败");
  } finally {
    $("runButton").disabled = false;
    $("runButton").textContent = "运行 Agent";
  }
}

async function initTaskSystem() {
  try {
    const result = await request("/api/init", {
      method: "POST",
      body: JSON.stringify({
        taskRoot: $("taskRootInput").value,
        triggerMode: $("triggerModeInput").value,
        createTemplates: true,
      }),
    });
    $("jsonOutput").textContent = JSON.stringify(result, null, 2);
    await refreshContext();
  } catch (error) {
    $("jsonOutput").textContent = error.message;
  }
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
  $("runButton").addEventListener("click", runAgent);
  $("initButton").addEventListener("click", initTaskSystem);
  $("refreshButton").addEventListener("click", refreshContext);
  $("sampleButton").addEventListener("click", () => {
    $("inputText").value = [
      "数据链系统与技术第一次课堂讨论报告，5月11日前要交，先列大纲。",
      "矩阵分析九章作业和课程自学，5月31日前要推进，6月7日考试。",
      "人工智能安全论文 part3/4 和 PPT，5月19日前先确认范围。",
      "B站总结和 tyj 周报系统先放等待，别混到今天必做。",
    ].join("\n");
  });
}

async function boot() {
  wireEvents();
  await loadProviders();
  await refreshContext();
}

boot();
