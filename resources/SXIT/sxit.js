// 山西工学院（172.16.46.67:1000，正方 jwglxt）整学期课表适配器
(async function main() {
  const BASE = location.origin;
  const INDEX_URL = BASE + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151';
  const KB_URL = BASE + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
  const JC_URL = BASE + '/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151';

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

  async function postForm(url, params) {
    const body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]);
    }).join('&');
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  }

  async function getText(url) {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  }

  function parseOptions(doc, id) {
    const sel = doc.querySelector('#' + id) || doc.querySelector('select[name="' + id + '"]');
    const out = [];
    if (!sel) return out;
    const opts = sel.querySelectorAll('option');
    for (let i = 0; i < opts.length; i++) {
      const v = (opts[i].getAttribute('value') || '').trim();
      const t = (opts[i].textContent || '').trim();
      if (!v) continue;
      out.push({ value: v, text: t, selected: opts[i].hasAttribute('selected') });
    }
    return out;
  }

  function defaultIndex(list) {
    for (let i = 0; i < list.length; i++) if (list[i].selected) return i;
    return 0;
  }

  async function chooseSemester(doc) {
    const years = parseOptions(doc, 'xnm');
    const terms = parseOptions(doc, 'xqm');
    if (!years.length || !terms.length) return null;
    const pick = async function (title, list) {
      // 只有一个选项时直接使用，避免多余的选择交互
      if (list.length === 1) return list[0];
      const idx = await select(title, list.map(function (o) { return o.text; }), defaultIndex(list));
      const n = Number(idx);
      if (idx === null || idx === undefined || isNaN(n) || n < 0 || n >= list.length) return null;
      return list[n];
    };
    const year = await pick('选择学年', years);
    if (!year) return null;
    const term = await pick('选择学期', terms);
    if (!term) return null;
    return { year: year, term: term };
  }

  function parseWeeks(zcd) {
    const out = [];
    if (!zcd) return out;
    const s = String(zcd).replace(/（/g, '(').replace(/）/g, ')').replace(/\s/g, '');
    const parts = s.split(/[,，;；]/);
    for (let p = 0; p < parts.length; p++) {
      const seg = parts[p].trim();
      if (!seg) continue;
      let m = seg.match(/^(\d+)-(\d+)周(?:\((单|双)\))?$/);
      if (m) {
        let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { const t = a; a = b; b = t; }
        for (let i = a; i <= b && i <= 30; i++) {
          if (i < 1) continue;
          if (m[3] === '单' && i % 2 === 0) continue;
          if (m[3] === '双' && i % 2 === 1) continue;
          out.push(i);
        }
        continue;
      }
      m = seg.match(/^(\d+)周(?:\((单|双)\))?$/);
      if (m) {
        const i = parseInt(m[1], 10);
        if (i < 1 || i > 30) continue;
        if (m[2] === '单' && i % 2 === 0) continue;
        if (m[2] === '双' && i % 2 === 1) continue;
        out.push(i);
      }
    }
    return Array.from(new Set(out)).sort(function (a, b) { return a - b; });
  }

  function parseSections(jcs) {
    const s = String(jcs || '');
    let m = s.match(/(\d+)\s*-\s*(\d+)/);
    if (m) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      return a <= b ? [a, b] : [b, a];
    }
    m = s.match(/^(\d+)$/);
    if (m) return [parseInt(m[1], 10), parseInt(m[1], 10)];
    return null;
  }

  function sameWeeks(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function normalizeCourses(rawList) {
    let bad = 0;
    const groups = new Map();
    for (let i = 0; i < rawList.length; i++) {
      const r = rawList[i] || {};
      const name = String(r.kcmc || '').trim();
      const day = parseInt(r.xqj, 10);
      const sec = parseSections(r.jcs || r.jc);
      const weeks = parseWeeks(r.zcd);
      if (!name || !(day >= 1 && day <= 7) || !sec || !weeks.length) { bad++; continue; }
      let position = String(r.cdmc || '').trim();
      if (position === '未排地点' || position === '无') position = '';
      const teacher = String(r.xm || '').trim();
      const key = [name, teacher, position, day].join('|');
      const item = {
        name: name, teacher: teacher, position: position, day: day,
        startSection: sec[0], endSection: sec[1], weeks: weeks
      };
      if (!groups.has(key)) groups.set(key, []);
      const arr = groups.get(key);
      let hit = null;
      for (let k = 0; k < arr.length; k++) {
        if (arr[k].startSection === item.startSection && arr[k].endSection === item.endSection) {
          hit = arr[k]; break;
        }
      }
      if (hit) {
        hit.weeks = Array.from(new Set(hit.weeks.concat(weeks))).sort(function (a, b) { return a - b; });
      } else {
        arr.push(item);
      }
    }
    const courses = [];
    groups.forEach(function (arr) {
      arr.sort(function (a, b) { return a.startSection - b.startSection; });
      const merged = [];
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        const last = merged[merged.length - 1];
        if (last && last.endSection + 1 === it.startSection && sameWeeks(last.weeks, it.weeks)) {
          last.endSection = it.endSection;
        } else {
          merged.push({
            name: it.name, teacher: it.teacher, position: it.position, day: it.day,
            startSection: it.startSection, endSection: it.endSection, weeks: it.weeks.slice()
          });
        }
      }
      for (let i = 0; i < merged.length; i++) courses.push(merged[i]);
    });
    return { courses: courses, bad: bad };
  }

  function toMin(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  async function fetchTimeSlots(xnm, xqm, xqhId) {
    try {
      const text = await postForm(JC_URL, { xnm: xnm, xqm: xqm, xqh_id: xqhId });
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : []);
      const slots = [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        const num = parseInt(it.jcmc, 10);
        const st = String(it.qssj || '').trim();
        const en = String(it.jssj || '').trim();
        if (!num || toMin(st) === null || toMin(en) === null) continue;
        slots.push({ number: num, startTime: st, endTime: en });
      }
      slots.sort(function (a, b) { return a.number - b.number; });
      return slots;
    } catch (e) {
      return [];
    }
  }

  async function runImportFlow() {
    const indexText = await getText(INDEX_URL);
    const doc = new DOMParser().parseFromString(indexText, 'text/html');
    const choice = await chooseSemester(doc);
    if (!choice) { toast('已取消，未导入'); return; }
    const xnm = choice.year.value;
    const xqm = choice.term.value;

    const kbText = await postForm(KB_URL, { xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
    let kb;
    try {
      kb = JSON.parse(kbText);
    } catch (e) {
      throw new Error('课表接口返回的不是数据，可能登录已失效，请重新登录后再试');
    }
    const rawList = Array.isArray(kb.kbList) ? kb.kbList : [];
    if (!rawList.length) throw new Error(choice.year.text + ' ' + choice.term.text + ' 没有查到课程');

    let xqhId = '';
    for (let i = 0; i < rawList.length; i++) {
      if (rawList[i] && rawList[i].xqh_id) { xqhId = String(rawList[i].xqh_id); break; }
    }
    const timeSlots = xqhId ? await fetchTimeSlots(xnm, xqm, xqhId) : [];

    const norm = normalizeCourses(rawList);
    if (!norm.courses.length) throw new Error('课表数据解析后没有有效课程');

    let tip = '学期：' + choice.year.text + ' 第' + choice.term.text + '学期\n课程：' + norm.courses.length + ' 条';
    if (norm.bad) tip += '（跳过 ' + norm.bad + ' 条信息不全的记录）';
    if (timeSlots.length) tip += '\n作息：' + timeSlots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    if (!BP || typeof BP.saveImportedCourses !== 'function') throw new Error('桥未就绪，请重试');
    const saved = await BP.saveImportedCourses(JSON.stringify(norm.courses));
    if (saved === false || saved === 'false' || saved === null) throw new Error('课程保存失败');

    let configFailed = false;
    let slotsFailed = false;
    if (timeSlots.length) {
      const cfg = {};
      const d = toMin(timeSlots[0].endTime) - toMin(timeSlots[0].startTime);
      if (d > 0) cfg.defaultClassDuration = d;
      if (timeSlots.length >= 2) {
        const br = toMin(timeSlots[1].startTime) - toMin(timeSlots[0].endTime);
        if (br > 0) cfg.defaultBreakDuration = br;
      }
      if (Object.keys(cfg).length) {
        try {
          await BP.saveCourseConfig(JSON.stringify(cfg));
        } catch (e) {
          configFailed = true;
        }
      }
      try {
        await BP.savePresetTimeSlots(JSON.stringify(timeSlots));
      } catch (e) {
        slotsFailed = true;
      }
    }

    if (BD && typeof BD.notifyTaskCompletion === 'function') {
      try { BD.notifyTaskCompletion(); } catch (e) {}
    } else if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
    toast('已导入 ' + norm.courses.length + ' 条课程' +
      (norm.bad ? '，跳过 ' + norm.bad + ' 条信息不全的记录' : '') +
      (configFailed ? '（节次时长未保存）' : '') +
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
