#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const repoRoot = __dirname;
const publicRoot = path.join(__dirname, "public");
const configPath = path.join(os.homedir(), ".codex", "task-manager", "config.json");
const initScript = path.join(repoRoot, "scripts", "init_task_manager.py");
const storeScript = path.join(repoRoot, "scripts", "task_manager_store.py");

const managedFiles = [
  "00_任务总览.md",
  "01_收集箱.md",
  "02_项目清单.md",
  "03_等待与阻塞.md",
  "04_固定提示词.md",
];

const providers = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    thinking: "disabled",
    note: "OpenAI-compatible, lower-cost default.",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    thinking: "disabled",
    note: "OpenAI-compatible, stronger reasoning.",
  },
  {
    id: "openrouter",
    name: "OpenRouter / Router",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    apiKeyEnv: "OPENROUTER_API_KEY",
    note: "Use a router when price and availability matter.",
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
  } catch (error) {
    const err = new Error("Request body must be valid JSON.");
    err.status = 400;
    throw err;
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

async function readConfig() {
  if (!(await exists(configPath))) return null;
  const raw = await fsp.readFile(configPath, "utf8");
  const config = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (!config.task_root) return null;
  return config;
}

async function readTaskContext(config) {
  if (!config?.task_root) {
    return { initialized: false, configPath, taskRoot: null, files: [] };
  }

  const taskRoot = path.resolve(config.task_root);
  const files = [];
  for (const fileName of managedFiles) {
    const filePath = path.join(taskRoot, fileName);
    if (await exists(filePath)) {
      files.push({
        fileName,
        filePath,
        content: await fsp.readFile(filePath, "utf8"),
      });
    } else {
      files.push({ fileName, filePath, content: "" });
    }
  }

  return { initialized: true, configPath, taskRoot, files };
}

function getPythonCandidates() {
  const candidates = [];
  if (process.env.TASK_MANAGER_PYTHON) candidates.push(process.env.TASK_MANAGER_PYTHON);
  candidates.push(path.join(repoRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"));
  candidates.push(path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", process.platform === "win32" ? "python.exe" : "bin/python"));
  candidates.push(process.platform === "win32" ? "python.exe" : "python3");
  candidates.push("python");
  if (process.platform === "win32") candidates.push("py.exe");
  return candidates;
}

function findPython() {
  for (const candidate of getPythonCandidates()) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("No Python runtime found. Set TASK_MANAGER_PYTHON to a Python executable.");
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new Error(stderr || stdout || `${command} exited with ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function initializeTaskSystem(body) {
  const taskRoot = String(body.taskRoot || "").trim();
  if (!taskRoot) {
    const error = new Error("taskRoot is required.");
    error.status = 400;
    throw error;
  }
  const triggerMode = body.triggerMode || "built-in";
  const validModes = new Set(["explicit-only", "built-in", "custom"]);
  if (!validModes.has(triggerMode)) {
    const error = new Error("triggerMode must be explicit-only, built-in, or custom.");
    error.status = 400;
    throw error;
  }

  const python = findPython();
  const args = [initScript, "--task-root", taskRoot, "--trigger-mode", triggerMode];
  if (body.createTemplates !== false) args.push("--create-templates");
  if (triggerMode === "custom") {
    for (const trigger of body.customTriggers || []) {
      if (String(trigger).trim()) args.push("--custom-trigger", String(trigger).trim());
    }
  }
  const { stdout } = await runProcess(python, args, { cwd: repoRoot });
  return JSON.parse(stdout);
}

function buildSystemPrompt() {
  return [
    "你是 task-manager agent。你只负责把用户的混乱事项整理成结构化任务 JSON。",
    "不要写 Markdown，不要解释，不要调用工具。后端会使用 scripts/task_manager_store.py apply 写入本地文件。",
    "输出必须是严格 JSON 对象，包含这些顶层数组：today_focus, week_focus, inbox, project_actions, waiting, blocked, needs_info。",
    "普通任务字段：任务、状态、截止期、影响、成本、下一步动作、所属项目、备注。",
    "waiting 字段：任务、状态、截止期、影响、等待对象/条件、下一次检查、所属项目、备注。",
    "needs_info 字段：任务、状态、缺什么信息、截止期、影响、下一步动作、所属项目、备注。",
    "blocked 字段：任务、状态、卡住原因、截止期、影响、可尝试的最小动作、所属项目、备注。",
    "默认按截止期+影响排序，今日重点最多 5 条；如果信息不足，放入 inbox 或 needs_info。",
  ].join("\n");
}

function buildUserPrompt({ mode, input, context }) {
  const compactFiles = context.files.map((file) => ({
    fileName: file.fileName,
    content: file.content.slice(0, 12000),
  }));
  return JSON.stringify(
    {
      mode,
      user_input: input,
      current_task_files: compactFiles,
      instruction: "整理为完整 task-manager persistence JSON。保留仍有效的既有任务，并融合用户新输入。",
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

function normalizePayload(payload) {
  const required = ["today_focus", "week_focus", "inbox", "project_actions", "waiting", "blocked", "needs_info"];
  const normalized = {};
  for (const key of required) {
    normalized[key] = Array.isArray(payload?.[key]) ? payload[key] : [];
  }
  return normalized;
}

async function callChatCompletion({ provider, input, mode, context }) {
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
      { role: "user", content: buildUserPrompt({ mode, input, context }) },
    ],
    temperature: Number.isFinite(Number(provider.temperature)) ? Number(provider.temperature) : 0.2,
  };

  if (provider.jsonMode !== false) {
    body.response_format = { type: "json_object" };
  }
  if (provider.thinking && String(provider.baseUrl || "").includes("deepseek.com")) {
    body.thinking = { type: provider.thinking };
  }

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
  const content = parsed.choices?.[0]?.message?.content;
  return {
    providerResponse: parsed,
    payload: normalizePayload(extractJson(content)),
  };
}

async function persistPayload(payload) {
  const python = findPython();
  const runRoot = path.join(os.homedir(), ".codex", "task-manager", "agent-runs");
  await fsp.mkdir(runRoot, { recursive: true });
  const inputPath = path.join(runRoot, `update-${Date.now()}.json`);
  await fsp.writeFile(inputPath, JSON.stringify(payload, null, 2), "utf8");
  const { stdout } = await runProcess(python, [storeScript, "apply", "--input-json", inputPath], { cwd: repoRoot });
  return JSON.parse(stdout);
}

async function handleAgentRun(body) {
  const input = String(body.input || "").trim();
  if (!input) {
    const error = new Error("input is required.");
    error.status = 400;
    throw error;
  }

  const config = await readConfig();
  const context = await readTaskContext(config);
  if (!context.initialized) {
    const error = new Error("task-manager is not initialized. Set a task directory first.");
    error.status = 409;
    error.code = "NOT_INITIALIZED";
    throw error;
  }

  const provider = body.provider || {};
  const { payload, providerResponse } = await callChatCompletion({
    provider,
    input,
    mode: body.mode || "organize",
    context,
  });

  let persistence = null;
  if (body.persist !== false) {
    persistence = await persistPayload(payload);
  }

  return {
    payload,
    persistence,
    usage: providerResponse.usage || null,
    model: providerResponse.model || provider.model,
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
  }[ext] || "application/octet-stream";
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(publicRoot, `.${requested}`);
  if (!filePath.startsWith(publicRoot)) {
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
    if (req.method === "GET" && url.pathname === "/api/providers") {
      sendJson(res, 200, { providers });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/context") {
      const config = await readConfig();
      const context = await readTaskContext(config);
      sendJson(res, 200, {
        initialized: context.initialized,
        configPath: context.configPath,
        taskRoot: context.taskRoot,
        files: context.files.map((file) => ({ fileName: file.fileName, exists: Boolean(file.content) })),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/init") {
      sendJson(res, 200, await initializeTaskSystem(await readBody(req)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agent/run") {
      sendJson(res, 200, await handleAgentRun(await readBody(req)));
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
      stdout: error.stdout || undefined,
      stderr: error.stderr || undefined,
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
  });
}

const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : Number(process.env.PORT || 8787);
startServer(Number.isFinite(port) ? port : 8787);
