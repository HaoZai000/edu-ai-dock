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

  // CAS 登录页会把教务源站放在 service 参数里，据此推断 jwxt 源站
  function getOrigin() {
    try {
      const u = new URL(location.href);
      const svc = u.searchParams.get('service');
      if (svc && /^https?:\/\//.test(svc)) return new URL(svc).origin;
    } catch (e) {}
    return location.origin;
  }

  const BASE = getOrigin() + '/student';

  async function getJson(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) throw new Error('接口 HTTP ' + r.status);
    if (!ct.includes('json')) {
      const t = await r.text();
      if (/登录页面|login/i.test(t.slice(0, 3000))) throw new Error('登录已失效');
      throw new Error('接口返回非 JSON');
    }
    return await r.json();
  }

  function fmtTime(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    if (!s) return '';
    if (s.indexOf(':') >= 0) {
      const p = s.split(':');
      const h = parseInt(p[0], 10), m = parseInt(p[1], 10);
      if (!isFinite(h) || !isFinite(m)) return '';
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    const n = Number(s);
    if (!isFinite(n)) return '';
    const h = Math.floor(n / 100), m = n % 100;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function minutes(t) {
    const p = String(t || '').split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  async function fetchAcademicOptions() {
    const r = await fetch(BASE + '/for-std/course-table', { credentials: 'same-origin' });
    const html = await r.text();
    if (/<title>\s*登录页面/.test(html)) throw new Error('登录已失效，请重新登录');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#allSemesters') || doc.querySelector('#experimentSemesters') || doc.querySelector('#semesters');
    if (!sel) throw new Error('课表页找不到学期下拉框');
    const options = Array.from(sel.options)
      .filter(function (o) { return o.value && o.value !== 'all'; })
      .map(function (o) { return { value: o.value, text: (o.text || o.textContent || '').trim() }; });
    if (!options.length) throw new Error('学期列表为空');
    let def = 0;
    try {
      const frames = document.getElementsByTagName('iframe');
      for (let i = 0; i < frames.length; i++) {
        const d = frames[i].contentDocument;
        if (!d || !d.querySelector) continue;
        const s = d.querySelector('#allSemesters');
        if (s && s.value) {
          const k = options.findIndex(function (o) { return o.value === s.value; });
          if (k >= 0) { def = k; break; }
        }
      }
    } catch (e) {}
    if (!def) {
      const m = html.match(/var\s+currentSemester\s*=\s*\{([\s\S]*?)\};/);
      if (m) {
        const im = m[1].match(/['"]?id['"]?\s*:\s*(\d+)/);
        if (im) {
          const k = options.findIndex(function (o) { return o.value === im[1]; });
          if (k >= 0) def = k;
        }
      }
    }
    if (!def) {
      try {
        const cw = await getJson(BASE + '/home/get-current-teach-week');
        const k = options.findIndex(function (o) { return cw.currentSemester && o.text.indexOf(cw.currentSemester) >= 0; });
        if (k >= 0) def = k;
      } catch (e) {}
    }
    return { options: options, defaultIndex: def };
  }

  async function chooseSemester(meta) {
    const texts = meta.options.map(function (o) { return o.text; });
    if (!texts.length) throw new Error('学期列表为空');
    if (texts.length === 1) return meta.options[0].value;
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    const picked = await BP.showSingleSelection('选择要导入的学期', JSON.stringify(texts), meta.defaultIndex);
    if (picked === null || picked === undefined || picked === -1) return null;
    let idx = Number(picked);
    if (!Number.isInteger(idx) || idx < 0 || idx >= meta.options.length) idx = texts.indexOf(String(picked));
    if (idx < 0 || idx >= meta.options.length) throw new Error('学期选择无效');
    return meta.options[idx].value;
  }

  function extractTimeSlots(print) {
    const vms = (print && print.studentTableVms) || [];
    let units = [];
    for (let i = 0; i < vms.length; i++) {
      const l = vms[i] && vms[i].timeTableLayout;
      if (l && Array.isArray(l.courseUnitList) && l.courseUnitList.length) { units = l.courseUnitList; break; }
    }
    const map = new Map();
    for (const u of units) {
      const n = Number(u.indexNo !== undefined && u.indexNo !== null ? u.indexNo : u.number);
      const st = fmtTime(u.startTime !== undefined && u.startTime !== null ? u.startTime : u.startTimeText);
      const et = fmtTime(u.endTime !== undefined && u.endTime !== null ? u.endTime : u.endTimeText);
      if (Number.isInteger(n) && n >= 1 && n <= 20 && st && et && minutes(et) > minutes(st)) {
        map.set(n, { number: n, startTime: st, endTime: et });
      }
    }
    return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
  }

  function expandWeeks(str) {
    const out = new Set();
    String(str || '').split(/[,，]/).forEach(function (part) {
      let p = part.trim();
      if (!p) return;
      let parity = '';
      const pm = p.match(/\((单|双)\)/);
      if (pm) { parity = pm[1]; p = p.replace(pm[0], ''); }
      const rg = p.match(/(\d+)\s*[~～—-]\s*(\d+)/);
      if (rg) {
        let a = parseInt(rg[1], 10), b = parseInt(rg[2], 10);
        if (a > b) { const t = a; a = b; b = t; }
        for (let w = Math.max(1, a); w <= b && w <= 30; w++) {
          if (parity === '单' && w % 2 === 0) continue;
          if (parity === '双' && w % 2 === 1) continue;
          out.add(w);
        }
      } else {
        const w = parseInt(p, 10);
        if (Number.isInteger(w) && w >= 1 && w <= 30) {
          if (parity === '单' && w % 2 === 0) return;
          if (parity === '双' && w % 2 === 1) return;
          out.add(w);
        }
      }
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function normalizeCourses(acts, slots) {
    const rows = [];
    let skipped = 0;
    for (const a of acts) {
      if (!a) continue;
      const name = String(a.courseName || a.experimentName || a.lessonName || '').trim();
      const day = Number(a.weekday);
      const s = Number(a.startUnit), e = Number(a.endUnit);
      let weeks = Array.isArray(a.weekIndexes)
        ? a.weekIndexes.map(Number).filter(function (w) { return Number.isInteger(w) && w >= 1 && w <= 30; })
        : expandWeeks(a.weeksStr);
      weeks = Array.from(new Set(weeks)).sort(function (x, y) { return x - y; });
      if (!name || !Number.isInteger(day) || day < 1 || day > 7 ||
          !Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s || e > 20 || !weeks.length) {
        skipped++;
        continue;
      }
      const teachers = Array.isArray(a.teachers) ? a.teachers.filter(Boolean).join('、') : (a.teachers ? String(a.teachers) : '');
      const place = [a.campus, a.room].filter(function (v) { return v !== null && v !== undefined && String(v).trim(); })
        .map(function (v) { return String(v).trim(); }).join(' ');
      rows.push({
        name: name, teacher: teachers, position: place, day: day,
        startSection: s, endSection: e, weeks: weeks,
        _st: fmtTime(a.startTime), _et: fmtTime(a.endTime)
      });
    }

    const g1 = new Map();
    for (const c of rows) {
      const k = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      if (!g1.has(k)) g1.set(k, []);
      g1.get(k).push(c);
    }
    const stage1 = [];
    for (const arr of g1.values()) {
      arr.sort(function (a, b) { return a.startSection - b.startSection || a.endSection - b.endSection; });
      let cur = null;
      for (const c of arr) {
        if (cur && c.startSection === cur.endSection + 1) cur.endSection = c.endSection;
        else { cur = Object.assign({}, c); stage1.push(cur); }
      }
    }

    const g2 = new Map();
    for (const c of stage1) {
      const k = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!g2.has(k)) g2.set(k, []);
      g2.get(k).push(c);
    }
    const final = [];
    const slotMap = new Map(slots.map(function (s) { return [s.number, s]; }));
    for (const arr of g2.values()) {
      const base = Object.assign({}, arr[0]);
      const ws = new Set();
      for (const c of arr) c.weeks.forEach(function (w) { ws.add(w); });
      base.weeks = Array.from(ws).sort(function (a, b) { return a - b; });
      const withSt = arr.find(function (c) { return c._st; });
      const withEt = arr.find(function (c) { return c._et; });
      base._st = withSt ? withSt._st : '';
      base._et = withEt ? withEt._et : '';
      if (base._st && base._et) {
        const a = slotMap.get(base.startSection), b = slotMap.get(base.endSection);
        if (!a || !b || a.startTime !== base._st || b.endTime !== base._et) {
          base.isCustomTime = true;
          base.customStartTime = base._st;
          base.customEndTime = base._et;
        }
      }
      delete base._st;
      delete base._et;
      final.push(base);
    }
    return { courses: final, skipped: skipped };
  }

  function buildConfig(sem, slots) {
    if (!sem) return null;
    const cfg = {};
    if (sem.startDate) cfg.semesterStartDate = sem.startDate;
    if (sem.startDate && sem.endDate) {
      const d = (Date.parse(sem.endDate + 'T00:00:00Z') - Date.parse(sem.startDate + 'T00:00:00Z')) / 86400000;
      if (d > 0 && d < 400) cfg.semesterTotalWeeks = Math.ceil(d / 7);
    }
    if (slots.length >= 2 && slots[0].number === 1 && slots[1].number === 2) {
      const dur = minutes(slots[0].endTime) - minutes(slots[0].startTime);
      const gap = minutes(slots[1].startTime) - minutes(slots[0].endTime);
      if (dur >= 20 && dur <= 180) cfg.defaultClassDuration = dur;
      if (gap >= 0 && gap <= 60) cfg.defaultBreakDuration = gap;
    }
    return cfg;
  }

  async function runImportFlow() {
    const meta = await fetchAcademicOptions();
    const sid = await chooseSemester(meta);
    if (sid === null) { toast('已取消，未导入'); return; }

    toast('正在读取课表…');
    const printUrl = BASE + '/for-std/course-table/semester/' + encodeURIComponent(sid) + '/print-data?semesterId=' + encodeURIComponent(sid) + '&hasExperiment=true';
    const semUrl = BASE + '/ws/semester/get/' + encodeURIComponent(sid);
    const results = await Promise.all([
      getJson(printUrl).catch(function () { return null; }),
      getJson(semUrl).catch(function () { return null; })
    ]);
    const print = results[0], sem = results[1];
    if (!print || !Array.isArray(print.studentTableVms) || !print.studentTableVms.length) throw new Error('课表打印接口未返回数据');
    const acts = [];
    for (const vm of print.studentTableVms) if (vm && Array.isArray(vm.activities)) acts.push.apply(acts, vm.activities);
    const slots = extractTimeSlots(print);
    const normalized = normalizeCourses(acts, slots);
    if (!normalized.courses.length) throw new Error('没有解析到有效课程');
    const cfg = buildConfig(sem, slots);

    const term = sem && sem.nameZh ? sem.nameZh : sid;
    let tip = '学期：' + term + '，课程 ' + normalized.courses.length + ' 条';
    if (normalized.skipped) tip += '，跳过 ' + normalized.skipped + ' 条信息不全';
    if (slots.length) tip += '，作息 ' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '。是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    await saveCourses(normalized.courses);

    let cfgFailed = false;
    if (cfg) {
      try {
        if (BP && typeof BP.saveCourseConfig === 'function') {
          const r = await BP.saveCourseConfig(JSON.stringify(cfg));
          if (r === false || r === 'false' || r === null) cfgFailed = true;
        }
      } catch (e) {
        cfgFailed = true;
      }
    }

    let slotsFailed = false;
    if (slots.length) {
      try {
        if (BP && typeof BP.savePresetTimeSlots === 'function') {
          const r = await BP.savePresetTimeSlots(JSON.stringify(slots));
          if (r === false || r === 'false' || r === null) slotsFailed = true;
        }
      } catch (e) {
        slotsFailed = true;
      }
    }

    toast('已导入 ' + term + ' 共 ' + normalized.courses.length + ' 门课程' +
      (normalized.skipped ? '，跳过无效数据 ' + normalized.skipped + ' 条' : '') +
      (cfgFailed ? '（学期配置未保存）' : '') +
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
