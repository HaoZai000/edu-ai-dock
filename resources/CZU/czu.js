(async function main() {
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

  async function choose(title, labels, def) {
    if (labels.length === 1) return 0;
    const f = ui('showSingleSelection');
    if (!f) throw new Error('当前环境不支持选择');
    const r = await f(title, JSON.stringify(labels), def);
    if (r === null || r === undefined || r === -1) return -1;
    const n = Number(r);
    return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
  }

  const KB_URL = (function () {
    const m = location.pathname.match(/^\/http\/[^/]+\//);
    return location.origin + (m ? m[0] : '') + 'web_jxrw/cx_kb_xsgrkb.aspx';
  })();

  async function fetchGetHtml() {
    const res = await fetch(KB_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表页请求失败(' + res.status + ')，请先登录');
    return await res.text();
  }

  function val(doc, name) {
    const e = doc.querySelector('input[name="' + name + '"]');
    return e ? String(e.value || '') : '';
  }

  function parsePage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#DDxq');
    const options = [];
    let defaultIndex = 0;
    let selectedValue = '';
    if (sel) {
      const opts = Array.from(sel.querySelectorAll('option'));
      opts.forEach(function (o, i) {
        options.push({ text: String(o.textContent || '').trim(), value: String(o.value || '') });
        if (o.hasAttribute && o.hasAttribute('selected')) defaultIndex = i;
      });
      selectedValue = String(sel.value || '');
      if (selectedValue) {
        const i = options.findIndex(function (o) { return o.value === selectedValue; });
        if (i >= 0) defaultIndex = i;
      }
    }
    return {
      doc: doc,
      options: options,
      defaultIndex: defaultIndex,
      selectedValue: selectedValue,
      viewstate: val(doc, '__VIEWSTATE'),
      viewstategen: val(doc, '__VIEWSTATEGENERATOR'),
      txtbj: val(doc, 'Txtbj'),
      txtxm: val(doc, 'Txtxm')
    };
  }

  async function fetchAcademicOptions() {
    return parsePage(await fetchGetHtml());
  }

  async function chooseSemester(page) {
    if (!page.options.length) throw new Error('未找到学期下拉框，请先登录');
    const idx = await choose('选择学期', page.options.map(function (o) { return o.text; }), page.defaultIndex);
    if (idx < 0) return null;
    return page.options[idx].value;
  }

  async function fetchCoursesForSemester(page, target) {
    if (!target || target === page.selectedValue) return page.doc;
    const body = new URLSearchParams();
    body.set('__EVENTTARGET', '');
    body.set('__EVENTARGUMENT', '');
    body.set('__VIEWSTATE', page.viewstate);
    body.set('__VIEWSTATEGENERATOR', page.viewstategen);
    body.set('__SCROLLPOSITIONX', '0');
    body.set('__SCROLLPOSITIONY', '0');
    body.set('__VIEWSTATEENCRYPTED', '');
    body.set('DDxq', target);
    body.set('Btcx', '查询');
    body.set('Txtbj', page.txtbj);
    body.set('Txtxm', page.txtxm);
    body.set('TextBox1', '');

    const res = await fetch(KB_URL, {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error('课表查询失败(' + res.status + ')，请确认已登录');
    const np = parsePage(await res.text());
    if (np.selectedValue !== target) throw new Error('学期切换未生效，请重新登录后重试');
    return np.doc;
  }

  function parseTeacherMap(doc) {
    const map = {};
    const tbl = doc.querySelector('#GVxkall');
    if (!tbl) return map;
    const rows = Array.from(tbl.querySelectorAll('tr'));
    for (let i = 1; i < rows.length; i++) {
      const tds = Array.from(rows[i].querySelectorAll('td'));
      if (tds.length < 6) continue;
      const name = String(tds[1].textContent || '').replace(/\u00a0/g, ' ').trim();
      const teacher = String(tds[5].textContent || '').replace(/\u00a0/g, ' ').trim();
      if (name) map[name] = teacher;
    }
    return map;
  }

  function expandWeeks(expr) {
    const out = new Set();
    String(expr || '').split(',').forEach(function (part) {
      const p = part.trim();
      if (!p) return;
      const r = p.match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
      if (r) {
        const a = Number(r[1]);
        const b = Number(r[2]);
        for (let w = Math.min(a, b); w <= Math.max(a, b) && w <= 30; w++) if (w >= 1) out.add(w);
        return;
      }
      const n = p.match(/^\d+$/);
      if (n) {
        const w = Number(p);
        if (w >= 1 && w <= 30) out.add(w);
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function parseCell(text, day, section, teacherMap) {
    const clean = String(text || '').replace(/\u00a0/g, ' ').trim();
    if (!clean) return [];
    const out = [];
    clean.split('/').forEach(function (rec) {
      const r = rec.replace(/\u00a0/g, ' ').trim().replace(/[,，]$/, '');
      if (!r) return;
      const wm = r.match(/^(.*?)\s+([0-9][0-9,\-]*)$/);
      if (!wm) return;
      const head = wm[1].trim();
      const weeks = expandWeeks(wm[2]);
      let name = head;
      let position = '';
      const lastSpace = head.lastIndexOf(' ');
      if (lastSpace > 0) {
        name = head.slice(0, lastSpace).trim();
        position = head.slice(lastSpace + 1).trim();
      }
      if (!name || !weeks.length) return;
      out.push({
        name: name,
        position: position,
        teacher: teacherMap[name] || '',
        day: day,
        startSection: section,
        endSection: section,
        weeks: weeks
      });
    });
    return out;
  }

  function parseKB(doc, teacherMap) {
    const tbl = doc.querySelector('#GVxkkb');
    if (!tbl) return [];
    const rows = Array.from(tbl.querySelectorAll('tr'));
    const raw = [];
    rows.forEach(function (row) {
      const tds = Array.from(row.querySelectorAll('td'));
      if (tds.length < 8) return;
      const section = parseInt(String(tds[0].textContent || '').trim(), 10);
      if (!(section >= 1 && section <= 12)) return;
      for (let d = 1; d <= 7; d++) {
        const arr = parseCell(tds[d].textContent, d, section, teacherMap);
        arr.forEach(function (c) { raw.push(c); });
      }
    });
    return raw;
  }

  function normalizeCourses(list) {
    const valid = list.filter(function (c) {
      return c.name && c.day >= 1 && c.day <= 7 && c.startSection >= 1 &&
        c.endSection >= c.startSection && c.endSection <= 30 && c.weeks.length > 0;
    });
    let skipped = list.length - valid.length;

    valid.sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });

    const g1 = new Map();
    valid.forEach(function (c) {
      const key = [c.name, c.position, c.teacher, c.day, c.weeks.join(',')].join('|');
      if (!g1.has(key)) g1.set(key, []);
      g1.get(key).push(c);
    });
    const phase1 = [];
    g1.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = Object.assign({}, arr[0]);
      for (let i = 1; i < arr.length; i++) {
        const n = arr[i];
        if (n.startSection === cur.endSection + 1) {
          cur.endSection = n.endSection;
        } else {
          phase1.push(cur);
          cur = Object.assign({}, n);
        }
      }
      phase1.push(cur);
    });

    const g2 = new Map();
    phase1.forEach(function (c) {
      const key = [c.name, c.position, c.teacher, c.day, c.startSection, c.endSection].join('|');
      if (!g2.has(key)) {
        g2.set(key, Object.assign({}, c, { weeks: c.weeks.slice() }));
      } else {
        const keep = g2.get(key);
        keep.weeks = Array.from(new Set(keep.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      }
    });

    const courses = Array.from(g2.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return { courses: courses, skipped: skipped };
  }

  const TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:40' },
    { number: 2, startTime: '08:45', endTime: '09:25' },
    { number: 3, startTime: '09:45', endTime: '10:25' },
    { number: 4, startTime: '10:35', endTime: '11:15' },
    { number: 5, startTime: '11:20', endTime: '12:00' },
    { number: 6, startTime: '13:30', endTime: '14:10' },
    { number: 7, startTime: '14:15', endTime: '14:55' },
    { number: 8, startTime: '15:15', endTime: '15:55' },
    { number: 9, startTime: '16:00', endTime: '16:40' },
    { number: 10, startTime: '18:30', endTime: '19:10' },
    { number: 11, startTime: '19:15', endTime: '19:55' },
    { number: 12, startTime: '20:05', endTime: '20:45' }
  ];

  async function runImportFlow() {
    const go = await alert('导入课表', '将读取所选学期的整学期课程并导入，是否继续？', '继续');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const page = await fetchAcademicOptions();
    const target = await chooseSemester(page);
    if (target === null || target === undefined) {
      toast('已取消，未导入');
      return;
    }

    toast('正在读取课表数据…');
    const doc = await fetchCoursesForSemester(page, target);
    const teacherMap = parseTeacherMap(doc);
    const raw = parseKB(doc, teacherMap);
    const result = normalizeCourses(raw);
    if (!result.courses.length) throw new Error('未解析到课程，课表可能为空或登录已失效');

    const idx = page.options.findIndex(function (o) { return o.value === target; });
    const label = idx >= 0 ? page.options[idx].text : target;
    const confirmed = await alert(
      '确认导入',
      '学期：' + label +
        '\n课程：' + result.courses.length + ' 门' +
        (result.skipped ? '\n跳过异常：' + result.skipped + ' 条' : '') +
        '\n作息：12 节' +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let slotsFailed = false;
    try {
      await BP.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    } catch (e) {
      slotsFailed = true;
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') BD.notifyTaskCompletion();
    toast('导入完成：' + result.courses.length + ' 门课程' +
      (result.skipped ? '，跳过 ' + result.skipped + ' 条异常' : '') +
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
