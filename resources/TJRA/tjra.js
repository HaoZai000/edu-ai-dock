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
  const INDEX_URL = '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const KB_URL = '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const TS_URL = '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

  function postForm(path, params) {
    return fetch(BASE + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams(params).toString()
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error('接口返回非 JSON，可能会话已过期'); }
    });
  }

  async function fetchAcademicOptions() {
    const res = await fetch(BASE + INDEX_URL, { credentials: 'include' });
    if (!res.ok) throw new Error('课表查询页打开失败：HTTP ' + res.status);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    function readSelect(id) {
      const sel = doc.querySelector('#' + id);
      if (!sel) throw new Error('课表查询页缺少 ' + id + ' 下拉框');
      const texts = [];
      const values = [];
      let def = 0;
      let found = false;
      Array.prototype.forEach.call(sel.querySelectorAll('option'), function (op) {
        const v = (op.value || '').trim();
        if (!v) return;
        values.push(v);
        texts.push((op.textContent || '').trim());
        if (!found && op.selected) { def = values.length - 1; found = true; }
      });
      if (!values.length) throw new Error(id + ' 下拉框没有可选项');
      return { texts: texts, values: values, defaultIndex: def };
    }
    return { years: readSelect('xnm'), terms: readSelect('xqm') };
  }

  async function chooseSemester() {
    const opts = await fetchAcademicOptions();
    const yi = await select('选择学年', opts.years.texts, opts.years.defaultIndex);
    if (yi === null) return null;
    const ti = await select('选择学期', opts.terms.texts.map(function (t) { return '第' + t + '学期'; }), opts.terms.defaultIndex);
    if (ti === null) return null;
    return { xnm: opts.years.values[yi], xqm: opts.terms.values[ti],
      label: opts.years.texts[yi] + '学年第' + opts.terms.texts[ti] + '学期' };
  }

  function parseSections(row) {
    const raw = String(row.jcor || row.jcs || row.jc || '').replace(/\s/g, '');
    const range = raw.match(/(\d+)\s*[-~至到]\s*(\d+)/);
    if (range) return [parseInt(range[1], 10), parseInt(range[2], 10)];
    const one = raw.match(/(\d+)/);
    if (one) { const n = parseInt(one[1], 10); return [n, n]; }
    return [];
  }

  function parseWeeks(raw) {
    if (!raw) return [];
    const result = new Set();
    String(raw).replace(/\s/g, '').split(/[,，;；]/).forEach(function (seg) {
      if (!seg) return;
      const parity = seg.indexOf('单') >= 0 ? 'odd' : (seg.indexOf('双') >= 0 ? 'even' : null);
      const nums = seg.match(/\d+/g);
      if (!nums || !nums.length) return;
      let a = parseInt(nums[0], 10);
      let b = nums.length > 1 ? parseInt(nums[1], 10) : a;
      if (!Number.isInteger(a) || a < 1) return;
      if (!Number.isInteger(b) || b < a) b = a;
      for (let w = a; w <= Math.min(b, 30); w++) {
        if (parity === 'odd' && w % 2 === 0) continue;
        if (parity === 'even' && w % 2 === 1) continue;
        result.add(w);
      }
    });
    return Array.from(result).sort(function (a, b) { return a - b; });
  }

  function normalizeCourses(list) {
    const items = [];
    let skipped = 0;
    (list || []).forEach(function (r) {
      const name = String(r.kcmc || '').trim();
      const day = parseInt(r.xqj, 10);
      const sec = parseSections(r);
      const weeks = parseWeeks(r.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec.length ||
          sec[0] < 1 || sec[1] < sec[0] || sec[1] > 20 || !weeks.length) { skipped++; return; }
      items.push({ name: name, position: String(r.cdmc || '').trim(), teacher: String(r.xm || '').trim(),
        day: day, startSection: sec[0], endSection: sec[1], weeks: weeks });
    });
    const groups = new Map();
    items.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });
    const stageA = [];
    groups.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection || a.endSection - b.endSection; });
      let cur = Object.assign({}, arr[0], { weeks: arr[0].weeks.slice() });
      for (let i = 1; i < arr.length; i++) {
        const n = arr[i];
        if (n.startSection <= cur.endSection + 1) cur.endSection = Math.max(cur.endSection, n.endSection);
        else { stageA.push(cur); cur = Object.assign({}, n, { weeks: n.weeks.slice() }); }
      }
      stageA.push(cur);
    });
    const bySlot = new Map();
    stageA.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!bySlot.has(key)) bySlot.set(key, { name: c.name, teacher: c.teacher, position: c.position,
        day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: [] });
      bySlot.get(key).weeks = Array.from(new Set(bySlot.get(key).weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
    });
    const courses = Array.from(bySlot.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name, 'zh');
    });
    return { courses: courses, skipped: skipped };
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    const data = await postForm(TS_URL, { xnm: xnm, xqm: xqm, xqh_id: xqhId || '' });
    if (!Array.isArray(data)) return [];
    const map = new Map();
    data.forEach(function (r) {
      const n = parseInt(r.jcmc, 10);
      let s = String(r.qssj || '').trim();
      let e = String(r.jssj || '').trim();
      if (!Number.isInteger(n) || n < 1 || n > 30) return;
      if (!/^\d{1,2}:\d{2}$/.test(s) || !/^\d{1,2}:\d{2}$/.test(e)) return;
      if (s.length === 4) s = '0' + s;
      if (e.length === 4) e = '0' + e;
      map.set(n, { number: n, startTime: s, endTime: e });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    const sel = await chooseSemester();
    if (!sel) { toast('已取消导入'); return; }

    const ok = await alert('确认导入', '将读取「' + sel.label + '」整学期课表并导入，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    const results = await Promise.allSettled([
      postForm(KB_URL, { xnm: sel.xnm, xqm: sel.xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' }),
      fetchTimeSlots(sel.xnm, sel.xqm, '')
    ]);
    const kb = results[0].status === 'fulfilled' ? results[0].value : null;
    let slots = results[1].status === 'fulfilled' ? results[1].value : [];
    if (!kb || !Array.isArray(kb.kbList) || !kb.kbList.length) throw new Error('课表接口未返回课程，请确认已登录');
    if (!slots.length) {
      const hit = kb.kbList.find(function (r) { return r.xqh_id; });
      if (hit) { try { slots = await fetchTimeSlots(sel.xnm, sel.xqm, String(hit.xqh_id)); } catch (e) { slots = []; } }
    }
    const normalized = normalizeCourses(kb.kbList);
    if (!normalized.courses.length) throw new Error('整学期课表中没有可用的课程记录');
    await saveCourses(normalized.courses);
    if (slots.length) { try { await BP.savePresetTimeSlots(JSON.stringify(slots)); } catch (e) {} }
    toast('已导入 ' + sel.label + ' 共 ' + normalized.courses.length + ' 条课程' +
      (slots.length ? '，并写入 ' + slots.length + ' 个节次时间' : '') +
      (normalized.skipped ? '，跳过 ' + normalized.skipped + ' 条无效记录' : '') + '。');
    finish();
  }

  try {
    await runImportFlow();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await alert('导入失败', msg, '知道了');
    toast('导入失败：' + msg);
  }
})();
