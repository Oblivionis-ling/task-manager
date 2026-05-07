#!/usr/bin/env python3
"""Persist task-manager structured output into local Markdown task files."""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_KEYS = (
    "today_focus",
    "week_focus",
    "inbox",
    "project_actions",
    "waiting",
    "blocked",
    "needs_info",
)

TASK_COLUMNS = ("任务", "状态", "截止期", "影响", "成本", "下一步动作", "所属项目", "备注")


@dataclass(frozen=True)
class Section:
    key: str
    file_name: str
    heading: str
    marker: str
    columns: tuple[str, ...]
    title: str


SECTIONS = (
    Section("today_focus", "00_任务总览.md", "## 今日重点", "today_focus", TASK_COLUMNS, "任务总览"),
    Section("week_focus", "00_任务总览.md", "## 本周推进", "week_focus", TASK_COLUMNS, "任务总览"),
    Section("inbox", "00_任务总览.md", "## 待澄清", "inbox", TASK_COLUMNS, "任务总览"),
    Section("inbox", "01_收集箱.md", "## 待整理表", "inbox", TASK_COLUMNS, "收集箱"),
    Section("project_actions", "02_项目清单.md", "## 本周要推进的项目动作", "project_actions", TASK_COLUMNS, "项目清单"),
    Section(
        "waiting",
        "03_等待与阻塞.md",
        "## 等待他人或外部条件",
        "waiting",
        ("任务", "状态", "截止期", "影响", "等待对象/条件", "下一次检查", "所属项目", "备注"),
        "等待与阻塞",
    ),
    Section(
        "needs_info",
        "03_等待与阻塞.md",
        "## 需要我补充信息",
        "needs_info",
        ("任务", "状态", "缺什么信息", "截止期", "影响", "下一步动作", "所属项目", "备注"),
        "等待与阻塞",
    ),
    Section(
        "blocked",
        "03_等待与阻塞.md",
        "## 卡住的任务",
        "blocked",
        ("任务", "状态", "卡住原因", "截止期", "影响", "可尝试的最小动作", "所属项目", "备注"),
        "等待与阻塞",
    ),
)


def default_config_path() -> Path:
    return Path.home() / ".codex" / "task-manager" / "config.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persist task-manager JSON into Markdown files.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    apply_parser = subparsers.add_parser("apply", help="Apply a complete task-manager JSON update.")
    apply_parser.add_argument("--input-json", required=True, help="Path to the complete update JSON.")
    apply_parser.add_argument(
        "--config-path",
        default=None,
        help="Override config path for testing. Defaults to ~/.codex/task-manager/config.json.",
    )
    return parser.parse_args()


def load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        raise SystemExit(f"Config not found: {config_path}. Run task-manager initialization first.")
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    task_root = config.get("task_root")
    if not isinstance(task_root, str) or not task_root.strip():
        raise SystemExit(f"Invalid config: missing task_root in {config_path}.")
    return config


def load_payload(input_path: Path) -> dict[str, list[dict[str, Any]]]:
    if not input_path.exists():
        raise SystemExit(f"Input JSON not found: {input_path}")
    raw = json.loads(input_path.read_text(encoding="utf-8-sig"))
    if not isinstance(raw, dict):
        raise SystemExit("Input JSON must be an object.")
    missing = [key for key in REQUIRED_KEYS if key not in raw]
    if missing:
        raise SystemExit("Input JSON must include all required keys: " + ", ".join(missing))
    payload: dict[str, list[dict[str, Any]]] = {}
    for key in REQUIRED_KEYS:
        value = raw[key]
        if not isinstance(value, list):
            raise SystemExit(f"Input JSON key {key!r} must be a list.")
        rows: list[dict[str, Any]] = []
        for index, row in enumerate(value):
            if not isinstance(row, dict):
                raise SystemExit(f"Input JSON key {key!r} row {index} must be an object.")
            rows.append(row)
        payload[key] = rows
    return payload


def escape_cell(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = " / ".join(part.strip() for part in text.split("\n") if part.strip())
    return text.replace("|", r"\|")


def render_table(columns: tuple[str, ...], rows: list[dict[str, Any]]) -> str:
    lines = [
        "| " + " | ".join(columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(escape_cell(row.get(column, "")) for column in columns) + " |")
    return "\n".join(lines)


def render_block(section: Section, rows: list[dict[str, Any]]) -> str:
    return (
        f"<!-- task-manager:start {section.marker} -->\n"
        f"{render_table(section.columns, rows)}\n"
        f"<!-- task-manager:end {section.marker} -->"
    )


def minimal_document(section: Section) -> str:
    return f"# {section.title}\n\n{section.heading}\n\n"


def find_heading(lines: list[str], heading: str) -> int | None:
    for index, line in enumerate(lines):
        if line.strip() == heading:
            return index
    return None


def replace_marked_block(text: str, section: Section, block: str) -> tuple[str, bool]:
    start_marker = f"<!-- task-manager:start {section.marker} -->"
    end_marker = f"<!-- task-manager:end {section.marker} -->"
    start = text.find(start_marker)
    end = text.find(end_marker)
    if start == -1 or end == -1 or end < start:
        return text, False
    end += len(end_marker)
    return text[:start] + block + text[end:], True


def replace_legacy_table(text: str, section: Section, block: str) -> str:
    lines = text.splitlines()
    heading_index = find_heading(lines, section.heading)
    if heading_index is None:
        suffix = "" if text.endswith("\n") or not text else "\n\n"
        return text + suffix + f"{section.heading}\n\n{block}\n"

    table_start: int | None = None
    for index in range(heading_index + 1, len(lines)):
        stripped = lines[index].strip()
        if stripped.startswith("## ") and index != heading_index:
            break
        if stripped.startswith("|"):
            table_start = index
            break

    if table_start is None:
        insert_at = heading_index + 1
        lines[insert_at:insert_at] = ["", block]
        return "\n".join(lines) + "\n"

    table_end = table_start
    while table_end < len(lines) and lines[table_end].strip().startswith("|"):
        table_end += 1
    lines[table_start:table_end] = [block]
    return "\n".join(lines) + "\n"


def update_section(text: str, section: Section, rows: list[dict[str, Any]]) -> str:
    block = render_block(section, rows)
    updated, replaced = replace_marked_block(text, section, block)
    if replaced:
        return updated if updated.endswith("\n") else updated + "\n"
    return replace_legacy_table(text, section, block)


def backup_file(path: Path, backup_root: Path) -> Path:
    backup_root.mkdir(parents=True, exist_ok=True)
    destination = backup_root / path.name
    shutil.copy2(path, destination)
    return destination


def apply_update(config_path: Path, input_path: Path) -> dict[str, Any]:
    config = load_config(config_path)
    payload = load_payload(input_path)
    task_root = Path(config["task_root"]).expanduser().resolve()
    if not task_root.exists():
        raise SystemExit(f"Task root does not exist: {task_root}")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = task_root / ".task-manager-backups" / timestamp
    changed_files: list[str] = []
    backups: list[str] = []

    sections_by_file: dict[str, list[Section]] = {}
    for section in SECTIONS:
        sections_by_file.setdefault(section.file_name, []).append(section)

    for file_name, sections in sections_by_file.items():
        path = task_root / file_name
        original = path.read_text(encoding="utf-8") if path.exists() else minimal_document(sections[0])
        updated = original
        for section in sections:
            updated = update_section(updated, section, payload[section.key])
        if updated != original:
            if path.exists():
                backups.append(str(backup_file(path, backup_root)))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(updated, encoding="utf-8", newline="\n")
            changed_files.append(str(path))

    return {
        "config_path": str(config_path),
        "task_root": str(task_root),
        "changed_files": changed_files,
        "backups": backups,
    }


def main() -> int:
    args = parse_args()
    if args.command == "apply":
        config_path = Path(args.config_path).expanduser().resolve() if args.config_path else default_config_path()
        input_path = Path(args.input_json).expanduser().resolve()
        result = apply_update(config_path, input_path)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
