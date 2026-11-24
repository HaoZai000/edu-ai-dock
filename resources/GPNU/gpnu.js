// 广东技术师范大学（正方教务移动端）整学期课表适配器
(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;
  const BD = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;

  const BASE = location.origin + '/jwglxt';
  const KB_PAGE = BASE + '/kbcx/xskbcxMobile_cxTimeTableIndex.html';
  const KB_API = BASE + '/kbcx/xskbcxMobile_cxXsgrkb.html';
  const TIME_API = BASE + '/jzgl/skxxMobile_cxRsdjc.html';
  const CAL_API = BASE + '/kbcx/xskbcxMobile_cxZc.html';

  function toast(msg) {
    if (BD && typeof BD.showToast === 'function') { try { BD.showToast(msg); return; } catch (e) {} }
    if (BP && typeof BP.showToast === 'function') { try { BP.showToast(msg); } catch (e) {} }
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  async function choose(title, labels, def) {
    if (labels.length === 1) return 0;
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const d = Math.max(0, Math.min(Number(def) || 0, labels.length - 1));
    const r = await BP.showSingleSelection(title, JSON.stringify(labels), d);
    if (r === null || r === undefined) return -1;
    const n = Number(r);
    return Number.isInteger(n) && n >= 0 && n < labels.length ? n : -1;
  }

  async function post(path, params) {
    const body = new URLSearchParams(params).toString();
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    });
    if (!res.ok) throw new Error('请求失败(' + res.status + ')：' + path);
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('返回非 JSON：' + path); }
  }

  async function fetchAcademicOptions() {
    const res = await fetch(KB_PAGE, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表查询页打开失败：' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const hidden = function (id) {
      const el = doc.getElementById(id);
      return el ? String(el.getAttribute('value') || el.textContent || '').trim() : '';
    };
    function fromSelect(ids) {
      for (const id of ids) {
        const sel = doc.querySelector('#' + id);
        if (sel && sel.tagName === 'SELECT' && sel.options && sel.options.length) {
          return Array.from(sel.options).map(function (o) {
            return { value: o.value, text: o.textContent.trim() };
          });
        }
      }
      return [];
    }
    let years = fromSelect(['xnm', 'xnd']);
    let terms = fromSelect(['xqm', 'xqd']);
    if (!years.length || !terms.length) {
      const groups = new Map();
      const re = /(\w+)\.push\(\s*\{\s*value\s*:\s*["']([^"']+)["']\s*,\s*text\s*:\s*["']([^"']*)["']\s*\}\s*\)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (!groups.has(m[1])) groups.set(m[1], []);
        groups.get(m[1]).push({ value: m[2], text: m[3] });
      }
      const gs = Array.from(groups.values());
      if (!years.length) years = gs[0] || [];
      if (!terms.length) terms = gs[1] || [];
    }
    return {
      years: years,
      terms: terms,
      currentYear: hidden('xnm_hide'),
      currentTerm: hidden('xqm_hide'),
      currentWeek: hidden('zs_hide'),
      xqhId: hidden('xqh_id')
    };
  }

  async function chooseSemester(options) {
    if (!options.years.length || !options.terms.length) {
      throw new Error('未能从课表查询页解析学年/学期选项');
    }
    let yi;
    if (options.years.length === 1) {
      yi = 0;
    } else {
      const di = Math.max(0, options.years.findIndex(function (o) { return o.value === options.currentYear; }));
      yi = await choose('选择学年', options.years.map(function (o) { return o.text; }), di);
      if (yi < 0) return null;
    }
    let ti;
    if (options.terms.length === 1) {
      ti = 0;
    } else {
      const di = Math.max(0, options.terms.findIndex(function (o) { return o.value === options.currentTerm; }));
      ti = await choose('选择学期', options.terms.map(function (o) { return o.text; }), di);
      if (ti < 0) return null;
    }
    return {
      xnm: options.years[yi].value,
      xqm: options.terms[ti].value,
      xqhId: options.xqhId,
      zs: options.currentWeek || '1',
      label: options.years[yi].text + ' / ' + options.terms[ti].text
    };
  }

  async function fetchCourses(xnm, xqm, zs) {
    const data = await post(KB_API, { xnm: xnm, xqm: xqm, zs: zs, kblx: '1', doType: 'app' });
    if (!data || !Array.isArray(data.kbList)) throw new Error('课表接口未返回课程列表');
    return data.kbList;
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    const list = await post(TIME_API, { xnm: xnm, xqm: xqm, xqh_id: xqhId || '' });
    if (!Array.isArray(list)) return [];
    return list.map(function (r) {
      return {
        number: parseInt(r.jcmc, 10),
        startTime: String(r.qssj || '').slice(0, 5),
        endTime: String(r.jssj || '').slice(0, 5)
      };
    }).filter(function (t) {
      return t.number >= 1 && /^\d{2}:\d{2}$/.test(t.startTime) && /^\d{2}:\d{2}$/.test(t.endTime);
    }).sort(function (a, b) { return a.number - b.number; });
  }

  async function fetchCalendar(xnm, xqm) {
    const list = await post(CAL_API, { xnm: xnm, xqm: xqm });
    if (!Array.isArray(list) || !list.length) return null;
    const first = String(list[0].rq || '').split('/')[0].trim();
    const cfg = { semesterTotalWeeks: list.length };
    if (/^\d{4}-\d{2}-\d{2}$/.test(first)) cfg.semesterStartDate = first;
    return cfg;
  }

  function parseWeeks(text) {
    if (!text) return [];
    const s = String(text).replace(/周/g, '').replace(/第/g, '').replace(/至/g, '-')
      .replace(/[~～—－]/g, '-');
    const set = new Set();
    s.split(/[,，;；]/).forEach(function (raw) {
      let part = raw.trim();
      if (!part) return;
      const odd = /单/.test(part), even = /双/.test(part);
      part = part.replace(/[单双]/g, '');
      let matched = false, m;
      const re = /(\d+)\s*-\s*(\d+)/g;
      while ((m = re.exec(part)) !== null) {
        matched = true;
        let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (b < a) { const t = a; a = b; b = t; }
        for (let w = a; w <= b; w++) {
          if (odd && w % 2 === 0) continue;
          if (even && w % 2 === 1) continue;
          set.add(w);
        }
      }
      if (matched) return;
      (part.match(/\d+/g) || []).forEach(function (n) {
        const w = parseInt(n, 10);
        if (odd && w % 2 === 0) return;
        if (even && w % 2 === 1) return;
        set.add(w);
      });
    });
    return Array.from(set).filter(function (w) { return w >= 1 && w <= 30; })
      .sort(function (a, b) { return a - b; });
  }

  function normalizeCourses(list) {
    const out = [];
    let bad = 0;
    list.forEach(function (raw) {
      const name = String(raw.kcmc || '').trim();
      const day = parseInt(raw.xqj, 10);
      const jcText = String(raw.jcs || raw.jcor || raw.jc || '');
      const range = jcText.match(/(\d+)\s*[-~至]\s*(\d+)/);
      const single = jcText.match(/^(\d+)$/);
      const start = range ? parseInt(range[1], 10) : (single ? parseInt(single[1], 10) : 0);
      const end = range ? parseInt(range[2], 10) : start;
      const weeks = parseWeeks(raw.zcd || '');
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1 && start <= 20) ||
          !(end >= start) || !weeks.length) { bad++; return; }
      out.push({
        name: name,
        position: String(raw.cdmc || '').trim(),
        teacher: String(raw.xm || '').trim(),
        day: day,
        startSection: start,
        endSection: end,
        weeks: weeks
      });
    });

    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i], b = out[j];
          if (a.name !== b.name || a.teacher !== b.teacher ||
              a.position !== b.position || a.day !== b.day) continue;
          if (a.weeks.length !== b.weeks.length ||
              !a.weeks.every(function (w, k) { return w === b.weeks[k]; })) continue;
          let x = a, y = b;
          if (x.startSection > y.startSection) { x = b; y = a; }
          if (y.startSection === x.endSection + 1) {
            x.endSection = y.endSection;
            out.splice(out.indexOf(y), 1);
            changed = true;
            break outer;
          }
        }
      }
    }

    const map = new Map();
    out.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map.has(key)) {
        map.set(key, {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice()
        });
      } else {
        const prev = map.get(key);
        prev.weeks = Array.from(new Set(prev.weeks.concat(c.weeks)))
          .sort(function (a, b) { return a - b; });
      }
    });
    const courses = Array.from(map.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return { courses: courses, bad: bad };
  }

  async function runImportFlow() {
    const options = await fetchAcademicOptions();
    const sel = await chooseSemester(options);
    if (!sel) { toast('已取消，未导入'); return; }

    toast('正在读取课表…');
    const results = await Promise.allSettled([
      fetchCourses(sel.xnm, sel.xqm, sel.zs),
      fetchTimeSlots(sel.xnm, sel.xqm, sel.xqhId),
      fetchCalendar(sel.xnm, sel.xqm)
    ]);
    if (results[0].status !== 'fulfilled') throw results[0].reason || new Error('课表读取失败');
    const normalized = normalizeCourses(results[0].value);
    if (!normalized.courses.length) throw new Error('整学期未解析到有效课程');
    const slots = results[1].status === 'fulfilled' && results[1].value.length ? results[1].value : [];
    const cfg = results[2].status === 'fulfilled' && results[2].value ? results[2].value : null;
    if (cfg && slots.length >= 2) {
      const toMin = function (t) { const p = t.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); };
      const duration = toMin(slots[0].endTime) - toMin(slots[0].startTime);
      const gap = toMin(slots[1].startTime) - toMin(slots[0].endTime);
      if (duration > 0 && duration <= 120) cfg.defaultClassDuration = duration;
      if (gap > 0 && gap <= 60) cfg.defaultBreakDuration = gap;
    }

    let tip = '学期：' + sel.label + '\n课程：' + normalized.courses.length + ' 条';
    if (normalized.bad) tip += '\n跳过：' + normalized.bad + ' 条';
    tip += '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到');
    const ok = await alert('确认导入', tip + '\n\n导入会覆盖当前课表。', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(normalized.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    if (cfg) {
      try {
        await BP.saveCourseConfig(JSON.stringify(cfg));
      } catch (e) {
        configFailed = true;
      }
    }

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
    toast('已导入 ' + normalized.courses.length + ' 条课程' +
      (normalized.bad ? '，跳过 ' + normalized.bad + ' 条异常' : '') +
      (configFailed ? '（校历未保存）' : '') +
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
