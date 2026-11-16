// 适配脚本骨架 —— 在教务页面里执行，通过 shiguangBridgePromise 回写课程。
// 约定见根目录 README：不写顶层 await、不猜周次/节次、不碰与课表无关的页面。
(function () {
  'use strict';

  async function run() {
    // 1. 定位课表数据（接口或 DOM），拿到课程数组
    // const rows = ...

    // 2. 可选：写入节次配置与作息时间
    // await shiguangBridgePromise.saveCourseConfig(JSON.stringify({ /* ... */ }));

    // 3. 写入课程：每门课必须有真实的上课星期、节次、周次
    // await shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
  }

  return run();
})();
