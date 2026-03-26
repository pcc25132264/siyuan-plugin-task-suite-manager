# Task Suite Manager

A multi-view task management plugin for SiYuan.

中文文档请查看 [README_zh_CN.md](./README_zh_CN.md)。

## Changelog

### v1.0.3

- Fixed recurrence calculation in calendar: one-time tasks show once, daily/weekly/monthly tasks now render by their own cadence between start and due dates.
- Fixed calendar note hover tooltip display.
- Split documentation into English and Chinese files and mapped localized readme in plugin metadata.
- Added recurrence test cases covering one-time, daily, weekly, and monthly rules.

### v1.0.2

- Mobile top tabs, toolbar actions, and list action buttons are switched to compact icon interactions with single-line horizontal scrolling.
- Fixed the mobile plugin-entry flow that previously required a second click, now entering the plugin directly.
- Optimized the task create/edit dialog to a single-column layout and added vertical scrolling to avoid truncated fields.
- Adjusted mobile calendar month cells by hiding the “+” quick-add button to reduce visual crowding.

## Overview

- Unified task model: title, description, status, priority, tags, assignee/resource, progress, dependencies, subtasks, reminders, and recurrence
- List view: centralized task creation/editing with quick status cycling, subtask toggles, and synced history
- Timeline view: combines change history and planned milestones with date-range filtering
- Kanban view: fixed status columns (Todo / In Progress / Done / Blocked) with drag-and-drop state transitions
- Calendar view: Month / Week / Day modes with quick task creation and status cycling per date
- Gantt view: timeline bars, progress, critical path identification, and resource utilization
- Theme system: unified contrast hierarchy for both light and dark modes across toolbar, kanban, calendar, gantt, and editor forms
- Real-time sync: updates in any view are persisted and reflected across all views
- Built-in self test: quick checks for core data structures and recurrence logic

## Current Interaction Behavior

- Kanban headers are fixed display blocks and no longer editable via input
- Kanban columns are derived strictly from task statuses in the list model
- Week calendar uses in-cell scrolling so dense task days remain fully browsable

## Quick Start

1. Open the plugin from the top bar icon or via command “打开任务管理中心”
2. Create tasks in List view and fill schedule, priority, tags, dependencies, resources, and recurrence
3. Manage the same task set through Kanban / Calendar / Gantt / Timeline perspectives
4. Run “运行自测” when needed to verify core plugin behavior

## Metadata

- Package: `siyuan-plugin-task-suite-manager`
- Display name: Task Suite Manager
- Minimum SiYuan version: `3.0.0`
