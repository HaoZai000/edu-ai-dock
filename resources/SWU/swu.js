// 西南大学微查课表。请求使用办事大厅的当前登录会话。
async function runSwuMicroImport() {
  try {
    await importMicroSchedule();
  } catch (error) {
    console.error("西南大学微查课表导入失败:", error);
    window.shiguangBridge.showToast(`课表导入失败：${error.message || error}`);
  }
}

async function importMicroSchedule() {
  if (window.location.hostname !== "ywtb.swu.edu.cn") {
    throw new Error("请登录西南大学办事大厅并打开微查课表后再导入");
  }

  async function apiJson(path) {
    const response = await fetch(path, { credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      throw new Error("请登录西南大学办事大厅并打开微查课表后重试");
    }
    if (!response.ok) throw new Error(`微查接口请求失败（HTTP ${response.status}）`);
    const data = await response.json().catch(() => null);
    if (!data?.content) throw new Error("未取得微查课表数据，请打开微查课表后重试");
    return data.content;
  }

  const { list } = await apiJson("/new-light-app/basic/academicSemesterList");
  const semesters = Array.isArray(list) ? list.filter((item) =>
    item?.code != null && String(item.code).trim() !== "" && typeof item.label === "string" && item.label.trim()
  ) : [];
  if (semesters.length === 0) throw new Error("未读取到学期选项");
  const defaultIndex = Math.max(0, semesters.findIndex((item) => item.isCurrent === "YES"));
  const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
    "选择学期",
    JSON.stringify(semesters.map((item) => item.label)),
    defaultIndex
  );
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= semesters.length) {
    return;
  }
  const semesterCode = String(semesters[selectedIndex].code);
  const semesterQuery = `academicSemesterCode=${encodeURIComponent(semesterCode)}`;

  const [weekInfo, periodData] = await Promise.all([
    apiJson(`/new-light-app/basic/weekInfo?${semesterQuery}`),
    apiJson("/new-light-app/basic/periodList")
  ]);
  const totalWeeks = Number(weekInfo.totalWeeks);
  const calendarWeeks = weekInfo.weeks;
  if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 60 || !Array.isArray(calendarWeeks) || calendarWeeks.length !== totalWeeks) {
    throw new Error("学期周历不完整，已停止导入");
  }
  for (let i = 0; i < totalWeeks; i++) {
    if (Number(calendarWeeks[i].weekNo) !== i + 1) throw new Error("学期周历周号不连续，已停止导入");
  }
  const startDate = weekInfo.startDate;
  const parsedStartDate = new Date(`${startDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0, 10) !== startDate) {
    throw new Error("接口未提供有效的第 1 周开课日期，已停止导入");
  }

  const rawSlots = periodData.list;
  if (!Array.isArray(rawSlots) || rawSlots.length === 0) throw new Error("未读取到节次时间表");
  const clockPattern = /^((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/;
  const slotsByNumber = new Map();
  for (const slot of rawSlots) {
    const number = Number(slot.periodNo);
    const startTime = clockPattern.exec(String(slot.startTime || "").trim())?.[1];
    const endTime = clockPattern.exec(String(slot.endTime || "").trim())?.[1];
    if (!Number.isSafeInteger(number) || number < 1 || !startTime || !endTime || startTime >= endTime) {
      throw new Error("节次时间表存在无效记录");
    }
    const previous = slotsByNumber.get(number);
    if (previous && (previous.startTime !== startTime || previous.endTime !== endTime)) {
      throw new Error(`第 ${number} 节有不同的作息时间，已停止导入`);
    }
    slotsByNumber.set(number, { number, startTime, endTime });
  }
  const presetTimeSlots = Array.from(slotsByNumber.values()).sort((a, b) => a.number - b.number);
  for (const [index, slot] of presetTimeSlots.entries()) {
    if (slot.number !== index + 1) throw new Error("节次编号必须从 1 开始连续排列");
    const previous = presetTimeSlots[index - 1];
    if (previous && slot.startTime < previous.endTime) {
      throw new Error(`第 ${previous.number} 节与第 ${slot.number} 节的作息时间重叠`);
    }
  }

  // 逐周接口只返回指定周的数据，分批并行避免同时请求整学期。
  const weekResponses = [];
  const batchSize = 4;
  for (let firstWeek = 1; firstWeek <= totalWeeks; firstWeek += batchSize) {
    const batch = calendarWeeks.slice(firstWeek - 1, firstWeek - 1 + batchSize);
    weekResponses.push(...await Promise.all(batch.map((week) => apiJson(
      `/new-light-app/schedule/query?${semesterQuery}&weekNo=${encodeURIComponent(week.weekNo)}`
    ))));
  }
  const merged = new Map();
  for (let i = 0; i < weekResponses.length; i++) {
    const data = weekResponses[i];
    const weekNo = i + 1;
    if (String(data.academicSemesterCode) !== semesterCode || Number(data.weekNo) !== weekNo || !Array.isArray(data.list)) {
      throw new Error(`第 ${weekNo} 周响应与所选学期不匹配，已停止导入`);
    }
    for (const item of data.list) {
      const name = String(item.courseName || "").trim();
      const teacher = String(item.teacherName || "").trim();
      const position = String(item.classroomName || "").trim();
      const day = Number(item.dayOfWeek);
      const startSection = Number(item.startPeriod);
      const endSection = Number(item.endPeriod);
      if (!name || !Number.isInteger(day) || day < 1 || day > 7 ||
          !Number.isSafeInteger(startSection) || !Number.isSafeInteger(endSection) || startSection < 1 ||
          endSection < startSection || endSection > presetTimeSlots.length) {
        throw new Error(`第 ${weekNo} 周存在排课字段无效的记录，已停止导入`);
      }
      const key = JSON.stringify([name, teacher, position, day, startSection, endSection]);
      let course = merged.get(key);
      if (!course) {
        course = { name, teacher, position, day, startSection, endSection, weeks: [] };
        merged.set(key, course);
      }
      if (course.weeks[course.weeks.length - 1] !== weekNo) course.weeks.push(weekNo);
    }
  }

  const courses = Array.from(merged.values()).sort((a, b) =>
    a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name)
  );
  if (courses.length === 0) throw new Error("所选学期未返回课程，已停止导入以避免覆盖现有课表");

  const bridge = window.shiguangBridgePromise;
  await bridge.saveImportedCourses(JSON.stringify(courses));
  await bridge.saveCourseConfig(JSON.stringify({
    semesterStartDate: startDate,
    semesterTotalWeeks: totalWeeks,
    firstDayOfWeek: 1
  }));
  await bridge.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
  window.shiguangBridge.notifyTaskCompletion();
}

runSwuMicroImport();
