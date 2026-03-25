# 任务管理中心 / Task Suite Manager

一个面向思源的多视图任务管理插件。  
A multi-view task management plugin for SiYuan.

---

## 更新记录 / Changelog

### v1.0.2

- 移动端顶部 Tab、工具栏与清单操作按钮改为更紧凑的图标交互，并保持单行可横向滚动。
- 修复移动端插件列表进入后仍需二次点击的问题，支持直接进入插件主界面。
- 优化任务新增/编辑弹窗为单列布局，并补充弹窗纵向滚动，避免字段显示不全。
- 调整移动端日历月视图，隐藏日期格中的“+”快捷添加按钮以缓解拥挤。

### v1.0.2

- Mobile top tabs, toolbar actions, and list action buttons are switched to compact icon interactions with single-line horizontal scrolling.
- Fixed the mobile plugin-entry flow that previously required a second click, now entering the plugin directly.
- Optimized the task create/edit dialog to a single-column layout and added vertical scrolling to avoid truncated fields.
- Adjusted mobile calendar month cells by hiding the “+” quick-add button to reduce visual crowding.

## 中文说明

### 功能概览

- 统一任务模型：标题、描述、状态、优先级、标签、资源、进度、依赖、子任务、提醒、重复规则
- 清单视图：集中创建与编辑任务，支持快速流转状态、子任务勾选与历史记录同步
- 时间轴视图：整合任务历史变更与计划节点，可按日期范围筛选
- 看板视图：按任务状态固定分列（待办 / 进行中 / 已完成 / 受阻），支持拖拽改状态
- 日历视图：月 / 周 / 日三种模式，日期内可直接创建任务与切换任务状态
- 甘特图视图：展示任务区间、进度、关键路径和资源负载
- 主题系统：浅色 / 暗色统一对比层级，覆盖工具栏、看板、日历、甘特图与编辑表单
- 数据同步：任一视图修改会实时写回，并同步到全部视图
- 插件自测：内置基础数据结构与重复任务逻辑自检

### 当前交互特性

- 看板列头为固定展示，不使用输入框编辑
- 看板仅按清单状态显示列，不再支持新增自定义列
- 日历周视图支持日期容器内滚动，任务过多时可继续浏览

### 使用方式

1. 在思源顶部栏点击“任务管理中心”图标，或通过命令“打开任务管理中心”进入插件
2. 在“清单”中创建任务并配置时间、优先级、标签、依赖、资源与重复规则
3. 在“看板 / 日历 / 甘特图 / 时间轴”中从不同维度管理同一批任务
4. 需要时点击“运行自测”快速检查插件核心逻辑

### 插件信息

- 插件名：`siyuan-plugin-task-suite-manager`
- 显示名：任务管理中心
- 最低思源版本：`3.0.0`

---

## English

### Overview

- Unified task model: title, description, status, priority, tags, assignee/resource, progress, dependencies, subtasks, reminders, and recurrence
- List view: centralized task creation/editing with quick status cycling, subtask toggles, and synced history
- Timeline view: combines change history and planned milestones with date-range filtering
- Kanban view: fixed status columns (Todo / In Progress / Done / Blocked) with drag-and-drop state transitions
- Calendar view: Month / Week / Day modes with quick task creation and status cycling per date
- Gantt view: timeline bars, progress, critical path identification, and resource utilization
- Theme system: unified contrast hierarchy for both light and dark modes across toolbar, kanban, calendar, gantt, and editor forms
- Real-time sync: updates in any view are persisted and reflected across all views
- Built-in self test: quick checks for core data structures and recurrence logic

### Current Interaction Behavior

- Kanban headers are fixed display blocks and no longer editable via input
- Kanban columns are derived strictly from task statuses in the list model
- Week calendar uses in-cell scrolling so dense task days remain fully browsable

### Quick Start

1. Open the plugin from the top bar icon or via command “打开任务管理中心”
2. Create tasks in List view and fill schedule, priority, tags, dependencies, resources, and recurrence
3. Manage the same task set through Kanban / Calendar / Gantt / Timeline perspectives
4. Run “运行自测” when needed to verify core plugin behavior

### Metadata

- Package: `siyuan-plugin-task-suite-manager`
- Display name: Task Suite Manager
- Minimum SiYuan version: `3.0.0`
