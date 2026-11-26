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
    if (picked === null || picked === undefined) return null;
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

  const BASE = location.origin + '/hbkjjw';
  const DROPLIST_PATH = '/frame/droplist/getDropLists.action';
  const YEARTERM_PATH = '/jw/common/showYearTerm.action';
  const SCHEDULE_PATH = '/frame/desk/showLessonScheduleDetail.action';
  const DROPLIST_BODY = 'comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=';

  async function post(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body || ''
    });
    if (!res.ok) throw new Error('接口请求失败（HTTP ' + res.status + '）');
    return await res.text();
  }

  function parseWeeks(text) {
    const weeks = {};
    String(text || '').split(/[,，、;；]/).forEach(function (segment) {
      const onlyOdd = segment.indexOf('单') >= 0;
      const onlyEven = segment.indexOf('双') >= 0;
      const s = segment.replace(/[第周（）()单双]/g, '');
      const re = /(\d{1,2})\s*(?:[-—~至]\s*(\d{1,2}))?/g;
      let m;
      while ((m = re.exec(s))) {
        let a = parseInt(m[1], 10);
        let b = m[2] ? parseInt(m[2], 10) : a;
        if (isNaN(a) || isNaN(b)) continue;
        if (b < a) { const t = a; a = b; b = t; }
        for (let w = Math.max(1, a); w <= b && w <= 30; w++) {
          if (onlyOdd && w % 2 === 0) continue;
          if (onlyEven && w % 2 === 1) continue;
          weeks[w] = true;
        }
      }
    });
    return Object.keys(weeks).map(Number).sort(function (x, y) { return x - y; });
  }

  // 单元格内可能用 <br> / <li> 分隔多门课，替换为换行后读取 textContent
  function cellLines(cell) {
    const copy = cell.cloneNode(true);
    const doc = cell.ownerDocument || document;
    Array.prototype.forEach.call(copy.querySelectorAll('br'), function (br) {
      br.parentNode.replaceChild(doc.createTextNode('\n'), br);
    });
    Array.prototype.forEach.call(copy.querySelectorAll('li,div,p'), function (el) {
      el.appendChild(doc.createTextNode('\n'));
    });
    return String(copy.textContent || '').replace(/\u00a0/g, ' ').split(/\n+/)
      .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function parseScheduleHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.prototype.slice.call(doc.querySelectorAll('tr'));
    const list = [];
    const slotMap = {};
    let totalWeeks = 0;
    const wm = (doc.body.textContent || '').replace(/\s+/g, ' ').match(/周次\s*[：:]\s*(\d+)\s*[-~—]\s*(\d+)/);
    if (wm) {
      const n = parseInt(wm[2], 10);
      if (n >= 1 && n <= 30) totalWeeks = n;
    }
    rows.forEach(function (row) {
      const tds = Array.prototype.slice.call(row.querySelectorAll('td'));
      let sIdx = -1, sec = 0, st = '', et = '';
      for (let i = 0; i < tds.length; i++) {
        const cls = tds[i].className || '';
        if (cls.indexOf('kb-content') < 0 || cls.indexOf('have-content') >= 0) continue;
        const txt = (tds[i].textContent || '').replace(/\s+/g, '');
        const m = txt.match(/(\d{1,2})\((\d{2}:\d{2})-(\d{2}:\d{2})\)/);
        if (m) { sIdx = i; sec = parseInt(m[1], 10); st = m[2]; et = m[3]; break; }
      }
      if (sIdx < 0 || sec < 1 || sec > 20) return;
      slotMap[sec] = { number: sec, startTime: st, endTime: et };
      for (let d = 1; d <= 7 && (sIdx + d) < tds.length; d++) {
        const cell = tds[sIdx + d];
        if ((cell.className || '').indexOf('have-content') < 0) continue;
        cellLines(cell).forEach(function (line) {
          const m = line.match(/^(.+?)\s+(\S+)\(([^)]*)\)\s*$/);
          if (!m) return;
          const name = m[1].trim();
          const teacher = m[2].trim();
          const inner = m[3].trim();
          if (!name) return;
          const sp = inner.indexOf(' ');
          const weekStr = sp < 0 ? inner : inner.slice(0, sp);
          const position = sp < 0 ? '' : inner.slice(sp + 1).trim();
          const weeks = parseWeeks(weekStr);
          if (!weeks.length) return;
          list.push({
            name: name, position: position, teacher: teacher, day: d,
            startSection: sec, endSection: sec, weeks: weeks
          });
        });
      }
    });
    const slots = Object.keys(slotMap).map(function (k) { return slotMap[k]; })
      .sort(function (a, b) { return a.number - b.number; });
    return { list: list, slots: slots, totalWeeks: totalWeeks };
  }

  function normalizeCourses(list) {
    const good = [];
    let bad = 0;
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!c || !c.name || !(c.day >= 1 && c.day <= 7) ||
          !(c.startSection >= 1 && c.startSection <= 20) ||
          !(c.endSection >= c.startSection && c.endSection <= 20) ||
          !c.weeks || !c.weeks.length) { bad++; return; }
      good.push(c);
    });

    const map = new Map();
    good.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map.has(key)) map.set(key, { c: c, weeks: new Set(c.weeks) });
      else c.weeks.forEach(function (w) { map.get(key).weeks.add(w); });
    });
    const flat = [];
    map.forEach(function (v) {
      flat.push({
        name: v.c.name, position: v.c.position, teacher: v.c.teacher,
        day: v.c.day, startSection: v.c.startSection, endSection: v.c.endSection,
        weeks: Array.from(v.weeks).sort(function (a, b) { return a - b; })
      });
    });
    flat.sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    const out = [];
    flat.forEach(function (c) {
      const prev = out[out.length - 1];
      if (prev && prev.name === c.name && prev.teacher === c.teacher && prev.position === c.position &&
          prev.day === c.day && prev.endSection + 1 === c.startSection &&
          prev.weeks.join(',') === c.weeks.join(',')) {
        prev.endSection = c.endSection;
      } else {
        out.push(Object.assign({}, c));
      }
    });
    return { list: out, bad: bad };
  }

  async function fetchSemesterOptions() {
    const dl = await post(DROPLIST_PATH, DROPLIST_BODY);
    let opts = [];
    try {
      const arr = JSON.parse(dl);
      if (Array.isArray(arr)) {
        opts = arr.filter(function (o) { return o && o.code != null; })
          .map(function (o) { return { code: String(o.code), name: String(o.name || o.code) }; });
      }
    } catch (e) {}
    if (!opts.length) throw new Error('未获取到学年学期选项，请重新登录教务系统');

    let cur = '';
    try {
      const yt = await post(YEARTERM_PATH, '');
      const y = JSON.parse(yt);
      if (y && y.xn != null && y.xqM != null) cur = y.xn + '-' + y.xqM;
    } catch (e) {}

    let def = 0;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].code === cur) { def = i; break; }
    }
    return { opts: opts, def: def };
  }

  async function runImportFlow() {
    const ac = await fetchSemesterOptions();
    const pi = await select('选择学年学期', ac.opts.map(function (o) { return o.name; }), ac.def);
    if (pi === null) { toast('已取消，未导入'); return; }
    const sem = ac.opts[pi];
    if (!sem || !sem.code) throw new Error('学年学期选择无效');

    toast('正在读取课表…');
    const html = await post(SCHEDULE_PATH, 'weeks=&xnxq=' + encodeURIComponent(sem.code));
    if (!html) throw new Error('课表接口无响应（可能登录已失效）');

    const parsed = parseScheduleHtml(html);
    const normalized = normalizeCourses(parsed.list);
    if (!normalized.list.length) {
      throw new Error('课程解析结果为空（原始 ' + parsed.list.length + ' 条，异常 ' + normalized.bad + ' 条）');
    }

    let tip = '学期：' + sem.name + '，课程 ' + normalized.list.length + ' 条';
    if (normalized.bad) tip += '，跳过 ' + normalized.bad + ' 条信息不全';
    if (parsed.slots.length) tip += '，作息 ' + parsed.slots.length + ' 节';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    await saveCourses(normalized.list);

    if (parsed.totalWeeks > 0 && BP && typeof BP.saveCourseConfig === 'function') {
      const r = await BP.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: parsed.totalWeeks }));
      if (r === false || r === 'false' || r === null) throw new Error('课表配置保存失败');
    }

    let slotsFailed = false;
    if (parsed.slots.length) {
      try {
        if (BP && typeof BP.savePresetTimeSlots === 'function') {
          const r = await BP.savePresetTimeSlots(JSON.stringify(parsed.slots));
          if (r === false || r === 'false' || r === null) slotsFailed = true;
        }
      } catch (e) {
        slotsFailed = true;
      }
    }

    toast('已导入 ' + normalized.list.length + ' 条课程' +
      (normalized.bad ? '，跳过 ' + normalized.bad + ' 条异常' : '') +
      (slotsFailed ? '（作息未保存）' : ''));
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
