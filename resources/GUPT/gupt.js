(async function main() {
  const base = location.origin + '/jwglxt';
  const kbPageUrl = base + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
  const kbApi = base + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const rjcApi = base + '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

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

  function extractOptions(html, id) {
    const re = new RegExp('<select[^>]*id=["\']' + id + '["\'][^>]*>([\\s\\S]*?)<\\/select>', 'i');
    const m = String(html || '').match(re);
    if (!m) return null;
    const ore = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
    const opts = [];
    let om;
    while ((om = ore.exec(m[1])) !== null) {
      const vm = om[1].match(/value\s*=\s*["']([^"']*)["']/i);
      if (!vm) continue;
      const value = vm[1].trim();
      if (!value) continue;
      const text = om[2].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      opts.push({ value: value, text: text, selected: /selected/i.test(om[1]) });
    }
    if (!opts.length) return null;
    let def = opts.findIndex(function (o) { return o.selected; });
    if (def < 0) def = 0;
    return {
      values: opts.map(function (o) { return o.value; }),
      texts: opts.map(function (o) { return o.text; }),
      defaultIndex: def
    };
  }

  async function fetchAcademicOptions() {
    const res = await fetch(kbPageUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表查询页请求失败(' + res.status + ')，请先登录');
    const html = await res.text();
    return { years: extractOptions(html, 'xnm'), terms: extractOptions(html, 'xqm') };
  }

  async function chooseSemester(options) {
    if (!options || !options.years || !options.terms) throw new Error('未找到学年/学期选项，请先打开课表查询页');
    const y = await choose('选择学年', options.years.texts, options.years.defaultIndex);
    if (y < 0) return null;
    const t = await choose('选择学期', options.terms.texts, options.terms.defaultIndex);
    if (t < 0) return null;
    return {
      xnm: options.years.values[y],
      xqm: options.terms.values[t],
      label: options.years.texts[y]
    };
  }

  function postForm(url, params) {
    const body = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); })
      .join('&');
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('接口请求失败(' + r.status + ')');
      return r.text();
    }).then(function (t) {
      try { return JSON.parse(t); }
      catch (e) { throw new Error('接口未返回 JSON，可能登录已失效'); }
    });
  }

  function parseWeeks(raw) {
    if (!raw) return [];
    const out = new Set();
    String(raw).replace(/周/g, '').replace(/[，、]/g, ',').replace(/[（）()]/g, '').split(',').forEach(function (part) {
      const m = part.trim().match(/^(\d+)\s*(?:[-~至到]\s*(\d+))?\s*(单|双)?$/);
      if (!m) return;
      let a = Number(m[1]);
      let b = m[2] ? Number(m[2]) : a;
      const parity = m[3] || '';
      if (b < a) { const tmp = a; a = b; b = tmp; }
      for (let w = Math.max(1, a); w <= b && w <= 30; w++) {
        if (parity === '单' && w % 2 === 0) continue;
        if (parity === '双' && w % 2 !== 0) continue;
        out.add(w);
      }
    });
    return Array.from(out).sort(function (x, y) { return x - y; });
  }

  function parseSections(raw) {
    const m = String(raw || '').replace(/节/g, '').trim().match(/^(\d+)\s*(?:[-~至到]\s*(\d+))?$/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a) return { startSection: b, endSection: a };
    return { startSection: a, endSection: b };
  }

  function normalizeCourses(list) {
    let skipped = 0;
    const items = [];
    (list || []).forEach(function (row) {
      const name = String(row.kcmc || '').trim();
      const day = Number(row.xqj);
      const sec = parseSections(row.jcs);
      const weeks = parseWeeks(row.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec ||
        !(sec.startSection >= 1) || !(sec.endSection >= sec.startSection) || sec.endSection > 30 || !weeks.length) {
        skipped++;
        return;
      }
      items.push({
        name: name,
        position: String(row.cdmc || '').trim(),
        teacher: String(row.xm || '').trim(),
        day: day,
        startSection: sec.startSection,
        endSection: sec.endSection,
        weeks: weeks
      });
    });
    return { items: items, skipped: skipped };
  }

  function mergeCourses(items) {
    items.sort(function (a, b) {
      return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || a.day - b.day || a.startSection - b.startSection;
    });

    const stage1 = [];
    items.forEach(function (c) {
      const hit = stage1.find(function (x) {
        return x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
          x.day === c.day && x.weeks.join(',') === c.weeks.join(',') &&
          c.startSection <= x.endSection + 1 && c.endSection >= x.startSection - 1;
      });
      if (hit) {
        hit.startSection = Math.min(hit.startSection, c.startSection);
        hit.endSection = Math.max(hit.endSection, c.endSection);
      } else {
        stage1.push(Object.assign({}, c, { weeks: c.weeks.slice() }));
      }
    });

    const stage2 = new Map();
    stage1.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!stage2.has(key)) stage2.set(key, Object.assign({}, c, { weeks: [] }));
      const t = stage2.get(key);
      t.weeks = Array.from(new Set(t.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
    });

    return Array.from(stage2.values()).sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
  }

  async function fetchTimeSlots(sem, xqhId) {
    const data = await postForm(rjcApi, { xnm: sem.xnm, xqm: sem.xqm, xqh_id: xqhId || '' });
    const arr = Array.isArray(data) ? data : ((data && data.items) || []);
    const map = new Map();
    arr.forEach(function (r) {
      const m = String(r.jcmc == null ? '' : r.jcmc).match(/\d+/);
      const n = m ? Number(m[0]) : NaN;
      const st = String(r.qssj || '').trim();
      const et = String(r.jssj || '').trim();
      if (!(n >= 1 && n <= 30) || !/^\d{1,2}:\d{2}$/.test(st) || !/^\d{1,2}:\d{2}$/.test(et) || map.has(n)) return;
      map.set(n, { number: n, startTime: st, endTime: et });
    });
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    const go = await alert('导入课表', '将读取所选学期的整学期课程，是否继续？', '继续');
    if (!go) {
      toast('已取消，未导入');
      return;
    }

    const options = await fetchAcademicOptions();
    const sem = await chooseSemester(options);
    if (!sem) {
      toast('已取消，未导入');
      return;
    }

    toast('正在读取课表数据…');
    const kbData = await postForm(kbApi, {
      xnm: sem.xnm, xqm: sem.xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: ''
    });
    const rawList = (kbData && kbData.kbList) || [];
    if (!rawList.length) throw new Error('该学期课表为空，或登录已失效');

    let xqhId = '';
    const campusCount = new Map();
    rawList.forEach(function (r) {
      const id = String(r.xqh_id || '').trim();
      if (id) campusCount.set(id, (campusCount.get(id) || 0) + 1);
    });
    let max = 0;
    campusCount.forEach(function (n, id) { if (n > max) { max = n; xqhId = id; } });

    const slots = await fetchTimeSlots(sem, xqhId).catch(function () { return []; });
    const norm = normalizeCourses(rawList);
    if (!norm.items.length) throw new Error('课表里没有解析到有效课程');
    const courses = mergeCourses(norm.items);
    const otherCount = ((kbData && kbData.sjkList) || []).length;
    const xsxx = (kbData && kbData.xsxx) || {};
    const termLabel = xsxx.XQMMC ? '第' + xsxx.XQMMC + '学期' : '学期 ' + sem.xqm;

    const confirmed = await alert(
      '确认导入',
      '学期：' + sem.label + ' ' + termLabel +
        '\n课程：' + courses.length + ' 门' +
        (norm.skipped ? '\n跳过不完整：' + norm.skipped + ' 条' : '') +
        (otherCount ? '\n无固定节次课程：' + otherCount + ' 门不导入' : '') +
        '\n作息：' + (slots.length ? slots.length + ' 节' : '未取到') +
        '\n\n导入会覆盖当前课表。',
      '导入'
    );
    if (!confirmed) {
      toast('已取消，未导入');
      return;
    }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(courses));
    if (saved === false || saved === 'false') throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots.length) {
      try {
        await BP.savePresetTimeSlots(JSON.stringify(slots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') BD.notifyTaskCompletion();
    toast('已导入 ' + courses.length + ' 门课程' +
      (norm.skipped ? '，跳过 ' + norm.skipped + ' 条异常' : '') +
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
