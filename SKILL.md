---
name: task-manager
description: Use when the user invokes $task-manager, wants to initialize an Obsidian-compatible Markdown task system, says "我脑子乱了", "帮我整理任务", "做一次复盘", or wants daily/weekly task planning with local Markdown files.
---

# Task Manager

This skill manages a local, Obsidian-compatible Markdown task system. It is designed for personal task capture, clarification, prioritization, daily planning, weekly review, and project tracking.

## Core rule

Do not assume or invent a task directory. On first use, initialize the skill before reading or writing task files.

Task Markdown persistence is script-only. The only allowed way to write organized task data into the user's task directory is:

```bash
python scripts/task_manager_store.py apply --input-json "<path-to-update-json>"
```

Do not directly edit, rewrite, append to, or manually repair the user's task Markdown files:

- `00_任务总览.md`
- `01_收集箱.md`
- `02_项目清单.md`
- `03_等待与阻塞.md`
- `04_固定提示词.md`

If persistence fails because of garbled filenames, encoding, path handling, permissions, schema validation, or any script bug, stop and fix the script or the update JSON. Do not bypass the script by writing Markdown directly.

Local configuration is stored outside this skill at:

```text
~/.codex/task-manager/config.json
```

Use the platform home directory. Do not store personal task data, vault paths, or local configuration inside the skill repository.

## Initialization

When the config file is missing, invalid, or the user asks to initialize or reinitialize:

1. Ask for the task directory path. The user must provide it explicitly.
2. Ask whether to create missing Markdown templates in that directory.
3. Ask for trigger mode:
   - `explicit-only`: use only `$task-manager` or explicit skill invocation.
   - `built-in`: also respond to built-in Chinese trigger phrases such as "我脑子乱了", "帮我整理任务", "做一次复盘".
   - `custom`: ask the user for 1-5 custom trigger phrases.
4. Run the initializer script after the user answers:

```bash
python scripts/init_task_manager.py --task-root "<user-provided-path>" --trigger-mode built-in --create-templates
```

For custom triggers, add one `--custom-trigger "<phrase>"` argument per phrase. If the user does not want templates created, omit `--create-templates`.

The script must not overwrite existing Markdown task files. It only creates missing files and writes the local config.

## Runtime workflow

After initialization:

1. Read `~/.codex/task-manager/config.json`.
2. Read the Markdown files under `task_root`.
3. If the user's message does not match the configured mode, ask them to invoke `$task-manager` explicitly.
4. Guide the user through the appropriate workflow:
   - Brain dump: collect unstructured thoughts first.
   - Daily planning: choose 1-3 realistic current priorities.
   - Weekly review: update projects, waiting items, and this week's focus.
5. Persist the organized result to local Markdown files unless the user explicitly says "只预览", "不保存", or asks for a dry run.
6. Report the changed local files after persistence completes.

## Persistence requirement

Task organization must not stop at chat output. After the user provides enough task detail, produce a complete update JSON and run:

```bash
python scripts/task_manager_store.py apply --input-json "<path-to-update-json>"
```

This command is mandatory for local writes. Never use direct file editing tools, ad hoc shell writes, or manual Markdown edits to persist organized task data in the configured task directory.

The JSON must include every top-level key, even when a section is empty:

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

Default behavior is to save. Only skip persistence when the user explicitly requests preview-only behavior. When persistence succeeds, show the exact `changed_files` and `backups` returned by the script. Do not summarize this as only "已落到本地".

When persistence fails, state clearly that local Markdown was not updated, include the failure reason, and keep the JSON available so the user can retry. If the failure is caused by the script, fix the script and rerun it; do not manually edit task Markdown as a fallback.

For temporary update JSON files, use a local temporary path outside the skill repository when possible. Do not store task content in the published skill files.

## Task fields

Use these fields consistently in tables:

- `任务`
- `状态`: `收集` / `下一步` / `进行中` / `等待` / `暂缓` / `完成`
- `截止期`
- `影响`: `高` / `中` / `低`
- `成本`: `小` / `中` / `大`
- `下一步动作`
- `所属项目`
- `备注`

## Prioritization

Default priority is `截止期 + 影响`, adjusted by execution cost:

- Clear deadline and high impact: put into current or weekly focus.
- High impact and no deadline: set a review date.
- Near deadline but low impact: complete quickly or confirm whether to drop it.
- High impact and large cost: split into the smallest next action.
- Small cost and stress-reducing: use as a starter task when useful.

## Output format

End task-management sessions with the saved summary and persistence result:

```markdown
## 今日/当前重点

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 本周需要盯住

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 等待或阻塞

| 任务 | 状态 | 截止期 | 影响 | 等待/阻塞 | 下一次检查 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 需要补充的信息

- 

## 本地保存

- 状态：已保存 / 未保存
- 已修改文件：
- 备份位置：
```

## References

- Read `references/workflow.md` for detailed conversation flows.
- Read `references/templates.md` when creating or repairing task Markdown files manually.
