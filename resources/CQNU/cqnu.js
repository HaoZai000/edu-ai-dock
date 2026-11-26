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

  const ORIGIN = location.origin;
  const GNMKDM = 'N2151';
  const PAGE_PATH = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=' + GNMKDM + '&layout=default';
  const KB_PATH = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=' + GNMKDM;
  const JC_PATH = '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=' + GNMKDM;

  // 教务可能在 iframe 内，探测可访问课表页的源
  async function detectBase() {
    const cands = [ORIGIN];
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (f) {
      try {
        const u = new URL(f.src, location.href);
        if (u.origin !== ORIGIN) cands.push(u.origin);
      } catch (e) {}
    });
    const seen = {};
    for (let i = 0; i < cands.length; i++) {
      const base = cands[i];
      if (!base || seen[base]) continue;
      seen[base] = true;
      try {
        const res = await fetch(base + PAGE_PATH, { credentials: 'include' });
        if (!res.ok) continue;
        const html = await res.text();
        if (html && html.length > 200 && html.indexOf('id="xnm"') >= 0) return { base: base, html: html };
      } catch (e) {}
    }
    const local = document.documentElement.outerHTML;
    if (local.indexOf('id="xnm"') >= 0) return { base: ORIGIN, html: local };
    throw new Error('无法访问课表查询页，请重新登录教务系统');
  }

  function pickSelect(doc, id) {
    const sel = doc.querySelector('#' + id) || doc.querySelector('select[name="' + id + '"]');
    if (!sel) return { opts: [], idx: 0 };
    const all = Array.prototype.slice.call(sel.querySelectorAll('option'));
    const opts = [];
    all.forEach(function (o) {
      const value = (o.value || '').trim();
      const text = (o.textContent || '').trim();
      if (!value || !text || /^-{2,}/.test(text)) return;
      opts.push({ value: value, text: text });
    });
    let idx = 0;
    for (let i = 0; i < all.length; i++) {
      if (!all[i].selected) continue;
      const v = (all[i].value || '').trim();
      for (let j = 0; j < opts.length; j++) {
        if (opts[j].value === v) { idx = j; break; }
      }
      break;
    }
    return { opts: opts, idx: idx };
  }

  function parseWeeks(text) {
    const weeks = {};
    String(text || '').split(/[,，、;；]/).forEach(function (segment) {
      const onlyOdd = segment.indexOf('单') >= 0;
      const onlyEven = segment.indexOf('双') >= 0;
      const s = segment.replace(/[周（）()单双]/g, '');
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

  function parseSections(item) {
    const raw = item.jcs || item.jc || item.jcor || '';
    const nums = String(raw).match(/\d+/g);
    if (!nums || !nums.length) return null;
    const start = parseInt(nums[0], 10);
    const end = parseInt(nums[nums.length - 1], 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > 20) return null;
    return { startSection: start, endSection: end };
  }

  function normalizeCourses(raw) {
    const good = [];
    let bad = 0;
    (Array.isArray(raw) ? raw : []).forEach(function (it) {
      if (!it) { bad++; return; }
      const name = (it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const sec = parseSections(it);
      const weeks = parseWeeks(it.zcd);
      if (!name || !sec || !(day >= 1 && day <= 7) || !weeks.length) { bad++; return; }
      good.push({
        name: name,
        position: (it.cdmc || it.cdbh || '').trim(),
        teacher: (it.xm || '').trim(),
        day: day,
        startSection: sec.startSection,
        endSection: sec.endSection,
        weeks: weeks
      });
    });
    return { list: good, bad: bad };
  }

  function mergeCourses(list) {
    const map = new Map();
    list.forEach(function (c) {
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
    return out;
  }

  async function fetchAcademicOptions() {
    const found = await detectBase();
    const doc = new DOMParser().parseFromString(found.html, 'text/html');
    const year = pickSelect(doc, 'xnm');
    const term = pickSelect(doc, 'xqm');
    if (!year.opts.length || !term.opts.length) throw new Error('未找到学年/学期下拉框（xnm/xqm）');
    return { base: found.base, year: year, term: term };
  }

  async function chooseSemester() {
    const ac = await fetchAcademicOptions();
    const yi = await select('选择学年', ac.year.opts.map(function (o) { return o.text; }), ac.year.idx);
    if (yi === null) return null;
    const ti = await select('选择学期', ac.term.opts.map(function (o) { return o.text; }), ac.term.idx);
    if (ti === null) return null;
    const y = ac.year.opts[yi];
    const t = ac.term.opts[ti];
    if (!y || !t) throw new Error('学年/学期选择无效');
    return { base: ac.base, xnm: y.value, xqm: t.value, label: y.text + ' ' + t.text };
  }

  async function postForm(url, params) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(params).toString()
    });
    if (!res.ok) throw new Error('接口请求失败（HTTP ' + res.status + '）');
    const text = await res.text();
    if (!text) throw new Error('接口无响应');
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('接口返回非 JSON（可能登录已失效）');
    }
  }

  async function fetchTimeSlots(base, xnm, xqm, xqhId) {
    if (!xqhId) return [];
    const data = await postForm(base + JC_PATH, { xnm: xnm, xqm: xqm, xqh_id: xqhId });
    const slots = [];
    (Array.isArray(data) ? data : []).forEach(function (it) {
      const n = parseInt(it.xsdj || it.jcmc, 10);
      const s = (it.qssj || '').trim();
      const e = (it.jssj || '').trim();
      if (!isNaN(n) && n >= 1 && /^\d{1,2}:\d{2}$/.test(s) && /^\d{1,2}:\d{2}$/.test(e)) {
        slots.push({ number: n, startTime: s, endTime: e });
      }
    });
    slots.sort(function (a, b) { return a.number - b.number; });
    return slots;
  }

  async function runImportFlow() {
    const sem = await chooseSemester();
    if (!sem) { toast('已取消，未导入'); return; }

    toast('正在读取课表…');
    const kbRes = await postForm(sem.base + KB_PATH, {
      xnm: sem.xnm, xqm: sem.xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: ''
    });
    const kbList = Array.isArray(kbRes && kbRes.kbList) ? kbRes.kbList : [];
    if (!kbList.length) throw new Error('该学期未查到课程（' + sem.label + '）');

    const xqhId = (kbList[0] && kbList[0].xqh_id) || '';
    const timeSlots = await fetchTimeSlots(sem.base, sem.xnm, sem.xqm, xqhId).catch(function () { return []; });

    const normalized = normalizeCourses(kbList);
    const courses = mergeCourses(normalized.list);
    if (!courses.length) {
      throw new Error('课程解析结果为空（原始 ' + kbList.length + ' 条，异常 ' + normalized.bad + ' 条）');
    }

    let tip = '学期：' + sem.label + '，课程 ' + courses.length + ' 条';
    if (normalized.bad) tip += '，跳过 ' + normalized.bad + ' 条信息不全';
    if (timeSlots.length) tip += '，作息 ' + timeSlots.length + ' 节';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    await saveCourses(courses);

    let slotsFailed = false;
    if (timeSlots.length) {
      try {
        if (BP && typeof BP.savePresetTimeSlots === 'function') {
          await BP.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
      } catch (e) {
        slotsFailed = true;
      }
    }

    toast('已导入 ' + courses.length + ' 条课程' +
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
