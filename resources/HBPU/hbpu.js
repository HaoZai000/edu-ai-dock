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
  const KB_PAGE = BASE + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default';
  const API_KB  = BASE + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508';
  const API_RJC = BASE + '/kbcx/xskbcx_cxRjc.html?gnmkdm=N253508';

  function postForm(url, params) {
    const body = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); })
      .join('&');
    return fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('非JSON响应'); } });
  }

  function parseWeeks(raw) {
    if (!raw) return [];
    const set = new Set();
    String(raw).split(/[,，、;；]/).forEach(function (part) {
      part = String(part).trim();
      if (!part) return;
      let parity = 0;
      if (/单/.test(part)) parity = 1; else if (/双/.test(part)) parity = 2;
      const cleaned = part.replace(/[（(][^）)]*[）)]/g, '').replace(/第/g, '').replace(/周/g, '').trim();
      const range = cleaned.match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
      if (range) {
        let a = parseInt(range[1], 10);
        let b = parseInt(range[2], 10);
        if (a > b) { const t = a; a = b; b = t; }
        for (let w = Math.max(a, 1); w <= Math.min(b, 30); w++) {
          if (parity === 1 && w % 2 === 0) continue;
          if (parity === 2 && w % 2 === 1) continue;
          set.add(w);
        }
      } else {
        const num = cleaned.match(/^(\d+)$/);
        if (num) {
          const w = parseInt(num[1], 10);
          if (w < 1 || w > 30) return;
          if (parity === 1 && w % 2 === 0) return;
          if (parity === 2 && w % 2 === 1) return;
          set.add(w);
        }
      }
    });
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  function parseSection(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = s.match(/^(\d+)\s*[-~至到]\s*(\d+)$/);
    if (m) return { startSection: parseInt(m[1], 10), endSection: parseInt(m[2], 10) };
    const n = s.match(/^(\d+)$/);
    if (n) return { startSection: parseInt(n[1], 10), endSection: parseInt(n[1], 10) };
    return null;
  }

  // GET 查询页解析学年/学期 option.value；默认取页面当前选中项
  async function fetchAcademicOptions() {
    const r = await fetch(KB_PAGE, { credentials: 'include' });
    if (!r.ok) throw new Error('课表查询页 HTTP ' + r.status);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    function read(id) {
      const el = doc.querySelector('#' + id);
      if (!el || !el.options) return null;
      const opts = [];
      let def = 0;
      Array.prototype.forEach.call(el.options, function (o, i) {
        if (!o.value || !o.value.trim()) return;
        opts.push({ text: (o.textContent || o.value).trim(), value: o.value.trim() });
        if (o.selected) def = opts.length - 1;
      });
      return opts.length ? { opts: opts, def: def } : null;
    }
    let years = read('xnm');
    let terms = read('xqm');
    try {
      const live = function (sel) {
        const e = document.querySelector(sel);
        if (!e || !e.value) return '';
        return e.value.trim();
      };
      if (years && live('#xnm')) years.def = Math.max(0, years.opts.findIndex(function (o) { return o.value === live('#xnm'); }));
      if (terms && live('#xqm')) terms.def = Math.max(0, terms.opts.findIndex(function (o) { return o.value === live('#xqm'); }));
    } catch (e) {}
    if (!years || !terms) throw new Error('未解析到学年/学期，请先打开「课表查询」页面后再导入');
    return { years: years, terms: terms };
  }

  function fetchTimetable(xnm, xqm) {
    return postForm(API_KB, { xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    const arr = await postForm(API_RJC, { xnm: xnm, xqm: xqm, xqh_id: xqhId || '1' });
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (x) { return x && x.jcmc && x.qssj && x.jssj; }).map(function (x) {
      return { number: parseInt(x.jcmc, 10), startTime: String(x.qssj).slice(0, 5), endTime: String(x.jssj).slice(0, 5) };
    }).filter(function (x) {
      return x.number >= 1 && /^\d{2}:\d{2}$/.test(x.startTime) && /^\d{2}:\d{2}$/.test(x.endTime);
    }).sort(function (a, b) { return a.number - b.number; });
  }

  function normalizeCourses(kbList) {
    const raw = [];
    let bad = 0;
    for (const it of (kbList || [])) {
      const name = String(it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const sec = parseSection(it.jcor || it.jcs || it.jc);
      const weeks = parseWeeks(it.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec || sec.startSection < 1 || sec.endSection < sec.startSection || !weeks.length) { bad++; continue; }
      raw.push({ name: name, position: String(it.cdmc || it.cdbh || '').trim(), teacher: String(it.xm || '').trim(),
        day: day, startSection: sec.startSection, endSection: sec.endSection, weeks: weeks });
    }
    raw.sort(function (a, b) { return a.day - b.day || a.startSection - b.startSection; });
    const stage1 = [];
    const map1 = new Map();
    for (const c of raw) {
      const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('\u0001');
      const ex = map1.get(key);
      if (ex && c.startSection === ex.endSection + 1) { ex.endSection = c.endSection; continue; }
      const n = Object.assign({}, c, { weeks: c.weeks.slice() });
      map1.set(key, n);
      stage1.push(n);
    }
    const stage2 = [];
    const map2 = new Map();
    for (const c of stage1) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('\u0001');
      const ex = map2.get(key);
      if (ex) ex.weeks = Array.from(new Set(ex.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      else {
        const n = Object.assign({}, c, { weeks: c.weeks.slice() });
        map2.set(key, n);
        stage2.push(n);
      }
    }
    return { courses: stage2, bad: bad };
  }

  async function runImportFlow() {
    const semOpts = await fetchAcademicOptions();
    const yi = await select('选择学年', semOpts.years.opts.map(function (o) { return o.text; }), semOpts.years.def);
    if (yi === null) { toast('已取消导入'); return; }
    const ti = await select('选择学期', semOpts.terms.opts.map(function (o) { return o.text; }), semOpts.terms.def);
    if (ti === null) { toast('已取消导入'); return; }
    const xnm = semOpts.years.opts[yi].value;
    const xqm = semOpts.terms.opts[ti].value;

    const ok = await alert('确认导入', '将导入「' + semOpts.years.opts[yi].text + ' ' + semOpts.terms.opts[ti].text + '」整学期课表，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    let domXqh = '';
    try {
      const d = new DOMParser().parseFromString(document.documentElement.outerHTML, 'text/html');
      const el = d.querySelector('#xqh_id, input[name="xqh_id"]');
      domXqh = el ? String(el.value || '') : '';
    } catch (e) {}

    const kbData = await fetchTimetable(xnm, xqm);
    const kbList = kbData && kbData.kbList;
    if (!Array.isArray(kbList) || !kbList.length) throw new Error('课表接口未返回 kbList');

    const xqhId = (kbList[0] && kbList[0].xqh_id) || domXqh || '1';
    let timeSlots = [];
    try { timeSlots = await fetchTimeSlots(xnm, xqm, xqhId); } catch (e) {}

    const result = normalizeCourses(kbList);
    if (!result.courses.length) throw new Error('没有可用的课程数据');
    await saveCourses(result.courses);
    if (timeSlots.length) { try { await BP.savePresetTimeSlots(JSON.stringify(timeSlots)); } catch (e) {} }
    toast('已导入 ' + result.courses.length + ' 条课程' +
      (timeSlots.length ? '，含 ' + timeSlots.length + ' 个节次时间' : '') +
      (result.bad ? '，跳过 ' + result.bad + ' 条无效数据' : ''));
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
