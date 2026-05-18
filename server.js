#!/usr/bin/env node
"use strict";

const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");

const repoRoot = __dirname;
const publicRoot = path.join(repoRoot, "public");
const dataDir = process.env.TASK_MANAGER_DATA_DIR
  ? path.resolve(process.env.TASK_MANAGER_DATA_DIR)
  : path.join(repoRoot, ".task-manager-data");
const storePath = path.join(dataDir, "store.json");
const backupDir = path.join(dataDir, "backups");

const historyLimit = 30;
const draftLimit = 20;

const taskFields = [
  "title",
  "status",
  "bucket",
  "due_date",
  "impact",
  "cost",
  "next_action",
  "project",
  "notes",
  "waiting_for",
  "blocked_reason",
];

const providers = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    thinking: "disabled",
    note: "Lower-cost DeepSeek default.",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    thinking: "disabled",
    note: "Stronger DeepSeek preset.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    apiKeyEnv: "OPENROUTER_API_KEY",
    note: "Router preset for provider and price switching.",
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    baseUrl: "",
    model: "",
    apiKeyEnv: "",
    note: "Any provider that supports /chat/completions.",
  },
];

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, status, value, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(value);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function defaultStore() {
  const timestamp = now();
  return {
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    settings: {
      today_limit: 5,
    },
    tasks: [],
    drafts: [],
    history: [],
  };
}

function normalizeStore(store) {
  const normalized = store && typeof store === "object" ? store : defaultStore();
  normalized.version = 1;
  normalized.created_at = normalized.created_at || now();
  normalized.updated_at = normalized.updated_at || normalized.created_at;
  normalized.settings = {
    today_limit: 5,
    ...(normalized.settings && typeof normalized.settings === "object" ? normalized.settings : {}),
  };
  normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks.map((task) => normalizeTask(task, task)) : [];
  normalized.drafts = Array.isArray(normalized.drafts) ? normalized.drafts : [];
  normalized.history = Array.isArray(normalized.history) ? normalized.history.slice(0, historyLimit) : [];
  return normalized;
}

async function readStore() {
  await fsp.mkdir(dataDir, { recursive: true });
  if (!(await exists(storePath))) {
    const store = defaultStore();
    await writeStore(store, { backup: false });
    return store;
  }

  try {
    const raw = await fsp.readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw.replace(/^\uFEFF/, "")));
  } catch (error) {
    const wrapped = new Error(`Task store is not readable: ${storePath}. Restore from ${backupDir} or fix the JSON.`);
    wrapped.status = 500;
    wrapped.code = "STORE_CORRUPT";
    wrapped.cause = error;
    wrapped.store_path = storePath;
    wrapped.backup_dir = backupDir;
    throw wrapped;
  }
}

async function writeStore(store, options = {}) {
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(backupDir, { recursive: true });
  let backupPath = null;
  if (options.backup !== false && (await exists(storePath))) {
    const backupName = `store-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    backupPath = path.join(backupDir, backupName);
    await fsp.copyFile(storePath, backupPath);
  }

  store.updated_at = now();
  const tempPath = path.join(dataDir, `.store-${process.pid}-${Date.now()}.tmp`);
  await fsp.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, storePath);
  return backupPath;
}

async function mutateStore(mutator) {
  const store = await readStore();
  const result = await mutator(store);
  store.history = store.history.slice(0, historyLimit);
  store.drafts = store.drafts.slice(0, draftLimit);
  const backupPath = await writeStore(store);
  return { store, result, backupPath };
}

function pick(input, keys, fallback = "") {
  for (const key of keys) {
    const value = input?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return fallback;
}

function normalizeStatus(value, fallback = "active") {
  const raw = String(value || "").trim().toLowerCase();
  const map = new Map([
    ["active", "active"],
    ["next", "next"],
    ["doing", "active"],
    ["todo", "active"],
    ["进行中", "active"],
    ["下一步", "next"],
    ["收集", "active"],
    ["等待", "waiting"],
    ["waiting", "waiting"],
    ["blocked", "blocked"],
    ["阻塞", "blocked"],
    ["later", "later"],
    ["暂缓", "later"],
    ["done", "done"],
    ["完成", "done"],
  ]);
  return map.get(raw) || fallback;
}

function normalizeBucket(value, status = "active") {
  const raw = String(value || "").trim().toLowerCase();
  const map = new Map([
    ["today", "today"],
    ["今日", "today"],
    ["week", "week"],
    ["本周", "week"],
    ["project", "project"],
    ["项目", "project"],
    ["waiting", "waiting"],
    ["等待", "waiting"],
    ["blocked", "blocked"],
    ["阻塞", "blocked"],
    ["later", "later"],
    ["以后", "later"],
    ["暂缓", "later"],
    ["inbox", "inbox"],
    ["收集箱", "inbox"],
  ]);
  if (map.has(raw)) return map.get(raw);
  if (status === "waiting") return "waiting";
  if (status === "blocked") return "blocked";
  if (status === "later") return "later";
  return "week";
}

function normalizeImpact(value, fallback = "medium") {
  const raw = String(value || "").trim().toLowerCase();
  const map = new Map([
    ["high", "high"],
    ["高", "high"],
    ["medium", "medium"],
    ["mid", "medium"],
    ["中", "medium"],
    ["low", "low"],
    ["低", "low"],
  ]);
  return map.get(raw) || fallback;
}

function normalizeCost(value, fallback = "medium") {
  const raw = String(value || "").trim().toLowerCase();
  const map = new Map([
    ["small", "small"],
    ["小", "small"],
    ["medium", "medium"],
    ["mid", "medium"],
    ["中", "medium"],
    ["large", "large"],
    ["big", "large"],
    ["大", "large"],
  ]);
  return map.get(raw) || fallback;
}

function normalizeTask(input, existing = null, source = "manual") {
  const status = normalizeStatus(pick(input, ["status", "状态"], existing?.status || "active"), existing?.status || "active");
  const bucket = normalizeBucket(pick(input, ["bucket", "分类", "分组"], existing?.bucket || ""), status);
  const timestamp = now();
  const completedAt = status === "done" ? existing?.completed_at || input?.completed_at || timestamp : null;

  return {
    id: existing?.id || input?.id || makeId("task"),
    title: pick(input, ["title", "任务", "name"], existing?.title || ""),
    status,
    bucket,
    due_date: pick(input, ["due_date", "截止期", "deadline"], existing?.due_date || ""),
    impact: normalizeImpact(pick(input, ["impact", "影响"], existing?.impact || "medium"), existing?.impact || "medium"),
    cost: normalizeCost(pick(input, ["cost", "成本"], existing?.cost || "medium"), existing?.cost || "medium"),
    next_action: pick(input, ["next_action", "下一步动作", "可尝试的最小动作"], existing?.next_action || ""),
    project: pick(input, ["project", "所属项目"], existing?.project || ""),
    notes: pick(input, ["notes", "备注"], existing?.notes || ""),
    waiting_for: pick(input, ["waiting_for", "等待对象/条件"], existing?.waiting_for || ""),
    blocked_reason: pick(input, ["blocked_reason", "卡住原因"], existing?.blocked_reason || ""),
    source: existing?.source || source,
    created_at: existing?.created_at || input?.created_at || timestamp,
    updated_at: timestamp,
    completed_at: completedAt,
  };
}

function flattenModelPayload(payload) {
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  const rows = [];
  const mappings = [
    ["today_focus", "today"],
    ["week_focus", "week"],
    ["inbox", "inbox"],
    ["project_actions", "project"],
    ["waiting", "waiting"],
    ["blocked", "blocked"],
    ["needs_info", "inbox"],
  ];
  for (const [key, bucket] of mappings) {
    for (const row of Array.isArray(payload?.[key]) ? payload[key] : []) {
      rows.push({ ...row, bucket });
    }
  }
  return rows;
}

function normalizeDraftTasks(payload) {
  return flattenModelPayload(payload)
    .map((row) => normalizeTask(row, { id: makeId("draftitem"), source: "draft" }, "draft"))
    .filter((task) => task.title);
}

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function selectTodayTasks(store) {
  const limit = Math.max(1, Math.min(10, Number(store.settings.today_limit) || 5));
  const impactScore = { high: 0, medium: 1, low: 2 };
  const costScore = { small: 0, medium: 1, large: 2 };
  const today = todayISO();
  return store.tasks
    .filter((task) => task.status !== "done")
    .filter((task) => {
      if (task.bucket === "today") return true;
      if (task.bucket === "later") return false;
      if (task.due_date && task.due_date.slice(0, 10) <= today) return true;
      return task.impact === "high" && ["week", "project"].includes(task.bucket);
    })
    .sort((a, b) => {
      const dateA = parseDate(a.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const dateB = parseDate(b.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return (
        dateA - dateB ||
        (impactScore[a.impact] ?? 1) - (impactScore[b.impact] ?? 1) ||
        (costScore[a.cost] ?? 1) - (costScore[b.cost] ?? 1) ||
        a.created_at.localeCompare(b.created_at)
      );
    })
    .slice(0, limit);
}

function stateView(store) {
  return {
    version: store.version,
    data_dir: dataDir,
    store_path: storePath,
    backup_dir: backupDir,
    settings: store.settings,
    tasks: store.tasks,
    today_focus: selectTodayTasks(store),
    drafts: store.drafts,
    history: store.history,
    updated_at: store.updated_at,
  };
}

function buildSystemPrompt() {
  return [
    "你是 task-manager agent。你只负责把用户输入整理成任务草稿 JSON。",
    "不要写 Markdown，不要解释，不要调用工具。输出必须是严格 JSON。",
    "JSON 顶层必须包含 tasks 数组。",
    "每个 task 字段：title, status, bucket, due_date, impact, cost, next_action, project, notes, waiting_for, blocked_reason。",
    "status 只能用 active, next, waiting, blocked, later, done。",
    "bucket 只能用 today, week, project, waiting, blocked, later, inbox。",
    "impact 只能用 high, medium, low；cost 只能用 small, medium, large。",
    "due_date 尽量使用 YYYY-MM-DD；不确定就留空。",
    "只整理用户这次输入的新事项，不要重写已有任务库。",
    "today 只放马上要处理的高优先级行动；复杂事项拆到下一步动作，不要过度规划。",
  ].join("\n");
}

function compactTasks(tasks) {
  return tasks
    .filter((task) => task.status !== "done")
    .slice(0, 80)
    .map((task) => ({
      title: task.title,
      status: task.status,
      bucket: task.bucket,
      due_date: task.due_date,
      impact: task.impact,
      next_action: task.next_action,
      project: task.project,
    }));
}

function buildUserPrompt({ input, mode, store }) {
  return JSON.stringify(
    {
      mode,
      user_input: input,
      existing_active_tasks: compactTasks(store.tasks),
      instruction: "从 user_input 中生成可入库的任务草稿。避免和 existing_active_tasks 明显重复。",
    },
    null,
    2,
  );
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Model returned empty content.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model response was not valid JSON.");
  }
}

async function callChatCompletion({ provider, input, mode, store }) {
  const baseUrl = String(provider.baseUrl || "").replace(/\/+$/, "");
  const model = String(provider.model || "").trim();
  const apiKey = String(provider.apiKey || process.env[provider.apiKeyEnv || ""] || "").trim();
  if (!baseUrl || !model || !apiKey) {
    const error = new Error("Provider baseUrl, model, and API key are required.");
    error.status = 400;
    throw error;
  }

  const body = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt({ input, mode, store }) },
    ],
    temperature: Number.isFinite(Number(provider.temperature)) ? Number(provider.temperature) : 0.2,
  };

  if (provider.jsonMode !== false) body.response_format = { type: "json_object" };
  if (provider.thinking && String(baseUrl).includes("deepseek.com")) body.thinking = { type: provider.thinking };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(provider.referer ? { "HTTP-Referer": provider.referer } : {}),
      ...(provider.title ? { "X-Title": provider.title } : {}),
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    const error = new Error(`Provider request failed: HTTP ${response.status} ${responseText.slice(0, 800)}`);
    error.status = 502;
    throw error;
  }

  const parsed = JSON.parse(responseText);
  return {
    providerResponse: parsed,
    payload: extractJson(parsed.choices?.[0]?.message?.content),
  };
}

async function createDraft(body) {
  const input = String(body.input || "").trim();
  if (!input) {
    const error = new Error("input is required.");
    error.status = 400;
    throw error;
  }

  const store = await readStore();
  const provider = body.provider || {};
  const { payload, providerResponse } = await callChatCompletion({
    provider,
    input,
    mode: body.mode || "organize",
    store,
  });

  const draft = {
    id: makeId("draft"),
    status: "open",
    mode: body.mode || "organize",
    input,
    tasks: normalizeDraftTasks(payload),
    raw_payload: payload,
    provider: {
      id: provider.id || "custom",
      model: providerResponse.model || provider.model || "",
    },
    created_at: now(),
    committed_at: null,
  };

  store.drafts.unshift(draft);
  store.history.unshift({
    id: makeId("hist"),
    type: "draft_created",
    draft_id: draft.id,
    title: `生成草稿：${draft.tasks.length} 个任务`,
    created_at: now(),
  });
  store.history = store.history.slice(0, historyLimit);
  store.drafts = store.drafts.slice(0, draftLimit);
  const backupPath = await writeStore(store);
  return {
    draft,
    backup_path: backupPath,
    usage: providerResponse.usage || null,
    model: providerResponse.model || provider.model,
    state: stateView(store),
  };
}

async function commitDraft(draftId, body) {
  const { store, result, backupPath } = await mutateStore((mutable) => {
    const draft = mutable.drafts.find((item) => item.id === draftId);
    if (!draft) {
      const error = new Error("Draft not found.");
      error.status = 404;
      throw error;
    }
    const rows = Array.isArray(body.tasks) ? body.tasks : draft.tasks;
    const tasks = rows.map((row) => normalizeTask(row, null, "draft")).filter((task) => task.title);
    mutable.tasks.unshift(...tasks);
    draft.status = "committed";
    draft.tasks = tasks;
    draft.committed_at = now();
    mutable.history.unshift({
      id: makeId("hist"),
      type: "draft_committed",
      draft_id: draft.id,
      title: `入库草稿：${tasks.length} 个任务`,
      task_ids: tasks.map((task) => task.id),
      created_at: now(),
    });
    return { draft, tasks };
  });
  return { ...result, backup_path: backupPath, state: stateView(store) };
}

async function createTask(body) {
  const { store, result, backupPath } = await mutateStore((mutable) => {
    const task = normalizeTask(body, null, "manual");
    if (!task.title) {
      const error = new Error("title is required.");
      error.status = 400;
      throw error;
    }
    mutable.tasks.unshift(task);
    mutable.history.unshift({
      id: makeId("hist"),
      type: "task_created",
      title: `新增任务：${task.title}`,
      task_ids: [task.id],
      created_at: now(),
    });
    return { task };
  });
  return { ...result, backup_path: backupPath, state: stateView(store) };
}

async function updateTask(taskId, body) {
  const { store, result, backupPath } = await mutateStore((mutable) => {
    const index = mutable.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      const error = new Error("Task not found.");
      error.status = 404;
      throw error;
    }
    const task = normalizeTask({ ...mutable.tasks[index], ...body, id: taskId }, mutable.tasks[index], mutable.tasks[index].source);
    if (!task.title) {
      const error = new Error("title is required.");
      error.status = 400;
      throw error;
    }
    mutable.tasks[index] = task;
    mutable.history.unshift({
      id: makeId("hist"),
      type: "task_updated",
      title: `更新任务：${task.title}`,
      task_ids: [task.id],
      created_at: now(),
    });
    return { task };
  });
  return { ...result, backup_path: backupPath, state: stateView(store) };
}

async function completeTask(taskId) {
  const { store, result, backupPath } = await mutateStore((mutable) => {
    const index = mutable.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      const error = new Error("Task not found.");
      error.status = 404;
      throw error;
    }
    const task = normalizeTask({ ...mutable.tasks[index], status: "done" }, mutable.tasks[index], mutable.tasks[index].source);
    mutable.tasks[index] = task;
    mutable.history.unshift({
      id: makeId("hist"),
      type: "task_completed",
      title: `完成任务：${task.title}`,
      task_ids: [task.id],
      created_at: now(),
    });
    return { task };
  });
  return { ...result, backup_path: backupPath, state: stateView(store) };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[ext] || "application/octet-stream";
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(publicRoot, `.${requested}`);
  const relative = path.relative(publicRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!(await exists(filePath))) {
    sendText(res, 404, "Not found");
    return;
  }
  sendText(res, 200, await fsp.readFile(filePath), contentTypeFor(filePath));
}

async function router(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const draftCommit = url.pathname.match(/^\/api\/drafts\/([^/]+)\/commit$/);
    const taskComplete = url.pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
    const taskItem = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);

    if (req.method === "GET" && url.pathname === "/api/providers") {
      sendJson(res, 200, { providers });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, stateView(await readStore()));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/drafts") {
      sendJson(res, 200, await createDraft(await readBody(req)));
      return;
    }
    if (req.method === "POST" && draftCommit) {
      sendJson(res, 200, await commitDraft(draftCommit[1], await readBody(req)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      sendJson(res, 200, await createTask(await readBody(req)));
      return;
    }
    if (req.method === "PATCH" && taskItem) {
      sendJson(res, 200, await updateTask(taskItem[1], await readBody(req)));
      return;
    }
    if (req.method === "POST" && taskComplete) {
      sendJson(res, 200, await completeTask(taskComplete[1]));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || String(error),
      code: error.code || null,
      store_path: error.store_path || undefined,
      backup_dir: error.backup_dir || undefined,
    });
  }
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    router(req, res);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < 8899) {
      startServer(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`task-manager agent listening on http://127.0.0.1:${port}`);
    console.log(`data store: ${storePath}`);
  });
}

const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : Number(process.env.PORT || 8787);
startServer(Number.isFinite(port) ? port : 8787);
