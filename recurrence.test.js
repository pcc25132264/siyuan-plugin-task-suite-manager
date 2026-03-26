const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const INDEX_PATH = path.join(__dirname, "index.js");

function loadPluginClass() {
    const source = fs.readFileSync(INDEX_PATH, "utf8");
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require: (name) => {
            if (name === "siyuan") {
                return {
                    Plugin: class {},
                    Dialog: class {},
                    showMessage: () => {}
                };
            }
            return require(name);
        },
        console,
        globalThis: {}
    };
    vm.runInNewContext(source, sandbox, { filename: "index.js" });
    return sandbox.module.exports;
}

function createTask(overrides) {
    return {
        id: "task-test",
        title: "task-test",
        repeat: "none",
        startDate: "2026-03-01T09:00",
        dueDate: "2026-03-01T18:00",
        createdAt: "2026-03-01T00:00:00.000Z",
        ...overrides
    };
}

function run() {
    const PluginClass = loadPluginClass();
    const plugin = new PluginClass();
    plugin.state = plugin.createDefaultState();
    plugin.ui = {
        activeTab: "calendar",
        timelineStart: "",
        timelineEnd: "",
        calendarMode: "month",
        calendarCursor: "2026-03-04",
        calendarMonthHeight: 70,
        ganttStart: "",
        ganttEnd: "",
        kanbanDropTaskId: ""
    };

    const oneTimeDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "none", startDate: "2026-03-04T09:00", dueDate: "2026-03-20T18:00" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(oneTimeDates.join(","), ["2026-03-04"].join(","));

    const dailyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "daily", startDate: "2026-03-01T09:00", dueDate: "2026-03-05T18:00" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(dailyDates.join(","), ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].join(","));

    const weeklyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "weekly", startDate: "2026-03-02T09:00", dueDate: "2026-03-31T18:00" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(weeklyDates.join(","), ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"].join(","));

    const monthlyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "monthly", startDate: "2026-01-15T09:00", dueDate: "2026-04-30T18:00" }),
        "2026-01-01",
        "2026-04-30"
    );
    assert.equal(monthlyDates.join(","), ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"].join(","));

    const reverseWindowWeeklyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "weekly", startDate: "2026-03-31T09:00", dueDate: "2026-03-02T18:00" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(reverseWindowWeeklyDates.join(","), ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"].join(","));

    const noteTask = createTask({
        id: "task-note",
        repeat: "none",
        startDate: "2026-03-04T09:00",
        dueDate: "2026-03-04T18:00"
    });
    plugin.state.tasks = [noteTask];
    plugin.state.occurrenceNotes[plugin.getOccurrenceKey(noteTask.id, "2026-03-04")] = "测试备注提示";

    const monthHtml = plugin.renderCalendarView();
    assert.equal(monthHtml.includes('class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger"'), true);
    assert.equal(monthHtml.includes('aria-label="测试备注提示"'), true);

    plugin.ui.calendarMode = "day";
    const dayHtml = plugin.renderCalendarView();
    assert.equal(dayHtml.includes('class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger"'), true);
    assert.equal(dayHtml.includes('aria-label="测试备注提示"'), true);

    const source = fs.readFileSync(INDEX_PATH, "utf8");
    assert.equal(source.includes(".task-suite-day-timeline {"), true);
    assert.equal(source.includes(".task-suite-day-hour-row {"), true);
    assert.equal(source.includes(".task-suite-day-event:hover"), true);
    assert.equal(source.includes(".task-suite-day-event .task-suite-calendar-note-badge"), true);
    assert.equal(source.includes("overflow: visible;"), true);
    assert.equal(source.includes("handleRootMouseOver(event)"), true);
    assert.equal(source.includes("getOrCreateNoteTooltip()"), true);
    assert.equal(source.includes('tooltip.style.whiteSpace = "pre-wrap";'), true);
    assert.equal(source.includes('tooltip.style.overflowWrap = "anywhere";'), true);
}

run();
