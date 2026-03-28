---
name: siyuan-plugin-task-suite-manager
description: 维护和开发思源插件 siyuan-plugin-task-suite-manager 的专用技能。只要用户提到任务管理中心插件、日历/月周日视图、看板、时间轴、甘特图、重复规则、任务编辑弹窗、样式主题、插件设置或该插件中的 bug 修复与功能新增，就应使用此技能。即使用户没有明确说“用技能”，只要目标是修改或排查这个插件，也要优先触发。
---

# siyuan-plugin-task-suite-manager

用于在该插件目录内执行稳定、可回归验证的开发流程。

## 适用范围

- 修改 `index.js` 的数据模型、渲染逻辑、事件处理、设置项
- 修改 `index.css` 的布局、视觉样式、移动端适配
- 调整月/周/日历、看板、时间轴、甘特图表现
- 修复重复任务、跨天任务、时间显示、状态切换等问题
- 补充或更新 `recurrence.test.js` 以覆盖行为变更

## 工作流程

1. 先定位需求对应的模块与函数，再做最小必要改动  
2. 优先延续现有命名、结构和样式约定  
3. 变更涉及行为时，同时更新对应测试断言  
4. 完成后必须执行：
   - `node --check index.js`
   - `node recurrence.test.js`
5. 输出结果时说明：
   - 修改了哪些文件
   - 关键函数/样式点
   - 校验命令及结果

## 代码约束

- 不引入与现有工程无关的新依赖
- 优先编辑现有文件，避免无必要新建文件
- 日历和任务时间逻辑修改时，确保月/周/日三个模式行为一致且可解释
- 涉及移动端样式时，检查 `.task-suite-root.task-suite-mobile` 相关规则

## 常用定位线索

- 日历主视图：`renderCalendarView`
- 日视图时间轴：`renderCalendarDayTimeline`
- 重复/跨天计算：`getTaskOccurrences`、`getTaskDayTimeRange`
- 设置页：`renderSettingsView`
- 时间归一化：`normalizeTimeInput`
- 回归测试：`recurrence.test.js`
