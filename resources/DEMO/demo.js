// 示例适配器：不解析任何教务页面，直接通过导入桥写入一门测试课程。
// 用途是验证「仓库索引 → 脚本下载 → 课表落库」整条链路是否通畅。
// 正式适配请复制 resources/_template 重写，课程字段见根目录 README。
(function () {
  'use strict';

  async function run() {
    const bridge = window.AndroidBridgePromise;
    if (!bridge) {
      throw new Error('未找到导入桥：请从课程表 App 的教务导入进入本页');
    }

    // 一门真实可落库的课：星期 1..7、节次从 1 开始、周次必填
    const course = {
      name: '示例课程',
      teacher: '示例教师',
      position: '示例楼 101',
      day: 1,
      startSection: 1,
      endSection: 2,
      weeks: [1, 2, 3, 4],
    };

    await bridge.saveImportedCourses(JSON.stringify([course]));
    await bridge.notifyTaskCompletion();
  }

  return run();
})();
