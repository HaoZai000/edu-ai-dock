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

  const BASE = location.origin;
  const KB_PATH = '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const JC_PATH = '/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';
  const INDEX_PATH = '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151';

  function parseWeeks(raw) {
    const out = {};
    if (!raw) return out;
    String(raw).replace(/周/g, '').split(/[,，]/).forEach(function (part) {
      const seg = part.trim();
      if (!seg) return;
      const onlyOdd = seg.indexOf('单') >= 0;
      const onlyEven = seg.indexOf('双') >= 0;
      const s = seg.replace(/[（()）单双]/g, '');
      const range = s.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
      if (range) {
        let lo = parseInt(range[1], 10);
        let hi = parseInt(range[2], 10);
        if (lo > hi) { const t = lo; lo = hi; hi = t; }
        for (let i = Math.max(1, lo); i <= hi && i <= 30; i++) {
          if (onlyOdd && i % 2 === 0) continue;
          if (onlyEven && i % 2 === 1) continue;
          out[i] = true;
        }
      } else {
        const n = parseInt(s, 10);
        if (!isNaN(n) && n >= 1 && n <= 30) out[n] = true;
      }
    });
    return out;
  }

  function parseSections(str) {
    const s = String(str || '').trim();
    const m = s.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const n = parseInt(s, 10);
    if (!isNaN(n)) return [n, n];
    return null;
  }

  function normalizeCourses(list) {
    const items = [];
    const bad = { day: 0, section: 0, weeks: 0 };
    for (let i = 0; i < list.length; i++) {
      const r = list[i] || {};
      const name = (r.kcmc || '').trim();
      if (!name) continue;
      const day = parseInt(r.xqj, 10);
      if (!(day >= 1 && day <= 7)) { bad.day++; continue; }
      const sec = parseSections(r.jcs || r.jcor || r.jc);
      if (!sec) { bad.section++; continue; }
      const s = sec[0];
      const e = sec[1];
      if (!(s >= 1 && e >= 1 && s <= 12 && e <= 12 && s <= e)) { bad.section++; continue; }
      const weekMap = parseWeeks(r.zcd);
      const weeks = Object.keys(weekMap).map(Number).sort(function (a, b) { return a - b; });
      if (!weeks.length) { bad.weeks++; continue; }
      items.push({
        name: name,
        position: (r.cdmc || '').trim(),
        teacher: (r.xm || '').trim(),
        day: day,
        startSection: s,
        endSection: e,
        weeks: weeks
      });
    }

    // 同一门课、同一周次集合下把连续节次并成一段
    const g1 = {};
    items.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      (g1[k] = g1[k] || []).push(c);
    });
    const stage1 = [];
    Object.keys(g1).forEach(function (key) {
      const arr = g1[key].slice().sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = Object.assign({}, arr[0], { weeks: arr[0].weeks.slice() });
      for (let j = 1; j < arr.length; j++) {
        const c = arr[j];
        if (c.startSection <= cur.endSection + 1) {
          cur.endSection = Math.max(cur.endSection, c.endSection);
        } else {
          stage1.push(cur);
          cur = Object.assign({}, c, { weeks: c.weeks.slice() });
        }
      }
      stage1.push(cur);
    });

    // 同课同节次合并周次
    const g2 = {};
    stage1.forEach(function (c) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!g2[k]) g2[k] = Object.assign({}, c, { weeks: [] });
      g2[k].weeks = g2[k].weeks.concat(c.weeks);
    });
    const result = [];
    Object.keys(g2).forEach(function (key) {
      const c = g2[key];
      const seen = {};
      c.weeks.forEach(function (w) { seen[w] = true; });
      c.weeks = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
      result.push(c);
    });
    return { courses: result, bad: bad };
  }

  function extractOptions(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const opts = function (id) {
      const sel = doc.getElementById(id) || doc.querySelector('[name="' + id + '"]');
      if (!sel || !sel.options) return [];
      const out = [];
      for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        const v = (o.value || '').trim();
        let t = (o.textContent || '').trim();
        if (!v) continue;
        if (t.indexOf('请选择') >= 0 || t === '---') continue;
        if (!t) t = v;
        const isSel = !!(o.selected || (o.hasAttribute && o.hasAttribute('selected')));
        out.push({ value: v, text: t, selected: isSel });
      }
      return out;
    };
    return { years: opts('xnm'), terms: opts('xqm') };
  }

  async function fetchAcademicOptions() {
    let o = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = BASE + INDEX_PATH + (attempt ? '&_=' + Date.now() : '');
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) continue;
        o = extractOptions(await res.text());
        if (o.years.length && o.terms.length) return o;
      } catch (e) {}
    }
    throw new Error('无法读取学年/学期下拉框，请确认已登录教务系统');
  }

  async function chooseSemester() {
    const o = await fetchAcademicOptions();
    let yi = 0;
    let ti = 0;
    for (let i = 0; i < o.years.length; i++) if (o.years[i].selected) { yi = i; break; }
    for (let i = 0; i < o.terms.length; i++) if (o.terms[i].selected) { ti = i; break; }

    const y = await select('选择学年', o.years.map(function (x) { return x.text; }), yi);
    if (y === null) return null;
    const t = await select('选择学期', o.terms.map(function (x) { return x.text; }), ti);
    if (t === null) return null;
    const yOpt = o.years[y];
    const tOpt = o.terms[t];
    if (!yOpt || !tOpt) throw new Error('学年/学期选择无效');
    return { xnm: yOpt.value, xqm: tOpt.value, label: yOpt.text + ' ' + tOpt.text };
  }

  async function fetchCourses(xnm, xqm) {
    const body = 'xnm=' + encodeURIComponent(xnm) + '&xqm=' + encodeURIComponent(xqm) +
      '&kzlx=ck&xsdm=&kclbdm=&kclxdm=';
    const res = await fetch(BASE + KB_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!res.ok) throw new Error('课表请求失败（HTTP ' + res.status + '）');
    const data = await res.json();
    if (!data || !Array.isArray(data.kbList) || !data.kbList.length) throw new Error('课表接口未返回课程');
    return data.kbList;
  }

  async function fetchTimeSlots(xnm, xqm) {
    const body = 'xnm=' + encodeURIComponent(xnm) + '&xqm=' + encodeURIComponent(xqm);
    const res = await fetch(BASE + JC_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr
      .map(function (r) {
        return { number: parseInt(r.xsdj || r.jcmc, 10), startTime: r.qssj, endTime: r.jssj };
      })
      .filter(function (t) {
        return t.number >= 1 &&
          /^\d{2}:\d{2}$/.test(String(t.startTime || '')) &&
          /^\d{2}:\d{2}$/.test(String(t.endTime || ''));
      })
      .sort(function (a, b) { return a.number - b.number; });
  }

  async function runImportFlow() {
    const sem = await chooseSemester();
    if (!sem) { toast('已取消，未导入'); return; }

    toast('正在读取课表…');
    const list = await fetchCourses(sem.xnm, sem.xqm);
    const slots = await fetchTimeSlots(sem.xnm, sem.xqm).catch(function () { return []; });

    const out = normalizeCourses(list);
    const courses = out.courses;
    if (!courses.length) throw new Error('没有可用的课程数据');

    const skipped = out.bad.day + out.bad.section + out.bad.weeks;
    let tip = '学期：' + sem.label + '，课程 ' + courses.length + ' 条';
    if (skipped) tip += '，跳过 ' + skipped + ' 条异常';
    if (slots.length) tip += '，作息 ' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    await saveCourses(courses);

    let slotsFailed = false;
    if (slots.length) {
      try {
        if (BP && typeof BP.savePresetTimeSlots === 'function') {
          await BP.savePresetTimeSlots(JSON.stringify(slots));
        }
      } catch (e) {
        slotsFailed = true;
      }
    }

    toast('已导入 ' + courses.length + ' 条课程（' + sem.label + '）' +
      (skipped ? '，跳过 ' + skipped + ' 条异常' : '') +
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
