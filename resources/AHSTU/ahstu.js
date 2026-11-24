// 安徽科技工程大学教务系统（EAMS）整学期课表适配器
(async function main() {
  const BASE = location.origin + '/eams';
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;

  function toast(msg) {
    const b = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
    if (b && typeof b.showToast === 'function') {
      try { b.showToast(msg); } catch (e) {}
      return;
    }
    if (BP && typeof BP.showToast === 'function') {
      try { BP.showToast(msg); } catch (e) {}
    }
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  async function select(title, labels, def) {
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    return await BP.showSingleSelection(title, JSON.stringify(labels), def);
  }

  async function saveOk(name, payload) {
    if (!BP || typeof BP[name] !== 'function') throw new Error('桥未就绪，请重试');
    const r = await BP[name](payload);
    return !(r === false || r === 'false' || r === null);
  }

  async function notifyTaskCompletion() {
    const b = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
    if (b && typeof b.notifyTaskCompletion === 'function') {
      try { b.notifyTaskCompletion(); } catch (e) {}
      return;
    }
    if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
  }

  // 找一个能带上教务会话的 fetch 上下文
  async function resolveFetcher() {
    const cands = [];
    try { if (window.top && window.top.fetch) cands.push(window.top.fetch.bind(window.top)); } catch (e) {}
    try { if (window.parent && window.parent !== window && window.parent.fetch) cands.push(window.parent.fetch.bind(window.parent)); } catch (e) {}
    cands.push(function (u, o) { return fetch(u, o); });
    for (let i = 0; i < cands.length; i++) {
      try {
        const res = await cands[i](BASE + '/courseTableForStd.action', { credentials: 'include', cache: 'no-store' });
        const t = await res.text();
        if (/courseTableForm/.test(t)) return { fn: cands[i], pageHtml: t };
      } catch (e) {}
    }
    return null;
  }

  function makeNet(fn) {
    function postForm(url, params) {
      const body = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]);
      }).join('&');
      return fn(url, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body
      }).then(function (res) {
        if (!res.ok) throw new Error('请求失败 HTTP ' + res.status + ' ' + url);
        return res.text();
      });
    }
    return { postForm: postForm };
  }

  function cleanName(n) {
    if (!n) return '';
    return String(n).replace(/[\(（][A-Za-z0-9]+\.[A-Za-z0-9]+[\)）]\s*$/, '').trim();
  }

  function parseActivities(html) {
    const ucM = html.match(/var\s+unitCount\s*=\s*(\d+)/);
    const unitCount = ucM ? parseInt(ucM[1], 10) : 12;
    const re = /var actTeachers = \[([\s\S]*?)\];|activity = new TaskActivity\(([\s\S]*?)\);|index =(\d+)\*unitCount\+(\d+);/g;
    const raw = [];
    let teachers = [], current = null, m;
    while ((m = re.exec(html))) {
      if (m[1] !== undefined) {
        teachers = [];
        const nr = /name:"([^"]*)"/g; let n;
        while ((n = nr.exec(m[1]))) teachers.push(n[1]);
      } else if (m[2] !== undefined) {
        const pre = m[2].match(/^actTeacherId\.join\('[^']*'\),actTeacherName\.join\('[^']*'\),([\s\S]*)$/);
        const rest = pre ? pre[1] : m[2];
        const strs = []; const sr = /"([^"]*)"/g; let s;
        while ((s = sr.exec(rest))) strs.push(s[1]);
        current = { courseName: strs[1] || '', roomName: strs[3] || '', weeksStr: strs[4] || '', teachers: teachers.slice() };
      } else if (m[3] !== undefined && current) {
        const idx = parseInt(m[3], 10) * unitCount + parseInt(m[4], 10);
        raw.push({
          courseName: current.courseName, roomName: current.roomName,
          weeksStr: current.weeksStr, teachers: current.teachers,
          day: Math.floor(idx / unitCount) + 1, unit: idx % unitCount
        });
      }
    }
    return raw;
  }

  function normalizeCourses(raw) {
    const slotMap = new Map();
    let bad = 0;
    raw.forEach(function (r0) {
      const name = cleanName(r0.courseName);
      const teacher = (r0.teachers || []).join('、');
      const position = String(r0.roomName || '').trim();
      const day = r0.day;
      const weeks = [];
      const ws = r0.weeksStr || '';
      // 周次位图，只取 1-30 周
      for (let i = 0; i < ws.length && i < 30; i++) if (ws[i] === '1') weeks.push(i + 1);
      if (!name || !(day >= 1 && day <= 7) || !weeks.length) { bad++; return; }
      const key = [name, teacher, position, day, weeks.join(',')].join('||');
      let e = slotMap.get(key);
      if (!e) {
        e = { name: name, teacher: teacher, position: position, day: day, weeks: weeks, units: [] };
        slotMap.set(key, e);
      }
      if (e.units.indexOf(r0.unit) < 0) e.units.push(r0.unit);
    });

    const stage1 = [];
    slotMap.forEach(function (e) {
      const units = e.units.slice().sort(function (a, b) { return a - b; });
      const segs = [];
      let start = units[0], prev = units[0];
      for (let i = 1; i < units.length; i++) {
        if (units[i] === prev + 1) { prev = units[i]; continue; }
        segs.push([start, prev]); start = units[i]; prev = units[i];
      }
      segs.push([start, prev]);
      segs.forEach(function (s) {
        stage1.push({
          name: e.name, position: e.position, teacher: e.teacher, day: e.day,
          startSection: s[0] + 1, endSection: s[1] + 1, weeks: e.weeks.slice()
        });
      });
    });

    const mergeMap = new Map();
    stage1.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('||');
      let m = mergeMap.get(key);
      if (!m) {
        m = {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: new Set(c.weeks)
        };
        mergeMap.set(key, m);
      } else {
        c.weeks.forEach(function (w) { m.weeks.add(w); });
      }
    });

    const courses = [];
    mergeMap.forEach(function (m) {
      courses.push({
        name: m.name, position: m.position, teacher: m.teacher, day: m.day,
        startSection: m.startSection, endSection: m.endSection,
        weeks: Array.from(m.weeks).sort(function (a, b) { return a - b; })
      });
    });
    courses.sort(function (a, b) { return a.day - b.day || a.startSection - b.startSection; });
    return { courses: courses, bad: bad };
  }

  async function onlineCourses(net, pageHtml) {
    const idM = pageHtml.match(/addInput\(form,\s*"ids",\s*"(\d+)"\)/);
    if (!idM) throw new Error('未能从课表页解析出学生 ids 参数，请确认已登录教务系统');
    const semIdM = pageHtml.match(/semesterCalendar\(\{[^}]*value:"(\d+)"/);
    const currentSemesterId = semIdM ? semIdM[1] : '';
    let maxWeek = 0;
    const weekSel = pageHtml.match(/<select id="startWeek"[\s\S]*?<\/select>/);
    if (weekSel) {
      const wr = /value="(\d+)"/g; let w;
      while ((w = wr.exec(weekSel[0]))) maxWeek = Math.max(maxWeek, parseInt(w[1], 10));
    }

    let semTxt = '';
    try {
      semTxt = await net.postForm(BASE + '/dataQuery.action', { dataType: 'semesterCalendar', tagId: 'semesterBar', entityId: '', empty: 'false' });
    } catch (e) {}
    const semesters = [];
    const re = /\{id:(\d+),schoolYear:"([^"]*)",name:"([^"]*)"\}/g; let m;
    while ((m = re.exec(semTxt))) semesters.push({ id: m[1], label: m[2] + '学年 第' + m[3] + '学期' });
    if (!semesters.length) semesters.push({ id: currentSemesterId, label: '当前学期' });
    let defaultIndex = 0;
    for (let i = 0; i < semesters.length; i++) {
      if (semesters[i].id === currentSemesterId) { defaultIndex = i; break; }
    }

    let idx;
    // 只有一个学期时直接使用，避免多余的选择交互
    if (semesters.length === 1) {
      idx = 0;
    } else {
      const labels = semesters.map(function (s) { return s.label; });
      const picked = await select('选择要导入的学年学期', labels, defaultIndex);
      if (picked === null || picked === undefined) return null;
      idx = Number(picked);
      if (!Number.isInteger(idx) || idx < 0 || idx >= semesters.length) return null;
    }
    const sem = semesters[idx];

    const html = await net.postForm(BASE + '/courseTableForStd!courseTable.action', {
      ignoreHead: '1', 'setting.kind': 'std', startWeek: '', 'semester.id': sem.id, ids: idM[1]
    });
    if (!/new TaskActivity/.test(html)) throw new Error('该学期课表未返回排课数据（可能未选课或未开放）');
    const raw = parseActivities(html);
    const normalized = normalizeCourses(raw);
    let totalWeeks = maxWeek;
    normalized.courses.forEach(function (c) {
      c.weeks.forEach(function (w) { if (w > totalWeeks) totalWeeks = w; });
    });
    return { courses: normalized.courses, bad: normalized.bad, rawCount: raw.length, totalWeeks: totalWeeks, label: sem.label };
  }

  async function runImportFlow() {
    const fetcher = await resolveFetcher();
    if (!fetcher) throw new Error('脚本沙箱无法携带教务会话访问课表接口，请确认已登录教务系统后重试');

    toast('正在读取课表…');
    const net = makeNet(fetcher.fn);
    const result = await onlineCourses(net, fetcher.pageHtml);
    if (!result) { toast('已取消，未导入'); return; }
    if (!result.courses.length) throw new Error('未解析到有效课程，请确认该学期已排课');

    let tip = '学期：' + result.label + '\n课程：' + result.courses.length + ' 条';
    if (result.bad) tip += '\n跳过：' + result.bad + ' 条信息不全的记录';
    if (result.totalWeeks > 0) tip += '\n教学周：' + result.totalWeeks + ' 周';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    const saved = await saveOk('saveImportedCourses', JSON.stringify(result.courses));
    if (!saved) throw new Error('课程保存失败');

    let configFailed = false;
    if (result.totalWeeks > 0) {
      // 只写接口推导出的真实总周数，不设置星期基准
      try {
        configFailed = !(await saveOk('saveCourseConfig', JSON.stringify({ semesterTotalWeeks: result.totalWeeks })));
      } catch (e) { configFailed = true; }
    }

    await notifyTaskCompletion();
    toast('已导入 ' + result.courses.length + ' 条课程' +
      (result.bad ? '，跳过 ' + result.bad + ' 条异常' : '') +
      (configFailed ? '（教学周未保存）' : ''));
  }

  try {
    await runImportFlow();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
