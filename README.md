# task-manager

`task-manager` 现在是一个本地 Web Agent，用来整理任务并维护 Obsidian 兼容的 Markdown 任务系统。

当前 `main` 分支只保留 agent 应用和本地持久化脚本。旧版 Codex Skill 已从主分支删除，但历史 Skill 包仍保留在 GitHub Releases，可以继续查看和下载。

## 功能

- 把混乱的想法整理成结构化任务。
- 输出今日重点、本周推进、项目动作、等待项、阻塞项和需要补充的信息。
- 通过 `scripts/task_manager_store.py` 把结果保存到本地 Markdown。
- 提供 iOS / Liquid Glass 风格的本地网页界面。
- 预留 OpenAI-compatible `/chat/completions` 接口，可切换 DeepSeek、OpenRouter 或其他兼容供应商。

## 本地运行

在仓库根目录运行：

```powershell
node server.js
```

然后打开：

```text
http://127.0.0.1:8787
```

如果普通终端里没有 `node`，需要先安装 Node.js LTS，或在已经提供 Node 的运行环境中启动。

## 模型供应商

界面内置 DeepSeek 和 OpenRouter 预设，也支持自定义 OpenAI-compatible provider。

API key 不会提交到仓库。通过网页界面填写的 provider 设置会保存在浏览器 `localStorage`。服务端也可以按配置读取环境变量中的 key。

## 本地保存

所有任务 Markdown 写入都必须走脚本：

```powershell
python scripts/task_manager_store.py apply --input-json <update.json>
```

Agent 不直接重写用户任务 Markdown 文件。保存脚本会读取已初始化的任务目录，只更新受管理区块，并在修改前创建备份。

更新 JSON 结构如下：

```json
{
  "today_focus": [],
  "week_focus": [],
  "inbox": [],
  "project_actions": [],
  "waiting": [],
  "blocked": [],
  "needs_info": []
}
```

## 初始化任务目录

首次使用前可以运行：

```powershell
python scripts/init_task_manager.py
```

初始化脚本会保存本机配置，并可按需创建 Obsidian 兼容的 Markdown 模板文件。

## 仓库结构

```text
server.js
public/
  index.html
  styles.css
  app.js
scripts/
  init_task_manager.py
  task_manager_store.py
```

## 历史 Codex Skill 版本

Codex Skill 已不在当前 `main` 分支中维护，但历史版本仍可下载：

- [v0.2.0](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.2.0)
- [v0.1.2](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.1.2)
- [v0.1.1](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.1.1)
- [v0.1.0](https://github.com/Oblivionis-ling/task-manager/releases/tag/v0.1.0)

## License

MIT
