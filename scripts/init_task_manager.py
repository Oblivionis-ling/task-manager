#!/usr/bin/env python3
"""Initialize local config and optional Markdown templates for task-manager."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path


TASK_FILES = {
    "00_任务总览.md": """---
created: {today}
updated: {today}
type: task-dashboard
---

# 任务总览

这是当前任务系统的首页。每天只需要先看这里，再根据需要进入 [[01_收集箱]]、[[02_项目清单]]、[[03_等待与阻塞]]。

## 今日重点

原则：只保留 1-3 件今天现实上能推进的事。

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 本周推进

原则：放本周需要盯住、但不一定今天完成的事。

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 待澄清

原则：放还没有明确截止期、下一步、范围或归属的事。

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|
""",
    "01_收集箱.md": """---
created: {today}
updated: {today}
type: task-inbox
---

# 收集箱

这里放所有未经整理的脑内事项。写进来时不用排序，也不用写完整。

## 快速倾倒区

- 

## 待整理表

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|
""",
    "02_项目清单.md": """---
created: {today}
updated: {today}
type: project-list
---

# 项目清单

这里放多步骤任务、长期目标和需要持续推进的事项。每个项目都至少要有一个明确下一步。

## 进行中项目

| 项目 | 状态 | 目标 | 截止期 | 影响 | 当前下一步 | 阻塞 | 备注 |
|---|---|---|---|---|---|---|---|

## 本周要推进的项目动作

| 任务 | 状态 | 截止期 | 影响 | 成本 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 暂缓项目

| 项目 | 状态 | 暂缓原因 | 恢复条件 | 下次检查 | 备注 |
|---|---|---|---|---|---|
""",
    "03_等待与阻塞.md": """---
created: {today}
updated: {today}
type: waiting-and-blockers
---

# 等待与阻塞

这里放暂时不能直接推进的事项，包括等待他人回复、等待资料、需要决定、条件不成熟、精力不足等。

## 等待他人或外部条件

| 任务 | 状态 | 截止期 | 影响 | 等待对象/条件 | 下一次检查 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 需要我补充信息

| 任务 | 状态 | 缺什么信息 | 截止期 | 影响 | 下一步动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|

## 卡住的任务

| 任务 | 状态 | 卡住原因 | 截止期 | 影响 | 可尝试的最小动作 | 所属项目 | 备注 |
|---|---|---|---|---|---|---|---|
""",
    "04_固定提示词.md": """---
created: {today}
updated: {today}
type: task-management-prompt
---

# 固定提示词

```markdown
你是我的任务管理助手。请用中文和我对话，目标是帮我清空脑子、整理任务、拆解下一步，并维护一套 Obsidian 兼容的 Markdown 任务系统。

工作方式：
1. 先让我无序倾倒所有想到的事情，不要急着排序。
2. 把每件事澄清成：任务、截止期、影响、成本、下一步动作、所属项目、状态。
3. 按“截止期 + 影响”排序，同时考虑我的精力和执行阻力。
4. 把任务分成：今日重点、本周推进、项目任务、等待/阻塞、暂缓/以后。
5. 对复杂任务，只拆到“下一步可以立刻做什么”，不要过度规划。
```
""",
}


def default_config_path() -> Path:
    return Path.home() / ".codex" / "task-manager" / "config.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Initialize task-manager local configuration.")
    parser.add_argument("--task-root", required=True, help="User-selected task Markdown directory.")
    parser.add_argument(
        "--trigger-mode",
        required=True,
        choices=("explicit-only", "built-in", "custom"),
        help="How the user wants to invoke the skill.",
    )
    parser.add_argument(
        "--custom-trigger",
        action="append",
        default=[],
        help="Custom trigger phrase. Repeat for multiple phrases.",
    )
    parser.add_argument(
        "--create-templates",
        action="store_true",
        help="Create missing Markdown template files under task root.",
    )
    parser.add_argument(
        "--config-path",
        default=None,
        help="Override config path for testing. Defaults to ~/.codex/task-manager/config.json.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    custom_triggers = [trigger.strip() for trigger in args.custom_trigger if trigger.strip()]
    if args.trigger_mode == "custom" and not custom_triggers:
        raise SystemExit("--trigger-mode custom requires at least one --custom-trigger.")

    task_root = Path(args.task_root).expanduser().resolve()
    config_path = Path(args.config_path).expanduser().resolve() if args.config_path else default_config_path()
    today = date.today().isoformat()

    created_files: list[str] = []
    existing_files: list[str] = []

    if args.create_templates:
        task_root.mkdir(parents=True, exist_ok=True)
        for name, template in TASK_FILES.items():
            path = task_root / name
            if path.exists():
                existing_files.append(str(path))
                continue
            path.write_text(template.format(today=today), encoding="utf-8", newline="\n")
            created_files.append(str(path))

    config_path.parent.mkdir(parents=True, exist_ok=True)
    config = {
        "task_root": str(task_root),
        "trigger_mode": args.trigger_mode,
        "custom_triggers": custom_triggers,
        "initialized_at": datetime.now(timezone.utc).isoformat(),
    }
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "config_path": str(config_path),
        "task_root": str(task_root),
        "trigger_mode": args.trigger_mode,
        "created_files": created_files,
        "existing_files": existing_files,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

