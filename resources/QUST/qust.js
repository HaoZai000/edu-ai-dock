/* 青岛科技大学 bsdt 教务适配器
 * 课表接口：GET /api/v1/newJw/studentCourse/list?jsdm=xs&ksrq=YYYY-MM-DD&jsrq=YYYY-MM-DD
 * 返回字段：xqj(星期) nyr(上课日期) sjd(节次"5-8") kcmc(课程名) jsmc(地点) jsxm(教师)
 * 该系统没有学年学期下拉框，按学期日期区间取数；周次由上课日期相对第一周周一推算。
 */
(async function main() {
  const COURSE_API = '/api/v1/newJw/studentCourse/list';

  // 学校作息固定 10 节（教务不提供作息接口）
  const TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:45' },
    { number: 4, startTime: '10:55', endTime: '11:40' },
    { number: 5, startTime: '13:30', endTime: '14:15' },
    { number: 6, startTime: '14:25', endTime: '15:10' },
    { number: 7, startTime: '15:30', endTime: '16:15' },
    { number: 8, startTime: '16:25', endTime: '17:10' },
    { number: 9, startTime: '18:00', endTime: '18:45' },
    { number: 10, startTime: '18:55', endTime: '19:40' }
  ];
  const CLASS_MINUTES = 45;
  const BREAK_MINUTES = 10;

  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function ui(name) {
    if (BP && typeof BP[name] === 'function') return BP[name].bind(BP);
    if (BD && typeof BD[name] === 'function') return BD[name].bind(BD);
    return null;
  }

  function toast(msg) {
    const f = ui('showToast');
    if (f) { try { f(msg); } catch (e) {} }
  }

  async function alert(title, content, confirmText) {
    const f = ui('showAlert');
    if (!f) return true;
    return (await f(title, content, confirmText || '确定')) !== false;
  }

  async function select(title, labels, def) {
    const f = ui('showSingleSelection');
    if (!f) throw new Error('桥未就绪，请重试');
    return await f(title, JSON.stringify(labels), def);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function mondayOf(dateStr) {
    const d = new Date(String(dateStr) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const wd = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - wd);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function buildSemesterOptions() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const curStartYear = m >= 8 ? y : y - 1;
    const options = [];
    for (let i = 0; i < 3; i++) {
      const sy = curStartYear - i;
      options.push({
        label: sy + '-' + (sy + 1) + ' 学年 秋季学期',
        from: sy + '-08-01',
        to: (sy + 1) + '-02-15'
      });
      options.push({
        label: sy + '-' + (sy + 1) + ' 学年 春季学期',
        from: (sy + 1) + '-02-16',
        to: (sy + 1) + '-08-31'
      });
    }
    const defaultIndex = (m >= 8 || m === 1) ? 0 : 1;
    return { options: options, defaultIndex: defaultIndex };
  }

  function fetchAcademicOptions() {
    const sel = document.querySelector('#xnm, #xnd, select[name="xnm"], select[name="xnd"]');
    if (sel && sel.options && sel.options.length > 1) {
      const options = [];
      let defaultIndex = 0;
      for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        if (!o.value) continue;
        if (o.selected) defaultIndex = options.length;
        options.push({ label: o.textContent.trim(), code: o.value });
      }
      if (options.length) return { options: options, defaultIndex: defaultIndex };
    }
    return buildSemesterOptions();
  }

  async function chooseSemester(opt) {
    let idx = opt.defaultIndex;
    // 只有一个选项时直接使用，避免多余的选择交互
    if (opt.options.length > 1) {
      const r = await select('选择要导入的学期', opt.options.map(function (o) { return o.label; }), opt.defaultIndex);
      if (r === null || r === undefined || Number(r) < 0 || !opt.options[Number(r)]) return null;
      idx = Number(r);
    }
    return opt.options[idx] || null;
  }

  async function fetchCourses(from, to) {
    const url = COURSE_API + '?jsdm=xs&ksrq=' + encodeURIComponent(from) + '&jsrq=' + encodeURIComponent(to);
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('课表接口返回 ' + res.status);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) {
      throw new Error('课表接口数据结构异常：' + ((json && json.message) || '无 data 字段'));
    }
    return json.data;
  }

  function parseSections(sjd) {
    const s = String(sjd || '').trim();
    const m = s.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
    const single = s.match(/^(\d+)$/);
    if (single) {
      const n = parseInt(single[1], 10);
      return { start: n, end: n };
    }
    return null;
  }

  function sameWeeks(a, b) {
    if (a.size !== b.size) return false;
    let ok = true;
    a.forEach(function (w) { if (!b.has(w)) ok = false; });
    return ok;
  }

  function normalizeCourses(list) {
    const dates = list.map(function (it) { return it && it.nyr; }).filter(Boolean).sort();
    if (!dates.length) return { courses: [], skipped: 0, firstMonday: null };
    const firstMonday = mondayOf(dates[0]);
    if (!firstMonday) return { courses: [], skipped: 0, firstMonday: null };

    let skipped = 0;
    const byKey = new Map();

    list.forEach(function (it) {
      if (!it) { skipped++; return; }
      const name = String(it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const sec = parseSections(it.sjd);
      const mon = mondayOf(it.nyr);
      if (!name || !(day >= 1 && day <= 7) || !sec || !mon) { skipped++; return; }
      if (sec.start < 1 || sec.end < sec.start) { skipped++; return; }
      const week = Math.round((mon.getTime() - firstMonday.getTime()) / 604800000) + 1;
      if (!(week >= 1 && week <= 30)) { skipped++; return; }

      const position = String(it.jsmc || '').trim();
      const teacher = String(it.jsxm || '').trim();
      const key = [name, teacher, position, day, sec.start, sec.end].join('|');
      if (!byKey.has(key)) {
        byKey.set(key, {
          name: name, teacher: teacher, position: position, day: day,
          startSection: sec.start, endSection: sec.end, weeks: new Set([week])
        });
      } else {
        byKey.get(key).weeks.add(week);
      }
    });

    const groups = new Map();
    byKey.forEach(function (c) {
      const gk = [c.name, c.teacher, c.position, c.day].join('|');
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(c);
    });

    const merged = [];
    groups.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      arr.forEach(function (c) {
        if (cur && c.startSection === cur.endSection + 1 && sameWeeks(cur.weeks, c.weeks)) {
          cur.endSection = c.endSection;
        } else {
          if (cur) merged.push(cur);
          cur = {
            name: c.name, teacher: c.teacher, position: c.position, day: c.day,
            startSection: c.startSection, endSection: c.endSection, weeks: new Set(c.weeks)
          };
        }
      });
      if (cur) merged.push(cur);
    });

    const courses = merged.map(function (c) {
      return {
        name: c.name,
        position: c.position,
        teacher: c.teacher,
        day: c.day,
        startSection: c.startSection,
        endSection: c.endSection,
        weeks: Array.from(c.weeks).sort(function (a, b) { return a - b; })
      };
    }).filter(function (c) { return c.weeks.length > 0; });

    courses.sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      return a.startSection - b.startSection;
    });

    return { courses: courses, skipped: skipped, firstMonday: firstMonday };
  }

  async function runImportFlow() {
    const opt = fetchAcademicOptions();
    const sem = await chooseSemester(opt);
    if (!sem) { toast('已取消，未导入'); return; }

    const raw = await fetchCourses(sem.from, sem.to);
    const result = normalizeCourses(raw);
    if (!result.courses.length) throw new Error('未从课表接口解析到课程，请确认该学期是否有课');

    let tip = '学期：' + sem.label + '\n课程：' + result.courses.length + ' 条';
    if (result.skipped) tip += '（跳过 ' + result.skipped + ' 条异常记录）';
    if (result.firstMonday) tip += '\n开学日期：' + fmtDate(result.firstMonday);
    tip += '\n作息：' + TIME_SLOTS.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (result.firstMonday) {
      try {
        await BP.saveCourseConfig(JSON.stringify({
          semesterStartDate: fmtDate(result.firstMonday),
          defaultClassDuration: CLASS_MINUTES,
          defaultBreakDuration: BREAK_MINUTES
        }));
      } catch (e) {
        configFailed = true;
      }
    }
    let slotsFailed = false;
    try {
      await BP.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    } catch (e) {
      slotsFailed = true;
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + result.courses.length + ' 门课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常记录' : '') +
      (configFailed ? '（开学日期未保存）' : '') +
      (slotsFailed ? '（作息未保存）' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
