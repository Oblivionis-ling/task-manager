# task-manager

`task-manager` 是一个 Codex Skill，用来初始化和维护 Obsidian 兼容的 Markdown 任务管理系统。

它适合这些场景：

- 脑子里事情很多，需要先清空再整理。
- 想把任务拆成今日重点、本周推进、项目、等待与阻塞。
- 想让 Codex 持续维护一套本地 Markdown 任务文件。
- 想在 Obsidian 中直接查看和编辑任务系统。

## 安装

把本仓库复制到 Codex skills 目录下，并保持目录名为 `task-manager`。

```text
<codex-home>/skills/task-manager
```

安装后，在新对话中使用：

```text
用 $task-manager 初始化任务系统
```

## 初始化

第一次调用时，Skill 不会猜测任务目录。你需要明确提供：

1. 任务 Markdown 文件存放目录。
2. 是否创建缺失模板文件。
3. 触发方式：
   - 仅通过 `$task-manager` 调用。
   - 使用内置触发语，例如“我脑子乱了”“帮我整理任务”“做一次复盘”。
   - 使用自定义触发语。

本地配置保存在：

```text
~/.codex/task-manager/config.json
```

这个配置文件不属于仓库，也不应该提交。

## Obsidian 连接方式

Skill 不依赖 Obsidian API。它只读写 Markdown 文件。

推荐做法：

1. 在 Obsidian vault 中新建一个任务目录。
2. 初始化时把这个目录路径交给 `$task-manager`。
3. Codex 负责维护 Markdown，Obsidian 负责查看和手动编辑。

## 本地保存行为

从 `v0.1.1` 开始，整理任务后默认会保存到初始化时设置的本地 Markdown 目录，而不是只在对话里输出。

默认规则：

- 用户明确说“只预览”“不保存”时，不写入本地。
- 其他任务整理、每日整理、周复盘场景默认保存。
- 写入前会把被修改文件备份到任务目录下的 `.task-manager-backups/`。
- 写入只更新 `<!-- task-manager:start ... -->` 和 `<!-- task-manager:end ... -->` 之间的受管理区块。
- 旧模板没有受管理区块时，保存脚本会按标题和表格位置自动补上标记。

从 `v0.1.2` 开始，脚本是唯一允许的写入路径。Codex 不应该直接编辑、重写或追加用户任务目录中的 Markdown 文件。如果出现乱码、编码、路径、权限或 schema 问题，应修复脚本或输入 JSON 后重新运行脚本，而不是手动绕过。

保存脚本：

```text
scripts/task_manager_store.py apply --input-json <update.json>
```

## 文件结构

初始化模板会创建：

- `00_任务总览.md`
- `01_收集箱.md`
- `02_项目清单.md`
- `03_等待与阻塞.md`
- `04_固定提示词.md`

已有文件不会被覆盖。

核心表格会包含 `task-manager` 受管理标记，方便脚本稳定更新。

## License

MIT
