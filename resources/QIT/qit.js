// 青岛工学院（jw.qit.edu.cn，正方 jwglxt）整学期课表适配器
(async function main() {
  const PAGE_URL = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const KB_URL = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const JC_URL = '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

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

  function postForm(url, params) {
    const body = Object.keys(params)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]))
      .join('&');
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body
    }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  async function fetchAcademicOptions() {
    const res = await fetch(PAGE_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表查询页请求失败：HTTP ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    function parse(id) {
      const sel = doc.querySelector('#' + id) || doc.querySelector('select[name="' + id + '"]');
      if (!sel) return null;
      const opts = [];
      for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        const v = o.value;
        if (v && String(v).trim()) {
          opts.push({ value: String(v), text: (o.text || o.textContent || '').trim(), selected: !!o.selected });
        }
      }
      if (!opts.length) return null;
      let def = -1;
      for (let i = 0; i < opts.length; i++) { if (opts[i].selected) { def = i; break; } }
      if (def < 0) def = 0;
      return { items: opts.map((o) => ({ value: o.value, text: o.text })), def: def };
    }
    const years = parse('xnm');
    const terms = parse('xqm');
    if (!years || !terms) throw new Error('未能从课表查询页读取学年/学期下拉框');
    return { years: years, terms: terms };
  }

  function parseWeeks(raw) {
    if (!raw) return [];
    const s = String(raw).replace(/第/g, '').replace(/周/g, '');
    const out = {};
    s.split(/[,，、;；]/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      let parity = '';
      const pm = part.match(/\((单|双)\)/);
      if (pm) parity = pm[1];
      const clean = part.replace(/\((单|双)\)/g, '').trim();
      const m = clean.match(/^(\d+)\s*(?:[-~—]\s*(\d+))?$/);
      if (!m) return;
      let a = parseInt(m[1], 10);
      let b = m[2] ? parseInt(m[2], 10) : a;
      if (isNaN(a)) return;
      if (isNaN(b)) b = a;
      if (a > b) { const t = a; a = b; b = t; }
      for (let w = a; w <= b && w <= 30; w++) {
        if (w < 1) continue;
        if (parity === '单' && w % 2 === 0) continue;
        if (parity === '双' && w % 2 === 1) continue;
        out[w] = true;
      }
    });
    return Object.keys(out).map(Number).sort(function (x, y) { return x - y; });
  }

  function parseSections(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    let m = s.match(/(\d+)\s*[-~—]\s*(\d+)/);
    if (m) return { s: parseInt(m[1], 10), e: parseInt(m[2], 10) };
    m = s.match(/^(\d+)$/);
    if (m) return { s: parseInt(m[1], 10), e: parseInt(m[1], 10) };
    return null;
  }

  function sameWeeks(a, b) {
    if (a.length !== b.length) return false;
    const sa = a.slice().sort(function (x, y) { return x - y; });
    const sb = b.slice().sort(function (x, y) { return x - y; });
    return sa.every(function (v, i) { return v === sb[i]; });
  }

  function normalizeCourses(rawList) {
    const valid = [];
    let skipped = 0;
    (rawList || []).forEach(function (it) {
      const name = (it.name || '').trim();
      const day = parseInt(it.day, 10);
      const sec = parseSections(it.sectionsRaw);
      const weeks = parseWeeks(it.weeksRaw);
      if (!name || !(day >= 1 && day <= 7) || !sec || !weeks.length ||
          sec.s < 1 || sec.e < sec.s || sec.s > 20 || sec.e > 20) { skipped++; return; }
      valid.push({
        name: name, teacher: (it.teacher || '').trim(),
        position: (it.position || '').trim(), day: day,
        startSection: sec.s, endSection: sec.e, weeks: weeks
      });
    });
    const s1 = [];
    valid.forEach(function (c) {
      let merged = false;
      for (let i = 0; i < s1.length; i++) {
        const t = s1[i];
        if (t.name === c.name && t.teacher === c.teacher && t.position === c.position &&
            t.day === c.day && sameWeeks(t.weeks, c.weeks)) {
          if (c.startSection === t.endSection + 1) { t.endSection = c.endSection; merged = true; break; }
          if (t.startSection === c.endSection + 1) { t.startSection = c.startSection; merged = true; break; }
        }
      }
      if (!merged) s1.push({
        name: c.name, teacher: c.teacher, position: c.position,
        day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
      });
    });
    const s2 = [];
    s1.forEach(function (c) {
      let found = null;
      for (let i = 0; i < s2.length; i++) {
        const t = s2[i];
        if (t.name === c.name && t.teacher === c.teacher && t.position === c.position &&
            t.day === c.day && t.startSection === c.startSection && t.endSection === c.endSection) {
          found = t; break;
        }
      }
      if (found) {
        const u = {};
        found.weeks.concat(c.weeks).forEach(function (w) { u[w] = true; });
        found.weeks = Object.keys(u).map(Number).sort(function (x, y) { return x - y; });
      } else {
        s2.push({
          name: c.name, teacher: c.teacher, position: c.position,
          day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
        });
      }
    });
    return { courses: s2, skipped: skipped, rawCount: (rawList || []).length };
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    const txt = await postForm(JC_URL, { xnm: xnm, xqm: xqm, xqh_id: xqhId || '1' });
    const arr = JSON.parse(txt);
    const list = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.list) ? arr.list : []);
    return list.map(function (o) {
      return { number: parseInt(o.jcmc, 10), startTime: o.qssj, endTime: o.jssj };
    }).filter(function (t) {
      return t.number >= 1 && /^\d{1,2}:\d{2}$/.test(t.startTime || '') && /^\d{1,2}:\d{2}$/.test(t.endTime || '');
    }).sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    const opt = await fetchAcademicOptions();

    let yi = opt.years.def;
    if (opt.years.items.length > 1) {
      const picked = await select('选择学年', opt.years.items.map((x) => x.text), opt.years.def);
      if (picked === null || picked === undefined || Number(picked) < 0) { toast('已取消，未导入'); return; }
      yi = Number(picked);
    }
    let ti = opt.terms.def;
    if (opt.terms.items.length > 1) {
      const picked = await select('选择学期', opt.terms.items.map((x) => x.text), opt.terms.def);
      if (picked === null || picked === undefined || Number(picked) < 0) { toast('已取消，未导入'); return; }
      ti = Number(picked);
    }
    if (!opt.years.items[yi] || !opt.terms.items[ti]) throw new Error('学年/学期选项无效');
    const xnm = opt.years.items[yi].value;
    const xqm = opt.terms.items[ti].value;
    const termLabel = opt.years.items[yi].text + ' 第' + opt.terms.items[ti].text + '学期';

    const kbParams = { xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' };
    const results = await Promise.allSettled([
      postForm(KB_URL, kbParams).then(function (t) { return JSON.parse(t); }),
      fetchTimeSlots(xnm, xqm, '1')
    ]);
    if (results[0].status !== 'fulfilled') {
      throw new Error('课表接口读取失败：' + ((results[0].reason && results[0].reason.message) || results[0].reason));
    }
    const kbList = (results[0].value || {}).kbList || [];
    const raw = kbList.map(function (k) {
      return {
        name: k.kcmc, teacher: k.xm || '',
        position: (((k.lh || '') + ' ' + (k.cdmc || '')).trim()) || (k.cdmc || ''),
        day: k.xqj, sectionsRaw: k.jcs || k.jcor || k.jc, weeksRaw: k.zcd
      };
    });
    const result = normalizeCourses(raw);
    if (!result.courses.length) throw new Error('没有可用的课程数据（原始 ' + result.rawCount + ' 条）');

    const slots = (results[1].status === 'fulfilled' && results[1].value) ? results[1].value : [];
    let tip = '学期：' + termLabel + '\n课程：' + result.courses.length + ' 条';
    if (result.skipped) tip += '（跳过 ' + result.skipped + ' 条异常）';
    if (slots.length) tip += '\n作息：' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(result.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + result.courses.length + ' 门课程' +
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
