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

  const BASE = location.origin + '/jwglxt';
  const KB_PAGE = BASE + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151';
  const KB_API = BASE + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const JC_API = BASE + '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

  function form(obj) {
    return Object.keys(obj).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
    }).join('&');
  }
  function post(path, data) {
    return fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: form(data)
    });
  }

  // 从 select 元素读选项（当前页面 DOM）
  function readSelectFromElement(sel) {
    const el = document.querySelector(sel);
    if (!el) return { options: [], defaultIndex: 0 };
    const options = [];
    const nodes = el.querySelectorAll('option');
    for (let i = 0; i < nodes.length; i++) {
      const v = (nodes[i].value || '').trim();
      if (!v) continue;
      options.push({ text: (nodes[i].textContent || '').trim(), value: v, selected: nodes[i].hasAttribute('selected') || nodes[i].selected === true });
    }
    let di = options.findIndex(function (o) { return o.selected; });
    if (di < 0) di = 0;
    return { options: options, defaultIndex: di };
  }

  // 从 HTML 文本正则读 select（不依赖 DOM 解析）
  function readSelectFromHtml(html, id) {
    const re = new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>', 'i');
    const m = html.match(re);
    if (!m) return { options: [], defaultIndex: 0 };
    const body = m[1];
    const options = [];
    const optRe = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
    let mm;
    while ((mm = optRe.exec(body))) {
      const attrs = mm[1] || '';
      const vm = attrs.match(/value\s*=\s*"([^"]*)"/i);
      const value = vm ? vm[1].trim() : '';
      if (!value) continue;
      options.push({
        text: mm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        value: value,
        selected: /selected/i.test(attrs)
      });
    }
    let di = options.findIndex(function (o) { return o.selected; });
    if (di < 0) di = 0;
    return { options: options, defaultIndex: di };
  }

  async function fetchAcademicOptions() {
    let xnm = readSelectFromElement('#xnm');
    let xqm = readSelectFromElement('#xqm');
    if (xnm.options.length && xqm.options.length) return { xnm: xnm, xqm: xqm };
    const res = await fetch(KB_PAGE, { credentials: 'include' });
    const html = await res.text();
    xnm = readSelectFromHtml(html, 'xnm');
    xqm = readSelectFromHtml(html, 'xqm');
    return { xnm: xnm, xqm: xqm };
  }

  async function fetchKb(xnm, xqm) {
    const res = await post(KB_API, { xnm: xnm || '', xqm: xqm || '', kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
    const text = await res.text();
    if (!res.ok) throw new Error('课表接口 HTTP ' + res.status + ' ' + text.slice(0, 120));
    try { return JSON.parse(text); } catch (e) { throw new Error('课表接口返回非 JSON：' + text.slice(0, 120)); }
  }

  function parseWeeks(zcd) {
    const out = new Set();
    if (!zcd) return [];
    String(zcd).split(/[,，、;；]/).forEach(function (seg) {
      let s = seg.trim().replace(/第/g, '').replace(/周/g, '');
      if (!s) return;
      let mode = 0;
      if (s.indexOf('单') >= 0) mode = 1;
      if (s.indexOf('双') >= 0) mode = 2;
      s = s.replace(/[()（）\s]|单|双/g, '');
      const m = s.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
          if (w < 1 || w > 30) continue;
          if (mode === 1 && w % 2 === 0) continue;
          if (mode === 2 && w % 2 === 1) continue;
          out.add(w);
        }
      } else if (/^\d+$/.test(s)) {
        const w = parseInt(s, 10);
        if (w >= 1 && w <= 30) out.add(w);
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function parseSections(item) {
    const raw = String(item.jcor || item.jcs || item.jc || '');
    const m = raw.match(/(\d+)\s*[-~]\s*(\d+)/);
    if (m) return { startSection: parseInt(m[1], 10), endSection: parseInt(m[2], 10) };
    const one = raw.match(/(\d+)/);
    if (one) { const n = parseInt(one[1], 10); return { startSection: n, endSection: n }; }
    return null;
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    (list || []).forEach(function (it) {
      const name = (it.kcmc || '').trim();
      const day = parseInt(it.xqj, 10);
      const sec = parseSections(it);
      const weeks = parseWeeks(it.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec || sec.startSection < 1 || sec.endSection < sec.startSection || !weeks.length) {
        skipped++;
        return;
      }
      valid.push({
        name: name,
        position: (it.cdmc || '').trim(),
        teacher: (it.xm || '').trim(),
        day: day,
        startSection: sec.startSection,
        endSection: sec.endSection,
        weeks: weeks
      });
    });
    return { valid: valid, skipped: skipped };
  }

  function mergeCourses(list) {
    const byKey = new Map();
    list.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day].join('|');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(c);
    });
    const stage1 = [];
    byKey.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      arr.forEach(function (c) {
        const wk = c.weeks.join(',');
        if (cur && cur.weeks.join(',') === wk && c.startSection === cur.endSection + 1) {
          cur.endSection = c.endSection;
        } else {
          if (cur) stage1.push(cur);
          cur = { name: c.name, teacher: c.teacher, position: c.position, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() };
        }
      });
      if (cur) stage1.push(cur);
    });
    const map = new Map();
    stage1.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!map.has(key)) {
        map.set(key, c);
      } else {
        const t = map.get(key);
        t.weeks = Array.from(new Set(t.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      }
    });
    return Array.from(map.values());
  }

  function toMinutes(t) {
    const p = String(t).split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    const body = { xnm: xnm || '', xqm: xqm || '' };
    if (xqhId) body.xqh_id = xqhId;
    const res = await post(JC_API, body);
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr.map(function (it) {
      return {
        number: parseInt(it.jcmc, 10),
        startTime: (it.qssj || '').trim(),
        endTime: (it.jssj || '').trim()
      };
    }).filter(function (t) {
      return t.number > 0 && /^\d{2}:\d{2}$/.test(t.startTime) && /^\d{2}:\d{2}$/.test(t.endTime);
    }).sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    // 1. 学年 / 学期
    const opts = await fetchAcademicOptions();
    if (!opts.xnm.options.length || !opts.xqm.options.length) {
      throw new Error('未能读到学年/学期下拉框，请先打开「课表查询」页面后再导入');
    }
    const i1 = await select('选择学年', opts.xnm.options.map(function (o) { return o.text; }), opts.xnm.defaultIndex);
    if (i1 === null) { toast('已取消导入'); return; }
    const i2 = await select('选择学期', opts.xqm.options.map(function (o) { return o.text; }), opts.xqm.defaultIndex);
    if (i2 === null) { toast('已取消导入'); return; }
    let xnm = opts.xnm.options[i1].value;
    let xqm = opts.xqm.options[i2].value;
    const xnmText = opts.xnm.options[i1].text;
    const xqmText = opts.xqm.options[i2].text;

    const ok = await alert('确认导入', '将导入 ' + xnmText + ' 第 ' + xqmText + ' 学期课表，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    // 2. 整学期课表
    let data = await fetchKb(xnm, xqm);
    if ((!data || !Array.isArray(data.kbList) || !data.kbList.length) && data && data.xsxx && data.xsxx.XNM && data.xsxx.XQM) {
      if (data.xsxx.XNM !== xnm || data.xsxx.XQM !== xqm) {
        xnm = data.xsxx.XNM;
        xqm = data.xsxx.XQM;
        data = await fetchKb(xnm, xqm);
      }
    }
    const kbList = Array.isArray(data.kbList) ? data.kbList : [];
    const norm = normalizeCourses(kbList);
    const courses = mergeCourses(norm.valid);
    if (!courses.length) {
      throw new Error('课表接口没有返回可用课程（共 ' + kbList.length + ' 条原始记录）');
    }

    // 3. 节次作息
    const xqhId = (kbList[0] && kbList[0].xqh_id) || '';
    let timeSlots = [];
    try { timeSlots = await fetchTimeSlots(xnm, xqm, xqhId); } catch (e) { timeSlots = []; }

    // 4. 保存
    await saveCourses(courses);

    let maxWeek = 0;
    courses.forEach(function (c) { c.weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; }); });
    const config = {};
    if (maxWeek > 0) config.semesterTotalWeeks = maxWeek;
    if (timeSlots.length) {
      const durs = timeSlots.map(function (t) { return toMinutes(t.endTime) - toMinutes(t.startTime); }).filter(function (d) { return d > 0; });
      if (durs.length) {
        const cnt = {};
        durs.forEach(function (d) { cnt[d] = (cnt[d] || 0) + 1; });
        const best = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
        config.defaultClassDuration = parseInt(best, 10);
      }
      const gaps = [];
      for (let i = 1; i < timeSlots.length; i++) {
        const g = toMinutes(timeSlots[i].startTime) - toMinutes(timeSlots[i - 1].endTime);
        if (g >= 0 && g <= 30) gaps.push(g);
      }
      if (gaps.length) {
        const cnt = {};
        gaps.forEach(function (d) { cnt[d] = (cnt[d] || 0) + 1; });
        const best = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
        config.defaultBreakDuration = parseInt(best, 10);
      }
    }
    if (Object.keys(config).length) {
      try { await BP.saveCourseConfig(JSON.stringify(config)); } catch (e) {}
    }
    if (timeSlots.length) {
      try { await BP.savePresetTimeSlots(JSON.stringify(timeSlots)); } catch (e) {}
    }

    let msg = '已导入 ' + courses.length + ' 条课程安排（' + xnmText + ' 第' + xqmText + '学期）';
    if (norm.skipped) msg += '，跳过 ' + norm.skipped + ' 条缺星期/节次/周次的记录';
    toast(msg);
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
