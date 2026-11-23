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

  const PAGE = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const KB_API = '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const TS_API = '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

  const postForm = async function (path, params) {
    const body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) body.append(k, String(params[k]));
    });
    const res = await fetch(location.origin + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString()
    });
    if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('text/html') >= 0) throw new Error('会话可能已过期，请重新登录教务系统');
    return await res.json();
  };
  const safe = async function (p) { try { return await p; } catch (e) { return null; } };

  function readSelectFromDoc(doc, ids) {
    for (let i = 0; i < ids.length; i++) {
      const el = doc.querySelector('#' + ids[i]) || doc.querySelector('select[name="' + ids[i] + '"]');
      if (!el || !el.options) continue;
      const opts = Array.from(el.options).filter(function (o) {
        return String(o.value || '').trim() !== '';
      }).map(function (o) {
        return { text: (o.textContent || o.value || '').trim(), value: String(o.value) };
      });
      if (!opts.length) continue;
      let def = opts.findIndex(function (o) { return o.value === String(el.value || '').trim(); });
      if (def < 0) def = 0;
      return { opts: opts, def: def };
    }
    return null;
  }

  function readSelectFromHtml(html, ids) {
    for (let i = 0; i < ids.length; i++) {
      const re = new RegExp('<select\\b[^>]*\\b(?:id|name)=["\\\']?' + ids[i] + '["\\\']?[^>]*>([\\s\\S]*?)<\\/select>', 'i');
      const m = html.match(re);
      if (!m) continue;
      const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      const opts = [];
      let om;
      let def = 0;
      let found = false;
      while ((om = optRe.exec(m[1])) !== null) {
        const vm = om[1].match(/value\s*=\s*["']?([^"'\s>]+)/i);
        const val = vm ? vm[1] : '';
        if (!val) continue;
        const text = om[2].replace(/<[^>]*>/g, '').trim();
        if (!found && /\bselected\b/i.test(om[1])) { def = opts.length; found = true; }
        opts.push({ text: text || val, value: val });
      }
      if (opts.length) return { opts: opts, def: def };
    }
    return null;
  }

  async function fetchAcademicOptions() {
    let years = readSelectFromDoc(document, ['xnm', 'xnd']);
    let terms = readSelectFromDoc(document, ['xqm', 'xqd']);
    if (years && terms) return { years: years, terms: terms };

    let html = '';
    try {
      const res = await fetch(location.origin + PAGE, { credentials: 'same-origin' });
      html = await res.text();
    } catch (e) {}
    if (!html) html = document.documentElement.outerHTML;
    if (!years) years = readSelectFromHtml(html, ['xnm', 'xnd']);
    if (!terms) terms = readSelectFromHtml(html, ['xqm', 'xqd']);
    if (!years || !terms) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!years) years = readSelectFromDoc(doc, ['xnm', 'xnd']);
      if (!terms) terms = readSelectFromDoc(doc, ['xqm', 'xqd']);
    }
    if (!years || !terms) {
      throw new Error('未能解析学年/学期下拉框，请先打开「课表查询」页面后再导入');
    }
    return { years: years, terms: terms };
  }

  async function chooseSemester() {
    const info = await fetchAcademicOptions();
    const y = await select('选择学年', info.years.opts.map(function (o) { return o.text; }), info.years.def);
    if (y === null) return null;
    const t = await select('选择学期', info.terms.opts.map(function (o) { return o.text; }), info.terms.def);
    if (t === null) return null;
    return { xnm: info.years.opts[y].value, xqm: info.terms.opts[t].value,
      label: info.years.opts[y].text + ' ' + info.terms.opts[t].text };
  }

  async function fetchTimeSlots(xnm, xqm) {
    const rows = await postForm(TS_API, { xnm: xnm, xqm: xqm, xqh_id: '' });
    if (!Array.isArray(rows)) return [];
    const slots = [];
    rows.forEach(function (r) {
      const n = parseInt(r.jcmc, 10);
      const st = String(r.qssj || '').trim();
      const et = String(r.jssj || '').trim();
      if (n >= 1 && n <= 30 && /^\d{1,2}:\d{2}$/.test(st) && /^\d{1,2}:\d{2}$/.test(et)) {
        slots.push({ number: n, startTime: st, endTime: et });
      }
    });
    return slots.sort(function (a, b) { return a.number - b.number; });
  }

  async function fetchCourses(xnm, xqm) {
    const data = await postForm(KB_API, {
      xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: ''
    });
    if (!data || !Array.isArray(data.kbList)) throw new Error('课表接口未返回 kbList');
    return data.kbList;
  }

  // 去掉地点里的校区字样，统一格式
  function makePositionCleaner(list) {
    const tokens = new Set();
    (list || []).forEach(function (r) {
      const full = String(r.xqmc || '').trim();
      if (!full) return;
      tokens.add(full);
      const short = full.replace(/校区$/, '').trim();
      if (short) tokens.add(short);
    });
    return function (raw) {
      let s = String(raw || '').trim();
      tokens.forEach(function (t) {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp('[\\(（]\\s*' + esc + '\\s*[\\)）]', 'g'), '');
        s = s.replace(new RegExp(esc, 'g'), '');
      });
      s = s.replace(/[\s\u3000]+/g, ' ').trim();
      s = s.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '').trim();
      return s;
    };
  }

  function parseWeeks(raw) {
    const out = new Set();
    String(raw || '').replace(/，/g, ',').split(',').forEach(function (part) {
      const s = part.replace(/[（）()\s]/g, '');
      const onlyOdd = s.indexOf('单') >= 0;
      const onlyEven = s.indexOf('双') >= 0;
      const m = s.replace(/单|双|周/g, '').match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (!(a >= 1 && b >= a)) return;
      for (let w = a; w <= Math.min(b, 30); w++) {
        if (onlyOdd && w % 2 === 0) continue;
        if (onlyEven && w % 2 === 1) continue;
        out.add(w);
      }
    });
    return Array.from(out).sort(function (x, y) { return x - y; });
  }

  function parseSections(raw) {
    const s = String(raw || '');
    const m = s.match(/(\d+)\s*[-~至到]\s*(\d+)/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const one = s.match(/\d+/);
    if (one) return [parseInt(one[0], 10), parseInt(one[0], 10)];
    return null;
  }

  function baseKey(c) { return [c.name, c.teacher, c.position, c.day].join('\u0001'); }
  function weeksKey(c) { return c.weeks.join(','); }

  function mergeCourses(list) {
    const arr = list.slice();
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
          if (i === j) continue;
          const a = arr[i];
          const b = arr[j];
          if (baseKey(a) !== baseKey(b) || weeksKey(a) !== weeksKey(b)) continue;
          if (a.endSection + 1 === b.startSection) {
            a.endSection = b.endSection;
            arr.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    const map = new Map();
    arr.forEach(function (c) {
      const k = baseKey(c) + '|' + c.startSection + '-' + c.endSection;
      if (map.has(k)) {
        const prev = map.get(k);
        prev.weeks = Array.from(new Set(prev.weeks.concat(c.weeks))).sort(function (x, y) { return x - y; });
      } else {
        map.set(k, {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
        });
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
  }

  function normalizeCourses(list) {
    const cleanPosition = makePositionCleaner(list);
    const out = [];
    let skipped = 0;
    (list || []).forEach(function (r) {
      const name = String(r.kcmc || '').trim();
      const day = parseInt(r.xqj, 10);
      const sec = parseSections(r.jcs || r.jcor || r.jc);
      const weeks = parseWeeks(r.zcd);
      const start = sec ? sec[0] : 0;
      const end = sec ? sec[1] : 0;
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1 && end >= start && end <= 30) || weeks.length === 0) {
        skipped++;
        return;
      }
      out.push({
        name: name,
        position: cleanPosition(r.cdmc || r.cdbh || ''),
        teacher: String(r.xm || '').trim(),
        day: day,
        startSection: start,
        endSection: end,
        weeks: weeks
      });
    });
    return { courses: mergeCourses(out), skipped: skipped };
  }

  async function runImportFlow() {
    const sem = await chooseSemester();
    if (!sem) { toast('已取消导入'); return; }

    const ok = await alert('课表导入', '将导入「' + sem.label + '」整学期课表，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    const results = await Promise.all([
      safe(fetchCourses(sem.xnm, sem.xqm)),
      safe(fetchTimeSlots(sem.xnm, sem.xqm))
    ]);
    const rawList = results[0];
    const slots = results[1];
    if (!Array.isArray(rawList) || rawList.length === 0) {
      throw new Error('该学期未查询到课程，请确认已选对学年学期');
    }
    const normalized = normalizeCourses(rawList);
    if (!normalized.courses.length) throw new Error('课程字段校验后没有可导入的课程');

    await saveCourses(normalized.courses);
    if (Array.isArray(slots) && slots.length) {
      try { await BP.savePresetTimeSlots(JSON.stringify(slots)); } catch (e) {}
    }
    toast('已导入 ' + normalized.courses.length + ' 条课程' +
      (normalized.skipped ? '，跳过 ' + normalized.skipped + ' 条字段异常记录' : '') +
      (Array.isArray(slots) && slots.length ? '，并写入 ' + slots.length + ' 个节次时间' : ''));
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
