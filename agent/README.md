# Task Manager Agent

本目录把 `task-manager` Skill 包装成一个本地 Web Agent：

- 前端：原生 HTML/CSS/JS，Liquid Glass-inspired 界面。
- 后端：Node.js 内置 HTTP server，无 npm 依赖。
- 模型：OpenAI-compatible `/chat/completions` 接口。
- 落盘：只调用 `scripts/task_manager_store.py apply`，不直接写任务 Markdown。

## Run

```bash
node agent/server.js
```

默认地址：

```text
http://127.0.0.1:8787
```

## Provider

预置：

- DeepSeek V4 Flash: `https://api.deepseek.com`, `deepseek-v4-flash`
- DeepSeek V4 Pro: `https://api.deepseek.com`, `deepseek-v4-pro`
- OpenRouter / Router: `https://openrouter.ai/api/v1`
- Custom OpenAI-compatible endpoint

API key 默认只保存在浏览器 `localStorage`。也可以通过环境变量提供：

```bash
DEEPSEEK_API_KEY=... node agent/server.js
```

## Persistence

Agent 生成标准 JSON 后，后端会写入临时 JSON 文件，再调用：

```bash
python scripts/task_manager_store.py apply --input-json <file>
```

如果找不到 Python，设置：

```bash
TASK_MANAGER_PYTHON=/path/to/python node agent/server.js
```

