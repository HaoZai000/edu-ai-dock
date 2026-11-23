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
  const PAGE = '/jsxsd/xskb/xskb_list.do';
  // 用户提供的作息
  const TIMESLOTS = [
    { number: 1,  startTime: '08:00', endTime: '08:50' },
    { number: 2,  startTime: '09:00', endTime: '09:50' },
    { number: 3,  startTime: '10:10', endTime: '11:00' },
    { number: 4,  startTime: '11:10', endTime: '12:00' },
    { number: 5,  startTime: '14:30', endTime: '15:20' },
    { number: 6,  startTime: '15:30', endTime: '16:20' },
    { number: 7,  startTime: '16:30', endTime: '17:20' },
    { number: 8,  startTime: '17:30', endTime: '18:20' },
    { number: 9,  startTime: '18:30', endTime: '19:20' },
    { number: 10, startTime: '19:30', endTime: '20:20' },
    { number: 11, startTime: '20:30', endTime: '21:20' }
  ];

  function decodeHtml(s) {
    if (s == null) return '';
    const doc = new DOMParser().parseFromString('<div>' + String(s) + '</div>', 'text/html');
    return (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function expandWeeks(s) {
    const out = [];
    String(s || '').split(/[,，、;；]/).forEach(function (part) {
      let p = part.trim();
      if (!p) return;
      const onlyOdd = p.indexOf('单') >= 0;
      const onlyEven = p.indexOf('双') >= 0;
      p = p.replace(/[（）()\s周]|单|双/g, '');
      const push = function (w) {
        if (w < 1 || w > 30) return;
        if (onlyOdd && w % 2 === 0) return;
        if (onlyEven && w % 2 === 1) return;
        out.push(w);
      };
      const m = p.match(/^(\d+)\s*[-—~至]\s*(\d+)$/);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) push(i);
      } else if (/^\d+$/.test(p)) {
        push(parseInt(p, 10));
      }
    });
    return Array.from(new Set(out)).sort(function (a, b) { return a - b; });
  }

  async function fetchAcademicOptions() {
    const res = await fetch(BASE + PAGE, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('无法打开课表查询页');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const sel = doc.querySelector('#xnxq01id');
    if (!sel || !sel.options.length) throw new Error('未找到学年学期下拉框');
    const opts = Array.from(sel.options).map(function (o) {
      return { label: (o.textContent || '').trim(), value: o.value };
    });
    let def = 0;
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].selected) { def = i; break; }
    }
    return { opts: opts, def: def };
  }

  async function fetchTimetable(xnxq) {
    const body = new URLSearchParams();
    body.append('cj0701id', '');
    body.append('zc', '');
    body.append('demo', '');
    body.append('xnxq01id', xnxq);
    body.append('sfFD', '1');
    const res = await fetch(BASE + PAGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error('课表请求失败 status=' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#xnxq01id');
    const cur = sel ? sel.value : '';
    if (cur !== xnxq) throw new Error('学期切换未生效: want=' + xnxq + ' got=' + cur);
    return doc;
  }

  function parseTimetable(doc) {
    const table = doc.querySelector('#kbtable');
    if (!table) return [];
    const rows = table.querySelectorAll('tr');
    const list = [];
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].cells;
      if (!cells || cells.length < 8) continue;
      for (let d = 1; d <= 7; d++) {
        const td = cells[d];
        if (!td) continue;
        const div = td.querySelector('div.kbcontent');
        if (!div) continue;
        const blocks = String(div.innerHTML).split(/-{4,}/);
        for (let k = 0; k < blocks.length; k++) {
          const seg = blocks[k].replace(/^(?:\s|<br\s*\/?>)+/i, '');
          if (!seg.trim()) continue;
          const name = decodeHtml(seg.split(/<br/i)[0].replace(/<[^>]*>/g, ''));
          if (!name) continue;
          const tm = seg.match(/title=['"]老师['"]>([\s\S]*?)<\/font>/i);
          const wm = seg.match(/title=['"]周次\(节次\)['"]>([\s\S]*?)<\/font>/i);
          const rm = seg.match(/title=['"]教室['"]>([\s\S]*?)<\/font>/i);
          if (!wm) continue;
          const wtext = decodeHtml(wm[1]);
          const wPart = (wtext.match(/^([^(]*)\(周\)/) || [])[1] || '';
          const sPart = (wtext.match(/\[([^\]]*)节\]/) || [])[1] || '';
          const nums = (sPart.match(/\d+/g) || []).map(Number);
          const weeks = expandWeeks(wPart);
          if (!weeks.length || !nums.length) continue;
          list.push({
            name: name,
            position: rm ? decodeHtml(rm[1]) : '',
            teacher: tm ? decodeHtml(tm[1]) : '',
            day: d,
            startSection: Math.min.apply(null, nums),
            endSection: Math.max.apply(null, nums),
            weeks: weeks
          });
        }
      }
    }
    return list;
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.name || !(c.day >= 1 && c.day <= 7) || !(c.startSection >= 1) ||
          !(c.endSection >= c.startSection) || !Array.isArray(c.weeks) || !c.weeks.length) {
        skipped++;
        continue;
      }
      valid.push({ name: c.name, position: c.position, teacher: c.teacher,
        day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() });
    }
    const stage1 = [];
    valid.forEach(function (c) {
      const wk = c.weeks.join(',');
      let done = false;
      for (let i = 0; i < stage1.length; i++) {
        const x = stage1[i];
        if (x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
            x.day === c.day && x.weeks.join(',') === wk &&
            c.startSection <= x.endSection + 1 && c.endSection >= x.startSection - 1) {
          x.startSection = Math.min(x.startSection, c.startSection);
          x.endSection = Math.max(x.endSection, c.endSection);
          done = true;
          break;
        }
      }
      if (!done) stage1.push({ name: c.name, position: c.position, teacher: c.teacher,
        day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() });
    });
    const stage2 = [];
    stage1.forEach(function (c) {
      let done = false;
      for (let i = 0; i < stage2.length; i++) {
        const x = stage2[i];
        if (x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
            x.day === c.day && x.startSection === c.startSection && x.endSection === c.endSection) {
          x.weeks = Array.from(new Set(x.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
          done = true;
          break;
        }
      }
      if (!done) stage2.push({ name: c.name, position: c.position, teacher: c.teacher,
        day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: c.weeks.slice() });
    });
    return { courses: stage2, skipped: skipped };
  }

  async function runImportFlow() {
    const info = await fetchAcademicOptions();
    const idx = await select('选择学年学期', info.opts.map(function (o) { return o.label; }), info.def);
    if (idx === null) { toast('已取消导入'); return; }
    const xnxq = info.opts[idx].value;
    if (!xnxq) throw new Error('无法获取学年学期');

    const ok = await alert('确认导入', '将导入「' + info.opts[idx].label + '」整学期课表，是否继续？', '开始导入');
    if (!ok) { toast('已取消导入'); return; }

    const doc = await fetchTimetable(xnxq);
    const raw = parseTimetable(doc);
    const result = normalizeCourses(raw);
    if (!result.courses.length) throw new Error('未解析到课程（原始记录 ' + raw.length + ' 条）');

    await saveCourses(result.courses);
    try { await BP.savePresetTimeSlots(JSON.stringify(TIMESLOTS)); } catch (e) {}
    toast('已导入 ' + result.courses.length + ' 条课程' + (result.skipped ? '，跳过 ' + result.skipped + ' 条异常' : ''));
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
