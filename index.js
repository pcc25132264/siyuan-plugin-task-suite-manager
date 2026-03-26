(function (global, factory) {
    typeof exports === "object" && typeof module !== "undefined"
        ? module.exports = factory(require("siyuan"))
        : typeof define === "function" && define.amd
            ? define(["siyuan"], factory)
            : (global = typeof globalThis !== "undefined" ? globalThis : global || self,
               global.SiYuanTaskSuitePlugin = factory(global.siyuan));
}(this, function (siyuan) {
    "use strict";

    const { Plugin, Dialog, showMessage } = siyuan;

    const STATUS_OPTIONS = [
        { value: "todo", label: "待办" },
        { value: "in_progress", label: "进行中" },
        { value: "done", label: "已完成" },
        { value: "blocked", label: "受阻" }
    ];

    const PRIORITY_OPTIONS = [
        { value: "low", label: "低" },
        { value: "medium", label: "中" },
        { value: "high", label: "高" },
        { value: "urgent", label: "紧急" }
    ];

    const REPEAT_OPTIONS = [
        { value: "none", label: "一次" },
        { value: "daily", label: "每日" },
        { value: "weekly", label: "每周" },
        { value: "monthly", label: "每月" }
    ];

    const TAB_OPTIONS = [
        { value: "list", label: "清单", icon: "☰" },
        { value: "kanban", label: "看板", icon: "▦" },
        { value: "calendar", label: "日历", icon: "📅" },
        { value: "gantt", label: "甘特图", icon: "📊" },
        { value: "timeline", label: "时间轴", icon: "🕘" }
    ];

    class SiYuanTaskSuitePlugin extends Plugin {
        async onload() {
            const os = window?.siyuan?.config?.system?.os;
            this.isMobile = os === "ios" || os === "android" || !!document.getElementById("sidebar");
            this.dataFile = "task-suite-state.json";
            this.state = this.createDefaultState();
            this.ui = {
                activeTab: "list",
                timelineStart: "",
                timelineEnd: "",
                calendarMode: "month",
                calendarCursor: this.formatDate(new Date()),
                calendarMonthHeight: 70,
                ganttStart: "",
                ganttEnd: "",
                kanbanDropTaskId: ""
            };
            await this.loadState();
            this.normalizeState();
            this.ui.calendarMonthHeight = this.state.settings.calendarMonthHeight;
            this.startReminderLoop();
            const plugin = this;
            this.addTab({
                type: "task-suite-manager-tab",
                init() {
                    plugin.tabElement = this.element;
                    plugin.mountMainTab();
                },
                destroy() {
                    plugin.tabElement = null;
                    plugin.root = null;
                }
            });
            this.addTopBar({
                icon: "iconList",
                title: "任务管理中心",
                position: "right",
                callback: () => this.openPreferredEntry()
            });
            if (this.isMobile) {
                this.addDock({
                    config: {
                        position: "RightTop",
                        size: {
                            width: 400,
                            height: 600
                        },
                        icon: "iconList",
                        title: "任务管理中心",
                        show: true
                    },
                    data: {},
                    type: "mobile-entry",
                    init: (custom) => {
                        this.tabElement = custom.element;
                        this.mountMainTab();
                    },
                    update: () => {
                        if (this.tabElement) {
                            this.mountMainTab();
                        }
                    },
                    destroy: () => {
                        this.tabElement = null;
                        this.root = null;
                    }
                });
            }
            this.addCommand({
                langKey: "openTaskSuite",
                langText: "打开任务管理中心",
                hotkey: "⌥⌘T",
                callback: () => this.openPreferredEntry()
            });
        }

        onunload() {
            if (this.reminderTimer) {
                clearInterval(this.reminderTimer);
                this.reminderTimer = null;
            }
            if (this.taskEditorDialog) {
                this.taskEditorDialog.destroy();
                this.taskEditorDialog = null;
            }
            if (this.occurrenceEditorDialog) {
                this.occurrenceEditorDialog.destroy();
                this.occurrenceEditorDialog = null;
            }
            if (this.dragFeedbackTimer) {
                clearTimeout(this.dragFeedbackTimer);
                this.dragFeedbackTimer = null;
            }
            if (this.dialog) {
                this.dialog.destroy();
                this.dialog = null;
            }
            if (this.noteTooltipEl && this.noteTooltipEl.parentElement) {
                this.noteTooltipEl.parentElement.removeChild(this.noteTooltipEl);
            }
            this.noteTooltipEl = null;
            this.tabElement = null;
            this.root = null;
        }

        createDefaultState() {
            return {
                tasks: [],
                history: [],
                occurrenceStatuses: {},
                occurrenceNotes: {},
                reminderFired: {},
                settings: {
                    calendarMonthHeight: 70,
                    themeMode: "light"
                },
                boardColumns: [
                    { id: "col_todo", title: "待办", status: "todo", builtIn: true },
                    { id: "col_in_progress", title: "进行中", status: "in_progress", builtIn: true },
                    { id: "col_done", title: "已完成", status: "done", builtIn: true },
                    { id: "col_blocked", title: "受阻", status: "blocked", builtIn: true }
                ]
            };
        }

        async loadState() {
            const data = await this.loadData(this.dataFile);
            if (!data || typeof data !== "object") {
                return;
            }
            this.state = {
                ...this.createDefaultState(),
                ...data
            };
        }

        normalizeState() {
            if (!Array.isArray(this.state.tasks)) {
                this.state.tasks = [];
            }
            if (!Array.isArray(this.state.history)) {
                this.state.history = [];
            }
            if (!Array.isArray(this.state.boardColumns) || this.state.boardColumns.length === 0) {
                this.state.boardColumns = this.createDefaultState().boardColumns;
            }
            if (!this.state.occurrenceStatuses || typeof this.state.occurrenceStatuses !== "object") {
                this.state.occurrenceStatuses = {};
            }
            if (!this.state.occurrenceNotes || typeof this.state.occurrenceNotes !== "object") {
                this.state.occurrenceNotes = {};
            }
            if (!this.state.reminderFired || typeof this.state.reminderFired !== "object") {
                this.state.reminderFired = {};
            }
            if (!this.state.settings || typeof this.state.settings !== "object") {
                this.state.settings = this.createDefaultState().settings;
            }
            this.state.settings = {
                ...this.createDefaultState().settings,
                ...this.state.settings
            };
            this.state.settings.calendarMonthHeight = this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeight);
            this.state.settings.themeMode = this.normalizeThemeMode(this.state.settings.themeMode);
            this.state.boardColumns = this.createDefaultState().boardColumns.map((item) => ({ ...item }));
            const knownIds = new Set(this.state.tasks.map((task) => task.id));
            this.state.tasks = this.state.tasks.map((task) => {
                const normalized = {
                    id: task.id || this.makeId("task"),
                    title: task.title || "未命名任务",
                    description: task.description || "",
                    status: this.normalizeStatus(task.status),
                    priority: this.normalizePriority(task.priority),
                    tags: Array.isArray(task.tags) ? task.tags : [],
                    repeat: this.normalizeRepeat(task.repeat),
                    startDate: task.startDate || "",
                    dueDate: task.dueDate || "",
                    endDate: task.endDate || "",
                    reminderTime: task.reminderTime || "",
                    progress: this.normalizeProgress(task.progress),
                    resource: task.resource || "",
                    dependencies: Array.isArray(task.dependencies) ? task.dependencies.filter((id) => knownIds.has(id)) : [],
                    subtasks: Array.isArray(task.subtasks) ? task.subtasks.map((subtask) => ({
                        id: subtask.id || this.makeId("sub"),
                        title: subtask.title || "子任务",
                        done: !!subtask.done
                    })) : [],
                    createdAt: task.createdAt || new Date().toISOString(),
                    updatedAt: task.updatedAt || new Date().toISOString()
                };
                return normalized;
            });
        }

        normalizeStatus(status) {
            if (STATUS_OPTIONS.some((item) => item.value === status)) {
                return status;
            }
            return "todo";
        }

        normalizePriority(priority) {
            if (PRIORITY_OPTIONS.some((item) => item.value === priority)) {
                return priority;
            }
            return "medium";
        }

        normalizeRepeat(repeat) {
            if (REPEAT_OPTIONS.some((item) => item.value === repeat)) {
                return repeat;
            }
            return "none";
        }

        normalizeCalendarMonthHeight(value) {
            const parsed = Number(value);
            const options = [60, 70, 80];
            if (options.includes(parsed)) {
                return parsed;
            }
            return 70;
        }

        normalizeThemeMode(value) {
            return value === "dark" ? "dark" : "light";
        }

        normalizeProgress(progress) {
            const value = Number(progress);
            if (Number.isNaN(value)) {
                return 0;
            }
            return Math.max(0, Math.min(100, Math.round(value)));
        }

        async saveState() {
            await this.saveData(this.dataFile, this.state);
        }

        openSetting() {
            if (this.isMobile) {
                this.openPreferredEntry();
                return;
            }
            super.openSetting();
        }

        openPreferredEntry() {
            this.openMainTab();
        }

        openMainTab() {
            if (this.isMobile) {
                this.openMobileSidebarPanel();
                return;
            }
            const canOpenTab = typeof siyuan.openTab === "function" && this.app;
            if (!canOpenTab) {
                this.openDialog();
                return;
            }
            try {
                siyuan.openTab({
                    app: this.app,
                    custom: {
                        icon: "iconList",
                        title: "任务管理中心",
                        id: `${this.name}task-suite-manager-tab`
                    }
                });
                if (this.tabElement) {
                    this.mountMainTab();
                }
            } catch (error) {
                this.openDialog();
            }
        }

        openMobileSidebarPanel() {
            const sidebarElement = document.getElementById("sidebar");
            const pluginPanelElement = sidebarElement?.querySelector('[data-type="sidebar-plugin"]');
            if (!sidebarElement || !pluginPanelElement) {
                return;
            }
            const toolbarElement = sidebarElement.querySelector(".toolbar--border");
            const pluginTabIcon = toolbarElement?.querySelector('svg[data-type="sidebar-plugin-tab"]');
            if (toolbarElement) {
                toolbarElement.querySelectorAll(".toolbar__icon").forEach((item) => {
                    item.classList.remove("toolbar__icon--active");
                });
            }
            if (pluginTabIcon) {
                pluginTabIcon.classList.add("toolbar__icon--active");
            }
            const panelContainer = sidebarElement.lastElementChild;
            if (panelContainer) {
                Array.from(panelContainer.children).forEach((item) => {
                    if (item.getAttribute("data-type")) {
                        item.classList.add("fn__none");
                    }
                });
            }
            pluginPanelElement.classList.remove("fn__none");
            sidebarElement.style.transform = "translateX(0px)";
            this.tabElement = pluginPanelElement;
            this.mountMainTab();
        }

        openDialog() {
            if (this.dialog) {
                this.dialog.destroy();
            }
            this.dialog = new Dialog({
                title: "任务管理中心",
                width: this.isMobile ? "96vw" : "1240px",
                height: this.isMobile ? "92vh" : "88vh",
                content: this.renderDialogShell()
            });
            this.root = this.dialog.element.querySelector(".task-suite-root");
            this.bindRootEvents();
            this.renderApp();
        }

        mountMainTab() {
            if (!this.tabElement) {
                return;
            }
            this.tabElement.innerHTML = this.renderDialogShell();
            this.root = this.tabElement.querySelector(".task-suite-root");
            this.bindRootEvents();
            this.renderApp();
        }

        renderDialogShell() {
            const themeMode = this.normalizeThemeMode(this.state.settings.themeMode);
            return `
                <div class="task-suite-root task-suite-theme-${themeMode}${this.isMobile ? " task-suite-mobile" : ""}">
                    <style>
                        .task-suite-root {
                            --task-suite-bg: #ffffff;
                            --task-suite-surface: #ffffff;
                            --task-suite-muted: #ffffff;
                            --task-suite-border: #d9e0ea;
                            --task-suite-line: #e3e8ef;
                            --task-suite-text: #1f2937;
                            --task-suite-text-soft: #64748b;
                            --task-suite-item-bg: #f8fafc;
                            --task-suite-item-text: #1f2937;
                            --task-suite-chip-bg: #eef2f7;
                            --task-suite-ghost-text: #6b7280;
                            --task-suite-panel-tint: #f6f8fb;
                            --task-suite-header-text: #0f172a;
                            --task-suite-button-bg: #f8fafc;
                            --task-suite-button-text: #0f172a;
                            --task-suite-button-border: #cfd8e3;
                            --task-suite-day-title-bg: #f8fafc;
                            --task-suite-day-title-text: #0f172a;
                            --task-suite-form-bg: #f8fafc;
                            --task-suite-gantt-panel-bg: #f6f8fb;
                            --task-suite-gantt-track-bg: #fbfcfe;
                            height: 100%;
                            display: flex;
                            flex-direction: column;
                            gap: 0;
                            padding: 0;
                            overflow: hidden;
                            background: var(--task-suite-bg);
                            color: var(--task-suite-text);
                        }
                        .task-suite-root.task-suite-theme-dark {
                            --task-suite-bg: #0f1115;
                            --task-suite-surface: #171a20;
                            --task-suite-muted: #12151b;
                            --task-suite-border: #313948;
                            --task-suite-line: #2a3140;
                            --task-suite-text: #f3f6fb;
                            --task-suite-text-soft: #c2cad7;
                            --task-suite-item-bg: #1d2430;
                            --task-suite-item-text: #eef3fb;
                            --task-suite-chip-bg: #222a36;
                            --task-suite-ghost-text: #aab4c3;
                            --task-suite-panel-tint: #1a202a;
                            --task-suite-header-text: #f8fbff;
                            --task-suite-button-bg: #1d2430;
                            --task-suite-button-text: #f4f8ff;
                            --task-suite-button-border: #3a4558;
                            --task-suite-day-title-bg: #1b2230;
                            --task-suite-day-title-text: #f8fbff;
                            --task-suite-form-bg: #1c2330;
                            --task-suite-gantt-panel-bg: #151b24;
                            --task-suite-gantt-track-bg: #1a2230;
                        }
                        .task-suite-toolbar {
                            display: flex;
                            flex-wrap: nowrap;
                            gap: 6px;
                            align-items: center;
                            justify-content: space-between;
                            padding: 0 0 6px;
                            min-width: 0;
                        }
                        .task-suite-tabs.layout-tab-bar {
                            border-bottom: 1px solid var(--task-suite-border);
                            border-radius: 8px 8px 0 0;
                            padding: 0 6px;
                            flex: 1;
                            background: var(--task-suite-panel-tint);
                            min-width: 0;
                            display: flex;
                            flex-wrap: nowrap;
                            overflow-x: auto;
                            overflow-y: hidden;
                        }
                        .task-suite-tabs .item {
                            min-height: 34px;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-tabs .task-suite-tab {
                            flex: 0 0 auto;
                            min-width: 88px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            gap: 4px;
                            padding: 0 8px;
                        }
                        .task-suite-tab-icon {
                            font-size: 13px;
                            line-height: 1;
                        }
                        .task-suite-tab-label {
                            white-space: nowrap;
                        }
                        .task-suite-toolbar-actions {
                            display: flex;
                            gap: 6px;
                            align-items: center;
                            flex: 0 0 auto;
                        }
                        .task-suite-toolbar-icon-btn {
                            min-width: 30px;
                            width: 30px;
                            height: 30px;
                            padding: 0;
                            border-radius: 6px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            line-height: 1;
                            font-size: 14px;
                        }
                        .task-suite-tab.item--focus {
                            color: var(--task-suite-header-text);
                            background: var(--task-suite-surface);
                            border-radius: 6px 6px 0 0;
                        }
                        .task-suite-content {
                            min-height: 0;
                            flex: 1;
                            overflow: auto;
                            border-radius: 6px;
                            padding: 8px 10px 10px;
                            background: var(--task-suite-bg);
                        }
                        .task-suite-list-toolbar {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            gap: 10px;
                            flex-wrap: wrap;
                        }
                        .task-suite-task-actions {
                            display: flex;
                            gap: 6px;
                            align-items: center;
                            flex-wrap: wrap;
                        }
                        .task-suite-icon-btn {
                            min-width: 28px;
                            width: 28px;
                            height: 28px;
                            padding: 0;
                            border-radius: 6px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 14px;
                            line-height: 1;
                        }
                        .task-suite-grid {
                            display: grid;
                            grid-template-columns: repeat(12, minmax(0, 1fr));
                            gap: 8px;
                        }
                        .task-suite-field {
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                        }
                        .task-suite-field > label {
                            font-size: 12px;
                            color: var(--task-suite-header-text);
                        }
                        .task-suite-card {
                            border-radius: 6px;
                            padding: 10px;
                            background: var(--task-suite-surface);
                            border: 1px solid var(--task-suite-border);
                        }
                        .task-suite-task-card {
                            background: color-mix(in srgb, var(--task-suite-surface) 82%, var(--task-suite-panel-tint));
                            box-shadow: inset 0 1px 0 color-mix(in srgb, var(--task-suite-line) 45%, transparent);
                        }
                        .task-suite-repeat-summary {
                            margin-top: 8px;
                            padding: 6px 8px;
                            border-radius: 6px;
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 26%, var(--task-suite-form-bg));
                            border: 1px solid color-mix(in srgb, var(--b3-theme-primary-lighter) 50%, var(--task-suite-border));
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            flex-wrap: wrap;
                            font-size: 12px;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-repeat-badge {
                            display: inline-flex;
                            align-items: center;
                            border-radius: 999px;
                            padding: 1px 8px;
                            background: var(--b3-theme-primary-lighter);
                            color: var(--b3-theme-primary);
                            font-weight: 600;
                            white-space: nowrap;
                        }
                        .task-suite-list {
                            display: flex;
                            flex-direction: column;
                            gap: 0;
                        }
                        .task-suite-list > .task-suite-card + .task-suite-card {
                            margin-top: 6px;
                        }
                        .task-suite-meta {
                            display: flex;
                            gap: 8px;
                            flex-wrap: wrap;
                            align-items: center;
                            font-size: 12px;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-tag {
                            background: var(--b3-theme-primary-lighter);
                            color: var(--b3-theme-primary);
                            border-radius: 100px;
                            padding: 2px 8px;
                            font-size: 12px;
                        }
                        .task-suite-subtasks {
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                            margin-top: 8px;
                            padding: 8px;
                            border: 1px solid var(--task-suite-border);
                            border-radius: 8px;
                            background: color-mix(in srgb, var(--task-suite-panel-tint) 72%, var(--task-suite-surface));
                        }
                        .task-suite-subtask {
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            font-size: 13px;
                            padding: 6px 8px;
                            border-radius: 6px;
                            background: color-mix(in srgb, var(--task-suite-form-bg) 70%, var(--task-suite-surface));
                            color: var(--task-suite-item-text);
                        }
                        .task-suite-subtask-entry {
                            display: flex;
                            gap: 8px;
                            align-items: center;
                            padding-top: 4px;
                        }
                        .task-suite-columns {
                            display: grid;
                            grid-template-columns: repeat(4, minmax(0, 1fr));
                            gap: 6px;
                            margin-top: 12px;
                        }
                        .task-suite-column {
                            min-height: 220px;
                            border-radius: 8px;
                            background: var(--task-suite-surface);
                            border: 1px solid var(--task-suite-border);
                            display: flex;
                            flex-direction: column;
                        }
                        .task-suite-column-header {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            padding: 10px;
                            color: var(--task-suite-header-text);
                        }
                        .task-suite-column-title-wrap {
                            min-width: 0;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        }
                        .task-suite-column-status-dot {
                            width: 10px;
                            height: 10px;
                            border-radius: 999px;
                            flex-shrink: 0;
                            background: currentColor;
                        }
                        .task-suite-column-title {
                            font-weight: 700;
                            line-height: 1.1;
                        }
                        .task-suite-column-count {
                            font-size: 12px;
                            color: var(--task-suite-text-soft);
                            padding: 2px 8px;
                            border-radius: 999px;
                            background: color-mix(in srgb, var(--task-suite-surface) 68%, transparent);
                        }
                        .task-suite-column-header--todo {
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 28%, var(--task-suite-panel-tint));
                            color: var(--b3-theme-primary);
                        }
                        .task-suite-column-header--in-progress {
                            background: color-mix(in srgb, var(--b3-card-info-background) 35%, var(--task-suite-panel-tint));
                            color: var(--b3-card-info-color);
                        }
                        .task-suite-column-header--done {
                            background: color-mix(in srgb, var(--b3-card-success-background) 35%, var(--task-suite-panel-tint));
                            color: var(--b3-card-success-color);
                        }
                        .task-suite-column-header--blocked {
                            background: color-mix(in srgb, var(--b3-card-warning-background) 35%, var(--task-suite-panel-tint));
                            color: var(--b3-card-warning-color);
                        }
                        .task-suite-column-settings {
                            background: var(--task-suite-panel-tint);
                        }
                        .task-suite-column-body {
                            min-height: 320px;
                            padding: 8px;
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                            background: var(--task-suite-surface);
                            transition: background-color .2s ease;
                        }
                        .task-suite-column-body.drag-over {
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 26%, var(--task-suite-surface));
                        }
                        .task-suite-kanban-card {
                            border-radius: 8px;
                            background: var(--task-suite-item-bg);
                            color: var(--task-suite-item-text);
                            padding: 8px;
                            cursor: grab;
                            transition: transform .16s ease, border-color .16s ease, background-color .16s ease;
                            border: 1px solid transparent;
                        }
                        .task-suite-kanban-card.priority-low {
                            background: color-mix(in srgb, var(--b3-card-info-background) 34%, var(--task-suite-item-bg));
                        }
                        .task-suite-kanban-card.priority-medium {
                            background: color-mix(in srgb, var(--task-suite-chip-bg) 72%, var(--task-suite-item-bg));
                        }
                        .task-suite-kanban-card.priority-high {
                            background: color-mix(in srgb, var(--b3-card-warning-background) 42%, var(--task-suite-item-bg));
                        }
                        .task-suite-kanban-card.priority-urgent {
                            background: color-mix(in srgb, var(--b3-card-error-background) 44%, var(--task-suite-item-bg));
                        }
                        .task-suite-kanban-title {
                            font-weight: 600;
                            margin-bottom: 4px;
                        }
                        .task-suite-kanban-desc {
                            font-size: 12px;
                            color: var(--task-suite-ghost-text);
                            margin-top: 4px;
                            display: -webkit-box;
                            -webkit-line-clamp: 2;
                            -webkit-box-orient: vertical;
                            overflow: hidden;
                        }
                        .task-suite-kanban-meta {
                            margin-top: 6px;
                            display: flex;
                            gap: 6px;
                            flex-wrap: wrap;
                            font-size: 11px;
                            color: var(--task-suite-ghost-text);
                        }
                        .task-suite-kanban-chip {
                            border-radius: 999px;
                            padding: 1px 7px;
                            background: var(--task-suite-chip-bg);
                            color: var(--task-suite-item-text);
                            white-space: nowrap;
                        }
                        .task-suite-kanban-card.dragging {
                            opacity: .72;
                            transform: scale(.98);
                            border-color: var(--task-suite-border);
                        }
                        .task-suite-kanban-card.drop-success {
                            animation: task-suite-drop-flash .85s ease;
                        }
                        @keyframes task-suite-drop-flash {
                            0% {
                                border-color: var(--b3-theme-primary);
                            }
                            100% {
                                border-color: transparent;
                            }
                        }
                        .task-suite-calendar-header {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            gap: 8px;
                            flex-wrap: wrap;
                        }
                        .task-suite-calendar-mode.layout-tab-bar {
                            border-bottom: 1px solid var(--task-suite-border);
                            border-radius: 8px;
                            padding: 0 6px;
                            background: var(--task-suite-panel-tint);
                        }
                        .task-suite-calendar-mode .item {
                            min-height: 32px;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-calendar-grid {
                            display: grid;
                            grid-template-columns: repeat(7, minmax(0, 1fr));
                            gap: 6px;
                            margin-top: 6px;
                        }
                        .task-suite-calendar-grid--month {
                            gap: 0;
                            border-radius: 0;
                            overflow: visible;
                            grid-template-rows: repeat(6, minmax(0, 1fr));
                            height: var(--task-suite-month-height, 70vh);
                            min-height: 520px;
                            margin-top: 0;
                            background: var(--task-suite-surface);
                            border: none;
                            box-sizing: border-box;
                        }
                        .task-suite-calendar-grid--week {
                            grid-template-columns: repeat(7, minmax(0, 1fr));
                            align-items: stretch;
                            min-height: 72vh;
                        }
                        .task-suite-calendar-panel--week {
                            min-height: 72vh;
                            display: flex;
                        }
                        .task-suite-calendar-panel--week .task-suite-calendar-grid {
                            flex: 1;
                        }
                        .task-suite-calendar-day {
                            min-height: 120px;
                            border: 1px solid var(--task-suite-border);
                            padding: 6px;
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                            background: var(--task-suite-surface);
                        }
                        .task-suite-calendar-day.dimmed {
                            opacity: .55;
                        }
                        .task-suite-calendar-grid--month .task-suite-calendar-day {
                            min-height: 0;
                            height: 100%;
                            overflow: hidden;
                            border: none;
                            border-radius: 0;
                            padding: 4px 6px;
                            gap: 4px;
                            position: relative;
                            outline: 1px solid var(--task-suite-line);
                            background: var(--task-suite-surface);
                            box-sizing: border-box;
                        }
                        .task-suite-calendar-grid--week .task-suite-calendar-day {
                            min-height: 0;
                            height: 100%;
                            overflow: hidden;
                        }
                        .task-suite-calendar-panel--month {
                            border-radius: 8px;
                            overflow: hidden;
                            padding: 0;
                            background: var(--task-suite-surface);
                            border: 1px solid var(--task-suite-border);
                        }
                        .task-suite-calendar-day-head {
                            display: flex;
                            justify-content: space-between;
                            align-items: flex-start;
                            gap: 6px;
                            min-width: 0;
                            color: var(--task-suite-header-text);
                        }
                        .task-suite-calendar-day-title {
                            min-width: 0;
                            display: flex;
                            flex-direction: column;
                            gap: 2px;
                        }
                        .task-suite-calendar-day-title > strong {
                            line-height: 1.2;
                            color: var(--task-suite-day-title-text);
                        }
                        .task-suite-calendar-add-btn {
                            min-height: 22px;
                            height: 22px;
                            min-width: 22px;
                            width: 22px;
                            padding: 0;
                            line-height: 20px;
                            font-size: 16px;
                            font-weight: 700;
                            border-radius: 999px;
                            flex-shrink: 0;
                            border: none !important;
                            box-shadow: none !important;
                            background: transparent !important;
                        }
                        .task-suite-calendar-add-btn:hover {
                            background: color-mix(in srgb, var(--task-suite-button-bg) 45%, transparent) !important;
                        }
                        .task-suite-calendar-lunar {
                            font-size: 11px;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-calendar-day-tasks {
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            min-height: 0;
                        }
                        .task-suite-calendar-grid--month .task-suite-calendar-day-tasks {
                            flex: 1;
                            overflow: auto;
                            padding-right: 2px;
                        }
                        .task-suite-calendar-grid--week .task-suite-calendar-day-tasks {
                            flex: 1;
                            min-height: 0;
                            overflow: auto;
                            padding-right: 2px;
                        }
                        .task-suite-calendar-grid--month .task-suite-calendar-day-head {
                            align-items: center;
                            padding: 2px 4px;
                            border-radius: 6px;
                        }
                        .task-suite-root .b3-button.b3-button--outline,
                        .task-suite-root .b3-button.b3-button--text {
                            background: var(--task-suite-button-bg);
                            color: var(--task-suite-button-text);
                            border-color: var(--task-suite-button-border);
                        }
                        .task-suite-root .b3-button.b3-button--outline:hover,
                        .task-suite-root .b3-button.b3-button--text:hover {
                            background: color-mix(in srgb, var(--task-suite-button-bg) 82%, var(--task-suite-surface));
                            color: var(--task-suite-header-text);
                            border-color: var(--task-suite-border);
                        }
                        .task-suite-root .b3-text-field,
                        .task-suite-root .b3-select,
                        .task-suite-root textarea {
                            background: var(--task-suite-form-bg);
                            color: var(--task-suite-item-text);
                            border-color: var(--task-suite-border);
                        }
                        .task-suite-root .b3-text-field::placeholder,
                        .task-suite-root textarea::placeholder {
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-editor-shell {
                            padding: 8px;
                            background: var(--task-suite-bg);
                            height: 100%;
                            box-sizing: border-box;
                            overflow-x: hidden;
                            overflow-y: auto;
                        }
                        .task-suite-editor-card {
                            background: var(--task-suite-surface);
                        }
                        .task-suite-editor-grid {
                            grid-template-columns: 1fr;
                            gap: 10px;
                        }
                        .task-suite-editor-actions {
                            justify-content: flex-end;
                            gap: 8px;
                            margin-top: 12px;
                            padding-top: 10px;
                            border-top: 1px solid var(--task-suite-border);
                        }
                        .task-suite-calendar-task {
                            font-size: 12px;
                            border-left: 4px solid var(--b3-theme-primary);
                            background: var(--task-suite-item-bg);
                            color: var(--task-suite-item-text);
                            padding: 2px 6px;
                            border-radius: 4px;
                            cursor: pointer;
                        }
                        .task-suite-calendar-task.status-todo {
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 48%, var(--task-suite-item-bg));
                        }
                        .task-suite-calendar-task.status-in-progress {
                            background: color-mix(in srgb, var(--b3-card-warning-background) 70%, var(--task-suite-item-bg));
                        }
                        .task-suite-calendar-task.status-done {
                            background: color-mix(in srgb, var(--b3-card-success-background) 58%, var(--task-suite-item-bg));
                        }
                        .task-suite-calendar-task.status-blocked {
                            background: color-mix(in srgb, var(--b3-card-error-background) 62%, var(--task-suite-item-bg));
                        }
                        .task-suite-calendar-task-line {
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            min-width: 0;
                        }
                        .task-suite-calendar-task-line .task-suite-calendar-note-badge {
                            flex-shrink: 0;
                        }
                        .task-suite-calendar-task-text {
                            flex: 1;
                            min-width: 0;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                        .task-suite-calendar-note-badge {
                            display: inline-flex;
                            align-items: center;
                            min-height: 16px;
                            padding: 0 5px;
                            border-radius: 999px;
                            font-size: 10px;
                            line-height: 16px;
                            color: var(--task-suite-text-soft);
                            background: color-mix(in srgb, var(--task-suite-chip-bg) 65%, var(--task-suite-surface));
                            white-space: nowrap;
                            cursor: help;
                        }
                        .task-suite-calendar-grid--month .task-suite-calendar-task {
                            padding: 1px 4px;
                        }
                        .task-suite-calendar-mobile-month-list {
                            margin-top: 10px;
                        }
                        .task-suite-calendar-mobile-month-day {
                            border: 1px solid var(--task-suite-border);
                            border-radius: 8px;
                            padding: 8px;
                            background: var(--task-suite-surface);
                        }
                        .task-suite-calendar-mobile-month-head {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            margin-bottom: 6px;
                            gap: 8px;
                        }
                        .task-suite-calendar-mobile-month-tasks {
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                        }
                        .task-suite-calendar-task.priority-low {
                            border-left-color: color-mix(in srgb, var(--b3-card-info-color) 88%, var(--task-suite-line));
                        }
                        .task-suite-calendar-task.priority-medium {
                            border-left-color: color-mix(in srgb, var(--task-suite-chip-text) 72%, var(--task-suite-line));
                        }
                        .task-suite-calendar-task.priority-high {
                            border-left-color: color-mix(in srgb, var(--b3-card-warning-color) 92%, var(--task-suite-line));
                        }
                        .task-suite-calendar-task.priority-urgent {
                            border-left-color: color-mix(in srgb, var(--b3-card-error-color) 92%, var(--task-suite-line));
                        }
                        .task-suite-task-time {
                            font-size: 11px;
                            color: var(--task-suite-text-soft);
                            margin-right: 4px;
                        }
                        .task-suite-day-timeline {
                            border: 1px solid var(--task-suite-border);
                            border-radius: 8px;
                            overflow: visible;
                            background: var(--task-suite-surface);
                            position: relative;
                        }
                        .task-suite-day-hour-row {
                            display: grid;
                            grid-template-columns: 64px 1fr;
                            border-top: 1px solid var(--task-suite-border);
                            min-height: 34px;
                            overflow: visible;
                            position: relative;
                        }
                        .task-suite-day-hour-row:first-child {
                            border-top: none;
                        }
                        .task-suite-day-hour-label {
                            padding: 6px 8px;
                            font-size: 12px;
                            color: var(--task-suite-text-soft);
                            background: var(--task-suite-muted);
                            border-right: 1px solid var(--task-suite-border);
                        }
                        .task-suite-day-hour-content {
                            padding: 4px 8px;
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            align-items: stretch;
                            overflow: visible;
                            position: relative;
                        }
                        .task-suite-day-event {
                            font-size: 12px;
                            padding: 2px 6px;
                            border-radius: 6px;
                            background: var(--b3-theme-background);
                            border: 1px solid var(--b3-border-color);
                            border-left: 4px solid var(--task-suite-line);
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            min-width: 0;
                            cursor: pointer;
                            position: relative;
                            z-index: 1;
                            overflow: visible;
                        }
                        .task-suite-day-event:hover,
                        .task-suite-day-event:focus-within {
                            z-index: 6;
                        }
                        .task-suite-day-event .task-suite-calendar-note-badge {
                            position: relative;
                            z-index: 7;
                        }
                        .task-suite-day-event.status-todo {
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 42%, var(--b3-theme-background));
                        }
                        .task-suite-day-event.status-in-progress {
                            background: color-mix(in srgb, var(--b3-card-warning-background) 72%, var(--b3-theme-background));
                        }
                        .task-suite-day-event.status-done {
                            background: color-mix(in srgb, var(--b3-card-success-background) 62%, var(--b3-theme-background));
                        }
                        .task-suite-day-event.status-blocked {
                            background: color-mix(in srgb, var(--b3-card-error-background) 62%, var(--b3-theme-background));
                        }
                        .task-suite-day-event.priority-low {
                            border-left-color: color-mix(in srgb, var(--b3-card-info-color) 88%, var(--task-suite-line));
                        }
                        .task-suite-day-event.priority-medium {
                            border-left-color: color-mix(in srgb, var(--task-suite-chip-text) 72%, var(--task-suite-line));
                        }
                        .task-suite-day-event.priority-high {
                            border-left-color: color-mix(in srgb, var(--b3-card-warning-color) 92%, var(--task-suite-line));
                        }
                        .task-suite-day-event.priority-urgent {
                            border-left-color: color-mix(in srgb, var(--b3-card-error-color) 92%, var(--task-suite-line));
                        }
                        .task-suite-day-event-title {
                            min-width: 0;
                            flex: 1;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                        .task-suite-calendar-repeat-badge {
                            min-height: 16px;
                            padding: 0 5px;
                            border-radius: 999px;
                            font-size: 10px;
                            line-height: 16px;
                            color: var(--b3-theme-primary);
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 58%, var(--task-suite-surface));
                            white-space: nowrap;
                            flex-shrink: 0;
                        }
                        .task-suite-calendar-task-head {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 6px;
                        }
                        .task-suite-calendar-status {
                            min-height: 18px;
                            height: 18px;
                            padding: 0 6px;
                            border-radius: 999px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 11px;
                            font-weight: 600;
                            color: var(--b3-theme-on-surface-light);
                            background: var(--b3-theme-background);
                            white-space: nowrap;
                        }
                        .task-suite-calendar-status.status-todo {
                            background: color-mix(in srgb, var(--b3-theme-primary-lighter) 45%, var(--b3-theme-background));
                            color: var(--b3-theme-primary);
                        }
                        .task-suite-calendar-status.status-in-progress {
                            background: color-mix(in srgb, var(--b3-card-warning-background) 75%, var(--b3-theme-background));
                            color: color-mix(in srgb, var(--b3-card-warning-color) 90%, #5c4300);
                        }
                        .task-suite-calendar-status.status-done {
                            background: color-mix(in srgb, var(--b3-card-success-background) 65%, var(--b3-theme-background));
                            color: var(--b3-card-success-color);
                        }
                        .task-suite-calendar-status.status-blocked {
                            background: color-mix(in srgb, var(--b3-card-error-background) 65%, var(--b3-theme-background));
                            color: var(--b3-card-error-color);
                        }
                        .task-suite-calendar-switch-btn {
                            min-height: 20px;
                            height: 20px;
                            width: 24px;
                            min-width: 24px;
                            padding: 0;
                            line-height: 18px;
                            font-size: 12px;
                            border-radius: 999px;
                        }
                        .task-suite-calendar-grid--month .task-suite-calendar-switch-btn {
                            min-height: 16px;
                            height: 16px;
                            width: 16px;
                            min-width: 16px;
                            font-size: 10px;
                            line-height: 14px;
                        }
                        .task-suite-progress-slider-row {
                            display: flex;
                            align-items: center;
                            gap: 8px;
                        }
                        .task-suite-progress-value {
                            width: 44px;
                            text-align: right;
                            font-size: 12px;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-dependency-picker {
                            max-height: 180px;
                            overflow: auto;
                            border: 1px solid var(--task-suite-border);
                            border-radius: 6px;
                            background: var(--task-suite-surface);
                            padding: 6px;
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                        }
                        .task-suite-dependency-item {
                            display: flex;
                            gap: 8px;
                            align-items: center;
                            padding: 4px 6px;
                            border-radius: 4px;
                        }
                        .task-suite-dependency-item:hover {
                            background: var(--b3-list-hover);
                        }
                        .task-suite-timeline {
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                        }
                        .task-suite-timeline-item {
                            border-left: 2px solid var(--b3-theme-primary);
                            padding: 6px 10px;
                            background: var(--task-suite-surface);
                            border-radius: 6px;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            min-width: 0;
                        }
                        .task-suite-timeline-time {
                            color: var(--task-suite-text-soft);
                            white-space: nowrap;
                            flex-shrink: 0;
                        }
                        .task-suite-timeline-title {
                            flex-shrink: 0;
                            white-space: nowrap;
                        }
                        .task-suite-timeline-content {
                            min-width: 0;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            color: var(--task-suite-text-soft);
                        }
                        .task-suite-gantt {
                            display: flex;
                            flex-direction: column;
                            gap: 12px;
                        }
                        .task-suite-gantt-canvas {
                            border: 1px solid var(--task-suite-border);
                            border-radius: 8px;
                            overflow: auto;
                            position: relative;
                            background: var(--task-suite-gantt-panel-bg);
                        }
                        .task-suite-gantt-row {
                            display: grid;
                            grid-template-columns: 260px 1fr;
                            min-height: 36px;
                            border-bottom: 1px solid var(--task-suite-border);
                            background: var(--task-suite-surface);
                        }
                        .task-suite-gantt-axis-row {
                            display: grid;
                            grid-template-columns: 260px 1fr;
                            min-height: 30px;
                            border-bottom: 1px solid var(--task-suite-border);
                            background: var(--task-suite-gantt-panel-bg);
                        }
                        .task-suite-gantt-axis-label {
                            padding: 6px 8px;
                            font-size: 12px;
                            color: var(--task-suite-header-text);
                            border-right: 1px solid var(--task-suite-border);
                        }
                        .task-suite-gantt-axis-track {
                            position: relative;
                            min-width: 800px;
                            overflow: visible;
                        }
                        .task-suite-gantt-axis-tick {
                            position: absolute;
                            top: 0;
                            bottom: 0;
                            border-left: 1px solid var(--task-suite-border);
                        }
                        .task-suite-gantt-axis-text {
                            position: absolute;
                            top: 6px;
                            transform: translateX(-50%);
                            font-size: 11px;
                            color: var(--task-suite-header-text);
                            white-space: nowrap;
                            padding: 0 2px;
                        }
                        .task-suite-gantt-row:last-child {
                            border-bottom: none;
                        }
                        .task-suite-gantt-label {
                            padding: 6px 8px;
                            font-size: 12px;
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            gap: 2px;
                            background: var(--task-suite-panel-tint);
                        }
                        .task-suite-gantt-track {
                            position: relative;
                            min-width: 800px;
                            background: repeating-linear-gradient(
                                to right,
                                var(--task-suite-gantt-track-bg) 0,
                                var(--task-suite-gantt-track-bg) 29px,
                                var(--task-suite-line) 30px
                            );
                        }
                        .task-suite-gantt-bar {
                            position: absolute;
                            top: 8px;
                            height: 20px;
                            border-radius: 10px;
                            background: var(--b3-theme-primary);
                            color: #fff;
                            font-size: 11px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            white-space: nowrap;
                            overflow: hidden;
                        }
                        .task-suite-gantt-bar.critical {
                            background: var(--b3-card-warning-color);
                        }
                        .task-suite-resource {
                            border: 1px solid var(--task-suite-border);
                            border-radius: 8px;
                            padding: 8px;
                            display: flex;
                            flex-direction: column;
                            gap: 6px;
                            background: var(--task-suite-panel-tint);
                        }
                        .task-suite-resource-bar {
                            height: 8px;
                            border-radius: 4px;
                            background: var(--task-suite-chip-bg);
                            overflow: hidden;
                        }
                        .task-suite-resource-bar > span {
                            display: block;
                            height: 100%;
                            background: var(--b3-theme-primary);
                        }
                        @media (max-width: 980px) {
                            .task-suite-columns {
                                grid-template-columns: 1fr;
                            }
                            .task-suite-gantt-row {
                                grid-template-columns: 180px 1fr;
                            }
                        }
                        @media (max-width: 720px) {
                            .task-suite-grid {
                                grid-template-columns: 1fr;
                            }
                            .task-suite-toolbar {
                                flex-direction: row;
                                align-items: center;
                            }
                            .task-suite-tabs.layout-tab-bar {
                                overflow: auto;
                                width: auto;
                            }
                            .task-suite-content {
                                padding: 10px;
                            }
                            .task-suite-calendar-grid {
                                grid-template-columns: repeat(2, minmax(0, 1fr));
                            }
                            .task-suite-calendar-grid--month {
                                height: var(--task-suite-month-height, 70vh);
                                min-height: 420px;
                                grid-template-rows: repeat(6, minmax(0, 1fr));
                                grid-template-columns: repeat(7, minmax(0, 1fr));
                            }
                            .task-suite-calendar-panel--month {
                                overflow-x: auto;
                            }
                            .task-suite-calendar-day {
                                min-height: 96px;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-toolbar {
                                padding: 8px;
                                gap: 6px;
                                flex-wrap: nowrap;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-toolbar .task-suite-toolbar-actions {
                                gap: 4px;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-toolbar .task-suite-toolbar-icon-btn {
                                min-width: 26px;
                                width: 26px;
                                height: 26px;
                                font-size: 12px;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-tabs .task-suite-tab {
                                min-width: 42px;
                                flex: 1 0 auto;
                                padding: 0 4px;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-tab-label {
                                display: none;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-content {
                                padding: 8px;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-card {
                                padding: 10px;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-calendar-add-btn {
                                display: none;
                            }
                            .task-suite-root.task-suite-mobile .task-suite-calendar-grid--month .task-suite-calendar-day-tasks {
                                display: none;
                            }
                        }
                    </style>
                    <div class="task-suite-toolbar">
                        <div class="layout-tab-bar fn__flex task-suite-tabs" data-role="tabs"></div>
                        <div class="task-suite-toolbar-actions">
                            <button class="b3-button b3-button--outline task-suite-toolbar-icon-btn" data-action="toggle-theme" title="${themeMode === "dark" ? "切换浅色主题" : "切换暗黑主题"}">${themeMode === "dark" ? "☀" : "🌙"}</button>
                            <button class="b3-button b3-button--outline task-suite-toolbar-icon-btn" data-action="run-self-test" title="运行自测">🧪</button>
                        </div>
                    </div>
                    <div class="task-suite-content" data-role="content"></div>
                </div>
            `;
        }

        bindRootEvents() {
            if (!this.root) {
                return;
            }
            this.root.addEventListener("click", (event) => this.handleRootClick(event));
            this.root.addEventListener("submit", (event) => this.handleRootSubmit(event));
            this.root.addEventListener("change", (event) => this.handleRootChange(event));
            this.root.addEventListener("mouseover", (event) => this.handleRootMouseOver(event));
            this.root.addEventListener("mouseout", (event) => this.handleRootMouseOut(event));
            this.root.addEventListener("focusin", (event) => this.handleRootFocusIn(event));
            this.root.addEventListener("focusout", (event) => this.handleRootFocusOut(event));
            this.root.addEventListener("dragstart", (event) => this.handleDragStart(event));
            this.root.addEventListener("dragover", (event) => this.handleDragOver(event));
            this.root.addEventListener("drop", (event) => this.handleDrop(event));
            this.root.addEventListener("dragend", (event) => this.handleDragEnd(event));
        }

        handleRootMouseOver(event) {
            const badge = event.target.closest(".task-suite-note-tooltip-trigger");
            if (!badge || !this.root || !this.root.contains(badge)) {
                return;
            }
            this.showNoteTooltip(badge);
        }

        handleRootMouseOut(event) {
            const badge = event.target.closest(".task-suite-note-tooltip-trigger");
            if (!badge || !this.root || !this.root.contains(badge)) {
                return;
            }
            const nextTarget = event.relatedTarget;
            if (nextTarget && badge.contains(nextTarget)) {
                return;
            }
            this.hideNoteTooltip();
        }

        handleRootFocusIn(event) {
            const badge = event.target.closest(".task-suite-note-tooltip-trigger");
            if (!badge || !this.root || !this.root.contains(badge)) {
                return;
            }
            this.showNoteTooltip(badge);
        }

        handleRootFocusOut(event) {
            const badge = event.target.closest(".task-suite-note-tooltip-trigger");
            if (!badge || !this.root || !this.root.contains(badge)) {
                return;
            }
            this.hideNoteTooltip();
        }

        getOrCreateNoteTooltip() {
            if (this.noteTooltipEl && this.noteTooltipEl.isConnected) {
                return this.noteTooltipEl;
            }
            const tooltip = document.createElement("div");
            tooltip.className = "tooltip";
            tooltip.style.display = "none";
            tooltip.style.pointerEvents = "none";
            tooltip.style.whiteSpace = "pre-wrap";
            tooltip.style.overflowWrap = "anywhere";
            tooltip.style.wordBreak = "break-word";
            tooltip.style.maxWidth = "min(420px, 80vw)";
            document.body.appendChild(tooltip);
            this.noteTooltipEl = tooltip;
            return tooltip;
        }

        showNoteTooltip(target) {
            if (!target) {
                return;
            }
            const note = String(target.getAttribute("aria-label") || "").trim();
            if (!note) {
                this.hideNoteTooltip();
                return;
            }
            const tooltip = this.getOrCreateNoteTooltip();
            tooltip.textContent = note;
            tooltip.style.display = "block";
            const targetRect = target.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const offset = 8;
            let top = targetRect.top - tooltipRect.height - offset;
            if (top < offset) {
                top = targetRect.bottom + offset;
            }
            if (top + tooltipRect.height > window.innerHeight - offset) {
                top = Math.max(offset, targetRect.top - tooltipRect.height - offset);
            }
            let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
            left = Math.max(offset, Math.min(left, window.innerWidth - tooltipRect.width - offset));
            tooltip.style.top = `${Math.round(top)}px`;
            tooltip.style.left = `${Math.round(left)}px`;
        }

        hideNoteTooltip() {
            if (!this.noteTooltipEl) {
                return;
            }
            this.noteTooltipEl.style.display = "none";
        }

        handleRootClick(event) {
            const target = event.target.closest("[data-action]");
            if (!target) {
                return;
            }
            const action = target.dataset.action;
            if (action === "switch-tab") {
                this.ui.activeTab = target.dataset.tab || "list";
                this.renderApp();
                return;
            }
            if (action === "open-create-task") {
                this.openTaskEditorDialog("", target.dataset.date || "");
                return;
            }
            if (action === "open-edit-task") {
                this.openTaskEditorDialog(target.dataset.taskId || "");
                return;
            }
            if (action === "open-calendar-task-editor") {
                const taskId = target.dataset.taskId || "";
                const date = target.dataset.date || "";
                this.openCalendarOccurrenceEditor(taskId, date);
                return;
            }
            if (action === "delete-task") {
                this.deleteTask(target.dataset.taskId || "");
                return;
            }
            if (action === "quick-status") {
                const task = this.findTask(target.dataset.taskId || "");
                if (!task) {
                    return;
                }
                const statusQueue = STATUS_OPTIONS.map((item) => item.value);
                const currentIndex = statusQueue.indexOf(task.status);
                const next = statusQueue[(currentIndex + 1) % statusQueue.length];
                this.updateTask(task.id, { status: next }, "状态更新");
                return;
            }
            if (action === "cycle-calendar-status") {
                const taskId = target.dataset.taskId || "";
                const date = target.dataset.date || "";
                this.cycleCalendarOccurrenceStatus(taskId, date);
                return;
            }
            if (action === "add-subtask") {
                const input = this.root.querySelector(`input[data-subtask-input="${target.dataset.taskId || ""}"]`);
                if (!input) {
                    return;
                }
                const title = input.value.trim();
                if (!title) {
                    showMessage("子任务标题不能为空", 2000, "error");
                    return;
                }
                const task = this.findTask(target.dataset.taskId || "");
                if (!task) {
                    return;
                }
                task.subtasks.push({
                    id: this.makeId("sub"),
                    title,
                    done: false
                });
                task.updatedAt = new Date().toISOString();
                this.pushHistory(task.id, "子任务新增", `新增子任务「${title}」`);
                input.value = "";
                this.commitAndRender();
                return;
            }
            if (action === "remove-subtask") {
                const task = this.findTask(target.dataset.taskId || "");
                if (!task) {
                    return;
                }
                const before = task.subtasks.length;
                task.subtasks = task.subtasks.filter((item) => item.id !== (target.dataset.subtaskId || ""));
                if (task.subtasks.length !== before) {
                    task.updatedAt = new Date().toISOString();
                    this.pushHistory(task.id, "子任务删除", "移除子任务");
                    this.commitAndRender();
                }
                return;
            }
            if (action === "new-task-on-date") {
                const date = target.dataset.date || this.formatDate(new Date());
                this.openTaskEditorDialog("", `${date}T09:00`);
                return;
            }
            if (action === "calendar-prev") {
                this.shiftCalendar(-1);
                return;
            }
            if (action === "calendar-next") {
                this.shiftCalendar(1);
                return;
            }
            if (action === "calendar-today") {
                this.ui.calendarCursor = this.formatDate(new Date());
                this.renderApp();
                return;
            }
            if (action === "switch-calendar-mode") {
                this.ui.calendarMode = target.dataset.mode || "month";
                this.renderApp();
                return;
            }
            if (action === "gantt-range-quick") {
                this.applyGanttQuickRange(target.dataset.range || "30d");
                return;
            }
            if (action === "run-self-test") {
                this.runSelfTest();
                return;
            }
            if (action === "toggle-theme") {
                const current = this.normalizeThemeMode(this.state.settings.themeMode);
                this.state.settings.themeMode = current === "dark" ? "light" : "dark";
                this.saveState();
                if (this.tabElement) {
                    this.mountMainTab();
                } else if (this.dialog) {
                    this.openDialog();
                }
            }
        }

        handleRootSubmit(event) {
            event.preventDefault();
        }

        handleRootChange(event) {
            const target = event.target;
            if (!target || !target.dataset) {
                return;
            }
            if (target.dataset.action === "toggle-subtask") {
                const task = this.findTask(target.dataset.taskId || "");
                if (!task) {
                    return;
                }
                const subtask = task.subtasks.find((item) => item.id === (target.dataset.subtaskId || ""));
                if (!subtask) {
                    return;
                }
                subtask.done = !!target.checked;
                task.updatedAt = new Date().toISOString();
                this.recomputeTaskProgress(task);
                this.pushHistory(task.id, "子任务状态", `子任务「${subtask.title}」${subtask.done ? "完成" : "重开"}`);
                this.commitAndRender();
                return;
            }
            if (target.dataset.filter === "timeline-start") {
                this.ui.timelineStart = target.value || "";
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "timeline-end") {
                this.ui.timelineEnd = target.value || "";
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "calendar-cursor") {
                this.ui.calendarCursor = target.value || this.formatDate(new Date());
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "calendar-month-height") {
                const next = this.normalizeCalendarMonthHeight(target.value);
                this.ui.calendarMonthHeight = next;
                this.state.settings.calendarMonthHeight = next;
                this.saveState();
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "gantt-start") {
                this.ui.ganttStart = target.value || "";
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "gantt-end") {
                this.ui.ganttEnd = target.value || "";
                this.renderApp();
                return;
            }
        }

        handleDragStart(event) {
            const card = this.getClosestFromEvent(event, "[data-draggable-task-id]");
            if (!card) {
                return;
            }
            card.classList.add("dragging");
            this.draggingTaskId = card.dataset.draggableTaskId || "";
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", card.dataset.draggableTaskId || "");
        }

        handleDragOver(event) {
            const columnBody = this.getClosestFromEvent(event, "[data-drop-status]");
            if (!columnBody) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (this.dragOverColumnBody && this.dragOverColumnBody !== columnBody) {
                this.dragOverColumnBody.classList.remove("drag-over");
            }
            this.dragOverColumnBody = columnBody;
            this.dragOverColumnBody.classList.add("drag-over");
        }

        handleDrop(event) {
            const columnBody = this.getClosestFromEvent(event, "[data-drop-status]");
            if (!columnBody) {
                return;
            }
            event.preventDefault();
            this.clearKanbanDragOver();
            const taskId = event.dataTransfer.getData("text/plain");
            const task = this.findTask(taskId);
            if (!task) {
                return;
            }
            const nextStatus = columnBody.dataset.dropStatus || "todo";
            if (task.status !== nextStatus) {
                this.flashKanbanDropSuccess(task.id);
                this.updateTask(task.id, { status: nextStatus }, "看板拖拽");
                return;
            }
            this.flashKanbanDropSuccess(task.id);
        }

        handleDragEnd(event) {
            const card = this.getClosestFromEvent(event, "[data-draggable-task-id]");
            if (!card) {
                this.clearKanbanDragOver();
                return;
            }
            card.classList.remove("dragging");
            this.clearKanbanDragOver();
        }

        renderApp() {
            if (!this.root) {
                return;
            }
            this.hideNoteTooltip();
            const tabHost = this.root.querySelector("[data-role='tabs']");
            const contentHost = this.root.querySelector("[data-role='content']");
            tabHost.innerHTML = TAB_OPTIONS.map((tab) => `
                <div class="item item--full task-suite-tab ${tab.value === this.ui.activeTab ? "item--focus" : ""}"
                    data-action="switch-tab"
                    title="${tab.label}"
                    data-tab="${tab.value}">
                    <span class="task-suite-tab-icon">${tab.icon || "•"}</span>
                    <span class="item__text task-suite-tab-label">${tab.label}</span>
                </div>
            `).join("");
            let html = "";
            if (this.ui.activeTab === "list") {
                html = this.renderListView();
            } else if (this.ui.activeTab === "timeline") {
                html = this.renderTimelineView();
            } else if (this.ui.activeTab === "kanban") {
                html = this.renderKanbanView();
            } else if (this.ui.activeTab === "calendar") {
                html = this.renderCalendarView();
            } else if (this.ui.activeTab === "gantt") {
                html = this.renderGanttView();
            }
            contentHost.innerHTML = html;
        }

        renderListView() {
            const cards = this.state.tasks
                .slice()
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .map((item) => this.renderTaskCard(item))
                .join("");
            return `
                <div class="task-suite-list">
                    <div class="task-suite-card">
                        <div class="task-suite-list-toolbar">
                            <div class="task-suite-meta">集中管理任务，新增/编辑通过弹窗表单完成。</div>
                            <button class="b3-button b3-button--text" data-action="open-create-task">新建任务</button>
                        </div>
                    </div>
                    <div class="task-suite-card">
                        <div class="fn__flex" style="justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <strong>任务列表</strong>
                            <span class="task-suite-meta">共 ${this.state.tasks.length} 个任务</span>
                        </div>
                        <div class="task-suite-list">
                            ${cards || `<div class="b3-label">暂无任务，先创建第一条清单任务。</div>`}
                        </div>
                    </div>
                </div>
            `;
        }

        renderTaskCard(task) {
            const dependencyTitles = task.dependencies
                .map((id) => this.findTask(id))
                .filter(Boolean)
                .map((item) => item.title);
            const repeatTime = this.getTaskRepeatTimeLabel(task);
            const occurrenceNoteCount = this.getTaskOccurrenceNoteCount(task.id);
            return `
                <div class="task-suite-card task-suite-task-card">
                    <div class="fn__flex" style="justify-content: space-between; gap: 8px; align-items: center;">
                        <div style="min-width: 0;">
                            <div style="font-weight: 600;">${this.escapeHtml(task.title)}</div>
                            <div class="task-suite-meta">
                                <span>${this.getStatusLabel(task.status)}</span>
                                <span>优先级: ${this.getPriorityLabel(task.priority)}</span>
                                <span>重复: ${this.getRepeatLabel(task.repeat)}</span>
                                <span>进度: ${task.progress}%</span>
                            </div>
                        </div>
                        <div class="task-suite-task-actions">
                            <button class="b3-button b3-button--outline task-suite-icon-btn" data-action="quick-status" data-task-id="${task.id}" title="流转状态">↻</button>
                            <button class="b3-button b3-button--outline task-suite-icon-btn" data-action="open-edit-task" data-task-id="${task.id}" title="编辑">✎</button>
                            <button class="b3-button b3-button--error task-suite-icon-btn" data-action="delete-task" data-task-id="${task.id}" title="删除">🗑</button>
                        </div>
                    </div>
                    <div style="margin-top: 6px;">${this.escapeHtml(task.description || "暂无描述")}</div>
                    <div class="task-suite-meta" style="margin-top: 8px;">
                        ${task.startDate ? `<span>计划开始: ${task.startDate}</span>` : ""}
                        ${task.dueDate ? `<span>计划截止: ${task.dueDate}</span>` : ""}
                        ${task.endDate ? `<span>实际完成: ${task.endDate}</span>` : ""}
                        ${task.reminderTime ? `<span>提醒: ${task.reminderTime}</span>` : ""}
                    </div>
                    ${task.tags.length ? `
                        <div class="task-suite-meta" style="margin-top: 8px;">
                            ${task.tags.map((tag) => `<span class="task-suite-tag">#${this.escapeHtml(tag)}</span>`).join("")}
                        </div>
                    ` : ""}
                    ${dependencyTitles.length ? `
                        <div class="task-suite-meta" style="margin-top: 6px;">
                            依赖: ${dependencyTitles.map((title) => this.escapeHtml(title)).join("，")}
                        </div>
                    ` : ""}
                    ${task.repeat !== "none" ? `
                        <div class="task-suite-repeat-summary">
                            <span class="task-suite-repeat-badge">${this.getRepeatLabel(task.repeat)}</span>
                            <span>日历按开始时间 ${repeatTime} 展示</span>
                            <span>实例备注 ${occurrenceNoteCount} 条</span>
                        </div>
                    ` : ""}
                    <div class="task-suite-subtasks">
                        ${task.subtasks.map((subtask) => `
                            <div class="task-suite-subtask">
                                <input type="checkbox" data-action="toggle-subtask" data-task-id="${task.id}" data-subtask-id="${subtask.id}" ${subtask.done ? "checked" : ""}>
                                <span>${this.escapeHtml(subtask.title)}</span>
                                <button class="b3-button b3-button--outline" data-action="remove-subtask" data-task-id="${task.id}" data-subtask-id="${subtask.id}">删除</button>
                            </div>
                        `).join("")}
                        <div class="task-suite-subtask-entry">
                            <input class="b3-text-field fn__block" data-subtask-input="${task.id}" placeholder="新增子任务">
                            <button class="b3-button b3-button--text" data-action="add-subtask" data-task-id="${task.id}">添加</button>
                        </div>
                    </div>
                </div>
            `;
        }

        renderTimelineView() {
            const timelineEntries = this.getTimelineEntries();
            const filtered = timelineEntries.filter((item) => this.inTimelineRange(item.time));
            return `
                <div class="task-suite-list">
                    <div class="task-suite-card">
                        <div class="task-suite-grid">
                            <div class="task-suite-field" style="grid-column: span 3;">
                                <label>开始日期</label>
                                <input class="b3-text-field fn__block" data-filter="timeline-start" type="date" value="${this.escapeHtml(this.ui.timelineStart || "")}">
                            </div>
                            <div class="task-suite-field" style="grid-column: span 3;">
                                <label>结束日期</label>
                                <input class="b3-text-field fn__block" data-filter="timeline-end" type="date" value="${this.escapeHtml(this.ui.timelineEnd || "")}">
                            </div>
                            <div class="task-suite-field" style="grid-column: span 6;">
                                <label>快速定位</label>
                                <div class="task-suite-meta">当前筛选后共 ${filtered.length} 条记录，支持历史变更与未来计划联合查看</div>
                            </div>
                        </div>
                    </div>
                    <div class="task-suite-card">
                        <div class="task-suite-timeline">
                            ${filtered.length ? filtered.map((item) => `
                                <div class="task-suite-timeline-item">
                                    <span class="task-suite-timeline-time">${new Date(item.time).toLocaleString()}</span>
                                    <strong class="task-suite-timeline-title">${this.escapeHtml(item.title)}</strong>
                                    <span class="task-suite-timeline-content">${this.escapeHtml(item.content)}</span>
                                </div>
                            `).join("") : `<div class="b3-label">当前筛选范围内暂无时间轴记录。</div>`}
                        </div>
                    </div>
                </div>
            `;
        }

        renderKanbanView() {
            const columns = this.createDefaultState().boardColumns;
            const columnHtml = columns.map((column) => {
                const tasks = this.state.tasks
                    .filter((task) => task.status === column.status)
                    .sort((a, b) => {
                        const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
                        const diff = (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
                        if (diff !== 0) {
                            return diff;
                        }
                        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                    });
                const columnClass = this.getColumnClassByStatus(column.status);
                const columnHeaderClass = this.getColumnHeaderClassByStatus(column.status);
                return `
                    <div class="task-suite-column ${columnClass}">
                        <div class="task-suite-column-header ${columnHeaderClass}">
                            <div class="task-suite-column-title-wrap">
                                <span class="task-suite-column-status-dot"></span>
                                <div class="task-suite-column-title">${this.escapeHtml(column.title)}</div>
                            </div>
                            <span class="task-suite-column-count">${tasks.length} 项</span>
                        </div>
                        <div class="task-suite-column-body" data-drop-status="${column.status}">
                            ${tasks.map((task) => `
                                <div class="task-suite-kanban-card ${this.getPriorityClass(task.priority)} ${this.ui.kanbanDropTaskId === task.id ? "drop-success" : ""}" draggable="true" data-draggable-task-id="${task.id}">
                                    <div class="task-suite-kanban-title">${this.escapeHtml(task.title)}</div>
                                    <div class="task-suite-kanban-meta">
                                        <span class="task-suite-kanban-chip">进度: ${task.progress}%</span>
                                        ${task.repeat !== "none" ? `<span class="task-suite-kanban-chip">重复: ${this.getRepeatLabel(task.repeat)}</span>` : ""}
                                        ${task.startDate ? `<span class="task-suite-kanban-chip">开始: ${task.startDate.slice(0, 10)}</span>` : ""}
                                        ${task.dueDate ? `<span class="task-suite-kanban-chip">截止: ${task.dueDate.slice(0, 10)}</span>` : ""}
                                        ${task.tags.length ? `<span class="task-suite-kanban-chip">${task.tags.slice(0, 2).map((tag) => `#${this.escapeHtml(tag)}`).join(" ")}</span>` : ""}
                                    </div>
                                    ${task.description ? `<div class="task-suite-kanban-desc">${this.escapeHtml(task.description)}</div>` : ""}
                                </div>
                            `).join("")}
                        </div>
                    </div>
                `;
            }).join("");
            return `
                <div class="task-suite-list">
                    <div class="task-suite-card">
                        <div class="task-suite-meta">看板按任务状态自动分列，拖拽任务卡片后会同步更新清单、时间轴、日历与甘特图。</div>
                    </div>
                    <div class="task-suite-columns">
                        ${columnHtml}
                    </div>
                </div>
            `;
        }

        renderCalendarView() {
            const mode = this.ui.calendarMode || "month";
            const cursor = this.parseDate(this.ui.calendarCursor) || new Date();
            const range = this.getCalendarRange(mode, cursor);
            const monthHeight = this.normalizeCalendarMonthHeight(this.ui.calendarMonthHeight || this.state.settings.calendarMonthHeight);
            const allOccurrences = this.getOccurrencesForRange(range.start, range.end);
            const mapByDay = new Map();
            allOccurrences.forEach((item) => {
                const key = item.date;
                if (!mapByDay.has(key)) {
                    mapByDay.set(key, []);
                }
                mapByDay.get(key).push(item);
            });
            const modeTabs = [
                { mode: "month", label: `月 · ${cursor.getMonth() + 1}月` },
                { mode: "week", label: `周 · 第${this.getWeekNumber(this.startOfWeek(cursor))}周` },
                { mode: "day", label: `日 · ${cursor.getDate()}号` }
            ];
            const isMobileMonthView = Boolean(this.isMobile && mode === "month");
            const modeTabsHtml = modeTabs.map((item) => `
                                <div class="item item--full ${mode === item.mode ? "item--focus" : ""}" data-action="switch-calendar-mode" data-mode="${item.mode}">
                                    <span class="fn__flex-1"></span>
                                    <span class="item__text">${item.label}</span>
                                    <span class="fn__flex-1"></span>
                                </div>
                            `).join("");
            if (mode === "day") {
                const day = range.days[0];
                const tasks = mapByDay.get(day.date) || [];
                return `
                    <div class="task-suite-list">
                        <div class="task-suite-card task-suite-calendar-header">
                            <div class="fn__flex" style="gap: 8px; align-items: center;">
                                <button class="b3-button b3-button--outline" data-action="calendar-prev">上一段</button>
                                <button class="b3-button b3-button--outline" data-action="calendar-next">下一段</button>
                                <button class="b3-button b3-button--text" data-action="calendar-today">今天</button>
                                <input class="b3-text-field" type="date" data-filter="calendar-cursor" value="${this.formatDate(cursor)}">
                            </div>
                            <div class="layout-tab-bar fn__flex task-suite-calendar-mode">
                                ${modeTabsHtml}
                            </div>
                            <div class="task-suite-meta">
                                展示区间: ${range.start} 至 ${range.end}
                            </div>
                            <div class="task-suite-meta">
                                <span>月视图密度</span>
                                <select class="b3-select" data-filter="calendar-month-height">
                                    ${[60, 70, 80].map((item) => `<option value="${item}" ${monthHeight === item ? "selected" : ""}>${item}vh</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="task-suite-card">
                            <div class="fn__flex" style="justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <strong>${day.label}</strong>
                                <button class="b3-button b3-button--outline" data-action="new-task-on-date" data-date="${day.date}">新增任务</button>
                            </div>
                            ${tasks.length ? this.renderCalendarDayTimeline(day.date, tasks) : `<div class="task-suite-meta">当日暂无任务，时间轴会在有任务时显示。</div>`}
                        </div>
                    </div>
                `;
            }
            return `
                <div class="task-suite-list">
                    <div class="task-suite-card task-suite-calendar-header">
                        <div class="fn__flex" style="gap: 8px; align-items: center;">
                            <button class="b3-button b3-button--outline" data-action="calendar-prev">上一段</button>
                            <button class="b3-button b3-button--outline" data-action="calendar-next">下一段</button>
                            <button class="b3-button b3-button--text" data-action="calendar-today">今天</button>
                            <input class="b3-text-field" type="date" data-filter="calendar-cursor" value="${this.formatDate(cursor)}">
                        </div>
                        <div class="layout-tab-bar fn__flex task-suite-calendar-mode">
                            ${modeTabsHtml}
                        </div>
                        <div class="task-suite-meta">
                            展示区间: ${range.start} 至 ${range.end}
                        </div>
                            <div class="task-suite-meta">
                                <span>月视图密度</span>
                                <select class="b3-select" data-filter="calendar-month-height">
                                    ${[60, 70, 80].map((item) => `<option value="${item}" ${monthHeight === item ? "selected" : ""}>${item}vh</option>`).join("")}
                                </select>
                            </div>
                    </div>
                    <div class="task-suite-card ${mode === "month" ? "task-suite-calendar-panel--month" : ""} ${mode === "week" ? "task-suite-calendar-panel--week" : ""}">
                        <div class="task-suite-calendar-grid task-suite-calendar-grid--${mode}" style="${mode === "month" ? `--task-suite-month-height:${monthHeight}vh;` : ""}">
                            ${range.days.map((day) => {
                                const tasks = mapByDay.get(day.date) || [];
                                const renderTasks = isMobileMonthView ? [] : tasks;
                                return `
                                    <div class="task-suite-calendar-day ${day.dimmed ? "dimmed" : ""}">
                                        <div class="task-suite-calendar-day-head">
                                            <div class="task-suite-calendar-day-title">
                                                <strong>${day.label}</strong>
                                                <div class="task-suite-calendar-lunar">${this.getLunarLabel(day.date)}</div>
                                            </div>
                                            <button class="b3-button b3-button--outline task-suite-calendar-add-btn" data-action="new-task-on-date" data-date="${day.date}">+</button>
                                        </div>
                                        <div class="task-suite-calendar-day-tasks">
                                            ${renderTasks.map((item) => {
                                                const occurrenceStatus = this.getOccurrenceStatus(item.task, day.date);
                                                const statusClass = this.getStatusClass(occurrenceStatus);
                                                const note = this.getOccurrenceNote(item.task, day.date);
                                                const noteBadge = note ? `<span class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger" tabindex="0" aria-label="${this.escapeHtml(note)}">备注</span>` : "";
                                                const repeatBadge = item.task.repeat !== "none" ? `<span class="task-suite-calendar-repeat-badge" title="重复规则：${this.getRepeatLabel(item.task.repeat)}">${this.getRepeatLabel(item.task.repeat)}</span>` : "";
                                                return mode === "month" ? `
                                                    <div class="task-suite-calendar-task ${this.getPriorityClass(item.task.priority)} ${statusClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day.date}">
                                                        <div class="task-suite-calendar-task-line">
                                                            <div class="task-suite-calendar-task-text">
                                                                ${this.getCalendarTaskTimeLabel(item.task, day.date) ? `<span class="task-suite-task-time">${this.getCalendarTaskTimeLabel(item.task, day.date)}</span>` : ""}
                                                                ${this.escapeHtml(item.task.title)}
                                                            </div>
                                                            ${repeatBadge}
                                                            ${noteBadge}
                                                            <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day.date}">↻</button>
                                                        </div>
                                                    </div>
                                                ` : `
                                                    <div class="task-suite-calendar-task ${this.getPriorityClass(item.task.priority)} ${statusClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day.date}">
                                                        <div class="task-suite-calendar-task-head">
                                                            <span class="task-suite-calendar-status ${statusClass}" title="${this.getStatusLabel(occurrenceStatus)}">${this.getStatusLabel(occurrenceStatus)}</span>
                                                            ${repeatBadge}
                                                            ${noteBadge}
                                                            <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day.date}">↻</button>
                                                        </div>
                                                        <div>
                                                            ${this.getCalendarTaskTimeLabel(item.task, day.date) ? `<span class="task-suite-task-time">${this.getCalendarTaskTimeLabel(item.task, day.date)}</span>` : ""}
                                                            ${this.escapeHtml(item.task.title)}
                                                        </div>
                                                    </div>
                                                `;
                                            }).join("")}
                                        </div>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                    ${isMobileMonthView ? this.renderMobileMonthTaskList(range.days, mapByDay) : ""}
                </div>
            `;
        }

        renderMobileMonthTaskList(days, mapByDay) {
            const dayBlocks = days.map((day) => {
                if (day.dimmed) {
                    return "";
                }
                const tasks = mapByDay.get(day.date) || [];
                if (!tasks.length) {
                    return "";
                }
                return `
                    <div class="task-suite-calendar-mobile-month-day">
                        <div class="task-suite-calendar-mobile-month-head">
                            <div class="task-suite-calendar-day-title">
                                <strong>${day.label}</strong>
                                <div class="task-suite-calendar-lunar">${this.getLunarLabel(day.date)}</div>
                            </div>
                            <button class="b3-button b3-button--outline" data-action="new-task-on-date" data-date="${day.date}">新增</button>
                        </div>
                        <div class="task-suite-calendar-mobile-month-tasks">
                            ${tasks.map((item) => {
                                const occurrenceStatus = this.getOccurrenceStatus(item.task, day.date);
                                const statusClass = this.getStatusClass(occurrenceStatus);
                                const note = this.getOccurrenceNote(item.task, day.date);
                                const noteBadge = note ? `<span class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger" tabindex="0" aria-label="${this.escapeHtml(note)}">备注</span>` : "";
                                const repeatBadge = item.task.repeat !== "none" ? `<span class="task-suite-calendar-repeat-badge" title="重复规则：${this.getRepeatLabel(item.task.repeat)}">${this.getRepeatLabel(item.task.repeat)}</span>` : "";
                                return `
                                    <div class="task-suite-calendar-task ${this.getPriorityClass(item.task.priority)} ${statusClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day.date}">
                                        <div class="task-suite-calendar-task-line">
                                            <div class="task-suite-calendar-task-text">
                                                ${this.getCalendarTaskTimeLabel(item.task, day.date) ? `<span class="task-suite-task-time">${this.getCalendarTaskTimeLabel(item.task, day.date)}</span>` : ""}
                                                ${this.escapeHtml(item.task.title)}
                                            </div>
                                            ${repeatBadge}
                                            ${noteBadge}
                                            <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day.date}">↻</button>
                                        </div>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                `;
            }).filter(Boolean).join("");
            if (!dayBlocks) {
                return `
                    <div class="task-suite-card task-suite-calendar-mobile-month-list">
                        <div class="task-suite-meta">当前月份暂无任务清单。</div>
                    </div>
                `;
            }
            return `
                <div class="task-suite-card task-suite-calendar-mobile-month-list">
                    <div class="task-suite-calendar-mobile-month-tasks">${dayBlocks}</div>
                </div>
            `;
        }

        renderGanttView() {
            const tasks = this.getGanttTasks();
            if (!tasks.length) {
                return `<div class="b3-label">暂无可展示任务，请先在清单中填写开始/截止时间。</div>`;
            }
            const range = this.getGanttRange(tasks);
            const timelineDays = this.diffDays(range.startDate, range.endDate) + 1;
            const trackWidth = Math.max(800, timelineDays * 30);
            const criticalSet = this.getCriticalPathSet(tasks);
            const baseAxisStep = timelineDays > 120 ? 14 : (timelineDays > 60 ? 7 : (timelineDays > 31 ? 3 : 1));
            const axisStep = Math.max(baseAxisStep, Math.ceil(72 / 30));
            const tickPoints = [];
            for (let i = 0; i < timelineDays; i += axisStep) {
                tickPoints.push(i);
            }
            if (!tickPoints.includes(timelineDays - 1)) {
                tickPoints.push(timelineDays - 1);
            }
            const ticks = Array.from(new Set(tickPoints))
                .sort((a, b) => a - b)
                .map((point) => {
                    const currentDate = this.addDays(range.startDate, point);
                    const isFirst = point === 0;
                    const isLast = point === timelineDays - 1;
                    const transform = isFirst ? "translateX(0)" : (isLast ? "translateX(-100%)" : "translateX(-50%)");
                    const align = isFirst ? "left" : (isLast ? "right" : "center");
                    return `
                        <span class="task-suite-gantt-axis-tick" style="left:${point * 30}px;"></span>
                        <span class="task-suite-gantt-axis-text" style="left:${point * 30}px; transform:${transform}; text-align:${align};">${this.formatDate(currentDate).slice(5)}</span>
                    `;
                });
            const rows = tasks.map((task) => {
                const left = this.diffDays(range.startDate, this.parseDate(task.planStart)) * 30;
                const durationDays = Math.max(1, this.diffDays(this.parseDate(task.planStart), this.parseDate(task.planEnd)) + 1);
                const width = durationDays * 30;
                return `
                    <div class="task-suite-gantt-row" data-task-id="${task.id}">
                        <div class="task-suite-gantt-label">
                            <strong>${this.escapeHtml(task.title)}</strong>
                            <span class="task-suite-meta">${task.planStart} ~ ${task.planEnd} | ${task.progress}% | ${task.resource ? this.escapeHtml(task.resource) : "未分配"}</span>
                        </div>
                        <div class="task-suite-gantt-track" style="width:${trackWidth}px;">
                            <div class="task-suite-gantt-bar ${criticalSet.has(task.id) ? "critical" : ""}" style="left:${left}px; width:${width}px;">
                                ${task.progress}%
                            </div>
                        </div>
                    </div>
                `;
            }).join("");
            const resources = this.getResourceOverview(tasks);
            return `
                <div class="task-suite-gantt">
                    <div class="task-suite-card">
                        <div class="task-suite-grid">
                            <div class="task-suite-field" style="grid-column: span 3;">
                                <label>开始日期</label>
                                <input class="b3-text-field fn__block" type="date" data-filter="gantt-start" value="${this.escapeHtml(this.ui.ganttStart || "")}">
                            </div>
                            <div class="task-suite-field" style="grid-column: span 3;">
                                <label>结束日期</label>
                                <input class="b3-text-field fn__block" type="date" data-filter="gantt-end" value="${this.escapeHtml(this.ui.ganttEnd || "")}">
                            </div>
                            <div class="task-suite-field" style="grid-column: span 6;">
                                <label>快速范围</label>
                                <div class="fn__flex" style="gap: 8px;">
                                    <button class="b3-button b3-button--outline" data-action="gantt-range-quick" data-range="today">当天</button>
                                    <button class="b3-button b3-button--outline" data-action="gantt-range-quick" data-range="week">当周</button>
                                    <button class="b3-button b3-button--outline" data-action="gantt-range-quick" data-range="month">当月</button>
                                    <button class="b3-button b3-button--outline" data-action="gantt-range-quick" data-range="30d">30天</button>
                                    <button class="b3-button b3-button--outline" data-action="gantt-range-quick" data-range="90d">90天</button>
                                </div>
                            </div>
                        </div>
                        <div class="task-suite-meta" style="margin-top: 8px;">
                            关键路径任务数量: ${criticalSet.size}，项目区间: ${this.formatDate(range.startDate)} 至 ${this.formatDate(range.endDate)}
                        </div>
                    </div>
                    <div class="task-suite-gantt-canvas" style="min-width: 100%;">
                        <div style="width: ${trackWidth + 260}px;">
                            <div class="task-suite-gantt-axis-row">
                                <div class="task-suite-gantt-axis-label">时间轴</div>
                                <div class="task-suite-gantt-axis-track" style="width:${trackWidth}px;">
                                    ${ticks.join("")}
                                </div>
                            </div>
                            ${rows}
                        </div>
                    </div>
                    <div class="task-suite-card">
                        <strong>资源分配可视化</strong>
                        <div class="task-suite-grid" style="margin-top: 10px;">
                            ${resources.map((resource) => `
                                <div class="task-suite-resource" style="grid-column: span 4;">
                                    <div class="fn__flex" style="justify-content: space-between;">
                                        <span>${this.escapeHtml(resource.name)}</span>
                                        <span>${resource.taskCount} 项</span>
                                    </div>
                                    <div class="task-suite-resource-bar">
                                        <span style="width:${resource.loadPercent}%"></span>
                                    </div>
                                    <div class="task-suite-meta">负载: ${resource.loadPercent}% | 平均进度: ${resource.avgProgress}%</div>
                                </div>
                            `).join("")}
                        </div>
                    </div>
                </div>
            `;
        }

        openTaskEditorDialog(taskId = "", presetDateTime = "") {
            const editingTask = taskId ? this.findTask(taskId) : null;
            const dependencySet = new Set(editingTask?.dependencies || []);
            const allDependencies = this.state.tasks
                .filter((item) => item.id !== (editingTask?.id || ""))
                .map((item) => `
                    <label class="task-suite-dependency-item">
                        <input type="checkbox" name="dependencies" value="${item.id}" ${dependencySet.has(item.id) ? "checked" : ""}>
                        <span>${this.escapeHtml(item.title)}</span>
                    </label>
                `).join("");
            const task = editingTask || {
                id: "",
                title: "",
                description: "",
                status: "todo",
                priority: "medium",
                repeat: "none",
                startDate: presetDateTime || "",
                dueDate: presetDateTime || "",
                endDate: "",
                progress: 0,
                resource: "",
                tags: []
            };
            if (this.taskEditorDialog) {
                this.taskEditorDialog.destroy();
            }
            this.taskEditorDialog = new Dialog({
                title: task.id ? "编辑任务" : "新建任务",
                width: this.isMobile ? "96vw" : "760px",
                height: this.isMobile ? "90vh" : "84vh",
                content: `
                    <div class="task-suite-root task-suite-theme-${this.normalizeThemeMode(this.state.settings.themeMode)} task-suite-editor-shell">
                        <form data-form="task-editor-dialog" class="task-suite-card task-suite-editor-card">
                            <input type="hidden" name="taskId" value="${task.id}">
                            <div class="task-suite-grid task-suite-editor-grid">
                                <div class="task-suite-field">
                                    <label>标题</label>
                                    <input class="b3-text-field fn__block" name="title" required value="${this.escapeHtml(task.title)}">
                                </div>
                                <div class="task-suite-field">
                                    <label>状态</label>
                                    <select class="b3-select fn__block" name="status">
                                        ${STATUS_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === task.status ? "selected" : ""}>${this.getStatusIcon(item.value)} ${item.label}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="task-suite-field">
                                    <label>优先级</label>
                                    <select class="b3-select fn__block" name="priority">
                                        ${PRIORITY_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === task.priority ? "selected" : ""}>${item.label}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="task-suite-field">
                                    <label>计划开始时间</label>
                                    <input class="b3-text-field fn__block" type="datetime-local" name="startDate" value="${this.escapeHtml(this.formatDateTimeLocal(task.startDate))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>计划截止时间</label>
                                    <input class="b3-text-field fn__block" type="datetime-local" name="dueDate" value="${this.escapeHtml(this.formatDateTimeLocal(task.dueDate))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>实际完成时间</label>
                                    <input class="b3-text-field fn__block" type="datetime-local" name="endDate" value="${this.escapeHtml(this.formatDateTimeLocal(task.endDate))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>提醒时间</label>
                                    <input class="b3-text-field fn__block" type="datetime-local" name="reminderTime" value="${this.escapeHtml(this.formatDateTimeLocal(task.reminderTime))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>重复规则</label>
                                    <select class="b3-select fn__block" name="repeat">
                                        ${REPEAT_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === task.repeat ? "selected" : ""}>${item.label}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="task-suite-field">
                                    <label>进度(%)</label>
                                    <div class="task-suite-progress-slider-row">
                                        <input class="b3-slider fn__flex-1" name="progress" type="range" min="0" max="100" value="${Number(task.progress || 0)}">
                                        <span class="task-suite-progress-value" data-role="progress-value">${Number(task.progress || 0)}%</span>
                                    </div>
                                </div>
                                <div class="task-suite-field">
                                    <label>标签（逗号分隔）</label>
                                    <input class="b3-text-field fn__block" name="tags" value="${this.escapeHtml((task.tags || []).join(", "))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>依赖任务（可多选）</label>
                                    <div class="task-suite-dependency-picker">
                                        ${allDependencies || `<span class="task-suite-meta">暂无可依赖任务</span>`}
                                    </div>
                                </div>
                                <div class="task-suite-field">
                                    <label>描述</label>
                                    <textarea class="b3-text-field fn__block" name="description" rows="4">${this.escapeHtml(task.description || "")}</textarea>
                                </div>
                            </div>
                            <div class="fn__flex task-suite-editor-actions">
                                <button class="b3-button b3-button--outline" type="button" data-action="cancel-task-editor">取消</button>
                                <button class="b3-button b3-button--text" type="submit">${task.id ? "保存任务" : "创建任务"}</button>
                            </div>
                        </form>
                    </div>
                `
            });
            const dialogElement = this.taskEditorDialog.element;
            const editorShell = dialogElement.querySelector(".task-suite-editor-shell");
            if (editorShell) {
                editorShell.style.height = "100%";
                editorShell.style.overflowY = "auto";
                editorShell.style.overflowX = "hidden";
                editorShell.style.boxSizing = "border-box";
            }
            const form = dialogElement.querySelector("form[data-form='task-editor-dialog']");
            const cancelButton = dialogElement.querySelector("[data-action='cancel-task-editor']");
            if (cancelButton) {
                cancelButton.addEventListener("click", () => this.closeTaskEditorDialog());
            }
            if (form) {
                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    this.submitTaskForm(form);
                });
                const progressInput = form.querySelector("input[name='progress']");
                const progressValue = form.querySelector("[data-role='progress-value']");
                if (progressInput && progressValue) {
                    const updateProgressValue = () => {
                        progressValue.textContent = `${this.normalizeProgress(progressInput.value)}%`;
                    };
                    progressInput.addEventListener("input", updateProgressValue);
                    updateProgressValue();
                }
            }
            const originalDestroy = this.taskEditorDialog.destroy.bind(this.taskEditorDialog);
            this.taskEditorDialog.destroy = () => {
                this.taskEditorDialog = null;
                originalDestroy();
            };
        }

        closeTaskEditorDialog() {
            if (!this.taskEditorDialog) {
                return;
            }
            this.taskEditorDialog.destroy();
            this.taskEditorDialog = null;
        }

        openCalendarOccurrenceEditor(taskId, date) {
            const task = this.findTask(taskId);
            if (!task || !date) {
                return;
            }
            if (task.repeat === "none") {
                this.openTaskEditorDialog(task.id);
                return;
            }
            const status = this.getOccurrenceStatus(task, date);
            const note = this.getOccurrenceNote(task, date);
            if (this.occurrenceEditorDialog) {
                this.occurrenceEditorDialog.destroy();
            }
            this.occurrenceEditorDialog = new Dialog({
                title: `实例编辑 · ${task.title}`,
                width: this.isMobile ? "92vw" : "520px",
                height: this.isMobile ? "72vh" : "440px",
                content: `
                    <div class="task-suite-root task-suite-theme-${this.normalizeThemeMode(this.state.settings.themeMode)} task-suite-editor-shell">
                        <form data-form="occurrence-editor-dialog" class="task-suite-card task-suite-editor-card">
                            <input type="hidden" name="taskId" value="${task.id}">
                            <input type="hidden" name="date" value="${date}">
                            <div class="task-suite-grid task-suite-editor-grid">
                                <div class="task-suite-field">
                                    <label>任务</label>
                                    <div class="task-suite-meta">${this.escapeHtml(task.title)}</div>
                                </div>
                                <div class="task-suite-field">
                                    <label>实例日期</label>
                                    <div class="task-suite-meta">${date}</div>
                                </div>
                                <div class="task-suite-field">
                                    <label>实例状态</label>
                                    <select class="b3-select fn__block" name="status">
                                        ${STATUS_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === status ? "selected" : ""}>${item.label}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="task-suite-field">
                                    <label>实例备注</label>
                                    <textarea class="b3-text-field fn__block" name="note" rows="5" placeholder="该条重复任务在 ${date} 的专属备注">${this.escapeHtml(note)}</textarea>
                                </div>
                            </div>
                            <div class="fn__flex task-suite-editor-actions">
                                <button class="b3-button b3-button--outline" type="button" data-action="open-master-task-from-occurrence">编辑任务主信息</button>
                                <button class="b3-button b3-button--outline" type="button" data-action="cancel-occurrence-editor">取消</button>
                                <button class="b3-button b3-button--text" type="submit">保存实例</button>
                            </div>
                        </form>
                    </div>
                `
            });
            const dialogElement = this.occurrenceEditorDialog.element;
            const form = dialogElement.querySelector("form[data-form='occurrence-editor-dialog']");
            const cancelButton = dialogElement.querySelector("[data-action='cancel-occurrence-editor']");
            const openMasterButton = dialogElement.querySelector("[data-action='open-master-task-from-occurrence']");
            if (cancelButton) {
                cancelButton.addEventListener("click", () => this.closeOccurrenceEditorDialog());
            }
            if (openMasterButton) {
                openMasterButton.addEventListener("click", () => {
                    this.closeOccurrenceEditorDialog();
                    this.openTaskEditorDialog(task.id);
                });
            }
            if (form) {
                form.addEventListener("submit", (event) => {
                    event.preventDefault();
                    this.submitOccurrenceForm(form);
                });
            }
            const originalDestroy = this.occurrenceEditorDialog.destroy.bind(this.occurrenceEditorDialog);
            this.occurrenceEditorDialog.destroy = () => {
                this.occurrenceEditorDialog = null;
                originalDestroy();
            };
        }

        closeOccurrenceEditorDialog() {
            if (!this.occurrenceEditorDialog) {
                return;
            }
            this.occurrenceEditorDialog.destroy();
            this.occurrenceEditorDialog = null;
        }

        submitOccurrenceForm(form) {
            const formData = new FormData(form);
            const taskId = (formData.get("taskId") || "").toString();
            const date = (formData.get("date") || "").toString();
            const status = this.normalizeStatus((formData.get("status") || "").toString());
            const note = (formData.get("note") || "").toString().trim();
            const task = this.findTask(taskId);
            if (!task || !date) {
                this.closeOccurrenceEditorDialog();
                return;
            }
            const statusKey = this.getOccurrenceKey(task.id, date);
            if (status === this.normalizeStatus(task.status)) {
                delete this.state.occurrenceStatuses[statusKey];
            } else {
                this.state.occurrenceStatuses[statusKey] = status;
            }
            if (note) {
                this.state.occurrenceNotes[statusKey] = note;
            } else {
                delete this.state.occurrenceNotes[statusKey];
            }
            task.updatedAt = new Date().toISOString();
            this.pushHistory(task.id, "实例编辑", `${date} 的任务实例已更新`);
            this.commitAndRender();
            this.closeOccurrenceEditorDialog();
        }

        submitTaskForm(form) {
            const formData = new FormData(form);
            const taskId = (formData.get("taskId") || "").toString();
            const title = (formData.get("title") || "").toString().trim();
            if (!title) {
                showMessage("任务标题不能为空", 2000, "error");
                return;
            }
            const dependencies = Array.from(form.querySelectorAll("input[name='dependencies']:checked"))
                .map((input) => input.value)
                .filter((id) => id && id !== taskId);
            const payload = {
                title,
                description: (formData.get("description") || "").toString().trim(),
                status: this.normalizeStatus((formData.get("status") || "").toString()),
                priority: this.normalizePriority((formData.get("priority") || "").toString()),
                repeat: this.normalizeRepeat((formData.get("repeat") || "").toString()),
                startDate: this.normalizeDateTimeInput((formData.get("startDate") || "").toString()),
                dueDate: this.normalizeDateTimeInput((formData.get("dueDate") || "").toString()),
                endDate: this.normalizeDateTimeInput((formData.get("endDate") || "").toString()),
                reminderTime: this.normalizeDateTimeInput((formData.get("reminderTime") || "").toString()),
                progress: this.normalizeProgress((formData.get("progress") || "").toString()),
                resource: "",
                tags: (formData.get("tags") || "").toString().split(",").map((tag) => tag.trim()).filter(Boolean),
                dependencies
            };
            if (taskId) {
                this.updateTask(taskId, payload, "任务编辑");
            } else {
                this.createTask(payload);
            }
            this.closeTaskEditorDialog();
        }

        createTask(payload) {
            const now = new Date().toISOString();
            const task = {
                id: this.makeId("task"),
                title: payload.title,
                description: payload.description || "",
                status: payload.status || "todo",
                priority: payload.priority || "medium",
                tags: payload.tags || [],
                repeat: payload.repeat || "none",
                startDate: payload.startDate || "",
                dueDate: payload.dueDate || "",
                endDate: payload.endDate || "",
                reminderTime: payload.reminderTime || "",
                progress: this.normalizeProgress(payload.progress),
                resource: payload.resource || "",
                dependencies: payload.dependencies || [],
                subtasks: [],
                createdAt: now,
                updatedAt: now
            };
            this.state.tasks.unshift(task);
            this.pushHistory(task.id, "任务创建", `创建任务「${task.title}」`);
            this.commitAndRender();
        }

        updateTask(taskId, patch, historyType) {
            const task = this.findTask(taskId);
            if (!task) {
                return;
            }
            const beforeSnapshot = {
                status: task.status,
                priority: task.priority,
                progress: task.progress,
                dueDate: task.dueDate,
                startDate: task.startDate,
                endDate: task.endDate
            };
            Object.assign(task, patch);
            task.progress = this.normalizeProgress(task.progress);
            task.updatedAt = new Date().toISOString();
            this.pushHistory(task.id, historyType || "任务更新", this.describeTaskDiff(task, beforeSnapshot));
            this.commitAndRender();
        }

        deleteTask(taskId) {
            const task = this.findTask(taskId);
            if (!task) {
                return;
            }
            this.state.tasks = this.state.tasks.filter((item) => item.id !== taskId);
            this.removeTaskOccurrenceStatus(taskId);
            this.state.tasks.forEach((item) => {
                item.dependencies = item.dependencies.filter((id) => id !== taskId);
            });
            this.pushHistory(taskId, "任务删除", `删除任务「${task.title}」`);
            this.commitAndRender();
        }

        describeTaskDiff(task, before) {
            const changes = [];
            if (before.status !== task.status) {
                changes.push(`状态 ${this.getStatusLabel(before.status)}→${this.getStatusLabel(task.status)}`);
            }
            if (before.priority !== task.priority) {
                changes.push(`优先级 ${this.getPriorityLabel(before.priority)}→${this.getPriorityLabel(task.priority)}`);
            }
            if (before.progress !== task.progress) {
                changes.push(`进度 ${before.progress}%→${task.progress}%`);
            }
            if (before.startDate !== task.startDate || before.dueDate !== task.dueDate || before.endDate !== task.endDate) {
                changes.push("时间计划已调整");
            }
            if (!changes.length) {
                changes.push("任务详情已更新");
            }
            return `任务「${task.title}」${changes.join("，")}`;
        }

        pushHistory(taskId, type, detail) {
            this.state.history.unshift({
                id: this.makeId("history"),
                taskId,
                type,
                detail,
                time: new Date().toISOString()
            });
            if (this.state.history.length > 2000) {
                this.state.history = this.state.history.slice(0, 2000);
            }
        }

        async commitAndRender() {
            await this.saveState();
            this.renderApp();
        }

        recomputeTaskProgress(task) {
            if (!task.subtasks.length) {
                return;
            }
            const doneCount = task.subtasks.filter((item) => item.done).length;
            task.progress = this.normalizeProgress((doneCount / task.subtasks.length) * 100);
            if (task.progress === 100 && task.status !== "done") {
                task.status = "done";
            }
        }

        getTimelineEntries() {
            const historyEntries = this.state.history.map((item) => {
                const task = this.findTask(item.taskId);
                return {
                    time: item.time,
                    title: `${item.type}${task ? ` · ${task.title}` : ""}`,
                    content: item.detail,
                    sortWeight: 1
                };
            });
            const planEntries = this.state.tasks.flatMap((task) => {
                const entries = [];
                if (task.startDate) {
                    const startDate = this.parseDate(task.startDate);
                    entries.push({
                        time: startDate ? startDate.toISOString() : new Date().toISOString(),
                        title: `计划开始 · ${task.title}`,
                        content: `任务计划开始，状态：${this.getStatusLabel(task.status)}`,
                        sortWeight: 2
                    });
                }
                if (task.dueDate) {
                    const dueDate = this.parseDate(task.dueDate);
                    entries.push({
                        time: dueDate ? dueDate.toISOString() : new Date().toISOString(),
                        title: `计划截止 · ${task.title}`,
                        content: `目标截止日期，优先级：${this.getPriorityLabel(task.priority)}`,
                        sortWeight: 2
                    });
                }
                if (task.repeat !== "none") {
                    const future = this.getTaskOccurrences(task, this.shiftDateString(this.formatDate(new Date()), -1), this.shiftDateString(this.formatDate(new Date()), 60));
                    future.slice(0, 8).forEach((date) => {
                        const dateTime = this.getCalendarTaskDateTime(task, date);
                        entries.push({
                            time: dateTime ? dateTime.toISOString() : new Date(`${date}T00:00:00`).toISOString(),
                            title: `重复计划 · ${task.title}`,
                            content: `${this.getRepeatLabel(task.repeat)}任务将在 ${date} 触发`,
                            sortWeight: 3
                        });
                    });
                }
                return entries;
            });
            return [...historyEntries, ...planEntries]
                .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime() || b.sortWeight - a.sortWeight);
        }

        inTimelineRange(time) {
            const date = this.formatDate(new Date(time));
            if (this.ui.timelineStart && date < this.ui.timelineStart) {
                return false;
            }
            if (this.ui.timelineEnd && date > this.ui.timelineEnd) {
                return false;
            }
            return true;
        }

        getCalendarRange(mode, cursorDate) {
            if (mode === "day") {
                const day = this.formatDate(cursorDate);
                return {
                    start: day,
                    end: day,
                    days: [{
                        date: day,
                        label: day,
                        dimmed: false
                    }]
                };
            }
            if (mode === "week") {
                const startDate = this.startOfWeek(cursorDate);
                const days = [];
                for (let i = 0; i < 7; i += 1) {
                    const current = this.addDays(startDate, i);
                    const date = this.formatDate(current);
                    days.push({
                        date,
                        label: `${current.getDate()}`,
                        dimmed: false
                    });
                }
                return {
                    start: this.formatDate(startDate),
                    end: this.formatDate(this.addDays(startDate, 6)),
                    days
                };
            }
            const firstDay = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
            const gridStart = this.startOfWeek(firstDay);
            const days = [];
            for (let i = 0; i < 42; i += 1) {
                const current = this.addDays(gridStart, i);
                const date = this.formatDate(current);
                days.push({
                    date,
                    label: `${current.getDate()}`,
                    dimmed: current.getMonth() !== cursorDate.getMonth()
                });
            }
            return {
                start: days[0].date,
                end: days[days.length - 1].date,
                days
            };
        }

        shiftCalendar(step) {
            const current = this.parseDate(this.ui.calendarCursor) || new Date();
            if (this.ui.calendarMode === "day") {
                this.ui.calendarCursor = this.formatDate(this.addDays(current, step));
            } else if (this.ui.calendarMode === "week") {
                this.ui.calendarCursor = this.formatDate(this.addDays(current, step * 7));
            } else {
                const next = new Date(current.getFullYear(), current.getMonth() + step, current.getDate());
                this.ui.calendarCursor = this.formatDate(next);
            }
            this.renderApp();
        }

        getOccurrencesForRange(startDateString, endDateString) {
            const result = [];
            this.state.tasks.forEach((task) => {
                const dates = this.getTaskCalendarDates(task, startDateString, endDateString);
                dates.forEach((date) => {
                    result.push({
                        date,
                        task
                    });
                });
            });
            return result.sort((a, b) => a.date.localeCompare(b.date));
        }

        getTaskCalendarDates(task, startDateString, endDateString) {
            return this.getTaskOccurrences(task, startDateString, endDateString);
        }

        getTaskSpanDates(task, startDateString, endDateString) {
            if (this.normalizeRepeat(task.repeat) !== "none") {
                return [];
            }
            const startDateRaw = this.toDateOnly(task.startDate);
            const dueDateRaw = this.toDateOnly(task.dueDate);
            if (!startDateRaw || !dueDateRaw) {
                return [];
            }
            const taskStart = this.parseDate(startDateRaw);
            const taskDue = this.parseDate(dueDateRaw);
            const rangeStart = this.parseDate(startDateString);
            const rangeEnd = this.parseDate(endDateString);
            if (!taskStart || !taskDue || !rangeStart || !rangeEnd) {
                return [];
            }
            const start = taskStart <= taskDue ? taskStart : taskDue;
            const end = taskStart <= taskDue ? taskDue : taskStart;
            if (end < rangeStart || start > rangeEnd) {
                return [];
            }
            const cursor = start < rangeStart ? new Date(rangeStart) : new Date(start);
            const limit = end > rangeEnd ? new Date(rangeEnd) : new Date(end);
            const result = [];
            while (cursor <= limit) {
                result.push(this.formatDate(cursor));
                cursor.setDate(cursor.getDate() + 1);
            }
            return result;
        }

        getTaskOccurrences(task, startDateString, endDateString) {
            const rangeStart = this.parseDate(startDateString);
            const rangeEnd = this.parseDate(endDateString);
            const repeat = this.normalizeRepeat(task.repeat);
            const startRaw = this.toDateOnly(task.startDate) || this.toDateOnly(task.dueDate) || this.formatDate(new Date(task.createdAt));
            const dueRaw = this.toDateOnly(task.dueDate) || this.toDateOnly(task.startDate) || startRaw;
            const startDate = this.parseDate(startRaw);
            const dueDate = this.parseDate(dueRaw);
            if (!rangeStart || !rangeEnd || !startDate || !dueDate) {
                return [];
            }
            const windowStart = startDate <= dueDate ? startDate : dueDate;
            const windowEnd = startDate <= dueDate ? dueDate : startDate;
            const result = [];
            if (repeat === "none") {
                const day = this.formatDate(windowStart);
                if (day >= startDateString && day <= endDateString) {
                    result.push(day);
                }
                return result;
            }
            let current = new Date(windowStart);
            const hardLimit = 520;
            let iterations = 0;
            while (current <= windowEnd && iterations < hardLimit) {
                iterations += 1;
                const dateString = this.formatDate(current);
                if (dateString >= startDateString && dateString <= endDateString) {
                    result.push(dateString);
                }
                if (repeat === "daily") {
                    current = this.addDays(current, 1);
                } else if (repeat === "weekly") {
                    current = this.addDays(current, 7);
                } else if (repeat === "monthly") {
                    current = new Date(current.getFullYear(), current.getMonth() + 1, current.getDate());
                } else {
                    break;
                }
            }
            return result;
        }

        getGanttTasks() {
            return this.state.tasks
                .map((task) => {
                    const planStart = this.toDateOnly(task.startDate) || this.toDateOnly(task.dueDate) || this.formatDate(new Date(task.createdAt));
                    const planEnd = this.toDateOnly(task.endDate) || this.toDateOnly(task.dueDate) || this.toDateOnly(task.startDate) || this.formatDate(new Date(task.createdAt));
                    if (!planStart || !planEnd) {
                        return null;
                    }
                    const startDate = this.parseDate(planStart);
                    const endDate = this.parseDate(planEnd);
                    if (!startDate || !endDate) {
                        return null;
                    }
                    if (startDate > endDate) {
                        return {
                            ...task,
                            planStart: planEnd,
                            planEnd: planStart
                        };
                    }
                    return {
                        ...task,
                        planStart,
                        planEnd
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.planStart.localeCompare(b.planStart));
        }

        getGanttRange(tasks) {
            const minDate = tasks.reduce((min, task) => {
                const d = this.parseDate(task.planStart);
                return d < min ? d : min;
            }, this.parseDate(tasks[0].planStart));
            const maxDate = tasks.reduce((max, task) => {
                const d = this.parseDate(task.planEnd);
                return d > max ? d : max;
            }, this.parseDate(tasks[0].planEnd));
            const customStart = this.parseDate(this.ui.ganttStart);
            const customEnd = this.parseDate(this.ui.ganttEnd);
            const startDate = customStart || minDate;
            const endDate = customEnd || maxDate;
            if (startDate <= endDate) {
                return { startDate, endDate };
            }
            return { startDate: endDate, endDate: startDate };
        }

        applyGanttQuickRange(rangeValue) {
            const now = new Date();
            const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            let start = dayStart;
            let end = this.addDays(dayStart, 30);
            if (rangeValue === "today") {
                start = dayStart;
                end = dayStart;
            } else if (rangeValue === "week") {
                start = this.startOfWeek(dayStart);
                end = this.addDays(start, 6);
            } else if (rangeValue === "month") {
                start = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
                end = new Date(dayStart.getFullYear(), dayStart.getMonth() + 1, 0);
            } else if (rangeValue === "90d") {
                end = this.addDays(dayStart, 90);
            } else {
                end = this.addDays(dayStart, 30);
            }
            this.ui.ganttStart = this.formatDate(start);
            this.ui.ganttEnd = this.formatDate(end);
            this.renderApp();
        }

        getCriticalPathSet(tasks) {
            const byId = new Map(tasks.map((task) => [task.id, task]));
            const memo = new Map();
            const visiting = new Set();
            const visit = (id) => {
                if (memo.has(id)) {
                    return memo.get(id);
                }
                if (visiting.has(id)) {
                    return { score: 0, chain: [] };
                }
                visiting.add(id);
                const task = byId.get(id);
                if (!task) {
                    visiting.delete(id);
                    return { score: 0, chain: [] };
                }
                const base = Math.max(1, this.diffDays(this.parseDate(task.planStart), this.parseDate(task.planEnd)) + 1);
                let best = { score: base, chain: [id] };
                task.dependencies.forEach((depId) => {
                    const previous = visit(depId);
                    const merged = { score: previous.score + base, chain: [...previous.chain, id] };
                    if (merged.score > best.score) {
                        best = merged;
                    }
                });
                visiting.delete(id);
                memo.set(id, best);
                return best;
            };
            let longest = { score: 0, chain: [] };
            tasks.forEach((task) => {
                const candidate = visit(task.id);
                if (candidate.score > longest.score) {
                    longest = candidate;
                }
            });
            return new Set(longest.chain);
        }

        getResourceOverview(tasks) {
            const map = new Map();
            tasks.forEach((task) => {
                const key = task.resource || "未分配";
                if (!map.has(key)) {
                    map.set(key, {
                        name: key,
                        taskCount: 0,
                        totalProgress: 0
                    });
                }
                const item = map.get(key);
                item.taskCount += 1;
                item.totalProgress += this.normalizeProgress(task.progress);
            });
            const maxTask = Math.max(1, ...Array.from(map.values()).map((item) => item.taskCount));
            return Array.from(map.values()).map((item) => ({
                name: item.name,
                taskCount: item.taskCount,
                avgProgress: Math.round(item.totalProgress / item.taskCount),
                loadPercent: Math.round((item.taskCount / maxTask) * 100)
            }));
        }

        findTask(taskId) {
            return this.state.tasks.find((task) => task.id === taskId);
        }

        getClosestFromEvent(event, selector) {
            if (!event || !selector) {
                return null;
            }
            if (typeof event.composedPath === "function") {
                const path = event.composedPath();
                for (const node of path) {
                    if (node && typeof node.matches === "function" && node.matches(selector)) {
                        return node;
                    }
                }
            }
            const target = event.target;
            if (target && typeof target.closest === "function") {
                return target.closest(selector);
            }
            if (target && target.parentElement && typeof target.parentElement.closest === "function") {
                return target.parentElement.closest(selector);
            }
            return null;
        }

        clearKanbanDragOver() {
            if (!this.dragOverColumnBody) {
                return;
            }
            this.dragOverColumnBody.classList.remove("drag-over");
            this.dragOverColumnBody = null;
        }

        flashKanbanDropSuccess(taskId) {
            if (!taskId) {
                return;
            }
            this.ui.kanbanDropTaskId = taskId;
            if (this.dragFeedbackTimer) {
                clearTimeout(this.dragFeedbackTimer);
            }
            this.dragFeedbackTimer = setTimeout(() => {
                this.ui.kanbanDropTaskId = "";
                this.dragFeedbackTimer = null;
                if (this.ui.activeTab === "kanban") {
                    this.renderApp();
                }
            }, 900);
        }

        getStatusLabel(status) {
            return STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
        }

        getStatusIcon(status) {
            const normalized = this.normalizeStatus(status);
            if (normalized === "todo") {
                return "○";
            }
            if (normalized === "in_progress") {
                return "◔";
            }
            if (normalized === "done") {
                return "✓";
            }
            return "⛔";
        }

        getPriorityLabel(priority) {
            return PRIORITY_OPTIONS.find((item) => item.value === priority)?.label || priority;
        }

        getRepeatLabel(repeat) {
            return REPEAT_OPTIONS.find((item) => item.value === repeat)?.label || repeat;
        }

        getPriorityClass(priority) {
            return `priority-${this.normalizePriority(priority)}`;
        }

        getColumnClassByStatus(status) {
            const normalized = this.normalizeStatus(status);
            if (normalized === "in_progress") {
                return "task-suite-column--in-progress";
            }
            return `task-suite-column--${normalized}`;
        }

        getColumnHeaderClassByStatus(status) {
            const normalized = this.normalizeStatus(status);
            if (normalized === "in_progress") {
                return "task-suite-column-header--in-progress";
            }
            return `task-suite-column-header--${normalized}`;
        }

        getCalendarTaskTimeLabel(task, day) {
            const dateTime = this.getCalendarTaskDateTime(task, day);
            if (dateTime) {
                return `${`${dateTime.getHours()}`.padStart(2, "0")}:${`${dateTime.getMinutes()}`.padStart(2, "0")}`;
            }
            return "";
        }

        getCalendarTaskDateTime(task, day) {
            const due = this.parseDate(task.dueDate);
            const start = this.parseDate(task.startDate);
            if (task.repeat !== "none") {
                const base = start || due;
                if (base) {
                    const hh = `${base.getHours()}`.padStart(2, "0");
                    const mm = `${base.getMinutes()}`.padStart(2, "0");
                    return this.parseDate(`${day}T${hh}:${mm}`);
                }
            }
            if (due && this.toDateOnly(task.dueDate) === day) {
                return due;
            }
            if (start && this.toDateOnly(task.startDate) === day) {
                return start;
            }
            return null;
        }

        renderCalendarDayTimeline(day, tasks) {
            const groups = new Map();
            tasks.forEach((item) => {
                const dateTime = this.getCalendarTaskDateTime(item.task, day);
                const hour = dateTime ? dateTime.getHours() : 0;
                const safeHour = Math.max(0, Math.min(24, hour));
                if (!groups.has(safeHour)) {
                    groups.set(safeHour, []);
                }
                groups.get(safeHour).push(item);
            });
            const rows = Array.from(groups.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([hour, hourTasks]) => `
                    <div class="task-suite-day-hour-row">
                        <div class="task-suite-day-hour-label">${`${hour}`.padStart(2, "0")}:00</div>
                        <div class="task-suite-day-hour-content">
                            ${hourTasks.map((item) => {
                                const occurrenceStatus = this.getOccurrenceStatus(item.task, day);
                                const statusClass = this.getStatusClass(occurrenceStatus);
                                const note = this.getOccurrenceNote(item.task, day);
                                const noteBadge = note ? `<span class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger" tabindex="0" aria-label="${this.escapeHtml(note)}">备注</span>` : "";
                                const repeatBadge = item.task.repeat !== "none" ? `<span class="task-suite-calendar-repeat-badge" title="重复规则：${this.getRepeatLabel(item.task.repeat)}">${this.getRepeatLabel(item.task.repeat)}</span>` : "";
                                return `
                                    <div class="task-suite-day-event ${this.getPriorityClass(item.task.priority)} ${statusClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day}">
                                        <span class="task-suite-calendar-status ${statusClass}" title="${this.getStatusLabel(occurrenceStatus)}">${this.getStatusLabel(occurrenceStatus)}</span>
                                        <span class="task-suite-day-event-title">${this.getCalendarTaskTimeLabel(item.task, day) ? `${this.getCalendarTaskTimeLabel(item.task, day)} ` : ""}${this.escapeHtml(item.task.title)}</span>
                                        ${repeatBadge}
                                        ${noteBadge}
                                        <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day}">↻</button>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                `);
            return `<div class="task-suite-day-timeline">${rows.join("")}</div>`;
        }

        getLunarLabel(dateString) {
            const date = this.parseDate(dateString);
            if (!date) {
                return "";
            }
            try {
                const raw = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
                    day: "numeric"
                }).format(date);
                const normalized = raw
                    .replace(/\s+/g, "")
                    .replace(/(初|闰|日)/g, "");
                const numericMatch = normalized.match(/\d+/);
                if (numericMatch) {
                    return this.toChineseDayText(Number(numericMatch[0]));
                }
                return normalized;
            } catch (error) {
                return "";
            }
        }

        toChineseDayText(value) {
            const number = Number(value);
            if (!Number.isFinite(number) || number <= 0) {
                return "";
            }
            const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
            if (number <= 10) {
                return number === 10 ? "十" : digits[number];
            }
            if (number < 20) {
                return `十${digits[number - 10]}`;
            }
            if (number < 30) {
                return `二十${digits[number - 20]}`;
            }
            if (number === 30) {
                return "三十";
            }
            if (number === 31) {
                return "三十一";
            }
            return `${number}`;
        }

        getWeekNumber(dateValue) {
            const date = this.parseDate(dateValue);
            if (!date) {
                return 1;
            }
            const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const day = current.getDay() || 7;
            current.setDate(current.getDate() + 4 - day);
            const yearStart = new Date(current.getFullYear(), 0, 1);
            const dayIndex = Math.floor((current.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000));
            return Math.floor(dayIndex / 7) + 1;
        }

        getStatusClass(status) {
            const normalized = this.normalizeStatus(status);
            if (normalized === "in_progress") {
                return "status-in-progress";
            }
            return `status-${normalized}`;
        }

        getOccurrenceKey(taskId, date) {
            return `${taskId}::${date}`;
        }

        getOccurrenceStatus(task, date) {
            if (!task || !task.id || !date) {
                return "todo";
            }
            const key = this.getOccurrenceKey(task.id, date);
            const value = this.state.occurrenceStatuses[key];
            if (value) {
                return this.normalizeStatus(value);
            }
            return this.normalizeStatus(task.status);
        }

        getOccurrenceNote(task, date) {
            if (!task || !task.id || !date) {
                return "";
            }
            const key = this.getOccurrenceKey(task.id, date);
            return String(this.state.occurrenceNotes[key] || "").trim();
        }

        getOccurrenceNotePreview(task, date) {
            const note = this.getOccurrenceNote(task, date);
            if (!note) {
                return "";
            }
            if (note.length <= 16) {
                return note;
            }
            return `${note.slice(0, 16)}…`;
        }

        getTaskOccurrenceNoteCount(taskId) {
            if (!taskId) {
                return 0;
            }
            const prefix = `${taskId}::`;
            return Object.keys(this.state.occurrenceNotes).filter((key) => key.startsWith(prefix)).length;
        }

        getTaskRepeatTimeLabel(task) {
            const start = this.parseDate(task.startDate);
            const due = this.parseDate(task.dueDate);
            const base = start || due;
            if (!base) {
                return "00:00";
            }
            return `${`${base.getHours()}`.padStart(2, "0")}:${`${base.getMinutes()}`.padStart(2, "0")}`;
        }

        cycleCalendarOccurrenceStatus(taskId, date) {
            const task = this.findTask(taskId);
            if (!task || !date) {
                return;
            }
            const statusQueue = STATUS_OPTIONS.map((item) => item.value);
            const current = this.getOccurrenceStatus(task, date);
            const currentIndex = statusQueue.indexOf(current);
            const next = statusQueue[(currentIndex + 1) % statusQueue.length];
            if (task.repeat === "none") {
                this.updateTask(task.id, { status: next }, "日历状态更新");
                return;
            }
            const key = this.getOccurrenceKey(task.id, date);
            if (next === this.normalizeStatus(task.status)) {
                delete this.state.occurrenceStatuses[key];
            } else {
                this.state.occurrenceStatuses[key] = next;
            }
            this.pushHistory(task.id, "实例状态更新", `${date} 的任务实例状态更新为 ${this.getStatusLabel(next)}`);
            this.commitAndRender();
        }

        removeTaskOccurrenceStatus(taskId) {
            const prefix = `${taskId}::`;
            Object.keys(this.state.occurrenceStatuses).forEach((key) => {
                if (key.startsWith(prefix)) {
                    delete this.state.occurrenceStatuses[key];
                }
            });
            Object.keys(this.state.occurrenceNotes).forEach((key) => {
                if (key.startsWith(prefix)) {
                    delete this.state.occurrenceNotes[key];
                }
            });
            Object.keys(this.state.reminderFired).forEach((key) => {
                if (key.startsWith(prefix)) {
                    delete this.state.reminderFired[key];
                }
            });
        }

        startReminderLoop() {
            if (this.reminderTimer) {
                clearInterval(this.reminderTimer);
            }
            this.checkDueReminders();
            this.reminderTimer = setInterval(() => this.checkDueReminders(), 30000);
        }

        async checkDueReminders() {
            const now = Date.now();
            let changed = false;
            for (const task of this.state.tasks) {
                if (!task.reminderTime || this.normalizeStatus(task.status) === "done") {
                    continue;
                }
                const reminderDate = this.parseDate(task.reminderTime);
                if (!reminderDate) {
                    continue;
                }
                const key = `${task.id}::${task.reminderTime}`;
                if (this.state.reminderFired[key]) {
                    continue;
                }
                if (reminderDate.getTime() > now) {
                    continue;
                }
                await this.pushReminder(task);
                this.state.reminderFired[key] = new Date().toISOString();
                changed = true;
            }
            if (changed) {
                await this.saveState();
            }
        }

        async pushReminder(task) {
            const message = `任务提醒：${task.title}`;
            showMessage(message, 6000);
            try {
                await fetch("/api/notification/pushMsg", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        msg: message,
                        timeout: 7000
                    })
                });
            } catch (error) {
            }
        }

        makeId(prefix) {
            return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        parseDate(value) {
            if (!value) {
                return null;
            }
            if (value instanceof Date) {
                return Number.isNaN(value.getTime()) ? null : value;
            }
            const normalized = String(value).trim();
            const date = normalized.includes("T")
                ? new Date(normalized)
                : new Date(`${normalized}T00:00:00`);
            if (Number.isNaN(date.getTime())) {
                return null;
            }
            return date;
        }

        formatDate(date) {
            const y = date.getFullYear();
            const m = `${date.getMonth() + 1}`.padStart(2, "0");
            const d = `${date.getDate()}`.padStart(2, "0");
            return `${y}-${m}-${d}`;
        }

        formatDateTimeLocal(value) {
            if (!value) {
                return "";
            }
            const date = this.parseDate(value);
            if (!date) {
                return "";
            }
            const y = date.getFullYear();
            const m = `${date.getMonth() + 1}`.padStart(2, "0");
            const d = `${date.getDate()}`.padStart(2, "0");
            const hh = `${date.getHours()}`.padStart(2, "0");
            const mm = `${date.getMinutes()}`.padStart(2, "0");
            return `${y}-${m}-${d}T${hh}:${mm}`;
        }

        normalizeDateTimeInput(value) {
            const normalized = String(value || "").trim();
            if (!normalized) {
                return "";
            }
            const date = this.parseDate(normalized);
            if (!date) {
                return "";
            }
            return this.formatDateTimeLocal(date);
        }

        toDateOnly(value) {
            if (!value) {
                return "";
            }
            const raw = String(value).trim();
            if (raw.length >= 10) {
                return raw.slice(0, 10);
            }
            return "";
        }

        addDays(date, days) {
            const result = new Date(date);
            result.setDate(result.getDate() + days);
            return result;
        }

        startOfWeek(date) {
            const result = new Date(date);
            const day = result.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            result.setDate(result.getDate() + diff);
            return new Date(result.getFullYear(), result.getMonth(), result.getDate());
        }

        diffDays(startDate, endDate) {
            const ms = 24 * 60 * 60 * 1000;
            const a = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
            const b = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
            return Math.round((b - a) / ms);
        }

        shiftDateString(dateString, days) {
            const date = this.parseDate(dateString);
            if (!date) {
                return dateString;
            }
            return this.formatDate(this.addDays(date, days));
        }

        runSelfTest() {
            const selfTestTask = {
                id: "self-test",
                title: "self-test",
                repeat: "weekly",
                dueDate: "2026-03-31T18:00",
                startDate: "2026-03-02T09:00",
                createdAt: "2026-03-01T00:00:00.000Z"
            };
            const weeklyDates = this.getTaskCalendarDates(selfTestTask, "2026-03-01", "2026-03-20");
            const expectedWeeklyDates = ["2026-03-02", "2026-03-09", "2026-03-16"];
            const monthlyDates = this.getTaskCalendarDates({
                ...selfTestTask,
                repeat: "monthly",
                startDate: "2026-01-15T09:00",
                dueDate: "2026-04-30T18:00"
            }, "2026-01-01", "2026-04-30");
            const expectedMonthlyDates = ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"];
            const checks = [];
            checks.push({
                name: "任务结构",
                pass: this.state.tasks.every((task) => task.id && task.title && Array.isArray(task.subtasks))
            });
            checks.push({
                name: "看板列结构",
                pass: this.state.boardColumns.every((column) => column.id && column.title && column.status)
            });
            checks.push({
                name: "重复任务计算",
                pass: expectedWeeklyDates.every((date) => weeklyDates.includes(date)) && expectedMonthlyDates.every((date) => monthlyDates.includes(date))
            });
            const failed = checks.filter((item) => !item.pass);
            if (!failed.length) {
                showMessage("插件自测通过：核心数据结构与重复任务逻辑正常");
            } else {
                showMessage(`插件自测失败：${failed.map((item) => item.name).join("、")}`, 4000, "error");
            }
        }

        escapeHtml(text) {
            return String(text || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }
    }

    return SiYuanTaskSuitePlugin;
}));
