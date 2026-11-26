(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') {
      try { BD.showToast(msg); return; } catch (e) { return; }
    }
    try {
      const r = BP && typeof BP.showToast === 'function' ? BP.showToast(msg) : null;
      if (r && typeof r.catch === 'function') r.catch(function () {});
    } catch (e) {}
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  // 只有一个选项时直接使用，不再弹选择框
  async function select(title, labels, def) {
    if (!labels.length) throw new Error('未找到可选项：' + title);
    if (labels.length === 1) return 0;
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const picked = await BP.showSingleSelection(title, JSON.stringify(labels), def);
    if (picked === null || picked === undefined || picked === -1) return null;
    const n = Number(picked);
    if (!isFinite(n) || n < 0) return null;
    return n < labels.length ? n : def;
  }

  async function saveCourses(courses) {
    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const ok = await BP.saveImportedCourses(JSON.stringify(courses));
    if (ok === false || ok === 'false' || ok === null) throw new Error('课程保存失败');
  }

  function finish() {
    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    }
  }

  const BASE = location.origin + '/eams';

  async function request(path, body) {
    const opt = { method: body ? 'POST' : 'GET', credentials: 'same-origin' };
    if (body) {
      opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
      opt.body = body;
    }
    const r = await fetch(BASE + path, opt);
    if (!r.ok) throw new Error(path + ' 请求失败（HTTP ' + r.status + '），请重新登录教务系统');
    return await r.text();
  }

  async function fetchAcademicOptions() {
    const page = await request('/courseTableForStd.action');
    const idm = page.match(/addInput\(form,\s*["']ids["'],\s*["'](\d+)["']\)/);
    const sm = page.match(/semesterCalendar\(\{[^}]*?value:\s*["']?(\d+)["']?/);
    const tagm = page.match(/id=["'](semesterBar\w*Semester)["']/);
    const ids = idm ? idm[1] : '';
    const currentId = sm ? sm[1] : '';
    const tagId = tagm ? tagm[1] : '';
    if (!ids) throw new Error('未获取到学生课表标识 ids');
    if (!tagId) throw new Error('未获取到学期选择标识');

    const txt = await request('/dataQuery.action',
      'tagId=' + encodeURIComponent(tagId) + '&dataType=semesterCalendar&value=' + encodeURIComponent(currentId) + '&empty=false');
    const list = [];
    const re = /\{id:\s*(\d+)\s*,\s*schoolYear:\s*"([^"]*)"\s*,\s*name:\s*"([^"]*)"\s*\}/g;
    let m, def = 0;
    while ((m = re.exec(txt)) !== null) {
      const sid = m[1];
      const label = m[2] + '学年第' + m[3] + '学期';
      if (currentId && sid === currentId) def = list.length;
      list.push({ id: sid, label: label });
    }
    if (!list.length) throw new Error('未解析到学期列表');
    return { options: list.map(function (x) { return x.label; }), defaultIndex: def, ids: ids, semesters: list };
  }

  async function chooseSemester(meta) {
    const idx = await select('选择要导入的学期', meta.options, meta.defaultIndex);
    if (idx === null) return null;
    const s = meta.semesters[idx];
    if (!s) throw new Error('学期选择无效');
    return s;
  }

  // EAMS 周次为位串：第 i 位为 1 表示第 i 周有效，周次限制在 1..30
  function parseWeeks(s) {
    const out = [];
    if (typeof s !== 'string') return out;
    for (let i = 1; i < s.length; i++) {
      if (s.charAt(i) !== '1') continue;
      if (i >= 1 && i <= 30) out.push(i);
    }
    return out;
  }

  function parseTable(html) {
    const scripts = [];
    const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) scripts.push(m[1]);
    const body = scripts.find(function (s) { return s.indexOf('new CourseTable') >= 0; });
    if (!body) throw new Error('课表响应中没有课程数据脚本');

    function TaskActivity(teacherId, teacherName, courseId, courseName, roomId, roomName, vaildWeeks) {
      this.teacherId = teacherId; this.teacherName = teacherName;
      this.courseId = courseId; this.courseName = courseName;
      this.roomId = roomId; this.roomName = roomName; this.vaildWeeks = vaildWeeks;
    }
    const store = {};
    const activities = new Proxy(store, {
      get: function (t, p) { if (!(p in t)) t[p] = []; return t[p]; }
    });
    function CourseTable(year, unitCounts) {
      this.year = year; this.unitCounts = unitCounts; this.activities = activities;
      this.marshalTable = function () {};
    }
    const us = {
      where: function (arr, attrs) { return arr.filter(function (o) { return Object.keys(attrs).every(function (k) { return String(o[k]) === String(attrs[k]); }); }); },
      filter: function (arr, fn) { return arr.filter(fn); },
      reject: function (arr, fn) { return arr.filter(function (x) { return !fn(x); }); },
      mixin: function () {}, str: { exports: function () { return {}; } }
    };
    const noopJq = function () { return { prop: function () { return this; }, val: function () { return this; } }; };
    const runner = new Function('TaskActivity', 'CourseTable', '_', 'fillTable', 'alert', 'jQuery', '$',
      body + '\n;return typeof table0 !== "undefined" ? table0 : null;');
    runner(TaskActivity, CourseTable, us, function () {}, function () {}, noopJq, noopJq);

    const byAct = new Map();
    Object.keys(store).forEach(function (k) {
      const idx = Number(k);
      if (!Number.isInteger(idx)) return;
      const day = Math.floor(idx / 10) + 1;
      const sec = (idx % 10) + 1;
      (store[k] || []).forEach(function (act) {
        if (!act) return;
        let e = byAct.get(act);
        if (!e) { e = { act: act, days: new Set(), sections: [] }; byAct.set(act, e); }
        e.days.add(day); e.sections.push(sec);
      });
    });

    const raw = [];
    byAct.forEach(function (e) {
      const a = e.act;
      if (!a.roomName || a.roomName === '停课' || String(a.roomId) === '-1') return;
      const name = String(a.courseName || '').replace(/\([^()]*\)\s*$/, '').trim();
      const weeks = parseWeeks(a.vaildWeeks);
      if (!name || weeks.length === 0 || e.days.size !== 1) return;
      const secs = e.sections.slice().sort(function (x, y) { return x - y; });
      raw.push({
        name: name,
        position: String(a.roomName || ''),
        teacher: String(a.teacherName || ''),
        day: Array.from(e.days)[0],
        startSection: secs[0],
        endSection: secs[secs.length - 1],
        weeks: weeks
      });
    });
    return raw;
  }

  function parseTotalWeeks(html) {
    const m = html.match(/marshalTable\(\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*\)/);
    return m ? Number(m[1]) : 0;
  }

  function sameWeeks(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every(function (x) { return s.has(x); });
  }

  function normalizeCourses(raw) {
    let skipped = 0;
    const valid = [];
    raw.forEach(function (c) {
      if (!c.name || !(c.day >= 1 && c.day <= 7) || !Number.isInteger(c.startSection) ||
          !Number.isInteger(c.endSection) || c.startSection < 1 || c.endSection < c.startSection ||
          c.endSection > 20 || !Array.isArray(c.weeks) || c.weeks.length === 0) { skipped++; return; }
      valid.push(c);
    });

    const stage1 = [];
    valid.forEach(function (c) {
      let done = false;
      for (let i = 0; i < stage1.length; i++) {
        const x = stage1[i];
        if (x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
            x.day === c.day && sameWeeks(x.weeks, c.weeks)) {
          if (c.startSection === x.endSection + 1) { x.endSection = c.endSection; done = true; break; }
          if (c.endSection === x.startSection - 1) { x.startSection = c.startSection; done = true; break; }
        }
      }
      if (!done) stage1.push({
        name: c.name, teacher: c.teacher, position: c.position, day: c.day,
        startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
      });
    });

    const out = [];
    stage1.forEach(function (c) {
      let done = false;
      for (let i = 0; i < out.length; i++) {
        const x = out[i];
        if (x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
            x.day === c.day && x.startSection === c.startSection && x.endSection === c.endSection) {
          const s = new Set(x.weeks.concat(c.weeks));
          x.weeks = Array.from(s).sort(function (a, b) { return a - b; });
          done = true; break;
        }
      }
      if (!done) out.push(c);
    });
    return { courses: out, skipped: skipped };
  }

  async function runImportFlow() {
    const meta = await fetchAcademicOptions();
    const sem = await chooseSemester(meta);
    if (!sem) { toast('已取消，未导入'); return; }

    toast('正在读取课表…');
    const html = await request('/courseTableForStd!courseTable.action',
      'ignoreHead=1&setting.kind=std&startWeek=&semester.id=' + encodeURIComponent(sem.id) +
      '&ids=' + encodeURIComponent(meta.ids));

    const raw = parseTable(html);
    const result = normalizeCourses(raw);
    if (!result.courses.length) {
      throw new Error('课程解析结果为空（原始 ' + raw.length + ' 条，异常 ' + result.skipped + ' 条）');
    }

    const totalWeeks = parseTotalWeeks(html);
    let tip = '学期：' + sem.label + '，课程 ' + result.courses.length + ' 条';
    if (result.skipped) tip += '，跳过 ' + result.skipped + ' 条信息不全';
    if (totalWeeks > 0) tip += '，共 ' + totalWeeks + ' 周';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    await saveCourses(result.courses);

    let cfgFailed = false;
    if (totalWeeks > 0) {
      try {
        if (BP && typeof BP.saveCourseConfig === 'function') {
          const r = await BP.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: totalWeeks }));
          if (r === false || r === 'false' || r === null) cfgFailed = true;
        }
      } catch (e) {
        cfgFailed = true;
      }
    }

    toast('已导入 ' + result.courses.length + ' 条课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常' : '') +
      (cfgFailed ? '（学期配置未保存）' : ''));
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
