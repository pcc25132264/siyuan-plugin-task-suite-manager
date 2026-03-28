const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const INDEX_PATH = path.join(__dirname, "index.js");
const CSS_PATH = path.join(__dirname, "index.css");

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
        startDate: "2026-03-01",
        dueDate: "2026-03-01",
        startTime: "09:00",
        dueTime: "18:00",
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
        createTask({ repeat: "none", startDate: "2026-03-04", dueDate: "2026-03-20" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(oneTimeDates.join(","), ["2026-03-04"].join(","));

    const dailyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "daily", startDate: "2026-03-01", dueDate: "2026-03-05" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(dailyDates.join(","), ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].join(","));

    const weeklyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "weekly", startDate: "2026-03-02", dueDate: "2026-03-31" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(weeklyDates.join(","), ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"].join(","));

    const monthlyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "monthly", startDate: "2026-01-15", dueDate: "2026-04-30" }),
        "2026-01-01",
        "2026-04-30"
    );
    assert.equal(monthlyDates.join(","), ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"].join(","));

    const reverseWindowWeeklyDates = plugin.getTaskCalendarDates(
        createTask({ repeat: "weekly", startDate: "2026-03-31", dueDate: "2026-03-02" }),
        "2026-03-01",
        "2026-03-31"
    );
    assert.equal(reverseWindowWeeklyDates.join(","), ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"].join(","));

    const noteTask = createTask({
        id: "task-note",
        repeat: "none",
        startDate: "2026-03-04",
        dueDate: "2026-03-04",
        startTime: "09:00",
        dueTime: "18:00"
    });
    plugin.state.tasks = [noteTask];
    plugin.state.occurrenceNotes[plugin.getOccurrenceKey(noteTask.id, "2026-03-04")] = "测试备注提示";

    const monthHtml = plugin.renderCalendarView();
    assert.equal(monthHtml.includes('class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger"'), true);
    assert.equal(monthHtml.includes('aria-label="测试备注提示"'), true);
    assert.equal(monthHtml.includes("50vh"), true);
    assert.equal(monthHtml.includes("月 · 3月"), true);
    assert.equal(monthHtml.includes("周 · 第10周"), true);
    assert.equal(monthHtml.includes("日 · 4号"), true);
    assert.equal(monthHtml.includes("当前月份：3月"), false);
    assert.equal(monthHtml.includes("class=\"task-suite-calendar-lunar\""), true);
    assert.equal(monthHtml.includes("task-suite-calendar-weekdays"), true);
    assert.equal(monthHtml.includes("星期一"), true);
    assert.equal(monthHtml.includes("星期日"), true);

    const weekRange = plugin.getCalendarRange("week", plugin.parseDate("2026-03-04"));
    assert.equal(weekRange.days.map((item) => item.label).every((label) => /^\d+$/.test(label)), true);
    assert.equal(weekRange.days[0].label, "2");

    const lunarLabel = plugin.getLunarLabel("2026-03-04");
    assert.equal(lunarLabel.length > 0, true);
    assert.equal(/[0-9]/.test(lunarLabel), false);

    plugin.ui.calendarMode = "day";
    const dayHtml = plugin.renderCalendarView();
    assert.equal(dayHtml.includes('class="task-suite-calendar-note-badge task-suite-note-tooltip-trigger"'), true);
    assert.equal(dayHtml.includes('aria-label="测试备注提示"'), true);
    assert.equal(dayHtml.includes("星期三 · 2026-03-04"), true);
    assert.equal(dayHtml.includes("09:00-18:00"), true);

    plugin.ui.calendarMode = "month";
    plugin.isMobile = true;
    const mobileMonthHtml = plugin.renderCalendarView();
    assert.equal(mobileMonthHtml.includes("task-suite-calendar-mobile-month-list"), true);
    assert.equal(mobileMonthHtml.includes("task-suite-calendar-mobile-month-day"), true);
    assert.equal(mobileMonthHtml.includes("当前月份：3月"), false);
    assert.equal(mobileMonthHtml.includes('task-suite-calendar-weekday">一<'), true);
    assert.equal(mobileMonthHtml.includes("星期一"), false);

    plugin.ui.calendarMode = "week";
    const mobileWeekHtml = plugin.renderCalendarView();
    assert.equal(mobileWeekHtml.includes("task-suite-calendar-weekdays"), false);
    assert.equal(mobileWeekHtml.includes("星期一 2"), true);

    const source = fs.readFileSync(INDEX_PATH, "utf8");
    const cssSource = fs.readFileSync(CSS_PATH, "utf8");
    assert.equal(source.includes("handleRootMouseOver(event)"), true);
    assert.equal(source.includes("getOrCreateNoteTooltip()"), true);
    assert.equal(source.includes('getWeekdayNames(mode = "full")'), true);
    assert.equal(source.includes("getWeekdayName(dateValue)"), true);
    assert.equal(source.includes("const options = [50, 60, 70, 80];"), true);
    assert.equal(source.includes("showWeekdayHeader = !(this.isMobile && mode === \"week\")"), true);
    assert.equal(source.includes("renderMobileMonthTaskList(days, mapByDay)"), true);
    assert.equal(source.includes('tooltip.style.whiteSpace = "pre-wrap";'), true);
    assert.equal(source.includes('tooltip.style.overflowWrap = "anywhere";'), true);
    assert.equal(source.includes("<style>"), false);
    assert.equal(cssSource.includes(".task-suite-day-timeline {"), true);
    assert.equal(cssSource.includes(".task-suite-day-hour-row {"), true);
    assert.equal(cssSource.includes(".task-suite-day-event:hover"), true);
    assert.equal(cssSource.includes(".task-suite-day-event .task-suite-calendar-note-badge"), true);
    assert.equal(cssSource.includes(".task-suite-calendar-grid--week .task-suite-calendar-day-title {"), true);
    assert.equal(cssSource.includes(".task-suite-root.task-suite-mobile .task-suite-timeline-content {"), true);
    assert.equal(cssSource.includes(".task-suite-root.task-suite-mobile .task-suite-calendar-grid--month .task-suite-calendar-day-tasks {"), true);
    assert.equal(cssSource.includes("overflow: visible;"), true);
    assert.equal(cssSource.includes("overflow-x: hidden;"), true);
    assert.equal(cssSource.includes("display: none;"), true);
}

run();
