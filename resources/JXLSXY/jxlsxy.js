(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') { try { BD.showToast(msg); } catch (e) {} }
  }
  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }
  async function select(title, labels, def) {
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const picked = await BP.showSingleSelection(title, JSON.stringify(labels), def);
    if (picked === null || picked === undefined || Number(picked) === -1 || isNaN(Number(picked))) return null;
    return Number(picked);
  }
  async function saveCourses(courses) {
    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const ok = await BP.saveImportedCourses(JSON.stringify(courses));
    if (ok === false || ok === 'false' || ok === null) throw new Error('课程保存失败');
  }
  function finish() {
    if (BD && typeof BD.notifyTaskCompletion === 'function') { try { BD.notifyTaskCompletion(); } catch (e) {} }
  }

  const BASE = location.origin;
  const API = '/TeachClass_M/api/TeaClass/';
  // 用户提供的作息
  const TIME_SLOTS = [
    { number: 1, startTime: '08:10', endTime: '08:50' },
    { number: 2, startTime: '09:00', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:40' },
    { number: 4, startTime: '10:50', endTime: '11:30' },
    { number: 5, startTime: '13:30', endTime: '14:10' },
    { number: 6, startTime: '14:15', endTime: '14:55' },
    { number: 7, startTime: '15:05', endTime: '15:45' },
    { number: 8, startTime: '15:50', endTime: '16:30' }
  ];

  async function getJson(url) {
    const token = sessionStorage.getItem('XSKBtoken') || '';
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer  ' + token },
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function fetchAcademicOptions() {
    const json = await getJson(BASE + API + 'QuerySem?sf_request_type=ajax');
    if (json.code !== 1 || !Array.isArray(json.response) || !json.response.length) {
      throw new Error('未取到学期列表');
    }
    return json.response.map(function (s, i) {
      const weeks = parseInt(s.week, 10) || 20;
      return { index: i, id: s.id, name: s.name, weeks: Math.min(Math.max(weeks, 1), 30) };
    });
  }

  async function chooseSemester(items) {
    const idx = await select('选择学期', items.map(function (x) { return x.name; }), 0);
    if (idx === null) return null;
    return items[idx] || null;
  }

  async function fetchTermCourses(sem) {
    const total = sem.weeks > 0 ? sem.weeks : 20;
    const jobs = [];
    for (let w = 1; w <= total; w++) {
      jobs.push((async function (week) {
        try {
          const json = await getJson(BASE + API + 'QueryStuClass?week=' + week + '&sf_request_type=ajax');
          if (json.code !== 1 || !json.response) return { week: week, days: [], failed: true };
          const d0 = (json.response.curWeekDate || '').split(',')[0];
          const firstDate = /^\d{4}-\d{2}-\d{2}/.test(d0) ? d0.slice(0, 10) : null;
          return { week: week, days: json.response.weeklist || [], firstDate: firstDate, failed: false };
        } catch (e) {
          return { week: week, days: [], failed: true };
        }
      })(w));
    }
    const results = await Promise.all(jobs);
    const raw = [];
    let startDate = null;
    let okWeeks = 0;
    results.forEach(function (r) {
      if (r.failed) return;
      okWeeks++;
      if (r.week === 1 && r.firstDate) startDate = r.firstDate;
      r.days.forEach(function (day) {
        (day.courseList || []).forEach(function (c) { raw.push({ week: r.week, course: c }); });
      });
    });
    if (!raw.length) throw new Error('整学期课表为空或全部请求失败');
    return { raw: raw, startDate: startDate, total: total, okWeeks: okWeeks };
  }

  function normalizeCourses(records) {
    let bad = 0;
    const list = [];
    records.forEach(function (rec) {
      const c = rec.course;
      const day = parseInt(c.weekDay, 10);
      const start = parseInt(c.courseStartTime, 10);
      const num = parseInt(c.courseNum, 10);
      const end = start + num - 1;
      const week = parseInt(rec.week, 10);
      const name = (c.courseName || '').trim();
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1) || !(num >= 1) ||
          !(end >= start) || !(week >= 1) || week > 30) { bad++; return; }
      list.push({ name: name, position: (c.courseRoom || '').trim(), teacher: (c.teachers || '').trim(),
        day: day, startSection: start, endSection: end, weeks: [week] });
    });

    const g1 = new Map();
    list.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!g1.has(k)) g1.set(k, []);
      g1.get(k).push(c);
    });
    let stage1 = [];
    g1.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      const merged = [];
      arr.forEach(function (c) {
        const last = merged[merged.length - 1];
        if (last && last.endSection + 1 === c.startSection) last.endSection = c.endSection;
        else merged.push({ name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() });
      });
      stage1 = stage1.concat(merged);
    });

    const g2 = new Map();
    stage1.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!g2.has(k)) g2.set(k, { name: c.name, position: c.position, teacher: c.teacher, day: c.day,
        startSection: c.startSection, endSection: c.endSection, weeks: [] });
      const set = new Set(g2.get(k).weeks);
      c.weeks.forEach(function (w) { set.add(w); });
      g2.get(k).weeks = Array.from(set).sort(function (a, b) { return a - b; });
    });
    return { courses: Array.from(g2.values()), bad: bad };
  }

  async function runImportFlow() {
    const options = await fetchAcademicOptions();
    const sem = await chooseSemester(options);
    if (!sem) { toast('已取消导入'); return; }

    const ok = await alert('确认导入', '将读取「' + sem.name + '」整学期课表并导入，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    const data = await fetchTermCourses(sem);
    const result = normalizeCourses(data.raw);
    if (!result.courses.length) throw new Error('没有可用课程');

    await saveCourses(result.courses);

    const config = { semesterTotalWeeks: data.total, firstDayOfWeek: 1 };
    if (data.startDate) config.semesterStartDate = data.startDate;
    try { await BP.saveCourseConfig(JSON.stringify(config)); } catch (e) {}

    try { await BP.savePresetTimeSlots(JSON.stringify(TIME_SLOTS)); } catch (e) {}

    toast('已导入 ' + result.courses.length + ' 门课（覆盖 ' + data.okWeeks + ' 周）');
    finish();
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
