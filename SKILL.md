---
name: task-manager
description: Use when the user invokes $task-manager, wants to initialize an Obsidian-compatible Markdown task system, says "我脑子乱了", "帮我整理任务", "做一次复盘", or wants daily/weekly task planning with local Markdown files.
---

# Task Manager

This skill manages a local, Obsidian-compatible Markdown task system. It is designed for personal task capture, clarification, prioritization, daily planning, weekly review, and project tracking.

## Core rule

Do not assume or invent a task directory. On first use, initialize the skill before reading or writing task files.

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
5. Update Markdown task files only after the user provides enough task detail.

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

End task-management sessions with:

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
```

## References

- Read `references/workflow.md` for detailed conversation flows.
- Read `references/templates.md` when creating or repairing task Markdown files manually.

