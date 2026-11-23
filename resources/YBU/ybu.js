// 延边大学（jwxt.ybu.edu.cn，金智 jsxsd 教务）整学期课表适配器
(async function main() {
  const ORIGIN = location.origin;
  const PATH = '/jsxsd/xskb/xskb_list.do';

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

  function expandWeeks(str) {
    const set = new Set();
    String(str).split(',').forEach(function (part) {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (a >= 1 && b >= a) {
        for (let i = a; i <= b && i <= 30; i++) set.add(i);
      }
    });
    return Array.from(set).sort(function (x, y) { return x - y; });
  }

  async function fetchAcademicOptions() {
    const res = await fetch(ORIGIN + PATH, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('课表页请求失败 ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#xnxq01id');
    if (!sel) throw new Error('未找到学年学期下拉框，请确认已登录教务系统');
    const opts = Array.from(sel.querySelectorAll('option')).map(function (o) {
      return { value: o.value, text: (o.textContent || '').trim() };
    }).filter(function (o) { return o.value; });
    if (!opts.length) throw new Error('学年学期列表为空');
    let curIdx = opts.findIndex(function (o) { return o.selected || o.value === sel.value; });
    if (curIdx < 0) curIdx = 0;
    return { opts: opts, curIdx: curIdx, curValue: sel.value, html: html };
  }

  async function switchSemester(sem) {
    const body = new URLSearchParams();
    body.set('cj0701id', '');
    body.set('zc', '');
    body.set('demo', '');
    body.set('xnxq01id', sem.value);
    body.set('kbjcmsid', '');
    const res = await fetch(ORIGIN + PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString()
    });
    if (!res.ok) throw new Error('课表查询失败 ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#xnxq01id');
    // 切换失败时不要拿旧课表继续导入
    if (sel && sel.value && sel.value !== sem.value) {
      throw new Error('切换学期失败，请重新登录后再试');
    }
    return html;
  }

  function parseSchedule(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#kbtable');
    if (!table) throw new Error('未找到学期课表表格，可能登录已失效');
    const raw = [];
    Array.from(table.querySelectorAll('tr')).forEach(function (tr) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 7) return;
      Array.from(tds).forEach(function (td, i) {
        if (i > 6) return;
        const day = i + 1;
        const detail = td.querySelector('div.kbcontent');
        if (!detail) return;
        detail.innerHTML.split(/-{5,}/).forEach(function (b) {
          if (!b.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim()) return;
          const weekM = b.match(/<font[^>]*title=['"]周次\(节次\)['"][^>]*>([\s\S]*?)<\/font>/i);
          if (!weekM) return;
          const wtext = weekM[1];
          const wm = wtext.match(/([\d,\-]+)\(周\)/);
          const sm = wtext.match(/\[(\d+)-(\d+)节\]/);
          if (!wm || !sm) return;
          const weeks = expandWeeks(wm[1]);
          if (!weeks.length) return;
          const teacherM = b.match(/<font[^>]*title=['"]老师['"][^>]*>([\s\S]*?)<\/font>/i);
          const roomM = b.match(/<font[^>]*title=['"]教室['"][^>]*>([\s\S]*?)<\/font>/i);
          const namePart = b.split(/<font[^>]*title=['"]老师['"]/i)[0];
          const name = namePart.replace(/<br\s*\/?>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
          if (!name) return;
          raw.push({
            name: name,
            position: roomM ? roomM[1].replace(/<[^>]*>/g, '').trim() : '',
            teacher: teacherM ? teacherM[1].replace(/<[^>]*>/g, '').trim() : '',
            day: day,
            startSection: parseInt(sm[1], 10),
            endSection: parseInt(sm[2], 10),
            weeks: weeks
          });
        });
      });
    });
    return raw;
  }

  function fetchTimeSlots(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('#kbtable');
    if (!table) return [];
    const slots = [];
    const toMin = function (s) { const p = s.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); };
    const toStr = function (v) { return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); };
    Array.from(table.querySelectorAll('tr')).forEach(function (tr) {
      const th = tr.querySelector('th');
      if (!th || tr.querySelectorAll('td').length < 7) return;
      const m = (th.textContent || '').replace(/\s+/g, ' ').match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (!m) return;
      const a = toMin(m[1]), b = toMin(m[2]);
      const mid = a + Math.floor((b - a) / 2);
      slots.push({ number: slots.length + 1, startTime: toStr(a), endTime: toStr(mid) });
      slots.push({ number: slots.length + 1, startTime: toStr(mid), endTime: toStr(b) });
    });
    return slots;
  }

  function normalizeCourses(list) {
    let bad = 0;
    const map = new Map();
    for (const c of list) {
      const ok = c && c.name && Number.isInteger(c.day) && c.day >= 1 && c.day <= 7 &&
        Number.isInteger(c.startSection) && c.startSection >= 1 &&
        Number.isInteger(c.endSection) && c.endSection >= c.startSection &&
        Array.isArray(c.weeks) && c.weeks.length > 0;
      if (!ok) { bad++; continue; }
      const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
      if (map.has(key)) {
        const e = map.get(key);
        e.weeks = Array.from(new Set(e.weeks.concat(c.weeks))).sort(function (a, b) { return a - b; });
      } else {
        map.set(key, {
          name: c.name, position: c.position, teacher: c.teacher, day: c.day,
          startSection: c.startSection, endSection: c.endSection,
          weeks: Array.from(new Set(c.weeks)).sort(function (a, b) { return a - b; })
        });
      }
    }
    const merged = [];
    Array.from(map.values()).forEach(function (c) {
      const base = [c.name, c.teacher, c.position, c.day, c.weeks.join(',')].join('|');
      const hit = merged.find(function (o) {
        return [o.name, o.teacher, o.position, o.day, o.weeks.join(',')].join('|') === base &&
          (o.endSection + 1 === c.startSection || c.endSection + 1 === o.startSection);
      });
      if (hit) {
        hit.startSection = Math.min(hit.startSection, c.startSection);
        hit.endSection = Math.max(hit.endSection, c.endSection);
      } else {
        merged.push(c);
      }
    });
    return { courses: merged, bad: bad };
  }

  async function runImportFlow() {
    const opt = await fetchAcademicOptions();
    let sem;
    // 只有一个学期时直接使用，避免多余的选择交互
    if (opt.opts.length === 1) {
      sem = opt.opts[0];
    } else {
      const idx = await select('选择学年学期', opt.opts.map(function (o) { return o.text; }), opt.curIdx);
      if (idx === null || idx === undefined || Number(idx) < 0 || !opt.opts[Number(idx)]) {
        toast('已取消，未导入');
        return;
      }
      sem = opt.opts[Number(idx)];
    }

    const html = opt.curValue === sem.value ? opt.html : await switchSemester(sem);
    const result = normalizeCourses(parseSchedule(html));
    if (!result.courses.length) throw new Error('未解析到课程，请确认该学期课表已排定');
    const slots = fetchTimeSlots(html);

    let tip = '学期：' + sem.text + '\n课程：' + result.courses.length + ' 条';
    if (result.bad) tip += '（跳过 ' + result.bad + ' 条异常）';
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
    toast('已导入 ' + result.courses.length + ' 条课程' +
      (result.bad ? '，跳过 ' + result.bad + ' 条异常' : '') +
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
