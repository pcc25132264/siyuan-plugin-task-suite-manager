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
        { value: "list", label: "清单", icon: "iconList" },
        { value: "kanban", label: "看板", icon: "iconLayoutRight" },
        { value: "calendar", label: "日历", icon: "iconCalendar" },
        { value: "gantt", label: "甘特图", icon: "iconSort" },
        { value: "timeline", label: "时间轴", icon: "iconHistory" },
        { value: "settings", label: "设置", icon: "iconSettings" }
    ];

    class SiYuanTaskSuitePlugin extends Plugin {
        async onload() {
            const os = window?.siyuan?.config?.system?.os;
            this.isMobile = os === "ios" || os === "android" || !!document.getElementById("sidebar");
            this.storage = this.createStorageConfig();
            this.resetDirtyState();
            this.state = this.createDefaultState();
            this.ui = {
                activeTab: "list",
                timelineStart: "",
                timelineEnd: "",
                calendarMode: "month",
                calendarDayAxis: this.isMobile ? "vertical" : "horizontal",
                calendarCursor: this.formatDate(new Date()),
                ganttStart: "",
                ganttEnd: "",
                kanbanDropTaskId: ""
            };
            await this.loadState();
            this.normalizeState();
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
                    calendarMonthHeightDesktop: 80,
                    calendarMonthHeightMobile: 50,
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

        createStorageConfig() {
            return {
                metaSettings: "storage/meta/settings.json",
                indexActive: "storage/index/active.index.json",
                historyManifest: "storage/history/manifest.json",
                taskDir: "storage/tasks",
                occurrenceDir: "storage/occ",
                historyDir: "storage/history",
                historyPrefix: "events-"
            };
        }

        resetDirtyState() {
            this.dirty = {
                tasksUpsert: new Set(),
                tasksDelete: new Set(),
                occurrencesUpsert: new Set(),
                occurrencesDelete: new Set(),
                settings: false,
                historyEntries: []
            };
        }

        markTaskDirty(taskId) {
            if (!taskId) {
                return;
            }
            this.dirty.tasksDelete.delete(taskId);
            this.dirty.tasksUpsert.add(taskId);
        }

        markTaskDeleted(taskId) {
            if (!taskId) {
                return;
            }
            this.dirty.tasksUpsert.delete(taskId);
            this.dirty.tasksDelete.add(taskId);
        }

        markOccurrenceDirty(taskId) {
            if (!taskId) {
                return;
            }
            this.dirty.occurrencesDelete.delete(taskId);
            this.dirty.occurrencesUpsert.add(taskId);
        }

        markOccurrenceDeleted(taskId) {
            if (!taskId) {
                return;
            }
            this.dirty.occurrencesUpsert.delete(taskId);
            this.dirty.occurrencesDelete.add(taskId);
        }

        markSettingsDirty() {
            this.dirty.settings = true;
        }

        getTaskStoragePath(taskId) {
            return `${this.storage.taskDir}/${taskId}.json`;
        }

        getOccurrenceStoragePath(taskId) {
            return `${this.storage.occurrenceDir}/${taskId}.json`;
        }

        getHistoryStoragePath(monthKey) {
            return `${this.storage.historyDir}/${this.storage.historyPrefix}${monthKey}.json`;
        }

        getMonthKey(value) {
            const date = this.parseDate(value) || new Date();
            const year = date.getFullYear();
            const month = `${date.getMonth() + 1}`.padStart(2, "0");
            return `${year}-${month}`;
        }

        async safeLoadData(path, fallback) {
            try {
                const data = await this.loadData(path);
                if (data === undefined || data === null) {
                    return fallback;
                }
                return data;
            } catch (error) {
                return fallback;
            }
        }

        buildTaskIndex() {
            return {
                updatedAt: new Date().toISOString(),
                tasks: this.state.tasks.map((task) => ({
                    id: task.id,
                    title: task.title || "",
                    status: this.normalizeStatus(task.status),
                    priority: this.normalizePriority(task.priority),
                    repeat: this.normalizeRepeat(task.repeat),
                    progress: this.normalizeProgress(task.progress),
                    startDate: task.startDate || "",
                    dueDate: task.dueDate || "",
                    startTime: this.normalizeTimeInput(task.startTime || ""),
                    dueTime: this.normalizeTimeInput(task.dueTime || ""),
                    updatedAt: task.updatedAt || "",
                    createdAt: task.createdAt || ""
                }))
            };
        }

        extractTaskOccurrenceData(taskId) {
            const prefix = `${taskId}::`;
            const statuses = {};
            const notes = {};
            const reminders = {};
            Object.keys(this.state.occurrenceStatuses).forEach((key) => {
                if (key.startsWith(prefix)) {
                    statuses[key.slice(prefix.length)] = this.state.occurrenceStatuses[key];
                }
            });
            Object.keys(this.state.occurrenceNotes).forEach((key) => {
                if (key.startsWith(prefix)) {
                    notes[key.slice(prefix.length)] = this.state.occurrenceNotes[key];
                }
            });
            Object.keys(this.state.reminderFired).forEach((key) => {
                if (key.startsWith(prefix)) {
                    reminders[key.slice(prefix.length)] = this.state.reminderFired[key];
                }
            });
            return {
                taskId,
                statuses,
                notes,
                reminders,
                updatedAt: new Date().toISOString()
            };
        }

        applyTaskOccurrenceData(taskId, payload) {
            if (!taskId || !payload || typeof payload !== "object") {
                return;
            }
            const statuses = payload.statuses && typeof payload.statuses === "object" ? payload.statuses : {};
            const notes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
            const reminders = payload.reminders && typeof payload.reminders === "object" ? payload.reminders : {};
            Object.entries(statuses).forEach(([key, value]) => {
                this.state.occurrenceStatuses[`${taskId}::${key}`] = this.normalizeStatus(value);
            });
            Object.entries(notes).forEach(([key, value]) => {
                this.state.occurrenceNotes[`${taskId}::${key}`] = String(value || "");
            });
            Object.entries(reminders).forEach(([key, value]) => {
                this.state.reminderFired[`${taskId}::${key}`] = String(value || "");
            });
        }

        async loadHistoryFromStorage() {
            const manifest = await this.safeLoadData(this.storage.historyManifest, { months: [] });
            const months = Array.isArray(manifest?.months) ? manifest.months : [];
            const normalizedMonths = months
                .map((item) => String(item || ""))
                .filter(Boolean)
                .sort((a, b) => b.localeCompare(a));
            const history = [];
            for (const monthKey of normalizedMonths) {
                const path = this.getHistoryStoragePath(monthKey);
                const rows = await this.safeLoadData(path, []);
                if (!Array.isArray(rows)) {
                    continue;
                }
                rows.forEach((entry) => {
                    if (!entry || typeof entry !== "object") {
                        return;
                    }
                    history.push({
                        id: entry.id || this.makeId("history"),
                        taskId: entry.taskId || "",
                        type: entry.type || "记录",
                        detail: entry.detail || "",
                        time: entry.time || new Date().toISOString()
                    });
                });
                if (history.length >= 2000) {
                    break;
                }
            }
            history.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
            this.state.history = history.slice(0, 2000);
        }

        async loadState() {
            this.state = this.createDefaultState();
            const settings = await this.safeLoadData(this.storage.metaSettings, null);
            if (settings && typeof settings === "object") {
                this.state.settings = {
                    ...this.state.settings,
                    ...settings
                };
            }
            const indexData = await this.safeLoadData(this.storage.indexActive, { tasks: [] });
            const taskRows = Array.isArray(indexData?.tasks) ? indexData.tasks : [];
            const taskIds = taskRows
                .map((item) => String(item?.id || ""))
                .filter(Boolean);
            for (const taskId of taskIds) {
                const task = await this.safeLoadData(this.getTaskStoragePath(taskId), null);
                if (task && typeof task === "object") {
                    this.state.tasks.push(task);
                }
                const occurrence = await this.safeLoadData(this.getOccurrenceStoragePath(taskId), null);
                this.applyTaskOccurrenceData(taskId, occurrence);
            }
            await this.loadHistoryFromStorage();
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
            const legacyMonthHeight = this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeight, 80);
            this.state.settings.calendarMonthHeightDesktop = this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeightDesktop, legacyMonthHeight);
            this.state.settings.calendarMonthHeightMobile = this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeightMobile, 50);
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
                    startDate: this.normalizeDateInput(task.startDate || ""),
                    dueDate: this.normalizeDateInput(task.dueDate || ""),
                    startTime: this.normalizeTimeInput(task.startTime || ""),
                    dueTime: this.normalizeTimeInput(task.dueTime || ""),
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

        normalizeDateInput(value) {
            const normalized = this.toDateOnly(value);
            if (!normalized) {
                return "";
            }
            const date = this.parseDate(normalized);
            if (!date) {
                return "";
            }
            return this.formatDate(date);
        }

        normalizeTimeInput(value) {
            const normalized = String(value || "").trim();
            if (!normalized) {
                return "00:00";
            }
            if (normalized === "24:00") {
                return "24:00";
            }
            const matched = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
            if (!matched) {
                return "00:00";
            }
            const hour = Math.max(0, Math.min(24, Number(matched[1])));
            const minute = Math.max(0, Math.min(59, Number(matched[2])));
            if (hour === 24) {
                return "24:00";
            }
            return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
        }

        normalizeCalendarMonthHeight(value, fallback = 80) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return Math.max(30, Math.min(120, Math.round(parsed)));
            }
            return fallback;
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
            if (this.dirty.settings) {
                await this.saveData(this.storage.metaSettings, this.state.settings);
            }
            for (const taskId of this.dirty.tasksUpsert) {
                const task = this.findTask(taskId);
                if (task) {
                    await this.saveData(this.getTaskStoragePath(taskId), task);
                }
            }
            for (const taskId of this.dirty.tasksDelete) {
                await this.saveData(this.getTaskStoragePath(taskId), {
                    id: taskId,
                    deleted: true,
                    updatedAt: new Date().toISOString()
                });
            }
            for (const taskId of this.dirty.occurrencesUpsert) {
                await this.saveData(this.getOccurrenceStoragePath(taskId), this.extractTaskOccurrenceData(taskId));
            }
            for (const taskId of this.dirty.occurrencesDelete) {
                await this.saveData(this.getOccurrenceStoragePath(taskId), {
                    taskId,
                    statuses: {},
                    notes: {},
                    reminders: {},
                    deleted: true,
                    updatedAt: new Date().toISOString()
                });
            }
            await this.saveData(this.storage.indexActive, this.buildTaskIndex());
            if (this.dirty.historyEntries.length) {
                const manifest = await this.safeLoadData(this.storage.historyManifest, { months: [] });
                const monthSet = new Set(Array.isArray(manifest?.months) ? manifest.months : []);
                const grouped = new Map();
                this.dirty.historyEntries.forEach((entry) => {
                    const monthKey = this.getMonthKey(entry.time);
                    monthSet.add(monthKey);
                    if (!grouped.has(monthKey)) {
                        grouped.set(monthKey, []);
                    }
                    grouped.get(monthKey).push(entry);
                });
                for (const [monthKey, entries] of grouped.entries()) {
                    const path = this.getHistoryStoragePath(monthKey);
                    const existing = await this.safeLoadData(path, []);
                    const rowList = Array.isArray(existing) ? existing : [];
                    const merged = [...entries, ...rowList]
                        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
                        .slice(0, 5000);
                    await this.saveData(path, merged);
                }
                const sortedMonths = Array.from(monthSet)
                    .map((item) => String(item || ""))
                    .filter(Boolean)
                    .sort((a, b) => b.localeCompare(a));
                await this.saveData(this.storage.historyManifest, {
                    months: sortedMonths,
                    updatedAt: new Date().toISOString()
                });
            }
            this.resetDirtyState();
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
                    <div class="task-suite-toolbar">
                        <div class="layout-tab-bar fn__flex task-suite-tabs" data-role="tabs"></div>
                        <div class="task-suite-toolbar-actions">
                            <button class="b3-button b3-button--outline task-suite-toolbar-icon-btn" data-action="toggle-theme" title="${themeMode === "dark" ? "切换浅色主题" : "切换暗黑主题"}">${this.renderSiYuanIcon(themeMode === "dark" ? "iconLight" : "iconDark", "b3-button__icon task-suite-icon-svg")}</button>
                            <button class="b3-button b3-button--outline task-suite-toolbar-icon-btn" data-action="run-self-test" title="运行自测">${this.renderSiYuanIcon("iconCheck", "b3-button__icon task-suite-icon-svg")}</button>
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
                this.markTaskDirty(task.id);
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
                    this.markTaskDirty(task.id);
                    this.pushHistory(task.id, "子任务删除", "移除子任务");
                    this.commitAndRender();
                }
                return;
            }
            if (action === "new-task-on-date") {
                const date = target.dataset.date || this.formatDate(new Date());
                this.openTaskEditorDialog("", date);
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
                this.markSettingsDirty();
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
                this.markTaskDirty(task.id);
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
            if (target.dataset.filter === "calendar-day-axis") {
                this.ui.calendarDayAxis = this.normalizeCalendarDayAxis(target.value || "horizontal");
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "settings-calendar-month-height-desktop") {
                this.state.settings.calendarMonthHeightDesktop = this.normalizeCalendarMonthHeight(target.value, 80);
                this.markSettingsDirty();
                this.saveState();
                this.renderApp();
                return;
            }
            if (target.dataset.filter === "settings-calendar-month-height-mobile") {
                this.state.settings.calendarMonthHeightMobile = this.normalizeCalendarMonthHeight(target.value, 50);
                this.markSettingsDirty();
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
                    <span class="task-suite-tab-icon">${this.renderSiYuanIcon(tab.icon || "iconList", "task-suite-tab-icon-svg")}</span>
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
            } else if (this.ui.activeTab === "settings") {
                html = this.renderSettingsView();
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
                            <button class="b3-button b3-button--outline task-suite-icon-btn" data-action="quick-status" data-task-id="${task.id}" title="流转状态">${this.renderSiYuanIcon("iconRefresh", "b3-button__icon task-suite-icon-svg")}</button>
                            <button class="b3-button b3-button--outline task-suite-icon-btn" data-action="open-edit-task" data-task-id="${task.id}" title="编辑">${this.renderSiYuanIcon("iconEdit", "b3-button__icon task-suite-icon-svg")}</button>
                            <button class="b3-button b3-button--error task-suite-icon-btn" data-action="delete-task" data-task-id="${task.id}" title="删除">${this.renderSiYuanIcon("iconTrashcan", "b3-button__icon task-suite-icon-svg")}</button>
                        </div>
                    </div>
                    <div style="margin-top: 6px;">${this.escapeHtml(task.description || "暂无描述")}</div>
                    <div class="task-suite-meta" style="margin-top: 8px;">
                        ${task.startDate ? `<span>计划日期: ${task.startDate}</span>` : ""}
                        ${task.startDate ? `<span>计划时间: ${this.normalizeTimeInput(task.startTime || "")}</span>` : ""}
                        ${task.dueDate ? `<span>截止日期: ${task.dueDate}</span>` : ""}
                        ${task.dueDate ? `<span>截止时间: ${this.normalizeTimeInput(task.dueTime || "")}</span>` : ""}
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
                                        ${task.startDate ? `<span class="task-suite-kanban-chip">计划: ${task.startDate}</span>` : ""}
                                        ${task.dueDate ? `<span class="task-suite-kanban-chip">截止: ${task.dueDate}</span>` : ""}
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
            const monthHeight = this.getCalendarMonthHeight();
            const allOccurrences = this.getOccurrencesForRange(range.start, range.end);
            const mapByDay = new Map();
            const occurrenceKeySet = new Set();
            allOccurrences.forEach((item) => {
                const key = item.date;
                if (!mapByDay.has(key)) {
                    mapByDay.set(key, []);
                }
                mapByDay.get(key).push(item);
                occurrenceKeySet.add(`${item.date}::${item.task.id}`);
            });
            const modeTabs = [
                { mode: "month", label: `月 · ${cursor.getMonth() + 1}月` },
                { mode: "week", label: `周 · 第${this.getWeekNumber(this.startOfWeek(cursor))}周` },
                { mode: "day", label: `日 · ${cursor.getDate()}号` }
            ];
            const isMobileMonthView = Boolean(this.isMobile && mode === "month");
            const showWeekdayHeader = !(this.isMobile && mode === "week");
            const weekdayHeaderHtml = this.getWeekdayNames(this.isMobile && mode !== "day" ? "short" : "full")
                .map((name) => `<div class="task-suite-calendar-weekday">${name}</div>`)
                .join("");
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
                const dayAxis = this.normalizeCalendarDayAxis(this.ui.calendarDayAxis);
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
                                ${this.renderCalendarLegend()}
                            </div>
                        </div>
                        <div class="task-suite-card task-suite-calendar-day-card">
                            <div class="fn__flex" style="justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--task-suite-border);">
                                <strong>${this.getWeekdayName(day.date)} · ${day.label}</strong>
                                <div class="fn__flex" style="align-items: center; gap: 8px;">
                                    <span class="task-suite-meta" style="margin-right: 8px;">共 ${tasks.length} 项任务</span>
                                    <select class="b3-select" data-filter="calendar-day-axis">
                                        <option value="horizontal" ${dayAxis === "horizontal" ? "selected" : ""}>横轴</option>
                                        <option value="vertical" ${dayAxis === "vertical" ? "selected" : ""}>竖轴</option>
                                    </select>
                                    <button class="b3-button b3-button--outline" data-action="new-task-on-date" data-date="${day.date}">新增任务</button>
                                </div>
                            </div>
                            <div class="task-suite-calendar-day-body task-suite-calendar-day-body--${dayAxis}">
                                ${tasks.length ? this.renderCalendarDayTimeline(day.date, tasks, dayAxis) : `<div class="task-suite-meta" style="padding: 16px;">当日暂无任务，时间轴会在有任务时显示。</div>`}
                            </div>
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
                            ${this.renderCalendarLegend()}
                        </div>
                    </div>
                    ${showWeekdayHeader ? `
                    <div class="task-suite-calendar-weekdays">
                        ${weekdayHeaderHtml}
                    </div>
                    ` : ""}
                    <div class="task-suite-card ${mode === "month" ? "task-suite-calendar-panel--month" : ""} ${mode === "week" ? "task-suite-calendar-panel--week" : ""}">
                        <div class="task-suite-calendar-grid task-suite-calendar-grid--${mode}" style="${mode === "month" ? `--task-suite-month-height:${monthHeight}vh;` : ""}">
                            ${range.days.map((day) => {
                                const tasks = mapByDay.get(day.date) || [];
                                const renderTasks = isMobileMonthView ? [] : tasks;
                                const dayTitle = this.isMobile && mode === "week" ? `${this.getWeekdayName(day.date)} ${day.label}` : day.label;
                                return `
                                    <div class="task-suite-calendar-day ${day.dimmed ? "dimmed" : ""}">
                                        <div class="task-suite-calendar-day-head">
                                            <div class="task-suite-calendar-day-title">
                                                <strong>${dayTitle}</strong>
                                                <div class="task-suite-calendar-lunar">${this.getLunarLabel(day.date)}</div>
                                            </div>
                                            <button class="b3-button b3-button--outline task-suite-calendar-add-btn" data-action="new-task-on-date" data-date="${day.date}">${this.renderSiYuanIcon("iconAdd", "b3-button__icon task-suite-icon-svg")}</button>
                                        </div>
                                        <div class="task-suite-calendar-day-tasks">
                                            ${renderTasks.map((item) => {
                                                const occurrenceStatus = this.getOccurrenceStatus(item.task, day.date);
                                                const statusClass = this.getStatusClass(occurrenceStatus);
                                                const note = this.getOccurrenceNote(item.task, day.date);
                                                const noteBadge = note ? `<span class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger" tabindex="0" aria-label="${this.escapeHtml(note)}">备注</span>` : "";
                                                const repeatClass = this.getRepeatClass(item.task.repeat);
                                                const spanClass = this.getCalendarSpanClass(item.task, day.date, occurrenceKeySet);
                                                const showMainContent = this.shouldRenderCalendarTaskMainContent(item.task, day.date, occurrenceKeySet);
                                                const repeatLabel = this.normalizeRepeat(item.task.repeat) !== "none" ? this.getRepeatLabel(item.task.repeat) : "";
                                                return mode === "month" ? `
                                                    <div class="task-suite-calendar-task ${this.getPriorityClass(item.task.priority)} ${statusClass} ${repeatClass} ${spanClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day.date}">
                                                        <div class="task-suite-calendar-task-line">
                                                            ${showMainContent ? `
                                                                <div class="task-suite-calendar-task-text task-suite-calendar-task-title">
                                                                    ${this.escapeHtml(item.task.title)}
                                                                </div>
                                                                ${noteBadge}
                                                                <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day.date}">${this.renderSiYuanIcon("iconRefresh", "b3-button__icon task-suite-icon-svg")}</button>
                                                            ` : `<div class="task-suite-calendar-span-filler"></div>`}
                                                        </div>
                                                    </div>
                                                ` : `
                                                    <div class="task-suite-calendar-task ${this.getPriorityClass(item.task.priority)} ${statusClass} ${repeatClass} ${spanClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day.date}">
                                                        <div class="task-suite-calendar-task-head">
                                                            <span class="task-suite-calendar-status ${statusClass}" title="${this.getStatusLabel(occurrenceStatus)}">${this.getStatusLabel(occurrenceStatus)}</span>
                                                            ${mode === "week" && showMainContent && repeatLabel ? `<span class="task-suite-calendar-repeat-inline">${repeatLabel}</span>` : ""}
                                                            ${showMainContent ? noteBadge : ""}
                                                            ${showMainContent ? `<button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day.date}">${this.renderSiYuanIcon("iconRefresh", "b3-button__icon task-suite-icon-svg")}</button>` : ""}
                                                        </div>
                                                        <div class="task-suite-calendar-task-title">
                                                            ${showMainContent ? this.escapeHtml(item.task.title) : ""}
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
                    ${isMobileMonthView ? this.renderMobileMonthTaskList(range.days, mapByDay, occurrenceKeySet) : ""}
                </div>
            `;
        }

        renderMobileMonthTaskList(days, mapByDay, occurrenceKeySet) {
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
                                const repeatClass = this.getRepeatClass(item.task.repeat);
                                const spanClass = this.getCalendarSpanClass(item.task, day.date, occurrenceKeySet);
                                const showMainContent = this.shouldRenderCalendarTaskMainContent(item.task, day.date, occurrenceKeySet);
                                return `
                                    <div class="task-suite-calendar-task ${this.getPriorityClass(item.task.priority)} ${statusClass} ${repeatClass} ${spanClass}" data-action="open-calendar-task-editor" data-task-id="${item.task.id}" data-date="${day.date}">
                                        <div class="task-suite-calendar-task-line">
                                            ${showMainContent ? `
                                                <div class="task-suite-calendar-task-text task-suite-calendar-task-title">
                                                    ${this.escapeHtml(item.task.title)}
                                                </div>
                                                ${noteBadge}
                                                <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day.date}">${this.renderSiYuanIcon("iconRefresh", "b3-button__icon task-suite-icon-svg")}</button>
                                            ` : `<div class="task-suite-calendar-span-filler"></div>`}
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

        getCalendarMonthHeight() {
            if (this.isMobile) {
                return this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeightMobile, 50);
            }
            return this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeightDesktop, 80);
        }

        getRepeatClass(repeat) {
            const normalized = this.normalizeRepeat(repeat);
            if (normalized === "none") {
                return "";
            }
            return `repeat-${normalized}`;
        }

        getCalendarSpanClass(task, day, occurrenceKeySet) {
            if (!task || !task.id || !day || !occurrenceKeySet) {
                return "";
            }
            if (this.normalizeRepeat(task.repeat) !== "none") {
                return "task-suite-calendar-span-single";
            }
            const taskId = task.id;
            const prevDay = this.formatDate(this.addDays(day, -1));
            const nextDay = this.formatDate(this.addDays(day, 1));
            const hasPrev = occurrenceKeySet.has(`${prevDay}::${taskId}`);
            const hasNext = occurrenceKeySet.has(`${nextDay}::${taskId}`);
            if (hasPrev && hasNext) {
                return "task-suite-calendar-span-middle";
            }
            if (hasPrev) {
                return "task-suite-calendar-span-end";
            }
            if (hasNext) {
                return "task-suite-calendar-span-start";
            }
            return "task-suite-calendar-span-single";
        }

        shouldRenderCalendarTaskMainContent(task, day, occurrenceKeySet) {
            if (!task || !task.id || !day || !occurrenceKeySet) {
                return true;
            }
            if (this.normalizeRepeat(task.repeat) !== "none") {
                return true;
            }
            const prevDay = this.formatDate(this.addDays(day, -1));
            return !occurrenceKeySet.has(`${prevDay}::${task.id}`);
        }

        shouldRenderTaskInDayView(task, day) {
            if (!task || !day) {
                return false;
            }
            if (this.normalizeRepeat(task.repeat) !== "none") {
                return true;
            }
            const startDate = this.toDateOnly(task.startDate) || this.toDateOnly(task.dueDate);
            const dueDate = this.toDateOnly(task.dueDate) || this.toDateOnly(task.startDate);
            if (!startDate || !dueDate) {
                return true;
            }
            if (startDate === dueDate) {
                return day === startDate;
            }
            return day === startDate || day === dueDate;
        }

        normalizeCalendarDayAxis(value) {
            return value === "vertical" ? "vertical" : "horizontal";
        }

        renderCalendarLegend() {
            return `
                <span class="task-suite-calendar-legend">
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-priority-low">优先级低</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-priority-medium">优先级中</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-priority-high">优先级高</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-priority-urgent">优先级紧急</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-status-todo">待办</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-status-in-progress">进行中</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-status-done">完成</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-status-blocked">受阻</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-repeat-daily">每日</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-repeat-weekly">每周</span>
                    <span class="task-suite-calendar-legend-item task-suite-calendar-legend-repeat-monthly">每月</span>
                </span>
            `;
        }

        renderSettingsView() {
            const desktopHeight = this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeightDesktop, 80);
            const mobileHeight = this.normalizeCalendarMonthHeight(this.state.settings.calendarMonthHeightMobile, 50);
            return `
                <div class="task-suite-list">
                    <div class="task-suite-card">
                        <strong>日历设置</strong>
                        <div class="task-suite-meta" style="margin-top: 8px;">
                            月视图高度已独立配置：桌面端默认 80vh，手机端默认 50vh。
                        </div>
                        <div class="fn__flex" style="gap: 12px; flex-wrap: wrap; margin-top: 10px;">
                            <label class="fn__flex" style="gap: 8px; align-items: center;">
                                <span>桌面月视图高度</span>
                                <input class="b3-text-field" type="number" min="30" max="120" step="1" data-filter="settings-calendar-month-height-desktop" value="${desktopHeight}">
                                <span>vh</span>
                            </label>
                            <label class="fn__flex" style="gap: 8px; align-items: center;">
                                <span>手机月视图高度</span>
                                <input class="b3-text-field" type="number" min="30" max="120" step="1" data-filter="settings-calendar-month-height-mobile" value="${mobileHeight}">
                                <span>vh</span>
                            </label>
                        </div>
                    </div>
                    <div class="task-suite-card">
                        <strong>颜色说明</strong>
                        <div class="task-suite-meta" style="margin-top: 8px;">
                            任务左侧颜色代表优先级，任务底色代表状态，任务右侧颜色代表重复规则（一次任务不显示右侧颜色）。
                        </div>
                        <div class="task-suite-meta" style="margin-top: 8px;">
                            ${this.renderCalendarLegend()}
                        </div>
                    </div>
                </div>
            `;
        }

        getWeekdayNames(mode = "full") {
            if (mode === "short") {
                return ["一", "二", "三", "四", "五", "六", "日"];
            }
            return ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
        }

        getWeekdayName(dateValue) {
            const date = this.parseDate(dateValue);
            if (!date) {
                return "";
            }
            const names = this.getWeekdayNames();
            const index = date.getDay() === 0 ? 6 : date.getDay() - 1;
            return names[index] || "";
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

        openTaskEditorDialog(taskId = "", presetDate = "") {
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
                startDate: presetDate || "",
                dueDate: presetDate || "",
                startTime: "00:00",
                dueTime: "24:00",
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
                                        ${STATUS_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === task.status ? "selected" : ""}>${item.label}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="task-suite-field">
                                    <label>优先级</label>
                                    <select class="b3-select fn__block" name="priority">
                                        ${PRIORITY_OPTIONS.map((item) => `<option value="${item.value}" ${item.value === task.priority ? "selected" : ""}>${item.label}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="task-suite-field">
                                    <label>计划日期</label>
                                    <input class="b3-text-field fn__block" type="date" name="startDate" value="${this.escapeHtml(this.normalizeDateInput(task.startDate))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>计划时间</label>
                                    <input class="b3-text-field fn__block" type="time" name="startTime" value="${this.escapeHtml(this.normalizeTimeInput(task.startTime))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>截止日期</label>
                                    <input class="b3-text-field fn__block" type="date" name="dueDate" value="${this.escapeHtml(this.normalizeDateInput(task.dueDate))}">
                                </div>
                                <div class="task-suite-field">
                                    <label>截止时间</label>
                                    <input class="b3-text-field fn__block" type="time" name="dueTime" value="${this.escapeHtml(this.normalizeTimeInput(task.dueTime === "24:00" ? "23:59" : task.dueTime))}">
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
            this.markTaskDirty(task.id);
            this.markOccurrenceDirty(task.id);
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
            const dueTimeRaw = (formData.get("dueTime") || "").toString().trim();
            const payload = {
                title,
                description: (formData.get("description") || "").toString().trim(),
                status: this.normalizeStatus((formData.get("status") || "").toString()),
                priority: this.normalizePriority((formData.get("priority") || "").toString()),
                repeat: this.normalizeRepeat((formData.get("repeat") || "").toString()),
                startDate: this.normalizeDateInput((formData.get("startDate") || "").toString()),
                dueDate: this.normalizeDateInput((formData.get("dueDate") || "").toString()),
                startTime: this.normalizeTimeInput((formData.get("startTime") || "").toString()),
                dueTime: this.normalizeTimeInput(dueTimeRaw || "24:00"),
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
                startTime: this.normalizeTimeInput(payload.startTime || ""),
                dueTime: this.normalizeTimeInput(payload.dueTime || ""),
                reminderTime: payload.reminderTime || "",
                progress: this.normalizeProgress(payload.progress),
                resource: payload.resource || "",
                dependencies: payload.dependencies || [],
                subtasks: [],
                createdAt: now,
                updatedAt: now
            };
            this.state.tasks.unshift(task);
            this.markTaskDirty(task.id);
            this.markOccurrenceDirty(task.id);
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
                dueTime: task.dueTime,
                startTime: task.startTime
            };
            Object.assign(task, patch);
            task.startDate = this.normalizeDateInput(task.startDate);
            task.dueDate = this.normalizeDateInput(task.dueDate);
            task.startTime = this.normalizeTimeInput(task.startTime || "");
            task.dueTime = this.normalizeTimeInput(task.dueTime || "");
            task.progress = this.normalizeProgress(task.progress);
            task.updatedAt = new Date().toISOString();
            this.markTaskDirty(task.id);
            this.pushHistory(task.id, historyType || "任务更新", this.describeTaskDiff(task, beforeSnapshot));
            this.commitAndRender();
        }

        deleteTask(taskId) {
            const task = this.findTask(taskId);
            if (!task) {
                return;
            }
            this.state.tasks = this.state.tasks.filter((item) => item.id !== taskId);
            this.markTaskDeleted(taskId);
            this.markOccurrenceDeleted(taskId);
            this.removeTaskOccurrenceStatus(taskId);
            this.state.tasks.forEach((item) => {
                const before = item.dependencies.length;
                item.dependencies = item.dependencies.filter((id) => id !== taskId);
                if (item.dependencies.length !== before) {
                    item.updatedAt = new Date().toISOString();
                    this.markTaskDirty(item.id);
                }
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
            if (before.startDate !== task.startDate || before.dueDate !== task.dueDate || before.startTime !== task.startTime || before.dueTime !== task.dueTime) {
                changes.push("时间计划已调整");
            }
            if (!changes.length) {
                changes.push("任务详情已更新");
            }
            return `任务「${task.title}」${changes.join("，")}`;
        }

        pushHistory(taskId, type, detail) {
            const entry = {
                id: this.makeId("history"),
                taskId,
                type,
                detail,
                time: new Date().toISOString()
            };
            this.state.history.unshift(entry);
            this.dirty.historyEntries.push(entry);
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
                    const startDate = this.combineDateTime(task.startDate, task.startTime);
                    entries.push({
                        time: startDate ? startDate.toISOString() : new Date().toISOString(),
                        title: `计划开始 · ${task.title}`,
                        content: `任务计划开始，状态：${this.getStatusLabel(task.status)}`,
                        sortWeight: 2
                    });
                }
                if (task.dueDate) {
                    const dueDate = this.combineDateTime(task.dueDate, task.dueTime);
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
                const startBoundary = this.formatDate(windowStart);
                const endBoundary = this.formatDate(windowEnd);
                if (startBoundary >= startDateString && startBoundary <= endDateString) {
                    result.push(startBoundary);
                }
                if (endBoundary !== startBoundary && endBoundary >= startDateString && endBoundary <= endDateString) {
                    result.push(endBoundary);
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
                    const planEnd = this.toDateOnly(task.dueDate) || this.toDateOnly(task.startDate) || this.formatDate(new Date(task.createdAt));
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

        renderSiYuanIcon(iconName, className = "") {
            const normalizedIcon = iconName || "iconList";
            const normalizedClass = className ? ` class="${className}"` : "";
            return `<svg${normalizedClass}><use xlink:href="#${normalizedIcon}"></use></svg>`;
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
            const mode = this.ui.calendarMode;
            if (mode === "month" || mode === "week") {
                return "";
            }
            const dateTime = this.getCalendarTaskDateTime(task, day);
            if (dateTime) {
                return `${`${dateTime.getHours()}`.padStart(2, "0")}:${`${dateTime.getMinutes()}`.padStart(2, "0")}`;
            }
            return "";
        }

        getCalendarTaskDateTime(task, day) {
            const range = this.getTaskDayTimeRange(task, day);
            if (!range) {
                return null;
            }
            return this.combineDateTime(day, range.start);
        }

        getTaskDayTimeRange(task, day) {
            if (!task || !day) {
                return null;
            }
            let startDate = this.toDateOnly(task.startDate) || this.toDateOnly(task.dueDate) || day;
            let dueDate = this.toDateOnly(task.dueDate) || this.toDateOnly(task.startDate) || day;
            let startTime = this.normalizeTimeInput(task.startTime || "");
            let dueTime = this.normalizeTimeInput(task.dueTime || "");
            if (startDate > dueDate) {
                [startDate, dueDate] = [dueDate, startDate];
                [startTime, dueTime] = [dueTime, startTime];
            }
            if (task.repeat !== "none") {
                return {
                    start: startTime,
                    end: dueTime
                };
            }
            if (startDate === dueDate) {
                return {
                    start: startTime,
                    end: dueTime
                };
            }
            if (day === startDate) {
                return {
                    start: startTime,
                    end: "24:00"
                };
            }
            if (day === dueDate) {
                return {
                    start: "00:00",
                    end: dueTime
                };
            }
            if (day > startDate && day < dueDate) {
                return {
                    start: "00:00",
                    end: "24:00"
                };
            }
            return null;
        }

        getCalendarTaskRangeLabel(task, day) {
            const range = this.getTaskDayTimeRange(task, day);
            if (!range) {
                return "";
            }
            return `${range.start}-${range.end}`;
        }

        timeToMinutes(value) {
            const normalized = String(value || "").trim();
            if (!normalized) {
                return 0;
            }
            if (normalized === "24:00") {
                return 24 * 60;
            }
            const matched = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
            if (!matched) {
                return 0;
            }
            const hour = Math.max(0, Math.min(24, Number(matched[1])));
            const minute = Math.max(0, Math.min(59, Number(matched[2])));
            if (hour === 24) {
                return 24 * 60;
            }
            return hour * 60 + minute;
        }

        renderCalendarDayTimeline(day, tasks, axisMode) {
            const normalizedAxis = this.normalizeCalendarDayAxis(axisMode || this.ui.calendarDayAxis);
            const totalMinutes = 24 * 60;
            const now = new Date();
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const isToday = day === this.formatDate(now);
            const nowLine = isToday ? `
                <div class="task-suite-day-now-line" style="left:${(nowMinutes / totalMinutes) * 100}%;">
                    <span class="task-suite-day-now-label">${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}</span>
                </div>
            ` : "";
            const horizontalTickStep = this.isMobile ? 4 : 1;
            const tickHours = Array.from({ length: 25 }, (_, hour) => hour).filter((hour) => hour % horizontalTickStep === 0);
            const tickMarks = tickHours.map((hour) => {
                const leftPercent = (hour / 24) * 100;
                return `
                    <span class="task-suite-day-axis-tick" style="left:${leftPercent}%;">
                        <span class="task-suite-day-axis-tick-line"></span>
                        <span class="task-suite-day-axis-tick-label">${`${hour}`.padStart(2, "0")}:00</span>
                    </span>
                `;
            }).join("");
            const timelineItems = tasks
                .filter((item) => this.shouldRenderTaskInDayView(item.task, day))
                .map((item) => {
                    const range = this.getTaskDayTimeRange(item.task, day);
                    if (!range) {
                        return null;
                    }
                    let startMinutes = this.timeToMinutes(range.start);
                    let endMinutes = this.timeToMinutes(range.end);
                    if (endMinutes <= startMinutes) {
                        endMinutes = Math.min(totalMinutes, startMinutes + 30);
                    }
                    if (startMinutes < 0 || startMinutes >= totalMinutes) {
                        startMinutes = Math.max(0, Math.min(totalMinutes - 1, startMinutes));
                    }
                    endMinutes = Math.max(startMinutes + 15, Math.min(totalMinutes, endMinutes));
                    const occurrenceStatus = this.getOccurrenceStatus(item.task, day);
                    const statusClass = this.getStatusClass(occurrenceStatus);
                    const note = this.getOccurrenceNote(item.task, day);
                    const noteBadge = note ? `<span class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger" tabindex="0" aria-label="${this.escapeHtml(note)}">备注</span>` : "";
                    const repeatClass = this.getRepeatClass(item.task.repeat);
                    const repeatLabel = this.normalizeRepeat(item.task.repeat) !== "none" ? this.getRepeatLabel(item.task.repeat) : "";
                    const leftPercent = (startMinutes / totalMinutes) * 100;
                    const widthPercent = ((endMinutes - startMinutes) / totalMinutes) * 100;
                    const minTextWidthPercent = 48;
                    const textStartPercent = Math.min(leftPercent, Math.max(0, 100 - minTextWidthPercent));
                    return {
                        id: item.task.id,
                        title: item.task.title,
                        rangeLabel: this.getCalendarTaskRangeLabel(item.task, day),
                        startMinutes,
                        endMinutes,
                        repeatLabel,
                        repeatClass,
                        statusClass,
                        statusLabel: this.getStatusLabel(occurrenceStatus),
                        priorityClass: this.getPriorityClass(item.task.priority),
                        noteBadge,
                        leftPercent,
                        widthPercent,
                        textStartPercent,
                        html: `
                            <div class="task-suite-day-task-row">
                                <div class="task-suite-day-task-track">
                                    <div
                                        class="task-suite-day-event-segment ${this.getPriorityClass(item.task.priority)} ${statusClass} ${repeatClass}"
                                        style="left:${leftPercent}%;width:${Math.max(1, widthPercent)}%;"
                                    ></div>
                                    <div class="task-suite-day-spacer" style="width: ${leftPercent}%; flex-shrink: 1; min-width: 0;"></div>
                                    <div
                                        class="task-suite-day-event task-suite-day-event-horizontal task-suite-day-event-full ${this.getPriorityClass(item.task.priority)} ${statusClass}"
                                        data-action="open-calendar-task-editor"
                                        data-task-id="${item.task.id}"
                                        data-date="${day}"
                                        style="flex-shrink: 0; max-width: 100%;"
                                    >
                                        <span class="task-suite-calendar-status ${statusClass}" title="${this.getStatusLabel(occurrenceStatus)}">${this.getStatusLabel(occurrenceStatus)}</span>
                                        ${repeatLabel ? `<span class="task-suite-calendar-repeat-inline">${repeatLabel}</span>` : ""}
                                        <span class="task-suite-day-event-title">${this.getCalendarTaskRangeLabel(item.task, day)} ${this.escapeHtml(item.task.title)}</span>
                                        ${noteBadge}
                                        <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.task.id}" data-date="${day}">${this.renderSiYuanIcon("iconRefresh", "b3-button__icon task-suite-icon-svg")}</button>
                                    </div>
                                </div>
                            </div>
                        `
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.startMinutes - b.startMinutes || a.title.localeCompare(b.title));
            const rowsHtml = timelineItems.map((item) => item.html).join("");
            if (normalizedAxis === "vertical") {
                const ITEM_WIDTH = this.isMobile ? 88 : 100;
                
                // Calculate columns to avoid overlapping
                const sortedVerticalItems = [...timelineItems].sort((a, b) => a.startMinutes - b.startMinutes || (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes));
                const columns = [];
                let maxCols = 0;
                
                for (const item of sortedVerticalItems) {
                    let placed = false;
                    for (let i = 0; i < columns.length; i++) {
                        if (columns[i] <= item.startMinutes) {
                            item.colIndex = i;
                            columns[i] = item.endMinutes;
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        item.colIndex = columns.length;
                        columns.push(item.endMinutes);
                    }
                    maxCols = Math.max(maxCols, item.colIndex + 1);
                }

                const trackMinWidth = Math.max(100, maxCols * (ITEM_WIDTH + 8) + 16);

                const verticalItemsHtml = sortedVerticalItems.map((item) => {
                    const topPercent = (item.startMinutes / totalMinutes) * 100;
                    const heightPercent = ((item.endMinutes - item.startMinutes) / totalMinutes) * 100;
                    const leftPx = 8 + item.colIndex * (ITEM_WIDTH + 8);
                    
                    return `
                    <div
                        class="task-suite-day-vertical-event task-suite-day-event ${item.priorityClass} ${item.statusClass} ${item.repeatClass}"
                        data-action="open-calendar-task-editor"
                        data-task-id="${item.id}"
                        data-date="${day}"
                        style="top:${topPercent}%;height:${heightPercent}%;left:${leftPx}px;width:${ITEM_WIDTH}px;"
                    >
                        <div class="task-suite-day-event-meta" style="width: 100%;">
                            <span class="task-suite-calendar-status ${item.statusClass}" title="${item.statusLabel}">${item.statusLabel}</span>
                            ${item.repeatLabel ? `<span class="task-suite-calendar-repeat-inline">${item.repeatLabel}</span>` : ""}
                            ${item.noteBadge}
                            <button class="b3-button b3-button--outline task-suite-calendar-switch-btn" title="切换状态" data-action="cycle-calendar-status" data-task-id="${item.id}" data-date="${day}" style="margin-left: auto;">${this.renderSiYuanIcon("iconRefresh", "b3-button__icon task-suite-icon-svg")}</button>
                        </div>
                        <div class="task-suite-day-event-title" style="white-space: normal; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-all; line-height: 1.25;">${item.rangeLabel} ${this.escapeHtml(item.title)}</div>
                    </div>
                `;
                }).join("");
                const verticalNowLine = isToday ? `
                    <div class="task-suite-day-vertical-now-line" style="top:${(nowMinutes / totalMinutes) * 100}%;">
                        <span class="task-suite-day-now-label">${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}</span>
                    </div>
                ` : "";
                const verticalTicks = Array.from({ length: 25 }, (_, hour) => `
                    <span class="task-suite-day-vertical-tick" style="top:${(hour / 24) * 100}%;">${`${hour}`.padStart(2, "0")}:00</span>
                `).join("");
                return `
                    <div class="task-suite-day-timeline task-suite-day-timeline--vertical">
                        <div class="task-suite-day-vertical-layout">
                            <div class="task-suite-day-vertical-axis">${verticalTicks}</div>
                            <div class="task-suite-day-vertical-track" style="min-width: ${trackMinWidth}px;">
                                ${Array.from({ length: 25 }, (_, hour) => `<span class="task-suite-day-vertical-grid-line" style="top:${(hour / 24) * 100}%;"></span>`).join("")}
                                ${verticalNowLine}
                                ${verticalItemsHtml || `<div class="task-suite-meta" style="position:absolute;top:16px;left:16px;">当日暂无可展示任务。</div>`}
                            </div>
                        </div>
                    </div>
                `;
            }
            return `
                <div class="task-suite-day-timeline task-suite-day-timeline--horizontal">
                    <div class="task-suite-day-time-axis">
                        <div class="task-suite-day-axis-track">${tickMarks}</div>
                    </div>
                    <div class="task-suite-day-rows">
                        ${nowLine}
                        ${rowsHtml}
                    </div>
                </div>
            `;
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
            return this.normalizeTimeInput(task.startTime || task.dueTime || "");
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
            this.markOccurrenceDirty(task.id);
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
                this.markOccurrenceDirty(task.id);
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

        combineDateTime(dateString, timeString) {
            const date = this.normalizeDateInput(dateString);
            if (!date) {
                return null;
            }
            const time = this.normalizeTimeInput(timeString || "");
            return this.parseDate(`${date}T${time}`);
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
                dueDate: "2026-03-31",
                startDate: "2026-03-02",
                startTime: "09:00",
                dueTime: "18:00",
                createdAt: "2026-03-01T00:00:00.000Z"
            };
            const weeklyDates = this.getTaskCalendarDates(selfTestTask, "2026-03-01", "2026-03-20");
            const expectedWeeklyDates = ["2026-03-02", "2026-03-09", "2026-03-16"];
            const monthlyDates = this.getTaskCalendarDates({
                ...selfTestTask,
                repeat: "monthly",
                startDate: "2026-01-15",
                dueDate: "2026-04-30"
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
