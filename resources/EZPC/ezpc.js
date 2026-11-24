// 鄂州职业大学教务系统（ezzyjw）整学期课表适配器
(async function main() {
  const BP = typeof shiguangBridgePromise !== 'undefined' ? shiguangBridgePromise : null;

  function toast(msg) {
    const b = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
    if (b && typeof b.showToast === 'function') {
      try { b.showToast(msg); } catch (e) {}
      return;
    }
    if (BP && typeof BP.showToast === 'function') {
      try { BP.showToast(msg); } catch (e) {}
    }
  }

  async function alert(title, content, confirmText) {
    if (!BP || typeof BP.showAlert !== 'function') return true;
    return (await BP.showAlert(title, content, confirmText || '确定')) !== false;
  }

  async function select(title, labels, def) {
    if (!BP || typeof BP.showSingleSelection !== 'function') throw new Error('桥未就绪，请重试');
    return await BP.showSingleSelection(title, JSON.stringify(labels), def);
  }

  async function saveOk(name, payload) {
    if (!BP || typeof BP[name] !== 'function') throw new Error('桥未就绪，请重试');
    const r = await BP[name](payload);
    return !(r === false || r === 'false' || r === null);
  }

  async function notifyTaskCompletion() {
    const b = typeof shiguangBridge !== 'undefined' ? shiguangBridge : null;
    if (b && typeof b.notifyTaskCompletion === 'function') {
      try { b.notifyTaskCompletion(); } catch (e) {}
      return;
    }
    if (BP && typeof BP.notifyTaskCompletion === 'function') {
      try { await BP.notifyTaskCompletion(); } catch (e) {}
    }
  }

  async function post(path, body) {
    const res = await fetch(location.origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body || '',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('请求失败：HTTP ' + res.status);
    return await res.text();
  }

  async function fetchAcademicOptions() {
    const text = await post('/ezzyjw/frame/droplist/getDropLists.action',
      'comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0');
    let arr;
    try { arr = JSON.parse(text); } catch (e) { throw new Error('学期列表解析失败，登录可能已失效'); }
    if (!Array.isArray(arr) || !arr.length) throw new Error('未取到学期选项，登录可能已失效');
    let def = 0;
    try {
      const yt = JSON.parse(await post('/ezzyjw/jw/common/showYearTerm.action', ''));
      const cur = yt.xn + '-' + yt.xqM;
      const i = arr.findIndex(function (x) { return String(x.code) === cur; });
      if (i >= 0) def = i;
    } catch (e) {}
    return { options: arr, def: def };
  }

  // 学期 code 可能是「2025-2026-1」或「2025-1」，学年要保留完整范围
  function splitCode(code) {
    const parts = String(code || '').split('-').filter(function (x) { return x !== ''; });
    if (parts.length >= 3) return { xn: parts.slice(0, parts.length - 1).join('-'), xq: parts[parts.length - 1] };
    if (parts.length === 2) return { xn: parts[0], xq: parts[1] };
    return null;
  }

  async function chooseSemester() {
    const info = await fetchAcademicOptions();
    let opt;
    // 只有一个学期时直接使用，避免多余的选择交互
    if (info.options.length === 1) {
      opt = info.options[0];
    } else {
      const labels = info.options.map(function (x) { return x.name; });
      const picked = await select('选择学期', labels, info.def);
      const i = Number(picked);
      if (picked === null || picked === undefined || !Number.isInteger(i) || i < 0 || !info.options[i]) return null;
      opt = info.options[i];
    }
    const sem = splitCode(opt.code);
    if (!sem) throw new Error('学期代码格式异常：' + opt.code);
    return { xn: sem.xn, xq: sem.xq, label: opt.name };
  }

  function okWeek(w, mode) {
    if (w < 1 || w > 30) return false;
    if (mode === 1) return w % 2 === 1;
    if (mode === 2) return w % 2 === 0;
    return true;
  }

  function parseWeeks(expr) {
    let s = String(expr).replace(/周/g, '').replace(/[\[\]]/g, '').trim();
    let mode = 0;
    if (/单/.test(s)) { mode = 1; s = s.replace(/单/g, ''); }
    else if (/双/.test(s)) { mode = 2; s = s.replace(/双/g, ''); }
    const out = [];
    s.split(/[,，、;；\s]+/).filter(Boolean).forEach(function (part) {
      const m = part.match(/^(\d{1,2})\s*[-~—至]\s*(\d{1,2})$/);
      if (m) {
        let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { const t = a; a = b; b = t; }
        for (let w = a; w <= b; w++) if (okWeek(w, mode)) out.push(w);
      } else if (/^\d{1,2}$/.test(part)) {
        const w = parseInt(part, 10);
        if (okWeek(w, mode)) out.push(w);
      }
    });
    return Array.from(new Set(out)).sort(function (a, b) { return a - b; });
  }

  function cnDay(c) {
    const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    return map[c] || 0;
  }

  function parseTimeSlots(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const slots = [];
    doc.querySelectorAll('td.kb-content').forEach(function (td) {
      const m = td.textContent.trim().match(/^(\d{1,2})\s*[\(（](\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})[\)）]$/);
      if (m) slots.push({ number: parseInt(m[1], 10), startTime: m[2], endTime: m[3] });
    });
    slots.sort(function (a, b) { return a.number - b.number; });
    return slots;
  }

  function parseCourses(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    doc.querySelectorAll('div.weeklesson').forEach(function (div) {
      const lis = div.querySelectorAll('li');
      function pick(label) {
        for (let i = 0; i < lis.length; i++) {
          const t = lis[i].textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
          if (t.indexOf(label) === 0) return t.slice(label.length).trim();
        }
        return '';
      }
      const name = pick('课程名称：');
      if (!name) return;
      const teacher = pick('任课教师：');
      const timeText = pick('上课时间：');
      const position = pick('上课地点：');
      const wm = timeText.match(/\[([^\[\]]*周[^\[\]]*)\]/);
      const weeks = wm ? parseWeeks(wm[1]) : [];
      let day = 0, startSection = 0, endSection = 0;
      const sm = timeText.match(/([一二三四五六日天])\s*\[(\d{1,2})\s*(?:[-~—]\s*(\d{1,2}))?\s*节\]/);
      if (sm) {
        day = cnDay(sm[1]);
        startSection = parseInt(sm[2], 10);
        endSection = sm[3] ? parseInt(sm[3], 10) : startSection;
      } else {
        const im = String(div.id || '').match(/^weekly0?(\d+)_(\d+)$/);
        if (im) { day = parseInt(im[1], 10); startSection = parseInt(im[2], 10); endSection = startSection; }
      }
      out.push({ name: name, position: position, teacher: teacher,
        day: day, startSection: startSection, endSection: endSection, weeks: weeks });
    });
    return out;
  }

  function normalizeCourses(list) {
    const valid = [];
    let skipped = 0;
    list.forEach(function (c) {
      if (!c.name || !(c.day >= 1 && c.day <= 7) || !(c.startSection >= 1) ||
          !(c.endSection >= c.startSection) || !c.weeks.length) { skipped++; return; }
      valid.push(c);
    });

    const dedup = new Map();
    valid.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection,
        c.weeks.slice().sort(function (a, b) { return a - b; }).join(',')].join('|');
      if (!dedup.has(key)) dedup.set(key, Object.assign({}, c, { weeks: c.weeks.slice() }));
    });
    const arr = Array.from(dedup.values());

    // 同一门课相邻节次且周次一致时合并成连堂
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
          if (i === j) continue;
          const a = arr[i], b = arr[j];
          if (a.name === b.name && a.teacher === b.teacher && a.position === b.position &&
              a.day === b.day && a.weeks.join(',') === b.weeks.join(',') &&
              a.endSection + 1 === b.startSection) {
            a.endSection = b.endSection;
            arr.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }

    const finalMap = new Map();
    arr.forEach(function (c) {
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (!finalMap.has(key)) finalMap.set(key, Object.assign({}, c));
      else {
        const e = finalMap.get(key);
        e.weeks = Array.from(new Set(e.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      }
    });
    return { courses: Array.from(finalMap.values()), skipped: skipped };
  }

  async function fetchPages(xn, xq) {
    // 接口按教学周分页，按学校一学期最大 22 周逐页取
    const tasks = [];
    for (let w = 1; w <= 22; w++) {
      tasks.push(post('/ezzyjw/frame/desk/showLessonScheduleInfosV14.action?xn=' +
        encodeURIComponent(xn) + '&xq=' + encodeURIComponent(xq) + '&jxz=' + w, ''));
    }
    const settled = await Promise.allSettled(tasks);
    const pages = settled
      .filter(function (r) { return r.status === 'fulfilled' && r.value && r.value.length > 2000; })
      .map(function (r) { return r.value; });
    if (!pages.length) throw new Error('课表接口未返回数据，请确认该学期已排课或重新登录');
    return pages;
  }

  async function runImportFlow() {
    toast('正在读取学期信息…');
    const sem = await chooseSemester();
    if (!sem) { toast('已取消，未导入'); return; }

    toast('正在读取课表…');
    const pages = await fetchPages(sem.xn, sem.xq);
    const slots = parseTimeSlots(pages[0]);
    let raw = [];
    pages.forEach(function (html) { raw = raw.concat(parseCourses(html)); });
    const norm = normalizeCourses(raw);
    if (!norm.courses.length) throw new Error('未解析到课程，请确认所选学期已排课');

    let tip = '学期：' + sem.label + '\n课程：' + norm.courses.length + ' 条';
    if (norm.skipped) tip += '\n跳过：' + norm.skipped + ' 条信息不全的记录';
    if (slots.length) tip += '\n作息：' + slots.length + ' 节';
    const ok = await alert('确认导入', tip + '\n是否继续？', '开始导入');
    if (!ok) { toast('已取消，未导入'); return; }

    const saved = await saveOk('saveImportedCourses', JSON.stringify(norm.courses));
    if (!saved) throw new Error('课程保存失败');

    let slotsFailed = false;
    if (slots.length) {
      try { slotsFailed = !(await saveOk('savePresetTimeSlots', JSON.stringify(slots))); } catch (e) { slotsFailed = true; }
    }

    await notifyTaskCompletion();
    toast('已导入 ' + norm.courses.length + ' 条课程' +
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
