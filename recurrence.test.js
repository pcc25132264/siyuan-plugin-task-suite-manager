const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPluginClass() {
    const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
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
}

run();
